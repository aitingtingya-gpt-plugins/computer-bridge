"""JSON control transport for DSH-owned command execution, input and cancellation."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import BinaryIO

from .common import Error, Json, save


class NativeCommand:
    def __init__(self, process: asyncio.subprocess.Process, log: BinaryIO, log_path: Path):
        self.process = process
        self.log = log
        self.log_path = log_path
        loop = asyncio.get_running_loop()
        self.started: asyncio.Future[None] = loop.create_future()
        self.ready: asyncio.Future[Json | None] = loop.create_future()
        self.result: asyncio.Future[Json] = loop.create_future()
        self.pending: dict[int, asyncio.Future[Json]] = {}
        self.sequence = 0
        self.write_lock = asyncio.Lock()
        self.reader = asyncio.create_task(self._read())

    @classmethod
    async def launch(cls, request: Json, directory: Path, node_path: str | None) -> NativeCommand:
        node = node_path or os.environ.get("COMPUTER_BRIDGE_NODE") or shutil.which("node")
        runtime = Path(__file__).parent / "native/command-runtime.mjs"
        if not node or not runtime.is_file():
            raise Error("runtime_missing", "请重新安装包含 DSH 工具源码运行组件的 Computer Bridge")
        request_file = directory / "command.json"
        save(request_file, {"protocol": 1, "operation": directory.name, **request})
        # Hide only the bridge transport window. DSH owns all command creation flags.
        options: dict = {}
        if os.name == "nt":
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = subprocess.SW_HIDE
            options["startupinfo"] = startup
        # Runtime diagnostics can outlive released command output while descendants run.
        logs = directory.parent / ".runtime-logs"
        logs.mkdir(exist_ok=True)
        log_path = logs / (directory.name + ".log")
        log = log_path.open("wb")
        try:
            process = await asyncio.create_subprocess_exec(
                node, str(runtime), str(request_file), cwd=request["cwd"],
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                stderr=log, limit=1024 * 1024, **options,
            )
        except BaseException:
            log.close()
            raise
        return cls(process, log, log_path)

    async def _read(self) -> None:
        failure: BaseException | None = None
        try:
            assert self.process.stdout is not None
            while line := await self.process.stdout.readline():
                message = json.loads(line)
                event = message.get("event")
                if event == "approval_requested":
                    if not self.ready.done():
                        self.ready.set_result(message)
                elif event == "started":
                    if not self.ready.done():
                        self.ready.set_result(None)
                    if not self.started.done():
                        self.started.set_result(None)
                elif event == "job_registered":
                    continue  # The original job registry persists its facts in jobs.jsonl.
                elif event == "completed":
                    if not self.result.done():
                        self.result.set_result(message["result"])
                elif event == "failed":
                    error = message["error"]
                    failure = Error(error["code"], error["message"])
                elif "id" in message:
                    waiting = self.pending.pop(message["id"], None)
                    if waiting is not None and not waiting.done():
                        if "error" in message:
                            error = message["error"]
                            waiting.set_exception(Error(error["code"], error["message"]))
                        else:
                            waiting.set_result(message["result"])
                else:
                    raise Error("command_protocol", "命令运行组件返回了无法识别的控制消息")
            code = await self.process.wait()
            failure = failure or Error("command_runtime", f"命令运行组件提前退出，状态码 {code}；见 {self.log_path}")
        except BaseException as exc:
            failure = exc
            # EOF is the runtime's host-loss signal; let DSH dispose its managed range.
            if self.process.returncode is None:
                if self.process.stdin:
                    self.process.stdin.close()
                try:
                    await asyncio.wait_for(self.process.wait(), 15)
                except TimeoutError:
                    self.process.kill()
                    await self.process.wait()
        finally:
            self.log.close()
            for waiting in [self.ready, self.started, self.result, *self.pending.values()]:
                if not waiting.done():
                    waiting.set_exception(failure or Error("command_runtime", "命令控制连接已关闭"))
            self.pending.clear()

    async def control(self, method: str, **payload: object) -> Json:
        if self.process.returncode is not None or not self.process.stdin:
            raise Error("stdin_unavailable", "命令已结束，没有可写的标准输入")
        self.sequence += 1
        identity = self.sequence
        waiting: asyncio.Future[Json] = asyncio.get_running_loop().create_future()
        self.pending[identity] = waiting
        try:
            async with self.write_lock:
                self.process.stdin.write(
                    (json.dumps({"id": identity, "method": method, **payload}, ensure_ascii=False) + "\n").encode("utf-8")
                )
                await self.process.stdin.drain()
            return await waiting
        finally:
            self.pending.pop(identity, None)

    async def wait(self) -> Json:
        # DSH root completion and managed-range lifetime are separate facts.
        return await self.result

    async def output_status(self) -> Json | None:
        if self.reader.done():
            return None  # The only writer has exited and closed every output descriptor.
        try:
            return await self.control("output_status")
        except (Error, BrokenPipeError, ConnectionResetError):
            await self.reader  # EOF may race the status acknowledgement during normal teardown.
            return None

    async def stop(self) -> None:
        if self.process.returncode is None:
            try:
                await self.control("stop")
            except (Error, BrokenPipeError, ConnectionResetError):
                # Completion can close the control channel while this stop is in flight.
                # The reader still owns the authoritative command outcome.
                pass
        await self.reader

    async def release_output(self) -> None:
        if self.process.returncode is not None:
            return
        try:
            await self.control("release")
        except (Error, BrokenPipeError, ConnectionResetError):
            if self.process.returncode is None:
                await self.reader

    async def close(self) -> None:
        await self.stop()
        # Consume failure futures even when preparation failed before the caller received a handle.
        for future in (self.ready, self.started, self.result):
            if future.done() and not future.cancelled():
                future.exception()
