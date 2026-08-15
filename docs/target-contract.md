# e-Mate 2.0.7 target contract

This file is the implementation source of truth. Development records may add evidence but may not weaken these obligations.

## Identity and source pins

- Product name: `e-Mate`
- Repository: `zyfjacksonchen-source/e-Mate`
- Release: `@e-mate/dsh@2.0.7`
- Executable: `e-mate`
- Harness source: `deepseek-ai/deepseek-harness@47f943859bef60e4160492346772ded9b24f765a`
- Harness source version: `0.1.0-rc.5`
- Browser shell and component source: task `019ff91c-47ca-7c11-93bd-863475181a18`, represented by the final e-Mate 2.0.4/2.0.5 UI state at exact 2.0.5 commit `564a6b6c1d43fb6831dd4a5cd8026e472f063311`
- Chat interaction source: Codex prototype `019ff665-d721-79a0-869d-338f086cf529`
- “Harness” identifies the pinned technical foundation only and must not be used as the product or UI name.

## Product boundaries

- Local Harness owns execution, sessions, tools, jobs, plugins, memory, schedules, and artifacts.
- The enterprise sidecar owns only login/authentication, model-policy delivery, and asynchronous redacted audit ingestion.
- The product ships as npm plus a loopback web server, with an overwrite-safe desktop shortcut. It ships no desktop application.
- The browser frontend is responsive from 320px and contains no Win/macOS window-chrome compensation.
- The central chat UI derives activity from real durable/live events and plugin render metadata; it contains no tool-name dispatch table.
- WebUI-to-CLI communication must reuse the pinned Harness `ApiProxy` carrier and Web client architecture: typed HTTP `POST /api/<method>` and `/api/respond` uplinks, the two existing downlink-only WebSockets at `/api/events.mux` and `/api/events.host`, `dsh.client` modules, Cordis services, and registered UI slots. e-Mate may skin or compose those services but must not introduce a parallel protocol, event store, session state machine, or tool dispatcher.
- Main application source uses the pinned target's TypeScript/TSX and `tsdown` toolchain. Published JavaScript is a build artifact, not a second source implementation.
- Every non-chat page, component, token, brand asset, capability/settings surface, and responsive state must be a high-fidelity browser adaptation of task `019ff91c…`. The conversation surface alone follows the high-fidelity upgraded prototype `019ff665…`; an upstream Harness onboarding, empty state, or visual default is not an acceptable substitute.
- Historical e-Mate `v0.x`/`v1.x` screenshots, screenshots from pre-2.0.4 code, and superseded UI variants are forbidden visual references. The current `desktop/src/v1` component tree, current Token/assets, and final 2.0.4/2.0.5 acceptance state are the only non-chat visual baseline; an older screenshot cannot override them.
- First use requires authenticated acceptance of the e-Mate user agreement and the 亦芯 enterprise disclaimer. Only an enterprise-server receipt for all required document hashes unlocks the workspace; a local/browser flag is insufficient. Agreement archiving remains part of `emate.identity` and cannot expand enterprise control over the local runtime.
- The e-Mate 2.0.5 Skill Hub remains part of the capability center: authenticated users can publish a validated Skill ZIP, other users can discover immutable versions, verify/download the package, and install it into the local Harness Skill provider. This product catalog cannot remotely enable, disable, inject, approve, or execute a local plugin.
- Online update and Skill Hub search/download/install/publish are also Agent-callable product operations. A user message expresses intent; the pinned Harness Agent Loop uses its existing Bash/PowerShell Tool for the e-Mate update CLI and typed Skill Hub Tools for authenticated Host-side catalog work. Long Skill mutations use `ctx.jobs`; the browser projects only the resulting real Tool/Job/session events. e-Mate must not add a browser keyword matcher, a second intent engine, a direct frontend npm runner, duplicate shell Tools, or a parallel update protocol.
- The Agent invokes the typed e-Mate CLI rather than composing npm commands itself. `e-mate update` delegates to the same setup/upgrade transaction used by manual npm installation. It may stage while the service is running, but activation waits for every non-update local Job to become idle and is completed by a detached updater process with a receipt and rollback evidence.
- Project memory is scoped by the pinned Harness `WorkspaceRegistry` identity and its canonical workspace path. Memory, dream distillation, learning output, and imported CowAgent material for workspace A must never be read from or written to workspace B; an ungrouped session receives session-local scope rather than a shared fallback. A missing, moved, or mismatched workspace binding fails closed.
- Every visible interactive UI element must complete a real Harness or enterprise-boundary action and expose its pending, success, failure, cancellation, and reloaded state. Empty handlers, placeholder links, fake success, permanently inert buttons, and visual controls with no reachable terminal result are release blockers.
- Identity begins with self-registration, not administrator-created credentials. Registration requires a unique account, mandatory real name, a 10–256 character password, and a one-time expiring enterprise image-verification challenge. The enterprise server rate-limits challenge issuance and submission; successful submission creates only a `pending_approval` record and never a login lease.
- An administrator may list, inspect, approve, edit, disable, and soft-delete identity records through the existing management workspace. Approval is invalid until a positive per-user weekly Token limit and a valid model policy are configured. Disabled/deleted users and users without that allowance cannot log in; changing status, allowance, password, or deletion state increments the auth revision and revokes active leases. These operations remain inside `emate.identity`/`emate.modelPolicy` and grant no local-runtime control.
- Login carries an explicit `remember_login` boolean. It changes only the server-issued lease lifetime; the browser never persists a password, bearer, refresh token, or model credential. With it disabled, closing the authenticated browser context or ordinary lease expiry requires login again; with it enabled, the Host may restore an unexpired OS-keystore-backed lease after browser restart.
- Password login, logout, and password change retain the existing e-Mate request/receipt contracts. A successful change revokes prior account leases, returns `reauthentication_required`, rejects the former password, and permits a new login only with the new password; plaintext passwords never enter browser persistence, logs, audit, or receipts.
- Usage acceptance reconciles provider-reported immutable usage facts, the local durable audit outbox, the enterprise receipt, account counters, and the existing usage panel. Duplicate delivery is an idempotent no-op; a missing or conflicting fact is surfaced as a data-quality failure and cannot be hidden by an aggregate total.

## Model policy

| Public id | Provider model | Reasoning |
| --- | --- | --- |
| `ecorex-chat` | `gpt-5.6-luna` | `max` |
| `ecorex-gpt-5.6-sol` | `gpt-5.6-sol` | `medium` |
| `ecorex-deepseek-v4-pro` | `deepseek-v4-flash` | `max` |
| `ecorex-doubao-seed-2.0-pro` | `doubao-seed-2-0-pro-260215` | `medium` |

Gemini is not part of the 2.0.7 production catalog while its upstream route is unavailable. It must not be emitted by identity policy, shown in the client catalog, or enabled by default; restoring it requires a separately verified upstream route and release slice.

Image generation adapts the final e-Mate 2.0.5 Codex-like `imagegen` Tool: each call accepts only required `prompt` and optional current-session `image_url` attachment IDs, produces one independent output, and uses separate target Tool calls for concurrency. Generation and image editing are both fixed to `gpt-image-2-pro`; neither the user nor the Agent can select or pass an image model or provider. Only the enterprise image service may apply the verified 2.0.5-compatible `gpt-image-2-pro → gpt-image-2` fallback for eligible upstream-unavailable errors. The tenant policy may allow several chat models, while one session selects one active model.

## Shipped plugin roster

The product-owned built-in list contains image generation/editing, Office, OCR, Browser, Feishu, Tencent Docs, WeChat, and DingTalk. The capability center also keeps the community Skill Hub and installed custom Skills as a visibly separate catalog. Schedule, memory, dream distillation, and autonomous learning are local system plugins rather than extra built-in cards.

At the pinned Harness commit, only `web_search` is active from the relevant built-in set. `web_fetch` is shipped but disabled without a composed provider, and Office/PDF, OCR, and real Chromium Computer Use Tools are absent. e-Mate keeps thin adapters for those gaps and must still route them through target Tool, Job, attachment, subprocess, event, and client contracts; this finding does not authorize a parallel runtime.

## Compatibility and delivery

- Import only authoritative, non-deleted old e-Mate/ECoreX sessions; preserve sources unchanged and make import idempotent.
- User data stays under the resolved `$DSH_HOME`; npm installation directories are read-only code/resources.
- Supported release platforms are macOS 13+ arm64/x64 and Windows 10/11 x64.
- Keep the existing download, admin, and audit URLs unchanged. The download URL remains the stable entry/integrity page, while every final 2.0.7 tarball and release-evidence download resolves to its immutable Cloudflare R2 object admitted under `npm/v2.0.7/`; the application server must not become the binary origin.
- Release activation requires clean npm installation, automated checks, performance evidence, and Computer Use acceptance.
