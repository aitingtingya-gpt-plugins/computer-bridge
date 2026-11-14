# Computer Bridge 0.2.6-alpha

新增 Super Agent 会话模式与可选只读仓库绑定、三层长上下文与真实语义摘要维护、`chat.channel` 跨会话统一插件通知通道，以及持久化终端登录和网页记住登录。保留普通 Chat、`computer.*` 文件/命令工具、权限隔离及大文件断点续传。

## 主要变化

- **双模式会话（Chat / Super Agent）**：新建会话可在网页弹窗、终端 `/new` 与 MCP `chat.create` 选择 `chat` 或 `super_agent`（默认 `chat`，创建后不切换）。`Super Agent` 复用固定上游源码与角色提示词，通过 `chat.task` 上报决策与执行进度，并支持可选只读绑定单个 GitHub 或 CNB 仓库（`chat.repository`）。
- **长上下文与真实语义摘要**：Chat 与 Super Agent 均支持完整消息上下文和无损 `.txt` 附件回退（`payload_version=2`）；普通 Chat 新增 `chat.working_context`、`chat.maintenance` 与 `chat.trace`，支持超过 400,000 参考 token 或闲置十分钟后触发宿主语义摘要维护与时间线状态展示。
- **跨会话插件通知通道（`chat.channel`）**：在插件级建立统一通知通道。网页与终端 `/new`、`/connect`、`/disconnect`、`/delete` 会通过 `chat.channel` 通知 Dot 接入、暂停或永久退订并清理已删除会话，遇瞬态/403 投递失败支持后台退避重试（含删除后的载荷快照重投）。对 `/new`、`/connect`、`/disconnect` 增加 1 分钟未生效延迟兜底弹窗提醒，并在期间生效时自动关闭弹窗；`/delete` 直接展示删除反馈，不弹出旧框或倒计时提醒。
- **登录会话持久化**：终端 `/login` 账号登录支持重启恢复并可用 `/logout` 返回本机身份；网页登录支持勾选「保持登录（30 天）」。

## 升级与文档

安装与升级通过 GitHub Release 提供 `computer-bridge-0.2.6-alpha-install.zip`、服务端、Windows、Mac 与可选模块资源。升级服务端和电脑端后，刷新 `/chat` 网页、重启旧 `cs` / `closesi` 终端，并在宿主刷新 Computer Bridge MCP 工具与事件目录。

使用说明见[双向聊天](chat.md)、[终端聊天](chat-terminal.md)、[Chat 与 Super Agent](chat-modes.md)及[大上下文与语义摘要](chat-context.md)。
