"""Device-local operations. Network reconnection does not own command lifetime."""

from __future__ import annotations

import asyncio
import json
import hashlib
import time
import shutil
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .access import cleanup_sandbox, command_argv
from .common import Error, Json, home, save, uid
from .file_results import read_original
from .native_commands import NativeCommand
from .requests import bind_operation


@dataclass
class Operation:
    session: str
    kind: str
    directory: Path
    task: asyncio.Task[None] | None = None
    process: NativeCommand | None = None
    started: asyncio.Event = field(default_factory=asyncio.Event)
    state: str = "running"
    approval: Json | None = None
    expiry: asyncio.Task[None] | None = None


class Operations:
    def __init__(self, directory: Path | None = None):
        self.directory = directory or home() / "operations"
        self.entries: dict[str, Operation] = {}
        self.keys: dict[tuple[str, str], str] = {}
        self.node_path: str | None = None
        self.grant_base = self.directory.parent / "sandbox-grants"
        self.runtimes: set[NativeCommand] = set()
        for path in self.directory.glob("*/approval.json"):
            approval = json.loads(path.read_text(encoding="utf-8"))
            if approval["state"] == "pending" and not (path.parent / "result.json").exists():
                approval["state"] = "cancelled"
                save(path, approval)
                save(path.parent / "result.json", {"state": "failed", "error": {
                    "code": "approval_cancelled", "message": "电脑组件已重启，待批准的命令没有执行"}})

    def start(
        self,
        session: str,
        root: Path,
        kind: str,
        perform: Callable[[], Awaitable[Any]],
        request_key: str | None = None,
    ) -> Json:
        key = (session, request_key) if request_key else None
        if key and key in self.keys:
            identity = self.keys[key]
            return {"operation": identity, "state": self.entries[identity].state}
        identity = uid("operation")
        path = self.directory / identity
        path.mkdir(parents=True)
        entry = Operation(session, kind, path)
        self.entries[identity] = entry
        save(path / "metadata.json", {"session": session, "kind": kind, "cwd": str(root)})
        if kind == "command":
            bind_operation(identity)
        if key:
            self.keys[key] = identity

        async def run() -> None:
            try:
                result = {"result": await perform()}
                entry.state = "completed"
            except asyncio.CancelledError:
                entry.state = "cancelled"
                result = {"error": {"code": "cancelled", "message": "本次操作已取消"}}
            except Exception as exc:
                entry.state = "failed"
                result = {
                    "error": exc.as_dict()
                    if isinstance(exc, Error)
                    else {"code": type(exc).__name__, "message": str(exc)}
                }
            if entry.expiry:
                entry.expiry.cancel()
            save(path / "result.json", {"state": entry.state, **result})
            entry.started.set()

        entry.task = asyncio.create_task(run())
        return {"operation": identity, "state": "running"}

    def get(self, session: str, identity: str) -> Operation:
        if identity not in self.entries:
            path = self.directory / identity
            if (path / "result.json").is_file():
                meta = json.loads((path / "metadata.json").read_text(encoding="utf-8"))
                result = json.loads((path / "result.json").read_text(encoding="utf-8"))
                self.entries[identity] = Operation(meta["session"], meta["kind"], path, state=result["state"])
        entry = self.entries.get(identity)
        if entry is None or entry.session != session:
            raise Error("operation_missing", "操作不属于这个工作会话，或已经释放")
        return entry

    async def wait(
        self, session: str, identity: str, seconds: float = 1, consume: bool | None = None
    ) -> Json:
        entry = self.get(session, identity)
        if entry.task and entry.state != "awaiting_approval":
            await asyncio.wait({entry.task}, timeout=max(0, min(seconds, 30)))
        result: Json = {"operation": identity, "state": entry.state}
        if entry.state == "awaiting_approval":
            result["approval"] = self.approval_details(session, identity)
        elif entry.state != "running":
            result.update(json.loads((entry.directory / "result.json").read_text(encoding="utf-8")))
            if entry.kind == "command" and "result" in result:
                status = await entry.process.output_status() if entry.process else None
                result["result"] = await asyncio.to_thread(self.output_preview, result["result"], status)
            if consume is True or (consume is None and entry.kind == "business"):
                if entry.kind == "command" and "result" in result:
                    for stream in ("stdout", "stderr"):
                        result["result"].pop(stream + "_path", None)
                    result["released"] = True
                await self.release(session, identity)
        return result

    def output_preview(self, value: Json, status: Json | None = None) -> Json:
        result = dict(value)
        result.pop("output_status", None)
        for stream in ("stdout", "stderr"):
            preview = result.pop(stream + "_preview", None)
            preview_size = result.pop(stream + "_preview_size", 0)
            current = status.get(stream, {}) if status is not None else {}
            result[stream + "_size"] = current.get("size", preview_size)
            result[stream + "_next_offset"] = 0
            result[stream + "_complete"] = False
            if preview is not None:
                result[stream + "_text"] = preview["text"]
            if current.get("error"):
                result.setdefault("output_error", {})[stream] = current["error"]
            if status is not None and not current.get("closed", False):
                # DSH has completed its root result, but a descendant can still append.
                # Never read that live file to decide whether the command succeeded.
                result[stream + "_state"] = "streaming"
                continue
            try:
                window = read_original(Path(value[stream + "_path"]), length=4096, node_path=self.node_path)
            except Exception as exc:
                result[stream + "_state"] = "unavailable"
                result.setdefault("output_error", {})[stream] = {
                    "code": getattr(exc, "code", type(exc).__name__), "message": str(exc),
                }
                continue
            result[stream + "_state"] = "closed"
            result[stream + "_size"] = window["size"]
            result[stream + "_version"] = window["version"]
            result[stream + "_next_offset"] = window["next_offset"]
            result[stream + "_complete"] = window["eof"] and not window.get("binary", False)
            if "text" in window:
                # DSH owns bounded text presentation. Raw byte paging is Bridge transport.
                result[stream + "_text"] = preview["text"] if preview is not None else window["text"]
                if preview is not None:
                    complete = not preview["truncated"] and preview_size == window["size"]
                    result[stream + "_complete"] = complete
                    result[stream + "_next_offset"] = window["size"] if complete else 0
            else:
                result.pop(stream + "_text", None)
                result[stream + "_binary"] = True
        return result

    async def release(self, session: str, identity: str) -> Json:
        entry = self.get(session, identity)
        if entry.state in {"running", "awaiting_approval"}:
            raise Error("operation_running", "请先等待完成或停止命令")
        if entry.process is not None:
            await entry.process.release_output()
        shutil.rmtree(entry.directory)
        del self.entries[identity]
        self.keys = {key: value for key, value in self.keys.items() if value != identity}
        return {"released": True}

    async def command(
        self,
        session: str,
        root: Path,
        command: str,
        cwd: Path,
        capture: Callable[[Json], Awaitable[Json]] | None = None,
        request_key: str | None = None,
        roots: list[Path] | None = None,
        sandbox_permissions: str | None = None,
        justification: str | None = None,
        description: str | None = None,
        approval_context: Json | None = None,
    ) -> Json:
        identity = ""

        async def perform() -> Json:
            entry = self.get(session, identity)
            out, err = entry.directory / "stdout", entry.directory / "stderr"
            prefix = command_argv([], roots, entry.directory, self.node_path, self.grant_base)
            try:
                try:
                    entry.process = await NativeCommand.launch({
                        "command": command, "cwd": str(cwd), "sandbox_prefix": prefix,
                        "stdout_path": str(out), "stderr_path": str(err), "session": session,
                        "sandbox_permissions": sandbox_permissions, "justification": justification,
                        "description": description,

                    }, entry.directory, self.node_path)
                    self.runtimes.add(entry.process)
                    entry.process.reader.add_done_callback(lambda _, process=entry.process: self.runtimes.discard(process))
                    requested = await entry.process.ready
                    if requested is not None:
                        if approval_context is None:
                            raise Error("approval_unavailable", "命令审批上下文不可用")
                        details = {**approval_context, "session": session, "operation": identity,
                            "command": command, "cwd": str(cwd), "target": sandbox_permissions,
                            "justification": justification, "description": description,
                            "reason": requested["reason"]}
                        digest = hashlib.sha256(json.dumps(details, sort_keys=True, ensure_ascii=False,
                                                          separators=(",", ":")).encode()).hexdigest()
                        entry.approval = {**details, "id": uid("approval"), "digest": digest,
                                          "state": "pending", "expires_at": time.time() + 600}
                        save(entry.directory / "approval.json", entry.approval)
                        entry.state = "awaiting_approval"
                        entry.started.set()
                        async def expire() -> None:
                            await asyncio.sleep(max(0, entry.approval["expires_at"] - time.time()))
                            if entry.approval["state"] == "pending":
                                entry.approval["state"] = "expired"
                                save(entry.directory / "approval.json", entry.approval)
                                await entry.process.control("approval", decision="cancelled")
                        entry.expiry = asyncio.create_task(expire())
                    await entry.process.started
                    entry.state = "running"
                finally:
                    entry.started.set()
                result = await entry.process.wait()
            except BaseException:
                if entry.process is not None:
                    await entry.process.close()
                if entry.approval and entry.approval["state"] in {"rejected", "cancelled", "expired", "invalidated"}:
                    state = entry.approval["state"]
                    raise Error("approval_" + state, "命令审批已" + state + "，命令没有执行") from None
                raise
            finally:
                await cleanup_sandbox(entry.directory, self.node_path)
            return await capture(result) if capture else result

        result = self.start(session, root, "command", perform, request_key)
        identity = result["operation"]
        entry = self.get(session, identity)
        await entry.started.wait()
        return {**result, "state": entry.state}

    def approval_details(self, session: str, identity: str) -> Json:
        entry = self.get(session, identity)
        path = entry.directory / "approval.json"
        if entry.approval is None and path.exists():
            entry.approval = json.loads(path.read_text(encoding="utf-8"))
        if entry.approval is None:
            raise Error("approval_missing", "该命令没有审批请求")
        return dict(entry.approval)

    async def decide(self, session: str, identity: str, approval_id: str, digest: str,
                     decision: str, context: Json) -> Json:
        entry = self.get(session, identity)
        approval = self.approval_details(session, identity)
        if decision not in {"allowed-once", "rejected", "cancelled"}:
            raise Error("approval_decision", "未知审批结果")
        if approval["id"] != approval_id or approval["digest"] != digest:
            raise Error("approval_mismatch", "审批不属于原命令")
        if any(approval.get(key) != context.get(key) for key in ("device", "caller", "revision")):
            if approval["state"] == "pending" and entry.process:
                entry.approval["state"] = "invalidated"
                save(entry.directory / "approval.json", entry.approval)
                await entry.process.control("approval", decision="cancelled")
            raise Error("approval_invalidated", "命令授权上下文已变化，请重新申请")
        if approval["state"] != "pending":
            if approval.get("decision") == decision:
                return await self.wait(session, identity, 0)
            raise Error("approval_finished", "该审批已结束")
        if approval["expires_at"] <= time.time():
            decision = "cancelled"
            state = "expired"
        else:
            state = "approved" if decision == "allowed-once" else decision
        entry.approval.update(state=state, decision=decision)
        save(entry.directory / "approval.json", entry.approval)
        if entry.expiry:
            entry.expiry.cancel()
        if not entry.process:
            raise Error("approval_cancelled", "原命令实例已结束")
        await entry.process.control("approval", decision=decision)
        if decision == "allowed-once":
            # Called under Computer.access_lock: a revoke cannot race this spawn.
            await entry.process.started
        elif entry.task:
            await entry.task
        return await self.wait(session, identity, 0)

    async def input(self, session: str, identity: str, text: str, eof: bool = False) -> Json:
        entry = self.get(session, identity)
        if not entry.process or entry.state != "running":
            raise Error("stdin_unavailable", "该操作当前没有可写的标准输入")
        return {"operation": identity, **await entry.process.control("input", text=text, eof=eof)}

    async def stop(self, session: str, identity: str) -> Json:
        entry = self.get(session, identity)
        if entry.kind != "command":
            raise Error("not_command", "这个入口只停止本机命令")
        if entry.approval and entry.approval["state"] == "pending":
            entry.approval["state"] = "cancelled"
            save(entry.directory / "approval.json", entry.approval)
        if entry.process:
            await entry.process.stop()
            if entry.task:
                await entry.task
        elif entry.task and not entry.task.done():
            entry.task.cancel()
            await entry.task
        return {"operation": identity, "state": entry.state}

    async def close(self) -> None:
        # Released operations may still own descendants. The agent owns every runtime.
        await asyncio.gather(*(runtime.close() for runtime in list(self.runtimes)))
        for entry in self.entries.values():
            if entry.process:
                await entry.process.stop()
                if entry.task:
                    await entry.task
            if entry.task and not entry.task.done():
                entry.task.cancel()
        await asyncio.gather(*[e.task for e in self.entries.values() if e.task], return_exceptions=True)
