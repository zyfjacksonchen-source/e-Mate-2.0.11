# Development log

Entries are append-only. Each entry records verified facts, decisions, evidence, and remaining blockers so later work cannot silently redefine the target.

## 2026-08-14 — S00 source and release baseline

### Goal

Create the independent 2.0.7 repository, freeze the two source inputs, and establish a reproducible path to the first installable package without modifying either source repository.

### Verified facts

- DeepSeek Harness source is clean at `47f943859bef60e4160492346772ded9b24f765a`, version `0.1.0-rc.5`, MIT.
- e-Mate 2.0.5 source is clean at `564a6b6c1d43fb6831dd4a5cd8026e472f063311`, MIT.
- The planned GitHub repository did not exist in the connected installation when checked.
- npm publishes DeepSeek Harness `0.1.0-rc.2`, `0.1.0-rc.3`, and `0.1.0-rc.6`, but not the required `0.1.0-rc.5` package family.
- The exact `rc.5` source includes its own release packer and packed-install verifier. Therefore the implementation must build the dependency closure from the pinned source rather than silently consume `rc.6`.

### Decision

Keep the new repository as an overlay with the exact Harness source pinned as a Git submodule. Build release inputs from that source. Do not change the source pin to satisfy registry availability.

### Blockers

- The final npm publication layout for the unpublished `rc.5` dependency family still needs a packed-consumer proof before the public package can be published.
- Platform Office/OCR/Chromium runtime artifacts do not yet exist.

### Next action

Pin the upstream submodule, add a target-drift check, and implement the smallest `@e-mate/dsh` CLI/profile path that can boot the exact source from a development checkout.

## 2026-08-14 — Product naming correction

### Goal correction

The product remains **e-Mate 2.0.7**. “Harness” describes only the pinned DeepSeek runtime foundation and is not part of the product name.

### Applied change

- Renamed the public repository from `zyfjacksonchen-source/e-Mate-Harness` to `zyfjacksonchen-source/e-Mate`.
- Updated the local Git remote to the canonical renamed repository.
- Kept the technical npm contract `@e-mate/dsh@2.0.7` and executable `e-mate` unchanged.

### Drift rule

Repository titles, UI labels, documentation headings, package descriptions, health responses, and release pages must use `e-Mate`; references to DeepSeek Harness are allowed only when explaining the underlying technical architecture or source pin.

## 2026-08-14 — S01/S05 exact-core CLI and managed Web baseline

### Implemented

- Added `@e-mate/dsh@2.0.7` and the `e-mate` CLI with `setup`, `setup --check --json`, `web`, `launch`, `status`, `stop`, profile dump, and version commands.
- Resolution accepts only the pinned Harness `0.1.0-rc.5` source commit or a matching packaged manifest. It never falls back to another registry version, system Python, or system Chrome.
- Added the managed `e-mate` Harness profile and loopback-only `/api/e-mate/health` endpoint. Active-run counts are projected from real Harness Job ownership.
- Managed launch writes instance identity below `$DSH_HOME/e-mate/run`, reuses the healthy instance, protects `stop` with identity checks, and does not depend on the browser remaining open.
- Added overwrite-safe macOS and Windows shortcut writers. They resolve the current global `e-mate launch` command at invocation time rather than binding an npm installation path.
- Added the exact e-Mate 2.0.5 source as a read-only Git submodule and extended the target checker to verify both source commits.

### Main-process evidence

- Exact Harness source installed and built successfully with Node 24 and `pnpm@11.7.0` using its TypeScript, tsdown, and Web frontend build commands.
- `pnpm --filter @e-mate/dsh test`: 5 tests passed, covering version/platform gates, exact source resolution, idempotent profile install, fail-closed checks, health projection, HTTP methods, and HTML title branding.
- `publint @e-mate/dsh`: no errors.
- `e-mate setup --check --json`: exact source, Node, platform, writable home, SQLite, Keychain, and profile passed; missing Runtime/Browser packages and their Office/OCR/Chromium resources failed as required.
- Harness config dump contained only the managed profile composition including `emate-health`.
- Real Web smoke returned `product=e-Mate`, `version=2.0.7`, the expected instance/profile/run count, an SPA deep link for `/chat/smoke-session`, and `<title>e-Mate</title>`.
- Real managed-process smoke launched one instance, reused the same PID and instance ID on a second launch, stopped it cleanly, and left no matching process.

### Child repair record

The main Web smoke first exposed the upstream `<title>DeepSeek Harness</title>`. A scoped child repair changed only the health/profile index transform and its unit test. The main process then reran package tests and the real HTTP/deep-link smoke before accepting the repair.

### Remaining blockers

- No Runtime or Browser platform package exists yet, so `setup` intentionally makes no mutation and the current npm tarball is not publishable.
- Platform package manifests, embedded Python/Office/OCR resources, pinned Chromium, SBOM, and packed-consumer proof remain S01 work.
- Shortcut generation is unit-covered through the shared lifecycle path but still needs real macOS and Windows acceptance once the install closure exists.

## 2026-08-14 — WebUI/CLI architecture correction

### User constraint

Structural and architectural behavior must be reused from the target DeepSeek Harness project. In particular, the WebUI/CLI seam cannot be reimplemented for e-Mate.

### Verified target path

The pinned Harness already owns the browser carrier and client composition: typed `ApiProxy` requests over HTTP `POST /api/<method>`, answerable-frame responses through `/api/respond`, two downlink-only WebSockets for `events.mux` and `events.host`, client modules declared by `dsh.client`, Cordis services, and UI slot registration. Its durable session/event and Job services remain the only runtime sources of truth.

### Implementation rule

The e-Mate Web layer is limited to client-module registration, brand assets, layout/renderer slots, CSS tokens, and enterprise plugins. It must not add a parallel WebSocket, RPC envelope, REST facade, normalized session/event store, synthetic event protocol, or tool-name dispatch layer. Any missing UI behavior is added by consuming or extending a Harness service/plugin contract; the core transport is not forked.

## 2026-08-14 — High-fidelity UI and TypeScript correction

### Binding references

- Task `019ff91c-47ca-7c11-93bd-863475181a18` is the complete e-Mate page/component/brand baseline. The exact 2.0.5 submodule is its code source.
- Task `019ff665-d721-79a0-869d-338f086cf529` is the only chat-interaction upgrade baseline. Its delivered prototype defines L0–L4 disclosure, activity lifecycle, nested Shell, image groups, Goal timing and the normal-answer-plus-artifacts terminal state.
- The live smoke still showed Harness onboarding, PWA naming and hero content. Those are recorded product failures, not accepted visual defaults. The PWA manifest has been corrected to e-Mate; onboarding and hero replacement remain open until the e-Mate identity/chat slots land.

### Technical-stack correction

The maintained CLI and Host plugins were moved from JavaScript source to TypeScript. `@e-mate/dsh` now builds CLI lifecycle code, health, identity agreement catalog and shell Host code with the pinned Harness `tsdown`; its React browser module remains TSX and uses the official `clientBundle` preset. Published `.js` files are generated artifacts.

### Main-process evidence

- `pnpm --filter @e-mate/dsh test`: TypeScript build completed and 7/7 tests passed.
- `node packages/dsh/lib/bin.js --version`: `2.0.7`.
- `pnpm check:target`: both source pins and the e-Mate product contract passed.

## 2026-08-14 — First-use agreements

### Added contract

- Added versioned `e-Mate 用户协议与合规使用承诺` and `亦芯企业免责声明与风险提示` documents with SHA-256 identities and three explicit acknowledgement IDs.
- The first Host surface is registered through Harness's generic Connection RPC channel `/emate.identity`; no new HTTP/WebSocket protocol or browser event store was created.
- The gate requires authentication followed by an enterprise archive receipt. Browser/local flags cannot satisfy it, and missing legal entity information fails closed.
- Agreement retention is part of the identity boundary, not the asynchronous runtime-audit outbox; it cannot affect tools, plugins, sessions, Jobs or local execution control.

### Legal and product constraints

The text highlights AI hallucination and human verification, legal use, real-action review, data authorization, professional-decision limits, intellectual-property checks and AI content labels. It expressly preserves liabilities that cannot lawfully be excluded. Agreement wording does not replace the product's required visible/metadata AI labeling.

### Remaining blockers

- The repository does not contain a verified 亦芯 legal entity name, unified social credit code, contact/privacy address, or a deployed authenticated agreement archive endpoint.
- Production first-use acceptance remains blocked until those facts, server schema/API, retention administration and admin read-only projection are implemented and verified.

## 2026-08-14 · S02/S03 高保真真值与结构落点

- 目标：把两项任务引用拆成可执行、可截图、可自动检查的逐屏合同，避免把“品牌化 Harness”误判为“高保真 e-Mate”。
- 事实：Harness 浏览器端没有独立产品路由/消息总线；稳定组合是 `root → sidebar / conversation / details / shell.overlay`，Session、Conversation、Slots 和 Connection 已提供业务与通讯真值。
- 决策：不注册第二个 `root`，不复制 Session/Conversation Store；e-Mate 覆盖同名视觉插件并在 `shell.overlay` 中承载登录、首次协议和浏览器独立页。业务状态继续由 Harness 服务注入。
- 证据：新增 `docs/ui-fidelity-map.md`，固定旧 e-Mate 源码提交、聊天原型/交互稿哈希、六条路由、17 个聊天状态、五个响应式视口和 Design QA 阻断规则。
- 偏差：当前实现仍只覆盖侧栏、标题和 PWA manifest；Home、能力中心、设置、登录/协议门、聊天 17 状态均未达到该合同，不能标记 S02/S03 完成。

## 2026-08-14 · Skill Hub 保留与目标插件适配

- 新增目标：保留 e-Mate 2.0.5 能力中心的用户 Skill 上传、公开发现、下载和本机安装，不把“八项内置能力”误解为关闭社区 Skill。
- 已验证旧实现：`skill_hub.py`、SkillsWorkspace、Runtime 投影校验和四组 Skill Hub 测试已经定义不可变版本、摘要、来源、上传者、上传/目录/详情/下载/安装行为，可直接作为中央目录合同。
- 已验证目标落点：固定 Harness 已内置 `@deepseek-ai/dsh-skill-filesystem` 和 `@deepseek-ai/dsh-tool-skill`；其用户根是 `$DSH_HOME/skills`，适合承接旧 Skill ZIP，无需普通用户安装 pnpm 或运行 `dsh plugin`。
- 决策：社区 Skill ZIP 原子安装到 `$DSH_HOME/skills/<slug>`，由目标 provider 自动发现；浏览器通过 target Connection 的 `emate.skillHub` Host adapter 使用旧 Hub API。JS Cordis 动态插件为独立包族，不能伪装成 Skill ZIP。
- 边界：上传只发布到目录，不远程安装；企业管理端仍无插件启停/推送/执行权限。新增 `docs/skill-hub-compatibility.md` 固化供应链、事务和验收合同。
- 偏差：Host adapter、原子安装器、能力中心 UI 和真实双用户验收尚未实现，S10/S11/S12 仍未完成。

## 2026-08-14 · Agent 自执行更新与 Skill 操作

- 新增目标：用户可直接在聊天中表达在线更新以及 Skill 搜索、下载、安装、发布意图，由 Agent 自行开始执行。
- 已验证目标项目：标准 Agent 已组合 Bash/PowerShell Tool；其 `run_in_background` 原生进入 owner-scoped `ctx.jobs.start` 和既有 `tool-jobs` 控制/完成通知；托管实例 SIGTERM 进入启动器 bounded graceful shutdown；Skill 最终仍由 `$DSH_HOME/skills` 的 `skill-filesystem` 发现。
- 决策：更新复用目标 Shell Tool 调用 typed `e-mate update`；Skill Hub 因需使用 Host 身份租约而注册目标 `ctx.tools` 业务工具，禁止把 bearer 传给 shell。前端不增加关键词识别、npm API、任务 Store 或自定义进度协议，真实 Tool/Job/Session 事件是唯一展示输入。
- 升级边界：Agent 与人工安装共用同一 CLI 升级事务；当前进程只做预检/排队，文件替换和重启由带收据的 detached helper 执行。激活前必须等待其他 Job 空闲，失败恢复旧包和数据快照。
- Skill 边界：发布只接受已安装 Skill 名或 Harness attachment/artifact ID；Tool 不能接受任意宿主路径，也不能绕过旧 Hub 的摘要、不可变版本和安全门。
- 已实现：Skill ZIP 的中央目录/路径/文件类型/大小/压缩比/YAML/摘要校验、`$DSH_HOME/skills` 原子切换、旧 Hub install-intent/claim/complete 事务，以及 search/download/install/publish 四个目标 Tool 和 owner-scoped Job。
- 偏差：身份服务目前明确失败关闭；secure Keychain/DPAPI Worker、真实登录租约、协议归档、线上 Hub 凭据和双用户验收仍未完成。不得以环境 bearer、前端 mock 或 Agent 直接拼装 HTTP/npm 命令关闭这些项。

## 2026-08-14 · 首次验收增量：项目记忆、界面闭环、改密与 usage 对账

- 新增阻断项：项目记忆/梦境/学习数据必须绑定目标 Harness `WorkspaceRegistry` 的稳定 workspace ID 与已校验 canonical cwd；跨项目、无归属会话、目录漂移和旧数据误绑定均不得回退到全局记忆。
- 新增阻断项：旧 e-Mate 高保真外壳中的所有可见交互必须映射真实 Harness service/slot/RPC/Tool/Job 并完成 pending → terminal → authoritative reload 闭环。空 handler、假成功、无效链接和不可达按钮均算失败。
- 新增阻断项：保留旧 e-Mate 登录/退出/改密请求与 receipt 语义；改密后旧租约和旧密码均失效，新密码重登成功后重新加载模型策略和协议收据。
- 新增阻断项：usage 从真实 provider fact、local audit outbox、企业 receipt、不可变 ledger/account counter 到现有 usage panel 逐笔对账；重复上送必须幂等，冲突/缺失不得被聚合总数掩盖。
- 已核实目标复用点：Harness workspace registry 以稳定 ID 管理 workspace，并用 session header 的 canonical `cwd` 校验成员；旧 e-Mate 已定义 password change 强制重新鉴权和 immutable provider usage fact/idempotency 语义。
- 已新增 `docs/performance-and-acceptance.md`，固定四类场景的证据字段与 fail-closed 判定。生产身份/审计 endpoint、验收账号、平台包和真实 usage panel 数据仍是外部阻塞，不得用 mock 关闭。

## 2026-08-14 · 视觉基线纠偏：只允许最终 2.0.4/2.0.5 界面

- 用户纠正：e-Mate 非聊天前端必须以 2.0.4/2.0.5 最新最终界面为唯一视觉依据，不得从旧界面继续开发。
- 已核定的代码真值是固定提交 `564a6b6c1d43fb6831dd4a5cd8026e472f063311` 中当前 `desktop/src/v1`、`desktop/src/styles/tokens.css` 和四个当前品牌资产；其中包含 2.0.5 上的 Sidebar、Home、Timeline、Settings、Skill Hub 及响应式收口。
- 库内 `docs/v0.*`、`docs/v1.*` 截图和 2.0.4 之前的 UI 变体已列为禁用样本；它们不能用于取色、间距、布局、组件选型或高保真验收。
- 任务 `019ff91c…` 的最终 2.0.4/2.0.5 验收画面才可以作为截图真值；若无法获得或与固定当前源码冲突，该视觉验收项必须标记阻塞，不得回退到历史截图。

## 2026-08-14 · S02 首屏真实组合与浏览器复验

- 复用边界：e-Mate 浏览器模块继续占用目标 `sidebar`，Home 只注册目标 `shell.overlay`；数据只读取目标 `sessions`/`workspaces`，打开任务只调用 `ctx.sessions.open`。未新增 HTTP、WebSocket、路由 Store 或事件协议。
- 视觉来源：构建前从固定 2.0.5 提交同步 logo、mark、五助手横幅和小芯头像；测试逐个校验发布资源与 `desktop/src/v1/assets` 的 SHA-256 一致。
- 主进程发现并收口：Home 最初误把 `conversation.composer` 的 fallback 包装层当 composerStack，导致 Workspace、Agent preset 和 InputBar 被 CSS 一并隐藏。子代只修 `home.tsx`/`home.module.css`，主进程随后用真实浏览器确认三项目标组件均保留。
- 目标开发者引导：`ui-settings-models` 的“内测声明”和 DeepSeek API Key 弹窗不属于 e-Mate 首次流程。e-Mate 通过目标 `settings.onboarding` list-slot 的 priority shadow 仅跳过 `welcome-notice`/`deepseek-official`，仍保留目标模型设置页、Connection、Store 和模型选择；没有复制模型插件。
- 自动化证据：`pnpm --filter @e-mate/dsh test` 完成 TS/TSX 构建，16/16 通过。
- 浏览器证据（目标真实 Web，非静态 mock）：1280×900 下 e-Mate Home、真实 Workspace picker、Agent preset、InputBar、四项真实本机统计和设置动作均可访问；320×800 下 `scrollWidth === clientWidth === 320`，首屏 5 个按钮的实际命中尺寸均至少 44×44；两项 Harness onboarding dialog 数量为 0。
- 未通过项：设置动作当前仍显示目标 Harness 默认 Settings 视觉，尚未高保真映射到最终 e-Mate 2.0.5 `SettingsDialog`；能力中心、登录/协议门和 17 个聊天状态也未完成。S02/S03/Design QA 继续保持 blocked。

## 2026-08-14 · 企业材料边界与首次登录/协议门

- 收到两份本地运维材料后，仅做字段类型、文件权限和网络可达性核验；未把其中任何密钥、密码或主机登录材料写入仓库、配置、前端状态、产品日志或测试夹具。两份源文件已收紧为仅当前用户可读。
- 用户已确认两份材料分别是生产模型 Key 与生产服务器资料；当前只复核到两份文件均为 `0600`，未再次读取或回显值。该确认不会解除下述泄露处置，必须由服务端轮换后再建立新的 Keychain/DPAPI 引用并执行生产验收。
- 安全事件：一次本地字段识别的脱敏规则覆盖不完整，敏感值曾进入当前开发任务的工具输出。该批材料全部按已暴露处理，生产接入前必须轮换；轮换前禁止导入 Keychain/DPAPI、登录企业主机或调用生产模型。
- 边界结论：材料能确认模型供应商类别、既有运维面板和服务器入口，但不能证明 `emate.identity`、`emate.modelPolicy`、`emate.audit` 的应用 API、租约、协议归档或 usage receipt 合同。不得根据面板页面或 SSH 入口另造企业协议。
- 复用决策：企业接入继续以最终 e-Mate 2.0.5 已存在的登录、改密、设备身份、Skill Hub 和 usage 事实/收据合同为源，浏览器通讯只走 Harness Connection RPC `/emate.identity`；未新增 HTTP、WebSocket、路由 Store 或浏览器 token。
- 已实现：首次门使用目标 `shell.overlay` 并 portal 到 `body`；未解锁时将目标 `#root` 设为 `inert`。企业 provider 缺失时固定停留 `/login` 且失败关闭；登录成功后必须完成版本化协议勾选，并拿到企业归档 receipt 才恢复本地工作区。受保护深链在登录 reload 后恢复原路径尚未完成，继续按路由合同阻塞。
- 视觉来源：登录和协议门只使用最终 e-Mate 2.0.5 品牌资产与 Token，支持 320px 浏览器布局、44px 触控目标、焦点态、暗色和 `prefers-reduced-motion`。
- 生产阻塞：等待轮换后的模型/企业凭据、经确认的 SSH host key、企业法定主体资料、真实身份/协议归档 endpoint 与验收账号。以上缺失不得用 mock、环境 bearer、硬编码 token 或面板抓包推断关闭。

## 2026-08-14 · 退出与改密闭环

- 复用落点：账户入口注册到目标 `sidebar.footer.action`，个人资料/改密注册到目标 `settings.section`；仍由 Harness 设置 Shell 管理打开状态、分区导航和渲染生命周期。未增加账户 Store、HTTP 路由或 WebSocket 事件。
- Host 合同：`session.logout` 与 `session.password` 继续走 `/emate.identity`。两者只接受精确字段和稳定请求 ID；企业 provider 必须返回 receipt。改密 receipt 还必须声明 `reauthentication_required: true`。
- 失败关闭：企业操作完成后 Host 立即读取权威 bootstrap；若旧登录状态或工作区解锁状态仍为真，响应直接失败，前端不得显示成功。成功后浏览器刷新并由同一首次门重新取得身份、模型策略和协议归档状态。
- 交互闭环：用户中心使用最终 2.0.5 的“用户中心 → 二次确认 → 退出”语义；个人资料页保留三字段改密、10–256 字符校验、重复提交复用同一请求 ID，以及“所有设备重新登录”提示。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 16/16 通过，覆盖旧密码失效后的新密码重登、退出后权威状态失效、无效请求和 receipt；`pnpm check:target` 通过。真实浏览器加载新 profile 后只出现一个目标插槽账户入口，未配置企业 provider 时 `/login`、`#root[inert]` 和失败关闭保持有效；320×800 仍无横向溢出且唯一可见按钮为 44px 高。
- 验收状态：本地合同和 UI 投影完成；真实“改密 → 退出 → 旧密码失败 → 新密码成功 → 策略/协议恢复”仍等待轮换凭据、生产 provider 和验收账号，不能用测试 provider 关闭。

## 2026-08-14 · S02 设置页结构复用与浏览器适配

- 结构边界：继续使用目标 Harness `SettingsRoot`、`settings.section`、`settings.action`、`settings.trigger`、`settings.header` 和 `settings.close`；只用 e-Mate Client 模块注册文案、账户分区和品牌 CSS。没有复制目标设置打开状态、分区 Store、模型页、插件页或 Agent 预设页。
- 高保真来源：依据最终 e-Mate 2.0.5 `SettingsDialog.tsx` 及 `features.css` 的全屏工作区、76px 页头、184px 分区栏、窄屏横向导航和密码表单布局，把目标默认 800px 模态壳投影为浏览器全屏设置工作区；删除桌面窗口平台留白。
- 闭环修复：真实浏览器首次复验发现目标设置 trigger 在当前覆盖组合中无可见文案和 accessible name。e-Mate 在同一单槽以更低优先级提供“设置/关闭设置”内容及目标图标，按钮现可见、可聚焦并能打开/关闭同一个目标 Settings Shell。
- 主进程证据：1280×900 实测 panel 为 `(0,0,1280,900)`、五个真实设置分区存在且无横向溢出；320×800 实测 panel 为 `(0,0,320,800)`、横向分区可滚动且所有可见按钮/输入命中高度均至少 44px。主包 TypeScript/TSX 构建和 16/16 测试通过。
- 证据边界：浏览器视觉状态使用 `/private/tmp` 中一次性 identity provider 夹具解锁，仅用于渲染测量，未写入产品仓库，也不计作身份、协议、模型或改密验收。与任务 `019ff91c…` 的最终同视口验收截图仍需取得后做并排差异复验；取得前 S02 Design QA 不关闭。

## 2026-08-14 · S07 自助注册、管理员审核与周 Token 配额

- 用户修正：登录身份改为用户自行注册账号/密码并强制填写真实姓名；注册要有防恶意验证码，管理员审核并设置每周 Token 用量后才允许登录；登录可选择“保持登录”；管理员拥有用户增删改查权限。
- 复用核验：固定 2.0.5 企业源已经提供管理员 `/users` 列表、创建、更新、密码凭据、用量调整、鉴权修订和 `weekly_token_limit` 租约投影。它尚无公开验证码注册、`pending_approval` 状态、显式审批门和删除路由，因此这些缺口不得被当前 active/suspended 或管理员代建账号伪装为完成。
- Host 实现：继续使用 Harness Connection `/emate.identity`；新增 `verification.issue` 和 `session.register`，严格校验 one-time challenge、账号、真实姓名、密码和验证码边界，只接受 `pending_approval` 回执。`session.login` 新增 `remember_login` 并强制权威 bootstrap 为 `active` 且 `weekly_token_limit > 0`，旧无配额租约失败关闭。
- 浏览器实现：在最终 2.0.5 `LoginPage` 的 360px 布局、品牌资产和现有 Token 上增加注册态、真实验证码图片、待审核回执与保持登录复选框；仍由目标 `shell.overlay`、Connection RPC 和同一身份门承载，无浏览器 Token、账号 Store 或新通讯协议。
- 管理合同：现有管理员工作区继续作为 CRUD 表面；“删除”定义为带审计、不可登录、不可自动复活并撤销租约的服务端软删除。审批、状态、密码、周配额或删除变更都必须推进 auth revision；管理端仍不得控制本地插件、会话、Tool 或 Job。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 完成 Host/TSX 构建并 16/16 通过，覆盖验证码和注册回执、真实姓名、保持登录转发、active+正周配额门、旧无配额 bootstrap 拒绝、协议、改密和退出回归。一次性本地 provider 仅用于浏览器渲染复验：注册字段可填写、验证码来自 Host 响应、提交后只显示待审核申请编号、返回登录可见“保持登录”；320×800 下页面 `scrollWidth === clientWidth === 320`，身份门正好覆盖视口，全部表单输入和按钮高度至少 44px。
- 未关闭项：真实企业服务器尚未实现/验证公开验证码、注册表、审批与软删除；生产 provider、轮换凭据、管理员账号和验收账号均缺失。浏览器当前 UI 不等同生产身份验收，S07 保持进行中。

## 2026-08-14 · S10/S11 能力中心与 Skill Hub 目标式闭环

- 结构复用：能力中心只注册目标 `shell.overlay` 与 `sidebar.footer.action`；路由继续使用浏览器 History，目录/安装/下载/上传统一调用 Harness Connection `/emate.skillHub`，已安装列表直接调用目标 `ctx.connection.api.skills.list`。页面源中静态禁止 `fetch`、`WebSocket` 和 `EventSource`。
- 目标标准 Props 修复：首次真实浏览器复验发现页面手动传入 `ctx.sessions.useStore`，覆盖了 Harness `shell.overlay` 自动提供的 `useSessions`。现已删除重复注入，由目标 Slot Runtime 独占 Session 投影。
- 目标 Job 修复：无会话时 Agent 预设尚未挂载 `tool-jobs`，Host UI Job 会被目标注册表拒绝。能力中心 Host 控制面现按官方 `ctx.jobs.attachController('emate-skill-hub-ui')` 挂载控制器；安装、下载、上传仍使用同一目标 Job 注册表、Job ID、状态、取消和输出，不建立第二套任务状态。
- 交互闭环：发现页的搜索、刷新、下载、安装，已安装页的真实 Session Skill 列表/新建会话，以及上传页的分类、10 MiB ZIP 边界和发布按钮均已落到真实 RPC/Job。进行中的 Job 原位轮询，终态保留失败详情；未知/失败企业响应不会显示假成功。
- 浏览器下载复用目标 Session Export 的同源二进制模式：下载 Job 完成后只投影短时 `download_id`，浏览器再通过 loopback Host 的 `GET/HEAD /api/e-mate/skill-hub.download` 取得已校验 ZIP；Host 在发送前重新计算 SHA-256，固定 `attachment` 文件名、`no-store` 和 `nosniff`。未增加 WebUI–CLI Socket、前端 bearer 或第二套文件协议。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 完成 TS/TSX 构建并 17/17 通过。一次性本地身份/Hub 夹具只用于浏览器结构复验：目录卡真实从 Host RPC 返回；点击安装后目标 Job 从 `running` 收敛为 `failed` 并显示 Host 失败详情；发现/已安装/上传三页均可到达。320×800 下 `scrollWidth === clientWidth === 320`，卡片单列且主操作未被裁切。
- 下载复验证据：同一一次性夹具返回一个 200-byte 声明式 Skill ZIP；浏览器下载 Job 收敛为 `completed` 并出现“保存 ZIP”。对该同源 URL 的 `HEAD` 返回 `Content-Disposition: attachment; filename="e-mate-skill-meeting-notes-1.2.3.zip"`，`GET` 字节 SHA-256 为 `88e9df5abf1b399cb90f0ac4c56ae3a074763f9a205b54edd5e855927a37ef62`，与 Hub 卡片声明一致。
- 动态内置能力：新增 Cordis `ctx.emateCapabilities` 注册表与 Connection `/emate.capabilities` 投影。能力标题、摘要、图标、顺序、真实状态和当前有效动作全部由已加载适配插件注册；浏览器不判断能力 ID、插件模块名或工具名。动作执行前 Host 再读插件状态，只允许当下仍公布的 action ID，完成后前端权威重读。
- 注册表复验证据：17/17 主包测试通过，覆盖插件注册/卸载、动态状态、动作白名单、loopback 权限和 profile 幂等安装。一次性本地插件从 `setup-required` 注册 Office 卡片，点击其真实 RPC 动作后重读为 `ready`；该夹具不计作 Office Worker 验收。
- 验收边界：夹具未计作线上 Hub、身份、Office、安装或发布验收。八项实际适配插件及其真实 Worker/凭据状态、真实双用户发布/发现/安装、供应链签名和各连接授权仍未完成，S10/S11/S12 保持进行中。

## 2026-08-14 · S01 Harness npm 运行闭包

- 事实：`@deepseek-ai/dsh@0.1.0-rc.5` 不存在可直接安装的 npm 发布物，普通 CLI `pnpm deploy` 只带声明依赖并缺少 target package 的 workspace peer，启动会在 `@deepseek-ai/cordis-plugin-group` 处失败。该失败没有通过升级 rc.6、复制开发链接或从系统环境兜底。
- 目标复用：新增的 release assembler 只调用固定 Harness 的 `pnpm deploy`、`release:pack --family dsh/vendor` 和其 `dsh-subprocess-local` reviewed postinstall；再把目标 release tarball 中尚缺的 peer 包放入同一顶层 Node closure。没有修改 Harness 源码、Loader、Web 通讯或 Agent Loop。
- 供应链门：构建要求 `pnpm@11.7.0`，固定提交/版本和 lockfile SHA-256；输出前运行包内 `dsh --version`，删除 `.pnpm` 元数据和 `.bin` 链接，并拒绝任何剩余符号链接。生成目录在同一文件系统上完成后才替换旧闭包。
- 主进程证据：生成 receipt 固定 commit `47f943859bef60e4160492346772ded9b24f765a`、Harness `0.1.0-rc.5`、lock SHA-256 `6177ec61bdb8194eb5a606813a62ffb0ab2cc7fdfe2cd6e0249dcbfe4bce58e0`；闭包内 233 个 `@deepseek-ai` 顶层包，无符号链接，CLI 自报 `0.1.0-rc.5`。
- 仓库外 tarball 烟测：`@e-mate/dsh@2.0.7` 完整产物为 57 MiB；解包后 `e-mate --version` 返回 `2.0.7`，`setup --check --json` 的 `harness` 为 `packaged-runtime ... pass`。缺失的 darwin-arm64 Runtime/Browser 包仍分别为 required failure，证明主包闭包已成立且平台资源没有被伪造或静默降级。
- 未关闭项：三个 Runtime 包、三个 Browser 包、精确 `optionalDependencies`、真实 npm 全局安装以及 Office/OCR/Chromium 自检尚未完成，S01 保持进行中。

## 2026-08-14 · S01 darwin-arm64 Browser 平台包

- 目标复用：浏览器版本直接读取固定 Harness Web 的 `playwright@1.61.1` 和 `browsers.json`，锁定 revision `1228` / browser `149.0.7827.55`；平台包携带目标安装的 `chromium-headless-shell`，未改用系统 Chrome、另选 Puppeteer 或建立第二套下载器。
- 安装闭包：主包已经以 workspace protocol 声明六个 `optionalDependencies`，`pnpm pack` 后全部重写为精确 `2.0.7`。三类 Browser 包均声明 npm `os/cpu`；当前主机实际生成 darwin-arm64，darwin-x64 和 win32-x64 只保留同一构建合同，不能在错误主机伪造产物。
- 完整性与启动：Browser manifest 固定包身份、平台、Playwright/Chromium 版本、相对可执行路径和 SHA-256。npm tar 会归一化普通文件权限，因此包复用目标 `node-pty` 的同类做法，以无下载、无编译的 postinstall 仅恢复 manifest 列举的可执行位。
- 主进程失败证据：第一次仓库外解包未运行 postinstall 时，`browser_runtime` 通过但 headless 启动以 `EACCES` 失败；没有把声明成功当成运行成功。改为 headless-shell 并执行受限权限恢复后，新的 90 MiB 平台 tarball 在仓库外 `browser_runtime` 与 `chromium` 均通过，真实等待到 `DevTools listening` 再退出。
- 仍阻塞：darwin-x64/Windows 平台机上的实际 tarball、SHA、SBOM/许可证汇总和干净 npm 安装尚无证据；Runtime/Office/OCR 包仍缺失，所以 S01 不关闭。

## 2026-08-14 · 目标 Harness OCR/Office/Browser 原生能力审计

- 审计基线：只读核对固定提交 `47f943859bef60e4160492346772ded9b24f765a` / `0.1.0-rc.5`，并以目标仓库生成的完整 Tool Catalog、base profile 和生产 bundle 依赖为证据，不由名称或测试依赖猜测产品能力。
- 原生存在：`ctx.web` 服务、DeepSeek search provider 和 `web_search` Tool；base profile 默认开启 search，需有效 DeepSeek credential。这部分直接复用，禁止搬运旧 e-Mate 搜索 Tool 或建第二套 web service。
- 原生但未默认组合：`web_fetch` Tool 和 Node `fetch` provider 包存在，但 shipped base 明确 `fetch: false` 且未挂 fetch provider；它仅支持 HTML/text，不是真实页面交互且不处理 PDF/二进制。后续如启用，只通过 e-Mate profile 组合目标 provider/Tool，不自建 fetch 协议。
- 原生缺失：没有 OCR/RapidOCR service/provider/tool，没有 DOCX/XLSX/PPTX/PDF 创建、读取、编辑、导出 Tool，也没有 Agent 可用的 Chromium/CDP/Playwright Computer Use Tool。Harness `apps/web` 的 Playwright 只是 Host Web UI 测试开发依赖。
- 实施决策：保留 `@e-mate/dsh-runtime-*` 与 `@e-mate/dsh-browser-*`，只补目标缺口；Office/OCR 保留包内便携 Python Worker 及固定依赖，Browser 只新增真实页面交互适配。Harness Python SDK 的 `deepseek-harness-runtime-bin` 不加入 Node CLI 产品闭包。
- 当前真实状态：三个 Runtime 目录仍只是占位 manifest/README，e-Mate profile 仍只有能力注册表，没有 Office/OCR/browser-control provider/tool 行。因此 S01/S10 是“继续最小适配”，不是“删除平台包”，也不得将占位包记为已验收。

## 2026-08-14 · S01 darwin-arm64 Office/OCR Runtime 实包

- 最小闭包：没有搬运旧 e-Mate 主 Runtime、Browser、Web/search/fetch 或 Harness Python SDK。`requirements/worker.in` 只列 RapidOCR/ONNX/NumPy 与五类 Office 根；`uv@0.11.7` 以最终 2.0.5 `platform-stage.lock` 为约束生成通用哈希锁，共 29 个跨平台包，macOS 实装 27 个分发包。
- 固定来源：Worker 直接取自最终 2.0.5 提交 `564a6b6c1d43fb6831dd4a5cd8026e472f063311`，SHA-256 为 `257f21d5bb8ef16151027e006a3c38aaa15bf9f2e2a4fc541c7946ddf339d891`；Worker lock SHA-256 为 `cea6914a347a2a9a80f61260bea9d66d7d2fa2ad7e42434e6ecdafc63d8f8fd5`。构建器逐项核对源提交、旧锁、裁剪锁和 Worker 后才开始打包。
- Python 资产：复用旧 2.0.5 实际选择的 python-build-standalone `20260602` / CPython `3.11.15`。darwin-arm64 资产大小 `27091323`，SHA-256 `f1461690377000ee2161af52db780b7c1a200549fff7c8064e47e1ee1832265b`；另外两平台 URL/大小/SHA 同样固定在构建器，错误平台禁止伪造构建。
- 真实能力：本机包包含 7284 个普通文件、六个 ONNX 模型和完整分发包许可证元数据；构建阶段通过隔离 Python 子进程执行 `python-office-formats-v1` probe 与实际 RapidOCR 模型加载/空图识别。`setup --check --json` 重新计算完整 Runtime tree、逐模型校验并再次执行两个 Worker，自检与固定 Harness/Chromium 一起全绿。
- 主进程修复：第一次 npm tar 验证发现 python-build-standalone 的 `python3` 是符号链接，而 npm tar 会省略链接，导致工作区通过但解包后 manifest 入口不存在。修复不是 postinstall 造链接：构建阶段删除九个非必需 convenience links，manifest 固定指向真实 `python3.11`，并在无链接树上重新计算 payload identity。
- 打包证据：`@e-mate/dsh-runtime-darwin-arm64@2.0.7` tarball 为 138 MiB，SHA-256 `66d89e25de4f4ee8d9722547c95395b81831c83f4fa3d262e7cb128bc6b865b2`。仓库外用 `pnpm@11.7.0` 解包并显式运行同一 postinstall 后，文件数与 manifest 的 7284 一致，Office probe 成功，RapidOCR 六模型加载成功且返回真实空识别结果。
- 自动化证据：`pnpm --filter @e-mate/dsh test` 为 17/17；环境测试现在按平台实包是否存在决定预期，并要求 Runtime tree、Office、OCR、Browser 与 Chromium 真实检查，不再固定断言“Runtime 缺失”。
- 未关闭项：本机没有 npm 可执行文件，因此本轮仓库外证据是精确 pnpm 解包加同一 postinstall，不等同最终 npm 干净全局安装；darwin-x64/Windows 实包、SBOM 汇总、主包组合安装和 Office/OCR Cordis Tool/Job 接线仍未验收，S01/S10 保持进行中。

## 2026-08-14 · S01/S10 Office/OCR 目标原生接线与可复现闭包

- 目标事实：profile 位于可变的 `$DSH_HOME`，从中静态 import `@deepseek-ai/dsh-tools` 不能可靠解析到 npm 包内的固定 Harness。`setup` 现从已验证的 Harness CLI 解析目标模块，将绝对路径、SHA-256、Harness 提交及 Runtime 身份写入 mode-0600 managed binding；Office/OCR 与 Skill Hub 在注册前复核并动态加载同一个目标 `defineTool`。没有复制 Tool registry、Loader 或 WebUI–CLI 通讯。
- 最小适配：新增 `emate-office-ocr` Cordis 插件，仅注入目标 `tools/fs/subprocess/webServer` 与已有能力注册表。四个 Tool 分别执行 OCR、Office 读取、创建、编辑；输入走 `ctx.fs`，Worker 走 `ctx.subprocess`，真实 Tool/session 事件由 Harness 自己持久化和投影。能力卡状态与自检动作由插件真实注册，缺包或完整性错误时失败关闭。
- 产物合同：Office Worker 验证完成后才写入 `$DSH_HOME/e-mate/attachments/office` 的不可变内容寻址存储；receipt 记录 artifact ID、文件名、MIME、大小和 SHA-256。读取/编辑按 ID 重开，编辑生成新 artifact。由于 rc.5 attachment 服务只支持图片，二进制下载最小复用目标 Session Export 的 loopback `GET/HEAD` 模式，发送前再校验摘要与大小，不增加前端协议或伪事件。
- 可复现修复：首次连续构建发现 pip console-script shebang、其 `RECORD` 行以及 build-time `.pyc` 捕获随机 staging 路径。构建器现移除未使用的 console scripts/对应记录，并为所有构建时 Python 调用启用 `-B` 与 `PYTHONDONTWRITEBYTECODE=1`。连续两次构建均为 6,803 文件、payload SHA-256 `8ed54dadde01aac9d57ec15af6816efb812b0b44ab481835d027ba121d597a28`；Python SHA-256 `e3938f2a272dafdc33f3dd12b093dfc85354629476cb97a7d7d4a7201b8482dd`，Worker SHA-256 `257f21d5bb8ef16151027e006a3c38aaa15bf9f2e2a4fc541c7946ddf339d891`。
- 打包证据：当前 darwin-arm64 Runtime tarball 为 135 MiB，SHA-256 `9eff1a480b560c16f2c5cf45fb6b2b53959bef730fe54fca6bba28fb32a7e856`；前一节的 7,284 文件/138 MiB 摘要已被本次可复现修复取代，不可用于发布。
- 运行证据：使用真实固定 Harness `LocalSubprocessRuntime` 执行包内 Office probe 与 RapidOCR 模型加载通过；临时 `e-mate setup` 完成，最终 profile dump 同时包含 Skill Hub 与 Office/OCR 插件；真实 Harness Web 在 loopback 启动，`/api/e-mate/health` 返回 e-Mate 2.0.7，`/capabilities` 深链返回目标 SPA。
- 未关闭项：本轮尚未完成最终 npm 干净全局安装、darwin-x64/Windows 平台实包与 SBOM；Windows 旧 Worker 依赖父进程 Job Object 的内存限制，而目标 subprocess 当前只证明进程树终止，等价内存边界需在 Windows 上适配并验收。Browser Computer Use 仍是下一缺口，因此 S01/S10 不关闭。

## 2026-08-14 · S10 Browser Computer Use 目标原生适配

- 目标复用：目标 rc.5 没有 Agent 可调用的浏览器控制 Tool，但其 Web 开发闭包已经锁定 `playwright/playwright-core@1.61.1`。主包只加入精确 `playwright-core@1.61.1`（无浏览器下载 postinstall），setup 将入口绝对路径与 SHA-256 写入 managed binding。平台 Chromium 仍来自 Harness 同一 Playwright revision `1228` / browser `149.0.7827.55`，不使用系统 Chrome。
- 结构边界：`emate-browser-computer-use` 是普通 Cordis 插件，注入目标 `tools/subprocess/attachments/webServer` 和已有能力注册表。Chromium 由 `ctx.subprocess` 以显式 argv、loopback 动态 DevTools 端口和持久 session profile 启动；插件只用锁定 Playwright Core 连接该 CDP 端点。没有 WebUI socket、RPC facade、第二套事件存储、前端关键词路由或自制浏览器进程管理。
- Tool 合同：唯一 `e_mate_browser` 通过目标 `defineTool` 注册，支持 navigate/snapshot/click/fill/select/scroll/screenshot/wait/back/forward/get_text/press/download。snapshot 只投影有界正文与最多 240 个真实可见元素 ref；截图经 `ctx.attachments.saveImage` 形成目标 ImageBlock。未开放任意 evaluate。
- 隔离与安全：profile 目录由权威 Harness session ID 哈希派生；无 agent/session 的调用失败，不使用全局默认 profile。所有 HTTP(S) 请求拒绝 link-local 和云元数据地址；fill 在执行前拒绝 password 与 password autocomplete 字段，避免密码进入持久 Tool 参数。验证码、MFA、授权、支付和破坏性确认在 Tool 描述中保留为用户动作。
- 下载合同：下载上限 100 MiB，保存为 `$DSH_HOME/e-mate/attachments/browser` 下不可变 SHA-256 object/receipt；返回 artifact ID 和同源 loopback URL。`GET/HEAD /api/e-mate/browser.download` 每次重读 receipt、大小和摘要，并返回 `no-store`、`nosniff` 与安全附件名。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 为 20/20，真实测试通过目标 `LocalSubprocessRuntime` 启动打包 Chromium，完成本地页面导航、表单填写/点击、密码字段拒绝、截图持久化、下载字节/SHA 对账和 `169.254.169.254` 拒绝。新临时 home 的 `e-mate setup` 成功，最终 dump-config 包含 `emate-browser-computer-use` 及目标 inject；完整 Harness Web 在 `127.0.0.1:55143` 启动，health 返回 e-Mate 2.0.7，`/capabilities` 深链返回 `<title>e-Mate</title>`。
- 未关闭项：上述是 darwin-arm64 本机与受控页面证据，不替代 macOS x64/Windows 实包、真实站点下载/多页/MFA 用户接管、性能 Trace、Computer Use 全场景和供应链 SBOM/许可证汇总。能力中心三项图标 URL 尚未对应真实来源资产，不能按可见验收完成；S10/S12 保持进行中。

## 2026-08-15 · S09 项目记忆隔离与目标存储接线

- 目标复用：项目归属只读取固定 Harness 的 `ctx.workspaceRegistry.resolveByPath`、稳定 workspace ID、canonical path、`status()` 与 header-validated `sessionIds`；持久化只使用已组合的 `ctx.storageDomain`。没有新建 SQLite、RPC、WebUI 通讯、会话索引或全局记忆目录。
- 运行绑定：`setup` 从已验证 Harness CLI 解析 `@deepseek-ai/dsh-storage-domain` 与其锁定 `zod@4.4.3`，把入口绝对路径及 SHA-256 写入 mode-0600 managed binding。插件动态加载前复核摘要，漂移、缺失或 API 不完整均失败关闭。
- 隔离合同：每次读写重新解析当前 Agent/session。已注册项目使用 `workspace ID + canonical path SHA-256`；会话 ID 不在项目权威成员表、项目目录丢失或 Agent 身份缺失时拒绝。现存但未注册的 cwd 和无 cwd 会话只得到 session-ID 哈希作用域，不共享资料，也不自动创建/修改 Workspace。
- 能力实现：新增系统插件 `emate-memory`，通过目标 `defineTool` 注册 `e_mate_memory_remember` 与 `e_mate_memory_search`，并通过 `ctx.emateMemory` 暴露同一有界存储服务给后续 dream/learning 插件。内容、标签、结果数和 schema 均有界；磁盘记录不含 canonical path 明文。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 为 21/21；真实组合目标 Storage、JSON backend、DomainFacility 和 WorkspaceRegistry，创建 A/B 两个 canonical workspace，证明 A/B 双向不可见、成员 ID/cwd 错配拒绝、无项目会话互不可见、同一未注册 cwd 仍不共享、删除目录后读操作失败，且实际 `emate_memory.json` 不包含 A/B 路径。`pnpm check:target` 与 `git diff --check` 同时通过。
- 未关闭项：本片只关闭基础 memory 隔离与存储接线。梦境蒸馏、自主学习、旧 CowAgent copy-on-write 导入、跨新会话召回、项目 rename/move 正向路径和迁移收据尚未实现/验收；S09 保持进行中。

## 2026-08-15 · S02 e-Mate 2.0.5 聊天框与连接器闭环

- 防漂移真值：聊天框严格取固定 e-Mate 2.0.5 提交 `564a6b6c1d43fb6831dd4a5cd8026e472f063311` 的 `desktop/src/v1/components/Composer.tsx` 与当前 `features.css`，未引用更老界面。实现只注册 Harness `conversation.input.right` 并样式化目标 InputBar 的稳定语义节点；没有复制 InputBar、Router、Store、draft、attachment、submit 或 transport。
- 明确产品覆盖：通用会话继续由目标 `general-workspace` 与真实 workspace/session 路径承担；模式入口隐藏、目标默认 `standard`，访问策略继续由 profile 默认 `danger-full-access`；模型设置继续由企业策略控制。桌面发送按钮使用品牌色与 2.0.5 的“发送”形态，移动端发送和外部连接均为 `44×44px` 可点击区。
- 连接器闭环：聊天框“外部连接”通过 History 投影进入 `/settings?section=connections&connectors=feishu,tencent-docs`；既有 SettingsRoot 选择其注册的 `外部连接` section，既有 `/emate.connections` 只显示真实 `feishu` 与 `tencent-docs` 条目。没有造空页、假成功、第二通信层或按工具名路由。
- 量测证据：`1440×900` 下源与实现聊天框均为 `1056×114`，输入区 `1054×66`、工具栏 `1054×40`、间距 `6px`；实现无水平溢出。`390×844` 无水平溢出。证据位于 `artifacts/design-qa/S02-composer-205/`。
- 门禁：主进程 client Vitest `26/26`、`@e-mate/dsh build` 与 `git diff --check` 通过；Browser 真实点击路由并确认只出现飞书/腾讯文档。主进程已将源/实现同视口截图合成同一 1:1 比较画布并检查，几何、控件顺序、间距和响应式未发现新的 P0/P1/P2。完整 QA 仍保持 blocked：隔离 profile 没有 S07 真实模型 Catalog，无法与 2.0.5 的启用模型状态同态。未把临时 Catalog 尝试或替代 transport 写入产品。

## 2026-08-15 · S09 梦境蒸馏与自主学习目标接线

- 目标复用：`emate-dream` 与 `emate-learning` 只使用当前 Harness Agent 的 `session.deriveMessages()`、`requestHeader()`、已组合 `ctx.llm`、目标 `BlockAssembler/createUserMessage`、`ctx.jobs` 和上一片的 `ctx.emateMemory`。没有新增模型客户端、定时器、WebUI 通讯、Job Store、会话事件或持久化路径。
- 梦境合同：用户调用 `e_mate_dream_distill` 后启动 owner-scoped `emate-dream` Job；输入仅含当前作用域记忆与有界权威会话文本，输出必须为严格 JSON。成功时原子写入一个带源消息 ID 和输入摘要的 dream 记录；相同输入再次调用先命中摘要去重，不重复请求模型。`e_mate_dream_search` 只返回当前项目或当前无归属会话的数据。
- 学习合同：非子 Agent 进入 idle 且累计六条新用户消息后，启动 owner-scoped `emate-learning` Job。模型只可返回 silent，或返回每项都引用当前有界会话消息 ID 的持久经验；缺失/伪造证据、截断、非 JSON 或非文本输出全部失败且不落盘。当前实现只形成本地、证据化学习记录，不改 Skill、文件、系统提示、模型策略或 Harness 事件。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 仍为 21/21，但项目记忆组合测试已扩展为真实目标 Storage/Workspace 上的 dream/learning 集成：证明沿用会话路由后的 provider/model、目标 Job 终态、同输入去重不再调用模型、A/B 项目 dream/learning 双向隔离、非法 evidence ID 失败且 B 无记录、silent 决策完成且不落盘。managed profile 同时校验两个插件及目标 LLM 入口 SHA-256。
- 未关闭项：旧 CowAgent memory/dream/learning copy-on-write 导入、跨新会话召回、项目 rename/move 正向路径、迁移收据和旧定时任务到目标 schedule 插件的禁用态导入尚未完成；S09 继续进行，不以本片替代迁移验收。

## 2026-08-15 · S10 生图/改图云端权威 Job 适配

- 复用结论：最终 e-Mate 2.0.5 已经有严格的云端 `/api/v1/images` Job/CAS/租户隔离合同；本片没有搬旧 Python `imagegen` provider runner、模型 Key、provider fallback 或第二套本地任务状态。Host 只通过 `emateIdentity.request` 调用该既有面，前端仍只看 Harness Tool/Job/Attachment 真值。
- Tool 合同：新增目标 Tool `imagegen`。单任务接受 prompt 与当前会话 attachment ID；2–8 个独立输出接受互斥的 ordered `tasks`，本地同时最多发起四项，其余并发、公平队列、重试和 provider 幂等继续由云端权威服务控制。generation 固定提交本地槽 `gpt-image-2`，retouch 固定 `gpt-image-2-edit`，调用参数不暴露 provider/model/Key。
- 输入/结果边界：编辑引用只从当前 Agent 的权威 `session.deriveMessages()` 查找完整 AttachmentRef，再由 `ctx.attachments.readImage` 读取校验字节并按 SHA-256 上传。远端完成后同时核对终态、local model、MIME、大小、Content-Length、ETag、声明摘要和实际摘要，最后才通过 `ctx.attachments.saveImage` 形成真实 ImageBlock。部分批次失败保留成功兄弟，全部失败才使 Tool/Job 失败。
- 目标 Job：一次 `imagegen` Tool 调用对应一个 owner-scoped `emate-image` Harness Job；取消向同一 AbortSignal 传播，并对已经提交的远端 Job 做 5 秒有界取消。Job 输出只含数量和远端 Job ID，不含 prompt、图片字节、路径或凭据。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 为 22/22。新增组合测试使用真实 `LocalAttachmentStore` 和目标 `defineTool`，证明单张 generation、当前会话引用 retouch、两任务实际并发、固定 model slot、输入上传摘要、结果四重完整性、ImageBlock renderer、目标 Job 终态和跨会话不存在附件引用的拒绝；插件源静态禁止直接 `fetch`，profile 安装/LLM/Runtime 回归同时通过。`pnpm check:target` 与 `git diff --check` 通过。
- 生产阻塞：轮换后的生产身份材料、经验证的 Image API HTTPS root、真实 provider/计费/usage receipt、单次改图和至少两项并发 live 验收仍不存在，因此未把 fixture 记为生产生图通过。默认 profile 在 root 未配置时不注册 Tool，绝不根据已泄露材料或服务器地址猜路径。能力中心真实 image 图标与通用图标元数据仍未闭环，S10/S12 保持进行中。

## 2026-08-15 · S08 旧会话到目标 SessionPersistence

- 结构复用：迁移没有建立 `sessions.sqlite3`、消息 Store 或 e-Mate 事件协议。`e-mate setup` 动态加载固定 Harness 的 `Context`、`SessionStore` 与 `JsonlSessionPersistence`，直接写入 `$DSH_HOME/sessions`；profile 中的 `emate-legacy-migration` 只注入同一个 `sessionPersistence` 作为首次启动兜底。
- 来源优先级：先读 `~/.emate/state/runtime.sqlite3`，再读平台 ECoreX Runtime，最后读 CowAgent 会话库。Runtime 只选 `status != deleted`；UI cache、删除记录和浏览器状态不是恢复源。当前 e-Mate Runtime 的同身份记录压过旧 ECoreX/CowAgent。
- 只读边界：DB/WAL 经 no-follow 文件描述符读取，复制前后核对文件身份、大小与 SHA-256，SQLite 只打开 mode-0600 私有快照并执行 `integrity_check`。源 DB/WAL 未被 SQLite 打开、checkpoint 或修改；损坏、换链、并发变化、schema 缺失、孤儿消息和同级身份冲突均在目标写入前失败。
- 目标事件：确定性 Session/Message ID、真实 `turn/start|end`、`user/message`、`step/start|end`、`assistant/message` 和 `session/title` 直接使用目标格式。非完成旧 Turn 统一标为 `interrupted`；旧 Tool/Artifact 行只写本地 mode-0600 历史证据，不伪造成目标执行。
- 项目绑定：只有绝对旧项目路径进入不可变 SessionHeader `cwd`，由目标 WorkspaceRegistry 后续按 canonical path 接管；相对或含糊路径不提升为项目权威。空且无标题的旧会话只写一个 ignorable 迁移证据事件以物化目标 Header，不伪造用户消息。
- 幂等事务：先校验所有已存在目标 ID 的完整 Header/Event digest，再写任何缺失 Session。中途失败不写最终收据；重跑只复用完全一致批次。最终收据只含哈希身份和摘要，位于 `$DSH_HOME/e-mate/migrations/legacy-sessions-v1.json`。
- 附件/CAS：CowAgent extras 与当前 Runtime artifact projection 中的普通文件经根目录、全路径无链接、受保护目录、512 MiB、大小和 SHA-256 校验后，复制到 `$DSH_HOME/e-mate/attachments/legacy-v1/objects`。Session 只追加 ignorable `emate/legacy-artifacts` 证据；缺失/远程/内部/未就绪/越界文件明确标记 unavailable，绝不伪造目标 ImageAttachment。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 完成 TypeScript 构建并 26/26 通过；新增测试使用真实目标 JSONL backend，证明 CowAgent 重放幂等、ECoreX deleted thread 不复活、绝对项目 cwd 保留、CowAgent 与 Runtime 产物字节进入内容寻址对象且源 SHA 不变、缺失产物保留 unavailable、旧 Tool 不生成 `tool/call`、损坏 SQLite 在创建 Session 前失败关闭，以及任一已有稳定 ID 冲突时不会先导入另一个缺失 Session。
- 未关闭项：导入产物的浏览器历史 renderer/download、非默认旧 artifact root、CowAgent memory/dream/learning copy-on-write、禁用态 schedule 导入、真实发行版 WAL/项目移动样本和浏览器继续对话尚未完成，因此 S08/S09 保持进行中。

## 2026-08-15 · S08/S09 导入产物展示与 CowAgent 记忆迁移

- 产物展示复用：`emate/legacy-artifacts` 由 e-Mate 浏览器 Cordis 模块注册 `conversationEvents` Definition 和 keyed `conversation.chat.node` renderer；中央聊天目录没有新增事件类型、工具名或能力 ID 分支。可用项显示真实下载动作，不可用项保持原因可见。
- 下载边界：`emate-legacy-migration` 在既有 Harness `webServer` 上注册 loopback `GET/HEAD`。请求只接受 64 位 SHA-256，Host 以 no-follow 普通文件重新打开 CAS 对象、完整复算摘要后流式发送，并返回 `private, no-store` 与 `nosniff`；篡改对象返回 404。
- 记忆来源：最终 e-Mate 默认 `~/ECoreX` 优先，只有它没有记忆权威时才考虑 `~/cow`。导入 `MEMORY.md`、普通 `memory/**/*.md`、`memory/dreams/**` 和 `memory/evolution/**`，分别映射到目标 `memory/dream/learning`；索引库、隐藏目录、符号链接和无效 UTF-8 不进入目标。
- 项目绑定：只有源目录 canonical path 与目标 `WorkspaceRegistry` 的现有 workspace 完全一致才导入。记录沿用目标 `workspace ID + path SHA-256` 作用域，因此同项目另一个 Header-validated Session 可召回，项目 B 与无归属 Session 均不可见；插件不会新建 Workspace 或猜测绑定。
- copy-on-write 与幂等：源文件不修改；目标记录使用确定性 UUID/source digest，写前校验全部已存在身份。`legacy-memory-v1.json` 只留源/路径摘要、workspace identity、记录 identity 与阻塞清单。完成后源变化会失败关闭，不静默覆盖目标。
- 账号隔离：旧 `memory/users/<id>` 没有权威企业账号映射，因此不提升成 workspace shared；receipt 仅记录其哈希并保持阻塞。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 为 28/28。真实 Harness JSONL、WorkspaceRegistry、Storage Domain、浏览器下载 HTTP 测试证明附件字节/SHA、篡改拒绝、源文件不变、记忆三类导入、重复运行全复用、完成后源漂移拒绝、跨同项目 Session 召回及 A/B 隔离。
- 仍未关闭：非默认旧 Runtime artifact root、旧 user-memory 企业身份映射、禁用态 schedule 导入、真实 macOS/Windows 历史样本、项目移动正向流程和浏览器继续对话验收；S08/S09 继续进行。

## 2026-08-15 · S09 旧定时任务禁用态迁移与目标 Schedule 激活

- 目标能力审计：子代理只读核对固定 Harness rc.5。默认组合只有 `web_search`；`web_fetch` 包存在但 base 明确关闭且没有 fetch provider；Office/PDF、OCR、真实 Chromium Computer Use Tool 均不存在。因此保留 e-Mate 的薄 Office/OCR/Chromium 适配，仍强制走目标 Tool/Job/Attachment/Subprocess/Session 事件，不删除缺失能力，也不搭第二套运行架构。
- profile 偏差修复：发现既有 `cordis.patch.yml` 的 `emate-legacy-migration`/`emate-agent-operations` 缩进已破坏，旧测试只做字符串正则而未解析 YAML。已恢复为单一合法 `insert`，并让 `profileCheck` 实际解析 patch、校验关键行；目标 CLI `--dump-config` 真实输出 `schedule`、`emate-schedule-import`、`emate-legacy-migration` 与 `emate-agent-operations` 四个预期 Loader 行。
- 目标 schedule 复用：managed profile 直接组合官方 `@deepseek-ai/dsh-schedule`。e-Mate 不写 `schedule/change`、不实现 timer/recurrence/dispatch/冷会话唤醒。旧 store 只进入 `$DSH_HOME/e-mate/migrations/legacy-schedule-v1.json` 的 mode-0600 禁用目录；live 激活通过同一 Agent/Root Call/AbortSignal/Tool token 嵌套目标 `schedule_list` 和 `schedule_create`。
- 迁移边界：已覆盖已知 e-Mate/ECoreX/CowAgent roots，16 MiB/10,000 task 上限、no-follow 稳定读取、UTF-8/JSON、map/body ID 一致、源/DSH_HOME 隔离、source fingerprint、receipt schema/边界/激活唯一性。源 cron、小于五分钟 interval、无明确时区 one-shot、无效规则和未知 action 保持 disabled+blocked，不做近似转换；旧 receiver/channel 不提升为新投递权威，目标只在用户确认的当前 Session 内送达。
- 确认与崩溃恢复：Agent 必须先列出任务，再等待后续真实用户消息逐字回复 `确认启用 <legacy-task-id>`；同一轮请求确认时不得启用。唯一 prompt marker 与目标 `schedule_list` 可在目标 create 已落盘、本地 activation receipt 尚未写入时完成对账，防止重试重复创建；同一 Session 已记录激活时保持幂等。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 完成 TypeScript/TSX 构建并 30/30 通过；测试证明四类旧规则分类、源 SHA 不变、重复导入全复用、源漂移失败关闭、篡改 receipt 拒绝、未确认零目标调用、确认后真实嵌套 list/create、Agent/token 继承、重复确认不重复创建。`pnpm check:target`、`git diff --check` 和新增文件行尾检查通过。另以临时 DSH_HOME 启动真实 `e-mate web`，health 返回 `e-Mate/2.0.7/e-mate/active_runs=0` 后优雅停止。
- 仍未关闭：旧 Runtime 非默认 artifact root、旧 user-memory 企业身份映射、真实 macOS/Windows 历史 schedule/WAL/项目移动样本和浏览器继续对话；这些仍是 S08/S09/S12 发布门槛，不能由受控 fixture 替代。

## 2026-08-15 · S07 目标模型策略与异步旁路审计

- 模型策略复用：`emate-model-policy` 原位包装目标 `apiProxy.sessions.models`、`session.selectModel`、`llm.models` 与 `agent/request`，没有新增 WebUI 接口、模型 Store 或 LLM 调度器。浏览器多选清单、单会话选择和最终 provider 请求都落在目标现有路径；生图/改图 Tool 同样在创建目标 Job 前检查固定 image slot。
- 策略闭包：只接受 2.0.7 固定五个 chat 映射与 image 路由、非空 `allowed_model_ids`、允许集合内 default、正 revision、最长 32 天有效期、receipt 和 canonical payload SHA。缓存写入目标 Storage Domain，只能由相同账号摘要且未过期的策略在企业断连时复用；跨账号、过期、映射漂移和被禁模型全部失败关闭。RPC 只返回无敏感状态，不返回原始账号 subject。
- 审计投影：`emate-audit` 从目标 `agent/request` 捕获真实 provider/model 与账号策略 receipt，从目标 `assistant/message` 的 provider usage 形成稳定 `e-mate-audit` fact；SessionPersistence 只用于启动回放，Storage Domain 保存 binding/outbox。payload 不含 prompt、answer、账号明文、Session 明文、路径、附件或凭据。缺失/冲突绑定及零 usage 保留为 blocked，不猜归属。
- 非阻塞合同：Session event 只排队本地写入；上传、重试和启动 backfill 均异步运行，所有异常只记录摘要错误码，不能改变 Agent 结果。provider 回执必须逐项精确匹配 fact ID 与 payload SHA；失败保持 pending，重复事件与重复投递不新增 fact。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 完成 TS/TSX 构建并 32/32 通过；新增目标 ApiProxy/agent request/model selection、跨账号 cache、image policy、真实 usage/outbox/replay/retry/receipt/status 组合测试。`pnpm check:target` 与 `git diff --check` 同时通过。
- 实机启动修复：全新临时 `$DSH_HOME` 首次启动暴露 tsdown 为 dream/learning 生成的共享 `reflection-runtime-*.js` 未被原白名单复制，导致 Loader 在测试之外失败。根因修在唯一 `installProfile` 路径：自动复制 `profile/plugins` 的全部顶层生成 JS（入口及共享 chunk），嵌套 identity/shell 资产继续走显式映射；回归会从已安装 dream import 解析依赖并逐项确认存在。修复后真实 profile dump 包含 identity/model-policy/audit，Harness Web 在 `127.0.0.1:55217` 启动，health 返回 `e-Mate/2.0.7/e-mate/active_runs=0`，深链标题为 `e-Mate`，随后用 SIGINT 优雅停止。
- 未关闭项：生产企业审计 ingest/receipt、provider usage ledger、周配额扣减与 usage panel 目前没有经过验证；现有 `/api/v1/usage` 只证明读取投影，不能被当成上传接口。真实账号、轮换凭据和生产 endpoint 缺失时，provider 不接入、outbox 保持本地 pending，S07/S12 继续进行。

## 2026-08-15 · S03 真实事件活动组与首轮 Design QA

- 结构复用：聊天覆盖继续使用目标 `conversationEvents.register` 和 keyed `conversation.chat.node` renderer。新增的 `e-mate-activity-group` 只消费真实 `turn/start`、`tool/call`、`turn/end`，稳定身份沿用目标 turn/seq；没有前端 `fetch`、WebSocket、EventSource、超时伪状态、第二套 Store 或 Tool 名称分发表。
- 交互闭环：一组活动只显示一个由真实起止时间计算的“正在工作/已处理”标题。已完成历史默认折叠，按钮使用目标图标并维护 `aria-expanded`；只折叠全部为 `ok` 的目标 Tool/Command 行，pending、失败、审批、取消证据不得被隐藏。正常回答继续位于活动组之后，目标原有 terminal `用时` 只在同一 turn 已由该真实活动标题承载时隐藏。
- 真实 Web 证据：隔离临时 DSH home 中创建目标 JSONL SessionPersistence 会话，写入真实 turn/user/tool/result/assistant/end 事件；浏览器通过目标 WorkspaceRegistry 打开。`1280×800` 下完成态默认显示“已处理 1分18秒”、隐藏两条成功 Tool 行且保留最终回答，点击后两条 Tool 行展开，再次点击折叠。夹具与临时身份 provider 均未进入产品仓库，也不计作生产 Computer Use。
- 视觉迭代：首次比较发现目标 terminal 时间位置、活动组归属和折叠层级与 `019ff665…/09-timer-placement.png` 不一致。修复后将源图和实现截图放入同一 `900×520` 比较图复核，该聚焦区域的 P1 已关闭；证据位于 `artifacts/design-qa/S03-chat-activity/`。
- QA 记录：新增根目录 `design-qa.md`，明确源真值、像素/视口、交互、五个必查视觉面、迭代历史和剩余阻塞。当前总结果仍为 `blocked`：运行/失败/审批/取消/重试、长文本同 DOM 折叠、图像/产物、五断点、亮色、同状态全屏源图和 reload console trace 尚未齐全。
- 主进程门禁：`pnpm --filter @e-mate/dsh test` 完成两段 TypeScript/TSX 构建并 32/32 通过；`pnpm check:target` 和 `git diff --check` 同时通过。静态合同覆盖真实事件类型、Conversation Node 注册、折叠标记，以及聊天模块无 `fetch`/WebSocket/EventSource/伪 timeout 和 Tool/能力 ID 分支。

## 2026-08-15 · S03 长文本同 DOM 折叠与浏览器复验

- 结构复用：`e-mate-message-disclosure` 继续注册到目标 `conversationEvents` 和 keyed `conversation.chat.node`。它只匹配持久的 `user/message`、`assistant/message` append-surface 事件，并定位目标已经渲染的消息 DOM；没有新增通信协议、消息 Store、Markdown renderer 或按工具名分支。
- 交互合同：用 `ResizeObserver` 和真实 `scrollHeight > 160` 判定长文本；折叠/展开只切换同一 Markdown 元素的展示属性。控制按钮 portal 到该元素内部，因此折叠态位于卡片底部、展开态位于卡片右上角，同时 `aria-expanded` 和 `aria-controls` 精确指向原元素 ID。
- 视觉复验：将 `019ff665…/15-long-text.png` 与真实 Harness Web 的折叠、展开截图分别合成同一比较输入。首版单独控制行的位置偏差已修正；最终实现保留源图的 `长文本摘要`、边框、底部渐隐、居中展开和右上收起层级。证据位于 `artifacts/design-qa/S03-chat-activity/focused-long-text-comparison.png` 与 `focused-long-text-expanded-comparison.png`。
- 浏览器实测：assistant 折叠时 `clientHeight=198`、`scrollHeight=1696`，展开后 `clientHeight=scrollHeight=1654`；按钮在展开后位于卡片右上角，控件 ID 与 Markdown ID 完全一致。稳定重载时间窗内 warning/error 为 0；更早的 `connection lost, retry` 仅由 QA 主动重启本地服务产生。
- 门禁：最新 portal 变更完成 TypeScript/TSX 构建，`pnpm --filter @e-mate/dsh test` 为 32/32；目标 pin 检查和 `git diff --check` 同时通过。静态合同锁定真实消息事件、`scrollHeight > 160`、展开属性、精确 `aria-controls`，并禁止私有 transport/timeout。
- QA 状态：长文本 P2 已关闭；运行、失败、审批、取消、重试、亮色、五断点、图像/产物和同状态全屏源图仍未齐全，`design-qa.md` 总结果保持 `blocked`。

## 2026-08-15 · S03 五类真实状态与重试态 Design QA

- 目标真值：运行、审批和 scheduled retry 由临时 profile 插件直接创建目标 `SessionStore` 的开放 turn/step，并通过真实 `WorkspaceRegistry.attachSession` 进入浏览器；失败、取消和 terminal retry 从目标 JSONL SessionPersistence 重放。夹具仅在隔离 `/tmp` DSH home，产品源码没有状态生成器、私有传输或假 Tool。
- 状态闭环：运行态耗时随真实 `turn/start` 递增；审批使用目标 answerable `approval/requested` 帧和 `/api/respond`，浏览器点击“拒绝”后面板真实消失且 composer 恢复；failed/cancelled 保留 Tool 与 turn-error 证据；scheduled retry 显示真实 `(1/3)` 延迟并仅在活动时运行动画，持久 terminal retry 为静止态。
- 根因修复一：目标 turn tail 不一定紧邻 activity node，原定位会在失败/取消保留复制、反馈、分支和 terminal `用时`，形成没有正常答案却有答案动作的假尾部。现在按同一 turn 的稳定 `data-turn-tail` 在全 flow 定位，并只对 `failed/cancelled` 隐藏该尾；partial commentary、失败 Tool 和 turn-error 继续可见。
- 根因修复二：长文本 assistant 样式只检查 kind，导致所有短 assistant 文本被套上 `长文本摘要` 卡。消息卡/边距/头部规则现同时要求浏览器真实测量后的 `data-emate-long-text`；五类状态浏览器实测短卡计数均为 0。
- 高保真证据：`04-running-activities.png`、`10-state-supplement.png`、`14-motion-sequence.png` 与 `implementation-{running,approval,failed,cancelled,retry,retry-active}-1280x800.jpg` 已分别检查；运行、审批、失败、活动重试均形成同一输入内的 focused comparison。审批继续位于目标 Harness `conversation.composer` 插槽，不为贴图另造第二条 UI/CLI 状态路径。
- 主进程证据：最新产品变更完成两段 TS/TSX 构建，`pnpm --filter @e-mate/dsh test` 为 32/32；`pnpm check:target` 与 `git diff --check` 通过。真实浏览器最后一次稳定 reload 的 warning/error 时间窗为 0。
- QA 状态：运行、审批、失败、取消、活动重试和 terminal retry 的状态 P1 已关闭。亮色、五断点、图片/产物/未知 renderer 和同状态全屏源图仍未齐全，`design-qa.md` 总结果继续为 `blocked`。

## 2026-08-15 · S03 目标图片 Gallery 与未知内容兜底

- 目标复用：没有新增图片事件、附件接口、Gallery、lightbox 或加载状态。浏览器继续使用 Harness `AssistantMarkdown → ImageGallery → MessageImage`，连续真实 ImageBlock 自动成组，字节读取仍由 session-authorized attachment loader 完成。
- 视觉修正：真实浏览器首次显示两个 `64×64` 目标默认 tile，与 `03-image-group.png` 的等权可读图片明显不符。e-Mate 只在 `assistant-step/[data-align]/[data-variant=tile]` 语义边界覆盖为 `clamp(112px, 18vw, 156px)` 正方形；`1280×800` 实测两张均为 `156×156`，没有按 Tool 名、能力 ID、附件名或数量分支。
- 交互闭环：两个真实 PNG 经目标 `attachments.saveImage` 进入持久会话，点击首图打开目标“原图预览”，关闭动作恢复对话。另一个真实持久会话写入未知 content type，目标通用 JsonBlock 默认显示“未知内容块”，点击后完整展示 payload，页面与 composer 不崩溃。
- 高保真证据：`03-image-group.png` 与 `implementation-image-gallery-1280x800.jpg` 已合成为 `focused-image-gallery-comparison.png` 后共同复核；未知块证据为 `implementation-unknown-renderer-1280x800.jpg`。临时会话/附件只存在隔离 `/tmp` DSH home，不进入产品包。
- 主进程门禁：`pnpm --filter @e-mate/dsh test` 完成 TS/TSX 构建并 32/32 通过；静态合同锁定语义选择器和响应尺寸。`pnpm check:target`、`git diff --check` 同时通过。
- QA 状态：图片分组、原图预览和未知 renderer 项已关闭；Office/文件纵向产物、亮色、五断点及同状态全屏源图仍未齐全，Design QA 总结果保持 `blocked`。

## 2026-08-15 · S03 迁移文件产物纵向排版与下载闭环

- 目标复用：继续使用 `emate/legacy-artifacts` 的 keyed Conversation Node renderer 与既有 loopback 下载合同；聊天中央目录没有增加 artifact 类型判断、文件 Store 或 WebUI–CLI 通讯。夹具由两个真实项目文件经迁移 CAS 进入目标持久会话，不是前端假数据。
- 视觉修正：首次浏览器证据显示平灰历史附件卡，与 `019ff665…/13-artifact-layouts.png` 的深色抬升面、标题分区和同类纵排层级不一致。仅在插件自己的 CSS 中改用既有 layer token、标题分隔线和行间分隔；下载、identity、事件和 renderer 注册均未变化。
- 组合复验：源图“文件与文档”区域与 `implementation-file-artifacts-1280x800.jpg` 合成为 `focused-file-artifacts-comparison.png` 后共同检查。实现保留 `历史附件` 文案以避免把迁移证据伪装成新 Office 结果，文件名、大小和纵向下载动作清晰可见。
- 字节闭环：一个 11.6 KiB 对象的 `HEAD/GET` 均返回 200；`Content-Length=11920`，响应具备 attachment、`private, no-store`、`nosniff`，GET SHA-256 为 `7875afd86953be4262bbe4440f5c009daaf6afac3b7d3a3153e6a20544568fec`，与 CAS 真值一致。
- 稳定性：最后一次浏览器稳定重载从 `2026-08-14T19:39:26.732Z` 起 warning/error 为 0。该片关闭的是旧会话文件产物展示与下载，不代表 Office create/edit 的新 Tool-result 产物区完成；后者、亮色、五断点和同状态全屏源图仍阻塞 Design QA。

## 2026-08-15 · S03/S10 Office 新产物复用目标 turn-tail

- 结构复用：没有用 `tool.call.toolview` 复制一张产物卡；该插槽仍只承载活动组内的目标通用 Tool 行。Office 定义通过 Harness 原生 `output.presentationMeta` 投影已验证的 artifact ID、格式、大小、摘要和下载 URL，目标 Session `tool/result.meta` 原样持久化并在重放时恢复。
- 终态位置：浏览器插件新增一个无 View Node 的 turn-scoped `ConversationNodeDefinition`，只折叠 append-surface 的真实 `tool/result.meta` 到目标 `ConversationTurnDataMap`；`conversation.chat.turnTail` 的 chain selector 在 closing Assistant 后挂载 `文件与文档`。因此顺序真实固定为活动组、正常回答、产物区、目标答案动作，没有新事件类型、前端 Tool 名分支、artifact Store、HTTP/WS 或 WebUI–CLI 协议。
- 视觉证据：打包 Runtime 的真实 Office Worker 生成 `e-Mate-Office-acceptance.docx`；浏览器显示 `DOCX · 35.9 KiB`，与 `13-artifact-layouts.png` 合成为 `focused-office-artifacts-comparison.png` 复核。完整界面为 `implementation-office-artifacts-1280x800.jpg`。
- 下载与重放：`HEAD/GET` 均为 200，`Content-Length=36711`、DOCX MIME、attachment、`private, no-store`、`nosniff` 全部正确，GET SHA-256 为 `2df4bb0f5365332913d2a62456c87baa9548a0c4d5f3203396bc3eaa189f42ff`。刷新后同一 artifact ID、文件名与下载链接仍存在；从 `2026-08-14T19:49:29.161Z` 起 warning/error 为 0。
- 主进程门禁：新增 Host presentation meta、turn data selector、chain renderer 和静态无私有传输断言后，`pnpm --filter @e-mate/dsh test` 完成 TS/TSX 构建并 32/32 通过。该证据关闭 `1280×800` Office create 产物展示/下载，不替代 edit/read/export、并发、五断点、亮色和正式 Computer Use 组合验收。

## 2026-08-15 · S01/S13 三平台发布载体与真实 npm 组合安装

- 目标复用：发布器沿用固定 Harness 的 pack-byte、registry integrity、同版本幂等和平台包先于主包语义；e-Mate 只加入自身七包的精确清单、S12 accepted-SHA gate 和证据汇总，没有创建第二套更新协议或让 WebUI 直接安装 npm。
- 三平台载体：新增 Node 24 CI 与手工 release workflow。平台矩阵固定为 `macos-15`/darwin-arm64、`macos-15-intel`/darwin-x64、`windows-2025`/win32-x64；每个平台只构建 Runtime 与 Browser 匹配包。主包独立打包后与对应二包进行仓库外 npm 全局安装；publish 仅接受同一 workflow 生成的 tarball，并按六个平台包、主包、registry 回读/再安装顺序运行。
- 供应链证据：`scripts/release.mjs` 对七个 tarball 校验 name/version/license/public/os/cpu、Harness commit/version、精确 optionalDependencies 和资源 manifest，生成 SHA256SUMS、release manifest、SPDX 2.3 SBOM、第三方许可证汇总与 evidence SHA。Runtime manifest 现在保留每个 Python distribution 的 license/source metadata；主包随包携带目标 pin 与直接依赖 notice。
- 真实安装：本机实际 tarball 为主包 57 MiB、Runtime 135 MiB、Browser 90 MiB，SHA-256 分别为 `053419caa62523a9dae2286a3847a466e2ad03e9b3e6a718cce4287b226fc200`、`9eff1a480b560c16f2c5cf45fb6b2b53959bef730fe54fca6bba28fb32a7e856`、`eb8cf693a98119a761865b8dd193fc97b7714728fe10d92d95885dde2f1a15a2`。三个包安装到全新外部 npm prefix 后，在全新 `DSH_HOME` 执行 setup，Node/platform/Harness/Runtime/Browser、SQLite、credential store、profile、Office Worker、OCR 模型和 Chromium headless 检查全部通过，快捷方式写入隔离 Desktop。
- 根因修复一：Unix npm `--prefix` 的全局包目录是 `npm root --global --prefix <prefix>` 返回值，不能假设为 `<prefix>/node_modules`。clean-install 与 registry-install 现在都向 npm 查询真实 root，Windows 同样不拼接路径。
- 根因修复二：真实 setup 的默认旧源发现触发 `ERR_INVALID_ARG_TYPE paths[2] Array`。唯一根因是把变参 `path.resolve` 直接传给 `Array.map`，index/array 被误作路径参数；改为单参数回调并增加默认空发现回归。主包测试现为 33/33，release carrier 测试为 3/3。
- 未关闭项：workflow 尚未在 GitHub 的 darwin-x64/Windows runner 实跑，Windows Worker Job Object 等价内存边界仍未证明；没有 S12 accepted SHA、npm 发布凭据、真实生产 Computer Use/企业对账，故未发布任何包、未覆盖下载/管理/审计 URL，S01/S13 继续进行。

## 2026-08-15 · S02 响应式壳、身份快照与能力中心离线隔离

- 名称与架构防漂移：项目和产品继续统一为 `e-Mate`；本片没有创建 `e-Mate Harness` 品牌、第二套 WebUI Store、HTTP/SSE/WebSocket 或 CLI 通讯协议。页面仍通过目标 Harness Connection RPC、Workspace/Session、Settings 和 Slot 所有权工作。
- 目标能力审计：固定 Harness rc.5 只将 `web_search` 作为默认可用能力；`web_fetch` 虽有原生包但 base profile 明确关闭且未挂 provider，真实 Chromium Computer Use、OCR、Office/PDF 工具均不存在。因此 Office/RapidOCR/Chromium 平台闭包不能删除；它们继续作为 e-Mate Cordis 插件复用目标 `ctx.tools`、`ctx.subprocess`、`ctx.attachments` 和能力注册表。用户安装侧仍不运行 pip、浏览器二次下载或原生编译。
- 能力中心根因修复：原 loader 将本地 `/emate.capabilities/list` 与远端 `emate.skillHub/catalog.search` 放在同一个失败域，远端 HTTP 500 会导致已验证的本地卡永远不提交。现在本地注册表先进入 React state，Skill Hub 独立失败、清空社区结果并显示真实错误；没有缓存、重试或伪成功。真实浏览器复验在远端 500 时仍显示 Office、OCR、浏览器三张卡。
- 当前能力缺口：浏览器同时证明注册表目前只有 Office、OCR、浏览器三项。生/改图 Tool 已存在但尚未注册能力元数据；飞书、腾讯文档、微信、钉钉的目标插件还未完成。八项清单因此继续阻塞，禁止用静态卡、空按钮或旧项目连接实现冒充完成。
- 身份快照根因修复：登录页原来只更新自身 `IdentityGate` state，侧栏用户中心和设置分别保留旧 bootstrap，造成同屏“已登录/未登录”冲突。有效 RPC 回执经 `validBootstrap` 验证后现在先恢复受保护 History，再重载目标页面，由所有消费者重新调用同一 bootstrap；没有新增全局身份 Store。浏览器退出进入 `/login`，未登录直达一个真实 `/chat/:sessionId` 后登录会恢复该会话，用户中心立即显示同一“本地验收用户”。
- 路由投影：固定 Harness 没有 Browser Router，只有 SPA GET fallback。e-Mate 因此没有引入 Router；`/chat/:sessionId` 只在目标 Session list `ready` 后调用 `ctx.sessions.open/clear` 并订阅其真实 `current` 投影 History，未知 ID 失败关闭到 `/`；`/settings` 只给目标 Settings trigger/close/content 增加生命周期 marker，由 `popstate` 点击目标真实按钮，SettingsRoot 仍唯一持有 modal open。真实会话的直达、刷新、返回、前进和未知 ID通过；设置的直达、关闭、返回、前进和 Escape 通过。
- 响应式证据：真实 Harness Web 在 `320×800`、`390×844`、`768×800`、`1280×800`、`1440×900` 和 `1920×1080` 检查 Home；合同断点覆盖浅/深主题，全部实测 `scrollWidth === clientWidth`。`320px` 抽屉宽 `288px`、四周 `8px` inset，关闭按钮可见；能力中心、设置与登录的可见交互完成，`/capabilities`、`/settings`、`/chat/:sessionId` 的对应深链/History 合同按上述边界通过。证据位于 `artifacts/design-qa/S02-responsive/`。
- 视觉边界：历史 `docs/v0.*`、`docs/v1.*` 截图按 `docs/ui-fidelity-map.md` 明确禁用，不能作为 2.0.4/2.0.5 最终真值。本片因此只关闭响应式运行证据，不对缺失的任务同状态最终截图作近似像素评分；`design-qa.md` 继续为 `blocked`。同一丰富聊天/Office/图片状态尚未在五断点双主题重放。
- 主进程门禁：五处独立根因修复（本地/远端能力失败域、身份统一快照、身份深链恢复、设置路由、会话路由）均由主进程审阅并串行重跑 `pnpm --filter @e-mate/dsh test`，完成两段 TypeScript/TSX 构建并 35/35 通过；`pnpm check:target` 与 `git diff --check` 通过。随后把新 bundle 放入既有隔离 npm 安装 profile 做真实浏览器复验。验收身份 provider、route Workspace/Session 只存在隔离 `$DSH_HOME`/临时目录，不是产品代码、生产凭据或生产企业验收。

## 2026-08-15 · S10 生图能力注册失败关闭

- 能力中心闭环：`emate-image-generation` 现在无论企业生图端点是否存在都会向同一 `emateCapabilities` 注册元数据。未下发地址时为 `setup-required`，非法地址为 `blocked`，两种状态均不暴露动作；能力不再从八项内置清单静默消失，也不会用空按钮冒充可用。
- 运行边界：只有固定 HTTPS `/api/v1/images` 地址验证通过才注册既有 Harness `defineTool`、Job controller 和 Attachment 结果链。未配置状态不会加载身份、模型策略或 Tool，不猜测生产路径，也未调用任何真实或付费生图服务。
- 资产边界：能力元数据只引用浏览器插件已经随包提供、且与固定 e-Mate 2.0.5 最终源字节一致的 `/assets/e-mate/mark.png`；Office、OCR、Browser 原先不存在的图标 URL 同步收敛到该受管资产，消除 404 和占位图。
- 定时器根因：image Job 轮询的延迟 Promise 原先对定时器调用 `unref()`，在没有其他活动句柄的测试/CLI 上会让事件循环提前结束。现由受管轮询计时器保持 Job 生命周期，Abort 仍会清理定时器并拒绝；未增加第二套调度器。
- 主进程证据：TypeScript/TSX 构建及 `pnpm --filter @e-mate/dsh test` 完成 36 项回归，新增测试锁定生图卡的 `setup-required/blocked` 状态、无动作和受管图标；目标 pin 与 diff 检查同批执行。隔离 Harness Web 重启后真实能力 RPC 返回四项卡，生/改图显示 `setup-required`、无按钮，Office/OCR/Browser 保持 `ready`；受管 `mark.png` 的 HEAD 为 200、长度 479134。协议签署层没有被自动确认或绕过。真实生成、改图及并发仍需轮换后的企业端点和用量回执，S10/S12 未关闭。

## 2026-08-15 · S11 四类外部连接目标能力审计

- 目标复用结论：四类连接都不是固定 Harness 或当前平台 Runtime 的内置能力。落地必须是一个共享 TypeScript Cordis 插件，复用目标 Credentials、Storage Domain、Tool、Job、Connection RPC、Settings Slot、Capability Registry；旧 Python Runtime、SQLite Store、Dispatcher、全局绑定、mcporter 和企业 Managed Connector Gateway 均不迁移。
- 飞书：旧本地 App Bot 只有消息收发闭环，文档/Drive 依赖旧托管网关。2.0.7 先实现本地消息 Bot；文档/Drive 在本地 OAuth、scope、刷新和官方 API 完成前保持阻塞。旧 MIT 行为合同和 `lark-channel-sdk` notice 可作验证依据，不直接搬 Python 实现。
- 腾讯文档：继续以官方 MCP endpoint 和目标 `dsh-mcp-client` 的发现/调用为唯一运行面。目标当前静态 header 配置会把 Bearer 暴露在 Cordis config，因此先补 credential-reference OAuth/header 组合；旧无 LICENSE、未通过 execution attestation 的 Skill ZIP 禁止复用。
- 微信：保留设备扫码的 pending/scanned/confirmed/expired、取消、刷新和消息收发合同，但 iLink 的公开授权与服务条款尚无本地证据。法务/产品确认、真实扫码账号和可逆发送目标缺失时保持阻塞。
- 钉钉：保留 App Credential、官方 gateway/WSS、健康和消息幂等合同；旧 `dingtalk-stream` 缺第三方许可证条目，不进入发布包。实现需使用官方协议与精确锁定、许可证清楚的 TS 依赖。
- 凭据前置：目标 `credentials-local` 明示同 UID 进程可读且 Keychain provider 尚未交付，不能满足发布合同。下一片先以相同 `CredentialProvider` 接口实现 macOS Keychain/Windows CurrentUser DPAPI，保留环境变量只读优先级，不另建 vault。
- 验收边界：缺真实应用、授权账号、法务许可、OAuth token 或可逆测试目标时，不注册 ready Tool，不以静态卡、空按钮或近似 API 冒充开箱即用。企业端仍只保留 identity/modelPolicy/audit，外部连接凭据、状态、授权和执行全部留在本机。

## 2026-08-15 · S11 OS 凭据 Provider 目标接线

- 目标复用：`emate-credentials-os` 直接继承固定 Harness 的 `CredentialProvider`，继续使用同一 `credentials.describe/set/unset` API、Connection 传输和 `launchEnvironmentOf` 分层；没有新增 Vault、REST、WebSocket、前端 Store 或凭据协议。profile 显式禁用原 `@deepseek-ai/dsh-credentials-local`，再插入 OS Provider，真实 `--dump-config` 已证明两者不会同时提供服务。
- macOS：凭据写入固定 service `net.ecoremedia.e-mate.credentials.v1` 的 Keychain。`security -w` 的双提示由系统自带 Expect 驱动；引用名在 POSIX credential 边界验证后才进入固定 Tcl，secret/base64 只经 stdin，不进入 argv、脚本、日志或响应。读取只返回本地 Provider，浏览器 `describe` 仅返回 configured/source/writable。
- Windows：凭据以 CurrentUser DPAPI 保护后原子落入 `$DSH_HOME/e-mate/credentials`；明文不落盘。setup/check 只读探测当前平台后端；缺 Keychain/Expect、DPAPI 或受校验目标模块时失败关闭，不回退到系统 `.env` 写入或旧文件 Provider。
- 主进程纠偏：真实 profile 安装发现首版 patch 因 name 匹配错误未替换旧 provider，已改为禁用原 ID 加独立插入；真实 Keychain 写入又发现 `/usr/bin/security -w` 不能靠普通 pipe 满足交互提示，以及 Expect `-c` 不提供 `$argv`。最终只保留固定脚本生成与 stdin secret 路径，并以真实 API 验证，不以 mock 通过代替运行证明。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 为 38/38，`pnpm check:target` 与 `git diff --check` 通过。隔离 `DSH_HOME` 的 `setup`、`setup --check --json`、目标 `--dump-config` 和真实 Harness Web 全部通过；loopback `/api/credentials.set → describe → unset → describe` 证明中间状态为 `source: keychain`、前后均 unconfigured，所有响应不含测试值，结束后 Keychain 测试项不存在。
- 未关闭项：Windows CurrentUser DPAPI 尚未在 Windows runner 与真实用户配置文件验收；本片没有触碰或导入生产模型 Key、企业 Token、旧 Electron 凭据，也不把 macOS 本机证据扩大为三平台发布通过。S11/S13 继续进行。

## 2026-08-15 · S11 四类连接目录与本机配置闭环

- 结构复用：新增单一 TypeScript Cordis `emate-connections` 插件，仅注入目标 `credentials/connection/emateCapabilities`。Host 通过目标 Connection 的 `/emate.connections` 只读投影 provider 元数据和无值 CredentialView；浏览器写入/清除直接调用目标 `ctx.connection.api.credentials.set/unset`。没有旧 Runtime、SQLite Store、Dispatcher、前端 Secret Store、REST、SSE 或 WebSocket。
- 能力清单：飞书、腾讯文档、微信、钉钉现在都由插件向同一能力注册表动态注册，和生图、Office、OCR、Browser 组成准确八项。缺字段显示 `setup-required`；字段齐全但适配器尚未真实验收时保持 `blocked`；微信在公开授权与服务条款确认前保持 `blocked`。四项均不提供空操作或假 ready Tool。
- 设置闭环：外部连接页复用目标 `settings.section`，按最终 e-Mate 2.0.5 ConnectorPopover 的紧凑行、状态 pill、raised surface、凭据字段和动作层级适配浏览器 SettingsRoot。每个字段独立保存，避免双凭据部分失败造成覆盖不明；已保存值只显示 configured/source，不回显正文。清除要求二次点击确认，刷新、保存和清除都到达真实目标 API。
- 主进程证据：`pnpm --filter @e-mate/dsh test` 为 39/39，`pnpm check:target` 与 `git diff --check` 通过。隔离 Harness Web 的设置页显示四类连接；dummy 飞书 App ID 经 UI 保存后投影 `source: keychain`，再经两步确认清除，最终恢复未配置且 Keychain 不留测试项。能力中心在真实 Skill Hub HTTP 500 同时存在时仍显示准确八项，证明本地目录与社区失败域隔离。
- 视觉证据：`artifacts/design-qa/S11-connections/implementation-connections-1440x900.jpg` 与 `implementation-eight-capabilities-1440x900.jpg`。稳定重载从 `2026-08-14T22:19:44.441Z` 起 warning/error 为 0。由于没有任务认可的最终 2.0.4/2.0.5 同状态连接截图，历史 `docs/v0.*` 不被提升为真值，精确视觉 QA 继续 blocked。
- 未关闭项：四类远端适配器、首次授权、重连、真实读取与可逆写入/发送仍需各平台官方应用、账号、法务许可和测试目标；没有这些外部条件时不造凭据、不调用近似服务。S11/S12 保持进行中。

## 2026-08-15 · S02/S10 移动设置闭环与动态能力图标

- 目标动作复用：移动 `/settings` 不再依赖一个实际组合中未证明运行的无界面 overlay 副作用，也没有新增 Router、Store 或 transport。现有 `SidebarRoot` 在需要展开时直接调用已经注入的目标 `ctx.layout.toggleSidebar()`；随后仍由目标 `SettingsTrigger/SettingsRoot` 唯一持有弹窗、History 和关闭动作。
- 主进程根因链：真实浏览器连续暴露协议 gate 后未展开、隐藏侧栏预挂载的 Settings content/trigger 被误判为已可见，以及 `1920→320` 时首次 toggle 与目标响应式收起竞态。最终只把 `getClientRects().length > 0` 作为目标可见真值，并在首次 action 无效时用已有 120 帧硬上限的 rAF 复核；可见、离开路由或 collapsed 变化立即停止，不常驻轮询、不模拟 DOM 点击。
- 浏览器闭环：`320×800` 首次协议签署后自动回到并打开 `/settings`；同一路由 `320→1920→320` 仍恢复弹窗；直接关闭回 `/`，再通过真实设置按钮打开后，back 返回 `/`、forward 恢复 `/settings`。页面始终 `scrollWidth === clientWidth`，外部连接刷新动作在五个断点均为 `44×44px`。
- 动态图标合同：八项内置能力由各插件下发受校验 `icon_key`，浏览器只通过通用 metadata renderer 选择固定 Harness 的原生图标组件；中央能力页没有按 capability ID/title 写 `if/switch`。生图、Office、OCR、Browser 和协作类图标不再重复显示 e-Mate 品牌 mark，状态统一映射为“可使用/需要配置/暂未启用/状态异常”。
- 失败展示：远端 Skill Hub HTTP 500 仍保留为真实失败，但页面显示“社区 Skill 暂时不可用；内置能力仍可正常使用”，本地八项清单不被清空。深/浅主题 `1440×900` 与移动 `320×800` 均显示八项，未出现横向溢出；稳定重载从 `2026-08-14T23:02:51.801Z` 起 warning/error 为 0。
- 证据与门禁：`artifacts/design-qa/S10-capability-icons/` 保存深色桌面、浅色桌面和移动图标证据，`artifacts/design-qa/S11-connections/implementation-connections-320x800.jpg` 保存移动连接页证据。主包 32 项 Node 回归、2 项真实 React/Portal 客户端挂载回归、`pnpm check:target` 与 `git diff --check` 全部通过。
- 未关闭项：任务没有提供可接受的最终 2.0.4/2.0.5 同状态整屏图，不能对该页宣称像素级关闭；真实四连接授权/读写发送和生产 Skill Hub 仍等待外部账号、法务许可及服务器条件。S10/S11/S12 继续进行。

## 2026-08-15 · S10 Office 四格式真实 Worker 闭环

- 目标复用：没有新增 Office runner、通信协议或测试框架；扩展现有 `LocalSubprocessRuntime → runWorker` 集成验收，仍由固定 Harness subprocess 启动已校验平台 Runtime。
- 真实格式矩阵：打包 Python Worker 对 DOCX、XLSX、PPTX、PDF 逐项执行 create → read/reopen → edit（先验证并打开原字节）→ read/reopen，检查各自 MIME、扩展名、非空产物、修改后文本和 `source_opened` 证据。HTTP/CAS 导出路径继续由同一既有通用下载合同覆盖，不按格式复制实现。
- 主进程门禁：聚焦真实 Worker 测试 1/1 通过，耗时约 17.4 秒；四种格式均使用包内 `python-docx/openpyxl/python-pptx/pypdf/reportlab`，用户侧不调用 pip、不使用系统 Python，也未修改 Harness Agent Loop 或 WebUI–CLI 通讯。
- 未关闭项：当前仅为 darwin-arm64 打包 Runtime 的真实闭环；darwin-x64/Windows runner、四格式浏览器下载/重新打开的 Computer Use 证据，以及生产图像单次/改图/并发仍待完成，因此 S10 不关闭。

## 2026-08-15 · 前端一比一纠偏与同屏真值建立

- 用户验收否决当前视觉后，主进程不再以“源码已搬运、单测通过、响应式无溢出”代替高保真。固定 2.0.5 提交自带的 GA frame server 已在本地以 `many-threads` 同状态运行；Home、能力中心、设置、登录和深色 Home 均在同一浏览器、同一 `1280×720` CSS 视口捕获，与当前 Harness profile 并排检查。
- 证据纠偏：`design-qa.md` 中“没有同状态整屏真值”的旧结论已被证伪。新的源图和当前图固定在 `docs/design-qa/2026-08-15-front-fidelity/`；历史 `docs/v0.*`/`docs/v1.*` 仍禁用。后续视觉修改必须逐页留下 source/current 组合证据。
- 装载链事实：最初看到旧 Harness 侧栏不是 profile 替换失败，而是 `55127` 被一个旧 OS-credential 测试进程占用，其 `DSH_HOME` 为另一隔离目录。新端口以显式 `DSH_HOME` 启动后，boot manifest 的 `@deepseek-ai/dsh-client-ui-sidebar` revision 与 profile 内 e-Mate bundle 的 SHA-1 前缀一致，HTTP 返回包含 `今日使用概览/新任务`。因此不恢复额外 `emate-shell` loader row，也不新增 WebUI–CLI 协议；继续使用目标 package id 和模块装载器。
- 第一轮可见失败：首页目标默认 280px 侧栏与 748px composer cap、定时任务入口缺失、真实 Workspace/Agent row 位于 composer 上方；能力中心错误地覆盖全屏并用三列内置能力压过两列 Skill Hub；个人资料缺头像行；登录整体比源图上移约 85px。以上均作为子代最小修复输入，未被标记通过。
- 保留边界：新注册、验证码、保持登录、模型/插件/外部连接设置、动态八能力和 Harness 真事件是 2.0.7 的必要功能，视觉复刻不能通过删除这些闭环实现。结构、Session/Workspace/Input、Connection RPC、SettingsRoot、Tool/Job 和模块加载继续复用目标 Harness。

## 2026-08-15 · 前端一比一第二轮纠偏

- 真值与范围：继续固定 e-Mate 2.0.5 提交 `564a6b6c1d43fb6831dd4a5cd8026e472f063311` 的 `desktop/src/v1` 与本地 GA frame；非聊天页不引用历史 `docs/v0.*`/`docs/v1.*`，聊天仍以任务 `019ff665-d721-79a0-869d-338f086cf529` 的原型和交互稿为真值。源图与新图位于 `docs/design-qa/2026-08-15-front-fidelity/`。
- 装载链纠偏：旧页面来自错误 `DSH_HOME` 的残留进程，不是目标 loader 合同失效。当前 profile 仍用 Harness 的 `@deepseek-ai/dsh-client-ui-sidebar` module id、`window.__ModuleLoader__.load`、Cordis Slot 和 Connection；没有恢复独立 `emate-shell` 服务、前端 Router、Store、REST、SSE 或 WebSocket。
- 第二轮最小修复：桌面侧栏固定到源图的 248px，恢复“定时任务”和七个当前动作，真实 composer/workspace/agent seat 按稳定 target slot 重排；能力中心恢复带侧栏的 Skill Hub 两列主面和 `发现/已安装/导入`，八项内置能力继续来自真实插件注册表；设置补头像行和受限本地预览；登录纵向与宽度对齐；目标 boot 通过 `tapIndex` 使用真实 e-Mate 资产和“正在加载…”文案。
- 真实按钮闭环：侧栏折叠调用 `ctx.layout.toggleSidebar`，主题切换调用目标 theme API，设置入口继续投影目标 SettingsRoot；定时任务仅走 `workspaces.pickDirectory/create/connectWorkspace → sessions.scope → conversation.input.for(scope).setDraft → sessions.open`。浏览器测试发现 `/schedules` 的“新任务”因 `current` 本来为空而不能触发既有 History 投影，现只在目标 `startSession` 后补 `/` 与 `popstate`，没有新建会话或伪造状态。
- 浏览器根因修复：boot CSS 最初错误匹配生成类名的后缀，改为目标 CSS Module 的前缀选择器后，立即启动帧不再显示 HARNESS；定时任务页第二轮对照发现标题和卡片整体下移，最终仅收紧现有页面 top/header 间距。两项均由同视口 source/current 联合检查发现，而非凭截图主观通过。
- 证据与门禁：`current-boot-brand-final-1280x720.jpg`、`current-home-after-second-fix-1280x720.jpg`、`current-schedules-final-1280x720.jpg`、`current-capabilities-after-fix-1280x720.jpg`、`current-capabilities-builtins-expanded-1280x720.jpg`、`current-settings-after-second-fix-1280x720.jpg`、`current-login-after-fix-1280x720.jpg` 已保存。跨切片主包为 40/40，e-Mate shell Vitest 为 16/16；最后的 schedule CSS 调整后 TypeScript build 与 16/16 client tests 再次通过。
- 未关闭项：真实 Skill Hub 在隔离验收环境返回 HTTP 503，不能伪造社区卡用于像素验收；Home 的项目/会话/模型数据状态与源 fixture 不同；本轮没有刷新五断点后修复截图，也没有在真实 workspace/session 上重放完整新版聊天。S02/S12 继续 open，禁止记录为“一比一完成”。

## 2026-08-15 · S02 通用会话、企业设置边界与品牌面收敛

- 目标路径复用：新增的“通用会话”不是第二套前端项目模型。Host 只通过固定 Harness `WorkspaceRegistry.create` 建立受管本地 workspace，浏览器继续调用目标 `workspaces.startSession`、Session Store、InputBar 和 Connection；未新增 REST、WebSocket、Router 或前端状态源。受管 workspace 从“项目”列表隐藏，其会话仍进入真实“会话”列表。
- 企业设置边界：profile 禁用目标的模型设置与 Agent Preset 设置页，默认 preset 为 `standard`、访问策略为 `danger-full-access/never`；composer 保留企业允许集合内的单会话模型选择。设置中的“插件”只做展示文案替换为“能力中心”，目标 SettingsRoot、控制器和 RPC 不变。
- Home 与账号闭环：真实 InputBar 的发送色通过目标 design token 改为 e-Mate 品牌橙；workspace strip 约束 `min/max-width` 防止项目名溢出；设置和用户中心使用同一行高、内边距与字号。用户中心通过既有 `emate.identity` Connection RPC 读取企业周用量，显示真实进度；不可用时保持不确定态，不伪造 0。
- 品牌扫描：页面标题、favicon、manifest、折叠侧栏头像统一使用现有透明底小芯资产；已覆盖本片可见的 DeepSeek Harness、Runtime Scheduler 和 Runtime 文案。主工作区外层 `[data-phase]` 的灰色边框与圆角已删除，内部卡片层级保持不变。
- 真实浏览器证据：桌面设置页只显示个人资料、通用设置、能力中心和外部连接；没有模型或 Agent 模式入口，页面可见文本无 DeepSeek Harness，favicon 指向 `/assets/e-mate/xiaoxin-avatar.png`。折叠态加载同一透明资产；`320px` 实测 `scrollWidth=320`，主区 computed style 为 `border=0px/radius=0px`。
- 门禁：本片完成完整 `@e-mate/dsh` 测试，TypeScript/TSX build、41/41 Node 回归与 17/17 浏览器组件回归全部通过。新增窄合同锁定主区无外框、发送品牌 token 和 Scheduler 可见文案不回退到 Runtime。
- 未关闭项：模型策略为空时真实 InputBar 会按目标合同保持不可发送；生产 identity usage 对账、真实允许模型策略、完整 2.0.5 同状态逐页像素比较和五断点丰富聊天重放仍属 S07/S12 门槛，不能由本地验收 provider 代替。

## 2026-08-15 · S05/S06 干净安装、同版重装与临时构建泄漏修复

- 发布包根因：一次中断的 Harness 预构建把 `runtime/.harness-build-*` 暂存目录留在主包发布树内，下一次 `npm pack` 因显式发布整个 `runtime/` 而把 31,914 条临时路径打入 tarball。唯一构建路径现先清理旧版残留，并把新 scratch 移到系统临时目录；release verifier 同时拒绝任何此类路径，最窄 carrier 回归 4/4 通过。
- 新主包证据：清理后 `@e-mate/dsh@2.0.7` tarball 不含 `.harness-build-*`，体积从约 112 MiB 收敛到约 58 MiB，SHA-256 为 `00291bdaeaa5ffd69bdc579e44010251915e4e5037891fd981dfd4d03287bb70`。本段 supersede 本日志先前基于泄漏包记录的主包 hash；Runtime 与 Browser tarball 未因该修复改变。
- 干净安装与同版重装：主包、darwin-arm64 Runtime、darwin-arm64 Browser 三个本地 tarball 同批安装到仓库外 npm prefix，`npm ls -g` 只包含当前平台三包。全新 `DSH_HOME` 的 `setup`、12 项 `setup --check --json`、Office Worker、RapidOCR 和 Chromium headless 全部通过；完全相同版本重装并再次 `setup` 后检查仍全绿。
- 数据与快捷方式：重装前写入隔离 memory 的验收哨兵，重装后 SHA-256 仍为 `8c4249043b32e6d3339bb76ae50d4c9b65d8cc7b9d9e68d6809a277557a17218`；隔离 Desktop 的 `e-Mate.command` SHA-256 仍为 `fea3d2360f24769192bf3b234c250418e428d1e02d92765a342ea9e646be40ac`、保持可执行，内容只通过登录 shell 调用当前全局 `e-mate launch`。
- 受管实例：同版重装后的两次 `launch --port 55233` 复用 PID `86935` 和实例 `e12075c3-a9a9-447f-8532-4822334153a2`；`status` 返回 e-Mate 2.0.7、profile `e-mate`、`healthy: true`、`active_runs: 0`，`stop` 只停止该实例。独立 Node 进程占用 55234 时，`launch` 退出 1 并明确未停止它，随后原服务仍返回 200。
- 验收边界：Codex App 自带 Node 因 macOS library validation 无法加载 npm 包内原生模块，不代表普通 Node 24 用户环境；真实运行改用带标准 Node entitlement 的 Node 24.19.0 后通过。临时 npm prefix 无法模拟 Finder 登录环境对真实全局 npm PATH 的发现，所以本轮不把脚本字节验证冒充真实双击；Windows 快捷方式、darwin-x64/Windows 平台安装、rc→正式版、跨版失败恢复、活动任务门禁和降级仍未验收，S05/S06 保持进行中。

## 2026-08-15 · S02 深链身份竞态与 S04 5,000 事件基线

- 深链根因：新浏览器上下文中，企业身份 bootstrap 与目标 Session baseline 存在真实时序差。IdentityGate 会先把受保护的 `/chat/:sessionId` 暂存为 `/login`；异步解锁后原实现只用 `history.replaceState` 恢复地址，没有通知已经初始化的 SessionRouteProjection，造成 URL 正确但主区停在 Home。修复只在既有 History seam 恢复 returnPath 后派发 `popstate`，没有新增 Router、Store、RPC 或 WebUI–CLI 通讯。
- 深链回归：可执行 jsdom 用 pending Session baseline 与延迟 identity 回执复现该顺序，确认解锁后调用目标 `sessions.open`。新 bundle 放入同一隔离 profile 后，5 个全新 Chromium context 均从 `/chat/e-mate-performance-5000-v1` 打开真实会话，5/5 不再落到 Home；聚焦 identity/settings 测试 6/6 通过。
- 固定数据集：`scripts/create-performance-fixture.mjs` 通过目标 `JsonlSessionPersistence` 生成 5,000 个连续事件、625 个 turn，SHA-256 为 `ad12feaa53f9d55c22d0e32a366316c8e29a8031ccca5d27a8e4f97d2a99b0cc`。测试会话再经目标 `workspace.create → session.create` 接入，不直接改 workspace storage，也不伪造前端事件。
- 性能基线：目标 history 每页加载 25 个 turn；连续执行 25 次真实 `Load earlier` 后页面显示全部 625 个 assistant 响应、约 45,300 个 DOM 节点。首轮 5 秒全量滚动为 58.4 fps、97 MB JS heap、稳态长任务均 <100 ms；当时按旧门槛记录掉帧率 2.66%，该门槛已由后续用户修订删除。rc.5 ChatView 仅保留未来 virtualizer 的 row 边界，当前未实际虚拟化。
- 失败实验撤回：复用浏览器原生 `contain: layout paint style` 的单次预跑曾到 2.00%，但新 bundle 重复测量为 3.65%，没有稳定改善，已从产品 CSS 删除。不得把偶然一次结果写成发布通过；下一步应优先复用目标已存在的 `@tanstack/react-virtual` 设计与 keyed row/anchor 合同，而不是复制一套聊天 Store 或引入第二通信层。
- 未关闭项：正式 Chrome Trace、React Profiler、刷新率校准后的掉帧定义、30 events/s、INP p75、20 会话 heap 增长和三平台重复数据仍未齐全，S04 保持待验收。

## 2026-08-15 · S04 虚拟化边界审计与失败实验

- 测量纠偏：发现两个本地 Harness Web 实例曾同时读取同一隔离 `DSH_HOME`，导致 history window 在加载途中重置；停止重复实例后，目标原生分页稳定加载到 4,999 个聊天行。后续性能证据必须保证一个数据目录只有一个运行实例。
- 夹具幂等：目标打开会话会在固定样本后合法追加 `session/end-seed`、权限、沙箱和审批策略事件。生成器现在只对前 5,000 个样本事件计算固定 SHA-256，并仅允许该固定版本的连续控制尾部；新目录首次/复用均为尾部 0，已接入目录复用为尾部 5，摘要保持 `ad12…0cc`。普通消息、未知类型或断号仍失败关闭。
- 目标结构结论：rc.5 的 `ChatView` 直接 `order.map` 渲染全部 `ChatNodeSeat`；目标已有 `@tanstack/react-virtual` 只用于 trajectory。`conversation.view` 支持同 ID 优先级覆盖，但每个 entry 独立持有 store、inject、locale 和 child-slot 授权；覆盖 entry 不能继承原 chat entry 的 `conversation.chat.node` renderer seat。直接覆盖会被迫复制聊天 Store/注入/分页/详情选择，或修改 SlotRegistry 私有 entry，均违反“固定上游核心、复用目标通讯与结构”的边界，未实施。
- 原生方案复测：`content-visibility:auto` 在 4,999 行正向滚动中可偶发降到 `0.03%–0.36%` 掉帧，但同一页面反向滚动重复为 `4.99%`、`12.94%`；增加 `will-change:scroll-position` 后仍为 `6.98%`、`13.98%`。该方案不稳定且反向明显卡顿，未写入产品。
- 当前决策：不以偶发正向数字关闭 S04，也不在 e-Mate overlay 内复制 Harness ChatView。继续完成其余性能测量；真实行虚拟化只能在目标 `ChatView` 自身接入既有 virtualizer，或由上游提供可继承的 chat-row/child-slot 覆盖合同后再落地。

## 2026-08-15 · S04 INP、会话堆与真实事件压力

- 固定环境：darwin-arm64，Node `24.19.0`，包内 Chrome for Testing `149.0.7827.55`，`1280×900`；client bundle SHA-256 为 `8943ebfc…36af`。完整结构化结果固化在 `artifacts/performance/S04-2026-08-15-metrics.json`。
- INP：真实输入、目标侧栏 action、目标 theme action 与 SettingsRoot 打开/关闭共 24 个 interaction，Event Timing p75 为 `24ms`、最大 `72ms`，覆盖项通过 ≤100ms。企业允许模型策略当前为空，模型选择 interaction 尚无生产状态证据，未被本地近似项替代。
- 会话堆：通过目标 `session.create` 建立 20 个隔离测试会话，再由既有 `/chat/:id` History 投影逐个 `sessions.open/clear`，两次 GC 后增长分别为 `9.53%`、`8.25%`，均满足 ≤10%；测试会话随后通过目标 archive action 归档。
- 30 events/s：每次真实 `session.prompt` 在当前模型策略拒绝下仍由 Harness 持久化 inbox/turn/step/user/error 终态；校准为 220 次/约 60 秒后，浏览器目标 WebSocket 实收 1,792 个 session event，速率 `30.02/s`，类型计数完整。浏览器同钟的接收→下一绘制机会为 p95 `53.53ms`、p99 `70.93ms`，无 >100ms 长任务；p99 通过但 p95 超预算 `3.53ms`，因此 S04 仍失败关闭。
- 测量纪律：早期以“下一次聊天 DOM 变更”配对所有 session event，会把不产生聊天节点的 inbox/step 事件延迟到下一轮，已废弃。最终证据在 WebSocket message 与 `requestAnimationFrame` 同一浏览器时钟上采样，包含全部六类真实事件，不按可见类型缩小分母。

## 2026-08-15 · S02 会话分享入口恢复与用户轨迹隐藏

- 真值与边界：固定 Harness rc.5 只有 `ApiProxy.downloads.sessionLog` 与 `/api/session.export` 的真实 ZIP 下载，没有 e-Mate 2.0.5 `ShareDialog` 所需的 create/list/get/revoke、有效期和公开 URL Cloud Share 生命周期。导出不能改名为分享；当前也没有经验证的生产 Share Provider，因此本片按缺失上游失败关闭。
- 插件接线：e-Mate client 插件通过目标 `conversation.session.header.utilities` 注册“分享当前任务”，继续使用目标 Modal、图标和 Connection RPC；profile 的 `emate-share` 仅在 loopback `/emate.share` 返回 `public-share-provider-not-configured`，弹层明确说明 Session log 只是本地归档。没有新增 REST、WebSocket、Router、Store 或会话状态机，也未修改 Harness 核心。
- 视觉基线：入口与“分享任务/链接只包含创建时已有内容”文案来自固定 2.0.5 `desktop/src/v1/components/ShareDialog.tsx`，弹层宽度、不可用卡片、桌面 32px/粗指针 44px 控件按当前 2.0.5 源码适配到目标 Token；不可用入口仍可点击以形成真实终态，不制造公开链接。
- 轨迹隐藏：profile 直接将目标 `ui-trajectory` row 设为 `disabled: true`；普通用户只剩 Chat view，Trajectory 定义、事件与目标源码均未删除，未来只能通过受控 profile 重新组合。
- 门禁：Node 24 构建通过；Host `managed profile/public share capability` 定向回归 2/2，通过 loopback authority、disabled row 与 fail-closed schema；e-Mate client 6 files/22 tests 全绿，分享聚焦 2/2；`pnpm check:target` 通过。未关闭项：真实公开分享仍缺经过验收的 Cloud Share Provider、生产 CAS/renderer、认证上传、创建/复制/到期/撤销与公网 Computer Use 证据，不能将本片记录为后端闭环完成。

## 2026-08-15 · S04 Chrome Trace 与短消息投影修复

- Trace 根因：固定包内 Chromium 的正式 Trace 含 333,514 条记录、约 75.8MB。renderer main 中目标 `ChatView.toBottom` 自耗时约 `6.66s`，`UpdateLayoutTree` 合计约 `12.28s`、最大 `23.81ms`；唯一 >100ms task 是 CPU profiler 启动本身，稳态没有 >100ms 长任务。Trace 固化在 `artifacts/performance/S04-2026-08-15-chrome-trace.json`。
- 最小覆盖修复：e-Mate 长文本插件原先为每条短消息创建一个隐藏 Conversation Node，再挂 ResizeObserver；这会额外触发目标 ChatView 的列高变化和底部跟随。现在仅对可证明不会超过 160px 的单行纯文本（≤48 UTF-16 code units，且不含换行、图片 Markdown/HTML 起始符）跳过探测行，其他消息仍复用同一真实 Markdown DOM 以 `scrollHeight > 160` 判定，不以字符数冒充折叠条件。终态活动组也只做一次 DOM 标记，不再常驻观察整条 flow。
- 同口径复测：220 次真实 `session.prompt` 的注入窗口约 `59.63s`，目标 WebSocket 实收 1,795 个 `session/event`，约 `30.10/s`；事件→下一绘制机会 p50 `10.40ms`、p95 `43.30ms`、p99 `64.30ms`、最大 `97.80ms`，0 个 >100ms 长任务，短消息 disclosure 行为 0。p95 从 `53.53ms` 降至 `43.30ms`，本项通过；本段关于掉帧/虚拟化阻断的旧结论已由后续用户修订取消。
- 边界：没有修改 Harness ChatView、Connection、Store、Session 事件或 SlotRegistry，也没有加入第二条通讯链路。窄回归覆盖短纯文本跳过、49 字符/图片 Markdown/换行仍测量，以及终态 observer 释放；`chat-fidelity.client.spec.tsx` 4/4、`@e-mate/dsh build` 均通过。

## 2026-08-15 · S04 浏览器启动与企业模型选择性能补证

- 浏览器启动：使用包内 Chrome for Testing `149.0.7827.55`、`1280×900` 和五个全新 browser context 打开真实 e-Mate Home；LCP 为 `512/400/372/296/320ms`，p75 `400ms`，真实“新建任务”按钮可见的交互时间 p75 `383.1ms`、最大 `512.6ms`，页面口径通过 `LCP≤2s/interactive≤2.5s`。该证据不把 Host 进程启动时间混入 Navigation Timing；五次顺序启动的温 OS cache 诊断为 index p75 `1029.2ms`、health p75 `1030.36ms`，不作为发布门禁替代值。
- 模型选择：隔离验收 profile 通过目标 `ctx.llm.registerAdapter` 暂挂只提供目录、永不执行模型调用的 Catalog；企业身份插件仍下发真实固定 schema 的多选策略，页面仍经目标 `session.models → ModelDirectory → session.selectModel`。20 次在 `e-Mate Chat/GPT-5.6 Sol` 间切换产生 60 个可信 Event Timing interaction，p75 `16ms`、最大 `96ms`，无 >100ms 长任务，补齐 S04 的模型选择 INP 性能口径。
- 产品缺口：临时 Catalog 没有进入源码或发布 profile。当前 `emate.modelPolicy` 只过滤目标目录，固定 `CHAT_MODELS` 的 alias→upstream 映射没有注册企业 LLM Adapter；生产 InputBar 因此仍会在无真实 Adapter 时失败关闭。该缺口属于 S07 模型凭据/Endpoint 下发与 target `llm-pi-ai` 适配，不能用本地性能 Catalog、环境 Key 或前端静态选项关闭。
- React 提交摘要：在产品 bundle 前安装 React 官方 DevTools hook，以同一固定会话从 25 turn 通过目标 history paging 加载到 625 turn/4,999 chat row；一个真实 renderer 共提交 177 次，每页固定 4 次，分页 wall time p50 `167ms`、p95 `225ms`、最大 `269ms`，0 次 error commit。生产 React renderer 不暴露 `actualDuration`，因此该证据只关闭 commit-count/错误摘要，不能冒充带 duration 的 React Profiler 通过项。
- 剩余门禁（历史记录）：当时因 4,999 行目标 ChatView 掉帧超过旧 2% 门槛、真实行虚拟化不可组合和 production Profiler duration 缺失而失败关闭；后续用户已删除掉帧率门槛，当前只保留 production Profiler 摘要和发布候选重跑。Harness 核心和通讯路径未修改。

## 2026-08-15 · S03/S07 公开会话分享后端合同审计

- 2.0.5 真值：固定 e-Mate 2.0.5 源 `564a6b6c1d43fb6831dd4a5cd8026e472f063311` 的分享不是 Session ZIP。`ecorex/sharing/api.py` 在本地 Runtime 提供 create/list/get/revoke；`service.py` 从权威会话投影生成一次性不可变快照并先把快照与 Durable Job 同事务落盘；`transport.py` 只向 allowlist 内、无凭据的 HTTPS `/api/v1/shares` 发送 Bearer 与幂等键。有效期严格为 1 小时至 30 天。
- 企业端真值：`ecorex/control_plane/app.py` 只接收已认证的 schema-v2 发布、媒体 PUT 与撤销，不提供客户端会话目录；`shares.py` 以追加式 SQLite 状态、HMAC token/state/audit、CAS 引用和严格 MIME/字节摘要保存快照，公开 `/s/{43 字符 token}` 返回无脚本 HTML，媒体只经同 token 路由读取。过期或撤销后 URL/媒体均失败关闭。公开页具备 CSP、no-store/noindex、同源媒体和无凭据 HTTPS URL 约束。
- 生产只读探测：用户指定生产域名的 canonical `/api/v1/shares` 对 HEAD/OPTIONS 返回 `405 Allow: POST`，使用明确无效的测试 Bearer 提交空对象返回 401；格式合法但不存在的公开 token 及 media ID 均返回 404。这证明路由与认证边界存在，但不能证明生产当前 schema/CAS/keyring、成功发布响应、真实 `public_url`、公开 renderer 字节或撤销/到期闭环。生产没有公开 OpenAPI 文档可用来补足合同证明。
- 当前产品缺口：e-Mate 2.0.7 的 `emate-share` 仍只有目标 Connection RPC 的失败关闭状态；固定 Harness 只有真实 ZIP export，没有 ShareSnapshot 服务。当前 `emate-identity` profile 也未配置 `identityProvider` 或 `authenticatedRequest`，因此插件无法取得受管账号身份/访问租约并调用企业发布端。用户提供的服务器和模型配置只证明运维入口、服务器域名与模型接口存在，不包含可用于 e-Mate 分享验收的账号访问租约或无敏感测试快照。
- 决策：本片不复制旧 Python Runtime/SQLite/Router，不把云 POST 路由直接暴露给 WebUI，不用模型 Key/面板凭据冒充账号 Bearer，也不猜 HTTP base URL、public host 或成功响应。前端继续显示真实不可用终态；`packages/dsh/src/profile/share.ts` 不改，避免制造只能创建假链接而无法 list/get/revoke、CAS 或公开渲染的第二协议。
- 继续实现所需输入：先提供可轮换的 e-Mate 验收账号租约获取流程（由正式 identity provider 下发，禁止写入源码/日志）、生产 share endpoint 与 public-host allowlist 的签名配置/版本收据，以及允许发布后立即撤销的无敏感会话和小图片夹具。拿到这些后，唯一允许的实现路径是一个 TypeScript Cordis 插件复用目标 `Connection`、`SessionPersistence`、`Jobs`、`StorageDomain` 和 `emateIdentity.request`，再以成功 create/list/get/revoke、CAS 媒体、公开页、到期和撤销 Computer Use 证据关闭本项。

## 2026-08-15 · S07 企业身份与模型服务权威源码定位

- 源码事实：本地工作区和已连接 GitHub 账户的公开仓库中均未找到当前生产 `auth-gateway/model-gateway/analytics-api/admin` 源码；生产服务器保留只读构建快照 `/opt/e-mate/builds/model-catalog-08f2f35-20260803-1749/src`，共 1,268 个文件、约 23 MiB，根包声明 `e-Mate 2.1.47`、`Apache-2.0`、TypeScript 工作区。审计只把所需目录复制到系统临时目录，未修改生产容器、数据库、镜像、路由或密钥。
- 已有控制面：生产入口继续由现有 nginx 分流到 `auth-gateway`、`model-gateway` 和 `analytics-api`。Auth 当前只实现 password/refresh，会话回执包含短期 access、refresh 与 model-session Token；Analytics 已有用户增删改查、管理员改密、会话撤销与 `tokenLimit`；Model Gateway 已有模型目录、Responses/Chat/Image、Consent 和 Usage。不存在另造第二套控制面的理由。
- 身份缺口：当前 Auth 没有注册挑战、用户自注册、审批中状态、用户自助改密或显式 logout；用户状态合同仅为 `ACTIVE/SUSPENDED/DELETED`，管理员创建用户会直接变为 ACTIVE。e-Mate 2.0.7 的 `emate.identity` 客户端合同已经为 challenge、pending approval、remember-login、logout、改密和协议回执留出目标 Connection RPC，但 profile 尚无可序列化的生产 Provider，因此真实登录仍失败关闭。
- 配额缺口：当前 `tokenLimit` 的执行查询累计账号历史总量，没有周起点；也没有把账号周限额、当前周用量和用户级 `allowed_model_ids` 作为签名身份/策略回执下发。不得用管理页 lifetime 值冒充周限额，也不得用临时 Catalog 冒充生产多模型策略。
- 复用决策：服务端修复必须基于该 Apache 源码的现有 Auth/Postgres/Admin/Model Gateway 路径，补 PENDING_APPROVAL、单次验证码、周配额、用户模型集合、logout/改密与签名回执；本地端只通过目标 Credentials 保存可轮换 refresh Token、通过目标 LLM Adapter 调用 model-session 网关，并继续由 `emate.identity/modelPolicy/audit` 三个旁路服务投影。找不到可公开复现的基线源码前不部署源码补丁，也不在客户端猜协议或持久化生产 Token。

## 2026-08-15 · S02 205 发送按钮与项目条连续面修复

- 用户对照根因：固定 Harness 的发送按钮原生为 `34px` 圆形 grid 和上箭头；前一版只追加 `发送` 伪元素，导致图标与文字上下堆叠。输入卡又保留四个 `24px` 圆角，而项目选择栏是独立底板，两个下圆角之间暴露工作区黑缝。
- 最小修复：继续使用同一个 `aria-label=发送消息` 的 Harness submit，不复制 InputBar、draft、附件、提交或 transport；桌面仅把它投影成 `76×32px`、`10px` 圆角、横向纸飞机+`发送`。输入卡只承担 `24px 24px 0 0`，真实 workspace strip 只承担 `0 0 24px 24px`，用既有排列负间距组成连续外轮廓。
- 响应式与可访问性：`<768px` 仍隐藏文字并保留原提交按钮 `44×44px` 点击区，纸飞机资产来自现有受管 `/assets/e-mate/send.svg`；forced-colors 继续回退到目标原生 SVG。没有增加图标依赖或手绘资产。
- 证据：最终桌面、局部对照和移动截图为 `implementation-button-seam-final-dark-1440x900.png`、`composer-source-vs-final-button-seam-focus.png` 与 `implementation-button-seam-final-mobile-390x844.png`。主进程聚焦 Vitest 4/4、`@e-mate/dsh build` 和 `git diff --check` 全部通过。完整 Composer Design QA 仍只受 S07 生产模型 Catalog 同状态缺失阻塞，本片两处视觉 P1 已关闭。

## 2026-08-15 · S04 掉帧率门槛修订

- 用户明确删除“5,000 行聊天反向滚动掉帧率 ≤2%”发布标准；掉帧百分比继续保留在 Trace/测量产物中作为诊断信息，不再阻断 S04 或 S12。
- 仍保留 5,000 事件平均滚动 ≥55 fps、JS heap ≤300 MB、稳态无 >100 ms 主线程长任务，以及冷启动、INP、真实事件绘制延迟和 20 会话内存增长预算。
- 现有虚拟化、containment 与 `content-visibility` 失败实验保留为历史事实，但不再因为非门槛掉帧百分比改 Harness ChatView 或复制聊天 Store/通讯路径。S04 剩余工作收敛为 production Profiler 摘要和最终发布候选重跑。

## 2026-08-15 · S02 Composer 第三轮通用会话与真实目标控件复验

- 根因：先前截图来自仍占用 `55127` 的过期生成 profile，该运行态没有当前源码声明的 `emate-general-workspace`，所以 Harness InputBar 正确进入“选择一个工作区开始”的无 Workspace 状态；这不是缺一套输入框交互。以当前包重新 `setup` 后，Harness 原生初始 Workspace 选择自动打开真实受管“通用会话”，项目选择器原生提供“通用会话/添加工作区…”，真实项目目录仍走目标 `WorkspaceRegistry`、Session、History 与 InputBar。
- 最小修复：没有新增 Store、Router、REST、WebSocket、transport 或提交逻辑。e-Mate 的 `conversation.input.right` 投影只在目标 textarea 可用时恢复 2.0.5 输入引导“给小芯发送消息，支持粘贴图片或文件”；禁用态继续显示目标的真实模型阻塞原因。输入 backdrop/textarea/mirror 改为透明，消除卡内第二层深色面，但 Composer 卡、model target、连接器 target 和 submit 仍由 Harness 所有。
- 干净安装闭环：shell 已引用品牌纸飞机 `lucide-send.svg`，而 profile 资产复制清单此前遗漏该文件，导致全新 profile 启动 ENOENT。现只把已有 SVG 加入既有复制列表，并在受管 profile 与品牌资源路由回归中锁定；没有新图标依赖或第二资源服务。
- Browser 证据：`1440×900` 下 card/input/action row 为 `1056×114 / 1054×66 / 1054×40`，model/external/Send 为 `83.05×32 / 89.05×32 / 76×32`，workspace 为 `105.05×28`；`390×844` 下三项触控目标为 `83.05×44 / 44×44 / 44×44`，workspace 为 `105.05×44`。两档均 `scrollWidth === clientWidth`，连接器进入目标 `/settings?section=connections&connectors=feishu,tencent-docs` 并显示飞书、腾讯文档。最终截图和同屏对照位于 `artifacts/design-qa/S02-composer-205-round3/`。
- 门禁：e-Mate shell 7 files/28 tests、`@e-mate/dsh` build，以及受管 profile/品牌 send 资源的 Node 聚焦回归 2/2 通过。S07 当前未提供真实模型 Adapter，浏览器因此诚实显示“当前模型不可用，请先选择模型”并禁用发送；不能用测试目录或前端写死的模型关闭该 P1，完整 Composer 一比一结果继续 blocked。

## 2026-08-15 · S10 生图固定 Pro 模型与 S13 Cloudflare R2 下载源

- 生图合同纠偏：固定 2.0.5 最终 `image-generation` 真源默认提交 `gpt-image-2-pro`，用户和 Agent 均不传、不选择图像模型；只有企业图像服务可在符合旧版已验证的上游不可用错误时执行 `gpt-image-2-pro → gpt-image-2` 降级。2.0.7 继续复用目标 `ctx.tools`、`ctx.jobs`、附件和企业身份/策略路径，只把现有 generation 常量从 `gpt-image-2` 修正为 `gpt-image-2-pro`；编辑仍固定 `gpt-image-2-edit`，未搬入旧 Python Provider 或第二传输。
- R2 发布合同：最终 2.0.7 下载字节固定来自现有 Cloudflare R2 bucket 的 `npm/v2.0.7/` 不可变对象；原下载地址只保留入口和完整性展示。发布流水线在 npm 回读及三平台注册表干净安装后，复用既有 S12 accepted SHA 和 R2 S3 凭据，将七个 tarball 与五个证据文件上传；同 key 不同 size/SHA-256 失败关闭，公共 HEAD 与首尾 Range 字节不一致也不写 admission receipt。
- 激活边界：R2 上传只形成不可变候选和 `r2-download-admission.json`，不会自动覆盖下载页。正式下载入口仍必须等待真实 Computer Use、R2 收据、npm 回读和完整性页验收完成后再切换，应用服务器不得作为最终二进制源。

## 2026-08-15 · S07 目标原生 LLM Adapter 组合复核

- 根因纠偏：浏览器先前显示“当前模型不可用”不能据此推断缺少 Adapter。当前 profile 已直接组合固定 Harness `@deepseek-ai/dsh-llm-pi-ai`，唯一 provider route 为 `e-mate-enterprise`；`api=openai-responses`、生产 `/model-api/v1` 和四个企业聊天模型均由目标配置解析。另写 e-Mate Adapter 会与同一路由冲突并产生第二模型实现，因此未新增。
- 凭据链：生产登录 Provider 将短期 Model Gateway session JWT 写入目标 Credentials 引用 `E_MATE_MODEL_SESSION_TOKEN`；`llm-pi-ai` 在每次 stream 前通过目标 Credentials 动态解析该引用，缺失时按目标 `MISSING_CREDENTIAL` 失败关闭，不回退到环境中的其他模型 Key。`emate.modelPolicy` 继续只在目标 `apiProxy.sessions.models`、`session.selectModel`、`llm.models`、`agent/request` 与 `llm/stream` 边界过滤和复核允许集合。
- 组合证据：e-Mate profile/identity/model-policy 聚焦回归 3/3；固定 Harness `llm-pi-ai` 完整 catalog spec 52/52；企业 Model Gateway 的授权 Responses 代理与 Chat-Completions→Responses 适配聚焦回归 2/2。以上证明静态目录、目标凭据解析语义、策略边界和网关 SSE 兼容，未用临时 Adapter 或前端静态模型关闭缺口。
- 尚待生产终证：仍需一个已批准、已配置周额度与允许模型的真实 e-Mate 用户完成登录、协议签署、四模型选择和至少一次真实 Harness 会话流；这一步不能由未认证目录、上游直连 smoke 或假账号替代。注册页含 CAPTCHA，Computer Use 必须取得用户对验证码操作的明确确认后才能继续。

## 2026-08-15 · S13 Cloudflare R2 发布合同复核

- 依据当前随 Cloudflare 插件交付的 R2 参考重新核对：S3 endpoint 使用 `https://<account>.r2.cloudflarestorage.com`，AWS region 固定 `auto`；正式公开下载必须使用已绑定 bucket 的 HTTPS 自定义域。本阶段当时仍把限流的 `r2.dev` 留作离线清单测试默认值；后续“最终 2.0.5 Codex-like imagegen 与生产 R2 域门禁”切片已删除该默认值，生产和清单生成均要求显式 origin。
- 定点加固：公开 `HEAD` 明确请求 `Accept-Encoding: identity`，避免 CDN 压缩 JSON/文本证据后用压缩长度误判原始对象；认证 `head-object` 除大小和 SHA-256 元数据外，还必须匹配 MIME、附件名和一年 immutable cache-control，已有同 key 但下载元数据不同也按不可变冲突失败关闭。
- 门禁：`publish-r2.mjs` 语法检查通过，release carrier 5/5 通过，scoped `git diff --check` 通过。当前本地只有 darwin-arm64 的主包、Runtime、Browser 三个 tarball，缺 darwin-x64 与 win32-x64 四个包，也没有经发布环境验证的正式 R2 自定义域，因此未执行生产上传或下载页切换。

## 2026-08-15 · S06 在线更新平台执行位修复

- 主进程审计发现 detached updater 的 staging、正式全局安装和回滚三条 npm 路径都传了 `--ignore-scripts`；这会跳过 Runtime/Browser 平台包已经审查过的 `postinstall`，使 npm tar 归一化后丢失的 Python/Chromium 可执行位无法恢复。全新更新可能因此通过包身份检查却无法完成真实 Worker/浏览器启动。
- 根因修复只删除三个 `--ignore-scripts` 参数，继续复用同一 npm、setup/check、快照、收据和回滚事务；没有新增安装器或脚本执行层。六个平台包的现有 `postinstall` 只读取包内 manifest、校验相对路径仍位于包根并执行 `chmod 0755`，不下载、不编译、不读取用户数据。
- 同链路补齐四项失败关闭：从当前受管 `lib/bin.js` 的标准 npm 全局布局解析并复用原安装 prefix，拒绝本地源码/未知布局，避免自定义 prefix 用户把新版本装到另一个目录后仍运行旧版；在 npm 开始全局替换前武装 rollback，使部分替换失败也会重装旧版本、恢复数据快照；安装后以新进程 `--version` 精确核对 staged version；回滚重新 setup/launch 时保留原受管端口，不悄悄切回 3080。
- Agent 终态闭环：现有 `e-mate status` 只读投影最新有效 `online-update-*.json` 为 `latest_update`，只暴露 request ID、终态、版本和完成时间，不暴露 npm 错误、路径或环境。系统提示要求 Agent 将其与 `e-mate update --json` 返回的 request ID 精确匹配；缺失或不同收据不得报告更新成功，未新增轮询服务或第二状态协议。
- 并发门禁：`e-mate update` 通过 `$DSH_HOME/e-mate/run/update.lock` 只允许一个 detached helper；活 PID 明确拒绝第二次更新，死 PID 的陈旧锁才可回收。父进程以 request ID 获取独占文件后把所有权交给 helper PID，helper 等待交接完成再触碰 npm，并只释放同 request ID 的锁，避免 Agent 重试/双击造成两个全局安装与两份数据快照并发。

## 2026-08-15 · S02 对外品牌文案门禁补齐

- 二次品牌扫描确认 title、favicon、PWA manifest、折叠侧栏头像和设置页此前已正确投影 e-Mate；剩余泄漏来自 CLI/runtime 校验错误、真实 Tool 失败文本与 Tool description 中的 `DeepSeek Harness/Harness`。这些字符串可能出现在终端、活动详情或插件元数据，不属于仅内部的包名/模块 ID。
- 只替换对外字面量为 `e-Mate local runtime`、`e-Mate session/project/Agent` 或无品牌的 registered Job；固定 `@deepseek-ai/*` 包名、Cordis 注入 ID、Harness commit/version、内部函数名、审计 source key 和开发文档技术归因全部不变，因此未改变结构或通讯链。
- 新回归扫描 e-Mate CLI、迁移器及全部顶层 profile TypeScript 源中的用户可见字符串字面量，拒绝重新出现 `DeepSeek Harness/Harness`；HTML 品牌转换仍独立验证旧标题/鲸鱼 favicon 被 e-Mate 标题、透明小芯 favicon 和 manifest 替换。`@e-mate/dsh` build 通过，完整 Host 46/46、scoped `git diff --check` 通过。
- 门禁：目标 pin 检查通过；新增更新锁/收据回归后 e-Mate Host 45/45、shell 28/28、release carrier 5/5、enterprise TypeScript check 与全部非外部依赖测试通过。`@e-mate/dsh` build 和 scoped `git diff --check` 通过。真实跨版本 registry 更新/失败恢复仍需正式候选和平台运行证据，不能由源码检查关闭 S06。

## 2026-08-15 · S10 最终 2.0.5 Codex-like imagegen 与生产 R2 域门禁

- 真源复核：`upstream/e-mate-2.0.5` 精确位于 `564a6b6c1d43fb6831dd4a5cd8026e472f063311`；最终 `ImageGenTool` 的公开合同是每次一个独立产物，参数只含必填 `prompt` 和可选 `image_url`，Runtime 固定 provider/model/output/concurrency，多个结果由多个独立 Tool 调用完成。2.0.7 因浏览器与本地附件边界把 `image_url` 收窄为当前权威会话内一个或多个 attachment ID，不接受本地路径或远程 URL。
- 最小纠偏：删除 2.0.7 自行增加的 `tasks/attachment_ids/width/height/quality` 公开参数和插件内批处理器；仍只注册一个目标 `imagegen` Tool，每次启动一个 owner-scoped `ctx.jobs` Job，生成固定提交 `gpt-image-2-pro`、编辑固定提交 `gpt-image-2-edit`。并发验收改为两个真实 Tool 调用并行，继续由 Harness 的并发安全与 Job 路径调度，不新增队列或第二协议。
- 生产下载门禁：最终二进制仍只来自 Cloudflare R2 的 `npm/v2.0.7/` 不可变对象。正式 `EMATE_R2_PUBLIC_ORIGIN` 现在明确拒绝 `*.r2.dev` 和 `*.r2.cloudflarestorage.com`，只接受已绑定该 bucket 的无凭据 HTTPS 自定义域；S3 API 域仅用于认证上传/回读，应用服务器不承载包字节。
- 检查：目标 pin、`@e-mate/dsh` build、完整 Host 46/46、shell 28/28、release carrier 6/6 与 scoped `git diff --check` 全部通过。Host 覆盖 Codex-like Tool schema、单次生成、当前会话改图、两次独立并发、固定模型和禁止调用方选模型；release 覆盖生产 R2 自定义域及不可变 metadata。真实生产生/改图和 R2 上传仍分别等待已批准账号/Image API 与三平台七个完整 tarball/正式 R2 自定义域，未伪造发布通过。

## 2026-08-15 · S10 imagegen 复用现有 Model Gateway 并统一固定 Pro

- 生产事实纠偏：服务器确有成熟 `/api/v1/images` Job/CAS 服务，但它使用旧版独立 JWT issuer/audience；2.0.7 登录 Provider 只持有现有 e-Mate Model Gateway session JWT。直接复用旧服务会要求第二令牌桥或修改旧客户端鉴权，因此不再把它作为 2.0.7 插件传输。
- 目标共享路径：本地 `imagegen` 继续只注册目标 `ctx.tools`，每次调用创建一个 owner-scoped `ctx.jobs` Job，输入图片只从当前权威 Session 取 attachment ID 并经 `ctx.attachments.readImage` 读取，结果经 `ctx.attachments.saveImage` 验证落盘。网络请求只走已有 `emateIdentity.request` 和 profile 已配置的 Model Gateway `/v1` 根；Gateway task/trace/session scope 由目标 Session ID 与 Tool `callId` 的稳定哈希生成，同一调用可命中既有幂等账本。没有新 REST 客户端凭据、轮询器、CAS、Store 或前端 transport。
- 2.0.5 最终合同：生成以 JSON 调 `/v1/images/generations`，编辑以 multipart 调 `/v1/images/edits`；两者都固定提交 `gpt-image-2-pro`。本地策略投影同步移除旧 `gpt-image-2-edit` 槽，只保留 Pro 和仅供服务端降级的 `gpt-image-2`。Gateway 继续只在已验证的明确上游拒绝状态下执行 `gpt-image-2-pro → gpt-image-2`，并复用同一租约、租户策略、调用 admission、幂等账本、用量回执和协议门禁。
- 信任边界：改图只接受 1–16 张当前会话 PNG/JPEG/WebP，单张不超过 5 MiB，请求总量有界；Gateway 拒绝未知 multipart 字段、混用 `image`/`image[]`、无图、重复 model/prompt、错误 MIME 和超限字节。用户与 Agent 仍只能传 `prompt` 和可选 `image_url`，不能传模型、provider、Key、尺寸、质量或并发策略。
- 门禁：`@e-mate/model-gateway` TypeScript check 通过，完整 Gateway 71 passed / 6 external-platform skipped；新增回归证明改图转发到同一路由、固定 Pro、multipart 字节完整、写入同一 usage journal，并在 provider 前拒绝额外控制。`@e-mate/dsh` build 通过；生图 Tool、身份策略映射和模型策略聚焦回归 3/3，shell 28/28、release carrier 6/6、目标 pin 与 diff check 通过。尚未部署新 Gateway，也未执行付费真实生图/改图；需要生产回滚候选、已批准用户和用量面板对账后才能关闭 S10/S12。

## 2026-08-15 · S07/S13 生产目录与三平台候选门禁补齐

- 用户最终确认下载字节只走 Cloudflare R2，并再次确认生图/改图复用 2.0.5 最终 Codex-like `imagegen` 且固定 `gpt-image-2-pro`。现有单一路径已满足：R2 只接受绑定 bucket 的 HTTPS 自定义域；Tool 只调用目标 `ctx.tools`/`ctx.jobs`/附件和既有 Model Gateway，不增加下载代理、模型选择器或第二传输。
- Gemini 上游当前不可用，2.0.7 生产默认目录与本地策略均不包含 Gemini；测试中的 Gemini 字面量只用于证明非默认路由被拒绝，不构成可见或可调用模型。恢复必须单独验证上游后再切片，不在本次发布中预留假入口。
- 发布工作流现在在 PR 上直接构建 macOS arm64、macOS x64、Windows x64 的 Runtime/Browser 候选并做匹配平台干净安装；npm 与 R2 发布仍只允许手动 `workflow_dispatch` 且 `publish=false` 为默认。主包候选同时安装、检查、测试并构建 enterprise TypeScript 工作区，避免只验本地客户端而漏掉登录、模型、审计和管理端。
- 修复企业前端构建的两个真实缺口：构建命令复用仓库已声明的 pnpm，不再依赖未声明 Bun；管理端和用量面板直接打包固定 2.0.5 submodule 的同一 e-Mate logo，不复制第二套品牌资源。`enterprise:check` 通过，enterprise tests 全绿（仅缺真实 PostgreSQL/Redis/Windows ACL 的环境测试按合同跳过），五个企业应用构建通过；e-Mate build 与聚焦回归 2/2、release carrier 6/6、工作流 YAML 解析和 `git diff --check` 通过。正式三平台 tarball、R2 admission 和生产生/改图仍待 GitHub 候选与真实账号验收，不提前标记完成。
## 2026-08-15 · 固定 Harness 的 CI 构建、发布与安装方式对齐

- 目标事实：固定提交 `47f943859bef60e4160492346772ded9b24f765a` 的 `.github/workflows/release.yml` 是 CI-first。Pull Request 与主分支先在无发布凭据的 `pack` job 中执行不可变安装、构建、完整 release-family 打包，并把 tarball 安装到仓库外临时 consumer 后运行已安装 CLI；只有手工从 `dsh-v*` 标签触发的受保护 `publish` job 才下载并发布前一步的同一制品，发布阶段不重新构建。
- e-Mate 对齐：PR 同样先生成主包和完整平台包 tarball、进行仓库外 npm 安装与 CLI/setup 自检，再汇总为唯一 release-candidate artifact；手工 `e-mate-v2.0.7` 发布只消费该候选字节。npm registry 回读通过后才允许 Cloudflare R2 不可变对象准入。因 Python/Office/OCR/Chromium 必须在目标 OS/CPU 预构建，e-Mate 保留 macOS arm64、macOS x64、Windows x64 三个原生 pack/install lane，这是相对纯 TypeScript Harness 的必要差异，不建立第二套发布协议。
- CI 根因修复：六个 Runtime/Browser `postinstall` 在源码工作区不得要求 `prepack` 才生成的资源 manifest；现在只在可确认的仓库源码根跳过缺失 manifest，任何仓库外/发布包缺失 manifest 仍立即失败。manifest 存在时 Windows 也先解析验证，macOS 再按清单恢复可执行位，不回退系统 Python/Chrome，也不下载或编译。
- 跨平台字节合同：根 `.gitattributes` 复用目标仓库的 `* text=auto eol=lf`，避免 Windows checkout 把 Python Worker 锁文件改成 CRLF 后触发 SHA-256 漂移。窄回归覆盖源码安装成功、缺损发布包失败关闭、手工发布默认关闭、publish job 无 build/pack，以及 LF 属性；本地 `node --test scripts/release.test.mjs` 为 7/7 通过。GitHub 三平台候选重跑结果仍以 Actions 为最终证据。
- 首轮 Actions 证明源码安装和 Windows 锁文件 SHA 门已经通过；Windows 随后暴露 GNU tar 把 `D:` 绝对 archive operand 解释为远端主机的真实兼容问题。Runtime 构建现在把 tar 的工作目录固定到 archive 所在目录，只传 basename，并把解包目的地改为同盘相对路径；未切换解压库或增加依赖。该修复由跨平台静态合同和 Windows 原生 runner 的实际 `prepack` 共同验收。
- 同轮 Ubuntu main job 证明旧本地绿灯依赖已构建 macOS 平台包留下的受管 binding。生产 `installProfile` 继续在 Runtime/Browser 闭包不完整时删除 binding 并失败关闭；测试改用单一显式 fixture：先调用真实 `installProfile`，仅在非发布 Linux runner 缺平台包时，从固定 Harness 的正常 Node resolution 生成带 SHA-256 的临时模块 binding。没有把 fixture、假 Runtime/Browser 或系统回退写进产品包。
- 第二轮原生 runner 继续暴露两项宿主差异：Node 24/Windows 对直接 `spawnSync pnpm.cmd` 返回 `EINVAL`，Browser builder 现改为用当前 `process.execPath` 执行固定 `playwright@1.61.1` 包自带 `cli.js`；macOS x64 首次连接 GitHub 发生 10 秒超时，Runtime builder 的既有六次下载循环现捕获网络异常并有界退避，最终仍必须同时匹配固定大小与 SHA-256。两处都没有切换下载源、浏览器版本或放宽完整性；源码与打包 Harness 的 binding 解析探针、主包 Node 测试 38/38、发布合同 9/9 均已通过，最终状态继续以 Actions 原生 runner 为准。
- Actions `e1a8c46` 已通过源码 CI、主包、三类平台包、证据包及两类 macOS 干净安装；Windows 干净安装在 npm 解包后、首次 staging 环境检查前后静默退出 1。Release workflow 继续失败关闭，但在检查非零时回显原 JSON 报告，使下一轮能按具体 `check.id` 定点修复，不再靠 runner 时序猜测，也不跳过 Windows 门禁。
- 诊断轮 `4b646f0` 给出唯一失败项 `credential_store: Windows CurrentUser DPAPI unavailable`；同一份已安装 tarball 的 Harness、Runtime、Office、OCR 和 Chromium 检查全部通过。根因路径收敛到 Windows PowerShell 的 DPAPI 类型装载：既有脚本现显式加载系统自带 `System.Security` 程序集并使用完整 `System.Security.Cryptography.*` 类型名，仍采用 `DataProtectionScope.CurrentUser` 与原密文文件合同，不增加依赖或明文回退。
- DPAPI 修复轮 `6db39f6` 的 Windows staging check 已走到 Chromium 启动后的临时目录回收，但 Windows 文件锁尚未释放时同步删除触发 `EPERM`，因此报告在 DPAPI 检查前中断。Chromium 检查现在使用 Node `rmSync` 原生 `maxRetries/retryDelay` 处理 Windows 短时锁；仍递归删除并在重试耗尽后抛错，没有残留忽略或平台绕过。

## 2026-08-15 · 插件闭包重定基线（替代旧七包架构）

- 用户最终选择“单一 `@e-mate/dsh@2.0.7` tarball + 固定 Harness bundle”作为 2.0.7 当前架构。六个 `@e-mate/dsh-runtime-*`/`@e-mate/dsh-browser-*` 平台包、随包 Python、Office/OCR Worker、RapidOCR/ONNX 模型、Chromium、旧 dream/learning 实现及其预装依赖均从当前产品闭包删除。上文与旧平台包有关的构建、摘要、Actions 和性能记录只说明当时发生过的实验，不再构成当前 S01/S05/S06/S10/S13 的通过证据。
- 当前内嵌 bundle 清单固定为 `office-skills`、`search-mcp`、`ego-browser`、`browser-panel`、`vision-toolkit`、`memory-evolve`、native-subagent receipt、`genui`、`better-sidebar`。它们必须走 rc.5 Loader、bundle patch、Skills/Tools/Jobs/Storage/Session/Connection/slot 机制；不得增加自有 WebUI–CLI 协议、Router、Store、Agent Loop 或动态插件安装器。Subagent 只复用目标原生实现，不复制 AGPL 项目代码。
- Office 改为四个 clean-room Skills，不再声称包内可执行 DOCX/XLSX/PPTX/PDF Worker。Vision/OCR 因 rc.5 缺 enterprise model-policy seam 保持 `blocked`，不得回退旧 Python、RapidOCR、模型 Key 或非治理模型路由。`memory-evolve` 必须以 WorkspaceRegistry + canonical-path fingerprint + session membership 绑定项目；通用会话仅能使用 session scope，旧 dream/learning 不作为并行兼容层复活。
- Windows 浏览器路线按用户选择固定为 Microsoft `@playwright/mcp@0.0.78` + 已安装系统 Edge，安装/setup 不得二次下载浏览器。rc.5 workspace roots/permission 组合及真实 Windows 验收尚未完成，因此公开状态必须是 `PLAYWRIGHT_MCP_EDGE_UNVERIFIED`/`setup-required`，Browser Panel 不得自行显示 ready。macOS Ego Browser 同样需真实启动、权限、隔离、清理、交互和下载证据；当前不得写成已可用。
- 发布继续对齐目标 CI-first：PR/主分支构建并仓库外安装同一主包 tarball，受保护发布只消费已验收原字节；npm 回读后才进行 Cloudflare R2 不可变对象 admission。旧七包 release carrier 必须重构并重跑，不能因源码适配或历史 Actions 记录标记完成。5,000 事件反向滚动掉帧百分比继续只作诊断，没有发布阈值；FPS、heap、长任务、事件绘制延迟和泄漏预算仍有效。
- 本条是后续开发与验收的防漂移基线。如与本文件更早的 Runtime/Browser/Worker/Chromium 记录冲突，以本条和当前规范文档为准。当前只完成架构/文档纠偏；单包构建、干净安装、CI、Windows Edge、macOS Ego、Vision/OCR、Office 全场景、Computer Use、npm/R2 和生产 URL 均未因本条自动通过。

## 2026-08-15 · S01/S05 单包 macOS 安装、快捷方式与单实例实跑（前序候选）

- 候选字节：精确 `pnpm@11.7.0` 生成的该轮唯一 `@e-mate/dsh@2.0.7` tarball 大小为 `61,322,499` 字节，SHA-256 为 `b7f0fa15f3c497745f7010268ab4154434ca89c681a0678360273ab7fb5e7342`。它完成了 CLI/快捷方式证据，但随后被 S09 canonical workspace 修复生成的新候选取代，不再作为发布候选。发布 verifier 当时确认九个 bundle、固定 Harness `0.1.0-rc.5`/`47f943859bef60e4160492346772ded9b24f765a`、584 个 SPDX 组件，release carrier 6/6 通过。
- 仓库外安装：用临时 npm 全局 prefix、独立 `DSH_HOME` 和独立 Desktop 安装该精确 tarball；staging `setup --check --json` 为 7/7，`setup` 后为 8/8，CLI 版本为 `2.0.7`。安装目录没有 Runtime/Browser 平台 optional package，setup 未运行 pip、浏览器下载或本地原生编译。
- 快捷方式与单实例：macOS `e-Mate.command` 内容仅为登录 shell 执行当前 `e-mate launch`，不含临时 prefix 或旧包绝对路径。服务先在 `55208` 启动后连续执行快捷方式两次，三次观测均保持 PID `70336`、实例 `74e52902-3b9a-4cf1-a087-dab31688f50b`，健康接口返回同一实例且 `active_runs=0`；同版再次 `setup` 原子覆盖快捷方式后重新启动、`stop` 与后续非健康 `status` 一致。
- 负向边界：独立非 e-Mate HTTP 服务占用 `55209` 时，`launch` 精确失败为 `port 55209 is occupied by a non-managed or unhealthy process; nothing was stopped`，占用进程仍存活。验收全部在临时目录完成并清理，没有修改全局 e-Mate、用户桌面或生产服务。
- 尚未关闭：本轮设置 `EMATE_NO_OPEN=1` 以避免影响用户默认浏览器，因此证明了浏览器生命周期与 Host 解耦、快捷方式复用同一实例，但未把“真实默认浏览器关闭后再次双击重开页面”记作 Computer Use 通过。macOS 实际浏览器重开、Windows `.lnk`/Edge 实机、macOS x64 同字节安装仍是 S01/S05/S12 门禁。
- Browser 补证：该前序 tarball 另起隔离实例 `497f8d0e-8b95-4b02-9f3e-83f3ff78a7ca`，in-app Browser 完成插件加载后投影 `/login`、`title=e-Mate` 且真实登录页可见；关闭唯一标签后浏览器会话列表为空，但 loopback health 仍返回同一实例。重新新建标签可再次加载 `/login`，证明关闭网页不终止 Host、页面可从同一实例恢复。随后 Browser 标签、Host 与临时安装目录均已清理。该证据仍不替代快捷方式触发系统默认浏览器窗口的可见 Computer Use。

## 2026-08-15 · S09 canonical workspace 记忆隔离与候选重打

- 根因：产品受管“通用会话”位于 `$DSH_HOME/e-mate/general`，目标 `WorkspaceRegistry` 用 `fs.realpath` 维护唯一 workspace 身份，而 `dshHomePath()` 只做路径拼接。原适配器把 registry 返回的 canonical path 与未 canonicalize 的配置字符串直接比较；当 `$DSH_HOME` 或其父目录含符号链接（macOS `/tmp`/`/private/tmp` 也是同类）时，会把通用会话误判为项目 scope，导致同一受管 workspace 下的会话共享记忆键。
- 最小修复：不增加第二套 path 工具或缓存；在字符串不相等时直接复用目标 `WorkspaceRegistry.resolveByPath(sessionOnlyWorkspacePath)`，只有解析到与当前 workspace 相同的 authoritative ID 才切为 Session scope。Workspace 状态和 Session membership 的失败关闭条件不变。
- 可执行证据：`@e-mate/dsh-plugin-memory-evolve` 4/4 通过，其中真实组合使用固定 rc.5 `WorkspaceRegistry`、目标 JSON Storage Domain、真实目录和符号链接，证明两个通用会话 key 不同、两个普通项目会话 key 相同且与通用会话不交叉；主包受管 profile 与九 bundle 闭包定向测试 2/2 通过。源码、同步 bundle、tarball、仓库外安装副本的 `scope.js` SHA-256 均为 `016db058d8a4f647bd8fbe82f4cc3eaed903709e752b2d4522f195054f0f0029`。
- 该轮候选：精确 `pnpm@11.7.0` 重打唯一 tarball，大小 `61,322,603` 字节，SHA-256 为 `f9fa66a33823c6a04041c3db157465ab586a01bc249f17ea6dcf233a4c02744e`；release evidence 为 1 个 tarball、584 个 SPDX 组件。通过 `npm@11.6.2 install --prefix ... <exact-tarball>` 的仓库外安装、`e-mate --version`、`setup` 和 `setup --check --json` 8/8；全程使用隔离 `DSH_HOME`/Desktop，未写生产状态。该字节随后被下面的 S06 请求校验/完整性收据候选取代，不再作为当前发布候选。
- 仍未关闭：真实历史 schedule/项目移动样本、macOS x64/Windows 同字节 CI、Windows Edge/macOS Ego、生产 Computer Use、npm registry 回读、R2 admission 和三个生产 URL 激活仍缺证据；本轮未发布、未部署、未修改生产服务器。

## 2026-08-15 · S06 单包重装、Updater 请求边界与完整性收据

- 根因审计：detached Helper 读取 mode-0600 request 后只核对 schema/request ID，没有再次验证 `target/current_version`；同时升级合同要求记录包完整性，但终态收据只有版本。即使 scheduling 入口已限制版本，这个持久化边界仍不应把损坏或被改写的 npm spec 继续传给安装/回滚路径。
- 最小修复：继续复用唯一 `update.ts` 事务，在 Helper 内用既有 SemVer 解析器重新验证 request，并要求 npm registry 对 staged/previous 精确版本返回合法 `sha512-...==` SRI。成功收据写 `installed_package_integrity`/`previous_package_integrity`；失败和回滚收据写 staged/previous integrity。`e-mate status` 仍只投影 request ID、终态和版本，不暴露 registry 输出、路径或错误。
- 同版实跑：新候选在隔离 npm prefix、`DSH_HOME` 和 Desktop 中安装后连续执行两次 `setup`，两次命令均成功、最终环境检查 8/8。第一次从用户既存只读源导入 15 条会话，第二次为 `imported=0/reused=15`，source fingerprints 完全一致；schedule 收据同样没有重复导入，证明同版修复 profile/快捷方式不会复活或复制会话。
- 门禁：主包 Host 42/42、shell 28/28、release carrier 6/6、workflow YAML 解析、target pin 与 diff check 通过。发布工作流的三平台 tarball lane 现在连续运行两次 setup；正式 npm 回读 lane 运行 `e-mate update --version 2.0.7 --json`，必须匹配 request ID、`completed`、两份 SHA-512 integrity，随后 `stop`。该 CI 门禁尚未由真实 npm 发布触发，不作为已通过证据。
- 当前候选：九 bundle 最终集成并清除公开 npm description/README 首句中的 DeepSeek Harness 产品字样后，用精确 `pnpm@11.7.0` 重打唯一 tarball，大小 `61,323,433` 字节，SHA-256 `ff2eed4b1fba08dd269170c53aaaf311725b9d8c0a1b7745df98eab1fb228c67`；技术文档仍保留必要的上游归因。本地 release evidence 为 1 个 tarball、584 个 SPDX 组件且 evidence checksum 全通过。仓库外 npm 安装、两次 setup 和 8/8 check 通过，第二次迁移为 `imported=0/reused=15`。旧 `dist/npm` 中两个平台包产物已按单包证据合同删除；未发布、未部署。仍缺真实跨版本失败恢复、活动任务竞争、降级、macOS x64/Windows、npm 回读和 R2 admission。

## 2026-08-15 · S08 本机真实旧会话只读迁移证据

- 来源发现：产品的 `defaultLegacySources()` 在本机找到 3 个权威来源，分别为 e-Mate Runtime、ECoreX Runtime 和 CowAgent。证据只记录 family、路径 SHA-256、聚合 SHA-256、文件数和字节数，没有输出会话标题、消息、附件名、明文路径或凭据。
- 源不变：在隔离的 `DSH_HOME` 与 Desktop 上连续执行两次真实 `e-mate setup`。对源 SQLite、WAL/SHM、Runtime artifact、CowAgent 树及旧 memory 证据做前/中/后清单；第一次和第二次之后的聚合 SHA-256 均与开始时完全一致。两次 setup exit 0、stderr 为空。
- 幂等结果：第一次 `source_found=true/imported_sessions=15/reused_sessions=0`；第二次 `source_found=true/imported_sessions=0/reused_sessions=15`，3 个 source fingerprint 逐项一致，最终迁移收据含 15 个稳定目标 Session。当前真实 Runtime 源只有 active 行，未提供 deleted 真实样本，因此“删除会话不复活”继续由已存在的可执行 fixture 覆盖，不能写成真实样本已通过。
- 仍待关闭：需要在真实 Browser 中打开并继续其中一条导入会话；需要 moved/missing project 与并发 WAL 样本，以及企业端提供旧 `memory/users/<id>` 到新账号的权威映射。隔离测试目录没有写生产 `DSH_HOME`、用户桌面或企业服务器。

## 2026-08-15 · S05 正式快捷方式当前环境缺口

- 当前用户真实 Desktop 已有正确的 `e-Mate.command`，内容只经登录 shell 执行 `e-mate launch`，没有绑定旧 npm 路径；但 `/bin/zsh -lic 'command -v e-mate'` 当前返回空，说明机器尚未从正式 npm 全局安装 e-Mate，双击该快捷方式会失败。
- 本轮没有把未发布的本地候选安装进 Codex 自带 Node 前缀或用户全局环境来制造可见通过；`pnpm dlx npm@11.6.2 prefix -g` 在当前工具环境解析到 Codex runtime 自身目录，也不适合作为产品全局前缀。真实默认浏览器重开应在正式 npm registry 回读后，以用户正常 Node/npm 全局安装路径执行。

## 2026-08-15 · S13 Windows ESM 路径与旧 Actions 候选收敛

- GitHub Release run `31879791989` 的唯一失败为旧候选 `70ff2ce2e340682f4aad2be27e4ec8f1d74ee913` 的 Windows clean-install。npm 解包完成后，setup 报错 `Received protocol 'd:'`；根因是迁移入口把 `createRequire().resolve()` 返回的 `D:\\...` 绝对路径直接交给动态 `import()`，Node ESM 将盘符当成 URL scheme。
- 现行单 tarball 架构没有恢复已删除的 Runtime/Browser 平台包。共享迁移入口只复用 Node 原生 `pathToFileURL(...).href` 转换三个 Harness 模块路径，与 profile 内既有目标模块加载方式一致；新增窄回归禁止 `import(harnessRequire.resolve(...))` 重新出现。
- 当前 `@e-mate/dsh` build、Windows ESM 路径聚焦回归 1/1 与 scoped `git diff --check` 通过；现行 `.github/workflows/release.yml` 只上传 `e-mate-dsh-2.0.7.tgz` 并在 macOS arm64/x64、Windows x64 安装同一字节。远端失败 run 属于已淘汰的七包候选，没有重跑或伪造通过；必须提交现行候选后由新的 Windows runner 验收该修复。

## 2026-08-15 · S13 Windows 路径修复后的本地单包候选

- 精确 `pnpm@11.7.0` 重打唯一 `@e-mate/dsh@2.0.7` tarball；大小 `61,323,563` 字节，SHA-256 `d4a9e05b4869a33dfefdd158e81f71e5d634c9424e5ed776e106372b119c375a`。release verifier 只发现 1 个 tarball，SBOM 为 584 个 package/relationship，`EVIDENCE_SHA256SUMS` 和 tarball `SHA256SUMS` 均通过。
- 仓库外用 `npm@11.6.2` 安装该精确字节，CLI 输出 `2.0.7`；staging check 7/7、setup 后 check 8/8，固定 Harness `0.1.0-rc.5`/`47f943859bef60e4160492346772ded9b24f765a` 与 9 个插件 bundle 均通过。安装、`DSH_HOME` 和 Desktop 使用隔离 `/tmp` 目录并在验证后清理，没有修改全局安装、用户桌面或生产状态。
- 当前工作树尚未提交，证据 manifest 的 `source_commit` 仍只能记录旧 HEAD `70ff2ce2e340682f4aad2be27e4ec8f1d74ee913`，因此这轮只证明本地字节可安装，不可作为可发布不可变候选。下一份正式候选必须来自包含本修复的干净提交，并由 GitHub Windows runner 关闭 `D:` ESM 回归。
- 为避免旧 HEAD 被错误绑定到未提交字节，`release:evidence` 现在在生成任何证据前要求 `GITHUB_SHA`（若存在）与 checkout HEAD 一致，并要求 tracked/untracked worktree 均为空；普通 build/pack 不受影响。release carrier 7/7 通过，真实脏工作树 CLI 负向探针按合同拒绝，错误为 `release evidence requires a clean worktree`。
- 提交前根门禁还捕获到一次工作区调度竞态：根 `pnpm test` 同时运行主包测试与插件自己的 rebuild，`memory-evolve` 清理 `lib/` 时主包的 bundle 同步读到 `ENOENT`。修复只调整既有脚本顺序：9 个插件仍以并发 4 完成测试，全部结束后再运行 `@e-mate/dsh`，没有增加锁、重试或第二构建系统；release 合同锁定插件测试必须先于主包测试。修复后根门禁完整通过：Host 43/43、shell 28/28、各插件测试及 release carrier 7/7 全绿。

## 2026-08-15 · S13 新提交 CI 的源码解析与 bundle 前置条件

- Draft PR #1 的提交 `b85d57467a6fd5c39930d11ac9908a9008405357` 触发 CI run `31886626728` 与 Release run `31886626760`。两者都在无发布凭据的 PR 门禁阶段失败；npm、R2 和生产页面 job 均未运行。
- CI 首个真实错误为主包同步九个内嵌 bundle 时缺 `packages/dsh-plugin-better-sidebar/lib/index.js`。工作流此前绕过根测试顺序，直接执行 `pnpm --filter @e-mate/dsh test`；现在复用根唯一 `pnpm test`，先构建/测试插件再测试主包，并由 release carrier 拒绝该工作流退回直跑主包。
- Release 的六项失败同源于 `installProfile` 只从 Harness CLI 根 `node_modules` 解析 target 服务包。干净 CI 的固定源码树已生成各 package `lib/index.js`，但根目录不保证链接未被 CLI 直接依赖的 workspace package；本地历史 `node_modules` 恰好掩盖了这一点。共享 resolver 现在在固定源码树中按 package manifest 的真实 `main` 读取已构建入口，缺 build 立即失败；正式 npm 包仍从 Harness 自己组装的 portable `node_modules` 解析。会话迁移的 Cordis/Session 三个动态 import 复用同一 resolver 和 `pathToFileURL`，没有第二 binding 或测试专用回退。
- 删除已失效的 45 行测试 binding 补丁，测试直接调用产品 `installProfile`。本地验证：Host 43/43、shell 28/28、release carrier 7/7 与 `git diff --check` 通过；新增源码模式断言精确解析 `dsh-storage-domain/lib/index.js`，品牌扫描同时保证错误文本不向用户暴露 Harness 产品名。最终跨平台结论继续以修复提交后的 GitHub Actions 为准。
- 修复提交 `e13e0082805bbbf65142c68db2b174af723aa723` 的 CI run `31887177839` 已越过 bundle 同步和全部 target module binding；唯一剩余失败是 Linux runner 的环境测试无条件要求 `report.ok=true`，与 2.0.7 只支持 macOS/Windows 且 Linux 必须拒绝凭据后端的产品合同冲突。测试现在仍强制 Harness 与九 bundle 为 pass，同时按真实 `platformSupported()` 和 `checkOsCredentialBackend()` 断言宿主相关状态；没有把 Linux 加入支持范围、把凭据降为 warning 或放宽 setup 门禁。

## 2026-08-15 · S07 用量审计面板真实账本接入

- 复用现有 `usage-dashboard → Analytics API` 同源 Bearer 链路：概览、时间范围、用户/模型 Token 明细、成本、四项对账差异和分页调用事件均只投影 `/v1/usage/*` 与 `/v1/tasks/summary` 的真实响应；事件页必须与当前 tenant/from/to 完全一致，不一致失败关闭。
- 用户显示名、状态和配置 Token 额度只读复用已有 `/v1/admin/users` 权威投影；`null` 按合同显示“不限”，审计凭据无管理读权或管理存储不可用时明确显示“配额数据不可用”，不伪造 0 或阻断其他审计事实。面板未增加插件、工具、会话或 Job 控制接口。
- 部署路径固定为 `/ecorex-agent/usage-panel/`，生产 API 使用同源已存在的 `/e-mate/enterprise-api/`；当前外部 URL `https://mvdcm.ecoremedia.net/ecorex-agent/usage-panel/` 返回 Nginx Basic `401`，缺真实账号，未做生产登录、部署或账本对账；旧同源 API `/e-mate/enterprise-api/healthz` 实测 `200`。
- 视觉复用现有 e-Mate 管理面深色/品牌橙 Token 与原 Arco 组件，未引入新 UI 依赖。`tsc --noEmit`、11/11 用量合同测试和 Vite production build 通过；以真实 schema 形状的本地拦截回放验证 `1280×900`/`320×800` 的 `scrollWidth === clientWidth`，测试数据没有写入产品或生产服务。

## 2026-08-15 · S07 企业管理端账号、用户、配额与模型策略

- 管理端复用 e-Mate 用户端已有品牌资产、OKLCH Token、圆角、按钮、输入、弹层、卡片、表格与响应式规则，生产 base 固定 `/ecorex-agent/admin/`。登录复用 Auth Gateway `/v1/auth/password`；密码不持久化，短期 access JWT 每次由 Analytics 核验 Ed25519 签名并回查有效 session/用户/当前角色。租户用户只能为 `TENANT_ADMIN`/`AUDIT_ADMIN`/`MEMBER`；`SUPER_ADMIN` 仍是静态引导身份，不能由密码会话签发。
- 用户面完成搜索、新建/编辑/停用/删除、单个与批量审批、批量模型策略与 K/M/不限 Token；新建的 ACTIVE 用户在 UI 与 contract 都强制至少一个已启用模型。`token_limit=null` 现在是权威不限语义，Auth session 签发为 `Number.MAX_SAFE_INTEGER`，不再被错误拒绝。协议页只读显示版本、时间、状态和内容哈希，未查到时不冒充“已确认未签”。
- 模型 Key 仍只写入后端 AES-256-GCM 租户/路由绑定存储，页面和日志不回显。模型“添加/移除”是对 Model Gateway 已部署 catalog 的租户发布状态 CRUD；未知 route 返回 404，UI 不提供任意上游 route 创建。移除后 Auth 模型下发和 Model Gateway 新请求都立即失效，重新发布仍保持 disabled，需管理员显式启用。
- 本地门禁：admin-contract 11/11、Auth 14/14、Analytics 33/33、Model Gateway 71/71、Admin 13/13，合计 142 项通过；Auth 与 Analytics/Model Gateway 因未提供真实 PostgreSQL/Redis 的 20 项集成用例按环境合同 skip。五个 TypeScript check 和 Auth/Analytics/Model/Admin production build 通过；Admin Vite 仅有已知的大 chunk 警告。Auth 与 Model Gateway 启动探针现在同时校验 `published` 及路由 Key 密文列，旧库未先迁移时会在启动阶段失败关闭，不等到首次登录/模型调用才暴露。未获得生产管理员账号、会话公钥/反代配置和真实数据库环境，因此未部署、未对生产账号或模型 Key 做任何变更。

## 2026-08-15 · S07 管理端当前模型真实联通测试

- 沿用 Auth Gateway 登录响应中既有的短期 Model Gateway session，不增加管理 API 到 Provider 的代理，也不把上游 API Key、Endpoint 或错误正文交给浏览器。模型 session 使用独立 `sessionStorage` key；base URL 必须与管理端同源，过期或跨源立即失败关闭。
- 点击“测试联通”先读取目标 `/v1/models` 权威目录，再依据目录的 `capabilities.imageGeneration` 选择一次最小 Responses 推理或一次真实生图；没有按模型 ID 写分支。两条路径继续经过协议、当前用户允许集合、租户发布/启用、加密 Key、幂等调用和用量账本，因此界面明确提示测试会计入真实用量。
- Admin API 窄测增至 16/16，覆盖登录 session 校验、同源路径、文本 SSE 终态、生图目录分派、Token 不进入 URL；TypeScript check 与 production build 通过。IAB 本地合同回放实际点击后显示“联通正常”，`1280×900` 与 `320×800` 均无横向溢出；证据为 `artifacts/design-qa/S07-admin/models-connectivity-final-1280x900.jpg` 和 `models-connectivity-mobile-final-320x800.jpg`。
- 本次只验证本地同合同 fixture，不冒充生产 Provider 通过。生产终证仍需已批准管理员、已签协议、当前允许模型、真实 Model Gateway/数据库/Redis 与用量面板对账；未使用用户提供的生产 Key，也未部署生产。

## 2026-08-15 · S07 用量面板 e-Mate 明暗视觉重构

- 视觉真源固定为当前用户端 `desktop/src/styles/tokens.css` 与 `design.md`：Usage Dashboard 直接消费相同 OKLCH 明暗 Token、系统 CJK 字体、四点间距、248px 导航、8px workspace inset、16px 外框和 e-Mate 品牌资产；未增加第二套主题、图片或 UI 依赖。
- 主题只跟随 `prefers-color-scheme`；根 `data-theme` 与 Arco `arco-theme` 同步并监听系统变化。统计口径、Bearer 鉴权、API 路径、租户边界、配额语义与事件明细没有改变；Vite 本地代理补齐已存在的 `/v1/admin/users` 同源读路由，仅用于与生产同合同的开发验收。
- IAB 以真实 schema 形状的只读本地回放验证暗色 `1280×900` 与 `320×800`，两者均为 `scrollWidth === clientWidth`；桌面保留 Workbench 导航/单 workspace surface，手机保留四个导航入口、时间范围、刷新与横向独立滚动的明细表。首轮手机截图发现选择器误隐藏 IconPark wrapper，已收窄为只隐藏文字标签，复测四个图标全部可见。
- 证据：`artifacts/design-qa/S07-usage-dashboard/implementation-dark-1280x900.jpg`、`implementation-dark-320x800.jpg`、`source-vs-implementation-dark.jpg`。12/12 聚焦测试、TypeScript check 与 production build 通过；浏览器仅出现 Arco/React 19 既有 `element.ref` 开发警告，无页面错误状态。生产 URL、真实只读令牌和账本对账仍未执行，本轮未部署、未使用生产凭据。

## 2026-08-15 · S07 用量面板事件口径、用户事件次数与主题选择

- 旧事件真值来自固定 2.0.5 `usage_panel_service.py` 的 `EVENT_TYPE_ZH`。当前 `e_mate_task_event.type` 不能把 `TOOL_EXECUTION` 无损拆成旧版 `tool.started/tool.finished/tool.failed`，且 `FIRST_RESPONSE/SKILL_SELECTED/PERMISSION_REQUESTED/WAITING_INPUT` 没有旧枚举对应，因此不猜测迁移：只将可确定对应的 `RECEIVED/COMPLETED/FAILED/CANCELLED/ARTIFACT_UPDATED` 恢复为“任务已接收/任务已完成/任务失败/任务已取消/产物已更新”，其余保留当前任务事件合同。旧 `runtime-audit` 的 `actionTypeCounts/actionTypeLabels/userActions` 实现位于部署时动态加载的 `ecorex_admin_api`，未随本仓库源码提供，本片不伪造第二套动作分类。
- `TenantTaskSummary.userEventCounts` 由既有 `PostgresTaskEventStore.summary()` 在同一 tenant、同一 `from/to` cohort SQL 中直接按 `e_mate_task_event.user_id` 聚合；没有 cursor、limit 或前端分页反算。合同校验每用户唯一、精确十进制字符串，且用户合计必须与完整 `eventTypeCounts` 守恒。Usage 用户表新增“事件次数”，并补入只存在任务事件账本、没有模型 Usage 的用户；调用明细 Drawer 继续只显示分页 `REQUEST/USAGE`，不混作任务事件计数。
- 明暗切换复用现有 `data-theme`/`arco-theme` 路径和 e-Mate Token；按钮可键盘操作并带 `aria-label`，仅将 `light|dark` 保存到 `localStorage`，非法值或存储不可用时回退系统主题。没有新增 Theme Store、依赖或视觉体系。
- 聚焦门禁：Monitoring Contract 6/6、Analytics 33/33（另 6 项真实 PostgreSQL/Redis 集成按环境合同 skip）、Usage 12/12 通过；Analytics 与 Usage TypeScript check、Analytics production TypeScript build、Usage Vite production build均通过。主进程随后用同合同本地账本回放实点明暗切换并刷新，`data-theme`/`arco-theme` 均保持 `light`；320×800 下 `scrollWidth === clientWidth === 320`，主题按钮、“事件次数”和仅有 task event 的用户均可见。浏览器只出现既有 Arco/React 19 `element.ref` 开发警告。未连接真实 PostgreSQL、未部署生产，生产账本对账仍待真实环境。

## 2026-08-15 · S04/S12 最终 Computer Use 口径增补

- 模型验收新增：切换模型后下一次真实请求必须命中新路由，切换前后同一会话上下文连续；上游不稳或弱网恢复不得重复消息、Tool、用量事实或审计回执。聊天视觉只以任务 `019ff665-d721-79a0-869d-338f086cf529` 的交互原型和逐屏标注为真源，逐状态逐交互核对，不以首页或静态截图代替。
- 生/改图并发改为逐级加压并记录稳定上限、首个有界拒绝/退化点及附件/会话归属。四类外部连接的 2.0.7 终验边界改为可发现、正确路由并到达 provider 真实授权 handoff；不提交 OAuth consent、二维码确认、凭据或外部写入。在线更新必须可由用户自然语言触发 Agent 复用既有受管 npm 事务，成功恢复后核对版本、会话、凭据、outbox 和完整性收据。
- 性能新增固定 Harness 配对门禁：同机器/浏览器/网络/模型/提示/Tool 下至少 30 对成功样本；e-Mate 有效缓存租约、模型策略和异步审计开启时，TTFT p50/p95 额外开销不超过 5%/10%（小样本绝对容差 50 ms），持续生成吞吐 p50/p95 下降不超过 5%/10%，Tool event→start 与 Tool result→下一请求的 p95 额外延迟均不超过 50 ms 且相对不超过 10%。企业端断连但租约/策略仍有效时重复同一门禁，证明管理层只作旁路观察/鉴权而不拖慢本地运行。

## 2026-08-15 · S06 Agent 自执行在线更新端到端审计

- 真实路径复核：自然语言意图只由固定 Harness Agent Loop 结合 `emate-agent-operations` 系统提示选择目标已注册的 typed Bash/macOS 或 PowerShell/Windows Tool；Tool 只在前台调用 `e-mate update [--version] --json`。CLI 生成 UUID request ID、持久化请求并把唯一 `update.ts` 事务交给 detached helper；目标 Jobs 服务只提供非更新 Job 的空闲门禁。没有浏览器关键词匹配、第二 Router/transport、第二更新器、`e_mate_update` 平行 Tool 或 Agent 拼装 npm/setup/stop/launch 命令。
- 信任边界修复：精确 `--version` 过去只验证 tarball 内版本是 SemVer，没有再次要求其等于请求版本；错误 registry 元数据可能把“请求 2.0.8、实际 2.0.7”继续执行。现在 staging 在任何 setup、快照或全局替换前精确比对 requested/staged version，`latest` 仍以解出的真实版本为准；helper/lock 同时只接受 `randomUUID()` 形状的 RFC 4122 v4 request ID。
- 隔离事务证据：使用现有 `dist/npm/e-mate-dsh-2.0.7.tgz`、临时 Node/npm、临时 npm registry proxy、临时 global prefix、临时 `DSH_HOME` 和 `EMATE_NO_OPEN=1` 执行同版在线更新。权威收据 `online-update-832f617d-41be-4fdb-8509-a76684cecd66.json` 为 `completed`，requested/previous/installed 均为 `2.0.7`，前后 SHA-512 integrity 相同；记忆哨兵保留、收据唯一、update lock 已释放，重启后 `/api/e-mate/health` 为同版本健康实例，随后只停止该临时实例。未修改系统全局安装、用户正式 `$DSH_HOME` 或生产服务器。
- 聚焦门禁：`@e-mate/dsh build` 通过；更新 target/request/lock/status 与 Agent guidance 窄回归 4/4 通过。当前 npm registry 对 `@e-mate/dsh@2.0.7` 返回 404，真实自然语言模型选 Tool、正式跨版本 npm 更新与故障后 rollback 仍必须在发布候选、已批准身份/模型和两平台环境中验收；本地同版 fixture 不能冒充这些终证。

## 2026-08-15 · S03/S07 模型切换、重连与幂等合同补强

- 运行边界：模型菜单继续只调用固定 Harness 的 `ModelDirectory → session.selectModel`；Host 在下一次 `agent/request` 组装边界读取同一 Session 的新选择，既有消息历史不重写。浏览器弱网只重连目标的两个下行事件流，既有 unary prompt 不由 e-Mate 自动重发，因此没有新增 transport、Store、前端模型写入或泛化重试。
- e-Mate 回归补强：现有 `model-policy` 测试现在以同一 `sessionId` 连续选择两个允许模型，证明包装层原样委托目标 `selectModel`、选择后目录返回新模型、历史消息保持不变；企业策略端不可达时只允许账号绑定且未过期的缓存策略继续工作，账号变化仍失败关闭。现有 `audit` 测试同时重放相同 Harness usage 事件并并发 `flush`，证明 outbox 仍只有一个 `fact_id/payload_sha256`，失败后重送使用同一载荷，交付后再次重放不会新增上传。
- 可执行证据：`@e-mate/dsh` 聚焦 2/2、完整 `e-mate.test.mjs` 34/34；固定 Harness `api-proxy-models`、`ConnectionController` 和客户端 Session 回放/缺口修复 74/74；固定 Harness checkpoint crash-recovery 2/2；企业 Model Gateway 71/71，通过项覆盖 pending/recorded replay、provider 明确未接收时复用原幂等键、结果已入账后拒绝重放、未知结果进入 reconciliation 而不二次 POST。真实 PostgreSQL 4 项和 Windows-only 2 项按环境合同 skip。
- 未关闭的生产门禁：以上证明本地组合合同，不能替代真实 Provider。仍需已批准且下发多模型策略的生产账号，在受控弱网/上游故障注入下完成至少 30 对真实请求，并用 Session 事件序列、Tool call ID、Provider invocation ID、Usage fact、audit receipt 和 Usage 面板逐项对账；当前没有该账号与真实 PostgreSQL 测试 URL，故生产项保持阻塞且未部署。

## 2026-08-15 · S04 固定 Harness 首响/流速/Tool 成对门禁

- 缺口核实：既有 `scripts/create-performance-fixture.mjs` 只生成目标持久化层的 5,000 事件滚动数据集，仓库中没有 TTFT、持续生成吞吐、Tool call→真实执行和 Tool result→下一模型请求的成对采集/判定入口；性能文档此前只有阈值，没有可执行门禁。
- 最小实现：新增 `scripts/performance-parity.mjs`，直接组合固定提交的 `LlmRuntime/SessionStore/SystemPrompt/ToolRuntime/AgentRegistry/AgentLoop`。Keyless Provider 只产生目标 StreamChunk，所有计时样本均从 Agent Loop 实际追加的 `user/message`、`assistant/chunk/message`、`tool/call/result` 与真实 Tool body/下一次 adapter request 边界派生；没有手写 Session event、e-Mate 延迟拦截器、第二事件协议或新依赖。
- 判定合同：三个 cohort 各至少 30 个同 pair ID 且无重复事件的样本；TTFT、吞吐和 Tool 两段 p95 精确执行文档阈值，并强制企业端不可用 cohort 声明有效缓存租约/策略和异步 outbox。聚焦单测覆盖 29 样本、重复事件、超 TTFT、低吞吐、Tool 超 10% 和过期租约的失败关闭。
- 防伪边界：默认命令固定输出 `fixture-passed-production-blocked`。仅把 JSON 改名为 `production-real-provider` 仍不能通过；生产输入还必须提供 pinned commit、精确 provider/model/Tool/dataset、同环境、起止时间、raw sample ID/样本哈希和实际 raw/Provider receipt 或 Trace 文件，CLI 逐文件回读 SHA-256 后才允许进入生产判定。当前缺已批准生产账号和真实 Provider 配对运行，因此生产性能仍明确阻塞。
- 本地证据：`node --test scripts/performance-parity.test.mjs` 2/2；固定目标检查通过；真实 Agent Loop 自测三个 cohort 均 30 样本、无判定失败，输出 `fixture-passed-production-blocked` 和 `REAL_PROVIDER_AND_APPROVED_ENTERPRISE_ACCEPTANCE_ACCOUNT_REQUIRED`，未访问生产、未读取模型 Key、未写入产品数据。

## 2026-08-16 · S03/S12 主代理 Computer Use：聊天框裁切与 320px 控件闭环

- 流程按 S12 固定合同执行：主代理运行隔离 Browser 验收并保存证据；独立视觉失败交子代理仅改 `home.module.css` 与直接回归；主代理重新装载构建并逐屏复测，子代理不关闭验收项。
- 第一轮发现 placeholder 被裁切，且 `320px` 下真实模型、连接器和 Send 互相覆盖。子代理首修把 `44/66px` 高度下限移到目标 mirror 并恢复移动双行 toolbar；主代理没有直接接受，因为 `768/1440px` 的真实 textarea 仍为 `28px`、`scrollHeight=38px`。
- 第二轮以 Browser computed style 定位到 e-Mate 裸 `:global([data-phase])` 误命中 Harness `<textarea data-phase='plain'>`，给输入控件施加页面根的 `margin:8px`、缩减高度和 `overflow:clip`。修复只将两个页面规则收窄到稳定目标根 `[data-slot='conversation'] > div[data-phase]`，保留目标 InputBar、draft、模型、连接器、submit、Store 和 transport。
- 子代理聚焦 7 文件 28/28、`@e-mate/dsh` build 与 diff check 通过。主代理 final Browser 在 `1440x900/1280x800/768x800/390x844/320x800`、暗色和明色下均测得零横向溢出，textarea `clientHeight=scrollHeight=44px`、margin `0`；桌面 Send `76x32px`，移动 Send `44x44px` 且完整落在视口内。
- 主代理还实点真实模型菜单并以 Escape 关闭；实点“外部连接”到 `/settings?section=connections&connectors=feishu,tencent-docs`，只渲染飞书和腾讯文档注册项，未提交授权或凭据。证据位于 `artifacts/design-qa/S12-current-067873f/`。本项关闭不代表完整 S03/S12：六种实时状态、生产多模型/弱网、真实性能和其他切片仍保持开放。

## 2026-08-16 · S03/S12 真实聊天状态与审批重连

- 新增 `scripts/create-chat-state-fixture.mjs`，只通过固定 Harness `JsonlSessionPersistence` 写入完成、失败、阻塞、用户取消、进程中断和输出上限六类真实事件；固定 50 个事件的 SHA-256 为 `e88c05a486d196cfd14f2ae8d0be003de191b826b1c226d803bbfb658ff15096`。同一命令重复运行返回 `reused=true` 且摘要不变，测试使用 Node 标准库在临时目录验证创建/复用，不向前端写状态。
- 主代理 Browser 首轮证明 `turn/end reason.kind=blocked` 被活动头错误折叠为“已取消”。定点修复只在真实事件投影函数增加 `blocked → 已阻塞`，复用现有错误状态 Token；计时器和 observer 仍只在 `running` 时存在。主代理用同一持久会话复验后，“执行失败”“已阻塞”“已取消”和 token 上限提示互不混淆，活动组与 Tool 详情仍调用目标组件。
- 审批交互使用仓库外临时 profile 插件，经目标 `ctx.sessions`、`setApprovalPolicy(session, 'ask')` 和 `ctx.approval.request()` 产生真正的 `approval/requested` Mux frame；插件显式依赖现有 `apiProxy`，没有新增 REST、WebSocket、Store、Router 或产品审批实现。页面显示运行中的“已工作”、真实 Tool call、待审批原因、“拒绝/允许一次”；拒绝收敛为“已阻塞”，允许收敛为“已处理”。默认产品 profile 仍是 `full access + approval never`，本验收没有改变用户默认权限。
- 在审批未决时刷新页面，Harness 以同一个 pending frame 恢复；刷新后“拒绝”和“允许一次”各恰好 1 个，未重复消息、Tool 或审批卡，随后真实按钮仍能完成决议。证据在 `artifacts/design-qa/S03-chat-states/`。该结果关闭聊天状态投影、审批两种决议和审批刷新恢复；生产模型流式生成中的弱网恢复、真实 Provider 模型切换与端到端审计对账继续保留为发布验收项。

## 2026-08-16 · S10 通用会话默认入口与插件能力投影

- 主代理在干净受管 profile 复现 Home `/` 仍停在 Harness 的未选择工作区状态，输入框显示“选择一个工作区开始”。根因是 URL 投影对 `/` 调用 `sessions.clear()`；修复改为复用 shell 已有 `startSession()`，由目标 `workspaces.startSession(emate-general-workspace)` 打开受管“通用会话”。项目选择器仍由目标组件提供“通用会话/添加工作区…”，真实 `/chat/:id` 深链仍只调用 `sessions.open(id)`；没有新增 Session、Store、Router 或 transport。
- 九个替换 bundle 均已安装，但能力中心此前只有生图和四类外部连接，因为 Office/Search/Browser Panel/Vision 没有向既有 `emateCapabilities` 服务注册用户可见元数据。四包现在各自注册真实状态：Office、Search、macOS Browser 为 `setup-required`，Vision/OCR 为 `blocked`；没有 action，也没有把未验收能力伪装为可执行。Better Sidebar、GenUI、memory-evolve、native subagent 与 Ego Browser 候选等系统/结构插件不单列卡片。
- 主代理重载同一 target Host 后验证：首页输入框可直接使用、工作区标签为“通用会话”，选择器仍含“添加工作区…”；能力中心显示 9 项，并逐项呈现生图、Office、网络搜索、浏览器操作、视觉/OCR、飞书、腾讯文档、微信、钉钉及其真实状态。社区 Skill Hub 不可达继续显示错误，不影响内置能力投影。首轮又发现能力中心点“新建任务”只创建会话却不关闭 overlay；同一 `startSession()` 现在先用既有 History/`popstate` 回到 `/`，随后 Home 投影再调用一次目标 `workspaces.startSession`。主代理复验 URL 为 `/`、能力中心消失、通用会话与真实输入框显示。
- 组合门禁：`@e-mate/dsh` 44/44 Host 测试、shell 7 文件 29/29 测试与构建通过；插件分类测试保证只有四个新增用户能力包含 `emateCapabilities`，系统包保持不可见。证据：`artifacts/design-qa/S10-plugin-replacement/home-general-default-dark-1280x720.jpg`、`capabilities-nine-real-status-dark-1280x720.jpg`。
- 同一轮主代理交互证据还覆盖：Skill Hub“导入/上传 Skill”真实表单；企业模型目录只含 Luna/Sol、Gemini 不存在，Sol 选择在刷新后保持且同一会话 6 条用户消息未丢；外部连接页面展示飞书、腾讯文档、微信、钉钉的真实配置/阻塞状态而未提交授权；用户中心显示本周 `12,345 / 1,000,000 Token` 进度。对应截图同在 `artifacts/design-qa/S10-plugin-replacement/`。真实 Provider 下一请求、外部 OAuth/扫码完成和生产用量对账仍按发布合同保持开放。

## 2026-08-16 · S05 主代理 CLI、单实例与快捷方式验收

- 在仓库外临时 `DSH_HOME` 和临时 Desktop 上运行当前构建：首次 `setup`、同版本再次 `setup` 与最终 `setup --check --json` 均成功；后者 8 项全部 pass，包括固定 Harness、九 bundle、SQLite、Keychain 与受管 profile。桌面目录最终只有一个可执行的 `e-Mate.command`，内容继续通过登录 shell 调用当前全局 `e-mate launch`，未绑定 npm 绝对安装路径。
- `launch --port 55207` 后再次 `launch`、关闭真实浏览器标签、再执行快捷方式的完整 `/bin/zsh -lic 'exec e-mate launch'` 路径，三次均复用同一 PID、instance ID 和健康 URL。`status` 与 loopback health 的 product/version/profile/instance 完全一致；`stop` 只停止该实例并删除状态。
- 端口 `55208` 由独立 Node HTTP 服务占用时，`launch` 返回“nothing was stopped”，随后原服务仍返回 `not-e-mate`。另以独立进程和错误 instance ID 构造状态，`stop` 返回“instance identity could not be verified”，原进程继续存活；受管进程被外部终止形成 stale PID 时，`stop` 只移除陈旧状态。所有测试进程随后按精确 PID/会话停止。
- 同一隔离 setup 只读扫描本机三份旧 e-Mate/ECoreX/CowAgent 权威 SQLite，收据包含 3 个源指纹和 15 个唯一 target Session；同版重装后源文件 SHA-256 逐一不变，未从 UI 缓存复活会话，也未写回旧库。隔离数据与临时快捷方式不作为发布产物；Windows `.lnk` 的创建/同版覆盖由同提交的 Windows 2025 干净 npm 安装作业继续提供平台证据。

## 2026-08-16 · S08 主代理真实旧库迁移可见性

- 主代理用本机三份权威旧 SQLite 在全新隔离 `$DSH_HOME` 执行当前 setup；迁移收据包含 15 个唯一 target Session，但修复前 Browser 只显示初始化产生的 1 个空会话。根因不是前端列表遗漏，而是无项目旧 Session 没有 `cwd`，固定 Harness 的 WorkspaceRegistry 因此不会把它们投影到任何 Workspace；缺陷截图为 `artifacts/design-qa/S08-legacy-migration/pre-fix-imported-sessions-invisible.jpg`，不含旧标题或正文。
- 根因修复只调整迁移边界：无项目旧 Session 的 header 绑定受管 `$DSH_HOME/e-mate/general`，项目 Session 继续保留原项目 `cwd`；setup 在迁移前创建该目录，现有 general-workspace 插件复用目标 `Workspace.setTitle()` 把 Registry 自动标题恢复为“通用会话”。没有新增 Session Store、Workspace Registry、Router 或 transport。
- 可执行回归直接组合目标 `JsonlSessionPersistence`、`JsonStorageBackend` 与 `WorkspaceRegistry`，证明通用/项目会话各自只落入对应 Workspace，重复迁移为 `[2 imported, 0 reused] → [0 imported, 2 reused]`，两份源 SQLite 哈希不变。`@e-mate/dsh` 完整门禁为 Host 45/45、Shell 29/29。
- 主代理在新的真实旧库导入实例复验：Home 初始可见 16 行（15 个导入会话加当前空会话）；选择任一非当前行后进入 `legacy-*` 深链，真实聊天投影为 5 个节点/2 个用户节点；刷新后 URL、5/2 节点和唯一选中行保持，侧栏显示 15 个非空导入会话。只记录数量和布尔结果，不保存旧标题或内容；证据为 `artifacts/design-qa/S08-legacy-migration/acceptance.json`。
- 导入前后 3 份权威源文件 SHA-256 逐一相同。两个隔离 profile 与其附件副本已停止并移动到 macOS 废纸篓，可恢复；没有修改、删除或上传旧源库。

## 2026-08-16 · S02/S03/S12 主代理可见控件闭环抽查

- 主代理继续在同一真实 Harness Web 实点侧栏与会话动作：新建受管通用会话；重命名后刷新标题保持；复制任务 ID 返回浏览器成功反馈；归档当前临时会话后列表减少 1 行且刷新不复现；会话搜索按输入筛出 4 个真实 fixture 行。所有测试只作用于隔离 profile。
- 定时任务页 7 个动作均来自现有页面；实点“创建定时任务”后 URL 进入真实 `/chat/:id`，既有 Input Store 获得非空定时任务草稿，页面 overlay 关闭。草稿随后由主代理清空，未发送模型请求或创建计划。
- 非空会话头的“分享当前任务”真实显示并打开“分享任务”对话框；Host 返回已实现的失败关闭状态“分享服务不可用”，关闭按钮有效。该结果只关闭入口/弹层/RPC 错误态，公开 URL create/revoke 仍因企业分享 provider 未配置保持 blocked。
- 消息复制动作从“复制”切换为真实“已复制”反馈；完成活动的 disclosure 从 `aria-expanded=false` 切换为 `true`。没有创建消息、Tool 或完成状态。
- 首轮又发现重命名视觉弹层缺少 dialog 语义：输入和按钮虽然可见，浏览器按 role 查询为 0。定点修复只给现有 form 增加 `role="dialog"`/`aria-modal="true"`，保留原 backdrop、提交和关闭路径；子代 shell 29/29 与 build/target check 通过，主代理重载同一 profile 后按标题命中唯一 dialog，并在其内部命中任务名称输入、取消和重命名按钮。证据为 `artifacts/design-qa/S12-current-067873f/control-closure.json`。
- 设置页首轮还暴露目标桌面式“打开配置文件”动作；浏览器版本不能安全兑现本地原生打开。修复没有改前端或用 CSS 隐藏，而是在 e-Mate profile 上复用 Harness `SettingsProvider → ApiProxy → SettingsDocumentAction` 合同，只令该 profile 的 `documentPath/prepareDocument()` 报告不可用，文件设置存储和热加载继续保留。主代理在真实 Host 重载后打开设置页，确认“打开配置文件”不存在、个人资料/通用设置/能力中心/外部连接仍可见；证据为 `artifacts/design-qa/S12-current-067873f/settings-browser-boundary.png`。Host 46/46、Shell 29/29 和 target contract 检查通过。

## 2026-08-16 · S11 主代理外部连接发现与授权边界

- 主代理从真实聊天框“外部连接”入口进入既有 `/settings?section=connections&connectors=feishu,tencent-docs` 投影，再打开完整“外部连接”设置。页面由同一 `/emate.connections` 注册表动态展示飞书、腾讯文档、微信、钉钉；不存在第二页面、第二 Router 或前端硬编码连接结果。
- 飞书显示 App ID/App Secret 本机配置步骤，腾讯文档显示 OAuth Token 步骤，微信显示设备扫码前置授权说明，钉钉显示 Client ID/Client Secret 步骤；所有未配置状态均保持真实，凭据只声明进入 Keychain/CurrentUser DPAPI。主代理未输入、保存或提交任何真实凭据，也未触发 OAuth/扫码，因此本项只关闭“可发现并走到授权步骤”，连接成功、读取和可逆写入仍保持生产账号阻塞。
- 证据为 `artifacts/design-qa/S11-connections/discovery-auth-step-dark-1280x720.png`；截图不含凭据值。

## 2026-08-16 · S07 生产 HTTP Provider 显式路由许可

- 用户确认生产 Provider 的 HTTP base URL 已完成其网络安全验证。原 Model Gateway 对所有 `upstreamBaseUrl` 强制 HTTPS，导致该已授权路由在请求前失败；e-Mate 客户端到企业 Gateway 的 HTTPS 边界本身无需改变。
- 最小适配只给服务端 `ModelGatewayRoute` 增加字面量 `allowInsecureHttpUpstream: true`。默认仍只接受 HTTPS；HTTP 缺少逐路由许可、许可与 HTTPS 混用、含 userinfo/query/hash 或无 hostname 的 URL 均在请求前失败。API Key 仍只从 `upstreamApiKeyFile` 读取，重定向继续拒绝，模型目录显式剥离上游 URL 与许可字段。
- 主代理复跑 TypeScript 与 Model Gateway 门禁：75 passed、6 项因真实 PostgreSQL/Windows 外部环境跳过、0 failed。该适配门禁阶段只证明路由合同，未写入生产配置或部署；HTTP hop 不提供链路加密，只允许用于用户已认可的受控网络路径。
- 随后主代理使用用户明确授权测试的生产 GPT Key 和 HTTP base URL，分别向 Luna 与 Sol 发起一次最小 Responses 调用；两次均返回 HTTP 200，响应报告的模型 ID 与请求一致，并各有 Provider response/request ID 和 token usage。未记录 Key、base URL 或回复正文。脱敏收据为 `artifacts/acceptance/S07-model-upstream-gpt-smoke.json`。该证据只关闭原始 Provider 对两模型的单次连通，不替代企业 Gateway 租约、同会话切换、审计对账或弱网恢复。
- live smoke 审核同时发现 DeepSeek 上游仍写旧 `deepseek-v4-pro`，与冻结映射 `ecorex-deepseek-v4-pro → deepseek-v4-flash` 漂移；权威 contract 与出站 body 回归已改为 `deepseek-v4-flash`，用户可见路由 ID、策略、鉴权和管理端均未改变。Model Gateway 门禁再次为 75 passed、6 external skips、0 failed；真实目录是否存在该 ID 仍需生产 DeepSeek Provider smoke，未用近似模型代替。
- 用户提供的生产 DeepSeek Key 在官方目录中真实返回 `deepseek-v4-flash` 与 `deepseek-v4-pro`；主代理随后固定调用 `deepseek-v4-flash`，HTTP 200，返回模型 ID 与冻结映射一致，并有 Provider response ID 和 token usage。用户提供的豆包 Key 在官方方舟目录中真实包含 `doubao-seed-2-0-pro-260215`；同模型最小 Chat Completions 调用也返回 200、匹配模型 ID、request/response ID 与 token usage。脱敏收据分别为 `artifacts/acceptance/S07-model-upstream-deepseek-smoke.json` 与 `S07-model-upstream-doubao-smoke.json`，均不含 Key、base URL、prompt 或回复正文。
- 正式 Model smoke 原先只允许内部占位域，导致这两个已验证的官方 HTTPS Provider 在任何凭据请求前被错误拒绝。权威 smoke allowlist 现在同时接受既有内部路由、DeepSeek 官方根和方舟北京 `/api/v3` 根；未知 HTTPS 目标继续失败关闭。逐路由 HTTP 许可只保留给用户已认可的 GPT/图像 `/v1` 路径，不能借该开关把 DeepSeek/豆包改到任意明文主机。Model Gateway TypeScript 与 82 项测试通过（76 pass、6 external skips、0 fail）。
- 这两项与 Luna/Sol 一样只关闭原始 Provider 单次连通；企业 Gateway 登录租约、同会话模型切换、上游故障/弱网恢复、usage/audit 对账和生产 UI 仍必须端到端验收。
- 主代理随后使用同一 production `runModelSmoke` 代码和完整冻结目录顺序，顺序验证 Luna、Sol、DeepSeek Flash、`gpt-image-2-pro` 与 Doubao；五项全部 `PASSED`，目录哈希为 `23f9afa492eb27aa4aeb36577d30bf4ae23aa372d30958386bf2a95d960f78cc`。正式脱敏审批收据为 `artifacts/acceptance/S07-model-upstream-formal-smoke.json`，不含 Key、Provider URL、prompt 或输出正文。该收据关闭生产目录与上游协议 smoke，但仍不替代已认证 Gateway 会话、租户策略、用量账本与旁路审计。

## 2026-08-16 · S10 生产图像 Provider 单次、编辑与最低并发

- 主代理用用户明确授权测试的同一生产 GPT Key/HTTP base URL，按最终 Codex-like 合同固定提交 `gpt-image-2-pro`：单次 `/images/generations`、带前一输出的 multipart `/images/edits` 均返回 HTTP 200；两份输出均为可解码 PNG，生成图带 alpha。没有向请求传模型选择、尺寸、质量、本地输出路径或并发策略。
- 随后并行发起两次独立 generation 请求；两次均返回 200，wall time 为 113,569ms，单项耗时约 64,974ms 与 113,566ms。输出逐份打开检查且 SHA-256 不同。该结果关闭计划要求的“至少两个并发”原始 Provider 下限，但长尾已明显，不能据此宣称稳定上限或系统端性能达标。
- 脱敏收据为 `artifacts/acceptance/S10-image-upstream-smoke.json`，只包含请求 ID、时长、大小和哈希，不含 Key、base URL、prompt、响应正文或图像字节。完整发布仍需通过企业 Gateway、e-Mate `imagegen` Tool、Harness Job/附件、审计与 Usage 对账；在这些链路完成前不继续盲目提高 4/8 路并发。

## 2026-08-16 · S07 主代理管理端与 Usage 本地 Browser 验收

- 主代理直接打开当前 Admin/Usage production build 的既定子路径。管理端登录页真实显示企业标识、管理员账号、密码与登录动作；Usage 入口真实显示只读令牌输入和明暗切换。没有提交生产账号、密码或令牌。
- Usage 明暗按钮由 Browser 实点后，页面从暗色切换到明色，按钮可访问名称同步由“浅色模式”变为“深色模式”；保存并重新打开的两张截图均使用 e-Mate logo、橙色主动作与现行明暗 Token。
- 使用本地只读 fixture 进入真实看板壳后，概览/用量/用户/审计导航均出现；本地未连接企业 Analytics API，因此页面按合同显示“用量数据暂时不可用”和“重试”，未生成虚假用户、事件或 Token 数据。生产登录、用户事件次数与审计账本对账继续阻塞于真实 Auth/PG/Redis/反代环境。
- 证据位于 `artifacts/design-qa/S07-admin-usage-local/`。本轮只关闭本地入口、主题与失败关闭状态，不等同于生产部署或账本验收。

## 2026-08-16 · S01/S13 macOS 与 Windows npm 安装边界

- 目标 Harness 的完整 vendor closure 自身含 dormant Linux Landlock optional packages；它们没有进入 e-Mate 的可执行 `bin`，现有 runtime 也会拒绝 Linux。为保持 pinned target 闭包不被私自裁剪，本版本不删除这些不可达依赖字节。
- 发布主包 manifest 现使用 npm 原生 `os: [darwin, win32]`，因此 Linux 在安装解析阶段即失败，而不是安装 58MiB 后等到 `setup` 才拒绝；Windows arm64 继续由现有 runtime 组合门禁拒绝。未增加 `cpu`，因为 npm 单一 `cpu` 列表无法表达 macOS arm64/x64 与仅 Windows x64 的联合矩阵。
- release carrier 7/7、根级精确构建和 diff check 通过；CI 仍只有 macOS arm64/x64 与 Windows x64 干净安装，没有 Electron/Tauri/DMG/签名/公证或 Linux 发行作业。

## 2026-08-16 · S10 Office 执行层许可证与运行边界复核

- 主代理复核子代的独立审计：pinned rc.5 standard preset 只有 Skill、filesystem、macOS Bash、Windows PowerShell 与 Job seam，目标锁中没有 DOCX/PDF/XLSX/PPTX 执行 Tool 或完整文档库。Codex primary-runtime 是环境所有的加载器，Documents Skill 的附加许可明确禁止第三方提取、分发和衍生分发；公开 `openai/skills` 的 Apache-2.0 PDF Skill仍要求现场安装 Python/Poppler，也不提供 DOCX/XLSX/PPTX 执行层。
- 因此四项 Office Skill 保留能力身份但改为非模型/非用户可调用，注册 Tool 数为 0，能力状态固定 `blocked / EMATE_OFFICE_EXECUTION_LAYER_UNAVAILABLE`；不再扫描偶然存在的系统 Office、Python、LibreOffice 或全局 Node 包，也不生成伪装 Office 文件。
- 插件窄测 2/2、Node 24 构建与 diff check 通过。强制 Office Computer Use 仍是正式发布阻塞，只有取得可再分发的 macOS/Windows 预构建执行插件并完成四格式真实全场景后才能关闭。
- 主代理把新 bundle 同步到同一隔离受管 profile 并重启真实 Harness Host；能力中心展开后仍是 9 项，Office 卡真实显示“暂未启用”和稳定 blocker，Image 继续可用，Search/Browser 为需要配置，Vision/OCR 为暂未启用。页面没有 Office action 或假 ready 状态。Browser 证据为 `artifacts/design-qa/S10-plugin-replacement/capabilities-office-blocked-real-status-dark-1280x720.png`。

## 2026-08-16 · S07/S13 生产管理与用量入口只读核验

- 主代理只读核验用户指定生产服务器：企业 Web、Auth、Analytics、Model Gateway、PostgreSQL 与 Redis 容器均处于健康运行态，既定管理端与用量子路径在服务器内网返回 HTTP 200。该事实纠正了此前“生产无 PostgreSQL/Redis”的历史假设，但不代表当前分支已经部署。
- 公网管理端可达并显示 e-Mate 管理员账号/密码入口，但用户提供的服务器面板账号不是 e-Mate 应用管理员账号，真实登录返回 `account login failed`，会话保持未连接；主代理未继续猜测账号、未读取服务端密码材料，也未改用户、配额、协议或模型。证据为 `artifacts/design-qa/S07-admin-usage-production/admin-login-rejected-current-deployment.png`。
- 用户指定的 Usage 公网入口在浏览器认证层返回 `ERR_INVALID_AUTH_CREDENTIALS`。Browser 安全策略随后阻止继续访问该页面；主代理没有尝试替代浏览器、URL 变形、原始 CDP 或其他绕过。因此生产用户事件次数、Token、模型、审计 outbox 对账继续阻塞于有效的 e-Mate 管理员账号和 Usage 只读认证材料。
- 生产页面仍是服务器既有部署版本，不能用本地新管理端/Usage 截图冒充生产。当前分支 CI 已通过；正式发布工作流的 npm 候选打包仍在执行。Office、Windows/macOS 浏览器执行层、Vision/OCR、生产登录/租户策略/账本对账等阻塞关闭前，不覆盖生产部署或 R2 下载入口。

## 2026-08-16 · S01/S13 当前三平台发布候选

- 提交 `f7c567a4adde61bac844585b6ff603dd75f96729` 的 GitHub Actions `Release e-Mate` run `31902404007` 从同一源码构建唯一 npm tarball，并在 macOS arm64、macOS x64、Windows x64 三个干净 runner 上完成全局 npm 安装、staging check、两次幂等 setup 与 installed check；三项分别成功，Windows 较慢但在 30 分钟门禁内以 12m57s 正常结束，没有重跑或放宽超时。
- 同一 run 的 release evidence job 成功生成并回验 SHA256、manifest、SPDX SBOM 与许可证清单。上传的 npm artifact digest 为 `sha256:82132fa7af226e22584f58df3b4e983480ac1093a1ba4b4085b24f2629d4a9be`，release-candidate artifact digest 为 `sha256:2096e966cc969d4d9517ebb6288bd9470139ed9c5a58b332c4f155f9d10aa197`。
- 该 run 由 Pull Request 触发，npm 发布、registry 三平台回读与 R2 上传按工作流合同全部 skipped；因此本条关闭当前源码的三平台候选构建/干净安装，不关闭 npm/R2 正式发布、生产 URL 激活或 Computer Use 平台能力。

## 2026-08-16 · S07 主代理生产注册 challenge 与移动边界

- 主代理以仓库外隔离 `DSH_HOME` 启动当前 e-Mate profile，直接使用 profile 已签入的生产 Auth Gateway 配置打开 `/register`。页面通过既有 `emate.identity → Connection RPC → enterprise-provider` 链真实取得 CAPTCHA data URL；实点“换一张验证码”后图片载荷变化。全程没有填写或提交账号、真实姓名、密码、验证码，也没有创建生产用户或修改管理员状态。
- 页面真实展示账号、真实姓名、至少 10 位密码、验证码、提交注册申请和返回登录；登录页真实展示账号/邮箱、密码、保持登录和注册入口。浏览器标签为 `e-Mate`，favicon 为现有透明底小芯头像，当前可见文本没有 `DeepSeek Harness/HARNESS` 品牌残留。
- 首轮 `320×800` Computer Use 量测为 `scrollWidth=432/clientWidth=320`。根因不是 CAPTCHA 行本身，而是身份 Gate 使用 body portal 时，底层 Harness `#root` 仍按应用最小宽度参与文档布局。子代理只在 Gate 锁定期间把同一根节点设为 `inert + hidden`，cleanup 精确恢复之前的 `hidden/inert`；没有改 Auth、注册语义、Router、Store 或 transport。
- 主代理重新构建、覆盖同一隔离 profile 并复验：`320×800` 与 `1440×900` 均为 `scrollWidth === clientWidth`，Gate 存在时底层 root 为 hidden，验证码继续来自真实生产 challenge。聚焦身份测试 7/7、shell build 和 diff check 通过。证据位于 `artifacts/design-qa/S07-registration/`。
- 本项只关闭公开 registration challenge、验证码刷新、登录/注册入口和两视口布局。按 Browser 安全边界，CAPTCHA 求解与注册提交必须取得用户对具体测试身份的确认；管理员批量审批、周额度、协议签署、改密、退出再登录、Gateway 会话和 Usage 对账仍保持生产阻塞。

## 2026-08-16 · S04 当前候选固定 5,000 事件复跑

- 主代理在仓库外隔离 `DSH_HOME` 创建权威固定会话 `e-mate-performance-5000-v1`；5,000 个事件、625 个 turn 与事件 SHA-256 `ad12feaa53f9d55c22d0e32a366316c8e29a8031ccca5d27a8e4f97d2a99b0cc` 均由现有 `create-performance-fixture.mjs` 复核。身份只在该临时 profile 内替换为无企业传输的 QA provider，用于越过登录展示锁；没有写入产品 profile、生产账号、模型策略或审计账本。
- 当前提交 `098f36c8cb769e7e8f8eeb6f6bd18bb98c030eff`、client bundle SHA-256 `3495cdfa492f036d105de02c170891233e208e885f233d44034c8b963cae4457` 通过真实 Harness history paging 从 turn 601 加载到 turn 1。页面最终含 625 条用户消息、625 条助手消息和 39,345 个 DOM nodes；24 个有效 prepend 页的 wall time 中位数 380 ms、最大 589 ms，最后一次空边界请求正确移除“加载更早”。
- 当前内置 Browser 只开放导航、可访问树、交互和 DOM 只读量测，不开放 CDP Trace、React Profiler 预注入、heap、长任务或 browser metrics。故该轮只更新最终候选分页/DOM事实，不拿旧 Chromium 闭包的 Trace 冒充当前候选，也不把 S04 标记通过；正式支持浏览器上的 Trace、Profiler、heap/FPS/长任务和真实 Provider 配对仍保持发布阻塞。

## 2026-08-16 · S03 当前候选六种真实终态回归

- 主代理复用现有 `create-chat-state-fixture.mjs`，在同一隔离 Harness Host 写入并重放 50 个真实持久事件；fixture SHA-256 为 `e88c05a486d196cfd14f2ae8d0be003de191b826b1c226d803bbfb658ff15096`，六个终态依次为 completed、error、blocked、aborted、interrupted、max-tokens。页面保持目标 Session、History、Conversation renderer 和 Connection，没有前端伪造状态。
- 首轮 Computer Use 发现唯一独立失败：`reason.kind='interrupted'` 落入 cancelled fallback，显示“已取消”，与真实“任务因进程中断”不一致。子代只在既有活动头映射增加 `interrupted → 已中断`，保持 aborted 为“已取消”、blocked 为“已阻塞”，并复用原重复 turn-tail 隐藏规则；没有改事件、Store、transport、Timer 或 Observer。
- 主代理串行重跑 shell 29/29、完整主包构建与同一 Browser Session。修复后六态文案和 Tool/失败/输出上限证据均可见，interrupted 独立为“已中断 7s”；所有终态计时冻结。前后证据位于 `artifacts/design-qa/S03-chat-states-current-46d306d/`。该项关闭六终态区分回归，不替代真实 Provider 切换、弱网恢复或全部 17 原型状态的最终逐屏验收。

## 2026-08-16 · S02/S03 指定聊天原型同状态复跑

- 主代理在当前轮同时打开用户指定 `019ff665-d721-79a0-869d-338f086cf529` 原型（HTML SHA-256 `fd734f0026f51e334874cca54adb60f37d7b09cb4e89e98da1841c922996a33e`）和当前 e-Mate Harness Host；`1280×720` 暗色下逐屏捕获重试、失败、完成与长文本，并把每对源图/实现图合成同一检查输入。当前轮证据位于 `artifacts/design-qa/S02-chat-prototype-current-dee4b39/`，没有拿历史截图冒充本轮结果。
- 重试首轮暴露真实 P1：同一 `retryId` 的两次 `llm/retry` 已由目标 Conversation Node 投影到 `attempts`，但目标默认 Retry View 只渲染 `current`，导致第 1 次失败不可见。子代只用目标 `conversation.chat.node` keyed-slot shadow seam替换 `model-retry` 的展示层，直接渲染 target-owned attempts；未改 pinned upstream、事件、Store、Router 或 transport。
- 主代理重跑 shell 30/30、完整 `@e-mate/dsh` build、diff check，再把最终 client bundle SHA-256 `3ae8125072a0f5c0cab5d8c6bd647d2e0893387fd3608c5fc74d4562cba009d8` 同步到同一隔离 profile。Browser 复验显示“上次尝试失败 / 第 1 次”和“重试已取消 / 第 2 次”，两行分别展开后保留 `450ms/连接被重置` 与 `900ms/服务暂时不可用`；另一个保持 open step 的真实 Session 显示当前态“正在重试”，与源稿字面一致。源/修后合并图为 `source-vs-current-retry-after-1280.png`，实时态为 `current-retry-active-after-1280x720.png`。
- 长文本折叠/展开、下载与同一 Markdown DOM 在本轮再次通过。失败卡本身保留真实 Tool/turn error，但原型中的“重试”动作继续失败关闭：rc.5 没有失败轮原子重试动作，`setDraft + submit` 会重复提示且无法重放附件，`forkAt` 又保留失败轮；因此没有增加无效按钮。完成态的图片/文件产物因本轮真实 Session 没有对应 attachment/renderer 数据也不伪造，S02 的全部 17 状态最终逐屏验收仍保持 open。

## 2026-08-16 · S02/S03 消息动作与复制反馈同状态验收

- 主代理在同一 `1280×720` 暗色 Browser 会话打开用户指定聊天原型和当前提交 `f225cc2651fd08c0cda7ec5c46d0925301c88a82` 的真实 Harness Session。原型 HTML SHA-256 仍为 `fd734f0026f51e334874cca54adb60f37d7b09cb4e89e98da1841c922996a33e`；当前页面从固定 50-event Session（SHA-256 `e88c05a486d196cfd14f2ae8d0be003de191b826b1c226d803bbfb658ff15096`）投影，没有替换 Message renderer、Store 或 transport。
- 当前用户消息继续使用目标 `MessageIconActions`。主代理点击真实复制动作后，同一消息下方原位出现 check 图标和“复制成功”提示；约 1 秒后按钮与提示恢复为“复制”，页面没有新增消息、全局 toast 或伪事件。证据位于 `artifacts/design-qa/S02-message-copy-current-f225cc2/`，其中 `focused-source-vs-current-copy-feedback.jpg` 是源稿与当前同状态的聚焦并排图。
- 源稿同一位置还有“编辑”动作，但 rc.5 完成态用户消息只公开 `forkAt(seq)`；该动作会保留本轮结束事件，不能原子地在失败/完成轮之前分支，也没有可安全重放原消息与 durable attachment 的接口。`setDraft + submit` 会追加重复消息并可能丢附件，因此本轮不增加无效编辑按钮。编辑分支保持上游接口阻塞，需目标提供 pre-turn fork 加精确消息/附件重放或原子 edit-and-branch action 后再验收。
- 本轮关闭“消息动作可见、复制成功反馈、反馈恢复且不造假状态”这一同状态；S02/S03 仍未关闭全部 17 个原型状态、产物同状态和编辑分支。

## 2026-08-16 · S02/S03 排队状态语义核对与真实消息队列验收

- 主代理选择指定原型第 6 屏“排队”，并在当前 e-Mate Host 中用仓库外临时 LLM adapter 打开一个真实目标 Agent turn；adapter 只让首个模型 stream 保持运行，页面仍使用目标 Session、Agent inbox、Connection、Conversation 和 InputBar。随后从真实 InputBar 提交第二条消息，目标权威 `session/queue` 快照显示一条 `placement='queued'` 的下一轮用户消息，没有客户端注入 queue 数据。
- 目标 QueueDock 真实显示排队消息及“编辑排队消息 / 删除排队消息 / 插话发送”三个动作。主代理依次完成编辑并保存、删除并确认 dock 消失、重新排队后插话并确认同一消息从 QueueDock 移到真实 conversation tail；没有重复消息、残留 dock 或第二 Store。当前运行随后通过真实“停止生成”动作结束。
- 同状态视觉对照发现原型与目标事件语义不同：原型行是工具动作 `npm test -- session.test.ts` 在取得执行位之前的“等待运行 / 排队中”；rc.5 `executeToolCalls()` 只在 `startCall()` 内真正开始调用时追加 `tool/call`，客户端也只在 `tool/call` 已存在且 `tool/result` 未出现时投影 `runningCalls`。目标没有可供前端读取的 pre-dispatch Tool queue 事件。
- 因而不能把真实的用户消息 `session/queue` 改名或搬进活动组冒充工具队列，也不能提前制造 `tool/call`。本轮关闭目标原生消息队列及三个动作闭环；原型第 6 屏的 Tool queued 同状态保持上游事件缺口阻塞。证据位于 `artifacts/design-qa/S02-queued-current-7b607c7/`，聚焦并排图为 `focused-source-vs-current-queued.jpg`。

## 2026-08-16 · S02/S03 运行中活动组折叠同状态终验

- 主代理选择指定原型第 3 屏“折叠”，在仓库外 QA profile 中注册一个目标原生 Tool，让真实 Agent turn 保持 `tool/call` 已开始、`tool/result` 未产生的运行态；产品继续使用固定 rc.5 的 Session、Agent loop、Tools 和持久事件，前端没有注入活动行或伪造终态。
- 首轮同视口量测发现共享活动头仍是 `14px`、全行 `748px` 点击面和向右 `14px` Chevron，而源稿是内容宽、`22px / 31.9px`、标签/计时 `500` 字重和向下 `18px` Chevron。最小修复只调整现有活动头 DOM/CSS：同一 `strong` 保留真实 `<time>`，按钮使用 `fit-content`，复用现有 Chevron 且不旋转；未改事件匹配、计时、折叠状态或 renderer 分派。
- 主代理同步最终 client bundle SHA-256 `63a69d3ec37c0cc6b661d7c88e7c0a79d414e0c7d163af2d834d83960bf2fd30` 后重新启动 Host 并提交新会话。展开态有且仅有一条真实 `acceptance_wait` Tool 行；折叠后 `aria-expanded=false` 且 Tool 行数为 0；再次展开恢复同一 Tool 行。最终计算样式为 `22px / 31.9px`、内容宽、`8px` 间距、`18×18` 向下 Chevron，与源稿同状态一致。
- 子代窄测 7 files / 30 tests、`@e-mate/dsh` build 和 diff check 通过；主代理最终并排证据位于 `artifacts/design-qa/S02-collapse-current-7b607c7/`。本片关闭“真实运行活动组折叠/展开与视觉同状态”，未扩大到目标不存在的 Tool pre-dispatch queue。

## 2026-08-16 · S02/S03 摘要与图片披露同状态终验

- 主代理选择指定原型第 4 屏“摘要”和第 5 屏“图片”，固定源稿 SHA-256 为 `fd734f0026f51e334874cca54adb60f37d7b09cb4e89e98da1841c922996a33e`。仓库外 QA 脚本通过目标 `JsonlSessionPersistence` 写入 13 个持久事件，使用目标小写 `read/glob/bash` Tool 名与真实 CAS 图片附件；事件摘要为 `02a20970ec505cd007cd9da340e179480da02b03c0deb42daf2d4f5db4132a62`。前端继续读取正常 Host Session API，没有夹具 Store 或伪事件。
- 首轮发现四个具体 P1：目标 gallery 的 display 规则覆盖原生 hidden、Bash 独立摘要行尺寸偏小、普通消息字级未跟随逐屏标注稿、`320/390px` 折叠侧栏触发器与 Session 标题重叠。子代只在对应 target seam 做最小修复，主代理每轮重新构建、同步当前 bundle、重启同一 Host 并复验；没有复制 ImageGallery/Markdown/Terminal renderer，也没有新建 Router、Store 或 transport。
- 最终桌面实测：普通 assistant 段落 `26px / 41.08px`，用户气泡 `24px / 34.8px`；Read/Bash 摘要均为真实 `44px` 高、`22px / 31.9px`，图片摘要为 `44px`，单图为真实 `160×160px / 18px`。图片按钮从默认收起切到展开后仍是同一 target gallery，原图 lightbox 可打开/关闭，再次收起和刷新均恢复 `aria-expanded=false`、图片不可见。
- 移动端最终 `390/390`、`320/320`，真实侧栏触发器为 `x=12..56 / 44px`，Session title 从 `x=64` 开始且高度 `44px`；`320px` 只对标题省略，不重叠或横溢出。证据位于 `artifacts/design-qa/S02-summary-current-60b0955/`，最终 client SHA-256 为 `a2d29fe556d92b58919bdf3ced40e7ea2ca092a30b7f3aaefede03b09b765a68`。
- 本轮关闭原型第 4/5 屏在 e-Mate 真实消息流中的摘要/图片披露与响应式交互；现有 ActivityHeader 继续作为真实活动组合同保留，不为静态截图隐藏。

## 2026-08-16 · S02/S03 消息流字号、折叠焦点与第一准则复核

- 只读追踪确认当前消息流仍由 pinned rc.5 的 `conversationEvents`、Session persistence、`/api/events.mux`、官方 assembler、InputHub/Session.prompt、Session.cancel 与 PendingWait `/api/respond` 驱动；e-Mate 只用 keyed slots 和真实持久事件做展示投影。没有第二 Store、Router、WebSocket/EventSource、消息 normalizer，也没有按 Tool 名或能力 ID 硬编码事件。
- 按用户最新纠正，消息流字号不再照搬原型截图的绝对像素，而统一回到 e-Mate 2.0.5 全局层级：正文 `14/22`、摘要与工具 UI `13/20`、详情 `12/16`，交互热区仍为 `44px`，图标/Chevron 为 `16/14px`。移动端保持同层级，避免与侧栏、Composer 和设置页失衡。
- 用户指出折叠点击出现红/蓝框后，现有 Activity、Tool、Bash、长文本/图片和 retry disclosure 的 `focus-visible` 改用 e-Mate 交互背景与文字色反馈，不再绘制外轮廓；没有移除键盘焦点反馈。禁用的 `ui-trajectory` 所遗留的 inert Inspect seat 只在 pinned target 的两种展开 Tool body seam 隐藏，其他 target action 不受影响。
- ActivityHeader 现在仅对真实可控制成员输出 `aria-controls/aria-expanded`；失败、阻塞、取消、中断的 Tool/错误证据必须常显，因此相应 header 被禁用并隐藏 Chevron，避免无效折叠按钮。主代理 Browser 实点 completed header 与 Tool row 后均为 `outline:none/border:none`，受控 Tool row 正常展开，Inspect 不可见。
- 同轮 `320×800` 实测发现 error status 的三列 grid 把中文错误压成单字竖排；窄屏仅把该真实 status 收敛为 `10px + minmax(0,1fr)`，code 放第二列并允许断行。最终 document 为 `320/320`，status 为 `10px 208px`，没有横溢出。
- 证据位于 `artifacts/design-qa/S02-message-flow-typography-focus-9a84bde/`，最终 bundle SHA-256 为 `20a2d90eb6adaf58df6c8f0001084a13d1c71e91389683e2df4e61f4568a030a`。shell 8 files/39 tests、主包 build 和 diff check 通过；本条只关闭消息流尺寸、焦点与折叠语义，不关闭上游缺少原子用户编辑/失败轮重试动作的既有阻塞。

## 2026-08-16 · S07/S10 生产模型 Key 激活与生图并发上限

- 主代理按用户明确授权从仓库外生产配置文件加载 GPT、DeepSeek 与豆包 Key；Key 只进入权限受限临时文件、SSH/SCP 传输和服务器 Secret，不进入命令参数、日志、源码、前端状态、Git 或验收回执。Gemini 未配置。
- 新 Key 的精确模型推理在写入前通过：`gpt-5.6-luna` Responses 流 2.34s、`gpt-5.6-sol` 1.66s、`deepseek-v4-flash` 0.56s、`doubao-seed-2-0-pro-260215` 2.89s，四路均 HTTP 200 且有真实流终态。客户端默认模型无需新增逻辑：企业目录与本地 `CHAT_MODELS` 都以 Luna 为首个允许聊天模型，故默认仍是 `gpt-5.6-luna`。
- `gpt-image-2-pro` 单次真实生成 HTTP 200，37.16s，得到 1,898,205-byte PNG；上游响应披露底层解析名 `gpt-image-2-codex`，客户端和 Gateway 路由 ID 仍固定为 `gpt-image-2-pro`。并发 2 路为 2/2、4 路为 4/4；8 路仅 5/8，另外 3 路为 HTTP 429。因此本次已验证稳定并发上限为 4，不把 8 路标记可用，也不继续扩大付费压测。
- 生产服务器复用既有 HTTPS Model Gateway 与内网 TLS provider bridge；main/image bridge 的最终上游正是用户给定 HTTP Base URL，DeepSeek/豆包分别走官方 HTTPS API。没有把 HTTP Base URL 暴露给浏览器或本地 Harness，也没有新增第二传输层。
- 服务器先在 root-only 目录快照旧四类 Secret 与模型配置，再原子替换 Luna/Sol 共用 GPT Key、DeepSeek Key 和豆包 Key；按现有 `activate-release.sh` 的 Compose 环境加载方式只重建 gateway 容器。重建后健康状态为 `healthy`，5 条原生生产 Model Smoke 全通过，配置 SHA-256 为 `3c985cde632ef7db81da431db4552c73df3c93926ad875f1233f5a3d0f4e5769`，回退快照收据为 `20260816T010958Z-production-model-keys`。
- 当前线上 gateway 镜像的 DeepSeek Smoke 合同仍锁 `deepseek-v4-pro`，而当前仓库与新 Key 已验证 `deepseek-v4-flash`。本轮只激活授权 Key，不在服务器手改镜像或伪造 Flash 验收；Flash 切换必须随下一份由 CI 构建的 Model Gateway 镜像和对应生产配置一起发布、重跑 5 路 Smoke 后关闭。
- 可复核回执与单次真实图片位于 `artifacts/acceptance/S10-image-production-20260816/`；回执不含 Key、Key hash、上游签名 URL或回复正文。

## 2026-08-16 · S07 2.0.7 新用户命名空间

- 用户明确要求旧服务继续运行，但 e-Mate 2.0.7 不沿用旧用户、必须重新注册。只读核对确认线上旧 Auth 映射为 `e-mate-desktop / emate → emate-production`，旧租户当前有 43 个 ACTIVE、2 个 DELETED、1 个 SUSPENDED 用户；本轮未修改这些记录，也未给旧用户补模型策略。
- 2.0.7 受管 profile 改用长期 Web 产品命名空间 `clientId=e-mate-web / organization=emate-v2`；租户 ID 同为 `emate-v2`。命名空间不携带补丁版本，后续 2.0.8+ 可延续 2.0.7 新注册账号，同时不会回落到旧桌面用户。
- 生产 Auth Gateway 只新增上述 client 与 organization 映射，保留旧 client/tenant；只重建 auth 容器。新旧 client 的真实 registration challenge 均返回 HTTP 200，Auth 健康，新租户用户数仍为 0，证明未导入或复用旧用户。
- 生产 Auth 配置回退快照收据为 `20260816T011716Z-auth-namespace`。本轮只关闭账号命名空间隔离与注册入口，不创建测试用户、不求解 CAPTCHA、不审批、不设置用户额度；这些动作仍须使用明确的新测试身份完成 Computer Use。
- 默认 Luna 保持策略级语义：当管理员为新用户允许多个模型时，Auth 按权威目录顺序下发，本地 `CHAT_MODELS` 首选 `gpt-5.6-luna`。新注册用户仍以 PENDING/空模型集合进入，必须由管理端审批并配置额度和允许模型后才能登录执行，未因“默认 Luna”绕过审批边界。
- 主代理用当前构建重新执行隔离 `setup` 和浏览器验收：安装后的 `--dump-config` 精确回读 `clientId=e-mate-web / organization=emate-v2`；`/register` 标签标题为 `e-Mate`，账号、真实姓名、至少 10 位密码、验证码、提交申请和返回登录均可见，实点“换一张验证码”后 data URL 载荷变化。未填写或提交表单；证据为 `artifacts/design-qa/S07-registration-namespace/registration-emate-v2-dark-1280x720.jpg`。验收 Host 已停止，临时 profile 与指针均移入废纸篓。

## 2026-08-16 · S07 新租户管理员引导边界复核

- 主代理在不读取密码、Token 或私钥内容的前提下只读复核当前生产配置与数据库。Auth 当前允许 `e-mate-desktop`、`e-mate-web`，保留 `emate → emate-production` 与新增 `emate-v2 → emate-v2`；Analytics 当前未配置 `sessionAuth`，Compose 也未向 Analytics 挂载 Auth 公钥。
- 权威用户表中旧租户 43 ACTIVE、2 DELETED、1 SUSPENDED 全部只有 `MEMBER`；新租户仍为 0。不存在可合法复用的旧管理员，新租户也没有首个 `TENANT_ADMIN`。因此当前管理端的账号密码登录、审批和额度配置不能标记生产可用。
- 要关闭该项，必须先由用户明确一个新的 2.0.7 管理员身份，再按现有服务合同允许 `e-mate-admin` client、为 Analytics 配置匹配 issuer/audience/clientId 的 `sessionAuth` 并只挂载公钥，最后以该新租户账号完成登录、审批、配额、模型下发和 Usage 对账。不得把旧 MEMBER 提权、猜管理员口令、直接写测试账号或绕过 CAPTCHA 冒充验收。本轮未修改生产用户、角色、Analytics 或 Compose。
- 命名空间提交 `bbb1d5ea9fdf4338581c15f30d3fb33b6c0fae70` 的 CI run `31919887274` 与 Release e-Mate run `31919887259` 均成功；同一 tarball 在 macOS arm64、macOS x64、Windows x64 完成干净 npm 安装与 setup 检查，SHA/manifest/SBOM/许可证证据生成成功。PR 门禁按合同跳过正式 registry 发布与 R2 上传，因此这里只关闭候选构建和三平台安装，不冒充 npm/R2 已发布。

## 2026-08-16 · S07 2.0.7 生产管理员与公网管理端

- 用户明确授权由主代理创建新的 2.0.7 管理员。主代理通过现有 `PostgresAdminManagementStore` 创建 `emate-v2 / emate-admin`，角色严格为 `TENANT_ADMIN + AUDIT_ADMIN`，允许模型为 Luna、Sol、DeepSeek、Doubao 与图片 Pro；没有提升或复用旧 `emate-production` 用户。初始密码只保存在服务器 root-only `0600` 回执与用户本机剪贴板中，未写入命令参数、日志、源码、Git 或本文。
- Analytics 接入现有 Auth Gateway 的 Ed25519 access session 验签，并逐请求回查 ACTIVE Session 和当前角色。生产只重建 Gateway、Auth、Analytics 与静态 Web 容器，Postgres、Redis 和旧控制面进程未停止；旧 `e-mate-desktop`、新 `e-mate-web` 与管理端 client 的 registration challenge 均为 HTTP 200。
- 用户纠正“管理员不用签署用户协议”后，模型短会话增加 Auth 签名角色；Model Gateway 只对真实 `TENANT_ADMIN` 跳过用户同意门。普通用户仍须签署，旧短会话在角色字段缺失时继续按普通用户处理。管理员的同意状态保持 `required=true / accepted=false`，没有生成伪签署记录；模型目录仍返回全部 5 个允许模型。
- 生产服务镜像由提交 `9b26eead4625c2813f91dc78b62bf9997e7febaa` 的 `enterprise/deploy/Dockerfile.services` 和锁文件构建，三项服务健康。回退收据位于服务器 root-only `20260816T022330Z-admin-session`，包含旧/新配置、Compose、镜像、Nginx 路由与管理端静态目录。
- 管理端生产构建固定同源 `/e-mate/auth-api/`、`/e-mate/enterprise-api/`、`/e-mate/model-api/`，登录页只显示账号和密码，组织固定为 `emate-v2`。公网固定地址 `https://mvdcm.ecoremedia.net/ecorex-agent/admin/` 和 `https://dl.ecoremedia.net/ecorex-agent/admin/` 均为 HTTP 200；`/health/ready` 为 200。
- 主代理用 Browser 实点账号密码登录，用户页回读管理员为“不限”周额度、5 个模型、未查询到签署记录；模型页实点 Luna 的真实最小 Responses 调用后显示“联通正常”。公网 API 同步验证登录、用户列表、用量汇总、模型目录均为 200，Luna 收到真实 `response.completed`。验收后已退出管理会话并清空密码框。
- Usage 面板仍由既有 Nginx Basic Auth 独立保护，未把管理员密码复制为 Basic Auth 口令；该地址的未认证响应保持 401。管理员页面已接入同源用量链接，但 Usage 面板统一账号登录属于后续独立鉴权切片，不能在本条冒充关闭。

## 2026-08-16 · S07 生产 Usage 面板统一管理员登录与真实对账

- 删除重复的“粘贴只读 Token”登录入口，复用现有同源 Auth Gateway `/v1/auth/password`；生产配置固定 `clientId=e-mate-admin / organization=emate-v2`。密码只进入该请求，access token 只保留在当前标签页；后续 `/v1/usage/*`、`/v1/tasks/summary` 与 `/v1/admin/users` 继续使用原 Analytics Bearer 链路，没有第二认证服务、Store、Router 或传输层。客户端只允许真实 `TENANT_ADMIN/AUDIT_ADMIN` 进入，服务端仍逐请求验签、回查会话并执行角色授权。
- 聚焦验证为 Usage 13/13、TypeScript check、Vite production build 与 diff check。最终生产静态 release 为 `/srv/ecorex-agent-usage-panel/releases/usage-2.0.7-auth-final-20260816T033831Z`，tar SHA-256 `32bdbf566f12b5a184a747ee7e36ced3630018d323ca0be3b3397a4dce1df252`，root-only 回执同名。旧 `v2.0.5-77786087753e-8f116d9b4bca` 目录未删除；前两次真实探针分别暴露回环地址与 Nginx graceful reload 竞态，均由部署钩子恢复旧软链和配置，失败候选保留在服务器 `failed/` 后才重新切换。
- Nginx 仅移除静态 `/ecorex-agent/usage-panel/` 的 Basic Auth；旧 `/ecorex-agent/usage-panel/api/` 继续 401，新前端数据走同源 `/e-mate/auth-api/` 与 `/e-mate/enterprise-api/`。`mvdcm` 与 `dl` 两个 Usage URL 均回读 HTTP 200，Auth/Analytics `/healthz` 均为 200。
- 主代理 Browser 用真实 `emate-admin` 登录。7 日账本显示 3 次成功调用、13,185 Token、1 个活跃用户、Luna 3 次调用、管理员周额度“不限”；请求状态、任务汇总、Usage/Invocation 关联四项差异均为 0。调用明细逐条显示三组 Luna request/usage 对，明暗主题切换和退出后密码清空均通过。任务事件账本仍显示“未接入/0”，这是当前生产没有 e-Mate 本地任务审计上送事实，不用模型调用记录伪造任务事件次数。

## 2026-08-16 · S07 管理员协议免签一致性

- 管理员协议豁免统一收敛到现有角色边界：`TENANT_ADMIN` 与 `AUDIT_ADMIN` 登录本地 e-Mate 时直接解锁工作区，Model Gateway 同样跳过普通用户同意门；不请求 `/v1/consents/current`、不写接受记录、不生成伪回执。普通 `MEMBER` 流程保持首次签署和企业留档不变。
- 管理端用户列表对管理员显示“管理员免签”，不再把无签署记录误标为普通用户“未签署”。身份、模型网关、管理端聚焦回归及两项 TypeScript check 通过；生产部署仍须随下一份已通过 CI 的服务制品激活后再做真实账号复验。

## 2026-08-16 · S07 2.0.7 新用户首次使用与真实模型闭环

- 主代理通过生产注册 challenge 创建 `emate-v2 / emate-accept-0816-1140`，真实姓名为“验收用户”。管理员从现有管理端将其审批为 ACTIVE，周额度设为 100,000 Token，只允许 Luna 与 Sol；旧 `emate-production` 用户和服务未停止、未导入、未修改。生产数据库只读回读为普通用户 `ACTIVE / 100000 / 1` 条当前协议回执，管理员 `ACTIVE / unlimited / 0` 条回执。
- 首次登录发现服务器当前同意政策 hash 仍指向旧 2.0.5 文本，客户端按合同失败关闭。主代理在 root-only 目录快照配置后，只把生产 consent policy 的 `contentHash` 对齐当前安装包 `3e3f7919a9007b9f852ca74f363f257fb0bbf3b09c366d63d2b121abee682920`，使用既有生产镜像和 `validate-secrets.sh` 校验，再仅重建 Gateway；Auth、Postgres、Redis 与旧服务未停止。回退收据为 `/root/e-mate-bootstrap/20260816T043000Z-consent-policy-3e3f7919`，新配置 SHA-256 为 `32182edf2280b35e2b9eb32fd35225314dd845c08222fb3be2f192a260d4e891`。
- 普通用户在 Browser 中逐项勾选三项确认并签署协议，企业数据库回读 agreement/disclaimer version 均为 `2026-08-14.1`，随后进入工作区。默认模型真实显示 Luna；同一 Session 的 Luna 首轮回复编号 `207`，第二轮准确回忆 `207`；切换 Sol 后第三轮仍回复 `207`，模型选择器同时回读 Sol，证明模型切换生效且上下文连续。三轮实测分别为 Luna 21.4s/首 Token 18.8s/5.4 tok/s、Luna 15s/首 Token 14s/7.2 tok/s、Sol 20s/首 Token 20s/32 tok/s；用户中心回读 48,855 / 100,000 Token。
- 首次真实登录同时暴露 macOS `security -w` 交互输入对长凭据截断的根因。OS credential provider 保持 Keychain-only：不把值放 argv、环境变量或文件；超过 96B 的值改为带 generation、SHA-256 manifest 和写后校验的分片，且同一 credential ref 的 set/unset 串行化。4 KiB 真实 Keychain round-trip 与 256B 并发覆盖探针均通过，Model Token 和 Session 不再出现 generation incomplete。
- 用户在现有账户设置中完成改密，服务撤销旧租约并返回登录页；旧密码经 Auth 401/`INVALID_GRANT` 映射为 Harness `bad-request`，页面显示“账号或密码错误”，新密码重新登录成功且原本地会话保留。HTTP 500、未知 4xx 和网络失败继续抛出，不被误报为凭据错误。管理员真实登录直接进入工作区、未进入协议页，生产数据库回执数保持 0；未生成管理员假签署记录。

## 2026-08-16 · S04/S07 Luna 首响分段与原生直连修复候选

- 真实 Session 事件分段确认首轮 Luna 的 `turn/start → request/header` 为 7.950s、`request/header → first assistant/chunk` 为 10.882s、首 chunk 到终态为 2.602s，总计 21.434s；输入 14,729、输出 14，生成段 5.38 tok/s。第二轮缓存上下文后 TTFT 仍为 14.457s，说明问题不只在首轮 Skill/System catalog。请求头约 51.7 KiB、40 个真实 Tool；没有删除必要系统提示、安全边界或 Tool 能力。
- 本机 Keychain 分段发现模型短令牌首读 837.945ms、企业 Session 首读 2,912.145ms，随后同进程重复读取分别降为 0.020/0.007ms 与 0.019/0.007ms。OS credential provider 只增加与 `set/unset` 同步失效的正值缓存；环境变量优先级不变，相同 durable value 的 `set` 为 no-op，写入/删除失败不会公布新值或回退到旧账号值。协议状态仍每次请求企业当前政策，没有做进程生命周期缓存。
- 更根本的架构违背是 e-Mate profile 把 rc.5 原生 `llm-pi-ai` 指向企业 Model Gateway，使聊天 SSE 进入了本应只负责鉴权、策略下发和旁路审计的企业层。修复候选保留唯一的 target adapter：Gateway 新增同一 JWT、协议、租户启用和允许模型过滤下的 Host-only `GET /v1/runtime-models`，只下发聊天路由 direct Base URL、真实 upstream model id、协议、能力和 Key；无 CORS、`Cache-Control: no-store`，公开 `/v1/models` 继续剥离这些字段。
- 本地 enterprise provider 对 runtime bundle exact validate，HTTP 只有路由显式 opt-in 才接受；Key 只写 Keychain/DPAPI，非秘密 provider profile 通过 target `settings` 的 `llm-pi-ai` namespace 热投影。静态 profile 已删除聊天 Gateway URL/Token，Luna/Sol 保持 provider `e-mate-enterprise`；durable/public policy v1 继续使用兼容 ID `deepseek`，只有 target native projection 使用真实 `deepseek-v4-flash` 并独立 route，未在 pinned adapter 中伪造 alias。模型调用前只读取本地有效、账号绑定的 policy cache；过期、账号切换或旧 Gateway settings 尚未被 native projection 替换时立即 fail closed，企业刷新在后台触发，真实 audit usage 仍写本地 durable outbox 后异步上送。
- Model Gateway TypeScript check 与 84 项测试为 78 pass / 6 环境 skip；`@e-mate/dsh` build 及 OS credential、identity、runtime projection、模型切换聚焦 4/4 通过。未部署、未修改生产；一次受控 direct upstream 探针返回 HTTP 503 后停止，没有盲重试或冒充 before/after。正式关闭仍需生产把权威聊天 route 从内网 bridge 改为客户端可达的批准 upstream，完成同数据集至少 3 次配对并报告 p50/p95、TTFT、总时长、tok/s 和输入 token。
- 直连后服务器不再逐请求同步执行周额度 admission；本地 durable quota enforcement 尚无现成完整 seam，保持独立发布阻塞。图片插件仍按既有专用 Gateway 路径运行，也必须作为后续切片处理，不能用本次聊天 LLM 修复宣称全部模型调用链已完成。

## 2026-08-16 · S02/S03 消息流回归 Harness 原生展示

- 用户最终明确撤销 `019ff665-d721-79a0-869d-338f086cf529` 与 e-Mate 2.0.4/2.0.5 的消息流展示升级。当前候选删除 ActivityHeader、RetryAttempts、LongMessageDisclosure 及对应 keyed slot/CSS，重新由 pinned rc.5 的 Message、Retry、TurnStatus、Tool、Disclosure 和 Actions 完整负责消息展现与交互；Session、Conversation events、Store、Router、Connection 与 transport 均未修改。
- 唯一保留的消息视觉例外是图片画廊：辅助节点只匹配真实 append `assistant/message` 图片块，只切换同一 target ImageGallery DOM 的 hidden 状态；图片加载、鉴权、重试和 Lightbox 仍由目标 renderer 负责。`dsh-genui` 的 bundle、patch、`render_ui`/`validate_dsh_ui` Tool 和 client renderer 无代码差异，并有静态注册回归。
- 主代理在既有真实账号和持久 Session 上复验：自定义 Activity/Retry/LongText 节点计数为 0，目标 Think disclosure 原位展开，消息复制/反馈/分支动作保持目标实现，禁用 trajectory 后无可见 Inspect；点击折叠后的 computed outline style 为 `none`、box-shadow 为 `none`，没有红/蓝框。品牌相关目标色 Token 继续投影为 e-Mate 橙色。
- 主包完整测试为 Node 47/47、shell 31/31，`@e-mate/dsh` build、target pin 和 diff check 均通过。主代理截图为 `artifacts/design-qa/S03-target-message-stream-main/target-native-message-stream-no-focus-ring.png`。旧日志中的原型活动组、重试链和长文本视觉验收仅是历史证据，已被本次最终产品决策取代。

## 2026-08-16 · S07 原生直连后的本地周额度候选

- 企业端继续只下发账号、周额度、模型策略和运行配置，不进入 Harness 原生 `llm-pi-ai` 推理热链。现有模型策略后台刷新同时取得权威 UTC 周用量快照，并按账号、策略租约和周起点写入本地 `StorageDomain`；有效快照可离线继续使用，过期、跨周或账号切换均失败关闭。
- 有限额度账号在真实 `agent/request` 与 `llm/stream` 之间持久预留当前剩余额度；同一账号同一周最多一个未结算聊天请求，因此消除本地并发超额。终态只读取真实 Harness usage chunk，并在对应持久 `assistant/message` 事件出现后以与审计 outbox 相同的 `fact_id` 结算；重复事件不重复计数，审计回执与更新后的企业快照用于排除已纳入服务端账本的本地事实。
- 弱网、Abort 或下游流抛错会释放当前预留并原样透传错误，让目标原生重试继续工作；若本地持久清理自身失败则保留预留并失败关闭。进程崩溃或正常结束但缺少真实 finish chunk 时也保留预留，避免猜测用量。不限额度账号不建预留并保持并发。
- 当前合同只能消除并发超额，不能阻止单个真实请求超过请求开始时的剩余额度；这是明确的 best-effort 单请求上限，不冒充严格硬配额。若发布要求零超额，仍需上游支持单请求精确 Token 上限或每用户 Provider 额度，保持发布阻塞。
- 主包验证为 Node 48/48、shell 31/31，构建与 diff check 通过；覆盖并发预留、真实终态结算、重复事件、重启、周切换、账号隔离、离线租约、不限额、弱网异常释放和审计回执对账。前一候选提交的 CI 与 Release run 均成功，三平台干净 npm 安装已通过；本切片合入后必须重新运行同一门禁。

## 2026-08-16 · S04/S07 原生直连生产激活与真实首响复验

- 生产只激活提交 `2bd51196dac25c6c8a42cfb9e9e704dcf8f50b81` 对应的 Model Gateway 控制面镜像 `e-mate/model-gateway:e-mate-2.0.7-direct-2bd5119`；运行镜像 ID 为 `sha256:13719f52d7bd0bba6827759b0cd158790357f8a4c55b2c0ed2132620293fb614`。Gateway 健康，Auth、Analytics、Web、PostgreSQL 与 Redis 未重启且继续健康；旧镜像、旧 Secret root、旧 Compose/环境/模型配置均保留用于精确回退。
- 权威聊天 route 现由 `GET /v1/runtime-models` 按当前账号和策略下发给本地 Host：Luna/Sol 走用户批准的 HTTP direct upstream，DeepSeek 与 Doubao 走各自 HTTPS upstream；图片继续使用专用 Gateway 路径。接口为 `Cache-Control: no-store`、无 CORS，只返回当前 principal 允许的 4 个聊天模型；Key 未进入浏览器、settings、日志或回执。
- 候选激活前真实 Model Smoke 为 Luna、Sol、DeepSeek Flash、Doubao、`gpt-image-2-pro` 五路全通过；Smoke SHA-256 为 `bd28059a253fbf055c1890b22f8aad66cde39cb906adc9b63f794fec2ba89095`。生产回执为 `/root/e-mate-bootstrap/20260816T071402Z-runtime-models-direct-2bd5119`，激活回执 SHA-256 为 `a8cdf027d6d6b208964b61f5a025741419b79921306597f8eaa3edb89de48f0f`。
- 本地主机用真实管理员登录后，目标 `session.models` 回读 Luna、Sol、DeepSeek、Doubao 四个聊天模型且 `routable=true`；`settings.describe` 的 `llm-pi-ai` namespace 为 live revision 1，只有三个原生 provider profile、Key 仅以 credential ref 出现且无 inline value。新 Session 默认回读 `gpt-5.6-luna / max`；验收中临时切到 Sol 后已切回 Luna，并由另一个新 Session 再次确认默认值。
- 同一真实 Session 的上下文连续通过：Luna 首轮记住 `ORANGE-207`，第二轮准确回忆；切到 Sol 后仍准确回忆，随后恢复 Luna。短回复的三次 Luna TTFT 为 2.522s、4.827s、4.074s，中位数 4.074s；对应总时长为 2.525s、5.162s、4.428s，中位数 4.428s。Sol 切换后的 TTFT/总时长为 2.807s/3.172s。相较修复前同机首轮 18.8s TTFT、21.4s 总时长，当前真实链路已消除企业 Gateway 与 Keychain 热路径等待。
- 另一个 Luna 长回复产生 183 output tokens、159 个真实 `assistant/chunk`，TTFT 3.357s、总时长 7.505s、首末 chunk 解码 2.434s，即 75.18 tok/s。该样本用于确认流式生成恢复，不把不同提示长度的 75.18 tok/s 与旧 5.4 tok/s 冒充严格同数据集配对，也不从少量样本推算 p95。
- 空白新 Session 首次读取模型目录时，在 control-plane 背景刷新完成前短暂返回 `routable=false`；绕过 UI 强行提交会按合同以 `model policy cache is unavailable or expired` 失败关闭。随后同一 Session 目录变为可路由并正常完成请求；正常浏览器 Composer 会等待真实目录可路由，不制造自动成功状态。

## 2026-08-16 · S07 验收账号模型与生图策略修复

- 通过现有 Admin API 将 `emate-v2 / emate-accept-0816-1140` 从 Luna/Sol 两项收敛策略更新为 Luna、Sol、DeepSeek、Doubao 和 `gpt-image-2-pro`，Luna 保持首位默认，未加入 Gemini。用户仍为 `ACTIVE / MEMBER / 100000`，真实协议回执数仍为 1。未直接写 SQL、未改 Key、未重启服务。
- 主进程只读复核回执：五路 route 均 `enabled + published`，登录模型集含四个聊天模型和 `gpt-image-2-pro`，runtime endpoint 仍只下发四个聊天模型；Gateway/Auth/Analytics/Postgres/Redis 均为原实例 healthy。生产回执为 `/root/e-mate-bootstrap/20260816T084700Z-accept-model-policy/`。
- 策略更新按合同撤销该账号旧租约。当前没有可安全取得的验收账号新密码或有效 Session，因此未伪造真实 image Tool 调用；最终 Computer Use 仍需用户重新登录该账号，核对五项可见目录与真实 imagegen Job/Attachment。

## 2026-08-16 · S03 Harness 原生思考状态品牌化

- 目标 `TurnStatus` 仍只由 Harness 真实 `running` 状态与真实 turn/start 时间驱动。e-Mate 只在客户端品牌层将可见/accessible 文案投影为“思考中”，并加入 Generative Loaders MIT `Domino` 的原始四节拍结构；色彩复用 Think/Tool 标题 `--dsw-alias-label-secondary`，尺寸收敛到 e-Mate `16px + 14/24`。
- 该投影不解析 Session 事件，不注册第二 renderer/Store/Router/transport，不影响目标原生计时与终态清理。主进程用真实 Luna 请求看到 `role=status / aria-label=思考中`，轮次结束后节点消失；Shell 32/32 和主包 build 通过。

## 2026-08-16 · S07 旁路审计生产入账与 Usage 对账

- 提交 `9f7aea9bf0875a261f508e4401be8e70df3911cd` 将真实 Harness `assistant/message` Usage 事实经本地持久 outbox 和现有 Host-only identity transport 上送 `/v1/audit/usage`。服务端只写现有 Usage task/attempt/invocation 账本，不参与推理、模型路由或额度 admission；批量大小、载荷、账号、策略、模型、hash 和时间均在入口失败关闭。
- 本地门禁为主包 Node 49/49、Shell 32/32；Model Gateway 80 pass / 7 环境 skip；精确提交 CI run `31938253833` 成功。Release run `31938253841` 的 tarball、darwin-arm64、darwin-x64 与 release evidence 已成功，记录时 win32-x64 干净安装仍在运行，不能提前标记整条 Release 成功。
- 生产只替换 Model Gateway 为 `e-mate/model-gateway:e-mate-2.0.7-audit-9f7aea9`，镜像 ID `sha256:439caf252870e1fccb6fa31e96a828be67ee8a862142fd4b3505c72908a989c9`；Auth、Analytics、Web、Postgres、Redis 容器未重启。激活前 Luna、Sol、DeepSeek、Doubao 和 `gpt-image-2-pro` 五路真实 Model Smoke 全通过。root-only 回执目录为 `/root/e-mate-bootstrap/20260816T091230Z-audit-ingest-9f7aea9`，激活回执 SHA-256 为 `81fcb009b2abddc35d37b1dcae3283711c879d9a8adada9970a5769cf9408975`。
- 真实管理员本地 outbox 从 1 条 pending / 15,040 Token 变为 0 pending / 1 delivered；生产账本从 3 次 / 13,185 Token / 3 Invocations 变为 4 次 / 28,225 Token / 4 Invocations。重复上送相同事实返回同一 receipt，账本计数完全不变。
- Analytics 回读管理员 requests=4、usage events=4、total tokens=28,225；租户总计 requests=8、usage events=8、total tokens=77,080。Usage reconciliation 为 `MATCHED`，request status、usage task total、completed invocation usage 和 usage-invocation link 四项差异均为 0。
- 本切片只关闭模型 Usage 审计。`/v1/tasks/summary` 仍为 `NO_DATA`，管理员 `e_mate_task_event` 数为 0；本地任务生命周期事件尚未上送，不能拿模型调用记录伪造每用户事件次数。

## 2026-08-16 · S07 Harness 任务事件旁路审计与每用户事件次数

- 提交 `46be4ef74e54421bf358286ebb1f425a89fdbb1f` 只映射 pinned rc.5 的真实持久事件：`turn/start → RECEIVED`、首个模型 `assistant/message → FIRST_RESPONSE`、`tool/call → TOOL_EXECUTION`、`approval/asked → PERMISSION_REQUESTED`，以及 `turn/end` 的完成/失败/取消终态。Task ID 与 Event ID 由 Session/turn/seq 的 SHA-256 稳定生成；载荷只有类型、匿名 ID、`GENERAL` 场景和时间，不含提示词、回复、工具名、参数、附件或原 Session ID。
- 本地复用现有 `emate-audit` 插件与独立 `emate_task_audit` StorageDomain；登录主体只在 live `turn/start` 绑定，旧的无绑定 Session 不会被当前账号冒领。任务 outbox 继续经 Host-only identity transport 上送新增的 `/v1/audit/tasks`；没有浏览器 RPC、第二 Store、Router 或通信层。Model Gateway 使用既有 model-session 验证当前用户和协议，再原子写入共享 `e_mate_task_fact/e_mate_task_event`，同 Event 重放返回同 receipt，冲突整批回滚。
- 新增 `GENERAL` 是 Harness 通用 turn 的真实场景，不从提示词、工具或能力名猜业务分类；`SKILL_SELECTED / TOOL_SELECTED / WAITING_INPUT / ARTIFACT_UPDATED` 在无权威事件源时保持 0。共享 monitoring contract、Analytics、Usage、Gateway 和 Host 聚焦门禁全通过；精确提交 CI run `31939933973` 成功。
- 生产候选激活前 Luna、Sol、DeepSeek、Doubao、`gpt-image-2-pro` 五路 Model Smoke 全通过。仅替换 Gateway 为 `sha256:491212557d98df0c0c01d98f4704503f353739f27655dfbb2dada0fd44929732`、Analytics 为 `sha256:b74fc659fc60a5d9bd0d826071d0d66f84de05959019c505bc53d87d3016a39c`；Auth、Web、Postgres、Redis 容器未重启且继续 healthy。公网 Usage 静态 release 原子切到 `/srv/ecorex-agent-usage-panel/releases/usage-2.0.7-task-audit-46be4ef`，实际脚本为 `index-BIO1utWs.js`。
- 主代理用真实管理员在受管 e-Mate 中执行一个 Luna 无工具 turn；页面终态回复“任务审计验收通过”。本地 outbox 精确为 3 delivered / 0 pending / 0 retry；生产账本精确为 `RECEIVED / FIRST_RESPONSE / COMPLETED` 各 1，管理员事件次数 3、`GENERAL` 任务 1。重启 Host 回放同一 Session 后本地和生产计数完全不变。生产 Usage 面板显示事件次数 3、通用任务 1，四项对账差异为 0。
- 公网 Usage 首轮仍加载旧 `index-JdWJrmzA.js` 并把四个 HTTP 200 的新合同误报为不可用；根因是公网 Nginx alias `/srv/ecorex-agent-usage-panel/current`，不是容器内 `/srv/www/usage`。切换真实 alias 后 Browser 回读新 bundle 与完整数据。后续静态验收固定先核对浏览器实际脚本 hash，避免只看容器目录。
- 管理员初始密码已失效；按现有 `PostgresAdminManagementStore.resetPassword` 共享事务设置新的随机强密码并撤销旧管理会话，真实重新登录成功。密码只存用户本机权限文件与服务器 root-only `0600` 文件，不进入命令参数、环境变量、日志、源码或 Git；管理员继续免签协议。
- root-only 生产回执为 `/root/e-mate-bootstrap/20260816T095133Z-task-audit-46be4ef`，`activation.json` SHA-256 为 `bd32b800b1c77ff61ec1cefc8f5f71d63389611ea59fd817622b11dd28834aaf`。旧 Gateway/Analytics 镜像、compose/env、Usage 静态 tar 与旧 alias 目标均保留用于精确回退。
- 本次真实 Luna 运行仍同时显示英文 `Deep diving...` 和中文“思考中”；这与先前品牌化结论不一致，已重新列入最终 UI P1，不能用既有单测或历史截图关闭。
## 2026-08-16 · S11 dsh-im 外部连接插件审计（实现前事实）

- 上游 `xmanrui/dsh-im` 当前 `HEAD` 为 `2eea8a08bcd8ef91e8845de1f300b5715b746938`（package `@xmanrui/dsh-im@0.2.0`），仓库与包本体均声明 MIT；npm 发布物可读取，完整性为 `sha512-piOMq5sHFrg7ScyPrUneOrRycB4KvGIm+gmY8qknObccviBHQn3v6zGF4M1f4xQos16dCbXzELQoOor+T/nc/w==`。上游 281 项源码测试在 Node 24.19.0 下通过。
- 上游 Host/Client 复用 Harness `Connection.rpc`、`/api/<method>`、Session/Workspace 事件，没有要求修改 Agent Loop；但源码和测试明确以 rc.6 RPC 形状命名，未声明对 e-Mate 固定 rc.5 commit `47f943859bef60e4160492346772ded9b24f765a` 的兼容矩阵，也没有 e-Mate 项目/通用会话绑定合同。
- 上游 QQ 扫码运行依赖 `@tencent-connect/qqbot-connector@1.2.0`，其 npm 元数据声明 `UNLICENSED`。该依赖以及 QQ 运行通道不得复制或进入 e-Mate 发布闭包；其余通道也不能在完成 rc.5、凭据、会话绑定和真授权验收前显示为 ready。
- 本切片采用失败关闭适配：增加 MIT 的 e-Mate 插件收据，只登记真实上游 commit、允许审计的通道集合和阻塞码，不复制上游运行码、不注册第二 transport/Router/Session Store/Tool。能力中心以现有 `emateCapabilities` 元数据展示该适配状态；聊天框入口只进入能力中心的“外部连接”分类。
- 实现增加 `@e-mate/dsh-plugin-im@2.0.7` 并纳入现有 profile bundle 生成、setup 校验和 release registry；该包依赖数为 0、运行码为 0、Tool/transport 数均为 0，能力卡真实显示 `blocked / EMATE_DSH_IM_RUNTIME_UNVERIFIED`。能力中心只按插件的 `icon_key=collaboration` 动态归类，中央 UI 没有通道 ID/工具名分派。
- 聊天框“外部连接”通过既有 History/`popstate` 跳转 `/capabilities?category=collaboration`；能力中心自动展开“本机内置能力”并选中“外部连接”，没有新增页面 Router。聚焦门禁通过：上游 281/281、适配包 2/2、Shell 路由/分类 9/9、profile setup/可见能力/环境闭包 3/3、target contract 与 diff check；适配包 `pnpm pack` 仅含允许名单文件。
- 剩余真实阻塞：rc.5 Host 组合、e-Mate 通用/项目会话绑定、macOS/Windows 本机凭据、飞书/微信/钉钉/企业微信/Telegram/Discord/WhatsApp 真授权与可逆收发均未验收；QQ 因 `UNLICENSED` 依赖不进入后续适配范围。

## 2026-08-16 · S07 生产验收账号无限额度与显示闭环

- 通过现有生产管理 API 将唯一验收用户 `cae2a9ef-2110-41ab-990d-151658c549e7` 的 `tokenLimit` 从有限值更新为 `null`；状态保持 `ACTIVE`，五项已允许模型保持不变，旧服务未停止或重启。管理 API 回读为 `null`，随后使用该用户真实密码重新登录，Auth Gateway 新租约的 `weeklyTokenLimit` 为 `Number.MAX_SAFE_INTEGER`，证明现有无限额度合同生效。
- Computer Use 发现用户中心把内部无限额度哨兵直接显示为 `9,007,199,254,740,991`。显示层已复用同一真实身份/用量状态，改为“已使用 Token · 不限额度”，进度条用 `aria-valuetext` 描述无限额度；设置页同步显示“每周 Token 额度 不限”。没有改变 Auth、配额 admission、审计或模型调用链。
- 聚焦组件测试覆盖有限额度原行为、无限额度用户中心、无哨兵泄露和设置页文案；Shell 客户端构建通过。同步新 bundle 并重新登录后，真实浏览器回读用户中心为 `110,314 Token · 不限额度`，设置页为“每周 Token 额度 不限”，不再暴露内部哨兵。

## 2026-08-16 · S02/S10 覆盖层会话闭环与真实图片持久画廊

- Computer Use 发现从 `/capabilities` 点击真实会话会切换 Harness 当前 Session，但 URL 和能力中心覆盖层没有关闭。修复只监听目标 `sessions.current` 的真实变化：能力中心、设置或定时任务覆盖层中的会话变化投影到真实 `/chat/:sessionId` 并复用既有 `popstate`；初始深链和同一会话不制造导航。真实浏览器已验证能力中心点击另一会话后进入对应 chat URL，覆盖层消失。
- 首次真实生图完成后，图片只存在于持久 `tool/result` 的真实 image block；Host 重启后目标通用 Tool 仅显示 JSON，Agent 随后对已丢失的进程内 Job ID 查询失败，却错误声称图片已展示。历史错误回复原样保留为验收证据，没有删除或改写事件。
- e-Mate 图片例外现增加一个通用 `tool/result` 投影：只匹配真实 append Tool result 中的 image block，不判断工具名或能力 ID；复用 pinned Harness `ImageGallery`、授权附件加载和 Lightbox，只折叠/展开同一持久附件。没有新增 Store、Router、REST、WebSocket 或 Session 事件。Host 重启后旧图片真实恢复为“已查看 1 张图像”，原图预览可打开。
- 单次真实生图通过；基于上一张附件 SHA-256 的单次改图通过，耗时约 2 分 11 秒，真实产物把橙色星星改为橙色爱心并保持透明背景。两个不同 Session 的并发 2 验收中，一项约 60 秒完成并展示真实图片，另一项约 2 分 20 秒收到上游 HTTP 503；因此当前只能确认稳定并发下限为 1，并发 2 保持发布阻断，不能用 1/2 成功冒充通过。
- 主包验证为 Node 49/49、Shell 34/34，target pin 与客户端构建通过；Loader 合同显式加入目标 attachment renderer，确保受管 profile 重装后仍使用同一 Harness 实现。

## 2026-08-16 · S03 原生思考状态中文替换最终闭环

- 前一品牌投影只用 `font-size: 0` 隐藏目标 Text node，语义树仍同时包含 `Deep diving...` 和“思考中”。最终实现继续只覆盖 pinned Harness 的真实 running status，但在运行期间暂存并清空该英文 Text node，卸载时按原值恢复；Domino、真实 turn 时钟、终态清理和事件来源不变。
- Shell 34/34 与主包客户端构建通过。同步受管 profile、重启 Host 并重新登录后，真实 Luna 请求的运行态 DOM 为 `status / 思考中`，`Deep diving...` 计数为 0；截图中只显示橙色品牌 Domino 和“思考中”，终态后节点消失并显示真实回复。

## 2026-08-16 · S10 Codex imagegen 运行与并发对照

- 本机可分发的 imagegen 合同确认：每个资产或变体是一个独立 built-in 调用；编辑只使用当前会话中可见的图片。Codex 内置服务端实现不在分发目录中，不能检查、复制或宣称完全复刻。Apache-2.0 fallback CLI 的 `asyncio Task + Semaphore` 默认 5、上限 25 只是批处理工具参数，不是内置服务稳定并发上限，也没有搬入 e-Mate。
- e-Mate 已匹配可验证结构：每个 Tool 调用一张图、编辑仅接受当前权威 Session 的 CAS attachment、`isConcurrencySafe` 交给 Harness 并行调度、每次有独立 Job/调用 ID、取消信号、图片校验、CAS 产物和真实 `tool/result` attachment。模型固定 `gpt-image-2-pro`，不允许用户或前端改 provider/model/timeout/并发策略。
- 曾用同一调用 ID 试验 503 自动重试，但现有安全门禁正确失败：当前 Images 上游没有正式承诺 idempotency key 去重或 invocation 状态查询，重复 POST 可能重复出图和计费；试验已完整撤回，最终 0 代码改动。两条历史 504/503 的 Harness Job 都是真实 failed，企业调用账本的 PENDING 只表示无法证明上游未接收还是响应丢失，不能伪造为 rejected。
- 安全解除 PENDING 需要上游提供按 invocation/idempotency key 查询的鉴权状态合同，并绑定 request digest、route fingerprint、provider/model；只有明确 `NOT_ACCEPTED` 才可重试，`ACCOUNTED` 必须带可信 response ID、终态和 usage，`UNKNOWN` 保持待核对。在该合同缺失时停止更高阶生产压测；当前可确认稳定并发下限为 1，并发 2 仍不稳定。
- 对照切片验证为 Model Gateway TypeScript check、图片生成/改图/Pro fallback/503 不重复提交/API 隔离 5/5、e-Mate Harness Job 与 attachment 1/1；Model Gateway 81 pass / 7 环境 skip / 0 fail，且无残留代码改动。

## 2026-08-16 · S11 外部连接授权前闭环

- 主代理 Computer Use 复现真实缺口：聊天框已经进入能力中心“外部连接”分类，但插件卡只有动态状态，没有可达设置/授权步骤，违反“可发现且按钮闭环”。根因不在连接 transport，而是分类页缺少到目标现有 Connections Settings 的入口。
- 最小修复只在 `collaboration` 分类显示“配置外部连接”，通过既有 History/`popstate` 进入 `/settings?section=connections`；没有为飞书、腾讯文档、微信、钉钉或 dsh-im 在中央 UI 写 ID/工具名分派，没有新增 Router、Store、RPC 或第二连接页。聊天框入口仍先进入能力中心，符合外部连接子类型要求。
- 重建受管 profile 后，主代理从聊天框逐步进入能力中心和真实设置页。飞书显示 App ID/App Secret、腾讯文档显示 OAuth Token、钉钉显示 Client ID/Client Secret；凭据继续只写 Keychain/CurrentUser DPAPI且页面不回读。微信准确显示设备扫码尚未启用，dsh-im 继续为 `EMATE_DSH_IM_RUNTIME_UNVERIFIED`，没有假二维码或近似授权页。
- 按 2.0.7 验收边界，本轮未填写、保存、提交 OAuth、扫码或发消息。Shell 34/34 与主包构建通过；真实授权前截图为 `artifacts/design-qa/S11-external-connections/settings-authorization-step-1280.png`。

## 2026-08-16 · S10/S11 二维码真实闭环

- `xmanrui/dsh-im@2eea8a08bcd8ef91e8845de1f300b5715b746938` 的只读审计确认微信 iLink 二维码流程为 MIT 可适配部分；QQ 仍依赖 `UNLICENSED` 的 connector，不进入 e-Mate。微信授权复用现有 `/emate.connections` loopback RPC：二维码 token 和区域重定向只留在 Host 内存，浏览器只取得一次性 PNG 与状态；确认后的 bot/account/owner/base URL 只写现有 Keychain/CurrentUser DPAPI provider。没有复制 rc.6 Runtime、增加 REST/WebSocket/Store/Router 或把消息通道假标为 ready。
- 主代理直接调用同一发布 bundle 的真实微信 begin 流程，取得 pending 状态和 3,168-byte PNG 后立即取消；没有输出 token、保存二维码、扫码、提交配对码或取得真实账号授权。Browser 验收因此前策略变更已吊销验收账号租约且当前没有可安全取得的新密码，未绕过登录或创建临时生产用户；UI 的生成、轮询、配对码和取消闭环由挂载测试覆盖，最终 Computer Use 登录后仍需逐屏复验。
- Agent 普通二维码使用独立 `e_mate_qr_generate` typed Tool：输入上限 1,024 UTF-8 bytes，固定生成 512px/M 级 PNG，通过 owner-scoped Harness Job 与 `attachments.saveImage` 写入当前会话，返回真实 image block 继续由目标 Image renderer/Lightbox 展示。Job receipt 不含原文，Tool 明确禁止密码、Key、令牌、恢复码、私钥和 Cookie；未改 dsh-genui、消息事件、通信层或 renderer 分派。
- `qrcode@1.5.4`、`dijkstrajs@1.0.3` 与 `pngjs@5.0.0` 已内联进 Host 插件并补齐 MIT notice，干净安装不依赖 `$DSH_HOME` 外的模块解析。主包完整门禁为 Node 51/51、Shell 34/34；真实 Host 重装后健康，固定 Harness runtime-binding 的 Tool/Job/Attachment 执行回归通过。

## 2026-08-16 · S07 直连旁路审计终态修复与生产历史收敛

- 生产回读发现直连 Harness 上送的 Usage 事实已形成唯一 attempt 与已完成 invocation，但对应 `e_mate_model_usage_task` 仍停在 `ACCUMULATING`。标准 Gateway 调用本来允许跨 invocation 聚合、只有显式 `/v1/usage/:task` 才终结，因此修复只识别服务端生成的 `auditreceipt_` invocation；没有把全部积累中任务一刀切为终态。
- 提交 `f9c50fefefc92fe45618cb7bc6665539fa9d7a51` 在同一 Postgres 事务中写入旁路 attempt/invocation，并使用 `auditusage_<sha256(fact_id)>` 将该 task 终结为 `FINALIZED`。相同事实重放必须回读相同终态 task、usage ID 与时间，冲突继续失败关闭。Analytics 对账也只要求 `auditreceipt_` task 具有终态，不把正常聚合 task 或 Provider pending 误报为差异。
- 本地 Model Gateway 为 81 pass / 7 环境 skip，Analytics 为 33 pass / 6 环境 skip；候选镜像连接隔离临时 PostgreSQL 数据库的真实集成为 5/5，临时库随后删除。精确提交 [CI run 31948896991](https://github.com/zyfjacksonchen-source/e-Mate/actions/runs/31948896991) 成功；[Release run 31948896999](https://github.com/zyfjacksonchen-source/e-Mate/actions/runs/31948896999) 的 tarball、SBOM/许可证证据及 darwin-arm64、darwin-x64、win32-x64 三平台干净安装全部成功。该次运行 `publish=false`，npm、registry install 与 R2 发布 job 均为 skipped，不能写成已公开发布。
- 生产仅重建 Gateway 和 Analytics：当前镜像分别为 `sha256:0df335d158e5d07dd42667c550c1be38f89ef28c89253fcf443d8de3d97f3443` 与 `sha256:3271373646e5230a869df432adfd504be88a86776184883cfe7c4cc6cf4ab4da`，Auth、Web、Postgres、Redis 未重启。激活前 Luna、Sol、DeepSeek、Doubao 与 `gpt-image-2-pro` 五路 Model Smoke 全通过；配置摘要为 `6d47c4bc9350026492e1a6932510325b54b97ed2b671e1398a77d0657ba187ce`。
- 历史修复在一个事务内精确命中 21 条 audit task：`eligible=21 / updated=21 / unique_usage_ids=21 / remaining_audit_accumulating=0`；16 条正常 Gateway 聚合 task 与 2 条真实 Provider pending 合计 `non_audit_accumulating=18`，保持未修改。验收用户当前只读回查为 19 条 audit `FINALIZED`、0 条 audit `ACCUMULATING`；root-only 回执目录为 `/root/e-mate-bootstrap/20260816T130715Z-audit-finalize-f9c50fe`。
- 受管 Host 与 `/api/e-mate/health` 当前健康，但验收账号策略变更已撤销旧租约，真实浏览器停在登录页。尚未输入密码或绕过登录；因此“部署后新 Luna 会话产生新的 deterministic audit usage、Usage 四项继续为 0 差异”仍是明确待验收项，不能用历史 21 条修复或单元测试代替。

## 2026-08-16 · S13 当前发布载体与公开入口复核

- 公开仓库和产品名称继续为 `zyfjacksonchen-source/e-Mate` / `e-Mate`；npm 身份为 `@e-mate/dsh@2.0.7`、命令为 `e-mate`。技术文档可注明固定 DeepSeek Harness，但发布页、健康响应和 UI 不使用“e-Mate Harness”作为产品名。
- 当前产品提交 `f9c50fe` 的 CI/Release 均成功，Release 已用同一 tarball 完成 darwin-arm64、darwin-x64、win32-x64 仓库外干净 npm 安装和 SBOM/许可证证据；`publish=false` 使 npm、registry 回读和 R2 job 正确跳过。文档提交 `7971334` 的 CI 也成功，不把纯文档运行冒充新产品候选。
- 实时 HTTP 回读确认管理端和 Usage 的 `dl`/`mvdcm` 地址均为 200，当前生产脚本分别是 `index-_20_trxr.js` 与 `index-BIO1utWs.js`。下载入口 `https://dl.ecoremedia.net/e-mate/update/` 仍经两次 302 到旧“e-Mate 下载与安装”页面，并展示桌面安装包及 macOS 未签名图解；这与 2.0.7 的 npm-only 交付合同不一致。正式 npm/R2 同字节准入和新下载页切换前，S13 继续 open，禁止提前宣称已发布。
