"""Full-screen terminal chat. Closing it does not disconnect the model endpoint."""

from __future__ import annotations

import asyncio
import contextlib
import secrets
from pathlib import Path

import httpx2
from prompt_toolkit.application import Application
from prompt_toolkit.document import Document
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import HSplit, Layout, VSplit, Window
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.styles import Style
from prompt_toolkit.widgets import Frame, TextArea

from .chat_client import ChatClient
from .common import Error, Json

HELP = """/new [标题]        新建对话
/resume t1          打开历史对话
/title 新标题       修改当前标题
/list               刷新对话列表
/more               显示下一页对话
/history            读取更早的消息
/attach 文件路径    添加附件（路径含空格可直接粘贴）
/unattach           清空待发送附件
/read a1            查看文本附件
/download a1 [路径] 下载附件并校验 SHA256
/connect            显示 Work / Dot 连接指令
/retry              重试未确认发送的消息
/help               显示命令
/quit               退出终端，保留模型连接

Enter 发送 · Alt+Enter 换行 · PageUp/PageDown 滚动 · Ctrl+Q 退出
"""

STATES = {"waiting": "等待模型连接", "connected": "模型已连接", "expired": "模型连接已到期"}
DELIVERIES = {"pending": "待投递", "delivered": "已送达宿主", "replied": "已回复", "failed": "投递失败", "none": ""}


class ChatTerminal:
    def __init__(self, client: ChatClient, resume: str | None = None):
        self.client = client
        self.resume = resume
        self.chat: Json | None = None
        self.chats: list[Json] = []
        self.list_cursor: int | None = None
        self.messages: dict[int, Json] = {}
        self.cursor = 0
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
            VSplit([Frame(self.sidebar, title="本机对话"), Frame(self.transcript, title="消息")]),
            Window(FormattedTextControl(lambda: self.notice), height=2, style="class:status", wrap_lines=True),
            Frame(self.input, title=lambda: "消息" + (f" · {len(self.attachments)} 个附件" if self.attachments else "")),
            Window(FormattedTextControl(" Enter 发送  Alt+Enter 换行  /help 命令  Ctrl+Q 退出"), height=1, style="class:hint"),
        ])
        self.application: Application[None] = Application(layout=Layout(layout, focused_element=self.input),
            key_bindings=keys, full_screen=True, mouse_support=True, style=Style.from_dict({
                "header": "bg:#163b36 #e9f6f1 bold", "status": "#72c5af", "hint": "#8c999b",
                "frame.label": "#72c5af bold", "frame.border": "#4b6260", "text-area": "#e3ebea",
            }))

    def header(self) -> str:
        device = self.client.device
        chat = self.chat or {}
        title = f"{chat.get('id', '—')} · {chat.get('title', '选择或新建对话')}"
        return f" Computer Bridge  ·  {chat.get('device_name', device.get('name', ''))} {device.get('id', '')}  ·  {self.client.account.get('username', '')}\n {title}  ·  {STATES.get(chat.get('state', ''), '')}"

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
        self.transcript.buffer.set_document(Document(text, len(text) if at_end else min(old_position, len(text))), bypass_readonly=True)
        self.sidebar.text = "\n\n".join(
            ("● " if self.chat and self.chat["id"] == entry["id"] else "  ")
            + entry["id"] + "\n" + entry["title"] for entry in self.chats
        ) or "暂无对话\n\n/new 新建"
        if self.list_cursor is not None:
            self.sidebar.text += "\n\n/more 下一页"
        self.application.invalidate()

    def require_chat(self) -> str:
        if not self.chat:
            raise Error("chat_required", "先输入 /new 新建对话，或 /resume t1 选择已有对话。")
        return str(self.chat["id"])

    @property
    def unsent(self) -> Json | None:
        return self.pending_sends.get(str(self.chat["id"])) if self.chat else None

    async def refresh_list(self, after: int = 0) -> None:
        result = await self.client.action("list", device_id=self.client.device["id"], after=after, limit=100)
        self.chats = result["chats"]
        self.list_cursor = result["next_cursor"]
        self.render()

    async def open(self, chat_id: str) -> None:
        async with self.refreshing:
            result = await self.client.action("history", chat_id=chat_id, limit=50)
            if self.chat:
                self.draft_attachments[str(self.chat["id"])] = self.attachments
            self.chat = result["chat"]
            self.messages = {int(m["sequence"]): m for m in result["messages"]}
            self.cursor = int(result["next_cursor"])
            self.first_cursor = int(result.get("first_cursor", 0))
            self.has_older = bool(result.get("has_older", False))
            self.attachments = self.draft_attachments.setdefault(chat_id, [])
            self.notes.clear()
            self.notice = "已打开 " + chat_id + "。/connect 查看模型连接指令。"
            await self.refresh_list()
            self.render()

    async def poll(self) -> None:
        while True:
            await asyncio.sleep(2)
            if not self.chat:
                continue
            try:
                async with self.refreshing:
                    # Include recent rows so host-delivery/reply status changes are reflected.
                    result = await self.client.action("history", chat_id=self.chat["id"], after=max(0, self.cursor - 20), limit=50)
                    self.chat = result["chat"]
                    self.messages.update({int(m["sequence"]): m for m in result["messages"]})
                    self.cursor = max(self.cursor, int(result["next_cursor"]))
                    if self.network_error:
                        self.network_error = False
                        self.notice = "连接已恢复。"
                    self.render()
            except (Error, httpx2.HTTPError, OSError) as exc:
                self.network_error = True
                self.notice = str(exc)
                self.application.invalidate()

    async def send(self, body: Json) -> None:
        chat_id = str(body["chat_id"])
        pending = self.pending_sends.get(chat_id)
        if pending and body["request_key"] != pending["request_key"]:
            raise Error("chat_pending", "上一条消息的发送结果尚未确认，请先使用 /retry。")
        self.pending_sends[chat_id] = body
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
        elif name == "/list":
            await self.refresh_list()
            self.notice = "使用 /resume t1 打开对话，或 /new 新建。"
        elif name == "/more":
            if self.list_cursor is None:
                self.notice = "已经是最后一页对话。"
            else:
                await self.refresh_list(self.list_cursor)
        elif name == "/new":
            result = await self.client.action("create", device_id=self.client.device["id"],
                title=argument or "新的对话", request_key=secrets.token_hex(12))
            await self.open(result["chat"]["id"])
        elif name == "/resume":
            await self.open(argument)
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
            self.note(f"在 Work 或 Dot 启用 Computer Bridge 后发送：\n连接对话 {chat_id} 并订阅新消息，收到后在这里回复。\n已被其他模型对话使用时会显示占用，不会替换原连接。")
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
            await self.refresh_list()
            if self.resume:
                await self.open(self.resume)
            elif not self.chats:
                await self.command("/new", "")
            else:
                self.notice = "使用 /resume t1 打开对话，或 /new 新建。"
            self.application.create_background_task(self.poll())
        except (Error, OSError, httpx2.HTTPError) as exc:
            self.notice = str(exc)
            self.application.invalidate()

    async def run(self) -> None:
        def start() -> None:
            self.application.create_background_task(self.initialize())
        await self.application.run_async(pre_run=start)


async def run(config: Path, resume: str | None = None, *, browser: bool = True, login: bool = False) -> None:
    async with ChatClient(config) as client:
        await client.connect(browser=browser, login=login)
        terminal = ChatTerminal(client, resume)
        with contextlib.suppress(EOFError, KeyboardInterrupt):
            await terminal.run()
