"""Full-screen terminal chat. Closing it does not disconnect the model endpoint."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import platform
import re
import secrets
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable, Coroutine, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import httpx2
from prompt_toolkit.application import Application
from prompt_toolkit.data_structures import Point
from prompt_toolkit.document import Document
from prompt_toolkit.filters import Condition
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.key_binding.key_processor import KeyPressEvent
from prompt_toolkit.keys import Keys
from prompt_toolkit.layout import (
    ConditionalContainer,
    Float,
    FloatContainer,
    HSplit,
    Layout,
    Window,
)
from prompt_toolkit.layout.containers import AnyContainer
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.dimension import Dimension
from prompt_toolkit.layout.margins import ScrollbarMargin
from prompt_toolkit.layout.menus import CompletionsMenu
from prompt_toolkit.layout.screen import WritePosition
from prompt_toolkit.mouse_events import MouseButton, MouseEvent, MouseEventType
from prompt_toolkit.styles import DynamicStyle
from prompt_toolkit.widgets import Button, Dialog, Frame, Label, TextArea
from websockets.exceptions import ConnectionClosed, WebSocketException

from . import github_update
from .chat_attachments import (
    AttachmentDraft,
    AttachmentSource,
    DroppedAttachment,
    pasted_paths,
)
from .chat_client import ChatClient
from .chat_clipboard import copy_text, read_clipboard
from .chat_commands import BY_NAME, CommandCompleter, SlashMenu, help_for_mode
from .chat_dashboard import render_dashboard
from .chat_dashboard_update import read_dashboard_update
from .chat_delivery import DeliveryQueue
from .chat_dialogs import ChatDialogs, bind_keys, text_navigation
from .chat_export import export_chat, export_filename
from .chat_input import InputNavigator, KeyboardInput
from .chat_markdown import MarkdownWorker, has_math, preview
from .chat_native_drop import WindowsDrop
from .chat_native_menu import context_menu, menu_anchor
from .chat_review_controls import ReviewControls, ReviewState
from .chat_settings import DeviceSettings
from .chat_status import (
    StatusNotice,
    build_status_report,
    format_status_line,
    latency_status,
)
from .chat_themes import load_theme, save_theme, theme_style
from .chat_themes import names as THEMES
from .chat_transcript import (
    ChatTranscript,
    TranscriptWindow,
    approval_kind,
    beijing_message_time,
)
from .common import Error, Json

LIVE_RECONCILE_SECONDS = 15.0
APPROVAL_INPUT_GRACE = 1.0
CHANNEL_FALLBACK_SECONDS = 60.0
CHANNEL_DIAG_TEXT = {
    "edge_challenge": "通道推送被边缘安全拦截（HTTP 403）",
    "signature_rejected": "通道签名验证被拒",
    "timestamp_rejected": "通道时间戳超出允许窗口",
    "subscription_unavailable": "Dot 侧插件订阅已失效或未找到",
    "authentication_rejected": "通道认证被拒",
    "permission_denied": "通道权限不足",
    "rate_limited": "通道请求触发限流",
    "callback_address": "回调地址或 DNS 校验未通过",
    "timeout": "通道推送请求超时",
    "network_error": "通道推送网络异常",
    "gone_removed": "原订阅已返回 410 并自动清理",
}

SUPER_AGENT_COMMANDS = {"/tasks", "/task", "/task-new", "/task-resume", "/pause", "/cancel", "/stop", "/retry"}

STATES = {"waiting": "等待模型连接", "connected": "模型已连接", "expired": "模型连接已到期"}
NOTIFICATIONS = {"waiting": "等待接收方上线", "pending": "等待通知", "retrying": "正在重试", "unreachable": "暂不可达",
                 "received": "宿主已接收", "blocked": "通知配置异常", "failed": "通知未送达", "none": ""}

def message_status(message: Json) -> str:
    parts = ["已保存", NOTIFICATIONS.get(message.get("notification", {}).get("state", "none"), "")]
    return " · ".join(part for part in parts if part)


def format_goal_summary(goal: Json) -> str:
    phase = {
        "active": "进行中" if goal.get("activation") == "armed" else "待恢复",
        "paused": "已暂停",
        "complete": "已完成",
        "blocked": "已卡住",
    }.get(str(goal.get("phase")), str(goal.get("phase", "")))
    return f"目标{phase} · {goal.get('roundsStarted', 0)}/{goal.get('maxGoalRounds', 0)} 轮 · {goal.get('objective', '')}"


def channel_watch_satisfied(chat: Json | None, action: str) -> bool:
    if not chat:
        return False
    if action == "connect":
        return chat.get("state") == "connected" and chat.get("subscribed", True) is not False
    if action == "disconnect":
        return chat.get("subscribed", True) is False or chat.get("state") == "waiting"
    return False


def describe_channel_reason(channel: Json | None) -> str:
    info = channel or {}
    if int(info.get("delivered") or 0) > 0:
        return "通知已送达，Dot 尚未完成操作"
    if info.get("state") == "retrying":
        return "通知仍在后台重试"
    if info.get("state") == "unconfigured":
        return "当前未启用 Dot 自动通知"
    if info.get("state") == "failed":
        err = info.get("last_error") or {}
        category = str(err.get("category") or "")
        status = err.get("status")
        base = CHANNEL_DIAG_TEXT.get(category) or (f"通道推送返回 HTTP {status}" if status else "通知未送达 Dot")
        code = f"（HTTP {status}）" if status and category not in ("timeout", "network_error", "callback_address") and str(status) not in base else ""
        ray = f" · {err['cf_ray']}" if err.get("cf_ray") else ""
        return base + code + ray
    return "尚未确认通知送达"


def format_channel_notice(action: str, channel: Json | None) -> str:
    info = channel or {}
    waiting = "等待接入" if action == "connect" else "等待暂停订阅"
    if int(info.get("delivered") or 0) > 0:
        return f"已通知 Dot，{waiting}。"
    if info.get("state") == "unconfigured":
        return "Dot 自动通知未启用。"
    if info.get("state") == "failed":
        return "通知未送达 Dot。"
    if info.get("state") == "notified":
        return f"Dot 尚未完成操作，{waiting}。"
    return "正在通知 Dot…"


class ChatTerminal:
    def __init__(self, client: ChatClient, resume: str | None = None, *, browser: bool = True):
        self.client = client
        self.resume = resume
        self.browser = browser
        self.selected_device: Json = dict(client.device) if client.mode == "device" else {}
        self.computers: list[Json] = []
        self.identity_drafts: dict[str, Json] = {}
        self.quote_drafts: dict[tuple[str, str], Json] = {}
        self.pending_creations: dict[str, Json] = {}
        self.chat: Json | None = None
        self.chats: list[Json] = []
        self.startup_list_state = "正在读取会话…"
        self.startup_version = "—"
        self.startup_source = github_update.DEFAULT_REPOSITORY
        self.startup_channel = github_update.CHANNEL_LABELS["stable"]
        self.startup_latest = ""
        self.startup_update = "等待检查"
        self.startup_gateway = "正在连接"
        self.startup_local: Json = {}
        self.startup_device_epoch = 0
        self.startup_devices_identity: str | None = None
        self.startup_device_status = "正在读取账户设备…"
        self.messages: dict[int, Json] = {}
        self.sync_cursor = 0
        self.first_cursor = 0
        self.has_older = False
        self.view_generation = 0
        self.history_task: asyncio.Task[None] | None = None
        self.history_state = ""
        self.history_interest = False
        self.history_reconcile_cursor: int | None = None
        self.history_viewport: tuple[int, int, int, int, int] | None = None
        self.latency: Json = {}
        self.latency_target: tuple[str, str] | None = None
        self.latency_task: asyncio.Task[None] | None = None
        self.attachments: list[Json] = []
        self.draft_attachments: dict[str, list[Json]] = {}
        self.attachment_markers: dict[tuple[str, str], AttachmentDraft] = {}
        self.failed_sends: dict[tuple[str, str], list[Json]] = {}
        self.delivery_notices: dict[tuple[str, str], str] = {}
        self.delivery = DeliveryQueue(client, saved=self.delivery_saved, failed=self.delivery_failed, status=self.delivery_status)
        self.status_notice = StatusNotice()
        self.notice = "正在连接…"
        self.errors: list[str] = []
        self.theme = load_theme(client.config)
        self.manual_disconnect: tuple[str, float] | None = None
        self.channel_watch_seq = 0
        self.channel_watch: Json | None = None
        self.channel_watch_task: asyncio.Task[None] | None = None
        self.active_channel_dialog: tuple[str, str, str] | None = None
        self.login_generation = self.login_active = 0
        self.dialog_tasks: set[asyncio.Task[None]] = set()
        self.pending_approvals: list[Json] | None = None
        self.pending_review_cursor: tuple[str, str] | None = None
        self.review_task: asyncio.Task[None] | None = None
        self.approval_timer: asyncio.Task[None] | None = None
        self.seen_approvals: set[str] = set()
        self.previous_pending_approvals: set[str] = set()
        self.seen_plans: set[str] = set()
        self.decided_reviews: set[str] = set()
        self.incoming_approvals: dict[str, Json] = {}
        self.review_submissions: set[str] = set()
        self.review_unconfirmed: dict[str, str] = {}
        self.plan_request_keys: dict[tuple[str, str, str], str] = {}
        self.last_input_activity = -float("inf")
        self.human_submit_pending = 0
        self.recall_index: int | None = None
        self.recall_texts: list[str] = []
        self.recalling = False
        self.network_error = False
        self.live_connected = False
        self.commands = asyncio.Lock()
        self.refreshing = asyncio.Lock()
        self.syncing = asyncio.Lock()
        self.live_task: asyncio.Task[None] | None = None
        self.last_notification_ms: float | None = None
        self.render_notification_at: float | None = None
        self.input = TextArea(multiline=True, wrap_lines=True, height=4, prompt="", completer=CommandCompleter(lambda: (self.chat or {}).get("mode")), complete_while_typing=False)
        self.review = ReviewControls(self.review_choice, self.close_review)
        self.input.buffer.on_text_changed += self.recall_edited
        self.transcript = ChatTranscript(message_status, self.open_transcript_review)
        self.transcript.on_scroll = self.history_scrolled
        self.transcript.copy_menu = self.show_copy_menu
        self.transcript.selection_started = self.cancel_copy_menu
        self.transcript.selection_finished = self.selection_finished
        self.native_selecting = self.native_frozen = False
        self.markdown = MarkdownWorker(client.settings)
        self.transcript.markdown = self.markdown
        self.previews = tempfile.TemporaryDirectory(prefix='computer-bridge-formulas-')
        self.clipboard_files = tempfile.TemporaryDirectory(prefix='computer-bridge-clipboard-')
        self.clipboard_task: asyncio.Task[None] | None = None
        self.menu_task: asyncio.Task[None] | None = None
        self.menu_generation = 0
        self.menu_view: tuple[str, int, str] | None = None
        self.menu_value = ""
        self.menu_cleanups: set[asyncio.Task[None]] = set()
        self.drop = (WindowsDrop(self.native_files, self.native_mouse, self.native_notice)
                     if WindowsDrop.supported() else None)
        self.clipboard_sequence = 0
        self.relaunch_argv: list[str] | None = None
        self.transcript_window = TranscriptWindow(self.transcript, right_margins=[ScrollbarMargin(display_arrows=True)])
        keys = KeyBindings()

        review_inactive = Condition(lambda: not self.review.active)

        @keys.add("enter", filter=review_inactive)
        def send(event: object) -> object | None:
            if self.native_selecting:
                return cast(object, NotImplemented)
            if self.application.layout.current_control is self.transcript:
                self.transcript.activate()
                return None
            if self.application.layout.current_control is not self.input.control:
                return None
            if self.clipboard_task:
                self.notice = "正在读取剪贴板；粘贴完成后按 Enter 发送。"
                return None
            if self.drop and self.drop.pending == self.view_generation:
                self.notice = "正在读取拖入的文件；完成后按 Enter 发送。"
                return None
            state = self.input.buffer.complete_state
            if not state and not self.input.text.strip() and not self.attachments:
                return cast(object, NotImplemented)
            if state:
                completion = state.current_completion or state.completions[0]
                with self.slash.selecting():
                    self.input.buffer.apply_completion(completion)
            value = self.input.text
            name, _, argument = value.partition(" ")
            command = BY_NAME.get(name.lower())
            if command and command.required and not argument.strip():
                if not value.endswith(" "):
                    self.input.buffer.insert_text(" ")
                self.notice = command.usage + " · " + command.description
                return None
            if value.strip() or self.attachments:
                self.input.text = ""
                self.human_submit_pending += 1
                async def submit_draft() -> None:
                    try:
                        await self.submit(value)
                    finally:
                        self.human_submit_pending -= 1
                self.application.create_background_task(submit_draft())
            return None

        input_focused = review_inactive & Condition(lambda: self.application.layout.current_control is self.input.control)
        input_editing = input_focused & Condition(lambda: not self.native_selecting)
        transcript_focused = review_inactive & Condition(lambda: self.application.layout.current_control is self.transcript)
        completing = input_focused & Condition(lambda: self.input.buffer.complete_state is not None)

        @keys.add("c-y", filter=input_focused)
        def system_paste(event: object) -> object | None:
            if not self.start_clipboard_paste():
                return cast(object, NotImplemented)
            return None

        @keys.add(Keys.BracketedPaste, filter=input_focused)
        def paste(event: KeyPressEvent) -> None:
            self.paste_text(event.data)

        @keys.add("backspace", filter=input_focused & Condition(lambda:
            self.input.buffer.cursor_position == 0 and not self.input.buffer.selection_state))
        @keys.add("delete", filter=input_focused & Condition(lambda:
            self.input.buffer.cursor_position == len(self.input.text) and not self.input.buffer.selection_state))
        def empty_delete(event: object) -> object:
            return NotImplemented

        def marker_at(position: int) -> tuple[int, int] | None:
            if self.input.buffer.selection_state:
                return None
            return self.attachment_draft().marker_at(self.input.text, position)

        @keys.add("backspace", filter=input_focused & Condition(
            lambda: marker_at(self.input.buffer.cursor_position-1) is not None))
        @keys.add("delete", filter=input_focused & Condition(
            lambda: marker_at(self.input.buffer.cursor_position) is not None))
        def remove_marker(event: KeyPressEvent) -> None:
            position = self.input.buffer.cursor_position - (event.key_sequence[-1].key == Keys.ControlH)
            span = marker_at(position)
            if span:
                start, end = span
                self.input.buffer.document = Document(self.input.text[:start] + self.input.text[end:], start)

        self.navigator = InputNavigator(self.input.buffer, lambda: (
            self.input.window.render_info.window_width if self.input.window.render_info
            else max(1, self.application.output.get_size().columns - 2)))

        @keys.add("left", filter=input_editing)
        @keys.add("right", filter=input_editing)
        @keys.add("s-left", filter=input_editing)
        @keys.add("s-right", filter=input_editing)
        def input_horizontal(event: KeyPressEvent) -> None:
            self.slash.close()
            key = event.key_sequence[-1].key
            self.navigator.horizontal(-1 if key in {Keys.Left, Keys.ShiftLeft} else 1, event.arg,
                selecting=key in {Keys.ShiftLeft, Keys.ShiftRight})

        @keys.add("up", filter=input_focused & ~completing)
        def input_previous(event: KeyPressEvent) -> None:
            self.input.buffer.exit_selection()
            if not self.recall_message(-1):
                self.navigator.move(-1, event.arg)

        @keys.add("down", filter=input_focused & ~completing)
        def input_following(event: KeyPressEvent) -> None:
            self.input.buffer.exit_selection()
            if not self.recall_message(1):
                self.navigator.move(1, event.arg)

        @keys.add("s-up", filter=input_editing)
        def select_previous_row(event: KeyPressEvent) -> None:
            self.slash.close()
            self.navigator.select(-1, event.arg)

        @keys.add("s-down", filter=input_editing)
        def select_following_row(event: KeyPressEvent) -> None:
            self.slash.close()
            self.navigator.select(1, event.arg)

        @keys.add("f4", filter=input_editing)
        def clear_input(event: KeyPressEvent) -> None:
            self.slash.close()
            buffer = self.input.buffer
            if buffer.text:
                buffer.save_to_undo_stack()
                buffer.document = Document("", 0)
            buffer.exit_selection()

        @keys.add("down", filter=completing)
        def completion_next(event: object) -> None:
            with self.slash.selecting():
                self.input.buffer.complete_next()

        @keys.add("up", filter=completing)
        def completion_previous(event: object) -> None:
            with self.slash.selecting():
                self.input.buffer.complete_previous()

        @keys.add("tab", filter=input_focused)
        def complete(event: object) -> None:
            state = self.input.buffer.complete_state
            if state:
                selected = state.current_completion or state.completions[0]
                with self.slash.selecting():
                    self.input.buffer.apply_completion(selected)
                    if BY_NAME[selected.text].arguments:
                        self.input.buffer.insert_text(" ")
            elif self.input.text.startswith("/") and not any(character.isspace() for character in self.input.text):
                self.slash.refresh()
            else:
                self.transcript.focus_action()

        @keys.add("escape", filter=completing, eager=True)
        def dismiss_completion(event: object) -> None:
            self.slash.close()

        @keys.add("c-j", filter=input_focused)
        @keys.add("escape", "enter", filter=input_focused)
        def newline(event: object) -> None:
            if self.application.layout.current_control is self.input.control:
                self.slash.close()
                self.input.buffer.insert_text("\n")

        @keys.add("c-q", filter=review_inactive)
        def quit_app(event: object) -> None:
            self.application.exit()

        @keys.add("c-c", filter=input_focused)
        def clear(event: object) -> None:
            self.input.text = ""

        @keys.add("c-c", filter=Condition(lambda: self.has_selection()) & (input_editing | transcript_focused))
        @keys.add("c-insert", filter=Condition(lambda: self.has_selection()) & (input_editing | transcript_focused))
        def copy_selection(event: object) -> None:
            self.application.create_background_task(self.copy_selected(self.selected_text()))

        native = Condition(lambda: self.native_selecting)
        keys.add(Keys.Any, filter=native)(lambda event: NotImplemented)
        if sys.platform == "darwin":
            keys.add("f2", filter=input_focused | transcript_focused)(lambda event: self.native_selection())
        keys.add("escape", filter=native, eager=True)(lambda event: self.leave_native_selection())

        @keys.add("pageup", filter=(input_focused & ~completing) | transcript_focused)
        def scroll_up(event: object) -> None:
            self.transcript.page(-1)

        @keys.add("pagedown", filter=(input_focused & ~completing) | transcript_focused)
        def scroll_down(event: object) -> None:
            self.transcript.page(1)

        @keys.add("tab", filter=transcript_focused)
        def next_approval(event: object) -> None:
            if not self.transcript.focus_action():
                self.application.layout.focus(self.input)

        @keys.add("s-tab", filter=input_focused | transcript_focused)
        def previous_approval(event: object) -> None:
            if (self.application.layout.current_control is self.input.control and self.chat and not self.commands.locked()
                    and self.chat.get("mode") != "super_agent" and not self.native_selecting
                    and not self.menu_task and self.input.buffer.complete_state is None):
                self.application.create_background_task(self.cycle_interaction())
                return
            if not self.transcript.focus_action(-1):
                self.application.layout.focus(self.input)

        @keys.add("escape", filter=transcript_focused, eager=True)
        def leave_approval(event: object) -> None:
            self.application.layout.focus(self.input)

        @keys.add("f1", filter=review_inactive)
        def help_text(event: object) -> None:
            self.note(help_for_mode((self.chat or {}).get("mode")), title="命令帮助")

        @keys.add("f6", filter=input_editing | transcript_focused)
        def show_review(event: object) -> None:
            if self.chat and not self.dialogs.active:
                self.slash.close()
                self.start_review(self.navigate_review())

        layout = HSplit([
            FloatContainer(
                content=Frame(self.transcript_window),
                floats=[Float(top=1, right=1, bottom=1, left=1, content=ConditionalContainer(
                    Window(FormattedTextControl(self.startup_dashboard)),
                    filter=Condition(lambda: not self.chat and not self.resume),
                ))],
            ),
            ConditionalContainer(self.review.container, filter=Condition(lambda: self.review.active),
                                 alternative_content=Frame(self.input)),
            Window(FormattedTextControl(self.status), height=1, style="class:status"),
        ])
        body = ConditionalContainer(self.review.details_container, filter=Condition(lambda: self.review.reading),
                                    alternative_content=layout)
        def after_render(application: Application[None]) -> None:
            if self.menu_task and (self.dialogs.active or self.menu_view != self.view_key()
                    or self.menu_value != self.selected_text()):
                self.cancel_copy_menu()
            if self.drop:
                position = self.input_position()
                size = application.output.get_size()
                self.drop.update((self.view_generation, size.columns, size.rows, position.xpos, position.ypos,
                    position.width, position.height) if position and self.chat and not self.dialogs.active else ())
            if self.render_notification_at is not None:
                self.last_notification_ms = (time.monotonic() - self.render_notification_at) * 1000
                self.render_notification_at = None
            view = self.transcript
            viewport = self.view_generation, view.width, view.height, view.display_count, view.top
            if viewport != self.history_viewport:
                self.history_viewport = viewport
                self.maybe_load_history()
            self.schedule_review_arrivals()

        self.layout = FloatContainer(content=body, floats=[Float(xcursor=True, ycursor=True,
            content=CompletionsMenu(max_height=8, display_arrows=True, extra_filter=input_focused))])
        self.keyboard = KeyboardInput()
        self.application: Application[None] = Application(layout=Layout(self.layout, focused_element=self.input), input=self.keyboard.input,
            key_bindings=keys, full_screen=True, mouse_support=~native, min_redraw_interval=1/30, after_render=after_render, style=DynamicStyle(lambda: theme_style(self.theme)))
        self.keyboard.bind_output(self.application.output)
        self.bind_copy_controls()
        self.application.ttimeoutlen = 0.1
        self.status_notice.invalidate = self.application.invalidate
        self.dialogs = ChatDialogs(self.application, self.layout)
        present = self.dialogs.present
        async def present_without_menu(*args: Any, **kwargs: Any) -> Any:
            self.cancel_copy_menu()
            await self.wait_copy_menu()
            try:
                return await present(*args, **kwargs)
            finally:
                if self.review.active or self.application.layout.current_control not in (self.input.control, self.transcript):
                    self.focus_review_area()
                self.schedule_review_arrivals()
        self.dialogs.present = present_without_menu
        self.input.buffer.on_cursor_position_changed += self.composer_activity
        self.input.buffer.on_text_changed += self.composer_activity
        self.device_settings = DeviceSettings(self.client, self.dialogs, self.choose, self.settings_status)
        self.slash = SlashMenu(self.input.buffer, lambda: self.application.layout.current_control is self.input.control)

    def settings_status(self, message: str) -> None:
        self.notice = message

    def bind_copy_controls(self) -> None:
        # Native selection is owned by Terminal. Leave the painted screen in
        # place while messages continue to arrive behind it.
        renderer: Any = self.application.renderer
        render = renderer.render
        def paint(app: Any, layout: Layout, is_done: bool = False) -> None:
            if not self.native_frozen or is_done:
                render(app, layout, is_done)
                self.native_frozen = self.native_selecting and not is_done
        renderer.render = paint
        control: Any = self.input.control
        mouse = control.mouse_handler
        input_drag = False
        right_down = False
        def input_mouse(event: MouseEvent) -> Any:
            nonlocal input_drag, right_down
            if event.event_type == MouseEventType.MOUSE_DOWN:
                self.cancel_copy_menu()
                input_drag = event.button == MouseButton.LEFT
                right_down = event.button == MouseButton.RIGHT
                if right_down:
                    return None
                if event.button == MouseButton.LEFT:
                    self.transcript.clear_selection()
                    self.application.layout.focus(self.input)
            if event.event_type == MouseEventType.MOUSE_UP and right_down:
                right_down = False
                self.show_copy_menu()
                return None
            if event.button == MouseButton.RIGHT:
                return None
            result = mouse(event)
            if event.event_type == MouseEventType.MOUSE_UP and input_drag:
                input_drag = False
                if event.button != MouseButton.RIGHT:
                    self.selection_finished()
            return result
        control.mouse_handler = input_mouse

    def selection_finished(self) -> None:
        # Selection alone never opens a panel; copying is explicitly requested.
        pass

    def cancel_copy_menu(self) -> None:
        self.menu_generation += 1
        if self.menu_task:
            task, self.menu_task = self.menu_task, None
            if not task.cancelling():
                task.cancel()
            self.menu_cleanups.add(task)
            task.add_done_callback(self.menu_cleanups.discard)

    async def wait_copy_menu(self) -> None:
        tasks = tuple(task for task in self.menu_cleanups if task is not asyncio.current_task())
        if tasks:
            await asyncio.shield(asyncio.gather(*tasks, return_exceptions=True))

    def native_selection(self) -> None:
        self.slash.close()
        self.native_selecting = True
        self.application.invalidate()

    def leave_native_selection(self) -> None:
        self.native_selecting = self.native_frozen = False
        self.transcript.clear_selection()
        self.application.invalidate()

    def has_selection(self) -> bool:
        return bool(self.transcript.selection or self.input.buffer.selection_state)

    def selected_text(self) -> str:
        if self.transcript.selection:
            return self.transcript.selected_text()
        document = self.input.buffer.document
        if document.selection:
            start, end = document.selection_range()
            return document.text[start:end]
        return ""

    async def copy_selected(self, value: str) -> None:
        if not value:
            return
        try:
            await copy_text(value)
            self.notice = "已复制选中文字"
        except (Error, OSError, TimeoutError) as exc:
            self.error(str(exc))

    def show_copy_menu(self, anchor: tuple[int, ...] | None = None) -> None:
        if self.dialogs.active:
            return
        self.cancel_copy_menu()
        anchor = anchor or menu_anchor()
        if anchor:
            self.menu_view, self.menu_value = self.view_key(), self.selected_text()
            self.menu_task = self.application.create_background_task(
                self.copy_menu(anchor, self.menu_view, self.menu_value, self.menu_generation))

    async def copy_menu(self, anchor: tuple[int, ...], view: tuple[str, int, str], value: str,
                        generation: int | None = None) -> None:
        generation = self.menu_generation if generation is None else generation
        def valid() -> bool:
            return (generation == self.menu_generation and view == self.view_key()
                    and not self.dialogs.active and value == self.selected_text())
        try:
            await self.wait_copy_menu()
            if not valid():
                return
            choice = await context_menu(anchor, can_copy=bool(value))
            if not valid():
                return
            if choice == "copy":
                await self.copy_selected(value)
            elif choice == "paste":
                self.application.layout.focus(self.input)
                self.start_clipboard_paste()
        except OSError:
            self.notice = "无法打开系统右键菜单。"
        finally:
            if self.menu_task is asyncio.current_task():
                self.menu_task = None

    def start_clipboard_paste(self) -> bool:
        if self.clipboard_task:
            return False
        self.clipboard_task = self.application.create_background_task(self.paste_clipboard())
        return True

    def native_notice(self, text: str) -> None:
        self.notice = text

    def input_position(self) -> WritePosition | None:
        screen = self.application.renderer.last_rendered_screen
        return screen.visible_windows_to_write_positions.get(self.input.window) if screen else None

    def native_files(self, generation: int, files: list[DroppedAttachment]) -> bool:
        if self.view_generation != generation or not self.chat or self.dialogs.active:
            return False
        self.application.layout.focus(self.input)
        self.add_files(files)
        self.application.invalidate()
        return True

    def native_mouse(self, kind: str, generation: int, x: int, y: int,
                     screen_x: int, screen_y: int, owner: int) -> None:
        if not self.drop or generation != self.view_generation or self.dialogs.active:
            return
        position = self.input_position()
        if not position or not (position.xpos <= x < position.xpos + position.width and
                                position.ypos <= y < position.ypos + position.height):
            return
        if kind == "right":
            self.show_copy_menu((owner, screen_x, screen_y))
            return
        events = {"down": MouseEventType.MOUSE_DOWN, "up": MouseEventType.MOUSE_UP, "move": MouseEventType.MOUSE_MOVE,
                  "wheel-up": MouseEventType.SCROLL_UP, "wheel-down": MouseEventType.SCROLL_DOWN}
        event = events[kind]
        handler = self.application.renderer.mouse_handlers.mouse_handlers[y][x]
        button = MouseButton.NONE if kind.startswith("wheel") else MouseButton.LEFT
        handler(MouseEvent(Point(x, y), event, button, frozenset()))
        self.application.invalidate()

    def recall_edited(self, _: object) -> None:
        self.cancel_copy_menu()
        self.transcript.clear_selection()
        if not self.recalling:
            self.recall_index = None
            self.recall_texts = []

    def composer_activity(self, _: object) -> None:
        self.last_input_activity = time.monotonic()
        self.cancel_copy_menu()

    def recall_message(self, direction: int) -> bool:
        if self.recall_index is None:
            if self.input.text or direction > 0:
                return False
            self.recall_texts = [str(message['text']) for _, message in sorted(self.messages.items(), reverse=True)
                if message['role'] == 'user' and message.get('kind') != 'approval' and not message.get('approval_id') and message['text']]
            if not self.recall_texts:
                return False
            self.recall_index = -1
        self.recall_index = min(len(self.recall_texts) - 1, self.recall_index - direction)
        self.recalling = True
        try:
            self.input.text = self.recall_texts[self.recall_index] if self.recall_index >= 0 else ''
            self.input.buffer.cursor_position = len(self.input.text)
        finally:
            self.recalling = False
        if self.recall_index < 0:
            self.recall_index = None
        return True

    @property
    def notice(self) -> str:
        return self.status_notice.text

    @notice.setter
    def notice(self, value: str) -> None:
        self.status_notice.set(value)

    def _chat_mode_label(self, chat: Json, *, with_prefix: bool) -> str:
        if not chat:
            return ""
        if chat.get("mode") == "super_agent":
            return "Super Agent"
        interaction = {"normal": "普通", "plan": "计划", "auto": "自动"}.get(
            str(chat.get("interaction_mode", "normal")), "普通"
        )
        return f"Chat · {interaction}" if with_prefix else interaction

    def _connection_state(self, chat: Json) -> str:
        if not self.client.authenticated:
            return "未连接"
        if self.network_error:
            return "重连中"
        if not self.chat:
            return "未选对话"
        if not self.live_connected:
            return "连接中"
        return {
            "connected": "订阅已暂停（可输入 /connect 恢复）" if chat.get("subscribed") is False else "已连接",
            "waiting": "等待模型",
            "expired": "通知到期",
        }.get(str(chat.get("state")), "等待模型")

    def _hot_notice(self, chat: Json) -> str:
        if self.status_notice.visible():
            return self.notice
        chat_id = str(chat.get("id", ""))
        delivery = self.delivery_notices.get((self.client.identity, chat_id), "")
        if delivery:
            return delivery
        watch = self.channel_watch
        if watch and watch["chat_id"] == chat.get("id"):
            return format_channel_notice(watch["action"], watch["channel"])
        reminders: list[str] = []
        if self.pending_plan_review():
            reminders.append("待审阅方案 · 按 F6 审阅")
        pending = getattr(self, 'pending_approvals', None)
        if pending is not None and (count := len(pending) + int(bool(self.pending_plan_review()))):
            reminders = [f'待审 {count} · F6 审阅或领取']
        elif self.transcript.pending_count > 0:
            reminders.append("有待审批命令 · /status 查看")
        quoted = self.quote_drafts.get((self.client.identity, chat_id))
        if quoted:
            reminders.append(f"引用 {quoted['id']} · /quote cancel 取消")
        return "；".join(reminders)

    def status_report(self) -> str:
        device = self.selected_device
        chat = self.chat or {}
        chat_id = str(chat.get("id", ""))
        title = str(chat.get("title") or "未命名对话") if self.chat else "未选择对话"
        repo = chat.get("repository") or {}
        repo_text = f"{repo.get('provider', '')} · {repo.get('url', '')}".strip(" ·") if isinstance(repo, dict) else ""
        goal = chat.get("goal") if isinstance(chat.get("goal"), dict) else None
        goal_summary = format_goal_summary(goal) if goal else ("无" if self.chat and chat.get("mode") != "super_agent" else "")

        review = self.pending_plan_review()
        pending_review: tuple[str, str] | None = None
        if review:
            first_line = next((line.strip() for line in str(review.get("markdown", "")).splitlines() if line.strip()), "")
            pending_review = (str(review.get("id", "")), " ".join(first_line.split())[:80])

        source_messages = self.messages or self.transcript.messages
        pending_approvals: list[str] = []
        for _, message in sorted(source_messages.items()):
            approval = message.get("approval") if isinstance(message, dict) else None
            if not approval or approval.get("state") != "pending" or approval.get("decision"):
                continue
            kind = "工具审批" if approval.get("tool") else "命令审批"
            dev = str(approval.get("device_name") or approval.get("device_id") or "")
            cmd = " ".join(str(approval.get("command", "")).split())[:80]
            expires_raw = approval.get("expires_at")
            expires = ""
            if expires_raw is not None:
                expires = " · 到期 " + beijing_message_time(
                    datetime.fromtimestamp(float(expires_raw) / 1000, UTC).isoformat()
                )
            parts = [str(approval.get("id", "")), kind, dev, cmd]
            pending_approvals.append(" · ".join(part for part in parts if part) + expires)

        watch = self.channel_watch
        channel_status = ""
        if watch and watch.get("chat_id") == chat.get("id"):
            channel_status = f"{format_channel_notice(watch['action'], watch['channel'])}（{describe_channel_reason(watch.get('channel'))}）"
        delivery_notice = self.delivery_notices.get((self.client.identity, chat_id), "")
        quoted = self.quote_drafts.get((self.client.identity, chat_id))
        quote_summary = ""
        if quoted:
            quote_preview = " ".join(str(quoted.get("text", "")).split())[:80]
            quote_summary = f"{quoted['id']}" + (f" · {quote_preview}" if quote_preview else "") + "（/quote cancel 取消）"
        attachments = [str(item.get("name") or item.get("id") or "") for item in getattr(self, "attachments", ())]

        device_id = str(chat.get("device_id") or device.get("id") or "")
        device_name = str(chat.get("device_name") or device.get("name") or "")
        system = str(chat.get("system") or device.get("system") or "")
        if not system and device_id:
            matched = next((item for item in getattr(self, "computers", ()) if item.get("id") == device_id), None)
            if matched:
                system = str(matched.get("system") or "")
        device_parts = [part for part in (device_name, device_id, system) if part]
        device_label = " · ".join(device_parts)
        _, latency_text = latency_status(self.latency) if device.get("id") else ("", "")

        account_name = str(getattr(self.client, "account", {}).get("username", "")) if getattr(self.client, "mode", "device") == "account" else ""
        client_dev = getattr(self.client, "device", {}) or {}
        identity_label = f"账号 {account_name}" if account_name else f"本机设备 {client_dev.get('name', '本机')}"
        live_state = (
            "未认证" if not self.client.authenticated else
            "中断重连中" if self.network_error else
            "未打开对话" if not self.chat else
            "已连接" if self.live_connected else "连接中"
        )
        return build_status_report(
            chat_title=title,
            chat_id=chat_id,
            chat_mode=self._chat_mode_label(chat, with_prefix=True),
            repository=repo_text,
            connection_state=self._connection_state(chat),
            goal_summary=goal_summary,
            pending_review=pending_review,
            pending_approvals=pending_approvals,
            active_notice=self.notice if self.status_notice.visible() else "",
            channel_status=channel_status,
            delivery_notice=delivery_notice,
            quote_summary=quote_summary,
            attachments=attachments,
            device_label=device_label,
            latency_text=latency_text,
            identity_label=identity_label,
            server=str(getattr(self.client, "server", "")),
            live_state=live_state,
            theme_label=THEMES.get(self.theme, self.theme),
            errors=tuple(getattr(self, "errors", ())),
        )

    def startup_dashboard(self) -> FormattedText:
        size = self.application.output.get_size()
        device = self.client.device
        device_id = str(device.get("id") or "")
        local = self.startup_local or next(
            (row for row in self.computers if device_id and str(row.get("id", "")) == device_id), {}
        )
        if device_id and self.latency_target == (self.client.identity, device_id):
            local = self.latency or local
        _, latency = latency_status(local)
        if latency.startswith("电脑 "):
            latency = latency.removeprefix("电脑 ")
        elif latency == "电脑延迟未知":
            latency = "未测得" if self.startup_gateway != "正在连接" else "测量中"
        identity = "未登录 · 本机身份"
        account_devices = None
        account_device_status = ""
        if self.client.mode == "account":
            name = getattr(self.client, "account", {}).get("username")
            identity = f"已登录 · {name}" if name else "已登录"
            account_devices = []
            if self.startup_devices_identity == self.client.identity:
                for row in self.computers:
                    connection = row.get("connection_state")
                    if row.get("online") is False or connection == "offline":
                        state, measured = "离线", ""
                    else:
                        state = {"recovering": "恢复中", "degraded": "连接不稳"}.get(
                            connection, "在线" if row.get("online") is True or connection == "healthy" else "状态未知")
                        _, measured = latency_status(row)
                        measured = measured.removeprefix("电脑 ").removeprefix("电脑")
                        if measured in ("延迟未知", "恢复中", "连接不稳"):
                            measured = "延迟未测得"
                    account_devices.append((
                        str(row.get("name") or row.get("id") or "未命名设备"),
                        str(row.get("system") or ""), state, measured,
                    ))
            account_device_status = self.startup_device_status
        chats = [
            (
                str(item.get("title") or "未命名会话"),
                str(item.get("id") or ""),
                self._chat_mode_label(item, with_prefix=True),
                STATES.get(str(item.get("state") or ""), ""),
                str(item.get("device_name") or ""),
                beijing_message_time(item.get("updated_at")),
            )
            for item in sorted(self.chats, key=lambda row: str(row.get("updated_at") or ""), reverse=True)
        ]
        # The existing transcript frame and composer reserve two border cells
        # each, four editor rows and one status row.
        return render_dashboard(
            max(0, size.columns - 2), max(0, size.rows - 9),
            identity=identity, device=str(device.get("name") or local.get("name") or "本机"),
            system=str(device.get("system") or local.get("system") or platform.system()),
            connection=self.startup_gateway, latency=latency,
            chats=chats, chat_state=self.startup_list_state,
            current=self.startup_version, source=self.startup_source,
            channel=self.startup_channel, latest=self.startup_latest, update=self.startup_update,
            account_devices=account_devices, account_device_status=account_device_status,
        )

    async def refresh_startup_update(self) -> None:
        home_dir = self.client.config.parent
        self.startup_version = github_update.current_installed_version(home_dir)
        self.startup_update = "检查中"
        if not self.chat:
            self.application.invalidate()
        self.startup_source, self.startup_channel, self.startup_latest, self.startup_update = (
            await read_dashboard_update(home_dir, self.startup_version)
        )
        if not self.chat:
            self.application.invalidate()

    async def refresh_startup_local(self, target: tuple[str, str]) -> None:
        try:
            result = await self.client.action("devices", device_id=target[1])
            local = next((row for row in result["computers"] if str(row.get("id", "")) == target[1]), {})
        except (Error, OSError, httpx2.HTTPError):
            local = {}
        if not self.chat and target == (self.client.identity, str(self.client.device.get("id") or "")):
            self.startup_local = local
            self.application.invalidate()

    def status(self) -> FormattedText:
        device = self.selected_device
        chat = self.chat or {}
        columns = self.application.output.get_size().columns
        if self.native_selecting:
            return FormattedText([("class:status", "拖选文字 · Command+C 复制 · Esc 返回")])
        title = str(chat.get("title") or "未命名对话") if self.chat else "未选对话"
        mode = self._chat_mode_label(chat, with_prefix=False)
        tone, latency = latency_status(self.latency) if device.get("id") else ("", "")
        notice = self._hot_notice(chat)
        value, span = format_status_line(title, mode, latency, notice, str(chat.get("id", "")), columns)
        if span is None:
            return FormattedText([("", value)])
        return FormattedText([
            ("", value[:span[0]]),
            (tone, value[span[0]:span[1]]),
            ("", value[span[1]:]),
        ])

    def error(self, value: str) -> None:
        self.errors.append(value)
        self.errors = self.errors[-10:]
        self.note(value, title="操作失败")

    def note(self, value: str, *, title: str = "提示", key: str | None = None, valid: Callable[[], bool] | None = None) -> None:
        task = self.application.create_background_task(self.dialogs.message(title, value, key=key, valid=valid))
        self.dialog_tasks.add(task)
        task.add_done_callback(self.dialog_tasks.discard)

    def render(self, messages: list[Json] | None = None, *, reset: bool = False,
               maintenance_statuses: list[Json] | None = None, plan_reviews: list[Json] | None = None) -> None:
        self.transcript.update(messages or (), reset=reset, older=self.has_older, history_state=self.history_state,
            history_complete=bool(self.messages) and self.first_cursor == 1 and not self.has_older,
            user_name=str(self.client.device.get("name", "本机")),
            maintenance_statuses=maintenance_statuses, plan_reviews=plan_reviews or ())
        self.application.invalidate()

    def cancel_channel_watch(self, *, dismiss: bool = False) -> None:
        self.channel_watch_seq += 1
        self.channel_watch = None
        task = self.channel_watch_task
        self.channel_watch_task = None
        if task and not task.done():
            task.cancel()
        if dismiss and self.active_channel_dialog:
            dialog_key = self.active_channel_dialog[0]
            self.active_channel_dialog = None
            self.dialogs.dismiss(dialog_key)

    async def stop_channel_watch(self) -> None:
        task = self.channel_watch_task
        self.cancel_channel_watch(dismiss=True)
        if task:
            with contextlib.suppress(asyncio.CancelledError):
                await task

    def build_channel_fallback_dialog(self, chat_id: str, action: str, channel: Json | None) -> tuple[str, str]:
        title = "请手动告知 Dot 连接对话" if action == "connect" else "请手动告知 Dot 暂停对话"
        device_name = str((self.chat or {}).get("device_name") or (self.selected_device or {}).get("name") or "")
        reason = describe_channel_reason(channel)
        phrase = f"连接对话 {chat_id}" if action == "connect" else f"暂停对话 {chat_id}"
        verb = "自动接入此对话" if action == "connect" else "暂停事件订阅"
        body = (
            f"对话：{chat_id} · {device_name}\n\n"
            f"Dot 已超过 1 分钟未完成{verb}（{reason}）。\n\n"
            f"建议手动前往 Dot 告知它：\n{phrase}\n\n"
            "若弹窗期间 Dot 已生效，窗口会自动关闭；否则可按 Enter / Esc 手动关闭。"
        )
        return title, body

    def start_channel_watch(self, chat_id: str, action: str, channel: Json | None = None) -> None:
        self.cancel_channel_watch(dismiss=True)
        if not self.chat or str(self.chat.get("id")) != chat_id:
            return
        if channel_watch_satisfied(self.chat, action):
            self.notice = f"对话 {chat_id} 已处于 Dot 连接状态。" if action == "connect" else f"对话 {chat_id} 已暂停事件订阅。"
            self.application.invalidate()
            return
        self.notice = format_channel_notice(action, channel)
        self.application.invalidate()
        self.channel_watch_seq += 1
        token = self.channel_watch_seq
        view = self.view_key()
        self.channel_watch = {"token": token, "chat_id": chat_id, "action": action, "channel": dict(channel or {})}
        self.channel_watch_task = self.application.create_background_task(
            self._wait_channel_fallback(token, view, chat_id, action)
        )

    async def _wait_channel_fallback(self, token: int, view: tuple[str, int, str], chat_id: str, action: str) -> None:
        try:
            await asyncio.sleep(CHANNEL_FALLBACK_SECONDS)
            if self.channel_watch_seq != token or view != self.view_key() or not self.chat or str(self.chat.get("id")) != chat_id:
                return
            with contextlib.suppress(Error, OSError, httpx2.HTTPError):
                await self.sync(chat_id, expected=view)
            watch = self.channel_watch
            if not watch or watch["token"] != token or view != self.view_key() or channel_watch_satisfied(self.chat, action):
                return
            title, body = self.build_channel_fallback_dialog(chat_id, action, watch["channel"])
            dialog_key = f"channel:{action}:{chat_id}:{token}"
            self.active_channel_dialog = (dialog_key, chat_id, action)

            async def _present() -> None:
                try:
                    await self.dialogs.message(
                        title,
                        body,
                        key=dialog_key,
                        valid=lambda: self.active_channel_dialog == (dialog_key, chat_id, action)
                        and bool(self.chat and self.chat.get("id") == chat_id and not channel_watch_satisfied(self.chat, action)),
                    )
                finally:
                    if self.active_channel_dialog == (dialog_key, chat_id, action):
                        self.active_channel_dialog = None

            task = self.application.create_background_task(_present())
            self.dialog_tasks.add(task)
            task.add_done_callback(self.dialog_tasks.discard)
        except asyncio.CancelledError:
            return
        finally:
            if self.channel_watch_task is asyncio.current_task():
                self.channel_watch_task = None

    def require_chat(self) -> str:
        if not self.chat:
            raise Error("chat_required", "先输入 /new 新建对话，或 /resume 按名称选择已有对话。")
        return str(self.chat["id"])

    def list_scope(self) -> Json:
        return {"device_id": self.client.device["id"]} if self.client.mode == "device" else {}

    async def refresh_list(self) -> None:
        identity = self.client.identity
        try:
            result = await self.client.action("list", **self.list_scope(), limit=5)
        except (Error, OSError, httpx2.HTTPError):
            if identity == self.client.identity:
                self.startup_list_state = "暂无法读取会话"
                raise
            return
        if identity != self.client.identity:
            return
        self.chats = result["chats"]
        self.startup_list_state = ""
        self.application.invalidate()

    async def choose(self, title: str, choices: list[tuple[str, str, str]], *,
                     description: str = "", selected_id: str | None = None) -> str | None:
        selected = next((index for index, entry in enumerate(choices) if entry[0] == selected_id), 0)
        decision: asyncio.Future[str | None] = asyncio.get_running_loop().create_future()
        keys = KeyBindings()

        @keys.add("up")
        def previous(event: object) -> None:
            nonlocal selected
            selected = max(0, selected - 1)

        @keys.add("down")
        def following(event: object) -> None:
            nonlocal selected
            selected = min(len(choices) - 1, selected + 1)

        @keys.add("home")
        def first(event: object) -> None:
            nonlocal selected
            selected = 0

        @keys.add("end")
        def last(event: object) -> None:
            nonlocal selected
            selected = len(choices) - 1

        @keys.add("pageup")
        def page_previous(event: KeyPressEvent) -> None:
            nonlocal selected
            height = choice_window.render_info.window_height if choice_window.render_info else 14
            selected = max(0, selected - max(1, height - 1) * event.arg)

        @keys.add("pagedown")
        def page_following(event: KeyPressEvent) -> None:
            nonlocal selected
            height = choice_window.render_info.window_height if choice_window.render_info else 14
            selected = min(len(choices) - 1, selected + max(1, height - 1) * event.arg)

        @keys.add("enter")
        def accept(event: object) -> None:
            if not decision.done():
                decision.set_result(choices[selected][0])

        @keys.add("escape", eager=True)
        def cancel(event: object) -> None:
            if not decision.done():
                decision.set_result(None)

        def labels() -> FormattedText:
            rows: list[tuple[str, str]] = []
            for index, (_, label, detail) in enumerate(choices):
                style = "class:chat-choice.selected" if index == selected else "class:chat-choice"
                rows.append((style, ("› " if index == selected else "  ") + " ".join(label.splitlines())))
                if detail:
                    rows.append((style + " class:chat-choice.time", "  · " + " ".join(detail.splitlines())))
                if index < len(choices) - 1:
                    rows.append(("", "\n"))
            return FormattedText(rows)

        control = FormattedTextControl(labels, focusable=True, key_bindings=keys, show_cursor=False,
            get_cursor_position=lambda: Point(x=0, y=selected))
        rows: list[AnyContainer] = []
        details: TextArea | None = None
        if description:
            details = TextArea(text=description, read_only=True, scrollbar=True, wrap_lines=True,
                height=Dimension(min=1, preferred=min(8, description.count("\n") + 2), max=8))
            detail_keys = KeyBindings()
            detail_keys.add("escape", eager=True)(cancel)
            detail_keys.add("enter")(lambda event: self.application.layout.focus(control))
            bind_keys(details.control, detail_keys)
            text_navigation(details)
            rows.append(details)
        choice_window = Window(control, height=Dimension(min=1, preferred=min(14, len(choices)), max=14),
            right_margins=[ScrollbarMargin(display_arrows=True)])
        def hint() -> str:
            if details and self.application.layout.current_control is details.control:
                return "说明 ↑↓ / PageUp/PageDown 阅读 · Enter 返回选项\nTab/Shift+Tab 切换说明/选项 · Esc 关闭"
            return ("↑↓ 选择 · Home/End 首尾 · PageUp/PageDown 翻页 · Enter 确认\n"
                    + ("Tab/Shift+Tab 切换说明/选项 · " if details else "") + "Esc 关闭")
        body = HSplit([*rows, choice_window, Label(hint)])
        self.slash.close()
        return await self.dialogs.present(Dialog(title=title, body=body, width=96), control, decision)

    async def choose_chat(self) -> None:
        self.notice = "正在读取历史对话…"
        self.application.invalidate()
        cursor: int | None = 0
        chats: list[Json] = []
        while cursor is not None:
            page = await self.client.action("list", **self.list_scope(), after=cursor, limit=30)
            selected = (str(page["chats"][0]["id"]) if chats and page["chats"]
                        else str(self.chat["id"]) if self.chat else None)
            chats.extend(page["chats"])
            cursor = page["next_cursor"]
            if not chats:
                self.notice = "还没有可访问的历史对话；/new 新建。"
                break
            choices = [(str(entry["id"]), str(entry["title"]),
                (str(entry.get("device_name", entry["device_id"])) + " · " if self.client.mode == "account" else "")
                + beijing_message_time(entry.get("created_at"))) for entry in chats]
            if cursor is not None:
                choices.append(("more", "加载更多对话", ""))
            chosen = await self.choose("选择历史对话", choices, selected_id=selected)
            if chosen == "more":
                continue
            if chosen is None:
                self.notice = "已取消选择，当前对话保持不变。"
            else:
                await self.open(chosen)
                self.notice = "已打开「" + str(self.chat["title"] if self.chat else chosen) + "」。/connect 可通知 Dot 接入。"
            break
        self.application.invalidate()

    def view_key(self) -> tuple[str, int, str]:
        return self.client.identity, self.view_generation, str(self.chat["id"]) if self.chat else ""

    async def reset_history(self) -> None:
        self.cancel_copy_menu()
        await self.wait_copy_menu()
        self.view_generation += 1
        had_review = self.review.active
        self.review.reset()
        if had_review:
            self.focus_review_area()
        self.seen_approvals.clear()
        self.previous_pending_approvals.clear()
        self.seen_plans.clear()
        self.decided_reviews.clear()
        self.incoming_approvals.clear()
        self.review_submissions.clear()
        self.review_unconfirmed.clear()
        self.plan_request_keys.clear()
        if self.approval_timer:
            self.approval_timer.cancel()
            self.approval_timer = None
        self.pending_approvals = None
        self.pending_review_cursor = None
        review_task, self.review_task = self.review_task, None
        if review_task and not review_task.done():
            review_task.cancel()
            await asyncio.gather(review_task, return_exceptions=True)
        self.history_interest = False
        self.history_viewport = None
        self.history_state = ""
        self.history_reconcile_cursor = None
        task, self.history_task = self.history_task, None
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    def history_scrolled(self, amount: int) -> None:
        if amount < 0:
            self.history_interest = True
        elif self.transcript.following:
            self.history_interest = False
        self.maybe_load_history(recovered=amount < 0)

    def maybe_load_history(self, *, recovered: bool = False) -> None:
        if (not self.chat or not self.has_older and self.history_reconcile_cursor is None or not self.client.authenticated
                or self.history_task is not None or self.history_state == "error" and not recovered):
            return
        self.transcript._layout(self.transcript.width, self.transcript.height)
        if self.transcript.display_count > self.transcript.height and not self.history_interest:
            return
        if self.transcript.top >= self.transcript.height:
            return
        self.history_task = self.application.create_background_task(self.load_history(self.view_key()))

    async def load_history(self, own: tuple[str, int, str]) -> None:
        successful = False
        task = asyncio.current_task()
        self.history_state = "loading"
        self.render()
        try:
            if self.history_reconcile_cursor is not None:
                await self.sync(own[2], from_cursor=self.history_reconcile_cursor, expected=own)
                if own != self.view_key():
                    return
                self.history_reconcile_cursor = None
                if not self.has_older:
                    self.history_state = ""
                    self.render()
                    return
            before, cursor = self.first_cursor, self.sync_cursor
            result = await self.client.action("history", chat_id=own[2], before=before, limit=50)
            async with self.refreshing:
                if own != self.view_key() or before != self.first_cursor:
                    return
                additions = [message for message in result["messages"] if int(message["sequence"]) not in self.messages]
                self.messages.update((int(message["sequence"]), message) for message in additions)
                self.first_cursor = int(result["first_cursor"])
                self.has_older = bool(result["has_older"])
                self.history_reconcile_cursor = cursor
                self.render(additions, maintenance_statuses=result.get("maintenance_statuses"),
                            plan_reviews=result.get('plan_reviews'))
            await self.load_review_pages(own, result)
            await self.sync(own[2], from_cursor=cursor, expected=own)
            if own != self.view_key():
                return
            self.history_reconcile_cursor = None
            self.history_state = ""
            self.render()
            successful = True
        except (Error, OSError, httpx2.HTTPError) as exc:
            if own == self.view_key():
                self.history_state = "error"
                self.errors = [*self.errors[-9:], str(exc)]
                self.render()
        finally:
            if self.history_task is task:
                self.history_task = None
                if successful:
                    asyncio.get_running_loop().call_soon(self.maybe_load_history)

    async def restart_latency(self) -> None:
        target = (self.client.identity, str(self.selected_device.get("id", "")))
        if target == self.latency_target:
            return
        self.latency_target = target
        self.latency = {}
        task, self.latency_task = self.latency_task, None
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if target[1] and self.client.authenticated:
            self.latency_task = self.application.create_background_task(self.poll_latency(target))

    async def poll_latency(self, target: tuple[str, str]) -> None:
        while self.latency_target == target and self.client.authenticated:
            try:
                result = await self.client.action("devices", device_id=target[1])
                value = next(item for item in result["computers"] if item["id"] == target[1])
            except (Error, OSError, httpx2.HTTPError, StopIteration):
                value = {"latency_state": "unavailable", "latency_ms": None}
            if self.latency_target != target or self.client.identity != target[0]:
                return
            if value != self.latency:
                self.latency = value
                self.application.invalidate()
            await asyncio.sleep(5)

    async def refresh_computers(self) -> None:
        scope = self.client.identity, self.startup_device_epoch
        try:
            computers = (await self.client.action("devices"))["computers"]
        except (Error, OSError, httpx2.HTTPError):
            if scope == (self.client.identity, self.startup_device_epoch):
                self.startup_devices_identity = None
                self.startup_device_status = "暂无法读取账户设备"
                if not self.chat and not self.resume:
                    self.application.invalidate()
            raise
        if scope != (self.client.identity, self.startup_device_epoch):
            return
        self.computers = computers
        self.startup_devices_identity = scope[0]
        self.startup_device_status = ""
        if not self.selected_device and len(self.computers) == 1:
            self.selected_device = self.computers[0]
        await self.restart_latency()
        if not self.chat and not self.resume:
            self.startup_gateway = "网关已连接"
            local_id = str(self.client.device.get("id") or "")
            if (self.client.mode != "account" and local_id
                    and local_id != str(self.selected_device.get("id") or "") and self.client.authenticated):
                self.application.create_background_task(self.refresh_startup_local((self.client.identity, local_id)))
            self.application.invalidate()

    async def choose_computer(self) -> bool:
        await self.refresh_computers()
        if not self.computers:
            self.notice = "账号当前没有可访问的电脑。"
            return False
        chosen = await self.choose("选择电脑", [(str(item["id"]), str(item["name"]),
            str(item["system"]) + " · " + str(item["id"])) for item in self.computers],
            selected_id=self.selected_device.get("id"))
        if chosen is None:
            return False
        if self.chat:
            self.draft_attachments[str(self.chat["id"])] = self.attachments
        self.cancel_channel_watch(dismiss=True)
        await self.reset_history()
        await self.stop_live()
        self.selected_device = next(item for item in self.computers if item["id"] == chosen)
        self.chat, self.messages, self.attachments = None, {}, []
        self.has_older = False
        self.notice = "已选择「" + str(self.selected_device["name"]) + "」；/new 新建对话，/resume 打开历史对话。"
        self.render(reset=True)
        await self.restart_latency()
        return True

    async def switch_identity(self, *, login: bool) -> None:
        previous = self.client.identity
        old_chat = str(self.chat["id"]) if self.chat else None
        await self.reset_history()
        await self.stop_live()
        try:
            if login:
                self.login_generation += 1
                generation = self.login_generation
                self.login_active = generation
                try:
                    await self.client.login_account(browser=self.browser, notice=lambda text: self.note(text, title="账号登录", key="login", valid=lambda: self.login_active == generation))
                finally:
                    self.login_active = 0
                    self.dialogs.dismiss("login")
            else:
                await self.client.logout()
        except BaseException:
            if old_chat:
                self.live_task = self.application.create_background_task(self.live(old_chat))
            raise
        if self.chat:
            self.draft_attachments[str(self.chat["id"])] = self.attachments
        self.cancel_channel_watch(dismiss=True)
        self.identity_drafts[previous] = {"attachments": self.draft_attachments}
        saved = self.identity_drafts.get(self.client.identity, {})
        self.draft_attachments = saved.get("attachments", {})
        self.delivery.set_identity(self.client.identity)
        self.chat, self.messages, self.attachments, self.chats = None, {}, [], []
        self.startup_list_state = "正在读取会话…"
        self.startup_gateway = "正在连接"
        self.startup_local = {}
        self.startup_device_epoch += 1
        self.startup_devices_identity = None
        self.startup_device_status = "正在读取账户设备…"
        self.computers = []
        self.selected_device = dict(self.client.device) if self.client.mode == "device" else {}
        self.has_older, self.network_error, self.sync_cursor = False, False, 0
        self.input.text = ""
        self.render(reset=True)
        await self.refresh_computers()
        await self.refresh_list()
        self.notice = ("已登录账号 " + str(self.client.account["username"]) if login else "已返回本机身份") + "；/resume 选择对话，/computers 选择电脑。"
        self.render()

    def pending_plan_review(self) -> Json | None:
        chat = self.chat or {}
        review = chat.get("plan_review")
        return review if chat.get("interaction_mode") == "plan" and review and review.get("state") == "pending" else None

    def focus_review_area(self) -> None:
        if not self.dialogs.active:
            layout = self.application.layout
            if self.review.active:
                self.review.focus(layout)
            else:
                layout.focus(self.input)
        self.application.invalidate()

    def close_review(self) -> None:
        self.review.close()
        self.focus_review_area()
        self.schedule_review_arrivals()

    def open_transcript_review(self, identifier: str, action: str) -> None:
        if self.dialogs.active or self.native_selecting or self.review.active:
            return
        if action == "plan":
            if identifier in self.decided_reviews or (self.pending_plan_review() or {}).get("id") != identifier:
                return
            self.review.show_plan(identifier)
        else:
            approval = self.transcript.approval(identifier)
            if approval is None:
                return
            if action == "details":
                self.review.show_details(approval)
            elif self.approval_pending(identifier):
                self.incoming_approvals.pop(identifier, None)
                self.review.show_approval(approval)
            else:
                return
        self.slash.close()
        if state := self.review.find(identifier):
            state.busy = identifier in self.review_submissions or identifier in self.review_unconfirmed
            state.error = self.review_unconfirmed.get(identifier, '')
        self.focus_review_area()

    def approval_pending(self, identifier: str) -> bool:
        if identifier in self.decided_reviews:
            return False
        if self.pending_approvals is not None:
            return any(str(item["id"]) == identifier for item in self.pending_approvals)
        return (self.transcript.approval(identifier) or {}).get("state") == "pending"

    def reconcile_review_controls(self, *, live: bool = False, messages: Sequence[Json] = ()) -> None:
        old = self.review.current
        reading = self.review.reading
        plan = self.pending_plan_review() or {}
        plan_id = str(plan["id"]) if plan else ""
        for identifier in self.seen_plans - ({plan_id} if plan_id else set()):
            if self.review.contains(identifier):
                self.review.remove(identifier)
        pending = {str(item["id"]) for item in self.pending_approvals} if self.pending_approvals is not None else {
            str(approval["id"]) for message in self.messages.values()
            if (approval := message.get("approval")) and approval.get("state") == "pending"
        }
        for identifier in self.previous_pending_approvals - pending:
            if identifier in self.incoming_approvals:
                del self.incoming_approvals[identifier]
            if self.review.contains(identifier):
                self.review.remove(identifier)
        self.previous_pending_approvals = pending
        self.decided_reviews.intersection_update(pending | ({plan_id} if plan_id else set()))
        for identifier in self.review_unconfirmed:
            if state := self.review.find(identifier):
                state.busy = False
        self.review_unconfirmed.clear()
        if old is not self.review.current or reading != self.review.reading:
            self.focus_review_area()

        if live:
            for message in messages:
                if ((approval := message.get("approval")) and (identifier := str(approval["id"])) in pending
                        and identifier not in self.seen_approvals):
                    self.incoming_approvals[identifier] = approval
        self.seen_approvals.update(pending)
        if plan_id and plan_id not in self.seen_plans:
            self.seen_plans.add(plan_id)
            entry = self.transcript.plan_reviews.get(plan_id, plan)
            anchor = int(entry.get("anchor_sequence", 0))
            if (live and not self.review.active and self.review_area_ready() and not self.incoming_approvals
                    and not self.review_task
                    and not self.human_submit_pending and not self.delivery.queues.get((self.client.identity, self.require_chat()))
                    and not any(item.get("role") == "user" and int(item["sequence"]) > anchor for item in messages)):
                self.open_transcript_review(plan_id, "plan")
        self.schedule_review_arrivals()

    def review_area_ready(self) -> bool:
        return (not self.dialogs.active and not self.native_selecting and not self.menu_task
                and self.input.buffer.complete_state is None)

    def schedule_review_arrivals(self) -> None:
        if not self.incoming_approvals or not self.review_area_ready() or self.review.reading or self.review_task:
            return
        for identifier, approval in tuple(self.incoming_approvals.items()):
            if approval_kind(approval) == "command":
                continue
            self.incoming_approvals.pop(identifier)
            if self.approval_pending(identifier) and not self.review.contains(identifier):
                self.review.show_approval(approval)
                self.focus_review_area()
        if self.incoming_approvals and not self.review.active and not self.approval_timer:
            self.approval_timer = self.application.create_background_task(self.open_delayed_command(self.view_key()))

    async def open_delayed_command(self, own: tuple[str, int, str]) -> None:
        try:
            while (own == self.view_key() and self.incoming_approvals and not self.review.active
                   and not self.review_task and self.review_area_ready()):
                delay = self.last_input_activity + APPROVAL_INPUT_GRACE - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
                    continue
                identifier = next(iter(self.incoming_approvals))
                approval = self.incoming_approvals.pop(identifier)
                if self.approval_pending(identifier):
                    self.review.show_approval(approval)
                    self.focus_review_area()
                    return
        finally:
            if self.approval_timer is asyncio.current_task():
                self.approval_timer = None

    def start_review(self, work: Coroutine[Any, Any, None]) -> None:
        if self.review_task and not self.review_task.done():
            work.close()
            return
        self.review_task = self.application.create_background_task(work)
        self.review_task.add_done_callback(self.review_navigation_finished)

    def review_navigation_finished(self, task: asyncio.Task[None]) -> None:
        if self.review_task is task:
            self.review_task = None
            self.schedule_review_arrivals()

    def review_choice(self, choice: str) -> None:
        state = self.review.current
        if state is None or state.busy:
            return
        if state.kind == 'claim':
            self.start_review(self.claim_approval(self.view_key(), choice))
            return
        identifier = state.identifier
        if identifier in self.decided_reviews or identifier in self.review_submissions or identifier in self.review_unconfirmed:
            return
        if state.kind == 'plan':
            if (self.pending_plan_review() or {}).get('id') != identifier:
                return
        elif not self.approval_pending(identifier):
            return
        state.busy, state.error = True, ''
        self.review_submissions.add(identifier)
        self.application.create_background_task(self.apply_review(self.view_key(), state, choice,
            self.review.reason.text if state.kind == 'plan' and choice == 'reject' else ''))

    async def resync_review(self, own: tuple[str, int, str]) -> bool:
        try:
            await self.sync(own[2], expected=own)
            return own == self.view_key()
        except (Error, OSError, httpx2.HTTPError):
            return False

    async def apply_review(self, own: tuple[str, int, str], state: ReviewState, decision: str, reason: str) -> None:
        if own != self.view_key():
            return
        identifier = state.identifier
        is_plan = state.kind == 'plan'
        fingerprint = identifier, decision, reason
        if not is_plan:
            self.transcript.approval_errors.pop(identifier, None)
            self.transcript.busy.add(identifier)
            self.transcript.refresh_approval(identifier)
        try:
            if is_plan:
                request_key = self.plan_request_keys.setdefault(fingerprint, secrets.token_hex(12))
                await self.client.action("plan", chat_id=own[2], operation="decide", review_id=identifier,
                                         decision=decision, request_key=request_key,
                                         **({"reason": reason} if decision == "reject" else {}))
            else:
                result = await self.client.action("approval-decide", id=identifier, decision=decision, chat_id=own[2])
            if self.view_key() == own:
                self.decided_reviews.add(identifier)
                was_current = self.review.identifier == identifier
                if is_plan and was_current:
                    self.transcript.follow_latest()
                elif not is_plan:
                    self.show_saved_approval(identifier, result)
                    self.notice = "决定已保存，等待送达" if result.get("delivery_pending") else {
                        "allowed-once": "已批准本次调用", "rejected": "已拒绝", "cancelled": "已取消",
                    }.get(str(result.get("decision")), "审批已处理")
                self.review.remove(identifier)
                if was_current:
                    self.focus_review_area()
                await self.resync_review(own)
        except (Error, OSError, httpx2.HTTPError) as exc:
            if self.view_key() == own:
                synced = await self.resync_review(own)
                if self.view_key() != own:
                    return
                if not synced:
                    self.review_unconfirmed[identifier] = str(exc)
                if visible := self.review.find(identifier):
                    visible.error = str(exc)
                if not is_plan and self.approval_pending(identifier):
                    self.transcript.approval_errors[identifier] = str(exc)
        finally:
            if self.view_key() == own:
                self.review_submissions.discard(identifier)
                if visible := self.review.find(identifier):
                    visible.busy = identifier in self.review_unconfirmed
                if not is_plan:
                    self.transcript.busy.discard(identifier)
                    self.transcript.refresh_approval(identifier)
                self.schedule_review_arrivals()
                self.application.invalidate()

    def show_saved_approval(self, identifier: str, result: Json) -> None:
        sequence = self.transcript.approval_sequences.get(identifier)
        message = self.messages.get(sequence) if sequence is not None else None
        if message and message.get('approval', {}).get('state') == 'pending' and result.get('state'):
            approval = {**message['approval'], **{key: result[key] for key in ('state', 'decision', 'delivery_pending') if key in result}}
            updated = {**message, 'approval': approval}
            self.messages[int(updated['sequence'])] = updated
            self.render([updated])

    def review_projection(self, result: Json, *, fallback_anchor: int | None = None) -> list[Json]:
        rows = list(result.get('plan_reviews', []))
        review = result['chat'].get('plan_review')
        if review and not any(row['id'] == review['id'] for row in rows):
            old = self.transcript.plan_reviews.get(str(review['id'])) if fallback_anchor is None else None
            if review.get('state') == 'pending' or old:
                anchor = max(self.messages, default=0) if fallback_anchor is None else fallback_anchor
                rows.append({'anchor_sequence': (old or {}).get('anchor_sequence', anchor),
                             'created_revision': (old or {}).get('created_revision', int(result['cursor'])),
                             'updated_revision': int(result['cursor']), **review})
        return rows

    async def load_review_pages(self, own: tuple[str, int, str], result: Json) -> None:
        cursor = result.get('review_next_cursor')
        while cursor and own == self.view_key():
            page = await self.client.action('history', chat_id=own[2], review_after=cursor)
            if own == self.view_key():
                self.render(plan_reviews=page['plan_reviews'])
            cursor = page.get('review_next_cursor')

    async def reveal_review_anchor(self, own: tuple[str, int, str], sequence: int) -> None:
        while own == self.view_key() and self.has_older and sequence < self.first_cursor:
            before = self.first_cursor
            if self.history_task:
                await asyncio.shield(self.history_task)
            else:
                self.history_task = asyncio.create_task(self.load_history(own))
                await asyncio.shield(self.history_task)
            if self.first_cursor == before:
                break

    async def focus_bound_approval(self, own: tuple[str, int, str], identifier: str, sequence: int) -> None:
        await self.reveal_review_anchor(own, sequence)
        if own == self.view_key() and not self.dialogs.active and not self.review.active:
            self.transcript.reveal_approval(identifier)
            self.open_transcript_review(identifier, 'approval')

    async def claim_approval(self, own: tuple[str, int, str], identifier: str) -> None:
        claim = self.review.current if self.review.kind == 'claim' else None
        if claim:
            claim.busy = True
        try:
            claimed = await self.client.action('approval-claim', chat_id=own[2], id=identifier)
            if own != self.view_key():
                return
            if claim:
                self.review.remove(claim.identifier)
                self.focus_review_area()
            await self.sync(own[2], expected=own)
            await self.focus_bound_approval(own, claimed['id'], int(claimed['sequence']))
        except (Error, OSError, httpx2.HTTPError) as exc:
            if own == self.view_key():
                if claim:
                    claim.error = str(exc)
                self.notice = str(exc)
                await self.resync_review(own)
        finally:
            if own == self.view_key():
                if claim:
                    claim.busy = False
                self.application.invalidate()

    async def navigate_review(self) -> None:
        own = self.view_key()
        claim_error = ''
        try:
            try:
                claims = (await self.client.action('approval-claim', chat_id=own[2]))['approvals']
            except (Error, OSError, httpx2.HTTPError) as exc:
                claim_error, claims = str(exc), []
            if own != self.view_key() or self.dialogs.active or self.review.active:
                return
            if len(claims) == 1:
                await self.claim_approval(own, claims[0]['id'])
                return
            if claims:
                self.review.show_claims([(row['id'], row['id'][-8:] + ' · ' + row['summary'])
                    for row in claims])
                self.focus_review_area()
                return
            plan = self.pending_plan_review()
            pending = self.pending_approvals
            destinations = ([('plan', str(plan['id']))] if plan else []) + [
                ('approval', str(item['id'])) for item in pending or ()]
            destination = None
            if destinations:
                start = destinations.index(self.pending_review_cursor) + 1 if self.pending_review_cursor in destinations else 0
                destination = destinations[start % len(destinations)]
                self.pending_review_cursor = destination
            if plan and destination and destination[0] == 'plan':
                item = self.transcript.plan_reviews.get(str(plan['id']), plan)
                await self.reveal_review_anchor(own, int(item.get('anchor_sequence', 0)))
                if (own != self.view_key() or self.dialogs.active or self.review.active
                        or (self.pending_plan_review() or {}).get('id') != plan['id']):
                    return
                self.transcript.reveal_plan(str(plan['id']))
                self.open_transcript_review(str(plan['id']), 'plan')
                return
            if pending and destination and destination[0] == 'approval':
                item = next(item for item in pending if item['id'] == destination[1])
                await self.focus_bound_approval(own, item['id'], int(item['sequence']))
                return
            if not self.transcript.pending_count or not self.transcript.focus_action():
                self.notice = claim_error or '当前没有待审或可领取的审批。'
        except (Error, OSError, httpx2.HTTPError) as exc:
            if own == self.view_key():
                self.notice = str(exc)
        finally:
            self.application.invalidate()

    async def set_interaction(self, mode: str, prompt: str = "") -> None:
        view = self.view_key()
        await self.client.action("interaction", chat_id=self.require_chat(), operation="set", mode=mode,
                                 expected_revision=(self.chat or {}).get("interaction_revision", 0),
                                 request_key=secrets.token_hex(12), **({"text": prompt} if prompt else {}))
        if self.view_key() == view:
            await self.sync(view[2])
            self.notice = {"normal": "已进入普通模式", "plan": "已进入计划模式",
                           "auto": "已进入自动模式"}[mode]

    async def cycle_interaction(self) -> None:
        async with self.commands:
            chat = self.chat
            if not chat or chat.get("mode") == "super_agent" or self.dialogs.active:
                return
            modes = {"normal": "plan", "plan": "auto", "auto": "normal"}
            try:
                await self.set_interaction(modes[chat.get("interaction_mode", "normal")])
            except (Error, OSError, httpx2.HTTPError) as exc:
                self.error(str(exc))

    async def open(self, chat_id: str) -> None:
        self.recall_index, self.recall_texts = None, []
        # Keep the old conversation usable if opening the requested one fails.
        result = await self.client.action("sync", chat_id=chat_id, cursor=0)
        await self.reset_history()
        await self.stop_channel_watch()
        await self.stop_live()
        async with self.refreshing:
            if self.chat:
                self.draft_attachments[str(self.chat["id"])] = self.attachments
            self.chat = result["chat"]
            self.pending_approvals = result.get('pending_approvals')
            self.selected_device = {"id": self.chat["device_id"], "name": self.chat["device_name"]}
            self.messages = {int(m["sequence"]): m for m in result["messages"]}
            self.sync_cursor = int(result["cursor"])
            self.last_notification_ms = None
            self.render_notification_at = None
            self.first_cursor = min(self.messages, default=0)
            self.has_older = self.first_cursor > 1
            self.attachments = self.draft_attachments.setdefault(chat_id, [])
            failures = self.failed_sends.get((self.client.identity, chat_id), [])
            if failures and not self.input.text:
                self.input.text = str(failures[-1].get("text", ""))
            self.notice = "已打开 " + chat_id + "。/connect 可通知 Dot 接入。"
            self.render(result["messages"], reset=True, maintenance_statuses=result.get("maintenance_statuses"),
                        plan_reviews=self.review_projection(result, fallback_anchor=max(self.messages, default=0)))
            self.reconcile_review_controls()
        try:
            await self.load_review_pages(self.view_key(), result)
        except (Error, OSError, httpx2.HTTPError) as exc:
            self.notice = str(exc)
        await self.restart_latency()
        self.live_task = self.application.create_background_task(self.live(chat_id))

    async def stop_live(self) -> None:
        if self.live_task:
            self.live_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.live_task
            self.live_task = None
        self.live_connected = False

    async def sync(self, chat_id: str, received_at: float | None = None, *, from_cursor: int | None = None,
                   expected: tuple[str, int, str] | None = None) -> None:
        own = expected or self.view_key()
        recovered = False
        review_messages: dict[int, Json] = {}
        review_synced = False
        async with self.syncing:
            cursor = self.sync_cursor if from_cursor is None else from_cursor
            while own == self.view_key() and own[2] == chat_id:
                result = await self.client.action("sync", chat_id=chat_id, cursor=cursor)
                async with self.refreshing:
                    if own != self.view_key():
                        return
                    assert self.chat is not None
                    previous_state = self.chat.get("state")
                    changed = any(self.transcript.maintenance_statuses.get(str(item["id"])) != item
                        for item in result.get("maintenance_statuses", []))
                    if int(result["cursor"]) >= self.sync_cursor:
                        changed = changed or self.chat != result["chat"]
                        self.chat = result["chat"]
                        pending = result.get('pending_approvals')
                        changed = changed or getattr(self, 'pending_approvals', None) != pending
                        self.pending_approvals = pending
                        review_synced = True
                        channel_info = result.get("channel")
                        channel_watch = getattr(self, "channel_watch", None)
                        active_dialog = getattr(self, "active_channel_dialog", None)
                        if self.chat.get("state") == "connected" and self.chat.get("subscribed", True):
                            manual_disconnect = getattr(self, "manual_disconnect", None)
                            if manual_disconnect and manual_disconnect[0] == chat_id:
                                self.manual_disconnect = None
                        if channel_watch and channel_watch["chat_id"] == chat_id:
                            action = channel_watch["action"]
                            if channel_watch_satisfied(self.chat, action):
                                self.cancel_channel_watch(dismiss=True)
                                finished = f"Dot 已连接对话 {chat_id}" if action == "connect" else f"Dot 已暂停对话 {chat_id} 的事件订阅"
                                self.notice = finished + ("，已自动关闭提醒。" if active_dialog else "。")
                                changed = True
                            elif channel_info and channel_info.get("chat_id") == chat_id and channel_info.get("action") == action:
                                previous = channel_watch["channel"]
                                if previous.get("state") == "retrying" and previous.get("sequence") is not None and channel_info.get("sequence") == previous["sequence"]:
                                    channel_watch["channel"] = channel_info
                                    notice = format_channel_notice(action, channel_info)
                                    if notice != format_channel_notice(action, previous):
                                        self.notice = notice
                                        changed = True
                        elif previous_state == "connected" and self.chat.get("state") != "connected":
                            manual_disconnect = getattr(self, "manual_disconnect", None)
                            suppressed = bool(manual_disconnect and manual_disconnect[0] == chat_id and manual_disconnect[1] > time.monotonic())
                            if not suppressed:
                                self.notice = f"Dot 连接已断开；可在需要时输入 /connect 或前往 Dot 告知：连接对话 {chat_id}"
                                changed = True
                    applied = []
                    for message in result["messages"]:
                        sequence = int(message["sequence"])
                        if received_at is not None:
                            review_messages[sequence] = message
                        if sequence < self.first_cursor and sequence not in self.messages:
                            continue
                        changed = changed or self.messages.get(sequence) != message
                        self.messages[sequence] = message
                        applied.append(message)
                    cursor = int(result["cursor"])
                    latest = cursor >= self.sync_cursor
                    self.sync_cursor = max(self.sync_cursor, cursor)
                    if self.network_error and self.live_connected and from_cursor is None:
                        self.network_error = False
                        recovered = True
                        self.notice = "实时连接已恢复。"
                        changed = True
                    if changed or result.get('plan_reviews'):
                        self.chats = [self.chat if item["id"] == chat_id else item for item in self.chats]
                        if received_at is not None:
                            self.render_notification_at = received_at
                        reviews = ChatTerminal.review_projection(self, result) if latest else result.get('plan_reviews')
                        self.render(applied, maintenance_statuses=result.get("maintenance_statuses"), plan_reviews=reviews)
                if not result["more"]:
                    break
            if review_synced and own == self.view_key() and getattr(self, 'review', None):
                self.reconcile_review_controls(live=received_at is not None and from_cursor is None,
                                               messages=tuple(review_messages.values()))
        if from_cursor is None and own == self.view_key():
            self.maybe_load_history(recovered=recovered)

    async def live(self, chat_id: str) -> None:
        delay = 1
        while self.chat and self.chat["id"] == chat_id:
            try:
                async with self.client.live(chat_id) as socket:
                    self.live_connected = True
                    self.delivery.wake(self.client.identity, chat_id)
                    self.application.invalidate()
                    dirty = asyncio.Event()
                    received: list[float] = []

                    async def receive(changed: asyncio.Event = dirty, arrivals: list[float] = received) -> None:
                        async for raw in socket:
                            event = json.loads(raw)
                            if event.get("chat_id") == chat_id and event.get("type") in {"chat.ready", "chat.changed"}:
                                if event["type"] == "chat.changed":
                                    arrivals[:] = [time.monotonic()]
                                changed.set()

                    async def update(changed: asyncio.Event = dirty, arrivals: list[float] = received) -> None:
                        nonlocal delay
                        while True:
                            try:
                                await asyncio.wait_for(changed.wait(), timeout=LIVE_RECONCILE_SECONDS)
                            except asyncio.TimeoutError:
                                pass
                            changed.clear()
                            received_at = arrivals[0] if arrivals else None
                            arrivals.clear()
                            await self.sync(chat_id, received_at)
                            delay = 1

                    receiver = asyncio.create_task(receive())
                    updater = asyncio.create_task(update())
                    try:
                        done, _ = await asyncio.wait((receiver, updater), return_when=asyncio.FIRST_COMPLETED)
                        for task in done:
                            await task
                    finally:
                        self.live_connected = False
                        for task in (receiver, updater):
                            task.cancel()
                        await asyncio.gather(receiver, updater, return_exceptions=True)
                raise Error("chat_live_closed", "实时连接已断开，正在重新连接。")
            except (Error, WebSocketException, httpx2.HTTPError, OSError) as exc:
                self.network_error = True
                self.errors = [*self.errors[-9:], str(exc)]
                self.notice = "实时连接中断，正在重连…"
                if isinstance(exc, ConnectionClosed) and exc.rcvd and exc.rcvd.code == 1008:
                    self.error("聊天访问已失效；/login 重新登录账号，或 /logout 返回本机身份。")
                self.application.invalidate()
                if not self.client.authenticated or isinstance(exc, Error) and exc.code in {
                    "chat_not_found", "chat_login_required", "account_access_expired", "account_unavailable",
                    "device_forbidden", "device_missing",
                } or isinstance(exc, ConnectionClosed) and exc.rcvd and exc.rcvd.code == 1008:
                    return
            await asyncio.sleep(delay)
            delay = min(delay * 2, 15)

    async def delivery_saved(self, identity: str, body: Json, result: Json) -> None:
        self.delivery_notices.pop((identity, str(body["chat_id"])), None)
        async with self.refreshing:
            if self.client.identity != identity or not self.chat or self.chat['id'] != body['chat_id']:
                return
            message = result['message']
            sequence = int(message['sequence'])
            if sequence not in self.messages:
                self.messages[sequence] = message
                self.render([message])
            self.notice = message_status(self.messages[sequence])

    async def delivery_failed(self, identity: str, body: Json, error: Exception) -> None:
        self.delivery_notices.pop((identity, str(body["chat_id"])), None)
        self.failed_sends.setdefault((identity, str(body['chat_id'])), []).append(body)
        if self.client.identity == identity and self.chat and self.chat['id'] == body['chat_id']:
            if not self.input.text:
                self.input.text = str(body.get('text', ''))
                if body.get("reply_to"):
                    self.quote_drafts.setdefault((identity, str(body["chat_id"])), {"id": body["reply_to"], "text": ""})
            self.error(str(error) + "\n\n未发送内容：\n" + str(body.get('text', '')))

    async def delivery_status(self, identity: str, chat_id: str, text: str) -> None:
        self.delivery_notices[identity, chat_id] = text
        if self.client.identity == identity and self.chat and self.chat['id'] == chat_id:
            self.notice = text

    async def send(self, body: Json) -> None:
        self.delivery.enqueue(body)
        getattr(self, "quote_drafts", {}).pop((self.client.identity, str(body["chat_id"])), None)
        self.attachments = []
        self.render()

    def attachment_draft(self) -> AttachmentDraft:
        key = self.client.identity, str((self.chat or {}).get("id", ""))
        return self.attachment_markers.setdefault(key, AttachmentDraft())

    def add_files(self, paths: Sequence[AttachmentSource]) -> None:
        self.slash.close()
        self.input.buffer.insert_text(self.attachment_draft().insert(paths))

    def paste_text(self, text: str, *, files: bool = True) -> None:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        paths = pasted_paths(text, self.input.buffer.document.text_before_cursor) if files else []
        if paths:
            self.add_files(paths)
        else:
            self.input.buffer.insert_text(text)

    async def paste_clipboard(self) -> None:
        own = self.view_key()
        self.clipboard_sequence += 1
        destination = Path(self.clipboard_files.name) / f"clipboard-{self.clipboard_sequence}.png"
        self.notice = "正在读取系统剪贴板…"
        try:
            content = await read_clipboard(destination)
            if own != self.view_key():
                destination.unlink(missing_ok=True)
                return
            self.slash.close()
            if content.paths:
                self.add_files(content.paths)
                self.notice = "已粘贴 " + "、".join(path.name for path in content.paths) + "；Enter 发送"
            elif content.text is not None:
                self.paste_text(content.text, files=False)
                self.notice = "已粘贴剪贴板文字"
            else:
                self.notice = "剪贴板中没有可粘贴的文件、图片或文字"
        except (Error, OSError, ValueError, TimeoutError) as exc:
            destination.unlink(missing_ok=True)
            if own == self.view_key():
                self.error(str(exc) if str(exc) else "读取系统剪贴板超时，请重试。")
        finally:
            self.clipboard_task = None

    async def submit(self, value: str) -> None:
        self.cancel_copy_menu()
        await self.wait_copy_menu()
        async with self.commands:
            try:
                command, _, argument = value.partition(" ")
                task_command = (self.chat or {}).get("mode") == "super_agent" and command.lower() in SUPER_AGENT_COMMANDS
                if command.lower() in BY_NAME and not task_command:
                    await self.command(command.lower(), argument.strip())
                else:
                    paths, text = self.attachment_draft().parse(value)
                    if not task_command and not paths and re.fullmatch(r"/[A-Za-z][A-Za-z0-9_-]*", command):
                        await self.command(command.lower(), argument.strip())
                        return
                    chat_id = self.require_chat()
                    uploaded = []
                    for path in paths:
                        def progress(done: int, size: int, name: str = path.name) -> None:
                            self.notice = f"正在上传 {name} · {done}/{size} 字节"
                        self.notice = "正在上传 " + path.name
                        uploaded.append(await self.client.upload(chat_id, path, progress))
                    if len(json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")) > 1_500_000:
                        command_match = re.match(r"^\s*(/(?:task-new|task\s+\S+))\s+([\s\S]+)$", text) if (self.chat or {}).get("mode") == "super_agent" else None
                        if command_match and command_match.group(2).strip():
                            upload_text = command_match.group(2)
                            kept_text = re.sub(r"\s+", " ", command_match.group(1), count=1)
                        else:
                            upload_text = text
                            kept_text = ""
                        self.notice = "正文较长，正在作为 Markdown 附件上传…"
                        with tempfile.TemporaryDirectory(prefix="bridge-message-") as temporary:
                            body_file = Path(temporary) / "message-body.md"
                            body_file.write_bytes(upload_text.encode("utf-8"))
                            uploaded.append(await self.client.upload(chat_id, body_file))
                        text = kept_text
                    quotes = getattr(self, "quote_drafts", {})
                    quote = quotes.get((self.client.identity, chat_id)) if quotes else None
                    await self.send({"chat_id": chat_id, "text": text,
                        **({"reply_to": quote["id"]} if quote else {}),
                        "attachments": [item["id"] for item in [*self.attachments, *uploaded]],
                        "request_key": secrets.token_hex(12), "source": "tui"})
                    if self.drop:
                        for file in paths:
                            if isinstance(file, DroppedAttachment):
                                self.drop.release(file)
            except (Error, OSError, ValueError, httpx2.HTTPError) as exc:
                if not self.input.text:
                    self.input.text = value
                    self.input.buffer.cursor_position = len(value)
                    self.error(str(exc))
                else:
                    self.error(str(exc) + "\n\n未发送内容：\n" + value)
                self.application.invalidate()

    async def quote_message(self, argument: str) -> None:
        chat_id = self.require_chat()
        identity = self.client.identity
        scope = identity, chat_id
        if argument == "cancel":
            self.quote_drafts.pop(scope, None)
            self.notice = "已取消引用"
            return
        identifier, _, remainder = argument.partition(" ")
        if not identifier:
            choices = [(str(item["id"]), str(item["id"]), str(item.get("text", ""))[:180] or "（附件消息）")
                       for _, item in sorted(self.messages.items(), reverse=True)
                       if item.get("role") == "assistant" and item.get("kind") != "approval" and not item.get("approval_id")]
            if not choices:
                raise Error("quote_missing", "已加载记录中没有 dot 消息；可用 /quote m1 指定更早消息")
            identifier = await self.choose("引用 dot 消息", choices)
            if identifier is None:
                return
        if not re.fullmatch(r"m[1-9][0-9]*", identifier):
            raise Error("quote_invalid", "请输入消息 ID，例如 /quote m1；/quote cancel 取消引用")
        item = self.messages.get(int(identifier[1:]))
        if item is None:
            result = await self.client.action("history", chat_id=chat_id, after=int(identifier[1:]) - 1, limit=1)
            item = next((item for item in result.get("messages", []) if item.get("id") == identifier), None)
        if self.client.identity != identity or (self.chat or {}).get("id") != chat_id:
            return
        if not item or item.get("role") != "assistant" or item.get("kind") == "approval" or item.get("approval_id"):
            raise Error("quote_invalid", "只能引用当前对话中可读取的 dot 消息")
        self.quote_drafts[scope] = {"id": identifier, "text": item.get("text", "")}
        self.notice = "引用 " + identifier + " · " + str(item.get("text", ""))[:120]
        if remainder:
            self.input.text = remainder
            self.input.buffer.cursor_position = len(remainder)
        self.application.invalidate()

    async def export_conversation(self, chat_id: str, destination: Path) -> None:
        progress_text = "正在读取完整会话…"
        finished: asyncio.Future[bool] = asyncio.get_running_loop().create_future()

        def progress(text: str) -> None:
            nonlocal progress_text
            progress_text = text
            self.application.invalidate()

        def cancel() -> None:
            if not finished.done():
                finished.set_result(False)

        keys = KeyBindings()
        keys.add("escape", eager=True)(lambda event: cancel())
        content = FormattedTextControl(lambda: progress_text, key_bindings=keys, focusable=True)
        cancel_button = Button("取消", handler=cancel)
        bind_keys(cancel_button.control, keys)
        navigate = KeyBindings()
        navigate.add("enter")(lambda event: self.application.layout.focus(cancel_button))
        navigate.add("down")(lambda event: self.application.layout.focus(cancel_button))
        bind_keys(content, navigate)
        back = KeyBindings()
        back.add("up")(lambda event: self.application.layout.focus(content))
        bind_keys(cancel_button.control, back)
        dialog = Dialog(title="导出会话", body=HSplit([Window(content, height=3),
            Label("↓ / Enter 到取消按钮 · ↑ 返回进度 · Tab/Shift+Tab 切换\n按钮 Enter 取消导出 · Esc 取消导出")]),
            buttons=[cancel_button], width=80)
        operation = asyncio.create_task(export_chat(self.client, chat_id, destination, progress))
        def complete(task: asyncio.Task[Json]) -> None:
            if not finished.done():
                finished.set_result(True)
        operation.add_done_callback(complete)
        try:
            accepted = await self.dialogs.present(dialog, content, finished)
            if not accepted:
                operation.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await operation
                self.notice = "已取消导出"
                return
            result = await operation
            self.note(f"保存位置：{result['path']}\n消息：{result['messages']}\n附件：{result['attachments']}", title="会话导出完成")
        finally:
            if not operation.done():
                operation.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await operation

    async def update_client(self, argument: str) -> None:
        text = argument.strip()
        if text:
            channel = github_update.normalize_channel(text)
        else:
            selected = await self.choose(
                "选择更新渠道",
                [(key, f"{label} ({key})", summary) for key, label, summary in github_update.CHANNELS],
                description=(
                    f"从 GitHub 仓库 {github_update.DEFAULT_REPOSITORY or '未设置'} 检查本机客户端更新；"
                    "仅更新本机客户端，不自动降级。"
                ),
                selected_id="stable",
            )
            if selected is None:
                return
            channel = github_update.normalize_channel(selected)

        home_dir = self.client.config.parent
        current = github_update.current_installed_version(home_dir)
        settings = github_update.load_device_settings(home_dir)
        channel_label = github_update.CHANNEL_LABELS[channel]
        self.notice = f"正在检查 {channel_label} 更新（当前 {current}）…"
        self.application.invalidate()
        try:
            release = await github_update.fetch_latest_release(settings, channel=channel)
        finally:
            self.notice = ""
            self.application.invalidate()
        if release is None:
            self.note(
                f"当前版本：{current}\n所选渠道（{channel_label}）暂无可用客户端发布版本。",
                title="检查更新",
            )
            return

        latest = str(release["version"])
        if not github_update.is_newer_version(latest, current):
            message = (
                f"当前已是所选渠道最新版本（{current}）。"
                if github_update.parse_version(latest) == github_update.parse_version(current)
                else f"当前版本（{current}）已高于所选渠道最新版本（{latest}），无需更新（不自动降级）。"
            )
            self.note(message, title="已是最新版本")
            return

        detail_lines = [
            f"当前版本：{current}",
            f"最新版本：{latest}",
            f"更新渠道：{channel_label}",
            f"发布仓库：{github_update.DEFAULT_REPOSITORY or '未设置'}",
        ]
        if release.get("published_at"):
            detail_lines.append(f"发布时间：{release['published_at']}")
        notes = str(release.get("notes") or "").strip()
        if notes:
            detail_lines.extend(["", "更新说明：", notes[:1200]])
        confirmation = await self.choose(
            f"发现新版本 {latest}",
            [
                ("install", f"立即更新到 {latest}", "下载、隔离构建并在切换后自动重启界面"),
                ("cancel", "取消", "暂不更新，保留当前版本"),
            ],
            description="\n".join(detail_lines),
            selected_id="install",
        )
        if confirmation != "install":
            return

        progress_text = f"正在准备更新到 {latest}…"
        can_cancel = True
        cancel_requested = False
        finished: asyncio.Future[bool] = asyncio.get_running_loop().create_future()

        def progress(message: str) -> None:
            nonlocal progress_text
            progress_text = message
            self.application.invalidate()

        def check_cancelled() -> None:
            if cancel_requested:
                raise github_update.UpdateCancelledError()

        def on_switching() -> None:
            nonlocal can_cancel
            can_cancel = False
            self.application.invalidate()

        def cancel() -> None:
            nonlocal cancel_requested, progress_text
            if not can_cancel:
                progress_text = "正在切换后台服务并刷新命令，请等待完成…"
                self.application.invalidate()
                return
            cancel_requested = True
            if not finished.done():
                finished.set_result(False)

        keys = KeyBindings()
        keys.add("escape", eager=True)(lambda event: cancel())
        content = FormattedTextControl(lambda: progress_text, key_bindings=keys, focusable=True)
        cancel_button = Button("取消", handler=cancel)
        bind_keys(cancel_button.control, keys)
        navigate = KeyBindings()
        navigate.add("enter")(lambda event: self.application.layout.focus(cancel_button))
        navigate.add("down")(lambda event: self.application.layout.focus(cancel_button))
        bind_keys(content, navigate)
        back = KeyBindings()
        back.add("up")(lambda event: self.application.layout.focus(content))
        bind_keys(cancel_button.control, back)

        def hint_text() -> str:
            if not can_cancel:
                return "正在切换后台服务与版本激活状态，请等待完成…"
            return "↓ / Enter 到取消按钮 · ↑ 返回进度 · Tab/Shift+Tab 切换\n按钮 Enter 取消更新 · Esc 取消更新"

        dialog = Dialog(
            title=f"正在更新到 {latest}",
            body=HSplit([Window(content, height=3), Label(hint_text)]),
            buttons=[cancel_button],
            width=80,
        )
        operation = asyncio.create_task(
            github_update.install_client_release(
                home_dir,
                release,
                progress=progress,
                cancelled=check_cancelled,
                on_switching=on_switching,
            )
        )

        def complete(task: asyncio.Task[Json]) -> None:
            if not finished.done():
                finished.set_result(True)

        operation.add_done_callback(complete)
        try:
            accepted = await self.dialogs.present(dialog, content, finished)
            if not accepted and can_cancel:
                operation.cancel()
                with contextlib.suppress(asyncio.CancelledError, github_update.UpdateCancelledError):
                    await operation
                self.notice = "已取消更新"
                return
            result = await operation
        finally:
            if not operation.done() and can_cancel:
                operation.cancel()
                with contextlib.suppress(asyncio.CancelledError, github_update.UpdateCancelledError):
                    await operation

        relaunch_argv = [
            str(result["python"]),
            "-m",
            "computer_bridge",
            "chat",
            "--config",
            str(self.client.config),
        ]
        if self.chat and self.chat.get("id"):
            relaunch_argv.extend(["--resume", str(self.chat["id"])])
        if not self.browser:
            relaunch_argv.append("--no-browser")
        self.relaunch_argv = relaunch_argv
        self.application.exit()

    async def command(self, name: str, argument: str) -> None:
        if name in {"/quit", "/exit", "/q", "/e", "/quite"}:
            self.application.exit()
        elif name == "/quote":
            await self.quote_message(argument)
        elif name in {"/goal", "/plan"}:
            chat_id = self.require_chat()
            if (self.chat or {}).get("mode") == "super_agent":
                raise Error("chat_mode_mismatch", "此命令仅用于普通 Chat 会话")
            if name == "/goal":
                result = await self.client.action("goal", chat_id=chat_id, operation="command", input=argument,
                                                  request_key=secrets.token_hex(12))
                goal = result.get("goal")
                self.notice = format_goal_summary(goal) if goal else "当前没有目标"
                await self.sync(chat_id)
            else:
                await self.set_interaction("normal" if argument == "off" else "plan",
                                           "" if argument == "off" else argument)
        elif name == "/help":
            self.note(help_for_mode((self.chat or {}).get("mode")), title="命令帮助")
        elif name == "/status":
            self.note(self.status_report(), title="当前状态")
        elif name == "/update":
            await self.update_client(argument)
        elif name == "/login":
            await self.switch_identity(login=True)
        elif name == "/logout":
            await self.switch_identity(login=False)
        elif name == "/computers":
            await self.choose_computer()
        elif name in {"/permissions", "/workspaces"}:
            device = (self.chat or {}).get("device_id") or self.selected_device.get("id")
            if not device:
                raise Error("chat_device_required", "请先用 /computers 选择电脑")
            if name == "/permissions":
                await self.device_settings.permissions(device)
            else:
                await self.device_settings.workspaces(device)
        elif name == "/new":
            if not self.selected_device and not await self.choose_computer():
                return
            identity = self.client.identity
            pending = self.pending_creations.get(identity)
            if pending is None:
                mode = await self.choose("新建对话：选择模式", [
                    ("chat", "Chat", "连续对话与多条上下文，不自动创建任务"),
                    ("super_agent", "Super Agent", "持久任务协作，需 Work / Dot 执行宿主")], selected_id="chat")
                if mode is None:
                    return
                pending = {"device_id": self.selected_device["id"], "title": argument or "新的对话",
                    "mode": mode, "request_key": secrets.token_hex(12)}
                if mode == "super_agent":
                    provider = await self.choose("仓库绑定（可选）", [
                        ("none", "不绑定仓库", "一般任务与不绑定代码仓库"),
                        ("github", "GitHub", "仅作上下文，不自动克隆或授权"),
                        ("cnb", "腾讯 CNB", "仅作上下文，不自动克隆或授权")], selected_id="none")
                    if provider is None:
                        return
                    repository = None
                    if provider != "none":
                        url = await self.dialogs.path("仓库 HTTPS 地址", "https://github.com/" if provider == "github" else "https://cnb.cool/")
                        if url is None:
                            return
                        repository = {"provider": provider, "url": url.strip()}
                    pending["repository"] = repository
                self.pending_creations[identity] = pending
            else:
                self.notice = "正在确认上次新建结果，不会重复创建。"
            try:
                result = await self.client.action("create", **pending)
            except Error as exc:
                # A successful but unreadable HTTP response can follow a committed create.
                if exc.code != "chat_response":
                    self.pending_creations.pop(identity, None)
                raise
            self.pending_creations.pop(identity, None)
            await self.open(result["chat"]["id"])
            self.start_channel_watch(str(result["chat"]["id"]), "connect", result.get("channel"))
        elif name == "/resume":
            if argument:
                await self.open(argument)
            else:
                await self.choose_chat()
        elif name == "/delete":
            chat_id = self.require_chat()
            delete_choice = await self.choose("删除当前对话", [("cancel", "取消", "保留对话"),
                ("delete", "删除对话", f"{self.chat['title'] if self.chat else ''} · {chat_id}，删除服务器消息、附件和聊天任务记录；已启动电脑命令不会自动停止")], selected_id="cancel")
            if delete_choice != "delete":
                return
            await self.stop_channel_watch()
            await self.reset_history()
            await self.delivery.discard(self.client.identity, chat_id)
            await self.stop_live()
            try:
                await self.client.action("delete", chat_id=chat_id)
            except (Error, OSError, httpx2.HTTPError):
                self.live_task = self.application.create_background_task(self.live(chat_id))
                raise
            self.delivery_notices.pop((self.client.identity, chat_id), None)
            self.attachment_markers.pop((self.client.identity, chat_id), None)
            self.chat, self.messages, self.attachments = None, {}, []
            self.has_older = False
            self.render(reset=True)
            self.notice = f"对话 {chat_id} 已删除。"
            self.application.invalidate()
            await self.refresh_list()
        elif name == "/title":
            self.chat = (await self.client.action("rename", chat_id=self.require_chat(), title=argument))["chat"]
            self.application.invalidate()
        elif name == "/math":
            self.require_chat()
            candidates=[item for item in self.messages.values() if item.get('kind')!='approval' and has_math(item['text'])]
            if argument:
                selected=next((item for item in candidates if item['id']==argument),None)
                if selected is None:raise Error('chat_math_missing','该消息没有可查看的公式，或尚未加载；向上滚动会自动读取更早消息。')
            else:
                if not candidates:
                    self.notice='已加载消息中没有数学公式。';return
                chosen=await self.choose('选择公式消息',[(str(item['id']),' '.join(item['text'].split())[:90],str(item['id'])) for item in candidates])
                if chosen is None:return
                selected=next(item for item in candidates if item['id']==chosen)
            self.notice='正在生成本机完整排版…';self.application.invalidate()
            path=await preview(self.client.settings,selected,Path(self.previews.name))
            self.notice='已打开完整排版 · '+str(path)
        elif name == "/connect":
            chat_id = self.require_chat()
            self.cancel_channel_watch(dismiss=True)
            self.manual_disconnect = None
            self.notice = format_channel_notice("connect", None)
            result = await self.client.action("connect", chat_id=chat_id)
            if result.get("chat") and self.chat and self.chat.get("id") == chat_id:
                self.chat = result["chat"]
            self.start_channel_watch(chat_id, "connect", result.get("channel"))
        elif name == "/disconnect":
            chat_id = self.require_chat()
            self.cancel_channel_watch(dismiss=True)
            self.manual_disconnect = (chat_id, time.monotonic() + CHANNEL_FALLBACK_SECONDS + 30.0)
            self.notice = format_channel_notice("disconnect", None)
            try:
                result = await self.client.action("disconnect", chat_id=chat_id)
            except Exception:
                self.manual_disconnect = None
                raise
            if result.get("chat") and self.chat and self.chat.get("id") == chat_id:
                self.chat = result["chat"]
            self.start_channel_watch(chat_id, "disconnect", result.get("channel"))
        elif name == "/theme":
            theme_choice = await self.choose("选择主题", [(key, label, "当前主题" if key == self.theme else "")
                for key, label in THEMES.items()], selected_id=self.theme)
            if theme_choice:
                save_theme(self.client.config, theme_choice)
                self.theme = theme_choice
                self.notice = "主题已切换：" + THEMES[theme_choice]
        elif name == "/export":
            chat_id = self.require_chat()
            destination = await self.dialogs.path("保存完整会话 ZIP", str(Path.cwd() / export_filename(self.chat or {})))
            if destination is None:
                return
            await self.export_conversation(chat_id, Path(destination).expanduser())
        elif name == "/download":
            attachment_id, _, destination = argument.partition(" ")
            saved = await self.client.download(self.require_chat(), attachment_id,
                Path(destination.strip('"')) if destination else None)
            self.note("附件已保存并通过 SHA256 校验：" + str(saved))
        elif name == "/read":
            result = await self.client.action("read-attachment", chat_id=self.require_chat(), attachment_id=argument,
                offset=0, length=16384, encoding="text")
            self.note(str(result["text"]) + ("\n（未完整显示；使用 /download 下载原文件。）" if not result["eof"] else ""))
        else:
            raise Error("chat_command", "未知命令；/help 查看可用命令。")
        self.application.invalidate()

    async def initialize(self) -> None:
        try:
            await self.refresh_computers()
            if self.resume:
                await self.open(self.resume)
            else:
                await self.refresh_list()
            if not self.resume and not self.chats and self.selected_device:
                await self.command("/new", "")
            elif not self.resume:
                self.notice = "使用 /resume 按名称选择对话，或 /new 新建。"
        except (Error, OSError, httpx2.HTTPError) as exc:
            if self.startup_gateway == "正在连接":
                self.startup_gateway = "连接暂不可用"
            if not self.chats:
                self.startup_list_state = "暂无法读取会话"
            self.error(str(exc))
            self.application.invalidate()

    async def run(self) -> None:
        def start() -> None:
            self.keyboard.start(self.application.output)
            if self.drop:
                self.application.create_background_task(self.drop.run())
            self.application.create_background_task(self.initialize())
            if not self.resume and not self.chat:
                self.application.create_background_task(self.refresh_startup_update())
        try:
            await self.application.run_async(pre_run=start)
        finally:
            self.cancel_copy_menu()
            await self.wait_copy_menu()
            if self.clipboard_task:
                self.clipboard_task.cancel()
                await asyncio.gather(self.clipboard_task, return_exceptions=True)
            await self.reset_history()
            if self.latency_task:
                self.latency_task.cancel()
                await asyncio.gather(self.latency_task, return_exceptions=True)
                self.latency_task = None
            await self.stop_channel_watch()
            for task in tuple(self.dialog_tasks):
                task.cancel()
            await asyncio.gather(*self.dialog_tasks, return_exceptions=True)
            await self.delivery.close()
            self.keyboard.close()
            self.status_notice.close()
            await self.stop_live()
            if self.transcript.document_flush:self.transcript.document_flush.cancel()
            self.markdown.close()
            self.previews.cleanup()
            self.clipboard_files.cleanup()
            if self.drop:
                self.drop.close()


async def run(config: Path, resume: str | None = None, *, browser: bool = True, login: bool = False) -> None:
    relaunch: list[str] | None = None
    async with ChatClient(config) as client:
        await client.connect(browser=browser, login=login)
        terminal = ChatTerminal(client, resume, browser=browser)
        with contextlib.suppress(EOFError, KeyboardInterrupt):
            await terminal.run()
        relaunch = terminal.relaunch_argv
    if relaunch:
        if os.name == "nt":
            raise SystemExit(subprocess.run(relaunch, check=False).returncode)
        os.execv(relaunch[0], relaunch)
