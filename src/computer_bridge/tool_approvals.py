"""Hold unapproved calls on the target computer, beside the original receipts."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from pathlib import Path

from .common import Error, Json, save
from .requests import Requests


class ToolApprovals:
    def __init__(self, directory: Path, receipts: Requests):
        self.directory, self.receipts = directory, receipts
        self.expiry: dict[str, asyncio.TimerHandle] = {}

    def expire(self, identity: str) -> None:
        timer = self.expiry.pop(identity, None)
        if timer:
            timer.cancel()
        self.path(identity).unlink(missing_ok=True)

    def path(self, identity: str) -> Path:
        return self.directory / (identity + ".json")

    def arm(self, identity: str, seconds: float) -> None:
        if identity in self.expiry:
            self.expiry.pop(identity).cancel()
        self.expiry[identity] = asyncio.get_running_loop().call_later(max(0, seconds), self.expire, identity)

    def start(self) -> None:
        for path in self.directory.glob("*.json"):
            remaining = path.stat().st_mtime + 600 - time.time()
            if remaining <= 0:
                self.expire(path.stem)
            else:
                self.arm(path.stem, remaining)

    def prepare(self, request: Json) -> Json:
        identity = request["request_id"]
        path = self.path(identity)
        if path.exists():
            original = json.loads(path.read_text(encoding="utf-8"))
            if original["fingerprint"] != request["fingerprint"] or original["caller"] != request["caller"]:
                raise Error("request_conflict", "原工具申请的参数或调用方不同")
        else:
            save(path, request)
        self.arm(identity, request["expires_at"] - time.time())
        return {"prepared": True}

    async def decide(self, decision: Json, execute: Callable[[Json], Awaitable[Json]]) -> Json:
        identity = decision["request_id"]
        async def perform() -> Json:
            try:
                if decision["decision"] != "allowed-once":
                    return {"approved": False, "approval_state": decision["state"]}
                path = self.path(identity)
                if not path.is_file():
                    raise Error("approval_expired", "原工具申请已过期")
                original = json.loads(path.read_text(encoding="utf-8"))
                if (original["fingerprint"], original["caller"], original["revision"]) != (
                    decision["fingerprint"], decision["caller"], decision["revision"]
                ):
                    raise Error("approval_invalidated", "工具申请的授权已变化")
                if original["expires_at"] <= time.time():
                    raise Error("approval_expired", "原工具申请已过期")
                return await execute(original)
            finally:
                self.expire(identity)

        # Use the same receipt ID for all deliveries of the decision, including a
        # second click while the first call is still executing.
        parameters: Json = {}
        path = self.path(identity)
        if decision["decision"] == "allowed-once" and path.is_file():
            original = json.loads(path.read_text(encoding="utf-8"))
            if (original["method"] == "computer.transfer" and original["expires_at"] > time.time()
                    and (original["fingerprint"], original["caller"], original["revision"]) == (
                        decision["fingerprint"], decision["caller"], decision["revision"])):
                parameters = {**original["params"], "_tool_revision": original["revision"]}
        reply = await self.receipts.execute({**decision, "params": parameters, "retain_result": True}, perform)
        return {"_tool_error": reply["error"]} if "error" in reply else reply["result"]

    def close(self) -> None:
        for timer in self.expiry.values():
            timer.cancel()
        self.expiry.clear()
