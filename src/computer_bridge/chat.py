"""Full-screen terminal chat. Closing it does not disconnect the model endpoint."""

from __future__ import annotations

import asyncio
import contextlib
import json
import secrets
import time
from datetime import datetime
from pathlib import Path

import httpx2
from prompt_toolkit.application import Application
from prompt_toolkit.data_structures import Point
from prompt_toolkit.document import Document
from prompt_toolkit.formatted_text import FormattedText
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import Float, FloatContainer, HSplit, Layout, VSplit, Window
from prompt_toolkit.layout.containers import AnyContainer
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.dimension import Dimension
from prompt_toolkit.layout.margins import ScrollbarMargin
from prompt_toolkit.styles import Style
from prompt_toolkit.widgets import Dialog, Frame, Label, TextArea
from websockets.exceptions import ConnectionClosed, WebSocketException

from .chat_client import ChatClient
from .common import Error, Json

HELP = """/new [标题]        新建对话
/resume             按名称选择历史对话
/login              登录账号，使用账号有权访问的全部电脑
/logout             返回本机身份
/computers          选择新对话使用的电脑
/approve            查看当前电脑的待审批命令
/title 新标题       修改当前标题
/list               刷新对话列表
/more               显示下一页对话
/history            读取更早的消息
/attach 文件路径    添加附件（路径含空格可直接粘贴）
/unattach           清空待发送附件
/read a1            查看文本附件
/download a1 [路径] 下载附件并校验 SHA256
/connect            获取连接 ID 和 Work / Dot 连接步骤
/timing [m1]        查看消息投递分段耗时
/retry              重试未确认发送的消息
/help               显示命令
/quit               退出终端，保留模型连接

Enter 发送 · Alt+Enter 换行 · PageUp/PageDown 滚动 · Ctrl+Q 退出
"""

STATES = {"waiting": "等待模型连接", "connected": "模型已连接", "expired": "模型连接已到期"}
DELIVERIES = {"pending": "待投递", "delivered": "已送达宿主", "replied": "已回复", "failed": "投递失败", "none": ""}


class ChatTerminal:
    def __init__(self, client: ChatClient, resume: str | None = None, *, browser: bool = True):
        self.client = client
        self.resume = resume
        self.browser = browser
        self.selected_device: Json = dict(client.device) if client.mode == "device" else {}
        self.computers: list[Json] = []
        self.approvals: list[Json] = []
        self.identity_drafts: dict[str, Json] = {}
        self.chat: Json | None = None
        self.chats: list[Json] = []
        self.list_cursor: int | None = None
        self.messages: dict[int, Json] = {}
        self.sync_cursor = 0
        self.first_cursor = 0
        self.has_older = False
        self.attachments: list[Json] = []
        self.draft_attachments: dict[str, list[Json]] = {}
        self.pending_sends: dict[str, Json] = {}
        self.notice = "正在连接…"
        self.notes: list[str] = []
        self.network_error = False
        self.commands = asyncio.Lock()
        self.refreshing = asyncio.Lock()
        self.live_task: asyncio.Task[None] | None = None
        self.last_notification_ms: float | None = None
        self.render_notification_at: float | None = None
        self.input = TextArea(multiline=True, wrap_lines=True, height=4, prompt="› ")
        self.transcript = TextArea(read_only=True, scrollbar=True, wrap_lines=True)
        self.sidebar = TextArea(read_only=True, width=26, wrap_lines=True)
        keys = KeyBindings()

        @keys.add("enter")
        def send(event: object) -> None:
            if self.application.layout.current_control is not self.input.control:
                self.application.layout.focus(self.input)
                return
            value = self.input.text
            if value.strip() or self.attachments:
                self.input.text = ""
                self.application.create_background_task(self.submit(value))

        @keys.add("escape", "enter")
        def newline(event: object) -> None:
            self.input.buffer.insert_text("\n")

        @keys.add("c-q")
        def quit_app(event: object) -> None:
            self.application.exit()

        @keys.add("c-c")
        def clear(event: object) -> None:
            self.input.text = ""

        @keys.add("pageup")
        def scroll_up(event: object) -> None:
            self.transcript.buffer.cursor_up(count=10)

        @keys.add("pagedown")
        def scroll_down(event: object) -> None:
            self.transcript.buffer.cursor_down(count=10)

        @keys.add("f1")
        def help_text(event: object) -> None:
            self.note(HELP)

        layout = HSplit([
            Window(FormattedTextControl(self.header), height=2, style="class:header"),
            VSplit([Frame(self.sidebar, title=lambda: "本机对话" if self.client.mode == "device" else "账号对话"), Frame(self.transcript, title="消息")]),
            Window(FormattedTextControl(lambda: self.notice), height=2, style="class:status", wrap_lines=True),
            Frame(self.input, title=lambda: "消息" + (f" · {len(self.attachments)} 个附件" if self.attachments else "")),
            Window(FormattedTextControl(" Enter 发送  Alt+Enter 换行  /help 命令  Ctrl+Q 退出"), height=1, style="class:hint"),
        ])
        def after_render(application: Application[None]) -> None:
            if self.render_notification_at is not None:
                self.last_notification_ms = (time.monotonic() - self.render_notification_at) * 1000
                self.render_notification_at = None

        self.layout = FloatContainer(content=layout, floats=[])
        self.application: Application[None] = Application(layout=Layout(self.layout, focused_element=self.input),
            key_bindings=keys, full_screen=True, mouse_support=True, after_render=after_render, style=Style.from_dict({
                "header": "bg:#163b36 #e9f6f1 bold", "status": "#72c5af", "hint": "#8c999b",
                "frame.label": "#72c5af bold", "frame.border": "#4b6260", "text-area": "#e3ebea",
                "dialog.body": "bg:#163b36 #e3ebea", "chat-choice": "bg:#163b36 #e3ebea",
                "chat-choice.selected": "bg:#276256 #ffffff bold", "chat-choice.time": "#a0b9b2",
            }))

    def header(self) -> str:
        device = self.selected_device
        chat = self.chat or {}
        identity = "本机身份" if self.client.mode == "device" else "账号：" + str(self.client.account.get("username", ""))
        title = f"{chat.get('id', '—')} · {chat.get('title', '选择或新建对话')}"
        approval = f" · {len(self.approvals)} 条待审批 /approve" if self.approvals else ""
        return f" Computer Bridge  ·  {chat.get('device_name', device.get('name', '请选择电脑'))} {chat.get('device_id', device.get('id', ''))}  ·  {identity}\n {title}  ·  {STATES.get(chat.get('state', ''), '')}{approval}"

    def note(self, value: str) -> None:
        self.notes.append(value)
        self.notes = self.notes[-10:]
        self.render()

    def render(self) -> None:
        rows: list[str] = []
        if self.has_older:
            rows.append("↑ /history 读取更早消息\n")
        for message in sorted(self.messages.values(), key=lambda item: item["sequence"]):
            sender = "GPT / Dot" if message["role"] == "assistant" else "你"
            delivery = DELIVERIES.get(message.get("delivery", "none"), "")
            rows.append(f"{sender} · {message['id']} · {message.get('created_at', '')}  {delivery}\n{message['text']}")
            for attachment in message.get("attachments", []):
                rows.append(f"  ↳ {attachment['id']}  {attachment['name']}  ({attachment['size']} 字节)")
            rows.append("")
        if self.notes:
            rows.append("\n".join("— " + value for value in self.notes))
        old_position = self.transcript.buffer.cursor_position
        at_end = self.transcript.buffer.document.is_cursor_at_the_end
        text = "\n".join(rows)
        if text != self.transcript.text:
            self.transcript.buffer.set_document(Document(text, len(text) if at_end else min(old_position, len(text))), bypass_readonly=True)
        sidebar = "\n\n".join(
            ("● " if self.chat and self.chat["id"] == entry["id"] else "  ")
            + entry["id"] + "\n" + entry["title"]
            + ("\n" + str(entry.get("device_name", entry["device_id"])) if self.client.mode == "account" else "") for entry in self.chats
        ) or "暂无对话\n\n/new 新建"
        if self.list_cursor is not None:
            sidebar += "\n\n/more 下一页"
        if sidebar != self.sidebar.text:
            self.sidebar.text = sidebar
        self.application.invalidate()

    def require_chat(self) -> str:
        if not self.chat:
            raise Error("chat_required", "先输入 /new 新建对话，或 /resume 按名称选择已有对话。")
        return str(self.chat["id"])

    @property
    def unsent(self) -> Json | None:
        return self.pending_sends.get(str(self.chat["id"])) if self.chat else None

    def list_scope(self) -> Json:
        return {"device_id": self.client.device["id"]} if self.client.mode == "device" else {}

    async def refresh_list(self, after: int = 0) -> None:
        result = await self.client.action("list", **self.list_scope(), after=after, limit=100)
        self.chats = result["chats"]
        self.list_cursor = result["next_cursor"]
        self.render()

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
        rows: list[AnyContainer] = [Label("↑ / ↓ 选择 · Enter 确认 · Esc 关闭")]
        if description:
            rows.append(TextArea(text=description, read_only=True, scrollbar=True, wrap_lines=True,
                height=Dimension(min=3, preferred=min(12, description.count("\n") + 3), max=12)))
        body = HSplit([*rows, Window(control, height=Dimension(min=1, preferred=min(14, len(choices)), max=14),
            right_margins=[ScrollbarMargin(display_arrows=True)])])
        floating = Float(content=Dialog(title=title, body=body, width=96))
        focus = self.application.layout.current_control
        self.layout.floats.append(floating)
        self.application.layout.focus(control)
        self.application.invalidate()
        try:
            return await decision
        finally:
            self.layout.floats.remove(floating)
            self.application.layout.focus(focus)
            self.application.invalidate()

    async def choose_chat(self) -> None:
        self.notice = "正在读取历史对话…"
        self.application.invalidate()
        chats: list[Json] = []
        cursor: int | None = 0
        while cursor is not None:
            page = await self.client.action("list", **self.list_scope(), after=cursor, limit=100)
            chats.extend(page["chats"])
            cursor = page["next_cursor"]
        if not chats:
            self.notice = "还没有可访问的历史对话；/new 新建。"
            return
        choices = [(str(entry["id"]), str(entry["title"]),
            (str(entry.get("device_name", entry["device_id"])) + " · " if self.client.mode == "account" else "")
            + str(entry["created_at"]).replace("T", " ").removesuffix("Z")) for entry in chats]
        chosen = await self.choose("选择历史对话", choices, selected_id=str(self.chat["id"]) if self.chat else None)
        if chosen is None:
            self.notice = "已取消选择，当前对话保持不变。"
        else:
            await self.open(chosen)
            self.notice = "已打开「" + str(self.chat["title"] if self.chat else chosen) + "」。/connect 获取连接 ID。"
        self.application.invalidate()

    async def refresh_computers(self) -> None:
        self.computers = (await self.client.action("devices"))["computers"]
        if not self.selected_device and len(self.computers) == 1:
            self.selected_device = self.computers[0]

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
        await self.stop_live()
        self.selected_device = next(item for item in self.computers if item["id"] == chosen)
        self.chat, self.messages, self.attachments, self.notes = None, {}, [], []
        self.has_older = False
        self.notice = "已选择「" + str(self.selected_device["name"]) + "」；/new 新建对话，/resume 打开历史对话。"
        await self.refresh_approvals()
        self.render()
        return True

    async def switch_identity(self, *, login: bool) -> None:
        previous = self.client.identity
        old_chat = str(self.chat["id"]) if self.chat else None
        await self.stop_live()
        try:
            if login:
                await self.client.login_account(browser=self.browser, notice=self.note)
            else:
                await self.client.logout()
        except BaseException:
            if old_chat:
                self.live_task = self.application.create_background_task(self.live(old_chat))
            raise
        if self.chat:
            self.draft_attachments[str(self.chat["id"])] = self.attachments
        self.identity_drafts[previous] = {"attachments": self.draft_attachments, "pending": self.pending_sends}
        saved = self.identity_drafts.get(self.client.identity, {})
        self.draft_attachments, self.pending_sends = saved.get("attachments", {}), saved.get("pending", {})
        self.chat, self.messages, self.attachments, self.chats, self.notes, self.approvals = None, {}, [], [], [], []
        self.selected_device = dict(self.client.device) if self.client.mode == "device" else {}
        self.has_older, self.network_error, self.sync_cursor = False, False, 0
        self.input.text = ""
        self.render()
        await self.refresh_computers()
        await self.refresh_list()
        await self.refresh_approvals()
        self.notice = ("已登录账号 " + str(self.client.account["username"]) if login else "已返回本机身份") + "；/resume 选择对话，/computers 选择电脑。"
        self.render()

    def approval_device(self) -> str:
        return str(self.chat["device_id"]) if self.chat else str(self.selected_device.get("id", ""))

    async def refresh_approvals(self) -> None:
        device = self.approval_device()
        if not device:
            self.approvals = []
            return
        result = await self.client.action("approvals", device_id=device)
        if device == self.approval_device():
            self.approvals = [item for item in result["approvals"] if item["state"] == "pending"]
            self.application.invalidate()

    async def approve(self) -> None:
        if not self.approval_device() and not await self.choose_computer():
            return
        await self.refresh_approvals()
        if not self.approvals:
            self.notice = "当前电脑没有待审批命令。"
            return
        chosen = await self.choose("当前电脑的待审批命令", [(str(item["id"]), "待审批命令 " + str(index + 1),
            "到期 " + datetime.fromtimestamp(float(item["expires_at"]) / 1000).astimezone().strftime("%H:%M:%S"))
            for index, item in enumerate(self.approvals)])
        if chosen is None:
            return
        details = await self.client.action("approval-details", id=chosen)
        if details["state"] != "pending":
            self.notice = "该审批已处理。"
            await self.refresh_approvals()
            return
        expires = float(details["expires_at"])
        if expires > 10_000_000_000:
            expires /= 1000
        detail = ("电脑：" + self.approval_device() + "\n目录：" + str(details["cwd"]) + "\n命令：\n"
            + str(details["command"]) + "\n理由：" + str(details["justification"])
            + "\n到期：" + datetime.fromtimestamp(expires).astimezone().isoformat(timespec="seconds")
            + "\n批准后，本次命令及其子进程、后续输入将以当前登录用户权限在工作区沙盒外运行。")
        decision = await self.choose("审批命令", [("close", "关闭", "保持待审批"),
            ("allowed-once", "批准本次", "仅限这次命令"), ("rejected", "拒绝", "不执行命令"),
            ("cancelled", "取消命令", "不执行命令")], description=detail)
        if decision is None or decision == "close":
            self.notice = "已关闭审批详情，未改变审批结果。"
            return
        result = await self.client.action("approval-decide", id=chosen, decision=decision,
            **({"chat_id": self.chat["id"]} if self.chat else {}))
        labels = {"allowed-once": "已批准本次命令", "rejected": "已拒绝", "cancelled": "已取消命令"}
        self.notice = labels.get(str(result.get("decision")), "审批已处理")
        await self.refresh_approvals()

    async def open(self, chat_id: str) -> None:
        # Keep the old conversation usable if opening the requested one fails.
        result = await self.client.action("sync", chat_id=chat_id, cursor=0)
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
            self.notes.clear()
            self.notice = "已打开 " + chat_id + "。/connect 获取连接 ID。"
            await self.refresh_list()
            self.render()
        await self.refresh_approvals()
        self.live_task = self.application.create_background_task(self.live(chat_id))

    async def stop_live(self) -> None:
        if self.live_task:
            self.live_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.live_task
            self.live_task = None

    async def sync(self, chat_id: str, received_at: float | None = None) -> None:
        async with self.refreshing:
            while self.chat and self.chat["id"] == chat_id:
                result = await self.client.action("sync", chat_id=chat_id, cursor=self.sync_cursor)
                changed = self.chat != result["chat"]
                self.chat = result["chat"]
                for message in result["messages"]:
                    sequence = int(message["sequence"])
                    changed = changed or self.messages.get(sequence) != message
                    self.messages[sequence] = message
                self.sync_cursor = int(result["cursor"])
                if self.network_error:
                    self.network_error = False
                    self.notice = "实时连接已恢复。"
                    changed = True
                if changed:
                    self.chats = [self.chat if item["id"] == chat_id else item for item in self.chats]
                    if received_at is not None:
                        self.render_notification_at = received_at
                    self.render()
                if not result["more"]:
                    return

    async def live(self, chat_id: str) -> None:
        delay = 1
        while self.chat and self.chat["id"] == chat_id:
            try:
                async with self.client.live(chat_id) as socket:
                    dirty = asyncio.Event()
                    dirty.set()
                    received: list[float] = []

                    async def receive(changed: asyncio.Event = dirty, arrivals: list[float] = received) -> None:
                        async for raw in socket:
                            event = json.loads(raw)
                            if event.get("type") == "approvals.changed":
                                await self.refresh_approvals()
                            if event.get("chat_id") == chat_id and event.get("type") in {"chat.ready", "chat.changed"}:
                                if event["type"] == "chat.ready":
                                    await self.refresh_approvals()
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
                        for task in (receiver, updater):
                            task.cancel()
                        await asyncio.gather(receiver, updater, return_exceptions=True)
                raise Error("chat_live_closed", "实时连接已断开，正在重新连接。")
            except (Error, WebSocketException, httpx2.HTTPError, OSError) as exc:
                self.network_error = True
                self.notice = str(exc)
                if isinstance(exc, ConnectionClosed) and exc.rcvd and exc.rcvd.code == 1008:
                    self.notice = "聊天访问已失效；/login 重新登录账号，或 /logout 返回本机身份。"
                self.application.invalidate()
                if not self.client.authenticated or isinstance(exc, Error) and exc.code in {
                    "chat_not_found", "chat_login_required", "account_access_expired", "account_unavailable",
                    "device_forbidden", "device_missing",
                } or isinstance(exc, ConnectionClosed) and exc.rcvd and exc.rcvd.code == 1008:
                    return
            await asyncio.sleep(delay)
            delay = min(delay * 2, 15)

    async def send(self, body: Json) -> None:
        chat_id = str(body["chat_id"])
        pending = self.pending_sends.get(chat_id)
        if pending and body["request_key"] != pending["request_key"]:
            raise Error("chat_pending", "上一条消息的发送结果尚未确认，请先使用 /retry。")
        self.pending_sends[chat_id] = body
        async with self.refreshing:
            result = await self.client.action("send", **body)
            self.pending_sends.pop(chat_id, None)
            self.chat = result["chat"]
            message = result["message"]
            self.messages[int(message["sequence"])] = message
            self.attachments.clear()
            self.notice = "消息已保存；" + DELIVERIES.get(message.get("delivery", "pending"), "待投递")
            self.render()

    async def submit(self, value: str) -> None:
        async with self.commands:
            try:
                if value.startswith("/"):
                    command, _, argument = value.partition(" ")
                    await self.command(command.lower(), argument.strip())
                else:
                    await self.send({"chat_id": self.require_chat(), "text": value,
                        "attachments": [item["id"] for item in self.attachments],
                        "request_key": secrets.token_hex(12), "source": "tui"})
            except (Error, OSError, ValueError, httpx2.HTTPError) as exc:
                self.notice = str(exc) + (" /retry 可确认原消息的发送结果。" if self.unsent else "")
                self.application.invalidate()

    async def command(self, name: str, argument: str) -> None:
        if name == "/quit":
            self.application.exit()
        elif name == "/help":
            self.note(HELP)
        elif name == "/login":
            await self.switch_identity(login=True)
        elif name == "/logout":
            await self.switch_identity(login=False)
        elif name == "/computers":
            await self.choose_computer()
        elif name == "/approve":
            await self.approve()
        elif name == "/list":
            await self.refresh_list()
            self.notice = "使用 /resume 按名称选择对话，或 /new 新建。"
        elif name == "/more":
            if self.list_cursor is None:
                self.notice = "已经是最后一页对话。"
            else:
                await self.refresh_list(self.list_cursor)
        elif name == "/new":
            if not self.selected_device and not await self.choose_computer():
                return
            result = await self.client.action("create", device_id=self.selected_device["id"],
                title=argument or "新的对话", request_key=secrets.token_hex(12))
            await self.open(result["chat"]["id"])
        elif name == "/resume":
            if argument:
                await self.open(argument)
            else:
                await self.choose_chat()
        elif name == "/title":
            self.chat = (await self.client.action("rename", chat_id=self.require_chat(), title=argument))["chat"]
            await self.refresh_list()
        elif name == "/history":
            if not self.has_older:
                self.notice = "没有更早的消息。"
                return
            result = await self.client.action("history", chat_id=self.require_chat(), before=self.first_cursor, limit=50)
            self.messages.update({int(m["sequence"]): m for m in result["messages"]})
            self.first_cursor = int(result.get("first_cursor", self.first_cursor))
            self.has_older = bool(result.get("has_older", False))
            self.notice = "已加载更早消息；PageUp 向上查看。"
            self.render()
        elif name == "/connect":
            chat_id = self.require_chat()
            self.note(f"连接 ID：{chat_id} · {self.chat['device_name'] if self.chat else ''}\n"
                f"在 Work 或 Dot 启用 Computer Bridge 后发送：\n连接对话 {chat_id}：先调用 chat.resume，"
                "再使用宿主的事件任务订阅 chat.message；订阅成功后，通过 chat.reply 回复。\n"
                "chat.resume 返回 subscribed:false 时仍在等待订阅。获取 ID 不会连接或替换模型；"
                "已被其他模型对话使用时会显示占用。收到 chat.message 后使用事件中的 connection 直接回复，不要重新 resume。")
        elif name == "/timing":
            result = await self.client.action("timing", chat_id=self.require_chat(),
                **({"message_id": argument} if argument else {}))
            if not result["timings"]:
                self.notice = "当前对话没有可查看的消息。"
                return
            item = result["timings"][0]
            rows = [f"{item['message_id']} · 投递分段耗时"]
            for field, label in (("save_to_first_attempt_ms", "保存 → 首次投递"),
                ("first_attempt_to_host_accept_ms", "首次投递 → 宿主接收"),
                ("host_accept_to_reply_ms", "宿主接收 → 回复保存")):
                value = item[field]
                rows.append(label + "：" + (f"{value} ms" if value is not None else "尚无记录"))
            if self.last_notification_ms is not None:
                rows.append(f"最近一次终端通知 → 显示更新：{self.last_notification_ms:.1f} ms")
            rows.append("宿主接收表示事件已送达，不代表模型已开始处理。")
            self.note("\n".join(rows))
        elif name == "/attach":
            path = Path(argument.strip('"'))
            self.notice = "正在上传 " + path.name
            self.application.invalidate()
            def progress(done: int, total: int) -> None:
                self.notice = f"上传 {path.name} · {done}/{total} 字节"
                self.application.invalidate()
            attachment = await self.client.upload(self.require_chat(), path, progress)
            self.attachments.append(attachment)
            self.notice = f"已添加 {attachment['id']} · {attachment['name']}。输入消息后发送。"
            self.render()
        elif name == "/unattach":
            self.attachments.clear()
            self.notice = "已清空待发送附件。"
            self.render()
        elif name == "/download":
            attachment_id, _, destination = argument.partition(" ")
            saved = await self.client.download(self.require_chat(), attachment_id,
                Path(destination.strip('"')) if destination else None)
            self.note("附件已保存并通过 SHA256 校验：" + str(saved))
        elif name == "/read":
            result = await self.client.action("read-attachment", chat_id=self.require_chat(), attachment_id=argument,
                offset=0, length=16384, encoding="text")
            self.note(str(result["text"]) + ("\n（未完整显示；使用 /download 下载原文件。）" if not result["eof"] else ""))
        elif name == "/retry":
            if self.unsent:
                await self.send(self.unsent)
            else:
                self.notice = "没有未确认发送的消息。"
        else:
            raise Error("chat_command", "未知命令；/help 查看可用命令。")
        self.application.invalidate()

    async def initialize(self) -> None:
        try:
            await self.refresh_computers()
            await self.refresh_list()
            await self.refresh_approvals()
            if self.resume:
                await self.open(self.resume)
            elif not self.chats and self.selected_device:
                await self.command("/new", "")
            else:
                self.notice = "使用 /resume 按名称选择对话，或 /new 新建。"
        except (Error, OSError, httpx2.HTTPError) as exc:
            self.notice = str(exc)
            self.application.invalidate()

    async def run(self) -> None:
        def start() -> None:
            self.application.create_background_task(self.initialize())
        try:
            await self.application.run_async(pre_run=start)
        finally:
            await self.stop_live()


async def run(config: Path, resume: str | None = None, *, browser: bool = True, login: bool = False) -> None:
    async with ChatClient(config) as client:
        await client.connect(browser=browser, login=login)
        terminal = ChatTerminal(client, resume, browser=browser)
        with contextlib.suppress(EOFError, KeyboardInterrupt):
            await terminal.run()
