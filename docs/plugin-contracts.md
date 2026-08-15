# Plugin contracts

## Harness-native composition

Every e-Mate capability is a Cordis/Harness plugin. Host behavior is a Loader entry; browser behavior is the package's `dsh.client` export built by the pinned Harness client preset. Plugins collaborate through Cordis services, Harness registries, Jobs, session events, and UI slots.

Host and browser source is TypeScript/TSX. The release packages contain its generated ESM JavaScript. A JavaScript-only parallel implementation is prohibited.

The following are prohibited inside e-Mate browser plugins:

- opening their own WebSocket or SSE connection;
- adding a second RPC envelope or session/events REST facade;
- duplicating the Harness Session or Conversation stores;
- manufacturing activity, tool, approval, retry, completion, or failure events;
- importing another plugin's presentation implementation instead of consuming its service or slot;
- dispatching central chat rendering with tool-name or capability-ID `if/switch` branches.

## Browser module identity

The Harness module graph is keyed by Loader entry package name. A browser bundle must call `window.__ModuleLoader__.load` with that exact ID, declare its module dependencies in `dsh.client.inject`, and use only the Harness platform external table. CSS Modules are emitted by the official preset and tagged to the plugin lifecycle.

The e-Mate shell is a profile-local implementation of the existing sidebar plugin seam. It retains the target module ID so Workspace, Settings, and extension plugins keep their declared dependency graph. It owns only brand/layout rendering and the same child slots; the rest of the browser/runtime object model remains upstream.

## Tool and renderer metadata

A capability plugin registers metadata for display name, icon, summary, argument/result schema, renderer, artifacts, required credentials, and availability. The central chat asks the slot/renderer registry by the event's runtime key. An unregistered key uses the generic safe renderer and remains visible.

Renderer input is already validated Harness event/result data. Renderers may own private expansion state but cannot rewrite durable events or infer terminal states. Approvals, blocking, failures, cancellation, and prior retry attempts remain visible.

## Worker boundary

Office and OCR plugins obtain the exact target `defineTool` constructor from the setup-managed, hash-verified Harness binding and register directly with `ctx.tools`. They resolve and observe input through target `ctx.fs`, then call the packaged Worker through target `ctx.subprocess` with explicit argv, bounded standard streams, abort propagation, process-tree termination and an environment allowlist. Requests and responses are typed, bounded and correlated. A binding, manifest, integrity or Worker failure becomes the real Tool failure and does not trigger a system-runtime fallback.

Generated Office files are validated before being committed to the immutable content-addressed store under `$DSH_HOME/e-mate/attachments/office`. A receipt supplies the artifact ID, safe file name, MIME type, size and SHA-256; later read/edit operations accept that ID, and edit creates a new artifact. Harness rc.5's attachment service is image-only, so binary Office download uses the target Session Export pattern: a loopback-only `GET/HEAD` route revalidates the stored bytes and answers with `no-store`, `nosniff` and `Content-Disposition: attachment`. This does not add a frontend transport, event protocol, Tool registry or artifact state machine; target Tool/session events remain the only chat projection.

The Browser capability is split deliberately. Search uses Harness's existing `ctx.web` provider and `web_search` Tool; ordinary HTTP fetch may use the target `web_fetch` Tool only after its native provider is explicitly composed and accepted, because the shipped base currently disables it. e-Mate does not register search/fetch replacements. Real page interaction is the only browser gap: the Cordis adapter launches the manifest-verified packaged Chromium through `ctx.subprocess`, connects with the exact Harness-locked `playwright-core`, registers one target `defineTool`, persists screenshots through `ctx.attachments`, and uses target Tool/session events as the only chat projection. Harness's Web UI Playwright tests are not themselves a product Computer Use implementation.

Computer Use state is scoped by the live Harness session ID; no global anonymous browser profile exists. The Tool supports bounded navigation, snapshot, element interaction, scrolling, screenshot, wait, history, text, key and download operations, but does not expose arbitrary page-script evaluation. Navigation and all browser requests reject link-local/cloud-metadata targets. Password fields are rejected at execution so credentials cannot be written into durable Tool arguments; CAPTCHA, MFA, authorization, payment and destructive confirmation remain user actions. Browser downloads use an immutable capped receipt/CAS and the same loopback binary-download pattern as Office, not a second frontend protocol.

The pinned target-capability audit is binding for these adapters: shipped default composition provides `web_search`; it does not provide an active `web_fetch` provider, Office/PDF operations, OCR, or a product Chromium Computer Use Tool. e-Mate therefore keeps only the missing adapter surface. If a later independently accepted Harness pin supplies one of these capabilities, that adapter must be re-evaluated as a separate slice rather than silently duplicating the new target implementation.

Image generation/editing adapts the final e-Mate 2.0.5 Codex-like `imagegen` contract pinned at `564a6b6c1d43fb6831dd4a5cd8026e472f063311` to the target runtime. It calls the existing e-Mate Model Gateway through `emateIdentity` instead of importing the legacy Python provider runner or creating a second image credential. The local Tool is registered through target `ctx.tools`, executes under one owner-scoped target `ctx.jobs` record, and stores the verified result through target `ctx.attachments`. Its public arguments are exactly required `prompt` plus optional `image_url`; in 2.0.7 `image_url` is narrowed to one or more image attachment IDs already present in the authoritative current session. Generation posts JSON to `/v1/images/generations`; editing re-reads the referenced bytes and posts multipart data to `/v1/images/edits`. Both operations submit only `gpt-image-2-pro`. Users and the Agent cannot pass or select an image model, provider, output path, size, quality, timeout, or concurrency policy. Provider credentials and any eligible `gpt-image-2-pro → gpt-image-2` fallback remain server-side.

Each call produces exactly one independent output and one remote Job. Multiple outputs use separate concurrent `imagegen` Tool calls through the target scheduler; the plugin does not expose a second `tasks` batch protocol. Each result must commit a terminal Job descriptor before download. The adapter checks status/model, byte limit, MIME, `Content-Length`, ETag, declared SHA-256 and actual SHA-256 before `ctx.attachments.saveImage`; only then does the Tool render a real Harness ImageBlock. The browser does not classify image intent or manufacture progress. An absent verified Image API root disables this adapter; it never guesses an endpoint, reads production material directly, falls back to a local provider key, or changes the selected chat model.

## External connections

Four external connections share one TypeScript Cordis plugin and one provider metadata table. Host code uses target `ctx.credentials`, `ctx.storageDomain`, `ctx.tools`, `ctx.jobs`, `ctx.connection` and `ctx.emateCapabilities`; browser code uses target Connection RPC and `settings.section`. It may not import the legacy Python Runtime, SQLite connector Store, Dispatcher, global binding, mcporter, or enterprise Managed Connector Gateway. Long user-started authorization work is an owner-scoped Harness Job; persistent inbound subscriptions are Cordis effects with deterministic teardown, not Jobs or a second Runtime.

The loopback connection RPC owns only `catalog/status`, one-time secret submission, authorization start/poll/cancel/refresh, test, enable/disable/retry and disconnect. Secret input is written directly through `ctx.credentials.set`; no response, browser state, log, Tool argument or capability metadata contains its value. Disconnect first stops the adapter effect and commits non-secret state, then unsets the credential. The Agent sees one lifecycle Tool which never accepts secrets; each ready provider registers its business Tools from provider metadata, so central chat never branches on provider or Tool name.

Provider boundaries are fixed:

- Feishu first closes the local App Bot message send/receive path. Documents and Drive remain blocked until a local OAuth client, required scopes, refresh and official API contract are licensed and verified; the old managed gateway is not a fallback.
- Tencent Docs uses the official `https://docs.qq.com/openapi/mcp` endpoint and target `@deepseek-ai/dsh-mcp-client` discovery/call semantics. It must not place a Bearer token in Cordis configuration or config dumps. A credential-reference header/OAuth composition is required before the adapter or card may become ready; the unlicensed legacy Skill ZIP is prohibited.
- WeChat keeps the device authorization states `pending/scanned/confirmed/expired`, cancellation, refresh and message send/receive contract. Shipping is blocked until the iLink API's public authorization and terms are accepted and a real account completes reversible acceptance.
- DingTalk first closes App Credential validation, official gateway/WSS handshake and message send/receive. The legacy Python dependency is not shipped; a locked, license-attested TypeScript protocol dependency is required.

An adapter with no implementation or no safe authorization path does not publish a ready Tool or empty action. Its capability card may appear only when it can truthfully expose a real setup flow or an explicit blocked reason. Each provider exits S11 only after first authorization, cancel, restart recovery, upgrade preservation, test, read, reversible write/send, disable and disconnect have real-account evidence.

## Credential boundary

Connection plugins consume the target `CredentialProvider` service and store secret material in Keychain or CurrentUser DPAPI, persisting only credential IDs. Environment-variable credentials remain read-only and take precedence; writable values enter only the OS store. Browser state receives connection status and redacted metadata, never credential values. First-use authorization is local and explicit; upgrade preserves the credential reference. The target file-backed local provider is insufficient for release because a same-UID model process can read it; e-Mate therefore must supply a platform provider with the same target interface, not a parallel vault.

## User-visible and system plugins

The capability center derives the product-owned built-in list from registered metadata and exposes image generation/editing, Office, OCR, Browser, Feishu, Tencent Docs, WeChat, and DingTalk. A separate community tab retains the e-Mate Skill Hub and locally installed custom Skills. Schedule, memory, dream distillation, and autonomous learning are preinstalled system plugins and do not add built-in cards.

The Host registry is a Cordis service published as `ctx.emateCapabilities`; each local adapter owns its title, summary, same-origin icon asset, order, current readiness and currently valid actions. The browser reads the projection through Harness Connection `/emate.capabilities` and renders it generically. Capability IDs, plugin module names and tool names are not dispatched in the browser. An action is accepted only when the adapter's fresh status still advertises its action ID; after execution the browser re-reads the complete registry. A plugin with an invalid or throwing status is shown as failed with no actions, not silently treated as ready.

## Community Skill Hub adapter

The retained e-Mate Skill Hub package is a versioned Skill archive, not an npm/Cordis bundle. Its local install adapter reuses both existing sides:

1. retain the e-Mate 2.0.5 Hub catalog, immutable version, upload, package SHA-256, provenance, duplicate-version rejection, size, path, link and archive-bomb checks;
2. fetch through a Host-side `emate.skillHub` adapter after identity authorization, never directly from browser code;
3. verify the response digest and package manifest before extraction;
4. atomically install the accepted directory bundle under `$DSH_HOME/skills/<slug>/`;
5. let pinned `@deepseek-ai/dsh-skill-filesystem` discover it and `@deepseek-ai/dsh-tool-skill` expose it to the Agent.

No ordinary user runs `pnpm` or `dsh plugin`, and e-Mate does not fork the Harness Skill registry. Removing or disabling a community Skill operates on its local Skill directory/receipt only; it cannot edit product-owned profile plugins.

Skill Hub registers product-domain Tools through the pinned `ctx.tools` registry because catalog requests require the Host's authenticated identity service and must never expose tokens to a shell subprocess. Search is a bounded foreground read; download/install/publish create owner-scoped `ctx.jobs` work with the target controller, cancellation and completion delivery. Publish accepts an installed Skill name or a Harness attachment/artifact identity only; no Tool accepts an arbitrary host path. Tool schemas are the Agent's intent surface—there is no browser or Host keyword classifier.

The browser-facing Skill Hub controller attaches through Harness `ctx.jobs.attachController`; it does not create another task registry. A completed download Job yields only a short-lived download receipt. Binary transfer follows the target Session Export pattern: a same-origin loopback `GET/HEAD` route re-reads the cached archive, verifies SHA-256 again, and answers an attachment with `no-store` and `nosniff`.

Uploaded archives are untrusted. Publication does not make content executable or trusted. The adapter rejects malformed frontmatter, mismatched slug/version/hash, absolute or traversal paths, links, device files, nested archives, unexpected executable/native binaries, oversized entry/count/expanded size, duplicate paths, and licenses or provenance that fail policy. A Skill whose tools or platform are unavailable may be shown as unsupported but is not substituted with a nearby capability.

JavaScript Cordis packages are a different artifact family. If supported, they use Harness's existing dynamic Cordis package guard and approval flow; they are never accepted through the Markdown Skill ZIP endpoint.

## Agent-driven online update

`e-mate update` is a product CLI transaction reached through the target's existing Bash/PowerShell Tool, not a replacement Agent Loop, Tool registry, or updater protocol. It resolves an exact npm version/channel, validates the complete main/Runtime/Browser closure, and detaches activation from the running Host. The scheduling command runs in the foreground and returns immediately; e-Mate never shells out through browser code or edits the currently running npm tree in-process.

Activation is fail-closed: the updater waits for non-update Jobs to be idle, flushes local state, records the requested/installed versions and package integrity, stops the identity-verified managed instance so the target launcher's normal signal path performs bounded disposal, then performs npm install, `e-mate setup`, health check and `e-mate launch` from a detached helper. Failed setup or health returns to the recorded prior package/data snapshot. The target Tool's real events remain the only chat progress source.

## Enterprise plugins

Only `emate.identity`, `emate.modelPolicy`, and `emate.audit` may call the enterprise control plane. Their browser/Host seam uses Harness Connection logical RPC channels (for example `/emate.identity`) with the existing envelope, loopback trust fence, correlation and cancellation behavior. They do not register another transport.

`emate.identity` owns registration challenge issuance, self-registration, administrator-controlled account state, login/remembered lease state, required agreement discovery, and agreement archive receipts. Registration stores the required real name only on the enterprise server and returns a non-authenticating pending receipt. Approval requires a positive weekly Token allowance; disable/delete/password/allowance mutations revoke leases. The legal entity name and contact data come from the authenticated enterprise policy and are production-required. Acceptance records contain document versions/hashes and explicit acknowledgements, not passwords, tokens, conversations, attachments, or local paths. No browser or local-only receipt can unlock first use.

The three plugins cannot publish plugin-management, tool-approval, session-deletion, Job-control, or runtime-control services. Audit writes a local durable outbox first and uploads asynchronously; upload failure cannot block local execution.

`emate.modelPolicy` accepts only the fixed e-Mate 2.0.7 public/model mapping, a non-empty multi-select `allowed_model_ids`, one allowed default, the fixed image slots, a positive revision, bounded validity, and an immutable receipt. Its same-account cache is stored through Harness Storage Domain. It filters the existing `apiProxy` model list, guards the existing session selection method, and revalidates the actual `agent/request`; it does not expose a model endpoint or a second selection store. The local status RPC contains policy hashes and revisions but never the raw enterprise account subject.

`emate.audit` binds each actual `agent/request` to the current policy receipt, then accepts usage only from target `assistant/message` events whose source is a real model and whose token buckets are valid. Fact identity is stable across replay, payload hashes are canonical, duplicate delivery is idempotent, and a missing or conflicting account-policy binding is retained as `blocked` rather than attributed to a guessed user. The outbox and binding tables use Harness Storage Domain; backfill reads Harness SessionPersistence; interval and shutdown flushing use Cordis lifecycle services. A provider adapter must return an exact receipt for every fact ID and payload hash. Until the production ingest endpoint is verified, no provider is composed and durable pending facts remain local without blocking the Agent.

## Memory scope contract

`memory`, `dream`, and `learning` inject the target `workspaceRegistry` and session services. Their persistence key is a validated workspace ID plus canonical-path fingerprint; the current session must be an indexed member of that workspace before project material can be read or written. No plugin may use the selected sidebar row, display title, process cwd, or a global default directory as project authority. An ungrouped session is keyed by session ID and cannot see another ungrouped session's private material.

The implemented `emate-memory` owner opens its schema-validated records through target `ctx.storageDomain`, publishes the local `ctx.emateMemory` service for dream/learning consumers, and registers `e_mate_memory_remember` plus `e_mate_memory_search` through target `ctx.tools`. Scope is resolved anew for every operation. A missing directory, mismatched workspace membership, missing Agent identity, corrupted record, or changed managed binding fails before read/write; none falls back to another project or a global store.

`emate-dream` and `emate-learning` reuse the current Agent model route through target `ctx.llm`, assemble output with the pinned target LLM helpers, and execute through owner-scoped target `ctx.jobs`. Dream distillation stores one atomic, source-digested local record; exact input replay is deduplicated before another model call. Autonomous learning runs only after an idle transition and six new user messages, accepts only strict JSON whose evidence IDs exist in the bounded authoritative Harness transcript, and otherwise fails or stays silent without writing. Both inherit the same workspace/session isolation service. Neither plugin edits Skills, files, prompts, model policy, or the Harness event log.

Legacy schedules are a separate disabled migration catalog. The profile composes upstream `@deepseek-ai/dsh-schedule`; the e-Mate import adapter only validates/stages old rows, requires a later exact user confirmation, and nests target `schedule_list`/`schedule_create` calls. It never owns a timer, appends a synthetic `schedule/change`, or approximates unsupported cron, short intervals, ambiguous local times, or external recipients.

## UI action contract

Client plugins register controls only when they also provide the real action through an existing Harness service/slot or one of the three enterprise RPC services. Every mutation is single-flight, cancellable where the target supports cancellation, reports the real error, and is re-read from the authoritative projection after success. Reference components that are purely decorative must render as non-interactive markup; visible buttons may not carry empty callbacks or locally manufactured completion state.
