"""One command catalogue for terminal help and interactive completion."""

import asyncio
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from prompt_toolkit.completion import CompleteEvent, Completer, Completion
from prompt_toolkit.buffer import Buffer
from prompt_toolkit.document import Document


@dataclass(frozen=True)
class Command:
    name: str
    arguments: str
    description: str
    required: bool = False

    @property
    def usage(self) -> str:
        return self.name + (" " + self.arguments if self.arguments else "")


COMMANDS = (
    Command("/resume", "[对话 ID]", "按名称选择历史对话"),
    Command("/new", "[标题]", "新建对话"),
    Command("/attach", "文件路径", "添加附件，支持含空格的路径", True),
    Command("/unattach", "", "清空待发送附件"),
    Command("/computers", "", "选择新对话使用的电脑"),
    Command("/login", "", "登录账号，访问账号授权的电脑"),
    Command("/logout", "", "返回本机身份"),
    Command("/title", "新标题", "修改当前对话标题", True),
    Command("/history", "", "读取更早的消息"),
    Command("/read", "附件 ID", "查看文本附件，例如 a1", True),
    Command("/download", "附件 ID [路径]", "下载附件并校验 SHA256", True),
    Command("/connect", "", "获取连接 ID 和模型连接步骤"),
    Command("/timing", "[消息 ID]", "查看消息投递分段耗时"),
    Command("/retry", "", "确认上一条消息的发送结果"),
    Command("/help", "", "显示命令帮助"),
    Command("/quit", "", "退出终端，保留模型连接"),
)
BY_NAME = {command.name: command for command in COMMANDS}
HELP = "\n".join(command.usage + "  ·  " + command.description for command in COMMANDS) + (
    "\n\n/ 命令菜单 · ↑/↓ 选择 · Tab 补全 · Enter 使用 · Esc 关闭"
    "\nEnter 发送 · Alt+Enter 换行 · PageUp/PageDown 滚动 · Ctrl+Q 退出\n"
)


class CommandCompleter(Completer):
    def get_completions(self, document: Document, complete_event: CompleteEvent) -> Iterable[Completion]:
        prefix = document.text
        if not document.is_cursor_at_the_end or not prefix.startswith("/") or any(c.isspace() for c in prefix):
            return
        for command in COMMANDS:
            if command.name.startswith(prefix.lower()):
                yield Completion(command.name, start_position=-len(prefix), display=command.usage,
                                 display_meta=command.description)


class SlashMenu:
    """Refresh for any edit; selecting or dismissing a menu is not a new edit."""

    def __init__(self, buffer: Buffer, focused: Callable[[], bool]):
        self.buffer, self.focused = buffer, focused
        self.suspended = False
        self.pending: asyncio.Handle | None = None
        buffer.on_text_changed += self.changed

    def changed(self, buffer: Buffer) -> None:
        if self.suspended:
            return
        if self.pending:
            self.pending.cancel()
        self.pending = asyncio.get_running_loop().call_soon(self.refresh)

    def refresh(self) -> None:
        self.pending = None
        document = self.buffer.document
        if (self.focused() and document.is_cursor_at_the_end and document.text.startswith("/")
                and not any(character.isspace() for character in document.text)):
            self.buffer.start_completion(select_first=False)

    @contextmanager
    def selecting(self) -> Iterator[None]:
        if self.pending:
            self.pending.cancel()
            self.pending = None
        self.suspended = True
        try:
            yield
        finally:
            self.suspended = False

    def close(self) -> None:
        with self.selecting():
            self.buffer.cancel_completion()
