# e-Mate 2.0.15 status board

Status vocabulary: `TODO / INVESTIGATED / CODE_COMPLETE / NARROW_TEST_PASSED / INSTALLED_E2E_PASSED / MERGED / RC_PASSED / BLOCKED`. “基本完成” is not a status.

## Program gates

| Gate | State | Evidence / rule |
| --- | --- | --- |
| Workpack integrity | `NARROW_TEST_PASSED` | ZIP and every manifest entry verified |
| Canonical source | `NARROW_TEST_PASSED` | clean current `origin/main` = `5f8c54d…` |
| Baseline difference | `NARROW_TEST_PASSED` | recorded in `BASELINE.md`; old SHA/path assertions are not silently reused |
| Base/Harness/Desktop pins | `NARROW_TEST_PASSED` | current contract and gitlink agree |
| Owner/path partition | `NARROW_TEST_PASSED` | fail-closed scopes and sequential leases in `DECISIONS.md` |
| Release/worktree topology | `NARROW_TEST_PASSED` | release and T00 worktrees exist; later worktrees are created only at dispatch |
| Production predecessor | `INVESTIGATED` | public production remains 2.0.13; 2.0.14 source/candidate is not called released |
| 2.0.14 Profile release input | `BLOCKED` | checked-in current snapshot is stale; run `33050840728` failed before publication |
| Post-xin Base ABI union | `BLOCKED` | retired C16 was the sole owner of `@deepseek-ai/dsh-launch-environment`; the v7 Base contract still declares it, so strict inventory validation correctly fails until T18 creates and rebinds an honest successor contract |
| Tencent backlog | `BLOCKED` | requires XLSX/CSV/full copied table/readable snapshot |
| Formal platform/service authorities | `BLOCKED` | real accounts, Worker access, Apple/signing policy and accepted Intel/x64 runner receipts are ticket-local gates |

The release-input and external-authority blockers do not authorize mock completion. They block the affected installed/RC/release statuses, not unrelated read-only audit or narrow source work.

## Tickets

The effective concurrency cap is `min(6, available executor slots)`. The current executor exposes four total slots, so the coordinator plus at most three worker tickets may be active. No T01–T18 worktree has been pre-created from a stale integration tip.

| ID | Topic | Model / effort | Branch | Dependencies | Planned worktree | State | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T00 | Program control, baseline, status | 5.6 sol max / xhigh | `feat/2.0.15-T00-program-control` | none | `worktrees/emate-2.0.15-T00` | `MERGED` | `docs/2.0.15/evidence/T00.json` |
| T01 | CI/build/release fast lanes | 5.6 sol max / xhigh | `feat/2.0.15-T01-ci-fast-lanes` | T00 | `worktrees/emate-2.0.15-T01` | `TODO` | `docs/2.0.15/evidence/T01.json` |
| T02 | Regression wall and smoke harness | 5.6 sol max / xhigh | `feat/2.0.15-T02-regression-wall` | T00 | `worktrees/emate-2.0.15-T02` | `TODO` | `docs/2.0.15/evidence/T02.json` |
| T03 | System/component audit | 5.6 sol max / high | `feat/2.0.15-T03-system-audit` | T00 | `worktrees/emate-2.0.15-T03` | `MERGED` | `d5c5ea24b36010cb3f497356ed955219fb40decc`; `docs/2.0.15/evidence/T03.json` |
| T04 | Remove xin-assistant | 5.6 sol / high | `feat/2.0.15-T04-remove-xin-assistant` | T03 inventory snapshot | `worktrees/emate-2.0.15-T04` | `MERGED` | `116dadb3cbe10ca9aab719821f17acddb40fcc2e`; `docs/2.0.15/evidence/T04.json` |
| T05 | Native Tool visibility/routing | 5.6 sol max / xhigh | `feat/2.0.15-T05-tool-routing` | T00; Wave-1 owner contracts | `worktrees/emate-2.0.15-T05` | `TODO` | `docs/2.0.15/evidence/T05.json` |
| T06 | Native Schedule closure | 5.6 sol max / xhigh | `feat/2.0.15-T06-schedules-e2e` | T02 harness; T05 visibility | `worktrees/emate-2.0.15-T06` | `TODO` | `docs/2.0.15/evidence/T06.json` |
| T07 | Skill Hub closure | 5.6 sol max / xhigh | `feat/2.0.15-T07-skillhub-e2e` | T02 harness; T05 visibility | `worktrees/emate-2.0.15-T07` | `TODO` | `docs/2.0.15/evidence/T07.json` |
| T08 | Online Share closure | 5.6 sol max / high | `feat/2.0.15-T08-share-e2e` | T02 harness | `worktrees/emate-2.0.15-T08` | `TODO` | `docs/2.0.15/evidence/T08.json` |
| T09 | Updater transaction/UX | 5.6 sol max / xhigh | `feat/2.0.15-T09-updater` | T01 artifact contract; T02 installed harness | `worktrees/emate-2.0.15-T09` | `TODO` | `docs/2.0.15/evidence/T09.json` |
| T10 | Token activity data contract | 5.6 sol max / high | `feat/2.0.15-T10-usage-activity` | T00 | `worktrees/emate-2.0.15-T10` | `TODO` | `docs/2.0.15/evidence/T10.json` |
| T11 | Home/Account/Token heatmap | 5.6 sol / high | `feat/2.0.15-T11-home-settings` | T06 extraction; T10 schema | `worktrees/emate-2.0.15-T11` | `TODO` | `docs/2.0.15/evidence/T11.json` |
| T12 | Simple/detailed message modes | 5.6 sol max / high | `feat/2.0.15-T12-message-modes` | T11 settings seam | `worktrees/emate-2.0.15-T12` | `TODO` | `docs/2.0.15/evidence/T12.json` |
| T13 | Navigation/button interaction | 5.6 sol / high | `feat/2.0.15-T13-ui-navigation` | T11; T12; T08 header handoff | `worktrees/emate-2.0.15-T13` | `TODO` | `docs/2.0.15/evidence/T13.json` |
| T14 | C03 production icon | 5.6 sol / high | `feat/2.0.15-T14-c03-icon` | T01 cache/input contract | `worktrees/emate-2.0.15-T14` | `TODO` | `docs/2.0.15/evidence/T14.json` |
| T15 | Runtime plugins/connectors | 5.6 sol max / high | `feat/2.0.15-T15-runtime-components` | T03 audit; T05 routing | `worktrees/emate-2.0.15-T15` | `TODO` | `docs/2.0.15/evidence/T15.json` |
| T16 | Remaining product plugins | 5.6 sol max / high | `feat/2.0.15-T16-product-components` | T03 audit; T05 routing | `worktrees/emate-2.0.15-T16` | `TODO` | `docs/2.0.15/evidence/T16.json` |
| T17 | Tencent backlog intake | 5.6 sol / medium | `feat/2.0.15-T17-tencent-backlog` | user export; T03 audit | `worktrees/emate-2.0.15-T17` | `BLOCKED` | `docs/2.0.15/evidence/T17.json` |
| T18 | Freeze/RC/release | 5.6 sol max / xhigh | `release/2.0.15` | every P0 `MERGED` + `INSTALLED_E2E_PASSED` | `worktrees/emate-2.0.15-release` | `BLOCKED` | `docs/2.0.15/evidence/T18.json` |

## Dispatch and merge order

1. Wave 1: T01, T02 and T03 may run in parallel after the T00 integration commit. T04 replaces T03's slot only after the inventory snapshot is committed.
2. Merge T03 snapshot, T04, then T01/T02. Rebase or recreate later worktrees from the new `release/2.0.15` tip; do not keep stale pre-created branches.
3. Wave 2: stabilize T05 first. Then run at most three of T06/T07/T08/T09/T10 subject to their gates. T06 and T07 never start before the T05 contract; T09 never starts before T01/T02.
4. Wave 3: T11 → T12 → T13 is serial. T14 may run in parallel after T01.
5. Wave 4: T15/T16 and an unblocked T17 may run within the cap. T18 is last.

Every merge reruns only the affected smoke. Product workers do not edit this board directly; they submit their evidence file and the integration owner advances the state.
