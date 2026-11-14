"""Native context menus for the terminal editor and transcript."""

from __future__ import annotations

import asyncio
import ctypes
import os
import subprocess
import sys
import tempfile
import threading
from ctypes import wintypes
from pathlib import Path
from typing import Any


def api(library: Any, name: str, result: Any, *arguments: Any) -> Any:
    function = getattr(library, name)
    function.restype, function.argtypes = result, arguments
    return function


def user32() -> Any:
    return ctypes.WinDLL("user32", use_last_error=True)  # type: ignore[attr-defined]


def macos_menu_owner() -> int | None:
    """Only the foreground application actually hosting this TUI may own it."""
    ctypes.CDLL("/System/Library/Frameworks/AppKit.framework/AppKit")
    objc = ctypes.CDLL("/usr/lib/libobjc.A.dylib")
    get_class = api(objc, "objc_getClass", ctypes.c_void_p, ctypes.c_char_p)
    selector = api(objc, "sel_registerName", ctypes.c_void_p, ctypes.c_char_p)
    object_message = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)(("objc_msgSend", objc))
    int_message = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)(("objc_msgSend", objc))
    workspace = object_message(get_class(b"NSWorkspace"), selector(b"sharedWorkspace"))
    foreground = object_message(workspace, selector(b"frontmostApplication"))
    owner = int_message(foreground, selector(b"processIdentifier"))
    parents = {}
    for line in subprocess.check_output(["/bin/ps", "-axo", "pid=,ppid="], text=True).splitlines():
        process, parent = map(int, line.split())
        parents[process] = parent
    process = os.getpid()
    while process in parents and process != 0:
        if process == owner:
            return owner
        process = parents[process]
    return None


def menu_anchor() -> tuple[int, ...] | None:
    if sys.platform == "win32":
        user = user32()
        point = wintypes.POINT()
        cursor = api(user, "GetPhysicalCursorPos", wintypes.BOOL, ctypes.POINTER(wintypes.POINT))
        dpi = api(user, "SetThreadDpiAwarenessContext", wintypes.HANDLE, wintypes.HANDLE)
        previous = dpi(-4)
        if not previous:
            raise OSError("无法统一菜单 DPI 坐标")
        try:
            if cursor(ctypes.byref(point)):
                owner = api(user, "GetForegroundWindow", wintypes.HWND)()
                if owner:
                    return int(owner), int(point.x), int(point.y)
        finally:
            dpi(previous)
    elif sys.platform == "darwin" and not os.environ.get("SSH_CONNECTION"):
        owner = macos_menu_owner()
        if owner is None:
            return None
        class Point(ctypes.Structure):
            _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

        core = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
        event = api(core, "CGEventCreate", ctypes.c_void_p, ctypes.c_void_p)(None)
        if event:
            cf = ctypes.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
            try:
                location = api(core, "CGEventGetLocation", Point, ctypes.c_void_p)(event)
                return owner, round(location.x), round(location.y)
            finally:
                api(cf, "CFRelease", None, ctypes.c_void_p)(event)
    return None


async def context_menu(anchor: tuple[int, ...], *, can_copy: bool) -> str:
    with tempfile.TemporaryDirectory(prefix="bridge-menu-") as directory:
        cancel = Path(directory) / "cancel"
        arguments = [*(str(value) for value in anchor), "1" if can_copy else "0", str(cancel)]
        if sys.platform == "darwin":
            script = Path(__file__).with_name("native") / "chat-menu-macos.js"
            command = ["/usr/bin/osascript", "-l", "JavaScript", str(script), *arguments]
        else:
            command = [sys.executable, "-m", __name__, *arguments]
        child = await asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            creationflags=0x08000000 if sys.platform == "win32" else 0)
        communication = asyncio.create_task(child.communicate())
        try:
            output, error = await asyncio.shield(communication)
            if child.returncode:
                raise OSError(error.decode("utf-8", errors="replace").strip())
            return output.decode("ascii").strip()
        finally:
            if child.returncode is None:
                cancel.touch()
                try:
                    await asyncio.wait_for(asyncio.shield(communication), 2)
                except asyncio.TimeoutError:
                    child.kill()
                    await communication


def windows_menu(owner: int, x: int, y: int, can_copy: int, cancel_path: str = "") -> str:
    user = user32()
    hwnd, flag, boolean = wintypes.HWND, wintypes.UINT, wintypes.BOOL
    handle, string = wintypes.HANDLE, wintypes.LPCWSTR
    foreground = api(user, "GetForegroundWindow", hwnd)
    if (cancel_path and Path(cancel_path).exists()) or foreground() != owner:
        return ""
    # Use physical coordinates in the same DPI space as GetPhysicalCursorPos.
    dpi = api(user, "SetThreadDpiAwarenessContext", handle, handle)
    previous_dpi = dpi(-4)
    if not previous_dpi:
        raise OSError("无法统一菜单 DPI 坐标")
    make_window = api(user, "CreateWindowExW", hwnd, flag, string, string, flag,
        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, hwnd, handle, handle, ctypes.c_void_p)
    popup = make_window(0x80, "Static", "", 0x80000000, x, y, 0, 0, owner, None, None, None)
    menu = api(user, "CreatePopupMenu", handle)()
    if not popup or not menu:
        if menu:
            api(user, "DestroyMenu", boolean, handle)(menu)
        if popup:
            api(user, "DestroyWindow", boolean, hwnd)(popup)
        dpi(previous_dpi)
        raise OSError("无法创建 Windows 原生菜单。")
    set_foreground = api(user, "SetForegroundWindow", boolean, hwnd)
    attach = api(user, "AttachThreadInput", boolean, wintypes.DWORD, wintypes.DWORD, boolean)
    thread = api(ctypes.WinDLL("kernel32"), "GetCurrentThreadId", wintypes.DWORD)()  # type: ignore[attr-defined]
    owner_thread = api(user, "GetWindowThreadProcessId", wintypes.DWORD, hwnd, ctypes.c_void_p)(owner, None)
    stopped = threading.Event()
    def watch_cancel() -> None:
        while not stopped.wait(.05):
            if cancel_path and Path(cancel_path).exists():
                api(user, "PostMessageW", boolean, hwnd, flag, ctypes.c_size_t, ctypes.c_ssize_t)(popup, 0x001F, 0, 0)
                return
    watcher = threading.Thread(target=watch_cancel, daemon=True)
    watcher.start()
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
        stopped.set()
        watcher.join()
        if foreground() == popup:
            set_foreground(owner)
        api(user, "DestroyMenu", boolean, handle)(menu)
        api(user, "DestroyWindow", boolean, hwnd)(popup)
        dpi(previous_dpi)


if __name__ == "__main__":
    host, mouse_x, mouse_y, copy = map(int, sys.argv[1:5])
    print(windows_menu(host, mouse_x, mouse_y, copy, sys.argv[5] if len(sys.argv) > 5 else ""))
