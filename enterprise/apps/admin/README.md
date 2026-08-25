# e-Mate enterprise admin

This app is the smallest production-facing administrator surface backed by
authoritative services currently present in this repository.

## Deployment contract

- Serve the built app over HTTPS.
- Serve the console at `/ecorex-agent/admin/` and reverse proxy
  `/e-mate/enterprise-api/` to `@e-mate/analytics-api` on the same origin.
  The proxy removes only the public `/e-mate/enterprise-api/` prefix and must
  not strip the `Authorization` header.
- Set `VITE_ADMIN_API_BASE` only when the analytics API lives under a
  same-origin path prefix. The enterprise release uses
  `/e-mate/enterprise-api/`.
- Reverse proxy same-origin `/v1/auth/` to `@e-mate/auth-gateway`. Configure
  `VITE_AUTH_CLIENT_ID=e-mate-admin` and allow that client ID in Auth Gateway.
  The Analytics API `sessionAuth` issuer, audience, client ID and Ed25519
  public keys must match Auth Gateway; every request rechecks the active
  database session and user before accepting the signed access token.
- Set `VITE_USAGE_DASHBOARD_PATH` to the same-origin deployed usage dashboard
  path, `/ecorex-agent/usage-panel/`. When absent, the console shows plain unavailable text
  instead of a non-working control.
- Administrators sign in with organization, account and password. Passwords
  are never persisted or logged. The short-lived access token uses the isolated
  `e-mate.admin.access-token` `sessionStorage` entry and is never placed in a
  URL. The existing static hashed Bearer remains only as a bootstrap-compatible
  operations identity; it is not exposed by this UI.

## Authoritative services

- Initialize `PostgresAdminManagementStore` with the same redacted route
  catalog configured in Model Gateway and pass it as `adminManagement`.
- Enterprise administrator tokens retain roles and no task-event write scope.
  Newly issued user credentials receive only `models:invoke`; task audit is
  accepted only by Model Gateway from the signed-in e-Mate session.
- Use the same PostgreSQL database for Analytics and Model Gateway. Production
  Model Gateway reads `e_mate_tenant_model_route` before catalog responses and
  before upstream or usage-journal access. Read failures are fail-closed.
- Auth Gateway tenant users can carry `TENANT_ADMIN`, `AUDIT_ADMIN`, or
  `MEMBER`. `SUPER_ADMIN` remains an out-of-band bootstrap role and cannot be
  minted by password login.

Existing task-event credential metadata remains listable and revocable so
historical administration records are preserved, but Analytics exposes no task
event write endpoint and no longer authenticates those legacy secrets. Local
e-Mate uploads metadata-only audit facts with its short-lived Model Gateway
session, and Renderer receives neither credential.

## Local-runtime boundary

The administrator control plane owns identity/account/authentication leases,
managed model and search policy with bounded credential leases, and append-only
redacted audit/usage only. It does not invoke models. Production does not register runtime-registry, Session Index,
observability-policy or local-runtime status routes, and the console must not
add a dependency on them. It cannot execute local commands, manipulate local
sessions, tools, plugins, permissions or sandbox policy, or read prompts,
answers, attachments, local paths or credential values. A control-plane outage
may fail closed for a new enterprise model request, but it must not lock a
previously accepted local Harness workspace.

All user, credential, and model-route writes are tenant-scoped from the
authenticated principal and append redacted audit records. New routes are
disabled until explicitly enabled. Add/remove only publishes or removes a
route already present in the deployed Model Gateway catalog; unknown routes
return `404` and the console does not offer arbitrary provider-route creation.
Only `gpt-5.6-luna`, `gpt-5.6-sol`, and `gpt-image-2-pro` retain the default
allowlist.

## Immediate management semantics

- Deleting a user is a terminal soft delete. The same PostgreSQL transaction
  marks the user `DELETED`, revokes every bound credential, and appends one
  redacted audit record. Historical usage and ownership remain intact.
- Static enterprise administrator Bearers are out-of-band bootstrap
  identities, not tenant-user credentials. Deleting a tenant user revokes that
  user's issued credentials and blocks its signed sessions; it does not revoke
  a separately configured bootstrap administrator identity.
- A user token limit is either `null` (unlimited) or a positive safe integer.
  It is a cumulative allowance over recorded input, output, cache-read, and
  cache-write tokens; this release does not reset it on a calendar cycle.
- Model Gateway rereads user activity, token allowance, route enablement, and
  tenant model keys for each new request. A committed administrator change
  therefore affects the next request without cache invalidation or restart.
  Work already admitted keeps its captured state. Because provider output is
  unknown until completion, the last admitted request may cross the allowance;
  later requests remain blocked until an administrator raises or removes it.
- User updates carry the last observed update timestamp. Stale administrator
  pages receive `409 ADMIN_USER_STALE` and reload before another write, so a
  quota edit or deletion cannot overwrite a newer administrator change.
- The console and API ship in one release, but Compose activation is not an
  atomic UI/API cutover. An older tab or a write during rollout fails closed;
  reload after release health succeeds before retrying the change.
