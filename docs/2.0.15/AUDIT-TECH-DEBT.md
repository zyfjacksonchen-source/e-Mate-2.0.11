# e-Mate 2.0.15 technical-debt and evidence-gap audit

> Ticket: T03. Baseline: `b3773a72274b51032a39cc92d4b0b0db8dcd25ec`. Findings are assignments, not fixes. A source file, passing fixture or old CI run is not an installed receipt.

## P0 findings

| ID | Finding | Evidence at T03 | Unique owner / action | Gate |
|---|---|---|---|---|
| TD-P0-01 | Tool Search overrides the admitted managed-search contract | Base profile patch selects `deepseek-official` at `https://api.deepseek.com/anthropic/v1`; C14 later disables that provider and inserts `gpt-responses` at `http://43.135.183.53:8080/v1`, model `gpt-5.6-luna`, with `allowInsecureHttp: true` while retaining a DeepSeek-named credential variable. This also conflicts with the package test intent that rejects accidental insecure transport. | T05: choose and document the single approved provider/credential/transport contract, remove the conflicting route, then prove deterministic routing and failure behavior. T03 does not choose or patch it. | Blocks UR05 and T18 |
| TD-P0-02 | Checked-in Profile snapshot is stale and cannot admit a release | `artifacts/release/profile-current-snapshot.json` embeds 2.0.12/v6-era data while the base contract is `e-mate-desktop-profile-v7-dsh-b2b1650b01f0`; the recorded profile release run failed. | T01: regenerate only through the release lane and record exact three-target desired-state hashes; T18 consumes the receipt. | Blocks UR01 and T18 |
| TD-P0-03 | Blocked xin-assistant remains a 58 MB source/runtime closure | C16 is not active in Desktop/CLI/public, yet its package contains 642 tracked files, 58,277,640 bytes and 497 Python typing/source files, including three native vendor trees. | T04: execute the exact deletion/migration snapshot in `AUDIT-COMPONENTS.md`; preserve Vision Toolkit Python and immutable historical objects. | Blocks the 15-component 2.0.15 closure |
| TD-P0-04 | 2.0.14 routing and updater repairs have no installed receipt | Development log and source tests describe the repairs; public remains exact 2.0.13 and no real installed 2.0.14 evidence was found. | T05 owns routing proof; T09 owns update transaction proof; T18 may promote only their installed receipts. Do not rewrite the existing fixes in T03. | `NEEDS_EVIDENCE` |
| TD-P0-05 | Tencent Docs backlog is unreadable | Workpack contains only `https://docs.qq.com/sheet/DVnduU25aTGJBTkRJ?tab=BB08J2`; no readable table/export is present. | T17: `BLOCKED/NEEDS_INPUT` until readable export or authorized access is supplied; never infer content. | Blocks only UR17/imported requirements |

## P1 findings

| ID | Finding | Unique owner / required evidence | Ticket |
|---|---|---|---|
| TD-P1-01 | Native Harness gitlinks are uninitialized in the T03 worktree, so this audit can confirm pins and consumer contracts but cannot re-walk every rc.7 implementation line. | T02 must use the pinned `b2b1650b01f0ee88d81837a9b5c050f9f763f606` Harness to produce installed Session/Workspace/Tool/Job/Skill/Schedule recovery receipts; T18 checks the exact pin. | T02 |
| TD-P1-02 | All 15 retained components lack at least one real installed positive/negative receipt. | T05-T16 follow the exact C01-C15 owner matrix; no owner may convert source/fixture evidence into `PASS`. | T02 |
| TD-P1-03 | Computer Use inventory covers win32 while its patch disables the runtime on non-darwin. | T15 must prove Windows projects an explicit unavailable capability and never advertises or simulates control. | T15 |
| TD-P1-04 | GenUI has only a package-surface source test. | T16 must exercise native ToolView success/failure and both message modes in an installed app. | T16 |
| TD-P1-05 | Glass Composer could regress into duplicate composer ownership if treated as a replacement. | T16 must prove it decorates the one native semantic composer, persists settings and supports reduced motion/accessibility; Merge/Delete requires a migration, not inference. | T16 |
| TD-P1-06 | Enterprise services have route-level tests but no deployed cross-account authorization receipt for this baseline. | T07/T08 prove Skill Hub/Share service flows; T10 proves identity/usage; T18 proves admin/model boundaries cannot mutate local runtime. | T18 |
| TD-P1-07 | Per-component timeouts and fallbacks are bounded in source but not calibrated on real targets. | T15 validates CDP/helper/Vision/connector timeouts; T16 validates MCP/Office/GenUI cleanup; T09 validates updater timeouts and rollback. Record elapsed time and terminal projection, not only thrown errors. | T15 |

## Ownership and state-model conclusions

- No second Session, Workspace, Tool registry, Schedule engine, Skill registry or Job store was found in the admitted component design. Components consume native DSH owners through typed Tools, slots, `WorkspaceRegistry`, persistence and Jobs.
- Shell is the only client shell. `glass-composer` is a decoration and `schedules` is a read-only projection; neither may become a parallel owner.
- Enterprise auth/model/analytics services own remote identity, model and usage policy. They do not own local Tool dispatch, local Session state or local Profile activation.
- Share Worker and Skill Hub Worker are purpose-specific service planes, not a general control plane.
- Empty `catch` sites seen in scoped source are parser/cleanup/best-effort boundaries, not evidence of installed recovery. Owners must prove visible terminal behavior for credential cleanup, Tool Search fallback, image/job cancellation and updater receipt cleanup; T03 creates no blanket refactor ticket without a reproduced loss.

## Package, build and license conclusions

- All 16 inventory rows resolve to a package root and component metadata tied to the current base contract. The retained packages expose their declared client/host/platform artifacts through existing build/composition tests.
- C16 is the only blocked inventory component and the only deletion decision. It must not be confused with C15 Vision Toolkit, whose target-specific Python wheels remain required.
- No current root lockfile literal for xin was found. T04 still owns lock regeneration/verification, but must not manufacture a no-op lock edit.
- Existing component fixtures, package-surface checks and old CI receipts are useful source evidence only. Final admission requires the owner-specific installed checks in `AUDIT-COMPONENTS.md` and the user-terminal flows in `AUDIT-USER-FLOWS.md`.

## Release decision

T03 does not unlock release. The audit is complete when its inventory and requirement mappings are internally consistent; product closure remains with T04-T18. Public production stays exact 2.0.13 until T18 has protected-baseline, byte, installed/public and ownership receipts.

