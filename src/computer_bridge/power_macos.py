"""IOKit assertion and event-driven sleep/wake observer, owned by this process."""

from __future__ import annotations

import ctypes as c
import threading
from collections.abc import Callable
from typing import Any


class MacPower:
    def __init__(self, notify: Callable[[str], None]):
        self.notify = notify
        self.lock = threading.RLock()
        self.enabled = False
        self.cf = c.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        self.io = c.CDLL("/System/Library/Frameworks/IOKit.framework/IOKit")
        self.cf.CFStringCreateWithCString.argtypes = [c.c_void_p, c.c_char_p, c.c_uint32]
        self.cf.CFStringCreateWithCString.restype = c.c_void_p
        self.cf.CFRelease.argtypes = [c.c_void_p]
        self.cf.CFDictionaryGetValue.argtypes = [c.c_void_p, c.c_void_p]
        self.cf.CFDictionaryGetValue.restype = c.c_void_p
        self.cf.CFNumberGetValue.argtypes = [c.c_void_p, c.c_int, c.c_void_p]
        self.cf.CFNumberGetValue.restype = c.c_bool
        self.cf.CFRunLoopGetCurrent.restype = c.c_void_p
        self.cf.CFRunLoopAddSource.argtypes = [c.c_void_p, c.c_void_p, c.c_void_p]
        self.cf.CFRunLoopStop.argtypes = [c.c_void_p]
        self.io.IOPMAssertionCreateWithName.argtypes = [
            c.c_void_p,
            c.c_uint32,
            c.c_void_p,
            c.POINTER(c.c_uint32),
        ]
        self.io.IOPMAssertionRelease.argtypes = [c.c_uint32]
        self.io.IOPMAssertionCopyProperties.argtypes = [c.c_uint32]
        self.io.IOPMAssertionCopyProperties.restype = c.c_void_p
        self.io.IONotificationPortGetRunLoopSource.argtypes = [c.c_void_p]
        self.io.IONotificationPortGetRunLoopSource.restype = c.c_void_p
        self.io.IONotificationPortDestroy.argtypes = [c.c_void_p]
        self.io.IOAllowPowerChange.argtypes = [c.c_uint32, c.c_ssize_t]
        self.io.IOCancelPowerChange.argtypes = [c.c_uint32, c.c_ssize_t]
        self.io.IODeregisterForSystemPower.argtypes = [c.POINTER(c.c_uint32)]
        self.callback = c.CFUNCTYPE(None, c.c_void_p, c.c_uint32, c.c_uint32, c.c_void_p)(self._event)
        self.io.IORegisterForSystemPower.argtypes = [
            c.c_void_p,
            c.POINTER(c.c_void_p),
            type(self.callback),
            c.POINTER(c.c_uint32),
        ]
        self.io.IORegisterForSystemPower.restype = c.c_uint32
        self.source_callback = c.CFUNCTYPE(None, c.c_void_p)(lambda _: self.notify("power_source"))
        self.io.IOPSNotificationCreateRunLoopSource.argtypes = [type(self.source_callback), c.c_void_p]
        self.io.IOPSNotificationCreateRunLoopSource.restype = c.c_void_p
        self.assertion = c.c_uint32()
        self.port = c.c_void_p()
        self.notifier = c.c_uint32()
        self.root = 0
        self.runloop: Any = None
        self.ready = threading.Event()
        self.thread = threading.Thread(target=self._observe, name="bridge-power-events", daemon=True)
        self.thread.start()
        self.ready.wait()
        if not self.root:
            raise OSError("IORegisterForSystemPower 注册失败")

    def _event(self, context: Any, service: int, message: int, argument: Any) -> None:
        if message == 0xE0000270:
            with self.lock:
                function = self.io.IOCancelPowerChange if self.enabled else self.io.IOAllowPowerChange
                function(self.root, argument or 0)
        elif message == 0xE0000280:
            self.io.IOAllowPowerChange(self.root, argument or 0)
        if message == 0xE0000280:
            self.notify("suspend")
        elif message == 0xE0000300:
            self.notify("resume")

    def _observe(self) -> None:
        self.root = self.io.IORegisterForSystemPower(
            None, c.byref(self.port), self.callback, c.byref(self.notifier)
        )
        if not self.root:
            self.ready.set()
            return
        self.runloop = self.cf.CFRunLoopGetCurrent()
        mode = c.c_void_p.in_dll(self.cf, "kCFRunLoopDefaultMode")
        self.cf.CFRunLoopAddSource(self.runloop, self.io.IONotificationPortGetRunLoopSource(self.port), mode)
        power_source = self.io.IOPSNotificationCreateRunLoopSource(self.source_callback, None)
        if power_source:
            self.cf.CFRunLoopAddSource(self.runloop, power_source, mode)
        self.ready.set()
        self.cf.CFRunLoopRun()
        if power_source:
            self.cf.CFRelease(power_source)
        self.io.IODeregisterForSystemPower(c.byref(self.notifier))
        self.io.IOServiceClose(self.root)
        self.io.IONotificationPortDestroy(self.port)

    def set_enabled(self, enabled: bool) -> None:
        with self.lock:
            self.enabled = enabled
            self._apply(enabled)

    def verified(self) -> bool:
        with self.lock:
            if not self.assertion.value:
                return not self.enabled
            properties = self.io.IOPMAssertionCopyProperties(self.assertion)
            if not properties:
                self.assertion.value = 0
                return False
            key = self.cf.CFStringCreateWithCString(None, b"AssertLevel", 0x08000100)
            try:
                number = self.cf.CFDictionaryGetValue(properties, key)
                level = c.c_int()
                return bool(number and self.cf.CFNumberGetValue(number, 9, c.byref(level)) and level.value)
            finally:
                self.cf.CFRelease(key)
                self.cf.CFRelease(properties)

    def _apply(self, enabled: bool) -> None:
        if enabled and self.assertion.value and not self.verified():
            if self.assertion.value:
                self.io.IOPMAssertionRelease(self.assertion)
                self.assertion.value = 0
        if enabled and not self.assertion.value:
            kind = self.cf.CFStringCreateWithCString(None, b"PreventUserIdleSystemSleep", 0x08000100)
            name = self.cf.CFStringCreateWithCString(None, b"Computer Bridge lock mode", 0x08000100)
            try:
                code = self.io.IOPMAssertionCreateWithName(kind, 255, name, c.byref(self.assertion))
                if code:
                    raise OSError(f"IOPMAssertionCreateWithName: {code:#x}")
            finally:
                self.cf.CFRelease(kind)
                self.cf.CFRelease(name)
        elif not enabled and self.assertion.value:
            code = self.io.IOPMAssertionRelease(self.assertion)
            if code:
                raise OSError(f"IOPMAssertionRelease: {code:#x}")
            self.assertion.value = 0

    def close(self) -> None:
        self.set_enabled(False)
        self.cf.CFRunLoopStop(self.runloop)
        self.thread.join()
