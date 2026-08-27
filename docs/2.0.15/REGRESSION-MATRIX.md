# e-Mate 2.0.15 regression matrix

T02 turns this seed into executable manifests. T00 records ownership and required truth layers only; no mock result below is marked passed.

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

## Critical paths

| ID | Path | Fast owner | Candidate owner |
| --- | --- | --- | --- |
| CP-01 | startup to clickable shell | T02 | T18 |
| CP-02 | native blank/new Session and send | T02 | T18 |
| CP-03 | ordinary chat/native message render | T02/T12 | T18 |
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
- no T01–T17 command builds or publishes a formal candidate unless its work order explicitly owns that candidate-only boundary;
- T18 stops on any open P0, missing exact-byte receipt or mismatched public predecessor.
