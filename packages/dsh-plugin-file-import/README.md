# @e-mate/dsh-plugin-file-import

将本机普通文件导入当前会话绑定的 Workspace，并通过 `dsh-at-file` 的现有 `@相对路径` 合同交给 Agent。

- 仅 loopback 可用；远程 Web 客户端失败关闭。
- 只允许办公文档、PDF、文本/结构化数据和常见归档；拒绝脚本、可执行文件、安装包和目录。
- 文件原子写入当前 Workspace 的 `.e-mate/imports/`，不覆盖既有文件。
- 浏览器只得到真实文件名、MIME、字节数和 Workspace 相对路径；不会得到本地绝对路径或摘要 ID。
- UI 的“导入中 / 已就绪 / 失败”只来自真实 RPC 生命周期，不建立第二套 Store、Router 或聊天传输。
