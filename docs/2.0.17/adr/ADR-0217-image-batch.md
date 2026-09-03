# ADR-0217: local durable image batch orchestration

- **Status:** Accepted
- **Ticket:** EM217-002
- **Baseline:** e-Mate 2.0.16, DSH `0.1.0-rc.7@4da69d7c3522ee51de12822c917c503a124f7a7d`
- **Contracts:** `../contracts/image-batch.schema.json`, `../contracts/image-batch-result.schema.json`

## Context

`imagegen` already owns exactly one image request, native Job, child-owned `emate/image-output` receipt, Attachment CAS write, structural verification, and edit/fusion adjudication. The existing Gallery reads those receipts from native Session projections. The EM217-001 keyless baseline exercised text-only new-image requests only; reference edit/fusion and real-provider performance remain OPEN.

We need one local multi-image Tool without changing the gateway protocol, image receipt owner, native lifecycle, or byte owner.

## Decision and scope

Add exactly one `image_batch` Tool inside `@e-mate/dsh`. It accepts 2–8 ordered tasks and optional concurrency 1–4 (default 3). Each task mirrors model-facing `imagegen`: required `prompt` plus optional scalar or ordered array of 0–16 exact `image_url` Attachment IDs. Raw arrays may be empty or contain duplicates. It does not accept model, provider, size, aspect ratio, quality, output path, timeout, retry, or scheduling hints.

Every task reuses the existing single-image provider/receipt path and every gateway request asks for exactly one image. EM217-105 may refactor review owner routing, but it does not change one-image request semantics. There is no gateway batch endpoint, `n>1`, second scheduler, queue, store, projection transport, RPC, receipt format, or image-byte path. Pinned rc.7 Subagent/Session/Job owners, `spawn/localAgent`, shared Attachment CAS, Tool registration, audit classification, and existing client slots remain authoritative.

Delivery is sliced so no disconnected public Tool can exist:

- **EM217-101** adds only the tested internal request normalizer, length-prefixed ID helpers, and schema mapping. It is not model-visible, does not register `image_batch`, does not touch agent-operations, audit, Tool Search, or `imagegen`, and produces no event/provider request.
- **EM217-102** adds only a directly tested internal event reducer and parent projection definition. It registers no public producer, appends no Session event, and remains unreachable from model-visible Tools.
- **EM217-103** is the first public activation and is atomic: it completes the pinned-spawn gate, durable event producer, usable new-image execution, child inspection, result projection, and cleanup; only then, in the same ticket, it registers `image_batch` and updates agent-operations, existing Tool Search visibility/aliases, and canonical image-generation audit classification. A partial or disconnected activation fails review.
- **EM217-104** hardens the same owner with live-child bounds, refill, and cancellation; it introduces no ownership, registry, protocol, or UI path.
- **EM217-105** alone enables source edit/fusion after completing parent-owned receipt revision-2/revision-3 review routing. **EM217-106/107** then harden exact correlation and non-replaying recovery.

Every temporary internal module from 101/102 must be imported and behaviorally exercised by its focused test. No unused export, UI-only state, placeholder endpoint, disconnected payload, dormant Tool registration, or source-scan-only test is acceptable.

EM217-103 and EM217-104 enable new-image tasks only. Omitted `image_url` and explicit `image_url: []` both normalize to new-image. A non-empty normalized image list fails closed before child creation/provider submission until EM217-105 supplies the complete source-task route described below. Batch execution never infers an edit source from conversation history. Merely accepting non-empty source syntax does not enable it.

## Identity and sanitized persistence

All derived IDs are lowercase SHA-256 prefixed by `sha256:`. Hash input is an unambiguous sequence of UTF-8 length-prefixed tuples: for each value, append its unsigned 64-bit big-endian byte length followed by its bytes. Domain tags prevent cross-kind collisions.

- batch ID: tuples `("emate-image-batch-v1", parentSessionId, parentCallId, 0)`;
- task ID: tuples `("emate-image-task-v1", parentSessionId, parentCallId, ordinal)`, where ordinal is 1–8;
- event ID: tuples `("emate-image-batch-event-v1", parentSessionId, parentCallId, eventOrdinal)`, where eventOrdinal starts at 1 and strictly increases.

The random gate nonce is never an ID and never enters prompts, Tool results, receipts, or parent events.

Parent Session event type `emate/image-batch` is an ignorable schema-1 event with four kinds: `created`, `task-linked`, `task-state`, and `terminal`. `created` contains effective concurrency and the complete ordered queued snapshots, so recovery/UI never infer concurrency from compacted Tool input. Every later event contains the complete post-change snapshot for the affected task; `terminal` contains the complete ordered final snapshot list. Parent receipt references are pointers only: owner Session ID, call ID, revision, event sequence, and status. The unchanged child `emate/image-output` projection is the sole attachment receipt truth. Snapshots persist only prompt SHA-256, ordered Attachment IDs, lifecycle IDs, bounded error codes, and receipt pointers—never attachment metadata, prompt text, image bytes, nonce, authorization material, model credentials, provider secrets, or raw provider responses.

Event validation is fail closed:

1. IDs must exactly match their recomputation and batch/session/call/ordinal linkage.
2. Ordinals and task IDs are unique and remain in created order.
3. Task revisions start at 1 and strictly increase for a change. The same event ID plus byte-identical canonical event is an idempotent duplicate; the same ID with different bytes is corruption and is rejected. A different event that repeats a revision is rejected.
4. `task-linked` is the sole metadata-only `queued → queued` update: it adds the exact child link at a higher revision while the provider gate remains closed. State-changing edges are `queued → running|failed|cancelled|interrupted`, `running → needs-review|completed|failed|cancelled|unknown`, and `needs-review → completed|failed|cancelled|unknown`. Terminal task states never transition.
5. At most one batch `terminal` event is accepted. It is legal only when every task is terminal and its summary matches the deterministic rule below.

`needs-review` is nonterminal and image-bearing. It may exist only while a real live adjudication route is available. It is never a permanent recovery/result state.

## Pinned one-shot authorization

Before a child starts, the batch effect creates a gate object with a cryptographically random nonce, records it in a nonce lookup map, and retains it in a separate effect-owned active gate set. The nonce appears only in the native one-shot subagent descriptor label, which is model-hidden. Atomic claim removes the nonce from the lookup map immediately, so no second call can find or reuse it; claim does not remove the gate object from the active set or transfer disposal ownership. Parent/child operation references and the effect-owned active set retain the claimed gate through result, cancellation, timeout, or error settlement. Only final cleanup removes it from the active set.

Before digesting or comparing a task, both parent and child normalize `image_url` identically: omitted becomes `[]`, a scalar becomes a one-element list, and an array is deduplicated by first occurrence with order preserved. Operation is recomputed from that normalized list; explicit `[]` is new-image, and the batch path disables implicit history inference.

The child-side `imagegen` guard obtains the native descriptor—not prompt/message text—and validates descriptor one-shot mode, expected provider route, nonce, and its own Session header’s exact native parent linkage. It cannot validate `SubagentRun.localAgent`, which is returned only to the parent after start. The parent requires `run.localAgent !== undefined`, requires `run.id === run.localAgent.id` and an exact match with the claimed child Session ID, and performs these checks before appending the link, flushing it, or opening the gate. The child atomically claims the gate from the nonce lookup map before comparing normalized `prompt` and ordered `image_url` arguments, then waits on its bounded gate-open promise while the claimed gate remains in the effect-owned active set. Prompt markers, forged labels in model text, task IDs, and deterministic hashes are not authorization.

Wrong, zero, or multiple `imagegen` calls; nonce reuse; forged marker; wrong normalized args; sibling/continuable/remote child; parent mismatch; missing `run.localAgent`; mismatched `run.id`/claimed child; HMR; cancellation; timeout; and disposed effects all fail before another provider call. If one authorized image already completed, a blocked second call or later contract failure preserves that proven image while marking the task failed. A claimed or closed gate cannot be found again, reopened, or retried. Final cleanup aborts or settles the native Job/child as appropriate, closes waiters, awaits quiescent disposal, and only then removes the gate from the active set and releases its worker slot.

## Durability and worker order

One fixed worker pool bounds live children; configured concurrency defaults to 3 and can never exceed 4. A child waiting for review or disposal remains live and occupies its slot. A slot refills only after this complete sequence:

1. Normalize all tasks and validate rollout/source policy.
2. Append `created`; require `ctx.sessions.flush(parent.session) === true`.
3. For a selected queued task, create its effect-scoped gate and register/start the native one-shot child. On the parent, require `run.localAgent !== undefined`, `run.id === run.localAgent.id`, and an exact claimed-child Session match; only then append its exact `task-linked` snapshot and require parent flush true.
4. Only then open the gate. The child may now perform exactly one provider submission.
5. After the child settles, require the child Session flush to return true before inspecting exactly one terminal `emate/image-output` receipt and its native Job. Reject zero/multiple/conflicting receipts or Jobs.
6. Append the full post-change parent `task-state` snapshot and require parent flush true.
7. Await quiescent child/effect disposal; only then refill the slot.
8. After all tasks are terminal, append exactly one `terminal` and require parent flush true before returning the durable projection result.

Any append rejection, thrown flush, or flush result other than literal true keeps an unopened provider gate closed or aborts an opened operation, stops new admission and worker refill, settles and quiescently disposes active work, and surfaces the persistence failure to the Tool caller; cleanup must complete and must never hang permanently. A child flush failure can never produce a parent terminal fact. The Tool result is rebuilt from the flushed durable parent projection, not an in-memory task array.

## Source-task route (EM217-105 gate)

EM217-105 must implement the route completely before enabling any `image_url` task:

1. The parent resolves and validates every ordered Attachment ID through shared CAS, including media type, bounded metadata, existence, and current Session authorization.
2. The native child message may carry exactly those Attachment references; it must not copy bytes or infer references from history.
3. The claimed batch gate validates the same normalized prompt and ordered first-occurrence-unique image ID list; it never performs implicit edit-source inference.
4. `imagegen` keeps the `emate/image-output` receipt owned by the child but routes `userQuestions` to the parent Agent.
5. On a review candidate, append receipt revision 2 to the child and require child Session flush true **before** asking the parent. After the answer, append revision 3 and require child flush true before parent task-state projection.
6. The live child and Job continue occupying their concurrency slot throughout adjudication. Rejection, cancellation, timeout, unavailable route, or persistence failure terminates explicitly; no permanent `needs-review` remains.

If parent `userQuestions` is unavailable, reject the source task before provider submission. Child-local questions are not an acceptable fallback.

## Terminal summaries and result

Terminal task states are `completed`, `failed`, `cancelled`, `unknown`, and recovery-only `interrupted`. The batch status is deterministic:

- `completed`: every task ended cleanly `completed`, `images.length === tasks.length`, and `failures.length === 0`;
- `partial`: `images.length > 0 && failures.length > 0`;
- `cancelled`: `images.length === 0` and every task is `cancelled` or `interrupted`;
- `failed`: every other terminal combination.

Results preserve ordinal order. An image-bearing task that later fails—for example, its one authorized provider call succeeded and a second attempted call was blocked, or a post-image contract check failed—retains the first proven image exactly once in `images` and appears exactly once in `failures`. Therefore `images` is not restricted to tasks whose parent state is `completed`; it is the set of proven existing child image receipts. Each image contains one canonical existing camelCase `ImageAttachmentRef` (`attachmentId`, `mediaType`, `bytes`, `width`, `height`, optional `name`) plus a pointer-only receipt reference. Receipt pointers never embed a second attachment. Result and event contracts forbid raw prompts and bytes.

## Crash recovery

Recovery never automatically resumes or retries a one-shot task:

- durable `created` with no exact child link becomes `interrupted` / `not-submitted`;
- linked but nonterminal becomes `unknown`;
- an already-terminal linked child may be reacquired through native Session/Job state, its existing receipt proven and projected, and the parent finalized without a provider POST;
- `unknown` stays unknown until a proven existing receipt is read or the user makes an explicit new Tool call.

A crash between provider completion and parent projection therefore permits receipt reacquisition only, never replay. Recovery emits monotonic new task revisions and the one legal terminal event; it does not mutate child receipts. Legacy Gallery association remains read-only for old Sessions. New batches join only parent exact task link → existing child projection; label, title, timestamp, adjacency, and foreground-window heuristics are forbidden.

## Cancellation, lifecycle, and adversarial requirements

Cancellation stops admission of queued tasks, closes unopened gates, aborts live native children/Jobs, waits for their settled receipt/Job and quiescent disposal, and records `cancelled` only when non-submission or native cancellation is proven; ambiguous submitted outcomes are `unknown`. Timeout follows the same rule. HMR/effect disposal aborts every gate in the active set, including already-claimed waiters and in-flight operations; it cannot retain a lookup entry, lose disposal ownership, or reopen a claimed nonce. Final cleanup removes each settled gate from the active set.

Tests must cover created/link/child/parent flush false and rejection; append rejection; cancellation before link, before open, during provider, during review, and during dispose; timeout; HMR; forged prompt/label marker; wrong parent/provider/mode/nonce/args; nonce replay; zero, duplicate, and multiple calls/receipts/Jobs; sibling and remote child; same prompts; reordered references; duplicate/conflicting/out-of-order events; revision rollback; cross-batch task injection; two terminal events; attachment missing/oversize/type mismatch; child terminal before parent link; provider completion before child flush; crash at every durability boundary; unknown preservation; receipt reacquisition without POST; and 2/4/5/8-task worker bounds/refill. Every failure path asserts no unauthorized second provider call and no premature slot refill.

## UI and compatibility

The UI consumes the parent batch projection and exact child Session links, then reads the unchanged existing child receipt projection. It never mutates child receipts or scans the DOM. New batches never use label/time/title fallback. Existing pre-batch Sessions keep the current legacy Gallery path read-only.

## Consequences

This design deliberately pays one native child Session/Job per image and serial durability checkpoints around admission. That is the minimum complete change which preserves exactly-once boundaries, existing receipts, CAS ownership, and native UI projection. Throughput comes only from the bounded local worker pool; no new protocol or persistence owner is introduced.
