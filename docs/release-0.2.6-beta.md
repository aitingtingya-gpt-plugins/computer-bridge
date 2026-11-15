# Computer Bridge 0.2.6-beta

在 0.2.6-alpha 基础上新增客户端 `/update` 与 `cs update` 自更新能力，完善普通 Chat 目标、计划、模式切换与方案审阅交互，并增强 Markdown 与终端数学排版兼容及消息状态体验。

## 主要变化

- **客户端自更新（`/update` 与 `cs update`）**：支持在终端聊天输入 `/update [stable | beta | alpha]` 或直接在命令行运行 `cs update` / `closesi update`（含 `--stable`、`--beta`、`--alpha`、`--check`、`--repo`、`-y`），从 GitHub Release 检查兼容更新、下载并校验发布清单，经隔离环境构建与接力交接后重启进入新版本。
- **普通 Chat 目标、计划与模式切换**：支持 `/goal` 持续目标管理、`/plan` 发起规划和审阅，终端输入框支持 `Shift+Tab` 循环切换普通、计划和自动模式；按 `F6` 领取未指定入口的审批或定位当前对话的待审项。
- **终端与网页方案审阅交互优化**：统一审阅区域背景色与焦点导航，`3. 拒绝并要求修改` 支持 `Enter` 或鼠标点击进入多行理由输入框（`Shift+Enter` / `Ctrl+J` 换行、`Esc` 返回选择、`Enter` 确认提交），交互完成后完整保留并跟踪展示最新方案记录；同时优化普通 Chat 临时 403 自动退避重试与状态提示。
- **Markdown 与公式排版增强**：新增 CJK 友好加粗/斜体解析、任务列表（tasklist）、脚注及删除线渲染支持，进一步完善终端二维公式与网页富文本显示。
- **跨会话通知与文件传输完善**：网页与终端 `/new`、`/connect`、`/disconnect` 仅在 1 分钟未检测到宿主生效时显示延迟兜底提醒，生效后自动关闭；`/delete` 直接确认会话已删除并在后台清理订阅，同步改进回调诊断与文件传输细节。

## 升级与文档

安装与升级可通过终端 `/update`、`cs update` 或 GitHub Release 提供的 `computer-bridge-0.2.6-beta-install.zip`、服务端、Windows、Mac 与可选模块资源完成。升级服务端和电脑端后，刷新 `/chat` 网页、重启旧 `cs` / `closesi` 终端，并在宿主刷新 Computer Bridge MCP 工具与事件目录。

使用说明见[双向聊天](chat.md)、[终端聊天](chat-terminal.md)、[Chat 与 Super Agent](chat-modes.md)及[大上下文与语义摘要](chat-context.md)。
