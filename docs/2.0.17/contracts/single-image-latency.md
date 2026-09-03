# EM217-108 single-image latency contract

## Status and scope

This contract is planning-only until EM217-107 and EM217-202 are complete. All performance evidence remains **OPEN**. It changes no production, candidate, installed, or public-production gate and authorizes no provider call, package installation, build, product flag, product sleep, or benchmark implementation by itself.

Pinned Harness rc.7 at `4da69d7c3522ee51de12822c917c503a124f7a7d` has no native image-generation Tool. The comparison therefore must not claim native image-generation parity. Its control is the pinned-owner lower bound defined below.

## Comparator and invariants

Each comparison uses the same prompt SHA-256, exact request body, response bytes, model, limits, Node process, and local filesystem. Prompt text and image/base64 bytes never enter tracked evidence.

The lower-bound arm is one in-process fake provider response delayed exactly 25 ms followed by one real pinned rc.7 `LocalAttachmentStore.saveImage`. The assembled arm is the direct e-Mate `imagegen` path through the pinned Tool, Job, Session receipt, and projection owners. The fake provider uses no socket, DNS, TLS, credential, or other network access. Delay exists only in test code; product code gains no benchmark mode, delay, or flag.

A successful direct one-image call must bypass `image_batch`: zero subagents, zero `emate/image-batch` events, exactly one native Job, one provider POST, one Attachment CAS save, and one terminal `emate/image-output` receipt. The ordinary success scenario performs zero retry and zero admission wait. EM217-202 remains unchanged: only a typed pre-provider tenant rate/concurrency 429 may retry within its existing attempt/deadline bounds, and its latency is reported separately from success percentiles.

The next LLM turn and provider network variance are outside this local overhead measurement. Tool return and first-visible handoff are separate measurements.

## Scenarios and sampling

Each fresh benchmark process runs deterministic interleaved ABBA pairs. Warm small and warm max-size scenarios use 20 untimed warmups followed by 60 paired samples. Cold small and cold max-size scenarios use 15 paired samples with a fresh Context, Agent, Session, and CAS root for every pair. The history-growth scenario uses 30 paired small-output samples at zero versus 256 prior terminal image receipts. Run three fresh processes and require every repetition to pass. Compute nearest-rank p95 and p99 independently for each repetition; never pool repetitions to hide a failing run.

The max-size fixture is a deterministic valid supported image at least 99% of the configured single-image byte limit. Fixture creation and module loading occur before measurement. Record exact fixture bytes and SHA-256 in sanitized metadata, but store raw bytes only in the external evidence artifact.

Record provider submit/finish, response completion, CAS begin/end, optional post-save verification, Job terminal settlement, terminal receipt append, Tool return, terminal projection handoff, GUI attachment load completion, and first paint. Missing timing or count data invalidates the repetition rather than being dropped.

## Bounds

For percentile `q`, the assembled path passes only when:

`assembled_q <= lower_bound_q + max(absolute_relaxation_q, relative_relaxation_q * lower_bound_q)`.

| Scenario | p95 relaxation | p99 relaxation |
|---|---:|---:|
| Warm small | `max(75 ms, 15%)` | `max(150 ms, 25%)` |
| Warm max-size | `max(250 ms, 15%)` | `max(500 ms, 25%)` |
| Cold small | `max(350 ms, 25%)` | `max(750 ms, 50%)` |
| Cold max-size | `max(750 ms, 25%)` | `max(1500 ms, 50%)` |

The zero-to-256-receipt history slope must be no more than 75 ms p95 and 150 ms p99. The separate macOS app-directory/dev GUI acceptance measures cached-local-byte terminal-projection-to-first-visible handoff and requires p95 no greater than 500 ms. It is not packaged, installed, or production evidence.

## Change rule

Only a stage proven by this benchmark to fail its bound may change `packages/dsh/src/profile/image-generation.ts`. Any later change preserves Tool validation and ownership checks, canonical base64 validation, raster byte/pixel/media validation, CAS fsync/hash/private permissions, native Job terminal ordering, receipt and projection ownership, and EM217-202 retry semantics. It must not introduce a second store, scheduler, transport, receipt, or image-byte owner. If every scenario is already green, later implementation is limited to tests and sanitized evidence.

## Evidence

The tracked evidence manifest contains only sanitized provenance, exact e-Mate and Harness commits, benchmarked module hashes, runtime/platform metadata, scenario definitions, prompt/request/fixture hashes and byte counts, sample counts, nearest-rank percentiles, stage totals, operation counts, threshold evaluation, and the external raw artifact URI plus SHA-256. It contains no prompt text, image or base64 bytes, logs, secrets, credentials, screenshots, videos, or installers.

Evidence fails closed and remains **OPEN** when provenance, a required field, stage timestamp, sample, repetition, request hash, fixture hash, operation count, external artifact hash, or threshold is missing or mismatched. A fixture, historical receipt, narrative approval, another platform, or a real-provider sample cannot substitute for this deterministic gate.

## Rollback

If a later measured product change regresses correctness or latency, revert only that change and its expectations. Existing receipts and Attachment CAS objects remain valid. Restore the conservative direct `imagegen` path, leave `image_batch` and EM217-202 unchanged, and return the EM217-108 evidence gate to **OPEN**.
