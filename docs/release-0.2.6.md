# Computer Bridge 0.2.6

正式发布 `0.2.6`，在 `0.2.6-beta` 基础上新增 Super Agent 主从分工发送者识别与动态更新兼容，并修复 Windows 终端 TUI `Shift+Enter` 换行体验。

## 主要变化

- **Super Agent 发送者分工显示与动态更新**：Super Agent 对话中区分总协调回复／全局斜杠命令（`Master`）与具体任务回复／斜杠命令／结果投递（`任务 · <任务短名>`）；任务重命名时通过统一投影与增量同步动态刷新历史消息发送者；兼容历史消息回溯归因，未归因或无法关联到具体任务的历史助手消息统一兼容显示为 `Master`，普通 Chat 对话保持 `GPT / Dot`。
- **Windows TUI `Shift+Enter` 换行与终端命令入口修复**：为支持 VT 的 Windows 终端输出开启与关闭 `win32-input-mode`（`\x1b[?9001h` / `\x1b[?9001l`），并在本地非远程终端下为独立裸回车按键补充 `Shift` 修饰键兜底恢复，同时保持多行粘贴、组合键、`macOS` 与其他按键行为不变；同步移除 `cs.cmd` / `closesi.cmd` 的 `chcp` 切换以避免 Windows ConPTY 清屏，并将执行入口放入括号块以保护自更新重写与退出码传递。

- **终端启动看板**：显示身份、设备、最近会话和版本信息；登录后列账户设备，未登录只显示本机。更新检查在后台重试，总时限为 60 秒，不自动安装。

## 升级与文档

安装与升级可通过终端 `/update`、`cs update` 或 GitHub Release 提供的 `computer-bridge-0.2.6-install.zip`、服务端、Windows、Mac 与可选模块资源完成。升级服务端和电脑端后，刷新 `/chat` 网页、重启旧 `cs` / `closesi` 终端，并在宿主刷新 Computer Bridge MCP 工具与事件目录。

使用说明见[双向聊天](chat.md)、[终端聊天](chat-terminal.md)、[Chat 与 Super Agent](chat-modes.md)及[大上下文与语义摘要](chat-context.md)。
