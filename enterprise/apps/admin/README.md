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
- Keep the Auth Gateway `modelGateway.baseUrl` on the console origin and reverse
  proxy that path (production: `/e-mate/model-api/`) to the existing Model
  Gateway. The console stores its short-lived model session separately as
  `e-mate.admin.model-session`; it never receives or calls an upstream API key.
- Set `VITE_USAGE_DASHBOARD_PATH` to the same-origin deployed usage dashboard
  path, `/ecorex-agent/usage-panel/`. When absent, the console shows plain unavailable text
  instead of a non-working control.
- Administrators sign in with organization, account and password. Passwords
  are never persisted or logged. The short-lived access token uses the isolated
  `e-mate.admin.access-token` `sessionStorage` entry and is never placed in a
  URL. The existing static hashed Bearer remains only as a bootstrap-compatible
  operations identity; it is not exposed by this UI.

## Model connectivity test

The model-route row reuses the authenticated Model Gateway session returned by
password login. It first reads `/v1/models`, then follows the registered
`capabilities.imageGeneration` fact to run either one bounded `/v1/responses`
inference or one `/v1/images/generations` request. It does not branch on a model
name, contact a provider directly, or create a second model transport.

This is a real invocation: consent, tenant publication, route enablement,
allowed-model policy, encrypted route key lookup, idempotency and usage audit
remain enforced by Model Gateway. The UI therefore warns that every click can
consume quota (and image tests can incur image-generation cost). A route not in
the current administrator model session is disabled; an expired model session
requires a new login.

## Authoritative services

- Initialize `PostgresAdminManagementStore` with the same redacted route
  catalog configured in Model Gateway and pass it as `adminManagement`.
- Compose the enterprise authenticator with `createManagementAuthenticator`.
  Enterprise administrator tokens retain roles and no task-event write scope;
  issued task credentials receive only `task-events:write` and no roles.
- Use the same PostgreSQL database for Analytics and Model Gateway. Production
  Model Gateway reads `e_mate_tenant_model_route` before catalog responses and
  before upstream or usage-journal access. Read failures are fail-closed.
- Auth Gateway tenant users can carry `TENANT_ADMIN`, `AUDIT_ADMIN`, or
  `MEMBER`. `SUPER_ADMIN` remains an out-of-band bootstrap role and cannot be
  minted by password login.

Task-event credentials are random opaque Bearer secrets. The API returns a new
secret once, persists only its SHA-256 digest, exposes redacted metadata on
later reads, verifies the exact `task-events:write` scope, and supports
revocation. Desktop main receives such a credential through its protected
deployment path; Renderer must never receive it.

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
