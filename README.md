# e-Mate

e-Mate 2.0.15 是基于固定 DeepSeek Harness `0.1.0-rc.7` 与 `deepseek-harness-desktop` 原生生命周期封装的桌面 Agent 工作区。Harness 继续拥有 Agent Loop、会话、事件、工具、审批、Jobs、插件与本地数据；e-Mate 只在这些原生扩展面上提供产品 Profile、企业鉴权、模型策略和异步脱敏审计。

> 2.0.15 的实时记录见 [`docs/development-log.md`](docs/development-log.md)，不可越界项见 [`docs/target-contract.md`](docs/target-contract.md)。官方下载页只指向已通过安装与公开回读的正式字节。

## 下载与安装

正式激活后从 [e-Mate 官方下载页](https://dl.ecoremedia.net/e-mate/update/) 获取由版本专属签名清单绑定、并展示精确 SHA-256 的安装包：

- macOS 13+，Universal（Apple 芯片与 Intel Mac）。
- Windows 10/11 x64。
- Linux 不属于 2.0.15 正式支持范围。

用户不需要安装 Node.js、npm、pnpm、Python、Electron、Xcode、MSVC 或 Rust。2.0.15 的正式 macOS 和 Windows 包均为未签名发布；只应使用官方下载页展示的不可变 R2 地址并核对 SHA-256。macOS 首次安装按下载页的“未签名安装图解”将 e-Mate 拖入“应用程序”，再通过 Control 点按选择“打开”；页面同时提供只针对 `/Applications/e-Mate.app` 的备用命令。应用不会关闭 Gatekeeper，也不会伪装 Developer ID 或公证状态。

浏览器自动化由 `@e-mate/dsh-plugin-cdp` 连接用户已有 Chrome。它不安装扩展，不需要 `chrome://extensions`、开发者模式或“加载已解压”；首次使用只需按 Chrome 自身安全要求开启远程调试，并选择明确的本机 CDP 目标。

## 更新方式

安装 2.0.15 后，用户可在设置页手动检查更新，也可直接对 Agent 说“检查更新”或“更新 e-Mate”。设置页复用现有原生桥接，Agent 自然语言只调用类型化的 `e_mate_desktop_update` Tool；两者最终进入同一个 `desktopUpdates.runInteractiveUpdate` 服务。在线更新只接受严格高于当前版本的稳定 SemVer（2.0.16+）：

1. 验证 canonical Cloudflare R2 上的签名 schema-2 清单、目标版本和当前平台安装包；
2. 在原生确认框展示版本与下载字节，并下载清单绑定的真实安装包；
3. 安装包落盘后重新校验字节数、SHA-256、签名清单和清单身份；
4. macOS 原位替换 `/Applications/e-Mate.app`，Windows 原位替换现有安装目录，并从同一路径重启；
5. 健康提交后删除事务内部的旧版回滚备份，只保留一个应用和一套桌面/开始菜单快捷方式；失败则由同一事务恢复旧版。

2.0.13 和已有同版本旧 2.0.15 使用官方下载页手动迁移；客户端不会为同版本不同字节伪造在线更新。兼容的 Profile 增量仍由同一个更新服务按签名 generation 合同处理，不会创建第二个 updater、Feed 或安装路径。

## 插件与权限边界

- `danger-full-access` 只表示 pinned DSH sandbox 定义的文件效果范围，不等于 macOS TCC、Computer Use 应用 lease、CDP 目标授权、凭据、Skill 安装或 MCP 持久进程授权。
- `approval/policy: never` 表示需要 `ctx.approval` 的操作被拒绝，不表示自动同意。
- Computer Use 只接受插件设置中的 `allowAllApps`、精确应用 grant，或原生交互 lease；e-Mate 不把 Full Access 映射为全应用授权。
- `find-skill` 只负责发现。Skill 的安装、更新、启用、禁用、卸载、上传和删除统一由 Skill Hub 的版本/SHA/WAL 事务处理。
- 企业管理端负责鉴权、受管模型/搜索策略、有界凭据租约与异步脱敏审计，不得控制本地插件、工具审批、会话、Job 或执行。
- 管理员可在模型路由页手动发起一次最小真实联通测试：文本路由仅请求 32 Token 的固定回复，图片路由仅生成固定橙色方块。请求只经同源 Model Gateway 的短期管理会话，计入配额与脱敏审计，不传入 Tool schema、不暴露上游 Key、不保存生成内容，也不调用本地 Harness。

## 开发与发布

仓库唯一的本地测试、构建、验收和发布入口是独立 Node 24.x 承载的精确 `pnpm@11.7.0`：

```bash
corepack pnpm flow dev
corepack pnpm flow candidate
corepack pnpm flow verify --run <run-id>
corepack pnpm flow publish --run <run-id>
```

开发期先运行变更 Owner 的聚焦检查或 `flow dev`。冻结一个精确、干净的提交后只运行一次 `flow candidate`；同一 run 复用原始 macOS/Windows 字节继续 `verify` 和 `publish`，不得因单个修复反复重建。Windows 构建只执行 candidate 请求中给出的同一条 `_platform-build` 命令；传输优先 `win-codex` SSH，只有该线路不可用时才使用已授权 Codex Remote。

安装器下载、在线更新、回滚和发布数据面只使用 canonical Cloudflare R2。`flow publish` 复用 candidate 的原始字节，完成不可变对象上传与完整公开回读后，才通过既有 schema-2 签名 Owner 和 CAS 激活 `desktop/signed/latest.json`；`desktop/latest.json` 保持不变。GitHub CI、裸 `pnpm`、直接执行 `scripts/local-flow.mjs`、第二个发布器和重建后的替代字节都不是发布路径。
