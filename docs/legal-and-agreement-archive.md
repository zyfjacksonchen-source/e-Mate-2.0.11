# Legal agreements and enterprise archive

This document is an engineering contract, not a substitute for final review by the service provider's qualified counsel.

## First-use flow

1. The browser requests a short-lived, one-time registration image challenge from `emate.identity`. The enterprise server enforces per-source and per-account rate limits.
2. The user submits a unique account, mandatory real name, password and verification code. Success returns only a `pending_approval` registration receipt; it does not authenticate or unlock e-Mate.
3. An administrator verifies the identity, approves the record, and sets a positive weekly Token allowance and model policy. Approval without both is rejected.
4. The user authenticates through `emate.identity`; the local browser never receives or stores the enterprise bearer or refresh credential. “Keep me signed in” changes only the server lease lifetime.
5. The Host asks the enterprise identity service which agreement versions are required for that account and tenant.
6. Before the Harness workspace is exposed, the browser presents both packaged documents, the exact enterprise legal name and contact details, and three unchecked acknowledgements.
7. The user must separately acknowledge that both documents were read, AI output requires human verification, and use will remain lawful with required AI labels intact.
8. The Host uploads the acceptance through the authenticated enterprise identity adapter. Only a server receipt unlocks the local workspace. Browser storage or a local-only flag can never satisfy the gate.
9. A new material agreement version repeats the gate. An unchanged version reuses the authoritative server receipt.

The browser-to-CLI seam uses the pinned Harness `Connection` generic RPC channel `/emate.identity`. It does not add a WebSocket, SSE loop, REST facade, or parallel event store.

## Archive record

The enterprise server is authoritative and assigns the acceptance timestamp. The record contains:

- tenant and account identifiers derived from the authenticated lease;
- provider legal name and agreement IDs, versions, document SHA-256 values, and aggregate bundle SHA-256;
- the three acknowledgement IDs and their explicit `true` values;
- e-Mate version, managed instance ID, server-generated receipt ID, idempotency key, and server time;
- the policy version that required the acceptance.

It must not contain the password, access/refresh tokens, model credentials, conversation text, attachment content, or local file paths. The local receipt stores only the server receipt ID, agreement versions/hashes, and server time.

## Fail-closed rules

- Missing provider legal name/contact information, authentication, an agreement document, a hash mismatch, an unchecked acknowledgement, or an enterprise receipt blocks first use.
- Expired/reused verification challenges, duplicate accounts, an unapproved/disabled/deleted status, a zero/missing weekly Token allowance, or a missing model policy block login. Registration errors never create a partial active account.
- A network or enterprise-server failure may be retried with the same idempotency key; it must not manufacture local acceptance.
- Existing users with a server-verifiable receipt for every required version are not prompted again.
- The enterprise identity surface may gate access, but it cannot enable/disable plugins, approve tools, delete sessions, control Jobs, or execute local actions.

## Production blockers

The current repository has no verified provider legal name, unified social credit code, privacy/contact address, or deployed agreement-archive endpoint. The pinned 2.0.5 enterprise source already has administrator list/create/update, password and usage-limit primitives, but it does not yet implement public captcha registration, `pending_approval`, approval-with-weekly-allowance, or explicit soft deletion. Production acceptance remains blocked until those facts and server additions, retention policy, authenticated read/write API, administrator projection, and deletion/correction procedure pass acceptance.
