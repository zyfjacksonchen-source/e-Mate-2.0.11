# e-Mate 2.0.15 status board

Status vocabulary: `TODO / INVESTIGATED / CODE_COMPLETE / NARROW_TEST_PASSED / INSTALLED_E2E_PASSED / MERGED / RC_PASSED / BLOCKED`. “基本完成” is not a status.

## Program gates

| Gate | State | Evidence / rule |
| --- | --- | --- |
| Workpack integrity | `NARROW_TEST_PASSED` | ZIP and every manifest entry verified |
| Incremental work-order intake | `NARROW_TEST_PASSED` | all three 2026-08-27 inputs hash-recorded and reconciled against current source in `INCREMENTAL-WORK-ORDERS.md` |
| Incremental target-contract delta | `NARROW_TEST_PASSED` | accepted Image generation/intake, InputTrigger, Search and UI clauses are merged; T18 source freeze now passes `check:target` and the strict successor-Base release boundary with zero errors |
| Canonical source | `NARROW_TEST_PASSED` | live `origin/main@90c3a1f…` was integrated by exact two-parent merge `1135dd9…`; T00 independently verified the current source gate at `7bd8994…` with clean root/Harness/GenUI worktrees |
| Baseline difference | `NARROW_TEST_PASSED` | recorded in `BASELINE.md`; old SHA/path assertions are not silently reused |
| 2.0.14 task handoff | `NARROW_TEST_PASSED` | transferred task read; accepted branch tip `4bfe0c3…` and protected `main@5f8c54d…` have the identical tree; source changes map to T05/T09/T15 while installed/public closure stays T18 |
| Base/Harness/Desktop pins | `NARROW_TEST_PASSED` | source-frozen successor `e-mate-desktop-profile-v8-dsh-4787caf39134` binds rc.7 Harness `4787caf391…`, Desktop reference `6074088…`, 15 retained components and the exact 17-import ABI union; candidate and installed proof remain open |
| Harness source reachability | `NARROW_TEST_PASSED` | advertised branch `release/e-mate-2.0.15-harness` points to `4787caf391…`; T18 branch/SHA probes and an independent T00 clean HTTPS probe fetched the exact three-commit closure without alternates |
| Owner/path partition | `NARROW_TEST_PASSED` | fail-closed scopes and sequential leases in `DECISIONS.md` |
| Release/worktree topology | `NARROW_TEST_PASSED` | release and T00 worktrees exist; later worktrees are created only at dispatch |
| Production predecessor | `INVESTIGATED` | public production remains 2.0.13; 2.0.14 source/candidate is not called released |
| 2.0.14 Profile release input | `NARROW_TEST_PASSED` | T01 refreshed the checked-in desired-state snapshot to the exact public 2.0.13 Base v7 bytes and locked the former failure as a regression; no Profile publication was performed |
| Successor Base identity | `NARROW_TEST_PASSED` | strict inventory exits 0 with successor Base v8, 15 components, 19 jobs and zero errors; the two original D006 predicates are preserved as the before-state and closed only at source-contract scope |
| Tencent backlog | `NARROW_TEST_PASSED` | T17 mapped the sole authoritative functional-feedback export `VwnSnZLbANDI`: 20 unique raw rows → 16 canonical roots; the obsolete image-feedback workbook is identity-recorded only with `content_excluded=true` and contributes no content or mapping |
| Formal platform/service authorities | `BLOCKED` | real accounts, Worker access, Apple/signing policy and accepted Intel/x64 runner receipts are ticket-local gates |

The release-input and external-authority blockers do not authorize mock completion. They block the affected installed/RC/release statuses, not unrelated read-only audit or narrow source work.

## Tickets

The effective concurrency cap is `min(6, available executor slots)`. The current executor exposes four total slots, so the coordinator plus at most three worker tickets may be active. No T01–T18 worktree has been pre-created from a stale integration tip.

| ID | Topic | Model / effort | Branch | Dependencies | Planned worktree | State | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T00 | Program control, baseline, status | 5.6 sol max / xhigh | `feat/2.0.15-T00-program-control` | none | `worktrees/emate-2.0.15-T00` | `MERGED` | `docs/2.0.15/evidence/T00.json` |
| T01 | CI/build/release fast lanes | 5.6 sol max / xhigh | `feat/2.0.15-T01-ci-fast-lanes` | T00 | `worktrees/emate-2.0.15-T01` | `MERGED` | `e7822c22281373401e84bef9902722699d7d6fdd`; post-T04 fixture repair `9b4d935`; `docs/2.0.15/evidence/T01.json` |
| T02 | Regression wall and smoke harness | 5.6 sol max / xhigh | `feat/2.0.15-T02-regression-wall` | T00 | `worktrees/emate-2.0.15-T02` | `MERGED` | `2c352cf`; `docs/2.0.15/evidence/T02.json` |
| T03 | System/component audit | 5.6 sol max / high | `feat/2.0.15-T03-system-audit` | T00 | `worktrees/emate-2.0.15-T03` | `MERGED` | `d5c5ea24b36010cb3f497356ed955219fb40decc`; `docs/2.0.15/evidence/T03.json` |
| T04 | Remove xin-assistant | 5.6 sol / high | `feat/2.0.15-T04-remove-xin-assistant` | T03 inventory snapshot | `worktrees/emate-2.0.15-T04` | `MERGED` | `116dadb3cbe10ca9aab719821f17acddb40fcc2e`; `docs/2.0.15/evidence/T04.json` |
| T05 | Native Tool/Image/Search visibility and routing | 5.6 sol max / xhigh | `feat/2.0.15-T05-tool-routing` | T00; Wave-1 owner contracts; incremental contract delta | `worktrees/emate-2.0.15-T05` | `MERGED` | `docs/2.0.15/evidence/T05.json` |
| T06 | Native Schedule closure and `@定时任务` source | 5.6 sol max / xhigh | `feat/2.0.15-T06-schedules-e2e` | T02 harness; T05 visibility | `worktrees/emate-2.0.15-T06` | `MERGED` | `docs/2.0.15/evidence/T06.json` |
| T07 | Skill Hub closure and `@Skill` source | 5.6 sol max / xhigh | `feat/2.0.15-T07-skillhub-e2e` | T02 harness; T05 visibility | `worktrees/emate-2.0.15-T07` | `MERGED` | `1354df1`, `f7bbf5e`; `docs/2.0.15/evidence/T07.json` |
| T08 | Online Share closure | 5.6 sol max / high | `feat/2.0.15-T08-share-e2e` | T02 harness | `worktrees/emate-2.0.15-T08` | `MERGED` | `docs/2.0.15/evidence/T08.json` |
| T09 | Updater transaction/UX | 5.6 sol max / xhigh | `feat/2.0.15-T09-updater` | T01 artifact contract; T02 installed harness | `worktrees/emate-2.0.15-T09` | `MERGED` | `docs/2.0.15/evidence/T09.json` |
| T10 | Token activity, managed-search grant and model-capability contract | 5.6 sol max / high | `feat/2.0.15-T10-usage-activity` | T00; T05 search contract | `worktrees/emate-2.0.15-T10` | `MERGED` | `2544fcd`; `docs/2.0.15/evidence/T10.json` |
| T11 | Home/Account/Token heatmap and Shell token/host seam | 5.6 sol / high | `feat/2.0.15-T11-home-settings` | T06 extraction; T10 schema | `worktrees/emate-2.0.15-T11` | `MERGED` | release commits `37da362`, `dbabee2`; local upstream `820fee0df4`; visible task `01a0436a-de49-7ad1-a576-b4198616aa5e`; native skeleton `18/18`, Shell `15 files / 93 tests`, CP-11/12 zero pending; clean-fetch proof remains T18 |
| T12 | Message modes and typed image gallery | 5.6 sol max / high | `feat/2.0.15-T12-message-modes` | T05 image receipt; T11 Shell seam | `worktrees/emate-2.0.15-T12` | `MERGED` | `1176913`; independent visible task `01a0436a-de49-7ad1-a576-b3f8d73fb22e`; `docs/2.0.15/evidence/T12.json` |
| T13 | Native `@`, Settings, navigation and titlebar integration | 5.6 sol max / xhigh | `feat/2.0.15-T13-ui-navigation` | T06; T07; T08 header; T09 Desktop; T11; T12; T15; T16 handoffs | `worktrees/emate-2.0.15-T13` | `MERGED` | release tip `0157ce5`; visible task `01a043d2-7aad-7491-bfe1-f8d109d4183d`; product correction `48b0479`, fixture alignment `feb96b2`, upstream Settings metadata `4787caf391`; committed CP-13 `5/5`, zero pending, and T00 replay `8168 ms`; emitted imports exact 5; its two deferred D006 source predicates are now closed by T18 |
| T14 | C03 production icon | 5.6 sol / high | `feat/2.0.15-T14-c03-icon` | T01 cache/input contract | `worktrees/emate-2.0.15-T14` | `MERGED` | `docs/2.0.15/evidence/T14.json` |
| T15 | Runtime plugins/connectors, Computer Use availability and native image intake | 5.6 sol max / high | `feat/2.0.15-T15-runtime-components` | T03 audit; T05 routing; T10 model-capability contract | `worktrees/emate-2.0.15-T15` | `MERGED` | release commits `8cd64e9`, `f99cbdc`, `f3ec2ca`, D016 correction `9f7d54f`; same visible task `01a0436a-de49-7ad1-a576-b3df10972f5c`; Computer Use `3/3`, emitted imports exact 8; D006 source predicates were later closed by T18, while installed macOS TCC/Windows UI remain open |
| T16 | Product plugins, GenUI and Glass Composer contract | 5.6 sol max / high | `feat/2.0.15-T16-product-components` | T03 audit; T05 routing; T11 host; T12 gallery contract | `worktrees/emate-2.0.15-T16` | `MERGED` | release chain `af1d659` → `bca3321`; visible task `01a0437a-bff4-7db2-9387-9edbe2b01e1d`; seven-component narrow checks, Better Sidebar deferred race, emitted imports and CP-13 zero pending passed; D006 source predicates were later closed by T18 |
| T17 | Tencent backlog intake | 5.6 sol / medium | `feat/2.0.15-T17-tencent-backlog` | readable Tencent sheet; T03 audit | `worktrees/emate-2.0.15-T17` | `MERGED` | release commit `b6fa6f2`; visible task `01a04376-18e2-7a63-9c79-934597ccae80`; 20 unique raw rows, 16 canonical roots, classification total 20; obsolete image-feedback content excluded |
| T18 | Freeze/RC/release | 5.6 sol max / xhigh | `release/2.0.15` | source phase: every product P0 `MERGED`; candidate/installed gates stay inside T18 | `worktrees/emate-2.0.15-release` | `NARROW_TEST_PASSED` | same visible task `01a0447b-214f-7050-a85f-76b50ecffc8a`; source freeze `c2e7365`, live-main merge `1135dd9`, source correction `1912298`, evidence tip `7bd8994`; T00 independently passed impact `45/45`, release `16/16`, mac updater `93/93`, target/release-boundary/inventory and clean ancestry checks; Build once through formal release remain open |

## Dispatch and merge order

1. Wave 1: T01, T02 and T03 may run in parallel after the T00 integration commit. T04 replaces T03's slot only after the inventory snapshot is committed.
2. Merge T03 snapshot, T04, then T01/T02. Rebase or recreate later worktrees from the new `release/2.0.15` tip; do not keep stale pre-created branches.
3. Merge the incremental target-contract delta, then stabilize T05 first. T05 freezes Tool/Image/Search visibility and receipt contracts.
4. Run T06/T07/T08/T09/T10/T14/T15 in dependency-safe waves within the cap. T09 never starts before T01/T02; T06/T07/T10 never start before T05; T15 additionally waits for T10's model-capability handoff.
5. Preserve the Shell chain: T06 handoff → T11 token/home host → T12 message/gallery → T16 GenUI/Glass handoff → T13 final integration. T07, T08, T09 and T15 also hand off before T13.
6. An unblocked T17 may run within the cap. T18 is last.

Every merge reruns only the affected smoke. Product workers do not edit this board directly; they submit their evidence file and the integration owner advances the state.
