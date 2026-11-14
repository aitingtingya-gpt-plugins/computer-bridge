"""One command catalogue for terminal help and interactive completion."""

import asyncio
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from prompt_toolkit.buffer import Buffer
from prompt_toolkit.completion import CompleteEvent, Completer, Completion
from prompt_toolkit.document import Document


@dataclass(frozen=True)
class Command:
    name: str
    arguments: str
    description: str
    required: bool = False
    modes: frozenset[str] = frozenset({"chat", "super_agent"})

    @property
    def usage(self) -> str:
        return self.name + (" " + self.arguments if self.arguments else "")


# Conversation actions first, then setup/account management and exit.
COMMANDS = (
    Command("/quote", "[消息 ID | cancel]", "引用 dot 消息或取消引用"),
    Command("/resume", "[对话 ID]", "按名称选择历史对话"),
    Command("/new", "[标题]", "选择 Chat / Super Agent 并新建对话"),
    Command("/tasks", "", "Super Agent：查看任务", modes=frozenset({"super_agent"})),
    Command("/task", "任务 ID [内容]", "Super Agent：查看或定向跟进任务", True, modes=frozenset({"super_agent"})),
    Command("/task-new", "任务内容", "Super Agent：新建任务", True, modes=frozenset({"super_agent"})),
    Command("/cancel", "任务 ID", "Super Agent：取消后续工作", True, modes=frozenset({"super_agent"})),
    Command("/retry", "任务 ID", "Super Agent：明确重试任务", True, modes=frozenset({"super_agent"})),
    Command("/pause", "", "Super Agent：暂停调度", modes=frozenset({"super_agent"})),
    Command("/task-resume", "", "Super Agent：恢复调度", modes=frozenset({"super_agent"})),
    Command("/read", "附件 ID", "查看文本附件，例如 a1", True),
    Command("/download", "附件 ID [路径]", "下载附件并校验 SHA256", True),
    Command("/math", "[消息 ID]", "选择科研公式并打开本机完整排版"),
    Command("/export", "", "下载完整会话与附件为 ZIP"),
    Command("/title", "新标题", "修改当前对话标题", True),
    Command("/help", "", "显示命令帮助"),
    Command("/connect", "", "通知 Dot 连接当前对话"),
    Command("/disconnect", "", "通知 Dot 暂停当前对话的事件订阅"),
    Command("/computers", "", "选择新对话使用的电脑"),
    Command("/workspaces", "", "管理这台电脑的工作区"),
    Command("/permissions", "", "管理这台电脑的完全访问和工具权限"),
    Command("/theme", "", "选择终端主题"),
    Command("/login", "", "登录账号，访问账号授权的电脑"),
    Command("/logout", "", "返回本机身份"),
    Command("/delete", "", "删除当前对话及其服务器附件"),
    Command("/quit", "", "退出终端，保留模型连接（别名 /exit；快捷 /q、/e）"),
)
BY_NAME = {command.name: command for command in COMMANDS}
# Short exit aliases must work even before asynchronous completion opens, or
# after Esc dismisses the menu. Keep aliases out of the full command catalogue.
BY_NAME.update({name: BY_NAME["/quit"] for name in ("/exit", "/q", "/e", "/quite")})
HELP_KEYS = (
    "\n\n/ 命令菜单 · ↑/↓ 选择 · Tab 补全 · Enter 使用 · Esc 关闭"
    "\n弹窗按底部提示操作 · Tab/Shift+Tab 切换焦点 · Esc 关闭提示或取消表单"
    "\n表单 ↑/↓ 切字段；多行框内移动光标，首末显示行切出 · ←/→ 编辑文字或切换按钮"
    "\nEnter 发送 · Shift+Enter 换行（Ctrl+J 备用）· Ctrl+Y 粘贴系统剪贴板文件/图片/文字"
    "\nShift+方向键 选择文字（↑/↓ 按可视行）· F4 清空输入框（Mac 可能需 Fn+F4，可撤销）"
    "\n选中文字后 Ctrl+C / Ctrl+Insert 复制 · 右键打开系统复制／粘贴菜单"
    "\nMac 右键打开复制菜单 · Esc 或点击外部取消"
    "\nPageUp/PageDown 滚动 · Ctrl+Q 退出\n"
)


def commands_for_mode(mode: str | None = "chat") -> tuple[Command, ...]:
    # Missing mode is a legacy Chat conversation; unknown modes must not expose
    # task controls. Resolve this at use time, not when the terminal is created.
    current = "super_agent" if mode == "super_agent" else "chat"
    return tuple(command for command in COMMANDS if current in command.modes)


def help_for_mode(mode: str | None = "chat") -> str:
    return "\n".join(command.usage + "  ·  " + command.description
                     for command in commands_for_mode(mode)) + HELP_KEYS


# Safe default for older consumers; active terminals use help_for_mode instead.
HELP = help_for_mode()


class CommandCompleter(Completer):
    def __init__(self, mode: Callable[[], str | None] | None = None):
        self.mode = mode or (lambda: "chat")

    def get_completions(self, document: Document, complete_event: CompleteEvent) -> Iterable[Completion]:
        prefix = document.text
        if not document.is_cursor_at_the_end or not prefix.startswith("/") or any(c.isspace() for c in prefix):
            return
        commands = commands_for_mode(self.mode())
        preferred = {"/q": "/quit", "/e": "/quit"}.get(prefix.lower())
        if preferred:
            commands = tuple(sorted(commands, key=lambda command: command.name != preferred))
        for command in commands:
            if (command.name.startswith(prefix.lower())
                    or command.name == "/quit" and "/exit".startswith(prefix.lower())):
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
