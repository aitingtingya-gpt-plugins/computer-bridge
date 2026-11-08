"""Full-screen terminal chat. Closing it does not disconnect the model endpoint."""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
import secrets
import sys
import tempfile
import time
from collections.abc import Callable, Sequence
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
from prompt_toolkit.layout import Float, FloatContainer, HSplit, Layout, Window
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

from .chat_attachments import AttachmentDraft, AttachmentSource, DroppedAttachment, pasted_paths
from .chat_client import ChatClient
from .chat_clipboard import copy_text, read_clipboard
from .chat_commands import BY_NAME, HELP, CommandCompleter, SlashMenu
from .chat_delivery import DeliveryQueue
from .chat_dialogs import ChatDialogs, bind_keys, text_navigation
from .chat_export import export_chat, export_filename
from .chat_input import InputNavigator, KeyboardInput
from .chat_markdown import MarkdownWorker, has_math, preview
from .chat_native_drop import WindowsDrop
from .chat_native_menu import context_menu, menu_anchor
from .chat_settings import DeviceSettings
from .chat_status import StatusNotice, compact_status, latency_status
from .chat_themes import load_theme, save_theme, theme_style
from .chat_themes import names as THEMES
from .chat_transcript import ChatTranscript, TranscriptWindow
from .common import Error, Json

STATES = {"waiting": "等待模型连接", "connected": "模型已连接", "expired": "模型连接已到期"}
NOTIFICATIONS = {"waiting": "等待接收方上线", "pending": "等待通知", "unreachable": "暂不可达",
                 "received": "宿主已接收", "blocked": "通知配置异常", "none": ""}

def message_status(message: Json) -> str:
    parts = ["已保存", NOTIFICATIONS.get(message.get("notification", {}).get("state", "none"), "")]
    if message.get("reply", {}).get("state") == "replied" or message.get("delivery") == "replied":
        parts.append("已回复")
    return " · ".join(part for part in parts if part)


class ChatTerminal:
    def __init__(self, client: ChatClient, resume: str | None = None, *, browser: bool = True):
        self.client = client
        self.resume = resume
        self.browser = browser
        self.selected_device: Json = dict(client.device) if client.mode == "device" else {}
        self.computers: list[Json] = []
        self.identity_drafts: dict[str, Json] = {}
        self.chat: Json | None = None
        self.chats: list[Json] = []
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
        self.reminder_epoch = 0
        self.login_generation = self.login_active = 0
        self.dialog_tasks: set[asyncio.Task[None]] = set()
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
        self.input = TextArea(multiline=True, wrap_lines=True, height=4, prompt="", completer=CommandCompleter(), complete_while_typing=False)
        self.input.buffer.on_text_changed += self.recall_edited
        self.transcript = ChatTranscript(message_status, self.decide_approval)
        self.transcript.on_scroll = self.history_scrolled
        self.transcript.copy_menu = self.show_copy_menu
        self.native_selecting = self.native_frozen = False
        self.markdown = MarkdownWorker(client.settings)
        self.transcript.markdown = self.markdown
        self.previews = tempfile.TemporaryDirectory(prefix='computer-bridge-formulas-')
        self.clipboard_files = tempfile.TemporaryDirectory(prefix='computer-bridge-clipboard-')
        self.clipboard_task: asyncio.Task[None] | None = None
        self.menu_task: asyncio.Task[None] | None = None
        self.drop = (WindowsDrop(self.native_files, self.native_mouse, self.native_notice)
                     if WindowsDrop.supported() else None)
        self.clipboard_sequence = 0
        self.transcript_window = TranscriptWindow(self.transcript, right_margins=[ScrollbarMargin(display_arrows=True)])
        keys = KeyBindings()

        @keys.add("enter")
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
                self.application.create_background_task(self.submit(value))
            return None

        input_focused = Condition(lambda: self.application.layout.current_control is self.input.control)
        input_editing = input_focused & Condition(lambda: not self.native_selecting)
        transcript_focused = Condition(lambda: self.application.layout.current_control is self.transcript)
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

        @keys.add("c-j")
        @keys.add("escape", "enter")
        def newline(event: object) -> None:
            if self.application.layout.current_control is self.input.control:
                self.slash.close()
                self.input.buffer.insert_text("\n")

        @keys.add("c-q")
        def quit_app(event: object) -> None:
            self.application.exit()

        @keys.add("c-c", filter=input_focused)
        def clear(event: object) -> None:
            self.input.text = ""

        @keys.add("c-c", filter=Condition(lambda: sys.platform == "win32" and self.has_selection()))
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
            if not self.transcript.focus_action(-1):
                self.application.layout.focus(self.input)

        @keys.add("escape", filter=transcript_focused, eager=True)
        def leave_approval(event: object) -> None:
            self.application.layout.focus(self.input)

        @keys.add("f1")
        def help_text(event: object) -> None:
            self.note(HELP, title="命令帮助")

        layout = HSplit([
            Frame(self.transcript_window),
            Frame(self.input),
            Window(FormattedTextControl(self.status), height=1, style="class:status"),
        ])
        def after_render(application: Application[None]) -> None:
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

        self.layout = FloatContainer(content=layout, floats=[Float(xcursor=True, ycursor=True,
            content=CompletionsMenu(max_height=8, display_arrows=True, extra_filter=input_focused))])
        self.keyboard = KeyboardInput()
        self.application: Application[None] = Application(layout=Layout(self.layout, focused_element=self.input), input=self.keyboard.input,
            key_bindings=keys, full_screen=True, mouse_support=~native, min_redraw_interval=1/30, after_render=after_render, style=DynamicStyle(lambda: theme_style(self.theme)))
        self.bind_copy_controls()
        self.application.ttimeoutlen = 0.1
        self.status_notice.invalidate = self.application.invalidate
        self.dialogs = ChatDialogs(self.application, self.layout)
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
        def input_mouse(event: MouseEvent) -> Any:
            if event.event_type == MouseEventType.MOUSE_DOWN:
                if event.button == MouseButton.RIGHT:
                    self.show_copy_menu()
                    return None
                if event.button == MouseButton.LEFT:
                    self.transcript.clear_selection()
                    self.application.layout.focus(self.input)
            return mouse(event)
        control.mouse_handler = input_mouse

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
        if self.menu_task or self.dialogs.active:
            return
        anchor = anchor or menu_anchor()
        if anchor:
            self.menu_task = self.application.create_background_task(
                self.copy_menu(anchor, self.view_key(), self.selected_text()))

    async def copy_menu(self, anchor: tuple[int, ...], view: tuple[str, int, str], value: str) -> None:
        try:
            choice = await context_menu(anchor, can_copy=bool(value))
            if view != self.view_key() or self.dialogs.active:
                return
            if choice == "copy":
                await self.copy_selected(value)
            elif choice == "paste":
                self.application.layout.focus(self.input)
                self.start_clipboard_paste()
        except OSError:
            self.notice = "无法打开系统右键菜单。"
        finally:
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
        self.transcript.clear_selection()
        if not self.recalling:
            self.recall_index = None
            self.recall_texts = []

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

    def status(self) -> FormattedText:
        device = self.selected_device
        chat = self.chat or {}
        columns = self.application.output.get_size().columns
        if self.native_selecting:
            return FormattedText([("class:status", "拖选文字 · Command+C 复制 · Esc 返回")])
        state = ("未连接" if not self.client.authenticated else "重连中" if self.network_error
                 else "未选对话" if not self.chat else "连接中" if not self.live_connected
                 else {"connected": "已连接", "waiting": "等待模型", "expired": "通知到期"}.get(str(chat.get("state")), "等待模型"))
        tone, latency = latency_status(self.latency) if device.get('id') else ("", "")
        value = compact_status(str(chat.get('device_name', device.get('name', '请选择电脑'))),
            str(chat.get('device_id', device.get('id', ''))), str(chat.get('title', '')),
            str(chat.get('id', '')), state, columns,
            username=str(self.client.account.get('username', '')) if self.client.mode == 'account' else '',
            pending=self.transcript.pending_count,
            notice=self.notice if self.status_notice.visible() else self.delivery_notices.get((self.client.identity, str(chat.get("id", ""))), ""), latency=latency)
        offset = value.rfind(latency) if latency else -1
        return FormattedText([( "", value)]) if offset < 0 else FormattedText([
            ("", value[:offset]), (tone, latency), ("", value[offset + len(latency):])])

    def error(self, value: str) -> None:
        self.errors.append(value)
        self.errors = self.errors[-10:]
        self.note(value, title="操作失败")

    def note(self, value: str, *, title: str = "提示", key: str | None = None, valid: Callable[[], bool] | None = None) -> None:
        task = self.application.create_background_task(self.dialogs.message(title, value, key=key, valid=valid))
        self.dialog_tasks.add(task)
        task.add_done_callback(self.dialog_tasks.discard)

    def render(self, messages: list[Json] | None = None, *, reset: bool = False) -> None:
        self.transcript.update(messages or (), reset=reset, older=self.has_older, history_state=self.history_state,
            history_complete=bool(self.messages) and self.first_cursor == 1 and not self.has_older)
        self.application.invalidate()

    def connection_text(self) -> str:
        chat_id = self.require_chat()
        return (f"连接 ID：{chat_id} · {self.chat['device_name'] if self.chat else ''}\n\n"
            f"在 GPT Work 或 Dot 启用 Computer Bridge 后发送：\n连接对话 {chat_id}，并订阅 chat.message。\n\n"
            "模型调用 chat.resume 取得连接凭据，再用宿主的事件任务订阅 chat.message。"
            "收到事件后用 data.connection 直接调用 chat.reply，无需再次 resume。\n\n"
            "普通 Chat 无事件唤醒。获取 ID 不会替换已有模型连接。")

    def remind_connection(self, reason: str) -> None:
        chat_id = self.require_chat()
        self.reminder_epoch += 1
        epoch = self.reminder_epoch
        text = reason + "\n\n" + self.connection_text()
        task = self.application.create_background_task(self.dialogs.message("连接 GPT / Dot", text,
            key="connect:" + chat_id, valid=lambda: bool(self.chat and self.chat['id'] == chat_id
                and self.chat.get('state') != 'connected' and self.reminder_epoch == epoch)))
        self.dialog_tasks.add(task)
        task.add_done_callback(self.dialog_tasks.discard)

    def require_chat(self) -> str:
        if not self.chat:
            raise Error("chat_required", "先输入 /new 新建对话，或 /resume 按名称选择已有对话。")
        return str(self.chat["id"])

    def list_scope(self) -> Json:
        return {"device_id": self.client.device["id"]} if self.client.mode == "device" else {}

    async def refresh_list(self) -> None:
        result = await self.client.action("list", **self.list_scope(), limit=1)
        self.chats = result["chats"]

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
                + str(entry["created_at"]).replace("T", " ").removesuffix("Z")) for entry in chats]
            if cursor is not None:
                choices.append(("more", "加载更多对话", ""))
            chosen = await self.choose("选择历史对话", choices, selected_id=selected)
            if chosen == "more":
                continue
            if chosen is None:
                self.notice = "已取消选择，当前对话保持不变。"
            else:
                await self.open(chosen)
                self.notice = "已打开「" + str(self.chat["title"] if self.chat else chosen) + "」。/connect 获取连接 ID。"
            break
        self.application.invalidate()

    def view_key(self) -> tuple[str, int, str]:
        return self.client.identity, self.view_generation, str(self.chat["id"]) if self.chat else ""

    async def reset_history(self) -> None:
        self.view_generation += 1
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
                self.render(additions)
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
        self.computers = (await self.client.action("devices"))["computers"]
        if not self.selected_device and len(self.computers) == 1:
            self.selected_device = self.computers[0]
        await self.restart_latency()

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
        self.identity_drafts[previous] = {"attachments": self.draft_attachments}
        saved = self.identity_drafts.get(self.client.identity, {})
        self.draft_attachments = saved.get("attachments", {})
        self.delivery.set_identity(self.client.identity)
        self.chat, self.messages, self.attachments, self.chats = None, {}, [], []
        self.selected_device = dict(self.client.device) if self.client.mode == "device" else {}
        self.has_older, self.network_error, self.sync_cursor = False, False, 0
        self.input.text = ""
        self.render(reset=True)
        await self.refresh_computers()
        await self.refresh_list()
        self.notice = ("已登录账号 " + str(self.client.account["username"]) if login else "已返回本机身份") + "；/resume 选择对话，/computers 选择电脑。"
        self.render()

    def decide_approval(self, identifier: str, decision: str) -> None:
        self.application.create_background_task(self.apply_approval(identifier, decision))

    async def apply_approval(self, identifier: str, decision: str) -> None:
        chat_id = self.require_chat()
        if identifier in self.transcript.busy:
            return
        self.transcript.busy.add(identifier)
        self.transcript.refresh_approval(identifier)
        try:
            result = await self.client.action("approval-decide", id=identifier, decision=decision, chat_id=chat_id)
            self.notice = {"allowed-once": "已批准本次调用", "rejected": "已拒绝", "cancelled": "已取消"}.get(str(result.get("decision")), "审批已处理")
            if self.chat and self.chat["id"] == chat_id:
                await self.sync(chat_id)
        except (Error, OSError, httpx2.HTTPError) as exc:
            self.error(str(exc))
        finally:
            self.transcript.busy.discard(identifier)
            self.transcript.refresh_approval(identifier)

    async def open(self, chat_id: str) -> None:
        self.reminder_epoch += 1
        self.recall_index, self.recall_texts = None, []
        # Keep the old conversation usable if opening the requested one fails.
        result = await self.client.action("sync", chat_id=chat_id, cursor=0)
        await self.reset_history()
        await self.stop_live()
        async with self.refreshing:
            if self.chat:
                self.draft_attachments[str(self.chat["id"])] = self.attachments
            self.chat = result["chat"]
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
            self.notice = "已打开 " + chat_id + "。/connect 获取连接 ID。"
            self.render(result["messages"], reset=True)
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
        async with self.syncing:
            cursor = self.sync_cursor if from_cursor is None else from_cursor
            while own == self.view_key() and own[2] == chat_id:
                result = await self.client.action("sync", chat_id=chat_id, cursor=cursor)
                async with self.refreshing:
                    if own != self.view_key():
                        return
                    assert self.chat is not None
                    previous_state = self.chat.get("state")
                    changed = False
                    if int(result["cursor"]) >= self.sync_cursor:
                        changed = self.chat != result["chat"]
                        self.chat = result["chat"]
                        if self.chat.get("state") == "connected":
                            self.dialogs.dismiss("connect:" + chat_id)
                        elif previous_state == "connected":
                            self.remind_connection("模型连接已关闭，请重新连接。")
                    applied = []
                    for message in result["messages"]:
                        sequence = int(message["sequence"])
                        if sequence < self.first_cursor and sequence not in self.messages:
                            continue
                        changed = changed or self.messages.get(sequence) != message
                        self.messages[sequence] = message
                        applied.append(message)
                    cursor = int(result["cursor"])
                    self.sync_cursor = max(self.sync_cursor, cursor)
                    if self.network_error and self.live_connected and from_cursor is None:
                        self.network_error = False
                        recovered = True
                        self.notice = "实时连接已恢复。"
                        changed = True
                    if changed:
                        self.chats = [self.chat if item["id"] == chat_id else item for item in self.chats]
                        if received_at is not None:
                            self.render_notification_at = received_at
                        self.render(applied)
                if not result["more"]:
                    break
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
                            await changed.wait()
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
            self.error(str(error) + "\n\n未发送内容：\n" + str(body.get('text', '')))

    async def delivery_status(self, identity: str, chat_id: str, text: str) -> None:
        self.delivery_notices[identity, chat_id] = text
        if self.client.identity == identity and self.chat and self.chat['id'] == chat_id:
            self.notice = text

    async def send(self, body: Json) -> None:
        self.delivery.enqueue(body)
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
        async with self.commands:
            try:
                command, _, argument = value.partition(" ")
                if command.lower() in BY_NAME:
                    await self.command(command.lower(), argument.strip())
                else:
                    paths, text = self.attachment_draft().parse(value)
                    if not paths and re.fullmatch(r"/[A-Za-z][A-Za-z0-9_-]*", command):
                        await self.command(command.lower(), argument.strip())
                        return
                    chat_id = self.require_chat()
                    uploaded = []
                    for path in paths:
                        def progress(done: int, size: int, name: str = path.name) -> None:
                            self.notice = f"正在上传 {name} · {done}/{size} 字节"
                        self.notice = "正在上传 " + path.name
                        uploaded.append(await self.client.upload(chat_id, path, progress))
                    await self.send({"chat_id": chat_id, "text": text,
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

    async def command(self, name: str, argument: str) -> None:
        if name == "/quit":
            self.application.exit()
        elif name == "/help":
            self.note(HELP, title="命令帮助")
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
            result = await self.client.action("create", device_id=self.selected_device["id"],
                title=argument or "新的对话", request_key=secrets.token_hex(12))
            await self.open(result["chat"]["id"])
            self.remind_connection("新会话已创建，请连接模型。")
        elif name == "/resume":
            if argument:
                await self.open(argument)
            else:
                await self.choose_chat()
        elif name == "/delete":
            chat_id = self.require_chat()
            delete_choice = await self.choose("删除当前对话", [("cancel", "取消", "保留对话"),
                ("delete", "删除对话", f"{self.chat['title'] if self.chat else ''} · {chat_id}，删除服务器消息和附件")], selected_id="cancel")
            if delete_choice != "delete":
                return
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
            self.reminder_epoch += 1
            self.chat, self.messages, self.attachments = None, {}, []
            self.has_older = False
            self.render(reset=True)
            await self.refresh_list()
            self.notice = "对话已删除"
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
            self.note(self.connection_text(), title="连接 GPT / Dot")
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
            self.error(str(exc))
            self.application.invalidate()

    async def run(self) -> None:
        def start() -> None:
            self.keyboard.start(self.application.output)
            if self.drop:
                self.application.create_background_task(self.drop.run())
            self.application.create_background_task(self.initialize())
        try:
            await self.application.run_async(pre_run=start)
        finally:
            if self.clipboard_task:
                self.clipboard_task.cancel()
                await asyncio.gather(self.clipboard_task, return_exceptions=True)
            await self.reset_history()
            if self.latency_task:
                self.latency_task.cancel()
                await asyncio.gather(self.latency_task, return_exceptions=True)
                self.latency_task = None
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
    async with ChatClient(config) as client:
        await client.connect(browser=browser, login=login)
        terminal = ChatTerminal(client, resume, browser=browser)
        with contextlib.suppress(EOFError, KeyboardInterrupt):
            await terminal.run()
