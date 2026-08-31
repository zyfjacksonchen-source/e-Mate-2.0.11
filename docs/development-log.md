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
- 2026-08-16 复核继续使用固定 rc.5 的真实 `Context + SessionStore + JsonlSessionPersistence`：15 条目标会话均归入受管通用工作区，33 轮 start/end 平衡、33 条用户消息、26 条助手消息，`tool/call`/`tool/result` 为 0，证明旧活动没有伪造成新 Harness 执行。脱敏计数收据为 `artifacts/acceptance/S08-legacy-real-source-migration.json`；隔离副本在源哈希复核后按精确路径删除。
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

## 2026-08-16 · S02 登录 Gate 的目标 Portal 隔离

- `320px` 登录页复验发现 pinned Harness 的移动导航按钮由 React Portal 直接挂在 `body`，不属于既有 `#root`；原实现只隐藏并设置根节点 inert，因此底层“打开/关闭任务导航”仍进入辅助树。修复继续沿用同一 Identity Gate，只隔离当前 `body` 的非脚本背景节点，并在 Gate 卸载时逐项恢复原 `hidden/inert`，没有按 Harness 文案或生成类名硬编码，也没有增加 Router、Store 或通信层。
- Shell 挂载回归覆盖 Portal 隐藏及原状态恢复；聚焦 9/9、主包构建与 diff check 通过。新 bundle 同步到隔离受管 profile 后，主代理在真实 Browser 的 `320×800`、`390×844`、`768×900`、`1280×900`、`1920×1080` 逐档复验均为 `scrollWidth === clientWidth`，登录 Gate 之外的任务导航按钮可见数为 0，标题仍为 `e-Mate`，favicon 仍为透明底小芯机器人。该证据关闭登录态五档响应式与 Portal 隔离，不替代解锁后的五档响应式和全按钮闭环验收。

## 2026-08-16 · S07 注册密码二次确认

- 注册表单新增“确认密码”，两次输入必须完全一致才允许提交；不一致时显示中文错误并禁用提交。注册 RPC 与企业身份合同未改变，匹配后仍只发送一个 `password` 字段。
- 聚焦身份组件回归 9/9、主包构建和 diff check 通过。主代理在全新隔离 profile 的真实 Browser 中验证：`320×800` 与 `390×844` 均有两个密码输入、无横向溢出；不一致时按钮禁用，改为一致并填完其他必填项后按钮可用，全程未提交注册申请。

## 2026-08-16 · S07/S10 验收账号、生改图与图片用量终态闭环

- 验收账号 `emate-v2 / emate-accept-0816-1140` 已使用新密码真实登录；模型选择器回读 Luna、Sol、DeepSeek、Doubao 四个聊天模型，Luna 为默认，Image Pro 继续只由图片能力使用。一次 Luna 短回复的 TTFT 为 2.2 秒、总时长约 2.4 秒、28 tok/s；本地审计 outbox 归零，生产对应 Luna task 为 `FINALIZED`。
- 首次登录 HTTP 500 的根因不是账号、密码或 Auth，而是 Gateway 重建后 Nginx 仍缓存旧 Docker IP；`/consents/current` 因此返回 502。只重启 Web 容器后上游解析恢复，Gateway/Auth/Analytics/Postgres/Redis 未重启。前后容器收据保存在 `/root/e-mate-bootstrap/20260816T141500Z-web-upstream-dns`。
- 提交 `7e893d6` 只在现有 `imagegen` Tool/Job 结果中暴露当前 Session 的 `sha256:` attachment ID。主代理随后完成真实生图和自然语言改图：Luna 从上一张 Tool/Job 结果自动取 ID，第二次 Tool 明确携带该 ID，`emate-image-2` 完成并生成新 CAS attachment 与 Harness ImageGallery；没有把 Job ID、provider request ID 或纯生图冒充改图。
- Host 重启后的第一次图片 Tool 曾在同账号 session refresh 写 Keychain 的窗口误报 policy cache unavailable。提交 `fe6b27f` 仅让同 tenant/user 刷新在两份凭据写完前保留旧内存主体；跨账号和写入失败仍清空。重启后立即自然语言改图已越过原失败点并完成，证明未把企业请求重新塞进模型调用热链。
- 提交 `e4fbb54` 让图片成功 `complete` 后复用既有 `UsageStore.finalize`；精确 `RECORDED` 重放只补终态且不重发上游，503/未知结果仍保持 reconciliation。生产候选 `e-mate/model-gateway:e-mate-2.0.7-image-finalize-e4fbb54`（镜像 `sha256:a479c679256ba2488e24a678a23f596f22be8302fd5eafe213f61f1fe79baf1f`）激活前 Luna、Sol、DeepSeek、Doubao、Image Pro 五路真实 Smoke 全通过；只重建 Gateway，随后只重启 Web 刷新 Docker DNS，其他服务保持原实例 healthy。
- 激活后的真实改图 task `image-ed01d1668c46fc120e0dd170fd544521` 在图片返回时即为 `FINALIZED`，Usage 面板同时显示该图片 `ACCOUNTED`；本轮修复前产生且满足“Image Pro、0 PREPARED、1 attempt”的两条 task `image-a70c...`、`image-5eb1...` 经所属用户鉴权的现有 `/v1/usage/:taskId` 精确终结。更早的正常聚合、Provider pending 与图片历史任务全部保持未修改。Usage 四项对账差异均为 0；root-only 收据为 `/root/e-mate-bootstrap/20260816T144149Z-image-finalize-e4fbb54`。

## 2026-08-16 · S07 Usage 面板退出与会话撤销闭环

- 生产实测发现旧 Usage 面板退出只清访问令牌，未保存或提交 Auth Gateway 的 refresh token，因此不能撤销服务端会话。提交 `069068d` 复用现有 `/v1/auth/logout`：登录只在当前标签页保存 access/refresh token；退出先同步清除两者并返回登录页，再用既有 `clientId + refreshToken + clientRequestId` 合同撤销会话；401 同样清除两类令牌。没有新增身份服务、Cookie、Router 或持久登录层。
- `@e-mate/usage-dashboard` 类型检查、14/14 测试和生产构建通过。制品 SHA-256 为 `9d760c6ee9983ec14635ccc1a906a93a79d53471c6051feb7cfa56584d03e766`，公网 alias 原子切到 `/srv/ecorex-agent-usage-panel/releases/usage-2.0.7-logout-069068d`，实际脚本为 `index-BzUbJnBX.js`；旧 release 保留可回退，root-only 制品位于 `/root/e-mate-bootstrap/20260816T150000Z-usage-logout-069068d/usage-dashboard.tgz`。
- 主代理用真实管理员完成“登录 → 退出 → 刷新仍为登录页 → 重新登录”闭环；Nginx 访问日志同时记录 `POST /auth-api/v1/auth/logout` 为 HTTP 200。浏览器未读写或输出 refresh token，生产账号密码未进入源码、Git、命令参数或日志。
## 2026-08-16 — Browser final provider switched to dsh-browser

- 用户最终选择 `Lum1104/dsh-browser` 作为 macOS/Windows 统一方案。源码固定到 MIT commit `01f0b216b1bde88b5f9c6575ce9fb922db6fd8fb`；上游 Host 96/96、扩展 146/146、typecheck/build 通过，但其 rc.6 自有 Session/Workspace E2E 在 `sessionIds=[]` 处失败，因此不能原样并入 rc.5。
- e-Mate 删除 Ego/Playwright 双路径，只保留上游页面抽取/动作实现；扩展内的聊天、Session gateway、模型、设置、side panel 和审批 UI 全部移除。Host 用目标 `ctx.tools`、`ctx.approval` 和真实 `exec.agent.id` 注册十一项 browser Tool；扩展 WebSocket 仅承载 loopback token 认证后的 Tool call/cancel/result，不承载 WebUI、Session 或模型状态。
- 同一 MV3 制品面向用户已有的 macOS Chrome 与 Windows Chrome/Edge，不下载浏览器。Browser Panel 只投影真实连接状态。包级 Host/extension build 与 3 个 carrier 合同测试通过；macOS 和 Windows 的真实 Computer Use、扩展商店分发及断连/下载/会话隔离证据仍是发布门禁。
- macOS 隔离验收随后关闭：真实 Harness Agent Loop 在 `danger-full-access` 下完成 snapshot → 输入 `session-a` → 点击 → 读取 `Applied: session-a`，事件日志保留每项真实 `tool/call`/`tool/result` 和完成 `turn/end`；下载链接生成 `/Users/mac/Downloads/receipt.txt`，SHA-256 `82a958ac398aa7af3ab42afa831567240ecb4a9828a7bb77d194cae83c46bde7`。第二个真实 Session 在未显式选择新标签页时精确失败为“当前标签页已绑定其他 e-Mate 会话”，没有读取首会话页面；关闭扩展后 Tool 失败关闭，重启同一扩展后 snapshot 恢复成功。
- 验收同时修正目标权限语义：`ask` 模式仍调用 Harness `approval.request` 并记录原生审批事件；默认 `danger-full-access / never` 不制造一个必被 Harness 拒绝的审批请求，浏览器动作按目标 full-access 语义直接执行。包级合同扩为 4/4，并锁定会话标签碰撞失败关闭和扩展无第二套聊天/Session/模型/审批 UI。Windows 实机与 Chrome Web Store / Edge Add-ons 正式分发仍是发布门禁。
## 2026-08-17 · S13 npm 与 Cloudflare R2 不可变发布

- `@e-mate/dsh@2.0.7` 已从同一 GitHub candidate 发布到 npm，npm 回读 integrity 与三条注册表干净安装（darwin-arm64、darwin-x64、win32-x64）通过。随后复核确认 `emate-desktop-downloads` 账户没有可绑定的 Cloudflare Zone 或自定义域，`dl.ecoremedia.net` 实际仍由旧 Tengine/CDN 返回且不是该 R2 bucket 的公共域；继续把它作为 `EMATE_R2_PUBLIC_ORIGIN` 会让真实 R2 对象公共探针必然失败。
- 发布门禁改为固定该 bucket 已启用且经 Cloudflare API 核验的 `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev`，仍拒绝任意其他 `r2.dev`、旧 `dl` 域和 S3 API 域。已验收的 2.0.7 npm tarball、五份证据及 admission receipt 均发布到 `npm/v2.0.7/`，逐对象通过认证 size/content metadata/SHA-256、公共 HEAD 与首尾 Range 字节对比；旧下载 URL 只作为入口页，不承载包字节。

## 2026-08-17 · S07 Usage 用户事件下钻与自定义时间范围

- Usage 面板复用现有 `/v1/usage/*`、`/v1/tasks/summary` 与管理员用户列表，新增最长 366 天、不得晚于当前时间的自定义起止时间和用户筛选；没有新增统计 Store、分页推算或伪事件。预设范围、刷新、调用明细与选中用户继续共享同一 `from/to/userId` 账本范围。
- Usage SQL 已有的 `tenant/time/user/model` 聚合保持不变；任务账本的 `summary` 增加可选 `userId`，在权威 `e_mate_task_fact` cohort 入口过滤后再按事件类型、场景、状态和用户汇总。页面为选中用户显示原合同 `RECEIVED/COMPLETED/...`、请求 `ACCOUNTED/REJECTED/PENDING/USAGE` 代码与次数，并列出全部真实模型调用次数；`gpt-image-2-pro` 因而直接显示为该用户的生图模型调用次数，不依赖工具名判断。
- 明暗主题继续复用 e-Mate Token；筛选条在小屏改为单列、输入和选择器限制为容器宽度。Usage 14/14、Analytics 33 pass / 6 环境 skip、两项 TypeScript check、Usage Vite 生产构建、Analytics build 与 diff check 通过。真实生产部署、管理员登录后的自定义范围/逐用户/图片调用和任务事件账本核对仍须主代理完成，且当前生产任务事件源若仍为 `NO_DATA` 必须原样显示“未接入”，不能用模型调用代替。

## 2026-08-17 · S07 管理端双域名登录修复

- 生产实测确认管理员凭据有效：`mvdcm` 管理端可正常登录，而 `dl` 管理端在 Auth Gateway 已返回 HTTP 200 后仍显示“账号或密码错误”。根因是登录回执中的 Model Gateway 规范地址固定为 `mvdcm`，管理端随后用通用同源校验拒绝了 `dl` 页面收到的同一回执，错误被登录页统一映射为凭据失败。
- 管理端继续只向当前页面同源的 `/e-mate/model-api/` 发请求；登录回执中的地址必须是 HTTPS、无用户信息/查询/片段且路径精确为 `/e-mate/model-api`，才允许把这个固定路径投影到当前 `mvdcm` 或 `dl` 域名。任意其他路径、HTTP 或带凭据 URL 仍失败关闭；没有放宽 Auth/Admin/Usage 的既有同源合同。
- `@e-mate/enterprise-admin` 17/17 测试、TypeScript check、生产构建和 diff check 通过。生产部署后须用同一桌面凭据分别在 `mvdcm`、`dl` 登录，进入模型状态页后退出，并确认 Auth 会话已撤销。

## 2026-08-17 · S13 2.0.7 npm 下载入口

- 实时只读追踪确认 `https://dl.ecoremedia.net/e-mate/update/` 依次跳转到 `https://mvdcm.ecoremedia.net/e-mate/` 与 `/ecorex-agent/`；生产页面由 `/srv/ecorex-agent-download/current` 的原子相对软链提供。当前槽位仍是 `site-emate-2.0.4-r2-9d7351b3`，包含旧桌面安装包和未签名安装说明，必须覆盖为 npm-only 页面；既有槽位保留作为回退，不删除旧程序或数据。
- 新下载页复用现有 e-Mate Logo、橙色 Token、明暗模式、圆角卡片和响应式断点，不增加前端依赖。macOS Apple Silicon、macOS Intel、Windows 10/11 x64 分端展示同一真实发布包 `@e-mate/dsh@2.0.7` 的首次安装与覆盖更新命令；Node 合同固定为 `^22.19.0 || >=24.0.0`，推荐 Node 24 LTS。`setup` 创建覆盖式桌面快捷方式，页面明确它只是本地 Web 的启动入口。
- 日常安装只走 npm；R2 区域只链接已准入的 `npm/v2.0.7/` tarball、SHA256、manifest、SBOM、许可证、证据校验和 admission receipt。页面不提供旧 Feed、应用安装包、签名或第二下载源；三端验证只引用 Release run `31989572790` 的真实 clean-install job，Windows 不伪造成当前 macOS 本机验证。
- 随后从 npm registry 在独立 `DSH_HOME` 和全局前缀执行真实 macOS arm64 安装。npm 安装、重复 `setup` 与 `setup --check` 均成功，但 `launch` 后 Host 退出：其一，内置 e-Mate bundle patch 仍用 Loader 无法从安装目录解析的裸包名；其二，Ubuntu 生成的统一 tarball 未携带 pinned Harness 的 macOS `sharp` 与 `koffi` 原生闭包。第一项已最小改为 setup 落盘 profile 内的相对入口，并把 `launch → health → status → stop` 加入三平台 release clean-install 门禁；第二项必须以目标 Harness 原生三平台制品闭包修复，不能禁用 attachment/sandbox、使用系统依赖或伪造健康。因此当前下载页生产切换保持阻塞，已发布 2.0.7 npm/R2 字节不覆盖、不重发。
- 修复后的源码在 macOS arm64 独立目录真实执行 `setup → launch → 1 秒稳定 health → status → stop` 已通过；Loader 路径按各 bundle 自己的 `package.json#main` 生成，兼容 `.js` 与 `.mjs`，空 patch 仍保持为空。`launch` 同时要求间隔后的第二次健康回读，避免 Host 在插件树加载失败前短暂暴露 health 造成假成功。
- 已发布 npm `@e-mate/dsh@2.0.7` 的 `setup` 没有补丁下载器，也不认识外置平台补充包；新建 R2 对象无法改变已安装 CLI 的代码或依赖闭包。保持单命令 npm 安装合同的最小合法载体因此是新的 npm semver，并由同一不可变候选在 macOS arm64、macOS x64、Windows x64 全部通过新增启动门禁后再切下载页。此切片不重发 2.0.7、不覆盖 `npm/v2.0.7/`，也不把源码通过表述成 npm 2.0.7 已修复。

## 2026-08-17 · S13 2.0.7 R2 安装载体裁决

- 发布载体最终保持包 identity `@e-mate/dsh@2.0.7` 与产品版本 2.0.7，不重发或覆盖 npm registry 已存在字节，也不伪升产品版本。新的已验收 tarball 与证据只允许写入按 release source commit 隔离的 `npm/candidates/v2.0.7/<40-char-sha>/` R2 不可变前缀；旧 `npm/v2.0.7/` 对象保持原样。
- 下载页是 release artifact 模板，CI 用同一 evidence source commit 渲染三端 `npm install -g <immutable-r2-tarball-url>` 命令与全部证据链接；模板占位符不得直接部署。日常仍由 npm CLI 安装，但 registry 2.0.7 不再作为安装、更新或回滚字节源。
- 原在线更新 helper 保持单一路径、活动任务拒绝、数据快照、锁、收据和失败回滚；来源从 `npm view/install @version` 改为精确 R2 release manifest。Host 只接受固定 R2 HTTPS origin、无凭据/重定向/查询的 commit-scoped URL，校验 manifest 与 tarball 内的 name/version、size、SHA-256、SHA-512/SRI 后才进入 npm stage/install。
- 更新事务在变更前把当前 release manifest 指向的精确旧 tarball 校验并缓存到本次 update snapshot；回滚只安装该缓存字节并恢复数据快照，不查询或回落已知损坏的 registry 2.0.7。完成/失败收据保留新旧 source URL 与 SRI，R2 只在 accepted commit 的手动发布流程中写新 key。
- 前一候选 head `c63c77c8ac0dc5a61409c11148d0dff449bc6813` 的 Release run `31993617705` 已完成 darwin-arm64、darwin-x64、win32-x64 的 `setup → launch → health → status → stop`；本次 R2 updater 变更必须重新通过相同门禁后才可上传、合并或切生产页。
- PR 首轮 Release run `31992565126` 的 darwin-arm64 job `95279702774` 在新增启动门禁失败；候选 tarball 回读确认三项 `.mjs` bundle main 已存在并由 setup 正确落盘，但 runtime 只包含 Linux x64 的 `sharp`、`libvips` 与 `koffi`。Harness 原生 `pnpm deploy` 现显式声明目标 `darwin/win32 × arm64/x64`，继续由同一 deploy/pack 结构组装，不引入下载器或兼容层；release 校验同时要求三端 `sharp/libvips`、`koffi`、ripgrep、node-addon-require-builtin 与 node-pty 的固定原生文件，缺任一项即禁止候选进入 clean-install。

## 2026-08-17 · S02 分享弹层承接会话归档

- 聊天页不再并列显示独立 `Session log` 下载按钮。e-Mate 的静态 profile 插件不是 cordis-client-runner 的动态 facade，必须用目标 list slot 的同 `id` 和显式 `priority: -1` shadowing 原生 `priority: 0` 条目；同时直接注入 pinned `@deepseek-ai/dsh-session-log-export` 的既有 Controller，没有新增 fetch、Store、Router、WebSocket 或第二下载协议。
- “分享任务”弹层现提供真实“下载 ZIP”操作，继续走目标 Controller 的同源 `HEAD /api/session.export` 预检、浏览器原生下载、同 Session 并发折叠和 `/export` 命令状态；准备中、成功和失败均在同一弹层投影。关闭弹层继续调用目标 dismiss，且不会取消正在进行的预检。
- `emate.share` 的唯一可验证合同仍是 loopback `status` 返回 `public-share-provider-not-configured`。弹层明确展示“分享服务不可用”，不创建、复制或撤销不存在的公开 URL；本地归档与公开分享边界保持分离。
- Shell 聚焦回归 3/3、完整 Shell 回归 35/35、目标 Session Export Controller/Client apply 10/10 和 Shell bundle 均通过。受管 profile 聚焦检查被同工作树另一切片的用户消息 CSS 正则失配提前阻断，与本切片无关；待该并发切片收敛后由主代理重跑。
- 最终 rc.6 桌面复验进一步发现仅有 package `dsh.client.inject` 依赖不够：它只保证 Session Export bundle 进入 client graph；e-Mate bundle 导出的 Cordis 服务级 `inject` 未声明 `sessionLogDownload`，因此 `priority: -1` 条目先胜出后在渲染 inject face 读取 `undefined.store`，被目标 ErrorBoundary abdicate，原生 `Session log` 随即接管。现已在同一静态 shell 插件声明该服务依赖；组合回归通过真实插件 Context 启动目标 Session Export 和分享注册、执行最终 winner inject face，并核对其直接绑定目标 Controller store/download。
- 修复后 Shell 41/41、目标 Session Export 10/10、Shell bundle 与桌面 rc.6 `verify-profile-boot.mjs` 全部通过；最终桌面 AX 仍由主代理在重装新 bundle 后复验。

## 2026-08-17 · S02/S07 Token 紧凑显示与桌面插件启动图闭环

- 用户端、管理端和 Usage 面板的 Token 数量统一按同一显示规则缩写：`0–999` 保留整数，`1000` 起用 `K`，`1,000,000` 起用 `M`，非整单位保留一位小数；任务数、事件数、金额和精确账本字段不改写。三端窄测覆盖 `999 / 1K / 1.3K / 1M`，管理端 18/18、Usage 15/15、Shell 36/36、TypeScript 与两项 Vite 构建通过。
- 桌面实测发现四个 e-Mate 双端插件的 Host 已启动，但 profile 安装器把 Loader 行改成相对文件路径，目标 `ClientModuleRegistry` 因而无法按 package manifest 发现其 `dsh.client`；文件导入、Better Sidebar、Browser Panel 与 GenUI 均未进入 Web boot graph。修复只让声明 `dsh.client.platform=web` 的插件保留 package name，server-only bundle 继续使用现有相对入口；未改 Harness Loader、ClientModuleRegistry 或通信层。
- `verify-profile-boot.mjs` 过去没有先安装完整 e-Mate profile，只验证了基础 Web 层。门禁现先执行受管 profile 安装，再硬性要求上述四包及 `dsh-at-file / dsh-file-viewer / dsh-turn-fold / dsh-visualize` 全部出现在真实 `window.__DSH_BOOT__`。Profile/Package 15/15、Loader boot 和完整 profile boot 通过。
- 新打包的未签名 macOS arm64 2.0.7 使用全新 `DSH_HOME` 启动并以验收账号真实登录；健康响应为 `e-Mate/2.0.7/e-mate`，默认模型为 `gpt-5.6-luna · Max`。原生选择 README 后界面显示“已就绪”，草稿只保存 `.e-mate/imports/README.md`，工作区文件权限为 `0600`；Finder 复制粘贴同一文件生成 `README-2.md`，没有覆盖。无工作区的旧迁移会话按合同显示导入失败，不把主机绝对路径写入会话。
- 分享入口的真实桌面复验只显示“分享当前任务”，弹层复用目标 Session Export 提供“下载 ZIP”；公开分享服务未配置时明确失败关闭。点击弹层外空白区域可关闭二级窗口。当前本机只运行该 2.0.7 测试包，未发现其他 e-Mate `.app`。

## 2026-08-17 · S10 轻量 Office 执行闭包

- Office 能力从 rc.5 的失败关闭收据升级为 rc.6 原生 `Tool + Job + Skill` 插件：`office_write` 与 `office_read` 在当前工作区创建、读取并以规范化内容重新生成 DOCX、XLSX、PPTX、PDF；输出固定进入 `.e-mate/office/`，不覆盖源文件，路径越界、符号链接、超限文件和不支持的无损版式编辑继续失败关闭。
- 运行闭包为纯 JavaScript，不要求 Python、LibreOffice、Microsoft Office、本地编译或安装后下载。XLSX 直接使用 JSZip/XML 写入最小 OOXML，删除 ExcelJS 及其缺少许可证文本的旧传递依赖；PDF 使用随包 OFL 中文字体，精确版本和许可证记录随插件交付。最终 bundle 为 3.89 MB，npm tarball 约 5.7 MB。
- 四格式写入后均由同一插件重新读取成功；`file`、ZIP 完整性和 `pdfinfo` 通过，macOS Quick Look 为四个产物均生成真实缩略图。插件 4/4、桌面 profile/package 16/16、rc.6 完整 profile boot 与 583 个生产包许可证门禁通过；该证据关闭执行闭包和本机格式可打开性，不替代 Windows 实机及复杂第三方版式验收。

## 2026-08-17 · S13 rc.6 桌面封装、原生 CI 与更新完整性

- 桌面封装继续复用 `anywhere-labs/deepseek-harness-desktop` 的 Electron/Cordis 结构、Node 22.23.2、Corepack/Yarn 和原生 macOS/Windows 构建方式；CI 新增 Windows x64 未签名 NSIS 与 macOS universal 未签名 DMG 两条真实 runner，并只消费 source job 构建的同一 e-Mate profile。用户安装包不依赖系统 Node、pnpm 或另装 DSH。
- macOS universal 首轮真实打包依次暴露并关闭三个产品门禁：完整 profile loader smoke 缺 `workspaceRegistry` mock；双架构闭包的 Python runtime 未列入 `x64ArchFiles`；首次 universal 冷启动的真实 node-pty 探针超过 10 秒。最终所有单架构切片仍做完整静态闭包校验，live PTY 只在最终 universal app 运行且保留 60 秒上限。未签名 DMG `e-Mate-2.0.7-mac-universal.dmg` 已通过挂载、Info.plist、双架构和运行时探针；首份校验制品为 350,924,326 字节、SHA-256 `934d0604ac00217f867176ce126b331002d24818e993ac32d2ac313762ede30c`，后续更新完整性修改必须重打，不复用该摘要发布。
- Windows `package.json` 已生成 `e-Mate-2.0.7-win-x64-Setup.exe`，旧验证器仍查找 `DSH-Desktop-*`。验证器和回归现统一为品牌文件名；最终 Windows 关闭只能由新增原生 runner 的实际 NSIS/PE 校验给出，macOS 本机不冒充通过。
- 更新检查改用 R2 `desktop/latest.json`，较新版本必须同时提供平台制品的 commit-scoped HTTPS URL、精确字节数与小写 SHA-256；下载过程不跟随重定向并流式核对大小和摘要，再执行 DMG/PE 格式检查和原子落盘。R2 artifact 放在 `desktop/releases/v2.0.7/<40-char-source-commit>/`，`latest.json` 只能在两端原生门禁和公共回读完成后最后切换；不存在版本/平台制品、摘要漂移或 URL 越界均失败关闭。
- 安装态 Computer Use 使用 `/Applications/e-Mate.app` 唯一 2.0.7：默认暗色，Luna/Max、新会话中文与右侧栏默认折叠均符合合同。验收账号真实登录后发送固定短回复，首 token 2.5 秒、总 LLM 约 2.8 秒、50 tok/s；这是当前 macOS/Luna 单样本，不替代 30 组性能配对或 Windows 验收。完整桌面门禁为 39 个文件、320 pass / 2 skip；更新、发布清单、运行时和 Windows 品牌聚焦门禁为 151/151。

## 2026-08-18 · S10 已发布桌面 Office 四格式真实回归

- 使用 `/Applications/e-Mate.app` 的已发布 2.0.7、生产验收账号、默认 `gpt-5.6-luna · Max` 和通用工作区发起一次自然语言 Office 请求。Agent 经同一 rc.6 Tool/Job/Skill 链写入并重新读取 DOCX、XLSX、PPTX、PDF，八个 `emate-office` 后台 Job 均为真实完成态；最终消息只投影四个真实相对路径、字节数和可点击产物按钮。
- 落盘文件为 `.e-mate/office/office-acceptance.{docx,xlsx,pptx,pdf}`，字节数依次为 `8660 / 2110 / 45930 / 13904`。主机复核确认 DOCX/XLSX/PPTX ZIP 完整性无错误，Spotlight 类型分别为 Word、Excel、PowerPoint 与 PDF；该证据关闭当前 macOS 已发布制品的四格式创建、读取和终态产物展示，不替代 Windows 实机或复杂第三方版式保真。
- 同一已发布桌面制品使用原生本地图片选择器上传 `e-mate-ocr-acceptance.png`，草稿区立即显示真实缩略图；Luna 从图片精确还原其中唯一可见中文行。该项只证明当前企业 Luna 路由的原生图片理解/OCR 可用；桌面 profile 仍未安装会默认调用第三方 Anionex 服务并在首次运行下载 Python 的 `dsh-vision-toolkit`，不得把本次证据写成该插件已经通过或恢复旧 RapidOCR 闭包。
- 自然语言外部连接逐项通过现有 `e_mate_connection_setup` Tool：飞书进入 App ID/App Secret 配置页，腾讯文档进入 OAuth Token 配置页，微信进入二维码授权页并生成一次性二维码。主代理未输入任何凭据、未扫码或确认授权，并在取证后取消临时二维码会话；因此该项只关闭三类连接的 Agent 可发现性和“走到授权步骤”，不替代真实授权、读取或可逆写入验收。
- 同一制品真实调用 `gpt-image-2-pro` 生成一张图片，`emate-image` Job 为 `1 image / 0 failures / 28.9s`，整轮 54 秒，终态使用目标 ImageGallery/CAS。实测同时暴露图片默认折叠为“已查看 1 张图像”；源码最小修复仅把既有助手图片和工具图片披露层的初始状态改为展开，保留用户手动折叠、目标 Gallery/Lightbox、事件和 Tool/Job 链。Shell 8 文件 40 项回归与 bundle 构建通过；该展示修复仍需重新打包发布后做安装态复验。

## 2026-08-18 · S07/S13 当前发布与生产账本回读

- 当前仓库 HEAD 为 `fc1828941b9d49d12dd32fadbab6b67e52599ca4`，开放 PR 为 0。Desktop Release run `32070025595` 为成功，原生 macOS universal 与 Windows x64 两个构建 job、清单绑定和 R2 激活均通过；公开 `desktop/latest.json` 与下载页已指向 e-Mate 2.0.7。macOS `/Applications/e-Mate.app` 已按该发布制品完成登录、Luna、单次生图、终态图片画廊和同版本自然语言更新回读。
- 使用生产管理员只在内存中登录并在查询后撤销验收会话，回读 `2026-08-15T22:49:10Z` 至 `2026-08-17T22:48:10Z` 的权威 Usage/Task 账本。全租户 `216` 个模型任务中 `214` 个已入账、`2` 个 pending；四项 reconciliation 均为 `0`。当前验收账号对应用户的 Luna 与 `gpt-image-2-pro` 分组均为 `pendingRequests=0`，其中当前日期 Image Pro 为 `2/2 accounted`。
- 同一用户的任务账本为 `49 RECEIVED / 47 FIRST_RESPONSE / 40 COMPLETED / 2 FAILED / 4 CANCELLED / 128 TOOL_EXECUTION`，合计 `270` 个真实事件，来源状态为 `AUTHORITATIVE`。查询未读取 prompt、回答、附件或凭据值；管理员 refresh session 已在查询结束时通过现有 logout 合同撤销。
- 当前剩余 P0 不是账本或 macOS 发布：已发布 App 面向用户正在使用的 Chrome 真实调用 `dsh-browser` 仍返回“浏览器扩展桥接未连接”，而本机 Chrome 进程未加载 `$DSH_HOME/browser-extension`；Windows `win-codex` 当前主机名不可解析，故 Windows 安装、Edge、DPAPI、Office、更新和完整 CU 都不能标记通过。上述两项继续失败关闭，不用隔离开发者模式或 CI 构建代替。

## 2026-08-18 · 2.0.8 S09 Skill Hub 认证请求边界

- 活动切片：保持 2.0.7 已发布制品冻结，仅在最新 `main` 的 2.0.8 分支修复 Skill Hub 固定产品端点的认证请求。
- 已验证根因：`createSkillHubClient()` 复用现有 `emateIdentity.request` 和固定 `https://dl.ecoremedia.net/ecorex-agent/client/skill-hub/v1` 端点；`authenticatedRequest()` 只允许 Model Gateway root 且全局禁止 query，因而真实 `/skills?query=...&limit=24` 在发出前失败关闭。
- 边界：只扩展 identity provider 的精确 HTTPS origin/pathname subtree 允许集；不改 Skill Hub client、Agent Tool、Harness 核心、会话或传输模型。
- 真实 Agent Tool 首轮已经越过本机目标门禁并发出请求，但生产端返回 `Control Plane authentication failed`；保留的 Control Plane/设备传输合同确认 Skill Hub 使用企业 access token，Model Gateway 才使用 model session token。共享 provider 因此按已验证的目标类型选择现有 Bearer，不新增身份、请求客户端或回退链。

## 2026-08-18 · 2.0.8 S07 企业模型策略闲置恢复

- 活动切片：修复 e-Mate 闲置超过短期 JWT 后模型策略掉线、已登录用户无法从现有模型请求恢复的根因；保持 identity → model policy → target session/catalog 单链路。
- 已验证事实：生产合同的 access JWT 为 15 分钟、model JWT 为 10 分钟，refresh lease 为 30 天；当前 identity provider 却在 access JWT 到期时直接清除持久 refresh token，同时 model policy 的同步热路径在 cache 失效后只拒绝而不触发已有 `refresh()`。
- 边界：只复用 Auth Gateway 已有 refresh token 轮换和 model-policy 已有强制刷新；不改 Harness core，不新增定时器、会话、策略存储或传输协议。
- 实现只调整现有共享路径：持久会话加载后由 `active()` 在 access JWT 过期时强制轮换 refresh token，轮换被企业端拒绝则继续清除本地会话；`assertModel()` 与 `auditContext()` 仅在账户绑定的 cache 缺失或过期时等待同一 `refresh({ force: true })`，刷新失败仍拒绝模型请求。
- 窄回归先在旧实现稳定复现 `e-Mate login is required` 和 `model policy cache is unavailable or expired`；重建 profile 后两项通过。组合命令 `/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test test/e-mate.test.mjs` 为 `41/41` 通过，`git diff --check` 通过；已发布 2.0.7 制品和生产未修改。
- 剩余门禁：主代理须重建 2.0.8 Desktop profile，用现有验收账号完成跨过短期 JWT 的真实 Agent 模型请求与 Computer Use 复验；本切片不替代安装态验收或发布。

## 2026-08-18 · 2.0.8 S11 飞书 / 腾讯文档官方授权

- 根因不是第三方平台没有官方授权，而是原外部连接目录只提供 App ID/Secret 或手填 OAuth Token，Host 没有官方 OAuth 生命周期；同时 Agent 被正确禁止使用 `browser_*`，所以用户只能落到手填或浏览器桥。修复继续复用既有 `emate-connections` 插件、`/emate.connections` loopback RPC、DSH `webServer` 与 OS 凭据库，没有新增 Router、Store、会话、传输或 Harness core 改动。
- 飞书按官方 CLI 合同使用 Device Authorization Grant：Host 用已保存的 `cli_*` App ID/Secret 请求一次性链接、用户码和二维码，按 `authorization_pending / slow_down` 轮询；access/refresh token 只进入 Keychain/CurrentUser DPAPI，浏览器端从不读取 Bearer。当前没有可用飞书应用凭据，因此只关闭代码与模拟官方响应门禁，不伪称真实飞书租户授权通过。
- 腾讯文档的生产 discovery 虽声明 Device Grant，但真实 DCR public client 调用 device endpoint 返回 `invalid client for device auth`；继续硬套设备流会给用户生成不可用链接。最终改用同一生产 metadata 声明的 Authorization Code + S256 PKCE，动态注册 native public client，回调精确绑定 DSH 原生 `http://127.0.0.1:<port>/emate.oauth.tencent-docs/callback`；不新建回调服务器，也不使用 Agent 浏览器 Tool/桥。
- Host 严格固定腾讯 `docs.qq.com` issuer、authorization/token/registration/resource endpoint 和 scope，校验 loopback Host、GET、state、单值 callback 参数与 PKCE；一次性 state/verifier、授权码、链接、二维码在终态清除，access/refresh token 只进 OS 凭据库。UI 只展示 Host 白名单后的官方 HTTPS 链接和二维码。
- DSH build 通过；外部连接与 OAuth 聚焦回归 `2/2`、完整 e-Mate profile `42/42`、Shell `8 files / 41 tests`、`git diff --check` 通过。主代理重建 2.0.8 Desktop 后用 Computer Use 从“外部连接”生成真实腾讯官方二维码和 `https://docs.qq.com/scenario/open-claw.html` 链接，链接携带 `authorization_code + S256 + 127.0.0.1` 回调；随后取消 attempt，未替用户登录、同意授权或保存腾讯 access token。
- 同一重建桌面还完成闲置恢复终验：15 分钟 access JWT 过期后的持久 Session 重启直接回到工作区，Luna Agent 请求成功且刷新后的 access/model 到期时间均前移；不再要求用户重新登录或手动恢复模型策略。该证据关闭前一 S07 的真实 Desktop 门禁，不替代发布安装态和跨平台验收。

## 2026-08-18 · 2.0.8 S09 Skill Hub 生产认证闭环

- Control Plane 的 Skill Hub 认证补丁基于当前生产精确父提交 `35dfba71431cae43fd7cd169d048e89b9d045ba1` 构建为 `bb60c20fec6b97ed0a497a5d688cdaaee9c90866`，只为 Skill Hub router 增加现有 e-Mate access-session JWT 验证；Admin、设备、发布和 Model Gateway 身份边界不变。生产候选 `e-mate-cloud-2.0.5-skillhub-bb60c20` 的 artifact manifest SHA-256 为 `024c654b2fe1f0234ec36b1a4b4a5678ccd3e847ffed18bc52be25eb36445640`，继续使用当前云包的 operator-waived unsigned 合同，不改写任何 2.0.7 桌面制品。
- 首次 apply 在切槽前以 `nginx_admin_route_wiring_invalid` 失败关闭；活动 release、green 槽和四个服务均未切换。只读定位到两份受管 route 模板与当前/候选制品字节完全一致，但 `active-admin-route.conf` 被历史操作写成普通文件。将其原子恢复为只指向现有 `admin-route-control-plane.conf` 的符号链接后，`nginx -t`、reload 和部署 dry-run 均通过；新的独立部署单元成功切到 blue，四个 blue readiness endpoint 为 200，green 四服务已停，活动 manifest 与候选精确一致。
- 切槽后的首轮真实 Agent Tool 仍返回 Control Plane 身份验证失败。根因是代码中的 Skill Hub authenticator 已部署，但生产 Control Plane 环境尚未注入 issuer、audience 和 session 公钥 keyring，因此运行时按合同保持禁用。修复只复用当前 Auth Gateway 正在签名且 Model Gateway 正在验证的同一 `session-2026` Ed25519 公钥；私钥、access token、refresh token 和验收账号密码均未复制到 Control Plane。配置原子写入，重启健康失败会恢复原文件；实际重启后 blue readiness 为 200。
- 主代理随后在同一重建 2.0.8 Desktop、同一已登录验收用户和 Luna/Max 下再次发起自然语言请求。展开的真实 Harness 步骤显示 `Tool call e_mate_skill_hub_search · pdf`，详情为 `IN {"query":"pdf"} OUT []`；空数组是当前生产目录的真实搜索结果，不再出现本机目标越界或 Control Plane 鉴权错误。该证据关闭 Skill Hub 搜索的真实 Agent CU 门禁；跨用户发布、下载、安装和最终安装态回归仍由 2.0.8 发布流水线单独关闭。

## 2026-08-18 · S07 管理端用户审批筛选

- 企业管理端复用现有用户列表、`updateTenantUser`、批量审批与模型策略弹层，新增“全部状态 / 有效 / 待审批”筛选；没有新增管理 API、身份、Store 或第二套审批协议。
- “全选待审批并配置模型”只取当前筛选结果中的待审批用户并打开原策略弹层，预选全部已发布且启用的模型；弹层另提供“全选可用模型”，最终仍须管理员确认额度和模型后提交。
- 管理端 19/19 测试、TypeScript 与 Vite 生产构建通过。生产主备域名均回读同一 `index-QtMqsyCQ.js`；真实管理员会话验证了状态选项、有效用户筛选和五个可用模型的清空/全选交互，未提交任何生产用户变更，验收后已退出。

## 2026-08-18 · 2.0.8 S13 下载页静态缓存身份

- 用户在正式下载页复现“正在读取最新版本 / 下载信息暂不可用”。实时回读确认 R2 `desktop/latest.json` 为已发布 2.0.8，且对 `https://dl.ecoremedia.net` 返回正确 CORS；生产 `/srv/ecorex-agent-download/current` 仍指向 `site-emate-2.0.7-92c3fd3`，线上脚本因此按 2.0.7 身份拒绝 2.0.8 清单。
- 同一脚本 URL 使用一年 `immutable` 缓存，但仓库中的 2.0.8 脚本内容 SHA-256 已从文件名声明的 `527be2232a46` 变为 `a8c4f1979f7c`。直接覆盖旧 URL 会让已访问用户继续命中 2.0.7 字节；最小修复只为现有 2.0.8 脚本换用真实内容哈希文件名，并在发布测试锁定“文件名摘要前缀等于文件内容”，不放宽 manifest、R2 origin、版本、来源提交、大小或 SHA-256 校验。
- 下载页聚焦回归 `1/1`、完整 release contract `9/9` 与 `git diff --check` 通过；生产切槽继续要求新旧槽位并存、原子替换 `current`，并在公开页面真实渲染 2.0.8 下载按钮后才关闭。

## 2026-08-18 · 2.0.8 S10 本地图片附件身份透传

- 原生本地文件选择器已正确把 PNG/JPG 交给 pinned Harness 的 InputBar，Host 也已把图片保存为带 `sha256:` identity 的真实 `ImageAttachmentRef`；问题不在上传。目标 LLM adapter 只把图片字节和 MIME 暴露给模型，不暴露附件 identity，而既有 `imagegen` Tool 为避免读取会话外图片又只接受精确 `image_url`，因此 Agent 能看见图片却无法调用改图 Tool，错误要求用户重新上传。
- 修复只在既有 `emate-image-generation` 插件复用目标 `agent/pre-step` waterfall 和 `createUserMessage`：当本步存在真实 `source.kind=user` 图片时，追加一条 durably logged 的 plugin catalog 消息，把附件顺序和精确 `image_url` 提供给模型；文本请求保持原样，重复 identity 去重，Tool 的 session ownership 校验不变。未改文件选择器、Harness core、LLM adapter、附件 schema、会话或传输协议。
- 图片生成窄回归 `1/1`、完整 e-Mate profile `42/42`、文件导入合同 `5/5`、target pin 检查、profile build 与 `git diff --check` 通过。此切片未提交、发布、改版本或覆盖任何 2.0.8 制品；剩余门禁是主代理重建 Desktop profile 后通过真实本地文件选择器上传 PNG/JPG，确认自然语言改图调用 `imagegen` 的同一 `sha256:` identity 并完成 Job/Gallery，而不再出现重新上传提示。

## 2026-08-18 · 2.0.8 S13 下载页静态缓存身份

- 用户在正式下载页复现“正在读取最新版本 / 下载信息暂不可用”。实时回读确认 R2 `desktop/latest.json` 为已发布 2.0.8，且对 `https://dl.ecoremedia.net` 返回正确 CORS；生产 `/srv/ecorex-agent-download/current` 仍指向 `site-emate-2.0.7-92c3fd3`，线上脚本因此按 2.0.7 身份拒绝 2.0.8 清单。
- 同一脚本 URL 使用一年 `immutable` 缓存，但仓库中的 2.0.8 脚本内容 SHA-256 已从文件名声明的 `527be2232a46` 变为 `a8c4f1979f7c`。直接覆盖旧 URL 会让已访问用户继续命中 2.0.7 字节；最小修复只为现有 2.0.8 脚本换用真实内容哈希文件名，并在发布测试锁定“文件名摘要前缀等于文件内容”，不放宽 manifest、R2 origin、版本、来源提交、大小或 SHA-256 校验。
- 下载页聚焦回归 `1/1`、完整 release contract `9/9` 与 `git diff --check` 通过；生产切槽继续要求新旧槽位并存、原子替换 `current`，并在公开页面真实渲染 2.0.8 下载按钮后才关闭。

## 2026-08-18 · 2.0.8 S14 Bash 权限、导航栏与回合 Token 紧凑显示

- 固定 Harness 基线中 `terminal-bash` 的 `CONTROLLED_PROMPT` 是 5 字节 `dsh> `，而 `tool-bash-persistent` 的 `SHELL_PROMPT` 是 31 字节 `__DSH_PERSISTENT_BASH_PROMPT__ `；末尾都含空格但逐字节不一致，生产默认等待因此每条命令误走 3.5 秒超时。下游 Harness 提交 `12d68b6ca05fa538d98f70ed47786c44ca3a7225` 只把前者及锁死旧值的测试改为后者，改后两者均为 31 字节、十六进制 `5f5f4453485f50455253495354454e545f424153485f50524f4d50545f5f20`。
- 同一窄补丁在 Bash/PowerShell Tool 的共享权限入口把“请求与当前 sandbox 相等”及“当前已是 `danger-full-access`”判定为冗余请求，继续使用当前策略且不触发审批；只有严格扩大权限才进入既有审批，缺少 sandbox 组合及非法模式仍失败关闭。该修改直接覆盖截图中的 `danger-full-access → workspace-write/danger-full-access` 反向升级错误，没有新权限模型或第二套执行路径。
- 生产默认持久 Bash 三命令实测：macOS 从 `7244/3573/3547 ms` 降至 `239/78/79 ms`；Linux ARM64 从 `7183/3553/3537 ms` 降至 `229/67/67 ms`。相关 13 个测试文件在 macOS 改前/改后为 `7.85/7.90 s`，均为 248 passed、7 skipped；Linux 为 `9.649/8.356 s`，同样 248 passed、7 skipped。Linux 初次安装的 `node-pty` LTO 环境错误通过仅对该既有原生依赖关闭 LTO 重建后消除，不计入功能结果。
- Desktop 通过现有 ecosystem profile 机制预装固定 `@kelearns/dsh-navigation-bar@0.2.1`，没有修改 Harness 导航架构；既有 `dsh-turn-fold@0.2.2` Yarn patch 仅把折叠回合标题的总 Token 显示改为与 DSH StatsLine 相同的 K/M 阈值和精度，例如 `267382 → 267K token`、`1250000 → 1.3M token`，`tok/s` 与缓存命中率不变。

## 2026-08-18 · 2.0.9 产物本地打开边界

- rc.7 已由原生 `ui-deliverables → conversation openFile → host.openPath → OS 默认应用` 提供产物点击链路；e-Mate 不新增下载、文件服务或第二套打开协议。
- 原生 `host.openPath` 只受 loopback RPC 边界保护，仍会把任意绝对主机路径交给系统。e-Mate profile 增加一个窄包装插件：打开前 `realpath`，仅放行已注册本地 Workspace 自身及其子路径，并把规范化后的本地路径交回原生 opener；相对路径、缺失路径、Workspace 外路径和符号链接越界均失败关闭。
- e-Mate profile `tsdown` 构建通过；新增边界回归 `1/1`、rc.7 原生产物与会话打开回归 `23/23`、聚焦 `git diff --check` 通过。最终安装态点击并由系统默认应用打开真实产物，仍并入 2.0.9 的统一 Computer Use 发布门禁。
- 首轮 Computer Use 点击 ZIP 证明产物没有进入上述 `host.openPath` 边界。`dsh-better-sidebar@0.12.2` 的高优先级 turn-tail entry 是第一处接管：现有 ecosystem Yarn patch 将其侧栏文件接管默认关闭，并让 turn-tail 与共享包装统一遵守同一个用户偏好；用户仍可显式启用侧栏打开。
- 新 DMG 的 QA4 已确认设置中没有 `interceptOpenPath`，且已安装 better-sidebar 客户端默认、selector 与 Host schema 均为 `false`，因此继续迁移设置不会改变行为。第二处实际接管来自 `dsh-file-viewer@0.1.0`：它明确包装所有 `workspaces.openPath`，ZIP 不在其 Office 扩展特例中便进入“工作区文件浏览器”。最小修复只从现有 Yarn patch 移除该共享 router 的注册；插件的会话头手动入口、预览和“在系统应用中打开”保留，聊天产物与文件引用统一退回 rc.7 原生 opener 和 e-Mate Workspace 边界。
- 聚焦 Desktop profile 回归锁定 better-sidebar 默认/退让条件，并锁定发布包不再注册 file-viewer 的共享 file-open router；修复后的安装态验证必须重建 profile/桌面包，旧运行中 bundle 不会热更新，不能复用 QA4 结果。

## 2026-08-18 · 2.0.9 Codex-like 插件发现、MCP 授权与浏览器闭环

- DSH rc.7 已有 `@deepseek-ai/dsh-mcp-client` 的标准 MCP transport、Tool 同步和重连能力，因此不新增 MCP Server、Tool 协议或第二套客户端。e-Mate 只补 profile 插件 `@e-mate/dsh-plugin-mcp-manage`：非密配置进入 DSH Settings，OAuth 凭据进入 DSH Credentials，连接最终仍挂载到原生 MCP client；授权使用受保护资源 discovery、动态客户端注册、Authorization Code + PKCE、固定 loopback callback 和 refresh token 轮换，只有真实 `mcp__<name>__*` Tool 注册后才报告生效。
- 同一管理插件提供一个窄 `dsh_plugin_manage` Agent Tool，委托桌面已经打包的原生 `dsh plugin`/pnpm 服务安装可选插件，不新增 loader。远端来源只接受 `github:owner/repo#<40 位 commit>`，安装前走目标确认，安装后验证依赖和 bundle，失败回滚；受管 profile 修复保留用户安装的第三方依赖和 bundle。四个平台均改为可发现而非内置的 Skill：腾讯文档安装官方远程 MCP 并由用户扫码/OAuth 授权；飞书通过公开 `riba2534/feishu-cli` 的一键扫码创建应用、Device Flow 和按业务域 Skills；钉钉与微信使用精简 fork `zyfjacksonchen-source/dsh-im@f984f73dcd67692141d4e475c8fbe887e2ce7062`，要求真实首条消息/回复后才宣称闭环。
- `find-skill` 的远端 skills.sh 在新 Skill 尚未收录或临时不可用时原本会返回空结果。e-Mate fork `zyfjacksonchen-source/dsh-find-skill@37bba4f7c9115a476d8135f751b4cc6d1454aa23` 只增加 Codex-like 推荐目录：按关键词把四个外部 Skill 的来源元数据置于远端结果之前，安装仍由既有 `skill_install`、用户确认和官方 `skills@1.5.22` CLI 完成，平台实现代码没有回到预装包。fork 回归 `55/55`、类型检查和包装合同通过。
- `dsh-browser` 的断链根因是桌面仍安装旧 `@yuxianglin/dsh-bridge-browser` 及带 side panel 第二套聊天/Session 的扩展，而仓库现成的 `@e-mate/dsh-plugin-browser` 原生 Harness Tool/Session/approval 实现没有接入。Profile 现移除旧 bridge，安装原生插件，并从其精简 MV3 构建复制扩展；Browser Panel 只投影同一连接状态。包级 Browser `5/5`、Panel `5/5`、Desktop profile/electron `25/25`、MCP 管理 `3/3`、DSH profile `49/49` 与 Shell `37/37` 通过；当前 Chrome 未加载 e-Mate 扩展，最终新安装包仍需用户完成一次 Chrome “加载已解压的扩展”授权，再由 Agent 完成 `navigate/snapshot/click/type` 和右侧栏投影的安装态 Computer Use 验收。
- QA7 从真实 2.0.8/QA6 用户 Profile 升级时暴露旧 bridge 被“保留第三方插件”逻辑误留，和新浏览器插件争用 `emateBrowser` 导致启动失败。Desktop 与 CLI Profile 安装器现在只额外识别两个历史 e-Mate-owned 包（旧 `@yuxianglin/dsh-bridge-browser`、旧内置 `@e-mate/dsh-plugin-im`）并清理；真正第三方 bundle 仍保留。聚焦回归 Desktop `3/3`、DSH `49/49`、Shell `37/37` 通过，QA7 Universal DMG 的 140 个发布测试、197 节点运行时闭包和 DMG smoke 通过；安装升级后旧包消失、2.0.9 界面与登录态正常恢复。
- 四个连接 Skill 已单独提交为 `e361b1b8055af2c07ca0f84d65396479eb3a1fe8` 并发布不可变 Git 标签 `skills-v2.0.9`。真实官方 `skills@1.5.22` CLI 从标签 URL 克隆 `connect-feishu-cli` 并完成安装；同时发现 Desktop 只提供现有 `pnpm`，适配器配置却调用未打包的 `npx`。最小修复改为复用 Desktop PATH 中的 `pnpm dlx skills@1.5.22`，受信目录四个来源固定到该标签，不依赖 `main` 漂移；包装合同 `1/1` 通过，仍需重打安装包后由真实 Agent 完成安装确认与扫码前链路。
- QA7 安装态 Computer Use 已验证：搜索框仅一个关闭按钮且无选中描边；外部连接显示为小卡片；`@` 菜单同时提供文件与“电脑操控”，显式电脑操控返回当前前台应用 `e-Mate`；一次性定时任务 1 分钟后在原会话真实返回 `SCHEDULE_OK`；同一图片会话无需重新上传即把 A 改为 B，ZIP 包含两张对应图片，点击产物由 macOS 归档工具按本地路径打开并解压。上述证据不替代四平台扫码、浏览器扩展、Windows 与企业生产门禁。
## 2026-08-18 · S17 紧凑活动与产物展示（实现前事实）

- 图 1 的轮数、步骤、LLM/Tool 耗时、首 token、吞吐、缓存和输入输出 Token 来自 pinned rc.7 的 `conversation.composer.dock` `stats` 插槽，不是 Agent 输出；e-Mate Shell 已有同名插件插槽覆盖能力，可只隐藏普通用户展示而不删除持久用量事实或改变企业审计。
- 图 5 的逐行 Think/Tool 噪音已经由预装 `dsh-turn-fold` 插件接管，但插件只在回合结束后整组折叠，且组头改为性能指标，恰好与本轮需求相反；修复应留在该插件的真实 `turn/step/tool/assistant` 投影，不增加会话、事件或 transport。
- 图 2 的会话菜单漂移根因是 `.taskMenu > div` 使用 `position: fixed` 却没有任何 `top/right/bottom/left` 或锚点，位置依赖静态位置算法而不会可靠跟随滚动锚点。现代 Desktop Chromium 已具备 CSS Anchor Positioning，可让固定层继续逃逸滚动裁剪并绑定现有 summary，较 Portal 坐标状态更小。
- rc.7 原生 `ui-deliverables` 已从真实工具 mutation locations 聚合产物，并通过同一个 `openFile` 打开；本轮只收紧原生行的文件胶囊展示与标题隐私，不能复制 opener、产物 Store 或工具分派。Beautiful UI 的 Thinking/Tool Chips 组件和 SVG 图标按其页面声明的 MIT License（Copyright 2026 Shane Levine）可复用，采用内联小图标与现有依赖，不增加图标包。

## 2026-08-18 · S17 紧凑活动与产物展示（实现结果）

- e-Mate Shell 以同 id、较高优先级 shadow rc.7 的 `stats` dock cell，普通用户不再看到回合、步骤、耗时、首 Token、吞吐、缓存与输入输出 Token；原始 usage/session 事实仍留在 Harness 与企业审计链路。
- 现有 `dsh-turn-fold` Yarn patch 继续只读取 rc.7 `chat.nodes / locations / turnEnds`，把运行中和已结束的 Think、工具调用与上下文统一投影为默认折叠的“X 次工具调用，Y 条消息”；展开恢复原生节点。最终回复、失败工具结果、中断/带图 assistant 节点以及未被插件覆盖的审批、附件、turn-error、retry 仍保持可见，组头不再订阅或展示任何性能指标。
- rc.7 `ProducedFiles` 的真实按钮与 `openFile(path)` 没有替换；Shell 只把按钮投影成文件类型胶囊，保留文件名和外链箭头，并从 title/aria-label 清除本地完整路径。会话菜单使用原 summary 作为 CSS anchor，固定浮层随锚点滚动；不支持 anchor 的 Chromium 走原位 absolute fallback。
- Tool/Think 图标只复用 Beautiful UI MIT 许可的少量 SVG path，未引入依赖；完整版权与 MIT 文本已加入 Desktop `THIRD_PARTY_NOTICES.md`。
- 聚焦验证：Shell `8 files / 38 tests` 通过；独立活动投影 `1 file / 2 tests` 通过；Yarn patch `install --immutable` 通过，安装后的 `dsh-turn-fold/client.js` 通过 `node --check`，聚焦 `git diff --check` 通过。未提交、推送、发布。
- 剩余统一门禁：主流程重建 DMG 后用 Computer Use 验证滚动/缩放时菜单锚定、活动组默认折叠和展开、失败/审批/附件不丢、产物胶囊点击由系统默认应用打开且界面不泄漏本地路径，以及浅/深色下图标可读性。

## 2026-08-18 · 2.0.9 芯助手 CLI 离线运行时闭环

- 芯助手插件已复用 Desktop 现有的应用内 Python 和 DSH `subprocess`，但生产 CLI 的 MPI 路径直接导入 `requests` 与 `cryptography`；两套依赖都未随插件或应用内 Python交付，真实查询因此在授权检查前以 `No module named` 失败。
- 插件现随包携带固定版本的纯 Python HTTP 依赖，以及分别面向 `darwin-arm64`、`darwin-x64`、`win32-x64` 的 RSA 原生 wheel；运行时只通过 `PYTHONPATH` 接入，保持现有结构化只读 Tool、超时、输出上限和应用内 Python 路径，不运行 pip、不访问包仓库、不开放 shell。
- 应用内 arm64/x64 Python 均成功导入 `requests 2.32.5` 与 `cryptography 46.0.7`；真实 MPI 只读命令已越过依赖加载并按合同返回“需要现有 token/refresh token”，证明失败边界回到用户授权而不是缺包。插件 build 与合同回归 `2/2` 通过；Windows wheel 已校验为 PE x86-64，仍须最终 Windows 安装态执行同一导入和授权门禁。

## 2026-08-19 · S17 活动标题中文化与消息尾指标

- 活动折叠标题固定为“X 次工具调用，Y 条消息”，不再向中文用户显示 `tool calls / messages`。
- 只隐藏编辑器底部的回合/步骤/缓存/输入输出统计条；原生消息尾的用时、首 token 和 `tok/s` 继续显示，未删除 Harness usage 事实。

## 2026-08-19 · 2.0.9 dsh-browser 链接点击闭环

- 安装态 Computer Use 已确认精简 MV3 扩展连接到 e-Mate，Agent 的原生 `browser_snapshot` 与 `browser_click` 能读取 Example Domain 并把真实 Chrome 标签跳转到 IANA；但点击 Tool 一直停在运行中。
- 根因在同一扩展的链接点击实现：`el.click()` 触发跨文档导航后仍等待旧页面稳定，旧 content script 与 `tabs.sendMessage` 回包端口先被销毁，导致 Harness 一直等到工具超时。修复复用 `browser_navigate` 的既有模式，先返回 Tool 结果，再于下一事件轮执行真实链接点击；不增加桥接协议、会话或浏览器状态。
- 新增最小回归锁定链接分支必须延后点击且不得在旧文档等待；最终门禁是重建扩展后重复同一自然语言任务，确认点击后能继续快照并生成最终回复。

## 2026-08-19 · 2.0.9 安装态浏览器与企业生产验收

- 重建扩展并重新加载后，安装态 Computer Use 通过同一 Agent 回合完成 `browser_snapshot → browser_click → browser_snapshot`：Chrome 从 Example Domain 跳转到 IANA Example Domains，点击 Tool 正常结束并生成最终回复；消息尾继续显示用时、首 token 与 `tok/s`。浏览器包回归为 `6/6`。
- Usage Dashboard 已把生产静态目录原子切换到新不可变 release；公开脚本 SHA-256 为 `b636db0337d5f22b637242d49b734adf217032f0242e0b708758d61b11562ee6`。修复复用 Auth Gateway 已有 refresh token 轮换：access token 过期时单飞刷新并重试原查询，刷新失败才清除会话；没有新增身份或会话协议。
- Model Gateway 仅重建并替换自身容器，生产镜像 ID 为 `sha256:483a3933f2184c02cd1c967f632f731013b5a63359bfdaa8eedd65500aed24da`，Auth、Analytics、Postgres 与 Redis 未重建。DeepSeek/豆包的 Chat Completions 适配器现在接受管理端既有 `max_output_tokens`，并映射为受路由上限约束的 `max_tokens`，不再在上游请求前被精确字段校验拒绝。
- 用户已确认生产审计面板、DeepSeek 与豆包验收正常，并要求停止重复登录/实测；飞书与腾讯文档沿用此前用户验收，钉钉/微信和 Windows 实机测试按用户要求不进入本次真实测试。Windows 仍保留最终 CI、安装包和清单门禁。

## 2026-08-19 · 2.0.10 飞书反馈、首 token 与 Agent 性能切片

- 本片只处理反馈中的六项闭环：多图改图失败/误生成、并发生图触发限流并中止、生成图片污染后续模型历史导致文本模型无法切换、原图引用丢失、定时任务管理页展示伪动作、分享及首页工具按钮布局；同时优化首 token 与后续 Agent 请求热路径。发布前每项都必须由安装态 Computer Use 复测，任何一项未通过都不发布。
- 架构边界不变：所有修复继续落在 managed profile 插件或浏览器投影；不修改 pinned DeepSeek Harness 核心，不新增聊天、会话、传输、调度器、图片队列或模型路由。定时任务继续以官方 `@deepseek-ai/dsh-schedule` 的 Session 事件为唯一真值，UI 只做只读卡片和原生 Tool 提示词交接。
- 最小根因方案：生成图片改由非模型历史的 `emate/image-output` Session 事件承载，Tool 结果只保留 attachment ID 文本；用户上传图片仍进入模型历史。多张当前附件不再被隐式合并成一次编辑，独立编辑要求每次明确传入一个 ID；引用融合仍允许显式 ID 数组。并发复用 Agent Loop 原生 `maxParallelToolCalls=4`，不重试未知上游失败。
- 性能方案：消除生成图片字节在后续每次 LLM 请求中的重复编码/传输；同一请求在 `agent/request` 已校验并武装额度后，`llm/stream` 只复用完全匹配的武装记录，外部直调仍执行策略校验；策略缓存对象在有效期内复用已验证结果。验收保留原生首 token、总耗时与 `tok/s` 事实，不伪造指标。
- 定时任务选择“独立管理页”方案：列出真实任务卡片的状态、内容、规则、下次时间与所属会话；新增、修改、删除只把精确操作交给对应会话中的原生 `schedule_create/list/delete`，其中修改为先创建替代任务、成功后再删除旧任务。不会声称支持不存在的立即运行、暂停或恢复。
- 在线更新回退的现场核对发现标准 `/Applications` 内同时存在 7 个同 bundle id 的 2.0.9 应用副本，Spotlight 还索引到工作区内两个 2.0.7 构建；当前进程来自规范 `/Applications/e-Mate.app`。2.0.10 因此只在“当前运行的是标准目录中的最新稳定版本、且没有更高版本副本”时，把 `/Applications` 与用户 `Applications` 中同 bundle id 的旧版或同版重复包移入废纸篓；工作区构建、非标准目录、符号链接、身份/版本异常包一律不碰。下载缓存同样只保留本次目标版本，更新状态与用户会话数据不删除。
- 版本真值统一读取 Desktop `package.json`：profile、打包清单、更新清单和 R2 发布工作流不再分别硬编码。发布激活前必须回读线上 `latest.json` 及实际对象，逐项核对版本、文件名、来源提交、字节数与 SHA-256；只有全部一致才最后切换线上清单，避免“更新器显示版本”和实际发布字节不一致。
- `@电脑操控` 继续使用 DSH 原生 composer reference/codec/插入路径；e-Mate Shell 只恢复被全局字体覆盖误伤的 `DshChipCell` 字体，并补齐可见标签中的 `@`。用户选择后现在能在输入框内看到完整 chip，不增加第二套 mention 模型。
- 飞书 CLI 的 `spawn pnpm ENOENT` 来自 Skill 安装器依赖环境 PATH 查找，而 Desktop 已生成了可用的应用内 pnpm shim。Desktop 现把该 shim 的绝对路径显式交给 find-skill 适配器，只有 `pnpm` 安装命令使用它；其他 DSH 子进程路径不变，且拒绝非绝对覆盖值。
- 浏览器扩展仍复用现有 dsh-browser 内置 MV3 制品和 Desktop 安装入口。Agent Tool 只打开 Chrome 扩展页与内置目录，macOS 随后复用原生 Computer Use 完成可自动执行的“开发者模式/加载已解压目录”，并以原生 browser Tool 重试成功作为唯一完成标准；浏览器或系统强制的安全确认不能绕过，Windows 在没有 Computer Use provider 时必须如实提示一次浏览器侧确认。
- macOS Computer Use 首次使用若没有辅助功能权限，Agent 调用 Desktop 安装 Tool：复用 Electron 原生 `isTrustedAccessibilityClient(true)` 登记 e-Mate，并打开 `Privacy_Accessibility` 系统页。系统强制的“添加/开启 e-Mate”仍由用户完成；Agent 随后必须重试原生 Computer Use 并看到权限生效，不能只凭打开设置页报告成功。
- 登录页 `transport failure ... HTTP 500` 的请求字段和 Host RPC 合同均正确；公网解析与用户提供的生产连接资料交叉确认真实源站 `47.103.108.213`，但 22 无 SSH banner、80/443 无应用/TLS 响应、面板专用端口同样连接超时，`dl` CDN 回源为 504，属于实例网络/宿主层失联而非账号错误。仓库没有生产 restart/deploy workflow，本机也没有云厂商 API 凭据，因此未盲目重启。客户端共享身份 provider 现以 15 秒原生 signal 限制请求，把 transport 与上游 5xx 类型化为 service-unavailable；唯一 `/emate.identity` RPC 边界只返回中文可重试提示和脱敏 endpoint/reason/status，401 仍是账号密码错误，未知 4xx 继续失败关闭。生产登录恢复仍要求云控制台先恢复实例并读取 OOM/磁盘/负载、Nginx/Docker 日志；不能把客户端提示修复写成服务已恢复。

## 2026-08-19 · 2.0.10 macOS 正式发布与自动替换事故修复

- 事故根因不是用户打开方式：正式 Desktop workflow 错把明确定义为 CI-only、无完整签名且“never publishes”的 `dist:mac-smoke` 和 `dist/mac-smoke/` 当成正式 DMG 上传。2.0.9 线上 bundle 因此在 `codesign --verify --deep --strict` 下失败；本轮不覆盖任何 2.0.9 历史对象，修复直接并入 SemVer 可发现的 2.0.10。
- 正式无 Developer ID 路径现独立为 `dist:mac-unsigned-release` 与 `dist/mac-unsigned-release/`，强制完整 ad-hoc 封装且明确不是 Developer ID 签名/公证。正式 workflow 与聚焦合同禁止出现 `dist:mac-smoke` 或 `/mac-smoke/`；smoke 只保留在隔离 CI。正式门禁包含 `hdiutil verify`、只读挂载、Info.plist、Universal 主程序及全部原生 inventory、`codesign --verify --deep --strict` 和 `arch -arm64/-x86_64` 真实启动。
- 2.0.10 起 macOS updater 继续复用唯一清单、下载、字节数、SHA-256 与 DMG 校验，再由 staged 新包启动 detached helper。helper 只接受规范 `/Applications/e-Mate.app` 或用户 `Applications` 路径、同卷可写 Trash、严格递增稳定版本及完整 bundle 校验；helper-ready 持久握手成功后应用才退出，Cordis 完整释放写入 shutdown-ready 后才交换。旧包一直保留到新 renderer 健康回执，超时/启动失败会恢复、重启旧包并显示回滚结果；renderer 健康是提交边界，之后的回执或清理失败不得撤掉健康新包。没有静默 `sudo`、全局 Gatekeeper 关闭或第二更新协议。
- 已安装 2.0.9 的首次 2.0.10 升级仍受旧二进制限制，需要其原 DMG 手工交接；从 2.0.10 起后续更新才自动替换。最新图解对此作明确区分，并整合 Apple/Intel 两条仅针对 `/Applications/e-Mate.app` 的 quarantine 命令和密码不回显说明。
- 发布保持 commit-scoped immutable：Windows/macOS 制品与清单先上传并公共回读字节数/SHA-256，只有正式安装态门禁全部通过才最后原子激活 `desktop/latest.json`。未完成真实 Apple/Intel 安装态 Computer Use 前，本节不是发布完成声明。
- 首个正式候选包在安装态暴露 `dsh-computer-use-helper` 被 Electron Builder 二次签名后与原生 manifest SHA-256 不一致。修复位于既有 Computer Use 包适配层：以固定 entitlement 对 helper 做完整 ad-hoc 签名并更新 manifest，正式打包对该已管理文件禁止再签名；验证器直接复算包内 helper 与 manifest，不再允许只靠深度签名掩盖不一致。
- 首轮同提交 GitHub build-only 的 Linux profile 与 carrier job 同时在 Computer Use adapter 报 `/usr/bin/codesign ENOENT`；原因是同步脚本把 macOS helper 的正式签名步骤无条件带到非 mac runner。非 mac 构建现在保留仓库内已签名、已绑定 manifest 的固定 helper，仅同步平台无关 JS/资源并复算哈希；只有 macOS runner 才重新同步原生目录并执行固定 entitlement 的 ad-hoc 签名。正式 mac 门禁不变，失败阶段以新提交重新构建，不复用失败 run。
- 下一轮 carrier 的 macOS arm64/x64 clean install 与发布证据均通过，Windows 在 npm 安装后读取 manifest 时失败：workflow 把 `npm root` 的 Windows 反斜杠路径直接插入 `node -p` JavaScript 字符串，`\n` 被解释成换行而 `MODULE_NOT_FOUND`。版本读取现把 manifest 作为独立 argv 传给 Node，不再由 shell/JavaScript 二次解析路径；合同测试同时禁止旧写法。提交身份变化后两条制品链必须使用新 SHA 重建，不能把已通过的旧提交 Desktop artifact 与新 carrier 拼接发布。
- 与 `anywhere-labs/deepseek-harness-desktop` 的同机对照确认其秒级启动来自单一 Electron/Cordis 进程和就地 package 解析；e-Mate 变慢不是 Harness 架构，而是 Desktop 每次启动重复复制约 158MB 的受管 profile，且旧 Profile 第一次迁移还会在主线程递归删除整棵副本。现在仍走同一 DSH Loader：package 根只复制可补丁元数据，`assets/lib/runtime/node_modules` 等不可变目录在 macOS/Linux 使用符号链接、Windows 使用目录 junction 指向应用内固定来源；版本化回执与窄关键文件检查命中时不安装、不全树哈希、不改 Profile。旧副本迁移改为同卷原子改名，窗口可交互后再异步清理，失败不会覆盖原包。
- 本地 fresh managed-profile 安装为 48.16ms、warm receipt 校验为 5.28ms，完整 headless Host boot 为 2.86s。安装态预发布包在旧 Profile 修复前首轮 Computer Use 为 17.052s；迁移后按“登录页/Harness 可点击控件已进入完整 AX 树”复测三次热启动为 4.480s、4.151s、4.112s，均满足准则的 5s p75/8s max。项目根 `AGENTS.md` 已固定 macOS/Windows 同一原生启动顺序、不得启动期运行 pnpm/DSH 或可选维护、精确制品计时口径与 clean/warm 预算；用户随后明确要求本轮不再以 Computer Use 实测阻塞发布，该一次性决定不修改后续版本的长期准则。
- 侧栏底部复用目标 `sidebar.settings` 与 `sidebar.footer.action` 槽位，将运行状态点、明暗切换与设置恢复到用户区上方并排展示；侧栏收起时在同一容器内纵向排列。设置仍是 DSH 原生 SettingsRoot，主页不再保留一组重复按钮。
- 发布 workflow 改为两步骤但仍只有一份制品：首次 build-only 产生 commit-scoped macOS/Windows artifact，下载该精确字节做安装态验收；通过后的 publish 只允许下载同 commit、同 workflow、已成功的指定 run artifact，不再重建。这保证更新器、R2 对象和 Computer Use 验收对应同一份字节。

## 2026-08-19 · 2.0.10 Rosetta 发布探针回归

- macOS-only 增量 run `32232210491` 复用已通过的 Profile 与 Windows 制品；正式 DMG 的 `hdiutil verify`、Info.plist、Universal 主程序、全部原生 inventory、Computer Use helper manifest 和完整 ad-hoc `codesign --verify --deep --strict` 均通过，arm64 在 10.876 秒到达可交互 shell。唯一失败是 Apple Silicon runner 上的 x86_64/Rosetta 进程在 180 秒内未完成全新 Profile 的完整 Web boot；本机同一候选复现为进程持续存活、stderr 为空、60 秒仍无 renderer 回执。
- 对照 2.0.7/2.0.8 成功链，包体双架构/签名门禁与安装态验收原本分离；把 Rosetta 首次翻译加完整 fresh-profile health 当成 Intel 启动性能，会重复构建同一正式包且不能代表原生 Intel。最终不放宽 180 秒，也不退回 smoke：arm64 仍须到达真实交互 shell；x86_64 继续从复制到临时 `Applications` 的正式包经 `arch -x86_64` 真实启动，但只等待 `app.whenReady()` 后的 Electron 原生就绪回执，并继续受主程序、全部 native inventory 与完整签名门禁约束。原生 Intel 性能只能在 Intel 硬件上计量，不能用 Rosetta 冷翻译冒充。

## 2026-08-19 · 2.0.11 S00 增量发布基线与禁止漂移合同

- 2.0.11 唯一基线锁定为已公开激活的 2.0.10 提交 `65a995fa795d7007dd90818c939c5185b3fc1a1d`。build-only run `32235790388` 成功；publish-only 首次 run `32238137486` 只在 R2 阶段失败，重跑 `32238252808` 未重建任何制品并成功激活。公开 `desktop/latest.json` 回读仍绑定该提交：macOS `384418794` bytes / `c40840ef41017939ef583b36bd804d7c9a30cfc9f9f132b67896c2c9a8bf0ac1`，Windows `294003755` bytes / `44ed621f65c093c5323ff77d31a24211dd51d112dc83e24d260de340376bddea`。
- 新分支 `agent/e-mate-2.0.11` 和独立工作树从上述精确提交创建。固定 Harness 仍为 fork `df78045a127e32cb5b942defba52c539590d1596` / upstream `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` / `0.1.0-rc.7`；没有修改 submodule。对照 `anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add` 后，继续采用单 Electron/Cordis 进程、Profile 层、原生 `dsh plugin --profile` 对账及既有启动/重启健康边界，不新增 Loader、Host、Session、Transport 或更新协议。
- 当前仓库尚不能声称 plugin-only：根 `test/build`、CI 和 Desktop build 会构建全部一方插件与固定 Harness；`sync-emate-plugin-bundles.mjs` 把 14 个包复制进一份 Profile，`sync-emate-profile.mjs` 再把完整 Profile、浏览器扩展、生态插件与运行时嵌入 Desktop。该耦合在可执行边界门禁通过前必须保守进入 Base lane，不能用路径过滤制造假增量。
- 本切片先把 Desktop 基座、Profile 组件、第三方 overlay、精确兼容、双确认、原子切换和 fail-closed 分类写入仓库合同。下一片实现一份 Node 标准库 change-impact 分类器及表驱动测试；CI 与 Release 只能消费同一结果，未知或共享输入一律升级到 Base。

## 2026-08-19 · 2.0.11 S00 原生创造模式第一准则与封装门禁

- 对照固定 DSH rc.7 源码确认「创造模式」就是 shipped `cordis` Agent preset：它在标准 coding preset 之上增加 `cordis_inspect_*`、动态插件 define/run/stop/undefine 生命周期，以及 `cordis-plugin-development`、`editing-cordis-compositions` 两份官方 skill。动态包只存在当前 DSH 进程内存，重启即消失，且隔离不是恶意代码安全边界；因此它适合作为插件开发内环，不是发布格式或上线旁路。
- 对照 `anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add` 发现原生 Desktop 明确把完整 shipped preset 根作为 `system` root。e-Mate 2.0.10 封装此前只把改写 persona 的一个 `standard` 复制到受管根并替换全部 roots，同时禁用 `ui-agent-preset`；虽然包内已有 rc.7 Host/Client runner 依赖，`standard/code/minimal/cordis` 名单和创造模式入口实际被切断。
- `AGENTS.md` 和本目标合同现把“插件平面先走原生创造模式检查和可逆试装”固定为第一开发准则：成功实验必须重新实现为普通仓库 Profile 组件，并继续经过精确 Base/Harness 兼容、组件/组合测试、签名、原子 generation、renderer health 和回滚。创造模式为显式 opt-in、信任级别等同 shell，不能成为普通会话默认值，也不接触签名密钥、发布凭据或 Feed 激活权限；Base-only 变更必须记录原因并回到固定 Desktop 生命周期。
- Desktop Profile 现在按 first-root-wins 同时组合两个只读 `system` root：受管 e-Mate `standard` 在前，只 shadow 产品 persona；原生 DSH shipped root 在后，继续提供 `code/minimal/cordis`。`standard` 仍是默认 preset，UI 只恢复原生 preset 选择/创作入口。`shippedPresetRoot()` 同步采用原生 Desktop 的 `app.asar → app.asar.unpacked` 物理路径规则，没有复制、修改或另造 shipped preset。
- 仓库门禁同时锁定第一准则文本、两个 preset root、显式启用的原生 UI 行，以及正式包内四个 preset 的 composition/metadata 与两份创作 skill。验证结果：`node --test scripts/change-impact.test.mjs` 为 `10/10`；Desktop `vitest run tests/profile.spec.ts tests/verify-packaged-runtime.spec.ts` 为 `44/44`；首次 DSH Profile 测试因生成态 `lib/e-mate.js` 尚未构建而在加载前失败，按既有根构建链生成全部 Profile 输入后，同一 `node --test packages/dsh/test/e-mate.test.mjs` 为 `38/38`。本切片没有发布、签名或激活任何组件，不能据此声称热更新事务已经闭环。

## 2026-08-19 · 2.0.11 S03 Full Access 原生环境与 Computer Use 最小权限

- 截图中的 `npx ... exit code 127` 不是 DSH sandbox 拒绝，而是 e-Mate 封装遗漏了原生 Desktop 在 Host boot 前执行的 login-shell 环境恢复：Finder 启动的 macOS App 只继承精简 PATH，即使当前 Agent 已是 `danger-full-access`，Bash/Tool 仍找不到用户终端中的命令。Desktop 现直接保留原生 `shell-environment` 路径，只接受绝对路径的 zsh/bash/fish、2 秒/1 MiB 截止，并在官方敏感变量 scrub 后仅合并 PATH 与固定开发环境 allowlist；恢复发生在 `loadLayeredEnv()` 快照、pnpm shim、Profile 和 Host boot 之前。
- Computer Use 的 Full Access 映射继续按当前 Session 的 `sandboxPolicy.resolve()` 动态判断：只有 `danger-full-access` 绕过应用 lease，Default/Read-only/Workspace-write 仍走原生 exact grant/approval，未使用进程级 `allowAllApps`。同时删除了封装曾给高权限 Swift helper 追加的 Electron JIT、unsigned executable memory 与 disable-library-validation entitlement；build 现在复制上游 universal helper 并只重算 manifest SHA，不再二次扩权重签。
- 聚焦验证：Desktop `shell-environment.spec.ts + package.spec.ts` 为 `44 pass / 1 skip`，Desktop TypeScript 无输出通过；Computer Use 重建后合同为 `2/2`，helper SHA-256 `6dbb7d4b171d9f480e046a4c69df6e3b41c8c5bf0decfabc6e5331c1dc79af91` 与 manifest 一致，`codesign -d --entitlements` 未返回 entitlement。该证据关闭源码和构建产物边界，不替代正式 App 从 Finder 冷启动后的用户 PATH/真实 TCC 装机验收。

## 2026-08-19 · 2.0.11 S04 签名组件代启动、健康回滚与 Agent 自然语言更新

- Desktop 现在从随 Base 打包的严格 `base-contract.json` 读取唯一 Ed25519 信任根，不接受多余字段、错误密钥类型或 Harness 身份漂移。启动先消费 pending generation，复验签名 desired-state、完整官方热更组件集合、每个 manifest、精确文件集合/权限/SHA-256 与 package 合同；缺失或损坏代沿 `last_known_good → previous_known_good → bundled` 有界回落，不再由旧 profile 安装逻辑静默覆盖成 Base 字节。
- `installEmateDesktopProfile` 已接入通过复验的 content-addressed component roots，并把 generation id 写入安装回执。Renderer Loader 健康后才同时确认 Desktop Profile 与组件代；超时或失败会把非 bundled 代标记失败并请求重启上一个健康代。已健康代若以后发生磁盘损坏，也会在下一次启动回落。组件缓存仅在用户确认后的 staging 中修复损坏对象，active generation 不就地改写。
- 自然语言“检查更新 / 更新插件 / 更新 e-Mate”继续走原生 Harness Agent Tool `e_mate_desktop_update` 和既有 `desktopUpdates` 服务，没有 Bash、npm/pnpm、关键字路由或第二更新器。手动/Agent 检查优先验证签名组件 desired-state；后台轮询也按 generation id 每代只推送一次同一个原生确认框。确认框展示发布版本、变化组件及剩余字节；确认后再次取得并比对同一 generation，只下载缺失 component closure、原子 stage 并重启。真实 rc.6 Base 收到 rc.7-only envelope 会先得到 `base-required`，再检查既有 Base installer；没有兼容 Base 时不下载或安装插件。
- 聚焦验证命令为 Desktop 主/测试 TypeScript 两套 `--noEmit`，以及 `vitest run tests/profile-update.spec.ts tests/updates.spec.ts tests/agent-update.spec.ts tests/profile-release.spec.ts tests/profile-generation.spec.ts tests/profile-component.spec.ts tests/e-mate-profile.spec.ts tests/electron-runtime.spec.ts`，结果 `8 files / 69 tests` 全过。当前闭环证明客户端选择、下载、组装、重启选择和健康回滚合同；公开 desired-state 签名/上传/激活、完整 accepted-component-set 组合门禁和平台目标组件仍是后续发布切片，未据此声称已上线。

## 2026-08-19 · 2.0.11 S05 插件闭包第一批与 Desktop 原生能力回归

- Search 不再同时维护“第一方可发布但 Desktop 不使用”和生态包真实运行两条实现。Desktop 已移除旧 `dsh-search-mcp` patch/source/tarball，改装同一 `@e-mate/dsh-plugin-search-mcp` 热组件；搜索仍只注册到 DSH `ctx.web`。组件删除任意 URL、任意认证 header/query、任意 stdio 命令及运行时 `npx -y latest`，只接受固定 HTTPS provider catalog、精确 credential ref、有限结果树和有界来源；修复 request `maxResults` 被默认值遮蔽及 capability 永久 setup-required。Search `5/5`、MCP Manage `4/4`、重建后的完整 Profile boot 均通过。当前仍缺一张使用 DSH settings/credentials 原生服务的固定 provider 配置卡，不能把安全运行路径写成完整 UI 闭环。
- Office 对所有 DOCX/PPTX/XLSX 输入先做 ZIP metadata 预检：最多 2048 entries、单 entry 16 MiB、声明总量 64 MiB、超过 1 MiB 后最高 200 倍压缩率；XML 再经过单文件 8 MiB、累计 64 MiB、fatal UTF-8 的流式读取边界。PPTX 改为最多 200 页顺序解析，XLSX 最多 100 个 sheet metadata，不再 `Promise.all` 解压整包。真实 roundtrip、9 MiB STORE XML、高压缩率和 2049-entry 反例合计 `5/5` 通过。
- “Full Access 仍不能拖入项目文件夹”的根因不是权限预设，而是 e-Mate 封装删除了 DSH Desktop 的 context-isolated preload/Workspace drop bridge，同时 file-import 在 document capture 阶段抢走 directory drop。Desktop 已按固定参考回植只暴露 `webUtils.getPathForFile` 的最小 preload，并继续调用原生 `workspaces.create/startSession`；兼容模式的 DSH Workspace browser 与高级模式的项目区共享同一 drop marker。file-import 对目录和 Workspace target 明确放行，普通文件只在 `data-composer-card` 接管，页面级空 MIME 图片规范化继续交回原生 attachment 流。验证为 file-import `6/6`、Shell `6/6`、Desktop 相关 `5 files / 61 tests`、TypeScript 与完整 Profile boot 通过。
- Xin Assistant 不再由 Profile 安装器搜索/替换 `pythonPath`，因此未来 component generation 不会绕过改写后退回系统 Python。Desktop 在 `loadLayeredEnv()` 冻结快照前校验并覆盖 `EMATE_MANAGED_PYTHON_PATH` 为当前平台随 App 交付的解释器；插件只从 DSH `launchEnvironmentOf(ctx).getFrom(..., ['process'])` 读取该稳定基座合同，显式 `pythonPath` 仍优先，非 Desktop 才保留系统解释器回退。Xin `3/3`、Desktop Profile/Package/Vision `3 files / 28 tests`、TypeScript 与完整 Profile boot 通过。
- 本切片含 Desktop Base 与 Profile 组件同时变更，必须进入 Base lane；上述验证不是 plugin-only 发布证据，也没有上传、签名或激活任何线上 generation。下一步仍须关闭 Skill Hub 事务、Vision 平行实现、平台组件 target tuple、完整 accepted-component-set 组合、真实 TTFT/tok/s 对照和双平台安装态门禁。

## 2026-08-19 · 2.0.11 S06 平台 Profile 组件目标矩阵

- Computer Use 与 Xin Assistant 不再因为包含原生闭包而永久升级成 Base。唯一组件 inventory 为两者声明完整 `darwin-arm64 / darwin-x64 / win32-x64` 矩阵，并把 platform、arch、runtime ABI、最低系统、签名声明与 native path closure 同时绑定进组件 manifest 和签名 desired-state。portable 组件保持 `target: null`；平台组件缺 target、target 不全或元数据不一致一律失败关闭。
- change-impact 只为变更组件展开目标 job：macOS arm64 使用 `macos-15`、Intel 使用 `macos-15-intel`、Windows x64 使用 `windows-2025`。每个 job 仅 build/test 当前组件并从已接受 Base SDK 恢复 Harness ABI；Base SDK cache 缺失就失败，不允许插件 lane 偷跑 Harness 构建。emit 仅纳入所选目标的 native closure；Desktop 只读取 `<platform>-<arch>` desired state，并在下载/物化时复验目标、闭包、Mach-O/PE 与 ad-hoc/unsigned 声明。
- Computer Use 的 universal helper 实际 Mach-O minimum OS 为 14.0；Xin 原生 Python 闭包按目标固定为 CPython 3.12。最低系统字段表示该原生能力的 readiness floor，不阻断同一 generation 的无关 portable 组件。macOS Xin 的四个 Mach-O 扩展已逐一 ad-hoc 签名并由组件测试锁定；Windows target 必须在 Windows runner 产生并验收，不能在 Linux/macOS 伪造。
- 验证结果：分类器/组件产物合同 `16/16`，Desktop Profile release/component/generation/update/Profile 组合 `5 files / 21 tests`，Desktop TypeScript、完整构建和 headless Profile boot 均通过；CI YAML 由系统解析器回读成功，GitHub 当前官方 runner 表确认三个 runner label 可用。这里仍只关闭平台 component-only 的构建与客户端拒绝边界，没有签名公开 desired state、组合 accepted set、上传或 Feed 激活，因此尚未上线。

## 2026-08-19 · 2.0.11 S07 管理端与本地 DSH 边界回归

- 管理端生产装配现只保留身份、模型发布/策略与脱敏审计。Analytics production 不再打开 Runtime Registry、Session Index、observability policy 或 platform monitoring 的本地运行面；对应旧路由在生产装配返回 404，Redis 也不再是管理 API 启动依赖。Admin 去掉 `/runtime/status` 和本地 session/task/model-health 投影，只展示权威账户与已发布模型事实。
- Finder/网络故障之外另一个“本地不能用”根因是短 JWT 到期时 Auth 临时 5xx/断网会清除 OS 中已接受会话，IdentityGate 随即锁住整个本地 Harness。Identity provider 现在只对明确失效/撤销清会话；瞬时服务不可用时保留已接受主体和本地 workspace unlock，新的企业模型请求仍按既有模型策略失败关闭。模型目录投影同时把 Settings 与全部 runtime credential 纳入一个回滚边界，第二步失败不再留下半套模型配置。
- 聚焦验证为 DSH Profile `38/38`、Admin `17/17` 加 TypeScript/Vite build、Analytics TypeScript 与 `34/34`；另 6 项真实 PostgreSQL/Redis 测试因本机未提供外部测试端点而明确 skip。源码/测试证明生产路由与本地故障语义，不冒充真实控制面断网装机演练或线上部署完成。

## 2026-08-19 · 2.0.11 S08 Skill Hub 全链路审计与自然语言操作合同

- 只读行为重放证明旧实现会把原生 DSH 无法解析的 Skill 写成 installed；同 slug 并发安装时，较早失败事务还能删除较晚已返回成功的新版本；server complete 响应未知会留下永久 `pending-server-receipt`，且没有启动恢复。当前也缺 update/enable/disable/uninstall，Shell“已安装”页读取的是 session `skill.list` 而非 Hub receipt，搜索只取前 24 条再本地过滤。以上均为发布阻断，不按现状冒充闭环。
- 仓库合同现要求把 Host 事务与 UI 投影收敛成同版本 Skill Hub Profile 组件，复用原生 `dsh-skill-filesystem` parser/readback、`dsh-tool-skill` load、Jobs、UserQuestions 与 Agent Loop。每 slug 使用一个锁和持久 WAL；所有本地 mutation 只有在原生 provider 可见性/不可见性符合动作后提交，网络未知进入 recovery-pending 并在重启后幂等对账。
- 用户可自然语言搜索/查看、安装、更新、启用、禁用、卸载其他用户分享的 Skill，也可上传、发布或删除自己有权限的发布。明确原话已给出 exact action/slug/version 时可作为该次 consent；含糊请求必须在任何网络或磁盘副作用前询问 exact source/version/digest/scope。远端删除只为经服务端所有权验证的 immutable publication 写 tombstone；本地 uninstall 与远端 delete 是两种明确动作，不能互相替代。下一切片实现并用真实 DSH provider/invoke、并发/crash/restart 矩阵及 UI remount 验收；本条仅固定根因与不可退化合同。

## 2026-08-20 · 2.0.11 S09 Skill Hub 单组件与 Agent 全生命周期

- Skill Hub 的 Host 事务、Connection RPC、Agent prompt/Tools 与 UI 已从共享 `packages/dsh`/Shell 拆成唯一 portable 组件 `@e-mate/dsh-plugin-skill-hub`，同一组件提供搜索、详情、receipt inventory、短期下载、安装、更新、启用、禁用、卸载、上传发布和 owned-publication 删除。自然语言操作只注册类型化 `e_mate_skill_hub_*` Tools；不做浏览器关键词判断，也不把 ZIP 生命周期交给 `dsh-find-skill` 的另一套目录或 receipt。
- 本地 mutation 以每 slug 串行所有者、持久 WAL、候选/上代目录和原生 rc.7 provider readback 为提交边界。非法 frontmatter 不会产生 installed receipt；已安装 Skill 必须能由真实 model-facing `skill` Tool 加载。同 slug 交错、同版幂等、install/update 分离、completion 响应丢失、重启 reconcile、disable/enable/uninstall 都有行为测试。发布确认绑定实际 ZIP 摘要，Agent 不能把任意本机路径或变化后的文件上传；删除远端发布与本地卸载保持两个明确动作。
- 组件完整测试为 Host/事务 `8/8`、Client `5/5`，合计 `13/13`；真实 emit 还验证 Host、Agent、Client 和 bundled ZIP/YAML closure 全在同一 payload。当前仓库仍不拥有线上 2.0.5 Skill Hub 服务的部署权威；服务端幂等 complete/reconcile/所有权 DELETE 和 A/B 真实账号全流程尚无生产证据，因此这里只关闭客户端组件和原生 DSH 本地链，未宣称 Skill Hub 已在线闭环。

## 2026-08-20 · 2.0.11 S10 完整组件组合与增量发布事务

- Base lane 现一次产生 content-addressed Base SDK：固定 Harness 全部编译 `lib`、Desktop `lib`、非一方热组件的 Profile 核心/生态输入和图标，由 schema-2 manifest 绑定 Base contract、Desktop reference、Harness commit、每文件 mode/bytes/SHA-256。真实 emit/verify 为 `6,929` 个文件、`135,404,057` bytes。plugin-only lane 只 restore/install 该 SDK；cache miss 明确失败，不能在插件 job 里偷偷重建 Harness/Desktop。
- CI 只为 change-impact 返回的组件/目标执行 build/test/emit，再用当前签名 accepted set 形成 `darwin-arm64`、`darwin-x64`、`win32-x64` 三个完整候选。组合器要求 changed artifact 精确相等、官方 11 组件齐全、每个 manifest/文件/目标可物化，并实际启动 Cordis Host、Web graph 与全部 Client bundle。候选 artifact 只保留 admission/payload/临时签名证据，不上传验证期完整 store。一次真实 darwin-arm64 全量重放已通过，generation 为 `f8ab75ee8a30d6db29e4f42392ce545bcf0c8b4bd7150606b5716e6318e5466c`、组件数 `11`、changed `11`。
- 真实重放先后暴露并关闭四个会让单包测试假绿的问题：manifest 的 locale 排序与 Desktop codepoint 排序不一致；content-addressed 目录失去偶然的父级依赖解析；Search/MCP/Find/Computer Use 的非 Base 依赖未进入 payload；Computer Use bundling 后 `import.meta.url` 深度变化。现统一 codepoint 顺序，只从 generation roots 重定向固定 DSH/React Base ABI，其余依赖打入所属组件；Computer Use 只修正两个生成态本地路径。
- 新的手动 `profile-release.yml` 只接受 exact main commit 的成功 CI run 和 `CI admission`。正常发布不运行 build/test，不构建 DMG/EXE：生产私钥必须匹配 Base 内置信任根，publisher 先验证三目标候选和父代，再上传/回读变化组件与不可变 release envelope，最后分别替换 `no-store` target desired state 并产出 R2 receipt。首次 2.0.11 bootstrap 由同一 inventory 展开 9 个 portable job 加两组各三平台 job，从已接受 Base SDK 形成三份完整 generation；它只执行一次，仍不构建安装器。
- 仓库门禁当前为 release boundary/component/composition/publisher `23/23`，两份 workflow 均通过 YAML parser；完整真实 generation boot 也已通过。尚未执行受保护环境的 production bootstrap/R2 激活，也未取得三平台安装态、真实 TTFT/tok/s 或公开 desired-state receipt，故本切片只证明发布代码与本地组合闭环，不能写成已经上线。

## 2026-08-20 · 2.0.11 S11 流式 Renderer 热路径收敛

- 首 token 与 provider `tok/s` 的仓库 evaluator 已按真实慢尾定义固定为 TTFT p50/p95、吞吐 p50/p5，并要求原始 DSH Desktop rc.7 与同一 e-Mate generation 在同机器、模型、数据集和网络上至少 30 组成对样本。内置确定性 AgentLoop 只验证采集/比较器且强制非零退出，不能冒充 Desktop/Profile 或生产速度证据。
- 静态热路径追踪发现 e-Mate Shell 的思考状态、设置路由与折叠移动侧栏都在 `document.body` 上监听全部 `childList/subtree`；此前每个流式 token DOM 变化都会再次查询整页。三处现只检查 MutationRecord 中新增/移除的目标 marker 子树；思考状态首次扫描后只处理新增 status，设置与侧栏对无关 token mutation 完全不查询 document。没有修改 DSH Message、Agent Loop、LLM stream、Session event 或 Desktop IPC。
- Shell `8 files / 39 tests` 与组件 build 通过；新增反例连续插入 50 个无关 token 节点，锁定 document-wide query 为 0，同时验证晚到思考状态、设置弹层和移动路由仍生效。change-impact 对本切片精确返回 `plugin-only`、唯一组件 `@e-mate/dsh-client-shell`、`portable` job，证明以后该优化不构建 Harness、Desktop 或安装器。
- 这些结果证明已移除一个确定的 renderer 放大器，不等于声称 TTFT/tok/s 已对齐。最终性能门仍需绑定已安装 Base/Profile/组件摘要，用真实 provider 完成原始 Desktop 与候选的 30 组成对运行；缺该证据继续标记 blocked。

## 2026-08-20 · 2.0.11 S12 首个 Base 候选本地总验收

- 首个实现提交为 `dbf14555d0bf2806e325cd390987739a5d40586e`。相对唯一 2.0.10 基线 `65a995fa795d7007dd90818c939c5185b3fc1a1d` 的 change-impact 结果为 `base` 且 release contract valid；这是本版修改 Desktop、权限、更新事务、inventory 与发布权威后的正确一次性 Base lane，不是后续插件更新流程。
- 根工作区总门禁通过：release/component/composition/publisher `23/23`，性能 evaluator `4/4`，所有一方组件 build/test，DSH Profile `43/43`，Shell `39/39`。Xin Python 真依赖测试改为 `PYTHONDONTWRITEBYTECODE=1`，复跑 `4/4` 且 runtime 中没有 `__pycache__`，避免测试机器缓存进入候选工作树；component emitter 仍独立拒绝任何 `__pycache__`/`.pyc`。
- Desktop 首轮总测的唯一失败来自测试把 `node:child_process` 整体 mock 成只有 `spawn`，使组件平台验签 import 的标准库 `execFile` 不存在，26 条用例均在加载前失败。mock 改为保留真实标准库、只覆盖 `spawn` 后，聚焦 `26/26`，完整 Desktop `52/52 files`、`425 passed / 3 environment skips`；四套 TypeScript、197 节点 runtime closure、CLI、Loader、Profile 和 582 个生产依赖许可证检查全部通过。
- 用该真实提交重新 emit 当前 11 个 Desktop 接受组件并组合 macOS arm64 初代，真实 Cordis Host/Web Loader boot 通过。generation 为 `8719ccfca1de5a36111e25c068aa0ac9c57359adffaf00dc1e769771ca79a39f`；本地 admission 为 `7,179` bytes，SHA-256 `988a042de497ca9f6d2e253e466629f3d0778dfbc84e8647170de216a90374a3`。该收据使用 CI 临时 Ed25519 key，仅是本地组合证据，不能发布。
- 尚未关闭且不得降级的门：main 上同 SHA 的三平台 CI/Base installer、受保护环境生产签名 bootstrap、不可变 R2 上传与三目标 desired-state 公共回读、macOS/Windows 安装态确认/重启/健康/回滚、CDP 与 Full Access 真机、以及原始 DSH Desktop rc.7 对当前已安装 generation 的 30 组成对 TTFT/tok/s。缺任一外部证据都不能把 2.0.11 标为上线完成。

## 2026-08-20 · 2.0.11 S13 macOS Universal 打包与 Renderer 健康闭环

- 首轮真实 App 启动没有产生 `.release-health-ack`。新增的失败收据把根因定位到 Shell：`conversation.chat.turnTail` 是 rc.7 的 chain slot，entry 必须声明 `select`；e-Mate 的 `ArtifactCapsules` 既缺 `select`，也会与原生 `ProducedFiles` 争用同一 chain。最小修复删除该 entry 和 DOM adapter，只用 CSS 装饰原生 `[data-produced-files-row]` 按钮；原生 `ProducedFiles/openFile`、可访问属性与路径语义不再由 Shell 改写。实际 packaged app 随后完成 Host、完整 Profile、Client Loader 与 Renderer health。
- release probe 失败时不再弹出交互恢复框阻塞 CI；主进程把精确失败插件和 stack 写入仅限 probe 的 `.release-health-failure`，验证器发现后立即失败。正常用户启动仍保留原生恢复对话框。Shell `8 files / 39 tests`、release-probe 聚焦 `3 files / 53 tests`、打包 inventory 聚焦 `3 files / 55 tests` 与 Desktop TypeScript 通过，失败收据和“probe 不弹窗”都有窄回归。
- Universal 合并连续拒绝两处错误架构的宿主编译残留：随 Profile 复制的 `build/e-mate-profile/ecosystem/dsh-better-sidebar/node_modules/node-pty/build`，以及 Desktop 物理依赖树中的 `node_modules/dsh-better-sidebar/node_modules/node-pty/build`。同步器和 electron-builder 现统一排除任意嵌套 `node-pty/build`；每个 darwin 单架构 afterPack 已先失败关闭，最终 universal inventory 只接受并逐项验证 arm64/x86_64 prebuild 的 `pty.node` 与 `spawn-helper`，不再把污染二进制加入合并白名单。
- 本地 unsigned/ad-hoc Universal DMG 已通过 `hdiutil verify/attach`、Info.plist、全部原生条目双架构、深度 codesign 和从挂载镜像复制后的真实启动。arm64 交互 Renderer health ACK 为 `24,190 ms`，x86_64/Rosetta native-ready ACK 为 `44,097 ms`；产物为 `desktop/e-mate-desktop/dist/mac-unsigned-release/e-Mate-2.0.11-mac-universal.dmg`，`383,503,141` bytes，SHA-256 `25c2063c4d25fe8d5e08860a73ba68e33bcf11dd9878ed2b383f02d112e2732a`。
- 该文件仅是本机未公证候选，未上传、未激活 Feed，也不能替代 Intel 真机 Renderer、Windows 安装态、真实 Full Access/CDP、生产签名组件 generation 和 30 组成对性能证据；这些外部门禁继续保持未完成。

## 2026-08-20 · 2.0.11 S14 发布合同完成性复核

- 逐项重跑 Base CI 的独立 `Check release carrier` 时真实复现 `scripts/release.test.mjs` 失败：CI 已增加 `profile-composition`，旧测试仍断言没有该 Job，因此即使此前组件门禁全绿，Base lane 也会在发布载体合同处失败。最小修复只把完整 Profile generation Job 纳入既有权威拓扑断言；发布/分类/组件/组合/R2 合同合并重跑为 `32/32`。
- CI 中的 `dist:mac-smoke` 仍只属于隔离 Base 验证，正式 `desktop-release.yml` 唯一执行并上传 `dist:mac-unsigned-release`；本轮没有把 smoke 字节改名或提升为可发布 Desktop。当前本地正式 DMG 的真实健康证据仍由 S13 记录。
- 外部状态保持失败关闭：实时公开回读 `darwin-arm64`、`darwin-x64`、`win32-x64` 三个 `desktop/profile/desired-state/*.json` 均为 HTTP 404；远端 `main` 仍为 `af124d75ccf2c46f423a69380dcbd1450692686f`，最近成功 CI 为 `32099808664`，尚不包含本地 2.0.11 提交；`win-codex` 目标 `laptop-adq973jn.local` 当前 DNS 无法解析。故仓库实现、本地组合和 macOS 候选已经可验证，但生产 bootstrap、Windows 及用户热更新入口仍未上线，Goal 不能标为完成。

## 2026-08-20 · 2.0.11 S15 干净 CI impact 启动闭环

- 用当前提交创建未初始化 submodule、没有任何生成 `lib` 的临时 worktree，按 GitHub impact Job 原命令重放。修复前 `--check-contract` 因读取不存在的 `upstream/deepseek-harness/package.json` 失败；这是本机已展开 submodule 掩盖的真实首步阻断。分类器现直接读取 Git index 的唯一 `160000` gitlink，并要求其对象精确等于 Base contract 的 `df78045a127e32cb5b942defba52c539590d1596`；错误 mode、重复路径、缺失或 commit 漂移均失败关闭，不再为一个版本字段下载整个 Harness。
- 同一干净重放还证明 impact 的 component payload 测试依赖未跟踪构建产物：Shell `index.js`、Skill Hub `lib/` 和 Computer Use `lib/index.js` 在 CI 尚未 build 时均不存在。边界测试现只检查已提交 package allowlist/exports、平台 target 过滤函数和自包含 emitter fixture；真实生成字节仍由对应 changed-component Job 在 build 后 emit，并由三目标完整 generation 物化与 Host/Web Loader boot 验收，没有把生成物检查删除或移到浏览器伪测试。
- 修复后的无 submodule/无生成物 worktree按 impact 原命令为 `24/24`，随后 `--check-contract` 返回 `valid: true`；本地合并发布载体门禁为 `33/33`，`git diff --check` 通过。本切片修改 classifier 及共享发布测试，正确属于本版一次性 Base lane；后续普通组件源码变化仍复用同一 Base SDK，不初始化或重建 Harness/Desktop。

## 2026-08-20 · 2.0.11 S16 Plugin-only Base SDK cache-key 反例

- 新增真实 Git index 行为测试：先把完整 Base contract、Desktop package、组件 inventory、14 个组件 package manifest 和固定 Harness gitlink 写入一个无 submodule fixture，取得已接受 Base SDK fingerprint；随后只新增并 stage `memory-evolve` 组件源码，fingerprint 必须逐字节不变；再新增并 stage Desktop 共享源码，fingerprint 必须变化。错误 Harness gitlink继续使合同失败。
- 该反例证明 plugin-only Job 不只是“分类结果写着不跑 Base”：它会解析出与上一 Base lane 相同的 Actions cache key，命中并复验已有 SDK；Desktop/Harness/共享输入则产生新 key，只能回到 Base lane。干净 checkout 无生成物门禁继续为 `24/24`，且可直接输出 Base SDK fingerprint `f45d9f7fbf99ac2983ce3c727bde3b0fc511e9f35dca47e8d204f5108ded1aab`。
- 本切片只改变分类器反例测试和开发记录，不改变产品或发布输入；它必须保持 verification-only，不能因补门禁再次触发 Desktop 安装器构建。

## 2026-08-20 · 2.0.11 S17 组件外部源码所有权闭环

- 全量枚举 14 个一方组件的真实 build command 后确认两处可发布组件仍从组件目录外生成代码：Computer Use 读取固定 `upstream/plugins/dsh-computer-use` gitlink，Find Skill 读取固定 `upstream/plugins/dsh-find-skill` gitlink。旧分类器把所有 `upstream/**` 一律判为 Base，因此只升级这两个插件的权威上游源码仍会错误触发 Harness/Desktop 全量构建。
- 唯一 component inventory 现为这两个组件显式声明 `source_roots`。分类器只把该精确 gitlink 及其子路径交给对应组件，并要求 Git index 中必须是唯一 `160000` submodule、对象 SHA 必须与组件 `package.json` 的 `dsh.upstream.commit` 相等；缺失、普通目录、SHA 漂移或未声明的 upstream 均失败关闭。GenUI 仍是 Desktop blocked，继续走 Base；共享 Harness/tsdown ABI 仍由既有 Base SDK 提供，没有伪装成组件输入。
- 同一审计发现 Shell 的 plugin-only build 每次从旧 2.0.5 子模块和 `packages/dsh/src` 回拷 Logo、头像与发送图标。五个已生成文件先逐项 SHA-256 对照原来源完全一致，随后直接成为 Shell 组件的受跟踪 `assets` 闭包；同步脚本及 Base 中的重复 SVG 被删除。以后改 Shell 资源精确得到一个 portable Shell job，旧 2.0.5 参考资源仍属于 Base，不再暗中决定组件产物。
- Git-index 反例覆盖了“同时更新 Computer Use gitlink 与 manifest provenance 时 Base SDK fingerprint 不变”，以及“只改一侧时合同失败”；分类器实跑分别得到 Computer Use 三平台 plugin-only、Find Skill portable plugin-only、未声明 GenUI Base。真实构建/测试为 Computer Use `2/2`、Find Skill `6/6`、Shell `8 files / 39 tests`，DSH package build 通过；三个组件真实 emit 分别包含 Shell 五个资源、Find Skill 固定 upstream SHA 与 Computer Use darwin-arm64 固定 upstream SHA。
- 发布/分类/组合/R2 合并门禁为 `34/34`；无 submodule、无生成 `lib` 的物理路径临时 checkout 为 `22/22`，独立 `--check-contract` 返回 `valid: true`。本切片修改 inventory、分类器和一次性 Base 构建输入，因此当前提交正确进入 Base lane；它的目的正是让后续这三个组件的源码或资源更新不再重建 Desktop 安装器。本轮没有上传组件、签名 generation 或激活线上 desired state。

## 2026-08-20 · 2.0.11 S18 组件 Base 运行时 ABI 闭环

- 组合启动审计发现 Desktop resolver 会把任意组件中的 `@deepseek-ai/*`、`react` 和 `react-dom` 导入重定向到 Base，即使组件没有声明该依赖；单组件测试因此可能依赖 Desktop `node_modules` 偶然通过，随后 Base 升级或精简时才在用户机器失败。Base contract 现固定精确 `runtime_imports` 包名/版本，每个组件 manifest 显式、排序声明 `base_imports`；两者由分类器、签名组件 manifest、Profile materializer 和运行时 resolver 共用同一真相。
- 组件 emitter 使用固定 Harness toolchain 已有的 TypeScript parser，只扫描真实入包 JavaScript 的静态 ESM、字面量 dynamic import 和 CommonJS require。Node 内建与相对导入不进入 Base ABI；未声明 Base import、声明未使用的宽 ABI、版本漂移、未知包或未排序字段全部失败关闭。除签名允许的 Base import 外，第三方依赖必须自包含在组件 payload，不能继续向 Desktop 依赖树逃逸。
- 完整 `darwin-arm64` 与 `darwin-x64` generation 均通过签名物化、component-specific resolver、Cordis Host 与 Web Loader 启动，generation 分别为 `4f520bd03dd41e88fe6c0c288bf0f5918f53b0323902ac41dfb6527df49d61f3`、`7bfcef55b4e4f9321a22c8548bb8320303fa12ad777c64ca2b5f6a23e28a7b9c`。`win32-x64` 在 macOS 完成签名与物化；其 Computer Use payload 正确只含 Windows 原生目标，真实 Host boot 必须由 Windows runner 验收，未用伪造 `process.platform` 的跨平台烟测冒充。
- 聚焦发布合同 `27/27`、Desktop `52 files / 427 passed / 3 environment skips`、四套 TypeScript、Loader/Profile 启动和 `197` 节点 runtime closure 全部通过。该修改扩大 Base contract，当前切片正确属于一次性 Base lane；已有 S13 DMG 不再是该 Base ABI 的最终候选，后续单插件更新只有在 signed `base_imports` 与当前 Base 精确兼容时才进入 plugin-only lane。本轮未上传组件、未重建安装器、未激活线上 desired state。

## 2026-08-20 · 2.0.11 S19 Skill Hub 自然语言发布与远端事务闭环

- `@e-mate/dsh-plugin-skill-hub` 继续作为唯一 Host/Agent/UI 生命周期所有者。Agent 的类型化 Tool 现在同时覆盖搜索、详情、inventory、安装、更新、启用、禁用、卸载、上传发布和删除本人发布；所有 mutation 仍先由原生 `UserQuestions` 固定精确目标，再进入同一 DSH Job，不增加关键词匹配、Shell 旁路或第二套 Skill loader。发布只接受原生 rc.7 registry 当前可见的已安装 slug，或当前会话文件导入链生成的精确 `.e-mate/imports/*.zip` identity；任意主机路径、符号链接、硬链接、越界路径、超限或读取时变化的文件均失败关闭。
- 候选发布包在上传前必须通过固定 rc.7 `FileSystemSkillProvider`；同时修正原生 definition 指向 `SKILL.md`、resourceBase 指向目录的真实身份比较。ZIP 使用 codepoint 文件顺序和固定时间生成，规范内容 CAS 与 ZIP 原始字节摘要分离：前者进入目录/安装/远端请求身份，后者只绑定用户确认和本地 TOCTOU。自然语言删除不接收模型提供的摘要，先以当前登录身份从 owned-publication API 回读 slug/version/digest，再展示确认。
- publish/delete 在网络副作用前把稳定 request ID、精确不可变目标和发布原始字节写入独立远端 WAL；断网、限流、5xx、取消后响应未知或收据不匹配均保留 `recovery-pending`，重启只重放原 request/bytes，明确 4xx 才清理。响应丢失回归分别证明发布和删除都可在重启后得到同一终态；同账号昵称变化不参与幂等身份，重放返回首次不可变收据。
- 固定 2.0.5 服务源提交 `9704c5bc1a5006d56c3237cd76c0b0f14b722957` 已补齐规范 CAS 响应、幂等 install complete/reconcile、owned publication 回读、不可变 tombstone、publish/delete mutation receipt 和删除 latest 后的版本回退。首个版本以 `BEGIN IMMEDIATE` 原子绑定 slug owner，其他账号不能发布该 slug 的后续版本；schema admission 逐表校验列、类型、NOT NULL、主键、默认时间、约束、外键、不可变触发器和既有单 owner 历史，不能再用同名空对象或假审计时间骗过启动门禁。冻结的 2.0.5 排除 Skill 清单也恢复为权威 seed gate。
- 真实验证为组件 Host/事务 `11/11`、Client `5/5`；2.0.5 Skill Hub、生产装配、迁移和 schema 相关回归 `184 passed / 7 environment skips`，发布边界/组件/组合/R2 合同 `27/27`，Ruff 与两层 `git diff --check` 通过。独立审计对昵称重放和假时间默认值两个最终反例复核为 `2/2`。组件实现提交 `1bda5c5610a106b35269d8c3c8c946e4357b012b` 的 portable emit 为 `9` 个文件、`243,031` bytes，manifest SHA-256 `e4d88e1442f023de38675078ddee601c0afb41d281c133b59986a300d8ddec3e`，绑定 rc.7 commit 与四个 Base imports；临时 payload 验证后已删除。change-impact 实跑证明只改 Skill Hub 源码时为唯一 portable plugin-only job；该实现提交同时更新固定服务 gitlink，所以完整 diff 诚实进入一次 Base lane。服务源码尚未部署到权威线上环境，也没有 A/B 真实账号、公开 API、签名 generation 或 Desktop 安装态收据，因此不能宣称 Skill Hub 已生产上线。

## 2026-08-20 · 2.0.11 S20 UI 基线与 Skill Hub 服务来源解耦

- 继续完成性审计时，`pnpm run check:target` 在 S19 后真实失败：`upstream/e-mate-2.0.5` 已从唯一允许的 2.0.5 UI 基线 `564a6b6c1d43fb6831dd4a5cd8026e472f063311` 漂到本地 Skill Hub 服务候选 `9704c5bc1a5006d56c3237cd76c0b0f14b722957`。同一 gitlink 同时承担“不可变视觉参考”和“可演进云服务源码”是根因；放宽 UI pin 或把本机 commit 继续写进父仓库都会破坏干净 checkout 与目标合同。
- `git ls-remote` 证明 `9704c5bc…` 当前不在 ECoreX 权威远端任何 branch/tag，父仓库不能引用一个 CI 无法取回的本机对象。该服务候选已保存在本机分支 `agent/e-mate-2.0.11-skill-hub-service`；父仓库 gitlink恢复为 `564a6b6…`。服务端修复只有在独立服务来源发布并由部署链验收后才能进入生产，不能借推进 Desktop UI 基线交付。
- change-impact 现在导出唯一 `PRODUCT_UI_REFERENCE`，release boundary 直接从 Git index 验证该 gitlink；`check-target` 复用同一常量，不再维护第二份路径/SHA。新增反例把 UI gitlink换成任意本机提交时，合同在构建前失败关闭；正确 pin 下单组件仍复用相同 Base SDK key。本切片只修发布分类器和 Base 来源身份，Creation Mode 无法表示 Git provenance/CI admission，因此按合同保留在 Base/release plane，没有制造动态插件实验。
- 聚焦验收：影响分类/组件 payload/完整 Profile 组合/R2 publisher `27/27`、安装器发布合同 `9/9`，`check:release-boundary` 与 `check:target` 均通过；临时组合仓库也使用同一 UI reference 常量，不再因缺失 gitlink 假失败。当前修复修改分类器和受管 Base gitlink，正确进入一次 Base lane；它不改变 Skill Hub 组件的 portable plugin-only 归属。生产服务来源、三平台 CI/安装态、公开 desired state 与 A/B 账号验收仍未关闭。
- 提交后只读刷新外部门禁：远端 `main` 仍为 `af124d75ccf2c46f423a69380dcbd1450692686f`；最近成功的 Desktop Release run `32238252808` 绑定旧 SHA `65a995fa795d7007dd90818c939c5185b3fc1a1d`。`darwin-arm64`、`darwin-x64`、`win32-x64` 三个公开 Profile desired-state 继续全部返回 HTTP 404，`win-codex` 仍因 `laptop-adq973jn.local` 无法解析而不可达。没有推送、发布或生产变更；在同一当前 SHA 的 CI、签名 bootstrap、公共回读和平台安装态收据到齐前，Goal 保持 active。

## 2026-08-20 · 2.0.11 S21 删除最后的扩展浏览器发布字节

- 完成性审计区分了 `git diff --name-only` 中的历史删除项与当前磁盘真值：旧 `packages/dsh-plugin-browser`、`packages/dsh-plugin-browser-panel`、Desktop extension setup 和整份 extension vendor 已经不存在；`e-mate-profile.ts`/CLI 中保留的旧包名只负责升级时删除用户旧 Profile 残留，不是运行或发布依赖。
- 继续检查 Desktop vendor 后发现仍有失活的 `@yuxianglin/dsh-bridge-browser@0.0.1` tgz 与 source receipt。它们没有 package/lock/runtime 引用，仍是扩展浏览器实现字节，现已精确删除；删除前 tgz SHA-256 为 `66a97e999941b0da33096d027007d26029d82abc14d9f755b8370603a847c8ae`。CDP 仍是 inventory 中唯一浏览器组件，没有增加替代桥、扩展、浏览器二进制或第二套 Tool/approval/session 路径。
- `check-target` 现在拒绝旧 browser/browser-panel/extension setup 路径以及 vendor 中任何 `dsh-browser`/`bridge-browser` 文件重新出现；仓库边界新增同一可运行断言。验证结果为影响/组件/完整组合/R2 publisher `28/28`、安装器发布合同 `9/9`、Desktop Profile/package `26/26`，目标 pin 与 diff check 通过。本切片触及 Base 发布输入，必须诚实进入一次 Base lane；后续只改 CDP 组件仍保持 plugin-only。

## 2026-08-20 · 2.0.11 S22 唯一 2.0.10 前序改为可执行门禁

- 完成性审计发现目标合同虽声明 `65a995fa795d7007dd90818c939c5185b3fc1a1d` 是唯一验收的 2.0.10 前序，旧门禁只检查文档文本包含该 SHA，没有证明候选 Git 历史来自这些字节。另一条历史可以复制合同文本后进入分类，属于来源身份缺口。
- change-impact 现在导出唯一 `ACCEPTED_PREDECESSOR`，`--base/--head` 在计算 diff 与任何构建前调用 Git ancestry 验证；非后代、缺失对象或非法 HEAD 统一产生无效合同并非零退出，不再降级为昂贵的 Base 构建。`check-target` 复用同一常量和验证函数，Profile 发布仍只接受这个 exact HEAD 的成功 CI run，因此没有第二份前序判断。
- 正向证据证明当前 `HEAD` 的 merge-base 是精确 `65a995f…`；反例使用仓库根提交，函数与 CLI 均明确拒绝并返回状态 1。影响/组件/完整组合/R2 publisher 回归为 `29/29`，release boundary、target pin 与 diff check 通过。该分类器改动正确进入 Base lane；Goal 仍等待当前 SHA 的远端 CI/签名 bootstrap/三平台安装态收据。

## 2026-08-20 · 2.0.11 S23 平台组件原生字节闭包失败关闭

- 完成性审计发现 `verifyPlatformTarget` 旧实现只扫描声明 `native_paths` 内的 Mach-O/PE，且 `target:null` 的 portable 组件直接返回。这样 portable 插件可夹带原生二进制，平台组件也可把另一 OS 的 PE/ELF 放在声明闭包外，并用闭包内一个合法二进制满足最低检查，违背 target tuple 与“portable 不含 native”的合同。
- 现有 Desktop 物化边界现在扫描签名 manifest 的完整文件集，精确识别 Mach-O、带真实 PE signature 的 DOS/PE 与 ELF。portable 发现任一原生格式即拒绝；platform-profile 的每个原生二进制必须位于声明的 sorted native closure，darwin 只接受严格 ad-hoc Mach-O，win32 只接受 PE，ELF 和跨 OS 混入均失败。校验仍在同一 `materialize/verifyMaterializedProfileComponent` 路径，没有为 CI 或更新器复制第二套规则。
- 行为反例分别把 ELF 放入 portable payload、把第二个 PE 放到 Windows target 的声明闭包外，二者都在写 generation receipt 前失败；真实 macOS Xin native closure/codesign 正向路径继续通过。Profile release/component/generation/update `4 files / 17 tests`、Desktop 主进程与测试 TypeScript、仓库影响/组合 `29/29`、target pin 和 diff check 均通过。该信任边界属于 Desktop Base，正确触发 Base lane；普通 portable/平台插件源码仍由 inventory 的对应 plugin-only target jobs 构建。

## 2026-08-20 · 2.0.11 S24 多目标 Profile 激活可幂等续跑

- R2 publisher 会按目标依次激活三个 stable desired-state；如果首个目标写入成功、后续目标失败，旧重试会把已经写入的首目标视为“已有 bootstrap”或“不是当前状态的直接后继”，导致同一已签发布永久卡住。R2 不提供跨对象原子事务，因此不能用本地成功假装三目标同时提交。
- 发布前 CAS 校验现只增加一个严格幂等分支：公开对象经过原签名、target 和完整组件集合验证后，只有其 canonical envelope 与本次候选逐字节语义相等才视为该目标已经完成；任何其他已有对象仍拒绝 bootstrap，普通更新仍要求 exact parent generation、sequence 和 changed-component 声明。不可变组件上传、公开回读和最终 receipt 规则没有放宽。
- 回归分别模拟 bootstrap 与直接后继在 `darwin-arm64` 已激活、其余两目标尚未激活的中断状态，两次重试均可继续生成完整三目标发布计划；错误父代和非同一候选继续由原 CAS 测试失败关闭。影响/组件/完整组合/R2 publisher 为 `29/29`，安装器发布合同 `9/9`，release boundary 与 diff check 通过。该修改触及共享发布器，正确属于 Base lane；尚未发生线上写入或激活。

## 2026-08-20 · 2.0.11 S25 Base 发布性能收据独立失败关闭

- 性能 evaluator 已绑定原始 `deepseek-harness-desktop` rc.7 reference 与候选 Base/Profile/Client 摘要，使用 TTFT p50/p95、吞吐慢尾 p50/p5，并且夹具或未回读原始 artifact 的输入统一非零退出；但正式 Desktop R2 publisher 旧流程只检查综合 `EMATE_S12_ACCEPTED_SHA`，仓库没有独立证明当前发布 SHA 已完成真实 30 组成对性能验收。
- 最小门禁不增加第二套采集器，也不让 CI 夹具冒充真机：受保护 `r2-publish` 环境必须另外提供 `EMATE_PERFORMANCE_ACCEPTED_SHA`，且在下载候选后的任何 R2 写入之前逐字节等于 `GITHUB_SHA`。只有原始 DSH Desktop 与同一候选在相同机器、provider/model、数据集和网络上生成并通过生产 evaluator 后，维护者才能设置该受保护变量；plugin-only Profile 发布不走 Desktop installer publisher，因此不会因无关小插件更新重跑 Base 性能。
- release/performance 聚焦合同 `13/13`、影响/组件/组合/R2 publisher `29/29`、release boundary 与 diff check 通过。当前变量尚未配置、真实 30 组成对收据尚未取得，故该门会按预期阻止 Base 上线；本片没有把缺失证据写成通过。

## 2026-08-20 · 2.0.11 S26 旧 Base 与新插件代不兼容的完整入口反例

- 完成性审计确认 release envelope 的签名解析与 `selectProfileRelease` 已把兼容性和当前 Base 分层，但既有 rc.6→rc.7 测试只直接调用选择函数；它不能证明 Desktop 的真实网络入口会在组件 manifest/文件下载之前得到同一结果。
- 新行为测试用 rc.6 Base 内嵌的同一稳定 release 公钥验证一个仅声明 rc.7 Base/Harness 的已签 2.0.11 desired-state，再从 `checkProfileUpdate` 完整入口执行。结果精确为 `base-required`，包含所需 Base contract，网络请求严格只有一次 desired-state GET；任何组件 manifest 或文件都没有被请求。产品实现无需增加旁路或 SemVer 推断。
- Profile release/update 聚焦回归为 `2 files / 8 tests`，Desktop 测试 TypeScript 与 diff check 通过。该证据锁定“旧 Base 不混装新插件、兼容 Base 缺失时保持原代”的仓库合同；它没有把尚不存在的生产 desired-state 或 Base installer 冒充上线。

## 2026-08-20 · 2.0.11 S27 发布候选绑定 accepted impact 组件集合

- Profile release 的 validate Job 已从同 SHA 成功 CI impact artifact 读取 `publish_components` 并验证对应 component/composition Jobs，但 production publisher 旧接口没有接收这份列表，只验证三个候选各自声明的 `changed_components` 与实际 artifact 集合自洽。正常 CI 会生成一致数据，发布信任边界却没有证明“CI 判定变化哪些组件”和“最终签名哪些组件”是同一真相。
- publish Job 现在把非 bootstrap 的 accepted `publish_components`、bootstrap 的完整 accepted inventory 转成同一个重复 `--changed` 参数；publisher 要求列表非空、排序、唯一、全部属于当前 Base inventory，并要求三个目标候选的 admission 逐字节语义一致。候选多报、漏报或换成另一组件均在生产签名、不可变上传和 desired-state 激活前失败。
- 行为反例将一个已组合目标的 admission 从真实变化组件偷换为另一合法组件 ID；旧自洽链会直到后续 artifact 检查才间接失败，新边界直接报“candidate changed components do not match accepted CI impact”。影响/组件/组合/R2 publisher `29/29`、安装器发布合同 `9/9`、release boundary 与 diff check 通过。本切片修改发布权威，正确进入 Base lane；后续普通插件发布仍只传 classifier 已确认的变化集合。

## 2026-08-20 · 2.0.11 S28 当前生产阻塞回读

- 本节写入前的最新生产/门禁实现提交为 `60ee8205693dd3a4ebf6db2bf164b59d67f4ca46`，远端 `main` 仍为 `af124d75ccf2c46f423a69380dcbd1450692686f`；最近成功 main CI 仍是 run `32099808664`，绑定旧远端 SHA。没有可供 Profile publisher 接受的同 SHA CI run，本轮没有推送或伪造 CI artifact。
- 公开 `darwin-arm64`、`darwin-x64`、`win32-x64` desired-state 继续全部返回 HTTP 404；因此首个 2.0.11 production bootstrap 尚未发生。`win-codex` 仍解析到 `laptop-adq973jn.local`，但系统 DNS 返回 `Could not resolve hostname`，不能取得 Windows 安装、重启、健康、回滚或 Full Access/CDP 真机收据。
- 同一外部阻塞已跨 S14、S20、S25 与本节重复：需要维护者先把当前候选合入远端 main、取得 exact-SHA 三平台 CI/性能/Computer Use 验收，并恢复 Windows runner 或 `win-codex` 可达性；随后才能由受保护环境执行签名 bootstrap 与公共回读。仓库侧不得绕过这些门或把本地测试改名为生产证据。

## 2026-08-20 · 2.0.11 S29 新公开仓库成为发布权威

- 按用户明确指令创建公开仓库 `zyfjacksonchen-source/e-Mate-2.0.11`，默认分支为 `main`；首个主线提交为 `b76ad7055ad614e8dea65da6adb509bf752bbf7a`。旧 `zyfjacksonchen-source/e-Mate` 只保留为历史来源，当前开发分支跟踪新仓库 `main`，没有覆盖或删除旧远端。
- 目标合同、三个生产发布器和一方 npm package metadata 已统一迁到新仓库身份。`check-target` 同时校验合同文本、发布授权常量和五个发布包 URL，任何一处退回旧仓库都会失败关闭；历史开发记录及带旧 tag 的 Skill 来源 URL 继续指向原不可变出处，不被批量改写成不存在的 provenance。
- 公开前只扫描当前分支新增历史：高置信凭据模式只命中密码学依赖中的私钥格式常量及代码模板，没有真实私钥/API token；最大新增 blob 约 21 MiB；11 个 submodule URL 均可匿名读取。窄验证为 target contract 通过、release/Profile publisher `10/10`、impact classifier `17/17`、JSON 与 diff check 通过。
- 新仓库没有继承旧仓库的 Actions secrets、受保护 environment、平台验收收据或公开 desired state；因此“代码公开”不等于“2.0.11 已发布”。这些权限和证据只能在新仓库 fail-closed 门禁下重新建立，不能复制旧 SHA 的成功状态。

## 2026-08-20 · 2.0.11 S30 新仓库首次 push 的零前序闭环

- 新公开仓库第一次 push 的真实 CI run `32320534760` 在 impact 首步失败：GitHub 将 `github.event.before` 设为 40 个零，旧流程直接把它传给 Git，得到 `Not a valid commit name`。这不是产品测试失败，而是新仓库 bootstrap 事件此前没有可执行合同。
- impact Job 现在只在 `BASE_SHA` 精确等于 40 个零时，从 `change-impact.mjs` 的唯一 `ACCEPTED_PREDECESSOR` 读取 `65a995fa795d7007dd90818c939c5185b3fc1a1d`；普通 push 和 PR 仍使用 GitHub 提供的 exact base。分类器随后照常验证候选是该前序后代，缺对象或另一条历史仍失败关闭，不能用首次 push 绕过来源门禁。
- 反例被写入现有 CI 权威测试；impact `17/17`、target contract、系统 YAML 解析与 diff check 通过。以 accepted predecessor 到当前提交的真实分类结果为 `lane=base`、`run_base=true`、contract valid；本修改自身属于 workflow authority，因此下一次 main push 必须运行完整 Base/Windows/macOS lane，而不是借 docs-only 跳过。
- `Release e-Mate` 在普通 push 下仅执行 `inputs.publish == false` 的 build/clean-install/evidence 路径；R2 job 只接受显式 `workflow_dispatch publish=true`，本次没有发布 npm 或 R2 对象。

## 2026-08-20 · 2.0.11 S31 Linux Base SDK 与平台 runtime 解耦

- 新仓库 exact-SHA Base CI run `32320697231` 的 Harness build、目标合同和 release carrier 全部通过，随后在 Ubuntu 的 Base SDK cache miss 路径失败：`yarn build` 调用 `prepare-python-runtime.mjs`，该脚本正确拒绝 `linux-x64`。Windows/macOS Job 因 source 失败尚未启动；这证明旧仓库已有 cache 曾遮蔽首个 clean Base SDK seed。
- Desktop 只拆出一个复用原构建命令的 `build:sdk` script；完整 `build` 仍严格执行 `prepare:python && build:sdk`，安装器和平台发布没有获得跳过 runtime 的入口。Ubuntu Base SDK Job 只编译其 manifest 实际收录的 Harness/Desktop lib、Profile 与图标，不下载也不收录 macOS/Windows Python；对应平台 Job 仍在原生 runner 准备并验证自己的 runtime closure。
- Package 行为测试同时锁定完整 build 必须保留 Python preparation、SDK build 不得包含它，既有打包测试改为检查共享 `build:sdk` 中仍包含 Profile 同步与图标生成。聚焦结果为 package `22/22`、impact `17/17`、target contract、YAML、diff check，以及不执行 Python 下载的完整 SDK 编译成功。
- `main` 已启用强制 PR、线性历史、禁止强推/删除及 required `CI admission`；本修复从独立分支提交并经 PR 验收，不再直接写受保护主线。

## 2026-08-20 · 2.0.11 S32 新公开仓库专用 Profile 签名根

- 新公开仓库不能读取或迁移旧仓库 environment secret 的值，而 Base 中原 `e41eaa8769570d58` 信任根对应的私钥在当前发布环境不可用。继续保留它会让所有 production Profile bootstrap 在签名前永久失败；因此没有改名复用未知旧 secret，也没有绕过签名。
- 为 `zyfjacksonchen-source/e-Mate-2.0.11` 独立生成 Ed25519 发布根。Base 只提交 SPKI 公钥及其 SHA-256 前 16 位 key id `e0a81164526dcbcd`；PKCS#8 私钥和同一 key id 分别进入受保护 `r2-publish` environment 的 `EMATE_PROFILE_SIGNING_PRIVATE_KEY`、`EMATE_PROFILE_SIGNING_KEY_ID`，本机临时私钥在公私钥匹配验证和 Secret 写入后立即删除。
- 真实公私钥匹配检查通过；影响分类/Profile 组合/Profile publisher 聚焦回归 `21/21`、target pin 与 diff check 通过。信任根是 Base 发布输入，本切片必须经过新的 Base lane；R2 access secrets、当前 SHA 的性能/平台收据和三个公开 desired-state 仍未就绪，因此没有触发 bootstrap 或线上写入。

## 2026-08-20 · 2.0.11 S33 首代 Profile 跨平台组件构建闭环

- 新仓库首次 production Profile bootstrap run `32326434019` 在任何 R2 写入前安全失败：12 个组件目标成功，Windows 的 Computer Use、Xin Assistant 与 portable Shell 三个目标失败，三个完整 generation 和发布 Job 均跳过，公开 desired-state 未被部分激活。
- 两个 Windows 目标的共同根因是 workflow 在 PowerShell 中使用 Bash 的 `$COMPONENT` 语法，pnpm 实际收到空 filter 并以“没有匹配项目”返回成功，直到 emitter 才发现 `lib` 不存在。组件 build/test 现固定使用 Bash、`set -euo pipefail` 与同一个环境变量；Computer Use 构建同时只在 Darwin 复制并校验原生 helper，Windows payload 明确删除 macOS native 目录，与 inventory 的 `native_paths: []` 一致。
- Shell 失败来自自身测试读取 blocked GenUI 的已组装 bundle，令一个 hot-profile 组件无法独立构建。该跨组件断言已从 Shell owner 删除；GenUI 的注册和发布边界仍由其自身组件/完整组合门禁负责，不把另一组件的生成物塞进 Shell SDK。
- 聚焦验证为仓库影响合同 `17/17`、Shell `38/38`、Computer Use `2/2`、组件 payload/Profile 组合 `11/11`，diff check 通过。本切片触及发布 workflow 与 platform component build，正确进入一次 Base lane；只有新 main exact-SHA CI 和复跑 bootstrap 成功后才允许签名并发布首代 generation。

## 2026-08-20 · 2.0.11 S34 下载页版本绑定与 Linux Base 构建反例

- PR `#3` 的首次远端门禁证明跨平台修复还有一个共享调用方：Computer Use 为 Windows payload 删除 macOS helper 时也在 Linux Base SDK 构建中删除了同一目录，随后 CLI bundle 同步因 `native` 不存在而失败。构建脚本现在只在 Windows 删除 native closure、macOS 从固定上游重建并校验、Linux 保留仓库内已固定的 Base SDK 输入；平台 payload 的目标隔离合同没有放宽。
- 正式下载页脚本此前仍把 manifest 版本与两个安装包文件名固定为 `2.0.10`，且只接受三项 artifact 字段，遗漏真实发布器已固定的 `build_source_commit/build_run_id`。即使 2.0.11 `desktop/latest.json` 正确激活，页面也会按设计 fail closed 成“暂时无法下载”。页面现精确绑定 2.0.11，并严格接受、校验五项 provenance 字段；内容哈希文件更新为 `site.fc9d1cdb2ddd.js`。首页和 macOS 未签名图解同时说明全新安装 2.0.11、已安装 2.0.10 可在应用内确认更新。
- Codex 原生 Cloudflare OAuth 已确认可直接列举、读取和上传 R2 对象，单对象 API 上限 300 MB；后续发布无需创建或复制长期 R2 密钥。当前只完成能力只读确认，尚未上传安装器、覆盖 `desktop/latest.json` 或修改官网下载线上对象。
- Computer Use、release 与 impact 聚焦回归合计 `28/28`，diff check 通过。下载页和发布脚本属于 Base 发布输入，本切片继续由同一 PR 的 Base lane 验证；R2 仍须先上传 immutable 2.0.11 制品并公开回读，最后才能激活 latest 和上线页面。

## 2026-08-20 · 2.0.11 S35 原生 Cloudflare Profile 发布权威

- PR `#3` 已在公开仓库通过 exact-SHA Base、Windows unsigned、macOS universal unsigned、npm 三目标 clean-install 与 `CI admission`，随后以 squash commit `a9642a785617d3499cf986cc075fd814d7ddc6e1` 合入受保护 `main`。R2 `desktop/latest.json` 在此期间继续指向 2.0.10，没有用 PR 或半完成字节提前覆盖稳定入口。
- 新仓库的受保护环境持有 Profile Ed25519 私钥，但没有也不应复制旧 R2 S3 长期密钥；用户已连接 Codex 原生 Cloudflare 插件。Profile workflow 因此只承担它唯一能安全完成的职责：接受 exact main CI、构建/组合目标组件、用 Base 信任根生产签名，并输出一个有界 publication bundle。旧的 AWS CLI、API-token 派生 S3 凭据和 workflow 内直接写 R2 路径已删除，避免仓库保留第二套发布权威。
- `publication-plan.json` 将 immutable component/release 对象与三个 `no-store` activation pointer 分目录，逐项固定 key、URL、相对路径、content type、cache control、bytes、SHA-256，并记录 source commit、accepted CI run、preparation run、target generation/sequence/parent/changed set 及准备时公开 current pointer 的 bytes/SHA。Codex 原生 Cloudflare 插件必须先上传并公开回读全部 immutable 字节，再逐目标复核 expected current，最后写 activation；不同字节撞同 immutable key、父代变化或部分旧候选都会失败关闭。
- 单元行为测试真实复制并逐文件回读 bootstrap 与 successor bundle，证明 activation 与 immutable 对象物理隔离、bootstrap expected current 为 null、successor 绑定 64 位旧指针摘要；workflow 合同还明确拒绝重新出现 R2/AWS secret。聚焦发布/分类测试 `18/18`、脚本语法与 diff check 通过。该 workflow authority 修改正确属于最后一次 Base lane；后续普通插件仍只生成变化组件、三目标组合与签名 publication bundle，不构建安装器。

## 2026-08-20 · 2.0.11 S36 Profile bootstrap 的 Windows 组件产物闭包

- exact main Profile bootstrap run `32333362899` 在 R2 写入前失败关闭：Windows Computer Use 已完成 build/test，但 emitter 因构建脚本提前删除 `native` allowlist 根目录而拒绝产物；Windows Xin Assistant 则因 npm script 直接执行 POSIX `.bin/tsdown`，在 `windows-2025` 上得到 command-not-found。其余组件目标成功，完整 generation 与签名 publication bundle 均未生成，线上 desired-state 没有部分激活。
- Computer Use 的 Windows 运行能力本就按 inventory 声明为 `runtime_abi: none`、`native_paths: []`；非 Darwin 构建现保留仓库固定的 macOS native 来源供统一 allowlist 枚举，再由既有 target filter 从 Windows payload 排除，也保持 Linux npm/Base SDK 输入可构建，不新增 Windows 自动化旁路。Xin 仅把同一固定 Harness `tsdown` 入口改为跨平台 `node …/dist/run.mjs`，没有改变编译参数或依赖闭包。CI changed-component 步骤与 bootstrap 共用显式 Bash 环境，避免 PowerShell 把 `$COMPONENT` 当空值后由 pnpm 假成功。
- 两条窄合同分别锁定 Windows 构建不得删除 allowlist 根和 Xin 必须使用 Node 入口。该修复触及两个 platform-profile 的构建来源，按仓库合同诚实进入一次 Base lane；只有新的 exact-main CI、正式安装器和 Profile bootstrap 全部通过后，才允许原生 Cloudflare 发布。

## 2026-08-20 · 2.0.11 S37 Base bootstrap 与平台组件变化可同时成立

- 公开主线 `211597338906ea3507e57451f01b1f73ce18397b` 的 exact-SHA CI、Windows/macOS unsigned installer 和 npm 三目标 clean-install 全部成功；首次 Profile bootstrap run `32337936610` 随后在任何签名或 R2 写入前失败。accepted impact 正确判为 Base lane，同时列出本批确实变化的 Computer Use 与 Xin 两个平台组件；发布 workflow 却额外要求 Base lane 的 `publish_components` 必须为空，和 bootstrap 后续“构建完整 accepted component matrix”的职责矛盾。
- 最小修复只删除这条互斥断言。bootstrap 仍必须绑定当前 `main` 的 exact successful CI、有效 Base contract、`CI admission`、Node/目标合同及 Windows/macOS installer 成功，并继续重建、组合、启动验证所有目标组件；普通 plugin-only 发布仍逐项要求 classifier 给出的变化组件 Job 和三平台完整 generation 成功，没有放宽 lane 或签名/R2 权限。
- 仓库合同新增反例，防止以后重新把“Base 发生变化”误写成“本批不能包含组件变化”。聚焦 release-boundary 测试 `17/17` 与 diff check 通过；该修复本身修改发布权威，按规则再次进入 Base lane。旧 SHA 的 Desktop 候选全部作废，只有新主线 exact-SHA 的 CI、签名 bundle、性能/Computer Use 收据及公开回读闭合后才允许激活线上入口。

## 2026-08-20 · 2.0.11 S38 芯助手退出 2.0.11 运行时组合

- exact-main Profile bootstrap run `32341826773` 在签名和 R2 写入前失败关闭：16 个目标通过，只有 Xin Assistant `win32-x64` 的组件测试把 `file://` pathname 错交给 Windows Python，随后完整 generation 与 publication bundle 全部跳过。用户明确决定芯助手不进入 2.0.11、留待后续版本继续开发，因此本轮不修补或绕过该组件门禁。
- 唯一 component inventory 现把 `@e-mate/dsh-plugin-xin-assistant` 标成 `desktop: blocked`、`cli: false`。同一真相源会让 CLI bundle 同步、Desktop fallback、Profile bootstrap、普通组件发布和完整 generation 全部排除它；组件源码仍保留，任何后续源码变化在重新准入前按 Base lane 失败关闭，不能以 plugin-only 偷渡回 2.0.11。
- Desktop 与 CLI 将芯助手加入 retired owner：升级/修复 Profile 时同时移除旧 manifest dependency、bundle 声明及残留 package 目录。Desktop 不再投影专供芯助手的 `EMATE_MANAGED_PYTHON_PATH`，但 Vision Toolkit 仍使用自己既有的受管 Python runtime；macOS universal merge allowlist 也删除芯助手原生目录。原生 platform component 验证改由仍在 2.0.11 的 Computer Use helper 承担。
- run `32339945078` 的 unsigned Desktop 字节虽已通过哈希、DMG、Universal、ad-hoc codesign、arm64 交互健康和 x86_64/Rosetta 启动验收，但它仍包含本次退出前的组合，现作废且不会上传 R2。只有本切片经受保护主线 Base/Windows/macOS 门禁重新构建后的 exact-SHA 产物才可继续性能、Computer Use、Cloudflare 与官网下载页发布。

## 2026-08-20 · 2.0.11 S39 Profile Base SDK 保留唯一组合注册表

- 芯助手退出后的公开主线 `6647da0b8b58bea60f2ca745dda81ee1a7722aa6` 已通过 exact-SHA CI run `32345100665` 和 build-only Release run `32345100809`。Profile bootstrap run `32347169086` 随后正确构建并验收 10 个组件、12 个目标，清单中没有 Xin Assistant；三个完整 generation 在签名和任何 R2 写入前统一失败关闭。
- 根因不是插件代码或目标不兼容，而是 accepted Base SDK 的 allowlist 排除了 `build/e-mate-profile/bundles/registry.json`。Desktop 的既有 `installEmateDesktopProfile` 即使从 content-addressed generation 读取组件，仍需这份 1,627-byte 注册表验证受管 package roster；缺失时在 Host boot 前得到 `ENOENT`，因此不能把坏 generation 签名或激活。
- 最小修复只把 `bundles/registry.json` 作为 Base 组合元数据加入 SDK，并把它纳入 SDK 完整性断言；同目录下任何其他 bundle 文件继续排除，组件代码和 payload 仍只能来自签名 generation。该文件由唯一 component inventory 生成，所以芯助手保持 blocked 后不会借注册表回到 2.0.11。
- 本地边界验证实际 emit 6,926 个 Base SDK 文件、135,218,474 bytes；断言证明 registry 存在且没有第二个 `bundles/**` payload，仓库 release boundary `17/17` 与 diff check 通过。该修改触及 Base SDK authority，必须经新 PR、exact-main CI/Release 和 Profile bootstrap 重跑；在三目标完整 generation、签名 publication bundle、性能/Computer Use 收据与公开回读全部闭合前仍不写 R2。

## 2026-08-20 · 2.0.11 S40 真实启动发现 pi-ai 隐藏 manifest 漏包

- 对公开主线 `f8d5aa6febe5983fb7999dfcd4ace84cb5c41faf` 的正式候选做用户授权的未签名启动时，Electron 主进程在 UI 健康前退出。直接执行候选二进制得到唯一根因：`@deepseek-ai/dsh-llm-pi-ai` 无法加载 `@earendil-works/pi-ai/dist/providers/data/.manifest.json`。源依赖树存在该 3,353-byte 文件，但 electron-builder 的普通 glob 忽略点文件；此前 exact-main CI、DMG/EXE 哈希和静态 inventory 因未把它列为运行时必需文件而全部假绿。该 SHA 的 macOS/Windows 安装器和离线 latest manifest 已明确作废，未上传 R2、未激活 Feed。
- 最小修复只在 Desktop `build.files` 精确加入这一文件，并把同一路径加入 afterPack 的物理运行时必需清单；package 配置测试和缺文件反例同步锁定它。聚焦回归为 `2 files / 55 tests`，change-impact 对四个修改文件实跑为 `lane=base`、`run_base=true`、合同有效，避免把 Base 打包闭包变化伪装成 plugin-only。
- 新的本机 arm64 目录封装已由 afterPack 通过，物理 `.manifest.json` 存在；候选随后完成 Host、Profile、Client Loader 和交互 UI 启动，显示 `2.0.11`，并使用测试账号完成真实企业登录。Full Access 会话中的 Bash 无 `sandbox escalation`，`command -v gh` 返回登录 Shell 的 `/Users/mac/.local/bin/gh`，证明 Finder 启动环境已恢复用户 PATH；`npx` 无输出经 `/bin/zsh -lic` 交叉验证为本机登录 Shell 本身未安装 npm/npx，不再误判为权限拒绝。
- 同一安装态的两轮 Bash Agent 指令分别显示首 token `8.2 s` / `8.7 s`、流式 `103 tok/s` / `71 tok/s`。原生 Computer Use Tool 随后通过 `computer_list_apps` 与 `computer_observe` 只读取得 Chrome 当前标签页及窗口标题，没有 `COMPUTER_PERMISSION_REQUIRED`、应用授权或 sandbox 错误；该轮显示首 token `8.1 s`、`73 tok/s`。这些是当前真实候选的单机样本，不冒充原始 DSH/2.0.8 的 30 组成对性能收据。
- 当前只证明本机 arm64 unpacked candidate 的根因修复和交互链。因为修复属于 Base lane，必须先进入受保护的新公开仓库主线，再重新取得同一 exact SHA 的 CI、Windows/macOS 正式未签名安装器、Profile bootstrap、性能与平台收据；旧 `f8d5aa6…` 产物不得复用。所有新证据通过前继续禁止 R2 写入和官网下载页激活。

## 2026-08-20 · 2.0.11 S41 Profile 内嵌 PTY 闭包进入真实打包边界

- Draft PR `#9` 的 Node 24/Base SDK、Windows 未签名安装器、npm 三目标 clean-install 与 release-set 全部通过；macOS universal Job 在 afterPack 正确失败，`CI admission` 因而保持关闭。真实缺项是 Profile 复制的 `dsh-better-sidebar/node_modules/node-pty@1.1.0`：源码树包含 darwin arm64/x64 prebuild，但 Electron Builder 的主应用文件收集不会保留 `build/**` 下嵌套的 `node_modules`，先前本机单架构候选也只带了 Better Sidebar 自身而没有其独立依赖闭包。
- 中间修补曾复用 Desktop `extraResources -> app.asar.unpacked`，只复制 nested PTY 运行闭包，并用两套真实 PTY smoke 证明缺项根因；但原生复审进一步确认该做法会把旧 `dsh-better-sidebar` 的平行 WebSocket、PTY registry 与非鉴权 trust fence 固化进 Base，仍违反插件优先和 DSH runtime 单一路径，因此该中间修补未获合并资格并被完整删除。
- 最终修复启用已有 `@e-mate/dsh-plugin-better-sidebar` hot-profile 组件，Desktop Profile、Host boot 与组合门禁均从同一 component inventory 取它；旧生态包被列入 retired migration 集合，安装/升级会移除它。同步、依赖、Yarn patch/lock、第三方清单、universal inventory 与 nested PTY verifier 同步删除旧闭包，文件浏览只走 DSH Connection RPC、Workspace/Session 与 `conversation.view` slot，终端继续由 pinned DSH 原生服务持有。
- 原生对照复审还发现本地 `package:dir` 没有调用正式 macOS 路径共用的 runtime prepare。修复仅把它接到现有 `prepareInstalledMacUniversalRuntime`，不增加第二套权限逻辑；正式 Sidebar 插件自身 `2/2`、Desktop Profile/生成/更新/打包聚焦合同 `9 files / 93 tests`、真实 Host Profile 与 Client Loader 均通过。完整 Desktop check 为 `52 files / 430 passed / 3 skipped`，197 个 first-party runtime 节点闭包和 534 个 production package license 门禁通过。真实 `package-dir.mjs` 的 afterPack/PTY smoke 退出 0，物理 app 只含官方 hot-profile bundle、无 legacy ecosystem/package。新的 PR exact-SHA CI 完成前仍禁止合并及 R2 写入。

## 2026-08-21 · 2.0.11 S42 Full Access 与插件权限边界回归原生合同

- 权限审计把五个互不替代的域写回当前合同：DSH `sandboxPolicy` 只管其定义的文件效果，`approval/policy` 只管原生审批，插件自己的 standing grant 只授权该插件资源，macOS TCC 只授权实际 helper 身份，Credentials/Skill/MCP/Host plugin 的持久变更各自需要精确用户动作。`danger-full-access` 不再被解释成 Computer Use 全应用授权；`approval: never` 的含义继续是审批型操作失败关闭，不是自动同意。
- Computer Use 删除 e-Mate 自建的 `standingFullAccess` 映射，恢复 pinned rc.7 的 `allowAllApps`/精确应用 grant → 原生 approval fallback → TCC helper health 单一路径。Desktop 同时删除用 Electron 主进程 `systemPreferences` 代替 Swift helper 判权的并行 setup Tool；设置、健康检查与打开系统设置继续由原生 Computer Use 插件拥有。真实发布仍必须完成“helper 授权 → 重启 → 组件更新 → health/observe/action”的安装态收据，不能由源码或 Electron TCC 状态推断。
- CDP 默认只读，并新增唯一、可撤销、绑定精确 loopback endpoint 的 Settings grant。能力中心的明确按钮和 Agent 的类型化 `browser_control_access` Tool 写入同一设置；自然语言路径必须经原生 `UserQuestions`。页面 mutation 的顺序固定为“endpoint-bound grant → session approval ask → never 时拒绝”，整个插件不读取文件 sandbox，也不恢复扩展、开发者模式或 load-unpacked 桥。端点变化后旧 grant 不复用的行为反例已纳入测试。
- `find-skill` 只保留发现，所有 Skill mutation 继续由 Skill Hub 的版本/SHA/WAL owner 处理；MCP Manage 只挂载固定审计目录中的 HTTPS 服务，旧 stdio/custom 配置只能列出和删除；Office、Vision 与内置 `image_pack` 在任何写入前读取 session sandbox，Memory 写入必须经过原生 `UserQuestions`。这些修复都在现有 DSH Tool/Settings/Job/Skill/approval seam 上完成，没有新增第二个执行器、secret store 或传输层。
- 每个第一方组件现在声明排序、闭集的 `authority_contract.effects/guards`。component emitter 将同值写入签名 manifest，Desktop materializer 在加载前要求 package metadata 与已验证 manifest 完全相等；权限扩张会进入 permission review，但只有 Desktop/helper/Base import/runtime ABI 变化才升级 Base lane。该 ledger 只用于准入、审计与更新确认展示，不冒充进程内 Cordis JavaScript 的安全沙箱。
- 聚焦证据为 CDP `8/8`、发布边界/组件 emitter/组合/R2 `32/32`、release topology `10/10`、Profile component/update/generation/release `19/19`、Desktop 权限与打包聚焦 `72/72`、Desktop TypeScript、DSH Profile `43/43` 与 Shell `38/38`。组件 runner 现在从根 `packageManager` 读取并强制 pnpm `11.7.0`，错误版本会在安装/构建前失败；13 个 accepted component 已以该精确版本从各自 frozen lock 重建。Vision `darwin-arm64` 为 `9/9`，其中包含 Base CPython 3.12.14 对三个签名 wheel 的真实断网安装与复用。17 份目标 manifest 均成功 emit，三平台各 `13/13` 组合/物化，generation 分别为 arm64 `39aaba9fda4eb443d6cb5eb841971ed9ba7ebade01b3be87e45f8f2840fae59f`、x64 `d9e1bda890adb7547ff2de1eca9bcd7f08dce0d1a7624eea3429f5af65437845`、Windows `89e12b7f1ff738fc8943c070ee2f4db2069a210f188e77d722d25512e81098bd`；arm64 的 Cordis Host、Web graph 与 Client Loader 完整启动通过。x64 本机 Rosetta Node 探针卡在 dyld，故这里只保留物化证据，真实执行交给 `macos-15-intel`；Windows 按用户边界只做物化。正式安装包、真实用户全工具/插件、在线签名更新与 R2 公共回读完成前，本切片不得写成发布完成。

## 2026-08-21 · 2.0.11 S43 Impact Job 的 wheel 校验依赖闭包

- Draft PR `#10` 的 exact-SHA CI run `32395061470` 在第一道 impact Job 安全失败，其余 Base、平台组件和安装器任务全部跳过。分类器本身 `18/18`、组件静态闭包门禁通过；失败来自 Profile 组合测试加载 `profile-component.ts` 时找不到 `fflate`。该依赖已由 Desktop 和 DSH 精确声明，但 impact Job 为保持轻量此前完全不安装依赖，新的 wheel 内 Mach-O/PE 校验让这一旧假设不再成立。
- 最小修复不复制 ZIP parser，也不安装 Desktop/Harness 全依赖：根开发合同精确声明同一 `fflate@0.8.3`，impact Job 通过根 `pnpm-lock.yaml` 执行 `pnpm install --frozen-lockfile --ignore-scripts` 后再运行边界测试。仓库测试锁定这一步必须位于 fail-closed classifier 测试之前，防止以后删除安装步骤后在冷 CI 再次假绿或失败。
- 本地按远端冷路径重新安装后，impact/emitter/Profile publication 为 `32/32`，release topology 为 `10/10`，diff check 通过。该修复修改 CI authority，因此继续属于同一 Base PR；只有更新后的 exact SHA 完整门禁通过才可合并。

## 2026-08-21 · 2.0.11 S44 平台组件复用 Base 的精确 CPython

- PR `#10` 更新后的 CI run `32395386973` 已通过 impact 与完整 Node 24/source Job，随后 macOS arm64、Intel、Windows 的 Vision compatibility 和两套 Desktop installer 都在 `actions/setup-python` 阶段失败：该 action 的公开 manifest 尚无 CPython `3.12.14`，所以没有任何组件测试或安装器构建被误报成功。Computer Use 的非 Python 路径继续独立运行。
- 产品的唯一 Python 权威本来就是 Desktop `prepare-python-runtime.mjs`：它固定 python-build-standalone release、三目标 archive SHA 和 CPython `3.12.14`，正式 App 也从这里取得运行时。组件矩阵与 Profile bootstrap 现复用同一脚本的目标选择入口，只下载当前 target 并把已校验解释器绝对路径交给 Vision；不再把 GitHub action 的可用版本清单当第二个 Base runtime。
- `actions/setup-python` 仍以可用的 `3.12` 运行 `prepare-wheels.py`，该脚本只下载、重签和确定性重打固定 wheel 字节，不进入最终产品运行时。目标脚本本机 arm64 成功、跨 host target 在下载前拒绝；CI classifier `18/18`、release topology `10/10`、三份 workflow YAML 和 diff check 通过。新 exact SHA 必须重跑六个原生组件 Job与两套安装器后才可合并。

## 2026-08-21 · 2.0.11 S45 Vision 跨平台 pinned source 与 Base SDK 解析闭环

- PR `#10` 的 exact-SHA CI run `32398433767` 已证明两套安装器能越过 Python、wheel 与 PTY 准备，但 Vision 的 Base compatibility 仍失败关闭。Windows 在构建阶段报告 pinned apply contract changed，根因是子模块自己的 checkout 换行策略把已固定 JavaScript 变成 CRLF；macOS 则在行为测试加载 Base import 时从 Desktop 包根解析，而该 Job 按合同只恢复 Base SDK 编译字节、不安装 Desktop 依赖树。
- Vision 构建现在只在读取 pinned upstream JavaScript 的单一边界把 CRLF 规范成 LF，并继续拒绝任何孤立 CR；所有 exact-once 补丁哨兵和 upstream commit 约束保持不变。生产 Profile resolver 只新增可注入的 Base runtime 解析锚点，默认仍是 Desktop；Vision 的 Base SDK 行为测试将非 Desktop 的声明导入指向 pinned Harness 已安装的原生 package graph，而 `@e-mate/desktop/vision-toolkit` 仍只从唯一 Desktop ABI seam 解析。没有复制 resolver、安装第二套 Desktop closure或放宽未声明 import。
- 本地以 Base CPython `3.12.14` 复跑 Vision `9/9`，覆盖签名 wheel 的断网安装/复用、managed Web 只读、工具 sandbox、Responses 与策略失败关闭；Desktop resolver `2/2`、release boundary/emitter `28/28`、diff check 通过。旧 SHA 的失败安装器和组件证据继续作废；只有新 exact SHA 在 Windows、arm64、Intel 与两套安装器门禁全部通过后才能合并，当前仍未写 R2 或激活官网下载入口。

## 2026-08-21 · 2.0.11 S46 DSH 原生附件拖拽遮罩恢复路径

- 真实安装态复现表明，文件拖入对话框后若 Chromium/macOS 没有送达预期的末端 `dragleave` 或 `drop`，pinned DSH 的全窗口附件遮罩会一直保持挂载；该遮罩没有显式关闭动作，用户只能退出应用。根因位于 DSH 原生 `DropOverlay` 与 `InputBar` 的共享拖拽状态，不在 e-Mate Shell、文件导入插件或 Desktop 登录状态，因此没有新增 e-Mate 覆盖层或平行文件处理器。
- 修复以公开 DSH PR `zyfjacksonchen-source/deepseek-harness#1` 合入提交 `2bc16230975f6cf02aa1b283b1f86de44007b059`：遮罩增加可访问的本地化关闭按钮与 `Escape`，所有拖拽完成、离开、投放、按钮关闭和键盘关闭都复用同一个 `InputBar` reset 路径。新提交相对旧 e-Mate pin `df78045a127e32cb5b942defba52c539590d1596` 的文件树只改变 16 个附件 UI、测试和配对文档文件，并保留既有 prompt 与冗余沙箱参数修复。
- DSH 聚焦测试 `73/73`，Client GUI `3788 passed / 1 skipped`，Web replay `253 passed / 15 skipped`；Host/Client TypeScript 与生产构建、Vite build、lint、翻译配对、文档同步/类型检查及 pre-push typecheck 均通过。e-Mate Base contract、组件 manifests、生成/发布测试和仓库级准则随后统一改钉新 commit；这是 Base 变更，必须重新取得 exact-SHA Base CI、Computer Use/Vision 六个原生目标兼容收据、两套未签名安装器及安装态遮罩回归，旧 `df78045…` 2.0.11 候选不得上线。

## 2026-08-21 · 2.0.11 S47 首个真实 Shell 差量发布切片

- exact-main `19b649d29c1284ee799e090f77bc4b505c4ea07d` 的 CI、未签名 Desktop build-only 与正式 universal DMG 已通过；安装态随后暴露一处静态测试未覆盖的 UI 根因：运行时状态、主题和设置仍显示在兼容模式侧栏底部。Shell 把它们注册到只由 AdvancedFrame 渲染的 `desktop.titlebar.utilities`，而 2.0.11 Desktop 按合同固定 compatibility mode，所以该入口在真实产品中不可达。
- 最小修复复用 pinned DSH 会话页头现有的 `conversation.session.header.utilities`，与分享按钮使用同一 `priority: -1` winner 集和 32px 中线；用户中心继续由独立 `sidebar.footer.action` 留在左下。会话路由隐藏侧栏的重复三按钮，首页、能力中心、设置和定时任务等没有会话页头的页面仍保留原入口；没有切换 Desktop 模式、增加 overlay、复制设置或身份逻辑。
- Shell SlotTestRuntime 与 Client 回归为 `39/39`；组件 runner 使用仓库固定 pnpm `11.7.0` 完成独立 frozen-lock build/test。change-impact 对 5 个 Shell 源码/测试文件和本节记录实跑为 `lane=plugin-only`、唯一 publish component `@e-mate/dsh-client-shell`、Base contract `e-mate-desktop-profile-v2-dsh-2bc16230975f` 有效。该切片明确不重建 654 MiB Desktop release set；只有 exact-main plugin CI、完整 accepted generation 组合、签名 R2 差量、用户确认重启与安装态顶栏回归全部通过后才算生效。
- 修复提交前先封存 exact-main 基线：Profile preparation run `32427734136` 绑定 accepted CI `32421847050`，经 Codex 原生 Cloudflare 通道发布 541 个不可变对象并逐一从 `r2.dev` 公网回读，`87,016,583` 字节全部通过计划 SHA-256；随后才激活 darwin-arm64 `3c45dc38…8a53`、darwin-x64 `ba629a4d…5b617`、win32-x64 `e51aabb5…e2b1` 三个 sequence `1` generation。激活后 R2 账本为 544 个对象、`87,044,440` 字节，三个 desired-state 公网字节与签名发布计划逐一一致；后续 Shell delta 必须以这三个 generation 为 `expected_current`，不得重发或覆盖本批不可变字节。

## 2026-08-21 · 2.0.11 S48 产品呈现、CDP 优先与 Computer Use 显式触发

- 主聊天此前直接呈现 pinned DSH 的 `tool-call` 行，Skill 搜索、详情解析和未知 Skill 等内部协议错误会以红色英文事件替代 Agent 面向用户的说明。最小修复只在 e-Mate Shell 产品呈现层隐藏 raw Tool/Skill 行；原始 call/result/error 继续留在 durable Session、审计和诊断链，Agent 仍以自然语言说明进度、结果与失败，不改 DSH 事件类型、存储或 Tool renderer。
- 普通产品界面隐藏会话 Hero/页头的 preset 标签、通用设置中的 preset 行、`Agent 预设` 与 `视觉工具` 导航。实现复用 Slot shadowing 和既有 Settings 对话框投影；pinned `standard/code/minimal/cordis` 文件、Creation Mode 原生开发能力、Vision Host/Client/Tool/Skill/ToolView/paste/artifact/health 均继续在组合中，隐藏不等于删除。
- CDP Profile 的 endpoint-bound control setting 默认开启且可从能力中心撤销；Chrome 自己的 `chrome://inspect/#remote-debugging` 安全开关仍是不可绕过的先决条件。系统提示把全部网页读取和操作固定为 CDP 第一优先级，扩展桥、开发者模式加载已解压扩展和 Computer Use 网页回退都不再是产品路径。
- Computer Use 的渐进式暴露入口增加当前轮硬门：只有最新 direct user message 含 Shell 序列化的 `<computer-use explicit="true">` 标记时，activation、Skill-result 自动暴露、已有 Agent 恢复和执行 Tool 才可通过；下一轮普通请求立即失效。其应用 grant、native approval 与 macOS TCC 仍沿用 pinned 原生链，文件 Full Access 不被解释为电脑操控同意。
- 聚焦检查为 Shell `41/41`、CDP `9/9`、Computer Use `2/2`。安装态另对用户报告的 `basic.txt` capsule 做了真实点击：pinned ProducedFiles → `workspaces.openPath` → macOS 原生 open 链成功在 TextEdit 打开 `/var/tmp/e-mate-2.0.11-acceptance.A44vN9/basic.txt` 并显示原始两行内容，因此没有基于单张截图另造文件打开器；若后续 exact 文件复现失败，只在现有 Host openPath 边界补可见错误回执。
- 该切片只触及 Shell、CDP 与 Computer Use 三个 Profile component；后续必须由 impact classifier 给出 plugin-only 组件集合，分别构建 changed payload，与已接受的其余组件组合完整三目标 generation，再做 renderer health/rollback 和公开 desired-state 回读。不得因此重建 2.0.11 Desktop 安装器或重跑无关插件。

## 2026-08-21 · 2.0.11 S49 分享入口回归原生 Session 导出

- pinned DSH rc.7 的正式闭环能力只有 Session ZIP；e-Mate 的 `/emate.share` 当前固定失败关闭，Desktop/Profile 没有公开分享 provider 配置源，旧公网 `/api/v1/shares` 与 `/s/*` 又实测为 HTTP 502。继续显示“分享服务不可用”会把尚未部署的外部服务冒充成产品能力。
- Shell 顶部入口因此收敛为“导出当前任务”，直接调用既有 `sessionLogDownload.download` 并复用同一 store、Modal、错误状态与附件归档，不新增上传、存储、链接或第二套 Session transport；已无消费者的 `callShare` 注入同步删除。公开链接所需的认证发布、不可变存储、安全渲染、过期与撤销仍须作为独立 Cloud Share 服务切片，经真实公网 create/read/revoke 验收后才能恢复 UI。
- 精确 pnpm `11.7.0` 下 Shell component runner 为 `8 files / 41 tests`，CDP `9/9`、Computer Use `2/2`；仓库 impact/emitter/完整组合边界为 `32/32`，diff check 通过。该批仍是三个 changed Profile components 的 plugin-only 候选，不触发 Desktop Base 或安装器重建。

## 2026-08-21 · 2.0.11 S50 图片事件冷读兼容回归 DSH Session 原生合同

- 用户会话的 `SessionFormatUnsupportedError` 不是日志损坏：e-Mate 的 Base Host 通过 rc.7 `Session.append` 写入了下游 `emate/image-output`，但 declaration merge 只增加 TypeScript 词汇，rc.7 首个下游生产者尚无写入 envelope `ignorable: true` 的 API。热会话可继续工作，JSONL 写侧也按设计先持久化；会话冷读时，原生 `assertEventsSupported` 才因未知且未标记的事件拒绝重放。
- 修复边界固定为一次 Base lane：在现有 `harness-runtime-adapters.mjs` 唯一装配点补 DSH 架构说明已预留的非 surface `ignorable` writer；`imagegen` 显式使用它；读取侧只把历史上精确的 `emate/image-output` 当作兼容事件。查看不改用户日志，其他未知且未标记事件继续拒绝，Shell 不捕获或隐藏格式错误，也不建立运行时 known-event registry。
- 现有日志及 `ImageAttachmentRef` 保持原样，可由修复后的 Base 恢复。该切片必须用未来写入 marker、未知事件负例、真实冷读和安装态受影响会话重开证明；在这些证据完成前不得把当前 Base 候选发布为 2.0.11。

## 2026-08-21 · 2.0.11 S51 在线分享恢复为可重启管理的 DSH Session ZIP 投影

- Creation Mode 不再定义一次动态包：S02/S49 已用原生 `conversation.session.header.utilities`、`sessionLogDownload` 与 Connection RPC 证明该 Host/Client seam，本片只是把同一已存在普通组件的失败关闭 provider 接到外部发布终态；动态复制同一按钮/RPC 会形成必须删除的第二路径，且无法代表外部 R2 生命周期。永久实现继续只有现有 Shell 组件和 `/emate.share` Host 插件。
- S49 的导出收敛保留为历史失败关闭记录；本片在已有身份与 Cloudflare 发布条件到齐后恢复同一顶部分享入口。Host 只调用 pinned `apiProxy.downloads.sessionLog({ includeDescendants: true })`，用现有 Model Gateway 短期会话凭据访问唯一 `/emate.share` provider；Client 不直接联网，也不建立第二套会话、事件、附件或本地分享状态源。
- 独立 Worker 只把不可变 Session ZIP 写入专用 `emate-session-shares` R2。owner 与当前 session id 的 SHA-256 形成有界、分页的活动索引；每次打开弹层都从服务回读，创建响应不确定时同样回读，因此关闭、重载或重启后仍能复制和撤销全部有效链接。公开页面只提供无脚本 ZIP 下载，链接七天过期；发布桶不参与，跨账号或跨会话列表失败关闭。
- 主代理聚焦验证为 Shell `8 files / 45 tests`、Host 分享和生图 envelope `2/2`、Worker `4/4`、Harness runtime/release provenance `16/16`，共享 DSH build 与 diff check 通过。Cloudflare 专用 bucket、生命周期和 Worker 尚未在本条证据时部署；只有真实账号完成 create → 关闭/重开回显 → public page/ZIP → revoke → 404/410 后才能记为生产闭环。

## 2026-08-21 · 2.0.11 S52 对话自然披露与原生流式渲染恢复

- 根因不是模型停止流式，也不是 GenUI 与 DSH 互斥，而是 Shell 新增的 `conversation.chat.node / assistant-step / priority -2` 包装器抢走了 pinned DSH priority `0` `AssistantNodeView` 的唯一所有权，并绕过 SlotRenderer 手工调用其他 entry。仓库里并不存在包装器假设的 priority `-1` legacy renderer；GenUI 原生也从未注册该 slot，只拥有 `tool.call.toolview`、input dock 与自身 fence DOM 增强。
- 最小修复是删除该 Shell 包装器，让 pinned DSH 原生 Assistant 重新直接接收 running/streaming 状态；不添加另一个 handoff、事件或 renderer。共存测试直接组合原生 `AssistantMarkdown` 与 GenUI fence，证明流式正文、Reasoning/Think、GenUI 内容同时可见，且只隐藏 GenUI 自己的原始 fence 代码块。

## 2026-08-21 · 2.0.11 S53 外部连接状态与连接 Skill 全局持久化

- 飞书换会话重复授权的根因不是 OAuth token 被 Session 清理：官方 Lark CLI 将 profile 固定在 `~/.lark-cli`、refresh token 固定在 OS keychain；旧连接流程却把 `lark-doc` 等依赖装进 `skills-bridge/tmp`，且每次都先执行 `config init --new` 与 `auth login`，新 Session 看不到临时 Skill 后就错误重建连接。
- 修复复用 pinned `dsh-find-skill` 的 global managed provider，不建立另一套 connector store。`skill_install` 只对部署配置中的精确外部连接来源开放，网络动作前经原生 UserQuestions 确认并强制 global；任意其他来源失败关闭，普通社区 Skill 仍只走 Skill Hub。启动时只把 receipt 来源命中该白名单的旧 temp 目录原子迁到 global，普通临时 Skill 原样保留。
- 飞书工作流固定官方 CLI `1.0.88`，先执行 `auth status --json --verify`；已有有效 profile/token/scope 时跳过全部授权，只在真实 `not_configured`、过期、撤销或缺 scope 时分别执行一次 config/login。腾讯文档、钉钉和微信同样以 DSH Credentials/connector online 状态为设备级真值；Session 只拥有本次 Job 和取消，不拥有连接或凭据。

## 2026-08-21 · 2.0.11 S54 Skill Hub 与在线分享生产服务验收

- Codex 原生 Cloudflare 通道已部署 `emate-skill-hub` Worker（deployment `22b89fb0ab5b40c59c22502ddd4b4597`），绑定 APAC D1 `emate-skill-hub` 与专用 R2 `emate-skill-hub-packages`。客户端和身份传输的唯一默认根已切到该 Worker，仍由 Model Gateway 短期 session token 经 `/v1/consents/current` 验证。真实账号完成不可变 Skill 的 publish → search/detail → download/native inspect → intent/claim/complete/reconcile → owned readback → tombstone/delete replay；测试 publication 已 tombstone，不留公开目录项。
- Codex 原生 Cloudflare 通道已部署 `emate-share` Worker（deployment `b70b0c38c3b5478cabe4f6540c1bee1d`），workers.dev 入口启用且 preview 关闭，只绑定专用 APAC R2 `emate-session-shares`。生命周期精确为对象七天删除、未完成 multipart 一天终止；发布桶未绑定。公网 `/healthz` 返回 200；真实账号以一份有效 Session ZIP 完成 create `201`、owner/session list `200`、公开页面与原字节 ZIP `200`、revoke `200`、撤销后 `404`、重复 revoke `200`，并在结束前确认列表为空。
- 本机过期刷新凭据在验收开始时被身份服务正确拒绝；使用测试账号重新登录并选择记住登录后，新的 OS Keychain 全局会话生效。该状态属于设备账号而非当前 Session，后续新会话不得触发第二次登录。Worker/Client 不保存账号密码，验收输出也不包含 token。
- 当前源码窄门禁：Share Worker `4/4`、Skill Hub Worker `4/4`、Skill Hub 组件 `17/17`、find-skill `8/8`、Shell `45/45`、Host/Profile 聚焦 `4/4`、Harness adapters `6/6`、release provenance `11/11`，`@e-mate/dsh` build 与 diff check 通过。服务闭环不等于 Desktop 发布完成；必须由本次 Base 源重新构建、安装并在真实 UI 复验后，才允许更新 Desktop/Profile activation。

## 2026-08-21 · 2.0.11 S55 Base v3 兼容边界

- S50/S51 改变了组件可依赖的 Base 行为：Session 下游事件 writer/legacy reader seam 以及 `/emate.share` Host 均不存在于已安装的 v2 Base；Skill Hub 的新 Model Gateway token 传输也须与新组件同时落地。继续沿用 v2 id 会让旧 Base 错误接受新 Shell/Skill Hub generation，形成“先热更、后不可用”的兼容性假绿。
- 当前唯一 Base id 因此提升为 `e-mate-desktop-profile-v3-dsh-2bc16230975f`，全部 accepted/blocked component manifest 精确绑定 v3。旧 v2 Base 看到 v3 desired state 必须在下载组件前返回 `base-required`；只有新 Base 安装并通过 Renderer health 后才允许激活 v3 generation。本次一次性重建完整组件集合是 ABI 变化的必要成本，后续不触及 Base/ABI 的单组件变化仍走 plugin-only。
- 仓库 release boundary `37/37`、Desktop Profile parser/generation `17/17` 与 exact contract check 已通过；当前合同真相源返回 v3。正式发布仍须验证旧 v2 Base → v3 release 的 `base-required` 与新 Base → v3 generation 的原子启动/回滚。

## 2026-08-21 · 2.0.11 S56 Desktop Session 运行时封装闭环与 Base v4

- 正式 v3 DMG 的真实安装态重开 `测试生成图片` 会话仍触发 `SessionFormatUnsupportedError`。写入 Profile 已携带 `ignorable: true`，但 `harness-runtime-adapters.mjs` 只修改 CLI/Harness 的 pnpm 组装树；Electron Builder 实际封装的是 Desktop 自己的 Yarn 依赖树，最终 `app.asar.unpacked/node_modules/@deepseek-ai/dsh-session{,-persistence}` 保持原始 rc.7，导致插件启动前的冷读边界先拒绝历史 `emate/image-output`。
- 修复复用 Desktop 已有的 Yarn patch 单一路径：`dsh-session` 只持久化显式 `ignorable: true`，`dsh-session-persistence` 只兼容历史上精确的 `emate/image-output`；其他未知且未标记事件继续失败关闭。Desktop package 行为测试直接执行最终依赖字节，证明新写入 envelope、生图历史冷读与未知事件负例，不再只测试 CLI 组装器源码。
- v3 Base 已经存在且不具备该运行时行为，因此当前唯一 Base id 提升为 `e-mate-desktop-profile-v4-dsh-2bc16230975f`，所有组件精确绑定 v4；v3 必须在下载 v4 generation 前返回 `base-required`。正式发布必须以新 DMG 安装后重开原受影响会话作为收据，再完成完整组件 generation 与在线原子更新，旧 v3 构建不得激活。

## 2026-08-21 · 2.0.11 S57 连接 Skill 的签名全局投影

- 飞书重复授权并非 provider token 失效：以官方 `@larksuite/cli@1.0.88 auth status --json --verify` 只读核验得到 `verified: true`。真正被 Agent 加载的 `$DSH_HOME/skills-bridge/global/connect-feishu-cli` 仍来自 2.0.9 `skills-v2.0.9-r2`，旧说明固定执行 `config init --new` 与 `auth login`；它覆盖了仓库中已改为“先 status、有效即复用”的 2.0.11 指令。
- 永久修复仍落在现有 find-skill Profile component，不新增连接或凭据 store：四个第一方 bootstrap Skill 作为签名组件字节随包发货，启动时在 provider 注册前投影到同一个 DSH global managed root。只允许缺失目录、精确已知旧 e-Mate 来源或本组件上次写入的 receipt 更新；任意用户自有同名来源保持原样并报告冲突。切换使用同卷 staging/backup 与启动恢复，绝不读取、重置或迁移 `~/.lark-cli`、OS Keychain、DSH Credentials 或 IM 状态。
- 远程安装白名单收窄为官方 `larksuite/cli` 域 Skill；四个 bootstrap Skill 已随组件存在，不再运行时下载自身。该改动只属于 `@e-mate/dsh-plugin-find-skill`，若组件门禁、完整 generation 组合与安装态跨会话复用均通过，必须保持 plugin-only，不得重建 Desktop Base。

## 2026-08-21 · 2.0.11 S58 Chrome 原生 CDP 一次性启用入口

- 安装态的 e-Mate CDP control grant 已默认开启，但 `127.0.0.1:9222` 没有监听；Chrome `chrome://inspect/#remote-debugging` 明确显示尚未勾选的原生安全开关。Chrome 136 起默认用户数据目录又会忽略启动参数式 remote-debugging，因此“不弹确认直接控制当前已登录 Chrome”只能通过改偏好或换隔离 profile，二者都不符合当前用户状态与 Chrome 安全边界；旧扩展桥也不应复活。
- CDP 能力卡只新增一个显式用户动作，使用现有 DSH Subprocess 以固定参数打开 Chrome 原生设置页；不编辑 Chrome 文件、不点击安全开关、不增加扩展、IPC、浏览器进程管理器或第二套授权。Chrome 一次确认后由浏览器自身全局保持，e-Mate 的 endpoint-bound control grant 仍可独立撤销。
- CDP `10/10`、find-skill `10/10`、仓库分类/组件产物合同 `29/29` 通过；当前实际 diff 被唯一分类器判为 `plugin-only`，只发布两个 portable component：`@e-mate/dsh-plugin-cdp` 与 `@e-mate/dsh-plugin-find-skill`，`run_base=false`、Base v4 合同有效。完整 generation 与安装态确认仍须以提交后的精确组件字节验证。

## 2026-08-21 · 2.0.11 S59 原生进度自然披露与 Base v5

- S52 只删除了 Shell 对 `assistant-step` 的临时覆盖，流式正文与 GenUI 已回到 pinned DSH 单一路径；用户安装态仍出现“X 次工具调用，Y 条消息”，根因是 Base 继续预装第三方 `dsh-turn-fold@0.2.2`。该包以 `priority:-1` 同时 shadow 原生 `assistant-step`、`tool-call` 与 `context`，并把未记录过的 turn 状态硬编码为默认折叠，因此不是 DSH 原生行为，也不是 GenUI 互斥。
- 最小根因修复从受管 Profile roster、打包闭包和 Loader 必需集合删除 `dsh-turn-fold`，并把它列入 retired package，使已有安装升级时清退旧目录。热更新 Shell 只读取既有 `chat.order/nodes`：Agent 自然语言进度、结果、失败、图片与中断继续交给 priority `0` 的原生 `AssistantNodeView` 并保留 streaming；Reasoning/Think、Tool 与 Context 过程默认收进每回合唯一的“运行过程”折叠行，展开时仍委托原生 renderer 和既有 `tool.call.toolview` winner（含 GenUI）。没有 DOM observer、自动点击、新事件、第二 Store 或第二 transport。
- 旧 Base v4 自带该包，无法由普通组件 generation 从磁盘与 Cordis 组合中安全移除；Base 合同因此提升为 `e-mate-desktop-profile-v5-dsh-2bc16230975f`。已启动但未签发、未上传的 v4 Profile bootstrap 被停止，避免发布已知错误基线；本次一次性 Base/完整 generation 成本完成后，不触及 Base roster 的 CDP、连接 Skill 或其他业务插件变化仍必须保持 component-only。
- 当前窄验证收据：Shell 聚焦折叠/原生流式/GenUI 共存 `9/9`、Shell 全量 `47/47`、Profile 安装与旧包清退 `5/5`、Profile component/generation/release/update `19/19`、仓库 release boundary `37/37`；Shell 重建、Desktop Profile 同步、Host/Web/Client Loader 启动图与 diff check 均通过。正式完成仍以 Base v5 CI、安装态真实会话流式/展开回归及在线完整 generation 健康提交为准。

## 2026-08-21 · 2.0.11 S60 rc.7 原生渐进 Tool 披露与会话按钮单一归属

- 本片先按仓库第一准则重新解析当前 Base，而不是跟随外部 `latest`：唯一证据基线为 `e-mate-desktop-profile-v5-dsh-2bc16230975f`、Harness `0.1.0-rc.7@2bc16230975f6cf02aa1b283b1f86de44007b059` 与 Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`。`AGENTS.md`、目标合同与 release-boundary 反例现共同锁住该规则；不同 RC、浮动分支或未固定 checkout 不能再被写成“DSH 原生”。当前 Codex Host 没有暴露 shipped Cordis inspection provider；在已读完同一 rc.7 Creation Mode 两份 Skill 后，因 `ToolRuntime.restrict()`、`agent/created`、`tools/change` 与 Agent Loop `request/header.tools` 均可由固定运行时直接行为测试，未为这次已知 seam 另造 process-local 动态包或伪造 inspect 收据。
- 开源 `vibeinging/dsh-tool-search@265ce76eda21b211dc4a4c8f30d73a6826f035ca` 只作为 MIT 算法来源；产品实现是第一方 `@e-mate/dsh-plugin-tool-search` hot-profile component。它不代理执行，也不复制 Tool registry：每个 Agent 只叠加原生 `agent.ctx.tools.restrict()` 与一个 `tool_search`，匹配后下一 model step 仍从原始 definition 执行；Code Mode 的 `run_code`/SDK 保持原样，browser Tools 常驻以保证 CDP 第一优先，Computer Use 继续延迟到显式用户触发。恢复只读取 pinned Agent Loop 已写的 `request/header.tools`，不新增下游 Session event。
- 组件运行合同为 `7/7`：含独立 restriction 交集、动态 Tool 变化、重启 header 恢复、Code Mode 拒绝、dispose 恢复，以及 70 个原生 Tool 的请求面只保留 `tool_search`、初始 schema 字节至少下降 90% 后再精确披露一个原 Tool。组件自身 frozen-lock build/test 通过；payload 为 8 个文件、98,100 bytes，Base import 只有 `@deepseek-ai/dsh-tools`，authority 只有 `session-scope`。仓库 impact/component/release 行为测试分别证明新 inventory 初次进入 Base v5，而后续普通 Tool Search 源码只产生一个 `plugin-only` portable Job；签名 successor 合同只替换 changed manifest，沿用 accepted set 的所有其他引用。
- 用户截图中的两组三按钮不是 CSS 重复，而是会话选择使用 `history.pushState` 后没有通知 Sidebar 的 route store：URL 已变为 `/chat/...`，侧栏仍保留首页状态，于是侧栏底部与 `conversation.session.header.utilities` 同时呈现。唯一会话路由入口现于 push 后发出标准 `popstate`，不增加第二份按钮显隐状态；进入会话只保留页头一组，离开会话才恢复侧栏底部一组。聚焦路由/侧栏 `18/18`、Shell 全量 `48/48` 通过。
- 复用已验收的 12 个未变化 v5 component artifact，仅重发本提交的 Shell `2,481,536` bytes 和 Tool Search `98,100` bytes，组成 darwin-arm64 14/14 generation `8f8b41c2635e63fe9f82a4e5f4c73de9e5e104d247b795b3e4821fce273c8bc8`。一次性 SDK 清单更新后，完整 Host、Web graph、Client Loader、初始 `tool_search` 可见、`office_write` 初始隐藏及通过 search 恢复原 Tool 的行为 smoke 全部通过。该本地 envelope 使用 ephemeral CI key，未上传或激活；生产仍须 exact-main CI、受保护签名、R2 immutable 回读、用户确认重启和安装态重复按钮/Tool 披露验收。

## 2026-08-22 · 2.0.11 S61 跨 Base 的完整 Profile bootstrap

- PR `#24` 的 Base v5 门禁为 `11` 个成功、`0` 个失败，精确 merge tree 为 `a392f004bf2fbfcda563727b75152671f419a897`。Profile preparation `32501390771` 复用已接受的 PR CI `32499340093`，18 个组件目标和三目标 14/14 generation 组合全部通过；最后一步在任何 R2 上传前失败关闭。公网 desired-state 实际并非空白，而是 Base v2 sequence `4`、13 组件。发布器错误地先用 Base v5 的 14 组件 inventory 校验这个已签旧 Base release，因而报 `signed Profile release does not contain the complete runtime component set`。
- 最小修复只修改发布验证边界：先用同一受信 Ed25519 key 验签和目标校验公开 current，再调用现有 `selectProfileRelease`。仅当结果精确为 `base-required` 时，允许 sequence `1`、无 parent、完整 changed set 的新 Base bootstrap 以 CAS 替换稳定指针；当前 release 已兼容新 Base 时仍禁止非幂等 bootstrap，普通 successor 遇到跨 Base current 仍失败关闭。不可变组件、完整三目标、签名、公开 current SHA 与最后激活顺序均未放宽。
- 聚焦回归为 release boundary + publication `20/20`；真实三个公开 v2 envelope 在 Base v5 下均解析为 `base-required`。本修复仍需独立受保护 CI 后重跑 preparation；已失败 run 没有 publication artifact、没有上传、没有 desired-state 激活，线上 sequence `4` 保持不变。

## 2026-08-22 · 2.0.11 S62 会话工具按钮单一可见所有权

- S60 用 URL 路由决定侧栏底部三按钮是否可见，仍会在恢复态或非标准导航下与 Session header 同时出现。真正稳定的边界是 DSH `sessions.current`：存在当前会话时，状态、主题和设置只由 `conversation.session.header.utilities` 呈现；不存在当前会话时才显示侧栏入口。
- `sidebar.settings` 仍按 pinned DSH 合同挂载为唯一设置 Shell owner，会话中仅隐藏其触发器，页头设置按钮继续点击同一个原生 trigger 并打开同一面板；没有复制设置状态、Modal 或路由。Shell 全量 `48/48` 与 diff check 通过，本次仍是 Shell component-only 候选。

## 2026-08-22 · 2.0.11 S63 Base SDK 跨工作流使用精确 CI 产物

- Base v5 的 accepted PR CI 已生成并验证正确 SDK，但正式 Profile bootstrap 仍通过 Actions cache key 恢复；PR 作用域 cache 不对后续 `main` workflow dispatch 可见，导致第一次 bootstrap 在构建任何组件前失败，必须额外跑一次内容相同的 main Base CI 才能 seed cache。这不是产品变更需要全量重验，而是把性能缓存误作发布证据。
- 最小修复不改变 `base-sdk.mjs`、Base ABI 或组件构建：Base source Job 在既有 emit/verify 后把 `.release-cache/base-sdk` 上传为 `e-mate-base-sdk-<tested-source-sha>` run artifact；Profile bootstrap 的组件矩阵与三目标组合只从用户指定且已验收的 `ci_run_id` 下载该同名 artifact，再由原 manifest/bytes/SHA 校验并安装。Actions cache 继续加速同一 CI 内部 Job，但不再跨工作流授权发布。
- 仓库合同测试锁定 source artifact 名、30 天保留、hidden-path 上传，以及两个 bootstrap Job 的 exact run-id/source-SHA 下载；同时明确禁止它们退回 fingerprint/cache-hit 恢复。该 workflow authority 变更按分类器进入一次 Base lane；完成后后续 Base bootstrap 不再为“让缓存可见”重复全量主分支 CI，普通 plugin-only 发布路径仍不构建 Base。

## 2026-08-22 · 2.0.11 S64 Base v5 与首个生产 Shell-only 增量发布收据

- Base v5 的 exact-main Desktop build-only run `32512210610` 绑定提交 `4a7b7473e0aceb27d4bc315a78bc33c2086fe7f7`，总历时 `24m07s`。正式候选为 macOS universal DMG `390,572,468` bytes / SHA-256 `37b12dd2970aa776504c36c401f0d2922af49552c7b84b44fcf4ae7077c57faa` 与 Windows x64 EXE `272,988,796` bytes / SHA-256 `763a33363a24955feb40f3cba53e0203896ab0d94a6553bdfb81c71d858b0e34`；公网 `desktop/latest.json` 为 `948` bytes / SHA-256 `d5365c88aea2ca878639a9e0a910b674f51e0593ce2d42628f031daaf4962998`，并保持相同 build run、commit、bytes 与 hash provenance。GitHub publish run `32514763317` 因公开仓库缺少 R2 secrets 在上传前 `40s` 失败关闭，未改 stable pointer；随后只用 Codex 原生 Cloudflare 通道上传上述两个固定 key/size/hash 对象并完成公网流式重哈希，CAS 最后激活同一 `latest.json`。
- Base v5 Profile bootstrap plan 绑定 accepted CI `32503222914`、preparation `32505973544` 与 source `d26fc9495d06c4a39dea8a3343aed03c32dcd69f`，只在 558 个不可变对象、`87,189,329` bytes 完成 R2 metadata 与公网 SHA-256 回读后激活三个 sequence `1` generation：darwin-arm64 `2c7b277e76168ec7c9caea5f15119234b28b0d53ab7c7a5abb713790465e8f9c`、darwin-x64 `f22ca4e04362d200328dd297f8c6af3e8cab177d8f2133451e25750ca312ffa3`、win32-x64 `9e18edc235ff6da0353ffd58e2cda093e975dcb32758da7723b08f2dd4fb79e5`。这是新 Base 的一次性完整组件成本，不是普通插件发布路径。
- 会话按钮去重 PR 的 exact tested tree 为 `2219312087fa141204cd1c5bed7a225f29d65848`，CI run `32515746643` 总历时 `5m36s`：唯一 changed job `@e-mate/dsh-client-shell / portable` 为 `1m13s`，完整 accepted portable generation 组合为 `3m52s`，Desktop source、企业、Base compatibility、DMG 与 EXE Jobs 全部明确 skipped。合并后 release run `32516291689` 在 `1m33s` 内只验证既有 CI 并准备签名 publication；bootstrap 组件与三平台完整重建 Jobs 全部 skipped。
- 该 production successor 只含 Shell 的 14 个不可变文件、`2,514,488` bytes，三目标 `changed_components` 都精确为 `[@e-mate/dsh-client-shell]`；其他 13 个组件沿用 sequence `1` 的 manifest references。CAS 激活后公网 sequence `2` generation 为 darwin-arm64 `22ab3c312fd31a2b2ad20bb557f8aee579ef345064f3c84c7099d11aea1af5d1`、darwin-x64 `7a863d8d797bda3afb457f4604299bd8aca7ada60378f16e6f49baad0a2a3096`、win32-x64 `50905355430d296bd76e0c956281ed44f1bcb4bf2d0f2ef598cd50eb683f4981`；三个公开 desired-state 字节分别为 `af0e0562…f500`、`a62dd013…1871`、`b4b9b1ae…f156`，均已重新下载并与 activation plan 逐字节一致。
- 已安装 `/Applications/e-Mate.app` 通过中文“第 2 代组件可更新”确认，原子重启后 Renderer 恢复既有会话；generation state 最终为 `active = last_known_good = 22ab3c312fd31a2b2ad20bb557f8aee579ef345064f3c84c7099d11aea1af5d1`、`previous_known_good = bundled`。进入真实会话后页头只剩一组状态/主题/设置，侧栏底部只剩用户中心；离开会话回到首页时侧栏入口恢复。该机器此前没有接受 sequence `1`，因此本次从 bundled 直达 sequence `2` 的首次下载包含完整 generation；`2,514,488` bytes 的 production successor 与 CI/release skipped Jobs 才是“已有 v5 generation 后只发变化插件”的发布收据，不把一次性 bootstrap 冒充日常增量耗时。

## 2026-08-22 · 2.0.11 S65 Shell 重复工具入口增量热更新

- 根因是 Shell 同时在会话顶部和侧栏底部渲染运行状态、主题及设置入口，侧栏又依赖路由和当前会话状态决定是否显示，状态切换期间会出现两组控件。修复删除侧栏的可见副本，使会话顶部成为唯一可见所有者；侧栏仅保留隐藏的 DSH 原生 `sidebar.settings` 触发器供顶部设置按钮调用，并继续显示用户中心。未修改 Desktop Base、DSH core、会话、传输或设置协议。
- 源提交 `344a126813d660690c1eaf87de19cdc6418bb9c0` 经 PR #29 合并为 `7719116f0bc68c71fb0b55ff707c638a544a6cbb`。CI run `32518007484` 成功，只构建、测试并组合 `@e-mate/dsh-client-shell` portable 组件；Base、企业端、DMG、EXE 与 Base compatibility 均跳过，总耗时约 7 分钟。Profile release run `32518685586` 成功生成签名发布计划；R2 先写入并逐字节回读 14 个不可变对象，最后原子激活三个目标的第 3 代 desired state，发布辅助 Worker 随后删除。
- 安装态通过自然语言“检查并安装 e-Mate 组件更新”触发中文更新确认，界面明确显示仅更新 `@e-mate/dsh-client-shell 2.0.11`、下载约 2.4 MiB；用户确认后原子更新并重启。darwin-arm64 当前 generation 和 last-known-good 均为 `85d7e6700ba1762fb6a3e1d20dd9836a53eefaf1673f490689045ab4d1b9cfb8`，previous-known-good 保留第 2 代 `22ab3c312fd31a2b2ad20bb557f8aee579ef345064f3c84c7099d11aea1af5d1`。真实桌面验收确认顶部只剩一组运行状态、主题和设置按钮，侧栏底部只显示用户中心。

## 2026-08-22 · 2.0.11 S66 正式第 6 代组件、Computer Use 与官网下载链闭环

- 最终 Shell/Computer Use 候选提交 `4af100afa5329babf3283d5dbabdee91453d365a` 的 CI run `32545536456` 与 release run `32545894625` 均成功。CI 只构建变化的 `@e-mate/dsh-client-shell`、`@e-mate/dsh-plugin-computer-use`，并组合三目标完整 generation；Base、DMG、EXE 和未变化组件构建全部跳过。聚焦回归为 Shell `50/50`、Computer Use `2/2`，证明 10px 原生消息间距、同水平线控制项和 packaged helper 修复没有回退聊天框、DSH core 或 Desktop Base。
- Codex 原生 Cloudflare 通道上传并从公网逐字节回读 `189` 个不可变对象、`5,758,378` bytes，随后 CAS 激活第 `6` 代 desired state。三个 generation 为 darwin-arm64 `e4ec3a8825411e30fe084cf0a7554df13583ac5acb616ee17a59d16e4ac3ec35`、darwin-x64 `24998047e508f0a17a52187c911d1ade367bdf3f11b1933383dd19c696e699eb`、win32-x64 `bdc9054987f3e1fa4a50e7f6d89f391229ff5e8175d3b32ece0f2a9471bceb3c`；全部继续绑定 Base v5，changed set 仅含 Shell 与 Computer Use。
- 真实安装态先回到生产第 5 代，再以自然语言“检查并安装 e-Mate 更新”触发中文确认；对话框只列上述两个组件、下载 `3.7 MiB`。确认后完成下载、校验、原子切换与自动重启，状态为 `active = last_known_good = e4ec3a88…ec35`，第 5 代保留为 `previous_known_good`。重启后真实 `@电脑操控` 调用原生 helper 读取当前前台应用为 `e-Mate`，无 TCC、sandbox 或 approval 循环；该轮首 token `2.9s`、`96 tok/s`，三次 Tool 与三条 Think 默认收进唯一“运行过程”，Agent 原生结果留在折叠外。
- 官网以保留旧槽位的原子相对软链切到 `site-emate-2.0.11-4af100af-seq6`。公网 `index.html`、`install-macos.html`、JS 与 CSS 的 SHA-256 与仓库逐字节一致；真实 Chrome 显示 `2.0.11 · 正式未签名（ad-hoc）`、macOS Universal 下载和新版未签名图解。公开 `desktop/latest.json` 为 `d5365c88…2998`，不含 `mac-smoke`；从 R2 完整下载重哈希得到 macOS DMG `37b12dd2…7faa`、Windows EXE `763a3336…0e34`，与清单完全一致。Windows 按发布边界只校验公开字节，不执行安装态运行。

## 2026-08-22 · 2.0.11 S67 固化版本迭代准则与失败反思

- S39–S66 的主要反复不是“插件化无效”，而是把开发内循环、正式发布和用户终态验收混成一次全量动作：源码树/CLI 依赖通过后没有立刻核验最终 Desktop 封装字节，权限与持久状态被混为一个 Full Access，Actions cache 被当成跨 workflow 发布证据，publication plan 又曾被误认为已经上线。S64–S66 已实证普通 Shell 或 Shell+Computer Use 改动只需组件 CI/完整 generation，Base、DMG、EXE 和未变化组件全部 skipped；一次性 Base bootstrap 或新机从 `bundled` 下载完整 generation 不能冒充日常插件耗时。
- 根 `AGENTS.md` 现固定版本起点、当前 Base-bound DSH/Desktop reference、唯一 owner、Creation Mode、开发时间预算、四类发布 lane、Profile R2/CAS 次序、三目标部分激活恢复、Base→Profile bootstrap→官网顺序、真实父代自然语言更新，以及 `source fixed` / `candidate built` / `installed accepted` / `production released` 四级证据词。以后只有最后一级可称“已上线”；`profile-release.yml` 成功只代表 publication prepared，`mac-smoke` 永不进入 manifest、R2 或官网。
- 2.0.11 的永久失败账本同时锁住：源码树不等于封装产品、pnpm CLI 树不等于 Desktop Yarn 树、组件 inventory/renderer/UI 只能有一个 owner、Session 下游事件必须显式 ignorable 并冷读、五类权限互不继承、CDP 浏览器优先、外部凭据跨会话复用、跨 Base 先选择再 bootstrap、公网终态与成对性能证据。隐藏能力不等于退役；删除组件必须同时清理 inventory、loader、封装、依赖和安装迁移。
- 新仓库门禁不另造框架：`scripts/change-impact.test.mjs` 锁定上述语义锚点，并证明 `AGENTS.md`/目标合同只进入 `verification-only`、`run_base=false`、`run_plugins=false`；`scripts/component-release.test.mjs` 将 Desktop accepted set 从“数量 14”收紧为精确 ID 集合，GenUI 与 Vision Toolkit 不可被等量替换悄悄移出，芯助手保持唯一 blocked。聚焦收据为 release-boundary `20/20`、component payload `10/10`，完整 `pnpm run test:impact` 为 `34/34`；当前精确 diff 分类为 `verification-only`，不生成任何产品字节，因此本片明确不运行 Base、DMG、EXE、Profile/R2 或安装态发布。

## 2026-08-23 · 2.0.12 S00 固定基线、范围与直接开发计划

- 2.0.12 从已验收 2.0.11 提交 `6a7f4b9d59a1d8970345638946fb6564e2f5f93e` 开始；唯一 Base 仍为 `e-mate-desktop-profile-v5-dsh-2bc16230975f`，Harness 为 `0.1.0-rc.7@2bc16230975f6cf02aa1b283b1f86de44007b059`，Desktop reference 为 `6074088f5b660206e404b3591fab51fb99c69add`。没有用浮动分支、更新 RC 或另一个 Desktop 壳重新定义“原生”。本版本首次准入 AURA 动态登录页、Desktop 原生 vibrancy 半透明侧栏、Glass Composer 与 iDesign，因修改 Base contract、Desktop、inventory 和新组件集合，唯一 impact classifier 正确给出 `base`；后续已准入且兼容组件的小改仍必须回到 `plugin-only`，不得沿用本次首次 Base 成本。
- 设计实现只复用现有 Shell/Identity/Sidebar/Composer 语义节点与 Desktop advanced-frame contract。AURA 登录成功后必须卸载动画并释放计时器、Canvas/WebGL 和监听器；半透明侧栏以原生 vibrancy 为主，Reduced Transparency/forced-colors 回退为不透明；Glass 只装饰 `data-composer-card`，不替换输入生命周期；应用图标、小芯形象和 e-Mate Logo 保持不变。iDesign 只采用 SHA-512 固定、MIT 的 `deepseek-idesign@0.2.0`，其原始 tarball 与许可证随组件 vendor，后续 Source Available 版本、专有模板、运行时 CDN/Google Fonts 和无许可模板全部拒绝。

## 2026-08-23 · 2.0.12 S01 无安装构建、全组件合同与 Base ABI 收口

- 遵守本环境“不得 `npm/pnpm install`、不得 `approve-builds`”约束：使用现有 2.0.11 依赖存储和绝对 Node 路径，为当前固定 DSH 源码重建 package-level workspace symlink view。DSH Host/Client TypeScript 与 tsdown、e-Mate Shell、全部 16 个 Desktop accepted components、`packages/dsh` 以及 `@e-mate/desktop` SDK/声明输出均从当前源码成功构建；芯助手继续是唯一 blocked component，没有进入 registry、generation 或 Desktop accepted set。
- 聚焦收据：Shell `51/51`；Skill Hub Host `11/11` 与 UI `6/6`；better-sidebar `2/2`；CDP `10/10`；Computer Use `2/2`；file-import `6/6`；find-skill `10/10`；GenUI `1/1`；Glass `1/1`；iDesign `3/3`；MCP `4/4`；Memory `4/4`；Office `5/5`；Search MCP `5/5`；Tool Search `7/7`；Vision portable contract `2 passed / 7 native-target skipped`。`packages/dsh` 为 `43/43`，Desktop 类型检查通过且完整 Vitest 为 `50/50` 文件、`428 passed / 3 skipped`；仓库 release boundary、component payload/composition、Profile/R2 与 download-page 测试为 `45/45`，`check-target` 和 `git diff --check` 通过。
- 门禁捕获并修正四类会在发布后才暴露的问题：find-skill/MCP/managed-profile 的 2.0.11 静态期望未随 accepted set 更新；iDesign 的上游 tarball 错放到只接受 Git submodule 的 external source root；iDesign 实际使用的 rc.7 `dsh-client-ui-conversation`、`dsh-host-webserver` 与 `dsh-workspace` 未进入精确 Base ABI；下载页 JS 改字节后仍沿用旧内容哈希文件名且安装图解仍写 2.0.10→2.0.12。修复只更新各自合同来源，不增加第二分类器、Loader、运行时依赖安装或兼容猜测。

## 2026-08-23 · 2.0.12 S02 Session 冷读回归与后续正式门

- Desktop 完整测试首次以最终 Yarn rc.7 运行图执行时复现 `emate/image-output` 没有保存 `ignorable: true`；原因不是 DSH Session 新设计失效，而是本机复用的 2.0.11 安装依赖早于当前 Desktop patch，源码 patch/lock 与实际测试字节不一致。当前无安装验证树已按仓库 `.yarn/patches` 精确应用 Session writer 与 legacy image reader 后，针对性 `23/23` 和完整 Desktop `428 passed / 3 skipped` 均通过。永久发布仍必须从正式 Desktop lock/patch 图生成最终 `afterPack` 字节，并执行写入、退出、冷读与未知事件失败关闭；不能把本地依赖修补冒充正式封装证据。
- 本切片只到 `candidate built`。尚未完成的正式门保持失败关闭：Vision 两个 macOS 目标的离线 wheel 与 Desktop packaged Python、Computer Use universal helper、未签名 universal DMG、从 DMG 安装后的 AURA/侧栏/Composer/iDesign/全工具和插件、首 Token/tok/s 对照、2.0.11→2.0.12 自然语言更新/确认/原子重启/回滚、R2 immutable readback、`desktop/latest.json`、官网与未签名图解。上述终态全部通过且公开链无 `mac-smoke` 前，不得称 2.0.12 已发布。

## 2026-08-23 · 2.0.12 S03 AURA 字标与登录启动门

- 真实 Harness 登录页暴露 `e-Mate` 粒子字标在桌面构图中过大。修复只收小现有字标的桌面/窄屏宽度与高度上限并下移窄屏字标，不改 AURA 双态场、13 秒周期、Identity RPC 或登录表单。固定 Harness Host 的 `1280×720` 与 `390×844` 浏览器验收均无横向或纵向溢出，完整 `e-Mate` 分别可见于表单左侧与表单下方；收据为 `artifacts/design-qa/S02-login-aura/emate-wordmark-smaller-1280x720.png` 和 `artifacts/design-qa/S02-login-aura/emate-wordmark-smaller-390x844.png`。
- 新增启动绝对门：真实安装候选从启动到可见、AX 可读且可点击的 Harness 表面不得超过 15 秒；未登录时以真实登录表单为终点。AURA 已由 `identity.tsx` 静态导入并与登录路由同步预置，禁止动态导入、运行时 CDN 或登录临时下载，WebGL 初始化不得阻塞表单。正式 macOS 包验证器也把原 180 秒健康等待收紧为 15 秒启动硬门，并在收到确认后复核实测 elapsed；聚焦验证为 Shell Identity `13/13`、Shell 全量 `51/51`、macOS release verifier `5/5`。原 clean ≤10 秒、warm p75 ≤5 秒且单次 ≤8 秒的更严格预算继续生效；上述源码与 Host 收据不替代待执行的 DMG 安装态原始计时。

## 2026-08-23 · 2.0.12 S04 以 2.0.11 为启动基准并恢复原生按需 CDP

- 用户明确废止 S03 的独立 15 秒硬门及旧 clean/warm 绝对秒数，仓库级标准改为 accepted 2.0.11 安装制品的成对基准：同机器、架构、安装/复制状态、认证/Profile 状态、启动命令和探针边界下，双方各跑一轮 clean 与三轮 warm；候选的 clean、warm p75、warm maximum 分别允许最多 `+10,000 ms`。`AGENTS.md` 同时把 accepted 2.0.11 `6a7f4b9d59a1d8970345638946fb6564e2f5f93e` 的唯一原生 Desktop 生命周期固定为 Electron ready → 受限 shell environment → receipt-governed 本地 Profile → in-process Cordis Host → loopback Web → native BrowserWindow → renderer health；不得增加 launcher、CLI Host 子进程或并行启动路径。AURA 仍必须静态打包并随登录路由预挂载，不得运行时下载或以 WebGL 阻塞表单。
- 对照固定 Desktop reference `6074088f5b660206e404b3591fab51fb99c69add` 与 2.0.11 源码后确认 `desktop/e-mate-desktop/src/main.ts` 的启动顺序未变。原候选相对前代的真实回退来自 2.0.12 CDP 组件：Cordis effect 和能力状态轮询都会在应用启动时调用 `managedChrome.ensure()`，提前拉起 Chrome；2.0.11 只连接用户已启用 endpoint，没有这个启动期进程。最小修复保留同一个 DSH plugin、Tool、Settings、approval、Subprocess 与 managed runtime，只让生命周期 effect 持有 disposer，能力状态只读现有 endpoint；第一个 `browser_*` Tool 或“打开浏览器”动作继续调用既有 `ensure()`，自动启动系统 Chrome 的隔离 loopback CDP Profile，不恢复扩展、手动开发者加载、下载浏览器或第二浏览器路径。
- 原始诊断口径均为 arm64、`EMATE_RELEASE_HEALTH_PROBE=1`、隔离 HOME/DSH_HOME/user-data，从 process spawn 到 `.release-health-ack`。修复前单样本为 2.0.11 clean `23,524 ms` / warm `10,168 ms`，2.0.12 clean `27,056 ms` / warm `15,189 ms`；临时禁用启动期 CDP 后 Host/Renderer 约减少 3.1 秒，定位与源码一致。产品提交 `180b68170bf229b0153e5a97c3223b616a6e7f93` 的精确应用与 accepted 2.0.11 使用双方全新复制路径、同一 DSH/Profile receipt，且每轮使用独立 Electron user-data 避免 Chromium SingletonLock 干扰：2.0.11 clean `22,816 ms`、warm `3,322 / 2,864 / 2,855 ms`；2.0.12 clean `22,164 ms`、warm `3,167 / 3,232 / 3,290 ms`。候选 clean 快 `652 ms`；nearest-rank warm p75/max 为 2.0.11 `3,322 ms`、2.0.12 `3,290 ms`，候选快 `32 ms`，三项回退均不大于零，启动门通过。
- 聚焦门禁为 CDP `11/11`（新增“启动/能力轮询不拉起 Chrome，首个浏览器 Tool 恰好启动一次”的行为回归）、macOS release verifier `5/5`、release boundary `20/20`，`git diff --check` 通过。正式未签名流程的 macOS package tests `158/158` 与 runtime closure `197` 节点通过；构建机缺少 PATH npm 时只用 `/tmp` 转发到本机已有 npm CLI，未执行 install、approve-builds 或修改依赖/锁。产品提交 `180b68170bf229b0153e5a97c3223b616a6e7f93` 的精确 universal DMG 为 `399,924,111` bytes / SHA-256 `c9d729e9b88a4bea690593365dc1090dbcb177e4891fc62b23aa580ffdee144f`，DMG、deep ad-hoc code seal、arm64 renderer health（verifier clean copy `24,666 ms`）与 x86_64/Rosetta Electron readiness（`39,067 ms`）均通过；后两项是健康/兼容回执，不替代上述成对性能门。该候选尚未完成安装态 UI、全工具/插件、更新/回滚及公网发布，因此仍不得称为上线。
- 安装态验收前的规范复核发现 `docs/target-contract.md` 仍残留 S03 的绝对 15 秒条款，与 `AGENTS.md`、性能规范和已通过的新成对门禁冲突。现已把目标合同同步为 accepted 2.0.11 成对基准与 `+10,000 ms` 容差，并在 release-boundary 测试中同时锁定新语句与旧语句不得出现；聚焦回归仍为 `20/20`。这是合同纠偏，不改变已构建产品字节。

## 2026-08-23 · 2.0.12 S05 原生 Schedule 管理投影、iDesign 退役与 Base v6

- 定时任务继续由 pinned DSH rc.7 `@deepseek-ai/dsh-schedule` 单独拥有：Agent-local `schedule_create/list/delete` 写同一 Session `schedule/change` 流，原生 runtime 驱动计时和执行。新增 `@e-mate/dsh-plugin-schedules` 只经 loopback 读取 `sessionPersistence`，用原生 `foldScheduleEvents`、`decodeScheduleChange`、`resolveEveryOccurrence` 与 `scheduleView` 投影跨会话当前任务、一次性完成记录和最近 20 条 dispatch；它没有任务表、timer、executor、写 RPC 或第二历史库。Shell 的创建/修改/删除入口只把草稿带回原所属 DSH 会话，修改遵循 create 成功后 delete 的原生组合。
- rc.7 事件合同只有 `create`、`delete`、`dispatch`，当前状态只有 `scheduled`/`overdue`，因此完成态仅从一次性 dispatch 推导，最近运行仅来自原生 dispatch；rc.7 没有 pause、resume、edit、run-now 或单独 history Tool/event。本版明确不伪造这些状态和动作。Tool Search 组合行为证明 Agent-local `schedule_create/list/delete` 仍直接可见且执行原定义；Desktop 即使禁用旧 `emate-agent-operations`，独立 `emate-schedules` 组件仍装载。
- 审计发现候选 `runtime_imports` 已加入 `@deepseek-ai/dsh-schedule` 并移除 iDesign 专用 imports，却继续复用已发布 Base v5 id；这会让旧 v5 把不兼容 desired state 判为普通组件更新。唯一候选合同现提升为 `e-mate-desktop-profile-v6-dsh-2bc16230975f`，全部 accepted/blocked component manifest 精确绑定 v6，更新负例锁定 installed v5 在下载组件前返回 `base-required`。`@e-mate/dsh-plugin-idesign` 已从 inventory、源码/构建/许可输入和 vendored 8.1 MiB tarball 完整删除，并由 CLI/Desktop retired 集合在升级时清退旧目录和 bundle row，不留 ghost installation。
- 聚焦收据：Schedule 组件 build 与 `1/1` 行为测试、Shell build 与 `51/51`、Capability Center `6/6`、rc.7 原生 Schedule `131/131`、Tool Search 共存 `8/8`、`packages/dsh` `32/32`、Desktop Profile/组件/generation/release/update `24/24`、release-boundary/component `32/32`、Profile emit/publish `4/4` 均通过；exact contract check 返回 Base v6 `valid=true`，`git diff --check` 通过。仍需正式 Base v6 三平台封装、安装态自然语言 create/list/delete、dispatch 后完成/最近运行、更新确认/原子重启/回滚验收，未完成前不得称为上线。

## 2026-08-23 · 2.0.12 S06 新任务路由、图片编辑指代与设备级 Skill 安装复用

- 正式 2.0.12 arm64 App 回放证明点击“新任务”时主区变为空态、URL 却仍停在旧 `/chat/:blank`。固定 rc.7 的 `workspaces.startSession()` 会正确复用当前工作区已有 blank Session；问题在 e-Mate Shell 的共享入口只从设置类页面先回 `/`，而 `SessionRouteProjection` 又只在 current id 变化时纠正 URL。最小修复让所有无显式 workspace 的“新任务”先投影 `/` 并发送原生 popstate，再由同一个 rc.7 Session owner 打开或复用 blank Session；没有新增 Session、路由器或状态机。Shell 定向回归 `8/8` 与 tsdown build 通过。
- 真实 `~/.dsh/sessions` 日志显示“图上的方林改为圣都”前两次调用带 `image_url` 并走 `/images/edits`，第三次模型漏传引用后才退化到 `/images/generations`。附件、Job、Gateway 与结果回显链路本身有效；共享隐式图片指代守卫遗漏“图上的/图片中的/图片上的”。只补齐这些中文指代表达，使模型漏传时仍绑定会话最新图片进入 edit；图片生成定向回归 `1/1` 通过。局部字体或画面仍可能被模型重绘，属于模型编辑质量边界，不伪装成确定性像素编辑。
- 设备级 `lark-shared` receipt 已存在却在每个新 Session 重问安装，不是 rc.7 Full Access 或 `UserQuestionService` 丢状态，而是 Find Skill 在读取持久 receipt 前无条件提问。现在仅当 `source + skill + scope=global` 精确命中且原生 DSH Skill provider 可见时跨会话复用；Skill、source 或 receipt 变化仍走原生确认。Find Skill build 与 `12/12` 通过，没有把一次确认扩成全局免授权。
- Glass Composer 四种配色仍共用唯一边框伪元素，只把一圈动画从 `12s` 调为 `6s`；包围范围、颜色、Composer 几何与顶栏未变，Reduced Motion 仍关闭动画。组件合同 `1/1` 与 diff check 通过。

## 2026-08-23 · 2.0.12 S07 恢复公开现仓发布权威并冻结 Base v6 发布边界

- 只读 GitHub/生产审计确认旧 `zyfjacksonchen-source/e-Mate` 已是 private 且 main 仍停在旧版本；accepted 2.0.11、required `CI admission`、线性 PR 主线、`r2-publish` 签名环境和生产收据都属于公开现仓 `zyfjacksonchen-source/e-Mate-2.0.11`。2.0.12 早期提交误把目标合同、四个发布脚本及六个 package repository 字段改回旧私有仓，按该状态合并会让 Profile preparation 因 `GITHUB_REPOSITORY` 不匹配而失败。
- 唯一发布 authority 已恢复为公开现仓；四个内置 connector Skill 的本版 catalog URL 同步指向该仓待创建的不可变 `skills-v2.0.12-r1` 标签。2.0.9 历史 source URL 只用于识别和迁移旧 receipt，保持不变。`check-target` 继续作为共享权威并新增 Tool Search package metadata 覆盖，没有新增第二仓库分类器。
- 修复后 `check-target` 通过，Find Skill build/合同 `12/12` 通过，Base/Profile/component/R2/download release 合同 `47/47` 通过。公开 `skills-v2.0.12-r1` 必须在最终主线冻结后创建；当前旧 `180b681` DMG 早于 Base v6、Schedule、iDesign 退役与后续 UI 修复，已经失效，禁止复用或上传。下一证据级别仍是最终 SHA 的 PR CI、Base SDK、正式 universal DMG/Windows EXE、安装态验收与不可变公网发布。

## 2026-08-23 · 2.0.12 S08 最终源码审计收口与 Composer 光轨加速

- 图片隐式编辑不能把普通新图提示绑定到历史图片。S06 新增的裸“图上/图片中”表达已从通用图片指代中移出，只有定位词与明确的改、换、删、重绘等编辑动作同现时才复用会话最新图片；带历史图片的“生成一张地图上的路线图”负例固定走 `/images/generations`。这保留“图上的方林改为圣都”的漏参恢复，同时避免把“地图上”误识别成“上图”。
- 外部连接 Skill 的一次确认现在绑定真实不可变候选，而不只绑定可伪造的 `source + skill` 名称。允许清单固定为 `larksuite/cli` 的 `v1.0.88@2829ecd18846d8390dfac558125f602b07232206`、精确 GitHub tag/subpath、九个明确 `lark-*` Skill 与各自完整目录 SHA-256；确认框同时披露来源、版本、摘要和设备级全局范围。下载内容先在同卷 sibling staging 完整复制、写 receipt 并重算摘要，再以 sibling backup 原子切换；版本或字节不符、复制/写入/切换中断时旧安装保持或自动恢复，staging/backup/receipt 任一 symlink 都失败关闭且不得触碰外部目标。新建/更新 receipt 写入 `sourceVersion`、`receiptVersion` 与 `contentDigest`，跨会话复用前重新计算并要求全等。既有 `larksuite/cli` 旧 receipt 只有在 Skill 名称和实际字节恰好命中固定候选时才原子升级 receipt 并复用既有授权；内容被改、provider 不可见、source 或 Skill 变化都不会跳过确认，新的可变 `larksuite/cli` 请求更会在联网或写盘前直接拒绝。`registerCommand: false` 同时成为真实命令注册门，不能再从 `/skill` 绕开 `UserQuestions`。没有把飞书授权扩成其他连接或任意插件的全局许可。
- Schedule 管理组件实际跨多个持久 Session 做只读投影，manifest 因此删除错误的 `session-scope` 声明，只保留 `read-only`；成功的 revision 仍缓存，单个 Session 的瞬态 inspect 失败不再缓存到下一次写事件，下一次列表会重试该 Session。Desktop repair 测试同步注入旧 iDesign dependency、bundle 与物理目录并证明全部清退，防止 CLI 有覆盖而 Desktop 封装缺少回归门。
- Glass Composer 继续只用四种配色共享的唯一外框伪元素；用户确认 `6s` 仍慢后，将一圈时长收紧为 `4s`。边框范围、Composer 生命周期和 `prefers-reduced-motion: animation none` 不变。聚焦收据为 Glass `1/1`、Find Skill `21/21`（含真实 install/update 摘要失败保旧包、成功 receipt、swap/receipt 崩溃自愈及 symlink sentinel 负例）、DSH `43/43`、Schedule `1/1`、component release `11/11`、Desktop Profile `5/5` 与 `git diff --check`；九个摘要也已对固定 `v1.0.88` checkout 逐目录重算一致。公开 `skills-v2.0.12-r1` 标签仍是发布前门，必须在最终 accepted main SHA 上创建并验证远端标签精确绑定该 SHA；源码测试通过不等于标签或发布已经完成。

## 2026-08-23 · 2.0.12 S09 联网搜索回归 rc.7 原生单路径

- 回放固定 rc.7 组合确认 Base 已原生装载 `@deepseek-ai/dsh-web-search-deepseek`、`@deepseek-ai/dsh-web` 与 `@deepseek-ai/dsh-tool-web`；2.0.12 的实际故障来自 accepted `@e-mate/dsh-plugin-search-mcp` 覆盖 `web.searchProvider` 为 Tavily、关闭原生 DeepSeek provider，却要求本机不存在的 `TAVILY_API_KEY`。这不是 Tool Search 渐进披露或 Session 权限问题；`web_search` 本来就在 Tool Search 的直接可见集合中。
- 唯一正式路径恢复为 `deepseek-official`，原生 provider 从 OS Credentials 按次解析企业模型策略已投影的设备级 `E_MATE_MODEL_KEY_DEEPSEEK`。Search MCP 从共享 inventory、生成 registry/Profile、Desktop 与 CLI 安装清单退出，升级/repair 同时清除新旧 Search MCP dependency、bundle row 和物理目录；没有新增 Secret、后端接口、Transport、Tool dispatcher、Skill 安装或每会话设置。
- 当前实际设备已收到 DeepSeek runtime route，但代码合同只允许服务器为账户 `allowed_model_ids` 中的模型下发凭据，因此不能声称所有未来账户都必含 DeepSeek。若账户策略未包含 DeepSeek，原生搜索按 Credentials 合同失败关闭，不回退到用户自填或非治理 provider；这是真实产品边界，后端策略扩展不属于本次修复。
- 生成后的 CLI 与 Desktop Profile registry 均不含 Search MCP 目录、package 或 Tavily credential ref；最终 Cordis 组合固定 `deepseek-official`、`E_MATE_MODEL_KEY_DEEPSEEK`、`tool-web.fetch=false`，Tool Search 的真实组合行直接保留 `web_search`。聚焦收据为 DSH `32/32`、Desktop Profile `5/5`、Tool Search `8/8`、release-boundary/component `32/32`、`check-target` 与 `git diff --check` 通过。这里证明新装、升级修复和正式生成物的开箱链；最终发布候选仍需在已登录安装态发起一次真实联网查询并保留结果/来源回执，本切片未改版本、R2 或发布链。

## 2026-08-23 · 2.0.12 S10 真实用户逃逸缺陷门禁

- 当天真实使用暴露的新任务停留旧会话、图片编辑退化、全局 Skill 重复确认、联网搜索错误默认和 Glass 包内动画漂移，不是同一种单元逻辑错误，而是五类证据断层：测试把错误产品默认写成合同、替身只验证调用没有验证用户终态、设备级状态只测单 Session、源码与 emitted/generation/安装字节混为一层，以及真实账号/上游语义没有进入正式候选验收。以后每条用户旅程先记录唯一 Owner、初始状态、用户动作、可见终态、持久化范围、制品层和账号边界；修复只落在首次能观察该不可变式的最低原生 Owner，不按截图在多个调用方补 guard。
- 仓库现有 component/Base classifier 继续是唯一执行边界。单一兼容热组件只跑 Owner 集成、clean emitted bytes、完整 generation、在线增量更新后的受影响旅程与回滚；共享 DSH/Profile、Base ABI、inventory、锁、Desktop lifecycle、native helper、权限、打包或 updater 变化仍失败关闭到 Base。网络、凭据、OAuth 和模型语义的真实账号门与 lane 无关，受影响就必须执行；没有精确 SHA 的安装/更新终态，只能写 `source fixed` 或 `candidate built`。
- 三个最小回归已补到既有 Owner：Shell 测试真实挂载 `SessionRouteProjection`，证明 rc.7 复用同一 blank id 时点击新任务仍停在 `/` 空态且只调用一次原生 start（定向 `8/8`）；Find Skill 用第二个运行时实例和同一 global root 再执行真实 `skill_install`，证明重启边界不重复询问而版本/来源/摘要变化仍重新确认（`21/21`）；Glass 测试在 build 后直接读取 `lib/client.js`，要求 `4s`、Reduced Motion 为 `none` 且禁止旧 `6s/12s`（`1/1`）。正式候选仍必须完成安装态新任务点击、真实账号联网搜索、真实 Provider 图片编辑质量、跨会话/应用重启 Skill 复用和 computed style 验收，Mock 或源码字符串不能替代。

## 2026-08-23 · 2.0.12 S11 Find Skill 干净检出构建闭包

- PR `#44` 的第一轮受保护 CI 正确在任何 Base SDK/安装器产出前阻断：本机复用树已有 `upstream/plugins/dsh-find-skill/{,client/}node_modules`，但干净递归 submodule checkout 没有这两棵被忽略的工具链；adapter 的 build 脚本因此在 `pnpm test` 中报 `pinned dsh-find-skill dependencies are missing`。这不是产品运行时依赖，也不能靠本机缓存或重跑解决。
- 唯一组件 runner 现仅在构建 `@e-mate/dsh-plugin-find-skill` 时，从该固定 gitlink 自带的 `pnpm-lock.yaml` 执行一次 `--frozen-lockfile --ignore-scripts` 工具链准备，再继续原 build/test；普通组件、运行时与插件安装路径不受影响，没有在线运行时安装或第二构建器。release 测试锁住该精确 source root、frozen lock 和禁用 lifecycle scripts，CI 将以新提交从零重跑证明闭包。

## 2026-08-23 · 2.0.12 S12 组件测试使用真实 Base v6 依赖面

- PR `#44` 第二轮干净 CI 已越过 Find Skill 构建，随后测试加载 emitted `lib/index.js` 时找不到 `@deepseek-ai/dsh-skill`。本机独立组件目录残留的 workspace symlink 曾把这个缺口遮住；组件自身不应把 Base ABI 重装成运行时依赖，更不能沿用固定上游用于编译的 rc.6 devDependencies。
- 唯一组件 runner 现根据已验证的 `base_imports`，从固定 rc.7 Harness 源树为缺失的 `@deepseek-ai/*` 建立仅供构建/测试的解析视图，并对既有或新建目标都复验包名和 Base contract 精确版本。它不进入组件 files、Profile generation 或用户运行时；行为反例同时证明 rc.7 能链接、rc.6 期望失败关闭。这样 source/Base/plugin 三条 lane 测的是同一 Base ABI，不再依赖开发机偶然的 pnpm 链接。

## 2026-08-23 · 2.0.12 S13 Desktop 精确锁同步

- PR `#44` 第三轮已通过全部目标合同、组件 build/test 与 release carrier，随后 `yarn install --immutable` 在 Desktop SDK 冻结前拒绝 `dsh-workspace` 新增的 exact rc.7 descriptor。`package.json` 和 workspace lock 虽都已有该依赖，锁条目仍只有间接 `^0.1.0-rc.7` descriptor，且 workspace dependency 行未按 Yarn 确定顺序归一；本机已有安装状态再次遮住了 clean resolution 差异。
- 只把同一个 `0.1.0-rc.7` 解析条目合并 exact/range descriptor，并按 Yarn 的确定顺序排列 workspace 依赖；没有升级、重解析或新增包，也没有关闭 immutable。正式候选继续以干净 CI 的 `yarn --immutable` 作为唯一依赖图证据。

## 2026-08-23 · 2.0.12 S14 Profile 制品上传排除开发依赖链接

- PR `#44` 第四轮已通过目标合同、全组件测试、release carrier、Desktop immutable install 与 Base SDK 构建，却停在 Profile artifact 上传。根因是 Profile 中插件的开发期 `node_modules` 包含指回 Harness/pnpm store 的 symlink，而固定 `actions/upload-artifact@v4` 默认递归跟随 symlink；它因此进入不属于 Profile 制品的依赖图，而不是在上传真实 Profile 字节。
- CI 与正式 Desktop release 现在继续上传同一 `packages/dsh/profile` 和全部 accepted component `lib`，但在唯一上传边界显式排除任意层级 `node_modules` 目录及后代。Desktop 的原生 `sync-emate-profile.mjs` 本就以 `dereference: false` 并过滤 symlink，不消费这些开发链接；本修复不删除运行时文件、不改变 Base/Profile/组件字节，也不增加第二打包路径。release 合同同时锁住两个 workflow 都必须保留排除项，防止正式发布再次遍历开发机依赖图。

## 2026-08-23 · 2.0.12 S15 Profile artifact 改为无链接干净暂存树

- 第五轮 CI 证明 S14 的 negated glob 只排除上传结果，不能阻止 `@actions/glob` 沿正向 Profile pattern 继续递归；上传仍停在相同步骤。根据 GitHub Actions Toolkit 的真实 `partialMatch` 实现，负 pattern 不参与目录下钻判断，因此不能把该写法保留为伪门禁。
- 两个 workflow 现在先调用同一个 Node 标准库脚本，从已经 build/test 的 Profile 与 component `lib` 生成 `.release-cache/profile-artifact`。复制边界拒绝所有 symlink 和任意层级 `node_modules`，且没有 built component 时失败关闭；上传动作只读取这棵无链接暂存树，下载后仍恢复成原 `packages/dsh/profile` 与 `packages/dsh-plugin-*/lib` 布局。行为测试用真实目录 symlink 和实体 `node_modules` 证明两者都不会进入制品。稳定下载说明同时从错误的 2.0.10 修正为当前已公开验收的 2.0.11；没有改生产指针。

## 2026-08-23 · 2.0.12 S16 emitted runtime ABI 全组件门禁

- 合并后第一次从 exact-main 准备 Base v6 Profile bootstrap 时，在上传或激活任何生产对象前失败关闭：Glass portable 多声明一个只用于 TypeScript 类型的 `@deepseek-ai/dsh-client-runtime`，Skill Hub portable 漏声明 emitted `react-dom`。构建和聚焦测试均成功却未发现，是因为旧门禁分别验证手写 manifest 与解析器样例，没有对每个 accepted 组件的最终 allowlisted JS 字节做全等比较。
- 唯一组件 runner 现在在 portable build 或带精确 `EMATE_COMPONENT_TARGET` 的平台 build 后立即从 `files` 闭包提取真实外部 import，并要求与 `base_imports` 排序全等；没有目标 Python/runtime 的通用检查构建不冒充平台发布字节，三套 Base compatibility Jobs 负责各自目标，发布 emit 复用同一验证函数。PR clean target CI 进一步定位到 Vision 构建的反馈环：其 `neverBundle` 把通配符写成字符串，但当前固定 tsdown 只对 RegExp 做前缀匹配；未链接四个 DSH 包时它们偶然保持 external，按 manifest 链接后却被整体打入组件，导致同一声明反向改变 emitted imports。现改用仓库其他组件已采用的 `^@deepseek-ai/` 与 `^@e-mate/desktop/` RegExp，并以行为断言锁定，Vision 恢复原完整 Base ABI 声明。Glass 与 Skill Hub 的修正、全局 Base v6 runtime ABI union 和 Base id 均保持不变；旧 SHA 上的 CI、Desktop、npm carrier 和本机 stale-lib payload 全部作废。Profile workflow 的 bootstrap 说明同步为 accepted 2.0.12 Base。

## 2026-08-23 · 2.0.12 S17 Profile smoke 从产品 Owner 推导期望

- PR #45 的 accepted tree 已无差异合入主线，但 exact-main Profile bootstrap run `32641310551` 在签名、R2 上传和指针激活前失败关闭。`win32-x64` 与 `darwin-arm64` 都返回正确的 `advanced` renderer URL；失败来自 `verify-profile-boot.mjs` 仍把 2.0.11 的 `compatibility` 写死为期望。固定 Desktop reference `6074088f5b660206e404b3591fab51fb99c69add` 会原样编码 Host 提供的 mode/platform，2.0.12 的唯一产品 Owner `prepareDesktopProfile()` 则明确固定 macOS/Windows 为 `advanced`，因此不能为测试回退产品。
- 最小修复让完整 Profile smoke 从 `prepared.mode` 推导 URL、挂载模式和 Web graph：`advanced` 必须排除被 Desktop root 替代的上游 `ui-layout`，`compatibility` 才要求它存在。独立 Loader smoke 仍验证可复用 package 的兼容模式，但在测试挂载行显式传入 `compatibility`，不再借产品默认值。中英文 Desktop README 同步删除已经不存在的产品模式选择器说明。
- 继续运行完整 smoke 时，静态 `profile-smoke-tool-disclosure` Session id 与真实 `~/.dsh` 中的旧测试日志碰撞，曾被误报为 Tool Search 无法披露 `office_write`。产品 Tool Search 无需修改；smoke 现在把 `DSH_HOME` 固定到本轮临时目录并在退出时恢复环境，既不污染真实用户会话也可连续执行。当前工作树的 Profile smoke 连续两次通过、Loader smoke 通过、Profile/Plugin owner 测试 `26/26`，`git diff --check` 通过；仍须以新 PR 的 clean CI 和三目标完整 generation 复验后才能恢复正式发布。
- 独立终审又发现两个会让源码修复仍逃过 PR 的 P2：Desktop 后半段双语文档仍宣称产品可切换模式；classifier 会输出 `run_verification=true`，但 Base PR 只打包而没有执行本次改动的 Loader/Profile smoke。文档现在全部对齐为 e-Mate 平台固定模式并刷新双语 blob 记录；Windows 与 macOS Base installer job 在完成原有封装门后都会消费 `run_verification`，执行 Loader smoke 一次与可连续运行的 Profile smoke 两次，并由 `change-impact.test.mjs` 锁住该 workflow 边界。这些 smoke 只校验已构建的 Owner 与 Profile，不新增 Base/DMG/EXE 或并行 pipeline。

## 2026-08-23 · 2.0.12 S18 独立联网搜索授权与企业控制面硬边界

- S09 恢复 rc.7 原生搜索后，真实用户开箱链仍错误地把设备搜索凭据绑在账号的 DeepSeek 聊天 allowlist 上；GPT-only 用户因此没有搜索 Key。唯一 Owner 仍是既有 `/v1/runtime-models` 企业策略响应和 DSH 原生 Credentials：2.0.12 用同端点 `client_version=2.0.12` 协商独立 `granted/denied/unavailable` 搜索租约，GPT-only 目录继续不出现 DeepSeek 聊天；无查询的 2.0.11 客户端仍只收到精确 `{schemaVersion, models}`，没有第二 endpoint、provider、transport、Tool 或 store。Gateway 必须先部署该向后兼容响应，再发布 2.0.12 Desktop。
- 安全终审阻止了首版“只在成功时返回 Key”以及搜索/聊天共用引用的实现：保留 route `deepseek-web-search` 只绑定 `deepseek-official`、`https://api.deepseek.com/anthropic/v1`、`deepseek-v4-flash` 与独立 secret file，客户端只接收搜索专用设备引用 `E_MATE_SEARCH_KEY_DEEPSEEK`；DeepSeek 聊天继续使用不同的 `E_MATE_MODEL_KEY_DEEPSEEK`，两者不得别名、替代或回退。该保留 route 不进入 Auth 模型列表、`/v1/models`、client credential、代理调用或正式五路模型 Smoke。三态响应始终让有效 GPT route 继续投影，`denied/unavailable` 删除搜索引用，`granted` 可轮换 Key；凭据写入、清理和回滚按确定顺序等待。
- 每个进程第一次需要模型策略时必须等待 negotiated refresh；有效策略、最终 Settings 哈希、设备级凭据引用集合和搜索三态共同写入无秘密的 `runtime_projection` 收据，冷启动只有全等匹配才可离线复用。收到任何新版 runtime 响应后，先撤销 ready、删除旧搜索 Key 和旧收据，再刷新配额并投影 Settings/模型；因此配额、Settings、policy table、收据或回滚任一后续写失败都不能继续使用旧搜索授权，也不能由模型投影 rollback 把它恢复。missing/malformed grant 即使没有缓存也先撤销旧搜索 Key，显式拒绝/不可用的 unset 失败、正常投影或降级投影的收据写失败均保持 fail-closed，不能由通用缓存回退恢复 ready。e-Mate 管理的 GPT/DeepSeek/豆包/搜索引用只认 Keychain/DPAPI，进程、项目与用户环境变量不再能旁路企业撤销；其他非受管插件凭据仍保持原生 DSH precedence。
- 企业管理端生产面同步固化为三项 allowlist：鉴权/账户/协议与登录租约、受管模型和搜索策略/凭据租约、追加式脱敏审计与用量。生产注入、管理端 API 和逐项 404 反例共同禁止它控制本地 Tool、插件/Skill、文件、工作区、Session、记忆、Computer Use/CDP、定时任务、分享、Profile/Updater/发布或外部连接动作；模型传输 Tool schema 或返回 Tool call 只是推理数据，本地 Harness 仍是唯一执行 Owner。Skill Hub 文档已改称目录与包服务。通用 analytics server 中未接入生产的 runtime registry、Session Index、observability policy 仍是 P2 dormant 删除候选，但本版生产既未注入也由门禁阻止误接入，未为清理死代码扩大发布差异。
- 独立终审发现 Desktop Profile 测试仍读取被忽略的旧 `build/e-mate-profile` 并断言聊天 Key，形成源码测试假绿。测试现锁定搜索专用引用、官方 endpoint 与模型，并且必须先执行唯一 `sync-emate-profile.mjs` 再验证；最终 Profile `5/5` 通过。这个修复不新增同步路径，只让 Desktop 测试消费正式 build 会消费的同一字节。
- 该修复触及共享 Identity、Model Policy、OS Credentials 与 Desktop Profile 合同，classifier 正确判为 Base lane，而不是把安全边界伪装成单插件更新。聚焦证据为 Model Gateway `85 passed / 7 environment-platform skipped`、Auth `14 passed / 8 environment-integration skipped`、DSH `32/32`、Desktop Profile `5/5`、analytics production `4/4`、Gateway/Auth production build、target pin、完整 impact/component/Profile/R2 `37/37`、release topology `15/15` 与 `git diff --check` 通过。这里只证明源码、生成 Profile 字节和本地合同；exact-head clean CI、生产 Gateway 协商回读、真实 GPT-only 账号联网搜索、拒绝/轮换、安装态更新/回滚及正式 R2 发布仍未完成，不能称为上线。

## 2026-08-23 · 2.0.12 S19 企业管理端移除真实推理联通测试

- 严格按企业控制面的三类 allowlist 复审后，删除历史 Admin“测试联通”真实推理入口及其管理员模型 Session、状态、类型、文案和测试。管理端继续只保留账户/鉴权、受管模型目录与策略、追加式脱敏审计/用量；没有以健康探针或新 endpoint 替代被删功能。旧 `e-mate.admin.model-session` 名称仅保留为单向迁移清理键，初始化、所有管理请求的 `401` 和退出都会删除它，任何路径都不再读取或使用其内容。
- 仓库门禁现在递归扫描 Admin 全部可打包脚本扩展（`ts/tsx/mts/cts/js/jsx/mjs/cjs`），以精确依赖集合、唯一同源网络原语和鉴权/`/v1/admin/*` 路由 allowlist 为主；登录只能由该原语使用固定 `/v1/auth/password`，`requestAdmin()` 则先用固定虚拟 HTTPS origin 规范化路径，再只接受 `/v1/admin` 及其子路径（可带 query），最后才进入唯一 `fetch` 调用。直接或拼接的 Responses/图片推理路径、明文或编码 dot-segment、绝对/协议相对 URL、hash 和 `/v1/administer` 近似路径必须在网络前失败；动态第二 `fetch` fixture 同样失败。Tool 边界依赖精确依赖集合、唯一网络出口和本地 Harness Owner，而不维护无限动词黑名单；明显的模型 Tool schema 标记仍失败，同时普通局部 `tools:` 声明不会误报。通用 Analytics 中未接入生产的 dormant 模块保持不变。聚焦证据为 Admin `15/15` 与 production build、Analytics production `4/4` 与 build、`git diff --check` 通过。
- 首次 Enterprise-only exact-head CI 在业务检查全部通过后，暴露该 Job 的 checkout 没有像现有 Base/发布 Job 一样拉取锁定子模块，使用 Admin/Usage 真实品牌 Token 和 Logo 的干净构建失败。Enterprise-only checkout 现复用仓库已有的 `submodules: recursive`，不复制资产、不改产品边界。

## 2026-08-24 · 2.0.12 S20 Enterprise 运行镜像闭包权限

- `4d7a98d` 的 Analytics 候选曾在生产替换时于监听前退出；旧镜像已自动恢复且保持健康，Auth、Gateway、Web、PostgreSQL 与 Redis 未切换。只读复核确认真实 Docker healthcheck 一直使用 `/healthz`，没有依赖已经按控制面合同删除的 `/runtime/status`，因此不得为通过探针恢复禁用路由。
- 使用同一候选镜像、同一 Compose 配置和同一 Secret 挂载执行不启动服务的运行用户预检，精确复现 `Cannot find module '@e-mate/admin-contract'`。根因是服务器 root-only 源码归档保留了 workspace package 的 `0700/0600` 权限；镜像仍以 root 复制闭包、再切换到 `10001:0`，导致构建阶段和 root 测试可读，正式 Bun CMD 无权穿过 `/app/packages/admin-contract`。这不是配置、Secret、PostgreSQL、健康探针或企业业务代码回归。
- 唯一 Docker 运行时边界现在以 `--chown=10001:0` 复制三个服务各自应用、共享 packages 与 node_modules；Analytics、Gateway、Auth 每个最终 stage 都在声明 `USER 10001:0` 后直接 import 正式 production entry，任一 workspace 链接、文件权限或运行时依赖缺失都会令镜像构建失败。没有放宽源码归档权限、以 root 运行服务、恢复禁用 Analytics 模块或增加第二部署路径。正式生产重试仍必须基于合入后的精确提交重新构建，并先通过候选 import、配置/数据库只读预检和 `/healthz` 再原子替换。
- 修复以精确公开主线 `8247f83810bea5be045a6f2869fdda92f3da307a`、Enterprise tree `3045bbaf076e96a7bd5873d308c91b35821b753a` 重新生成 root-only 源码归档（SHA-256 `4066fdb6625cc45945764adda02b134f5a81c80a24b50d7d66f56fb6977d53a2`）和 Analytics 镜像 `sha256:ab0703e6b07789de6906c95dacdd6942d106b43033abc2d4b02b55e0673bfb1d`。同一生产网络、只读 Secret 与无发布端口的隔离 canary 达到 healthy、`/healthz=200` 后才执行单服务原子替换；Compose 解析差异和替换后回读均证明只有 Analytics 的镜像与启动时间变化，Auth、Gateway、Web、PostgreSQL、Redis 未重启，回滚未触发。替换后内部 `/healthz=200`，禁用的 `/runtime/status`、Tool、插件、定时任务和更新动作端点均为 404，未授权 `/v1/admin/users=401`；外部企业 API healthz 与两个既有 Admin 入口均为 200。root-only 激活回执保存在生产主机 `/root/e-mate-bootstrap/20260823T174323Z-analytics-boundary-8247f83/activation.receipt`，SHA-256 为 `16e7a293bb6cbdff7bd53bea3d095cba730437c8c7ecb4231007485bd97dc57f`。

## 2026-08-24 · 2.0.12 S21 Base v6 Profile 生产激活与 Desktop 正式候选

- accepted PR CI `32656824146` 绑定产品 source tree `7262d8b91a9a04222aedafc59c6f08b5fcaa98eb`；公开主线 `9fbc70ad56c4f263dfa0aa0085f19eded134e32d` 与该产品 tree 全等。Profile preparation run `32658083845` 在受保护环境生产签名完整 Base v6 三目标 generation，并输出仅含不可变对象与三个 activation pointer 的原生 Cloudflare publication bundle；Base contract 为 `e-mate-desktop-profile-v6-dsh-2bc16230975f`，签名 key id 为 `e0a81164526dcbcd`。
- publication plan 的 `567` 个 immutable objects 与 `3` 个 activation objects 在本机逐项验证安全相对路径、普通文件、唯一 key、bytes 和 SHA-256，总计 `86,839,497` bytes；先经一次性、随机令牌认证、仅绑定 `emate-desktop-downloads` 且只允许 `desktop/profile/components|releases|desired-state` 的 Cloudflare Worker 流式上传 immutable 对象。Worker 对 immutable key 拒绝不同字节覆盖，对 activation 额外在 R2 内重算并匹配 `expected_current` SHA；全部 immutable 对象随后从公开 R2 回读，`567/567` 的 HTTP、Content-Length、Content-Type、Cache-Control、bytes 与 SHA-256 全等，公开回读总计 `86,807,950` bytes。
- 旧公网 desired-state 的 bytes/SHA 与 plan 三项 `expected_current` 全等；其 Base v5 sequence 6 对 Base v6 正确选择为 `base-required`，因此 Base v6 的完整 15 组件 bootstrap 合法从 sequence 1 开始，不是旧 Base 内的逆序覆盖。最后才依次激活并公开逐字节回读：darwin-arm64 generation `992b3decd90f4f3dc07ac827838796cc8a195c48a995a01a5fb3adb109dcba2e`、SHA-256 `11206276896bbaa2d1485483198a4e30aadecbc38c079d00f16eba8b01286ec4`；darwin-x64 generation `8f520283c0a9e3d9e01916867fa97d98491142240c2330467868d241e700b71a`、SHA-256 `d9e5817cf13b02ca3b99e6564c910bb955400ee3fa96ba7c470643f6b036f7f3`；win32-x64 generation `da24e278ed820bae3a794b329ba6c79debbd13928ce58e3cb2aa8b209802e85f`、SHA-256 `b8df4b3290ea03af94c3672f6487696b998dde042635dac7f4eef206e97c1be1`。三份均为 `application/json`、`no-store`，以仓库 Base v6 信任根验证 Ed25519、完整 15 组件、source/base/target/generation 和更新选择通过；Search MCP 不在集合，Glass、Schedule、GenUI 与 Vision 都在集合。最终上传 Worker 已删除且 workers.dev URL 返回 404；两个未进入可用态的临时 Worker 也均未写 R2并已删除。
- exact-main Desktop build-only run `32658103294` 全部成功：Profile、unsigned macOS universal、unsigned Windows x64 和最终 release manifest 均绑定 `9fbc70ad56c4f263dfa0aa0085f19eded134e32d`；macOS artifact id `9498302935`、Actions 压缩大小 `389,378,547` bytes，Windows artifact id `9498110554`、压缩大小 `264,040,478` bytes，统一 release artifact id `9498321052`、压缩大小 `653,419,491` bytes。publish Job 按 build-only 合同跳过，`desktop/latest.json`、官网和安装图解仍未切换；正式 macOS artifact 正通过本机 `127.0.0.1:7993` 代理下载，必须完成 DMG/签名/架构、真实安装 UI、工具/插件、性能、在线更新与回滚后才能进入 Desktop 发布。
- 生产前置真实账号探针已确认 Auth 登录成功，但现网 Gateway 仍为 `e-mate/model-gateway:e-mate-2.0.9-max-output-53ee773`，`GET /v1/runtime-models?client_version=2.0.12` 返回 `400 INVALID_REQUEST: Query is not allowed`。服务器当前配置只有聊天 `deepseek` 路由和聊天专用 Secret；全量只读检索没有 `deepseek-web-search` route 或独立搜索 Secret。目标合同禁止 `E_MATE_SEARCH_KEY_DEEPSEEK` 与聊天 `E_MATE_MODEL_KEY_DEEPSEEK` 别名或互相替代，因此未复制现有聊天 Key，也未部署一个只能返回 `unavailable` 的 Gateway 冒充开箱可用；独立受管搜索 Key 和 Gateway 单服务 canary/原子替换仍是正式 Desktop 发布阻断项。
- 企业管理面专项边界审计对产品 HEAD `7262d8b91a9a04222aedafc59c6f08b5fcaa98eb` 与公开主线 `9fbc70ad56c4f263dfa0aa0085f19eded134e32d` 的全等 source tree、Admin 正式 bundle、生产依赖注入与 `98` 项相关测试完成核查：`96` 通过、`2` 项 Windows ACL 按 macOS 平台跳过、`0` 失败；没有新增可达的 Tool、插件、Skill、文件、工作区、会话、记忆、产物、Computer Use、CDP、定时任务、分享、Profile、更新器或 Desktop 控制能力。`AGENTS.md` 与 `docs/target-contract.md` 已把企业面唯一允许范围固定为身份/协议/鉴权租约、受管模型与搜索路由及有界凭据租约、追加式脱敏审计/用量三类，不再复制第二份规则。
- 审计只留下两项自 2.0.11 前即存在且当前生产不可达的 P2 硬化债务：Analytics 镜像仍物理携带未注入的 runtime-registry/session-index/observability-policy 模块与依赖，但禁用端点在生产均为 `404`；Admin Vite 开发配置仍保留无源码调用者、未进入正式 bundle 的 `/e-mate/model-api` 代理。两者都不是 2.0.12 新增越界，也不在当前运行链；冻结发布不夹带无关删除，后续必须以独立最小变更补充“禁用模块不得进入生产闭包”与“门禁覆盖 Vite 配置”的检查。
- 正式 macOS universal DMG `d2cb459d2e8648213e0b38aa6e210c1a727937be77993b2493e2a7848d5d3b2e` 已安装到 `/Applications/e-Mate.app`，Info.plist、universal 原生入口、Computer Use helper、深层 codesign、arm64 交互启动和 Rosetta x86_64 native-ready 均通过。实际账号从 Base v6 bundled Profile 接收 darwin-arm64 第 1 代 `992b3decd90f4f3dc07ac827838796cc8a195c48a995a01a5fb3adb109dcba2e` 的 15 个签名组件，原子重启后 `active` 与 `last_known_good` 同时提交到该代；再次正常退出并启动后不再提示更新。中途一次测试进程被非正常终止，原生健康门禁将未确认代回退到 bundled 并显示已缓存的 `0 B` 重试提示；重新执行同一签名代即恢复，证明回滚和重试均沿唯一 Profile generation 路径生效，不是前端隐藏弹窗或第二更新器。
- 正式安装态逐项回放真实用户反馈链路：新任务创建独立空白 Session；批量删除进入全选/逐项复选模式后可无删除退出；定时任务为独立 `/schedules` 页面并由“创建”返回拥有 Session、预填自然语言 `schedule_create` 请求；能力中心为独立 `/capabilities` 页面，Skill Hub 鉴权目录读取完成但当前公共清单为空，本机内置能力仍可见；设置页可从右上角打开并由页内关闭按钮返回；聊天框外沿菜单真实提供品牌橙光、RGB 彩光与关闭三态；附件按钮打开 macOS 原生文件选择器且 Escape 无残留返回；历史 `产物卡验收.docx` 卡片从聊天中真实打开 WPS，窗口标题与文件一致；空白测试任务的在线公开链接成功创建、返回七天有效期并立即撤销，导出 ZIP 仍与在线链接并列而非替代。历史完成 Session 的自然语言结果保持在原生消息槽，Think/Tool 只进入默认折叠的“运行过程”；Share、主题、设置仍在同一右上工具行。没有删除用户 Session、上传用户文件或保留测试公开链接。
- 对正式安装态补做 Finder→聊天框的跨应用图片拖拽时，当前生产 Gateway 尚未支持 2.0.12 runtime-policy，模型列表为空且原生输入框为 disabled；自动化拖放没有留下全屏遮罩或附件，但该环境不能把“未出现遮罩”提升为可发送状态下的真实通过。可重复的下层证据为活动 Base v6 generation `992b3decd90f4f3dc07ac827838796cc8a195c48a995a01a5fb3adb109dcba2e` 所引用的 `@e-mate/dsh-plugin-file-import` 2.0.12 物理组件 `0f6d29318ded11c5ced4c833a93f350daa851159ddb60c5c7bb4805fdcfaad8d`：其最终 `lib/client.js` 在 capture-owned drop 后显式派发 `dragend` 清理 rc.7 原生图片拖拽态，文件导入、边界拒绝、原子回滚、目标草稿 mention、Workspace/Composer 路由共 `6/6` 精准测试通过。正式发布仍要求模型恢复后在同一安装包中重新执行真实拖入、附件可关闭且不发送的 UI 验收，不能用源码或组件测试代替。
- 2026-08-23T20:53:44Z 再次只读回读生产主机：Gateway 仍为健康的 `e-mate/model-gateway:e-mate-2.0.9-max-output-53ee773`，挂载 Secret 只有既有 Luna、Sol、DeepSeek/Doubao 聊天 Key、TLS、usage、route-encryption、PostgreSQL 与 session-auth，仍没有独立 DeepSeek Web Search Secret。该阻断已连续三轮未变化；在独立搜索凭证未由管理面配置、DeepSeek 聊天上游 `402` 未恢复之前，不能部署 2.0.12 Gateway、不能完成真实模型/搜索/工具/插件及首 Token/tok/s 验收，也不能激活 Desktop Feed、官网或正式下载链。

## 2026-08-24 · 2.0.12 S22 企业管理端旧静态包失配修复

- 用户报告精确生产入口 `https://mvdcm.ecoremedia.net/e-mate/admin/` 不可用。公网 HTML、JS、CSS 与后端服务本身均为 HTTP 200；同一真实登录会话的 Admin 请求除 `GET /enterprise-api/runtime/status` 为 404 外均为 200。该 404 是 S19/S20 按企业控制面三项 allowlist 主动删除的本地 Runtime 路由；真实故障是生产 Web 容器仍挂载旧 2.0.7 Admin 静态包，旧首屏把 `/runtime/status` 放进同一个 `Promise.all`，让一个预期 404 拒绝整个管理台加载。没有为兼容旧前端恢复禁用路由。
- 从产品 tree `7262d8b91a9a04222aedafc59c6f08b5fcaa98eb` 构建当前 Admin，TypeScript、`15/15` 测试与 Vite production build 通过。候选先在生产同一 frontend network、相同 Nginx 镜像与 CA 挂载、无公开端口的隔离 canary 中验证健康、HTML 资源名、JS SHA-256 与 `/runtime/status` 字节缺席；首个 canary 校验脚本只因错误地在宿主读取容器 `/tmp` 文件而失败，修正检查位置后同一候选通过，未触碰生产。
- 激活只以新 release root 原子重建 `e-mate-enterprise-web-1`，未重建 Auth、Model Gateway、Analytics、PostgreSQL 或 Redis；root-only 回执保存在 `/root/e-mate-bootstrap/20260823T221658Z-admin-boundary-7262d8b`。公网终态回读为 Admin HTML HTTP 200、SHA-256 `88078e65e89d0ec140a5acc997445ca7f5a294dbaa8e92f2b3c65edbc9bf7545`，正式 JS HTTP 200、SHA-256 `190c07a261c2de4e82a5ebc99b8553bd4f93a2e9184296bbb153ba62ea3fff1c`，bundle 不含 `/runtime/status`；浏览器重新打开精确入口显示正常登录页且 console 为 0 error/warn。该修复只恢复三类企业管理能力的现有前端，不扩大管理端对本地 DSH、Tool、插件、Session、Computer Use/CDP、定时任务、更新或外部连接的权限。

## 2026-08-24 · 2.0.12 S23 GPT Responses 原生 Web Provider 与 2.0.11 侧栏回归

- 用户最终取消半透明左侧栏；Shell 删除 Advanced Mode 的混色覆盖与透明度媒体分支，恢复 accepted 2.0.11 的同一 `--emate-canvas` 实色背景。没有修改 Sidebar owner、Desktop Vibrancy、布局或导航。Shell 身份/设置视觉回归 `13/13` 通过。
- 联网搜索继续由 pinned rc.7 `@deepseek-ai/dsh-web` 与 `@deepseek-ai/dsh-tool-web` 唯一拥有。首版把 GPT provider 做成第 16 个新 package，但追到真实 Desktop install owner 后确认 Base v6 把组件 roster 固定在 inventory/registry；直接新增 package 必须重建 Base，若只放宽 classifier 会是假门禁。最终复用 Base v6 已接受的 `@e-mate/dsh-plugin-tool-search` 热组件，增加独立 `./web-search` Cordis 入口，只向现有 `ctx.web` 注册 `gpt-responses` provider。它不注册新 Tool、不读环境变量或 BYOK、不增加 transport/store/session，并在每次搜索时通过原生 Credentials 解析既有设备级搜索租约 `E_MATE_SEARCH_KEY_DEEPSEEK`。该名称是不可变 Base-v6 wire ref，不代表本次上游；它与任一聊天 Key 继续隔离。固定 Responses 请求使用 `gpt-5.6-luna`、原生 `web_search` server tool，并只接受同时含 `web_search_call` 和 URL citation 的结果；凭据缺失、非引用结果、重定向及未显式允许的 HTTP 均失败关闭。
- 企业面仍只下发有界搜索凭据租约，不代理本地 Tool。保留的非 callable route 改为 `gpt-web-search / gpt-responses / responses / gpt-5.6-luna`，绑定固定 GPT 自定义 Responses endpoint 与独立 Secret 文件；它不进入 Auth 模型清单、`/v1/models` 或客户端可调用模型集合。为了不要求 Base v7，2.0.12 runtime grant 继续使用 Base-v6 的 `deepseek-official / E_MATE_SEARCH_KEY_DEEPSEEK` wire schema，具体 provider、endpoint、模型与 Secret 身份只由保留 Gateway route 和热组件共同约束。旧无查询 2.0.11 runtime 响应仍保持精确 `{schemaVersion, models}`，2.0.12 才协商搜索三态。生产 Secret 即使初始字节获准复用现有 GPT Key，也必须拥有独立文件和挂载身份，不得与聊天 Secret 共挂载或回退。
- 组件 inventory、Base SDK fingerprint、Desktop installer 与 DSH shared Profile source 最终均不改变；搜索与恢复 2.0.11 实色侧栏只更新已接受的 Tool Search/Shell 两个 portable 热组件。企业 Gateway 配置拆到独立 enterprise-only 变更，避免 component+enterprise 混合 diff 被 fail-closed classifier 提升为 Base。聚焦证据必须按重构后组件重新生成；先前新 package 的 `3/3` 及 combined diff 的 Base 结果不再作为最终发布证据。生产 Gateway 独立 Secret/canary/原子替换、Profile generation 发布、安装态真实搜索/更新/回滚仍未完成；完成前不得称为上线。
- PR `#51` 首轮 clean CI 在 Model Gateway `tsc --noEmit` 阻断：搜索 smoke 的对象展开把允许 HTTP 的字面量 `true` 宽化成 `boolean`，Node 行为测试不执行类型检查所以本机先前未发现。唯一测试夹具现显式使用既有 `ModelSmokeRoute` 合同，继续保证生产只接受字面量 `true`；Model Gateway typecheck 与 smoke `9/9` 通过，没有放宽生产类型或 HTTP 边界。
- `#51` 第二轮影响报告虽识别搜索与 Shell 组件，却因新 inventory/shared Profile/identity 变化正确判为 Base，并开始构建完整 Desktop SDK；该运行在产出 Base 前主动取消。没有篡改 classifier：改为既有热组件入口并拆分企业变更后，两个 exact diff 应分别得到 plugin-only 与 enterprise-only，后续小改才真正不重建 Base/DMG/EXE。
## 2026-08-24 · 2.0.12 S24 GPT 搜索 Gateway 保留路由

- 联网搜索生产策略继续复用现有 Model Gateway、租户策略和 `/v1/runtime-models?client_version=2.0.12` 三态租约，不增加控制面或本地执行权限。唯一保留且不可调用的目录行改为 `gpt-web-search / gpt-responses / responses / gpt-5.6-luna / http://43.135.183.53:8080/v1`，要求字面量 `allowInsecureHttpUpstream: true` 与独立 `/run/secrets/gpt-web-search-api-key` 文件；它从 Auth 模型目录、Model Gateway 可调用路由、`/v1/models` 和五路真实模型 Smoke 中全部排除。
- 已发布 Base v6 的 runtime grant wire schema 保持 `deepseek-official / E_MATE_SEARCH_KEY_DEEPSEEK`，仅作为旧 Base 已固定的设备级搜索租约标识；具体 GPT provider、endpoint、模型和 Secret 身份由保留 route 约束。该 Search Secret 即使初始字节获准复用已有 GPT 自定义 Key，也必须复制为不同文件和挂载，不能与聊天 Secret 别名、替代或回退。无查询的 2.0.11 响应继续精确为 `{schemaVersion, models}`，只有 2.0.12 协商租约。
- 本切片只改 Auth/Gateway 生产配置和对应合同，必须由 classifier 判为 enterprise-only。正式激活需基于合入主线的精确提交构建 Gateway，先在同一生产网络以相同只读配置/Secret 做无公开端口 canary，再只原子替换 Gateway；Auth、Analytics、Web、PostgreSQL、Redis 的容器身份必须保持不变。真实 GPT-only 用户搜索、引用回读、拒绝/轮换和审计对账通过前不得称为上线。

## 2026-08-24 · 2.0.12 S25 企业管理端有界真实模型联通恢复

- 用户明确恢复管理端真实文本/图片模型联通测试。实现复用 Auth Gateway 登录回执中既有的短期 Model Gateway session 和管理端唯一同源网络原语；地址必须精确为当前 HTTPS origin 的 `/e-mate/model-api/`，session 单独保存在当前标签页的 `sessionStorage`，过期或跨源立即失败关闭。没有增加管理 API 到 Provider 的代理、第二 transport、本地 Harness/Tool 调用或上游 Key 暴露。
- 管理员只能在已发布、已启用且同时属于登录允许集合和 `/v1/models` 权威目录的 route 上手动点击一次测试。文本路径固定 `Reply with OK.`、`max_output_tokens=32`、`stream=true`、`store=false`，并要求 256 KiB 内出现 `response.completed`；图片路径只固定生成 `1024x1024` 橙色方块并立即取消响应体。两条路径均不接受自定义提示词、Tool schema 或客户端上游配置，继续计入既有配额与脱敏审计。
- 精准验证通过：Admin API `18/18`、Admin TypeScript/test/production build、Analytics production boundary `5/5` 与 TypeScript production build、`git diff --check`。门禁从源码抽取网络路径时按引号边界读取字符串字面量，避免把闭引号后的 `return path` 误吞为 URL；固定 allowlist 仍只有 Auth password、`/v1/admin/*`、models、Responses 与 images generations，第二 fetch、XHR/WebSocket/EventSource 和模型 Tool schema 继续失败关闭。生产静态包与真实账号/路由终证在本条提交时尚未激活，不得据此声称生产联通已经恢复。

## 2026-08-24 · 2.0.12 S26 首页 Workspace 冷启动竞态与产品文案收口

- 正式安装态曾出现首页输入框退化为“选择一个工作区开始”，但同一 App 重载或从定时任务点击“新任务”后又恢复“通用会话”。回放到 pinned DSH rc.7 的唯一 Session/Workspace owner 后确认：`SessionRouteProjection` 只等待 Session baseline；冷启动时 Session 先 ready、Workspace baseline 仍未完成，`startSessionFromRoute` 找不到通用 Workspace 后返回，而路由投影不再重试。最小修复不新增 Session、Workspace、Composer 或兜底路径，只同时订阅原生 `workspaces.baselinesReady`，两层 baseline 都 ready 后才执行一次原有 Home session 启动。新增反例先锁定 Workspace 未 ready 时不得启动，切为 ready 后恰好启动一次。
- 用户可见文案同步收口：定时任务页面删除解释 DSH rc.7 Schedule 能力边界的底部说明及其孤立样式；批量删除确认框把“本地历史记录仍由 DSH 保留”改为“本地历史记录仍由 e-Mate 保留”。底层 archive/Session persistence 行为、Schedule owner、事件与历史保留合同均未改变。
- 精确 pnpm `11.7.0` 下 Shell component runner 完成独立 frozen-lock build，`9 files / 53 tests` 全过；影响分类只命中 `@e-mate/dsh-client-shell` portable component，返回 `lane=plugin-only`、`run_base=false`、Base v6 合同有效。该切片不得构建 Base、DMG、EXE 或未变化插件；仍需从精确提交生成 Shell payload、与 accepted set 组合完整 generation，并在正式安装态冷启动和对应文案 UI 回放通过后才能声称生效。
- PR `#54` 的 accepted CI `32679795052` 绑定 source commit `4d6ad9d7b32e041c149ba9bb81782ae66cc26a1c`，公开主线 merge commit 为 `5bef129c6177de371aea2a3ae5ed262a5a0d0967`，两者 source tree 全等。Profile preparation run `32680121831` 只生成变化后的 Shell payload，并与已接受组件组合三目标第 3 代 generation；publication plan 共 `14` 个不可变对象、`3` 个 activation objects、`2,637,089` bytes。所有不可变对象上传后从公开 R2 逐项按 HTTP、bytes 与 SHA-256 回读，再以旧 desired-state 精确 SHA 做 CAS 激活；一次性认证 Worker 随后删除且 URL 返回 `404`。darwin-arm64 最终 generation 为 `d8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93`，darwin-x64 为 `6ec6b157ea2668d4670bc332457bc85fe2f895d982a85a4a6b53a12e316e70ce`，win32-x64 为 `963ede65e703b338e23c0728519db8dee476b0465609fa17c4c9d481442fc5b6`；三个公开 desired-state 均为 sequence `3`、`application/json`、`no-store` 并逐字节匹配签名计划。
- `/Applications/e-Mate.app` 的正式用户账号先确认本机 active/last-known-good 仍为第 1 代 `992b3decd90f4f3dc07ac827838796cc8a195c48a995a01a5fb3adb109dcba2e`，关闭此前已打开的第 2 代旧提示后，从真实首页聊天框自然语言发送“检查并安装 e-Mate 最新更新”。客户端重新读取公网指针，明确显示“第 3 代组件”、Shell 与 Tool Search 两个相对第 1 代的变化组件以及 `2.6 MiB` 下载大小；用户确认路径完成校验、原子切换和重启。最终本地收据为 active/last-known-good=`d8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93`、previous-known-good=`992b3decd90f4f3dc07ac827838796cc8a195c48a995a01a5fb3adb109dcba2e`，证明没有把 Profile 更新退化成 Base/DMG 全量安装。
- 第 3 代安装态在健康门提交后和再次正常退出冷启动后都显示“通用会话”、完整输入框“给小芯发送消息，支持粘贴图片或文件”、外部连接/动效/模型/发送控件及首页概览，不再出现“选择一个工作区开始”。定时任务独立页完整保留创建、建议、当前/完成/运行记录，但旧 DSH rc.7 底部说明不存在；批量删除真实进入选择模式并打开确认框，文案为“本地历史记录仍由 e-Mate 保留”，随后取消，未删除任何用户会话。这组安装态证据完成 S26 的 Profile 增量闭环，不代表 Gateway、正式 Desktop Feed、官网下载链或 2.0.12 全版本发布已经完成。

## 2026-08-24 · 2.0.12 S27 企业用量审计面板交互闭环

- 本切片严格限定在线企业用量审计面板：Analytics API 让汇总、任务事件、对账和日期明细共同接受同一组多用户筛选，HTTP 入口只接受有界、非重复的用户 id；Usage Dashboard 补齐最近 7/30/90 天快捷范围、自定义起止时间、多选用户、范围整体调用/Token 可视化，以及点击日期展开任务事件类型、使用场景和用户/模型用量。没有修改 e-Mate 客户端、Desktop、插件、Profile、Feed、R2 或本地 DSH 运行链。
- 任务场景只展示任务账本真实分类；当前历史记录仍提供 `GENERAL` 时明确显示为“未分类 / 历史数据”，面板不以标题、Tool 或模型调用推测并伪造分类。要得到真实业务场景，后续应由唯一任务账本生产者提供原生 scenario，不应在报表层重分类。
- 精确验证为 Usage Dashboard `16/16`、TypeScript 与 production build 通过；Analytics 全量测试 `35 passed / 6 environment-integration skipped / 0 failed`、TypeScript 与 production build 通过，`git diff --check` 通过。生产 Analytics 镜像为 `e-mate/analytics-api:e-mate-2.0.12-usage-audit-da7a8f`，真实 PostgreSQL 只读查询验证多用户与单日路径；最终静态 release 为 `/srv/ecorex-agent-usage-panel/releases/usage-2.0.12-audit-custom-9ee1d064ca1a`，公网首页与正式 JS 均 HTTP 200 且 JS SHA-256 与本地构建全等。已登录浏览器真实回放确认自定义时间保留并生效、同时选择两个用户后汇总变化、日期下钻展示当日事件/场景/用量，企业 API `/healthz` 为 `ok`。激活回执保存在生产主机 `/root/e-mate-bootstrap/20260824T075112Z-usage-panel-custom-9ee1d064ca1a/activation.receipt`。

## 2026-08-24 · 2.0.12 S28 企业用量可视化分析与姓名展示

- 本切片仍严格限定在线企业用量审计面板。Usage Dashboard 新增按日、按用户的使用热力图，支持在 Token 与调用次数之间切换；新增按日场景用量与构成图，并让时间范围、多用户筛选同时约束汇总、趋势、场景与明细。明细表支持多选自定义显示列；用户维度优先展示企业目录姓名，在下钻中保留姓名与用户 id 以便审计。没有修改 e-Mate 客户端、Desktop、插件、Profile、Feed 或 R2。
- 当前真实任务账本仍由 `packages/dsh/src/profile/audit.ts` 的唯一生产者把 scenario 固定写为 `GENERAL`，所以历史场景继续如实显示“未分类 / 历史数据”，报表层没有通过标题或 Tool 猜测分类。精准分类所需的客户端原生修复已移交任务 `01a02e48-f61f-7352-bc86-b5ec8771d46c`，要求在已锚定 DSH rc 基线的唯一生产点做确定性分类并保持隐私与生命周期稳定；本分支不包含该客户端改动。
- 精确验证为 Monitoring Contract `6/6`、Usage Dashboard `17/17`、Analytics `35 passed / 6 environment-integration skipped / 0 failed`，三处 TypeScript/production build 均通过。生产真实 PostgreSQL 首次暴露 JSONB 时间为 `+00:00`、而合同只接受规范 `Z` 的边界问题；修复只在 Analytics 唯一 SQL 结果边界规范化时间，并用真实 PostgreSQL 形态补充反例。最终 Analytics 镜像为 `e-mate/analytics-api:e-mate-2.0.12-usage-analysis-32252e4`，静态 release 为 `/srv/ecorex-agent-usage-panel/releases/usage-2.0.12-analysis-435a4e69cb8e`，激活回执为 `/root/e-mate-bootstrap/20260824T082606Z-usage-analysis-fix-32252e4ef4ba/activation.receipt`；只替换 Analytics 与审计面板静态资源，Auth、Gateway、Web、PostgreSQL、Redis 均未重建。已登录生产浏览器回放确认姓名展示、用户筛选、Token/调用切换、场景趋势、自定义列、日期下钻、7/30 天与自定义范围均生效，页面无全局横向溢出。

## 2026-08-24 · 2.0.12 S29 审计面板原地明细与内部账号排除

- 日期下钻此前只有一个共享明细节点，固定渲染在全部日期行之后；现仍复用同一查询与状态，只把该节点放到被选日期行之后，同一行再次点击或“关闭”均原地收起。分析指标的 Arco 弹出层在自动化路径可展开、真实鼠标路径却不稳定，最小修复改用原生 `select`，保持 Token/调用数量两个既有指标和样式，不再依赖弹出层。
- `企业管理员 / e-Mate 企业管理员`、`验收用户`、`测试` 三类内部账号由管理目录的稳定 id 与精确展示名共同识别；Dashboard 在读取任何汇总、对账、任务或事件数据前，把现有查询收窄到其余可见用户的同一组权威 user id。它们因此不进入概览、趋势、场景、用户表、日期下钻或调用审计，但底层原始账本未删除，Analytics、客户端、Auth、Gateway、数据库和采集合同均未修改。
- Usage Dashboard 类型检查、`18/18` 测试与 production build 通过。生产静态 release 最终原子切换为 `/srv/ecorex-agent-usage-panel/releases/usage-2.0.12-inline-audit-06422cb0600e`，旧 `usage-2.0.12-analysis-435a4e69cb8e` 与首个候选 `usage-2.0.12-inline-audit-ff7bde0658fe` 均保留回退，最终激活回执为 `/root/e-mate-bootstrap/20260824T085720Z-usage-inline-audit-06422cb/activation.receipt`；公网 HTML 与 JS 均为 HTTP 200、`no-store` 且 SHA-256 与本地构建全等。已登录生产浏览器确认内部账号排除后任务数、调用、Token 与活跃用户同步变化，原生指标切换生效，日期明细位于所选行与下一行之间并可再次点击收起，调用明细中也不含三类账号。

## 2026-08-24 · 2.0.13 S27 合同与基线 checkpoint

- Goal checkpoint: 唯一 2.0.13 主 Goal 已创建并保持 active；没有 token budget，也没有并行 Goal。当前记录只关闭文档、已发布身份和 TTFT v2 证据结构，不把 S27 或 2.0.13 标记完成。
- Frozen baseline / current HEAD: 开发分支从 `5fb9d595749ee9de4f8019ae4decce02ad3af541` / tree `20580c664c8f9f4eb130386f090c02c39ab1d413` 建立。公开 Desktop `2.0.12` 绑定 source `9fbc70ad56c4f263dfa0aa0085f19eded134e32d`、build run `32658103294`、Base `e-mate-desktop-profile-v6-dsh-2bc16230975f` 与三目标 Profile sequence 3；本机正式安装为 2.0.12 且 active/last-known-good 为 darwin-arm64 generation `d8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93`。源码身份、公开制品身份和安装态身份保持分列，未互相冒充。
- Binding documents read: 完整读取根 `AGENTS.md`、`docs/target-contract.md`、`docs/plugin-contracts.md`、`docs/performance-and-acceptance.md` 与最新 development log；新增 `docs/slices/2.0.13.md`，并把 Goal、共享详情区、画布、产物、宠物、浏览器和性能不变量写回上层合同。
- Inspected native seam: pinned rc.7 已有单一 `goal/change`/Goal Projection/CAS/Command/Tool/Remote/round driver；Better Sidebar 已有安全受限的 WorkspaceRegistry/Host RPC/`conversation.view`，根因是产品入口不可达；ActivityFold 在每个节点读取全量 `chat.order`，GenUI fallback 对 `document.body` 做全页观察、全页查询和周期扫描；普通流式链已经是 chunk 立即追加加唯一一层 `requestAnimationFrame`。
- Experiment or why unnecessary: 本 checkpoint 的 owner/边界均可由固定源码和现有组件测试直接证明，无需动态 Creation Mode 猜测接口；后续新增持久组件若仍有未知 seam，必须先按原生 define/run/stop/undefine 做最小可逆实验。TTFT fixture 通过固定 rc.7 AgentLoop 真实采集一次 30 组样本并克隆为等价比较臂，仅验证采集链、schema 与比较器；浏览器 paint/pre-provider 为合成零值，明确不能成为生产性能证据。
- Decision and forbidden alternatives: 不接入 AutoGPTBrowser、tldraw、Cowart 运行时、第二 Goal/Queue/Schedule/Browser/Store/transport 或用户 BYOK。固定研究/依赖身份为 dsh-pet `f501139cfb155fd46717a79bb1c158da064dce15`（只复用 MIT 代码，排除上游 sprites）、Cowart `c934452ead956f501655f242fd0b8cfa90bea509`（仅交互参考）与 `@excalidraw/excalidraw@0.18.1`（MIT，自托管资产）；精确 tarball/integrity/NOTICE 边界记录在切片和插件合同。
- Changed scope: 仅修改 2.0.13 文档合同、TTFT v2 证据验证器及其窄测试；未改产品运行时代码、Base/Profile、模型头、路由、凭据、用户数据、原 2.0.12 工作树或用户未跟踪证据。
- Verification commands and results: 固定 Node 24.19.0 下 `node --check scripts/performance-parity.mjs` 通过，`node --test scripts/performance-parity.test.mjs` 为 `4/4`；`node scripts/performance-parity.mjs --fixture --samples 30` 采集三路径各 30 条等价样本，得到 `fixture-passed-production-blocked`、零比较失败并按合同 exit 1；`node scripts/check-target.mjs` 与 `git diff --check` 通过。新 worktree 的 Harness 因共享 TypeScript build state 而缺失输出，执行一次 `tsc -b tsconfig.host.json --force` 与 host tsdown 后恢复；没有修改 Harness 源码或共享 Git 配置。
- Immutable evidence / receipt: 正式 macOS DMG 为 `390527181` bytes / SHA-256 `d2cb459d2e8648213e0b38aa6e210c1a727937be77993b2493e2a7848d5d3b2e`，Windows EXE 为 `272939381` bytes / SHA-256 `52b84e14cce5ad49ada282b9a41913aa751db43765c8dba44088d66148dcd186`；darwin-x64/win32-x64 sequence 3 generation 分别为 `6ec6b157ea2668d4670bc332457bc85fe2f895d982a85a4a6b53a12e316e70ce` / `963ede65e703b338e23c0728519db8dee476b0465609fa17c4c9d481442fc5b6`。fixture 原始 JSON 仅在临时目录，不进入发布证据或仓库。
- Remaining blockers: S27 仍缺最终安装态 2.0.12 的 30 组成对真实提供方 TTFT v2 baseline/原始 trace；Base v7 尚未生成；S28–S35 的源码、组件、安装态、跨平台、更新、回滚和公开发布均未开始或未关闭。开发凭据只可经既有 Auth/OS keystore/managed Secret/SSH 临时使用，严禁写入日志、仓库、命令输出或回执。
- Next exact action: 先定位并补齐最终安装态 TTFT v2 采集 seam 与 2.0.12 baseline receipt，再进入 S28 的 Base v7、共享详情区、两处已证实流式热路径和三项视觉修复；普通模型请求头必须逐字节保持冻结基线。

## 2026-08-25 · 2.0.13 事故聚合更新展示脱敏

- Goal checkpoint: 本修复仅收口更新链的用户可见投影，不扩展 2.0.13 功能范围，不改变发布状态。
- Frozen baseline / current HEAD: 独立 worktree 从事故聚合 `2873c1d8c0aac6533ec6442906acc4ee927e7a2a` 创建；未修改版本、Base contract 或 Harness gitlink。
- Binding documents read: 完整读取根 `AGENTS.md`、`docs/target-contract.md` 与本日志上一条完整记录。
- Inspected native seam: Profile update 的 `changedComponents` 仍是差量、字节和结构化 id 的唯一真相源；Electron 确认框、Agent Tool renderer、原生通知与托盘只是其用户可见投影。
- Experiment or why unnecessary: 该 seam 已由现有 Desktop adapter、Tool 和测试直接证明，无需 Creation Mode 实验。
- Decision and forbidden alternatives: 保留 `components`、`componentGeneration` 和 `requiredBaseContracts` 结构化值供内部调试；用户层只按差量数量显示稳定能力摘要，不新增 notes store、更新器或发布元数据路径。
- Changed scope: 仅修改 Desktop 更新可见文案、共享展示 helper、三组窄回归和根 README 的唯一用户说明；同步把稳定 legacy 入口事实从 2.0.11 更正为已发布 2.0.12 tombstone。
- Verification commands and results: Desktop 窄回归 `agent-update` / `electron-runtime` / `updates` 为 `3 files / 71 tests` 全过；修正测试类型后 `electron-runtime` `39/39` 再验通过；Desktop 四个 TypeScript face 全过。
- Immutable evidence / receipt: 本条只产生 source-fixed Git 证据，没有生成、签名、上传或激活任何安装包、Profile generation 或生产指针。
- Remaining blockers: 需由主聚合在最终版本与 Base/Harness 身份提交后重跑相同窄门禁，并在真实安装态确认可见层不泄露内部 id。
- Next exact action: 将本独立 source-fixed commit 合入主聚合，解决最终 README 版本文案后重跑相同回归；未取得用户发布授权前不进入任何生产发布步骤。

## 2026-08-25 · 2.0.13 更新展示脱敏重放到最终产品版本

- Goal checkpoint: 将既有用户可见更新展示修复重放到已切换产品身份的 2.0.13 事故聚合；不扩展功能范围，不进入发布链。
- Frozen baseline / current HEAD: 重放基线为 `e4e8df0c10d26048284b6af1311eaa61c53b1bab`，原修复提交为 `5908a654870414fb9a3176de38b15c6744d69e5f`；本切片未修改版本、Base contract 或 Harness gitlink。
- Binding documents read: 完整读取根 `AGENTS.md`、`docs/target-contract.md` 与本日志上一条完整记录，并核对当前 `desktop/e-mate-desktop/base-contract.json`。
- Inspected native seam: Profile update 的 `changedComponents`、`componentGeneration` 与 `requiredBaseContracts` 继续作为签名、差量、审计和诊断的内部结构化真相；Electron 确认框、Agent Tool renderer、系统提示、通知与托盘只投影稳定的用户能力摘要。
- Experiment or why unnecessary: 现有共享展示 helper 和 Desktop adapter 已覆盖全部可见投影，无需增加 notes store、第二 updater 或第二渲染路径。
- Decision and forbidden alternatives: 冲突解决保留产品版本 `2.0.13`、legacy `desktop/latest.json` 的真实 `2.0.12` tombstone、用户能力摘要、原子切换与失败回滚语义；内部 id 不在用户层直出，但不从内部更新结果中删除。
- Changed scope: 仅重放 Desktop 更新文案、共享展示 helper、三组窄回归和根 README；`development-log.md` 只追加本记录，未改写历史。
- Verification commands and results: Desktop `agent-update` / `electron-runtime` / `updates` 为 `3 files / 71 tests` 全过；四个 TypeScript face 全过；根 README 的 2.0.13 产品版本、2.0.12 tombstone、能力摘要与原子更新文案门禁通过；Desktop 英文/中文 README 的 `README.i18n.yaml` Git blob 哈希均匹配。`node scripts/check-target.mjs` 未通过：基线源码要求 Harness `e13ce9d953037a2f40d866d17f5a7e00cbc15d66`，但 `e4e8df0` 的 gitlink 仍为 `85bef24c764feb034465ea4e0d34442249ee4cc7`；该身份漂移先于且独立于本修复，本切片按边界不修改它。
- Immutable evidence / receipt: 本条只产生 source-fixed Git 证据；没有生成、签名、上传、激活或发布任何安装包、Profile generation、manifest 或生产指针。
- Remaining blockers: 主聚合必须由 Harness/Base identity owner 让 Harness 常量、Base contract 与 gitlink 精确一致并重跑 `check-target`；最终安装态仍需确认普通用户确认框、Agent Tool 终态与系统提示不泄露内部名称。
- Next exact action: 主聚合复核并合入本提交；Harness/Base owner 关闭既有身份漂移后重跑版本门禁，之后才允许进入候选安装态验收，严禁本地构建进入生产链。

## 2026-08-25 · 2.0.13 S27 TTFT v2 安装态证据导出闭环

- Goal checkpoint: 本切片只补齐 S27 的安装态性能证据导出和 fail-closed 验证器，不把真实 Provider 性能、S27 或 2.0.13 标记完成。
- Frozen baseline / current HEAD: 独立 worktree 从事故聚合 `b79cfbf4d7731cbe127f6e705f999c1dc574704a` 创建；当前分支仍携带旧 Harness 合同常量，最终聚合必须由身份 owner 锁到批准的 Harness/Base 后重跑本门禁。
- Binding documents read: 完整读取根 `AGENTS.md`、`docs/target-contract.md`、`docs/performance-and-acceptance.md`、`docs/slices/2.0.13.md`、最新完整 development log，以及 pinned Harness `AGENTS.md` 与 pre-push skill。
- Inspected native seam: DSH `session/event` 已提供 `user/message`、`request/header`、`assistant/chunk`、`tool/call`、`tool/result` 和终态事件；`agent/request` / `llm/stream` 是原生 waterfall；Session stats 与 e-Mate quota/audit ledger 已提供 usage、policy 和去重事实。原生 session telemetry 会携带正文、Tool arguments/results、请求头和 cwd，不能原样成为跨边界生产证据；renderer paint 与安装包身份必须由同一安装态外部验收探针关联。
- Experiment or why unnecessary: 未增加常驻采集插件。验收态 assembler 直接连接已脱敏的 native Session、request waterfall、Provider receipt、renderer paint、installed runtime 和 enterprise receipt；fixture 的 Harness imports 改为只在 `--fixture` 时动态加载，生产验证路径不要求装载 Harness runtime。
- Decision and forbidden alternatives: 继续使用原生事件、现有 audit/quota 与单一 receipt 路径，不增加第二 store/protocol、普通模型 Tool、正文采集或热路径 listener。所有 source artifact 使用闭合 schema、相对路径、逐样本 `pair_id` 对账和 run-scoped SHA-256 身份；只改哈希而不匹配语义不能通过。
- Changed scope: 修改 `scripts/performance-parity.mjs`、其窄测试和性能合同；增加 acceptance-only `--assemble <manifest> --output <evidence>`，自动生成 raw samples/run receipt，并加强 native/provider/header/paint/install/enterprise artifact 的逐样本语义、安装字节和隐私字段校验。未修改 Desktop、DSH 产品运行时、Base/Profile、模型头、路由、凭据、发布脚本或线上状态。
- Verification commands and results: Node 24.19.0 下 `node --test scripts/performance-parity.test.mjs` 为 `5/5`；覆盖 30 组成对样本、硬门禁、fixture 生产阻断、安装态六类 artifact 组装、逐样本关联、symlink source 拒绝，以及“修改语义并同步重算 artifact/run receipt 哈希仍被拒绝”。
- Immutable evidence / receipt: 本条只有 source-fixed Git 证据；测试 artifact 全部位于系统临时目录并清理，没有生成、签名、上传、激活或发布生产性能回执与安装包。
- Remaining blockers: 必须先把最终 Harness/Base/Profile/source identity 锁定并更新验证器 pin；仍需批准的真实验收账号、最终安装态 2.0.12 与 2.0.13、同机同网正式模型 30 组 AB/BA、外部 renderer paint 探针、Provider invocation/response 回执和安装回执。fixture 或本地 unpacked runtime 不能关闭这些阻断。
- Next exact action: 主聚合复核并合入本 source-fixed commit，在最终 identity 上重跑窄测试；随后仅在隔离验收目录用同一安装态运行生成六类脱敏 artifact，执行 `--assemble` 后再以 `--input` 回读，只有 `gate_status=passed` 的同一 `performance_run_id` 才可供 Desktop/Profile 准入引用。

## 2026-08-25 · 2.0.13 runtime-models 搜索授权版本协商修复

- Goal checkpoint: 本修复只关闭 2.0.13 客户端与既有企业模型/搜索策略端点的版本协商断裂，不处理其他 P0，也不进入发布链。
- Frozen baseline / current HEAD: 独立 worktree 精确基于事故聚合 `77454a2fdf1802365cd29802582b2382a2e8997f`；Base 为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`，Harness 为 `b2b1650b01f0ee88d81837a9b5c050f9f763f606`。
- Inspected native seam: `enterprise-provider.ts` 只调用既有 `/v1/runtime-models?client_version=2.0.13` 并严格要求 `searchCredentialGrant`；Gateway 同一路由却只在 `client_version=2.0.12` 时返回该字段，导致 2.0.13 在模型目录投影前整体失败。
- Decision and forbidden alternatives: Gateway 在同一路由保留无 query 的 2.0.11 精确旧 schema，精确允许 2.0.12/2.0.13 并为两者返回同一搜索授权合同；未知版本以 `UNSUPPORTED_CLIENT_VERSION` 失败关闭。没有新增 endpoint、回退、宽松默认、第二模型策略或凭据路径。
- Changed scope: 仅修改 Model Gateway 的版本 allowlist、服务端合同回归和客户端现有 HTTP 合同 fixture；未改 R2、AGENTS、网站、发布工作流、模型路由或凭据所有权。
- Verification commands and results: 根因回归在修复前精确失败；修复后 Gateway 2.0.12/2.0.13/未知版本合同 `1/1`、搜索 denied/unavailable `1/1`、Gateway TypeScript 通过，DSH enterprise identity 2.0.13 精确 query/grant 合同 `1/1`，change-impact 对精确变更判定为有效 Base lane，`git diff --check` 通过。
- Immutable evidence / receipt: 本条只有 source-fixed Git 证据；未生成、签名、上传、激活或发布任何安装包、Profile generation、manifest 或生产指针。
- Remaining blocker: 主聚合合入后仍须在最终候选上重跑相同窄门禁；生产 Gateway 部署与真实安装态联网搜索验收属于后续单独授权步骤，本提交不声称上线。

## 2026-08-25 · 2.0.13 仓库级创造模式内循环 scope amendment

- Goal checkpoint: 后续可插件化开发默认改为“Codex 修改后立即通过原生创造模式在隔离开发会话原地生效和验证，版本冻结时再统一固化发布”；本条只收紧开发方法，不改变 2.0.13 功能范围或发布状态。
- Frozen baseline / current HEAD: 独立 worktree 精确基于事故聚合 `7e126fcd43eb1489868fbf4da76823d56015b50e`；Base 为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`，Harness 为 `0.1.0-rc.7` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606`，Desktop reference 为 `6074088f5b660206e404b3591fab51fb99c69add`。
- Binding documents read: 完整读取根 `AGENTS.md`、`docs/target-contract.md` 与本日志上一条完整记录，并核对当前 `desktop/e-mate-desktop/base-contract.json` 和 Harness gitlink。
- Inspected native seam: 仓库已有唯一 “First development rule: use native DSH Creation Mode first” 章节、rc.7 `cordis` preset、两项原生创作 Skill、`cordis_inspect_*` 和 define/run/stop/undefine 生命周期；`scripts/change-impact.test.mjs` 已是该仓库准则的最窄可执行合同。
- Experiment or why unnecessary: 本切片只修改仓库治理文本和合同测试，不改运行时行为，因此不启动动态包；后续每项可插件化产品改动才必须在当前隔离开发会话执行原生热替换和真实窄交互验证。
- Decision and forbidden alternatives: 创造模式是默认开发内循环且仅为进程内开发证据，重启即消失；不得持有签名、R2、Feed、生产 desired-state 或发布权限，不得直接成为发布物或替代安装态、跨平台、性能、回滚验收。每项原地验证后仍回到既有 Owner 的普通 Profile 插件，多项已验证改动只在版本冻结时汇总；Base-only 修改继续沿 pinned Desktop lifecycle，禁止第二套热更新、运行时、存储或协议。
- Changed scope: 仅修改根 `AGENTS.md`、已有 `scripts/change-impact.test.mjs` 合同断言并 append 本记录；未修改功能源码、Profile、Base、Harness、Desktop、生产配置或发布状态。
- Verification commands and results: 使用安装态 Electron 所带 Node `24.18.1` 执行 `--test scripts/change-impact.test.mjs`，仓库 release boundary `22/22` 全过，其中 Creation Mode 准则合同通过；`git diff --check` 通过。
- Immutable evidence / receipt: 本条只有 source-fixed Git 提交证据；没有生成、签名、安装、上传、激活或发布任何制品。
- Remaining blockers: 主聚合需复核并合入本规则提交；每个后续插件切片仍须分别留下原地热替换证据、永久插件映射与最窄回归，正式版本仍按原安装态和发布门禁执行。
- Next exact action: 运行最窄合同测试与 diff 检查，提交独立规则变更并回传 SHA；主代理合入后按新内循环继续各切片，不触发生产链。

## 2026-08-25 · 2.0.13 DSH 源码门禁过期合同修复

- Goal checkpoint: 本修复只恢复最终 P0/TQ 候选的 DSH 源码门禁，不改变产品功能、Owner 或发布状态。
- Frozen baseline / current HEAD: 修复基于事故聚合 `6543ba2a232a9110aab4242a6f25ae784a18ceb0`；Base 为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`，Harness 为 `0.1.0-rc.7` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606`。
- Binding documents read: 核对根 `AGENTS.md`、`docs/target-contract.md`、最新 development log、Identity typed RPC 实现和 managed Profile 物理化测试。
- Inspected native seam: 搜索 Provider/模型策略继续由 `profile/cordis.patch.yml` 与 model-policy 所有，Shell client bundle 不应复制该策略字符串；`/emate.identity` 已在唯一 RPC 边界把未预期异常转成 `{ok:false,error:{code:'internal'}}` 并隐藏内部原因。
- Experiment or why unnecessary: 本次只修复与现有已证明运行时合同不一致的测试断言，没有新的插件行为或未知 seam，因此不定义动态 Creation Mode Package。
- Decision and forbidden alternatives: 将 Shell 中的 Provider 字符串断言改成负向边界；验证码与 bootstrap 的内部失败改验 typed envelope 和不泄漏内部诊断。禁止为让旧断言通过而把模型策略复制进 UI，或重新让 RPC reject 原始异常。
- Changed scope: 仅修改 `packages/dsh/test/e-mate.test.mjs` 三处过期断言并追加本记录；未改生产源码、Profile、Desktop、Gateway、凭据、更新或发布链。
- Verification commands and results: 在 `packages/dsh` 使用 Node `24.19.0` 执行 `node --test test/e-mate.test.mjs test/identity-lifecycle.test.mjs test/legacy-migration.test.mjs`，`52/52` 通过；`git diff --check` 通过。
- Immutable evidence / receipt: 本条只有 source-fixed Git 证据；没有生成、签名、安装、上传、激活或发布任何制品。
- Remaining blockers: 仍须修正 S27/S34 文档中的旧 Harness `2bc162...` 身份并记录 `b2b1650...` bounded diff；最终 P0/TQ 安装态、性能、更新、回滚和生产回读仍未关闭。
- Next exact action: 独立提交测试合同修复；随后对 Harness/Base 身份文档和首次 Creation Mode 运行态证据做单独 append-only 修正，再重跑聚合源码门禁。

## 2026-08-25 · 2.0.13 Harness Base v7 身份合同修正

- Goal checkpoint: 本修正关闭 S27/S34 当前态文档仍停留在 2.0.12 Harness pin 的硬冲突，只更新已存在源码事实，不把 TQ-13、S27、S34 或发布标记完成。
- Frozen baseline / current HEAD: 修正基于聚合 `571197c7929d02cc460c17d0eac0c4100b5765a7`；2.0.12 发布基线仍为 Base v6 / `2bc16230975f6cf02aa1b283b1f86de44007b059`，2.0.13 候选为 Base `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` / Harness `b2b1650b01f0ee88d81837a9b5c050f9f763f606`。
- Binding documents read: 核对 `AGENTS.md`、`docs/target-contract.md`、`docs/slices/2.0.13.md`、`desktop/e-mate-desktop/base-contract.json`、Harness gitlink 与最新 development log。
- Inspected native seam: Harness `b2b1650...` 是 `2bc162...` 的单一后继链，包含已审 `2318269...` Schedule startup admission，并继续收纳 Tool provenance、Job admission、Session cold-list、model-directory 与 image-edit review；Desktop reference 仍为 `6074088...`，没有第二 Harness fork 或运行时。
- Experiment or why unnecessary: 本次只修正权威合同与执行门禁，不改变运行时；`git merge-base --is-ancestor 2318269... b2b1650...`、gitlink、Base contract 和 `check-target` 已直接证明身份，无需动态 Package 模拟 Base-only provenance。
- Decision and forbidden alternatives: 切片合同现在明确分开 2.0.12 发布基线 `2bc162...` 与 2.0.13 候选 `b2b1650...`。TQ-13 只关闭 source pin/Base/SDK 身份缺口；冻结构建、installed transaction、真实 due、双平台更新与回滚继续 OPEN，不能因文档对齐而宣称功能闭环。
- Changed scope: 仅更新 `docs/slices/2.0.13.md` 的当前 Harness/TQ-13 状态、在既有 release-boundary 测试增加两条精确身份断言并追加本记录；未改 Harness、Base、Profile、Desktop、Schedule 运行时或发布链。
- Verification commands and results: `git merge-base --is-ancestor 2318269e77f1a36169445e2556199ef4d9a1625d b2b1650b01f0ee88d81837a9b5c050f9f763f606` 通过；`node --test scripts/change-impact.test.mjs` 为 `22/22`；`node scripts/check-target.mjs` 通过；`git diff --check` 通过。
- Immutable evidence / receipt: 当前只有 source-fixed Git 证据；没有生成、签名、安装、上传、激活或发布任何字节。
- Remaining blockers: TQ-13 仍缺同一冻结字节的 macOS B2b、Windows transaction、old-v1/fork/replay、真实 due/cold resume/时区/离线和双平台更新回滚；全部 13 项真实闭环仍为 `0/13`。
- Next exact action: 独立提交身份合同修正；随后追加首次 Creation Mode 原地验证回执并继续最终 P0/TQ 源码门禁，生产链保持关闭。

## 2026-08-25 · 2.0.13 原生 Creation Mode 首轮原地验证

- Goal checkpoint: 按新增仓库准则执行第一次真实开发内循环，验证“一切皆插件”的可达 seam 和边界；本记录是 development evidence，不把任何 P0/TQ、切片或发布标记完成。
- Frozen baseline / current HEAD: 运行态验证开始于聚合 `6543ba2a232a9110aab4242a6f25ae784a18ceb0`，记录时为 `f5d51edbda691acbe46491c8e6b5607bb940b04e`；目标 Base 为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`，Harness 为 `0.1.0-rc.7` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606`，Desktop reference 为 `6074088f5b660206e404b3591fab51fb99c69add`。
- Binding documents read: 完整读取根 `AGENTS.md`、`docs/target-contract.md`、最新 development log，以及 pinned rc.7 `cordis-plugin-development` 420 行 Skill 和 `editing-cordis-compositions` Skill；核对安装态 2.0.12 内三项 shipped cordis preset/Skill 文件真实存在。
- Inspected native seam: 原生 `cordis_inspect_list/query/self`、Host Tool Registry、`session/event`、Client `shell.overlay` Slot、用户批准，以及 define/run/update/stop/undefine 是唯一动态开发生命周期；e-Mate Profile 继续由同一 Cordis Host、Session、Tool、Slot 和普通组件组合启动。
- Experiment or why unnecessary: 在隔离 DSH_HOME 和测试 Session 中，真实执行 `cordis_define` 得到 `proof-1/pkg-1`，`cordis_run` 激活动态 Tool `emate_live_probe` 并返回 `{nonce:'creation-mode-ok',owner:'native-tools'}`；`cordis_stop` 后 Tool 不可见，`cordis_undefine` 后插件列表为空。另一个动态包随进程退出消失，同一 Session id 在新进程检查仍为空。rc.7 Web e2e 同时完成 define→用户批准→Client overlay 挂载→stop 撤除。
- Decision and forbidden alternatives: Shell 路由/hover/composer、Schedules、Better Sidebar 和 Tool Search 等既有 Profile Owner 可先通过对应 Client Slot 或 Host Service/Event/Tool seam 原地试验，再固化回同一个普通组件；Session 持久化/Harness pin、Windows native picker/Profile 物理化、Desktop updater/签名、Gateway/Auth/Share 服务端属于 Base 或服务端 Owner，绝不能包装成动态插件。动态包不写 Session/Event store，不接触 desired-state、R2、Feed、签名或生产指针。
- Changed scope: 验证过程没有修改产品源码、Base、Profile、Harness、Desktop 或生产状态；本提交只 append 本记录。隔离目录只含测试 Profile 与空 Session 状态，不含真实用户数据。
- Verification commands and results: pinned rc.7 Web `apps/web/tests/cordis-tool-round.e2e.ts` 为 `5/5`；原生 Tool Registry 完成 inspect/define/run/call/stop/undefine 和新进程易失性检查；e-Mate 隔离 Profile `setup --check --json` 全过，13 个 pinned bundle 与 cordis/Better Sidebar/Glass Composer/Schedules 共存，Web `/api/e-mate/health` 返回 `version=2.0.13`、`profile=e-mate`、`active_runs=0`；Desktop Profile `15/15`、Shell 路由/标题/输入框 `30/30`、Schedules `1/1`。
- Immutable evidence / receipt: Git 记录保存精确源码身份、命令和结论；动态 Package 与隔离状态按合同进程内易失，没有进入 Profile generation、安装包或发布物，也没有生产写入。
- Remaining blockers: 该结果不替代 Windows 正式安装态三项 P0、跨日/多会话/原生 picker、真实账号、性能、更新、回滚和公开回读；后续每项插件修改仍需留下自己的原地热替换与 owning regression 证据。
- Next exact action: 继续用 Creation Mode 验证下一项可插件化 P0/TQ；Base-only/服务端问题沿各自 pinned 原生 Owner 修复，候选冻结后才汇总为普通 Profile generation 和 Base 发布。

## 2026-08-25 · 2.0.13 P0/TQ 聚合源码门禁 checkpoint

- Goal checkpoint: 三项 Windows P0 与 TQ-01..13 的当前聚合已通过本机完整 source gate；本条只把候选提升为 source-fixed，安装态、性能、更新、回滚和生产发布仍未开始。
- Frozen baseline / current HEAD: 门禁运行于 `26a0050d46a2ca33569f0acb3099b9c0051b5edd`；对比基线为公开主线 `5fb9d595749ee9de4f8019ae4decce02ad3af541`，Base 为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`。
- Binding documents read: 核对根 `AGENTS.md`、目标/插件/性能合同、2.0.13 切片、最新 development log、change-impact 输出与 P0/TQ owning tests。
- Inspected native seam: change-impact 对 204 条候选路径判定 `lane=base`、`run_base=true`、`run_enterprise=true`、`run_verification=true`，15 个已准入组件继续由各自普通 Profile Owner 构建；共享 Harness/Desktop/enterprise 变化没有被错误降级为 plugin-only。
- Experiment or why unnecessary: 可插件化边界已由上一条 Creation Mode 运行态验证；本 checkpoint 验证永久源码、构建和 CI Owner，不再创建重复动态 Package。首次命令只因环境使用 pnpm `11.19.0` 和 enterprise 缺少 node_modules 失败，改用仓库固定 pnpm `11.7.0` 并按 frozen lock 安装后重跑成功，未改产品逻辑。
- Decision and forbidden alternatives: source gate 必须同时覆盖 Profile 组件、DSH、Desktop、enterprise 和 release/admission；不能因单个 Shell 或 Creation Mode 测试通过而跳过 Base/服务端 Owner，也不能用错误包管理器结果冒充源码失败。
- Changed scope: 本 checkpoint 没有修改产品源码；完整构建产生的 Vision requirements 临时机械 diff 已按运行前 Git 状态移除，用户既有未跟踪截图、provenance 与 node_modules 保持未纳入 Git。本提交只 append 本记录。
- Verification commands and results: 固定 pnpm `11.7.0` 的根 `pnpm test` exit 0，含 release-boundary `40/40`、Shell `67/67`、DSH `56/56` 和全部组件 owning tests；`pnpm test:release` 为 `22/22`；enterprise `check`、`test`、`build` 全部 exit 0；Desktop `typecheck` exit 0，Vitest 为 `54 passed / 1 skipped` 文件、`585 passed / 4 skipped` 测试；`check-target` 通过，change-impact 合同 `valid=true`、错误为空，`git diff --check` 通过。
- Immutable evidence / receipt: 当前只有 Git/source/build-test 输出；没有签名安装包、Profile generation、performance_run_id、安装回执、R2 对象或公开指针。
- Remaining blockers: 仍需受保护 PR/CI、正式不可变构建、macOS/Windows 同字节安装、三项 P0 跨日/双会话/picker、TQ-01..13 全矩阵、TTFT v2、更新/回滚和 Cloudflare 插件公开回读。Vision 的 7 项平台运行时测试与 Desktop 的 4 项平台条件测试必须在对应正式目标补齐。
- Next exact action: 提交本 checkpoint，复核最终 diff 与公共远端保护状态；随后推送候选 PR，先让 CI admission 验证同一源码，禁止在合并/准入前写 R2、Feed 或官网。

## 2026-08-25 · 2.0.13 Windows 候选启动物理路径一致性修复

- Goal checkpoint: 修复 P0/TQ 候选在真实 Windows CI 首次暴露的 Base 更新握手误拒绝；本条只恢复同一原生更新链，不把安装态、更新回滚或发布标记完成。
- Frozen baseline / current HEAD: 失败候选为 `97f04018c83d70e036f7fd830bbb53f146546811`，PR 为 `#56`，CI run 为 `32843830729`；Base 为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`，Harness 为 `b2b1650b01f0ee88d81837a9b5c050f9f763f606`。
- Binding documents read: 核对根 `AGENTS.md`、目标/插件/性能合同、2.0.13 切片、最新 development log，并追踪 `beginWindowsUpdateCandidateStartup()`、唯一调用方、调度端 `realFile()` 与 Windows 更新握手测试。
- Inspected native seam: 调度端已经用共享异步 `realFile()` 完成无 symlink 的真实文件检查与物理路径规范化；候选启动端却单独使用 `realpathSync()` 加重复 `lstatSync()`，在 Windows 临时目录/短路径规范化下会把同一物理候选误判为不同 canonical path。
- Experiment or why unnecessary: 远端真实 Windows runner 的 `check:win-package` 精确复现为 `windows-update-installer.spec.ts` 两项失败，均在读取候选 journal 前被 `Windows update candidate path or version is invalid` 拒绝；macOS 同测试通过说明这是平台路径规范化差异，不是 journal、版本或产品插件行为。
- Decision and forbidden alternatives: 候选启动端改为复用唯一 `realFile()`，删除平行同步规范化与重复文件元数据校验；保留现有 canonical directory、版本、journal、hash、exclusive started receipt 和 Base identity 全部防线。该责任属于 Desktop Base 私有握手，禁止包装成 Creation Mode/Profile 插件，也不通过放宽路径比较或跳过 Windows 测试掩盖。
- Changed scope: 仅修改 `desktop/e-mate-desktop/src/windows-update-installer.ts` 的候选可执行文件解析并 append 本记录；未改协议 schema、安装器、Profile、Harness、R2、Feed、desired state 或生产状态。
- Verification commands and results: 本机 Node `24.19.0` 下 Windows installer/transaction 窄回归为 `2 files / 21 tests` 全过；Desktop 主 TypeScript face 通过；`git diff --check` 通过。真实 Windows CI 重跑尚未取得结果，因此当前只为 source-fixed checkpoint。
- Immutable evidence / receipt: Git diff 与 PR CI 失败日志绑定到上述 run/job；没有生成、签名、安装、上传、激活或发布任何新字节。
- Remaining blockers: 必须将修复推送到同一 PR，让新的真实 Windows runner 通过 `check:win-package` 和 unsigned installer 构建；随后仍需同一冻结字节的 Windows 安装、P0/TQ、在线更新和失败回滚验收。
- Next exact action: 提交并推送最小修复，等待 PR #56 全部 CI 收敛；若 Windows 仍失败，只处理新的精确失败 owner，生产链继续关闭。

## 2026-08-25 · 2.0.13 Windows 更新恢复项幂等清理修复

- Goal checkpoint: 继续关闭同一 PR 的真实 Windows Base 更新事务门禁；本条只修复恢复项缺失时的幂等查询，不把更新、回滚或发布标记完成。
- Frozen baseline / current HEAD: 路径修复候选为 `35649817fa17ed45e620e94489dcb957a3592932`，PR `#56`，CI run `32844912068`；Base/Harness 身份保持不变。
- Binding documents read: 复核根 `AGENTS.md`、目标/切片合同、上一条完整记录，以及 `windows-update-transaction.ps1` 的 Register/Remove/SelfTest 唯一恢复项链和对应源合同测试。
- Inspected native seam: Windows runner 已证明 installer/transaction 等 `16 files / 253 tests` 全过，路径误拒绝已关闭；随后 PowerShell SelfTest 在成功删除专属恢复值后，用 `Get-ItemPropertyValue -ErrorAction SilentlyContinue` 查询不存在的值仍向顶层错误边界返回失败。
- Experiment or why unnecessary: 新 run 的精确末尾错误为专属 `e-MateUpdateRecovery-<transactionId>` property 不存在，发生在注册、核对、删除之后；不是安装包构建、Profile、Harness、插件或权限问题。当前 Mac 没有 PowerShell，真实 runner 是该边界的最窄执行证据。
- Decision and forbidden alternatives: 新增单一 `Get-RecoveryValue()`，通过原生 .NET `RegistryKey.GetValue(..., DoNotExpandEnvironmentNames)` 将“键/值不存在”确定性映射为 `$null`，并让生产 `Remove-Recovery` 与 SelfTest 共用；保留 transaction-id 命名、命令 owner 比对、删除和 `RegFlushKey`。禁止吞掉任意错误、跳过 SelfTest 或放宽恢复项所有权。
- Changed scope: 仅修改 Windows 更新事务脚本、既有源合同断言并 append 本记录；未改 schema、Desktop UI、Profile、Harness、发布或生产状态。
- Verification commands and results: 本机 Node `24.19.0` 下 `windows-update-transaction.spec.ts` 为 `1 file / 9 tests` 全过，`git diff --check` 通过；真实 PowerShell SelfTest 和 unsigned installer 必须由新 Windows CI 重跑确认，本条不预先宣称通过。
- Immutable evidence / receipt: 失败事实绑定 CI run `32844912068` 的 Windows job `97793781939`；没有签名、安装、R2/Feed/desired-state 写入。
- Remaining blockers: 新候选必须通过源合同和 Windows PowerShell SelfTest，再通过完整 CI；之后仍需冻结字节的真实 Windows 安装、在线更新、失败回滚和 P0/TQ 验收。
- Next exact action: 运行本机最窄源合同与 diff 检查，提交推送后只等待新的真实 Windows owner 结果；生产链保持关闭。

## 2026-08-25 · 2.0.13 Windows NSIS 快捷方式变量编译顺序修复

- Goal checkpoint: 继续关闭 PR `#56` 的真实 Windows 安装包编译门禁；本条只修复 electron-builder 原生快捷方式变量在私有更新事务分支中的首次展开顺序，不把安装、更新回滚或发布标记完成。
- Frozen baseline / current HEAD: 失败候选为 `525817412ae17df49ad3f84885d2313cfa75d2a9`，CI run 为 `32847226281`，Windows job 为 `97801253707`；Base/Harness 身份保持 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606`。
- Binding documents read: 复核根 `AGENTS.md`、目标/插件/性能合同、2.0.13 切片、上一条完整记录、pinned `app-builder-lib@26.15.3` 原始 NSIS 模板和唯一自定义 installer include。
- Inspected native seam: 真实 runner 已通过 Windows 源测试、PowerShell SelfTest 和应用打包，随后 makensis 在展开原生 `addStartMenuLink` 时报告 `$keepShortcuts` 未知。该原生宏读取全局 `$keepShortcuts`；私有事务宏在 upstream 声明之前首次展开同一宏，形成纯编译顺序错误。
- Experiment or why unnecessary: 对 Yarn 缓存中的原始 `app-builder-lib@26.15.3` 解包后执行完整补丁 `git apply --check` 和实际 apply，确认补丁可重放；无需新增快捷方式实现、关闭 warning-as-error、跳过 NSIS 或改变更新准入。
- Decision and forbidden alternatives: 将 upstream 已有 `Var /GLOBAL keepShortcuts` 与默认 `false` 初始化前移到 `setLinkVars` 后、所有安装分支共同入口，删除原位置重复声明；普通安装仍在原位置执行 `setIsTryToKeepShortcuts` 并可覆写为 `true`，私有事务分支确定性沿原生“重建快捷方式”语义。安装器仍属于 Desktop Base owner，禁止伪装成 Creation Mode/Profile 插件。
- Changed scope: 仅修改 pinned `app-builder-lib` 补丁、对应 Yarn patch hash/checksum、既有 Windows 事务合同断言并 append 本记录；未改事务协议、Profile、Harness、R2、Feed、desired state 或生产状态。
- Verification commands and results: 原始包完整补丁 `git apply --check` 通过；`windows-update-transaction.spec.ts` 为 `1 file / 9 tests` 全过；`package.spec.ts` 的 pinned app-builder patch-chain 定向合同为 `1/1`；`git diff --check` 通过。真实 makensis 必须由新 Windows CI 重跑确认，本条不预先宣称通过。
- Immutable evidence / receipt: 失败事实绑定上述 run/job；当前只有 source-fixed diff，没有生成、签名、安装、上传、激活或发布任何新字节。
- Remaining blockers: 新候选必须先通过 Windows makensis 和完整 PR CI；之后仍需冻结同字节的 Windows 安装、P0/TQ、在线更新、失败回滚和性能验收。
- Next exact action: 提交并推送最小补丁，让同一受保护 PR 的 Windows runner 编译真实 NSIS；只处理随后出现的精确 owner 失败，生产链保持关闭。

## 2026-08-25 · 2.0.13 Windows NSIS 单一进程检查宏修复

- Goal checkpoint: 继续关闭 PR `#56` 的 Windows makensis 门禁；本条只消除自定义事务与 upstream 安装路径对同一进程检查宏的重复编译展开，不把候选、安装或发布标记完成。
- Frozen baseline / current HEAD: `$keepShortcuts` 顺序修复候选为 `b6bdfd5175d777631fef16ed729b8afb10494aed`，CI run 为 `32853827955`，Windows job 为 `97822283753`；Base/Harness 身份不变。
- Binding documents read: 复核根 `AGENTS.md`、目标/切片合同、上一条完整记录、electron-builder `installSection.nsh`、自定义 `installer.nsh` 和对应事务合同测试。
- Inspected native seam: 新 runner 已证明 `$keepShortcuts` 编译错误消失，并继续通过 `16 files / 253 tests`、PowerShell transaction SelfTest、runtime closure 和应用 ASAR 打包；makensis 随后因自定义手动确认分支与 upstream 各展开一次 `CHECK_APP_RUNNING` 而报 `CmdPath already declared`。该宏含编译期全局变量声明，运行时分支互斥不能避免重复声明。
- Experiment or why unnecessary: 无需复制或改写 upstream 进程检测。将现有事务拆为同一流程的两个时点：私有回执/手动 SHA 确认仍在任何旧版本 mutation 前决定 `$R7`，upstream 唯一 `CHECK_APP_RUNNING` 完成后才 bootstrap/prepare/apply；仍在 `uninstallOldVersion` 前短路。
- Decision and forbidden alternatives: 删除自定义 include 中的 `CHECK_APP_RUNNING` 展开；复用现有 `$emateUpdateAction=manual` 信号把 Bootstrap 移入 `customUpdateInstall` 起点，不增加变量、协议、第二安装器或容错回退。fresh install、拒绝确认、managed receipt 与 manual receipt 的准入语义保持不变。
- Changed scope: 仅修改 pinned app-builder 补丁、自定义 installer include、Yarn patch hash/checksum和两项既有合同断言并 append 本记录；未改 PowerShell 事务协议、Profile、Harness 或生产链。
- Verification commands and results: 原始 `app-builder-lib@26.15.3` 完整补丁 `git apply --check` 通过；`windows-update-transaction.spec.ts` 为 `9/9`；pinned app-builder patch-chain 定向合同为 `1/1`；合同同时断言 decision 在 upstream 检查前、custom execute 在最后一次 upstream 检查后且在旧版本 mutation 前、自定义 include 不含 `CHECK_APP_RUNNING`；`git diff --check` 通过。
- Immutable evidence / receipt: 新失败绑定上述 run/job，前置 253 项和 SelfTest 成功事实来自同一 job；当前仍只有 source-fixed diff，没有生成、签名、安装、上传或激活发布字节。
- Remaining blockers: 必须由下一 Windows runner 真实编译 NSIS 并完成完整 PR CI；随后仍缺同一冻结字节的安装、P0/TQ、更新回滚和性能验收。
- Next exact action: 取消已被本修复取代的 run 剩余任务，提交推送最小修复并等待新 Windows makensis；生产发布链保持关闭。

## 2026-08-25 · 2.0.13 Windows NSIS 单一安装宏路径修复

- Goal checkpoint: 继续关闭 PR `#56` 的 Windows makensis 门禁；本条将私有更新事务收敛到 electron-builder 唯一解包、注册和快捷方式路径，不把候选、安装态或发布标记完成。
- Frozen baseline / current HEAD: 单一进程检查修复候选为 `85daba3905268bc1f8a3643df9b84087ec050ebd`，CI run 为 `32855312930`，Windows job 为 `97827430089`；Base/Harness 身份保持不变。
- Binding documents read: 复核根 `AGENTS.md`、目标/切片合同、上一条完整记录、pinned `app-builder-lib@26.15.3` 原始 NSIS 模板、自定义 installer include 和两项安装链合同测试。
- Inspected native seam: 新 runner 已通过 Source、Enterprise、六项 Base compatibility、Windows `16 files / 253 tests` 和 PowerShell SelfTest；makensis 随后在自定义事务与 upstream 各展开一次 `installApplicationFiles` 时报告 `packageArch already declared`。该宏及其下游注册/快捷方式宏包含编译期全局变量，运行时短路无法消除重复声明。
- Experiment or why unnecessary: 不再逐个前移全局变量。事务只保留 Prepare/Apply 两个时点：upstream 唯一进程检查后 Prepare 选择 candidate，upstream 唯一 `installApplicationFiles` 完成后 Apply/Monitor；registry、Start Menu、Desktop、file association 和 `customInstall` 全部继续由 upstream 各执行一次。
- Decision and forbidden alternatives: 普通安装维持原生 uninstall/extract/start 路径；私有 `stage` 跳过旧版卸载、把唯一解包定向到 candidate，`resume` 跳过重复解包，两者完成事务后复用同一 upstream 注册路径。禁止复制 electron-builder 宏、增加第二安装器、吞掉 warning-as-error 或把 Desktop Base 更新事务伪装成 Creation Mode/Profile 插件。
- Changed scope: 仅修改 pinned app-builder 补丁、自定义 installer include、Yarn patch hash/checksum和既有合同测试并 append 本记录；未改 PowerShell schema、Profile、Harness、R2、Feed、desired state 或生产状态。
- Verification commands and results: 原始 Yarn cache 中的 `app-builder-lib@26.15.3` 完整补丁 `git apply --check` 与实际重放均通过，重放模板与安装态模板字节一致；`windows-update-transaction.spec.ts` 为 `9/9`，pinned app-builder patch-chain 定向合同为 `1/1`，`git diff --check` 通过。真实 makensis 必须由下一次 Windows CI 确认。
- Immutable evidence / receipt: 失败事实绑定上述 run/job；当前只有 source-fixed diff，没有生成、签名、安装、上传、激活或发布任何新字节。
- Remaining blockers: 新候选必须通过 Windows makensis 和完整受保护 PR CI；随后仍需同一冻结字节的 Windows 安装、三项 P0/TQ、在线更新、失败回滚和性能验收。
- Next exact action: 取消已被替代的旧 run，提交并推送唯一宏路径修复；等待新的真实 Windows runner 生成 unsigned installer，生产链继续关闭。

## 2026-08-25 · 2.0.13 Profile 回滚后更新提示恢复修复

- Goal checkpoint: 在正式 2.0.13 候选安装前关闭本机已观察到的 Profile generation 回滚后不再自动提示同一恢复目标的问题；本条只修复更新提示去重 owner，不把 Profile 激活、安装态或发布标记完成。
- Frozen baseline / current HEAD: 修复基于受保护 PR `#56` 已全绿的 `dae78fcd40bf42620f4fd6d4916d899d450d7348`；Base/Harness 身份保持 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606`。本机 2.0.12 安装态的 generation state 为 `active=last_known_good=bundled`，旧 v6 generation 缓存仍存在。
- Binding documents read: 复核根 `AGENTS.md`、`docs/target-contract.md` 中 `(current generation, target generation)` 后台提示去重合同、`docs/slices/2.0.13.md`、上一条完整记录，以及 `updates.ts`、`profile-update.ts`、`profile-generation.ts` 与对应测试。
- Inspected native seam: `ProfileUpdateAvailable` 已由唯一原生检查链同时携带 `currentGeneration` 与 `generationId`；更新状态却只持久化 `lastPromptedGeneration`。因此从已提示目标回滚到 `bundled` 或另一 generation 后，相同目标仍被误判为同一提示，直到目标 ID 改变才偶然恢复。
- Experiment or why unnecessary: 本机状态精确为 `active=bundled` 且 `lastPromptedGeneration=d876...`，缓存中的 d876 generation 属于 Base v6 / Harness `2bc162...`，不能由 Base v7 恢复；初始回滚原因没有不可变收据，故不臆测。现有字段和确定性状态机已足以复现持续抑制，无需新存储、网络或 Creation Mode 模拟 Desktop lifecycle。
- Decision and forbidden alternatives: 继续复用唯一 v2 update state，只增加 `lastPromptedCurrentGeneration` 并按 current/target pair 比较；旧 target-only v2 状态被视为没有已记录 pair，因此在当前 generation 只重新提示一次并原地补齐字段。相同 pair 不重复，不同 current 的同一 target 会重新提示。禁止恢复不兼容旧 generation、清缓存、伪造新目标 ID、增加第二 updater 或把 Desktop 生命周期包装成 Profile 插件。
- Changed scope: 仅修改 `desktop/e-mate-desktop/src/updates.ts`、既有 `updates.spec.ts` 与 append 本记录；未改 Profile generation 格式、签名/desired state、Harness、组件 roster、R2、Feed、官网或生产状态。
- Verification commands and results: Desktop `profile-generation.spec.ts`、`profile-update.spec.ts`、`updates.spec.ts` 为 `3 files / 42 tests` 全过；主源码与测试 TypeScript 均通过；其中覆盖首次 pair 持久化、相同 pair 不重复、current 改变或回滚为 bundled 而 target 相同重新提示及旧 v2 target-only 状态迁移；`git diff --check` 通过。
- Immutable evidence / receipt: 当前只有 source-fixed diff 与本机只读状态证据。`desktop-release` run `32860583362` 在本修复前从 `dae78fc` 启动，即使完成也属于已取代候选，不得安装、验收或发布；此前 CI `mac-smoke` 同样未安装且永久不具备发布资格。
- Remaining blockers: 必须提交并推送该最小修复，重新通过 exact-HEAD PR CI 与只构建不发布的正式 Desktop candidate workflow；之后才可执行 macOS 手工候选 UI/P0 验收。Windows 真机、原生 signed updater transaction、Profile v7 激活、性能、回滚和生产回读仍 OPEN。
- Next exact action: 提交并推送 pair 去重修复，让 PR #56 在新 HEAD 重跑受保护 CI；作废旧 run 候选，生产链保持关闭。

## 2026-08-25 · 2.0.13 Profile 提示状态向后兼容与回滚重试修正

- Goal checkpoint: 独立复审否决并取代上一条 `ac7ff896edd2d635c95b986a1116783090e342b1` 的四字段 v2 状态方案；本条只修复同一 Desktop updater 状态链，不把候选、安装态或发布标记完成。
- Frozen baseline / current HEAD: 待修正 HEAD 为 `ac7ff896edd2d635c95b986a1116783090e342b1`，其父提交 `dae78fcd40bf42620f4fd6d4916d899d450d7348` 的受保护 PR CI 已通过；Base/Harness 仍为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606`。
- Binding documents read: 重新读取唯一 Goal、Git/HEAD、完整 `AGENTS.md`、`target-contract.md`、2.0.13 切片合同、最新完整日志，并核对 `updates.ts` 的所有 prompt/state 调用方及 Profile generation/update 测试。
- Inspected native seam: 旧 2.0.12 Base 的 v2 reader 只接受 `version`、`lastPromptedVersion`、`lastPromptedGeneration` 三个键；`ac7ff89` 新增第四键会使旧 Base 回读时重置整个状态并丢失 Base 提示记录。该方案还在确认前持久化 pair，导致 A→B 启动失败回滚 A 后同一恢复目标继续被抑制；Base/Profile 并发原子写也可能以完成顺序覆盖彼此快照。
- Experiment or why unnecessary: 两个独立只读复审分别检查旧 Base reader、A→B→A 生命周期和并发写序；无需新文件、schema、存储或 Creation Mode，因为该 owner 是 Desktop 生命周期且现有单一状态文件已可表达正确语义。
- Decision and forbidden alternatives: 保持旧 v2 精确三键格式，在现有 `lastPromptedGeneration` 中存放带 domain 的 `SHA-256(currentGeneration,targetGeneration)`；旧 target-only 值自然只迁移提示一次。只在用户明确拒绝时记录 pair；用户后来手动接受时先持久化清除相同拒绝摘要，再走原生 recheck/install，使安装失败或 B 启动失败回滚 A 后可重新提示。状态 mutation/write 由单一 Promise tail 串行且失败不毒死后续写。禁止第四字段、第二状态文件、恢复不兼容 generation、伪造目标或新增 updater。
- Changed scope: 修正 `desktop/e-mate-desktop/src/updates.ts`、扩充既有 `updates.spec.ts`，并更新 2.0.13 最终范围合同；未改 Profile schema、Harness、roster、R2、Feed、desired state 或生产状态。
- Verification commands and results: `profile-generation.spec.ts`、`profile-update.spec.ts`、`updates.spec.ts` 共 `3 files / 48 tests` 全过；生产与测试 TypeScript 均通过；`git diff --check` 通过。覆盖旧 reader 接受、legacy target-only 迁移、同 pair 拒绝去重、current/target 变化、手动接受清除、即时安装失败、B 激活失败回滚 A、确认异常、supersede、dispose、Base/Profile 并发及失败写后继续。
- Immutable evidence / receipt: 只有当前 source-fixed diff；`ac7ff89` 和旧 `dae78fc` release run 均永久作废，不得安装、验收或发布。没有生成、签名、安装、上传或激活任何字节。
- Remaining blockers: 必须形成新提交并通过 exact-HEAD PR CI，再启动全新只构建不发布的正式 Desktop candidate；macOS/Windows 同一字节安装态、P0/TQ、性能、更新/回滚与公开回读继续 OPEN。
- Next exact action: 提交并推送本修正，等待 PR #56 新 CI 全绿；随后仅从新 HEAD 生成正式候选，继续拒绝任何 2.0.12 UI 或 mac-smoke 作为 2.0.13 证据。

## 2026-08-25 · 2.0.13 最终事故范围与 2.0.14 接力边界

- Goal checkpoint: 按用户最新决定将本任务终态收敛为三个 Windows P0、共享 Windows Profile 物化前置项和 TQ-01..13 的 2.0.13 正式发布；其余原计划未闭环能力转入独立 2.0.14 接力，不提前结束当前 Goal。
- Frozen baseline / current HEAD: 范围修订发生在上述 Profile 状态修正尚未提交时；当前源码基线、Base v7、Harness pin、PR #56 与生产隔离边界均不变。
- Binding documents read: 核对唯一 Goal、根 `AGENTS.md`、目标/插件/性能合同、完整 2.0.13 切片、最新日志和当前 Git 状态；2.0.14 独立任务只接收只读恢复与后续审计结果。
- Inspected native seam: 这是发布范围与任务所有权修订，不改变任何运行时 seam。2.0.13 的 P0/TQ owner/carrier/验收矩阵继续有效，不能因移交其他能力而降低门槛。
- Experiment or why unnecessary: 无需产品实验；范围必须先写入切片合同，避免当前分支与新任务并发修改、把源码候选误当发布内容或把未验功能静默塞入事故版。
- Decision and forbidden alternatives: 2.0.13 候选、roster、更新说明和正式字节只容纳 P0/TQ 闭环所需变化；Goal、Canvas、非 TQ ImageGen、通用 Deliverables、Pet/30 动作、C03 图标、Better Sidebar 扩展及其他未闭环新能力保持 OPEN 并移交 2.0.14。2.0.14 在 2.0.13 发布前只能只读审计和写自己的合同，禁止触碰本分支或生产链。
- Changed scope: 仅更新 `docs/slices/2.0.13.md` 并 append 本记录；创建新的 Codex 接力任务不改变仓库或发布状态。
- Verification commands and results: 文档范围与现有 P0/TQ 矩阵交叉核对；`git diff --check` 通过。独立缺口审计仍在执行，结果将按 owner、证据、依赖和最小验收发送给 2.0.14 任务。
- Immutable evidence / receipt: 新接力任务 id 为 `01a0396e-5295-7e02-8549-edfe44451fee`；没有构建、安装、上传或发布任何字节。
- Remaining blockers: 2.0.13 仍须完成 exact-HEAD CI、正式候选、双平台 P0/TQ、性能、安全、更新、回滚及生产公开回读；2.0.14 清单中的所有项默认 OPEN，不能反向阻塞或替代 2.0.13 的事故门。
- Next exact action: 继续完成 2.0.13 Profile 状态修正提交和正式候选；审计返回后只向 2.0.14 任务发送结构化清单，本任务直到 2.0.13 真正发布才结束。

## 2026-08-25 · 2.0.13 越界审计分类候选排除

- Goal checkpoint: 根据 2.0.14 独立缺口审计，将已经进入当前历史但不属于三个 P0、共享 Windows Profile 前置项或 TQ-01..13 的任务场景分类候选从 2.0.13 事故版排除；分类保持为 2.0.14 OPEN 候选。
- Frozen baseline / current HEAD: 审计基于 `release/2.0.13-p0-tq@6b6ca145a827aa4deb322b3b13721ed76f2bf42f`；越界分类提交为 `7836d70997046e71cbc844b7aff67aa8b15a941d`。其子提交 `7e79c969318077c3f20833ecb1f81c340abe4a1a` 关闭 Analytics/Admin 第二审计写入口，经独立复审认定为现有 target contract 的单一生产者安全边界，不随分类反向。
- Binding documents read: 核对用户最新最终范围、根 `AGENTS.md`、`target-contract.md`、2.0.13 切片、完整 development log、两提交全部文件和后续 descendant touches；2.0.14 审计清单已发送到任务 `01a0396e-5295-7e02-8549-edfe44451fee`。
- Inspected native seam: `7836d70` 改动客户端 `emate.audit` 场景推导、provenance、outbox 隔离与 identity rejection，形成尚无最终 Base/Profile/真实投递/生产面回执的非 TQ 能力；`7e79c96` 则移除 `/v1/tasks/events`、旧 `task-events:write` 凭据及合并 scope，使既有 `emate.audit → Model Gateway → task ledger` 成为唯一生产写链。
- Experiment or why unnecessary: 先机械反向两提交的实验被独立复审判为 P1：会重新开放 caller-controlled 第二写入口和双生产者。该实验未提交并已完整中止；最终只反向 `7836d70`。机械反向同时带走了一处后来仍由 Model Policy 测试需要的 settings revision fixture，该夹带变化已最小保留。
- Decision and forbidden alternatives: 2.0.13 恢复分类前的 `GENERAL` 任务事实，不发布场景分类；保留单一生产者退役闭包作为安全不变量，但不在更新说明宣传为新能力。禁止重新开放 Analytics/Admin task-event 写入、改写公共历史、整枝重建或把分类隐藏在事故版字节。分类在 2.0.14 重新按唯一 owner、隐私、稳定性和真实 Gateway/Postgres/UI 对账准入。
- Changed scope: 反向应用 `7836d70` 涉及的 7 个 DSH 文件，选择性保留 `identity-lifecycle.test.mjs` 当前 Model Policy settings revision fixture，并同步目标/切片范围合同；未触碰 P0/TQ 产品 owner、Desktop updater、企业单一生产者、R2、Feed、desired state 或安装态。
- Verification commands and results: 反向范围的 DSH 首轮 `52/53`，唯一失败是机械反向误带走无关 settings `describe/revision` fixture；恢复后定向 `8/8`、完整 DSH `53/53` 与 Shell `67/67` 全过。两提交全反向的企业 `check/test/build` 实验曾通过，但因独立安全复审否决而不作为最终 diff 证据；最终保留 `7e79c96` 的企业字节由新受保护 CI 重验。`git diff --check` 通过。
- Immutable evidence / receipt: CI run `32863107272` 属于排除前 `6b6ca14`，已请求取消且不得作为候选；当前只有源码反向 diff，没有生成、安装或发布字节。
- Remaining blockers: 必须提交/推送排除变化并让新 exact HEAD 通过完整 PR CI；随后才能生成正式 macOS 候选。Windows 真机和 P0/TQ 全部安装/更新/回滚门仍 OPEN。
- Next exact action: 复核最终反向 diff 只移除分类候选且保留单一生产者闭包，提交后重跑 PR #56 CI，生产链继续关闭。

## 2026-08-25 · 2.0.13 Windows 冷 Profile 合同测试时限修正

- Goal checkpoint: 受保护 CI 在 exact HEAD `22538ac7ead211ec19833391863d131641d4c805` 的 Windows 安装器作业中只因一条 Profile 组合合同超过 Vitest 默认 5 秒而失败；本条只修测试时限误判，不改变生产 Profile、打包器或发布范围。
- Frozen baseline / current HEAD: 失败绑定 run `32864830246` / job `97859184341`；其余 target、Harness、企业合同和六项 Base 兼容矩阵均已通过，macOS 包作业仍独立执行。生产、R2、Feed、desired state 与安装态均未写入。
- Binding documents read: 核对根 `AGENTS.md`、2.0.13 最终 P0/TQ 边界、`profile.spec.ts`、`profile.ts`、Vitest 配置、Windows package check 及本次/上一绿跑的同名测试日志。
- Inspected native seam: 该断言以冷 `$DSH_HOME` 调用唯一 `prepareDesktopProfile`，会物化完整依赖 junction fallback 并验证 Host/Web/Profile 组合；这是有意的磁盘密集型集成合同，不是纯内存单元测试。生产 owner 与所有调用方不变。
- Experiment or why unnecessary: 本次 Windows runner 中同一测试在 `5.984s` 完成后，其余同文件测试继续通过；上一全绿 run `32857386958` / job `97834652832` 的同一未变测试为 `1.606s`。`dae78fc..22538ac` 对 `profile.ts`、`profile.spec.ts`、Vitest 配置和 package scripts 无 diff，排除本轮逻辑死锁或新 I/O 路径。
- Decision and forbidden alternatives: 只为这一条完整冷 Profile 合同设置局部 `15_000ms` 预算并写明 Windows junction/冷盘原因；其余 252 项继续使用默认 5 秒。禁止全局放宽、重试隐藏、删除组合断言、绕过 junction 物化或修改生产启动逻辑。
- Changed scope: 仅修改 `desktop/e-mate-desktop/tests/profile.spec.ts` 并 append 本记录；没有新增依赖或触碰产品字节。
- Verification commands and results: `profile.spec.ts` 本机 `15/15` 通过，测试 TypeScript 检查通过，`git diff --check` 通过；必须由下一次 Windows CI 证明该局部预算覆盖真实冷 runner 且安装器其余检查继续执行。
- Immutable evidence / receipt: 当前只有 CI 失败/历史对照与 source-fixed diff；run `32864830246` 因 Windows job 失败不能作为发布门或候选依据，即使其 macOS job随后成功也只可作诊断证据。
- Remaining blockers: 提交并推送后必须重新通过 exact-HEAD 全量 PR CI，再生成全新正式候选；不得复用当前失败 run 的任何制品。
- Next exact action: 在主代理复核最小 diff 后提交、推送并等待新 CI；生产发布链继续关闭。

## 2026-08-26 · 2.0.13 正式候选跨 Base Profile 验签与 Windows 冷物化门禁修正

- Goal checkpoint: 受保护 `main` 首轮正式 Desktop/Profile 候选暴露两个发布准备阻断；本条只修复共同验签迁移边界和一条 Windows 冷磁盘测试时限，不把候选、安装态或发布标记完成。
- Frozen baseline / current HEAD: 失败候选绑定 `main@de09046e24d50e4d9c41cb67b75d183483b80da0`、accepted CI run `32873388124`、Desktop run `32876823255` 和 Profile run `32876823223`；Base/Harness 仍为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606`。
- Binding documents read: 重新读取唯一 Goal、完整 `AGENTS.md`、`target-contract.md`、2.0.13 最终范围合同、最新日志、`profile-release.ts` 全部调用方、线上三目标快照和两条失败 job 日志。
- Inspected native seam: Profile 发布准备必须先用 v7 信任根验签线上 2.0.12 desired state，再由 `selectProfileRelease()` 判定 `base-required`；但新增 `schedule_protocol_floor` 后的严格解析器在验签前拒绝了缺少该字段的历史已签名 payload，使合法迁移入口不可达。Windows 安装器则在同一源码树的四次物理 Profile 安装/修复合同上由 PR runner 的 `3.618s` 漂移到正式 runner 的 `9.031s`，测试实际继续完成而默认 `5s` 已先判失败；其余 `252/253` 通过。
- Experiment or why unnecessary: 用仓库内 Cloudflare 插件捕获的真实三目标 2.0.12 快照逐一回放；修复后三者均完整 Ed25519 验签并只归类为内部 floor `0` / `base-required`。当前格式中显式 floor `0`、签名漂移、额外字段和非法 payload 仍失败关闭。Windows 对照使用 exact-tree PR job `97866495210` 与正式 job `97899403846`，排除本轮生产物化逻辑变化或死锁。
- Decision and forbidden alternatives: 签名始终覆盖原始 payload；只对精确旧键集合做验签后归一化，缺失 floor 永远不能匹配 floor-aware Base。当前格式继续要求正整数。Windows 仅给该四次物理安装集成合同局部 `15_000ms`，不放宽全局、不删除修复断言、不隐藏失败、不增加第二发布器或绕过 Profile 签名/父代检查。
- Changed scope: 修改 `desktop/e-mate-desktop/src/profile-release.ts`、既有 `profile-release.spec.ts`、`e-mate-profile-win.spec.ts` 并 append 本记录；未改 Profile payload 生成格式、Base/Harness、组件 roster、R2、Feed、desired state、生产安装态或用户数据。
- Verification commands and results: 真实三目标快照均输出 `verified=true`、`floor=0`、`selection=base-required`；`profile-release.spec.ts` 为 `7/7`；生产与测试 TypeScript 检查通过；`publish-profile-r2.test.mjs` / `profile-release.test.mjs` 合并为 `4 passed / 1 toolchain-absent skipped / 0 failed`；新 exact-HEAD CI 待提交后执行；`git diff --check` 通过。
- Immutable evidence / receipt: 两个失败 run 永久不能作为候选或发布证据；当前只有 source-fixed diff 和只读日志/快照证据，没有上传、激活或生产写入。
- Remaining blockers: 提交后必须通过新受保护 PR CI，再从新的 protected-main SHA 生成 Desktop/Profile 候选、性能与 admission；同一字节的 macOS/Windows 安装、P0/TQ、更新、回滚和公开回读继续 OPEN。
- Next exact action: 跑定向发布合同，提交并推送最小修复，走受保护 PR 合并与全新 exact-main 候选；所有旧候选作废，生产链继续关闭。

## 2026-08-26 · 2.0.12→2.0.13 macOS 原生更新 ACK 前驱桥接修复

- Goal checkpoint: 在正式候选安装前关闭真实 2.0.12 原生 helper 无法确认 2.0.13 启动、必然超时回滚的 P0；本条只修唯一 macOS ACK seam，不安装、不上传、不激活或发布候选。
- Frozen baseline / current HEAD: 修复从受保护 `main@100a670f283e6b9fcb1d032b086b37a45d9279c4` 独立分支开始；候选 Base/Harness 仍为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606`，目标只允许精确 `2.0.12→2.0.13`。
- Binding documents read: 完整复核根 `AGENTS.md`、`target-contract.md`、2.0.13 最终范围合同、上一条完整日志、候选 ACK/原子替换实现及本机已安装 2.0.12 `app.asar` 中同一模块的 source map。
- Inspected native seam: 2.0.12 helper 启动新应用时只传 `EMATE_MAC_UPDATE_ACK_PATH/TOKEN/VERSION`，而 2.0.13 只接受含 source/Base/floor/manifest/artifact/appId/arch 等 12 字段的新握手；因此候选在 renderer 健康后仍会拒绝环境，旧 helper 等待 60 秒后回滚。旧 helper 在看到六字段旧 ACK 前始终保留 predecessor backup。
- Experiment or why unnecessary: 从真实安装包复原旧请求的 15 个生成字段、路径命名和六字段 ACK，不凭记忆造兼容格式。该 owner 是 Electron 原子替换/进程生命周期，Creation Mode 无法安全模拟且不适用；无需第二 updater、Profile 路径或新依赖。
- Decision and forbidden alternatives: 在唯一 `writeMacUpdateStartupAck()` 入口识别精确三字段集合，严格读取 no-follow、限长、精确 15 键的旧请求，并只允许 2.0.12 predecessor、2.0.13 target、canonical app/transaction/Trash 路径。旧 ACK 延迟到既有 `commitApplied`，即 probation 窗口可见且 Schedule admission 打开后才耐久写入，使失败仍由旧 helper 原子回滚。任意缺字段、混入新字段、未知字段、扩展/漂移请求均失败关闭；完整 12 字段新协议及 source/Base/floor/manifest/artifact/appId/arch、pending owner、installed receipt、IPC confirmation 校验完全不变。禁止接受任意 partial env、为旧请求伪造 provenance、提前写 ACK 或绕过 Schedule/rollback。
- Changed scope: 仅修改 `desktop/e-mate-desktop/src/mac-update-installer.ts`、既有 `mac-update-installer.spec.ts` 并 append 本记录；未改 updater 下载/manifest、Base/Profile/Harness、R2、Feed、desired state、真实安装态或用户数据。
- Verification commands and results: `mac-update-installer.spec.ts` 与 `electron-runtime.spec.ts` 首轮为 `2 files / 124 tests` 全过；补充请求漂移反例后 `mac-update-installer.spec.ts` 为 `86/86`，生产及测试 TypeScript 均通过，`git diff --check` 通过。覆盖真实旧三字段正例、ACK 延迟、缺失/混合/未知字段、错误前驱、扩展与 probation 中漂移请求、新完整协议回归，以及 ACK 未 apply 时 predecessor 原子回滚。
- Immutable evidence / receipt: 根因输入来自本机已安装 2.0.12 包内 source map；源码修复绑定本分支后续提交。没有生成、签名、安装、上传、激活或发布任何新字节，既有 candidate run/artifact 因缺少本修复不得作为可发布候选。
- Remaining blockers: 新提交必须通过受保护 CI，并从合并后的 exact main 重建正式候选；随后必须从未改动的真实 2.0.12 经原生在线更新验证成功、失败回滚、Schedule admission、Profile/Base 回执和安装后版本/哈希，当前源码测试不能替代安装态门禁。
- Next exact action: 提交本最小桥接并交主代理复核；禁止复用旧候选，生产链保持关闭。

## 2026-08-26 · 2.0.12→2.0.13 旧更新入口单调迁移闭环

- Goal checkpoint: 在 ACK 修复后继续沿真实已安装 2.0.12 更新链追踪可达性；发现既有合同会让全部 v6 客户端永久读到 equal-version 2.0.12，故在重新构建候选前修复唯一生产发布 seam，不上传或激活任何字节。
- Frozen baseline / current HEAD: 调查和修复基于 `hotfix/2.0.13-legacy-update-ack@2a37a442b303a0ed397797cf3193a6745575d80b`；此前 `main@100a670f283e6b9fcb1d032b086b37a45d9279c4` 的 Desktop/Profile/Performance 候选及当前 PR CI 均因缺少本修复作废，不能复用。
- Binding documents read: 重新核对唯一 Goal、根 `AGENTS.md`、`target-contract.md`、2.0.13 切片、环境/发布合同、完整上一条日志、正式安装包内 2.0.12 updater/parser/source map和外部 signer action。
- Inspected native seam: 已发布 2.0.12 只轮询固定 R2 `desktop/latest.json`，reader 上限 16 KiB且只消费 `version/artifacts`；它忽略 rich/signature 额外字段，但仍强制同一 R2 origin、commit-scoped 版本路径、bytes、SHA-256、DMG/PE 格式，并在 macOS 走深度签名和原生替换/回滚。原合同永久冻结该入口会使真实用户永远看不到 2.0.13，人工下载不是在线更新闭环。
- Experiment or why unnecessary: 既有 `release.test.mjs` 已可执行证明旧 parser 接受同一 rich signed manifest，新增旧 reader 16 KiB 上限回归即可；不改产品 parser、不新增 updater、服务、Profile carrier或客户端协议。外部发布 action 的计划/CAS 行为由其既有 Node 合同测试覆盖。
- Decision and forbidden alternatives: 将 exact signed manifest 作为人工不可变路径、v7 signed feed和legacy bootstrap的唯一字节。发布顺序固定为 immutable上传和完整公网回读→signed pointer原生条件写/CAS及回读→legacy pointer以精确 948-byte 2.0.12 predecessor为条件、绝对最后CAS及回读。Base v7以后只读signed feed，legacy永久停在2.0.13。禁止本地/测试字节、两份manifest、非条件覆盖、把后续版本写入legacy或另造迁移器。
- Changed scope: 外部受保护 publication action 已在独立仓库以 PR #1 合并为固定 main `6be6cf166889899fb9ce6956ccf0f12e9ecc40e3`；本仓库只更新其 immutable pin/必填 predecessor input、既有合同测试、目标/环境/切片合同与本记录。未改 Desktop runtime、Base/Profile/Harness、R2、Feed、desired state、安装态或用户数据。
- Verification commands and results: 外部 action Node tests `50/50` 全过；本仓库 workflow/input/pin/16 KiB 与 release 合同定向 Node tests `22/22` 全过，`git diff --check` 通过，仍须由新 exact-HEAD CI 再验。旧 2.0.12 predecessor为 `948` bytes / SHA-256 `e6d5e045364bdac97ea7fef41b1e28a20af06c9f4ffdd85d2c136e982d12a7dc`。
- Immutable evidence / receipt: 外部 action reviewed main SHA `6be6cf166889899fb9ce6956ccf0f12e9ecc40e3`；本仓库当前只有 source-fixed diff。没有 Cloudflare Worker、R2写入、指针变化、候选安装或生产发布。
- Remaining blockers: 提交并通过新 PR CI、合并到受保护 main、重跑 exact-main CI/Desktop/Profile/Performance/admission；随后按 Cloudflare 插件一次性 Worker的multipart/CAS合同上传并公开回读，并完成真实2.0.12→2.0.13更新、故障回滚和双平台P0/TQ验收。
- Next exact action: 复核最小 diff、提交并更新 PR #58；当前生产链继续关闭，所有旧 run/artifact 永久作废。

## 2026-08-26 · 2.0.13 TTFT v2 同口径场景合同收紧

- Goal checkpoint: 现有 performance admission 会把三种场景池化、要求非 Tool 样本伪填 Tool timing，并以单组 Provider/request 字段表示实际有两次模型请求的 read-only Tool；本条只修正证据合同、verifier 与 fixture，不采集真实模型、不生成候选或发布。
- Frozen baseline / current HEAD: 独立 worktree `codex/performance-v2-real-contract` 从 `public-2011/main@100a670f283e6b9fcb1d032b086b37a45d9279c4` 创建；Base/Harness/Desktop reference 仍为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606` / `6074088f5b660206e404b3591fab51fb99c69add`。
- Binding documents read: 完整读取 `AGENTS.md`、`target-contract.md`、`slices/2.0.13.md`、`performance-and-acceptance.md` 与本日志此前最后一条；实现前先更新三份绑定合同。
- Inspected native seam: 证据继续由同一 20 个 source-partitioned 文件、native Session trace、request-header artifact、managed Provider receipt、renderer paint、installed/enterprise receipt 和 `scripts/performance-parity.mjs` 组装；workflow 外壳与外部 signer/action 未改。旧 closed row 每个 pair 只有一组 request/Provider 字段，且 `exactKeys()` 强制所有场景拥有数值 Tool/waterfall 字段，无法诚实表达现有运行路径。
- Experiment or why unnecessary: 可执行反例证明 short-text 基线 `100ms`→候选 `160ms`、另两类均 `1000ms` 时旧池化 evaluator 仍通过结构门；删除非 Tool timing 或加入第二 Provider attempt 则被旧 schema 拒绝。修复后使用 exact `b2b1650...` 已构建 AgentLoop 闭包运行 30 行 fixture：三类各 10，request attempt 为 `1/1/2`，非 Tool 带 Tool timing 为 `0` 条，结果仍为 `fixture-passed-production-blocked`。
- Decision and forbidden alternatives: 保持 `schema_version: 2` 和既有 20 文件，只把它收紧为首个可生产的 v2 语义：三场景闭合判别 row、ordered request/Provider attempts、每次 candidate request attempt 的 diagnostic 为 `null` 或闭合非负对象；硬门逐场景计算。禁止旧 evidence 兼容 parser、字段聚合哈希、非 Tool 补零、跨场景 percentile、多模型 aggregate 和 fixture 重标 production；此前所有 v2 evidence/admission 作废并须重采。
- Changed scope: 修改 `docs/target-contract.md`、`docs/performance-and-acceptance.md`、`docs/slices/2.0.13.md`、`scripts/performance-parity.mjs`、既有 `scripts/performance-parity.test.mjs` 并 append 本记录；未改 workflow、20 文件外壳、Desktop/Profile/Harness、模型路径、生产 R2/Feed/desired state 或用户数据。
- Verification commands and results: `pnpm run test:performance:parity` 为 `10 passed / 0 failed`；覆盖逐场景 TTFT、非 Tool 字段缺省/伪零、旧 flat v2 拒绝、1/1/2 attempts、第二 header 漂移、重复 Provider invocation、candidate diagnostic 非硬门及 source-artifact semantic rehash。exact Harness fixture 为 `fixture-passed-production-blocked`，三类各 10 且形状符合合同；`git diff --check` 通过。
- Immutable evidence / receipt: 当前只有 source-fixed commit 前 diff 与本地无密钥 fixture；未运行真实模型、未接触凭据、未注册 runner、未签名 admission、未发布。旧 performance evidence 和 workflow `32888885073` 不可复用。
- Remaining blockers: 必须从 exact 2.0.12/2.0.13 安装字节按新 schema 重采同模型同场景真实 Provider/paint/header evidence，并由 protected-main verifier 产生新 `performance_run_id` 与签名 admission；性能结果、安装态和发布继续 OPEN。
- Next exact action: 主代理复核并移植本提交，经 protected CI 后只把当前 verifier 字节交给外部 collector；不得使用旧 evidence root 或以 fixture 关闭生产门。

## 2026-08-26 · 2.0.13 四模型 TTFT v2 aggregate 发布门

- Goal checkpoint: 在同口径场景合同收紧后补齐四个正式聊天模型各自独立的生产性能准入；本条只实现仓库侧 evidence 分流、aggregate 验签、工作流和更新来源合同，不采集真实模型、不生成候选、不签名或发布。
- Frozen baseline / current HEAD: 独立 worktree `codex/performance-four-model-aggregate` 从已包含 TTFT v2 场景合同的 `8f5a8f2a4de101d639b2ea4132d617bff4c1938e` 创建；Base/Harness 身份保持不变，未触碰 `legacy-update-ack` 工作树。
- Binding documents read: 完整读取根 `AGENTS.md`、`target-contract.md`、`performance-and-acceptance.md`、`slices/2.0.13.md`、上一条完整日志，并逐字段核对外部受保护 performance/publication action 的四模型 aggregate 实现。
- Inspected native seam: 继续复用唯一 `desktop-performance`→外部 signer→`desktop-admission`→manifest/updater 链。固定 roster 为 Luna、Sol、DeepSeek、Doubao；每个 leaf 保留现有 TTFT v2 verifier、20 个 support receipt、重算 Profile aggregate及独立 `performance_run_id`，外层只投影原有四字段 performance summary。
- Experiment or why unnecessary: 该变更属于 release-plane provenance 与闭合集验签，Creation Mode 不能表示 GitHub artifact、签名或安装字节，故不创建动态插件。没有运行真实模型或读取凭据；使用本地签名 fixture 验证 exact `4 × 22 + 1 = 89` 文件、缺模型、重复 child run 与 fixture 拒绝。
- Decision and forbidden alternatives: 四个 leaf 按 `luna/sol/deepseek/doubao` 和公开 route/provider/model/reasoning 固定顺序独立比较，禁止跨模型混样、缺项、重复 run、rerun、fixture 或 Goal 样本进入 2.0.13 aggregate。外层使用 domain-separated 签名和 ordered child digest；更新 manifest 仍只有 `performance_run_id/admission_sha256/signature_key_id/verifier` 四字段。GitHub performance 与 publication action 均精确 pin 到受保护 main `eca005391708dc6ac3057a8702995e2475cdaaf2`，artifact provenance 只接受 `run_attempt=1` 和 `-attempt-1` 名称。
- Changed scope: 修改 Desktop performance/admission/publication workflows、`scripts/desktop-admission.mjs` 及既有测试、更新器与下载页同一 provenance validator、三份绑定合同和本记录；下载页脚本因字节变化按真实 SHA-256 前 12 位从 `site.a8feef4609f9.js` 更名为 `site.865115b8aa11.js`。未改 child verifier/schema、模型路由、Base/Profile/Harness、外部 action、R2/Feed/desired state 或用户数据。
- Verification commands and results: `node --test scripts/desktop-admission.test.mjs` 为 `8/8`；`node --test scripts/release.test.mjs` 为 `15/15`；Desktop `update-checker.spec.ts`、`desktop-release-manifest.spec.ts`、`updates.spec.ts` 为 `3 files / 103 tests` 全过；下载页测试同时确认脚本文件名等于当前内容 SHA-256 前 12 位。`git diff --check` 通过。
- Immutable evidence / receipt: 外部受保护 action pin 为 `eca005391708dc6ac3057a8702995e2475cdaaf2`；当前只有 source-fixed diff 和无密钥 fixture。没有 production evidence、真实 `performance_run_id`、签名 admission、候选安装、上传或生产指针变化。
- Remaining blockers: 必须由 exact protected-main workflow 从四个正式模型各自的新 schema v2 真实安装态证据生成四个 attempt-1 leaf，再由固定外部 action生成 aggregate并由 Desktop admission 回验；候选、安装态、更新/回滚和公开发布仍为 OPEN。
- Next exact action: 主代理复核并移植本提交，运行受保护 CI；随后只允许 source-partitioned collector 填入四个完整 cohort，缺任一真实 leaf 即保持发布门关闭。

## 2026-08-26 · 2.0.13 S35 legacy bootstrap 与 R2 条件晋升终审

- Goal checkpoint: 在四模型 aggregate 合入发布分支前，独立复核真实安装态 2.0.12 updater、一次性 v6→v7 bootstrap 和 Cloudflare 大制品写入边界；本条只收紧仓库级规则与发布合同，未写生产。
- Frozen baseline / current HEAD: 安装态仍为 `/Applications/e-Mate.app` 2.0.12；发布分支已包含 `8f5a8f2a4de101d639b2ea4132d617bff4c1938e` 和四模型提交 `cdd4332`，正式候选尚未重建。
- Binding documents read: 根 `AGENTS.md`、`target-contract.md`、`slices/2.0.13.md`、上一条完整日志；外部 publication protected main 固定为 `eca005391708dc6ac3057a8702995e2475cdaaf2`。
- Inspected native seam: 直接调用安装包内 2.0.12 `app.asar/lib/update-checker.js` 喂入完整 12 字段 rich manifest；2950-byte 样本被识别为 `2.0.12→2.0.13`，旧 parser 只消费 `version/artifacts`，但保留固定 R2 origin、版本/commit path、bytes、SHA-256、无重定向、DMG/PE 与 macOS 原生替换/ACK 回滚。2.0.13 只读并严格验签 `desktop/signed/latest.json`。
- Experiment or why unnecessary: updater 信任与 R2 发布属于 Base/release plane，Creation Mode 不能代表。Cloudflare 终审确认 multipart `complete()` 没有条件写，直接完成到最终 key 存在预检后覆盖竞态；R2 条件 `put` 才能在临时对象全量回读后 create-only 晋升。
- Decision and forbidden alternatives: 仓库级规则与 target contract 统一为唯一 2.0.13 legacy 例外：同一 admitted signed bytes 先 immutable/公开回读，再 signed CAS/回读，legacy 以精确 948-byte 2.0.12 前驱绝对最后 CAS，之后永久停在 2.0.13。multipart 只到随机临时 key，再以条件 `put` 晋升；禁止直接完成到最终 key、用 multipart ETag 冒充 SHA、无条件 pointer 删除或第二迁移器。signed 已切而 legacy 未切时保留 signed，fresh-read 后幂等恢复同一计划；不执行无法 CAS 到 absent 的删除回滚。
- Changed scope: 仅修订根 `AGENTS.md` 和本切片 S35 发布规则并 append 本记录；未改 updater、外部 action、候选字节、Profile、R2、Feed、官网、安装态或用户数据。
- Verification commands and results: 安装态 checker 正例返回精确 update-available；外部 action 完整 `node --test` 为 62/62，本仓四模型 admission/release 窄测为 23/23；相关 diff check 通过。
- Immutable evidence / receipt: 外部 action protected main `eca005391708dc6ac3057a8702995e2475cdaaf2`；公开 legacy 仍为 948 bytes / SHA-256 `e6d5e045364bdac97ea7fef41b1e28a20af06c9f4ffdd85d2c136e982d12a7dc`，signed/manual 2.0.13 前缀仍为空。没有 Worker、R2 写入、pointer 变化或候选安装。
- Remaining blockers: 提交本合同修订并通过 protected CI；exact-main Desktop/Profile/四模型性能/admission 候选完成后，Cloudflare Worker 必须真实实现临时 multipart+条件晋升、旧 pointer 原字节/ETag 回滚收据、双 pointer/installer/Profile/Feed/官网完整公开回读。macOS 旧 updater 需成功与故障回滚；Windows 旧链没有同等级健康 ACK，必须单列实机安装/失败恢复证据。
- Next exact action: 提交并推送唯一发布分支，废弃旧 CI；等待 exact source CI 全绿后才构建正式候选，生产写入继续为零。

## 2026-08-26 · 2.0.13 TTFT v2 模型与双 Harness 身份闭环

- Goal checkpoint: 在四模型 aggregate 已接线但尚未采集生产证据时，关闭 leaf assembler 会丢弃 `performance_model`、以及三条 path receipt 全部被错误重标为候选 Harness 的两个发布阻断；本条不采集真实模型、不生成候选、不签名或发布。
- Frozen baseline / current HEAD: 独立 worktree `fix/performance-real-baseline-contract` 从当前发布源 `588cb5ca10c381fe918be6dfefd6bc76edfa73d5` 创建；候选/Base Harness 为 `b2b1650b01f0ee88d81837a9b5c050f9f763f606`，真实 2.0.12 baseline Harness 为 `2bc16230975f6cf02aa1b283b1f86de44007b059`。
- Binding documents read: 完整读取根 `AGENTS.md`、`target-contract.md`、`performance-and-acceptance.md`、`slices/2.0.13.md` 和上一条完整开发记录；继续固定 schema v2、20 个支持文件、四模型 leaf/outer aggregate 与唯一 evidence/receipt 路径。
- Inspected native seam: `scripts/performance-parity.mjs` 是现有 manifest→source artifacts→run receipts→verified evidence 唯一组装/验签入口。旧 manifest closed keys 不接受 `performance_model`，verified object 又会丢弃它；`assemblePath()` 同时把 baseline run receipt 的 Harness 强制写成候选 pin。外部受保护 publication action `eca005391708dc6ac3057a8702995e2475cdaaf2` 已精确校验 top-level candidate Harness 和 closed `performance_model`，但不要求 baseline path 冒充 candidate，因此无需跨仓改动。
- Experiment or why unnecessary: 使用既有生产组装测试的三条 source-partitioned path 构造正反例；组装后逐字段验证模型对象原样保留、baseline/candidate receipts 分别绑定真实 pin，并对 closed-model 扩字段、模型漂移和重算摘要后的 baseline relabel 失败关闭。没有读取凭据、运行付费模型、注册 runner 或添加 collector。
- Decision and forbidden alternatives: top-level/verifier Harness 继续绑定 candidate/Base；baseline path receipt 固定绑定 `2bc162...`，两条 candidate receipt 固定绑定 `b2b165...`。闭合 `performance_model` 经 manifest、assembler、verifier 原样保留，并与每条 receipt 的 provider/model/reasoning 一致。禁止 relabel、兼容旧 evidence、放宽 schema、增加第二事件/collector或把 fixture 标为 production。
- Changed scope: 修改三份绑定合同、`scripts/performance-parity.mjs`、既有 `scripts/performance-parity.test.mjs` 并 append 本记录；workflow、Desktop admission、外部 publication action、20 文件外壳、Base/Profile/Harness、模型路由、R2/Feed/desired state 与用户数据均未改。
- Verification commands and results: `pnpm run test:performance:parity`（使用工作区 Node PATH）为 `10/10`；`node --test scripts/desktop-admission.test.mjs` 为 `8/8`；`git diff --check` 通过。直接 fixture 自检因独立 worktree 未包含已构建的 `upstream/deepseek-harness/vendor/cordis/lib/index.js` 而未启动，此环境缺失不能作为 fixture 或 production 结果；现有单测仍确认 keyless/重标 evidence 保持 `fixture-passed-production-blocked`。
- Immutable evidence / receipt: 当前只有 source-fixed diff、无密钥组装 fixture 与 protected external action pin `eca005391708dc6ac3057a8702995e2475cdaaf2`；旧 evidence 全部继续作废。没有真实 Provider evidence、`performance_run_id`、签名 admission、候选安装、上传或生产写入。
- Remaining blockers: 必须从 exact installed 2.0.12/2.0.13 bytes 按四个正式模型分别采集 3 path×30 AB/BA 的真实 source artifacts，并由合并后的 protected verifier 和固定外部 action 产生四 leaf/outer admission；缺任一模型、真实 renderer/provider/installed/enterprise receipt 或实机门禁均保持发布关闭。
- Next exact action: 提交本最小合同修复交主代理复核并移植；合入 protected main 后才允许外部 collector 使用新 manifest，禁止复用旧 evidence、手工补字段或把 baseline Harness 重标为 candidate。

## 2026-08-26 · 2.0.13 TTFT v2 双 Harness 显式证据修订

- Goal checkpoint: 独立审查确认前一修复已让 baseline receipt 使用真实 pin，但生产 evidence 自身仍只声明 candidate Harness，baseline 身份隐藏在 verifier 常量中；本条补齐显式可签证据字段，不采集模型、不发布。
- Frozen baseline / current HEAD: 修订基于独立提交 `614f66ca837d2b06cc2ae5312eb91d6bc19c68a7`；candidate/Base Harness 固定 `b2b1650b01f0ee88d81837a9b5c050f9f763f606`，2.0.12 baseline Harness 固定 `2bc16230975f6cf02aa1b283b1f86de44007b059`。
- Binding documents read: 复核三份 TTFT 绑定合同、前一条日志、唯一 assembler/verifier 与外部 protected publication action 的 evidence consumer；append 本修订而不改写历史记录。
- Inspected native seam: manifest、assembled evidence 与 `verifyProductionArtifacts()` checked output 共用同一 top-level evidence shape；因此只需在该 shape 增加 closed `baseline_harness_commit`，并让唯一 receipt validator 从 evidence 两个显式字段分别验证三条路径，无需新 receipt、事件、collector、workflow 或更新 summary。
- Experiment or why unnecessary: 正例验证 assemble→verify 同时保留 candidate/baseline 两字段；反例覆盖 manifest 缺失/错误 baseline 字段、已组装 production evidence 缺失/错误字段、baseline receipt 错标 candidate、candidate receipt 错标 baseline，且重算 receipt digest 仍失败关闭。
- Decision and forbidden alternatives: `harness_commit` 继续只表示 candidate/Base，`baseline_harness_commit` 只表示真实 2.0.12 baseline；production 两者均必填精确值，fixture 显式写 `fixture-only` 且仍不能进入 production。禁止从 path 猜 baseline、Verifier 隐式补字段、接受旧 production evidence 或增加兼容 schema。
- Changed scope: 继续只修改三份绑定合同、现有 `performance-parity` verifier/测试并 append 本记录；外部 action/schema、四字段 summary、workflow、20 支持文件、Base/Profile/Harness、R2 与用户数据未改。
- Verification commands and results: `pnpm run test:performance:parity` 为 `10/10`；`node --test scripts/desktop-admission.test.mjs` 为 `8/8`；`git diff --check` 通过。不以 fixture CLI 或外部环境缺失冒充生产通过。
- Immutable evidence / receipt: 当前仍只有源码与无密钥测试，外部 action 保持 `eca005391708dc6ac3057a8702995e2475cdaaf2`；没有真实 Provider、安装态、admission、上传或生产写入。
- Remaining blockers: 四模型真实 source-partitioned evidence、签名 leaf/outer admission 与安装/更新/回滚门禁仍全部 OPEN；本字段修订使旧 production evidence 必然作废。
- Next exact action: 提交本修订交主代理移植；只有合并后的 protected verifier 可用于新生产采集。

## 2026-08-26 · 2.0.13 TTFT v2 acceptance-only 生产采集 owner

- Goal checkpoint: 四模型 verifier/aggregate 已闭合但仓库仍只能消费 runner 预置 evidence，缺少一个明确 one-shot owner；本条只接通受保护 performance workflow、外部真实 authority probe 与现有 assembler/verifier，不调用模型、不采集或发布。
- Frozen baseline / current HEAD: 独立 worktree `feat/2.0.13-native-perf-producer` 从 protected main exact `eb372d715c9355fcca16fdc61c615867490e34f1` 创建；Base/Harness/Desktop reference 保持 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606` / `6074088f5b660206e404b3591fab51fb99c69add`，baseline Harness 为 `2bc16230975f6cf02aa1b283b1f86de44007b059`。
- Binding documents read: 完整读取根 `AGENTS.md`、`target-contract.md`、`performance-and-acceptance.md`、`slices/2.0.13.md`、上一条完整日志和 ponytail skill；追踪 `performance-parity.mjs`、`desktop-performance.yml`、ApiProxy/Session、audit outbox、enterprise identity/model-gateway UsageStore 与 Electron renderer seam。
- Inspected native seam: DSH Session 持有 native event、`request/header`、usage 和 Tool 生命周期；客户端 audit outbox只持脱敏 usage/策略绑定，真实 Provider invocation/response authority 位于 enterprise model-gateway UsageStore；首个可见文本 paint 只由安装态 renderer probe拥有。因此仓库运行时无法诚实自产全部 authority，安全边界是受控外部 acceptance probe写既有17 source artifacts，仓库继续用唯一 assembler/verifier完成语义验收。
- Experiment or why unnecessary: 未向 Desktop/Host/adapter加入 listener 或 header hook；新增纯 CLI 合同测试证明只有 exact protected-main workflow owner可启动、每模型固定30个唯一 pair且三场景各10、AB/BA均衡、四模型 roster与双 Harness pin不漂移、源目录只能是一份 manifest加17个文件。真实 probe/模型/安装态未运行，因此没有 production pass。
- Decision and forbidden alternatives: `performance:acceptance` 在 attempt-1 protected-main workflow中生成四个唯一 run id和闭合计划，以无 shell方式调用绝对路径且 SHA-256 锁定的 runner probe；随后要求 exact Session、request、Provider ledger、renderer paint、installed/Profile/lease receipts，逐模型复用现有 assembler/verifier并在复制后复验。scratch 保留17 sources+manifest并用于装配；final handoff只保留 evidence+20 referenced files，四模型加protected verifier精确85文件，解决“manifest必须保留”与workflow exact 85的层级矛盾。禁止常驻采集、第二事件/存储/传输、普通模型Tool、fixture重标、手写JSON和从客户端伪造Provider/paint权威。
- Changed scope: 新增 `scripts/performance-acceptance.mjs`及一个窄合同测试；仅导出现有 verifier 的 pins/path/scenario常量，接入根 package command和既有 performance workflow；更新三份绑定合同并append本记录。未改 Desktop/Profile/Harness、Session/API/LLM hot path、模型header/路由、企业服务、签名/R2/Feed/desired state或用户数据。
- Verification commands and results: bundled Node `--check scripts/performance-acceptance.mjs`通过；合并后的 `test:performance:parity` 为17/17（其中producer合同7项，包含冻结2.0.12/candidate安装身份正反例及四模型17→21→exact 85的mock assembly/copy/reverify）；`desktop-admission.test.mjs`为8/8；`test:impact`为35 passed / 5 Harness-toolchain skips / 0 failed；`git diff --check`通过。没有把合同fixture视为生产证据，protected CI仍须在合并后运行。
- Immutable evidence / receipt: 当前只有 exact-base源码diff与无密钥合同测试；没有读取凭据、调用付费模型、dispatch workflow、安装候选、生成真实 `performance_run_id`、签名、上传或生产写入。
- Remaining blockers: self-hosted runner必须提供外部 hash-pinned probe，实际驱动exact安装态2.0.12与candidate、读取native Session/request、真实renderer paint及model-gateway UsageStore/enterprise receipts，并通过受保护环境配置 `EMATE_PERFORMANCE_COLLECTOR(_SHA256)`；该外部 authority hook尚未在本地存在或运行，故四模型production evidence、admission和发布继续OPEN。
- Next exact action: 主代理复核本最小owner提交并合入protected main；runner owner安装/审查probe后才可手工dispatch performance workflow，任何authority缺失保持fail closed。

## 2026-08-26 · 2.0.13 TTFT v2 Profile 安装权威绑定修订

- Goal checkpoint: 主复核发现首版 acceptance owner 只把 Profile publication root 交给 probe，终态仅要求候选 `profile_generation` 非空，未将 installed runtime 绑定到三目标 signed Profile publication；本条只关闭该 fail-closed 缺口，不采集模型、不发布。
- Frozen baseline / current HEAD: 修订基于独立提交 `c859ca9b19d29e9e470ffc75c508f0474eb87b18`；源码基线仍为 protected main exact `eb372d715c9355fcca16fdc61c615867490e34f1`，2.0.12 三目标 package/Profile generation 冻结值不变。
- Binding documents read: 复核根 `AGENTS.md`、ponytail skill、`target-contract.md`、`performance-and-acceptance.md`、`slices/2.0.13.md`、上一条完整记录、既有 `desktop-admission` Profile aggregate parser、Profile release/component manifest consumer及 performance owner直接调用者。
- Inspected native seam: `createProfileComponentAggregate()` 已完整验签三目标 desired state，并校验 inventory、Profile build receipt、immutable/active release一致性、全部 component manifest/file closure及无多余文件；现有四字段 aggregate不能新增客户端 digest，否则会破坏 updater与外部签名 schema。Shell component manifest 已由 signed desired state固定，`lib/client.js` 文件条目提供所需真实摘要。
- Experiment or why unnecessary: 沿同一既有解析循环生成 acceptance-only派生 receipt，不新增 Profile格式、线上 aggregate或运行时事件；receipt绑定 publication tree、既有 aggregate、三目标 generation/component aggregate和 Shell client bundle SHA。owner 在启动 probe 前和装配 handoff 前重验 root/receipt/aggregate，并用目标行校验两条 candidate installed receipt。
- Decision and forbidden alternatives: `composition_sha256` 对应既有 target `component_aggregate_sha256`，`client_bundle_sha256` 对应 signed Shell manifest 的唯一 `lib/client.js`；baseline继续只匹配冻结三目标 generation/package。禁止相信 probe自填 generation/digest、猜测 publication文件名、扩展线上 aggregate、兼容缺字段 evidence或把 receipt当成发布签名。
- Changed scope: 最小修改既有 admission parser/测试、acceptance owner/测试和 performance workflow参数，修订两份绑定合同并append本记录；未改 Desktop/Profile updater schema、普通聊天/runtime hot path、模型header/路由、外部 signer、R2/Feed/desired state或用户数据。
- Verification commands and results: bundled Node `--check`通过；合并后的 `test:performance:parity` 为 `18/18`，`desktop-admission.test.mjs` 为 `8/8`，覆盖 signed desired state派生、publication root漂移、错误 target/generation/composition/client digest及四模型17→21→exact 85装配；`test:impact` 为 `35 passed / 5 Harness-toolchain skips / 0 failed`，`git diff --check`通过。
- Immutable evidence / receipt: 当前只有源码diff和无密钥合同fixture；未读取凭据、调用模型、dispatch workflow、安装候选、签名、上传或改生产状态。
- Remaining blockers: 受保护 self-hosted runner仍必须提供已审查且SHA锁定的外部 probe，从真实 installed 2.0.12/candidate和 enterprise UsageStore取得 renderer/provider/lease authority；本修订只保证错误Profile无法进入aggregate，不能替代真实采集。
- Next exact action: 主代理复核追加提交并合入 protected main；只允许合并后workflow重新派生Profile receipt并启动一次真实采集，旧 owner输出继续作废。

## 2026-08-26 · 2.0.13 TTFT v2 原生 Tool handoff 权威收敛

- Goal checkpoint: 外部生产 probe 开始实现后，独立只读审查发现 schema 要求的 Tool call→body start 在冻结 2.0.12 没有同口径生产 authority；本条删除不可实施的单边指标，只保留用户原始工具衔接门禁所需的 Tool result→第二次 request，不采集模型、不构建或发布。
- Frozen baseline / current HEAD: 修订基于 acceptance owner `cf678e019708bbb6706fc236bebdde7673265410`；2.0.12 Harness 仍为 `2bc16230975f6cf02aa1b283b1f86de44007b059`，候选/Base Harness 仍为 `b2b1650b01f0ee88d81837a9b5c050f9f763f606`。
- Binding documents read: 完整复核根 `AGENTS.md`、`target-contract.md`、`performance-and-acceptance.md`、`slices/2.0.13.md`、上一条完整日志与 ponytail skill；未从聊天记忆或 fixture 推断生产 seam。
- Inspected native seam: 两版 DSH 都只把 `tool/call`、`tool/result` 和后续 request/header/Provider attempt 持久化；真实 body start 只在 ToolRuntime 私有 `dispatchToolBody()` 内。创造模式只有模型 Tool 入口，会改变被测工具头和 Session；给基线临时安装新 Profile 又会改变冻结 generation/composition；候选单边 listener 或新 loopback RPC 均不可比较。
- Experiment or why unnecessary: 未尝试污染真实安装态。现有 fixture 内可直接读取 Tool body 的时间不具备安装态 authority；审查同时确认 `tool/result.time` 与同一 Session 后续 request 顺序是两臂共有的原生证据，因此不需要第二事件、listener、RPC、Profile component 或跨进程时钟相减。
- Decision and forbidden alternatives: `read-only-tool` 的生产硬字段只保留 `tool_result_to_next_request_ms`，继续按 p95 `+25ms` 且 `+5%` 双门验证；普通场景仍禁止用 0 占位。禁止合成 Tool start、从 Tool 参数/正文推断、候选单边埋点、模型驱动创造模式预热或放宽 Provider 两次 attempt/重复执行门禁。
- Changed scope: 最小修改唯一 assembler/verifier、既有两份窄测试和两份 TTFT 合同；删除 fixture 的无用 Tool-start Map。未改 Desktop/Profile/Harness、普通聊天 header/路由、Provider、Session/runtime 热路径、workflow、R2/Feed/desired state 或用户数据。
- Verification commands and results: bundled Node `--check scripts/performance-parity.mjs` 通过；`pnpm run test:performance:parity` 为 `18/18`；`node --test scripts/desktop-admission.test.mjs` 为 `8/8`；`git diff --check` 通过。
- Immutable evidence / receipt: 当前只有源码 diff、可运行合同测试与两版 native seam 审查结论；没有真实 Provider、安装态、`performance_run_id`、签名、上传或生产写入。
- Remaining blockers: hash-pinned 外部 probe 仍须完成其余 17 个原生/Renderer/Provider/installed/enterprise authority source 的真实采集；四模型、候选安装、更新/回滚与公开发布全部保持 OPEN。
- Next exact action: 提交本合同修订并与外部 probe runtime 合并到 protected-main 候选；通过 exact attempt-1 CI 后才允许真实采集，任何缺失 authority 继续 fail closed。

## 2026-08-26 · 2.0.13 TTFT v2 Profile authority 临时文件隔离

- Goal checkpoint: 独立终审发现 performance workflow 把 acceptance-only Profile authority receipt 写入只允许唯一 aggregate 的 stage 根，必然触发随后 exact-one 与 exact-file-count 门禁；本条只修复工作流文件边界。
- Frozen baseline / current HEAD: 基于 native Tool handoff 收敛提交 `9d8f869368ed11c2c5a65c811a1631b49e442da1`；候选、Profile、Harness、安装态和生产状态未变。
- Binding documents read: 根 `AGENTS.md`、`docs/performance-and-acceptance.md`、`docs/slices/2.0.13.md`、上一条完整记录及 workflow 的 stage copy/count/cleanup 直接调用链。
- Inspected native seam: `profile-component-aggregate.json` 是 stage 根唯一允许文件；`profile-performance-authorities.json` 只在 aggregate 生成与 one-shot collector 间传递，无需进入上传目录。
- Experiment or why unnecessary: 直接以现有 workflow 合同测试锁定 authority receipt 不再位于 `STAGE_DIRECTORY`，无需新增目录协议、artifact 或运行时逻辑。
- Decision and forbidden alternatives: authority receipt 固定写入 runner 私有临时根并在 `always()` 清理；stage 继续只持 aggregate。禁止放宽 exact-one/exact-count 门禁或把 authority receipt混入公开 evidence。
- Changed scope: 仅修改 `.github/workflows/desktop-performance.yml` 与既有 `scripts/performance-acceptance.test.mjs`，未改采集 schema、assembler/verifier、Desktop/Profile/Harness、模型链或发布状态。
- Verification commands and results: 使用工作区 bundled Node/Pnpm 运行 `pnpm run test:performance:parity` 为 `18/18`，`node --test scripts/desktop-admission.test.mjs` 为 `8/8`，`git diff --check` 通过；不以窄测替代 protected CI 或生产采集。
- Immutable evidence / receipt: 当前只有未发布源码 diff；无真实模型调用、安装、签名、上传或生产写入。
- Remaining blockers: 真实外部 probe、四模型 production evidence、签名 admission、安装/更新/回滚及 P0+TQ13 实机验收仍全部 OPEN。
- Next exact action: 运行 performance parity、desktop admission 与 diff check，提交后与外部 probe runtime 合并，只有 exact protected-main attempt-1 CI 可启动真实采集。

## 2026-08-26 · 2.0.13 TTFT v2 external probe 源码 provenance 与失败关闭骨架

- Goal checkpoint: 在 acceptance one-shot owner 已绑定 runner collector hash 但仓库没有该 hash 对应源码的情况下，补入受版本控制的 Node 24 probe 实体，并关闭 protected-main source bytes、runner 安装副本与受保护配置 digest 的同一性；不运行模型、不读取凭据、不安装、dispatch、推送或发布。
- Frozen baseline / current HEAD: 独立 worktree `codex/external-perf-probe-impl` 从 `feat/2.0.13-native-perf-producer` exact `cf678e019708bbb6706fc236bebdde7673265410` 创建，包含 one-shot owner `c859ca9b19d29e9e470ffc75c508f0474eb87b18` 和 Profile authority 修订；Base/Harness/Profile 身份未改。
- Binding documents read: 完整读取根 `AGENTS.md`、`target-contract.md`、`plugin-contracts.md`、`performance-and-acceptance.md`、`slices/2.0.13.md`、上一条完整日志和 ponytail skill；追踪 owner/workflow、assembler/verifier、pinned DSH `complex-history.perf.ts` 双 rAF、release-health 隔离启动和 Analytics `/v1/usage/events`。
- Inspected native seam: 安装态 renderer 可通过 pre-bootstrap CDP 在同一 `performance.now()` 时钟观测 send/chunk/text/paint；enterprise usage API有分页 ledger，但当前 pinned Desktop/DSH 未向外部 Node 暴露可与其 exact join 的原生 durable/live Session/request/Tool read-only authority。缺该 authority 时，外部 probe 无法诚实产生17个生产 source artifacts。
- Experiment or why unnecessary: 新增纯标准库 probe/测试，正反例覆盖同钟双 rAF、Usage extra/missing/ambiguous exact join、域分离 hash、offline-valid-cache 边界、owner-only config、无正文/密钥字段与 source/installed digest 漂移。没有启动 Desktop、Provider 或外部服务。
- Decision and forbidden alternatives: owner 现在同时计算 protected-main source 与 runner copy digest，并要求二者等于配置 SHA；私有 plan记录 source/installed digest。probe只允许固定 OS 保护路径中的 keychain/local-secret-broker引用，不能从 workflow env/plan取得凭据。因原生 Session authority 缺失，main 在 preflight 后明确非零退出；禁止用 DOM正文、时间窗口猜测、私有日志或 fixture 冒充 production pass。
- Changed scope: 新增 `scripts/performance-acceptance-probe.mjs`和一个窄测试；修改既有 owner/测试、performance workflow、根测试命令和两份性能绑定文档并 append 本记录。未改 Desktop/DSH/Profile/Session/API/LLM热路径、事件/存储/协议/Tool/header、模型路由、R2/Feed/desired state或用户数据。
- Verification commands and results: bundled Node `v24.19.0 --test scripts/performance-acceptance-probe.test.mjs` 为 `5/5`；两个新增/修改脚本 `node --check` 通过；`git diff --check` 通过。完整 `performance-acceptance.test.mjs` 在该独立 worktree 因禁止安装且缺现有 devDependency `fflate` 未运行，不能记为通过。
- Immutable evidence / receipt: 只有源码 diff 和无密钥合同测试；没有 collector 安装副本、runner config、Session/Provider/paint source、真实 `performance_run_id`、安装态或 production evidence。
- Remaining blockers: 需要在 pinned DSH 已有 Session authority 上提供最小 runner-private read-only exporter，返回当前唯一 Session 的 request/header、Tool start/result和provider关联ID，且必须有受审源码/runner scope；随后 probe 才能实现 exact 2.0.12→2.0.13 隔离启动、30×4真实采集、17源文件关闭与完整测试。当前生产性能门保持 OPEN。
- Next exact action: 主代理复核并移植本提交；先决定由 DSH 原生 Session export seam 还是既有 runner-private joined exporter承担只读关联，禁止在 Desktop hot path新增 listener。接口落地后补全 probe runtime并在 protected runner安装同字节副本，再进行首次真实采集。

## 2026-08-26 · 2.0.13 TTFT v2 installed Darwin probe orchestration

- Goal checkpoint: 将外部 probe 的无条件失败骨架收敛为受保护 checkout 自执行、真实 macOS安装/CDP preflight与严格证据派生；不读取凭据、不运行模型、不dispatch、推送、合并或发布。
- Frozen baseline / current HEAD: 独立分支 `codex/external-perf-probe-orchestration` 基于 probe skeleton `f937c5ad3425e9d20353efb55924865cd0fa9c2a`；2.0.12 source/Base/package/Profile与 candidate Harness/Desktop reference pin未改。
- Binding documents read: 根 `AGENTS.md`、target/plugin/performance合同、S27–S35切片、上一条完整日志及 ponytail skill。
- Inspected native seam: 安装态Host固定loopback、HTTP RPC与字符串 `/api/events.mux`；renderer已有稳定 composer/streaming data anchors；Provider Analytics仅暴露REQUEST/USAGE共同task/trace/model/provider键，不暴露native→provider直接外键；Tool body-start在冻结基线不可观测。
- Experiment or why unnecessary: 复用HTTP/WS/CDP、Session event/header、完整Usage分页集合差、现有安装/Profile收据，不改DSH/Desktop。Darwin测试以注入的系统命令边界验证冻结receipt、候选DMG复制及清理；没有用fixture冒充production。
- Decision and forbidden alternatives: collector固定为当前protected checkout并绑定workflow run/attempt；所有ID hash带run scope；provider/native attempt共享`request_id_sha256`；Tool仅保留`tool_result_to_next_request_ms`。runner broker固定为同owner canonical 0700 executable、无shell、bounded JSON stdin/stdout；禁止第二collector、body-start hook、时间窗join、正文扫描和普通header增量。
- Changed scope: 修改performance probe/owner/workflow/verifier及既有测试与两份性能合同；未改产品runtime、Session/API、模型路由/header、Base/Profile、R2/Feed或用户数据。
- Verification commands and results: bundled Node probe tests `9/9`，parity tests `10/10`；三个修改脚本`node --check`与`git diff --check`通过。acceptance owner测试因该独立worktree缺既有devDependency `fflate`未启动，明确不记为通过。
- Immutable evidence / receipt: 只有源码diff与无密钥测试；没有真实runner config、安装态启动回执、Provider evidence、performance_run_id或production pass。
- Remaining blockers: runner须创建精确owner-only config、冻结2.0.12 app/installed-runtime receipt与两个私有broker；真实4×30×3采集仍须在protected self-hosted runner执行并由17源文件/85文件handoff终验。任一字段缺失按样本失败关闭。
- Next exact action: 提交本独立分支供主代理移植；合入protected main后注册ephemeral runner并只运行一次真实performance workflow，失败不得复用旧evidence。

## 2026-08-26 · 2.0.13 TTFT v2 四模型真实采集循环闭合

- Goal checkpoint: 在 installed Darwin lane 已能验证并启动两代真实应用但仍未执行样本的基础上，补齐四模型、每模型 30 组、每组 3 path 的实际 AB/BA 采集编排与 exact 17 source artifacts；本地只做无模型窄测试，不运行 Provider、安装或 workflow。
- Frozen baseline / current HEAD: 独立分支 `codex/external-perf-probe-orchestration` 从提交 `2f96f384bc793363ce6f605d8403fa968c94c661` 继续；冻结 2.0.12 source/Base/package/Profile、候选 Base/Harness/Desktop reference 与四模型 roster 未改。
- Binding documents read: 复核根 `AGENTS.md`、ponytail skill、`target-contract.md`、`performance-and-acceptance.md`、`slices/2.0.13.md`、上一条完整日志、现有 Session route/RPC、renderer DOM/mux、Usage ledger 与 owner/verifier 合同。
- Inspected native seam: 使用现有 `session.create`、`session.rename`、`session.selectModel`、`session.prompt`、`session.history` 与 `/chat/<sessionId>` route projection；发送只经安装态 composer 的 trusted CDP click，文本首 chunk 只按目标 Session/turn/step 的真实 mux frame 识别。Provider 继续由 runner-private Usage broker 的完整 before/after ID 集合差与排他账号单飞配对；offline 只由同一 acceptance-only preload 控制认证端点，模型 gateway 保持可用。
- Experiment or why unnecessary: 新增无密钥正反例覆盖实际 AB/BA path 顺序、旧错误 bundle id 拒绝与真实 `net.ecoremedia.e-mate` receipt；既有测试继续覆盖 mux 字符串协议、run-scoped hash、Usage 多/少/外来/PENDING、Tool 唯一可观测边界、offline valid-cache、broker 权限和 DMG 清理。没有为测试调用模型或伪造 production evidence。
- Decision and forbidden alternatives: 每个样本使用唯一 native Session；每模型/path 只真实构造一次 20-turn 固定历史，再复用原生 `session.fork` 为 10 个 history 样本产生各自完整原生日志，避免约 2,400 次无信息重复调用。read-only-tool 只要求原生 `get_goal` 一次；每次通过原生 chat route 精确绑定本次 Session，不以“出现任意聊天框”判定。三 path 按 plan 的 AB/BA 顺序逐项隔离启动/退出，样本写入各 path 的 1..30 ordinal，最后原子关闭 manifest 加 17 source files。禁止第二产品接口、DOM正文扫描、普通 header、时间窗 Usage join、body-start 伪计时、旧 bundle id、缺字段降级或 fixture 重标。
- Changed scope: 只修改既有 `scripts/performance-acceptance-probe.mjs`、其窄测试并 append 本记录；未改 Desktop/DSH/Profile/Session协议、模型路由/header、企业服务、Base、R2/Feed/desired state 或用户数据。
- Verification commands and results: bundled Node 对 probe `--check` 通过；probe 与 parity 聚焦测试合计 `20/20`；`git diff --check` 通过。完整 acceptance owner 测试仍因该独立 worktree 未安装既有 devDependency `fflate` 而未启动，不记为通过。
- Immutable evidence / receipt: 当前只有源码 diff 与无密钥测试；没有真实 runner config/broker、四模型调用、17 个 production source files、performance admission、上传或生产写入。
- Remaining blockers: 合入 protected main 后，ephemeral self-hosted runner 必须提供 owner-only frozen baseline receipt、安装根、两个 broker 与 acceptance-only preload，并实际跑完四模型 360 个 path sample；任一模型、Session、Usage、paint、offline cache、安装或 artifact 字段缺失即整次失败关闭。
- Next exact action: 提交本第二阶段最小 diff 交主代理复核；只允许 exact protected-main attempt-1 workflow 在真实 runner 运行，禁止本地开发链触及生产发布或复用旧 evidence。
## 2026-08-26 · 2.0.13 Build-once Desktop release ownership

- Goal checkpoint: 将受保护 main CI 的 Base SDK、共享 Desktop、Profile、Windows EXE 与 macOS DMG 固定为唯一构建字节；后续 Desktop/Profile/performance/admission 只下载、重验、绑定，不重建或发布。
- Frozen baseline / current HEAD: 独立 worktree `codex/build-once-release` 从 `feat/2.0.13-native-perf-producer@62a77b62628d01c53befc5970bf5a7c9d048c475` 创建；未读取或修改生产 R2、Feed、desired state、签名或安装态。
- Binding documents read: 完整读取根 `AGENTS.md`、`target-contract.md`、上一条 development log 与用户提供的 CI/发行优化合同；冲突时以 Build once → Verify many → Sign exact bytes → Publish without rebuild 为准。
- Inspected native seam: `ci.yml` 已产出 Base SDK、staged Profile、Windows/macOS artifacts；旧 `desktop-release.yml` 又完整安装 Harness/Desktop toolchain、重跑测试、重建 SDK/Profile/EXE/DMG，且 Admission/Performance 把 Profile 与 Windows bytes 错归到 Desktop release run。现有 Base SDK manifest 已闭合哈希 shared Desktop `lib`，无需第二 shared receipt。
- Experiment or why unnecessary: 该变更只涉及 GitHub artifact/provenance release plane，Creation Mode 不能表示。新增同一 strict staging/verify helper，以 installer、可选真实 blockmap、runtime receipt 和 artifact receipt 的 closed fileset验证 source、CI run、Base、Harness、bytes、SHA-256及 PE/UDIF；未新增构建或传输路径。
- Decision and forbidden alternatives: Desktop release 只接受 exact repository/protected main/source/attempt-1/success CI admission，并消费 source-specific Base/Profile/Profile receipt/Windows/macOS artifacts；candidate 的两端 `build_run_id` 均保持原 CI run。禁止 release rerun Harness/tests/Yarn SDK/electron-builder，禁止 mac-smoke、cache authority、重标旧 bytes、伪造 blockmap或第二 shared truth。
- Changed scope: 修改 Desktop release、Profile release source acceptance、Performance/Admission artifact owner接线、唯一 CI platform receipt helper及其合同测试；未修改 `ci.yml`、change-impact 分类器、performance probe、产品 runtime、Base/Profile/Harness bytes或生产发布面。
- Verification commands and results: `pnpm run test:release` 24/24；`pnpm run test:impact` 35 passed / 5 environment-skipped / 0 failed；`git diff --check` 通过。CI staging workflow需在合并本 helper 后调用其 `stage` 命令，才形成完整 protected-main生产链。
- Immutable evidence / receipt: 当前只有 source-fixed commit 前 diff与本地无密钥 fixture；没有 GitHub protected-main artifact、签名 admission、候选安装、上传或生产指针变化。
- Remaining blockers: CI PR必须使用本 helper生成 source-specific formal EXE/DMG artifacts和 Profile build receipt；合并后以 exact main run 验证真实 artifacts，再继续 Performance、Admission、签名、Cloudflare发布及安装/更新/回滚。
- Next exact action: 提交本切片供主代理按依赖顺序合入；CI 先调用唯一 stage owner，再运行 exact protected-main CI 和无重建 Desktop release。

## 2026-08-26 · 2.0.13 CI PR1 低风险瘦身与 Build-once 入口

- Goal checkpoint: 按仓库既有 CI 效率合同先移除平台流水线浪费，并让 protected-main 只上传可直接进入后续验收的正式字节；本条不运行安装器、不触发 workflow、签名、R2、Feed 或 desired state。
- Frozen baseline / current HEAD: 独立干净 worktree `codex/ci-pr1-slim` 从 `public-2011/feat/2.0.13-native-perf-producer` exact `f0fbb9017321053f5f0aad41832ba80e09a43f03` 创建；Base/Harness/Desktop reference 保持 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606` / `6074088f5b660206e404b3591fab51fb99c69add`。
- Binding documents read: 完整读取根 `AGENTS.md`、`docs/target-contract.md`、上一条完整开发记录和 ponytail skill；复核 `ci.yml`、正式 macOS/Windows package/verifier、Profile build receipt owner、Enterprise 直接依赖及既有 impact workflow test。
- Inspected native seam: `dist:win` 和 `dist:mac-unsigned-release` 已分别持有最终安装器及 packaged runtime 验证；`desktop-admission.mjs profile-build-receipt` 已是 Profile 字节收据 owner；Enterprise 只从固定 ECoreX gitlink读取 `tokens.css` 与 `emate-logo.png`，无需递归初始化全部 submodule。
- Experiment or why unnecessary: CI/release plane 不能由 Creation Mode 表示，故不创建动态插件。以 workflow contract test验证 PR 只走 `package:dir`、protected-main 才走 formal dist、每个平台 Profile 只验证一次、缓存键覆盖版本/lock/patch/installer输入、Enterprise shallow sparse checkout和四个 job timing summary。
- Decision and forbidden alternatives: 平台产物只允许通过唯一共享 `stage-desktop-ci-artifact.mjs` strict stage 后上传，文件集为正式 DMG/EXE、真实存在时的 blockmap、`desktop-runtime-verification.json` 与 `desktop-artifact-receipt.json`，`compression-level: 0`；禁止 mac-smoke、`.app`、unpacked tree、Python closure、`node_modules` 或 wildcard build directory进入 artifact。普通 PR 不产发行物，protected-main artifact 以 exact head SHA 命名；缓存不作为发布证据。
- Changed scope: 仅修改 `.github/workflows/ci.yml`、既有 `scripts/change-impact.test.mjs` 和本记录；新增 Profile build receipt artifact、Enterprise 两文件 sparse checkout、Electron/electron-builder OS cache、四个 job timing summary，并删除两平台重复 `verify:profile`。未改性能 probe、DSH/Desktop runtime、Profile内容、模型链、企业产品代码或生产状态。
- Verification commands and results: bundled Node 运行 `node --test scripts/change-impact.test.mjs` 为 `22/22`；Ruby YAML parser通过；`git diff --check`通过。未运行 formal DMG/EXE，因此本条只记 source-fixed。
- Immutable evidence / receipt: 当前只有源码 diff 与 workflow contract test；无 GitHub run id、platform artifact id/bytes/SHA、安装态、签名或公开写入。
- Remaining blockers: 唯一 strict staging helper及其 symlink/格式/forbidden-tree 负例由并行 Build-once owner提交，主代理必须先合入该 exact helper再移植本 workflow；随后 protected-main attempt-1 必须真实生成并回读两平台 closed artifact。任何缺失文件或 provenance 均保持失败关闭。
- Next exact action: 提交本最小 CI diff；主代理按依赖顺序合入共享 staging owner与本提交，运行 protected CI，并将真实 artifact IDs/文件清单/bytes/SHA交给后续 Desktop release 直接消费，禁止重建。
## 2026-08-26 · 2.0.13 PR2 影响维度与 PR 快速链

- Goal checkpoint: 在 build-once 合同已固定后，把普通 PR 的应用目录 smoke 与正式 DMG/NSIS 分发构建从同一影响权威派生；本条不构建候选、不安装、不调用模型、不签名或发布。
- Frozen baseline / current HEAD: 独立 worktree `codex/pr2-impact-fastchain` 从 `feat/2.0.13-native-perf-producer` exact `f0fbb9017321053f5f0aad41832ba80e09a43f03` 创建；Base/Harness/Desktop reference 未改，性能 probe 文件未触碰。
- Binding documents read: 完整读取根 `AGENTS.md`、`target-contract.md`、`plugin-contracts.md`、`performance-and-acceptance.md`、上一条完整日志和 ponytail skill；追踪唯一 change-impact、CI matrix、Base SDK/Profile artifact 与正式 macOS/Windows package owner。
- Inspected native seam: `scripts/change-impact.mjs` 已是 coarse lane、组件 inventory、平台 target/runner 和 CI matrix 的唯一权威；CI 已有原生 `package:dir`、正式 `dist:mac-unsigned-release`/`dist:win` 与 admission owner，因此无需第二分类器、路径表或构建协议。
- Experiment or why unnecessary: 该变更属于 Git diff/CI/release plane，Creation Mode 不能表示 GitHub matrix、原生 runner 或 installer provenance。使用现有 Node 标准库表驱动测试直接覆盖普通 PR、protected main、受保护 release-candidate、macOS/Windows/updater、enterprise、release verifier、未知/非法路径和双 native component 聚合。
- Decision and forbidden alternatives: classifier 现在闭合输出 `shared_runtime/profile/macos_runtime/macos_packaging/windows_runtime/windows_packaging/enterprise/release_verifier` 与 `ci.app_smoke/distribution`。普通 runtime PR 只跑 `package:dir`；packaging/updater、protected-main affected Base 或 protected release-candidate 才跑唯一正式 DMG/NSIS。未知路径全维度 fail closed。native component 只在新增的 CI matrix 按 target 聚合；既有 `component_jobs[].component/publish` 逐组件 release 消费合同保持不变。禁止 YAML 复制 path 规则、生成或上传 mac-smoke 作为 release 字节、重复 checkout/install 或从 cache冒充 artifact。
- Changed scope: 仅修改唯一 impact classifier、既有 impact 合同测试、`ci.yml` 和 append 本记录；未修改 performance probe、Desktop/Profile/Harness 产品运行时、模型 header/路由、企业服务、R2/Feed/desired state 或用户数据。
- Verification commands and results: bundled Node 24 `--check scripts/change-impact.mjs` 通过；`change-impact.test.mjs` 为 `24/24`；与 `component-release.test.mjs` 合跑为 `33 passed / 4 intentional Harness-toolchain skips / 0 failed`；Ruby YAML parse 与 `git diff --check` 通过。完整四文件 impact 命令在本独立 worktree因未安装 `fflate` 无法启动两个 Profile consumer，未记为通过且没有安装依赖掩盖环境缺口。
- Immutable evidence / receipt: 当前只有 source-fixed diff和本地无密钥合同测试；没有 CI run、DMG、EXE、Profile generation、安装态或 production receipt。
- Remaining blockers: 主代理须与 PR1 artifact staging 最小合并并由 protected PR CI 验证 GitHub expression/matrix；只有 protected main exact SHA 的正式 distribution artifacts可供后续 release复用。
- Next exact action: 主代理复核并移植本提交；PR1 staging包裹同一正式输出而不重建，随后运行 exact protected CI，失败只修受影响 stage。
## 2026-08-26 · 2.0.13 TTFT v2 安装态 Profile 真实性绑定

- Goal checkpoint: 终审发现 Darwin probe 为每次启动创建空 `userData`，实际会使用 bundled Profile，但 installed receipt 仍写入冻结/候选 generation；本条只关闭安装态 Profile 假绑定，不调用模型、不安装正式候选、不 dispatch、推送或发布。
- Frozen baseline / current HEAD: 独立分支 `codex/perf-profile-install-truth` 基于 producer exact `62a77b62628d01c53befc5970bf5a7c9d048c475`；冻结 2.0.12 source/Base/package/Profile generation 与候选 Base/Harness/Desktop reference 未改。
- Binding documents read: 完整复核根 `AGENTS.md`、ponytail skill、`target-contract.md`、`performance-and-acceptance.md`、最新完整日志、Darwin probe、Profile generation/component/release 原生实现、DSH Profile 安装 receipt 与 performance workflow。
- Inspected native seam: Desktop 唯一 Profile authority 位于隔离 `userData/profile-generations/{state.json,store/}`；`loadProfileGeneration()` 已验签 release、完整组件 inventory、manifest、文件集/摘要/权限与平台目标，`assembleProfileGeneration()` 已提供同一离线物化路径；DSH 最终安装 generation 由 `DSH_HOME/profiles/e-mate/.e-mate-install.json` 记录，无需第二 schema、事件、存储或协议。
- Experiment or why unnecessary: 复用上述原生 loader/assembler。基线只接受 owner-only installation root 下预置的 v6 Base、inventory、非 bundled state 与 content-addressed store，并只复制签名 release 引用的闭包；候选将已下载、已验收 publication bundle 映射成禁止联网的 fetch-compatible request。测试覆盖正确闭包复制、symlink 拒绝、运行态 bundled 回退和 DSH receipt generation 漂移；未读取真实用户 Home 或联网补字节。
- Decision and forbidden alternatives: 每次启动前把已验证模板复制到新 `userData`，启动后必须回读 state 且 `active=last_known_good=expected`，再次完整验证物理 generation，再核对 DSH receipt 的 generation、Harness 与 DSH home；任何缺文件、签名/manifest/摘要漂移、symlink/逃逸、bundled 回退或 receipt 不一致均失败关闭。禁止相信 plan/installed receipt 的声明值、读取实时用户 Profile、从 R2补下载、降级 bundled 或复制未引用的旧 generation。
- Changed scope: 只修改现有 performance probe/窄测试、性能合同并 append 本记录；未改 Desktop/DSH/Profile updater、普通聊天/模型 hot path、header/路由、企业服务、Base、R2/Feed/desired state 或用户数据。
- Verification commands and results: bundled Node `v24.19.0` 对 probe `--check` 通过；probe、acceptance owner 与 parity 三组聚焦测试合计 `30/30`，change-impact 合同测试 `22/22`；`git diff --check` 通过。测试仅证明合同/本地文件边界，不记为真实四模型 production pass。
- Immutable evidence / receipt: 当前只有 exact-base 源码 diff 与无密钥测试；没有读取凭据、真实用户 Profile、调用模型、生成 production `performance_run_id`、签名、上传或生产写入。
- Remaining blockers: runner owner 仍须在 installation root 单独预置精确 2.0.12 `base-contract.json`、`component-inventory.json`、state/store 与既有 app/runtime receipt；protected attempt-1 仍须实际物化候选 publication、启动两臂并完成四模型采集。任一预置或运行态 authority 缺失保持 OPEN。
- Next exact action: 主代理复核并合并本提交；随后仅在 exact protected-main attempt-1 runner 做真实安装态 Profile preflight 和四模型采集，失败不得复用旧 evidence。
## 2026-08-26 · 2.0.13 PR2 合并后发布边界修复

- Goal checkpoint: 修复 PR1/PR2 合并后普通 PR 误产正式安装器、protected-main Base 单端漏产及聚合组件发布消费者仍校验旧 job 名的根因；不触碰 release coordinator、产品运行时或生产状态。
- Frozen baseline / current HEAD: 独立干净 worktree `codex/pr2-impact-contract-fix` 从 `feat/2.0.13-native-perf-producer` exact `e05ff397d2fc3d2c7a6fbb5a657a3e0077c184e9` 创建。
- Binding documents read: 完整读取根 `AGENTS.md`、当前 change-impact/CI/Profile release 合同、最新完整日志与 ponytail skill；以“普通 PR 不产发行物、protected-main Base 同 SHA 双平台一次构建、旧消费者稳定名称不漂移”为准。
- Inspected native seam: 唯一根因位于 `ciPlan()` 的 formal 判定、CI 两个稳定 job 名和 Profile release 对聚合 CI matrix 的消费；公开逐组件 `component_jobs` schema 无需修改。
- Decision and forbidden alternatives: `formal = releaseCandidate || (protectedMain && lane === base)`，formal 时双平台 app-smoke/distribution 同时开启；普通 PR 只按影响维度跑 `package:dir` 且 distribution 全 false；plugin-only main 不建安装器。CI 恢复两平台旧稳定名称，Profile release 只从 `ci_component_jobs` 去重 target 校验聚合 job。禁止 PR 正式字节、单端 Base freeze、复制路径分类或修改 coordinator。
- Changed scope: 仅修改 change-impact 计划、既有 CI/Profile workflow、合同测试并 append 本记录；未修改 release coordinator、Desktop/DSH/Profile bytes、性能 probe、R2/Feed/desired state 或用户数据。
- Verification commands and results: bundled Node 24 `--check scripts/change-impact.mjs` 通过；change-impact 与 component-release 合跑 `33 passed / 4 intentional Harness-toolchain skips / 0 failed`；两份 workflow Ruby YAML parse 和 `git diff --check` 通过。干净 worktree 未安装依赖，完整 `test:impact` 的两个 Profile consumer 未启动且不记为通过。
- Immutable evidence / receipt: 只有 source-fixed diff 与无密钥合同测试；没有 CI run、DMG、EXE、签名、安装或生产写入。
- Remaining blockers: 主代理需先与并行 coordinator source-SHA 修复做无冲突合并，再由 exact protected-main attempt-1 CI 真实证明双平台 artifacts、聚合 plugin-only Profile release 与 downstream job-name接受。
- Next exact action: 提交本独立修复供主代理移植；不推送、不 dispatch、不发布。

## 2026-08-26 · 2.0.13 TTFT v2 冻结 v6 Profile 历史合同兼容

- Goal checkpoint: 真实 runner 预置完成后，原生 loader 证明冻结 v6 Base、release 与 component manifests 均早于 `schedule_protocol_floor`，现有 v7 parser 会在读取真实 d876 generation 前失败；本条只兼容该精确历史字节，不修改冻结文件、不调用模型、不 dispatch、推送或发布。
- Frozen baseline / current HEAD: 独立分支 `codex/perf-v6-profile-compat` 基于 producer exact `cb737381de20e41439c2a388e2a1a6abfc55ee11`；冻结 v6 Base id/Harness/Profile generation 为 `e-mate-desktop-profile-v6-dsh-2bc16230975f` / `2bc16230975f6cf02aa1b283b1f86de44007b059` / `d8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93`。
- Binding documents read: 完整复核根 `AGENTS.md`、ponytail skill、`target-contract.md`、`performance-and-acceptance.md`、最新完整日志、Profile Base/release/component/generation parser 与 probe 的 baseline prepare 调用链。
- Inspected native seam: v7 `loadProfileBaseContract()` 要求正整数 floor；冻结 v6 Base 文件、签名 release 与15个 materialized component manifests均完全缺少该字段。release parser已有“缺字段→0”历史表示，但 generation id仍错误地把合成的0写入 hash，component parser也拒绝缺字段，因此只修 Base loader不足以验证真实 store。
- Experiment or why unnecessary: probe 只对 byte-exact v6 fixture（1598 bytes，SHA-256 `964a26f282345a46cd919e0dd3fe1caf9270d4cf732b2c2ab81b1dc168a6a990`）及精确 Base/Harness/Desktop reference创建内存 floor-0 视图；普通 Base parser保持原样。原生 component parser仅在收到该不可由普通 parser产生的 floor-0 view时接受“恰好只缺 floor”的旧 manifest；generation id在 floor=0时按原始无字段 payload计算。
- Decision and forbidden alternatives: 不改写或重签 v6 文件，不允许任意旧 Base、显式 floor=0 Base、缺其他字段的 manifest或现代 Base缺 floor；兼容只用于验收 probe 的冻结 predecessor，候选和产品更新继续使用严格 v7合同。
- Changed scope: 最小修改 probe baseline Base loader、原生 component/generation的历史语义、已有三组窄测试，新增一份 byte-exact v6 Base测试 fixture并更新性能合同；未改 Desktop启动、普通Profile updater、模型链、R2/Feed/desired state或用户数据。
- Verification commands and results: byte-exact fixture正例与缺其他字段反例通过；Profile component/generation/release Vitest `20/20`，probe/acceptance/parity Node测试 `31/31`，probe `--check` 与 `git diff --check`通过。另以 owner-provisioned安装根实际运行原生 `loadProfileGeneration()`及完整 `installVerifiedProfileTemplate()`，d876 generation、15个组件、floor 0均通过且临时复制已清理。
- Immutable evidence / receipt: 当前只有源码 diff、byte-exact历史fixture、本机 owner-provisioned只读 store验证输出；没有读取用户live Profile、凭据或正文，没有真实模型调用、production `performance_run_id`、上传或生产写入。
- Remaining blockers: protected attempt-1 runner仍须以同一冻结字节执行完整两臂启动和四模型采集；本修复只关闭 v6 native load 阻断，不把本地 store验证记为 production performance pass。
- Next exact action: 主代理复核提交并合入 producer；随后重跑 exact runner preflight，任何 Base/store字节或 generation差异继续失败关闭。

## 2026-08-26 · 2.0.13 S35 Build-once publication closure and frozen-v6 performance compatibility

- Goal checkpoint: 唯一主 Goal `01a02e48-f61f-7352-bc86-b5ec8771d46c` 保持 active；本记录只关闭正式 CI 恢复前的两个源码阻断，不宣称发布完成。
- Frozen baseline / current HEAD: frozen 2.0.12 Base v6 / Profile `d8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93`；producer 起点 `cb737381de20e41439c2a388e2a1a6abfc55ee11`，外部 publication protected-main 合入 SHA `9fa786244ed80e2202cc0907d6fd3d276a9e4d2f`。
- Binding documents read: 根 `AGENTS.md`、`docs/target-contract.md`、`docs/slices/2.0.13.md`、`docs/performance-and-acceptance.md` 与上一条完整日志。
- Inspected native seam: performance probe 仍使用原生 Base/Profile parser 与 `loadProfileGeneration()`；仅 byte-exact 冻结 v6 Base 产生内存 floor-0 兼容视图并保持原 generation identity。Desktop publication 仍由仓库外 fixed-SHA action 验证 protected-main Build-once 平台闭包并生成 Cloudflare plugin handoff。
- Experiment or why unnecessary: 真实 owner-provisioned v6 store 已通过原生 generation load 与 template install；外部 action 以无密钥闭包 fixture 覆盖 installer、runtime receipt、artifact receipt、可选 blockmap、额外文件、摘要漂移和压缩漂移。未运行生产模型、上传或激活。
- Decision and forbidden alternatives: 不改冻结合同、不放宽普通 parser、不重写历史 generation、不让 Desktop release 重建安装包。publication action 只接受 exact main CI owner/run/bytes，只有 installer 进入发布计划；receipt/blockmap/mac-smoke/额外文件均不得公开。
- Changed scope: probe 的精确 v6 兼容视图与测试 fixture；外部 publication verifier 两文件；主仓两个 workflow fixed pin、对应合同测试与本切片合同。未改模型头、路由、流式链、R2、Feed、desired state、官网或用户数据。
- Verification commands and results: `pnpm run test:impact` 37 pass/5 intentional skip；`pnpm run test:release` 24/24；release coordinator 3/3；performance parity/probe 31/31；Desktop admission 8/8；外部 action Node 24 `node --test` 66/66；workflow YAML 与 `git diff --check` 通过。
- Immutable evidence / receipt: 外部 protected-main merge `9fa786244ed80e2202cc0907d6fd3d276a9e4d2f`；producer 源码测试与本机 owner-provisioned store验证。没有 production `performance_run_id`、签名 admission、候选安装、Cloudflare 写入或公开指针变化。
- Remaining blockers: Cloudflare 大文件 plugin bridge、私有生产证据 broker、官网可执行 handoff 与 exact protected-main attempt-1 全链仍须通过；双平台安装/更新/回滚与公网回读仍 OPEN。
- Next exact action: 合入本记录与 fixed pin，推送同一 source SHA，运行 PR CI；只有通过后合并 protected main 并以 attempt-1 artifacts 启动 coordinator 和 one-shot production performance runner。

## 2026-08-26 · 2.0.13 官网原子发布交接闭环

- Goal checkpoint: 发布终审发现旧 `website-publication-plan.json` 只有文件清单和说明文字，未绑定 coordinator release-state、Desktop/Cloudflare 前驱、官网 active 前驱或公开回读；本条只补可执行交接，不部署或写生产。
- Frozen baseline / current HEAD: 独立分支 `codex/website-publication-handoff` 基于 producer exact `cb737381de20e41439c2a388e2a1a6abfc55ee11`；外部 Desktop publication action 固定为 `zyfjacksonchen-source/e-mate-desktop-publication@de2868c574098c356ce0b88c02d6c3afd29d47be`。
- Binding documents read: 完整读取根 `AGENTS.md`、`target-contract.md`、最新 development log、ponytail skill及现有 release coordinator、Desktop publication action、下载页 staging owner。
- Inspected native seam: coordinator 已解析 exact attempt-1 CI及 Profile/Desktop/performance/admission artifacts，但 release-state只留ID且未产官网交接；旧 npm release workflow生成的官网计划不在受保护 Desktop协调链内，不能作为2.0.13发布权威。
- Experiment or why unnecessary: release-state v2复用现有 artifact resolver输出，将ID、GitHub archive digest和bytes闭合；同一 state job用既有下载页stager生成无网络、无写入 handoff，无需第二发布器、SSH脚本或Cloudflare凭据。
- Decision and forbidden alternatives: coordinator要求官网owner fresh提供 HTTPS origin、`active`相对软链目标及当前index bytes/SHA；候选固定写入 `versions/<source SHA>`，先完成 exact Desktop Cloudflare handoff和公开回读，最后才由官网owner切换 `active`。计划逐文件固定URL/content type/bytes/SHA并声明所有生产写和live verification均为false。旧npm carrier不再输出可误认成正式官网计划。
- Changed scope: 仅修改 release coordinator、下载页stager、旧carrier工件清单及其窄测试；未改产品runtime、Desktop/Profile/Harness bytes、模型链、R2/Feed/desired state、官网或用户数据。
- Verification commands and results: website handoff定向测试 `1/1`、coordinator测试 `4/4`、两份workflow YAML解析、两个脚本`node --check`及`git diff --check`通过。完整旧 release suite另有与本diff无关的缺失 `yaml` devDependency环境阻断，未记为通过。
- Immutable evidence / receipt: 当前只有源码diff与无密钥fixture；没有workflow run、Cloudflare/官网写入、pointer切换或公开回读收据。
- Remaining blockers: 合入protected main后必须用官网owner fresh前驱派发 exact attempt-1 coordinator；Cloudflare插件先发布并公开回读同一admitted Desktop bytes，官网owner再按计划落版本目录、CAS切active并逐文件公开回读，任一身份漂移保持发布关闭。
- Next exact action: 提交本独立修复供主代理立即移植；禁止从本地worktree直接上传、切软链或改生产。

## 2026-08-26 · 2.0.13 正式 CI 前发布依赖收口

- Goal checkpoint: 只关闭正式 attempt-1 前的发布依赖与私有 runner 预检，不把本机辅助验证、fixture 或外部源码合入误报为上线。
- Frozen baseline / current HEAD: 冻结 v6 Profile generation `d8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93`；外部 Desktop publication protected-main 最终 fixed SHA `de2868c574098c356ce0b88c02d6c3afd29d47be`。
- Binding documents read: 根 `AGENTS.md`、S35 合同、TTFT v2 合同、Build-once CI 合同及最新完整日志。
- Inspected native seam: Cloudflare plugin handoff 的平台 artifact 是 exact 3/4-entry Stored ZIP；大对象桥验证完整 archive 与 installer 摘要，经随机 temp 全读回后 create-only 晋升并只清理本次 temp。性能 probe 的审计证据直接读取 loopback-only `/emate.audit/audit.status`，broker 不得自报 audit hash。
- Experiment or why unnecessary: 外部 action/Worker 全量无密钥测试 `88/88`；主仓 impact `37 pass/5 intentional skip`、release `24/24`、coordinator `4/4`、performance `32/32`、YAML/脚本/diff均通过。本机私有 usage broker 用授权 Analytics 只读分页接口得到4条脱敏匹配事件；offline-control 通过原生 refresh 恢复仍在有效期内的企业/模型缓存，带 `{}` 输入的独立 status 复跑 exit 0，且无 audit 字段。未调用模型、未写账本/R2/官网。
- Decision and forbidden alternatives: 生产 R2 仍只由连接的 Cloudflare plugin执行；GitHub/本地不得持有R2写权限。大文件 Worker一次一对象、短寿命、无指针写/任意删除；官网由独立 owner在Cloudflare公开回读后切 active。Analytics 会话过期必须重新原生刷新，不能复用空输出或过期缓存。
- Changed scope: fixed publication pin、真实多文件大对象桥、原生 audit status证据、官网可执行 handoff及其合同测试；本机 broker/keychain只属于 owner-only runner状态，不入仓、不入artifact。
- Verification commands and results: `pnpm run test:impact` 37/42通过且5项为明确Harness-toolchain skip；`pnpm run test:release` 24/24；coordinator 4/4；performance 32/32；external publication 88/88；两份workflow YAML、两个脚本check与diff check通过。
- Immutable evidence / receipt: 外部 protected-main `de2868c574098c356ce0b88c02d6c3afd29d47be`；本机 broker权限目录0700、可执行0700、state/preload0600与专用Keychain项。仍没有 exact candidate DMG/EXE、production performance run、签名 admission、Cloudflare写入、官网切换或双平台安装回执。
- Remaining blockers: PR与protected-main attempt-1、正式四模型性能采集、签名admission、Cloudflare/Profile/Desktop发布、公网回读、macOS/Windows安装更新回滚仍须按顺序完成。
- Next exact action: 提交并推送唯一source SHA，等待PR CI通过后合入protected main；只消费该main attempt-1产生的同一字节继续实机与发布。

## 2026-08-26 · 2.0.13 正式 CI 图标工具与官网真实 owner 校正

- Goal checkpoint: PR CI 首次真实执行 macOS `package:dir` 后暴露 electron-builder 图标工具的模块作用域冲突；官网发布前驱只读核验同时证明服务器唯一在线切换点仍是 `current`，不是计划中尚不存在的 `active`。本条修复这两个正式发布阻断，不提前发布。
- Frozen baseline / current HEAD: PR #59 候选起点 `cc889290c66fa3481c7540c53cfca17c1c9ea916`；失败 CI run `32914225143`；官网公开入口当前 index 为 `636` bytes、SHA-256 `02ea7f5f44ef41390c41901b3f385754bc333f19be4a9aa0efe582890a7a252c`，与服务器 `current` 指向内容逐字节一致。
- Binding documents read: 根 `AGENTS.md`、S35、最新完整日志、CI Build-once 合同、release coordinator 与下载页 handoff owner。
- Inspected native seam: electron-builder `icons@1.1.0` 下载到根 `type=module` 作用域内，CommonJS `icon-tool.js` 因 `require` 不可用失败；官网 Nginx 当前由 `/srv/ecorex-agent-download/current` 服务，既有前驱位于同一根的 `releases/`，服务器没有 `active` 软链。
- Experiment or why unnecessary: CI 失败日志精确定位图标转换步骤；缓存移出仓库模块作用域后保留同一 actions/cache key 与跨平台共享做法。官网通过授权 SSH 只读 symlink/index 和公网 HTTPS 回读交叉核验，没有写服务器、R2、Feed 或 desired state。
- Decision and forbidden alternatives: 两个平台共用的 electron-builder 工具缓存固定到 workspace 父级，避免按 macOS 单步改工具源码或关闭图标生成。官网 handoff 改为对真实 `current` 做 exact predecessor CAS，候选写入 `releases/site-emate-2.0.13-<source>`，最后相对切换 `current`；拒绝伪报 `active=absent`、覆盖旧槽位或增加第二软链发布路径。
- Changed scope: CI 两个平台工具缓存边界、官网 handoff schema/描述及既有合同测试；未改产品运行时、图标资产、模型链、Desktop/Profile 字节、R2、Feed、desired state、官网或用户数据。
- Verification commands and results: change-impact `24/24`；release/coordinator `20/20`；`git diff --check` 通过。PR 新候选仍须由真实 macOS/Windows CI 证明构建修复。
- Immutable evidence / receipt: 只有失败 run `32914225143`、源码修复、只读官网前驱与公网 index 对账；没有候选安装器、安装态、生产写入或公开指针变化。
- Remaining blockers: 新 exact PR CI、protected-main attempt-1、四模型性能、admission、Cloudflare 发布、公网回读和实机安装/更新/回滚仍保持 OPEN。
- Next exact action: 推送本校正后的唯一候选，PR CI 全绿后合入 protected main；只消费 main attempt-1 字节继续实机与生产发布。

## 2026-08-26 · 2.0.13 protected-main Windows 正式字节后处理修复

- Goal checkpoint: protected-main attempt-1 已真实生成并验证 Windows 2.0.13 安装器，但紧随其后的版本读取步骤在 Git Bash 因嵌套双引号失败；该 SHA 的全部字节继续作废，不进入 coordinator 或发布。
- Frozen baseline / current HEAD: protected-main `034bf3e89a7461edd6acb6df4e336d60a5f471a9`，CI run `32916353656`；本修复基于同一已审计候选源，仅修改共享 CI 后处理语句和合同测试。
- Binding documents read: 根 `AGENTS.md`、Build-once CI 合同、S35 与上一条完整日志。
- Inspected native seam: `dist:win`、安装器校验、Loader/Profile 校验均成功；失败只在 `Resolve the formal Desktop version` 的 Git Bash 脚本解析，PR 因 distribution=false 不执行该正式后处理路径。
- Experiment or why unnecessary: 复用仓库其他正式流程已采用的 `node -p 'require(process.argv[1]).version' <path>` 写法，同时修正 Windows/macOS 两个同源步骤并由现有 change-impact 合同锁定，未增加 helper 或平台分支。
- Decision and forbidden alternatives: 修共享版本读取一次，不绕过失败 job、不手工拼版本、不复用失败 run 已生成的安装器，也不把 PR smoke 冒充正式后处理覆盖。
- Changed scope: CI 两个版本读取步骤、既有合同测试和本 append-only 记录；未改产品、打包输入、安装器字节、模型链、Profile、R2、Feed、官网或用户数据。
- Verification commands and results: change-impact `24/24`，`git diff --check` 通过；仍须由新 PR 和新 protected-main attempt-1 双平台正式路径证明。
- Immutable evidence / receipt: 失败 run `32916353656` 日志证明 Windows 安装器验证通过后才在 shell 解析退出 2；没有 admitted artifact、安装态或生产写入。
- Remaining blockers: 新 PR、protected-main attempt-1、性能/admission、Cloudflare、官网及实机验收全部保持 OPEN。
- Next exact action: 提交最小修复并新建 PR；全绿后合并得到新的唯一 source SHA，重新构建正式字节。

## 2026-08-26 · 2.0.13 正式 staging 跨 Shell 参数闭环

- Goal checkpoint: protected-main `8d67a529b55ddb4a065d3f5c389ef711c35528ab` 再次证明 Windows 安装器本体与校验成功，但版本 argv 缺显式相对前缀，随后 PowerShell 又将 Bash 风格 run-id 环境变量解析为空；同一 run 的全部字节继续作废。
- Frozen baseline / current HEAD: 失败 CI run `32918150868`；本修复从该 exact protected main 建立干净分支，只修正式 staging 参数交接。
- Binding documents read: 根 `AGENTS.md`、Build-once CI/staging 合同、S35 与上一条完整日志。
- Inspected native seam: `require(process.argv[1])` 对裸 `desktop/...` 按模块名解析而不是当前目录文件；Windows stage 默认 shell 是 PowerShell，`$GITHUB_RUN_ID` 不是其环境变量语法。两者均使已验证安装器无法进入闭合 artifact。
- Experiment or why unnecessary: 版本路径增加唯一 `./`；run id 直接使用 Actions 已解析的 `${{ github.run_id }}`，在进入任一 shell 前固化。两个平台继续共用同一命令，不增加 shell 分支、helper 或手工版本。
- Decision and forbidden alternatives: 在参数边界修一次，禁止切换默认 shell掩盖问题、从文件名猜版本、复用失败 run 安装器或让 staging 接受空 run id。
- Changed scope: CI 两平台 version/stage 参数、既有合同测试及本记录；未改产品、打包输入、安装器、Profile、模型链、R2、Feed、官网或用户数据。
- Verification commands and results: change-impact `24/24`、`git diff --check` 通过；合同逐平台锁定显式相对路径与 GitHub run-id 上下文。
- Immutable evidence / receipt: run `32918150868` 的 Windows 日志显示真实安装器验证成功后出现 `MODULE_NOT_FOUND` 与空 `--ci-run-id`；没有 admitted artifact、安装态或生产写入。
- Remaining blockers: 新 PR 与新 protected-main attempt-1、性能/admission、Cloudflare、官网和实机验收仍 OPEN。
- Next exact action: 提交干净 PR，合并后只认新的 protected-main source 与 attempt-1 字节。

## 2026-08-26 · 2.0.13 Desktop publication verifier closure

- Goal checkpoint: coordinator run `32922110287` 只读绑定 exact Desktop artifact 时，源码 verifier 因未安装锁定 `fflate` 依赖失败；没有生产写入。
- Frozen baseline / current HEAD: protected main `db512b174d08b8b51395cd0fd308df0833862416`，成功 CI `32919912761`。
- Binding documents read: 根 `AGENTS.md`、S35、Build-once 与 Desktop publication 合同。
- Inspected native seam: `desktop-release.yml` checkout 后直接运行 `desktop-admission.mjs`，该源码沿 `profile-component.ts` 使用 Desktop Yarn closure，但 workflow 未物化该 closure。
- Decision and forbidden alternatives: 在唯一 verifier consumer 复用 `corepack enable` 与 `yarn install --immutable`；不重建 Base/Profile/安装器，不 vendor 依赖，不放宽校验。
- Changed scope: Desktop publication workflow、既有 release 合同测试与本记录。
- Verification commands and results: release `16/16`、`git diff --check` 通过。
- Immutable evidence / receipt: child run `32922141498` 明确为 `ERR_MODULE_NOT_FOUND: fflate`；R2、Feed、官网、desired state 均未写。
- Remaining blockers: 修复 PR、new protected-main CI/coordinator、性能/admission、实机与生产发布。
- Next exact action: 合入最小 verifier closure 后重新以新 exact main 字节启动 coordinator。

## 2026-08-26 · 2.0.13 Desktop 发布消费者版本路径闭环

- Goal checkpoint: exact protected-main CI `32923419344` 的 Base/Profile、Windows Setup 与 macOS Universal DMG 全部成功；coordinator `32925166608` 随后在 Desktop 子流程完成全部字节与回执校验后，仅因 Node 将裸 `desktop/.../package.json` 当包名解析而失败，生产未写入。
- Frozen baseline / current HEAD: 失败发布 source `626f5a26751ca32f7a2b9ef3431e23dee4776f1b`；Desktop child `32925199255`。该 source 的发布交接作废，必须由新 exact main 重新闭合。
- Binding documents read: 根 `AGENTS.md`、S35、Build-once、TTFT v2 与 Desktop publication 合同。
- Inspected native seam: `desktop-release.yml`、`desktop-performance.yml`、`desktop-admission.yml` 三个发布消费者使用同一错误裸相对 argv；CI 正式 staging 已使用显式 `./`，绝对 npm manifest 路径不受影响。
- Experiment or why unnecessary: 三个消费者只给既有 argv 增加 `./`，不新增 helper、版本输入、文件名推断或第二条发布路径；现有 release/admission 测试逐消费者锁定正反例。
- Decision and forbidden alternatives: 在共同参数边界一次修全，禁止只修当前 child 后让 performance/admission 继续晚失败，也不复用失败 coordinator 的半成品或跳过回执校验。
- Changed scope: 三个发布 workflow 的版本读取参数、既有合同测试和本 append-only 记录；未改产品、Base/Profile、安装器输入、模型链、R2、Feed、官网或用户数据。
- Verification commands and results: release/admission `24/24`、`git diff --check` 通过；失败 coordinator 与仍无必要继续的 Profile child 已请求取消，未发生生产写入。
- Immutable evidence / receipt: child `32925199255` 证明全部精确下载与 receipt verify 成功后出现 `MODULE_NOT_FOUND: desktop/e-mate-desktop/package.json`；没有 performance admission、Cloudflare handoff、官网切换或公开回读。
- Remaining blockers: 新 PR、protected-main attempt-1、coordinator、四模型性能、admission、实机与 Cloudflare/官网发布仍 OPEN。
- Next exact action: 合入本最小闭环并只认新 protected-main source/attempt-1 字节，重新启动 coordinator。

## 2026-08-26 · 2.0.13 S35 跨运行制品下载目录闭环

- Goal checkpoint: 最终发布协调器 `32928224821` 的性能子链在任何模型调用或生产写入前 fail closed。
- Frozen baseline / current HEAD: 受保护主线 `9b96035819e691739a4599ffa3f69512112b796a`；失败性能运行 `32928852497`。
- Binding documents read: 仓库 `AGENTS.md`、`docs/target-contract.md`、`docs/performance-and-acceptance.md` 与当前 S35 发布合同。
- Inspected native seam: `actions/download-artifact@v4` 使用精确 `artifact-ids` 跨运行下载时默认保留制品名目录，而性能与最终 admission 的既有消费者合同要求目标目录直接包含签名文件。
- Experiment or why unnecessary: 本机 Runner 落盘证据显示三份正确文件完整位于唯一制品名子目录；无需放宽三文件门禁或复制字节。
- Decision and forbidden alternatives: 所有跨运行、精确 artifact-id 下载统一启用原生 `merge-multiple: true`，让 action 直接写入既有权威目录；禁止递归查找、移动未知目录、接受额外文件或绕过完整性验证。
- Changed scope: 仅 `desktop-performance.yml`、`desktop-admission.yml` 的九个下载步骤及一条 YAML 合同测试。
- Verification commands and results: `node --test scripts/desktop-admission.test.mjs` 为 `8/8`，`git diff --check` 通过；受保护主线 CI 待回填。
- Immutable evidence / receipt: GitHub run `32928852497` 在 `Verify Desktop bytes and resolve their CI producer run` 失败；未调用模型、未发布 R2/官网。
- Remaining blockers: 修复合并主线并重跑完整协调器。
- Next exact action: 运行窄测试、提交 PR、等待主线 CI 后以新源码重新协调发布。

## 2026-08-26 · 2.0.13 Windows 2.0.12 原子更新版本规范化

- Goal checkpoint: exact protected-main Windows candidate 在真实 2.0.12 覆盖更新中于安装器原生 `Inspect` 阶段 fail closed；本条只修该共享事务根因，不发布、不卸载重装、不改用户状态。
- Frozen baseline / current HEAD: 独立分支 `fix/win-product-version-2013` 基于 source `9b96035819e691739a4599ffa3f69512112b796a` / CI `32926072469`；失败候选安装器为 `281339666` bytes、SHA-256 `e6b842f8a51c74b17945552c630f41971039771b4d39f4410b3a8da260efbf8e`。
- Binding documents read: 根 `AGENTS.md`、`docs/target-contract.md`、最新完整 development log、Windows update transaction与既有合同测试。
- Inspected native seam: 实机 2.0.12 `e-Mate.exe` 的 Windows `ProductVersion` 为 `2.0.12.0`；同候选内嵌 `Get-ManualInstallContext()` 只接受三段版本，原生 `Inspect` 确定性报 `installed version rejected`，因此静默路径返回1、交互路径在SHA确认前退出，原子交换尚未发生。
- Experiment or why unnecessary: exact候选同源脚本在实机直接复现失败；修复脚本的原生 `SelfTest` 通过，且对同一安装态执行只读 `Inspect` 正确投影 `currentVersion=2.0.12`、`targetVersion=2.0.13` 和原候选SHA。无需注册表清理、第二安装器、卸载重装或私有回执伪造。
- Decision and forbidden alternatives: 共享事务入口只把严格 `x.y.z.0` 规范化为 `x.y.z`；既有三段值原样保留，第四段非零、`00`、前导零、缺段和后缀继续 fail closed。版本比较、请求、日志和安装器UI仍只使用canonical三段值。
- Changed scope: `desktop/e-mate-desktop/build/windows-update-transaction.ps1`、其既有合同测试和本append-only记录；未改Base/Profile/Harness、模型/搜索/账号、安装包、R2、Feed、官网或用户数据。
- Verification commands and results: Windows原生 `-Operation SelfTest`通过；同一2.0.12安装态只读`-Operation Inspect`通过并返回canonical版本与exact SHA；`git diff --check`通过。
- Immutable evidence / receipt: 2.0.12用户数据已在安装前做可恢复私有备份；失败候选未进入rename/swap，已安装文件仍为2.0.12。修复目前仅为源码与实机脚本验证，不是候选构建或安装通过。
- Remaining blockers: 必须合入protected main、产生新的attempt-1 exact Windows安装器并重新执行2.0.12→2.0.13原子更新、启动、会话、导航、登录/模型/搜索隔离和回滚验收；旧 `9b960` 候选永久作废。
- Next exact action: 提交最小修复供主线合入；只消费新protected-main CI的exact字节重跑Windows实机验收。

## 2026-08-26 · 2.0.13 S32 改图 413 与子代理顶层投影生产事故闭环

- Goal checkpoint: 用户改图连续返回 `receipt status unknown`，且原生图片子代理 Session 被 e-Mate 自定义首页/侧栏误投影为顶层会话；本条只恢复 2.0.13 可用性，S32 完整并发与交互迭代留给 2.0.14。
- Frozen baseline / current HEAD: 修复分支基于受保护主线 `d4444475e4dfb77ecba3c9919d1153a4e08ef576`；正式发布仍须使用本修复合入后的 exact main 字节。
- Binding documents read: 根 `AGENTS.md`、`docs/target-contract.md`、S32/S35 与最新完整 development log。
- Inspected native seam: 图片任务继续由 rc.7 原生 parent/child Session、Job、附件与 ImageGen receipt 链拥有；e-Mate 只负责顶层 Session 投影。生产链显示 1,439,016-byte PNG 在外层 Nginx 默认 1 MiB 限制处被 HTTP 413 拒绝，未到达允许 50 MiB 的 Web 层及允许 5 MiB/图的 Gateway；旧 receipt 因已开始本地提交阶段而误记 `unknown`。
- Experiment or why unnecessary: 外层 `/e-mate/` 路由把原生 `client_max_body_size` 对齐到 50 MiB 后，沿同一父会话、同一原图只调用一次 `imagegen`；候选图成功返回并由用户语义确认闭环，没有 413、unknown 或自动重试。子 Session 保留完整原生记录，只从首页、项目和通用会话的顶层投影排除。
- Decision and forbidden alternatives: 不删除子 Session、不禁用子代理、不新增图片运行时、重试器或第二会话表；只在首次可靠知道请求未提交的 HTTP 413 边界记录 `failed/not-submitted/http-413`，其他不可证明的 provider 结果继续 fail closed 为 unknown。
- Changed scope: `emate-shell` 首页/侧栏投影及回归、共享 ImageGen receipt 分类及回归、本 append-only 记录；外层生产路由热修复独立留有可回滚激活回执。
- Verification commands and results: Sidebar/Home fidelity `16/16`；ImageGen targeted test `1/1`；Harness 与受影响组件 build 通过；`git diff --check` 通过；安装态真实改图一次成功，源图 SHA-256 `ee08298fb9a0919ab3eaf0de81373b2902e32b14d4a76b88a4b57d5a7e7068e3`，候选 SHA-256 `0aadb886f0f6f2deb86f68bcf164fe543540196f0876da8f109882b92b141ddf`。
- Immutable evidence / receipt: 生产路由激活回执 `20260826T0530Z-image-edit-413/activation.receipt.json`，SHA-256 `407707d659cef6838043d6bfa0f2c6a6c5cd5f88659d446436e1ebab200fa8a6`；公开 `/e-mate/healthz` 回读 200。
- Remaining blockers: 首页/侧栏顶层投影与 413 receipt 分类尚须合入 main、由同一源码构建 macOS/Windows 候选并完成安装/更新验收后才可随 2.0.13 发布；性能验收按用户明确决定跳过，不得标记 passed。
- Next exact action: 提交本最小修复、合入受保护主线并只发布新 main exact 字节。

## 2026-08-26 · 2.0.13 Windows 手动更新回执校验闭环

- Goal checkpoint: 合入 ProductVersion 规范化后的 exact 2.0.13 候选在 Windows 2.0.12 实机通过只读 `Inspect`，但原生 `Bootstrap` 在写入 pending authority 前因 PowerShell 5 表达式优先级误拒绝手动安装固有的 `sourceCommit=null`；未进入 staging、rename 或安装。
- Frozen baseline / current HEAD: 受保护主线 `6d38ea56594fb5684c6b3695ce8337a0f163b2c9`；候选 Setup `281340377` bytes、SHA-256 `aa3288adc6e8e3bee4c6d1e86ed2ad9600f544d69c68e995d25419cc01c72d4f`。
- Binding documents read: 根 `AGENTS.md`、Windows 原子更新合同、S35 与上一条完整记录。
- Inspected native seam: `Read-Request()` 将可空 `sourceCommit`、字符串类型和 SHA 形状混在一个未显式分组的 PowerShell 表达式中；Windows PowerShell 5.1 对 `null` 输入计算为 false，导致手动 admission 永远无法进入同一事务链。managed-manifest 的 40 位 source commit 边界不变。
- Experiment or why unnecessary: 在同一 Windows PowerShell 5.1 上证明旧表达式对 `null` 为 false、显式分组后为 true；修复脚本原生 `SelfTest` 通过。没有修改回执、伪造 source commit、跳过校验或另建更新路径。
- Decision and forbidden alternatives: 只给现有可空联合条件添加显式括号，并把手动 `null` 正例加入原生 SelfTest；继续由唯一 `Read-Request()` 同时校验手动与托管更新。
- Changed scope: Windows update transaction 一处共享条件、原生 SelfTest 与本 append-only 记录；未改 Base/Profile/Harness、安装目录、用户数据、R2、Feed 或官网。
- Verification commands and results: Windows PowerShell 5.1 旧/新表达式实测 `false/true`；`-Operation SelfTest` 通过；`git diff --check` 通过。
- Immutable evidence / receipt: 实机更新前已关闭 e-Mate，并将 `.dsh/e-mate` 117 文件/30,980,229 bytes 与 Roaming `e-Mate` 5,563 非 junction 文件/201,697,831 bytes 复制到私有可恢复备份；失败 Bootstrap 未创建 pending authority。
- Remaining blockers: 修复必须合入 protected main 并重建内嵌脚本的新 Setup，再完成 2.0.12→2.0.13 原地更新、启动、会话和回滚实测；当前 `aa3288…` 候选永久作废。
- Next exact action: 提交最小 PR，等待新 exact main Windows artifact 后立即在同一安装态走原生更新链。

## 2026-08-26 · 2.0.13 Windows ProductVersion 全事务规范化

- Goal checkpoint: 新主线候选开始实机更新前，对唯一事务链做完端到端静态追踪，发现先前只在 `Inspect/Bootstrap` 规范化 Windows 四段 ProductVersion；`Prepare` 旧 Base 校验、候选校验与交换/回滚身份校验仍直接比较原始四段值。安装尚未启动，用户目录未交换。
- Frozen baseline / current HEAD: 受保护主线 `3be5826b3b7f7aedd3da0d76780e92c73ab05fef`；该 SHA 的 Windows artifact `9596507425` 因本缺口作废，不进入安装或发布。
- Binding documents read: 根 `AGENTS.md` 的共享根因准则、Windows 原子更新合同、S35 与上一条完整记录。
- Inspected native seam: 全文件只有四处读取 `FileVersionInfo.ProductVersion`；入口已经使用 `ConvertTo-CanonicalProductVersion()`，其余三处未复用，真实旧 Base `2.0.12.0` 会在 `Assert-OriginalCurrent()` fail closed，候选及回滚身份也存在同类风险。
- Experiment or why unnecessary: 无需启动安装即可由真实 2.0.12 metadata 与确定性代码路径证明失败；修复把剩余三处全部收口到既有严格规范化函数，合同测试锁定全文件恰好四处调用。
- Decision and forbidden alternatives: 只复用既有函数，不放宽版本语法、不新增兼容分支、不改 request/journal 版本格式；非零第四段和其他非法形式仍拒绝。
- Changed scope: Windows transaction 三个版本读取点、既有合同测试和本记录；未改安装字节以外的平台能力、用户数据或发布指针。
- Verification commands and results: Windows 原生 SelfTest、窄合同测试和新 exact-main CI 待回填；`git diff --check` 通过。
- Immutable evidence / receipt: 原 2.0.12 安装 exe SHA-256 仍为 `70e17703a946fe94c4f80b468b61c70e4419cca2cf1580cc14e0dfe803935b47`；事务根与 journal 均未创建。
- Remaining blockers: 合入 protected main、重新构建 Windows Setup，并完整跑通 Prepare→stage→Apply→Monitor→commit 与用户数据保留。
- Next exact action: 提交第二个最小 PR；旧候选不安装，只消费覆盖全部四处读取的新主线字节。

## 2026-08-26 · 2.0.13 Windows 原子更新候选路径预算闭环

- Goal checkpoint: exact main `f0c974f8fecca1a6ab82451f0e29515502f3be7a` 候选在 2.0.12 实机进入原生事务后停在 `staging`；旧 canonical 未重命名，安装进程在确认阶段与文件数稳定后于安全边界终止。
- Frozen baseline / current HEAD: CI `32942577622` / Windows artifact `9597355204`；Setup `281340342` bytes、SHA-256 `92c630bcb447af13ee0d44bf572b6530613b7bdce7df698ff872215cc015183c`，该字节作废。
- Binding documents read: 根 `AGENTS.md` 的共享根因/最小修复准则、Windows 原子更新合同、S35 与上一条完整记录。
- Inspected native seam: 正式 2.0.12 安装树最长绝对路径为 242 字符；旧事务根 `Programs/.net.ecoremedia.e-mate-update/<uuid>/candidate` 比 canonical 增长 70 字符，同一相对文件达到 312。NSIS 在 354 文件/396,413,570 bytes 后稳定停止，未进入 `Apply`；候选没有 `resources/python-runtime`，而旧安装树有 29,845 文件。
- Experiment or why unnecessary: 磁盘尚余 61.57 GB；Setup 无子进程、无可见窗口、CPU/I/O 与候选文件数持续不变，排除空间不足、健康 ACK 等后续阶段。旧 canonical SHA-256 始终为 `70e17703a946fe94c4f80b468b61c70e4419cca2cf1580cc14e0dfe803935b47`。
- Decision and forbidden alternatives: 保留同一事务、journal、原子 rename 与回滚；只把事务根压缩为 canonical 同父目录下 `.u/<12-hex>`，候选/旧版/失败目录分别为 `c/o/f`。候选根相对 canonical 最多增加 11 字符；前缀碰撞在 Bootstrap 写 authority 前 fail closed。禁止开启全局 LongPaths、缩短包内第三方路径、直接覆盖 canonical 或另建安装器。
- Changed scope: Windows transaction 路径派生与 journal path guards、原生路径预算 SelfTest、既有合同测试和本记录；未改用户数据、应用内容、R2、Feed 或官网。
- Verification commands and results: staging 终止后 Setup exit `-1`、安装版本仍 `2.0.12.0`、`.dsh/e-mate` 仍为 117 文件/30,980,229 bytes；新源码的 Windows SelfTest 与 CI 待回填。
- Immutable evidence / receipt: 失败事务保留 pending/request/journal 与不完整 candidate 供审计；更新前私有备份仍可恢复。
- Remaining blockers: 合入 protected main、重建最终 Setup，并从干净 pending 状态重新跑通完整事务。
- Next exact action: 提交最小路径预算 PR；新 CI 字节到达后归档失败 staging，再执行唯一最终实机更新。
## 2026-08-26 · 2.0.13 正式性能恢复与发布前置纠错

- Goal checkpoint: 用户在 emergency legacy Desktop 更新入口已公开回读后明确要求恢复正式性能测试并更新官网；本 checkpoint 撤销后续“免测收尾”路线，但不改写 emergency publication 的历史事实。
- Frozen baseline / current HEAD: 起点为 protected `public-2011/main` `a9632e787e8843c189cbb79a9725c72461982dcd`；已成功 CI `32971421254`、Desktop `32974052237`、Profile `32974255196`，其精确安装器和 emergency `desktop/latest.json` 身份记录于 `artifacts/receipts/release-2.0.13-emergency-publication-a9632e7.md`。
- Binding documents read: 根 `AGENTS.md`、`target-contract.md`、S35、TTFT v2、最新 development log、Desktop performance/admission/coordinator workflow 与今日失败链。
- Inspected native seam: `desktop-performance.yml` 唯一输入名为 `main_ci_run_id`，但候选校验步骤错误读取不存在的 `inputs.ci_run_id`；历史 run `32928852497` 已在同一步下载完候选后失败。当前受保护主线仍保留该确定性错误，直接 dispatch 必然重复失败。Windows 标题栏原生三按钮已由 `window-chrome.ts` 固定 138px/32px 与 `symbolColor`，应用侧分享/主题/设置却另用 32px 按钮、18px 图标、主题色和 24px 间隔；视觉漂移来自两个尺寸/颜色真相源。
- Experiment or why unnecessary: 只读 GitHub 回执证明历史 performance runner 曾正常接单并在精确候选校验处失败；源码全文件搜索确认仅该一处错误引用，其他三个消费者均使用 `main_ci_run_id`。先补一条合同反例，禁止再次用昂贵 workflow 发现同一输入漂移。
- Decision and forbidden alternatives: 在正式性能前先把该共享 input boundary 修为 `inputs.main_ci_run_id` 并以现有测试锁定；因为当前 admission 把 workflow source SHA、CI、Desktop、Profile 与性能 artifact 绑定，修复后的 source 不能冒充旧 `a9632e7` 安装器，必须由新 protected-main exact SHA 重新产生一次不可变双端候选。Windows 应用侧三枚图标复用现有原生 caption 宽度/颜色常量投影的 CSS token，贴住原生按钮左缘；macOS 保持原布局。不得手工改 artifact source、伪造 performance run、只切官网或再造标题栏。
- Changed scope: 一处 performance workflow 输入映射、一条既有合同测试、Windows 标题栏共享尺寸/颜色 token 与应用工具 CSS、对应窄测试、今日构建发布事故防复发仓库准则、emergency publication 不可变回执与本 append-only checkpoint；未改模型头、路由、Base/Profile/Harness、R2、Feed、官网或用户数据。
- Verification commands and results: change-impact/component/profile/publication 合同合计 `42/42`（首次缺固定 `dsh-genui` 子模块时 `41/42`，初始化精确 gitlink 后仅重跑 owning component `13/13`）、Desktop admission/workflow `8/8`、Desktop client environment/window options `18/18`、e-Mate Shell bundle build 与 Windows 标题栏静态合同通过，`git diff --check` 通过。全量 upstream `build:lib:client` 在未先生成 host remotes 的干净本机树因既有 remote 类型缺失失败，不记为本 diff 通过或失败；PR CI 仍须完成正式闭包验证。
- Immutable evidence / receipt: 现阶段只有历史成功/失败 GitHub run 和公开 emergency pointer/installer 回读；没有新 source 候选、正式 performance/admission、signed/manual pointer 或官网切换。
- Remaining blockers: 定向检查、PR/protected-main、新 exact CI/Desktop/Profile、四模型 installed performance、signed admission、Cloudflare 正式三入口一致性与官网原子切换仍 OPEN。
- Next exact action: 运行最窄合同；提交并推送一个 source-fix PR，CI 全绿后只消费新 protected-main attempt-1 字节，启动 one-shot performance runner，随后按 admission→Cloudflare plugin→官网 current 顺序闭环。

## 2026-08-27 · 2.0.13 首次 Profile bootstrap 前组件 Lane 定责修复

- Goal checkpoint: 子代理顶层投影的独立 Shell 修复在普通组件 CI 中暴露发布分类缺口；本条只修发布 Lane 定责，不改 Session、ImageGen、组件实现或生产指针。
- Frozen baseline / current HEAD: 独立分支基于受保护 `main@4530b373a6652c2ae909e460112be985232ac02c`；候选 Base/Harness 为 `e-mate-desktop-profile-v7-dsh-b2b1650b01f0` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606`。
- Binding documents read: 重新核对根 `AGENTS.md`、`target-contract.md`、`environment-and-dependencies.md`、Profile 组合/发布脚本、当前三目标快照和失败 CI 回执。
- Inspected native seam: 变更分类器此前只按源码路径判定组件 Lane；公网和仓库快照中的三目标当前 desired state 均仍是 2.0.12/Base v6，而候选组件只允许 Base v7。组件 CI 因而先被误派到 `plugin-only`，随后在唯一完整 generation composer 中正确拒绝 `base-required` 父代。
- Experiment or why unnecessary: 三目标公网字节与受控快照的 bytes/SHA-256 完全一致，均为 sequence 3、Base v6、Harness `2bc16230975f6cf02aa1b283b1f86de44007b059`，排除快照陈旧或候选 Shell 载荷损坏；失败发生在读取候选 Shell 字节之前。
- Decision and forbidden alternatives: 复用现有签名 Profile parser 和 `selectProfileRelease()`，只有三目标当前 desired state 全部与候选 Base 兼容时才允许发布型组件变更进入 `plugin-only`；缺失、损坏、目标不符或 `base-required` 均失败关闭到 `base`。禁止跳过组合、伪造 v7 父代、降级组件兼容表、复用 v6 组件引用或由工作流标签覆盖分类器。
- Changed scope: 仅修改唯一影响分类器、其窄测试和两份绑定开发准则；子代理投影修复仍由独立 `@e-mate/dsh-client-shell` PR 持有。
- Verification commands and results: Node 24 分类器 `25/25`（含 publishable/test-only pre-bootstrap 正反例）、组件闭包 `9 passed / 4 toolchain-absent skipped`、Profile 组合/发布 `4 passed / 1 toolchain-absent skipped`，`git diff --check` 通过；受保护 CI 仍待提交后执行。
- Immutable evidence / receipt: 失败诊断绑定 Shell source-fix CI run `32990225194`；它不能作为候选或发布证据。当前无安装、上传、R2、Feed、desired-state 或官网写入。
- Remaining blockers: 提交并通过独立 PR 全量 Base CI；合并后重基 Shell 修复并以新的 exact main 候选重建。首次完整 Profile bootstrap、双平台安装/更新和公开回读继续 OPEN。
- Next exact action: 跑最窄分类器与发布合同，提交独立修复并等待受保护 PR CI；生产链保持关闭。

## 2026-08-27 · 2.0.13 S32 原生子代理顶层投影 P0 二次定责

- Goal checkpoint: 用户实测单个及并发图片子代理仍会以独立会话进入左侧列表；本切片只修顶层产品投影，不改 ImageGen、Subagent、Session 持久化或父任务入口。
- Frozen baseline / current HEAD: authoritative `public-2011/main` 与独立分支起点均为 `4530b373a6652c2ae909e460112be985232ac02c`；Base `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`，Harness `0.1.0-rc.7` / `b2b1650b01f0ee88d81837a9b5c050f9f763f606`，Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`。
- Binding documents read: 根 `AGENTS.md`、`target-contract.md`、`plugin-contracts.md`、S32/S35 与最新完整 development log。
- Inspected native seam: pinned rc.7 child creation writes `parentSession` and `origin: 'subagent'`; Host `sessionListFields()` projects both, while client `SessionListState` additionally exposes `subagentsByParent` and `currentAddress`. e-Mate Shell Sidebar/Home currently define partial local rows and filter only `parentId === undefined`; project loops duplicate that condition.
- Experiment or why unnecessary: exact source already deterministically proves the first presentation violation, and the installed screenshot supplies the user-visible escape. Creation Mode cannot replace the existing Shell winner or prove reconnect/restart identity, so the smallest permanent pure selector plus native-state integration regression is the first valid experiment; installed Profile identity and real 1/2/4 child checks remain mandatory afterward.
- Decision and forbidden alternatives: add one pure classifier over the native client-runtime types and make Sidebar/Home consume it. Do not filter `This is one e-Mate image` or any title/prompt, hide with CSS/timers, delete/archive children, suppress persistence/catalog, modify ImageGen/Subagent creation or add a second store.
- Changed scope: contract amendment only at this checkpoint; implementation not yet changed.
- Verification commands and results: protected-main fetch matches local start; pinned Harness submodule checked out at exact Base commit and native source seams inspected. Product regression and installed verification are pending.
- Immutable evidence / receipt: user screenshot proves a child title in the top-level list; no new candidate/Profile generation or production pointer exists.
- Remaining blockers: implement the shared selector, cover origin-only/catalog-only/current-address/parentId/single/concurrent/search/batch/Home/highlight, run component/build/composition gates, then verify exact installed Profile identity and runtime behavior.
- Next exact action: add the pure selector and replace every Sidebar/Home top-level consumer before running the focused component test.

## 2026-08-27 · 2.0.13 S32 原生子代理顶层投影 P0 源码终态

- Goal checkpoint: P0 的源码、共享分类器、原生 Host→Client 投影回归和 Shell 全组件回归已闭环；正式 Profile generation、安装态 1/2/4 子代理与重启/热更新证据仍保持 OPEN，未据源码测试冒充上线。
- Frozen baseline / current HEAD: 实现最初基于 `4530b373a6652c2ae909e460112be985232ac02c`，现已重基到独立分类器修复后的 protected `main@724800e379df754b66b96bd58ecf7b04dd38463f`；Base `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`、Harness `0.1.0-rc.7@b2b1650b01f0ee88d81837a9b5c050f9f763f606` 与 Desktop reference `6074088f5b660206e404b3591fab51fb99c69add` 不变，产品 diff 未改 Harness/Desktop/Base、组件 inventory、锁或权限。
- Binding documents read: 根 `AGENTS.md`、`target-contract.md`、`plugin-contracts.md`、`performance-and-acceptance.md`、S32/S35 与前一条定责记录。
- Inspected native seam: rc.7 `SessionRuntime` 把真实 `host/session-added` 的 `origin`/`parentSessionId` 投影为 `SessionListState.byId.origin`/`parentId`；同一状态还保留 catalog 与当前 child address。Shell 不再维护缩水的本地 Session row 类型。
- Experiment or why unnecessary: 先以真实编译后的 rc.7 `SessionRuntime` 投递 parent/child Host 帧，再把其原生 `SessionListState` 交给产品 selector；另以 1/2/4 child、child-first、state rebuild 覆盖并发、乱序与重建。未定义复制 Shell winner 的 Creation Mode 动态包。
- Decision and forbidden alternatives: 唯一 `session-visibility.ts` 从 `origin`、`parentId`、`subagentsByParent.kind=child` 和 `currentAddress.childSessionId` 汇总 internal ids；Sidebar 项目/通用/搜索/批量删除与 Home 计数/Token/趋势/最近任务共同消费。current 为 child 时只高亮 parent。未按标题过滤、未 CSS/计时隐藏、未归档 child、未改 ImageGen/Subagent、未建第二 Store。
- Changed scope: 产品改动仍只属于 `@e-mate/dsh-client-shell` 的 selector、Sidebar、Home、聚焦测试及四份约束文档；由于公网三目标尚为 Base v6、首次 v7 Profile bootstrap 未完成，合入的唯一分类器现将该发布型组件变化失败关闭到 `base`，而不是再尝试不可能的 v6→v7 组件增量组合。
- Verification commands and results: pinned Harness Host/Client 直接构建 exit 0；聚焦 Sidebar/Home/Settings `19/19` 后修复空 `currentAddress` 与空 `current` 的同值边界；最终 Shell 全套 `9 files / 72 tests`；固定 pnpm `11.7.0` 的 `component-run check --component @e-mate/dsh-client-shell` 构建、runtime-import 校验与同一 `72/72` 全过；`git diff --check` 通过。
- Immutable evidence / receipt: 本地 deterministic bundle `lib/client.js` 为 `282820` bytes / SHA-256 `9992724fc2af2f3a779afb64bacbc6c6d43a55bf198f1561d728fdcac9beb2a9`，入口 `index.js` 为 `2152` bytes / SHA-256 `84a45acf8b667f0ccdecdc53d17bfee5e109159a9219c4cde36513677780e789`；这些是开发证据，不是签名发布字节。
- Remaining blockers: 重基后的 exact source PR/Base CI、首次三目标完整 Profile bootstrap/boot、隔离安装态派 1/2/4 子代理时顶层计数、父入口可达、搜索/批量/Home、连接重建、重启、Profile 激活/回滚及最终签名 generation identity 尚未完成。
- Next exact action: 提交 source-fix PR；只消费 exact protected-main CI 产出的 Shell payload，在隔离 non-production Profile 上完成上述安装态矩阵后才允许进入正式 Profile 发布。

## 2026-08-27 · 2.0.13 emergency legacy 正式发布恢复边界

- Goal checkpoint: 子代理投影合入受保护主干后准备正式性能/发布时，公网只读回读证明 `desktop/latest.json` 已被 emergency 2.0.13 占用，而正式发布 action 仍只接受冻结 2.0.12 前驱；本条修复唯一发布前驱边界并删除 post-emergency 的非必要 Base 运行时增量，不执行生产写入。
- Frozen baseline / current HEAD: 起点为 protected `public-2011/main@9f229900081e03d088012d28edfc1f5b8bb1ced1`、CI `32996160263`；公网 emergency legacy 为 `948` bytes / SHA-256 `1d70004c726e458525205dd370ebea595b3121ffd2afe49d7c65d646c4ac19c4`，`desktop/signed/latest.json` 仍为 `404`；官网 index 仍为 `636` bytes / SHA-256 `02ea7f5f44ef41390c41901b3f385754bc333f19be4a9aa0efe582890a7a252c`。
- Binding documents read: 唯一主 Goal、根 `AGENTS.md`、`target-contract.md`、`plugin-contracts.md`、`performance-and-acceptance.md`、S35、最新完整 development log、Desktop/Profile/performance/admission/coordinator/publication workflows 与固定外部 publication action。
- Inspected native seam: Base updater 只接受远端更高 SemVer，已安装 emergency 2.0.13 不会自动消费另一组同版本 Base；post-emergency Desktop 改动只把既有 Windows caption 的 `46px/12px/#7f858f` 常量再投影为 CSS 变量，而 Shell 已有完全相同 fallback。生产 signer 在固定 action 内把 legacy 前驱硬编码为单一 2.0.12 tombstone。
- Experiment or why unnecessary: 删除三项重复 Desktop CSS 常量投影及其测试后，工作树相对 `a9632e787e8843c189cbb79a9725c72461982dcd` 的 `desktop/e-mate-desktop/src` 和对应 client environment 测试 diff 为空；Shell 的 Windows safe-area/fallback 与子代理 selector 保持不变。外部 action 增加唯一 emergency identity 正例后全套 `88/88`，任意其他 948-byte identity 仍失败关闭。
- Decision and forbidden alternatives: legacy CAS 只接受冻结 2.0.12 或上述唯一 immutable emergency 2.0.13 identity；不接受任意同 SemVer、内容推断、无条件覆盖或第二 updater。已安装 emergency cohort 的用户可见修复必须全部由首次完整 Profile 承担，因此删除而不是保留 post-emergency Base 运行时差异。正式 signed/manual/legacy 最终仍必须是同一 admitted manifest bytes，legacy 仍是绝对最后条件写。
- Changed scope: 外部 publication action 的精确双前驱校验/文档/测试；主仓固定 action pin、performance/publication/website handoff 合同、四个重复 Desktop 常量投影文件的反向删除及绑定文档。本条未改 Harness、Session/ImageGen/Subagent、模型头/路由、安装器事务、R2、Feed、desired state、官网或用户数据。
- Verification commands and results: 外部 action Node 24 `88/88`、`git diff --check`；主仓 Desktop admission/release/coordinator `28/28`、`git diff --check`；相对 emergency source 的 Desktop runtime/test diff 为空。验证列车 Desktop run `33000731208` 成功；首次完整 Profile run `33000733886` 为 `25/25` 成功，三目标完整组合、boot 和签名交接准备均通过。
- Immutable evidence / receipt: 外部 PR `zyfjacksonchen-source/e-mate-desktop-publication#5` 已合入 protected main `4193d2ae0a87327f161ce4a5b69bf60aee1ab052`。Desktop artifact `9618497574` 为 `679913746` bytes / `sha256:49b9287aed4fb587a7bcd4d984ff60911b6a9597bf5bc34c9972dab3f238b7f1`；Profile publication artifact `9618933972` 为 `74741125` bytes / `sha256:b4c4f9511a12dc4e9ed46c18b8771e436b67a1ddf185f27fc01d66d3b4e2f982`。二者绑定旧 source `9f229900…`，只证明链路，不是本修复后的最终候选。
- Remaining blockers: 本恢复 diff 仍须独立 PR、受保护主干 CI 与新的 exact-source Desktop/Profile；随后才可运行四模型安装态性能、signed admission、双平台安装/更新/回滚、Cloudflare plugin 三入口 CAS、公网回读和官网 `current` 切换。现有 emergency 安装 cohort 还须以正式 Profile 激活/重启和顶层 1/2/4 子代理矩阵证明等价，不能以源码 diff 关闭。
- Next exact action: 提交本最小恢复 PR并等待 protected CI；只消费其 attempt-1 artifact set，禁止复用 `9f229900…` 候选继续 performance 或生产发布。

## 2026-08-27 · 2.0.13 emergency legacy PR 首次 CI 纠错

- Goal checkpoint: 正式发布恢复 PR 的首次完整 CI 在 Windows 标题栏几何测试失败；本条只修测试继续读取已删除重复 Base 常量造成的 `NaN`，不恢复运行时增量。
- Frozen baseline / current HEAD: PR `#78` head `21b4fafffa28068498acfbaa9911de401fd27c9e`，失败 CI `33002121754`；受保护基线仍为 `9f229900081e03d088012d28edfc1f5b8bb1ced1`。
- Binding documents read: 唯一主 Goal、根 `AGENTS.md`、S35、上一条 emergency legacy 正式发布恢复边界。
- Inspected native seam: Shell CSS 已把 Windows 按钮宽度、符号尺寸与颜色的离线 fallback 固定为 `46px`、`12px`、`#7f858f`；测试仍从已按上一条决策删除的 Desktop 导出读取同值，未导出符号在运行时变为 `undefined`，三按钮宽度计算因此得到 `NaN`。
- Experiment or why unnecessary: CI 精确失败为 `header-controls.client.spec.tsx:97` 的 `expected NaN to be greater than or equal to 0`；删除三个失效导入并让几何测试使用已经由同文件 CSS 正则锁定的 `46px` fallback 后，聚焦测试 `8/8` 通过。
- Decision and forbidden alternatives: 只调整 Profile 所有的合同测试，不恢复 Desktop 常量、CSS token 或同版本 Base 差异；产品运行时继续保持相对 emergency source 的 Desktop diff 为空。
- Changed scope: `@e-mate/dsh-client-shell` Windows 标题栏测试与本 append-only 记录；无产品运行时代码、R2、Feed、desired state、官网或用户数据写入。
- Verification commands and results: 固定 Harness Host/Client 本地构建通过；`vitest run tests/header-controls.client.spec.tsx` 为 `1 file / 8 tests` 全过；`git diff --check` 通过。修正后的 PR CI 待回填。
- Immutable evidence / receipt: 首次失败 CI `33002121754` 永久保留为负例，不可作为候选或发布证据。
- Remaining blockers: 修正后的 PR CI、受保护主干、新 exact-source Desktop/Profile、正式性能/admission、双平台安装/更新/回滚、Cloudflare 三入口与官网原子切换均保持 OPEN。
- Next exact action: 更新同一 PR 并等待精确 head CI；通过后才合入受保护主干并生成一次新的候选集。

## 2026-08-27 · 2.0.13 正式性能采集器所有权环境闭环

- Goal checkpoint: exact-source Desktop/Profile 候选和安装态单/双子代理投影已验证后，正式四模型性能 run 在进入真实样本前确定性失败；本条只修 protected workflow owner 到隔离采集器的进程边界，不改产品运行时、模型路由、性能阈值或生产指针。
- Frozen baseline / current HEAD: 独立修复分支基于 protected `public-2011/main@433fec4d734e681b87f20ef17fe79ed2220eefa9`；失败 performance run 为 `33008900166`，其 CI/Desktop/Profile 输入校验、下载和 aggregate 重算均成功，唯一失败步骤为 `Collect the exact installed-state production cohorts once`。
- Binding documents read: 唯一主 Goal、根 `AGENTS.md`、`target-contract.md`、`plugin-contracts.md`、`performance-and-acceptance.md`、S35 与最新完整 development log。
- Inspected native seam: owner 进程已用 `assertAcceptanceOwnerEnvironment()`验证并把 repository/ref/run/attempt/source 写入私有 plan；`runCollector()` 随后使用凭据隔离 allowlist 启动同一受保护源码的 probe，却遗漏 probe 自身 `assertProbePlan()` 必须再次核对的 `GITHUB_RUN_ID`、`GITHUB_RUN_ATTEMPT` 与 `GITHUB_SHA`，因此子进程在读取 runner-private 配置或安装字节前必然退出。专用只读 Usage exporter 的过期会话已通过既有 secret broker/OS keychain 路径刷新并单独验证成功，未把账号、密码或 Token 写入仓库、日志或 workflow 环境。
- Experiment or why unnecessary: 失败 run 从 probe 启动到退出约 0.3 秒，且精确源码证明父进程删掉全部三项后子进程立即要求它们；不需要重新测模型或修改 installed app 才能确定根因。新增测试实际启动一个 Node 子进程并读取其环境，证明三项 owner 字段存在、签名密钥样例被隔离。
- Decision and forbidden alternatives: 只在现有 allowlist 增加三项非敏感、已由父 owner 验证且与 plan 同值的 GitHub 身份；继续禁止 credential、signing secret、任意父环境和 shell 进入 probe。不得删除子进程 owner 复核、伪造 performance artifact、人工把失败 run 改为 passed，或复用旧 source 候选冒充修复后的 exact SHA。
- Changed scope: `scripts/performance-acceptance.mjs` 的唯一 child-process environment allowlist、对应既有测试和本 append-only 记录；无 Desktop/Profile/Harness/enterprise 产品代码、锁文件、R2、Feed、desired state、官网或用户数据写入。
- Verification commands and results: 固定 Node 24 的 `performance-acceptance.test.mjs` 为 `9/9`；完整 performance parity/acceptance/probe 聚焦套件为 `33/33`；`git diff --check` 通过。首次系统 `node` 不存在及干净 worktree 缺现有 `fflate` 时均未计为产品失败，复用仓库锁定 pnpm `11.7.0`/缓存安装既有依赖后只运行上述非重叠门禁。
- Immutable evidence / receipt: `33008900166` 永久记录为 owner 环境缺失负例；当前只有源码测试证据，没有新的 protected-main SHA、Desktop/Profile 候选、performance admission 或生产发布回执。
- Remaining blockers: 独立 PR/受保护主干 CI、新 exact-source Desktop/Profile 候选、重新运行一次性 performance owner、signed admission、双平台安装/更新/回滚、Cloudflare 三入口和官网原子切换均保持 OPEN。
- Next exact action: 提交最小修复 PR；CI 全绿后只消费新的 protected-main attempt-1 字节，重新注册一次性性能 Runner 并从新 run 继续 admission→Cloudflare→官网链。

## 2026-08-27 · 2.0.13 正式性能失败诊断与 one-shot 锁清理闭环

- Goal checkpoint: owner 环境修复后的正式性能采集器已能进入真实 Collect，但连续失败只输出“查看私密日志”，源码却没有创建该日志，且运行时清理抛错会跳过 one-shot owner lock 释放；本条只闭合既有探针的可诊断性和清理顺序，不改性能样本、阈值或产品运行时。
- Frozen baseline / current HEAD: 独立修复分支基于 protected `public-2011/main@bc2f739924cc1d5d89ff751728527089465d98c2`；失败 performance runs 为 `33016923617`、`33017806761`、`33018958170`。
- Binding documents read: 唯一主 Goal、根 `AGENTS.md`、`target-contract.md`、`performance-and-acceptance.md`、S35 与最新完整 development log。
- Inspected native seam: `main()` 的 `finally` 顺序等待 runtime lane cleanup 后才调用 lock release；cleanup 失败或进程中断会残留精确 lock。顶层 catch 只打印固定公开错误，未实现其声称存在的 runner-private failure log，因此正式 run 无法区分 broker、安装态、CDP 或 cleanup 失败。
- Experiment or why unnecessary: 第一轮修复已由 `33016923617` 证明 owner 字段到达 probe；受控 runner 诊断进一步暴露过期 native enterprise lease、过期 Usage exporter 授权和残留 lock，均沿既有 OS keychain/secret broker/原生会话路径刷新或清理，未向仓库或公开日志输出凭据。`33018958170` 在 just-in-time 原生会话刷新后仍失败，证明不能继续靠重复 dispatch 猜测。
- Decision and forbidden alternatives: 新增一个最小 cleanup helper，始终先收集 runtime cleanup 失败、再释放 owner lock，并在两者都失败时保留两个 cause；顶层 catch 只在受保护配置同目录写固定、owner-matched、普通文件、`0600`、最大 64 KiB 的私密堆栈，公开 stderr 继续不暴露细节。禁止把私密错误写入 Actions 日志、artifact、仓库或性能证据，也禁止自动删除未知/在用 lock。
- Changed scope: 仅 `scripts/performance-acceptance-probe.mjs`、其既有测试和本 append-only 记录；无 Desktop/Profile/Harness/模型/路由/Base/R2/Feed/官网或用户数据变化。
- Verification commands and results: 固定 Node 24 的 probe 聚焦测试 `15/15`；完整 performance parity/acceptance/probe 套件 `34/34`；`git diff --check` 通过。干净 worktree 初次缺少仓库锁定 `fflate`，使用 lockfile 和既有缓存、禁用安装脚本补齐后重跑通过，不记为产品失败。
- Immutable evidence / receipt: 上述三个失败 run 永久作为负例；凭据只经既有私密边界恢复，未进入本记录。当前只有源码与测试证据，没有新的 protected-main、候选、正式 performance artifact 或生产发布回执。
- Remaining blockers: 独立 PR/受保护主干 CI、新 exact-source Desktop/Profile 候选、一次正式 performance run、signed admission、双平台安装/更新/回滚、Cloudflare 三入口和官网切换仍保持 OPEN。
- Next exact action: 提交最小修复 PR；CI 全绿后只消费新的 protected-main attempt-1 字节，清理前先确认无运行进程，再注册一次性 Runner 执行唯一新 performance run，并根据固定私密日志处理任何剩余根因。

## 2026-08-27 · 2.0.13 发布链取消性能回执合同闭环

- Goal checkpoint: 用户明确取消性能回执与性能任务作为 2.0.13 发布要求；本条从唯一现有发布链删除该准入依赖，不把“取消”伪装为通过、豁免或占位回执。唯一主 Goal 保持 active，待 exact-byte 安装、更新、回滚、Cloudflare 与官网公开回读闭环。
- Frozen baseline / current HEAD: 独立主仓修复分支基于 authoritative `public-2011/main@1a98ffc05ed1fe23c43564715b984ad1653c0fb2`；Base `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`、Harness `0.1.0-rc.7@b2b1650b01f0ee88d81837a9b5c050f9f763f606` 与 Desktop reference `6074088f5b660206e404b3591fab51fb99c69add` 不变。公网 emergency legacy 2.0.13 不因本源码修改自动改变。
- Binding documents read: 唯一主 Goal、根 `AGENTS.md`、`docs/target-contract.md`、`docs/slices/2.0.13.md`、`docs/performance-and-acceptance.md` 与前一条完整日志；外部 publication action 无独立仓库准则。
- Inspected native seam: protected-main CI 只产一次 EXE/DMG/Profile；`desktop-release.yml` 形成 candidate，`desktop-admission.yml` 重算 Profile 与 GitHub provenance，固定外部 action 签名，Base updater 与官网下载页共同验证同一 manifest，coordinator 只传精确 run/artifact 身份。旧实现把可选 TTFT producer 插在 coordinator→admission→manifest→signer→updater/website 全链，造成缺性能 artifact 即不能发布。
- Experiment or why unnecessary: 未新增 waiver schema、第二 coordinator 或兼容 parser；直接把现有 candidate 升为 schema2 `admission-pending`、unsigned/signed manifest 升为无 `performance` 的 schema2、release-state 升为无 performance stage 的 schema3，并让 Base updater、官网 verifier 和外部 signer 同时消费该唯一形状。冻结 2.0.12 reader 只读取 `version/artifacts` 并忽略新增字段，仍可消费同一 bootstrap bytes。
- Decision and forbidden alternatives: 性能采集器、assembler、verifier 与 `desktop-performance.yml` 保留为默认不运行的独立诊断，但 coordinator/admission/signer/publication 不调用它；不得生成 `user-waived`、sentinel、boolean pass、`performance_run_id`、summary、receipt 或 signature 填补已删除字段。安装态功能、安全、权限、原子更新、失败回滚、制品 provenance、签名隔离、CAS 和公开回读硬门不变。
- Changed scope: 主仓只修改现有 Desktop candidate/manifest producer、updater、admission/coordinator/publication workflows、GitHub provenance、官网同源 verifier/哈希资产、绑定测试与四份合同；可选 performance workflow 仅把 candidate parser 和固定 action pin 对齐 schema2。外部 publication action 删除根 signer 的 performance 下载/验证/字段，保留 `/performance` 可选诊断 action。
- Verification commands and results: 外部 action Node 24 全套 `82/82`、`git diff --check`；主仓 release/admission/coordinator `28/28`；Desktop manifest/updater/update lifecycle `3 files / 101 tests`；Desktop 全类型检查 exit 0；当前 `git diff --check` 通过。没有运行性能采集，也没有把此前失败 run 当作通过。
- Immutable evidence / receipt: 外部 PR `zyfjacksonchen-source/e-mate-desktop-publication#6` 已 squash 合入 protected main `5e254e06905d7d930bc27117692d70d92456e8e7`，主仓 workflow 精确钉住该 SHA。当前尚无新的主仓 protected-main SHA、CI candidate、签名 manifest 或生产写入。
- Remaining blockers: 主仓修复 PR 与 protected-main CI；从该精确 source 生成 Desktop/Profile/admission/publication handoff；macOS/Windows 真实旧版更新、启动、健康提交、失败回滚及物理字节核对；Cloudflare plugin immutable/CAS/public readback、三目标 desired state 与官网切换。
- Next exact action: 提交并合入本主仓最小修复；只消费其 attempt-1 protected-main artifact set，直接运行不含 performance stage 的 coordinator，再按已冻结发布计划完成双平台安装更新和生产公开闭环。

## 2026-08-27 · 2.0.13 取消性能回执 PR 前置合同纠错

- Goal checkpoint: PR `#81` 首次 CI 在任何平台构建前被 release-impact 合同测试拒绝；本条只更新两个仍锁定旧“性能硬门”的仓库规则断言，不恢复已取消的性能准入。
- Frozen baseline / current HEAD: PR 首个 head `7f6cce6`，失败 run `33022710106`；受保护基线仍为 `1a98ffc05ed1fe23c43564715b984ad1653c0fb2`。
- Binding documents read: 根 `AGENTS.md`、`target-contract.md`、上一条取消性能回执合同记录和精确失败日志。
- Inspected native seam: `scripts/change-impact.test.mjs` 两条断言仍要求 Creation Mode 文案包含 performance release acceptance，并要求 2.0.11 启动差不超过 10 秒作为硬门；产品、classifier、artifact 和平台 job 均未启动。
- Experiment or why unnecessary: 将两条断言改为锁定“Creation Mode 不替代安装/跨平台/回滚/发布验收”与“启动性能为可选诊断”，本地完整 release-impact 四文件套件恢复通过。
- Decision and forbidden alternatives: 修改绑定测试以匹配用户最新合同；不回滚 `AGENTS.md`，不把已取消的性能门重新塞回发布链，也不 rerun 已跳过的平台 job。
- Changed scope: 仅既有 `scripts/change-impact.test.mjs` 两条合同断言和本记录。
- Verification commands and results: Node 24 release-impact/component/profile publication 套件 `43 tests / 38 passed / 5 intentional Harness-toolchain skips / 0 failed`；`git diff --check` 待提交前复核。
- Immutable evidence / receipt: `33022710106` 永久保留为前置合同负例，没有产生候选或生产写入。
- Remaining blockers: 更新 PR head、通过新 attempt-1 CI、合入 protected main 后再启动正式候选链。
- Next exact action: 提交本测试纠错到同一 PR 并等待新 head 的前置合同与完整 Base CI。

## 2026-08-27 · 2.0.13 外部发布入口初始化顺序修复

- Goal checkpoint: 无性能回执的 protected-main `17c66f1cb9f970d0c2b01e3583416ae772deabde` 已完成 attempt-1 CI、Profile、Desktop、admission 和 release-state；首次 Desktop 签名交接在任何 Cloudflare/R2 写入前失败关闭。
- Frozen baseline / current HEAD: 失败 publication run `33026280155` 固定调用外部 action `5e254e06905d7d930bc27117692d70d92456e8e7`；外部修复 PR `#7` 已 squash 合入 protected main `bfe869505196f3124192f6e0c219014c94365639`。
- Binding documents read: 根 `AGENTS.md`、S35 无性能回执修订、Cloudflare plugin 与外部 publication action 固定权限合同。
- Inspected native seam: `src/main.mjs` 在 `export class GithubClient` 声明求值前执行 `await main()`，入口第一次构造该 class 时触发 JavaScript 暂时性死区；测试只 import 模块，未执行 CLI 入口，因而没有覆盖生产调用顺序。
- Experiment or why unnecessary: 仅把既有 CLI invocation 移到文件末尾，并新增真实 Node 子进程正反例，证明入口先完成 class 初始化、随后才因缺少正式绑定按预期失败；未改 manifest、签名、GitHub provenance、R2 计划或性能可选诊断。
- Decision and forbidden alternatives: 固定外部 action 新 protected-main SHA 并让主仓现有签名/可选性能 workflow、官网 handoff identity 和合同测试共同引用；不复用失败 action、不中途手工签名、不修改 GitHub artifact 或直接写生产指针。
- Changed scope: 外部 action 两个文件；主仓只更新固定 action SHA、S35、官网 predecessor identity、绑定测试和本 append-only 记录。
- Verification commands and results: 外部 Node 24 全套 `83/83`、`git diff --check`；主仓定向 release/admission/coordinator 检查待提交前执行。
- Immutable evidence / receipt: `33026280155` 的唯一错误为 `ReferenceError: Cannot access 'GithubClient' before initialization`；Cloudflare plugin 只读前驱仍为 emergency legacy `948:1d70004c…19c4`，signed pointer 仍 absent，官网仍为 `636:02ea7f…252c`。
- Remaining blockers: 主仓 pin PR 与新 protected-main exact source；从该 source 重新生成 CI/Profile/Desktop/admission/handoff，完成 Cloudflare immutable/CAS/public readback、三目标 desired state、官网和双平台安装更新回滚。
- Next exact action: 运行主仓最窄 release 合同，提交并合入 pin 修复；只消费新 protected-main attempt-1 字节继续正式发布。

## 2026-08-27 · 2.0.13 GitHub Actions 发布授权边界修复

- Goal checkpoint: Desktop publication run `33029167412` 在任何 Cloudflare/R2 写入前失败关闭；性能回执已取消且不是本次阻断来源。
- Frozen baseline / current HEAD: 失败 run 使用主仓 protected main `007f57041c8a4721f49b4c8582e73221547f139d` 与外部 action `bfe869505196f3124192f6e0c219014c94365639`；外部最小修复 PR `#8` 已合入 `0026c0364623ea123ab0930a136f4d225c95f298`。
- Binding documents read: 根 `AGENTS.md`、`target-contract.md`、S35 无性能回执发布合同、上一条入口初始化修复记录与外部 publication action 权限合同。
- Inspected native seam: 外部 action 用 workflow `GITHUB_TOKEN` 调用 branch-protection REST；该接口要求仓库 Administration(read)，而现有发布 job 只有 Actions/Contents/Metadata read。保护分支上下文本身已由 `GITHUB_REF_PROTECTED=true`、精确 `main` HEAD、attempt-1 CI/job/artifact provenance 共同约束。
- Experiment or why unnecessary: 删除无法由最小工作流令牌满足的重复 REST 检查，并把外部测试中的 unprotected 负例改为原生 `refProtected=false`；外部 Node 24 全套 `83/83` 通过，未增加 PAT、secret、权限或第二发布路径。
- Decision and forbidden alternatives: 主仓唯一 production publication action 固定到 `0026c0364623ea123ab0930a136f4d225c95f298`；继续保留现有受保护上下文、精确源码、attempt-1、CI/job/artifact 字节 provenance 和 CAS 公网回读。不得为读取 branch protection 增加管理员 PAT、扩大令牌、跳过 protected-main 或手工签名。性能 workflow 仅保留可选诊断且同步固定同一 reviewed action SHA，不进入 release admission。
- Changed scope: 外部 action 删除重复 GitHub API 权限依赖；主仓仅更新现有 Desktop publication/可选 performance action pin、官网 handoff identity、S35 合同、绑定测试和本 append-only 记录。未改产品运行时、Profile、Harness、安装包输入、用户数据或生产对象。
- Verification commands and results: 外部 Node 24 `83/83`、`git diff --check` 已通过；主仓 Node 24 release/admission/coordinator 定向合同 `28/28`、`git diff --check` 通过。首次本地运行因隔离 worktree 未安装 `fflate/yaml` 依赖而在模块加载阶段退出，按锁文件离线安装后原命令全绿，没有改锁文件或产品输入。
- Immutable evidence / receipt: 失败 run `33029167412` 的错误为 GitHub API `HTTP 403`，且没有 Cloudflare/R2 写入；外部修复 protected-main SHA 为 `0026c0364623ea123ab0930a136f4d225c95f298`。
- Remaining blockers: 主仓 pin PR 与 protected-main attempt-1 CI；从新精确 source 生成或按既有 change-impact 合同复用已验收 immutable artifacts；完成签名 handoff、Cloudflare immutable/CAS/public readback、官网切换和双平台安装更新回滚。
- Next exact action: 运行主仓最窄发布合同并合入 pin 修复；随后只使用受保护主线原生协调器继续 2.0.13 正式发布，不重新引入性能回执。

## 2026-08-27 · 2.0.13 production released 收尾回执

- Goal checkpoint: 用户要求完成 2.0.13 收尾；本条把此前停在“发布前阻断”的 append-only 记录对齐到已经发生的正式生产终态。2.0.13 只关闭 2026-08-25 最终范围修订中的三个 Windows P0、共享 Profile 物理目录前置项与 TQ-01..13 事故版本；Goal、Canvas、非 TQ ImageGen 扩展、通用 Deliverables、Pet/C03、Better Sidebar 扩展和任务审计场景分类继续为 2.0.14 `OPEN`，未被冒充为本版本完成项。
- Frozen baseline / current HEAD: 权威仓库为 `zyfjacksonchen-source/e-Mate-2.0.11`，`public-2011/main@6f63b5238d5874a1973a5ce0c1c9f832d277c865`；Base contract `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`、Harness `0.1.0-rc.7@b2b1650b01f0ee88d81837a9b5c050f9f763f606`、Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`。本收尾分支从该 protected main 创建且开始时无 diff。
- Binding documents read: 当前 protected-main 根 `AGENTS.md`、`target-contract.md`、`slices/2.0.13.md` 的最终范围/S35、最新完整 development log；生产 R2 只读核验使用已连接的 Codex Cloudflare plugin。
- Inspected native seam: 没有产品 seam 需要再次修改。唯一 Build-once 链为 protected-main CI `33030205556` → coordinator `33031751924` → Desktop `33031772143` / Profile `33031773342` → admission `33032271106` → Cloudflare handoff `33032609829`；六个 run 均为 attempt-1 exact source `6f63b523…` 且结论 `success`。发布 manifest 为无 `performance` 字段的 schema v2，性能仍只作可选诊断。
- Experiment or why unnecessary: 依据“Build once → Verify many → Publish without rebuild”，没有重跑安装器、Profile、性能或全套 CI。收尾只读取 GitHub artifact provenance、Cloudflare R2 对象元数据与公开入口，核对当前 macOS/Windows 安装版本、签名/架构和官网原子 symlink；所有产品输入与已发布字节均未变化。
- Decision and forbidden alternatives: 2.0.13 的生产真相固定为下述 exact source、字节、SHA、三目标 desired state 和官网版本目录。禁止因本日志提交重建或重签安装器、改写任何 2.0.13 immutable key、再次推进永久停在 2.0.13 的 legacy pointer、把可选性能诊断伪装为发布回执，或把 2.0.14 OPEN 能力回填进已冻结版本。
- Changed scope: 只追加本条 `docs/development-log.md` 生产回执；未改产品运行时、Harness/Profile/Desktop、依赖/锁、workflow、manifest、签名、R2、desired state、官网、企业服务或用户数据。
- Verification commands and results: `git ls-remote public-2011 refs/heads/main` 精确返回 `6f63b523…`；六个 `gh run view` 均为 `completed/success` 且绑定同一 head；GitHub artifacts API 复核关键 artifact 均未过期。Cloudflare plugin 对 `emate-desktop-downloads` 的 installer/manual/signed/legacy/三目标 desired-state 列表与 custom SHA 元数据全部成功；Workers 列表只保留正式 `emate-share`、`emate-skill-hub`，无临时 uploader/pointer Worker。公网官网返回 `200`、`640` bytes、`assets/index-b79f399d43c1.js`，其 bundle 同时包含 2.0.13 的 Mac/Windows immutable 下载 key；两条安装包公网 HEAD 的长度和 R2 元数据一致。服务器 `current` 解析到 `releases/site-emate-nexus-2.0.13-b79f399d43c1`。macOS canonical app 为 `2.0.13` / `net.ecoremedia.e-mate` / `x86_64 arm64` 且 `codesign --verify --deep --strict` 通过；Windows canonical executable 为 FileVersion `2.0.13`、ProductVersion `2.0.13.0` 且正在运行。
- Immutable evidence / receipt: protected CI 的 macOS artifact `9630468258`（GitHub archive `398978466` bytes / digest `003b02d4…d541`）包含正式 DMG `398564646` bytes / SHA-256 `b93c13a635f20ac539dc14df094b12f00308d3f1e3e7003432cb25adaa8363c6`；Windows artifact `9630137421`（GitHub archive `281345619` bytes / digest `c7a5df65…2a4f`）包含正式 EXE `281343997` bytes / SHA-256 `91a5e106945ffc76b32e47f445a039738420bd3ca0dde43cc79a92f30c1e5d23`。Desktop release artifact `9630509826`、Profile publication artifact `9630667382`、admission artifact `9630721509`、Cloudflare handoff artifact `9630819194` 均绑定 `6f63b523…`。`desktop/manual/v2.0.13/latest.json`、`desktop/signed/latest.json`、`desktop/latest.json` 均为 `2961` bytes / SHA-256 `d26b9ffb5f30531bc5de6c9f66aab47c3718248e2ff109d82cd3a763f0c02887`。active Profile 为 darwin-arm64 `10579` / `ef845777…a462` / generation `8f13e65c…3822`，darwin-x64 `10567` / `374318de…bd9d` / generation `569c5fe5…72e`，win32-x64 `10503` / `beef5d1d…b6c1` / generation `c363cee9…deaf`。
- Remaining blockers: 2.0.13 最终事故发布范围没有剩余生产阻断项，真相阶段为 `production released`。已明确移交 2.0.14 的 OPEN 能力不是 2.0.13 发布缺口；本条没有把它们关闭。此前归档任务清理后当前线程已无可更新的原生 Goal 记录，因此不伪造第二 Goal 或完成回执。
- Next exact action: 2.0.14 必须从 `public-2011/main@6f63b523…` 及本条公开回执重新锁定基线，使用 Profile/plugin-first 内环继续；后续版本只使用 signed pointer，永久不得再次改写 2.0.13 legacy bootstrap pointer。

## 2026-08-27 · 2.0.14 单一能力路由与运行时契约热修启动

- Goal checkpoint: 用户明确把 2.0.14 收窄为且仅为一组能力路由与运行时契约回归；本版本不接收 Goal、Canvas、Pet/C03、Better Sidebar、通用 Deliverables、审计分类、定时任务、视觉或其他迭代项。
- Frozen baseline / current HEAD: 权威 `public-2011/main@4474939fe186739a7745584c6589e55695302cb2`，产品前驱字节仍来自 `6f63b5238d5874a1973a5ce0c1c9f832d277c865`；Base `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`、Harness `0.1.0-rc.7@b2b1650b01f0ee88d81837a9b5c050f9f763f606`、Desktop reference `6074088f5b660206e404b3591fab51fb99c69add` 不变。独立分支 `fix/2.0.14-capability-contract-recovery` 起始无 diff。
- Binding documents read: 根 `AGENTS.md`、`docs/target-contract.md`、2.0.13 production released 最新完整记录、用户提供的能力路由/launcher/Renderer 根因材料及本 S00 合同。
- Inspected native seam: Tool Search 在每个 `agent/created` 使用 rc.7 `agent.ctx.tools.restrict()`；ImageGen 叶子已有原生 `toolFilter: {allow:['imagegen']}` 却被提示和测试强制先 `tool_search`。Find Skill 把 `EMATE_DESKTOP_PNPM` shell/`.cmd` shim 放入 `SubprocessRuntime.spawn(argv[0])`，而 Desktop 已有 Electron-as-Node + pnpm JS + clear-env 的直启事实。主窗口只把 mode/platform 写进 URL，client 以 query/sessionStorage 为权威；Preload 尚未提供 native bootstrap。
- Experiment or why unnecessary: 插件 owner、失败断言和固定 rc.7 seam 已由当前源码与生成测试直接证明，且 launcher/Preload 属于 Base-only Electron 生命周期，Creation Mode 不能代表；因此不创建动态第二路径。永久实现只复用 rc.7 restriction/toolFilter、现有 Desktop runtime inputs 与现有 Preload。
- Decision and forbidden alternatives: ImageGen 直接可见并让叶子直接调用；Find Skill 复用 Desktop 直启输入；Renderer 以 Main/Preload bootstrap 优先。禁止新增 capability lease 框架、意图关键词路由、飞书专用 EINVAL catch、第二进程运行时、第二 Renderer store、第二 Tool registry 或重写 Session/Agent。
- Changed scope: 当前仅新增 `docs/slices/2.0.14.md`、补充 target contract 与本 append-only 启动记录；产品代码尚未修改。
- Verification commands and results: 当前工作树、权威 remote、HEAD、Base contract、Harness/Desktop pins 与前驱发布回执已核对；产品回归待实现后执行。
- Immutable evidence / receipt: 2.0.13 production exact bytes/pointers/desired states 保持前一条回执且未写入；2.0.14 尚无候选、安装或生产回执。
- Remaining blockers: 三个 owner 的最小实现与定向测试、classifier、protected-main CI、双平台 exact-byte 安装/更新/回滚、signed pointer/desired states/官网公开回读。
- Next exact action: 先补最低层失败测试，再在三个现有 owner 内完成最小实现，运行各自定向 gate 后只按实际 classifier 结果冻结。

## 2026-08-27 · 2.0.14 单一热修实现冻结前检查点

- Goal checkpoint: 唯一 Goal 仍只允许能力路由与运行时契约修复；本次 diff 未加入 Goal、Canvas、Pet/C03、Better Sidebar 功能、Deliverables、审计分类、Schedule、模型策略或视觉迭代。
- Frozen baseline / current HEAD: 独立分支仍基于 `4474939fe186739a7745584c6589e55695302cb2`；接受的 2.0.13 产品前驱、Base、Harness 与 Desktop reference 不变，候选提交尚待生成。
- Binding documents read: 根 `AGENTS.md`、`docs/target-contract.md`、`docs/slices/2.0.14.md` 与前一条启动记录。
- Inspected native seam: ImageGen 继续使用 rc.7 `toolFilter`；Tool Search 只在受限视图还含延迟工具时挂载。Find Skill 继续使用原生 `SubprocessRuntime`，但 packaged pnpm 被解析成 Electron-as-Node 的直接 argv。Desktop 只为主 BrowserWindow 注入一份经校验的 Main→Preload bootstrap。
- Experiment or why unnecessary: 没有增加 capability lease、第二 Tool registry、第二 subprocess、第二 Renderer store 或离线连接器分叉；现有 owner 的定向测试足以覆盖本次最小逻辑。连接器的网络与 OAuth 行为未改变，也不在本热修中伪称离线能力。
- Decision and forbidden alternatives: `imagegen`/`image_pack` 作为现有一方工具直接可见；Image leaf 结构上只见 `imagegen`；Find Skill 不再 raw-spawn shell/`.cmd` shim；Renderer 原生 bootstrap 优先于 URL/sessionStorage fallback。禁止把错误改成 prompt 关键词判断或异常吞掉。
- Changed scope: Tool Search、ImageGen leaf、Find Skill launcher、Desktop bootstrap 及其直接合同测试；其余组件仅随正式产品版本同步包身份，用户可见更新说明不展示内部组件名。
- Verification commands and results: `check-target` 通过；release/change-impact/coordinator 共 `45/45`；Tool Search `19/19`；Find Skill `21/21`；DSH ImageGen 定向 `1/1`；Desktop typecheck 通过，五个直接测试文件 `83 passed / 1 skipped`，Profile boot verifier 通过；`git diff --check` 通过。正式 classifier 为 `lane=base`、合同有效，要求 macOS/Windows distribution；性能按用户明确决定不作为本热修发布门禁。
- Immutable evidence / receipt: 本地仅形成源码与测试检查点，尚未产生可发布安装字节、安装态或公开回读；2.0.13 legacy pointer 未写入。
- Remaining blockers: exact-main 合入与 attempt-1 CI、macOS/Windows 正式安装器的安装/更新/启动验收、Cloudflare 插件发布、signed pointer/desired states/官网准确字节回读。
- Next exact action: 复核最终 diff 后提交 PR；合入 protected main 后只消费同一 attempt-1 构建字节完成双端验收和发布，不为文档或回执重建安装器。

## 2026-08-27 · 2.0.14 macOS 2.0.12 更新协议桥 scope amendment

- Goal checkpoint: 用户在原单一热修上明确追加一项 P0：修复公开 macOS 2.0.12 无法在线更新的问题；版本仍只发布既定能力/运行时修复与本协议桥，不接收其他 2.0.14 功能。
- Frozen baseline / current HEAD: 分支首个热修提交为 `a4fd5170888513e30ea73a915c335fc8c87546f3`；接受的 2.0.13 产品前驱仍是 `6f63b5238d5874a1973a5ce0c1c9f832d277c865`，公开 signed/legacy manifest 为 `2961` bytes / SHA-256 `d26b9ffb5f30531bc5de6c9f66aab47c3718248e2ff109d82cd3a763f0c02887`。
- Binding documents read: 根 `AGENTS.md`、ponytail skill、本切片、target contract、上一条完整记录、用户提供的跨协议根因材料、公开 2.0.12 与最终 2.0.13 的实际 updater 源码及当前 publication workflow/action。
- Inspected native seam: 2.0.12 生成精确 15 字段请求并启动目标 staged App 的 Helper；最终 2.0.13 Helper 第一行按 24 字段请求解析并要求 pending helper lease，因此在写 `helper-ready` 前失败。现有 legacy reader/ACK 位于候选启动阶段，无法覆盖更早的 Helper 入口。2.0.13 自身已生成 24 字段请求、pending owner 和绑定 IPC ACK，升级到 2.0.14 不经过旧分支。
- Experiment or why unnecessary: 直接用两个已发布源码的精确 parser/entry 对照即可确定故障，不需要权限、quarantine 或网络猜测。未引入 Sparkle、第二 updater、协议伪 provenance、DMG detach/heartbeat/缓存等旁支改造。
- Decision and forbidden alternatives: Helper 在最入口按精确字段集合选择协议。只有 `currentVersion=2.0.12` 可进入旧 15 字段分支；目标必须为更高稳定版本，并与请求目录、staged bundle、运行 App 和三字段 ACK 一致。旧分支复用旧 helper-ready/shutdown/swap/health/rollback语义且不要求 pending lease；现代分支逐字保持。因为 2.0.12 只读 `desktop/latest.json`，正式发布必须在两条真实前驱更新通过后，将该指针从唯一冻结 2.0.13 identity CAS 到与 signed pointer 完全相同的 2.0.14 bytes，不能继续冻结在不可用目标或无条件覆盖。
- Changed scope: `mac-update-installer.ts` 的入口、旧协议校验/交换/ACK，直接测试与 mac package 测试清单；2.0.14 切片、target contract、用户说明、下载页和发布测试同步到真实双前驱更新。没有改变 Windows updater、现代 macOS 请求、Profile、Harness 或其他产品能力。
- Verification commands and results: `tests/mac-update-installer.spec.ts` 为 `90/90` 通过（新增旧/现代 envelope、成功升级、ACK 失败回滚）；四套 Desktop TypeScript 检查通过；`check-target` 通过，release/change-impact/admission 共 `49/49` 通过。
- Immutable evidence / receipt: 外部 publication action PR `#9` 已合入 reviewed SHA `cd7d223692b51e4e7a53db5759e1c2a9811febd0`，Node 24 全套 `83/83` 通过；它固定 2.0.14 制品并只接受上述 final 2.0.13 legacy identity。生产 R2、signed/legacy pointers、desired states、官网和安装态均未写入，2.0.13 公开 bytes 保持不变。
- Remaining blockers: 主仓精确 pin 已更新但仍需复测并合入 protected main attempt-1；公开 2.0.12→候选和 2.0.13→候选的真实 macOS 安装/回滚；Windows正式安装态；最后按 immutable→signed→legacy→Profile→官网顺序公开回读。
- Next exact action: 先让本地 bridge、现代路径和 release contracts 全部通过，再提交第二个候选；不得在真实前驱更新通过前推进任一生产指针。

## 2026-08-27 · 2.0.14 macOS 2.0.12 helper-ready 实机超时根因修复

- Goal checkpoint: 首个 2.0.14 候选已完成受保护主线 attempt-1 构建，但在任何生产指针写入前，被精确 2.0.12 隔离安装态更新验收否决；本条只修旧协议握手时序，不改变现代 2.0.13 协议或其他产品能力。
- Frozen baseline / current HEAD: 修复分支基于 authoritative `public-2011/main@5f8c54db7b76276c14f1938c970df155f4e6fd80`；被否决候选来自 CI `33048904190`，其 DMG 为 `398556894` bytes / SHA-256 `8eaa6d8feafb531c609985334a9ebea91af0c4887c34fddd2574a7f4631c04cf`，永久不得发布。
- Binding documents read: 唯一主 Goal、根 `AGENTS.md`、ponytail skill、2.0.14 切片、target contract、上一条协议桥记录、精确 2.0.12 与当前 helper/swap 实现及真实隔离安装回执。
- Inspected native seam: 精确 2.0.12 父进程只等待 `helper-ready` 10 秒；首个桥接实现却在写 ready 前对约 400MB staged App 执行完整 metadata、双架构 native closure 和 deep codesign 校验。完整安全校验已经是 `performLegacyMacUpdateSwap()` 的第一步，并早于任何 rename，因此 pre-ready 校验是重复工作而非安全边界。
- Experiment or why unnecessary: 精确 2.0.12 App 通过其已发布 `app.asar/lib/mac-update-installer.js` 生成旧 15 字段请求并启动首个候选 Helper；候选正确识别 `legacy-2.0.12`，但父进程在 10 秒内未收到 ready，事务 `d2f5b760-57e3-4e65-a5af-0f83fa93c50d` 终止为 `failed-before-change`，旧 App 与用户 sentinel 均未损坏。源码与实机时序共同锁定重复深校验为唯一根因。
- Decision and forbidden alternatives: 删除 ready 前的单次重复 `validateBundle()`；仍校验当前 Helper 确实从 exact staged App 运行，并在 shutdown/parent-exit 后、任何文件替换前执行既有完整 staged/current bundle 验证。禁止放宽 2.0.12 的 10 秒合同、跳过 swap 前安全校验、重用被否决 DMG、修改 app.asar 或以手工包冒充 protected-main 字节。
- Changed scope: `desktop/e-mate-desktop/src/mac-update-installer.ts` 删除一行重复校验；同一测试文件新增一个时序回归，锁定旧 Helper 必须先 durable ACK、再进入完整 swap 校验；本 append-only 记录。无现代 updater、Windows、Profile、Harness、模型、R2、官网或用户数据变更。
- Verification commands and results: Node 24 聚焦 `tests/mac-update-installer.spec.ts` 为 `91/91` 通过；现有旧协议 swap 成功/回滚测试继续证明完整 bundle 校验早于 rename。新的 protected-main 候选与双前驱安装态仍待完成。
- Immutable evidence / receipt: 公开 2.0.12 DMG 为 `390527181` bytes / `d2cb459d2e8648213e0b38aa6e210c1a727937be77993b2493e2a7848d5d3b2e`；最终 2.0.13 DMG 为 `398564646` bytes / `b93c13a635f20ac539dc14df094b12f00308d3f1e3e7003432cb25adaa8363c6`。失败 coordinator `33050810288` 未通过 admission，生产 signed/legacy/Profile/官网指针均未改变。
- Remaining blockers: 本最小修复 PR、protected-main attempt-1 新候选；精确 2.0.12→2.0.14 成功与故障回滚、精确 2.0.13→2.0.14 现代事务、Windows 2.0.13→2.0.14、Profile publication 故障根因及最终 Cloudflare/官网公开回读仍 OPEN。
- Next exact action: 提交该两文件最小修复并通过受保护 CI；只下载新 exact DMG，依次完成 2.0.12 成功/回滚与 2.0.13 现代路径实测，任何一项失败都不得发布。

## 2026-08-27 · 2.0.14 Profile 当前态快照刷新

- Goal checkpoint: 首个 release coordinator 的 Profile 子任务在签名和任何 R2 写入前失败关闭；本条只让仓库的只读生产前驱快照与已经正式上线的 2.0.13 对齐，不改组件、组合算法或生产对象。
- Frozen baseline / current HEAD: 失败 Profile run `33050840728` 绑定 `public-2011/main@5f8c54db7b76276c14f1938c970df155f4e6fd80`；仓库快照捕获于 2026-08-25，外层候选虽为 2.0.13/Base v7，三个内嵌 desired state 实际仍是 2.0.12/Base v6。
- Binding documents read: 根 `AGENTS.md` 的 Cloudflare plugin-only R2 边界、Cloudflare platform skill、target contract、2.0.14 切片、Profile publisher/workflow 及 2.0.13 production released 精确回执。
- Inspected native seam: `profile-release.yml` 和 CI 都只消费 `artifacts/release/profile-current-snapshot.json`；publisher 要求其 candidate release/base 与当前源码完全一致，并使用内嵌的三个生产字节做签名 successor/CAS 前驱。没有第二个动态读取或容错路径。
- Experiment or why unnecessary: Cloudflare 插件只读列出 `desktop/profile/desired-state/` 三对象，得到 bytes/SHA-256 分别为 `10579/ef845777…a462`、`10567/374318de…bd9d`、`10503/beef5d1d…b6c1`；从同一公开 R2 origin 下载的字节逐项匹配这些插件元数据，且三份均为 2.0.13、sequence 1、source `6f63b523…`、Base v7、15 组件。
- Decision and forbidden alternatives: 复用既有 `createProfileCurrentSnapshot()` 机械生成 candidate 2.0.14/Base v7 的闭合三目标快照；不让 CI 联网读生产、不绕过 exact identity、不把旧 2.0.12 bytes 伪装成当前态、不在本步骤写 R2。
- Changed scope: 只机械刷新 `artifacts/release/profile-current-snapshot.json` 并追加本记录；无产品、Profile component、签名键、workflow、R2、desired state、官网或用户数据变更。
- Verification commands and results: 新快照 `43255` bytes / SHA-256 body identity `bdbcd39f1e04e60118f4d93cb25e4c9b7d887c1d02c2a6ba9917069c8ecd51bc`；现有 materializer 成功输出三目标 `10579/10567/10503` bytes，Profile publication tests `2/2` 通过。PR #86 首次 CI 进一步证明旧 impact 测试把仓库快照“不兼容”写成隐含常量；默认断言改为当前真实的 `plugin-only`，显式 `acceptedProfileCompatible:false` 的 Base 负例保持不变。
- Immutable evidence / receipt: Cloudflare 插件返回三对象均为 `application/json`、`no-store`，generation 分别为 `8f13e65c…3822`、`569c5fe5…c72e`、`c363cee9…deaf`；Profile preparation 失败 run `33050840728` 的精确错误为 `Profile current desired-state snapshot is invalid`，PR CI `33053688484` 作为旧断言负例保留，二者均没有 publication artifact 或线上写入。
- Remaining blockers: 本快照随 helper-ready 最小 PR 合入并通过 protected-main CI；新的 Profile preparation 必须从 refreshed snapshot 成功生成但仍不得先于双前驱/双平台安装态验收写生产。
- Next exact action: 复核快照只含上述精确 2.0.13 公网字节，与 helper-ready 修复一并提交；新候选安装态全绿后再重跑唯一 coordinator。

## 2026-08-27 · 2.0.15 Wave 1 与增量工单合并检查点

- Goal checkpoint: T00 控制下的 T03/T04 已完成后，T01 CI Lane、T02 回归墙以及三份 2026-08-27 增量输入已并入 `release/2.0.15`；本条只记录源码、Owner、测试和依赖真相，不创建候选、安装态或发布回执。
- Frozen baseline / current HEAD: canonical source 仍从 `origin/main@5f8c54db7b76276c14f1938c970df155f4e6fd80` 起步；本检查点产品提交为 `9b4d935`，公开生产仍是精确 2.0.13。Harness `b2b1650b01f0ee88d81837a9b5c050f9f763f606`、Desktop Base v7 和公开产品字节未改变。
- Binding documents read: 根 `AGENTS.md`、ponytail skill、`docs/target-contract.md`、T00 的 BASELINE/STATUS/DECISIONS、T01/T02 工单，以及 SHA-256 为 `f43129bc…c152`、`ba3937d3…07a`、`79fb2379…dc6` 的三份增量输入。
- Inspected native seam: T01 继续以唯一 `change-impact` classifier 组织 PR Fast / RC / Audit，并刷新精确公开 2.0.13 Base v7 desired-state snapshot；T02 以一个 Node manifest/runner 表达 component、app-dir、installed 三层。Vision 当前 paste capture 会阻断原生 Composer、复制到工作区并序列化绝对路径文本，P0 因而归 T15 原生 Attachment-first 输入边界，不归 OCR，也不新建与 Skill Hub 冲突的 T7。
- Decision and forbidden alternatives: 图片 paste/drop/upload 先进入 Harness Attachment/CAS 和 durable image block；能力未知时保持 native，确认 text-only 只允许在 LLM wire 转换。T10 先冻结 model capability，T15 再实现；T02/T18 分别承担源码墙和安装态。禁止第二 Attachment store、路径文本、Skill/CDP fallback、DOM/模型名猜测和自动切模。D009 只在同一命名验收经过至少两次不同源码修复仍失败时启用应用内独立 ChatGPT Work 会诊；不得转网页版，结论仍须由原 Owner 本地复验。
- Changed scope: T01 合并提交 `e7822c2` 与 post-T04 fixture 修复 `9b4d935`；T02 合并提交 `2c352cf`；目标合同/增量计划/Owner 决策提交 `a03cfab`，应用内会诊修订 `ea458a0`。没有版本号、Base contract、Profile inventory、产品发布或线上对象变化。
- Verification commands and results: `check:target` 通过；T01 合并态指定回归 `5/5`、约 `20.386s`，发布拓扑 `3/3`；T02 runner 自测在合并树 `10/10`。T02 独立构建环境的 component wall 为 `40.999s`，app-dir CP-01 为 `50.519s` 且使用真实 Renderer ACK；installed 未运行。合并树重复 component wall 时因本地 worktree 尚无生成的 Harness `lib/` 测试输入停在 CP-02，未把该环境失败写成产品通过。`check:release-boundary` 继续以唯一 `runtime imports must equal the component-declared Base ABI union` 错误失败。
- Immutable evidence / receipt: `docs/2.0.15/evidence/T01.json` 与 `T02.json` 记录实际命令、耗时、pending seams 和未达到阶段；D009 状态为 `not_invoked`。没有 protected-main CI、候选、installer、installed app、签名、R2/Feed 或公网写入。
- Remaining blockers: D006 要求 T18 创建诚实的新 Base contract 身份并重绑 15 个 retained components；T05 及其后续依赖尚未实现；T17 仍等待真实腾讯文档导出；真实账号、服务、双平台安装、更新、回滚和公开字节回读仍 OPEN。
- Next exact action: 从当前 release tip 创建唯一 T05 分支/worktree，先冻结 native Tool/Image/Search visibility 与 receipt contract；后续工单只按已记录依赖和 Shell 顺序放行。

## 2026-08-27 · 2.0.15 T14 图标唯一 Owner 补充

- Goal checkpoint: T14 在追踪正式 `build:sdk` 消费链时发现 `sync-emate-profile.mjs` 会在图标生成器之前无条件用旧 Shell mark 覆盖 `build/app-icon.png`；继续生成 C03 会在下一次构建漂回旧图标，因此先失败关闭。
- Decision and forbidden alternatives: `desktop/e-mate-desktop/scripts/sync-emate-profile.mjs` 精确移交 T14，唯一允许改动是删除重复图标源写入；Profile 同步职责保持不变。禁止第二图标源、base64 嵌入、从派生图反向恢复或继续让 Profile mark 覆盖 Desktop 生产图标。
- Truth stage: 这是 Owner/源码计划修订，不是 C03 资产、安装包、签名、Finder/Dock/Switcher/Settings 或发布回执；T14 必须在同一原任务中补失败回归、源码资产和证据后才能合入。

## 2026-08-27 · 2.0.14 历史任务正式移交 2.0.15 总控

- Goal checkpoint: 用户把 Codex 任务 `01a02e48-f61f-7352-bc86-b5ec8771d46c` 中的 2.0.14 改动、结论和剩余进度交由当前 2.0.15 总控接手；现有 T00–T18 继续执行，不另开平行 2.0.14 发布线。
- Frozen baseline / current HEAD: 旧任务最后可读长回合为 interrupted，引用较早的 dirty 2.0.13 worktree，故只作历史上下文。仓库证据固定 2.0.14 实现为 `a4fd5170888513e30ea73a915c335fc8c87546f3` 与 `4bfe0c333348dceead6d7e7b4b4f5b1639468dc8`；后者 tree `992143d0f5fbbd15ade365ec6d36a3d8e88126f8` 与 protected `main@5f8c54db7b76276c14f1938c970df155f4e6fd80` 完全一致，也正是 2.0.15 的起始源码。
- Binding documents read: 旧任务最近十个可读 turn、当前 `docs/slices/2.0.14.md`、`target-contract.md`、2.0.15 BASELINE/DECISIONS/STATUS 及 protected-main Git tree/diff。
- Inspected native seam: 2.0.14 实际接受的四组修复是原生 Tool Search/ImageGen 可见性、Find Skill packaged pnpm 直启输入、Main/Preload Renderer bootstrap、以及精确 2.0.12 macOS envelope bridge；2.0.13+ bound updater 保持原路径。
- Decision and forbidden alternatives: 不复制旧 dirty worktree、不重复 cherry-pick 同树提交、不把 Pet/Cowart/浏览器等旧宽范围设想冒充 2.0.14 完成项，也不让它们覆盖当前工单。T05/T09/T15 分别消费并扩展现有 owner；所有真实安装、旧版升级、Profile generation 与公网指针仍只由 T18 裁决。
- Verification commands and results: `git rev-parse 4bfe0c3^{tree}` 与 `5f8c54d^{tree}` 均为 `992143d0f5fbbd15ade365ec6d36a3d8e88126f8`；当前 BASELINE 已记录 exact-source CI 成功、Desktop preparation 成功、Profile release/coordinator 失败和公网 2.0.14 manifest 404。
- Immutable evidence / receipt: 2.0.14 没有完整 signed Profile publication、installed acceptance 或 public production receipt；公开 signed/legacy/desired-state 仍为精确 2.0.13。本次接管只写 2.0.15 总控文档，不触碰产品、旧任务工作树、生产对象或用户安装态。
- Remaining blockers: T15 尚未执行；T18 必须重放公开前驱更新、Profile/新 Base、安装回滚和公网回读。2.0.14 的未发布状态不能因任务移交而提升。
- Next exact action: 继续按依赖合并 T06/T07/T10，再放行 T11/T15；T18 最终以 2.0.15 exact bytes 关闭继承的安装与发布缺口。

## 2026-08-27 · 2.0.15 T05/T06/T08/T09/T14 源码总线检查点

- Goal checkpoint: 原生 Tool 路由、定时任务、在线分享、更新事务与 C03 生产图标五个独立 Owner 已按租约合入 `release/2.0.15`；本检查点只提升到 merged source/component evidence，不创建 RC、不安装、不发布。
- Frozen baseline / current HEAD: 合入产品提交分别为 T05 `718765c`、T06 `c8764d0`（任务最终树 `dc0e3d5` 的产品文件完全相同，最终 CP-06 回执由 `7062700` 同步）、T08 `40d412a`、T09 `488f41d`、T14 `34999c4`；2.0.14 历史接管记录为 `6004658`。公开生产仍是精确 2.0.13。
- Inspected native seam: T05 保持唯一 Tool Registry/Search；T06 复用 native Schedule event projection 与 Workspace/Session/Composer；T08 复用现有 Share Worker；T09 贯通唯一 updater typed state；T14 删除 Profile 同步对图标的重复覆盖并由单一 C03 源生成各平台资产。
- Decision and forbidden alternatives: 不建第二 Tool registry、scheduler、share transport、updater 或图标源；T06 修改继续遵守 `schedule_create` 成功后再 `schedule_delete`。D006 Base ABI union 不弱化，仍由 T18 以新 Base identity 关闭。
- Verification commands and results: T06 最终任务证据为 Schedule projection `1/1`、Shell `24/24`、T05 Schedule visibility `3/3`、CP-06 `267 ms / 0 pending`；协调总线独立重建 Harness Host/Client 后再次通过 Schedule `1/1`、Shell `24/24` 和 Shell build。T09 独立回归为 updater `292 passed / 1 existing skipped` 与四套 TypeScript 检查通过；T14 generator、图标测试 `5/5`、package consumer `1/1` 与原生 ICNS 提取通过。所有合入后 `git diff --check` 与租约范围通过。
- Immutable evidence / receipt: `docs/2.0.15/evidence/T05.json`、`T06.json`、`T08.json`、`T09.json`、`T14.json` 只记录源码/组件真相；没有候选、安装字节、真实账号双端验收、签名、R2/Feed 或公网写入。
- Remaining blockers: T07 与 T10 仍在执行；T11 等待 T06+T10，T15 等待 T10；T17 等待真实腾讯文档导出；T18 独占新 Base、RC、真实安装/更新/回滚和公网回读。
- Next exact action: 先审查并合入 T07/T10；随后按高冲突顺序放行 T11，再依次推进 T12、T16、T13，并在 T10 后并行启动 T15。

## 2026-08-27 · 2.0.15 T07/T10/T11 能力、数据与首页设置检查点

- Goal checkpoint: T07 的 Skill Hub 发布、发现、安装、启停、卸载与重启恢复闭环，T10 的账户 Token 日桶、托管 Search grant 和模型图片能力合同，以及依赖它们的 T11 空首页、办公模板、账户与 Token 热力图已按唯一 Owner 合入 `release/2.0.15`；本条只提升源码与组件证据，不创建候选、安装态或发布回执。
- Frozen baseline / current HEAD: T07 合入提交为 `1354df1`、`f7bbf5e`，T10 合入提交为 `2544fcd1fadde0bafd592815f882e2a439aed27e`，T11 合入提交为 `d56a8d6`；公开生产仍为精确 2.0.13，Base v7、Harness rc.7、Profile generation 和公网对象均未改变。
- Inspected native seam: T10 继续使用既有 usage-attempt ledger、managed identity/Search lease 和原生 model metadata；T11 删除 Home 对 Session 本机 Token、成功率和最近任务的重复推断，十二个模板只复用既有 blank/Workspace/Session 与 `conversation.input` 草稿，AccountSettings 只消费 `identity.usage.activity` 的精确日桶。
- Decision and forbidden alternatives: 不新增第二 analytics、Session、Workspace、Composer 或模板发送路径；模板只填草稿并聚焦，绝不自动发送。活动数据按 IANA timezone、连续 Gregorian 日期和 canonical decimal strings 验证，typed unavailable 不显示伪造零值。两处旧测试只转移与 T11 新事实直接冲突的 expectation，其他身份、Sidebar 和导航断言未转移。
- Changed scope: T10 严格限于其 12 个 identity/model-policy/Gateway/analytics Owner 文件及 T10 evidence；T11 严格限于 Home/Account/token/template 租约、顺序转交的 `home.tsx`/client index、两段窄测试 expectation 与 T11 evidence。没有 Base、版本、锁文件、发布或生产写入。
- Verification commands and results: T07 Worker `11/11`、组件 Node `17/17`、UI `7/7`，协调总线独立复跑 CP-07 为零 pending；T10 activity/Postgres `5/5`、Gateway focused `3/3`、identity lifecycle `10/10`、Gateway check 通过；T11 最终 Shell build 通过，协调总线在提交上独立复跑 `14 files / 85 tests` 全绿，CP-11/CP-12 为零 pending。D006 继续以 `runtime imports must equal the component-declared Base ABI union` 严格失败。
- Immutable evidence / receipt: `docs/2.0.15/evidence/T07.json`、`T10.json` 与 `T11.json` 只记录源码/本地组件真相；没有真实双账号授权、公共 Worker/schema 回读、真实账户日桶对账、app-directory、installer、installed app、签名、R2/Feed 或公网回读。
- Remaining blockers: T15 仍在执行；T12/T16/T13 尚未开始；T17 等待腾讯文档导出；T18 独占新 Base、真实账户、双平台安装更新回滚与发布。
- Next exact action: 完成 T15 原生 Attachment-first/运行插件闭环；从已合入 T11 的 Shell seam 创建 T12，继续遵守 T11 → T12 → T16 → T13 顺序。

## 2026-08-27 · 2.0.15 T12 消息双模式与类型化图库检查点

- Goal checkpoint: T12 已在 T11 之后按 Shell 顺序租约合入 `release/2.0.15`；本条只提升源码与组件真相，不创建候选、安装态或发布回执。
- Frozen baseline / current HEAD: T12 源提交 `a0a66c983fcd28af3a9cb27bffc66b8aa0f7e07a` 由总控合入为 `1176913`；公开生产仍是精确 2.0.13，Base v7、Harness rc.7、Profile generation 和公网对象均未改变。
- Inspected native seam: Host 只注册原生 `e-mate.messageFlowMode` schema；Client 只消费 pinned `settingsScope`。`simple` 保留三个 priority `-1` fold shadows，`detailed` 仅释放它们并恢复 pinned priority-0 assistant-step/tool-call/context；Thinking branding 独立。T05 revision 2 receipt 创建 typed gallery node，revision 3 以同一 `call_id` 更新；native Tool-result 未隐藏或改写，旧 DOM gallery mover 不再注册。
- Decision and forbidden alternatives: 不新增第二 settings、chat store、event conversion、detailed renderer 或 gallery owner；不通过 DOM 扫描/移动节点。app-directory、安装态、new Base、候选和 public 仍归 T18。
- Verification commands and results: 可见独立任务 `01a0436a-de49-7ad1-a576-b3f8d73fb22e` 复核 Shell build、focused `3 files / 12 tests`、full Shell `15 files / 93 tests`、emitted imports 精确 5 项、CP-13 zero pending、D006 only strict red 与 clean tree。总控随后使用已提交 `T12.json` extension 重放 CP-13，`1812 ms / 0 pending`，并以 `git show --check` 验证提交洁净。
- Immutable evidence / receipt: `docs/2.0.15/evidence/T12.json` 自身是 committed smoke extension；没有 complete Profile、installer、installed app、签名、R2/Feed 或公网写入。
- Remaining blockers: T15 prepared-adapter/Attachment-first 仍在独立任务收口；T16 尚未执行；T17 已取得两份只读腾讯源表并开始导入；D006 必须由 T18 新 Base identity/rebind 关闭。
- Next exact action: 从 `1176913` 创建 T16 独立 worktree/可见任务；T15 并行完成后，按 T16 → T13 → T18 顺序继续。

## 2026-08-27 · 2.0.15 T15 原生图片输入与运行组件检查点

- Goal checkpoint: T15 已在独立可见任务 `01a0436a-de49-7ad1-a576-b3df10972f5c` 完成，并由 T00 复验后作为一个不可拆分的三提交链合入 `release/2.0.15`；本条只提升源码与组件证据，不创建候选、安装态或发布回执。
- Frozen baseline / current HEAD: 首段原生 Attachment/CDP/Find Skill 修复合入为 `8cd64e9`，registration-bound Harness/Vision 收口为 `f99cbdc`，证据纠正为 `f3ec2ca`；本地 Harness 提交为 `2ca0b68b420ba11a80fc5fac800f889008cd42af`。公开生产仍为精确 2.0.13，immutable Base v7 未修改。
- Inspected native seam: paste/drop/upload 继续由 Harness Attachment/CAS 和 durable image block 唯一持有；image-capable 与 capability unknown 保留原请求和五个 native image blocks。确认 text-only 时，Vision 只在新的 Harness `llm/wire` waterfall 临时替换 messages；原 `llm/stream`、T10/invariant observers 和 prepared adapter registration 各只经过一次，HMR 重绑后仍调用 prepare 时捕获的 adapter。
- Decision and forbidden alternatives: 不递归调用 `ctx.llm.stream`，不写 durable history，不序列化绝对路径，不切换模型，不新增 Attachment store，也不回退到 Find Skill/CDP。`llm/wire` 只允许 messages 变化；provider/model/signal/session/其余 envelope 漂移、throw 和 abort 均失败关闭。旧 v7 不被静默改写。
- Changed scope: T15 Owner 内 CDP、Find Skill、Vision 与证据；经 D011 精确移交的 Harness `packages/llm/llm/src/index.ts`、窄测试和 root gitlink。Computer Use 无产品改动。没有 Base、版本、锁文件、发布或生产写入。
- Verification commands and results: 可见任务回执为 Harness LLM `85/85`、Vision `4/4`、CDP `11/11`、Computer Use `2/2`、Find Skill `21/21`、CP-03 zero pending 与 emitted imports 精确 7 项。T00 独立重跑 LLM typecheck、`85/85`、CDP `11/11`、Computer Use `2/2`、Find Skill `21/21`；补齐 HEAD 已声明但工作树未展开的 GenUI submodule 后，使用已提交 `T15.json` 重放 CP-03 为 `2657 ms / 0 pending`。
- Immutable evidence / receipt: `docs/2.0.15/evidence/T15.json` 诚实记录 source/component 层。`component-release inventory` 当前精确返回 D006 的两条严格消息：Harness gitlink 未被 v7 绑定，以及 v7 runtime imports 不等于 retained-component union；T18 successor Base 必须同时关闭二者。`2ca0b68b42…` 已通过本地对象同步到 release 工作树，但当前没有 advertised `origin/*` ref 包含它，因此这不是干净外部 checkout 回执。
- Remaining blockers: T18 必须先证明全新 checkout 可获取精确 Harness gitlink；complete Profile app-directory、目标 CPython 3.12 wheel/runtime、双平台 installed paste/drop/upload、macOS TCC、真实 connector/account、candidate/public receipts 均仍 OPEN；D006 仍是 RC blocker。
- Next exact action: 先完成 T11 D012 semantic frame host，再放行 T16；T13 只在 T11/T15/T16 handoff 后创建，T18 最后生成 successor Base 与正式 RC。

## 2026-08-27 · 2.0.15 T11 原生 Composer Host 纠偏合入

- Goal checkpoint: T11 在同一可见任务 `01a0436a-de49-7ad1-a576-b4198616aa5e` 完成第二种源码修复；总控拒绝了以 Home 文档扫描建立 Host 的第一种方案，只合入删除负尺寸补丁与最终原生 Owner 方案，release 提交为 `37da362`、`dbabee2`。
- Frozen baseline / current Harness: pinned Harness 从 T15 `2ca0b68b420ba11a80fc5fac800f889008cd42af` 前进到本地后代 `820fee0df4f46b15d4cc07f56ccfcae43549d769`。`ConversationRoot` 的原生 `composerStack` 直接发出 `data-emate-composer-frame-host`；Home 不再扫描后写入/删除该属性，也不新增 wrapper、mover、Composer、Store 或输入生命周期。
- Verification: 总控独立检查两个 root diff 与 upstream diff；native skeleton `18/18`、ui-conversation typecheck、Shell `15 files / 93 tests`、CP-11/CP-12 `3150 ms / 0 pending`、`git diff --check` 和 clean tree 均通过。重复失败会诊门禁 D009 未触发，因为第二种 native-owner 修复已通过同名验收。
- Evidence ceiling: 这只证明 source/component 层。严格 inventory 仍精确保留 D006 两条 blocker；`820fee0df4…` 当前通过本地任务仓补齐到 release 工作树，但没有 advertised `origin/*` 可达证明，不能冒充 clean-checkout、installed、RC 或 released。
- User input boundary: 用户已声明独立图片反馈工作簿为旧版作废材料；T17 不读取或映射其内容，只保留“已排除”的来源身份回执，并从唯一有效功能反馈导出重新生成 backlog。
- Next exact action: 同步并恢复原 T16 可见任务；并行恢复 T17，仅使用有效功能反馈导出。T16 合入后再创建 T13。

## 2026-08-27 · 2.0.15 T17 有效功能反馈只读归并

- Goal checkpoint: T17 在同一可见任务 `01a04376-18e2-7a63-9c79-934597ccae80` 仅使用 `VwnSnZLbANDI` 的有效功能反馈导出完成只读归并，release 提交为 `b6fa6f2`；没有业务代码、源表、外部文档、Base、版本或发布写入。
- User invalidation boundary: 用户明确宣布独立图片反馈工作簿为旧版作废材料。T17 没有重新打开或解析它，只在 evidence 的 `discarded_inputs` 记录文件名、已知 SHA、`user_declared_obsolete_old_version` 和 `content_excluded=true`；backlog 不含其行、字段、媒体、计数、分类、root、映射或结论。
- Verification: 有效表 SHA 精确匹配；20 条 raw feedback ID 全部唯一，分类 P0 8 / P1 5 / P2 1 / DUPLICATE 4 / NEEDS_EVIDENCE 2 合计 20；16 个 canonical ID 唯一且每条 raw 都有有效反向映射；禁止字符串 `IMAGE-` 不存在，JSON、`git show --check` 与 clean tree 通过。
- Evidence ceiling: 这是 read-only intake，不是产品修复。所有 P0 仍按各自 T05–T16 source/component、app-directory、installed、真实账户/provider、exact-byte 或 update/rollback 回执裁决；D006 与正式发布仍归 T18。
- Next exact action: 等待 T16 产品组件闭环并独立复验；T16 合入后创建 T13 最终 Shell/导航集成任务。

## 2026-08-27 · 2.0.15 T16 产品组件与原生渲染边界合入

- Goal checkpoint: T16 在同一可见任务 `01a0437a-bff4-7db2-9387-9edbe2b01e1d` 完成七个 retained component 的独立 Owner 闭环，release 提交链为 `af1d659`、`a6ef185`、`ca7a1c0`、`648830d`、`ca8aafe`、`c2701fe`、`e4526b7`、`fd47b90`、`bca3321`。没有 Shell、Harness、inventory、Base、版本、锁文件或发布写入。
- Native-owner decisions: Glass 明确 Keep，但只装饰 D013 原生 Composer Host；GenUI 在 rc.7 无 fence registry 时只保留 native `render_ui` ToolView，不启动全页 DOM 渲染双轨。Memory 增加用户确认且当前 scope 限定的删除；MCP 只有 native loader ACTIVE 且 server Tool 存在才报告 active；Office 在 Job 启动前已取消时不产出文件。
- Session and file boundaries: Better Sidebar 与 File Import 拒绝 archived/unknown Session，并把异步结果绑定到请求发起 Session。总控拒绝第一版仅覆盖 stale success 的 Better Sidebar 回执；同一可见任务第二版用 native session key 隔离首帧，并在一个 request-token owner 同时 fence stale resolve/reject，真实 deferred jsdom 回归证明旧 listing/path/preview/status 和脱离 DOM 的旧行都不能进入新 Session。
- Independent verification: Better Sidebar build、Host `3/3`、deferred client race `1/1`；File Import `7/7`、GenUI `1/1`、Glass `1/1`、MCP `5/5`、Memory `5/5`、Office `5/5`。七组件 emitted imports 精确匹配各自既有 `base_imports`；初始化 root 已声明的 GenUI submodule 后，committed T16 extension 重放 CP-13 为 `142 ms / 0 pending`；inventory 精确保留 D006 两条 strict red。
- Evidence ceiling: `docs/2.0.15/evidence/T16.json` 只提升 source/component 层。Complete Profile app-directory、installed macOS/Windows、真实 MCP provider、真实 Office application host、candidate/public、final Harness advertised reachability 与 successor Base rebind 仍归 T18。
- Next exact action: 从当前 release tip 创建 T13 独立 worktree/可见任务，消费 T06/T07/T08/T09/T11/T12/T15/T16 handoff，完成最后的原生 `@`、Settings、导航和 titlebar 集成。

## 2026-08-27 · 2.0.15 T13 最终 Shell 集成派发

- Goal checkpoint: T13 已按 Shell 高冲突顺序在 T16 合入后创建为用户可见的独立任务 `01a043d2-7aad-7491-bfe1-f8d109d4183d`；T00 继续只做状态、审查、纠偏、独立复验和合并，不代写产品实现。
- Frozen baseline / current HEAD: 独立 worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T13`、分支 `feat/2.0.15-T13-ui-navigation` 固定起点 `25e90d11bee5ce6d0df84a8384de2ece844f9fe2`；本地 Harness `820fee0df4f46b15d4cc07f56ccfcae43549d769` 与 GenUI `0e756efb7671e6b8413dde3d8e199c68fa89cbeb` 均已按 root gitlink 展开且 clean。
- Binding handoffs: T13 只接管 `DECISIONS.md` 的静态路径和已经顺序转交的 Shell/Header/Desktop integration seam，消费 T06 Schedule、T07 Skill Hub、T08 Share、T09 updater、T11 native Composer Host、T12 message/gallery、T15 native attachment/capability 与 T16 Glass/GenUI contracts。
- Decision and forbidden alternatives: 保持一个原生 Session/Workspace/Router/InputTrigger/Goal/Todo/Updater/Composer；不得新增 Mention registry、第二 Store/Renderer/Composer、DOM mover或可见 slash 菜单，不改 Home 内容、消息模式、产品插件、Base/version/lock/workflow。
- Evidence ceiling: 本任务先做 source/component 和可重复 smoke；完整 Profile app-directory、installed 双平台、真实服务、candidate/public 仍由 T18 裁决。D006 两条 strict blocker 必须保持可见，不能因 T13 集成被隐藏或弱化。
- Next exact action: 等待该可见任务形成最小提交和 `T13.json`，由 T00 回读源码与测试、独立复验并在通过后合入；随后才创建最后的 T18。

## 2026-08-27 · 2.0.15 T13 手动更新桥租约纠偏

- Goal checkpoint: 同一 T13 可见任务完成只读入口盘点后按规则停止且保持零改动；外置工作包已完整读取，不再是 blocker。总控独立核对确认真正缺口是 T09 Host 已有 `desktopUpdates.runInteractiveUpdate()`，但现有 Renderer bridge 只提供 `getState/subscribe/cancel`。
- Root cause: 直接在 Header/Settings 加“检查更新”会成为死按钮；从 Renderer 重跑 checker 会形成第二 updater。现有 `manualTask` 已拥有并发复用和完整事务，缺的是同一 context-isolated bridge 上的一条 typed 调用 carrier。
- Decision and transferred scope: D015 把已合入且 clean 的 T09 `update-presentation.ts`、`preload.ts`、`updates.ts`、`tests/updates.spec.ts` 精确顺序转交 T13，并把既有 `electron-runtime.ts`/测试租约扩大到该 IPC carrier。只允许调用原 `runInteractiveUpdate()`、验证 owning Renderer sender、teardown 清理和复用原 in-flight fence；Header/Settings 仍只消费同一 `DesktopUpdateState`。
- Forbidden alternatives: 不新增 updater、Store、持久结果、checker 调用、协议族或 manifest/download/install/rollback 逻辑；不把 source carrier 冒充 installed update/rollback。其余已证明缺口仍由 T13 原租约处理：Footer 重复 Settings、空白 Session Share、伪装可见 slash 和 connector route。
- Next exact action: 将本 T00 决策 fast-forward 到 clean T13 分支并恢复原可见任务；T00 在提交后独立验证 sender isolation、handler cleanup、同一 in-flight updater、Header/Settings 同源状态和完整路由/可访问性回归。

## 2026-08-28 · 2.0.15 T13 独立审查退回与 T15 能力状态补交

- Goal checkpoint: T13 可见任务已形成 source/component 候选 `c07d461` 与 evidence `8c63a29`，但尚未合入。T00 逐调用链回读后拒绝当前候选，主任务不代写产品修复。
- Root causes: 更新确认被拒绝后，唯一 updater 按合同保留稳定 `available`，而 Shell 把它同时列入 busy/cancellable，下一次点击只会调用不存在的取消事务；`@电脑操控` 仍读取 UA，未消费 T15 原生 `ComputerUseService` 的 helper/TCC 状态；Settings 仍以本地化标题和 MutationObserver 改名/隐藏，未按原生 `settings.section` id 收口 `models/plugins/agent-presets`。
- Decision and leases: D016 先恢复原 T15 可见任务，只在 Computer Use adapter/test/evidence 内把既有 status/openPermissionSettings 投影到既有 `emateCapabilities`。合入后恢复原 T13 可见任务；除既有租约外，只转交原生 SettingsRoot nav 的稳定 section-id metadata、对应窄测、root Harness gitlink与 identity-settings 的 expectation-only regression。
- Forbidden alternatives: 不新增 capability/permission/RPC/Settings/InputTrigger/Updater Owner，不用 UA 或本地化文本作最终事实，不卸载任何插件，不让 Windows 或 failed 状态插入可执行引用，不重写 T13 既有提交。旧版图片反馈工作簿继续整份排除且不读取。
- Evidence ceiling: 这是第一次针对三个同名验收的源码纠偏，D009 未触发。T15 必须先合入；随后 T13 同步 release、提交 follow-up、重跑最窄回归与 committed CP-13。app-directory、installed、真实 TCC、双平台 UI、更新/回滚、successor Base 和 public 仍由 T18 裁决。
- Next exact action: 恢复 T15 visible task 完成原生能力投影；T00 独立复验并合入后，再恢复 T13 修复 updater retry、Computer Use candidate state 和 stable Settings section boundary。

## 2026-08-28 · 2.0.15 T13 稳定主操作与版本冻结边界补充

- Goal checkpoint: T15 D016 修正仍在同一可见任务执行；T00 继续只做独立审查和精确租约，不代写产品实现，也未放行 T13 或 T18。
- Additional root cause: T13 候选仍用本地化 `aria-label='能力中心'` 选择 T07 控件，且共享 hover/focus/current 样式未覆盖该控件；T07 控件本身没有 tooltip 和 route-selected 状态。可访问名称不得兼任稳定样式/路由 identity。
- Decision and transferred scope: D017 只把已合入、clean 的 T07 `capabilities.tsx` 与对应 client test 顺序转交同一 T13 可见任务；Search/Schedule/Capability Center 共享一个稳定 primary-action data attribute，Capability Control 只接收 Sidebar slot 已有 route-active owner prop 并补 `title`/`aria-current`。禁止改 Hub 页面、RPC、registry、Jobs、catalog 或 Worker。
- Version boundary: Sidebar 与 Aura 仍有两个用户可见 `2.0.13`。D018 把这两个 literal 及直接相关测试的版本标签留给最后 T18 version-only freeze；不新增 Renderer/Desktop 版本桥，也不改历史 predecessor/update fixtures 或已发布 2.0.13 回执。
- Evidence ceiling: 这只是 Owner/租约裁决，没有 source/component、app-directory、installed、candidate 或 public 新回执。D009 未触发；D006 两条 strict blocker 继续保留。
- Next exact action: 等待同一 T15 visible task 完成并由 T00 复验合入；随后将 release 同步到原 T13 分支，按 D016/D017 做 follow-up，T18 仍只在全部 P0 合入后创建。

## 2026-08-28 · 2.0.15 T15 原生 Computer Use 能力投影合入

- Goal checkpoint: D016 在原 T15 可见任务 `01a0436a-de49-7ad1-a576-b3df10972f5c` 完成，没有新建任务或子代理；单一修正提交由总控合入 release 为 `9f7d54f`。T15 回到 `MERGED`，T13 的 native capability 依赖已解锁。
- Root cause and owner: 原 `ComputerUseService` 已拥有 helper/TCC 缓存状态与 `openPermissionSettings`，但组件没有向既有 `emateCapabilities` 投影，迫使 T13 候选读取 UA。修正只在 Computer Use build adapter 的唯一 fail-closed seam 注册一个 `computer-use` definition；没有新增服务、RPC、Store、permission model、helper、Tool、轮询器、依赖或 Windows executor。
- State and action contract: list 只读取一次缓存 `status()`；helper/provider 就绪且 Accessibility/Screen Recording 均 granted 才是 ready。缺失权限只返回对应原生设置 action；provider failure/unavailable 返回 failed/blocked 且无 action id。既有 registry 在 invoke 前重新计算 status 并拒绝不在 `action_ids` 的操作，signal 原样传给原生设置 Owner，Cordis effect disposer 移除唯一 registration。
- Independent verification: T00 逐行审查 `c55fe7900a` 后，以本地 runtime Node 重跑 build 和完整 package test为 `3/3`；真实 emitted imports 精确为 8 个声明项；T15 JSON、`git diff --check`、root/submodule clean 与提交检查通过。严格 inventory 仍且仅返回 `upstream/deepseek-harness: Git submodule commit does not match the Base contract` 和 `desktop/e-mate-desktop/base-contract.json: runtime imports must equal the component-declared Base ABI union`。
- Evidence ceiling: `T15.json` 只提升 source/component 层。真实 macOS TCC deny/grant/revoke、installed Windows 不可用投影、complete Profile app-directory、successor Base、candidate/public 与 clean external fetch 仍归 T18；旧版作废图片反馈工作簿继续整份排除且未读取。
- Next exact action: 将当前 release 合并到原 T13 分支，保留其既有提交，再恢复同一 T13 可见任务按 D016/D017 修正 updater retry、native Computer Use candidate、stable Settings IDs 和 stable primary-action contract。

## 2026-08-28 · 2.0.15 T13 最终原生导航集成合入

- Goal checkpoint: T13 在同一可见任务 `01a043d2-7aad-7491-bfe1-f8d109d4183d` 完成 D016/D017 纠偏、回归夹具对齐和 committed CP-13；T00 独立复验后将完整提交图 fast-forward 到 `release/2.0.15@0157ce5ad13880831b6e9230a7e521c3e6c80aa5`，没有重写、摘取或代写产品实现。
- Native-owner result: updater `available` 回到稳定可重试且不可取消；Computer Use 只消费 `/emate.capabilities` 与 Desktop 稳定平台元数据，ready 才插入，setup-required 复用原生 action，failed/blocked/Windows 不可执行；Settings 只按 `models/plugins/agent-presets` 稳定 section id 隐藏而不卸载；Search/Schedule/Capability Center 共享稳定主操作 identity、tooltip、focus/current 状态。
- Upstream and scope: 产品修复 `48b0479143bff18cfac10c8315af2a9c22aec294`，旧夹具对齐 `feb96b20017d2f127438df49b592c49c42748bf4`，最终 evidence `0157ce5ad13880831b6e9230a7e521c3e6c80aa5`；Harness 只新增 `SettingsRoot.tsx` 的既有 row-id metadata 与一个窄测，最终本地提交 `4787caf39134df190105b272da0dd2ba893d4d75`，GenUI 保持 `0e756efb7671e6b8413dde3d8e199c68fa89cbeb`。
- Verification: Owner committed CP-13 为五个 binding 全 PASS、`7850 ms / 0 pending`；T00 用最终 evidence 独立重放为 `8168 ms / 0 pending`。完整临时构建的外部 runtime imports 精确等于 `[@deepseek-ai/dsh-client-runtime, @deepseek-ai/dsh-client-ui-attachment, @deepseek-ai/dsh-client-ui-primitives, react, react-dom]`；root/Harness/GenUI、JSON、diff check 均 clean。
- Failures retained honestly: 第一次 CP 在旧 `composer-205` 夹具停下，因为夹具未提供 stable darwin 与 ready hint；最小测试修正后通过。其余 Settings 启动失败均由离线 package-local 映射不足引起，补齐已声明的 `ui-primitives` 闭包后通过；没有第二次产品源码修复，D009 会诊门禁未触发。
- D006 and reachability: strict inventory 仍且仅返回 `upstream/deepseek-harness: Git submodule commit does not match the Base contract` 与 `desktop/e-mate-desktop/base-contract.json: runtime imports must equal the component-declared Base ABI union`。release 子模块首次从 advertised origin 获取 `4787caf391…` 返回 `not our ref`，随后只从已验收本机对象库补齐工作树；这不是 clean-checkout reachability 回执，仍归 T18。
- Evidence ceiling: source/component 层通过；complete Profile app-directory、successor Base、真实 macOS TCC、Windows、Share/update 服务、candidate、installed exact bytes、update/rollback、签名与 public production 均未提升。用户宣布作废的旧版图片反馈工作簿继续只保留 identity exclusion，内容从未读取或映射。
- Next exact action: 创建唯一最终 T18 可见任务，在 `release/2.0.15` 上完成 successor Base、可达 Harness、版本冻结、RC、双平台安装更新回滚和正式发布回执；没有精确回执不得宣称 2.0.15 已发布。

## 2026-08-28 · 2.0.15 T18 Phase 1 源码冻结验收

- Goal checkpoint: 唯一 T18 可见任务 `01a0447b-214f-7050-a85f-76b50ecffc8a` 完成 advertised Harness reachability 与 Phase 1 source freeze。冻结提交为 `c2e7365b71a10e4a54622a70a30b0ae9fe19df90`，T00 拒绝第一版过滤网站用例的回执后，同一任务追加 source-gate 修正 `7a6703c299c54ae4edb34cbf802e9af2ada3637e`；最终 T18 evidence tip 为 `bc688967cb297086032efeb929b99edd62e11662`。
- Source truth: 当前唯一 Base 为 `e-mate-desktop-profile-v8-dsh-4787caf39134`，绑定 `0.1.0-rc.7@4787caf39134df190105b272da0dd2ba893d4d75`、Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`、15 个 retained components、19 个 `2.0.15` managed manifests 与精确 17 项 runtime-import union。严格 inventory 从原两条 D006 变为 15 components / 19 jobs / 0 errors；validator 未放宽，v7 只保留为 predecessor 历史合同。
- Advertised reachability: 仅新增远端分支 `release/e-mate-2.0.15-harness` 指向 `4787caf391…`。T18 branch/SHA clean probes 与 T00 独立 HTTPS clean probe 均无 alternates，并从旧 Base 精确取得 `2ca0b68b42…`、`820fee0df4…`、`4787caf391…` 三提交；没有 force push 或其他远端引用改写。
- Source-gate correction: `deploy/download-page` 是未正式发布的 2.0.14 历史网站源码，不能冒充当前 2.0.15 页面；真实 candidate staging 又必须默认要求当前 Desktop 版本。共享 validator 现在允许历史审计显式提供稳定 expected version，但 `stageDownloadPage` 默认仍严格绑定 2.0.15。第一次修正因临时路径非 canonical 且 current producer 仍收到 2.0.14 artifact name 而保持 14/16；第二种修正把历史页面、当前 staging fixture 与 current producer 分离后完整 16/16，未触发 D009。
- Independent verification: T00 逐行审查三路径修正并独立运行完整 `scripts/release.test.mjs` 为 16/16、冻结域 Harness/Base/component/profile/coordinator 为 53/53、`check:target` exit 0、`check:release-boundary` exact successor Base/0 errors、`component:inventory` 15/19/0 errors、全差异 `git diff --check` exit 0。`deploy/download-page` 与 `.github/workflows/release.yml` 相对纠偏起点零差异，root/Harness/GenUI 分别 clean 于 `bc688967cb…`、`4787caf391…`、`0e756efb76…`。
- Evidence ceiling: 这只接受 source freeze。Build once、candidate/admission、三目标 composition/boot、macOS arm64/x64 与 Windows x64 fresh install、2.0.12/2.0.13 更新、失败健康回滚、CP-01..CP-15 complete Profile、真实 Skill Hub/Share/connectors、TCC/Computer Use、C03 installed 截图、exact artifacts/provenance、签名/adhoc、Feed/Profile desired state、官网/public readback和正式发布仍全部 `OPEN`。生产前驱继续是 2.0.13，2.0.14 从未被提升为正式发布。
- User invalidation boundary: 作废的 `e-mate-image-feedback.xlsx` 继续只保留文件名、已知 SHA、`user_declared_obsolete_old_version` 与 `content_excluded=true`；T18 未打开、读取、摘要或映射其内容。
- Next exact action: 在同一 T18 可见任务中，从 T00 接受后的精确 release HEAD 启动 protected source gate 与 Build once；只生成一次三目标 Profile/Base/Desktop exact candidate，先回传 immutable artifact identity 交 T00 审查，未获接受前不得安装、签名或写任何生产状态。

## 2026-08-28 · 2.0.15 T18 Phase 1b 当前主线归并

- Goal checkpoint: T00 接受 Phase 1 后发现 authoritative `origin/main` 已前进到 `90c3a1fae3124536bb62f5ee215c74fe510e5e63`。T18 从 clean `release/2.0.15@3f8694415099e236288809591ccbe19a9ce2af5b` 以真实 `--no-ff` merge `1135dd9e3fcd1304c16607df9978f37811054e99` 保留双方完整 ancestry，随后以 `19122980f119b64c4011bcd7255db2b1b699d0cb` 完成当前 snapshot/publication source gate 修正；没有 rebase、cherry-pick、rewrite、push 或 PR 操作。
- Owner resolutions: 接收 upstream legacy mac Helper 在 deep bundle validation 前 durable ready 的一行 P0 修复及 source-order 回归，swap 前既有完整 validation 保持不变；`development-log.md` 保留双方全部 append-only 记录；impact 默认继续把公开 Base v7 前驱对当前 Base v8 候选判为 Base lane，并保留显式 compatible/incompatible 正负例。
- Snapshot boundary: 采用 origin/main 捕获于 `2026-08-27T08:19:11.281Z` 的三份公开 2.0.13/Base v7 inner bytes，精确保持 `10579/ef845777…a462`、`10567/374318de…bd9d`、`10503/beef5d1d…b6c1` 与全部 `content_base64`。只把外层 candidate identity 机械改为 `2.0.15` / `e-mate-desktop-profile-v8-dsh-4787caf39134`，并由既有 canonical helper 得到 `snapshot_sha256=b1714ce20eabf4010d1719055fff1bf2705d3c7cbdfab2b85d22be8e09cf4787`；没有联网刷新或生产写入。
- Source-gate correction: merge 后完整 `publish-profile-r2.test.mjs` 精确为 `2/3`，唯一失败是旧 fixture 同时触发 `base contract id must equal v8` 与 `Harness commit drifted`。第一种最小修正复用导出的 `BASE_CONTRACT_ID` / `HARNESS_COMMIT` 并让假 root、gitlink、Base 与 component 共同绑定当前 v8/4787caf 后达到 `3/3`，D009 未触发，validator 与 inner 前驱均未放宽或改写。
- Verification: 完整 `test:impact` 为 `45/45`，完整 `release.test.mjs` 为 `16/16`，完整 mac updater suite 为 `93/93` 且包含 ready-before-validation 回归；`check:target`、`check:release-boundary`、`component:inventory`、changed JSON parse 与 `git diff --check` 均 exit 0，inventory 为 15 components / 19 jobs / 0 errors。
- Evidence ceiling: 本轮只恢复当前主线 ancestry 与 source gate。Build once、candidate/admission、三目标 composition/boot、macOS/Windows fresh install、2.0.12/2.0.13 update、rollback、真实服务/TCC、exact artifacts、签名、R2/Feed/Profile desired state、官网/public readback与正式发布继续全部 OPEN；作废图片反馈工作簿仍只沿用 identity exclusion，未打开、读取、摘要或映射。
- Next exact action: 停止并交 T00 独立审查 merge parents、snapshot inner/outer 分层与完整 source gates；未获 Build once 放行前不进入候选或发布阶段。

## 2026-08-28 · 2.0.15 T18 Phase 1b 总控独立验收

- Goal checkpoint: T00 已独立接受同一 T18 可见任务的 Phase 1b 源码候选 `7bd8994231c51501975f7ccc722c6dfcb9b93040`。本轮只落账总控验收，不修改产品、T18 evidence、候选、安装、签名或生产状态。
- Ancestry and live baseline: merge `1135dd9e3fcd1304c16607df9978f37811054e99` 的两个父提交精确为 T00 已接受的 `3f8694415099e236288809591ccbe19a9ce2af5b` 与 live `origin/main@90c3a1fae3124536bb62f5ee215c74fe510e5e63`；远端 main 复查未再前进，远端 `release/2.0.15` 尚不存在。root、Harness `4787caf39134df190105b272da0dd2ba893d4d75` 与 GenUI `0e756efb7671e6b8413dde3d8e199c68fa89cbeb` 均 clean。
- Snapshot and owner review: 三目标 `.targets` 与 `origin/main` 捕获的公开 2.0.13/Base v7 inner bytes 精确相等；外层 candidate identity 才是 2.0.15/Base v8。legacy mac helper 只删除 durable ready 前的重复 validation，swap 前完整 validation 仍存在且有顺序回归；impact 默认仍诚实反映当前公开 Base v7 对冻结候选 Base v8 的 Base lane。
- Independent verification: T00 独立运行完整 impact `45/45`、release `16/16`、mac updater `93/93`；`check:target`、`check:release-boundary`、`component:inventory`、JSON 与全 Phase 1b `git diff --check` 均通过，inventory 为 15 components / 19 jobs / 0 errors。实际 Phase 1b 修改严格限于七个已记录路径。
- Evidence ceiling: Build once、不可变 artifact identity、candidate/admission、三目标 composition/boot、双平台安装、升级/回滚、真实服务与 TCC、签名、R2/Feed/Profile desired state、官网/public readback和正式发布仍全部 OPEN。作废图片反馈工作簿仍只保留 identity exclusion，内容未打开、读取、摘要或映射。
- Next exact action: 先再次读取 live `origin/main`；若仍为 `90c3a1f…`，只放行同一 T18 任务非强制推送唯一 release 分支、创建并通过一个受保护主线 PR，然后捕获 protected-main CI attempt-1 的唯一 Build once。该任务必须在 artifact identity 回传后停止，未获 T00 接受前不得安装、签名、调用发布协调器或写生产状态。

## 2026-08-29 · 2.0.15 T18 / T21 successor Base source binding

- Goal checkpoint: T21 将 root Harness gitlink 从 `4787caf39134df190105b272da0dd2ba893d4d75` 推进到其单提交后代 `b469c2b99a6c2f35c5e51eaf611f1941e095f90d`，因此 T18 在 protected source `955ddd36bfcdc29155cd7e5a11c96fdd93bc3c87` 上建立全新 `e-mate-desktop-profile-v9-dsh-b469c2b99a6c`；没有原地改写不可变 v8，也没有修改 T21 产品文件。
- Contract result: root gitlink、Base contract、当前 Desktop/DSH/release constants 和 15 个 retained component manifests 全部绑定 v9/b469；19 个 managed manifests 继续是 `2.0.15`。Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`、Profile Ed25519 signing root 和精确 17 项 retained-component ABI union 均未变化，strict validator 未放宽。
- Historical boundary: 已发布 2.0.15/Base v8、2.0.13/Base v7、predecessor/update fixtures 与旧 candidate/public receipts 保持历史事实。`profile-current-snapshot.json` 只重绑定当前 outer candidate identity；三目标公开 2.0.13/Base v7 inner bytes 未改。
- Verification: Harness `ui-conversation` focused tests `2 files / 25 tests`，移除全部 Harness 临时依赖链接后的 provenance `7/7`，完整 change-impact `26/26`，release contract `16/16`，component/profile release contracts `20/20`；`check:target`、`check:release-boundary` 均 exit 0，inventory 为 `15 components / 19 jobs / 0 errors`，19 个 changed JSON 全部可解析，manifest/runtime consistency 与 `git diff --check` 通过。
- Evidence ceiling: 这只关闭 v9 source binding。Build once、三目标 Profile composition、candidate、install、update、rollback、signing、Profile desired state、public 与 website 对 v9 全部保持 `OPEN`；没有构建、安装、签名、push、发布或生产写入。作废 `e-mate-image-feedback.xlsx` 继续只保留 identity exclusion，内容未打开、读取、摘要或映射。
- Next exact action: 停止交 T00 独立审查本 source-binding commit；只有 T21 产品提交与本 v9 绑定按保护规则共同进入新的 protected source 后，才可生成一个新的正式候选。

## 2026-08-29 · 2.0.15 T18 v9 source truth and candidate invalidation split

- Goal checkpoint: T21 Owner 的 advertised Harness ref `refs/heads/release/e-mate-2.0.15-t21-harness` 已由 T00 现场确认精确指向 `b469c2b99a6c2f35c5e51eaf611f1941e095f90d`；T18 的 v9 mechanical binding 保持单一 source owner，不改 T21 产品文件。
- Historical boundary: `T18.json` 的顶层发布/安装状态、旧 v8 snapshot、formal public closeout、installed acceptance、predecessor/update receipts 全部恢复并保持原字节真相。新 v9 snapshot identity 只记录在 `t21_successor_base_source_binding.current_candidate_snapshot`，不能覆盖历史回执。
- Candidate invalidation: formal RC run `33223689296` / source `955ddd36bfcdc29155cd7e5a11c96fdd93bc3c87` 因新增 installed P0 使 T21 成为必需产品输入而失效；T00 已请求取消，所有 artifacts 禁止消费或重标。v9 source binding 不等于候选。
- Evidence ceiling: 只有 v9 source contract 可进入 T00 复核。新的 Build once、Profile composition、candidate、install、update、rollback、signing、desired state、public 与 website 全部 `OPEN`；旧 v8 public/installed truth 不回退也不提升。

## 2026-08-29 · 2.0.15 T18 v9 final source-gate closeout

- Contract GREEN: 当前 v9/b469 tree 的完整 change-impact、component/profile/publication/release 合同组合为 `62 tests / 57 pass / 5 intentional impact-lane Harness-toolchain skips / 0 fail`；wrong-gitlink negative contract 继续 fail closed。没有发现新的 current-owner v8/4787 常量，因此没有额外源码修正。
- Final gates: 移除临时依赖映射后 Harness provenance `7/7`；`check:target` 与 `check:release-boundary` 均 exit 0，后者返回 v9/0 errors；inventory 为 `15 components / 19 jobs / 0 errors`。
- Cleanup and ceiling: root 与 package-local 临时 `node_modules` symlink 均已由 trap 移除。此回执只补 source checks；失效 run `33223689296` 仍禁止消费，新的 candidate/build/install/update/rollback/public 门禁继续 `OPEN`。

## 2026-08-29 · 2.0.15 T18 / T21 final source integration

- Integration ancestry: 从 v9 source-binding tip `c4db426aa6f864a048332fc12b476466621d9b01` 依次接入 T21 PR #103 的 `6296e30df28d274cd710353cca733924b2ad3482` 与 `11fd7f87c584d24938658b945f572229e9bbdfa0`，得到本地提交 `fe0bf68d62b40fe5301b8fb25c1a9eac58459eda` 与 `541eab8a7cb3823fd1078444c500a427159b3642`；22 个 T21 路径与 source head 逐字节一致，没有把 T18 Base Owner 文件塞回 PR #103。
- Integrated contract: 当前树同时保持 `e-mate-desktop-profile-v9-dsh-b469c2b99a6c`、Harness `b469c2b99a6c2f35c5e51eaf611f1941e095f90d`、17 项 ABI 与 T21 首页、Composer、Header、Sidebar、Glass 和 Capability Center 产品修复；版本仍为 `2.0.15`，旧 v8 public/installed 回执未改。
- Verification: T21 精确聚焦合同为 Composer `10/10` 加 Capability Center `8/8`；Harness 两个 ui-conversation 文件输出 `25/25`，但包装清理异常不冒充命令 exit 0。扩展 Shell 本地回归只停在未安装完整 workspace closure 的 module resolution，未出现断言失败，保持 `ENVIRONMENT_OPEN_PENDING_PROTECTED_PR_CI`。v9/source 合同为 `62 tests / 57 pass / 5 intentional Harness-toolchain skips / 0 fail`，Harness provenance 在全部临时映射移除后为 `9/9`；target、release boundary 与 inventory 均通过，inventory 为 `15 components / 19 jobs / 0 errors`。
- Evidence ceiling: 本提交只记录 source integration。新的受保护 PR admission 在提交时仍待外部 CI；修复后的 installed 视觉、Build once、candidate、安装、更新、回滚、Profile desired state、public 与 website 均保持 `OPEN`，后续候选必须明确为 unsigned。

## 2026-08-29 · 2.0.15 T18 session-draft successor Base source binding

- Root cause and immutable boundary: PR #105 run `33245046765` attempt 1 stopped before build because root gitlink and advertised Harness had advanced to `1d3824bcd3400b3761a0ebdd956901752ddc962b` while immutable Base v9 still bound `b469c2b99a6c2f35c5e51eaf611f1941e095f90d`. T18 created the honest current successor `e-mate-desktop-profile-v10-dsh-1d3824bcd340`; it did not rerun, cancel, consume or relabel that failed run.
- Contract result: Base, current Desktop/DSH/release constants, 15 retained component manifests, 19 managed manifests and the current outer Profile snapshot now agree on v10/1d3824. The exact 17-item ABI union, Desktop reference and Profile signing root are unchanged. Base v9/b469 remains immutable source-predecessor history, published Base v8 and 2.0.13/Base v7 receipts remain historical public/predecessor truth, and the snapshot's three inner public Profile byte strings are unchanged.
- Verification: change-impact/component/profile contracts `43/43`; release plus Harness provenance `23/23` (`16/16` plus `7/7`); current-snapshot publication `3/3`; `check:target`, `check:release-boundary` and `component:inventory` exit 0, with inventory `15 components / 19 jobs / 0 errors`; 19 changed JSON files parse and `git diff --check` passes. The first target check observed an unexpanded exact product-UI submodule and remote fetch was sandbox-blocked; expanding the pinned `564a6b6c…` object from an existing read-only local submodule made the same check pass without tracked changes. Three optional component emitted-lib tests remained environment-open because this worktree has no generated `lib/`; no assertion failed and no product build was run.
- Evidence ceiling: this is current source-binding fix #1 only. Fresh PR #105 admission, protected-main Build once, exact unsigned artifacts, installed/service/Windows/update/rollback/Profile desired-state/public/website gates remain `OPEN`. No product code, workflow, version, dependency, lockfile, Harness/GenUI source, installer, signing, publication or production state changed.

## 2026-08-30 · 2.0.15 T21R6 installed UI regression source fix

- Owner trace: the macOS stripe was the Desktop advanced frame's isolated transparent caption grid row over `BrowserWindow` vibrancy, not a route-local caption color; the Settings collision was the e-Mate Settings header's missing consumption of the Desktop traffic-light safe width. The frame now lets the existing conversation/details surfaces paint behind the drag overlay while retaining their 20px content offset, and exports the existing 80px native safe width to the Settings header. No second window, shell, router, Settings implementation, or caption fill was added.
- Notice trace: `@目标` already routes through the Base-bound Harness `SessionInputShell.notices` owner. That owner now clears on draft mutation, submit, session disposal/navigation teardown, and a four-second ceiling; the e-Mate trigger still preserves a non-empty draft and does not add a toast or store.
- Pinned comparison: Base `e-mate-desktop-profile-v10-dsh-1d3824bcd340`, Harness `0.1.0-rc.7@1d3824bcd3400b3761a0ebdd956901752ddc962b`, and Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`. This is Base/Desktop-owned window geometry plus the pinned Harness notice lifecycle, so Creation Mode cannot represent the native-window half and was not used.
- Settings-route gate: current RC evidence did not reproduce a leaked chat/task directory. Existing route shadowing remains intact; native Settings navigation stays interactive. Source tests cover standalone-route removal of the resident header/conversation and close-to-origin behavior; installed replacement-candidate visual/AX proof remains OPEN.

## 2026-08-30 · 2.0.15 T21R6 Settings navigation lifecycle correction

- New real-device evidence supersedes the earlier `NOT_REPRODUCED_CURRENT_CANDIDATE` conclusion: a chat with resident directory/outline state can expose its task navigation after entering `/settings`.
- Root cause: `SidebarRoot` owned a second mobile Settings route path that watched Settings DOM markers, retried for 120 animation frames, and called `layout.toggleSidebar()` while the native Settings trigger was mounting. Window restore and portal timing could therefore expand the chat sidebar into the Settings route. The native `SettingsTrigger` already owns direct-route opening, so the duplicate layout mutation was removed.
- Lifecycle result: on `/settings`, the existing SidebarRoot keeps only the native `sidebar.settings` trigger mounted and unmounts the task/sidebar navigation plus its mobile portal layer. Leaving Settings restores the same component state and original Session navigation without recreating a router, store, overlay, or Settings implementation.
- Focused matrix covers populated long-chat/file/subtask state, Chat to Settings, direct Settings, close and re-enter, light/dark themes, collapsed restored-window state, absence of task navigation/mobile portal, native Settings trigger interactivity, and zero sidebar toggles. Replacement installed-candidate screenshots remain `OPEN` because this source-only task forbids building or installing a new candidate.
- Installed RED refinement: in `/Applications/e-Mate-2.0.15-RC-9ce31122.app`, clicking “再次检查更新（已更新至 2.0.15）” while `/settings` remains visible can remount the shared Shell and restore `container 任务导航` plus project/session rows to the AX tree alongside SettingsChrome. Screenshot `artifacts/2.0.15-final-9ce31122/audit/macos/16-settings-chat-navigation-leak.png` records the visual state; the leaked navigation is obscured at its 1250×768 viewport, so AX is the decisive failure evidence.
- The focused source gate now forces a fresh `SidebarRoot` mount from that update-status action while the route remains `/settings`, then asserts the task/navigation owners, populated chat rows, and mobile portal are absent from the accessibility/DOM tree while all four native Settings categories remain accessible. The updater owner is unchanged; replacement installed-candidate AX and screenshot proof remain `OPEN`.
- Installed recovery-disclosure RED: the same RC can expose all 67 legacy “新会话” rows immediately beneath `未归属/待恢复 67` after a project is attached, despite the shared Sidebar source initializing that disclosure as collapsed. Screenshot `artifacts/2.0.15-final-9ce31122/audit/macos/18-project-memory-cross-session-pass.png` confirms the project session remains correctly assigned; only the orphan/recovery disclosure state fails.
- The focused gate now exercises 67 recovery rows and verifies their task buttons stay unmounted on initial load, project-list growth, Settings route round-trip, and restored-window remount. A deliberate user expansion still survives an ordinary rerender through the existing component-local disclosure state; no persistence store or parallel Sidebar state was added. Replacement installed-candidate proof remains `OPEN`.
- Installed Composer-notice RED: `artifacts/2.0.15-final-9ce31122/audit/macos/06-home-dark-empty.png` shows the `@目标` draft-protection error persisting above an empty Home composer and visually joining its outer glow after the transient mention interaction has ended.
- Root cause and source fix: the native `SessionInputShell.notices` owner already clears on draft mutation, submit, and session teardown, but its previous four-second timer was not a menu lifecycle and the shell did not observe the existing `InputTriggerController.menu` close transition. The InputHub now binds that existing observable once when composer chrome resolves the controller; open-to-closed clears the notice immediately, and disposal removes the subscription. No timer, second notice system, DOM relocation, or route store was added. Replacement installed-candidate proof remains `OPEN`.

## 2026-08-30 · 2.0.15 T25 local-first flow

- Baseline and owner boundary: the only worktree is `/Users/mac/e-mate/worktrees/emate-2.0.15-T25-local-flow` on `feat/2.0.15-T25-local-flow`, created clean from exact `origin/main@236aaa4f80598f07bf8f59848c217b9a60155d82`. The flow reuses `change-impact.mjs`, the existing Desktop unsigned macOS/Windows packagers and verifiers, native Codex SSH alias `kh19arc` with exact hostname `DESKTOP-KH19ARC`, the existing manifest admission/signing Owner `zyfjacksonchen-source/e-mate-desktop-publication@e45c3b9d1bec366ab306203574d0a7a724d7f123`, and the Codex Cloudflare/CAS owner. It adds no second classifier, packager, signer, uploader, pointer writer, updater, store, route, protocol, dependency, lock change, workflow, or schema migration.
- Local flow: root `pnpm flow <dev|candidate|verify|publish|rollback>` writes exactly one ignored `dist/local-runs/<run-id>/` per logical run. `dev` runs only classifier-selected checks and lists affected Computer Use scenarios. `candidate` requires a named, committed, clean source; makes a clean local clone from exact local Git objects, builds formal unsigned macOS locally and Windows only through `kh19arc`, uses legacy `scp -O` for both proven transfer legs, and can retry a failed platform while byte-verifying and reusing an unchanged passed platform. `verify` binds every package/blockmap byte and pollution negative; macOS requires installed-byte-bound Computer Use pass/screenshots, while Windows records Computer Use only as `not_applicable/allowed_unavailable` and instead requires installed, startup, update, all other 2.0.15 fixes and built-in-tool matrix coverage bound to task/thread, host, timestamp and installer SHA-256. `publish` keeps both installers unsigned and macOS unnotarized, but requires the existing Owner's Ed25519 `e-mate-desktop-release-manifest-v2\0` schema-2 admission/signature receipt; manual/signed/legacy must be that exact signed manifest, with both pointers CAS-bound to the frozen `2961`-byte 2.0.13 identity and legacy last. The local script has no GitHub/CI dispatch, Wrangler, direct R2, installer signer, second manifest signer, `win-codex`, or UU path.
- Verification: locked Node 24.19.0 reports `11/11` focused tests and `git diff --check` passes. Direct locked-Node dispatch `node scripts/local-flow.mjs dev` passed the same focused tests plus the existing release boundary, produced ignored run `20260829T235606Z-22bec1462385-54cc8d`, and its `SHA256SUMS` reverified `5/5` files. The release boundary remains Base `e-mate-desktop-profile-v10-dsh-fccd7d25b3f1`, schedule floor `1`, zero errors. A Codex fallback-pnpm preflight attempted a dependency install before dispatch and was interrupted; T00 moved its only ignored, newly created `node_modules` to Trash, with no source or tracked-file deletion.
- Evidence ceiling: no current candidate was built, installed, manifest-signed, uploaded, activated, rolled back, or published. Real platform package receipts, macOS Computer Use installed acceptance/screenshots, Windows installed/startup/update/product/tool matrix with explicit Computer Use non-applicability, existing-owner schema-2 admission/signature handoff, R2 authenticated/public readback, exact-predecessor manual/signed/legacy CAS, and rollback receipts remain `OPEN`; therefore publication cannot enter. Version `2.0.15`, dependency locks, product behavior, Desktop/Profile update safety, production pointers, R2 objects, GitHub workflows, and current candidate bytes were not changed.

## 2026-08-30 · 2.0.15 T21R7 Shell CSS build admission

- Baseline and owner: exact `origin/release/2.0.15-final-integration-r5@f508517f216e79c34e05b129ddf38d459a6f5aec`, Base `e-mate-desktop-profile-v10-dsh-fccd7d25b3f1`, Harness `0.1.0-rc.7@fccd7d25b3f19885e2778c128b57d7c8312b7344`, and Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`. The sole owner remains the existing `@e-mate/dsh-client-shell` client entry; Creation Mode was unnecessary because the failure is the pinned static bundle admission boundary, directly defined and exercised by `clientBundle`.
- Root cause and native seam: Shell imported one ordinary `theme-tokens.css`, so pinned tsdown `0.22.2` reached its CSS guard and required the intentionally absent `@tsdown/css`. The pinned Harness already owns `.module.css` virtualization through a non-CSS virtual id and Lightning CSS inlining. The token file now uses that existing path without changing its selectors or values; `src/client/index.ts` still loads it once for Home, conversation, Settings, and Capability Center, while `account.module.css` no longer repeats an `@import`.
- Focused evidence: the new regression first failed only because the entry still named `theme-tokens.css` (`11/12` passed), then passed `12/12`. The CI-equivalent accepted-component check rebuilt the actual Shell bundle and passed all `16/16` frontend files and `108/108` tests. Emitted `lib/client.js` contains one token style tag id, the existing idempotent style guard, and both global light `:root,body` and dark `body[data-ds-dark-theme]` token selectors.
- Scope and ceiling: no dependency, lockfile, workflow, loader, runtime injection, second token copy, Harness source, generated artifact, installer, CI dispatch, PR mutation, merge, signing, publication, or production state changed. This is `source fixed` evidence only; protected CI, candidate, installed, update/rollback, and public-production gates remain `OPEN`.

## 2026-08-30 · 2.0.15 T25R3 Codex Remote Windows candidate boundary

- Baseline and evidence: the sole local-flow Owner started from clean `a64226a1dfa65e36e6c1b93bd2d55211f9fca62d` in `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R3-codex-remote`. Sentry has no callable tool and this is a pre-runtime orchestration defect, so there is no relevant Sentry evidence. The native handoff probe did not complete before the task moved into the exact worktree, and no callable `handoff_thread` remained afterward; automatic binary return is therefore unproved rather than assumed.
- Root fix: the candidate no longer invokes or falls back to SSH/SCP. The same run now emits an exact committed-clean source/request for Codex Remote; `DESKTOP-KH19ARC` executes the existing `_platform-build`, and local `candidate --run ... --windows-result ...` imports only an exact allowlisted result whose request, source SHA, host, artifact names/bytes/SHA-256, artifact/result/log receipts and pollution scan all agree. The existing packager, artifact verifier, run/receipt Owner, unsigned installer policy and publication Owner remain unchanged.
- Focused evidence and ceiling: the SSH-only assertion was RED at `13/14`; the awaiting-state follow-up was RED at `15/16`; the final matrix is GREEN at `16/16`, including missing/pending/failed/building or source/request/digest-drifted handoff state, wrong host/schema/name/source, byte drift and canary pollution. No formal candidate, installer, Windows remote build, installed acceptance, signing, R2, pointer, CI, PR, push or publication operation ran; a real Codex Remote handoff, returned installer import and both-platform acceptance remain `OPEN`.

## 2026-08-30 · 2.0.15 T25R3 mixed-diff development gate

- Root cause and shared fix: `devChecks` treated any diff containing `scripts/local-flow*` as local-flow-only, so a mixed Base/product change could skip its owning lane. It now retains the local-flow regression whenever that owner changes, returns the existing change-impact contract only for the pure local-flow allowlist, and otherwise continues through the unchanged `plan.lane` selector; the existing `addCheck` remains the exact deduplication owner.
- Focused evidence and ceiling: the mixed Base assertion was RED at `15/16`, with `pnpm run test:fast` absent, then GREEN at `16/16` with the local-flow regression plus `pnpm run test:fast`; the pure local-flow pair remains unchanged. No `pnpm flow dev`, candidate, build, SSH, CI, push, signing, publication, or production operation ran.

## 2026-08-30 · 2.0.15 T25R3 explicit Windows-unavailable / macOS immutable boundary

- Authority and evidence: the user explicitly permits a macOS-only release when Windows remote access remains unavailable. Sentry has no callable tool and this is a static local orchestration change, so there is no relevant runtime evidence. The existing local-flow Owner is unchanged; no CI, SSH implementation, second packager, signer, updater, publisher, dependency, lockfile, or public manifest schema was added.
- Candidate and verify truth: `candidate --run <run-id> --windows-unavailable` is mutually exclusive with retry/result import, requires the exact `awaiting-codex-remote` request and byte-verified accepted macOS candidate, and records Windows exactly as `REMOTE_UNAVAILABLE / UNVERIFIED` with `tested: false`. Verify then requires the immutable DMG's complete macOS installed matrix, including installation, startup, update/relaunch, rollback, all 2.0.15 fixes, built-in Tools, and Computer Use, and closes only as `passed-macos-only`; forged, failed, building, source-drifted, or request-drifted waivers fail closed.
- Publication boundary: the schema-2 Desktop update manifest requires both `darwin` and `win32` artifacts bound to the same source. A macOS-only run therefore requests only create-only publication and authenticated/public byte readback of the source-scoped unsigned DMG. It neither invokes manifest admission/signing nor creates or mutates `desktop/manual/v2.0.15/latest.json`, `desktop/signed/latest.json`, or `desktop/latest.json`; it makes no online-update claim, and public rollback fails closed because no active pointer changed. The prior public 2.0.15 shared surfaces remain untouched.
- Focused evidence and ceiling: the new test first failed at module admission because the waiver Owner did not exist, then the final locked-Node matrix passed `19/19`; `git diff --check` passes. No candidate was built, installed, uploaded, activated, rolled back, or published. Windows remains unverified; macOS installed acceptance and immutable-object owner/public receipts remain `OPEN`.

## 2026-08-30 · 2.0.15 T09R4 local installed-update acceptance boundary

- Baseline and owner: clean `fix/2.0.15-T09R4-updater-closure@53e2ee60a631f997cc7cdbdce1c488d156576f64`, Base `e-mate-desktop-profile-v10-dsh-fccd7d25b3f1`, Harness `fccd7d25b3f19885e2778c128b57d7c8312b7344`, and pinned Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`. Sentry has no callable entry, so runtime evidence is `NONE`; this static release-receipt defect was traced through the repository and native updater instead.
- Native audit: the existing Desktop owner already performs signed-manifest checking, confirmation-gated download and byte/container verification, same-volume staging, atomic canonical replacement, orderly relaunch, Renderer-health ACK/commit, and failed-health rollback/relaunch on macOS and Windows. The pinned reference retains the same single Electron update, shutdown and relaunch lifecycle; e-Mate's bounded platform transactions extend that owner rather than adding a second updater. The fixed public metadata and artifact origins intentionally provide no installed loopback override; adding one here would weaken the trust boundary, so real predecessor execution still requires an exact signed candidate reachable through the existing owner.
- Root fix: `pnpm flow verify` previously accepted one ambiguous `update` coverage label, so a check-only or success-only receipt could satisfy the full installed matrix without automatic relaunch or the failed-health rollback leg. The one shared validator now requires both exact coverage facts: `update-download-verify-atomic-replace-relaunch-health-commit` and `failed-health-rollback-relaunch-recovery`. Missing either fails before verification or publication; no updater, transport, fixture endpoint, installer, Feed, pointer or public state changed.
- Evidence and ceiling: the updated receipt fixture was RED at `15/19` because the validator still expected `update`, then GREEN at `19/19`; the focused Desktop transaction/health/relaunch suite is GREEN across the existing macOS and Windows owners. This is `source fixed` only. T00 must still bind both real installed legs to the frozen candidate artifact SHA in the external T18/T22 matrix; check-only state cannot satisfy the new validator, and no candidate was built, installed, restarted, rolled back, published or mutated by T09R4.

## 2026-08-30 · 2.0.15 T16R6 partial ImageGen child delivery

- Baseline and owner: clean `fix/2.0.15-T16R6-image-partial-stream@53e2ee60a631f997cc7cdbdce1c488d156576f64`, Base `e-mate-desktop-profile-v10-dsh-fccd7d25b3f1`, Harness `0.1.0-rc.7@fccd7d25b3f19885e2778c128b57d7c8312b7344`, and Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`. The sole product owner is the existing e-Mate ImageGen Profile plugin and its one ignorable `emate/image-output` receipt stream. Sentry has no callable tool, so runtime evidence is `NONE`; the installed event trace and source path remain authoritative. Creation Mode was not used because this task may not operate the currently running application and no `cordis_inspect_*` capability is callable in the task; the permanent change stays on the existing Profile event seam.
- Root cause and RED: the existing ImageGen leaf already commits revision 1 in its child and revision 2/3 into the ImageGen caller before leaf disposal. A generic outer background Subagent therefore owns a complete terminal revision 2/3 receipt, but pinned native `subagent/end` carries only its closing assistant blocks; the direct parent Session receives neither the exact Attachment identity nor the durable receipt before the background Job notice wakes it. The focused regression is RED on the baseline because ImageGen registers no `subagent/end` consumer (`subagentEnd` is `undefined`).
- Required fix and ceiling: on each local outer child terminal edge, synchronously validate only real revision 2/3 ImageGen receipts whose recorded parent is that child, rebind the same Job/provider/source/output/verification facts to the exact live direct parent, and append once under a deterministic child-receipt identity. Internal revision 1 leaves, prose-only children, unrelated ownership, duplicate/reconnected edges, failures without a receipt, and permanently running children contribute nothing. No batch Tool, retry, Job/Queue, Attachment store, Gallery store, placeholder, natural-language inference, candidate build, installed operation, CI, or publication is authorized.
- GREEN and evidence ceiling: locked Node 24 direct `tsdown` source compilation passes; the focused `image generation reuses the Model Gateway with Harness Jobs and attachments` regression passes `1/1`, covering out-of-order completion, three successes with one permanently pending child, terminal review rejection plus explicit retry, cancellation after success, no provider replay, and cold-reopen duplicate suppression. The exact profile-inject static contract and `git diff --check` pass. This is source/fixture evidence only; no installer, installed app, live runtime, update, or publication claim is made.

## 2026-08-30 · 2.0.15 T13 Goal native-command handoff correction

- Baseline and evidence: the dedicated clean worktree starts at exact final integration source `70ca40b67fad860d0be897b02ae48272b188b62f`, Base `e-mate-desktop-profile-v10-dsh-fccd7d25b3f1`, Harness `0.1.0-rc.7@fccd7d25b3f19885e2778c128b57d7c8312b7344`, and Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`. No callable Sentry tool exists, so the installed symptom is bounded by source and test evidence here.
- Root cause and shared owner: the Shell's `@目标` adapter rewrote `@` to `/goal` and immediately called the InputTrigger controller's synchronous Space path. That path deliberately consults only hot command state, so a still-warming native command directory closed the mention interaction without producing the Goal claim. The adapter now awaits the same controller's strong-waiting `/goal` adjudication, accepts only its native claim, and applies it through the existing scoped `slash/input-begin-command` span-CAS event. It adds no Goal mutation, store, editor, menu, command executor, or draft owner.
- Goal/Plan gate: the focused regression was RED at `4/5`, with no call to native adjudication, then GREEN at `5/5`. It proves Goal receives the native `/goal ` claim while preserving a non-empty draft, and the Plan sibling still executes native `/plan`, consumes only its matching `@` span after success, preserves the draft on failure or revision drift, and does not depend on model availability. Exact pinned-Harness checks also pass the cold command strong-wait, bare Plan command, and InputTrigger adjudication contracts (`3/3`).
- Evidence ceiling: this is `source fixed` evidence only. No Harness pin, dependency, lockfile, generated bundle, candidate byte, installer, installed app, update/rollback state, public object, pointer, or production state changed; replacement installed-candidate acceptance remains `OPEN`.

## 2026-08-30 · 2.0.15 T07R2 Skill Hub Host bearer boundary

- Owner lease and baseline: sole Owner worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T07R2-skillhub-host-auth`, branch `fix/2.0.15-T07R2-skillhub-host-auth`, exact baseline `bbecebe01f5fe4e936fee1b2c4d2ea99a7894e68`. The write lease is limited to `enterprise/apps/skill-hub-worker/src/index.js`, its existing `tests/index.test.mjs`, and this record. No client, identity transport, route duplication, dependency, database, R2, public Skill, installer or release pointer is authorized.
- Canary evidence and Sentry boundary: root-controlled deployment `e66ef86c-22cd-48cd-9ecb-61a9cd0f184d` proved the current exact-version route at 0%, then the installed RC's existing Host `authenticatedRequest` failed after 100% activation with typed `auth / Browser bearer transport is forbidden`. Production was immediately restored to old version `de0f267c-82f2-4c9c-9a98-fc7e91dbe9ef` at 100% and the new version at 0%; this ticket must preserve that rollback. No callable Sentry tool is available, so Sentry evidence is `NONE / UNAVAILABLE`; the exact canary response, Host transport source and focused Worker regression are the runtime evidence.
- Native seam: the existing managed identity boundary already confines the bearer to the exact Skill Hub HTTPS root and rejects caller authorization overrides. Its Node/undici fetch legitimately emits `Sec-Fetch-Mode: cors`; a real cross-origin browser bearer request supplies `Origin`, while `Sec-Fetch-Site` remains an additional browser fetch-metadata signal. The Worker must distinguish those existing signals once rather than change the Host client or add another authentication path.
- RED and root fix: the focused Worker test added the installed Host header shape (`Sec-Fetch-Mode: cors` without `Origin` or `Sec-Fetch-Site`) and failed exactly `403 !== 200`. The existing browser request keeps `Origin` plus fetch metadata and remains a typed `403 auth` with no CORS grant. The shared Worker guard now rejects only `Origin` or `Sec-Fetch-Site`; it no longer treats the mode header alone as browser authority. This is one-line repair at the first boundary that can distinguish the requests and adds no fallback, client shim, credential path or transport.
- Source evidence and ceiling: the focused regression is GREEN `1/1`; Worker syntax is GREEN and its full deterministic contract is GREEN `11/11`, including exact version, package, install-intent/session binding, completion/reconciliation, publication and tombstone paths. `git diff --check` and the change-impact contract pass. This is `source fixed` only: root still owns a fresh 0% version override, 100% activation/rollback decision and installed publish/search/detail/install/enable/invoke/restart/disable/enable/uninstall retest. No deployment, public Skill mutation, database/R2 operation, client rebuild, installer, candidate or pointer changed here.

## 2026-08-30 · 2.0.15 T07R3 Skill Hub restart inventory projection

- Baseline and owner: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T07R3-skillhub-install-persistence`, branch `fix/2.0.15-T07R3-skillhub-install-persistence`, exact source `527531f1bbd294c3e2df8b8e67b6cc46fe7103c2`, Base `e-mate-desktop-profile-v10-dsh-fccd7d25b3f1`, Harness `0.1.0-rc.7@fccd7d25b3f19885e2778c128b57d7c8312b7344`, and Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`. Sentry is installed, but this task has no configured `SENTRY_AUTH_TOKEN`, organization or project, so no read-only event query was available; no runtime event evidence is claimed.
- Installed evidence and root cause: `/Applications/e-Mate-2.0.15-RC-70ca40b67f.app` retained the exact Skill file and migration receipt for `t00-skill-smoke-20260830-b@0.0.1`; importing that app's installed Skill Hub component and calling its native inventory returned one ready installed item. The running app's real `/emate.skillHub` `inventory.list` RPC also returned that item and immediately changed the UI from `已安装 0` to `已安装 1`. Persistence and startup recovery therefore remained correct. The sole defect was `CapabilitiesPage`: its default `discover` tab never requested inventory, and both catalog-card and detail actions ignored the existing local list.
- Native seam and minimal fix: Creation Mode was unnecessary because the exact installed app, native receipt store, shipped RPC and both direct UI callers already proved the pinned seam read-only; a process-memory package could not add restart evidence. The permanent `@e-mate/dsh-plugin-skill-hub` client now hydrates the same `inventory.list` owner on discover cold-open and refresh, projects that list by slug, and uses one shared lifecycle action for the catalog card and detail dialog. Installed, disabled, recovery-pending and not-installed states stay on the existing lifecycle RPCs; no store, route, protocol, dependency, Worker or fallback was added.
- RED/GREEN and ceiling: the new cold-open regression was RED at `8/9`, observing `已安装 0` and an active `安装并启用`; it is GREEN at `9/9`, including the badge plus disabled installed action in both callers. The exact component build passes, and the existing native lifecycle suite is GREEN `17/17`. The change-impact contract is valid and classifies the final three paths through the current `base` lane with the Skill Hub portable component job; `git diff --check` passes. This is source/component evidence only: no candidate was built or installed, and same-app restart acceptance, update/rollback, publication and public Skill gates remain `OPEN` under T18/T00.
- T00 merge-review correction: the first source fix still let a fast catalog response render an active install action while the silent inventory RPC was pending, and an inventory failure left that fail-open state permanently. The same page now owns only a local `loading / ready / failed` projection: catalog cards and the detail dialog show disabled `正在核对安装状态` before success and disabled `安装状态读取失败` after failure; lifecycle actions appear only after a valid native inventory response. The existing ninth UI test uses a deferred response, then a failed response, and was RED `8/9` before this correction and GREEN `9/9` after it. The exact component build and native lifecycle `17/17` were rerun successfully; no new store, retry, transport or lifecycle owner was added.

## 2026-08-30 · 2.0.15 T26 artifact terminal lease

- Baseline and owner: sole Owner worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T26-artifact-terminal` on `feat/2.0.15-T26-artifact-terminal`, clean at exact current integration `bbecebe01f5fe4e936fee1b2c4d2ea99a7894e68`. The work-order baseline `origin/main@236aaa4f80598f07bf8f59848c217b9a60155d82` is stale and is not used. Current immutable source contract is Base `e-mate-desktop-profile-v10-dsh-fccd7d25b3f1`, Harness `0.1.0-rc.7@fccd7d25b3f19885e2778c128b57d7c8312b7344`, Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`, `desktop_api: 1`, and the exact 17-item runtime import union.
- Exclusive T26 path lease: the existing `packages/dsh/profile/plugins/emate-shell` image/artifact terminal projection and focused tests; the existing `desktop/e-mate-desktop` resource-action bridge, preload/runtime tests and Base contract only if focused RED proves the bridge changes the Desktop ABI; mechanically required retained-component Base bindings and their exact contract tests; and T26-only development/evidence records. T26 does not own ImageGen generation, Attachment/CAS, `emate/image-output` receipt production, `image_pack`, ZIP bytes/order, Harness/Desktop gitlinks, dependency locks, updater, publisher, R2, pointers, or release-candidate construction.
- Required first slice: verify the pinned native `conversation.chat.turnTail`, hidden Chat Node and session-scope hook seams with one temporary Creation Mode package, exercise the narrow live interaction, then remove the package before any permanent implementation. Permanent work must reuse the native `MessageImage`, deliverables/`openFile(path)`, draft-image action and Desktop `runResourceAction` owners, with no second store, router, transport, CAS, loader, protocol, DOM scan, Portal relocation, Observer or background task. Candidate, installed Computer Use and three-platform gates remain `OPEN` and T18-owned.
- Creation seam and cleanup: the installed native Host accepted temporary plugin `tseam-1`, package `pkg-1` and run `run-1` in session `session-t26-cordis-35e098cc-4fdd-4dcd-a79b-6afaeb635f1d`; its one approved run returned exact marker `T26_CREATION_SEAM_PASS`. The run was stopped and the package undefined immediately afterward; a fresh inspection found no T26 plugin, control, marker, listener or resource residue before permanent source work began.
- Root fix and owners: the Shell now claims the existing completed-Turn chain once at priority `-1`, joins only the closing Turn's ImageGen call provenance, same-Turn hidden latest-revision receipts and native deliverables, and renders native `MessageImage` plus the existing draft-image and `openFile` owners. The old DOM query/Portal/neighbor-hiding projection is gone. The one Desktop preload bridge accepts an exact closed action/resource shape, validates the owning Renderer, live session root, authorized workspace, canonical regular file, symlink containment and image bytes/MIME/32 MiB ceiling, then reuses native resource actions; bitmap copy stays memory-only and image files materialize only after an explicit save/reveal action.
- Honest Base successor: T26 creates source-only `e-mate-desktop-profile-v11-dsh-fccd7d25b3f1` with `desktop_api: 2`; the work-order suffix `1d3824bcd340` would contradict the actual pinned Harness `fccd7d25b3f19885e2778c128b57d7c8312b7344` and was deliberately not used. Harness, Desktop reference, Profile signing root, schedule floor, profile format and the exact 17-item ABI stay unchanged; all 15 retained components mechanically bind only v11, while v10 remains immutable predecessor evidence.
- Focused evidence: native Shell tests pass `26/26` and its source build passes; Desktop typecheck and four focused files pass `72/72`; DSH source build plus `artifact-open-boundary` pass `1/1`; release-boundary/change-impact plus Profile release contracts pass `29/29`; `check:target`, component inventory (`15 components / 19 jobs`), contract-only change impact, explicit changed-path classification (`lane: base`) and `git diff --check` pass. Sentry has no callable read-only tool in this task, so runtime evidence is `NONE`; the live seam, repository trace and local focused checks are the evidence sources.
- Evidence ceiling: no release candidate, installer, installed replacement app, viewport screenshot comparison, macOS arm64/macOS x64/Windows x64 Computer Use matrix, performance pairing, update/rollback, signature, R2 object, pointer or public readback was created. CU-00 through CU-19, three-platform composition and `docs/2.0.15/evidence/T26.json` therefore remain `OPEN` for the single final T18 local candidate; this source commit is at most `NARROW_TEST_PASSED` and must not be relabelled `INSTALLED_E2E_PASSED`.

## 2026-08-30 · 2.0.15 T26 closed-Turn and background-settlement correction

- Merge-blocker root cause: the first source slice could claim its terminal before the native Turn closed, and its direct `imagegen` marker could not admit T16's successful parent projection. The real idle-parent order also begins the settlement-notification Turn before `subagent/end` appends the projected receipt, so looking back for the original delegation would cross the Turn boundary and remain wrong.
- Minimal shared fix: the existing terminal selector now requires `TurnLocation.status === 'closed'`. The native turn-tail Owner optionally carries only its own ordered visible/hidden Chat nodes; only `TurnTailNodeView` computes that currency, while Assistant/file-mention callers keep their existing zero-scan path and the public Location Index remains unchanged. A strict synthetic `subagent-image:<sha256>` receipt is admitted only from the current Turn when its `child_session_id` matches that Turn's native `subagent-settled` source, or when that same Turn contains an exact native `subagent`/`subagent_fork` delegation. No receipt field, Session event, store, route, DOM scan or cross-Turn aggregation was added.
- Honest successor identity: T00 extended the T26 lease only to this focused native Harness commit/gitlink and its mechanical Base rebind; the Desktop gitlink remains unchanged. The required Owner seam produces Harness `f97e3814fe677b35e2c0a4cdaec70c1fc1c8e1f4`, so immutable Base v11 remains predecessor evidence and the source-only successor is `e-mate-desktop-profile-v12-dsh-f97e3814fe67`. `desktop_api: 2`, Desktop reference, signing root, schedule floor, profile format and the exact 17-item ABI are unchanged. All 15 retained components bind only v12. Advertised Harness reachability and every candidate/installed/public gate remain `OPEN` and T18-owned.
- RED/GREEN and ceiling: the open-Turn regression first rendered a terminal, the T16 projection regression first returned no image, and the real two-Turn idle-parent regression first returned `null` under delegation-only admission. The final Shell file passes `16/16`, native chat-view passes `47/47`, and both focused source builds plus `git diff --check` pass. No release candidate, installer, installed app, Computer Use sweep, update/rollback, signature, R2 object, pointer, push or publication operation ran.

## 2026-08-30 · 2.0.15 T26 native client type-contract correction

- Integration RED: after the exact Harness Host prerequisites were built, `tsc -b tsconfig.client.json` failed only at the T26 chat-view fixture with two `TS18048` diagnostics because `TurnTailOwnerProps.nodes` is intentionally optional for non-tail callers and the test asserted through it without a narrowing guard.
- Minimal fix and identity: the focused fixture now throws when the expected Turn 1 tail-node currency is absent, then performs the existing assertions on the narrowed value. No product logic, protocol, dependency, TypeScript configuration or skipped check changed. The test-only Harness successor is `d19aae6da3100e836867418c2cf73bdee8a0b1a8`; exact provenance therefore advances mechanically to `e-mate-desktop-profile-v13-dsh-d19aae6da310`, while v12/f97 remains immutable predecessor evidence and the Desktop reference plus 17-item runtime ABI stay unchanged.
- GREEN and ceiling: exact client typecheck and `build:lib:client` pass, and the focused native chat-view file passes `47/47`; target/component release contracts, inventory, change-impact and `git diff --check` are the outer admission gates. No candidate, install, Computer Use sweep, signing, update/rollback or publication operation ran.

## 2026-08-30 · 2.0.15 T26 Shell emitted-ABI correction

- Exact RED: the focused `component-run build --component @e-mate/dsh-client-shell` completed the native Shell build, then rejected its bytes because the manifest declared `@deepseek-ai/dsh-client-runtime` while the emitted import set did not contain it. All Shell source references to that package are type-only; the unchanged native `dsh.client.inject` list is lifecycle wiring rather than an emitted component import.
- Minimal shared fix: remove the one stale Shell `base_imports` entry and the same now-unconsumed key from the sole Base runtime-import union. No verifier was relaxed, no dummy runtime import was added, and no source, loader, injection, protocol, dependency or lock changed. Exact ABI provenance therefore advances mechanically to `e-mate-desktop-profile-v14-dsh-d19aae6da310`; v13 remains immutable predecessor evidence and Harness/Desktop identities are unchanged.
- Evidence ceiling: the focused Shell build/emit check, 43 release contracts, target, 15-component/19-job inventory, change-impact and `git diff --check` are the source gates. Candidate, install, Computer Use, signing, update/rollback and publication remain `OPEN` and were not run here.

## 2026-08-30 · 2.0.15 T25R2 authoritative local-flow hardening

- Baseline and boundary: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R2-local-flow-hardening`, branch `fix/2.0.15-T25R2-local-flow-hardening`, exact source `8ec0f666d5b7339a185ca86ce7398e2208e82d65`. This ticket changes only the existing local-flow/package-manager/Harness-provenance owners, their focused tests, repository instructions and this record. The separately produced candidate at the same source identity was not read, rebuilt, installed, imported, verified or published.
- Sentry boundary: these failures occur before an e-Mate runtime exists. The installed Sentry integration has no configured `SENTRY_AUTH_TOKEN`, organization or project in this task, and there is no relevant runtime event to query; evidence is therefore the retained local receipts/logs, exact source path and focused local reproduction.
- Root-cause matrix:

  | Evidence | Classification | Root cause and disposition |
  | --- | --- | --- |
  | `20260830T093908Z-0acce5335b33-e36bbe` | toolchain bootstrap | Harness used a PATH-resolved `pnpm` and stopped at `spawnSync pnpm ENOENT`. The current single owner already invokes the inherited pinned manager; candidate preflight now proves that manager before a run is created. |
  | `20260830T095207Z-58214caea27f-0b8761` | toolchain bootstrap | The upstream aggregate delegated through missing nested `npm`. The existing manager-free Host/Client/Web commands remain the only build path. |
  | `20260830T095637Z-6ee90450c337-832fd4` | source gate, correctly failed closed | Client `TS18048` was a real Harness fixture defect, not a packaging failure. The fixed baseline passes; the gate remains before components and Desktop packaging. Host typert declarations are native prerequisites, so the smallest valid order is Host build, Client/Web aggregate typecheck, incremental Client build, then Web build—there is no second generator. |
  | `20260830T102714Z-2d2fb79cc577-a1cbdd` | component ABI gate, correctly failed closed | Shell declared a stale Base import that emitted bytes did not use. The existing emitted-ABI owner remains strict and now has an explicit stage before Profile/Desktop packaging. |
  | cached fallback `pnpm@11.19.0`, no run | caller/toolchain bootstrap | A wrong manager is rejected before creating `dist/local-runs`; if Node itself cannot start, repository JavaScript cannot manufacture a receipt. The sole documented entry is now `corepack pnpm flow`, never a cached fallback or direct script. |

- Minimal hardening: candidate preflight checks exact `pnpm@11.7.0`, the existing Base/snapshot/release contract and a clean committed source before creating a run. The existing stages fail fast as `INVALID_TOOLCHAIN_BOOTSTRAP`, `SOURCE_GATE_FAILED`, `COMPONENT_ABI_GATE_FAILED` or `PACKAGING_FAILED`; persisted errors are redacted. A macOS failure or missing verified macOS bytes invalidates/removes any unverified Windows handoff and records `request_valid: false`, so no Windows work can be requested for non-product bytes.
- One route: `corepack pnpm flow candidate` runs once; only verified macOS bytes unlock the emitted Codex Remote request; the same run imports `--windows-result`, then executes `verify`, then `publish`. GitHub CI, a cached `pnpm.cjs`, a PATH fallback, direct `local-flow.mjs`, SSH and a second publisher are not alternatives. Harness install retains `CI=true`; a focused cold-worktree install without that existing flag reproduced the upstream lefthook worktree-config failure, while the exact flow setting passed.
- RED/GREEN: focused RED first proved the new failure/stage exports and early type commands were absent. Cold Harness validation also proved Client typecheck before Host typert emit is invalid; after the native Host prerequisite, Client passed and an immediate verbose repeat reported the whole graph up to date, confirming that the following Client build reuses TypeScript state and emits only once. Final focused checks pass `23/23` local-flow tests and `8/8` Harness-provenance tests; script syntax, exact release-boundary contract and explicit changed-path classification pass.
- Evidence ceiling: this commit is source/test/documentation hardening only. It does not replace or change the exact existing candidate, macOS/Windows installed acceptance, update/rollback, Computer Use, signing, public-object, pointer or production evidence. Full candidate, installation, Windows import, verify and publish remain outside T25R2 and were not run.

## 2026-08-30 · 2.0.15 T25R3 Windows pnpm argv contract

- Baseline and ordering: dedicated worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R3-windows-argv-contract`, branch `fix/2.0.15-T25R3-windows-argv-contract`, retains T25R2 `ca6a38872b94bb30daa736b359c057440338ae16` unchanged as its direct parent over frozen source `8ec0f666d5b7339a185ca86ce7398e2208e82d65`. The sole owner remains root `pnpm flow` and `scripts/local-flow.mjs`; no request command, wrapper, dependency, platform branch or second build path was added.
- Sentry boundary: this failure exits in the local CLI parser before dispatch or an e-Mate runtime. `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are all absent in this task, so there is no relevant Sentry event to query; the exact Windows argv/log and focused parser reproduction are the evidence.
- Root cause: the existing Codex Remote producer emits the standard pinned-pnpm command `corepack.cmd pnpm run flow -- _platform-build ...`, while the consumer passed raw `process.argv.slice(2)` directly to `node:util.parseArgs`. Windows Node 24.15/Corepack 0.34.6/pnpm 11.7.0 preserved the first two script arguments exactly as `"--"`, `"_platform-build"`; the parser then treated the delimiter as an extra positional and stopped at the usage gate before `_platform-build` dispatch. macOS Node 24.19.0 happens to consume the delimiter, so relying on platform-specific parser behavior left the producer and consumer contract inconsistent.
- Minimal shared fix: the one argv boundary now removes exactly one optional leading `--` before `parseArgs`. Direct `node scripts/local-flow.mjs _platform-build ...` remains valid, while a repeated delimiter remains unnormalized and rejected by the existing single-positional gate; unknown commands still reach and fail the unchanged command allowlist. Windows request bytes and prompt, option validation, source/clean gates, build dispatch and fail-closed receipts are unchanged.
- RED/GREEN: the new contract test was RED at `23/24` because no platform-independent normalization owner existed, then GREEN at `24/24`. It covers direct-node and standard pnpm shapes, repeated delimiters, unknown commands and the actual `argumentsFor` wiring. Syntax, explicit changed-path impact classification and `git diff --check` pass. This is source evidence only; no candidate, platform build, remote dispatch, installer, installation, update/rollback, signing, upload, pointer or publication operation ran.

## 2026-08-30 · 2.0.15 T15R3 managed Web Search credential provenance

- Installed evidence for candidate `8ec0f666d5b7339a185ca86ce7398e2208e82d65` showed the sole native `web_search` call sending a projected internal-proxy chat key to the fixed rc.7 `deepseek-official` target and receiving an invalid-key error. Sentry runtime lookup was unavailable because `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` were unset; no token was requested or exposed. The pinned `d19aae6da3100e836867418c2cf73bdee8a0b1a8` provider and the Profile both fix `https://api.deepseek.com/anthropic/v1` plus `deepseek-v4-flash`, so Creation Mode was not applicable to this enterprise policy defect.
- Exact RED: the focused Model Gateway contract expected an internal `deepseek` proxy route to return `searchCredentialGrant.status=unavailable` without reading its key, but the response was `granted` and contained that proxy key. The shared fix restores the existing non-callable `deepseek-web-search` route as the only grant source, binds it to `deepseek-official`, the fixed endpoint/model and an independent secret-file identity, and excludes it from Auth model ids, client credentials, proxy dispatch, catalogs and the five callable-route smoke. The released wire and local credential ref remain unchanged; callable DeepSeek chat routes can no longer grant search authority.
- GREEN: Model Gateway tests passed `92/92` with `8` environment/platform skips, Auth Gateway passed `14/14` with `8` integration skips, both package TypeScript checks passed, the focused RED passed after the fix, and the exact-path classifier returned valid `enterprise-only` with no Base/Profile/platform build. No Harness/Profile source, dependency, lock, build, candidate, installed app, production configuration, deployment or publication was changed. Official production search-secret provisioning, installed online search, rotation/revocation, update and rollback remain `OPEN` for their existing Owners.

## 2026-08-30 · 2.0.15 T25R4 macOS Node carrier contract

- Baseline and boundary: dedicated worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R4-node-carrier`, branch `fix/2.0.15-T25R4-node-carrier`, exact parent `ef188114371cef9981af3e15fa9ef324eead0619`. This ticket changes only the authoritative repository instructions and this record; it does not change product code, local-flow code, dependencies, locks, install scripts or candidate bytes.
- Sentry boundary: the failure occurred during local dependency installation before an e-Mate runtime existed. `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` were absent, so no runtime event was available; the exact local-flow receipt, loader error, signatures and direct native-addon probes are the evidence.
- Root cause: the invalid run used the ChatGPT-bundled Node `v24.19.0` on `darwin-arm64` to install Harness dependencies. Koffi `3.1.1` correctly selected its locked `@koromix/koffi-darwin-arm64@3.1.1` prebuild, but macOS rejected it because the hardened application Node and the non-platform addon had different Team IDs. Koffi then correctly fell back to a source build and reported missing CMake; that was a secondary error, not an ABI, lock or missing-prebuild defect. The app-bundled and standalone Nodes both reported modules `137` and N-API `10`, proving that version/ABI equality alone is not an admissible loader probe.
- Direct evidence: the same arm64 `koffi.node` passed `codesign --verify`, failed to load under the app-bundled Node with `mapping process and mapped file (non-platform) have different Team IDs`, and loaded as Koffi `3.1.1` under the standalone Node `v24.19.0`. The standalone Node carries `com.apple.security.cs.disable-library-validation`; the application Node does not. The earlier exact `8ec0f666d5b7339a185ca86ce7398e2208e82d65` local-flow log shows the same Koffi install finishing without source fallback. Xcode Command Line Tools, Apple clang and Make were already present; CMake was absent and unnecessary on the valid prebuild path.
- Minimal repository standard: macOS Corepack must itself be carried by a standalone Node that passes a real third-party native-addon load. A bundle-owned wrapper that forces an application Node is forbidden. When only the bundle's Corepack is available, the standalone Node may execute its Corepack JavaScript entry directly; the same carrier must prove `process.execPath`, Corepack startup, exact `pnpm@11.7.0` resolution and a platform-matched native-addon load before creating a run. No CMake/system install, skipped install script, rebuilt addon, lock edit, alternate pnpm or second flow owner is authorized.
- Verification and ceiling: the standalone carrier returned Corepack `0.35.0`, resolved pnpm `11.7.0`, projected the standalone `process.execPath` into the package-manager child and loaded Koffi `3.1.1`. Documentation diff checking and exact source/clean-state checks are the only gates for this ticket. No candidate, build, install, Windows Remote/SSH, verification, publication or production operation ran.

## 2026-08-30 · 2.0.15 T21R7 Skill Hub emitted-ABI correction

- Baseline and Sentry boundary: dedicated worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T21R7-skill-hub-abi`, branch `fix/2.0.15-T21R7-skill-hub-abi`, exact parent `d7ae46d70c8aaef2fe7f6e0798a7547da802aab2`. This failure occurs in the local emitted-component verifier before an e-Mate runtime exists; `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are absent, so no runtime event is available and the retained local-flow receipt plus emitted bytes are the evidence.
- Exact RED: run `20260830T145615Z-d7ae46d70c8a-df0bd7` failed closed at `component-emitted-abi`: `@e-mate/dsh-plugin-skill-hub portable; declared ["@deepseek-ai/dsh-client-ui-primitives","@deepseek-ai/dsh-skill-filesystem","@deepseek-ai/dsh-tools","react","react-dom"], emitted ["@deepseek-ai/dsh-client-ui-primitives","@deepseek-ai/dsh-skill-filesystem","@deepseek-ai/dsh-tools","react"]`.
- Root cause and native seam: T21R6 removed the Skill Hub Client's Portal/MutationObserver projection, so its runtime graph no longer imports `react-dom`, while the fixed `base_imports` declaration retained that stale value. Creation Mode is unnecessary because this is static package ABI metadata already proved directly by the strict emitted-byte verifier, not a runtime plugin behavior. The `react-dom` development dependency remains required by Testing Library, and the shared Base runtime import remains required by the Shell's real `createPortal` imports.
- Minimal correction and GREEN: only the stale Skill Hub `base_imports` entry was removed; the verifier was not relaxed and no dummy import, source, dependency, lock, Base ABI, injection or sibling component changed. The exact `component-run build --component @e-mate/dsh-plugin-skill-hub` rebuilt the component and accepted its emitted import set under standalone Node `24.19.0` plus pnpm `11.7.0`; the native lifecycle suite is GREEN `17/17`, and `git diff --check` is GREEN. The Client fixture remained environment-open before assertions: after generating the pinned Harness Host/Client prerequisites, the isolated package runner still stopped while resolving its external Harness/Shell fixture graph and reported `0 test`, so it is not claimed as passed and no product failure is inferred. Candidate, installer, installed behavior, Windows Remote, update/rollback and publication remain `OPEN` and outside this ticket.

## 2026-08-31 · 2.0.15 T25R5 Desktop npm collector carrier

- Baseline and owner: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R5-desktop-npm-carrier`, branch `fix/2.0.15-T25R5-desktop-npm-carrier`, exact parent `d85ab656c18e87eac3654700acb78c9f6f4fac63`. The single owner remains root `corepack pnpm flow` plus `scripts/local-flow.mjs`; no dependency, lock, Electron Builder patch, Desktop product source, second package manager, platform build path, installer or release schema changed.
- Sentry and native boundary: this is a local build-time process-spawn failure before an e-Mate runtime exists, and `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are absent, so there is no relevant Sentry runtime event. The Base contract remains `e-mate-desktop-profile-v14-dsh-d19aae6da310`, Harness gitlink `d19aae6da3100e836867418c2cf73bdee8a0b1a8`, and Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`. Creation Mode is inapplicable because the failing seam is the pinned Base packaging lifecycle, not the plugin plane; the existing Electron Builder `26.15.3` collector remains unchanged.
- Exact RED and root cause: frozen run `20260830T151340Z-d85ab656c18e-b60b7a` reached `desktop-package`, detected Yarn Berry `4.18.0`, then the app-builder-lib collector spawned `npm list -a --include prod --include optional --omit dev --json --long --silent --loglevel=error` and failed `spawn npm ENOENT`. The accepted standalone Node `24.19.0` intentionally contains no npm command. Earlier successful source `8ec0f666d5b7339a185ca86ce7398e2208e82d65` reached the same collector only because its inherited PATH happened to expose npm, so that success did not define a reproducible carrier contract. App-builder-lib explicitly accepts npm-list status `1` when stdout is a JSON tree; the live Desktop probe reproduced that exact status and JSON/`ELSPROBLEMS` behavior.
- Minimal shared fix: candidate preflight now resolves only a standard, already-installed npm CLI from the active Node distribution or the inherited Corepack package root, verifies its manifest/shebang/version, executes both `--version` and the exact collector list through the same standalone Node, and rejects wrappers or unrelated PATH commands before run creation. macOS Desktop install/package children receive one temporary directory whose `npm` and `node` symlinks target that verified CLI and Node; the exact spawn contract is reproved there and the directory is removed in `finally`. Windows keeps the existing native `npm.cmd` path only when `where.exe` resolves it beside the same `node.exe`. npm, CMake and new tooling are not installed; collector status handling, dependencies and locks are untouched.
- Focused evidence and ceiling: RED first failed because the carrier contract exports did not exist. GREEN passes the local-flow suite `27/27`, including pre-run missing-carrier rejection, real run-scoped spawn under the same Node, exact argument order, cleanup, wrapper rejection and the Windows colocated-command seam; script syntax, release-boundary contract, changed-path classification and `git diff --check` also pass. No candidate, Desktop package, installer, Codex Remote, installation, update/rollback, signing, Cloudflare mutation, pointer activation or publication was run. Build-time GitHub/PyPI dependency acquisition is not a client distribution path: installer download, online update and rollback remain exclusively Cloudflare R2-owned.

## 2026-08-31 · 2.0.15 T20R3 local R2 three-pointer CAS contract

- Baseline and owner: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T20R3-local-r2-pointer-cas`, branch `fix/2.0.15-T20R3-local-r2-pointer-cas`, exact parent `94a3e73717d0adbcc8f0e12f3795ea86dd3a7c97`. The sole changed production owner is `scripts/local-flow.mjs` with its focused contract test; no updater, Desktop, Cloudflare Worker, external signer, version, lock, candidate or release pointer changed. Creation Mode is inapplicable because this is the offline publication request/receipt boundary rather than a DSH plugin runtime seam.
- Sentry and production boundary: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are absent, and this pre-publication contract emits no e-Mate runtime event, so no Sentry evidence is available. T00 supplied the read-only current identities for `desktop/signed/latest.json`, `desktop/latest.json` and `desktop/manual/v2.0.15/latest.json`: each is `2961` bytes / SHA-256 `838115146f74e18de0fc90e3dc586f6bd5eab706a0e6dcbc27e6ad5a79c642fb` / ETag `61df621671e90dc90ce457494e09b295`. T20R3 performed no network read, R2 write, GitHub action, signing, build, installation or publication.
- Root cause and minimal fix: the local full-publication request still modeled the versioned manual manifest as create-only and accepted the obsolete `d26b9f...` predecessor for only the signed and legacy pointers. The one local-flow owner now treats all three fixed keys as conditional CAS pointers, binds the exact current bytes/SHA-256/ETag independently per key, activates strictly `signed → legacy → manual`, and rolls back strictly `manual → legacy → signed`. Every receipt pointer records exact before/after identity, CAS result, authenticated bytes/SHA-256/ETag readback and public full-byte readback; installers remain create-only immutable objects and `passed-macos-only` still cannot touch any pointer.
- Failure-closed recovery: only an exact predecessor or exact target is admissible. `already-exact` entries must be an ordered activation prefix, so the same request can resume after a crash while stale ETag, foreign bytes, out-of-order partial activation, mismatched authenticated readback and mismatched public bytes are rejected. No delete, unconditional put, arbitrary key, parallel publisher, new schema or target-payload inference was added.
- RED/GREEN and ceiling: the two focused tests first failed because `activation_order` was absent and the old two-pointer receipt shape rejected the new contract. GREEN passes the complete local-flow suite `28/28`, change-impact Owner suite `26/26`, script/test syntax, exact changed-path classification (`valid`, `base`, `release_verifier=true`) and `git diff --check`. A broader optional Profile/R2 test invocation stopped before assertions because this isolated worktree has no materialized `fflate` dependency; no dependency was installed and no product failure is inferred. Candidate, signing-authority availability, Cloudflare execution, authenticated/public production readback, installed update and rollback remain outside T20R3 and OPEN.

## 2026-08-31 · 2.0.15 T00R2 governance-contract re-audit

- Baseline and scope: dedicated worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T00R2-governance-contracts`, branch `fix/2.0.15-T00R2-governance-contracts`, exact clean parent `d80e56bb09f9181a8030c27ce569f986fb59f62f`. This governance ticket updates only the target/baseline/status/decision/regression contracts and the existing target-pin checker; it changes no product runtime, dependency, lock, candidate, installer, service, R2 object or public pointer.
- Sentry boundary: the globally enabled plugin had no `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` or `SENTRY_PROJECT`, so no runtime event was available. The defects were static contradictions between the current source owners and their authoritative documents; exact source, tests and public read-only identities are the evidence.
- Root cause and correction: successive T10R2, T21, T25 and T26 work advanced Base/Harness, audit classification, Goal/Plan actions, current-Turn artifacts and the local release route, while the top-level contract still described v10, first-Skill/first-Tool classification, Goal/Plan references, Assistant-step/Attachment-ID projection and the old public 2.0.13 pointer. One current override now records v14/Harness `d19aae6…`, old public 2.0.15 pointer identity, direct subagent/local-flow governance, the final-version blocker and the exact native semantics. Historical evidence remains append-only rather than being relabelled.
- Minimal guard and evidence ceiling: `check-target` now reads the existing Base contract once and rejects either a Base/Harness mismatch or a target contract missing the exact current Base id. The exact checker passes, script syntax and `git diff --check` pass. This is source/governance evidence only; version freeze, candidate, installed acceptance, trusted manifest signing, Cloudflare R2 CAS activation, update, rollback and public readback remain OPEN.

## 2026-08-31 · 2.0.15 T16R8 semantic Glass Composer host

- Baseline and lease: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T16R8-glass-host`, branch `fix/2.0.15-T16R8-glass-semantic-host`, exact parent `d80e56bb09f9181a8030c27ce569f986fb59f62f`. The lease is limited to the existing Glass Composer Client/CSS/contract test, the Shell Home CSS/composer contract test and this record. Harness remains the pinned clean gitlink `d19aae6da3100e836867418c2cf73bdee8a0b1a8`; no Base or gitlink change is required.
- Sentry and native boundary: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are absent, so no relevant runtime Sentry event can be queried. Creation Mode is not available in this task and is unnecessary: the pinned native `ConversationRoot` source directly proves exactly one `data-emate-composer-frame-host` on `composerStack`, while emitted Shell CSS and a real Chromium geometry replay prove its rendered boundary.
- Root cause and minimal fix: the Glass control used `control.closest(...)` to guess an ancestor and imperatively copied palette state onto that Host, splitting state ownership from the Shell-owned geometry. The existing semantic Host now owns the single shared `24px` boundary and positioning; the Glass control retains palette state on itself, and CSS declaratively projects it to that known Host with `:has(...)`. The ring inherits the Host radius. No second Host, Composer, DOM movement, scan, observer, route, store, dependency or fixed pixel offset was added.
- RED/GREEN: the focused Glass contract was first RED because the control lacked its palette attribute and still contained the `closest`/Host-dataset mutation. GREEN passes Glass build plus `1/1` contract, Shell build plus the focused composer file `6/6`, and `git diff --check`. A real Chromium replay of emitted CSS passes hero and active-conversation geometry in light and dark themes: Host/card/workspace edges coincide, Host/card/ring radii are `24px`, the ring inset is exactly `-2px`, reduced motion disables animation and palette `off` removes the ring. Optional broader Shell/Harness invocations stopped before assertions on unmaterialized isolated-worktree dependencies and are not claimed as passed.
- Evidence ceiling: this is source, component-build and browser-render evidence only. No application bundle, candidate, install, signed/unsigned package, macOS/Windows installed acceptance, update/rollback, Cloudflare R2 mutation, pointer or publication operation ran; those gates remain `OPEN` for final release acceptance.

## 2026-08-31 · 2.0.15 T20R4 rollback owner receipt closure

- Baseline and owner: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T20R4-local-flow-rollback-receipt`, branch `fix/2.0.15-T20R4-local-flow-rollback-receipt`, exact parent `d80e56bb09f9181a8030c27ce569f986fb59f62f`. The sole runtime owner remains `scripts/local-flow.mjs`; no second publisher, signer, uploader, R2 writer, dependency, lock, candidate, installer or version was introduced. This is a static local orchestration boundary, and `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are absent, so no relevant Sentry runtime evidence exists.
- RED and root cause: the focused rollback test first stopped at module instantiation because `validateRollbackReceipt` did not exist. The existing `publish --owner-receipt` path already validated and imported its Owner receipt, while `rollback` wrote only `rollback/cloudflare-owner-request.json`, set `awaiting-existing-owner`, and the CLI explicitly rejected `--owner-receipt`; therefore no valid same-run terminal rollback state was reachable.
- Minimal closure: the rollback request now declares the exact existing-Owner receipt contract. `rollback --run <run-id>` still emits the bounded request and writes no R2 state; after that sole Owner executes it, `rollback --run <run-id> --owner-receipt <path>` rereads and validates the exact publication request/receipt and rollback request, binds all three SHA-256 identities plus run id, version, source commit, pointer order, before/after identities, CAS result, authenticated/public readbacks, retained immutable objects and zero deletions, then atomically imports the receipt and marks that same run's `rollback.status` as `passed`. Missing, malformed, wrong-owner, cross-run, cross-source, cross-version, cross-request, reordered, partial-out-of-order or drifted readback evidence fails closed. The validator derives pointer count and order from the existing version-bound rollback request rather than hard-coding the current three-key plan. Rollback state is monotonic: `passed` cannot be downgraded, an awaiting run cannot return to dry-run, and a repeated request is accepted only when the existing request bytes and all bound digests are unchanged.
- Contract correction: `AGENTS.md` no longer declares that the legacy pointer remains permanently at 2.0.13. Version freeze must produce one exact version-bound transaction plan. A new version uses create-only/retained versioned manual bytes, shared `signed → legacy` CAS with legacy last, and `legacy → signed` rollback; a same-version 2.0.15 replacement is allowed only after an explicit user version choice through a named three-key exact-before exception plan that discloses same-version clients cannot online-update. T20R4 makes no 2.0.15/2.0.16 choice.
- GREEN and ceiling: the focused receipt/import and monotonic-state tests pass, the complete local-flow suite passes `31/31`, both script syntax checks, the release-boundary contract and `git diff --check` pass. This is source/process evidence only. No candidate was built, no Owner receipt was fabricated, no Cloudflare/R2 read or write occurred, and installed update, production rollback, public readback and final version selection remain `OPEN` for T18/T00.

## 2026-08-31 · T10R2 Usage Dashboard static production activation

- Source and scope: exact clean source `d80e56bb09f9181a8030c27ce569f986fb59f62f` already contained the accepted T10R2 enum labels. The existing package ran check, tests and Vite build under Corepack/pnpm `11.7.0` with `VITE_USAGE_API_BASE=/e-mate/enterprise-api/`. Sentry auth was absent, so no runtime event evidence was claimed. No source, version, dependency, lock, backend, database, Nginx, R2 or GitHub state changed.
- Activation: the four exact static files were installed at immutable `/srv/ecorex-agent-usage-panel/releases/usage-2.0.15-task-scenarios-d80e56b-544cbfe0a6d9`; `current` atomically switched from `usage-2.0.12-ledger-cohort-13e78546c993` to the new relative target. The old release remains intact for one-step symlink rollback. An initial upload carried six AppleDouble metadata files; the exact-file-set gate stopped before activation, the staging-only metadata was removed, and the four-file candidate was revalidated before the switch.
- Public readback: both `mvdcm.ecoremedia.net` and `dl.ecoremedia.net` return HTTP 200, index SHA-256 `75f72f6c2efd041736d682ab90e4a7a2d6ac5db581bb419baa28a4e192005221`, and actual `index-bioym5Wp.js` at `511470` bytes / SHA-256 `544cbfe0a6d96ac63f5b24a8c623560fa130f4c249a28a6c13f916628df6046a`. The live bundle contains `文字生成 / 文档处理 / 图片生成 / 搜索查询 / 未分类` plus the exact same-origin API base. Container and Nginx fingerprints were unchanged; the mode-0600 activation receipt SHA-256 is `9c83a37b81d48ad157d56097c541a55673017f74f096a2f1d8215123732acdbf`.
- Evidence ceiling: this closes only the version-independent Dashboard static bundle/readback. Authenticated T10R2 task ingestion, local outbox, service receipt, Postgres aggregation and real candidate counters remain an installed T18 gate.

## 2026-08-31 · 2.0.15 T20R5 version-bound R2 transaction plan

- Baseline and owner: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T20R5-version-bound-r2-plan`, branch `fix/2.0.15-T20R5-version-bound-r2-plan`, exact parent `bfe785de4d26539b5706115465e8d23107f7a8b8`. The sole runtime owner remains `scripts/local-flow.mjs` and its existing Cloudflare Owner request/receipt path; no second publisher, signer, origin, protocol, dependency, lock, candidate, installer, product version or R2 object changed. This is a static local orchestration contract, and `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are absent, so no runtime Sentry evidence exists.
- RED and root cause: the focused test first failed because no `buildReleaseTransactionPlan` export existed. The full publication path hard-coded one unconditional `signed → legacy → manual` three-pointer plan, so it could neither create/retain a new version's manual manifest nor require an explicit same-version exception. It also could not persist a version choice or bind that choice to the run, exact current three-pointer identity and Owner receipt.
- Minimal closure: an explicit `--version-choice` now binds one immutable run plan. `new-version` is accepted only above the current public `2.0.15`; it writes and reads back the new versioned manual manifest create-only, then CAS-advances shared signed and legacy pointers, while rollback restores only `legacy → signed` and retains manual/installers. `same-version-2.0.15-exception` is accepted only for exact `2.0.15`; it discloses `manual_reinstall_required_for_existing_2_0_15=true`, CAS-advances `manual → signed → legacy` from all three exact before identities, and rolls back in exact reverse order. Missing choice, version/plan/current identity/origin/order/request/receipt drift and out-of-order recovery fail closed. Both full and macOS-immutable requests/receipts bind the existing `R2_PUBLIC_ORIGIN` exact URL; no GitHub Release/Actions artifact or alternate client origin is admitted.
- Contract correction and evidence ceiling: the two stale `AGENTS.md` Harness references now match Base/gitlink `d19aae6da3100e836867418c2cf73bdee8a0b1a8`; no Base/gitlink/version changed. Focused RED became GREEN and the complete local-flow suite passes `33/33`; both syntax checks, target contract, change-impact contract/classification and `git diff --check` also pass. No candidate was built, no signer/Owner receipt was fabricated, and no R2 read/write, activation, installed update or production rollback ran. The independently identified schema-2 signer/client requirement for truthful local (non-GitHub) provenance remains `OPEN` for coordinated T20R6/T18 ownership; T20R5 does not synthesize GitHub provenance.

## 2026-08-31 · 2.0.15 T20R9 local publication manifest provenance

- Baseline and owner: dedicated worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T20R9-local-provenance-schema`, branch `fix/2.0.15-T20R9-local-provenance-schema`, exact parent `2fa3dbec5638e33e57aef488e033bc572e573a16`. The sole product owner remains the existing Desktop updater parser/signature verifier and its focused test. Base `e-mate-desktop-profile-v14-dsh-d19aae6da310`, Harness `d19aae6da3100e836867418c2cf73bdee8a0b1a8`, pinned Desktop reference `6074088f5b660206e404b3591fab51fb99c69add`, version, dependencies and lock are unchanged. Creation Mode is inapplicable because signed updater trust is a Base-only lifecycle boundary, not a Profile plugin seam.
- Sentry and RED: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are absent, and this is a static pre-runtime trust contract, so Sentry is `NO_EVIDENCE`. The focused RED rejected every correctly signed schema-v4 fixture as `check-signature-invalid`, proving the installed parser admitted only GitHub-provenance schemas 2/3 and could not truthfully consume future local-flow provenance.
- Minimal closed schema: schema 4 uses its independent `e-mate-desktop-release-manifest-v4\0` Ed25519 context and replaces only the provenance projection with exact `local_publication_provenance`. Its exact `emate.local-publication-provenance` object binds the existing local-flow run-id format, publication-request and manifest-input-ledger SHA-256 values, version, source, Base, real Profile aggregate SHA-256, and exact darwin/win32 installer URL/bytes/SHA-256 copied from the signed manifest. Both platform URLs still pass the one existing canonical Cloudflare R2 immutable-object validator. Paths, content, extra fields and GitHub identities fail closed. T20R7's pre-signing `emate.local-candidate-provenance` remains a distinct stage and is not accepted as client provenance. Schema 2/3 exact keys, GitHub admission and signature contexts remain readable and unchanged for existing R2 pointer rollback.
- GREEN and evidence ceiling: updater tests pass `74/74`; updater plus legacy manifest-producer tests pass `80/80`; exact source/test TypeScript checks and the existing Desktop `tsdown` build pass; `git diff --check` passes. No local-flow signer/generator, manifest signing, installer, candidate, install, network request, R2 read/write, pointer activation, update or rollback ran. The later production admission Owner must generate/sign schema 4 from the frozen ledger/request and real Profile aggregate. Existing schema-2/3 clients cannot parse schema 4, so the one-time old-client bootstrap/compatibility transition remains explicitly `OPEN` for T18.

## 2026-08-31 · 2.0.15 T20R10 local Profile production-signing preparation

- Baseline and Owner: dedicated worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T20R10-local-profile-signing`, branch `fix/2.0.15-T20R10-local-profile-signing`, rebased onto exact clean integration parent `a2817bee5004e311da20573139bc581161e1be46`. The existing `local-flow.mjs` request/ledger verifier, `profile-release.mjs` composition, `publish-profile-r2.mjs` signing/publication and `desktop-admission.mjs` aggregate Owners remain the only algorithms; no second parser, signer, publisher, origin, dependency, version or lock was added. Sentry credentials are absent, so this static pre-publication contract has `NO_EVIDENCE` rather than a claimed runtime event.
- RED and root cause: the focused test first failed because `prepareLocalSignedProfilePublication` did not exist. The production Owner accepted only an ephemeral candidate plus numeric GitHub run provenance, while the sole current local flow emits a content-addressed request/ledger identity and correctly refuses to fabricate GitHub ids. As a result, valid local native outputs could not reach the existing production signing, publication-bundle or component-aggregate algorithms.
- Minimal closure: one network-free entry now requires the existing `EMATE_PROFILE_SIGNING_PRIVATE_KEY`, derives its exact Base-trusted key id, and fails before input reads or output creation when authority is missing. It loads the canonical run through the local-flow Owner, requires the canonical publication request path and recorded digest, deep-compares the request with `buildPublicationRequest`, and delegates all binding, ledger, platform receipt, component payload and candidate-provenance closed-set validation to `verifyManifestInputLedger`. Only the committed-clean source and checked-in Base/inventory byte binding remain local. The existing composer emits production-signed candidates, the existing publisher re-verifies those signatures and writes only canonical R2 URLs into a local bundle, and the existing aggregate Owner recomputes a schema-v2 local-provenance aggregate. Historical schema-v1 GitHub plans and the four-field client aggregate remain byte-shape compatible.
- Evidence and ceiling: missing-key RED is GREEN; the complete publication suite passes `4/4`, including canonical path/digest enforcement, equal-length request/ledger tamper rejection, extra GitHub-field rejection, production signatures for all three targets, no `ci-ephemeral`, GitHub URL or GitHub run fields, schema-v2 aggregate/plan provenance equality and R2-only URLs. The combined publication/admission suite passes `16/16`; the complete local-flow suite passes `35/35`; change-impact passes `26/26`. Three workflow-YAML cases initially stopped before assertions on this isolated worktree's unmaterialized `yaml` link, then pass against the existing read-only dependency closure. Changed-script syntax checks and `git diff --check` pass. No real production key was available or used, no production envelope for e-Mate was generated, and no installer, network, R2 write, activation, Desktop manifest signing, installation, update or rollback ran; those gates remain `OPEN`.

## 2026-08-31 · 2.0.15 T20R12A schema-2 compatibility attestation carrier

- Active slice and Owner: dedicated worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T20R12A-schema2-attestation`, branch `fix/2.0.15-T20R12A-schema2-attestation`, exact clean parent `418eb7617bcd2387304675ce73a8185ad8343266`. This slice owns only the existing local-flow publication handoff plus one legacy compatibility-attestation control-plane carrier; it does not own or modify the external signer. Creation Mode is inapplicable because this is a static Desktop publication-trust boundary, not a Profile plugin seam. `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are absent, so Sentry is `NO_EVIDENCE` and not a runtime diagnosis.
- Intended invariant: final verified DMG/EXE bytes first reach source-scoped immutable canonical Cloudflare R2 keys through the sole Cloudflare Owner with create-only-or-already-exact semantics and authenticated/public full-byte readback. Only an exact first-stage receipt may unlock a machine-readable schema-2 compatibility-attestation request. GitHub may then materialize those exact R2 bytes as a three-file compatibility-attestation control-plane carrier for the accepted 2.0.13 parser. That artifact contains installer bytes, but it never builds, tests, signs, publishes, writes R2, switches pointers or serves users, and canonical R2 remains the sole client data plane. Signing and pointer activation remain later external-signer and Cloudflare-Owner gates, and no production action occurs in this slice.
- RED and root cause: the first focused test saw the full publication request still combine signing and pointer activation with immutable R2 writes, so a truthful GitHub carrier could not exist before the legacy schema-2 signer required its provenance. After that split, the existing local Profile signing preparation RED exposed a second stale consumer: it still required `publication/cloudflare-owner-request.json` plus `awaiting-existing-owner`, which no real run could produce. The fix keeps one contract at the existing local-flow Owner: stage 1 emits and validates an exact two-installer immutable R2 request/receipt; local Profile preparation imports the same exported canonical path and exact `awaiting-immutable-owner` state; only a stage-1 receipt may then unlock the digest-bound compatibility request. The run advances monotonically to `awaiting-compatibility-attestation` and cannot treat the stage-1 receipt as a released terminal state. The former manual/signed/legacy CAS, exact-predecessor and rollback contracts remain intact as the later `buildActivationRequest`/final receipt boundary and are unreachable until exact immutable plus real carrier evidence passes.
- Blockmap boundary: this two-object projection follows the real client download path rather than the build bundle. At the accepted 2.0.13 product source `6f63b5238d5874a1973a5ce0c1c9f832d277c865`, the updater admits the exact ten-field unsigned schema-2 manifest, projects each platform artifact to the installer `{url,bytes,sha256}`, and `update-download.ts` performs one full-byte GET only for `artifact.url`; the package also fixes `nsis.differentialPackage=false`. Current 2.0.15 retains the same one-installer download and full-byte integrity check, with no `electron-updater`, `autoUpdater` or blockmap read in the runtime path. Verified blockmaps may remain build/signing evidence, but they are neither schema-2 carrier files nor client update data-plane requests.
- Minimal closure: the first-stage request and receipt bind exact run/source/version/transaction, request digest, canonical R2 origin, two fixed installer keys, bytes and SHA-256, with create-only-or-already-exact and authenticated/public full-byte readback. The second-stage request binds both stage-1 digests, the two derived R2 URLs and identities, protected-main workflow/ref/attempt 1, exact artifact name and exact candidate/DMG/EXE file set. The manual workflow accepts only frozen hashes/bytes, derives URLs from the fixed R2 origin and release identity, rejects redirects by requiring direct HTTP 200, verifies both downloads byte-for-byte, invokes the existing candidate creator with the actual `GITHUB_RUN_ID`, and uploads only the three non-hidden files. It has no submodule recursion, dependency install, build, test, signing, R2 credential/mutation or pointer path.
- GREEN and evidence ceiling: the complete local-flow plus local Profile publication suite passes `43/43` (`39` + `4`); Desktop release-manifest/updater tests pass `80/80`; Desktop admission passes `12/12`; change-impact passes `26/26`; the workflow YAML/static contract, both changed-script syntax checks and `git diff --check` pass. No candidate or installer was built, no workflow was dispatched, no GitHub API provenance or external signature was fabricated, and no network, R2 read/write, pointer activation, installation, update or rollback ran. Import of the external compatibility-attestation/signing receipt and final activation remain explicitly `OPEN`; the current local flow stops fail-closed at that handoff.

## 2026-08-31 · 2.0.15 T20R12D protected signer transport active slice

- Baseline and Owner: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T20R12D-signer-transport`, branch `fix/2.0.15-T20R12D-signer-transport`, exact parent `d47d1ab01518f55b96ff2a24358bec583158b1b5`. The sole orchestration Owner remains `scripts/local-flow.mjs`; the existing `desktop-publication.yml` remains the sole protected production-key workflow, and canonical Cloudflare R2 remains the only installer/Profile download, online-update, rollback and activation data plane. Creation Mode is inapplicable to this static release-trust boundary. `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are absent, so Sentry is `NO_EVIDENCE` and does not block the static contract work.
- Verified root gap before implementation: T20R12A stops at `awaiting-compatibility-attestation`; its pure activation builder still accepts caller-supplied compact stage evidence, while no state can seal a protected-signing input, import a signer result or reach the final activation Owner. T20R10 production Profile preparation additionally requires the exact local run ledger, three-target current Profile snapshot and production key, and its full publication bundle duplicates every component payload; that full bundle must not become the GitHub result. The protected signer therefore needs a deterministic, byte-bound control input with no installer duplication, credentials, user data or absolute paths, followed by a compact result containing only the three production-signed desired-state envelopes, Profile aggregate/plan metadata, and the external schema-2 Desktop signer's exact three files. Local import must recompute every Profile component object from the original run rather than trust copied payloads.
- Initial safety boundary: the repository has only the public canonical R2 origin. The control object may therefore contain only explicitly allowlisted, future-public Profile inputs plus cryptographic bindings for private/local receipts; an unsafe field, path, credential-like key or unallowlisted file fails before a Cloudflare Owner request is emitted. This slice will not dispatch a workflow, use a production key, write R2, activate a pointer, build or install an application. All candidate, signer execution, Cloudflare receipt, installed update/rollback and public-readback gates remain `OPEN`.
- RED and root-cause closure: the first transport fixture proved the old monolithic state had no route from the compatibility receipt to final activation. Static workflow review then found that the exact extracted run lives under `RUNNER_TEMP`, while Profile composition previously required output below the repository; that made the protected signer impossible even with valid inputs. The shared composer now accepts one explicit trusted output root, and the existing local Profile Owner binds it to the already-verified run root while still requiring a named, committed-clean exact source. The production fixture now moves the complete run outside the repository before signing, proving the workflow layout rather than a repository-local approximation.
- Sealed input and signer boundary: local flow scans and hashes every allowlisted public-control file through the same regular-file descriptor, rejects credentials including API/access/refresh tokens and client secrets, and passes the approved byte count/SHA-256 into the deterministic streaming bundle. The bundle rejects symlink ancestors, unsafe/duplicate paths, size overflow and any scan-to-copy identity drift, then the Cloudflare request binds its content-addressed canonical R2 key and full authenticated/public readbacks. The post-bundle dispatch request is deterministically recreated from exact late request/receipt descriptors; local flow never dispatches it. The protected workflow is attempt-1 protected `main`, pins checkout/setup-node/upload-artifact and the external schema-2 action to full commits, exposes the production key only to the two signing steps, downloads canonical R2 with direct HTTP 200 and size/hash caps, and uploads exactly ten compact control files with no installer or Profile component payload.
- Import and activation boundary: local import requires the exact ten-file result plus a separate designated GitHub-API Owner receipt. Both compatibility and signer receipts now require API artifact digest/bytes to equal the downloaded archive SHA-256/bytes, in addition to exact run/head/attempt/job/artifact/file-set and non-production state. The receipt is still externally owner-mediated JSON: the local validator binds its contents but cannot prove the caller actually queried GitHub, so real API collection remains `OPEN` rather than being relabelled as completed. The existing Profile Owner validates the compact plan before copying, reconstructs only in temporary storage from original local components plus three signed desired states, recomputes the aggregate, cleans on success/failure, and gives the final Cloudflare Owner only canonical-R2 component/activation objects plus imported signed metadata. The final receipt binds the exact Desktop bytes/statuses and Profile readbacks; rollback remains unavailable until that receipt passes and then preserves the existing reverse CAS contract.
- Evidence ceiling: Sentry remains `NO_EVIDENCE` because this is a static pre-runtime contract and no Sentry credentials are present. Focused local-flow plus signing-control tests pass `48/48`; Profile publication plus Profile composition pass `6` with the one intentionally skipped missing-Harness-toolchain case. No real production key, GitHub API Owner receipt, protected workflow run, Cloudflare receipt, R2 read/write, pointer change, candidate, installer, installed update or rollback was executed. Those production and installed gates remain `OPEN`.

## 2026-08-31 · 2.0.15 T25R6 local-only release governance

- Baseline and Owner: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R6-local-only-ci`, branch `fix/2.0.15-T25R6-local-only-ci`, exact parent `d821dd08e43e1d1272a81abfa2ec56de16ad762e`. The repository already declared `corepack pnpm flow` as the sole test/build/release operator, but `.github/workflows/ci.yml` still invoked the historical build/test graph automatically for pull requests and `main` pushes, while remote branch protection still required its `CI admission` check. That contradicted the accepted local-only flow and could force an unrequested second build path.
- Minimal closure: the historical CI graph remains available only through explicit `workflow_dispatch`; its automatic `pull_request` and `push` triggers are removed. The existing local-flow contract test now rejects either trigger. GitHub remains limited to the manual compatibility carrier and protected signer control-plane workflows; installers, Profile objects, client downloads, online update and rollback remain canonical Cloudflare R2 data-plane operations only. The matching remote protection change removes only the stale required `CI admission` context while retaining protected-main pull requests, linear history, conversation resolution, admin enforcement and force-push/deletion prohibitions.
- Evidence boundary: this governance change builds no product bytes, runs no GitHub workflow, signs nothing and writes no R2 object. Source tests and the exact remote protection readback are recorded separately; candidate, installed and public release gates remain `OPEN`.

## 2026-08-31 · 2.0.15 T25R7 pinned-pnpm lifecycle carrier

- Baseline and Owner: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R7-pnpm-carrier`, branch `fix/2.0.15-T25R7-pnpm-lifecycle-carrier`, exact parent `15aa97f946d9411af9760cafeab9992ed7db571b`. The sole implementation Owner remains `scripts/local-flow.mjs`; no package script, dependency, lock, component source, CI, installer, publisher, updater or version changed. This is a pre-runtime local process-spawn failure, and no Sentry runtime event exists (`NO_EVIDENCE`).
- Exact RED and root cause: frozen candidate run `20260830T231958Z-15aa97f946d9-ff78bd` reached `component-emitted-abi`, where the fixed inherited pnpm entry successfully launched `component-run.mjs`, but Office Skills' legitimate nested `pnpm run prepare:assets` resolved through the lifecycle shell and failed `sh: pnpm: command not found`. Direct Node invocation of `npm_execpath` covered only the parent process; it never made pnpm a child-lifecycle PATH command. Patching that one package would leave every sibling package script and the local `dev` component lane broken.
- Minimal shared root fix: local flow now derives the exact verified `pnpm@11.7.0` entry and active standalone Node once, creates one mode-private temporary lifecycle carrier, and prepends it to every development/platform child environment. POSIX uses an executable Node carrier plus the exact Node shim; Windows uses the equivalent run-scoped `pnpm.cmd` and requires `where.exe` to resolve that directory first. Every carrier invocation binds the real Node path and the pnpm entry's bytes/SHA-256 before delegation; wrong versions, entry replacement, unsafe Windows command paths, wrong PATH resolution and missing nested command resolution fail closed. The pnpm and existing npm carriers are both removed through the same platform-build `finally`, and development cleanup also runs on pass or failure.
- RED/GREEN and evidence ceiling: the focused test was initially RED because the shared carrier export did not exist. GREEN passes the complete local-flow suite `47/47`, including PATH-without-pnpm nested package execution, exact version, same-version byte drift rejection, Windows command-location/escaping seams and temporary-directory cleanup; both changed scripts parse and `git diff --check` passes. No candidate retry, package build, installer, Windows Remote/SSH, installation, signing, GitHub workflow, R2 write, pointer activation, update or rollback ran. Client installer download, Profile objects, online update, rollback and activation remain canonical Cloudflare R2-only data-plane operations.

## 2026-08-31 · 2.0.15 T25R8 manifest Profile input scope

- Baseline and evidence: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R8-manifest-input-scope`, branch `fix/2.0.15-T25R8-manifest-input-scope`, exact parent `15aa97f946d9411af9760cafeab9992ed7db571b`. Candidate run `20260830T231958Z-15aa97f946d9-ff78bd` correctly failed closed at `COMPONENT_ABI_GATE_FAILED:manifest-input-ledger` when the staged Profile tree contained the Shell test fixture `/Users/private/report.pdf`. This is a static pre-runtime build gate; Sentry credentials are absent and Sentry is therefore `NO_EVIDENCE`.
- Root cause and minimal shared fix: the ledger was not scanning an unrelated source tree. `stage-desktop-profile-artifact.mjs` copied the entire nested `emate-shell` development package into `profile-artifact`; that exact tree is hashed by the Profile build receipt and later consumed by Profile signing/publication aggregation. The sole staging Owner now excludes every inventory-declared nested Profile package from the broad Profile copy and restores only its existing `package.json.files` runtime closure through the shared `componentFiles` allowlist. The host Profile's compiled files and external component `lib` staging remain unchanged; the absolute-path/credential/canary scanner remains strict and unmodified.
- RED/GREEN and ceiling: the focused fixture first proved that `tests/private-path.spec.js` entered the staged artifact, then passed after the package allowlist fix while retaining `package.json` and built `lib/client.js`. The complete release suite passes `16/16` using the same-baseline read-only dependency closure after the isolated worktree's first environment-only `yaml` miss; the manifest-input binding/path-drift test and unchanged pollution gate pass `2/2`. `git diff --check` passes. This ticket did not rerun candidate, build an installer, install, sign, write R2, activate a pointer or publish; candidate and production evidence remain `OPEN` for the release Owner.

## 2026-08-31 · 2.0.15 T25R9 local release shift-left

- Baseline and failure chain: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R9-local-release-preflight`, branch `fix/2.0.15-T25R9-local-release-preflight`, exact parent `15aa97f946d9411af9760cafeab9992ed7db571b`, with the reviewed T25R7 lifecycle carrier applied before this incremental fix. Frozen run `20260830T231958Z-15aa97f946d9-ff78bd` first reached the Office Skills nested lifecycle without a PATH pnpm, then its same-source environment retry reached `manifest-input-ledger` only after the component/Profile/native-input/Desktop-install stages and rejected a Shell test fixture that broad Profile staging had incorrectly admitted. Both failures are local pre-runtime evidence; Sentry credentials are absent, so Sentry is `NO_EVIDENCE`.
- Root causes and existing coverage: T25R7 binds the exact inherited pnpm entry and standalone Node through one run-scoped child-lifecycle carrier, while T25R8 narrows the sole Profile staging Owner to each nested component's existing `package.json.files` closure without relaxing the pollution scanner. The remaining process gap was in `flow dev`: a Profile staging change is correctly classified `base`, but that lane added only `test:fast`, which does not contain the changed `scripts/release.test.mjs`; the new cheap runtime-closure regression could therefore be skipped before the expensive candidate.
- Minimal shift-left fix and ceiling: `devChecks` now schedules every changed `scripts/*.test.mjs` once, before preserving the existing lane check. A base-lane staging change therefore runs the changed release regression and still runs `test:fast`; `release.test` was not added globally to `test:fast`, the classifier and candidate stage order are unchanged, and no second flow Owner was created. The focused RED proved the old base plan returned only `test:fast`; GREEN passes local-flow `47/47`, the change-impact contract, both changed-script syntax checks and `git diff --check`. No candidate, component build, installer, installation, GitHub workflow, R2 operation, signing, pointer change, update or rollback ran; candidate, installed and public truth remain `OPEN`.

## 2026-08-31 · 2.0.15 T09R5 real bundled-Reader update contract

- Baseline and evidence: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T09R5-reader-attestation`, branch `fix/2.0.15-T09R5-reader-attestation`, exact parent `d938be8c1b74b5164132a57b39670e5b6b9ba0fb`. The real installed 2.0.13/Base-v7 Reader accepts only schema 1, v1 signing context, performance admission and two provenance roles, so it rejects the public schema-2/v2 pointer. The actual candidate-packaged 2.0.15 Reader accepts that same public schema-2 manifest and returns `up-to-date`; with a strictly signed 2.0.16 successor it returns `update-available`. This is a static release-trust defect and Sentry credentials are absent, so Sentry is `NO_EVIDENCE`.
- Product decision and root fix: 2.0.13 and existing same-version old 2.0.15 migrate through the one official Cloudflare R2 manual page. No schema-1 compatibility feed, fabricated performance evidence, second updater or downgraded validator is introduced. The sole 2.0.15+ client feed remains `desktop/signed/latest.json` schema2/v2 with the existing external signer, one `desktop_candidate` provenance role and no performance field. The candidate carrier is named for its actual provenance-only job. The protected signer now extracts the real packaged Reader from the exact candidate DMG for a same-version replacement or the exact frozen public-predecessor DMG for a later version, executes it against the final signed manifest, and emits a compact fail-closed attestation. Local import verifies that attestation before producing any activation request.
- Pointer correction: `desktop/latest.json` is frozen as a pre-2.0.15 bootstrap/manual-migration surface. Current replacement and future transactions read and bind its predecessor identity but explicitly leave it unchanged. Manual publication precedes a CAS of only `desktop/signed/latest.json`; rollback includes only signed/manual writes actually made. The official download-page copy and staging validator now state the manual migration boundary and reject the former false 2.0.13 in-app-update claim.
- Evidence ceiling: focused RED proved the old three-pointer plan, false carrier statement, missing bundled-Reader gate and false download copy. Focused GREEN covers the new transaction, workflow/static contract, download-page contract and Reader verifier. No installer was built, no protected workflow was dispatched, no R2 object or public pointer was written, and no website was deployed. A fresh candidate plus real protected-signer run and Owner receipts remain required before activation.

## 2026-08-31 · 2.0.15 T18R9 Windows SSH-first transport contract

- Baseline and evidence: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T18R9-win-codex-ssh`, branch `fix/2.0.15-T18R9-win-codex-ssh`, exact parent `2613761b012f2aa06082831f534e43512a451180`. This is a static local release-script boundary; `SENTRY_AUTH_TOKEN` is absent, so Sentry is `NO_EVIDENCE` and does not block the contract repair.
- Root cause and RED: the sole Windows request/result seam hard-coded Codex Remote host `DESKTOP-KH19ARC` in the request producer, native hostname gate, result producer/import expectation and protected-signer public control allowlist. It could neither express the authorized SSH alias `win-codex` with actual hostname `LAPTOP-ADQ973JN` nor prove that a returned host matched its selected transport. Focused RED failed at all four shared boundaries.
- Minimal root fix: the existing request now contains one exact ordered route contract: preferred `ssh` via alias `win-codex` only for actual hostname `LAPTOP-ADQ973JN`, then fallback `codex-remote-handoff` only for `DESKTOP-KH19ARC`. Both carriers execute the unchanged request-owned `corepack.cmd pnpm run flow -- _platform-build ...` command and return the existing exact directory/result schema. Native build, result generation, local import and signer public-control validation all reject unlisted hosts and mismatched host/transport pairs; no SSH/SCP process runner or second builder was added.
- GREEN and evidence ceiling: focused routing/import/signer tests pass, and the complete local-flow suite passes `47/47`. This ticket runs no candidate, installer build, SSH or Codex Remote command, installation, signer workflow, R2 operation, pointer activation, deployment or publication. Candidate, installed and public evidence remain `OPEN` for their existing Owners.

## 2026-08-31 · 2.0.15 T25R10 bounded Python Runtime download retry

- Baseline and evidence: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R10-python-runtime-fetch-retry`, branch `fix/2.0.15-T25R10-python-runtime-fetch-retry`, exact parent `7b1c664e4f748edd27836011b28c2fdd99309ddf`. Frozen local run `20260831T023611Z-7b1c664e4f74-7854e9` spent about 39 minutes reaching `desktop-package`; after the first pinned Python asset completed, the second asset's single fixed-GitHub fetch failed at the 10-second connect boundary with `TypeError: fetch failed` and exact cause `UND_ERR_CONNECT_TIMEOUT`. This is a local pre-runtime packaging failure; Sentry credentials are absent, so Sentry is `NO_EVIDENCE`.
- Minimal shared fix: the sole `prepare-python-runtime.mjs` download Owner now makes at most three attempts only for an explicit allowlist of fetch, DNS, connect, socket and response-stream network codes, removing any partial archive between attempts. The existing fixed release, asset names, GitHub URLs and SHA-256 values remain authoritative. HTTP non-OK or missing-body responses are never retried; successful bytes still pass the unchanged SHA-256 check before extraction, so a hash mismatch, archive error, missing interpreter or local filesystem failure remains fail-closed. No cache, dependency, parallel download, alternate origin or second builder was added.
- RED/GREEN and ceiling: the focused Node test first failed on the exact nested `UND_ERR_CONNECT_TIMEOUT`, then passes `2/2`, proving transient recovery, the three-attempt ceiling and single-attempt HTTP 503 failure. Both changed scripts parse, the change-impact contract and `git diff --check` pass. No real asset was downloaded, no candidate or installer was built, and no CI, GitHub workflow, R2, signing, installation, update, rollback, deployment or publication ran. The main release Owner must rerun the failed exact local candidate scenario before advancing candidate truth.

## 2026-08-31 · 2.0.15 T25R11 Windows npm selector

- Baseline and evidence: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R11-windows-npm-selector`, branch `fix/2.0.15-T25R11-windows-npm-selector`, exact parent `53eaaea50b63a490f3193d16caba4aeeca14d65e`. On the authorized Windows host with Node v24.15.0 in `C:\\Program Files\\nodejs`, `where.exe npm` returned the standard extensionless `npm` shim before the same-distribution `npm.cmd`; the selector read only the first nonempty line and rejected the valid bootstrap. This is a static local toolchain boundary, so Sentry is `NO_EVIDENCE`.
- Minimal root fix: the sole local-flow selector now ignores basenames other than `npm.cmd` and `npm.exe`, then validates the first allowed candidate against the normalized `node.exe` directory. This admits the standard extensionless-first Node layout without weakening PATH shadowing: a wrong-directory allowed candidate still fails immediately even if a later same-directory command exists. No PATH, host, Node or npm installation changed.
- RED/GREEN and ceiling: the focused case first failed on the exact extensionless-first output and is now GREEN; the complete local-flow suite passes `47/47`, both changed scripts parse, the change-impact contract and `git diff --check` pass. No candidate, Windows build, SSH/Remote command, installer, CI, R2, signing, installation, update, rollback or publication ran; the release Owner must rerun the failed exact Windows build before advancing candidate truth.

## 2026-08-31 · 2.0.15 T25R12 portable component-script shell

- Baseline and root cause: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R12-component-shell`, branch `fix/2.0.15-T25R12-component-shell`, exact parent `fadb25a4aae5d568db6b48d29361c4d0f8844dff`. The exact `win-codex` build reached `component-emitted-abi`, then native `cmd.exe` interpreted a retained component's POSIX relative `.bin/tsdown` package script and rejected `..`; source inspection found the same forward-slash command shape and `rm -rf` across sibling components. This is a local pre-runtime build failure, so Sentry is `NO_EVIDENCE`; Creation Mode cannot represent the Base-owned package-script shell boundary.
- Minimal shared fix and Windows proof: the sole `component-run.mjs` Owner now passes pnpm 11.7.0's built-in `--config.shell-emulator=true` only to component `run build` and `run test`. Component installs and the find-skill upstream install retain their byte-for-byte native lifecycle semantics. The existing inherited pinned-pnpm carrier, direct-Node launch, exact version check and per-component scripts remain unchanged; no package script, dependency, Git Bash, PowerShell or platform branch was added. Before the source edit, the same clean Windows repo and exact HEAD ran the emate-shell relative `.bin/tsdown` build successfully with that one option, and both the root and Harness submodule were clean before and after.
- RED/GREEN and ceiling: the focused contract first failed because component script execution omitted the emulator and is now GREEN, while its negative assertion keeps install invocations native; the adjacent pinned-version/order contracts pass `4/4`, both changed scripts parse, explicit changed-path classification remains fail-closed to the Base lane, and `git diff --check` passes. Office Skills' only nested component build step is a pure Node asset copier reached inside the emulator-owned outer script and continues to use the existing pinned pnpm PATH carrier. No candidate, installer, full component sweep, Desktop build, CI, R2, signing, installation or publication ran; T18 must continue the already materialized Windows workspace through the remaining batch gates and perform the one final build only after all findings are integrated.

## 2026-08-31 · 2.0.15 T25R13 Harness provenance path oracle

- Baseline and RED: dedicated clean worktree `/Users/mac/e-mate/worktrees/emate-2.0.15-T25R13-harness-provenance-paths`, branch `fix/2.0.15-T25R13-harness-provenance-paths`, exact parent `fadb25a4aae5d568db6b48d29361c4d0f8844dff`. The Windows batch `flow dev` passed Harness install/build and reached `test:fast`, where `scripts/harness-provenance.test.mjs:162` was the sole failure (`9/10`): its oracle compared native `\\`-separated `relative()` output with fixed `/`-separated package paths. This is a static local-test failure, so Sentry is `NO_EVIDENCE`.
- Root cause and minimal fix: `findDesktopHarnessPackages()` intentionally returns native absolute paths. Its two production callers use those paths for filesystem work and already convert relative paths with `split(sep).join('/')` before Git arguments or provenance serialization. The test was the only direct caller that omitted that boundary, so the oracle now applies the same one-line normalization; no product owner, traversal, ordering, dependency or platform branch changed.
- GREEN and ceiling: the focused discovery regression passes `1/1`; the changed test parses, the Harness provenance owning suite remains otherwise unchanged, explicit changed-path classification stays fail-closed to the Base lane, and `git diff --check` passes. No Harness rebuild, candidate, installer, Desktop build, CI, R2, signing, installation or publication ran; the parent batch sweep remains responsible for continuing the already prepared Windows development gates.
