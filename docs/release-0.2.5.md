# Computer Bridge 0.2.5

- 网页和终端新增 `/permissions` 与 `/workspaces`，可管理所选电脑的权限与目录。
- 每个工具可设为直接允许、使用前确认或禁止调用，规则独立于完全访问。审批可使用宿主弹窗或同一电脑的指定聊天，批准只作用于本次调用。
- 终端可在正文前、中、后拖入文件，也可用 Ctrl+Y 粘贴剪贴板中的文件和图片。输入区显示附件标记，发送原文件及正文。
- 终端支持拖选复制：右键复制，Windows 有选区时可用 Ctrl+C，Mac 可按 F2 后用终端原生选取及 ⌘C。

升级服务端和电脑端后，刷新网页并重新启动 `cs`。在宿主刷新 MCP 工具目录后，可选择审批位置。

使用说明见[双向聊天](chat.md)和[终端聊天](chat-terminal.md)。

## 大文件和兼容性修复

- 新增独立 HTTP 大文件传输，支持持久化断点、校验和及原子提交；上传片段按固定大小合并，减少远程写入次数。
- helper 使用真实产品标识，区分 DNS、TLS、连接和超时错误。默认不读取环境代理；需要代理时显式指定可信代理，保留 TLS 验证和拒绝跳转。
- 修复 Windows patch 受 Git 全局换行设置影响的问题，不修改用户全局 Git 配置。
- Mac、Windows 已完成双向 96MiB 上传和下载的换进程续传、最终 SHA256 与重复提交验收。

## 已知限制

Windows 原生拖放仅在 Windows Terminal 中接收允许复制的普通文件路径。虚拟文件、远程桌面提供的拖放格式及特定终端环境尚未完成全面兼容性验证；出现禁用指针不代表已确认是远控软件问题。可使用附件选择或支持的剪贴板文件粘贴方式。

## Dependency security updates

Updated fflate to 0.8.3, undici to 8.12.4, and zod to 4.6.7 to address published security advisories. Original vendored DSH source files remain unchanged.
