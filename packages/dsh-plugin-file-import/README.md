# @e-mate/dsh-plugin-file-import

将本机普通文件导入当前会话绑定的 Workspace，并通过 `dsh-at-file` 的现有 `@相对路径` 合同交给 Agent。

- 仅 loopback 可用；远程 Web 客户端失败关闭。
- 支持 `ALLOWED_MEDIA_BY_EXTENSION` 当前列出的办公文档、PDF、文本/结构化数据、ODF 和常见归档；拒绝未知、脚本、可执行文件、安装包和目录，不宣称支持任意扩展名。
- 普通文件只按 NFC 规范化后的扩展名决定 canonical MIME，不信任 Browser MIME，也不为某一种文件类型建立单独路径或协议；零字节文件受支持。
- 每次最多 8 个文件，单文件最多 16 MiB、总计最多 32 MiB；文件名保留跨平台、隐藏名、设备名和 160-byte 检查。
- 文件原子写入当前 Workspace 的 `.e-mate/imports/`，同名文件安全加后缀，批次失败时回滚且不覆盖既有文件。
- 浏览器只得到规范化文件名、canonical MIME、字节数和 Workspace 相对路径；不会得到本地绝对路径或摘要 ID。
- 预期校验返回 pinned rc.7 `bad-request`；意外 Host 异常返回固定 `internal` 文案。客户端严格解析结果，仅显示 allowlist 内有界业务校验文案，其余 RPC、transport、Zod 或未知失败统一显示固定安全中文。
- UI 的“导入中 / 已就绪 / 失败”只来自真实 RPC 生命周期，不建立第二套 Store、Router 或聊天传输；图片继续走 native draft 与 Attachment CAS。
