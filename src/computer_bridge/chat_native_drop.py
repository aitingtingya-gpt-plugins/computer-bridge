"""Read Explorer drops in the active Windows Terminal pane, outside the editor."""

from __future__ import annotations

import asyncio
import base64
import ctypes
import os
import secrets
import sys
import tempfile
from collections.abc import Callable
from ctypes import wintypes
from pathlib import Path, PureWindowsPath
from typing import BinaryIO

from .chat_attachments import DroppedAttachment
from .chat_clipboard import windows_powershell
from .chat_native_menu import api

_CHUNK = 64 * 1024


class WindowsDrop:
    def __init__(self, files: Callable[[int, list[DroppedAttachment]], bool],
                 mouse: Callable[[str, int, int, int, int, int, int], None],
                 notice: Callable[[str], None]) -> None:
        self.files, self.mouse, self.notice = files, mouse, notice
        self.changed = asyncio.Event()
        self.layout: tuple[int, ...] = ()
        self.pending: int | None = None
        self.open_files: list[DroppedAttachment] = []

    @staticmethod
    def supported() -> bool:
        return sys.platform == "win32" and bool(os.environ.get("WT_SESSION")) and sys.stdin.isatty()

    def update(self, layout: tuple[int, ...]) -> None:
        if self.layout != layout:
            self.layout = layout
            self.changed.set()

    async def run(self) -> None:
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)  # type: ignore[attr-defined]
        get_title = api(kernel, "GetConsoleTitleW", wintypes.DWORD, wintypes.LPWSTR, wintypes.DWORD)
        set_title = api(kernel, "SetConsoleTitleW", wintypes.BOOL, wintypes.LPCWSTR)
        title = ctypes.create_unicode_buffer(32768)
        get_title(title, len(title))
        original = title.value
        # TermControl.HelpText exposes this pane's console title even when tab
        # labels are overridden. The probe adds no printable characters.
        token = secrets.token_hex(8)
        marker = "\u2063" + "".join("\u200b" if bit == "0" else "\u2060"
            for bit in f"{int(token, 16):064b}")
        tagged = original + marker
        if not set_title(tagged):
            return
        child: asyncio.subprocess.Process | None = None
        writer: asyncio.Task[None] | None = None
        try:
            script = Path(__file__).with_name("native") / "chat-drop-windows.ps1"
            child = await asyncio.create_subprocess_exec(*windows_powershell(), "-File", str(script),
                "-Token", token, stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, creationflags=0x08000000)
            assert child.stdout and child.stdin
            writer = asyncio.create_task(self.write_layout(child.stdin))
            await self.read_events(child.stdout)
            if await child.wait():
                self.notice("当前 Windows Terminal 未能启动直接拖放。")
        except (OSError, ValueError, asyncio.IncompleteReadError):
            self.notice("Windows 文件拖放连接已关闭。")
        finally:
            if writer:
                writer.cancel()
                await asyncio.gather(writer, return_exceptions=True)
            if child:
                if child.stdin:
                    child.stdin.close()
                try:
                    await asyncio.wait_for(child.wait(), 3)
                except TimeoutError:
                    child.kill()
                    await child.wait()
            get_title(title, len(title))
            if title.value == tagged:
                set_title(original)

    async def write_layout(self, stream: asyncio.StreamWriter) -> None:
        self.changed.set()
        try:
            while True:
                await self.changed.wait()
                self.changed.clear()
                command = "L " + " ".join(map(str, self.layout)) if self.layout else "H"
                stream.write((command + "\n").encode("ascii"))
                await stream.drain()
        except OSError:
            return

    async def read_events(self, stream: asyncio.StreamReader) -> None:
        batch: list[DroppedAttachment] | None = None
        target: BinaryIO | None = None
        epoch = remaining = 0
        try:
            while line := await stream.readline():
                kind, *fields = line.decode("ascii").split()
                if kind == "M":
                    generation, x, y, screen_x, screen_y, owner = map(int, fields[1:])
                    self.mouse(fields[0], generation, x, y, screen_x, screen_y, owner)
                elif kind == "B":
                    epoch = int(fields[0])
                    self.pending = epoch
                    batch = []
                elif kind == "F" and batch is not None and target is None:
                    remaining = int(fields[0])
                    name = base64.b64decode(fields[1], validate=True).decode("utf-8")
                    if (not name or name in {".", ".."} or name != PureWindowsPath(name).name
                            or ":" in name or remaining < 0):
                        raise ValueError("invalid dropped file")
                    # Never reopen a path from Explorer at the TUI's privilege.
                    # Keep a delete-on-close file handle until the draft is sent.
                    target = tempfile.TemporaryFile(mode="w+b")
                    batch.append(DroppedAttachment(name, target))
                elif kind == "D" and target:
                    size = int(fields[0])
                    if not 0 < size <= min(_CHUNK, remaining):
                        raise ValueError("invalid dropped file block")
                    block = await stream.readexactly(size)
                    target.write(block)
                    remaining -= size
                elif kind == "C" and target and remaining == 0:
                    target.flush()
                    target = None
                elif kind in {"E", "X"} and batch is not None:
                    if kind == "E" and target is None and batch and self.files(epoch, batch):
                        self.open_files.extend(batch)
                    else:
                        for file in batch:
                            file.stream.close()
                        if kind == "X" and self.layout and self.layout[0] == epoch:
                            self.notice("无法读取拖入的文件；请重新拖入可读取的普通文件。")
                    target = None
                    batch = None
                    self.pending = None
                else:
                    raise ValueError("invalid drop event")
        finally:
            self.pending = None
            for file in batch or ():
                file.stream.close()

    def release(self, file: DroppedAttachment) -> None:
        self.open_files.remove(file)
        file.stream.close()

    def close(self) -> None:
        for file in self.open_files:
            file.stream.close()
        self.open_files.clear()
