"""JSON transport to the vendored DSH file services; never retries a lost mutation."""

from __future__ import annotations

import atexit
import asyncio
import contextlib
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path

from .common import Error, Json


def _runtime_options() -> dict:
    """Hide the transport window while preserving the console inherited by DSH."""
    if os.name != "nt":
        return {}
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    return {"startupinfo": startup}


class FileRuntime:
    def __init__(self, node: str):
        self.node = node
        self.lock = threading.Lock()
        self.process: subprocess.Popen[str] | None = None

    def call(self, request: Json) -> Json:
        with self.lock:
            if self.process is None or self.process.poll() is not None:
                entry = Path(__file__).parent / "native/files-runtime.mjs"
                if not entry.is_file():
                    raise Error("runtime_missing", "请安装包含 DSH 文件运行组件的新版安装包")
                self.process = subprocess.Popen(
                    [self.node, str(entry)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    text=True, encoding="utf-8", bufsize=1,
                    **_runtime_options(),
                )
            process = self.process
            assert process.stdin is not None and process.stdout is not None
            try:
                process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
                process.stdin.flush()
                response = process.stdout.readline()
                if not response:
                    raise EOFError("DSH 文件运行组件在返回结果之前退出")
                result = json.loads(response)
            except (OSError, ValueError, EOFError) as exc:
                self._close()
                raise Error("file_runtime_lost", f"{exc}；未自动重复执行本次操作") from exc
            if "error" in result:
                raise Error(result["error"]["code"], result["error"]["message"])
            return result["result"]

    def _close(self) -> None:
        if self.process is None:
            return
        process, self.process = self.process, None
        if process.stdin:
            with contextlib.suppress(OSError):
                process.stdin.close()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait(timeout=5)
        if process.stdout:
            process.stdout.close()

    def close(self) -> None:
        with self.lock:
            self._close()


_runtimes: dict[str, FileRuntime] = {}
_runtime_lock = threading.Lock()


def file_call(operation: str, path: Path, args: Json | None = None, node: str | None = None) -> Json:
    executable = node or os.environ.get("COMPUTER_BRIDGE_NODE") or shutil.which("node")
    if not executable:
        raise Error("runtime_missing", "找不到 Node.js 文件运行组件")
    with _runtime_lock:
        runtime = _runtimes.setdefault(executable, FileRuntime(executable))
    return runtime.call({"operation": operation, "path": str(path), "args": args or {}})


def media_call(request: Json, node: str | None = None) -> Json:
    executable = node or os.environ.get("COMPUTER_BRIDGE_NODE") or shutil.which("node")
    entry = Path(__file__).parent / "native/media-runtime.mjs"
    if not executable or not entry.is_file():
        raise Error("runtime_missing", "请安装包含 DSH 媒体运行组件的新版安装包")
    response = subprocess.run(
        [executable, str(entry)], input=json.dumps(request, ensure_ascii=False),
        capture_output=True, text=True, encoding="utf-8", check=False, **_runtime_options(),
    )
    return _media_response(response.stdout, response.stderr, response.returncode)


async def media_call_async(request: Json, node: str | None = None) -> Json:
    executable = node or os.environ.get("COMPUTER_BRIDGE_NODE") or shutil.which("node")
    entry = Path(__file__).parent / "native/media-runtime.mjs"
    if not executable or not entry.is_file():
        raise Error("runtime_missing", "请安装包含 DSH 媒体运行组件的新版安装包")
    process = await asyncio.create_subprocess_exec(
        executable, str(entry), stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, **_runtime_options(),
    )
    try:
        output, error = await process.communicate(json.dumps(request, ensure_ascii=False).encode("utf-8"))
    finally:
        if process.returncode is None:
            process.terminate()
            await process.wait()
    return _media_response(output.decode("utf-8"), error.decode("utf-8", errors="replace"), process.returncode)


def _media_response(output: str, error: str, returncode: int) -> Json:
    if returncode:
        raise Error("media_runtime_failed", error.strip())
    try:
        result = json.loads(output)
    except ValueError as exc:
        raise Error("media_runtime_failed", "媒体运行组件返回了无效响应") from exc
    if "error" in result:
        raise Error(result["error"]["code"], result["error"]["message"])
    return result["result"]


@atexit.register
def close_file_runtimes() -> None:
    for runtime in _runtimes.values():
        runtime.close()
