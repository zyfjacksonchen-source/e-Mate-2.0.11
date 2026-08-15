# e-Mate 2.0.7 legacy-data migration

This document defines the one-way, copy-on-write import from existing e-Mate, ECoreX, and CowAgent data into the pinned Harness runtime. The target database and event model are not reimplemented: imported conversations are written through Harness `SessionPersistence` into the same `$DSH_HOME/sessions` store used by new conversations.

## Authoritative source order

The default scan order is:

1. current e-Mate 2.0.5 Runtime at `~/.emate/state/runtime.sqlite3`;
2. native ECoreX Runtime at the platform application-data root;
3. CowAgent conversation databases under `~/.cow`, Windows CowAgent application-data roots, and `~/cow`.

Runtime tables are authoritative over CowAgent rows that carry the same stable legacy identity. The Runtime reader imports only `threads.status != deleted`. UI caches, browser state, thumbnails, and deleted records are never recovery sources. Conflicting rows at the same authority level stop the whole plan before a target write.

## Read-only boundary

The source database and optional WAL must be ordinary files beneath an allowed source root. Symbolic links and root escapes are rejected. Migration opens neither source file with SQLite. It reads both through no-follow file descriptors, records identity/size/SHA-256, copies them to a private mode-0600 temporary directory, verifies the copied hashes and verifies that the complete DB/WAL set did not appear, disappear, or change during the copy. SQLite `integrity_check` and every schema/query operation run only against that disposable snapshot.

The original database, WAL, attachments, memory, dream, and learning files are never updated, checkpointed, renamed, or deleted.

## Harness event mapping

Each source session receives a deterministic target Session ID derived from its authoritative legacy identity, not from the mutable source fingerprint. A rerun therefore addresses the same Harness session.

- `SessionHeader.version` stays at the pinned target format `0`.
- The original creation time is retained.
- A valid absolute project path becomes the immutable Harness header `cwd`; relative or ambiguous paths are not promoted to project authority.
- User text becomes identified `user/message` events with `surfaceOp: append`.
- Historical assistant text is enclosed by real `step/start` and `step/end` events and uses model provenance `legacy-ecorex` or `legacy-cowagent`.
- Every turn is balanced. A Runtime turn is `completed` only when its source status is completed; all other historical states become `interrupted` and are never resumed automatically.
- The original title becomes a bounded explicit `session/title` event.
- An empty untitled source session receives one ignorable `emate/legacy-import` evidence event so the target JSONL backend can materialize its header without fabricating a message.

Legacy tool/activity rows are not emitted as Harness `tool/call` or `tool/result`, because that would falsely claim a new target execution. They are stored as mode-0600 read-only evidence below `$DSH_HOME/e-mate/migrations/legacy-evidence-v1/` for a later history renderer.

CowAgent `extras.attachments`/`extras.artifacts` and current Runtime artifact projections are handled separately from the target's image-only Attachment service. A referenced file must be a stable ordinary file below the authoritative source root, cross no symbolic link or protected credential/cache path, remain at most 512 MiB, and retain its measured SHA-256 through publication. Accepted bytes are copied into `$DSH_HOME/e-mate/attachments/legacy-v1/objects/<sha-prefix>/<sha256>`. The Session receives one ignorable `emate/legacy-artifacts` evidence event containing only content identity, safe name, media type, size, source message identity, and availability. Missing, remote, internal, unready, oversized, protected, or unsafe references remain explicit `unavailable` entries; no outside path is copied and no fake Harness image reference is created.

The e-Mate client plugin owns the browser projection for this event family through Harness `conversationEvents` and the keyed `conversation.chat.node` slot. It does not add a tool/event switch to the central chat implementation. Available entries download through `GET/HEAD /api/e-mate/legacy-artifact.download?id=<sha256>`; the Host reopens the content-addressed object without following links, recomputes its complete SHA-256 before serving, and sends `no-store`/`nosniff` headers. An unavailable entry remains visible and has no inert download action.

## CowAgent memory, dream, and learning files

The memory plugin considers the final e-Mate workspace `~/ECoreX` first and the older `~/cow` workspace only when the first contains no memory authority. It imports `MEMORY.md` and `memory/**/*.md`; `memory/dreams/**` becomes `dream`, `memory/evolution/**` becomes `learning`, and the remaining Markdown becomes `memory`. Index databases, dot-directories, non-Markdown files, links, invalid UTF-8, files over 8 MiB, and sources over 128 MiB are not accepted.

Binding is exact and fail closed. A source is imported only when its canonical root is already the path of one Harness `WorkspaceRegistry` entry. The copied records use that workspace's stable ID plus canonical-path SHA-256, so every current or later Header-validated session in the same project can recall them while another project cannot. The plugin never creates a workspace or assigns legacy global data to a nearby project. If no exact binding exists, migration remains pending and writes no record.

Import is copy-on-write into the existing `emate_memory` Storage Domain. Source files remain byte-identical. Long files are split into bounded records; deterministic UUIDs and source digests make a retry reuse the same records. Every existing deterministic identity is checked before a new record is written. The mode-0600 receipt `$DSH_HOME/e-mate/migrations/legacy-memory-v1.json` contains source/path hashes, target workspace identity, record identities, and the hashes of blocked user-scoped files, never plaintext paths or memory text. Once the receipt exists, a changed legacy source is refused instead of silently overwriting target memory.

Old `memory/users/<legacy-user>/**` content is deliberately not promoted to workspace-shared memory. It remains listed by hash as blocked until the enterprise identity provider supplies an authoritative old-user-to-new-account mapping.

## Legacy scheduled tasks

The old `scheduler/tasks.json` stores are read through stable no-follow file descriptors from the known e-Mate, ECoreX, and CowAgent roots. A store is bounded to 16 MiB and 10,000 tasks, must be valid UTF-8/JSON, and must retain matching task-map and task-body identities. The source is never recovered from a backup, rewritten, enabled, or opened by the old scheduler.

Import creates only mode-0600 staging receipt `$DSH_HOME/e-mate/migrations/legacy-schedule-v1.json`. Every row remains `disabled`; importing does not append `schedule/change`, start a timer, inherit an old delivery recipient, or create another scheduler. Fixed intervals of at least five minutes map to target `every_seconds`; one-shot times map only when the source contains an explicit UTC/offset instant. Cron, faster intervals, missing time zones, invalid rules, and unsupported action types remain visible with a blocker instead of being approximated.

The managed profile composes the official `@deepseek-ai/dsh-schedule` plugin. `e_mate_schedule_import_list` reads the staging receipt. A mappable task can be activated only after a later authoritative user message exactly equals `确认启用 <legacy-task-id>`. `e_mate_schedule_import_enable` then performs nested calls through the target `schedule_list` and `schedule_create` Tools with the same Agent, cancellation signal, root call, policy pipeline, Session event stream, persistence barriers, and runtime owner. A unique prompt marker reconciles a target create that committed before its local activation receipt. The adapter owns no live timer, recurrence math, dispatch state, or WebUI protocol.

## Idempotency and failure behavior

Planning, source validation, duplicate analysis, and validation of every pre-existing target identity complete before the first new Session is created. An existing deterministic ID is reused only when its complete Harness header and event digest match. A mismatch fails closed.

New Sessions are then created and appended through the target persistence service. A process failure can leave only exact completed Session batches; no completion receipt is written. The next run verifies and reuses those batches before continuing. The final mode-0600 receipt is `$DSH_HOME/e-mate/migrations/legacy-sessions-v1.json` and contains only hashed source/session identities plus header/event digests.

`e-mate setup` performs the import after the service is idle and the managed profile is installed, using the pinned target `Context`, `SessionStore`, and `JsonlSessionPersistence`. The managed `emate-legacy-migration` profile plugin runs the same function as a fail-closed fallback; it does not own another database or protocol.

## Current release gates

Conversation text, titles, non-deleted filtering, project `cwd`, deterministic identity, source immutability, tool-history evidence, safe CowAgent/Runtime artifact CAS copy, browser artifact projection/download, unavailable-file evidence, corrupted-source refusal, replay idempotency, workspace-bound CowAgent memory/dream/learning copy-on-write import, and disabled-by-default legacy schedule staging/confirmed target activation are implemented and covered against the real Harness backends.

The following remain release blockers and must not be inferred as complete from the conversation tests:

- old Runtime releases whose artifact store used a non-default custom root;
- authoritative mapping for legacy `memory/users/<id>` files to current enterprise accounts;
- live fixtures from supported macOS/Windows releases, including moved/missing project paths and WAL concurrency;
- continuation acceptance from an imported conversation in the real browser UI.
