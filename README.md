# e-Mate

e-Mate 2.0.15 是基于固定 DeepSeek Harness `0.1.0-rc.7` 与 `deepseek-harness-desktop` 原生生命周期封装的桌面 Agent 工作区。Harness 继续拥有 Agent Loop、会话、事件、工具、审批、Jobs、插件与本地数据；e-Mate 只在这些原生扩展面上提供产品 Profile、企业鉴权、模型策略和异步脱敏审计。

> 仓库第一准则见 [`AGENTS.md`](AGENTS.md)，当前边界见 [`docs/target-contract.md`](docs/target-contract.md)。官方下载页只指向已通过安装与公开回读的正式字节。

## 下载与安装

正式激活后从 [e-Mate 官方下载页](https://dl.ecoremedia.net/e-mate/update/) 获取安装包：

- macOS 13+，Universal（Apple 芯片与 Intel Mac）。
- Windows 10/11 x64。
- Linux 不属于 2.0.15 正式支持范围。

用户不需要安装 Node.js、npm、pnpm、Python、Electron、Xcode、MSVC 或 Rust。2.0.15 的正式 macOS 和 Windows 包均为未签名发布；只应使用官方下载页展示的不可变 R2 地址并核对 SHA-256。macOS 首次安装按下载页的“未签名安装图解”将 e-Mate 拖入“应用程序”，再通过 Control 点按选择“打开”；页面同时提供只针对 `/Applications/e-Mate.app` 的备用命令。应用不会关闭 Gatekeeper，也不会伪装 Developer ID 或公证状态。

浏览器自动化由 `@e-mate/dsh-plugin-cdp` 连接用户已有 Chrome。它不安装扩展，不需要 `chrome://extensions`、开发者模式或“加载已解压”；首次使用只需按 Chrome 自身安全要求开启远程调试，并选择明确的本机 CDP 目标。

## 更新方式

安装后，用户可点击托盘“检查更新”，也可直接对 Agent 说“检查更新”或“更新 e-Mate”。自然语言入口只调用 `desktopUpdates.runInteractiveUpdate()`，与后台和托盘共用 dsh-desktop 的同一个 lifecycle，不持有 URL、下载、安装、替换或回滚逻辑。

原生 lifecycle 只接受严格更高的稳定版本。用户确认后，macOS 下载并打开未签名 DMG，由用户覆盖安装；Windows 启动同一个 assisted NSIS 安装器完成全新安装或覆盖安装，并有序退出当前应用。2.0.13 和已有同版本旧 2.0.15 仍从官方下载页手动迁移，客户端不会为同版本不同字节伪造在线更新。

## 插件与权限边界

- `danger-full-access` 只表示 pinned DSH sandbox 定义的文件效果范围，不等于 macOS TCC、Computer Use 应用 lease、CDP 目标授权、凭据、Skill 安装或 MCP 持久进程授权。
- `approval/policy: never` 表示需要 `ctx.approval` 的操作被拒绝，不表示自动同意。
- Computer Use 只接受插件设置中的 `allowAllApps`、精确应用 grant，或原生交互 lease；e-Mate 不把 Full Access 映射为全应用授权。
- `find-skill` 只负责发现。Skill 的安装、更新、启用、禁用、卸载、上传和删除统一由 Skill Hub 的版本/SHA/WAL 事务处理。
- 企业管理端负责鉴权、受管模型/搜索策略、有界凭据租约与异步脱敏审计，不得控制本地插件、工具审批、会话、Job 或执行。
- 管理员可在模型路由页手动发起一次最小真实联通测试：文本路由仅请求 32 Token 的固定回复，图片路由仅生成固定橙色方块。请求只经同源 Model Gateway 的短期管理会话，计入配额与脱敏审计，不传入 Tool schema、不暴露上游 Key、不保存生成内容，也不调用本地 Harness。

## 开发与发布

Harness 输入继续使用 Node 24.x 与精确 `pnpm@11.7.0`。桌面封装只使用 dsh-desktop 的 Yarn workspace 命令：

```bash
corepack yarn --cwd desktop install --immutable
corepack yarn --cwd desktop dist:mac
corepack yarn --cwd desktop dist:win
```

macOS 在本机原生构建，Windows 只在已登录的 Codex Remote Windows 机器上原生构建，不经 SSH。两个安装包完成安装、覆盖和启动验收后，按 dsh-desktop 固定版本端点与固定平台下载端点发布；版本对象最后激活。仓库不再保留 schema-2、Profile 热更新、二次签名或另一套 Desktop 发布器。
