"""Message-scoped MathJax compilation through one local, recyclable process."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import zlib
from collections import OrderedDict
from pathlib import Path
from typing import Any


class MathCompiler:
    """Called off the drawing thread; widths never participate in compilation."""

    def __init__(self, settings: dict[str, Any] | None = None, *, idle_seconds: float = 60):
        self.settings = settings or {}
        self.idle_seconds = idle_seconds
        self.lock = threading.RLock()
        self.process: subprocess.Popen[str] | None = None
        self.timer: threading.Timer | None = None
        self.cache: OrderedDict[tuple[str, str], tuple[bytes, int]] = OrderedDict()
        self.cache_bytes = 0
        self.compilations = 0
        self.starts = 0
        self.closed = False

    def compile(self, text: str, identifier: str) -> dict[str, Any]:
        key = (identifier, text)
        with self.lock:
            if self.closed:
                raise RuntimeError("数学编译进程已关闭")
            if key in self.cache:
                self.cache.move_to_end(key)
                cached: dict[str, Any] = json.loads(zlib.decompress(self.cache[key][0]))
                return cached
            if self.timer:
                self.timer.cancel()
                self.timer = None
            node = self.settings.get("native_node") or os.environ.get("COMPUTER_BRIDGE_NODE") or shutil.which("node")
            if not node:
                raise RuntimeError("本机 Node 环境缺失，请重新运行安装程序")
            if self.process is None:
                self.process = subprocess.Popen(
                    [str(node), str(Path(__file__).parent / "native/chat-math-compile.mjs")],
                    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
                    creationflags=0x08000000 if os.name == "nt" else 0,
                )
                self.starts += 1
            process = self.process
            assert process.stdin is not None and process.stdout is not None
            try:
                process.stdin.write(json.dumps({"id": identifier, "text": text}, ensure_ascii=False) + "\n")
                process.stdin.flush()
                response = process.stdout.readline()
                if not response:
                    raise RuntimeError("本机数学编译进程未返回结果")
                document: dict[str, Any] = json.loads(response)
                if document.get("id") != identifier:
                    raise RuntimeError("本机数学编译结果与当前消息不匹配")
            except (OSError, ValueError, RuntimeError):
                self._stop()
                raise
            self.compilations += 1
            # MathJax's tag configurations retain message contexts in its global
            # factory. Recycle only after a completed reply; cached trees remain
            # independent of the process and are never compiled again for resize.
            recycle = bool(document.get("recycle", False))
            if recycle:
                self._stop()
            packed = zlib.compress(response.encode("utf-8"), level=1)
            size = len(text.encode("utf-8")) + len(packed)
            if size <= 32 * 1024 * 1024:
                self.cache[key] = (packed, size)
                self.cache_bytes += size
                while self.cache_bytes > 32 * 1024 * 1024:
                    _, removed = self.cache.popitem(last=False)
                    self.cache_bytes -= removed[1]
            if self.process is not None:
                self.timer = threading.Timer(self.idle_seconds, self._idle)
                self.timer.daemon = True
                self.timer.start()
            return document

    def _idle(self) -> None:
        with self.lock:
            self.timer = None
            self._stop()

    def _stop(self) -> None:
        process, self.process = self.process, None
        if process is None:
            return
        if process.stdin:
            process.stdin.close()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.terminate()
            process.wait()
        if process.stdout:
            process.stdout.close()

    def close(self) -> None:
        with self.lock:
            self.closed = True
            if self.timer:
                self.timer.cancel()
                self.timer = None
            self._stop()
            self.cache.clear()
            self.cache_bytes = 0
