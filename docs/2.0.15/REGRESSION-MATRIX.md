# e-Mate 2.0.15 regression matrix

T02 turns this seed into executable manifests. T00 records ownership and required truth layers only; no mock result below is marked passed.

## Executable smoke wall

`scripts/smoke/critical-paths.json` is the single CP-01..CP-15 manifest. Run it with
`node scripts/smoke/run.mjs --layer component`; an owning ticket can add one JSON
extension binding without changing the shared manifest. `--require-complete`
fails closed while any selected seam is unbound.

The three truth layers are deliberately separate:

| Layer | T02 closure | Truth boundary |
| --- | --- | --- |
| component | CP-01 startup health contract; CP-02 new Session/Home/Composer; CP-03 native message; CP-04 registry mutation; CP-06 native Schedule visibility; CP-15 Home/Settings route | target at most 60 seconds; pending owner seams stay visible |
| complete Profile app-dir | CP-01 real Renderer health ACK from an unpacked application | no DMG/NSIS; process-alive-only and mocked receipts fail |
| installed candidate | runner plus exact install-receipt/executable-byte gate only | T18 supplies exact candidate, real account/Provider, visible UI and macOS/Windows receipts |

The Schedule seam `schedule-restrict.component` remains an explicit T05/T06
cross-component regression: `tools.restrict()` must not receive unknown global
Tool names. T02 does not implement Schedule, Skill Hub, Share or Updater product
behavior.

`vision-input.component` and `vision-input.app-dir` are the
EM-VISION-INPUT-01 seams. T10 supplies model-capability metadata and T15 owns the
native Attachment-first repair; T07 remains Skill Hub. T18 alone binds
`vision-input.installed` to real macOS/Windows candidate receipts.

## User requirement mapping

| Requirement | Ticket owner(s) | Fast acceptance | Installed/real acceptance |
| --- | --- | --- | --- |
| PR/RC/Audit lane split and exact-byte reuse | T01, T02, T18 | classifier/topology and no-rebuild checks | exact candidate provenance and public readback |
| Full component/feature audit | T03, T15, T16 | every inventory/non-component owner mapped | retained P0 paths have real positive/negative smoke |
| Remove xin-assistant and vendor closure | T04 | inventory/profile/package/lock absence | three-target generation and packaged runtime absence |
| Navigation/buttons/interaction hierarchy | T13 | route, keyboard, tooltip, busy/disabled tests | real app-directory task/search/schedule/hub/project/share/update/settings path |
| Home office templates fill native Composer only | T11 | blank reuse/new Session, editable draft, no send | app-directory Composer focus and persistence |
| Usage moves to Account with real heatmap | T10, T11 | daily bucket/timezone/aggregation/unavailable UI | real-account daily/weekly/total reconciliation |
| Simple/detailed message modes | T12 | same node sequence, native detailed renderer, persistence | app-directory live/restart with thinking state |
| Online Share create/list/open/revoke | T08 | Host/Worker typed stage tests | public unauthenticated read, restart list, revoke 404/410 |
| Skill Hub complete lifecycle | T07 | RPC/Job/WAL/provider contracts | two-account publish/search/install/invoke/update/disable/restart/enable/uninstall/delete |
| Native Schedule create/list/delete/dispatch | T05, T06 | Tool visibility plus event projection | app-directory create and restart projection using native tools |
| Deterministic first-party Tool routing | T05 | late register/unregister, fail-open native, child inheritance | ImageGen/Schedule/Skill/Browser real intent paths |
| Native updater progress, predecessor bridge, rollback | T09 | protocol/state/cache/failpoint tests | exact public predecessor updates on macOS/Windows and failed-health rollback |
| C03 production icon | T14 | RGBA/alpha/ICC/color/size checks | Finder/Dock/Switcher/Settings/installer screenshots |
| Tencent backlog intake | T17 | every supplied row has owner/status/evidence | current candidate reproduction; unread rows stay blocked |
| All product/release bytes say 2.0.15 | T18 | version/manifest/source consistency | fresh install/update/rollback/public exact-byte readback |
| External connector and runtime plugins | T15 | owner-specific positive/negative contracts | real installed CDP/CU/connector/Vision paths with actual grants |
| Native image input remains Attachment-first | T10, T15 | paste 5 PNG; text + 5 PNG; capable/unknown preserve images; text-only converts only at request/wire; Windows Chinese path; mixed image/PDF/DOCX each has one owner; exact 5 native Attachments, 5 model image blocks, 0 path markers/fallbacks/duplicates | T18 runs exact macOS/Windows installed bytes with real capability metadata and visible/durable Attachment receipts |

## Incremental acceptance additions

The incremental work-order intake adds these owning-ticket checks to the same
Source/App-dir wall. Fixtures can prove contract behavior only; none of the
following installed gates can be satisfied by a fixture.

| Acceptance family | Owning ticket checks | Installed gate |
| --- | --- | --- |
| Image | T05 health/edit/routing and 1/2/4 native capacity; T12 typed gallery; T15 semantic/OCR verification; T16 GenUI isolation | T18 runs 1/2/4/8, upload/current/reopened edits, independent/fusion, 429/timeout/invalid/partial/cancel/unknown, `imagen` discovery and source/output hashes against real Provider/account bytes |
| Native `@` | T06 Schedule, T07 Skill, T13 native entry plus Goal/Plan/final composition, T15 Computer Use capability, T16 File Import | T18 proves Home/new/existing Session, IME/keyboard/offline/large inventory, macOS permission states, Windows unavailable state and current-turn Computer Use authority with screenshots |
| Zero-user-Key Search | T05 routes native `web_search` only; T10 owns identity/grant/revoke and secret boundary | T18 proves fresh install with no user Key, login/grant/revoke/offline/timeout/429/503, source URLs, no Settings credential and no CDP/Skill fallback using real service authority |
| Cross-platform UI | T11 Shell tokens/host, T13 Settings/titlebar/actions/navigation, T16 Glass Composer/GenUI closure | T18 proves macOS/Windows, light/dark/system, all named surfaces, minimum window, 100/125/150 percent, titlebar/composer/hover/focus and streamed text + GenUI + gallery screenshots |
| Native image input | T10 model-capability contract; T15 Vision repair and Source/App-dir probes; T02 only hosts the seam | T18 proves paste/drop/upload, text + 5 PNG, capable/unknown/text-only behavior, Windows Chinese paths and mixed image/PDF/DOCX on exact installed bytes; counts must be Attachments=5, model image blocks=5, absolute-path markers=0, Skill Find/CDP fallback=0 and duplicates=0 |

## Critical paths

| ID | Path | Fast owner | Candidate owner |
| --- | --- | --- | --- |
| CP-01 | startup to clickable shell | T02 | T18 |
| CP-02 | native blank/new Session and send | T02 | T18 |
| CP-03 | ordinary chat/native message and native image input | T02/T10/T12/T15 | T18 |
| CP-04 | ImageGen is first correct business Tool | T05 | T18 |
| CP-05 | multi-image/subagent does not drift to CDP/Skill Find | T05 | T18 |
| CP-06 | Schedule create/list/delete/dispatch/restart | T05/T06 | T18 |
| CP-07 | Skill Hub publish through invoke/lifecycle | T07 | T18 |
| CP-08 | Share create/list/open/revoke | T08 | T18 |
| CP-09 | manual update and truthful progress | T09 | T18 |
| CP-10 | update failure rollback/data retention | T09 | T18 |
| CP-11 | Home template fills but does not send | T11 | T18 |
| CP-12 | Token activity daily/weekly/total | T10/T11 | T18 |
| CP-13 | simple/detailed mode same native nodes | T12 | T18 |
| CP-14 | C03 in all real surfaces | T14 | T18 |
| CP-15 | Session/model/settings/Skill state survives update | T09/T18 | T18 |

## Global negative gates

- unknown Tool names, stale selection and late registry changes never prevent Session creation;
- unavailable usage/service state is shown as unavailable, never fake zero/success;
- no Renderer stores a second transcript, Session or update state;
- no evidence contains credentials, user content, private paths or raw upstream error bodies;
- D009 consultation is allowed only after the same named check stays red after two materially different source-backed fixes; the coordinator may then create one separate ChatGPT Work task inside the current ChatGPT/Codex application and directly wait for/read it. Browser/Web ChatGPT is forbidden. If the in-app UI exposes exact `5.6 sol Pro`, select it; because task creation cannot force a ChatGPT model, an unavailable option is recorded rather than silently substituted or moved to the Web. Only one sanitized advisory hypothesis may return; the same local check must still pass, Owner/path scope cannot expand, and secrets/private data cannot be uploaded;
- no T01–T17 command builds or publishes a formal candidate unless its work order explicitly owns that candidate-only boundary;
- T18 stops on any open P0, missing exact-byte receipt or mismatched public predecessor.
