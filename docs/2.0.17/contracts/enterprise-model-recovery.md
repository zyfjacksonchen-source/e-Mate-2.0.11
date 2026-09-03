# EM217-206 enterprise model delivery and recovery contract

Status: **PLANNING ONLY — ALL EM217-206 EVIDENCE OPEN**

This contract authorizes no implementation before EM217-205 completes. It changes no source, candidate, installed, production, packaging, version, or release gate. Missing fault, reconnect, gateway-startup, or installed evidence stays **OPEN**.

## Ownership and scope

EM217-206 is owned by AUTH and depends on EM217-205 and EM217-406. It hardens only existing Profile identity/model-policy seams and the existing Model Gateway. Pinned DSH rc.7 remains the sole owner of Sessions, Session history/events, Workspace, attachments/CAS, local Tools, settings/storage primitives, and the Agent Loop. Desktop remains the sole lifecycle owner and receives no EM217-206 change.

In scope for later implementation:

- `packages/dsh/src/profile/identity/enterprise-provider.ts`
- `packages/dsh/src/profile/identity/index.ts`
- `packages/dsh/src/profile/model-policy.ts`
- `packages/dsh/profile/plugins/emate-shell/src/client/identity.tsx`
- their focused existing/new identity, policy, and client tests
- `enterprise/apps/model-gateway/src/server.ts`
- `enterprise/apps/model-gateway/src/session-auth.ts`
- `enterprise/apps/model-gateway/src/postgres-usage-store.ts`
- `enterprise/apps/model-gateway/src/production.ts`
- focused Model Gateway authentication, contract, Postgres integration, and production-configuration tests
- this contract

Excluded: Desktop lifecycle; rc.7 Session, Workspace, attachment, Tool, history, Agent Loop, store, or transport redesign; analytics/admin UI; generic provider retry; packaging, version, release, deployment, and publication. A monotonic catalog revision that demonstrably requires analytics/schema ownership needs a separate main-agent-approved scope and write-set lock; EM217-206 must not silently expand.

## Failure domains

The implementation and evidence must name the failing owner rather than report generic offline state:

1. **Management/control-plane outage:** Auth/management refresh, login, policy administration, or control HTTP is unavailable. Local runtime stays usable. A still-valid short model session may be used only through the live Gateway, whose database checks remain authoritative; expiry or a known revocation wins.
2. **Gateway data-plane outage:** the OpenAI-compatible Model Gateway route is unreachable or unhealthy. Enterprise model calls fail with a bounded, truthful gateway-unavailable result and perform zero provider POSTs. No direct-provider fallback exists.
3. **Provider outage:** Gateway authentication, Postgres, route, and key checks succeeded, but the selected upstream provider rejected, timed out, or failed. The failure remains provider-boundary truth; EM217-206 adds no retry.
4. **Postgres outage:** Gateway cannot establish live session/user/route/key authority. A running Gateway returns a bounded 503 before provider submission and resumes on a later request after the existing pool recovers. Gateway startup while Postgres is down remains fail closed; supervisor restart/recovery evidence is operational and **OPEN**, not an in-process recovery claim.

## Local availability is independent

Warm disconnect and cold restart during a management/control outage must still reach Desktop Renderer health and keep native Session list/open/history, Workspace operations, attachments, and local Tools usable. Identity UI state must represent local availability separately from enterprise authentication. It must not hide or inert the entire local application merely because management is unavailable.

A remembered record may provide nonauthoritative last-known-good labels and model metadata for UX only. Once access/model expiry is reached, or revocation/user disable/model-list change is known, cached state must not claim `authenticated`, advertise enterprise routability, or grant an enterprise call. Expiry and revocation always win over cache.

## Live enterprise delivery boundary

EM217-206 closes direct-key bypass atomically across Gateway and Profile:

- Runtime catalog responses expose Gateway-routed OpenAI-compatible provider metadata and reuse the existing short model-session credential reference. They do not return plaintext upstream provider keys or direct-provider authorization material.
- `llm-pi-ai` continues through its existing OpenAI-compatible owner, pointed at the existing Gateway route; no second LLM router or transport is introduced.
- Every enterprise invocation crosses Gateway authentication. Gateway performs the final per-request Postgres session, user, route enable/publication, and tenant route-key decision before provider submission.
- Obsolete distributed upstream-key OS references are removed through the existing credential owner. They are never retained as an availability fallback.
- Settings, storage-domain rows, catalog cache, logs, errors, and audit contain no access token, refresh token, model-session token, upstream key, or other model secret. Approved OS credential references remain the only durable client secret boundary.
- Last-known-good catalog metadata is nonauthoritative. It may render bounded UX but cannot authorize or route a call past expiry, revocation, or a failed live Gateway check.

The Profile and Gateway portions must activate together. A mixed version fails enterprise routing closed; it must not fall back to direct provider delivery.

## Refresh, reconnect, and fencing

Reuse existing seams only: browser `online` and focus signals, identity credential-generation notification, the current coalesced refresh owner, and the existing 30-second keepalive ceiling. Valid refresh credentials must restore authenticated state and rehydrate the Gateway catalog without app restart or password login. Overlapping signals coalesce; they do not create a polling or transport owner.

Generation is captured before the network request. Every response rechecks the exact identity/session generation before any OS credential, Settings, storage table, marker, or in-memory publication. A delayed catalog/refresh A cannot modify state after logout or login/catalog B. If a later proof shows same-subject ordering additionally needs a monotonic server revision, that work remains outside this write set until separately approved.

Projection persistence is rollback-safe: after injected failure at any OS credential, Settings, active-policy table, or projection-marker write, either the previous complete live projection remains or enterprise routing is non-routable and obsolete secrets are cleared. Cold restart must reach the same state.

## Acceptance and fault evidence

All evidence below is **OPEN** until the future authorized implementation and focused tests actually run.

| Fault | Required result |
|---|---|
| Warm management blackhole/500 | Renderer/local owners remain usable; valid live Gateway lease is distinguished from control outage; no cache extends authorization past expiry/revocation. |
| Cold management blackhole/500 | Renderer health, Session list/open/history, Workspace, attachments, and local Tools remain usable; expired remembered state is not authenticated; enterprise provider POST = 0. |
| Exact expiry boundary | `exp - 1` follows the valid lease contract; `exp` is rejected. Clock skew may protect future `iat/nbf` only and must not grant after `exp`. |
| Session revoke or user disable | Next enterprise request fails before provider POST; local owners are unchanged; cached authenticated/routable state is withdrawn. |
| User model-list change | Removed model is denied before provider POST; newly admitted model appears only after live revalidation. |
| Route disable/unpublish then re-enable | Disable is effective on the next Gateway request with provider POST = 0; re-enable recovers without app or Gateway restart after live authorization. |
| Tenant key A to B rotation | Next admitted Gateway request uses B; A is neither returned to nor retained by the Profile. |
| Delayed refresh/catalog A versus logout/login B | A cannot write credentials, Settings, tables, marker, cache, or UI state after B. |
| OS credential/Settings/table failure | Previous complete projection remains, or routing is disabled and obsolete secrets are cleared; restart preserves that result. |
| Gateway blackhole with provider reachable | Typed Gateway data-plane failure; provider POST = 0; no direct-provider fallback. |
| Provider reject/429/5xx/timeout | Truthful provider failure after live authorization; no new retry or auth misclassification. |
| Running Postgres down then up | While down: Gateway 503 and provider POST = 0. After pool recovery: next authorized request succeeds without Gateway restart. |
| Gateway starts while Postgres is down | No listener/authorization claim; supervisor recovery mechanism and evidence remain explicitly **OPEN**. |
| Reconnect | Existing online/focus/credential-generation signals and <=30 s keepalive are bounded/coalesced; valid refresh restores identity/catalog without app restart/login. |

Every fault assertion also proves native local owners are unaffected. Evidence must identify request counts and boundary codes without recording prompts, attachments, tokens, keys, provider bodies, or private paths.

## Rollback

Rollback first disables enterprise routing and catalog admission fail closed, then reverts the Profile and Gateway portions together. It leaves native Sessions, history, Workspace, attachments, local Tools, and their storage untouched. It may clear only obsolete enterprise runtime credential references through the existing credential owner. Rollback must never restore plaintext upstream-key distribution or direct-provider delivery as an availability fallback.
