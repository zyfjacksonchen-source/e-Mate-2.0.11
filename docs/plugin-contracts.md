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

`packages/dsh/profile/component-inventory.json` is the only first-party component roster. It declares the Shell and every first-party DSH plugin, including whether each one is hot, target-bound, or blocked; the CLI bundle copier, Desktop composer, change classifier, bootstrap matrix and release emitter all consume that file instead of maintaining parallel lists. Setup verifies every allowlisted package file and composes its bundle patch through the pinned Loader. A component may depend only on the fixed Harness identities and its signed dependency closure; it may not install another Runtime, Router, Store, Agent Loop or package manager.

`dsh-im` is pinned by source receipt to `xmanrui/dsh-im@2eea8a08bcd8ef91e8845de1f300b5715b746938`. Its e-Mate adapter contributes only dynamic `collaboration` capability metadata until exact rc.7 compatibility, project/session binding, OS credential handling and real authorization are proven. The upstream QQ runtime is excluded because `@tencent-connect/qqbot-connector@1.2.0` declares `UNLICENSED`; a blocked receipt is not permission to ship or load that dependency.

`office-skills` registers four clean-room Skills for documents, PDF, spreadsheets and presentations. It contains no Python interpreter, format library, OCR model or document Worker. A Skill can guide the Agent to a target-owned/approved toolchain, but must report the real missing capability rather than manufacture an artifact or completion.

`search-mcp` maps MCP discovery/calls to the target Web/Tool contracts. It does not add a browser-facing MCP socket or a parallel search event stream. `genui` uses the target tool-view/panel slots, while `better-sidebar` uses target Workspace/Session services and hides project files for general conversations. Subagent behavior remains entirely native to the pinned Harness; e-Mate ships no subagent compatibility package.

Browser capability is the ordinary `@e-mate/dsh-plugin-cdp` DSH adapter. It accepts only an explicit literal loopback CDP endpoint, binds target selection and snapshot references to the active Agent session, exposes actions as native DSH Tools, and routes mutations through the native approval policy. It ships no extension, side panel, browser binary, downloader, chat/session gateway, model/settings UI or second approval system. A missing or non-loopback CDP endpoint fails closed.

`vision-toolkit` is a Desktop-only hot Profile component over the pinned rc.7 toolkit. It preserves the native Skill, visual Tools, pasted-image codec, Tool views, Artifact preview/download and health surface, while the Desktop Base contributes only the packaged Python path. Its provider, model, credential reference and runtime settings are read-only projections of enterprise model policy; the same-origin Web route permits health checks but rejects Settings or credential writes. The CLI does not install this Desktop-dependent component.

Image generation/editing adapts the final e-Mate 2.0.5 Codex-like `imagegen` contract pinned at `564a6b6c1d43fb6831dd4a5cd8026e472f063311` to the target runtime. It calls the existing e-Mate Model Gateway through `emateIdentity` instead of importing the legacy Python provider runner or creating a second image credential. The local Tool is registered through target `ctx.tools`, executes under one owner-scoped target `ctx.jobs` record, and stores the verified result through target `ctx.attachments`. Its public arguments are exactly required `prompt` plus optional `image_url`; in 2.0.11 `image_url` is narrowed to one or more image attachment IDs already present in the authoritative current session. Generation posts JSON to `/v1/images/generations`; editing re-reads the referenced bytes and posts multipart data to `/v1/images/edits`. Both operations submit only `gpt-image-2-pro`. Users and the Agent cannot pass or select an image model, provider, output path, size, quality, timeout, or concurrency policy. Provider credentials and any eligible `gpt-image-2-pro → gpt-image-2` fallback remain server-side.

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

## Permission boundary

The DSH sandbox policy, DSH approval policy, operating-system privacy grants, and plugin-owned authorization are independent authorities. A plugin may inspect only the native context needed by its own contract and must not derive one authority from another. In particular, `danger-full-access` is not a Computer Use application grant, a CDP consent, a credential, a Skill/MCP installation receipt, or an operating-system TCC grant; `approval/policy: never` means a required native approval is rejected, not pre-approved.

Computer Use therefore retains the pinned `configuredAccess -> approval` lease path unchanged: only `allowAllApps`, an exact application grant, or an allowed native interactive lease permits access. CDP follows the same shape with its own persisted, endpoint-bound control grant: a direct capability action or native `UserQuestions` may enable or revoke that grant; without it, mutations use the native approval policy and fail closed under `never`. CDP read access still requires an explicit loopback endpoint and session target binding. Product mutations that are intentionally outside `ctx.approval`, such as an exact Skill Hub action or a one-way credential write, require a direct exact user action or native `UserQuestions` confirmation and remain scoped to their own transaction receipt. Repository tests must reject any adapter that maps a sandbox mode to plugin access or silently executes an approval-required mutation under `never`.

Every component declares a sorted, closed-vocabulary `eMate.component.authority_contract` with `effects` and their required `guards`. The release emitter copies that declaration into the signed component manifest, and the Desktop rejects missing, unknown, unsorted, or extra authority fields before materialization. This ledger is an admission, audit, and update-disclosure contract only: an in-process Cordis plugin remains trusted Host code and the ledger is never treated as a JavaScript sandbox or a runtime permission token.

## User-visible and system plugins

The capability center derives the product-owned list from registered metadata and real readiness. It may expose image generation/editing, Office Skills, Search, the CDP browser adapter, Vision/OCR, Feishu, Tencent Docs, WeChat, and DingTalk, but a blocked/setup-required adapter must say so and publish no fake action. A separate community tab retains the e-Mate Skill Hub and locally installed custom Skills. Schedule, `memory-evolve`, native Subagent, GenUI and Better Sidebar are system bundles and do not add misleading built-in cards.

## Component admission and publication

The component inventory, `base-contract.json`, component package metadata and signed desired state are one executable contract. A portable component emits one target-null payload; Computer Use and Vision Toolkit emit only the native closure for the selected platform tuple, while Xin Assistant is blocked from 2.0.11. Component files are codepoint-sorted regular files with canonical package entries, exact modes, sizes and SHA-256 values. Runtime dependencies that are not fixed Base ABI peers are bundled into those bytes; a component cannot rely on an accidental parent `node_modules` lookup.

The normal change path is fixed:

1. `change-impact` assigns the exact Git diff to Base, plugin-only, enterprise-only, verification-only, docs-only, or none; unknown/shared inputs fail to Base.
2. A plugin-only job restores the accepted Base SDK and builds/tests only each changed component and target. A missing SDK fails rather than rebuilding Harness.
3. If every published payload is portable, one macOS job merges it with the signed accepted set and materializes all three targets, verifies the unchanged target-native closures, then boots the shared Host/Web Loader graph once on arm64. If any published payload is target-bound, each matching native target job still materializes and boots its own complete generation. No installer is built in either plugin-only path.
4. `profile-release.yml` accepts only those exact successful CI artifacts. A protected squash merge may promote pull-request evidence without rebuilding only when GitHub confirms that PR produced the current `main`, its base is the current commit's sole parent, and both commits have the same Git tree SHA; the publication plan records both commit identities. Any other merge requires `main` CI. The workflow production-signs the same payload into a bounded native-Cloudflare publication bundle. The plan separates immutable changed objects from `no-store` activation pointers, records every byte count/SHA-256 plus the expected current pointer, and is published through the connected Codex Cloudflare plugin: upload and public-readback immutable bytes first, recheck every expected current pointer, then activate each target desired state last.
5. The Desktop downloads only the confirmed delta, switches one generation atomically on restart, and commits it only after renderer health; otherwise it restores the last-known-good generation.

The initial generation follows the same path with a one-time full-component bootstrap from the accepted Base SDK. This exception seeds the signed accepted set; it is not a recurring excuse to rebuild unrelated components or installers. Profile signing keys exist only in the protected publication environment and are never available to Agent tools, Creation Mode, component builds, tests, or candidate composition. R2 authority stays in the user's connected Codex Cloudflare plugin rather than repository secrets; the plugin accepts only the exact workflow artifact and publication plan for the accepted main commit.

The Host registry is a Cordis service published as `ctx.emateCapabilities`; each local adapter owns its title, summary, same-origin icon asset, order, current readiness and currently valid actions. The browser reads the projection through Harness Connection `/emate.capabilities` and renders it generically. Capability IDs, plugin module names and tool names are not dispatched in the browser. An action is accepted only when the adapter's fresh status still advertises its action ID; after execution the browser re-reads the complete registry. A plugin with an invalid or throwing status is shown as failed with no actions, not silently treated as ready.

A capability credential action advertises only a validated credential reference from its fresh status. The generic browser surface renders a password input and sends the value through the pinned Harness `credentials.set` one-way API; the capability action endpoint rejects that action kind so secret bytes cannot enter its generic `data`, an Agent turn, `UserQuestions`, Settings or logs. The Host credential provider remains the sole authority on writability and shadowing.

## Community Skill Hub adapter

The retained e-Mate Skill Hub package is a versioned Skill archive, not an npm/Cordis bundle. Its local install adapter reuses both existing sides:

1. retain the e-Mate 2.0.5 Hub catalog, immutable version, upload, package SHA-256, provenance, duplicate-version rejection, size, path, link and archive-bomb checks;
2. fetch through a Host-side `emate.skillHub` adapter after identity authorization, never directly from browser code;
3. verify the response digest and package manifest before extraction;
4. validate the staged candidate through the pinned `@deepseek-ai/dsh-skill-filesystem` parser, atomically switch it under `$DSH_HOME/skills/<slug>/`, then require an exact provider readback and real `@deepseek-ai/dsh-tool-skill` load before commit;
5. persist one per-slug transaction WAL/lock from intent through catalog completion so concurrent, cancelled, crashed, or response-unknown operations cannot roll back a newer successful version.

No ordinary user runs `pnpm` or `dsh plugin`, and e-Mate does not fork the Harness Skill registry. The same transaction owner implements local install/update/enable/disable/uninstall using exact receipt/digest ownership; disable and uninstall quarantine atomically and commit only after native provider readback. These operations cannot edit product-owned Profile plugins or another source owner's Skill.

`@e-mate/dsh-plugin-find-skill` contributes only catalog discovery (`skill_find`). Its install/remove Tools and `/skill` mutation command are disabled in the signed Profile configuration. Discovery results may be handed to Skill Hub, but this component cannot create a second mutable Skill root, execute a package-manager install, or remove a Skill.

Skill Hub registers product-domain Tools through the pinned `ctx.tools` registry because catalog requests require the Host's authenticated identity service and must never expose tokens to a shell subprocess. Natural language may drive search/detail/install/update/enable/disable/uninstall for shared Skills and upload/publish/tombstone-delete for publications owned by the current identity. Mutations create owner-scoped `ctx.jobs`; an exact action/slug/version already stated by the user is the only implicit consent, otherwise native `ctx.userQuestions` confirms source, version, digest and local/server scope before side effects. Publish accepts an installed Skill identity or a Harness attachment/artifact identity only; no Tool accepts an arbitrary host path. Delete requires an ownership receipt and never rewrites immutable version bytes. Tool schemas are the Agent intent surface—there is no browser or Host keyword classifier.

The browser-facing Skill Hub controller attaches through Harness `ctx.jobs.attachController`; it does not create another task registry. Active/recent owner Jobs and the local receipt inventory survive browser remount, and terminal completion triggers a fresh native provider/readiness projection. A completed download Job yields only a random, one-use, expiring and quota-bounded download receipt. Binary transfer follows the target Session Export pattern: a same-origin loopback `GET/HEAD` route re-reads the cached archive, verifies SHA-256 again, and answers an attachment with `no-store` and `nosniff`.

Uploaded archives are untrusted. Publication does not make content executable or trusted. The adapter rejects malformed frontmatter, mismatched slug/version/hash, absolute or traversal paths, links, device files, nested archives, unexpected executable/native binaries, oversized entry/count/expanded size, duplicate paths, and licenses or provenance that fail policy. A Skill whose tools or platform are unavailable may be shown as unsupported but is not substituted with a nearby capability.

JavaScript Cordis packages are a different artifact family. If supported, they use Harness's existing dynamic Cordis package guard and approval flow; they are never accepted through the Markdown Skill ZIP endpoint.

## Agent-driven online update

Natural-language update intent invokes only `e_mate_desktop_update`, which delegates to the existing native Desktop update service. It first verifies the signed target-specific Profile desired state. A compatible change calculates only missing component bytes; an incompatible contract returns `base-required` and then uses the existing Desktop installer lane. Browser code, Bash/PowerShell, npm/pnpm and a second updater are never part of this path.

The explicit Agent request authorizes metadata inspection only. The native confirmation names the release, changed component ids, compatibility and remaining bytes. After confirmation Desktop re-fetches the same signed generation, materializes a complete inactive Profile, atomically selects it for restart and commits only after Renderer health. Timeout, boot failure or content damage restores the last-known-good generation. The target Tool and native update service events remain the only progress source.

Every accepted Profile component owns a committed frozen `pnpm-lock.yaml`. CI installs that component with `--ignore-workspace --frozen-lockfile`, then builds and tests only that component before complete-generation composition. The lock is part of the package allowlist and signed payload, so adding or upgrading a component dependency changes that component without rewriting the Base/root lock. Missing, shared, linked, or workspace-relative dependency input fails closed.

## Platform Profile components

A `platform-profile` component is still a Profile plugin, not Desktop Base code. It may be published independently only as three explicit target artifacts (`darwin-arm64`, `darwin-x64`, `win32-x64`). Inventory, desired-state reference and component manifest must agree on platform, architecture, runtime ABI, native minimum OS, signing scheme/identity and the sorted native path closure. Portable components use `target: null` and cannot contain a target tuple.

The component job runs on the matching target runner, emits no bytes from another target, and validates every selected native binary format plus its declared signature. macOS Mach-O content must pass strict ad-hoc verification; Windows native content must be PE and follow the current unsigned release declaration. A `runtime_abi: none` target contains no native files. Desktop fetches the platform/architecture-specific desired state and rejects target drift before staging. Native minimum OS controls that capability's readiness and does not force unrelated portable components back into a Base build.

## Enterprise plugins

Only `emate.identity`, `emate.modelPolicy`, and `emate.audit` may call the enterprise control plane. Their browser/Host seam uses Harness Connection logical RPC channels (for example `/emate.identity`) with the existing envelope, loopback trust fence, correlation and cancellation behavior. They do not register another transport.

`emate.identity` owns registration challenge issuance, self-registration, administrator-controlled account state, login/remembered lease state, required agreement discovery, and agreement archive receipts. Registration stores the required real name only on the enterprise server and returns a non-authenticating pending receipt. Approval requires a positive weekly Token allowance; disable/delete/password/allowance mutations revoke leases. The legal entity name and contact data come from the authenticated enterprise policy and are production-required. Acceptance records contain document versions/hashes and explicit acknowledgements, not passwords, tokens, conversations, attachments, or local paths. No browser or local-only receipt can unlock first use.

The three plugins cannot publish plugin-management, tool-approval, session-deletion, Job-control, or runtime-control services. Audit writes a local durable outbox first and uploads asynchronously; upload failure cannot block local execution.

`emate.modelPolicy` accepts only the fixed e-Mate 2.0.11 public/model mapping, a non-empty multi-select `allowed_model_ids`, one allowed default, the fixed image slots, a positive revision, bounded validity, and an immutable receipt. Its same-account cache is stored through Harness Storage Domain. It filters the existing `apiProxy` model list, guards the existing session selection method, and revalidates the actual `agent/request`; it does not expose a model endpoint or a second selection store. The local status RPC contains policy hashes and revisions but never the raw enterprise account subject.

`emate.audit` binds each actual `agent/request` to the current policy receipt, then accepts usage only from target `assistant/message` events whose source is a real model and whose token buckets are valid. Fact identity is stable across replay, payload hashes are canonical, duplicate delivery is idempotent, and a missing or conflicting account-policy binding is retained as `blocked` rather than attributed to a guessed user. The outbox and binding tables use Harness Storage Domain; backfill reads Harness SessionPersistence; interval and shutdown flushing use Cordis lifecycle services. A provider adapter must return an exact receipt for every fact ID and payload hash. Until the production ingest endpoint is verified, no provider is composed and durable pending facts remain local without blocking the Agent.

## Memory scope contract

`memory-evolve` injects the target `workspaceRegistry` and session services. Its persistence key is a validated workspace ID plus canonical-path fingerprint; the current session must be an indexed member of that workspace before project material can be read or written. No plugin may use the selected sidebar row, display title, process cwd, or a global default directory as project authority. An ungrouped session is keyed by session ID and cannot see another ungrouped session's private material.

The adapter opens schema-validated records through target `ctx.storageDomain`; scope is resolved anew for every operation. A missing directory, mismatched workspace membership, missing Agent identity, corrupted record, or changed binding fails before read/write; none falls back to another project or a global store. The removed standalone dream/learning plugins, their model calls and their persistence are not retained behind compatibility aliases. Any evolve behavior must come from the accepted `memory-evolve` contract and inherit the same scope checks.

Legacy schedules are a separate disabled migration catalog. The profile composes upstream `@deepseek-ai/dsh-schedule`; the e-Mate import adapter only validates/stages old rows, requires a later exact user confirmation, and nests target `schedule_list`/`schedule_create` calls. It never owns a timer, appends a synthetic `schedule/change`, or approximates unsupported cron, short intervals, ambiguous local times, or external recipients.

## UI action contract

Client plugins register controls only when they also provide the real action through an existing Harness service/slot or one of the three enterprise RPC services. Every mutation is single-flight, cancellable where the target supports cancellation, reports the real error, and is re-read from the authoritative projection after success. Reference components that are purely decorative must render as non-interactive markup; visible buttons may not carry empty callbacks or locally manufactured completion state.
