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

## Embedded bundle boundary

The single main tarball embeds ten profile bundles: `office-skills`, `search-mcp`, `browser`, `browser-panel`, `vision-toolkit`, `memory-evolve`, a native-subagent receipt, `genui`, `better-sidebar`, and the fail-closed `dsh-im` adapter receipt. Setup verifies their allowlisted package files and composes their bundle patches through the pinned Loader. A bundle may depend only on the fixed Harness runtime identities; it may not install another Runtime, Router, Store, Agent Loop or package manager. The browser extension carrier is the sole exception to the no-new-WebSocket rule: it accepts only browser Tool call/cancel/result frames and carries no Session, chat, model, settings or WebUI state.

`dsh-im` is pinned by source receipt to `xmanrui/dsh-im@2eea8a08bcd8ef91e8845de1f300b5715b746938`. Its e-Mate adapter contributes only dynamic `collaboration` capability metadata until rc.5 compatibility, project/session binding, OS credential handling and real authorization are proven. The upstream QQ runtime is excluded because `@tencent-connect/qqbot-connector@1.2.0` declares `UNLICENSED`; a blocked receipt is not permission to ship or load that dependency.

`office-skills` registers four clean-room Skills for documents, PDF, spreadsheets and presentations. It contains no Python interpreter, format library, OCR model or document Worker. A Skill can guide the Agent to a target-owned/approved toolchain, but must report the real missing capability rather than manufacture an artifact or completion.

`search-mcp` maps MCP discovery/calls to the target Web/Tool contracts. It does not add a browser-facing MCP socket or a parallel search event stream. `genui` uses the target tool-view/panel slots, while `better-sidebar` uses target Workspace/Session services and hides project files for general conversations. The subagent package is only a compatibility receipt for rc.5 native Subagent behavior; it contains no copied AGPL implementation.

Browser capability is fail-closed and platform-specific. `browser` packages the reduced `dsh-browser` MV3 extension for existing macOS Chrome and Windows Chrome/Edge, authenticates it over loopback, binds every call to `exec.agent.id`, and routes mutations through target approval. It registers no chat, Session gateway, model/settings UI or second approval system. `browser-panel` only projects the real bridge state through target Connection RPC and slots; it cannot make a disconnected or platform-unverified adapter ready.

`vision-toolkit` remains `blocked`: rc.5 lacks the enterprise model-policy seam required to govern its model route. It does not register a ready OCR/Vision action and does not fall back to the deleted RapidOCR/Python runtime, a local model Key, or a guessed endpoint.

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

The capability center derives the product-owned list from registered metadata and real readiness. It may expose image generation/editing, Office Skills, Search, Browser, Vision/OCR, Feishu, Tencent Docs, WeChat, and DingTalk, but a blocked/setup-required adapter must say so and publish no fake action. A separate community tab retains the e-Mate Skill Hub and locally installed custom Skills. Schedule, `memory-evolve`, native Subagent, GenUI and Better Sidebar are system bundles and do not add misleading built-in cards.

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

`e-mate update` is a product CLI transaction reached through the target's existing Bash/PowerShell Tool, not a replacement Agent Loop, Tool registry, or updater protocol. It resolves the embedded commit-scoped R2 release source, verifies the HTTPS manifest plus tarball name/version/SHA-256/SHA-512/SRI before npm stages the local bytes, and detaches activation from the running Host. The scheduling command runs in the foreground and returns immediately; e-Mate never shells out through browser code or edits the currently running npm tree in-process.

Activation is fail-closed: the updater waits for non-update Jobs to be idle, flushes local state, records the requested/installed versions and package integrity, stops the identity-verified managed instance so the target launcher's normal signal path performs bounded disposal, then performs npm install, `e-mate setup`, health check and `e-mate launch` from a detached helper. Failed setup or health returns to the recorded prior package/data snapshot. The target Tool's real events remain the only chat progress source.

## Enterprise plugins

Only `emate.identity`, `emate.modelPolicy`, and `emate.audit` may call the enterprise control plane. Their browser/Host seam uses Harness Connection logical RPC channels (for example `/emate.identity`) with the existing envelope, loopback trust fence, correlation and cancellation behavior. They do not register another transport.

`emate.identity` owns registration challenge issuance, self-registration, administrator-controlled account state, login/remembered lease state, required agreement discovery, and agreement archive receipts. Registration stores the required real name only on the enterprise server and returns a non-authenticating pending receipt. Approval requires a positive weekly Token allowance; disable/delete/password/allowance mutations revoke leases. The legal entity name and contact data come from the authenticated enterprise policy and are production-required. Acceptance records contain document versions/hashes and explicit acknowledgements, not passwords, tokens, conversations, attachments, or local paths. No browser or local-only receipt can unlock first use.

The three plugins cannot publish plugin-management, tool-approval, session-deletion, Job-control, or runtime-control services. Audit writes a local durable outbox first and uploads asynchronously; upload failure cannot block local execution.

`emate.modelPolicy` accepts only the fixed e-Mate 2.0.7 public/model mapping, a non-empty multi-select `allowed_model_ids`, one allowed default, the fixed image slots, a positive revision, bounded validity, and an immutable receipt. Its same-account cache is stored through Harness Storage Domain. It filters the existing `apiProxy` model list, guards the existing session selection method, and revalidates the actual `agent/request`; it does not expose a model endpoint or a second selection store. The local status RPC contains policy hashes and revisions but never the raw enterprise account subject.

`emate.audit` binds each actual `agent/request` to the current policy receipt, then accepts usage only from target `assistant/message` events whose source is a real model and whose token buckets are valid. Fact identity is stable across replay, payload hashes are canonical, duplicate delivery is idempotent, and a missing or conflicting account-policy binding is retained as `blocked` rather than attributed to a guessed user. The outbox and binding tables use Harness Storage Domain; backfill reads Harness SessionPersistence; interval and shutdown flushing use Cordis lifecycle services. A provider adapter must return an exact receipt for every fact ID and payload hash. Until the production ingest endpoint is verified, no provider is composed and durable pending facts remain local without blocking the Agent.

## Memory scope contract

`memory-evolve` injects the target `workspaceRegistry` and session services. Its persistence key is a validated workspace ID plus canonical-path fingerprint; the current session must be an indexed member of that workspace before project material can be read or written. No plugin may use the selected sidebar row, display title, process cwd, or a global default directory as project authority. An ungrouped session is keyed by session ID and cannot see another ungrouped session's private material.

The adapter opens schema-validated records through target `ctx.storageDomain`; scope is resolved anew for every operation. A missing directory, mismatched workspace membership, missing Agent identity, corrupted record, or changed binding fails before read/write; none falls back to another project or a global store. The removed standalone dream/learning plugins, their model calls and their persistence are not retained behind compatibility aliases. Any evolve behavior must come from the accepted `memory-evolve` contract and inherit the same scope checks.

Legacy schedules are a separate disabled migration catalog. The profile composes upstream `@deepseek-ai/dsh-schedule`; the e-Mate import adapter only validates/stages old rows, requires a later exact user confirmation, and nests target `schedule_list`/`schedule_create` calls. It never owns a timer, appends a synthetic `schedule/change`, or approximates unsupported cron, short intervals, ambiguous local times, or external recipients.

## UI action contract

Client plugins register controls only when they also provide the real action through an existing Harness service/slot or one of the three enterprise RPC services. Every mutation is single-flight, cancellable where the target supports cancellation, reports the real error, and is re-read from the authoritative projection after success. Reference components that are purely decorative must render as non-interactive markup; visible buttons may not carry empty callbacks or locally manufactured completion state.
