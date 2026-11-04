"""Device-owned execution receipts. A socket is only a delivery route."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from collections.abc import Awaitable, Callable
from contextvars import ContextVar
from pathlib import Path
from typing import cast

from .common import Error, Json, save

_operation_binding: ContextVar[Callable[[str], None] | None] = ContextVar(
    "bridge_operation_binding", default=None
)


def bind_operation(operation: str) -> None:
    """Persist the request-to-operation link before its native process can start."""
    if binding := _operation_binding.get():
        binding(operation)


class Requests:
    def __init__(
        self,
        directory: Path,
        read: Callable[[str, Json], Awaitable[Json]],
        validate: Callable[[str, Json], None],
    ):
        self.directory = directory
        self.read = read
        self.validate = validate
        directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(directory / "requests.sqlite3")
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("""CREATE TABLE IF NOT EXISTS requests (
            id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, method TEXT NOT NULL,
            state TEXT NOT NULL, created REAL NOT NULL, completed REAL, acknowledged INTEGER DEFAULT 0
        )""")
        columns = {row["name"] for row in self.db.execute("PRAGMA table_info(requests)")}
        if "operation_id" not in columns:
            self.db.execute("ALTER TABLE requests ADD COLUMN operation_id TEXT")
        self.db.execute("UPDATE requests SET state='unknown' WHERE state='running'")
        self.db.commit()
        self.tasks: dict[str, asyncio.Task[Json]] = {}
        self.expire()

    def expire(self) -> None:
        self.last_cleanup = time.time()
        for row in self.db.execute(
            "SELECT id FROM requests WHERE completed < ? AND state='completed'", (time.time() - 86400,)
        ).fetchall():
            (self.directory / (row["id"] + ".json")).unlink(missing_ok=True)
            (self.directory / (row["id"] + ".read.json")).unlink(missing_ok=True)
            self.db.execute("UPDATE requests SET state='expired' WHERE id=?", (row["id"],))
        self.db.commit()

    async def execute(self, request: Json, perform: Callable[[], Awaitable[Json]],
                      received: Callable[[], Awaitable[None]] | None = None) -> Json:
        if time.time() - self.last_cleanup > 60:
            self.expire()
        identity, fingerprint = request["request_id"], request["fingerprint"]
        row = self.db.execute("SELECT * FROM requests WHERE id=?", (identity,)).fetchone()
        if row:
            if row["fingerprint"] != fingerprint:
                raise Error("request_conflict", "同一请求号的参数不同")
            if received:
                await received()
            if identity in self.tasks:
                return await asyncio.shield(self.tasks[identity])
            return await self.result(identity)
        self.db.execute(
            "INSERT INTO requests(id,fingerprint,method,state,created) VALUES(?,?,?,'running',?)",
            (identity, fingerprint, request["method"], time.time()),
        )
        self.db.commit()

        async def run() -> Json:
            def bind(operation: str) -> None:
                self.db.execute("UPDATE requests SET operation_id=? WHERE id=?", (operation, identity))
                self.db.commit()

            token = _operation_binding.set(bind if request["method"] == "computer.exec" else None)
            try:
                response: Json = {"result": await perform()}
            except Exception as exc:
                response = {"error": {"code": getattr(exc, "code", type(exc).__name__), "message": str(exc)}}
            finally:
                _operation_binding.reset(token)
            await asyncio.to_thread(save, self.directory / (identity + ".json"), response)
            if self.readonly(request) and "result" in response:
                parameters = dict(request["params"])
                parameters.pop("_access", None)
                if request["method"] == "computer.files" and parameters["operation"] == "read":
                    parameters["payload"] = {
                        **parameters.get("payload", {}),
                        "version": response["result"].get("version"),
                    }
                await asyncio.to_thread(
                    save,
                    self.directory / (identity + ".read.json"),
                    {"method": request["method"], "params": parameters},
                )
            self.db.execute(
                "UPDATE requests SET state='completed',completed=? WHERE id=?", (time.time(), identity)
            )
            self.db.commit()
            return response

        task = asyncio.create_task(run())
        self.tasks[identity] = task
        task.add_done_callback(lambda _: self.tasks.pop(identity, None))
        if received:
            await received()
        return await asyncio.shield(task)

    @staticmethod
    def readonly(request: Json) -> bool:
        method, args = request["method"], request["params"]
        return (
            method
            in {
                "computer.workspaces",
                "computer.image",
                "computer.skills",
                "computer.agents",
                "computer.jobs",
                "computer.modules",
                "computer.module_tools",
                "computer.present",
            }
            or (method == "computer.files" and args["operation"] in {"read", "list", "glob", "search"})
            or method == "computer.wait"
            and not args.get("consume")
        )

    async def result(self, identity: str) -> Json:
        row = self.db.execute(
            "SELECT method,state,completed,operation_id FROM requests WHERE id=?", (identity,)
        ).fetchone()
        if row is None:
            raise Error("request_missing", "电脑尚未收到这个请求，可使用原 request_key 重试原调用")
        if row["state"] == "unknown" and row["operation_id"]:
            operation = self.directory.parent / "operations" / row["operation_id"]
            if (operation / "result.json").is_file():
                metadata = json.loads((operation / "metadata.json").read_text(encoding="utf-8"))
                response = {"result": await self.read("computer.wait", {
                    "session": metadata["session"], "operation": row["operation_id"],
                    "seconds": 0, "consume": False,
                })}
                await asyncio.to_thread(save, self.directory / (identity + ".json"), response)
                self.db.execute("UPDATE requests SET state='completed',completed=? WHERE id=?",
                                (time.time(), identity))
                self.db.commit()
                return response
        if row["state"] == "completed" and row["completed"] >= time.time() - 86400:
            result_file = self.directory / (identity + ".json")
            if result_file.exists():
                response = cast(Json, json.loads(
                    await asyncio.to_thread(result_file.read_text, encoding="utf-8")
                ))
                self.validate(row["method"], response)
                return response
            recipe = json.loads((self.directory / (identity + ".read.json")).read_text(encoding="utf-8"))
            return {"result": await self.read(recipe["method"], recipe["params"])}
        if row["state"] == "unknown":
            raise Error("request_unknown", "电脑进程曾退出，原操作结果待核实；没有自动重放")
        if row["state"] == "running":
            raise Error("request_running", "原请求仍在执行")
        raise Error("request_expired", "原请求回执已过期；没有重新执行")

    async def recover(self, identity: str | None, seconds: float = 0) -> Json:
        self.expire()
        if identity is None:
            rows = self.db.execute("""SELECT id AS request_id,method,state,created FROM requests
                WHERE state IN ('running','unknown') OR (state='completed' AND acknowledged=0)
                ORDER BY created DESC""").fetchall()
            return {"requests": [dict(row) for row in rows]}
        task = self.tasks.get(identity)
        if task:
            await asyncio.wait({task}, timeout=max(0, min(seconds, 30)))
            if not task.done():
                return {"state": "running"}
        row = self.db.execute("SELECT state,operation_id FROM requests WHERE id=?", (identity,)).fetchone()
        if row and row["state"] == "unknown" and row["operation_id"]:
            operation = self.directory.parent / "operations" / row["operation_id"]
            if not (operation / "result.json").is_file():
                return {"state": "unknown", "operation": row["operation_id"]}
        return {"state": "completed", "response": await self.result(identity)}

    def acknowledge(self, identity: str) -> None:
        self.db.execute("UPDATE requests SET acknowledged=1 WHERE id=?", (identity,))
        self.db.commit()
        if (self.directory / (identity + ".read.json")).exists():
            (self.directory / (identity + ".json")).unlink(missing_ok=True)

    async def close(self) -> None:
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.db.close()
