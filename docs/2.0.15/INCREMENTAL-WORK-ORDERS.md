# e-Mate 2.0.15 incremental work-order intake

This addendum merges the 2026-08-27 issue-fix work orders into the existing T00–T18 program. The attached documents are planning input, not a replacement for the current source baseline, owner map, target contract, or release receipts.

## Intake receipts

| Input | SHA-256 | Use |
| --- | --- | --- |
| `e-Mate-2.0.15-development-work-orders.md` | `f43129bcd8ff0d03ea92ddf9b131980363154d21db99e3e19af80d0e3b59c152` | concise issue and UX work orders |
| pasted source analysis | `ba3937d3d9deea7c1a2265e20e817551622d1cbea2392956153982a90494907a` | supporting analysis and alternative implementation proposals |
| P0 image-input source analysis | `79fb23791d6c489ad7ea7a39b94fa2493ee29df766bf7945ab628a3970f47dc6` | native Attachment-first defect report, upstream references and acceptance matrix |

The integration baseline remains the current `release/2.0.15` history. Public production remains exact 2.0.13 until T18 has protected-source, byte, install, rollback, public and ownership receipts.

## Source-backed rulings

| Area | Current repository fact | Binding 2.0.15 decision |
| --- | --- | --- |
| Native image intake | The pinned Vision client captures composer paste before the native handler, calls `preventDefault()` plus `stopImmediatePropagation()`, copies each image through `/_dsh/vision-toolkit/paste-images`, and serializes an absolute-path sentence. The native Harness already owns immutable image Attachments and image `ContentBlock`s; File Import already routes ordinary images back to the native drop owner. | Treat this as a confirmed P0 Composer-edge routing defect, not an OCR-quality issue. Paste, drop and upload are native Attachment first. T15 may bounded-backport only the owner-compatible semantics from upstream `047324a`/`5e485fb`; it must not wholesale import their UI-label/DOM heuristics or automatic model switching. Image-capable and unknown-capability models stay on the native path. Confirmed text-only models may receive a request-time visual description while the durable native image message remains unchanged. |
| Image execution | `imagegen` already owns the native Tool, Job, child Session, Attachment and durable `emate/image-output` receipt path. One call produces one output and `image_pack` only packages completed attachments. | Keep one executable `imagegen` implementation. `imagen` becomes a discovery spelling for the canonical schema, not a second Provider or ledger. Multiple independent outputs use multiple native Tool calls and children. Do not add a browser queue, Renderer concurrency, private image store, second Job queue, or recursive batch Tool. |
| Image concurrency | The two supplied documents conflict between a custom semaphore defaulting to 3 and native Job capacity staged at 1/2/4. The current target contract requires separate Tool calls and the native Job owner. | Reuse the native Agent/Job admission path and measure 1, 2 and 4. The shipped default is selected only from installed success, latency, rate-limit, memory, cancellation and unknown-result receipts; it is not predeclared as 3. The hard ceiling is 4. |
| Image edit inputs | Current code accepts exact current-session `sha256:` Attachment IDs and already rejects Job IDs and URLs, but Agent-scope visibility and ambiguous source resolution remain gaps. | T05 adds scoped health, deterministic current-session source resolution, typed failures and semantic verification handoff. No filename/URL/cross-session guessing and no Skill/CDP/browser fallback. |
| Image presentation | The current `ImageDisclosure` scans adjacent DOM, hides generic galleries and portals controls. | T12 replaces DOM inference with typed receipt plus native Assistant-step/Conversation ownership. Attachment ID is the dedupe key. T16 verifies GenUI keeps only its own `dsh-ui` surface. |
| `@` capabilities | The pinned client already has one native `InputTriggerService`; File Import and Computer Use currently register `@` sources. The visible slash glyph is CSS, while Computer Use availability is incorrectly UA-gated. | Reuse the native InputTrigger registry and palette; do not build a second Mention registry, draft store or popup. Provider owners register native sources. The visible slash entry is removed/rebound to the native `@` trigger while hidden manual slash parsing remains compatible for 2.0.15. |
| Goal and plan | Pinned rc.7 exposes native Goals API/projection and session-owned `todo_write`/`todos` planning projection. | `@目标` and `@计划` adapt those owners. Do not create `emate/plan-v1`, LocalStorage, a Goal Store, Router or second Session log. |
| Computer Use | The native helper is macOS-only today and execution already requires the latest direct user message to carry exact `@电脑操控`; Shell candidate discovery is UA-filtered. | T15 exposes runtime capability/permission state. T13 shows macOS ready/needs-permission and Windows unavailable-with-reason; unavailable never means executable. Current-turn explicit authority remains mandatory. |
| Search | The accepted Profile already uses rc.7 native `web_search` with `deepseek-official` and the managed `E_MATE_SEARCH_KEY_DEEPSEEK` lease. `search-mcp` is retired. The Tool Search component patch currently conflicts by selecting insecure HTTP and another provider/model. | Do not revive Search-MCP, add a parallel relay Provider, expose a Key setting, or fall back to CDP/Skill Find. T05 removes the conflicting patch; T10 verifies the existing authenticated search-only grant and zero-user-setup lifecycle; T18 proves it in fresh installed apps. |
| Theme/settings/composer | Shell palettes are duplicated, Desktop advanced windows are transparent, the home composer uses a negative frame extension, Settings branding is text-driven, and Capability/Schedule actions use separate hover owners. | T11 creates the Shell token/host seam. T16 moves Glass Composer onto that real host. T13 performs the final Settings, titlebar, `@` entry and primary-action integration. Stable IDs/metadata replace text/UA/DOM inference. |

## Existing-ticket merge map

| Incoming work order | Existing owner(s) | Added exit criteria |
| --- | --- | --- |
| EM-215-00 contract/baseline | T00 integration owner, then T18 version freeze | This addendum and the narrow target-contract delta pass `check:target` and `check:release-boundary`; package versions remain T18-only. |
| EM-VISION-INPUT-01 native Attachment-first image intake | T10 model-capability contract; T15 Vision implementation; T02 cross-plugin smoke; T18 installed acceptance. T16 participates only if a separate File Import defect is proven. | Paste/drop/upload converge on the native Attachment/CAS and durable image-block path. Five PNGs yield exactly five native Attachments and five model image blocks, with zero absolute-path markers, Skill Find/CDP fallbacks or duplicates. Text + five images, confirmed text-only conversion, Windows Chinese paths and mixed image/PDF/DOCX routing retain order, reloadability and one owner per input. |
| EM-IMG-01 image health/edit reliability | T05; T15 for installed OCR/Vision verification | Agent-scoped visibility; `imagen` discovery spelling; exact source resolution; no wrong fallback; distinct source/output Attachment hashes; typed provider/verification failures. |
| EM-IMG-02 bounded multi-image execution | T05 | 1/2/4 capacity fixtures; N outputs produce N Tool calls, child Sessions, Jobs, provider requests, Attachments and terminal receipts; partial failure/cancel/unknown never replays or erases successes. |
| EM-IMG-03 typed gallery/GenUI isolation | T12; T16 compatibility; T18 installed acceptance | 1/2/3/4/8 responsive layouts, no adjacent-DOM scan/hide/portal ownership, durable rebuild, keyboard/reduced-motion, GenUI + text + gallery exactly once. |
| EM-MENTION-01 native `@` entry | T13 | Click and keyboard share the native InputTrigger lifecycle; visible slash entry is gone; no second popup/draft; hidden legacy slash parsing still works. |
| EM-MENTION-02 provider set | T06 schedule, T07 Skill, T15 Computer Use state, T16 File Import closure, T13 final composition | File, Computer Use, Goal, Plan, Schedule and enabled Skills are structured references from their native owners; static first screen is local and abortable. |
| EM-MENTION-03 Goal/Plan | T13 | Native Goal refs include ID/revision; Plan uses native `todos`; invalid/tombstoned refs fail closed; refresh restores native projection state. |
| EM-SEARCH-01 zero-user-key search | T05 routing, T10 identity/grant, T18 installed service | Native `web_search` only; no user/environment setup; exact auth/revoke/offline/timeout/429/503 states; real source URLs; no provider secret in Renderer/logs. |
| EM-SET-01 Settings product boundary | T13 | Ordinary Settings hide engineering/plugin/provider/concurrency surfaces by stable route/section metadata; `/capabilities` remains usable and does not unload components. |
| EM-UI-01 Shell/titlebar theme | T11 token owner, T13 Desktop/titlebar integration | Light/dark/system across Home, session, project, Settings, Schedules and Capabilities; target titlebar/workspace RGB delta at most 2; no intermediate flash. |
| EM-UI-02 composer frame | T11 host, T16 Glass Composer | One real frame host, no negative bottom patch or ancestor guessing, 100/125/150 percent and reduced-motion acceptance. |
| EM-UI-03 Capability hover | T07 stable Capability action metadata, T13 shared Shell style | Schedule and Capability actions share hover/focus/current/collapsed behavior without localized aria-label selectors. |
| QA/release acceptance | T02 source/app-dir Smoke, owning ticket focused tests, T18 installed/RC | Source fixtures cannot claim installed status. macOS/Windows, account/service, update/rollback and public bytes require exact T18 receipts. |

## Revised dependency spine

1. Finish and merge T01/T02. The existing T03/T04 snapshots are already merged.
2. Merge the narrow contract delta, then run T05 first. T05 freezes Tool/Image/Search visibility and receipt contracts.
3. Run T06, T07, T09, T10 and T14 in dependency-safe waves within the executor cap. T15 starts only after T10 freezes session-selected model capability metadata.
4. Preserve the high-conflict Shell chain: T06 handoff → T11 token/home host → T12 message/gallery → T16 GenUI/Glass handoff → T13 final `@`/Settings/navigation/titlebar integration. T07, T09 and T15 must hand off their exact seams before T13.
5. T08 hands Header ownership to T13. T17 remains blocked on a real Tencent export. T18 is last.

## Repeated-failure in-app ChatGPT consultation

- Trigger only when the same named acceptance check still fails after at least two materially different, source-backed repair attempts. Re-running the same patch or an unavailable external authority does not count.
- The owning ticket pauses further speculative edits and prepares one sanitized context packet: governing target-contract clauses, exact owned paths, minimal relevant source and caller flow, failing command/output, observed versus expected behavior, attempts already made, and explicit forbidden changes.
- Create a separate ChatGPT Work task inside the current ChatGPT/Codex application so the coordinator can wait on it and read its result back directly; do not open the browser/Web ChatGPT path. Ask one focused root-cause and minimum-fix question with the full packet. If the in-app UI exposes the exact `5.6 sol Pro` model/reasoning option, select it. The current task-creation interface cannot force a ChatGPT model, so if that exact option is not exposed, record the limitation and do not silently substitute another model or move the consultation to the Web.
- Treat the response as advisory evidence only. The coordinator reads the separate in-app task directly, while the original ticket retains ownership, applies only an in-scope minimum change, and must reproduce the result with the same local acceptance check. The consultation cannot authorize new paths, dependencies, architecture, merges, release claims or external writes.
- Never include credentials, tokens, private account/customer data, signing material or unrestricted logs. Record only a concise sanitized question/answer summary and the subsequent local verification in the ticket's existing evidence file; do not create a new permanent consultation artifact.

## Acceptance additions

- Image intake: paste five PNGs and text plus five PNGs; drop/upload parity; image-capable and unknown-capability native routing; confirmed text-only request conversion with unchanged durable images; Windows Chinese-path fixture; mixed images/PDF/DOCX; exactly five native Attachments and five model image blocks, zero absolute-path markers, Skill Find/CDP fallbacks and duplicates.
- Image generation: generate 1/2/4/8; edit uploaded/current-session/reopened-session images; independent edits versus explicit fusion; one 429, timeout and invalid response; partial success; cancel; unknown result; `imagen` discovery; source/output SHA inequality; semantic verification does not accept the worker's prose.
- `@`: Home/new/existing sessions; File, Computer Use, Goal, Plan, Schedule and Skill; macOS ready/permission denied; Windows unavailable; IME/keyboard/offline/large local Skill inventory; current-turn Computer Use authority; hidden slash compatibility.
- Search: fresh install with no user Key; grant/revoke/login/offline/timeout/429/503; source URL preservation; no Settings credential; no CDP/Skill fallback.
- UI: macOS/Windows, light/dark/system, Home/session/project/Settings/Schedules/Capabilities, minimum window and 100/125/150 percent; titlebar color, composer frame, hover/focus; streamed text + GenUI + gallery together.

These checks extend ticket evidence. They do not relax the existing protected-source, artifact-identity, installed-state, rollback, public-write or external-authority gates.
