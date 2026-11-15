"""One compact terminal status line, with short-lived action notices."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable, Sequence

from .chat_cells import display_width, graphemes
from .common import Json


def _single_line(text: str) -> str:
    return " ".join(text.split())


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
    value = _single_line(text)
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


def _assemble_left(tagged: Sequence[tuple[str, str]], available: int) -> tuple[str, tuple[int, int] | None]:
    span: tuple[int, int] | None = None
    chunks: list[str] = []
    pos = 0
    for kind, value in tagged:
        if not value:
            continue
        if chunks:
            chunks.append(" · ")
            pos += 3
        start = pos
        chunks.append(value)
        pos += len(value)
        if kind == "latency":
            span = (start, pos)
    left = "".join(chunks)
    if display_width(left) > available:
        return clipped(left, available), None
    return left, span


def format_status_line(
    title: str, mode: str, latency: str, notice: str, chat_id: str, columns: int,
) -> tuple[str, tuple[int, int] | None]:
    identity = clipped("聊天ID：" + _single_line(chat_id), columns) if chat_id else ""
    right = display_width(identity)
    available = max(0, columns - right - (2 if identity else 0))
    if available <= 0:
        return " " * max(0, columns - right) + identity, None

    title_s = _single_line(title)
    mode_s = _single_line(mode)
    latency_s = _single_line(latency)
    notice_s = _single_line(notice)
    fixed_tagged = [item for item in (("mode", mode_s), ("latency", latency_s)) if item[1]]
    fixed = " · ".join(value for _, value in fixed_tagged)
    fixed_width = display_width(fixed)

    if fixed and fixed_width > available:
        left, span = _assemble_left([("fixed", clipped(fixed, available))], available)
    else:
        full_tagged = [item for item in (("title", title_s), *fixed_tagged, ("notice", notice_s)) if item[1]]
        full_width = sum(display_width(value) for _, value in full_tagged) + 3 * max(0, len(full_tagged) - 1)
        if full_width <= available:
            left, span = _assemble_left(full_tagged, available)
        else:
            sep_after_fixed = 3 if fixed_tagged else 0
            if not notice_s:
                budget = available - fixed_width - sep_after_fixed
                title_part = clipped(title_s, budget) if title_s and budget > 0 else ""
                tagged = ([("title", title_part)] if title_part else []) + fixed_tagged
            else:
                rest = available - fixed_width - sep_after_fixed
                if rest <= 0:
                    tagged = fixed_tagged
                elif not title_s or rest <= 10:
                    notice_part = clipped(notice_s, rest)
                    tagged = [*fixed_tagged, ("notice", notice_part)]
                else:
                    # Cap title dynamically when hot notice is active so live messages stay readable,
                    # while reclaiming unused space if the notice itself is short.
                    title_fair = min(display_width(title_s), max(6, min(20, (rest - 3) // 3)))
                    notice_part = clipped(notice_s, max(1, rest - title_fair - 3))
                    title_budget = rest - display_width(notice_part) - 3
                    title_part = clipped(title_s, title_budget) if title_budget > 0 else ""
                    tagged = (
                        ([("title", title_part)] if title_part else [])
                        + fixed_tagged
                        + ([("notice", notice_part)] if notice_part else [])
                    )
            left, span = _assemble_left(tagged, available)

    return left + " " * max(0, columns - display_width(left) - right) + identity, span


def compact_status(
    title: str, mode: str, latency: str, notice: str, chat_id: str, columns: int,
) -> str:
    return format_status_line(title, mode, latency, notice, chat_id, columns)[0]


def build_status_report(
    *,
    chat_title: str,
    chat_id: str,
    chat_mode: str,
    repository: str = "",
    connection_state: str,
    goal_summary: str = "",
    pending_review: tuple[str, str] | None = None,
    pending_approvals: Sequence[str] = (),
    active_notice: str = "",
    channel_status: str = "",
    delivery_notice: str = "",
    quote_summary: str = "",
    attachments: Sequence[str] = (),
    device_label: str = "",
    latency_text: str = "",
    identity_label: str = "",
    server: str = "",
    live_state: str = "",
    theme_label: str = "",
    errors: Sequence[str] = (),
) -> str:
    lines = ["【对话与 Dot 状态】"]
    lines.append(f"当前对话：{chat_title}（{chat_id}）" if chat_id else "当前对话：未选择对话")
    if chat_id and chat_mode:
        lines.append(f"当前模式：{chat_mode}")
    if repository:
        lines.append(f"绑定仓库：{repository}")
    lines.append(f"Dot 状态：{connection_state}")
    if goal_summary:
        lines.append(f"当前目标：{goal_summary}")

    lines.append("")
    lines.append("【待审阅与待审批】")
    if pending_review:
        review_id, preview = pending_review
        summary = f"{review_id} · {preview}" if preview else review_id
        lines.append(f"待审阅方案：{summary}（在输入框按 F6 打开审阅）")
    else:
        lines.append("待审阅方案：无")
    if pending_approvals:
        lines.append(f"待审批列表：{len(pending_approvals)} 项")
        lines.extend(f"- {item}" for item in pending_approvals)
    else:
        lines.append("待审批列表：0 项")

    lines.append("")
    lines.append("【通知与投递进度】")
    lines.append(f"当前热通知：{active_notice or '无'}")
    lines.append(f"Dot 通道通知：{channel_status or '无'}")
    lines.append(f"后台发送：{delivery_notice or '无'}")
    lines.append(f"引用草稿：{quote_summary or '无'}")
    lines.append(
        f"待发附件：{len(attachments)} 个（{'、'.join(attachments)}）" if attachments else "待发附件：无"
    )

    lines.append("")
    lines.append("【电脑与终端链路】")
    lines.append(f"当前电脑：{device_label or '未选择电脑'}")
    lines.append(f"电脑延迟：{latency_text or '未测速'}")
    lines.append(f"当前身份：{identity_label or '本机设备'}")
    lines.append(f"服务端：{server or '未知'}")
    lines.append(f"实时通道：{live_state or '未知'} · 主题：{theme_label or '未知'}")

    lines.append("")
    lines.append("【最近异常】")
    if errors:
        lines.extend(f"- {item}" for item in errors)
    else:
        lines.append("无")
    return "\n".join(lines)


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
