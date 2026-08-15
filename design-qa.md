# e-Mate 2.0.7 Design QA

## 2026-08-15 same-state source correction

This section supersedes the older statement below that no same-state 2.0.5 full-screen truth exists. The pinned 2.0.5 checkout at commit `564a6b6c1d43fb6831dd4a5cd8026e472f063311` ships a deterministic GA frame server. It was run locally with the `many-threads` scenario and captured in the same in-app browser and viewport as the current Harness profile.

- Accepted non-chat source: the current `desktop/src/v1` implementation and its GA frame at `http://127.0.0.1:55205/__ga/frame-app?scenario=many-threads&theme=light|dark`.
- Source captures: `docs/design-qa/2026-08-15-front-fidelity/source-{home,capabilities,settings,login}-1133x701.png` and `source-home-dark-1133x701.png`.
- Current captures: `docs/design-qa/2026-08-15-front-fidelity/current-{home,capabilities,settings,login}-after-loaded-1133x701.png` plus the light Home capture.
- Prohibited evidence remains unchanged: historical `docs/v0.*` and `docs/v1.*` screenshots are not visual truth.

## 2026-08-15 second-round browser correction

The first comparison findings above were fixed against the same pinned source rather than being accepted as approximations. The source and revised implementation were opened together at `1280 × 720` for each inspected surface. The local `home-comparison.html` is only a retained evidence index because the in-app browser correctly refused its `file://` URL; the actual source/current judgments used the image files together in one comparison input.

- Boot and identity: the target `tapIndex` hook now replaces the boot title and loading treatment with the real e-Mate asset and Chinese loading copy. Login width and vertical placement were corrected while retaining the required real-name registration, captcha, keep-login and agreement flows. Evidence: `current-boot-brand-final-1280x720.jpg` and `current-login-after-fix-1280x720.jpg` beside the accepted login source.
- Home and navigation: the desktop sidebar is `248px`, “新任务” has the source active state, “定时任务” is restored, and the target composer/workspace/agent seats are rearranged through stable target slots rather than copied UI or a second Store. The source-width composer, grey workspace strip and top toolbar are visible in `current-home-after-second-fix-1280x720.jpg`. Sidebar, theme and settings controls reached the real Harness actions in browser testing.
- Scheduled tasks: `/schedules` reproduces the seven current 2.0.5 actions and uses the real `Workspace → Session scope → Input draft → Session open` chain. A browser-discovered route bug was fixed so “新任务” returns to `/`, and the final title/card vertical offsets were corrected. Evidence: `source-schedules-1280x720.jpg` with `current-schedules-final-1280x720.jpg`.
- Capabilities: the page keeps the sidebar, restores `发现 / 已安装 / 导入`, uses the two-column Skill Hub surface first, and exposes the eight built-ins from the live plugin registry in an expandable section. The real acceptance Skill Hub returned HTTP 503, so `current-capabilities-after-fix-1280x720.jpg` truthfully shows the offline state; `current-capabilities-builtins-expanded-1280x720.jpg` proves the registry without inventing community cards.
- Settings: the target SettingsRoot remains the owner. The personal profile now includes the source-sized avatar row and a local validated image picker; required model, plugin, connection, password and logout sections remain functional even where the older fixture does not show them. Evidence: `current-settings-after-second-fix-1280x720.jpg` beside the accepted settings source.
- Checks: the cross-cutting package run completed with 40/40 Node tests and 16/16 e-Mate shell Vitest tests. After the final schedule-only spacing change, the TypeScript build and the same 16/16 client tests passed again.

S02/S12 remain open. The current round does not yet provide a post-fix replay at `320/390/768/1280/1920`, a populated same-state Skill Hub comparison while the real service is unavailable, or the full rich-chat/prototype replay against a real workspace and session. State-dependent source data such as project/session/model rows is not fabricated. No visual item may be closed from source-code presence or unit tests alone; a fresh profile, content-revision boot manifest, same-state capture and combined reference/current inspection remain mandatory.

## Evidence

- Source visual truth:
  - `/Users/mac/Documents/Codex/2026-08-12/co-de/outputs/codex-desktop-flow-assets/03-image-group.png`
  - `/Users/mac/Documents/Codex/2026-08-12/co-de/outputs/codex-desktop-flow-assets/04-running-activities.png`
  - `/Users/mac/Documents/Codex/2026-08-12/co-de/outputs/codex-desktop-flow-assets/09-timer-placement.png`
  - `/Users/mac/Documents/Codex/2026-08-12/co-de/outputs/codex-desktop-flow-assets/10-state-supplement.png`
  - `/Users/mac/Documents/Codex/2026-08-12/co-de/outputs/codex-desktop-flow-assets/13-artifact-layouts.png`
  - `/Users/mac/Documents/Codex/2026-08-12/co-de/outputs/codex-desktop-flow-assets/14-motion-sequence.png`
  - `/Users/mac/Documents/Codex/2026-08-12/co-de/outputs/codex-desktop-flow-assets/15-long-text.png`
  - `/Users/mac/.codex/visualizations/2026/08/12/019ff665-d721-79a0-869d-338f086cf529/codex-flow-spec-preview.png`
- Browser-rendered implementation:
  - `artifacts/design-qa/S02-responsive/home-{dark,light}-{320x800,390x844,768x800,1920x1080}.jpg`
  - `artifacts/design-qa/S02-responsive/home-light-1280x800.jpg`
  - `artifacts/design-qa/S02-responsive/home-dark-1440x900.jpg`
  - `artifacts/design-qa/S02-responsive/mobile-drawer-dark-320x800.jpg`
  - `artifacts/design-qa/S02-responsive/capabilities-dark-320x800.jpg`
  - `artifacts/design-qa/S02-responsive/settings-{dark,light}-320x800.jpg`
  - `artifacts/design-qa/S02-responsive/login-light-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-collapsed-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-expanded-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-long-text-collapsed-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-long-text-expanded-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-running-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-approval-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-failed-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-cancelled-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-retry-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-retry-active-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-image-gallery-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-unknown-renderer-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-file-artifacts-1280x800.jpg`
  - `artifacts/design-qa/S03-chat-activity/implementation-office-artifacts-1280x800.jpg`
  - `artifacts/design-qa/S11-connections/implementation-connections-1440x900.jpg`
  - `artifacts/design-qa/S11-connections/implementation-eight-capabilities-1440x900.jpg`
- Focused comparisons:
  - `artifacts/design-qa/S03-chat-activity/focused-timer-comparison.png`
  - `artifacts/design-qa/S03-chat-activity/focused-long-text-comparison.png`
  - `artifacts/design-qa/S03-chat-activity/focused-long-text-expanded-comparison.png`
  - `artifacts/design-qa/S03-chat-activity/focused-running-comparison.png`
  - `artifacts/design-qa/S03-chat-activity/focused-approval-comparison.png`
  - `artifacts/design-qa/S03-chat-activity/focused-failed-comparison.png`
  - `artifacts/design-qa/S03-chat-activity/focused-retry-active-comparison.png`
  - `artifacts/design-qa/S03-chat-activity/focused-image-gallery-comparison.png`
  - `artifacts/design-qa/S03-chat-activity/focused-file-artifacts-comparison.png`
  - `artifacts/design-qa/S03-chat-activity/focused-office-artifacts-comparison.png`
- Route/state: local target Harness Web, authenticated acceptance-only profile. Completed, failed, cancelled and terminal retry sessions came from the target JSONL SessionPersistence; running, approval and scheduled retry were live open target sessions attached through WorkspaceRegistry. The later shell pass exercised dark/light Home, mobile drawer, `/login`, `/capabilities`, `/settings` and a real `/chat/:sessionId` through the same target Web instance. Settings direct/back/forward/close/Escape and chat direct/reload/back/forward/unknown-ID failure were verified; an unauthenticated protected chat deep link returned to that exact session after login.
- Viewport: the chat-state pass used `1280 × 800` CSS px; the shell pass used `320 × 800`, `390 × 844`, `768 × 800`, `1280 × 800`, `1440 × 900` and `1920 × 1080`, device scale factor `1`.
- Pixels and normalization:
  - timer source: `1600 × 700` px;
  - full flow source: `1600 × 900` px;
  - implementation captures: `1280 × 800` px;
  - focused comparison canvas: `900 × 520` px;
  - the timer source and implementation were cropped to the same semantic region and fitted into equal-width comparison panels. This is valid for hierarchy and placement, not a whole-screen pixel-difference score.
- Primary interactions tested: completed group defaults collapsed; activating its button expands the two real Tool rows; a second activation collapses them; `aria-expanded` changes with the visible state; the final answer stays visible outside the group. User and assistant messages whose rendered height exceeds `160px` use the same already-rendered Markdown element, expose exact `aria-controls`, expand in place, and collapse again; the assistant control moves from the centered lower edge to the source-matched upper-right edge without replacing the Markdown DOM. Running duration changes from the real open-turn time; the target approval request exposes `拒绝/允许一次`, and rejecting it through `/api/respond` removes the approval panel and restores the target composer. Failed/cancelled evidence stays visible without a fake final-answer action tail. Scheduled retry animates only while active; the persisted cancelled retry is static. Two durable target ImageBlocks load as one equal-tile Gallery; activating either tile opens the target authorized original-image lightbox and its close action works. An unknown future block falls through to the target JsonBlock, expands and collapses without crashing or losing its payload. Two real migrated file artifacts render as vertical rows; their loopback `HEAD/GET` path returns the expected attachment metadata and exact CAS bytes. A real Office Worker result persists structured target presentation metadata, leaves the generic Tool activity row inside the activity group, and renders its DOCX in the target turn-tail chain after the normal answer; reload and download both preserve the artifact identity. The target SettingsRoot opens the new “外部连接” section; all four required providers render from the Host catalog. A dummy Feishu App ID was saved through target `credentials.set`, reloaded as `source: keychain` without value disclosure, then removed through the two-step confirmation and target `credentials.unset`. The capability center then showed exactly eight built-ins while a real Skill Hub HTTP 500 remained isolated.
- Runtime evidence: the page used the target SessionPersistence, Connection, Conversation Node registry and existing Tool renderer. No product mock transport or alternate chat store was used. The temporary identity provider and durable event fixture lived only under an isolated `/tmp` DSH home and are not product code or production acceptance.
- Shell measurements: every tested Home viewport reported `scrollWidth === clientWidth`; mobile used the target e-Mate drawer instead of desktop window compensation; the `320px` drawer measured `288px` wide inside an `8px` inset and kept its close control visible. Light/dark theme changes persisted through target settings. `/capabilities` survived back, forward and reload. The acceptance-only identity provider returned a real target RPC failure for Skill Hub; after the focused repair the local plugin registry still rendered Office, OCR and Browser while the community error remained visible.
- Console errors: fresh stable reload at `2026-08-14T22:19:44.441Z` produced zero warning/error entries after the cutoff. Older `connection lost, retry` warnings in the tab log predate the cutoff and came from intentional local-server restarts during QA.

## Full-view comparison

The source package provides a full interaction specification and focused state frames, but no same-content, same-viewport full-screen frame for this target Web shell or the final 2.0.4/2.0.5 external-connections state. The rendered full views were inspected at `1280 × 800` and `1440 × 900`, but a whole-screen fidelity pass cannot be scored without inventing correspondence between different content and crops. Historical `docs/v0.*` connection captures are not promoted to current visual truth. This is a blocking evidence gap rather than permission to use an older e-Mate screen.

## Focused-region comparison

The combined timer/activity image was opened and judged as one comparison input. The revised implementation now places the single real `已处理 1分18秒` activity header before the collapsed Tool history and normal final answer. It removes the duplicate terminal `用时`, keeps the final answer outside the activity group, and uses the target icon/component family. No actionable P0/P1/P2 difference remains in this focused completed-state region.

The long-text source and browser captures were also opened as combined collapsed and expanded inputs. The implementation now matches the source hierarchy: bordered `长文本摘要` card, visible rendered-content window, bottom fade and centered collapsed action; the expanded action remains inside the same card at the upper-right. Exact content differs by the durable acceptance fixture, so these comparisons close structure and interaction fidelity rather than claiming a raw pixel-difference score.

Running, approval, failed and active-retry source/implementation pairs were opened as combined inputs. The implementation preserves the source's compact status-first hierarchy, real Tool summary, semantic failure evidence and numbered retry attempt. Approval remains in the target Harness `conversation.composer` slot rather than being moved into a second e-Mate-owned flow; this is the deliberate structural reuse boundary requested for WebUI–CLI communication. Cancellation has no standalone matching source frame, so its browser capture was checked against the supplied terminal-state/motion contract: visible cancelled Tool evidence, static terminal state and no fake answer tail.

The image-group source and implementation were opened as one combined input. Harness already merges consecutive authorized ImageBlocks, loads attachment bytes and owns the lightbox. The only e-Mate change is presentational: response tiles grow from target-default `64 × 64` to equal `clamp(112px, 18vw, 156px)` squares, yielding measured `156 × 156` tiles at this viewport. This restores source readability without adding an attachment API, Gallery component or image state machine.

The file-and-document source was compared separately with imported history and a newly generated Office result. Both implementations use one dark raised section, a compact heading, vertical same-category rows, restrained separators and filename-first metadata. History deliberately says `历史附件`; new output uses `文件与文档`, sits after the normal answer through the target turn-tail chain and displays `DOCX · 35.9 KiB`. The history object verified exact 11.6 KiB CAS bytes. The Office result came from the packaged Worker and verified HTTP 200, `Content-Length: 36711`, the DOCX MIME type, attachment disposition, `private, no-store`, `nosniff`, and GET SHA-256 `2df4bb0f5365332913d2a62456c87baa9548a0c4d5f3203396bc3eaa189f42ff`. This closes desktop-width Office create output presentation and download; edit/read/export breadth and responsive wrapping remain broader S10/S12 acceptance work.

## Required fidelity surfaces

- Fonts and typography: the focused status hierarchy, weight and line height are consistent with the supplied completed-state frame. Long-text heading/body hierarchy is visually aligned in the combined evidence; shell typography remains legible without clipping at all six measured widths. Exact same-state light-chat antialiasing remains unverified.
- Spacing and layout rhythm: timer, activity history and final-answer order now matches the focused source; compact Tool rows expand and collapse without moving the answer into the group. Home, drawer, login, capability and settings shells have measured responsive evidence; the same durable chat/Office/image state has not yet been replayed at every width.
- Colors and tokens: the dark state uses the existing target/e-Mate token stack and no new palette. Pending/approval and failed semantics have combined visual evidence; both light and dark shell tokens were exercised, while full chat-state coverage in light theme remains open.
- Image quality and asset fidelity: the shell continues using pinned e-Mate source assets rather than generated placeholders. Two real PNG attachments render as equal source-aligned tiles and open at original resolution through the target lightbox. Imported and newly generated Office artifacts match the source's vertical document hierarchy and download exact CAS bytes. Small-breakpoint wrapping remains unverified.
- Copy and content: `正在工作/已处理 + 真实耗时`, Tool summaries, retry attempts, approval controls, failure/cancellation evidence, normal answer and long-message bodies come from persisted events or the target renderer. The UI does not emit a fake green success card or hard-coded Tool name.
- External connections: the implementation uses the final source component's compact row, status pill, raised surface, credential field and action hierarchy with the target icon library. It exposes no stored value and every visible Save/Clear/Refresh action reached the target Connection/Credentials path. Exact final-source typography, spacing and brand-icon fidelity remain unscored because no accepted same-state 2.0.4/2.0.5 screenshot is available.

## Findings

- [P1] Responsive shell evidence is present, but responsive real-chat and artifact coverage is incomplete.
  - Location: durable chat, Office, file and image sessions at `320`, `390`, `768`, `1280` and `1920` widths in both themes.
  - Evidence: Home, drawer, login, capabilities and settings now have browser captures and no-overflow measurements; the rich chat fixtures remain dark `1280 × 800` only.
  - Impact: long content, approval controls, model selection, image grids and document rows can still regress at small widths even though the outer shell is sound.
  - Fix: replay the same real rich sessions at every required breakpoint and theme, recording bounds, overflow, tap targets and reduced-motion behavior.
- [P2] Full-screen same-state visual truth is missing.
  - Location: complete chat screen at `1280 × 800`.
  - Evidence: available source and implementation full views differ in viewport/content; the fresh browser reload is clean, but no matching source frame exists.
  - Impact: the focused passes cannot close whole-screen hierarchy and density acceptance.
  - Fix: obtain/export the final same-state source frame and compare it with a fresh browser capture.

## Comparison history

1. Initial focused pass — blocked.
   - Findings: the target terminal `用时` sat after the last Tool row; no single activity header owned the group; completed Tool history could not collapse; final hierarchy diverged from `09-timer-placement.png`.
2. Fix applied.
   - Registered `e-mate-activity-group` through the official `conversationEvents` definition and keyed `conversation.chat.node` renderer.
   - Derived status and duration only from real `turn/start`, `tool/call` and `turn/end` events.
   - Marked only settled successful Tool/Command nodes collapsible, preserving non-success evidence.
   - Suppressed the duplicate target terminal duration only when the real turn-owned activity header exists.
3. Revised focused pass — the earlier focused P1 findings are resolved.
   - Post-fix evidence: `artifacts/design-qa/S03-chat-activity/focused-timer-comparison.png` plus collapsed/expanded browser captures listed above.
4. Long-text pass — initial P2 resolved after one visual correction.
   - Initial renderer used a separate disclosure row, which put the assistant action outside the summary card and left the expanded action at the content tail.
   - The correction portals only the control into the existing target-owned Markdown element; the element itself is never re-rendered or replaced. Render-height measurement, state and ARIA stay in the keyed target Conversation Node.
   - Post-fix combined evidence is `focused-long-text-comparison.png` and `focused-long-text-expanded-comparison.png`; browser bounds confirmed collapsed `198/1696` client/scroll height, expanded `1654/1654`, and exact control-to-element ID matching.
5. Required state pass — earlier state P1 resolved.
   - Running, approval and active retry were created as live open target sessions; failed, cancelled and terminal retry were replayed from persisted target events. No product fixture or alternate transport was added.
   - Failure/cancellation initially retained the target terminal answer-action tail even though no normal final answer existed. The renderer now finds the exact turn tail across the whole flow and hides it only for `failed/cancelled`, while preserving partial commentary, Tool failure and turn-error evidence.
   - A broad long-message kind selector initially styled short assistant text as `长文本摘要`; all message-card rules now require the measured `data-emate-long-text` boundary. Browser checks report zero short cards across the required state fixtures.
   - Combined evidence is `focused-running-comparison.png`, `focused-approval-comparison.png`, `focused-failed-comparison.png` and `focused-retry-active-comparison.png`; terminal retry/cancellation have separate implementation captures. Approval rejection completed through the real answerable frame and restored the composer.
   - Remaining findings are themes, viewports, file/Office outputs and unmatched whole-screen truth, so the overall result stays blocked.
6. Image/unknown pass — target renderers retained.
   - Browser evidence first exposed target-default `64 × 64` multi-image tiles, materially below the supplied image-group frame. A CSS-only override on target semantic attributes now measures `156 × 156` at `1280px`, while the target Gallery still owns grouping, loading, authorization and lightbox behavior.
   - The same real target session opened and closed the original-image dialog successfully. A separate session with an unrecognized content type rendered the target's collapsed `未知内容块`, expanded to lossless JSON, and left the composer usable.
   - Evidence is `focused-image-gallery-comparison.png`, `implementation-image-gallery-1280x800.jpg` and `implementation-unknown-renderer-1280x800.jpg`.
7. Imported file-artifact pass — migration renderer retained.
   - The first browser capture used a flat gray card that weakened the source's raised section and row hierarchy. A CSS-only correction now uses the existing layer token, one section header and row separators; the target keyed renderer, artifact identity and download contract are unchanged.
   - The source/implementation comparison is `focused-file-artifacts-comparison.png`; full evidence is `implementation-file-artifacts-1280x800.jpg`. This pass closes migrated historical files, not new Office Tool output.
8. Office create-output pass — target turn-tail chain retained.
   - The Tool definition projects its already validated result through target `presentationMeta`; a turn-scoped target Conversation Definition folds that durable meta, and the plugin registers `文件与文档` into `conversation.chat.turnTail`. The keyed Tool row remains generic and inside the activity group; no alternate event, transport or artifact Store was added.
   - A packaged Worker generated the DOCX, the final answer rendered before the file section, reload preserved it, and GET bytes matched the immutable receipt. Evidence is `focused-office-artifacts-comparison.png` and `implementation-office-artifacts-1280x800.jpg`.
9. Browser shell responsive pass — outer-shell P1 narrowed, not closed for rich chat.
   - Home was exercised at `320`, `390`, `768`, `1280`, `1440` and `1920` widths; both themes were covered at the contract breakpoints and no horizontal overflow was measured.
   - The `320px` drawer, capability page, Settings, `/login`, `/capabilities` history/reload and login/logout were exercised through target-owned actions. Login now restores protected History and reloads the target bootstrap after a validated RPC receipt, so every identity consumer shows the same user without a second client store.
   - `/settings` is a lifecycle projection over target SettingsRoot, and `/chat/:sessionId` projects only target `sessions.list/open/clear`. Real browser direct/reload/back/forward checks passed; unknown chat IDs return to real Home instead of creating a fake Session.
   - A real Skill Hub RPC failure initially hid all local capabilities. The loader now commits validated local registry metadata before the optional remote request; browser recheck kept all eight registered built-ins visible and preserved the remote failure alert. Image and four external-connection adapters continue to fail closed until their real enterprise endpoint or external authorization is available.
   - No task-provided final 2.0.4/2.0.5 same-state screenshot exists in this evidence set. Historical `docs/v0.*` and `docs/v1.*` screenshots remain excluded by `docs/ui-fidelity-map.md`, so full-screen fidelity stays blocked rather than being scored against an old screen.
10. External-connections target-path pass — structure and interactions verified, visual truth blocked.
   - A shared TypeScript Cordis plugin registered Feishu, Tencent Docs, WeChat and DingTalk metadata; the Settings page used target `settings.section`, `/emate.connections` Connection RPC and `ctx.connection.api.credentials` rather than an e-Mate transport or browser secret store.
   - Browser evidence at `1440 × 900` showed all rows, the OS-store disclosure, responsive credential fields and honest setup/blocked states. A dummy Feishu App ID completed save, target catalog refresh, Keychain source projection, two-click clear and final unconfigured state; the test item was removed.
   - The ability center showed exactly image, Office, OCR, browser, Feishu, Tencent Docs, WeChat and DingTalk. Missing live provider accounts do not create buttons or fake ready states.
   - The first mobile check found a `20–40px` refresh target and a `/settings` route that did not recover after the first-use agreement or a desktop-to-mobile resize. The refresh action is now exactly `44×44px` at `320/390/768/1280/1920`; the route calls the target layout action, ignores target-preloaded but hidden Settings nodes and performs only a bounded result check when the first responsive toggle loses a race.
   - Main-browser evidence now covers agreement → `/settings`, `320→1920→320`, direct close, real-button reopen, back and forward. All retain the target SettingsRoot and show no horizontal overflow.
   - Built-in cards now render plugin-provided `icon_key` values with the fixed Harness icon library and generic renderer; no capability ID/title branch exists. All eight cards and Chinese states are visible in both themes, while the real remote Skill Hub failure is localized without being converted to success.
   - Implementation evidence is `implementation-connections-1440x900.jpg`, `implementation-connections-320x800.jpg`, `implementation-eight-capabilities-1440x900.jpg`, and `artifacts/design-qa/S10-capability-icons/`. A task-accepted final 2.0.4/2.0.5 same-state source screenshot is absent, so this pass cannot close exact visual fidelity.

## Implementation checklist

1. Run the same rich chat sessions at all five widths and both themes, including keyboard and reduced-motion checks.
2. Verify Office/file/image wrapping at the remaining viewports and keep edit/read/export breadth in S10/S12.
3. Obtain a same-state full-screen source frame and rerun the combined full-view comparison.

## Follow-up polish

- Revisit only P3 optical alignment after all state and responsive evidence is available; do not tune the target renderer against unmatched screenshots.

## S02 e-Mate 2.0.5 composer projection — 2026-08-15

### Visual source and implementation

- Source of truth: pinned `upstream/e-mate-2.0.5` commit `564a6b6c1d43fb6831dd4a5cd8026e472f063311`, rendered directly from `desktop/src/v1/components/Composer.tsx` and its current `features.css`; no historical `docs/v0.*`/`docs/v1.*` screen was used.
- Target seam: the pinned Harness `ConversationRoot` and `InputBar` remain the sole composer owner. e-Mate registers only `conversation.input.right` and styles the existing `data-composer-*` structure; draft, attachments, workspace, model policy, submit and transport are unchanged.
- Desktop measurements at `1440 × 900`: source and implementation card `1056 × 114`, input `1054 × 66`, toolbar row `1054 × 40`, and internal gap `6px`. The implementation add/model/external/send controls are `42/83/89/76px × 32px`, with zero horizontal overflow. The final Send control reuses the resident submit button, presents a horizontal paper-plane plus `发送`, and measures `76 × 32px` with a `10px` radius instead of inheriting the target's circular arrow layout.
- Responsive measurements at `390 × 844`: zero horizontal overflow; external-connection and Send controls both expose `44 × 44px` targets and hide their labels while retaining accessible names.
- Source capture: `artifacts/design-qa/S02-composer-205/source-2.0.5-dark-1440x900.png`.
- Implementation captures: the prior send/seam pass remains at `artifacts/design-qa/S02-composer-205/implementation-button-seam-final-dark-1440x900.png`; the latest clean-profile desktop/mobile states are `artifacts/design-qa/S02-composer-205-round3/implementation-general-workspace-final-dark-1440x900.png` and `artifacts/design-qa/S02-composer-205-round3/implementation-general-workspace-final-dark-mobile-390x844.png`.
- Combined comparison: `artifacts/design-qa/S02-composer-205-round3/source-vs-implementation-composer-workspace-final-1440.png`. It compares the accepted 2.0.5 composer above the current implementation below in one inspection input.
- Latest desktop DOM measurements at `1440 × 900`, DPR 1: card `1056 × 114` at `(308, 346.27)`, input `1054 × 66`, action row `1054 × 40`, model `83.05 × 32`, external connection `89.05 × 32`, Send `76 × 32`, and the real workspace target `105.05 × 28`. The textarea/backdrop/mirror layers now compute to a transparent background inside the one resident card, removing the false split surface; `scrollWidth === clientWidth === 1440`.
- Latest mobile DOM measurements at `390 × 844`, DPR 1: card `358 × 126`, model `83.05 × 44`, external connection `44 × 44`, Send `44 × 44`, workspace target `105.05 × 44`; `scrollWidth === clientWidth === 390`.

### Interaction and route closure

- Browser click on `打开飞书和腾讯文档连接器` reached the existing route `/settings?section=connections&connectors=feishu,tencent-docs`.
- The existing Harness SettingsRoot selected its registered `外部连接` section and rendered only the real `feishu` and `tencent-docs` catalog entries. WeChat and DingTalk were absent from this focused projection; no new Router, Store, page, transport or fake success state was introduced.
- A clean rebuilt profile opened the actual Host-managed `emate-general-workspace` through Harness's initial Workspace selection. The resident workspace target displayed `通用会话`; opening it exposed `通用会话` and `添加工作区…`, so the user can remain in a general session or choose a real project folder without an input-level “选择一个工作区开始” blocker. Workspace creation, selection, Session and History remain target-owned.
- The resident model target and Send control are not simulated. In this isolated run the model menu truthfully contained only its empty-state heading and the Send control remained disabled because S07 had no allowed adapter; all visible enabled controls reached their existing Harness actions.

### Findings

- [P1] Exact enabled-model same-state comparison remains externally blocked.
  - Evidence: the pinned 2.0.5 source fixture exposes `GPT-5.6 Luna · 最大推理`; the isolated 2.0.7 QA profile honestly reports `当前模型不可用，请先选择模型` because no S07 model adapter is available. One test-only adapter attempt did not alter the catalog and was not shipped or extended.
  - Impact: composer geometry and route closure are verified, but enabled textarea/model copy and focus/submission behavior cannot be claimed same-state from this run.
  - Closure: rerun this exact capture after the real enterprise model adapter is present; do not add a UI fixture or alternate transport.

### Comparison history

1. The first Browser pass found composer width, row height, spacing and control-order drift; those values were corrected against the pinned source CSS.
2. The revised desktop and mobile captures closed the earlier geometry and responsive findings. The main process then produced and inspected the combined comparison above without changing product code.
3. The enabled-model state remains unmatched, so the composer slice cannot yet receive a full one-to-one `passed` result.
4. A user-supplied side-by-side review exposed two residual P1s hidden by the full-screen scale: the resident circular arrow button stacked the added label vertically, and independent four-corner composer/workspace surfaces exposed a dark seam. The correction only skins the same submit control and divides the shared `24px` outer radius between the composer top and workspace bottom; final desktop/focused/mobile captures close both findings without changing InputBar ownership.
5. The third review exposed a state root cause rather than another missing widget: the old `55127` process used an out-of-date generated profile with no managed general workspace. A clean profile from current source created the existing `emate-general-workspace`, and the target's native initial selection opened it without adding a second workspace/session flow.
6. The clean run exposed one packaging defect: the shell imported `lucide-send.svg`, but profile installation did not copy it. The existing profile asset copy list now includes that file, and the Host asset route test verifies its SVG response.
7. The final desktop and mobile Browser pass verifies the real workspace/model/connection/Send targets, the source-sized continuous input surface and zero horizontal overflow. The only remaining same-state difference is the missing production model adapter described above; it is not replaced by a frontend fixture.

final result: blocked

## S07 enterprise admin model connectivity — 2026-08-15

- Visual source: the current e-Mate user surface and the pinned 2.0.5 logo/OKLCH design tokens already used by this repository. No separate approved admin-screen reference exists, so this pass verifies design-language reuse and responsive closure rather than claiming an invented one-to-one admin layout.
- The model row keeps the e-Mate dark workspace, orange primary action, existing Arco controls, compact status tags and rounded record surface. “测试联通” remains next to the route it tests and reports the real terminal state as “联通正常” or “联通失败”.
- Desktop evidence: `artifacts/design-qa/S07-admin/models-connectivity-final-1280x900.jpg`.
- Mobile evidence: `artifacts/design-qa/S07-admin/models-connectivity-mobile-final-320x800.jpg`. Browser measurement after the grid min-content fix is `clientWidth=320`, `scrollWidth=320`; inactive target tab panes are clipped by the resident Tabs container instead of widening the document.
- Functional result: passed against a same-contract local Auth/Admin/Model Gateway fixture. Production visual and connectivity acceptance remain blocked on the real administrator account, consent, reverse proxy and Model Gateway environment.

## S07 usage dashboard e-Mate visual language — 2026-08-15

- Source visual truth: `artifacts/design-qa/S02-responsive/home-dark-1440x900.jpg`, `artifacts/design-qa/S02-responsive/home-light-1280x800.jpg`, canonical `upstream/e-mate-2.0.5/desktop/src/styles/tokens.css`, and `upstream/e-mate-2.0.5/design.md`. This is a design-language target rather than a same-content usage-screen mock; no usage facts were changed to resemble the source.
- Browser implementation: `artifacts/design-qa/S07-usage-dashboard/implementation-dark-1280x900.jpg` and `implementation-dark-320x800.jpg`; combined full-view evidence is `source-vs-implementation-dark.jpg`. CSS viewport and capture pixels are respectively `1280×900`/`1280×900` and `320×800`/`320×800`, device scale factor 1.
- State: authenticated ready state from a local read-only fixture matching the production contracts. Desktop and mobile both measured `scrollWidth === clientWidth`; the user/model table keeps its own horizontal scroll at mobile width. Theme attributes were `data-theme=dark` and `arco-theme=dark`; the light path consumes the exact canonical light Token block and the runtime synchronizes both attributes on `prefers-color-scheme` changes.
- Full-view comparison: navigation width, 8px workspace inset, single 16px workspace frame, system CJK type, neutral surface hierarchy, rule density, icon stroke voice, brand logo treatment and restrained orange action use match the user surface. Usage-specific semantic green/red states are retained because they represent real ledger outcomes.
- Focused-region comparison was not needed after opening the combined full view at `1440×900`: logo, navigation, header, status strip, metric row, panels and chart strokes were legible. Image fidelity is limited to the existing e-Mate logo; the analytics screen has no illustration target and does not substitute CSS art or placeholder imagery.
- Primary interactions tested: read-token entry, ready-state load, refresh control presence, four navigation anchors, events drawer open, Escape close, and responsive reload. Browser console inspection found only the existing Arco/React 19 `element.ref` development warning; no dashboard error state appeared.

### Comparison history

1. The first `320×800` capture found a P2 mobile regression: `.sidebar nav a span` also hid IconPark's wrapper, leaving the active background without visible navigation icons.
2. The selector was narrowed to the direct last-child text label. The post-fix capture shows all four icons, no overlap, and zero document-level horizontal overflow.
3. The final source/implementation comparison found no remaining P0/P1/P2 design-language mismatch. Light-mode visual capture was not forced by changing the user's OS appearance; exact canonical light tokens and live system-theme synchronization are locked by the focused test.

final result: passed

## S03/S12 rich-chat composer main-agent Computer Use — 2026-08-16

- Acceptance source: pinned e-Mate 2.0.5 composer at `artifacts/design-qa/S02-composer-205/source-2.0.5-dark-1440x900.png`, plus the real target Harness `InputBar`/Session event projection. The test profile used the current source bundle, target `SessionPersistence` with 5,000 persisted events and a local acceptance identity projection; it did not replace the resident composer, model selector, Session store or transport.
- Main-agent first pass found two P1 defects: the placeholder was vertically clipped, and at `320x800` the model/connector/Send row overlapped with the real `44px` Send control ending outside the viewport. A child agent made the scoped CSS/test repair; the main agent rejected its first result because at `768x800` and `1440x900` the mirror/backdrop were `44px` but the absolute textarea remained `28px` with `scrollHeight=38px`.
- Root cause was the e-Mate page selector `:global([data-phase])`, which also matched the target textarea's `data-phase='plain'` and applied page-level margin/height/overflow. The corrected selector is scoped to the stable target root `[data-slot='conversation'] > div[data-phase]`; no textarea-specific patch, alternate composer or transport was added. The mobile toolbar follows the 2.0.5 two-row responsive shape and continues to use the target model, connector and submit actions.
- Main-agent final measurements at `1440x900`, `1280x800`, `768x800`, `390x844` and `320x800`: document horizontal overflow is `0`; textarea `clientHeight=scrollHeight=44px`, margin `0`; desktop Send is `76x32px`; mobile Send is `44x44px` and remains fully inside the viewport. Dark and light captures both pass at desktop and `320px`.
- Interaction closure: the real model selector opened and Escape closed it; the real connector control navigated to `/settings?section=connections&connectors=feishu,tencent-docs` and rendered only the registered Feishu and Tencent Docs configuration surfaces. No authorization or credential submission was performed.
- Evidence: pre-fix `02-rich-chat-dark-1440x900.png`, `04-rich-chat-dark-mobile-320x800.jpg`; rejected intermediate `07-rich-chat-dark-768x800-fixed.jpg`; final `08-rich-chat-dark-1440x900-final.jpg`, the four `09-rich-chat-dark-*-final.jpg` responsive captures, `10-rich-chat-light-1440x900-final.jpg`, `11-rich-chat-light-320x800-final.jpg`, `12-connections-feishu-tencent-light-1440x900.jpg`, and combined `13-source-205-vs-current-207-dark-1440.jpg`, all under `artifacts/design-qa/S12-current-067873f/`.
- The specific composer clipping/responsive issue is closed. Full S03/S12 release acceptance remains open for the six live event states, real multi-model Provider switch, weak-network recovery, production performance receipts and remaining S00-S11 gates.

final result: passed (scoped composer layout and connector route)
