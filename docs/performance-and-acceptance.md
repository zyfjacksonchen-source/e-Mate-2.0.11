# Performance and acceptance

This document is a release gate for e-Mate 2.0.12. A scenario is `passed` only with commands, screenshots or traces, immutable IDs, and the observed result. Missing enterprise accounts, credentials, platform capabilities, or real external targets are `blocked`; mocks cannot close a production acceptance item.

## Core browser and performance gates

- Cold local Web LCP is at most 2.0 seconds and interactive time at most 2.5 seconds.
- Installed-app startup has an absolute 15-second ceiling. For an unauthenticated launch, stop the clock only when the login form is visible, AX-readable and clickable; AURA is part of the statically bundled login module and is mounted eagerly, with no dynamic import, CDN fetch or login-time asset download. WebGL readiness must not block form interaction. Existing clean/warm startup budgets remain stricter and still apply.
- INP p75 for typing, model selection, navigation, dialogs, and sidebar actions is at most 100 ms.
- At 30 real events per second for 60 seconds, event-to-paint is p95 at most 50 ms and p99 at most 100 ms.
- A 5,000-event session scrolls at an average of at least 55 fps, uses at most 300 MB JS heap, and has no steady-state main-thread task above 100 ms. Frame-drop percentage is diagnostic evidence only and is not a release gate.
- Opening and closing 20 sessions grows retained heap by at most 10%.
- A Shell adapter that observes the conversation DOM must process only the changed marker subtree. Unrelated streamed-token `childList` mutations must not cause a document-wide selector scan; the component behavior test is the repository gate for this hot path.
- Chrome Performance Trace (gzip is accepted when the uncompressed SHA/size remain in the metrics receipt), React Profiler summary, fixed replay dataset, viewport, build SHA, Node/browser version, and before/after figures are retained per release.

### Harness parity for response and Tool latency

Run paired samples on the same machine, browser, network, provider model, prompt set, Tool fixture and warm/cold state: pinned Harness `0.1.0-rc.7` is the baseline; e-Mate uses a valid cached login lease, the same locally cached model policy and asynchronous audit outbox. Use at least 30 successful samples per path and retain raw timings.

- first response/TTFT adds at most 5% at p50 and 10% at p95, with an absolute allowance of 50 ms when that is larger than the percentage allowance;
- steady streamed generation throughput (provider output tokens per second, excluding TTFT) is no more than 5% lower at p50 and 10% lower at p5; the low tail is the slow side of a throughput distribution;
- persisted Tool-call event to real Tool start, and Tool-result persistence to the next model request, each add at most 50 ms at p95 and no more than 10% versus the target baseline;
- repeat the paired run with the enterprise endpoint unavailable while the login lease and last valid model policy remain valid. Local execution must stay within the same budgets, the audit outbox may remain pending, and no response/Tool event may be duplicated;
- new login, expired/revoked lease and invalid model policy are correctness failures and are measured separately; they must fail closed and are not included in the steady local-runtime latency sample.

If provider or network variance makes a paired sample incomparable, discard both members with the same documented reason and rerun; do not average unrelated providers, models or time windows into a passing result.

`pnpm performance:parity --fixture --output <receipt.json>` is an explicit collector/evaluator self-check. It runs the pinned Agent Loop and derives timings only from its real `user/message`, `assistant/chunk`, `assistant/message`, `tool/call`, and `tool/result` events plus the real Tool body/request boundaries. It creates 30 paired samples for baseline, online, and enterprise-unavailable-with-valid-cache cohorts, deliberately reports `fixture-passed-production-blocked`, and exits non-zero: the deterministic provider does not load the e-Mate Desktop/Profile and cannot prove production latency. Omitting both `--fixture` and `--input` is an error.

A production `--input` can report `passed` only when every cohort supplies an immutable run receipt bound to the pinned Harness commit, approved identity digest, exact provider/model/Tool/dataset, identical machine/OS/architecture/Node/browser/network environment, start/finish times, raw sample-ID/sample digests, and two existing artifact files: the raw samples and a Provider invocation/usage receipt or trace. The baseline must identify the pinned original `deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add`; both e-Mate cohorts must identify the same candidate source commit, Base contract, Profile generation, component-composition digest, and client-bundle digest. Each e-Mate path additionally supplies a verified enterprise-runtime receipt that binds the cached lease, model policy, and audit outbox, with online/offline using the same lease and policy. The evaluator reads and SHA-256 verifies every artifact relative to the input receipt. Relabeling a handwritten fixture, setting a JSON verification flag, using the same runtime for baseline and candidate, or omitting any artifact stays blocked and exits non-zero.

## Project memory isolation and binding

Use two real Harness workspaces A and B with distinct canonical directories and one ungrouped session.

1. Write a uniquely identifiable project memory in A, run the selected `memory-evolve` path, and prove the evolved memory is recalled in a new A session.
2. Open B and the ungrouped session; prove neither can search, recall, evolve, mutate, or enumerate A's facts.
3. Write equivalent facts in B and prove A cannot see them.
4. Rename A through the Harness workspace action; prove the stable workspace binding and recall remain intact.
5. Move or remove A's directory outside e-Mate, then attempt a project-memory read/write; it must fail closed and must not fall back to B, process cwd, or global memory.
6. Attempt to replay a session header or legacy import receipt against the wrong workspace ID/path; the mutation must be rejected and both scopes must remain byte-for-byte unchanged.
7. Re-run legacy CowAgent import; deduplication receipts must prevent duplicate facts and source files must remain unchanged.

Evidence records workspace IDs, canonical-path fingerprints, session IDs, memory item IDs, migration receipt IDs, before/after hashes, and the exact failure code. It does not record memory contents that contain user secrets.

## Complete UI action closure

Build an inventory from every visible page and state in `docs/ui-fidelity-map.md`: login, agreement gate, Home, sidebar, conversation, capability center, Skill Hub, artifacts, connections, settings, model selection, approvals, errors, updates, and account actions at 320/390/768/1280/1920 px.

For every link, button, menu item, row action, input, switch, tab, dialog action, drag/drop target, download, and keyboard shortcut:

- identify its real Harness slot/service/RPC/Tool/Job action;
- trigger it through Computer Use;
- observe pending state when applicable, one terminal success/error/cancel result, authoritative state reload, refresh persistence, and keyboard/focus behavior;
- prove double activation is fenced or idempotent;
- prove failure never shows success and an unknown plugin uses the generic safe renderer.

An empty callback, `href="#"`, console-only action, local fake timer, dead menu item, invisible error, non-working close/back action, or a button that only changes browser-local state is a release failure. Decorative affordances must not have button/link semantics.

## Password change, logout, and re-login

Use a dedicated enterprise acceptance account and preserve the existing e-Mate contracts:

1. Login with the current password; record the account ID, auth revision, local lease digest, login generation, and server receipt without recording the password or token.
2. Submit one password change with a unique client request ID. The response must be `{schema_version:1,status:"changed",reauthentication_required:true}` and all existing account leases must be revoked.
3. Refresh and invoke an authenticated action with the prior lease; it must fail as expired/revoked. Local execution already running under the valid pre-change lease may only finish according to the established identity boundary; it cannot silently obtain a new lease.
4. Logout/return to login. The old password must fail and increment only the server's protected rate-limit/audit path; no plaintext or password-derived value may appear in e-Mate logs or audit payloads.
5. Login with the new password. It must return a later generation, load the current multi-model policy and agreement receipt, and permit a real local conversation.
6. Replay the password-change client request ID with the same payload to prove idempotency; reuse it with a different payload to prove conflict handling.

The production endpoint and acceptance account are external prerequisites. Without both, this section remains `blocked`.

## Registration, approval, administration, and remembered login

Use a fresh source identity and two browser contexts; never reuse production personal data outside the authorized acceptance tenant.

1. Issue a registration challenge and prove its image, challenge ID and expiry came from the enterprise provider. Wrong, expired and replayed codes fail; source/account rate limits activate without leaking whether an account already exists.
2. Submit account, mandatory real name and a 10–256 character password. The receipt must be `pending_approval`; refresh and login must remain blocked, and no password/token may appear in browser storage, logs or audit.
3. In the existing administrator workspace, list and read the pending user. Approval with zero/missing weekly Token allowance or missing model policy must fail. Set both, approve, and prove the auth revision changed.
4. Login once without “保持登录”; verify the signed account status and weekly allowance, then prove ordinary lease expiry requires reauthentication. Login with “保持登录”, close only the browser, reopen through `e-mate launch`, and prove the Host restores the still-valid OS-keystore lease without browser token persistence.
5. Update the real name and weekly allowance and prove the new projection/lease is authoritative. Disable the user and prove every active lease is revoked. Re-enable only with a positive allowance, then soft-delete and prove login, challenge-to-activation shortcuts, usage mutation and record resurrection all fail.
6. Exercise administrator create/read/update/delete compatibility and duplicate/replayed client-request IDs. Every mutation must have an administrator audit record; the management API must expose no local plugin, Tool, session or Job operation.
7. Exhaust and reset the weekly Token window using provider-reported immutable usage facts. The exact accepted/rejected request and the usage panel counter must reconcile; local non-model browsing of existing sessions remains available while new model calls fail with the quota reason.

Evidence includes registration ID, challenge expiry (not code), account/auth revisions, allowance policy version, lease/receipt digests, administrator audit IDs, usage fact IDs and screenshots of both user and administrator terminal states. Production captcha, administrator API, rotated credentials and authorized acceptance identities are external prerequisites; without them this section remains `blocked`.

## Usage and audit-panel reconciliation

Create a fixed acceptance batch containing one chat response per allowed chat model, one non-fallback image, one fallback image when the service can deterministically force it, one failed/cancelled task, and a duplicate outbox replay.

For every terminal provider fact, reconcile the same immutable identity through five stages:

1. Harness durable session/Job event containing provider-reported usage.
2. Local `emate.audit` outbox row and payload SHA-256.
3. Enterprise ingestion receipt/idempotency result.
4. Existing immutable provider-usage ledger and account counter delta.
5. The row and aggregate rendered by `https://mvdcm.ecoremedia.net/ecorex-agent/usage-panel/`.

Compare source service/ID, account and organization, usage kind, input/output/total tokens or image count, provider timestamp, requested/provider-reported/actual model, provider, fallback source/flag, Job/result status, product generation `emate`, product version `2.0.7`, payload hash, and fact ID. Duplicate delivery must create no second ledger row or counter change. A conflict, missing row, unsettled outbox item, aggregate-only match, or panel mismatch fails acceptance; it cannot be waived because the total happens to match.

Before production access, the local automated gate must prove that one real target `agent/request` plus one provider-sourced `assistant/message` creates exactly one hashed outbox fact, replay creates none, a missing binding is `blocked`, provider failure leaves the fact pending, and a later exact receipt marks it delivered once. It must also prove that prompt/answer text and raw session/account identities are absent. This closes only the local projection/outbox contract; it does not pass enterprise ledger or usage-panel reconciliation.

## Computer Use evidence set

The release evidence covers the following end-to-end user journeys:

- model selection changes the actual next provider route while preserving the same conversation context; upstream instability and weak-network interruption recover through the existing retry/reconnect path without duplicate user messages, assistant answers, Tool calls, usage facts, or audit receipts;
- the composer, navigation and non-message product chrome keep their accepted e-Mate references, while the conversation stream itself is exercised against the pinned Harness Message, Retry, TurnStatus, Tool, Disclosure and Actions renderers. The earlier `019ff665-d721-79a0-869d-338f086cf529` and 2.0.4/2.0.5 custom message-flow projections were explicitly withdrawn; only the real attachment image gallery remains as an e-Mate message visual exception;
- image generation and editing cover one generation, one edit, concurrent jobs, attachment/context ownership, and a measured step-up run that records the maximum stable concurrency before the first bounded rejection or degraded budget; the caller still cannot choose the image model;
- DOCX/XLSX/PPTX/PDF create-read-edit-export-reopen, OCR/Vision, CDP browser search/interaction/download, GenUI and the selected Sidebar execute through their real target paths;
- Feishu, Tencent Docs, WeChat and DingTalk must be discoverable by the user and Agent, open the correct connection surface, and reach the provider's real authorization handoff. The 2.0.7 release gate stops before submitting a real OAuth consent, QR confirmation, credential or external write;
- non-deleted legacy sessions remain visible and can continue, project/general-session memory remains isolated, and Skill Hub cross-user publish/search/download/install uses the target plugin path;
- installation, same-version repair, cross-version upgrade, rollback protection, shortcut single-instance behavior and CLI status/stop/check are exercised. A user can request an update in natural language; e-Mate must recognize the intent, execute the existing managed npm update transaction, restart/recover, report success, and preserve sessions, credentials, audit outbox and version/integrity receipts.

Office, OCR/Vision and browser rows close only with the selected bundle's real result; installed metadata is not evidence. Vision/OCR remains `blocked` until the enterprise model-policy seam passes a governed request. CDP acceptance must prove the DSH-native adapter binds explicitly configured loopback Chrome/Edge endpoints to distinct Sessions without state crossover, routes mutations through target approval, performs no browser download, and recovers and cleans up after disconnect. Each platform remains `setup-required` until its own run passes.

The 5,000-event reverse-scroll frame-drop percentage is retained in traces only as a diagnostic. It has no pass/fail threshold and cannot by itself block S04 or S12; the FPS, heap, long-task, event-to-paint and leak budgets above remain binding.

Each run stores the starting database/snapshot identity, exact test data, screenshots, trace/artifact paths, relevant audit/fact/receipt IDs, cleanup result, and one of `passed` or `blocked`.

## 2.0.7 上线前真实验收清零表（2026-08-16）

以下只把真账号、真上游、真持久化或真平台结果标记为通过；单测、Mock、CI 构建和元数据安装不能替代对应的真实验收。

### 已真实通过

- macOS arm64 本地安装、受管 profile、登录/注册/审批/协议、管理员免签、改密后旧租约失效与新密码重新登录。
- Luna 默认模型、Luna/Sol 同一会话切换与上下文连续；生产直连后 Luna 短回复 TTFT 中位数 4.074 秒，Sol 样本 2.807 秒。
- 生产五路上游 Model Smoke：Luna、Sol、DeepSeek、Doubao、`gpt-image-2-pro`。
- 验收账号重新登录后真实回读 Luna、Sol、DeepSeek、Doubao 四个聊天模型和 Image Pro 图片能力，Luna 保持默认；单次生图、基于上一张 Session attachment 的自然语言改图、Harness Job、CAS Attachment 与 ImageGallery 均通过。重启后立即改图也通过，不再出现同账号刷新窗口的策略缓存误报。
- 本地真实 Usage outbox 到生产账本：一条 15,040 Token 事实成功入账，重复上送返回相同 receipt 且不重复计数；服务端现只对 `auditreceipt_` task 强制终态。历史 21 条旁路 task 已原子补齐 deterministic usage ID 并全部转为 `FINALIZED`，0 条 audit task 留在 `ACCUMULATING`；18 条正常聚合/Provider pending task 未被误改。
- 新 Luna 审计 task 首次写入即为 `FINALIZED`；图片成功调用也已在响应前终结，生产新图片 task `image-ed01...` 同时在 Usage 明细显示 `ACCOUNTED`。只精确补齐本轮修复前的两条已知图片 task，其他旧任务未批量修改；四项对账差异继续为 0。
- Harness 真实任务事件到生产任务账本：一个无工具 Luna turn 精确产生 `RECEIVED / FIRST_RESPONSE / COMPLETED` 各 1 条，本地 outbox 为 3 delivered / 0 pending，生产管理员事件次数为 3、`GENERAL` 任务为 1；Host 重启回放后生产计数不变，Usage 面板逐项显示且四项对账差异仍为 0。
- 管理端与 Usage 面板真实管理员登录、用户审批/额度/模型策略/协议状态、Luna 联通测试、明暗主题和退出登录。
- 图片上游生成/编辑与并发阶梯：并发 2、4 稳定；并发 8 为 5/8 成功并出现 3 次 429，因此 2.0.7 的已测稳定上限固定为 4，不再重复烧并发 8。
- 已发布 macOS 2.0.7 桌面制品完成 DOCX/XLSX/PPTX/PDF 创建与重新读取，四个产物通过格式完整性检查并在终态显示可点击产物；这关闭 macOS 当前规范化 Office 闭包，不替代复杂第三方版式或 Windows 实机。
- 已发布桌面制品完成 Luna 图片理解/OCR、飞书/腾讯文档/微信自然语言路由至真实授权前步骤，以及单次 `gpt-image-2-pro` 生图。外部连接按验收边界停在输入凭据或扫码确认之前。
- 桌面发布 run `32070025595` 从提交 `fc1828941b9d49d12dd32fadbab6b67e52599ca4` 生成 macOS universal DMG 与 Windows x64 Setup.exe，同一不可变清单已激活到 R2；macOS 安装态下载、登录、Luna、图片画廊和同版本自然语言更新回读通过。
- 2026-08-18 生产账本复核：最近 48 小时 `216` 个模型任务中 `214` 个已入账、`2` 个为另一旧验收用户的历史 pending；当前验收账号对应用户的 Luna 与 `gpt-image-2-pro` 分组均为 `pendingRequests=0`。四项 reconciliation 差异继续为 `0`，该用户任务账本为 `49 RECEIVED / 40 COMPLETED / 2 FAILED / 4 CANCELLED / 128 TOOL_EXECUTION`，总事件 `270`。

### 发布阻断：尚未真实通过

| 优先级 | 项目 | 当前真实状态 / 关闭条件 |
|---|---|---|
| P0 | CDP / Computer Use | 旧浏览器扩展与 Browser Panel 已删除，CDP 已实现为 DSH 原生 Tool/approval/session 插件；仍缺 macOS 与 Windows 已安装浏览器上的 loopback endpoint、会话隔离、交互、断连恢复真机证据。Computer Use 还必须分别验证 macOS TCC 与 Full Access 原生策略。 |
| P0 | Windows 真实安装 | Windows x64 Setup.exe 已由原生 GitHub runner 构建和校验，但不能替代 Windows 10/11 真机；安装、CDP endpoint、DPAPI、自然语言更新、Office/图片和卸载保留数据仍待跑。 |
| P0 | 跨版本在线升级与恢复 | R2 桌面发布、macOS 安装态同版本自然语言检查与真实 `up-to-date` 回执已通过；仍缺一个更高版本候选上的真实安装、失败回滚、活动任务拒绝和 Windows 恢复证据。 |
| P1 | Vision / OCR | 当前企业 Luna 图片理解已在发布桌面通过一张真实中文图片；独立 `dsh-vision-toolkit` 仍不进入闭包，复杂 OCR、批量图片和 Windows 侧没有单独验收，不能把一次模型视觉结果扩大为本地 OCR 工具闭包。 |
| P1 | Office 复杂版式与 Windows | macOS 已发布制品的四格式规范化创建/读取已通过；复杂第三方文档无损编辑、Office 全场景和 Windows 打开/预览仍待真实样本。 |
| P1 | 外部连接 | 飞书、腾讯文档和微信已由 Agent 走到真实授权前步骤；按产品边界不提交 OAuth、二维码确认或真实写入。钉钉仍需在当前发布制品中重复同一授权前 handoff。 |
| P1 | Skill Hub | 上传、搜索、下载、安装和 Agent 自执行已有合同测试；仍需生产服务和两个真实用户验证跨用户可见与安装。 |
| P1 | 旧会话与项目记忆 | 本机真实三类来源已完成 copy-on-write：15 条 e-Mate 权威非删除会话首次导入、复跑 15 条全复用、源哈希不变且旧 Tool 未伪造成新事件。仍需登录后在浏览器确认 15 条可见并任选一条继续真实模型对话；实际来源没有项目会话，项目/通用记忆隔离仍需另一个真实项目 fixture。 |
| P1 | 弱网与上游恢复 | 原生重试、checkpoint、审计幂等已有自动化；仍需受控断网/重连下验证上下文连续且消息、Tool、Usage、Audit 不重复。 |
| P1 | 性能成对验收 | 已有真实样本但未完成相同机器、相同提示、相同模型的 30 组原始 DSH Desktop rc.7 与 e-Mate 对照：TTFT 看 p50/p95，生成速度看 p50/p5，Tool 调用延迟看 p95；证据还必须绑定实际安装的 Base/Profile/组件组合。 |
| P1 | 最终响应式与全按钮闭环 | 当前交付形态已改为 rc.6 Desktop；需在 macOS 与 Windows 安装态分别复验主窗口缩放、明暗模式、二级弹层空白关闭和全部可见按钮闭环，不再把旧 rc.5 浏览器五断点当作桌面发布门槛。 |
| P1 | Session Share | 当前保持失败关闭；生产 create/list/get/revoke、公开 URL、到期和撤销未有有效租约与真实无敏感 fixture 验证。 |
| 合同风险 | 严格零超额 | 本地持久预留可阻止有限额度并发超额，但单个请求仍可能超过开始时剩余额度；若上线要求绝对零超额，仍需上游单请求精确上限。 |

Linux、Gemini 和 5,000 条会话反向滚动掉帧率不属于 2.0.7 发布阻断：Linux 不支持，Gemini 已按产品决定移除，反向滚动掉帧只保留诊断数据。

### 后续高效验收顺序

1. 日常变更只跑受影响包的一个聚焦回归、必要的 TypeScript/build 和 `git diff --check`；不重复跑未触及平台的全套测试。
2. 一个切片稳定后只在该提交 SHA 跑一次组合 CI。CI 通过后复用同一制品，不在部署阶段重新构建。
3. 候选部署只替换受影响服务，记录前后容器 ID、健康状态和回退收据；只跑该路由的一次真账号/真上游 canonical smoke。
4. 付费和慢测试集中到发布候选：图片只跑 1、2、4 并发；性能用固定 30 组数据；Windows/macOS 真机、npm、R2、Office、Browser 各跑一次。
5. 主代理执行 Computer Use。失败项按一个根因一个子代理修复，主代理只重跑失败场景及最近邻回归，不从头重复整套。
6. 所有结果绑定同一账号、Session、项目、fixture、commit、制品 SHA 和 receipt；缺真实环境就明确 `blocked`，不使用 Mock 关闭真实验收项。
7. 任务审计回归优先用一个无工具短 turn：预期固定为 3 个事件，可同时验证本地 outbox、生产 PG、Analytics 汇总、Usage 用户事件列和重启幂等，避免为事件计数重复跑付费工具场景。
8. Web 验收先从浏览器回读实际入口脚本 hash，再核对真实 Nginx alias；不要只验证容器内静态目录。API 四路均为 200 时，直接用同一共享 parser 对真实响应做一次无敏感诊断，避免重复登录和盲目重试。
