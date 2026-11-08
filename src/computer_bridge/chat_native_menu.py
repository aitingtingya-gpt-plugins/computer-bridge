"""Native context menus for the terminal editor and transcript."""

from __future__ import annotations

import asyncio
import ctypes
import os
import sys
from ctypes import wintypes
from pathlib import Path
from typing import Any


def api(library: Any, name: str, result: Any, *arguments: Any) -> Any:
    function = getattr(library, name)
    function.restype, function.argtypes = result, arguments
    return function


def user32() -> Any:
    return ctypes.WinDLL("user32", use_last_error=True)  # type: ignore[attr-defined]


def menu_anchor() -> tuple[int, ...] | None:
    if sys.platform == "win32":
        user = user32()
        point = wintypes.POINT()
        cursor = api(user, "GetPhysicalCursorPos", wintypes.BOOL, ctypes.POINTER(wintypes.POINT))
        if cursor(ctypes.byref(point)):
            owner = api(user, "GetForegroundWindow", wintypes.HWND)()
            if owner:
                return int(owner), int(point.x), int(point.y)
    elif sys.platform == "darwin" and not os.environ.get("SSH_CONNECTION"):
        class Point(ctypes.Structure):
            _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

        core = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        event = api(core, "CGEventCreate", ctypes.c_void_p, ctypes.c_void_p)(None)
        if event:
            cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
            try:
                location = api(core, "CGEventGetLocation", Point, ctypes.c_void_p)(event)
                return round(location.x), round(location.y)
            finally:
                api(cf, "CFRelease", None, ctypes.c_void_p)(event)
    return None


async def context_menu(anchor: tuple[int, ...], *, can_copy: bool) -> str:
    arguments = [*(str(value) for value in anchor), "1" if can_copy else "0"]
    if sys.platform == "darwin":
        script = Path(__file__).with_name("native") / "chat-menu-macos.js"
        command = ["/usr/bin/osascript", "-l", "JavaScript", str(script), *arguments]
    else:
        command = [sys.executable, "-m", __name__, *arguments]
    child = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        creationflags=0x08000000 if sys.platform == "win32" else 0)
    try:
        output, error = await child.communicate()
        if child.returncode:
            raise OSError(error.decode("utf-8", errors="replace").strip())
        return output.decode("ascii").strip()
    finally:
        if child.returncode is None:
            child.kill()
            await child.wait()


def windows_menu(owner: int, x: int, y: int, can_copy: int) -> str:
    user = user32()
    hwnd, flag, boolean = wintypes.HWND, wintypes.UINT, wintypes.BOOL
    handle, string = wintypes.HANDLE, wintypes.LPCWSTR
    foreground = api(user, "GetForegroundWindow", hwnd)
    if foreground() != owner:
        return ""
    # Use physical coordinates in the same DPI space as GetPhysicalCursorPos.
    api(user, "SetThreadDpiAwarenessContext", handle, handle)(-4)
    make_window = api(user, "CreateWindowExW", hwnd, flag, string, string, flag,
        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, hwnd, handle, handle, ctypes.c_void_p)
    popup = make_window(0x80, "Static", "", 0x80000000, x, y, 0, 0, owner, None, None, None)
    menu = api(user, "CreatePopupMenu", handle)()
    if not popup or not menu:
        raise OSError("无法创建 Windows 原生菜单。")
    set_foreground = api(user, "SetForegroundWindow", boolean, hwnd)
    attach = api(user, "AttachThreadInput", boolean, wintypes.DWORD, wintypes.DWORD, boolean)
    thread = api(ctypes.WinDLL("kernel32"), "GetCurrentThreadId", wintypes.DWORD)()  # type: ignore[attr-defined]
    owner_thread = api(user, "GetWindowThreadProcessId", wintypes.DWORD, hwnd, ctypes.c_void_p)(owner, None)
    try:
        append = api(user, "AppendMenuW", boolean, handle, flag, ctypes.c_size_t, string)
        append(menu, 0 if can_copy else 1, 1, "复制")
        append(menu, 0, 2, "粘贴")
        api(user, "ShowWindow", boolean, hwnd, ctypes.c_int)(popup, 4)  # SW_SHOWNOACTIVATE
        if not set_foreground(popup) and attach(thread, owner_thread, True):
            try:
                set_foreground(popup)
            finally:
                attach(thread, owner_thread, False)
        choice = api(user, "TrackPopupMenuEx", flag, handle, flag, ctypes.c_int, ctypes.c_int,
            hwnd, ctypes.c_void_p)(menu, 0x0100 | 0x0080 | 0x0002, x, y, popup, None)
        return {1: "copy", 2: "paste"}.get(choice, "")
    finally:
        if foreground() == popup:
            set_foreground(owner)
        api(user, "DestroyMenu", boolean, handle)(menu)
        api(user, "DestroyWindow", boolean, hwnd)(popup)


if __name__ == "__main__":
    host, mouse_x, mouse_y, copy = map(int, sys.argv[1:])
    print(windows_menu(host, mouse_x, mouse_y, copy))
