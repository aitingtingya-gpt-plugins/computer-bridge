"""Device-owned idle-sleep request and native wake notifications; no polling."""

from __future__ import annotations

import asyncio
import logging
import sys
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

from .common import Json

log = logging.getLogger(__name__)


class NativePower(Protocol):
    def set_enabled(self, enabled: bool) -> None: ...
    def verified(self) -> bool: ...
    def close(self) -> None: ...


class Power:
    def __init__(self, setting: Json):
        self.setting = dict(setting)
        self.native: NativePower | None = None
        self.applied = False
        self.error = ""
        self.resume = asyncio.Event()
        self.changed: Callable[[], None] = lambda: None
        self.last_sleep_at: str | None = None
        self.last_resume_at: str | None = None
        self.interrupted = False

    async def start(self) -> None:
        loop = asyncio.get_running_loop()

        def notify(event: str) -> None:
            loop.call_soon_threadsafe(self.system_event, event)

        try:
            if sys.platform == "darwin":
                from .power_macos import MacPower

                self.native = await asyncio.to_thread(MacPower, notify)
            elif sys.platform == "win32":
                from .power_windows import WindowsPower

                self.native = WindowsPower(notify)
            else:
                raise OSError("锁屏模式仅支持 macOS 和 Windows")
            self.apply(self.setting)
        except OSError as exc:
            self.error = str(exc)
            log.exception("power startup failed")

    def apply(self, setting: Json) -> Json:
        self.setting = dict(setting)
        try:
            if self.native is None:
                raise OSError(self.error or "电源管理尚未就绪")
            self.native.set_enabled(setting["enabled"])
            self.applied, self.error = True, ""
        except OSError as exc:
            self.applied, self.error = False, str(exc)
            log.exception("power apply failed revision=%s", setting["revision"])
        log.info(
            "power enabled=%s revision=%s applied=%s", setting["enabled"], setting["revision"], self.applied
        )
        return self.status(check=False)

    def status(self, *, check: bool = True) -> Json:
        if check and self.native and self.setting["enabled"] and not self.native.verified():
            log.warning("power request missing; reapplying revision=%s", self.setting["revision"])
            self.apply(self.setting)
        result = {
            **self.setting,
            "applied": self.applied,
            "error": self.error,
            "request_state": "held" if self.applied and self.setting["enabled"] else "released",
            "last_sleep_at": self.last_sleep_at,
            "last_resume_at": self.last_resume_at,
            "interrupted": self.interrupted,
            "checked_at": datetime.now(UTC).isoformat(),
        }
        if sys.platform == "win32":
            result["limitation"] = "Modern Standby 电池供电时，系统可能在睡眠超时后限制电源请求。"
        return result

    def system_event(self, event: str) -> None:
        log.info("power event=%s", event)
        if event == "suspend":
            self.last_sleep_at = datetime.now(UTC).isoformat()
            self.interrupted = bool(self.setting["enabled"])
            self.changed()
        if event == "resume":
            self.last_resume_at = datetime.now(UTC).isoformat()
        if event in {"resume", "power_source"}:
            self.apply(self.setting)
            self.changed()
        if event == "resume":
            self.resume.set()

    async def close(self) -> None:
        if self.native is not None:
            await asyncio.to_thread(self.native.close)
            self.native = None
        self.applied = False
