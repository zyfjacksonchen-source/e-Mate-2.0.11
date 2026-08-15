# e-Mate

e-Mate 2.0.7 是浏览器优先、本地运行的 AI 工作空间。产品运行在锁定的 DeepSeek Harness `0.1.0-rc.5` 上；Harness 是技术底座，不是产品名称。版本固定关系和不可越界项见 [`docs/target-contract.md`](docs/target-contract.md)。

> 当前仓库仍在发布前实现与验收阶段。npm 正式包尚未激活；未通过的切片不得描述为已交付。实时状态见 [`docs/development-log.md`](docs/development-log.md) 和 [`docs/slices/S00-S13.md`](docs/slices/S00-S13.md)。

## 用户环境

- macOS 13+：arm64 或 x64。
- Windows 10/11：x64。
- Node.js `^22.19.0` 或 `>=24.0.0`，推荐 Node 24 LTS。
- npm 使用 Node.js 自带版本。
- 用户机器不需要 pnpm、Python、Chrome、Xcode、MSVC、Rust、Electron 或签名工具；Python/Office/OCR/Chromium 均由匹配平台包预构建交付。
- Linux 不属于 2.0.7 正式支持范围。

## 安装与首次启动

正式发布后使用：

```bash
npm install -g @e-mate/dsh@2.0.7
e-mate setup --check --json
e-mate setup
e-mate launch
```

`setup --check --json` 是只读检查。任一必需平台包缺失、版本不一致或摘要错误时，`setup` 会失败且不使用系统 Python/Chrome 降级。`setup` 成功后会原子覆盖当前 e-Mate 管理的桌面快捷方式：

- macOS：桌面 `e-Mate.command`。
- Windows：桌面 `e-Mate.lnk`。

关闭浏览器不会停止本地服务；再次双击快捷方式只会复用健康实例并重新打开页面，不会启动第二实例。

## 日常命令

```bash
e-mate web                         # 前台运行本地 Web
e-mate launch                      # 后台复用或启动，并打开浏览器
e-mate status                      # PID、URL、实例、健康状态和最近更新收据
e-mate stop                        # 只停止身份匹配的受管实例
e-mate setup --check               # 人类可读环境检查
e-mate setup --check --json        # CI/支持诊断
e-mate --profile e-mate --dump-config
e-mate --version
```

默认数据根优先级为显式配置、`DSH_HOME`、`~/.dsh`。代码只存在 npm 安装目录；会话、附件、记忆、插件状态、审计 outbox、迁移和更新收据都保存在数据根内。

## 在线更新与同版重装

Agent 识别“在线更新”意图后调用的也是同一个受管更新事务：

```bash
e-mate update
e-mate update --version 2.0.8 --json
```

人工覆盖安装仍支持：

```bash
e-mate stop
npm install -g @e-mate/dsh@新版本
e-mate setup
e-mate launch
```

- 同版本重装只校验闭包、修复 profile、覆盖快捷方式；迁移收据保证不重复导入。
- 存在活动任务时更新拒绝执行。
- 新版本先校验依赖、快照数据、执行幂等迁移和健康检查，再激活；失败恢复数据快照并保留失败收据。
- 默认拒绝降级。需要旧版本时必须显式安装，并使用与该版本匹配的数据快照。

## 卸载与恢复

```bash
e-mate stop
npm uninstall -g @e-mate/dsh
```

卸载 npm 包不会删除 `$DSH_HOME/e-mate`、会话、附件、记忆、凭据引用或更新快照，也不会删除旧 Electron 程序。确认不再使用后可手动移除 e-Mate 自己管理的桌面快捷方式。删除数据根属于不可恢复操作，应先复制整个数据根并保存最近的 `update-snapshots/` 与 `migrations/` 收据。

更新失败时不要继续覆盖数据：先查看 `$DSH_HOME/e-mate/logs/` 和 `$DSH_HOME/e-mate/migrations/online-update-*.json`，保留 `update-snapshots/<request-id>/`，再按收据恢复。损坏、来源含糊或真实凭据缺失时必须失败关闭，不允许用相近数据或空白账号替代。

## 安全与企业边界

- Agent Loop、SessionPersistence、LLM、Tools、Jobs、WorkspaceRegistry、插件和本地执行均归 Harness 本地运行态所有。
- 企业服务只提供注册/登录鉴权、模型策略下发和异步旁路审计；不得控制插件、工具审批、会话、Job 或本地执行。
- 首次使用须签署用户协议和企业免责说明，并由企业服务返回不可变留档收据后才能进入产品。
- 模型 Key、服务器密码和用户凭据不得进入仓库、前端状态或日志。macOS 使用 Keychain，Windows 使用 DPAPI；文件仅保存非敏感凭据 ID。
- AI 输出可能错误，用户必须核实并依法合规使用。

## 开发

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile
pnpm check:target
pnpm --filter @e-mate/dsh test
pnpm test:release
# 在 dist/npm 已有完整七包后生成发布证据
pnpm release:evidence
```

开发使用 Node 24.x 和 `pnpm@11.7.0`。发布链与固定 DeepSeek Harness 一致采用 CI-first：每个 PR 都无凭据构建、打包并在仓库外安装同一批 tarball；只有从 `e-mate-v2.0.7` 标签手工触发、通过受保护环境和 S12 验收提交绑定后，才发布已经验证的原字节，发布阶段不重新构建。e-Mate 仅因便携 Python/Chromium 平台包保留三平台原生 runner，并在 npm 回读后再准入 Cloudflare R2。任何 Harness、Python Worker 或 Chromium 升级都必须独立切片重新验收。发布前还必须完成三平台干净安装、SBOM/许可证、性能 Trace、Computer Use 和生产企业对账。
