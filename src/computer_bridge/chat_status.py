"""One compact terminal status line, with short-lived action notices."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable

from .chat_cells import display_width, graphemes
from .common import Json


def latency_status(device: Json) -> tuple[str, str]:
    state, connection = device.get("latency_state"), device.get("connection_state")
    if connection == "recovering":
        return "class:latency.warning", "电脑恢复中"
    if connection == "degraded":
        return "class:latency.warning", "电脑探测超时" if state == "timeout" else "电脑连接不稳"
    if device.get("online") is False or connection == "offline":
        return "class:latency.offline", "电脑离线"
    if state == "timeout":
        return "class:latency.warning", "电脑探测超时"
    value = device.get("latency_ms")
    if state != "ok" or value is None:
        return "class:latency.warning", "电脑延迟未知"
    tone = "good" if value < 200 else "warning" if value < 500 else "poor"
    return "class:latency." + tone, f"电脑 {value:g} ms" if value >= 1 else "电脑 <1 ms"


def clipped(text: str, columns: int) -> str:
    value = " ".join(text.split())
    if display_width(value) <= columns:
        return value
    if columns <= 1:
        return "…" if columns else ""
    result: list[str] = []
    used = 0
    for _, cluster, size in graphemes(value):
        if used + size > columns - 1:
            break
        result.append(cluster)
        used += size
    return "".join(result) + "…"


def compact_status(
    device: str, device_id: str, title: str, chat_id: str, state: str, columns: int,
    *, username: str = "", pending: int = 0, notice: str = "", latency: str = "",
) -> str:
    identity = clipped("聊天ID：" + chat_id, columns) if chat_id else ""
    right = display_width(identity)
    available = max(0, columns - right - (2 if identity else 0))
    tail = [state]
    if username:
        tail.append("账号 " + clipped(username, max(1, min(16, available // 4))))
    if pending:
        tail.append(f"待审批 {pending}")
    if latency:
        tail.append(latency)
    suffix = " · ".join(tail)
    room = available - display_width(suffix) - 3
    if notice:
        ending = " · " + latency if latency else ""
        left = (clipped(notice, available - display_width(ending)) + ending
                if display_width(ending) < available else clipped(latency or notice, available))
    elif room >= 12:
        first = max(4, (room - 3) // 2)
        left = " · ".join(filter(None, (clipped(device or device_id, first),
            clipped(title, room - first - 3), suffix)))
    else:
        left = clipped(" · ".join(filter(None, (device_id, state,
            f"审批 {pending}" if pending else "", latency))), available)
    return left + " " * max(0, columns - display_width(left) - right) + identity


class StatusNotice:
    def __init__(self) -> None:
        self.text = ""
        self.expires_at = 0.0
        self.timer: asyncio.TimerHandle | None = None
        self.invalidate: Callable[[], None] | None = None

    def set(self, text: str, *, seconds: float = 5) -> None:
        self.text = text
        self.expires_at = time.monotonic() + seconds
        if self.timer:
            self.timer.cancel()
            self.timer = None
        if self.invalidate:
            self.invalidate()
            self.timer = asyncio.get_running_loop().call_later(seconds, self.invalidate)

    def visible(self) -> bool:
        return bool(self.text) and time.monotonic() < self.expires_at

    def close(self) -> None:
        if self.timer:
            self.timer.cancel()
            self.timer = None
