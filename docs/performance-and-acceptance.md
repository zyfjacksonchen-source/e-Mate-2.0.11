# Performance and acceptance

This document is a release gate for e-Mate 2.0.7. A scenario is `passed` only with commands, screenshots or traces, immutable IDs, and the observed result. Missing enterprise accounts, credentials, platform capabilities, or real external targets are `blocked`; mocks cannot close a production acceptance item.

## Core browser and performance gates

- Cold local Web LCP is at most 2.0 seconds and interactive time at most 2.5 seconds.
- INP p75 for typing, model selection, navigation, dialogs, and sidebar actions is at most 100 ms.
- At 30 real events per second for 60 seconds, event-to-paint is p95 at most 50 ms and p99 at most 100 ms.
- A 5,000-event session scrolls at an average of at least 55 fps, uses at most 300 MB JS heap, and has no steady-state main-thread task above 100 ms. Frame-drop percentage is diagnostic evidence only and is not a release gate.
- Opening and closing 20 sessions grows retained heap by at most 10%.
- Chrome Performance Trace (gzip is accepted when the uncompressed SHA/size remain in the metrics receipt), React Profiler summary, fixed replay dataset, viewport, build SHA, Node/browser version, and before/after figures are retained per release.

### Harness parity for response and Tool latency

Run paired samples on the same machine, browser, network, provider model, prompt set, Tool fixture and warm/cold state: pinned Harness `0.1.0-rc.5` is the baseline; e-Mate uses a valid cached login lease, the same locally cached model policy and asynchronous audit outbox. Use at least 30 successful samples per path and retain raw timings.

- first response/TTFT adds at most 5% at p50 and 10% at p95, with an absolute allowance of 50 ms when that is larger than the percentage allowance;
- steady streamed generation throughput (provider output tokens per second, excluding TTFT) is no more than 5% lower at p50 and 10% lower at p95;
- persisted Tool-call event to real Tool start, and Tool-result persistence to the next model request, each add at most 50 ms at p95 and no more than 10% versus the target baseline;
- repeat the paired run with the enterprise endpoint unavailable while the login lease and last valid model policy remain valid. Local execution must stay within the same budgets, the audit outbox may remain pending, and no response/Tool event may be duplicated;
- new login, expired/revoked lease and invalid model policy are correctness failures and are measured separately; they must fail closed and are not included in the steady local-runtime latency sample.

If provider or network variance makes a paired sample incomparable, discard both members with the same documented reason and rerun; do not average unrelated providers, models or time windows into a passing result.

`pnpm performance:parity --output <receipt.json>` is the executable collector/evaluator self-check. Its keyless default runs the pinned Agent Loop and derives timings only from its real `user/message`, `assistant/chunk`, `assistant/message`, `tool/call`, and `tool/result` events plus the real Tool body/request boundaries. It creates 30 paired samples for baseline, online, and enterprise-unavailable-with-valid-cache cohorts, but deliberately reports `fixture-passed-production-blocked`: the deterministic provider does not prove e-Mate or a production Provider's latency.

A production `--input` can report `passed` only when every cohort supplies an immutable run receipt bound to the pinned commit, exact provider/model/Tool/dataset, identical machine/OS/architecture/Node/browser/network environment, start/finish times, raw sample-ID/sample digests, and two existing artifact files: the raw samples and a Provider invocation/usage receipt or trace. The evaluator reads and SHA-256 verifies both files relative to the input receipt; relabeling a handwritten fixture as `production-real-provider`, setting a JSON verification flag, omitting the approved identity, or supplying arrays without these artifacts stays `fixture-passed-production-blocked`.

## Project memory isolation and binding

Use two real Harness workspaces A and B with distinct canonical directories and one ungrouped session.

1. Write a uniquely identifiable project memory in A, run the selected `memory-evolve` path, and prove the evolved memory is recalled in a new A session.
2. Open B and the ungrouped session; prove neither can search, recall, evolve, mutate, or enumerate A's facts.
3. Write equivalent facts in B and prove A cannot see them.
4. Rename A through the Harness workspace action; prove the stable workspace binding and recall remain intact.
5. Move or remove A's directory outside e-Mate, then attempt a project-memory read/write; it must fail closed and must not fall back to B, process cwd, or global memory.
6. Attempt to replay a session header or legacy import receipt against the wrong workspace ID/path; the mutation must be rejected and both scopes must remain byte-for-byte unchanged.
7. Re-run legacy CowAgent import; deduplication receipts must prevent duplicate facts and source files must remain unchanged.

Evidence records workspace IDs, canonical-path fingerprints, session IDs, memory item IDs, migration receipt IDs, before/after hashes, and the exact failure code. It does not record memory contents that contain user secrets.

## Complete UI action closure

Build an inventory from every visible page and state in `docs/ui-fidelity-map.md`: login, agreement gate, Home, sidebar, conversation, capability center, Skill Hub, artifacts, connections, settings, model selection, approvals, errors, updates, and account actions at 320/390/768/1280/1920 px.

For every link, button, menu item, row action, input, switch, tab, dialog action, drag/drop target, download, and keyboard shortcut:

- identify its real Harness slot/service/RPC/Tool/Job action;
- trigger it through Computer Use;
- observe pending state when applicable, one terminal success/error/cancel result, authoritative state reload, refresh persistence, and keyboard/focus behavior;
- prove double activation is fenced or idempotent;
- prove failure never shows success and an unknown plugin uses the generic safe renderer.

An empty callback, `href="#"`, console-only action, local fake timer, dead menu item, invisible error, non-working close/back action, or a button that only changes browser-local state is a release failure. Decorative affordances must not have button/link semantics.

## Password change, logout, and re-login

Use a dedicated enterprise acceptance account and preserve the existing e-Mate contracts:

1. Login with the current password; record the account ID, auth revision, local lease digest, login generation, and server receipt without recording the password or token.
2. Submit one password change with a unique client request ID. The response must be `{schema_version:1,status:"changed",reauthentication_required:true}` and all existing account leases must be revoked.
3. Refresh and invoke an authenticated action with the prior lease; it must fail as expired/revoked. Local execution already running under the valid pre-change lease may only finish according to the established identity boundary; it cannot silently obtain a new lease.
4. Logout/return to login. The old password must fail and increment only the server's protected rate-limit/audit path; no plaintext or password-derived value may appear in e-Mate logs or audit payloads.
5. Login with the new password. It must return a later generation, load the current multi-model policy and agreement receipt, and permit a real local conversation.
6. Replay the password-change client request ID with the same payload to prove idempotency; reuse it with a different payload to prove conflict handling.

The production endpoint and acceptance account are external prerequisites. Without both, this section remains `blocked`.

## Registration, approval, administration, and remembered login

Use a fresh source identity and two browser contexts; never reuse production personal data outside the authorized acceptance tenant.

1. Issue a registration challenge and prove its image, challenge ID and expiry came from the enterprise provider. Wrong, expired and replayed codes fail; source/account rate limits activate without leaking whether an account already exists.
2. Submit account, mandatory real name and a 10–256 character password. The receipt must be `pending_approval`; refresh and login must remain blocked, and no password/token may appear in browser storage, logs or audit.
3. In the existing administrator workspace, list and read the pending user. Approval with zero/missing weekly Token allowance or missing model policy must fail. Set both, approve, and prove the auth revision changed.
4. Login once without “保持登录”; verify the signed account status and weekly allowance, then prove ordinary lease expiry requires reauthentication. Login with “保持登录”, close only the browser, reopen through `e-mate launch`, and prove the Host restores the still-valid OS-keystore lease without browser token persistence.
5. Update the real name and weekly allowance and prove the new projection/lease is authoritative. Disable the user and prove every active lease is revoked. Re-enable only with a positive allowance, then soft-delete and prove login, challenge-to-activation shortcuts, usage mutation and record resurrection all fail.
6. Exercise administrator create/read/update/delete compatibility and duplicate/replayed client-request IDs. Every mutation must have an administrator audit record; the management API must expose no local plugin, Tool, session or Job operation.
7. Exhaust and reset the weekly Token window using provider-reported immutable usage facts. The exact accepted/rejected request and the usage panel counter must reconcile; local non-model browsing of existing sessions remains available while new model calls fail with the quota reason.

Evidence includes registration ID, challenge expiry (not code), account/auth revisions, allowance policy version, lease/receipt digests, administrator audit IDs, usage fact IDs and screenshots of both user and administrator terminal states. Production captcha, administrator API, rotated credentials and authorized acceptance identities are external prerequisites; without them this section remains `blocked`.

## Usage and audit-panel reconciliation

Create a fixed acceptance batch containing one chat response per allowed chat model, one non-fallback image, one fallback image when the service can deterministically force it, one failed/cancelled task, and a duplicate outbox replay.

For every terminal provider fact, reconcile the same immutable identity through five stages:

1. Harness durable session/Job event containing provider-reported usage.
2. Local `emate.audit` outbox row and payload SHA-256.
3. Enterprise ingestion receipt/idempotency result.
4. Existing immutable provider-usage ledger and account counter delta.
5. The row and aggregate rendered by `https://mvdcm.ecoremedia.net/ecorex-agent/usage-panel/`.

Compare source service/ID, account and organization, usage kind, input/output/total tokens or image count, provider timestamp, requested/provider-reported/actual model, provider, fallback source/flag, Job/result status, product generation `emate`, product version `2.0.7`, payload hash, and fact ID. Duplicate delivery must create no second ledger row or counter change. A conflict, missing row, unsettled outbox item, aggregate-only match, or panel mismatch fails acceptance; it cannot be waived because the total happens to match.

Before production access, the local automated gate must prove that one real target `agent/request` plus one provider-sourced `assistant/message` creates exactly one hashed outbox fact, replay creates none, a missing binding is `blocked`, provider failure leaves the fact pending, and a later exact receipt marks it delivered once. It must also prove that prompt/answer text and raw session/account identities are absent. This closes only the local projection/outbox contract; it does not pass enterprise ledger or usage-panel reconciliation.

## Computer Use evidence set

The release evidence covers the following end-to-end user journeys:

- model selection changes the actual next provider route while preserving the same conversation context; upstream instability and weak-network interruption recover through the existing retry/reconnect path without duplicate user messages, assistant answers, Tool calls, usage facts, or audit receipts;
- every conversation interaction is compared screen-by-screen and state-by-state with task `019ff665-d721-79a0-869d-338f086cf529`, including its interaction prototype and annotated frames, rather than accepting a Home-only or static screenshot match;
- image generation and editing cover one generation, one edit, concurrent jobs, attachment/context ownership, and a measured step-up run that records the maximum stable concurrency before the first bounded rejection or degraded budget; the caller still cannot choose the image model;
- DOCX/XLSX/PPTX/PDF create-read-edit-export-reopen, OCR/Vision, browser search/interaction/download, Browser Panel, GenUI and the selected Sidebar execute through their real target paths;
- Feishu, Tencent Docs, WeChat and DingTalk must be discoverable by the user and Agent, open the correct connection surface, and reach the provider's real authorization handoff. The 2.0.7 release gate stops before submitting a real OAuth consent, QR confirmation, credential or external write;
- non-deleted legacy sessions remain visible and can continue, project/general-session memory remains isolated, and Skill Hub cross-user publish/search/download/install uses the target plugin path;
- installation, same-version repair, cross-version upgrade, rollback protection, shortcut single-instance behavior and CLI status/stop/check are exercised. A user can request an update in natural language; e-Mate must recognize the intent, execute the existing managed npm update transaction, restart/recover, report success, and preserve sessions, credentials, audit outbox and version/integrity receipts.

Office, OCR/Vision and browser rows close only with the selected bundle's real result; installed metadata is not evidence. Vision/OCR remains `blocked` until the rc.5 enterprise model-policy seam exists and passes a governed request. Windows browser acceptance must prove `@playwright/mcp@0.0.78` uses the existing Microsoft Edge, receives the exact Harness workspace/permission scope, performs no browser download, isolates sessions, cleans up, and drives Browser Panel through target events; until then the expected status is `PLAYWRIGHT_MCP_EDGE_UNVERIFIED`/`setup-required`. macOS Ego Browser requires the equivalent real launch, permission, isolation, cleanup and UI evidence and remains setup-required meanwhile.

The 5,000-event reverse-scroll frame-drop percentage is retained in traces only as a diagnostic. It has no pass/fail threshold and cannot by itself block S04 or S12; the FPS, heap, long-task, event-to-paint and leak budgets above remain binding.

Each run stores the starting database/snapshot identity, exact test data, screenshots, trace/artifact paths, relevant audit/fact/receipt IDs, cleanup result, and one of `passed` or `blocked`.
