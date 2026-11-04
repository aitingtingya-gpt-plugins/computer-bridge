"""Native network-change subscriptions. They never poll or change system settings."""

from __future__ import annotations

import ctypes as c
import sys
import threading
from collections.abc import Callable
from typing import Any


class NetworkEvents:
    def __init__(self, notify: Callable[[], None]):
        self.notify = notify
        self.native: Any = None
        if sys.platform == "darwin":
            self.native = MacNetwork(notify)
        elif sys.platform == "win32":
            self.native = WindowsNetwork(notify)

    def close(self) -> None:
        if self.native:
            self.native.close()


class MacNetwork:
    def __init__(self, notify: Callable[[], None]):
        self.cf = c.CDLL("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")
        self.sc = c.CDLL("/System/Library/Frameworks/SystemConfiguration.framework/SystemConfiguration")
        self.callback = c.CFUNCTYPE(None, c.c_void_p, c.c_void_p, c.c_void_p)(lambda *_: notify())
        self.cf.CFStringCreateWithCString.argtypes = [c.c_void_p, c.c_char_p, c.c_uint32]
        self.cf.CFStringCreateWithCString.restype = c.c_void_p
        self.cf.CFArrayCreate.argtypes = [c.c_void_p, c.c_void_p, c.c_long, c.c_void_p]
        self.cf.CFArrayCreate.restype = c.c_void_p
        self.cf.CFRelease.argtypes = [c.c_void_p]
        self.cf.CFRunLoopGetCurrent.restype = c.c_void_p
        self.cf.CFRunLoopAddSource.argtypes = [c.c_void_p, c.c_void_p, c.c_void_p]
        self.cf.CFRunLoopStop.argtypes = [c.c_void_p]
        self.sc.SCDynamicStoreCreate.argtypes = [c.c_void_p, c.c_void_p, type(self.callback), c.c_void_p]
        self.sc.SCDynamicStoreCreate.restype = c.c_void_p
        self.sc.SCDynamicStoreSetNotificationKeys.argtypes = [c.c_void_p, c.c_void_p, c.c_void_p]
        self.sc.SCDynamicStoreSetNotificationKeys.restype = c.c_bool
        self.sc.SCDynamicStoreCreateRunLoopSource.argtypes = [c.c_void_p, c.c_void_p, c.c_long]
        self.sc.SCDynamicStoreCreateRunLoopSource.restype = c.c_void_p
        self.runloop: Any = None
        self.ready = threading.Event()
        self.thread = threading.Thread(target=self.run, name="bridge-network-events", daemon=True)
        self.thread.start()
        self.ready.wait()
        if not self.runloop:
            raise OSError("SCDynamicStore 网络通知注册失败")

    def run(self) -> None:
        name = self.cf.CFStringCreateWithCString(None, b"Computer Bridge network", 0x08000100)
        store = self.sc.SCDynamicStoreCreate(None, name, self.callback, None)
        self.cf.CFRelease(name)
        if not store:
            self.ready.set()
            return
        keys = [
            self.cf.CFStringCreateWithCString(None, key, 0x08000100)
            for key in (
                b"State:/Network/Global/IPv4",
                b"State:/Network/Global/IPv6",
                b"State:/Network/Global/Proxies",
            )
        ]
        callbacks = c.addressof((c.c_byte * 1).in_dll(self.cf, "kCFTypeArrayCallBacks"))
        array = self.cf.CFArrayCreate(None, (c.c_void_p * len(keys))(*keys), len(keys), callbacks)
        ok = self.sc.SCDynamicStoreSetNotificationKeys(store, array, None)
        self.cf.CFRelease(array)
        for key in keys:
            self.cf.CFRelease(key)
        source = self.sc.SCDynamicStoreCreateRunLoopSource(None, store, 0) if ok else None
        if source:
            self.runloop = self.cf.CFRunLoopGetCurrent()
            self.cf.CFRunLoopAddSource(
                self.runloop, source, c.c_void_p.in_dll(self.cf, "kCFRunLoopDefaultMode")
            )
        self.ready.set()
        if source:
            self.cf.CFRunLoopRun()
            self.cf.CFRelease(source)
        self.cf.CFRelease(store)

    def close(self) -> None:
        if self.runloop:
            self.cf.CFRunLoopStop(self.runloop)
        self.thread.join()


class WindowsNetwork:
    def __init__(self, notify: Callable[[], None]):
        win: Any = c
        self.ip = win.WinDLL("iphlpapi")
        self.callback = win.WINFUNCTYPE(None, c.c_void_p, c.c_void_p, c.c_int)(lambda *_: notify())
        self.handle = c.c_void_p()
        self.ip.NotifyIpInterfaceChange.argtypes = [
            c.c_ushort,
            type(self.callback),
            c.c_void_p,
            c.c_ubyte,
            c.POINTER(c.c_void_p),
        ]
        self.ip.NotifyIpInterfaceChange.restype = c.c_ulong
        self.ip.CancelMibChangeNotify2.argtypes = [c.c_void_p]
        code = self.ip.NotifyIpInterfaceChange(0, self.callback, None, 0, c.byref(self.handle))
        if code:
            raise OSError(code, "NotifyIpInterfaceChange")

    def close(self) -> None:
        self.ip.CancelMibChangeNotify2(self.handle)
