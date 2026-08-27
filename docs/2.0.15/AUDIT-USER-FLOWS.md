# e-Mate 2.0.15 user-flow and requirement ownership audit

> Ticket: T03. Baseline: `b3773a72274b51032a39cc92d4b0b0db8dcd25ec`. Each requirement has one accountable owner ticket. Related tickets may consume its output but do not share ownership.

## Requirement map

| ID | User requirement / terminal flow | Owner | Current truth at T03 | Required acceptance, not replaceable by source tests | Ticket |
|---|---|---|---|---|---|
| UR01 | Fast PR/RC/Audit lanes with receipt-gated promotion | T01 | Lane contracts exist; current profile snapshot is stale 2.0.12/v6 and profile release evidence failed | PR/RC/Audit receipts name exact source, target bytes and failure boundary; no mac-smoke artifact can reach manifest/R2/public | T01 |
| UR02 | Critical installed user-path regression wall | T02 | Fixture/source coverage is broad; pinned native Harness gitlinks are not initialized in this worktree and no 2.0.14 installed receipt exists | Three-target installed smoke records login, session/workspace, Tool/Job/Skill/Schedule recovery and no lost/duplicate/unauthorized execution | T02 |
| UR03 | Full component, function and architecture audit | T03 | This audit covers C01-C16 and A01-A10; no functional closure is claimed | Four T03 documents are internally traceable and committed without product changes | T03 |
| UR04 | Completely retire xin-assistant and its Python/native vendor | T04 | C16 is blocked from Desktop and retired from CLI/public, but 642 tracked files remain | Future inventory/profile/package closure is absent on all targets; stale local profile is cleaned; historical objects unchanged | T04 |
| UR05 | Deterministic native Tool routing including ImageGen, Schedule and Web Search | T05 | Native per-Agent restriction exists, but C14 patch conflicts with the profile search-provider contract and uses insecure HTTP | Installed registry/prompt receipt proves deterministic selection, late registration/child inheritance and credential/transport failure behavior | T05 |
| UR06 | Native Schedule create/list/dispatch/delete loop | T06 | Native schedule owns mutation; C13 provides read-only projection | Installed create/list/dispatch/delete/restart and failure recovery with one scheduler and Tool Search coexistence | T06 |
| UR07 | Skill Hub publish/discover/install/enable/call | T07 | Source lifecycle/recovery tests and Worker routes exist | Two real accounts complete publish through invocation, denial and restart recovery; receipts preserve authority and version | T07 |
| UR08 | Online Share create/list/open/revoke | T08 | Native Session ZIP -> Share Worker path and tests exist | Installed authenticated create/list/open/revoke/restart; public URL behavior after revoke is recorded | T08 |
| UR09 | User-confirmed Profile-first atomic update with visible progress | T09 | 2.0.14 routing/updater changes are source-only and not installed evidence | From 2.0.13, user confirms, sees progress, restarts into candidate, and can recover/rollback from negative cases | T09 |
| UR10 | Token/activity day buckets and usage data contract | T10 | Enterprise usage/audit endpoints exist; UI numbers are not accepted without shared-path evidence | Same account/time-zone data agrees across service, contract and UI; missing days/late events/privacy negatives are covered | T10 |
| UR11 | Empty Home page office templates, profile settings and token heatmap | T11 | Shell/settings/artifact primitives exist; requested presentation is not yet accepted | Installed Home/profile/heatmap interactions use UR10 data and native Shell ownership, with empty/error/loading states | T11 |
| UR12 | Simple/detailed message stream modes | T12 | Native turn/activity projection exists; no installed mode receipt | Both modes preserve the same turn state, Tool results and recovery; mode switching never duplicates or hides terminal results | T12 |
| UR13 | Main navigation buttons and interaction reorder | T13 | C01 owns Shell slots/routes; no installed acceptance for the new ordering | Installed keyboard/mouse navigation, active state, deep link and restart restoration on the single native Shell | T13 |
| UR14 | C03 production icon and cross-platform assets | T14 | Asset acceptance is independent of runtime component closure | Exact production icon renders in macOS/Windows installer/app surfaces with generated asset receipts | T14 |
| UR15 | High-risk runtime plugins and external connectors | T15 | C04/C05/C07/C15 have source tests, not real external closure | The four-component list in `AUDIT-COMPONENTS.md` supplies positive and negative installed receipts; external credential blockers are explicit | T15 |
| UR16 | Remaining product-plugin stability batch | T16 | C03/C06/C08-C12 have source tests of uneven depth | The seven-component list in `AUDIT-COMPONENTS.md` supplies entry -> owner -> result positive and negative installed receipts | T16 |
| UR17 | Import and deduplicate Tencent Docs feedback | T17 | Only the URL is available; table content is unreadable in the workpack | `BLOCKED/NEEDS_INPUT` until a readable export or authorized access is supplied; then each row is deduplicated and mapped, never guessed | T17 |
| UR18 | Freeze, integrate, generate, install and release exact 2.0.15 bytes | T18 | Public remains exact 2.0.13 with 15 components; checked-in source/version and receipts are not a 2.0.15 release | Protected baseline, generated byte hashes, installed/public receipts and ownership gates all match; source/fixture/old CI cannot substitute | T18 |

## Cross-cutting user flows

| ID | Flow | Owner | Entry -> authority -> terminal result | Current gap | Ticket |
|---|---|---|---|---|---|
| UF01 | First-run identity | T10 | Shell identity entry -> `/emate.identity` -> auth/model gateways + OS credentials -> native identity state | Real challenge/register/login/agreement/remember/logout/restart and policy denial | T10 |
| UF02 | Session and workspace lifecycle | T02 | Shell -> native client stores -> Session/Workspace Hosts and persistence -> conversation/workspace projection | Installed reconnect/rename/archive/restart, cross-workspace negative, no lost/duplicate turn | T02 |
| UF03 | Tool invocation and result projection | T05 | Composer -> native Agent/Tool registry -> selected Host/Job -> native turn/ToolView | Installed registry/prompt snapshot, late Tool and exact result/failure projection | T05 |
| UF04 | Office artifact creation | T16 | Template/composer -> C12 Skill/Tool/Job -> Workspace/Sandbox -> artifact open/download | Real DOCX/XLSX/PPTX/PDF positives plus malformed/cancel/cleanup negatives | T16 |
| UF05 | Browser and OS control | T15 | Explicit `@电脑操控` -> C04/C05 -> approval/TCC/helper -> visible result | macOS approval/denial and Windows explicit unavailable behavior | T15 |
| UF06 | Connector discovery and install | T15 | Natural-language request -> C07 -> fixed catalogue/native Skill -> receipt/result | Real-account connector positives and cancel/auth/launcher negatives | T15 |
| UF07 | Memory across sessions | T16 | Remember/search -> C11 -> Workspace-scoped native store -> answer | Restart persistence and cross-project isolation | T16 |
| UF08 | MCP lifecycle | T16 | Settings/Tools -> C10 -> credentials/OAuth/subprocess -> active Tool/status | Add/activate/restart/remove and invalid/OAuth denial | T16 |
| UF09 | Profile generation and update | T09 | Update Tool -> desired state -> Profile stage/activate/rollback -> Base fallback -> progress/result | Real installed transaction; 2.0.14 source fixes remain `NEEDS_EVIDENCE` | T09 |
| UF10 | Enterprise administration boundary | T18 | Account/policy/usage UI -> auth/model/analytics services -> bounded response | Deployed authorization negatives and proof the admin plane cannot mutate local runtime/Tool state | T18 |

## Explicit blockers and hand-offs

- `UR17` is `BLOCKED/NEEDS_INPUT`: the Tencent Docs URL alone is not evidence. No T03 finding invents its rows, counts or priorities.
- C01 Shell is the only UI shell owner. T11, T12, T06 and T08 integrate through its admitted slots/RPCs; they do not create another Shell, transport or state store.
- C14 Tool Search is the only 2.0.15 capability-routing owner. T15 may validate CDP/Computer Use/Find Skill/Vision behavior but may not repair C14.
- T18 may integrate and release only after owner receipts exist. It does not inherit product write ownership from earlier tickets.

