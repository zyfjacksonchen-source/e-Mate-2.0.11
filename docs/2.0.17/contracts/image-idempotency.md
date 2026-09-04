# Image invocation idempotency

## Owner and identity

The existing model-gateway `UsageStore` admission journal is the sole idempotency owner for `POST /v1/images/generations` and `POST /v1/images/edits`. Production persists it in `PostgresUsageStore`; the durable invocation schema is `e_mate_model_invocation`, keyed by `invocation_id`, with one partial-unique `PREPARED` row for `(tenant_id, user_id, task_id)`. No image-specific journal, image batch endpoint, or byte store exists.

The client supplies `session_id`, an identical `x-client-request-id`, `x-e-mate-task-id`, and `x-e-mate-trace-id` with its authenticated tenant/user identity. The task journal scope is tenant, user, task, trace, model, and provider. Image callers do not supply the durable provider key: after admission the gateway sends the journal's `invocation_id` upstream as `Idempotency-Key`.

`request_digest` is SHA-256 base64url over the canonical upstream single-image request. Generation includes the mapped upstream model, prompt, optional size, `n: 1`, and `response_format: b64_json`. Edit includes mapped model, prompt, operation marker, and each ordered image's media type, length, and byte digest. Reusing the same tenant/user/task identity with a different request digest returns HTTP 409 `INVOCATION_REQUEST_CONFLICT` before another provider POST.

## States and responses

- `PREPARED`: admission succeeded before the provider POST. A simultaneous or later exact retry returns HTTP 409 `INVOCATION_RECONCILIATION_REQUIRED` and performs no second POST.
- `COMPLETED`: exactly one valid image and valid usage were parsed and recorded. A retry returns HTTP 409 `INVOCATION_RESULT_ALREADY_RECORDED`; the gateway cannot replay the image.
- `REJECTED`: the provider definitely did not accept the request (HTTP 400, 401, 403, 404, 413, 415, 422, or 429). The same canonical request may be admitted again using the same durable `invocation_id`; every provider request still fixes `n=1`.

Network errors and timeouts return `UPSTREAM_UNAVAILABLE`/`UPSTREAM_TIMEOUT`. Provider 5xx, non-JSON success, malformed JSON, a success containing zero or multiple images, invalid base64, or invalid usage returns a gateway 502/503-class failure as applicable. These ambiguous outcomes remain `PREPARED`; retry is reconciliation-required and cannot issue another POST. Distinct task IDs, including separate local batch-item task IDs, have isolated journal identities and each submit one image through the ordinary endpoint. There is no `/images/batch` and `n>1` is rejected.

## Unresolved receipt gap

The gateway stores invocation and usage facts only. It stores neither generated image bytes nor an image receipt, so restart safety can prevent duplicate submission but cannot reacquire or replay a successful image response. Receipt reacquisition remains unresolved outside this contract.
