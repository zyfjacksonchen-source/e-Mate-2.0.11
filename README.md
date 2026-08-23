# e-Mate

e-Mate 2.0.12 是基于固定 DeepSeek Harness `0.1.0-rc.7` 与 `deepseek-harness-desktop` 原生生命周期封装的桌面 Agent 工作区。Harness 继续拥有 Agent Loop、会话、事件、工具、审批、Jobs、插件与本地数据；e-Mate 只在这些原生扩展面上提供产品 Profile、企业鉴权、模型策略和异步脱敏审计。

> 当前仓库仍处于 2.0.12 正式发布前验收阶段。稳定 R2 下载入口在 exact-main 安装器、完整 Profile generation、性能、真实 Computer Use、企业链路和公开回读全部通过前继续保留 2.0.11，不会提前指向候选字节。实时记录见 [`docs/development-log.md`](docs/development-log.md)，不可越界项见 [`docs/target-contract.md`](docs/target-contract.md)。

## 下载与安装

正式激活后从 [e-Mate 官方下载页](https://dl.ecoremedia.net/e-mate/update/) 获取与 `desktop/latest.json` 同源、同 SHA-256 的安装包：

- macOS 13+，Universal（Apple 芯片与 Intel Mac）。
- Windows 10/11 x64。
- Linux 不属于 2.0.12 正式支持范围。

用户不需要安装 Node.js、npm、pnpm、Python、Electron、Xcode、MSVC 或 Rust。2.0.12 的正式 macOS 和 Windows 包均为未签名发布；只应使用官方下载页展示的不可变 R2 地址并核对 SHA-256。macOS 首次安装按下载页的“未签名安装图解”将 e-Mate 拖入“应用程序”，再通过 Control 点按选择“打开”；页面同时提供只针对 `/Applications/e-Mate.app` 的备用命令。应用不会关闭 Gatekeeper，也不会伪装 Developer ID 或公证状态。

浏览器自动化由 `@e-mate/dsh-plugin-cdp` 连接用户已有 Chrome。它不安装扩展，不需要 `chrome://extensions`、开发者模式或“加载已解压”；首次使用只需按 Chrome 自身安全要求开启远程调试，并选择明确的本机 CDP 目标。

## 更新方式

安装 2.0.12 Base 后，用户可直接对 Agent 说“检查更新”“更新插件”或“更新 e-Mate”。自然语言只调用类型化的 `e_mate_desktop_update` Tool，并委托同一个 Desktop 更新服务：

1. 验证签名的当前平台 desired state 与 Base/Harness 兼容合同；
2. 在原生确认框展示版本、变化组件和下载字节；
3. 只下载缺失的内容寻址组件；
4. 组装完整 inactive Profile generation，原子切换并重启；
5. Renderer 健康后提交，失败自动恢复上一 generation。

普通插件源码或依赖变化不重建 DMG/EXE，也不重测无关组件。Harness/Desktop API、权限、原生 helper、更新器、共享依赖、签名或不兼容 ABI 变化才进入 Base lane。rc.7-only 插件不会混装到 rc.6 Base；客户端在下载前返回 `base-required`。

## 插件与权限边界

- `danger-full-access` 只表示 pinned DSH sandbox 定义的文件效果范围，不等于 macOS TCC、Computer Use 应用 lease、CDP 目标授权、凭据、Skill 安装或 MCP 持久进程授权。
- `approval/policy: never` 表示需要 `ctx.approval` 的操作被拒绝，不表示自动同意。
- Computer Use 只接受插件设置中的 `allowAllApps`、精确应用 grant，或原生交互 lease；e-Mate 不把 Full Access 映射为全应用授权。
- `find-skill` 只负责发现。Skill 的安装、更新、启用、禁用、卸载、上传和删除统一由 Skill Hub 的版本/SHA/WAL 事务处理。
- 企业管理端只负责鉴权、模型策略和异步脱敏审计，不得控制本地插件、工具审批、会话、Job 或执行。

## 开发与发布

开发环境使用 Node 24.x 与精确 `pnpm@11.7.0`：

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm check:target
pnpm check:release-boundary
pnpm test
pnpm test:release
```

`packages/dsh/profile/component-inventory.json` 是 CLI、Desktop、分类器、组合器与发布器共用的唯一组件清单。每个 accepted 组件拥有独立 frozen lock 和签名运行闭包；Plugin-only CI 恢复已接受的 Base SDK，只构建变化组件，再与完整 accepted set 在三个目标上组合验证。Base CI 才构建 Desktop 安装器，并额外对所有平台组件运行原生兼容矩阵。

发布严格复用已通过 exact-main CI 的原字节：先上传并公开回读 commit-scoped immutable 安装器/组件，最后才激活各目标 desired state 与 `desktop/latest.json`。`mac-smoke`、本地候选和失败构建永远不能进入 R2 或官网下载页。
