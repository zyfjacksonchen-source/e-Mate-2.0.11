# Image batch observability (EM217-204)

## Proven owners reused

- EM217-103 already owns deterministic `batch_id` and ordered child `task_id` values in `image-batch.ts`, durable parent/child Session events in `native-image-task-runner.ts`, Tool Search visibility plus Chinese aliases, and canonical `ASSET_PRODUCTION` audit classification. EM217-204 does not create another registry, queue, metric store, or audit protocol.
- EM217-202 already owns bounded retry of typed pre-provider 429 admission responses. Every attempt retains one `client_request_id`/`trace_id`/`task_id` and one POST per admitted image invocation.
- The gateway usage journal remains the admission and exactly-once invocation owner. Observations do not mutate or replace it.

## Demonstrated gaps closed

Batch children now add the model-hidden headers `x-e-mate-batch-id` and `x-e-mate-batch-ordinal` to their existing image request scope. The gateway accepts them only as a pair, validates their shapes, and requires the existing task, trace, session, and client-request identities to agree before admission or provider submission. Direct `imagegen` does not add these headers and performs no new batch lookup or child scan.

The gateway emits asynchronous structured `image_observation` records to its existing process log. Records contain identifiers and bounded timing/outcome facts only:

- `admission_decision`: duration of the existing usage-journal `prepare` decision; failures distinguish `rate_limited` from other preflight failures.
- `provider_submit`: the point immediately before the single provider POST.
- `provider_outcome`: provider latency and the outcome known at the gateway. A definite 4xx rejection is `provider_rejected`; an ambiguous network, timeout, 5xx, or invalid-success response is never called rejected.
- `client_response`: the gateway response handoff, not UI visibility.

Elapsed and stage durations use the monotonic `performance.now()` clock; `occurred_at` is captured separately from the wall clock. Invalid, backwards, non-finite, or over-bound timing is rejected inside the queued/caught observation path rather than coerced. Logging is scheduled with `queueMicrotask`: this defers log construction and handling and avoids any awaited network or flush, but does not claim zero CPU cost. Construction or logger failure cannot change product behavior.

## Fixed failure taxonomy

`preflight`, `rate_limited`, `provider_rejected`, `provider_timeout_before_accept`, `provider_outcome_unknown`, `attachment_commit`, `projection`, `cancelled`.

`provider_timeout_before_accept` is used only when the transport proves non-acceptance. Otherwise timeout maps conservatively to `provider_outcome_unknown`. Profile attachment or persistence failures map at their existing owners; full Error messages are not observation fields.

## Profile-derived boundaries

No Session, Job, Attachment CAS, or projection schema changed. For a batch child:

1. the gateway `provider_outcome` is the provider completion boundary;
2. a completed, recorded terminal `emate/image-output` with one strictly validated output/content attachment emits `attachment_commit`; its 64-hex batch `client_request_id` deterministically yields `task_id`, while `batch_id` and `ordinal` stay omitted until the parent join; pre-Job and no-output failures emit no attachment stage;
3. the existing parent `emate/image-batch` task-state append occurs only after the child Session flush and receipt validation, so its Session event time emits `parent_projection_append`, joined with `batch_id` and `ordinal`.

These owner timestamps can locate whether a three-minute or eight-and-a-half-minute delay sits in admission, provider execution, attachment commit, or durable parent projection without persisting image bytes or another metric record.

## Data minimization and open evidence

Allowed correlation fields are `trace_id`, `client_request_id`, `task_id`, and, for batch children only, `batch_id` plus `ordinal`. Observations never include prompts, raw images/base64, nonce values, secrets, provider Error messages, or local paths.

A parent projection append is **not** `projection_visible`. Actual client-visible delivery and first paint remain **OPEN** for EM217-301/EM217-108; gateway `client_response` and Session append timestamps cannot claim that UI boundary.
