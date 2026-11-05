"""One command catalogue for terminal help and interactive completion."""

from collections.abc import Iterable
from dataclasses import dataclass

from prompt_toolkit.completion import CompleteEvent, Completer, Completion
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
    Command("/approve", "", "查看当前电脑的待审批命令"),
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
