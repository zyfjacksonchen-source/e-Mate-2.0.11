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
