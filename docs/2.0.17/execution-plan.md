# e-Mate Desktop 2.0.17 execution plan

## Locked baseline

活动来源锁定为 e-Mate `f876f01d8280e4ab20fe83b88c36c7fe7a662135`、Harness `4da69d7c3522ee51de12822c917c503a124f7a7d`、唯一 Desktop reference `anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add` 和 `pnpm@11.7.0`。被拒绝的上传参考仅记录在 `baseline-lock.json.rejected_references`。EM217-501 通过前保持 2.0.16，之后才由 EM217-407 改版本合同。

## Ownership and WIP

The main agent is sole integrator, builder, installer, releaser, and rollback owner. WIP is at most 6. Tickets merge in dependency order; overlapping broad write sets are serialized in `work-orders.json`. Subagents do not install, build, package, install, publish, push, clean, or decide gates.

## Required W0 decision

EM217-002 固化已接受的 pinned-spawn：effect-scoped consume-once gate、model-hidden descriptor-label nonce、normalized args、spawn/shared CAS。child 只校验 descriptor mode/provider/nonce 与自身 Session parent；parent 在 link/flush/open 前要求 run.localAgent!==undefined 且 exact run.id=run.localAgent.id=claimed child。顺序必须为 parent created（含 effective concurrency）flush → child register/start → parent identity check → exact task link flush → open/provider；child Session flush → inspect one terminal receipt/Job → parent task-state flush → quiescent dispose/refill，任一 flush false/reject 均 fail closed。EM217-101 仅交付由 focused test 直接执行的 internal request normalizer/ID/schema，EM217-102 仅交付由 focused test 直接执行的 internal event reducer/projection；两者都不注册 model-visible Tool、不产生 public event、不修改 agent-operations/Tool Search/audit。EM217-103 是第一次原子公开激活：在 complete pinned-spawn gate、durable producer、可用 new-image execution/result 同时成立后，才在同一 ticket 注册 image_batch 并更新 agent-operations、既有 Tool Search visibility/aliases 和 canonical image-generation audit classification；禁止 disconnected registration、unused UI/state 或 placeholder endpoint。EM217-104 仅在同一 owner 内强化 live-child concurrency/refill/cancel。EM217-105 当时实现 parent CAS 与 exact Attachment refs/IDs gate、child receipt owner 不变、userQuestions 路由 parent、提问前 child revision 2 flush、回答后 revision 3 flush，且 review 全程占槽，之后才启用 source edit/fusion；parent userQuestions 不可用则 provider 前拒绝且不得永久 needs-review。上述确认流程已由 EM217-109 覆盖：新生图、改图与融合零确认，只产生 completed revision 2、semantic not-applicable；历史 revision-2 needs-review/revision-3 reviewed receipts 仅只读兼容，不恢复旧确认链。parent CAS、Attachment refs/IDs 与 same-source 校验仍保留。EM217-106 只做 parent exact link → existing child projection，不扩展 child receipt metadata。EM217-107 永不自动恢复/重试 one-shot task：created/unlinked=interrupted/not-submitted，linked/nonterminal=unknown，只有 existing child terminal receipt 可在 provider POST=0 时 reacquire/project/finalize。`image_batch` 仍是 `@e-mate/dsh` 内唯一实现，不建第二 scheduler/store/RPC。

## Single-image latency gate

EM217-108 只在 EM217-107 与 EM217-202 完成后实施，owner 为 IMG、sanitized evidence 由 QA 验证。Pinned rc.7 没有 native image-generation Tool，因此不得宣称 native imagegen parity；固定 comparator 是同一 in-process 25 ms fake provider response 加一次真实 pinned rc.7 `LocalAttachmentStore.saveImage` 的 pinned-owner lower bound，对照 assembled direct `imagegen` Tool/Job/receipt/projection。两臂使用相同 prompt SHA、request body、response bytes，禁止网络、product sleep/flag、next LLM turn 与 provider network variance。Direct one-image 必须 zero subagents/batch events、exactly one Job/POST/CAS save/terminal receipt，ordinary success zero retry/wait。Warm small/max 每 fresh process 20 warmups + 60 ABBA pairs，cold small/max 各 15 fresh-context pairs，0/256 receipt history slope 30 pairs，重复三个 fresh processes，每次 nearest-rank p95/p99 全部通过；阈值、fail-closed sanitized manifest 与独立 macOS dev cached-byte first-visible p95 ≤ 500 ms 由 `contracts/single-image-latency.md` 定义。只有 measured failing stage 可在后续修改 `image-generation.ts`；若已 green，仅交付 test/evidence。主代理已在 source commit `734da986d6bdc5c4dd8452a5ed29c1ce466a4a72` 执行三次 fresh-process full benchmark，全部通过且 network_calls=0；本地结果为 SOURCE_PASS_PENDING_EXTERNAL_EVIDENCE。external immutable raw URI+SHA-256、独立 macOS dev GUI first-visible、installed 与 production evidence 仍保持 OPEN，本地测量不替代这些门。

## Shared file import

EM217-307 由 `UI/shared-file-import` 所有，精确依赖 EM217-004 与 EM217-404，并在 EM217-501 前完成。当前 allowlist 中每个普通文件类型都走同一 extension-owned canonical MIME、session Workspace、atomic link/collision/rollback 和严格 RpcResult 路径；不得为 spreadsheet 或任一单独扩展新增 endpoint/protocol。预期校验保持 `bad-request`，意外 Host 异常使用 pinned rc.7 `internal` 固定安全文案；客户端仅呈现 allowlist 内的有界业务校验文案，其余失败均折叠为固定安全中文。Native images 继续使用既有 draft/Attachment CAS。

## Gateway boundary

The current gateway already owns its idempotent journal, admission, and exactly-once usage. EM217-201/203/205 prove those owners and close only demonstrated gaps. EM217-202 allows only typed pre-provider-admission retry or proven receipt reacquisition. Unknown outcomes are never generically replayed. Every gateway request is one image; no `/images/batch` and no `n>1`.

## Enterprise model delivery and recovery

EM217-206 由 AUTH owner 串行接在 EM217-205 与 EM217-406 之后，并在 EM217-501 source gate 前完成；EM217-205/406 的 source 依赖已完成，EM217-206 source 已于 `7cf4a0655cc04629f63f52bbcc90b6c76cba825d` 集成；已完成的源码检查与待补实机证据分开记录。它区分 management/control-plane、Gateway data-plane、provider 与 Postgres outage：warm/cold management outage 不得阻断 Renderer health、Session list/open/history、Workspace、attachments 或 local Tools；身份 UI 将 local availability 与 enterprise authenticated/routable state 分离，expired/revoked cache 不得声明 authenticated 或授权 enterprise call。

实现必须原子关闭 direct-key bypass：runtime catalog 只返回 Gateway-routed OpenAI-compatible metadata 并复用既有短期 model-session credential，`llm-pi-ai` 走既有 Gateway path；Gateway 每请求的 Postgres session/user/route/key 校验仍是最终权威。客户端不再接收、缓存或回退使用 plaintext upstream key；Settings/domain/log/error/audit 不含 access/refresh/model/upstream plaintext，废弃 upstream-key OS refs 由既有 credential owner 清理。仅允许非权威 last-known-good metadata 用于 UX，绝不延长 expiry/revocation。

Reconnect 仅复用 existing online/focus、credential-generation、coalesced refresh 与 <=30 秒 keepalive seam；refresh 有效时无需 app restart/login。Fault acceptance 覆盖 warm/cold blackhole、exp-1/exp、session revoke/user disable/model-list change、route disable/re-enable、key rotation、late A versus logout/login B、OS/Settings/table atomic failure、running Postgres down→up、Gateway startup Postgres-down supervisor truth，以及 bounded/coalesced reconnect。auth/route/Gateway 不 live 时 provider POST=0；provider outage 保持 provider-boundary truth且不新增 retry。Desktop lifecycle、rc.7 Session/Workspace/attachment/Tool/history owner、analytics/admin UI、generic provider retry、package/version/release 均排除；monotonic revision 如确有必要须另行批准 scope。最终 source commit `734da986d6bdc5c4dd8452a5ed29c1ce466a4a72` 的 root/Profile/Client/enterprise source checks 已退出 0，Model Gateway 为 108 通过、11 条件 skip。完整 fault/reconnect/gateway-startup、live PostgreSQL、external immutable、GUI、installed 与 production evidence 仍保持 **OPEN**；rollback 先 fail-closed 禁用 enterprise routing，绝不恢复 direct upstream-key distribution。

## Computer Use

EM217-408 只复用 pinned jing-hy MIT PowerShell/Win32 primitives，并接到既有 `@e-mate/dsh-plugin-computer-use` / `ctx.computerUse` backend 与单一 Profile row；不得安装或复制其插件层。Darwin 保持 Anionex pin，二者 MIT notice/provenance 均保留。Windows 路径必须校验 app+HWND+PID、UIA state hash、Win32 返回值、key/button cleanup、policy-never/per-turn lease/one-use confirmation、workspace Attachment fence、固定 DSH subprocess bounds/integrity/cleanup 和 post-action observation；secure desktop/UIPI/elevated/locked/RDP 诚实失败。排除候选 registry/settings/client/Skill/global Set/computer_set_mode/raw spawn/arbitrary path/output guard。Windows installed-machine evidence 保持 OPEN。EM217-407/505 依赖 408。

## Verification and gates

EM217-501 覆盖 EM217-108 单图 latency/bypass gate、全部 source、UI、gateway、Desktop alignment 与 Windows plugin；EM217-407 位于完整 source verification 和 Desktop 对齐之后，GUI 再随后执行。环境证据表明：缺少 pinned Harness emitted lib 时 `test:fast` 会在断言前失败；主代理先执行仓库自有 `build:harness` 后，`test:fast` 为 12/12 green。EM217-404 patch/package/lock 与 focused 38 tests 通过后，Desktop full check 对 `Desktop Harness overlay is not admitted: @deepseek-ai/dsh-app-boot@npm:0.1.0-rc.7` 正确 fail closed；唯一 owner `scripts/harness-provenance.mjs` 必须精确准入该 pinned overlay，并先通过 `scripts/harness-provenance.test.mjs` focused test，再运行 Desktop full check。该修复是必要的端到端 provenance owner，不是 bypass；`COREPACK_ENABLE_PROJECT_SPEC=0` 不是 canonical guidance。依赖安装属于精确 Harness worktree的环境准备，不写入产品命令。Source commands 按顺序为：

- `MAIN-AGENT-ONLY SOURCE PREREQUISITE: corepack pnpm run build:harness`
- `corepack pnpm run test:fast`
- `corepack pnpm test`
- `corepack pnpm --filter @e-mate/dsh build`
- `corepack pnpm --filter @e-mate/dsh test`
- `corepack pnpm enterprise:check`
- `corepack pnpm enterprise:test`
- `node --test scripts/harness-provenance.test.mjs`
- `workdir: desktop; corepack yarn check`

Ticket-local tests 只写真实路径。EM217-307 的 TSX check 从 pinned Harness workdir 直接运行已安装的 `node_modules/.bin/vitest`，不得使用会触发 Lefthook 安装的 `pnpm exec`；EM217-408 通过 `node scripts/component-run.mjs check --component @e-mate/dsh-plugin-computer-use` 构建并检查独立 component，不得使用 root `--filter`。当前仅允许主代理授权的非生产 app-directory/dev macOS Computer Use：EM217-504 只依赖 407+501。其 packaged/installed production 另需 502+503 且 **HUMAN-CONFIRMATION-GATED**；Windows installed evidence、生产 dist、rollback、public release 均保持 OPEN。

## Evidence

Git tracks only small sanitized specifications, manifests, and assertions. Videos, screenshots, logs, images, installers, and other runtime evidence live in an immutable external location and are referenced by URI plus SHA-256. Never commit secrets, prompt text, image bytes, or installer bytes.

## Machine check

Run `node docs/2.0.17/check-plan.mjs`, then `git diff --check`. The canonical 42 work orders and detailed acceptance/rollback data are in `work-orders.json`; its evidence reasons distinguish verified source checks from the external, GUI, live PostgreSQL, full fault/reconnect/gateway-startup, installed, and production evidence that remains **OPEN**.
