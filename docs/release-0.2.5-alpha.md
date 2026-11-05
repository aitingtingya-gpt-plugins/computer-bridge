# Computer Bridge 0.2.5-alpha

新增双向聊天：终端运行 `computer-bridge chat`，或在服务端 `/chat` 页面选择电脑，与已连接的 Work／Dot 对话交流。

- 对话使用 `t1`、`t2` 递增短 ID，标题独立修改；恢复时保留原始消息及附件。
- 同一对话只允许一个活动模型端，其他连接会显示“该对话正在被使用”。网页与终端可同时使用。
- 通过标准 MCP Events 传递新消息，支持签名验证、持久订阅、去重和失败重试；无需挂起命令。普通 Chat 不提供事件唤醒。
- 新增 `chat.list`、`chat.create`、`chat.resume`、`chat.history`、`chat.reply`、`chat.attachment`、`chat.disconnect`。
- 文字、图片与文件附件支持分块传输及 SHA256；聊天记录和主动发送的附件保存在服务端，电脑工具保持原来的数据位置与权限。
- 服务端更新后，需要在宿主刷新插件工具及事件目录。

使用步骤见[双向聊天](chat.md)及[终端聊天](chat-terminal.md)。安装包包含服务端、Windows、Mac 三部分，部署地址由使用者自行填写。
