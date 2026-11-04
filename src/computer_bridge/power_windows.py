"""Windows process-owned power requests and native power callbacks; no console."""

from __future__ import annotations

import ctypes as c
from collections.abc import Callable
from ctypes import wintypes as w
from typing import Any

# ctypes exposes WinDLL/WINFUNCTYPE/WinError on Windows only.
win: Any = c


class DetailedReason(c.Structure):
    _fields_ = [("module", w.HMODULE), ("id", w.ULONG), ("count", w.ULONG), ("strings", c.POINTER(w.LPWSTR))]


class ReasonUnion(c.Union):
    _fields_ = [("simple", w.LPWSTR), ("detailed", DetailedReason)]


class ReasonContext(c.Structure):
    _fields_ = [("version", w.ULONG), ("flags", w.DWORD), ("reason", ReasonUnion)]


class Guid(c.Structure):
    _fields_ = [("a", w.DWORD), ("b", w.WORD), ("c", w.WORD), ("d", w.BYTE * 8)]


class WindowsPower:
    def __init__(self, notify: Callable[[str], None]):
        self.notify = notify
        self.kernel = win.WinDLL("kernel32", use_last_error=True)
        self.powr = win.WinDLL("powrprof", use_last_error=True)
        self.kernel.PowerCreateRequest.argtypes = [c.POINTER(ReasonContext)]
        self.kernel.PowerCreateRequest.restype = w.HANDLE
        for name in ("PowerSetRequest", "PowerClearRequest"):
            function = getattr(self.kernel, name)
            function.argtypes = [w.HANDLE, c.c_int]
            function.restype = w.BOOL
        self.kernel.CloseHandle.argtypes = [w.HANDLE]
        self.callback = win.WINFUNCTYPE(w.ULONG, c.c_void_p, w.ULONG, c.c_void_p)(self._event)

        class Subscription(c.Structure):
            _fields_ = [("callback", type(self.callback)), ("context", c.c_void_p)]

        self.subscription = Subscription(self.callback, None)
        self.suspend = w.HANDLE()
        self.source = w.HANDLE()
        self.powr.PowerRegisterSuspendResumeNotification.argtypes = [w.DWORD, c.c_void_p, c.POINTER(w.HANDLE)]
        self.powr.PowerSettingRegisterNotification.argtypes = [
            c.POINTER(Guid),
            w.DWORD,
            c.c_void_p,
            c.POINTER(w.HANDLE),
        ]
        self.powr.PowerUnregisterSuspendResumeNotification.argtypes = [w.HANDLE]
        self.powr.PowerSettingUnregisterNotification.argtypes = [w.HANDLE]
        code = self.powr.PowerRegisterSuspendResumeNotification(
            2, c.byref(self.subscription), c.byref(self.suspend)
        )
        if code:
            raise OSError(code, "PowerRegisterSuspendResumeNotification")
        # GUID_ACDC_POWER_SOURCE from Windows SDK winnt.h.
        guid = Guid(0x5D3E9A59, 0xE9D5, 0x4B00, (w.BYTE * 8)(0xA6, 0xBD, 0xFF, 0x34, 0xFF, 0x51, 0x65, 0x48))
        code = self.powr.PowerSettingRegisterNotification(
            c.byref(guid), 2, c.byref(self.subscription), c.byref(self.source)
        )
        if code:
            self.powr.PowerUnregisterSuspendResumeNotification(self.suspend)
            raise OSError(code, "PowerSettingRegisterNotification")
        self.handle: Any = None

    def _event(self, context: Any, event: int, setting: Any) -> int:
        if event in {7, 18}:  # PBT_APMRESUMESUSPEND / PBT_APMRESUMEAUTOMATIC
            self.notify("resume")
        elif event == 4:
            self.notify("suspend")
        elif event == 0x8013:
            self.notify("power_source")
        return 0

    def set_enabled(self, enabled: bool) -> None:
        # Replace an existing handle after resume/source changes; requests may have expired.
        if self.handle is not None:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
        if not enabled:
            return
        reason = ReasonContext(0, 1, ReasonUnion(simple="Computer Bridge lock mode"))
        handle = self.kernel.PowerCreateRequest(c.byref(reason))
        if handle == c.c_void_p(-1).value:
            raise win.WinError()
        # SYSTEM_REQUIRED and EXECUTION_REQUIRED; never DISPLAY_REQUIRED or AWAYMODE.
        for kind in (1, 3):
            if not self.kernel.PowerSetRequest(handle, kind):
                error = win.WinError()
                self.kernel.CloseHandle(handle)
                raise error
        self.handle = handle

    def close(self) -> None:
        self.set_enabled(False)
        self.powr.PowerUnregisterSuspendResumeNotification(self.suspend)
        self.powr.PowerSettingUnregisterNotification(self.source)

    def verified(self) -> bool:
        # Windows has no public per-handle query equivalent to IOPMAssertionCopyProperties.
        # This reports held request ownership, not an unlimited-online guarantee.
        return self.handle is not None
