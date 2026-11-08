"""On-demand native clipboard reads, with image bytes kept out of terminal output."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .common import Error


@dataclass
class ClipboardContent:
    paths: list[Path] = field(default_factory=list)
    text: str | None = None


def windows_powershell() -> list[str]:
    shell = Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    return [str(shell), "-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass"]


def windows_clipboard() -> list[str]:
    native = Path(__file__).with_name("native")
    return [*windows_powershell(), "-File", str(native / "clipboard-windows.ps1")]


async def clipboard_process(command: list[str], content: bytes | None = None) -> bytes:
    process = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.PIPE if content is not None else None,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        creationflags=0x08000000 if sys.platform == "win32" else 0)
    try:
        async with asyncio.timeout(15):
            output, diagnostic = await process.communicate(content)
    except (asyncio.CancelledError, TimeoutError):
        if process.returncode is None:
            process.kill()
        await process.wait()
        raise
    if process.returncode:
        raise Error("chat_clipboard", "系统剪贴板操作失败：" + diagnostic.decode("utf-8", errors="replace").strip())
    return output


async def copy_text(text: str) -> None:
    if sys.platform == "darwin":
        command = ["/usr/bin/pbcopy"]
    elif sys.platform == "win32":
        command = [*windows_clipboard(), "-CopyText"]
    else:
        raise Error("chat_clipboard", "系统剪贴板复制目前支持 macOS 和 Windows。")
    await clipboard_process(command, text.encode("utf-8"))


async def read_clipboard(destination: Path) -> ClipboardContent:
    native = Path(__file__).parent / "native"
    if sys.platform == "darwin":
        command = ["/usr/bin/osascript", "-l", "JavaScript", str(native / "clipboard-macos.js"), str(destination)]
    elif sys.platform == "win32":
        command = [*windows_clipboard(), "-Destination", str(destination)]
    else:
        raise Error("chat_clipboard", "系统剪贴板粘贴目前支持 macOS 和 Windows。")
    output = await clipboard_process(command)
    value = json.loads(output.decode("utf-8-sig"))
    paths = [Path(p).expanduser().resolve(strict=True) for p in value.get("paths", [])]
    for path in paths:
        if not path.is_file():
            raise Error("chat_clipboard", "剪贴板中包含文件夹，请复制文件或图片：" + str(path))
    return ClipboardContent(paths=list(dict.fromkeys(paths)), text=value.get("text"))
