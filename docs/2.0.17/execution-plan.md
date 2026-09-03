# e-Mate Desktop 2.0.17 execution plan

## Locked baseline

活动来源锁定为 e-Mate `f876f01d8280e4ab20fe83b88c36c7fe7a662135`、Harness `4da69d7c3522ee51de12822c917c503a124f7a7d`、唯一 Desktop reference `anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add` 和 `pnpm@11.7.0`。被拒绝的上传参考仅记录在 `baseline-lock.json.rejected_references`。EM217-501 通过前保持 2.0.16，之后才由 EM217-407 改版本合同。

## Ownership and WIP

The main agent is sole integrator, builder, installer, releaser, and rollback owner. WIP is at most 6. Tickets merge in dependency order; overlapping broad write sets are serialized in `work-orders.json`. Subagents do not install, build, package, install, publish, push, clean, or decide gates.

## Required W0 decision

EM217-002 固化已接受的 pinned-spawn：effect-scoped one-shot gate、descriptor-label nonce、normalized args、spawn/localAgent/shared CAS。顺序必须为 parent created flush → task link flush → open/provider；child flush → parent terminal flush → dispose/refill，任一 `ctx.sessions.flush(parent.session)` false/reject 均 fail closed。首期只做 new-image batch；edit/fusion 等待 durable parent-owned revision-3 review/adjudication。`image_batch` 仍是 `@e-mate/dsh` 内唯一实现，不建第二 scheduler/store/RPC。现有 Tool Search 负责可发现性，现有 audit owner 负责 canonical image-generation 分类。

## Gateway boundary

The current gateway already owns its idempotent journal, admission, and exactly-once usage. EM217-201/203/205 prove those owners and close only demonstrated gaps. EM217-202 allows only typed pre-provider-admission retry or proven receipt reacquisition. Unknown outcomes are never generically replayed. Every gateway request is one image; no `/images/batch` and no `n>1`.

## Computer Use

EM217-408 只复用 pinned jing-hy MIT PowerShell/Win32 primitives，并接到既有 `@e-mate/dsh-plugin-computer-use` / `ctx.computerUse` backend 与单一 Profile row；不得安装或复制其插件层。Darwin 保持 Anionex pin，二者 MIT notice/provenance 均保留。Windows 路径必须校验 app+HWND+PID、UIA state hash、Win32 返回值、key/button cleanup、policy-never/per-turn lease/one-use confirmation、workspace Attachment fence、固定 DSH subprocess bounds/integrity/cleanup 和 post-action observation；secure desktop/UIPI/elevated/locked/RDP 诚实失败。排除候选 registry/settings/client/Skill/global Set/computer_set_mode/raw spawn/arbitrary path/output guard。Windows installed-machine evidence 保持 OPEN。EM217-407/505 依赖 408。

## Verification and gates

EM217-501 覆盖全部 source、UI、gateway、Desktop alignment 与 Windows plugin；EM217-407 位于完整 source verification 和 Desktop 对齐之后，GUI 再随后执行。环境证据表明：缺少 pinned Harness emitted lib 时 `test:fast` 会在断言前失败；主代理先执行仓库自有 `build:harness` 后，`test:fast` 为 12/12 green。依赖安装属于精确 Harness worktree 的环境准备，不写入产品命令。Source commands 按顺序为：

- `MAIN-AGENT-ONLY SOURCE PREREQUISITE: corepack pnpm run build:harness`
- `corepack pnpm run test:fast`
- `corepack pnpm test`
- `corepack pnpm --filter @e-mate/dsh build`
- `corepack pnpm --filter @e-mate/dsh test`
- `corepack pnpm enterprise:check`
- `corepack pnpm enterprise:test`
- `corepack yarn --cwd desktop check`

Ticket-local tests 只写真实路径。当前仅允许主代理授权的非生产 app-directory/dev macOS Computer Use：EM217-504 只依赖 407+501。其 packaged/installed production 另需 502+503 且 **HUMAN-CONFIRMATION-GATED**；Windows installed evidence、生产 dist、rollback、public release 均保持 OPEN。

## Evidence

Git tracks only small sanitized specifications, manifests, and assertions. Videos, screenshots, logs, images, installers, and other runtime evidence live in an immutable external location and are referenced by URI plus SHA-256. Never commit secrets, prompt text, image bytes, or installer bytes.

## Machine check

Run `node docs/2.0.17/check-plan.mjs`, then `git diff --check`. The canonical 38 work orders and detailed acceptance/rollback data are in `work-orders.json`.
