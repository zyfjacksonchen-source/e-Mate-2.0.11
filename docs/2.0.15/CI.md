# e-Mate 2.0.15 CI / build / release fast lanes

## Truth boundary

- Checked-in source remains `2.0.14`; T01 does not create a `2.0.15` candidate.
- Public production remains exact `2.0.13`. The refreshed desired-state snapshot records the three public `2.0.13` envelopes on Base v7; it is an input receipt, not a publication claim.
- A successful PR, RC source job, app-directory smoke, or unsigned Desktop artifact is not a released fact. Exact-byte admission, fresh install, update, rollback, Feed/public download and public readback remain formal RC/T18 receipts.
- T01 ran no installer build, signing, R2 write, Feed write, public activation, or installed-machine acceptance.

## Observed baseline

Read-only GitHub Actions observations were captured at `2026-08-27T08:24:51.942Z` from the latest 20 completed `CI` runs then available. The values are descriptive, not a new gate.

| Scope | Samples | p50 seconds | p95 seconds | Min–max seconds |
| --- | ---: | ---: | ---: | ---: |
| Whole completed workflow | 20 | 625 | 1706 | 22–1917 |
| Node 24 source | 16 | 274 | 391 | 253–391 |
| Base compatibility / darwin-x64 | 14 | 192 | 331 | — |
| Base compatibility / darwin-arm64 | 14 | 114 | 204 | — |
| Base compatibility / win32-x64 | 14 | 154 | 173 | — |
| Windows installer/app job | 12 | 371 | 511 | 297–511 |
| macOS disk-image/app job | 12 | 339 | 1600 | 179–1600 |
| Enterprise | 12 | 40 | 45 | — |
| Classifier | 20 | 15 | 19 | — |
| Admission | 20 | 3 | 5 | — |

Short failed/skipped workflows are included only in the whole-workflow row; job rows include positive, non-skipped executions. The ordinary narrow PR target is at most 10 minutes, and summaries now expose elapsed seconds plus relevant cache hits so an overrun has evidence rather than a guessed cause.

## One classifier, three lanes

`scripts/change-impact.mjs` is the only path classifier. It emits schema-v2 `emate.ci-plan` as `ci-plan.json`; workflows consume its lane, component matrix and platform flags instead of copying path rules.

| Lane | Trigger and work | Explicitly absent |
| --- | --- | --- |
| PR Fast | docs: classifier only; component: exact Base SDK + affected component; Shell: adds macOS/Windows app-directory smoke; Base/UI: source contracts, accepted component closure, affected platform/app-directory checks; Enterprise: isolated contracts | DMG/NSIS, R2, three-target full Profile composition, performance proof |
| Release Candidate | protected-main Base or publishable Profile change; build Base/portable components once, target-native components once, compose three candidates, produce formal unsigned Desktop bytes when Base is involved, then CI admission | publication-stage rebuild, performance as a mandatory gate |
| Audit | manual/weekly full contracts, Enterprise, licenses, and optional non-blocking runtime parity | PR/release dependency, candidate creation, publication |

Important plan fields are `ci_mode`, `run_base`, `run_components`, `compose_profile`, `profile_bootstrap`, the exact component job arrays, platform app-smoke/distribution flags, and the validated Base contract receipt.

## Build once and exact consumption

1. A Base RC source job builds the Harness/component closure once, emits the immutable Base SDK, reuses the already-built portable components as component payloads, and exports the Desktop Profile carrier.
2. Only target-native component jobs remain in the Base RC matrix. A plugin PR/RC restores the immutable Base SDK; a cache miss has one recoverable seed job rather than a permanent per-component failure.
3. Profile composition downloads that same-run Base SDK and component payloads. PR component work does not compose three complete targets.
4. `profile-release.yml` contains validation and signing/bundle preparation only. It downloads the accepted `ci-plan.json`, component artifacts and all three candidate artifacts from the exact CI run; it has no Harness, component, Profile, app or installer build job.
5. The coordinator reads `profile_bootstrap` from the accepted plan instead of hard-coding Bootstrap. The refreshed public Base-v7 snapshot therefore selects a normal successor generation for the current `2.0.14` source.
6. Shell app-directory smoke materializes only the exact emitted Shell payload over the accepted Base SDK image and calls the native directory packager without rebuilding Harness.

## Cache identities and summaries

- Base SDK: `base-sdk.mjs fingerprint`, derived only from tracked inputs classified as Base. Actions cache is acceleration only; every consumer uses a same-run uploaded artifact and verifies its manifest.
- Component payloads: exact source commit, Base contract, component id, target and file digests.
- pnpm/Yarn/Electron: exact lock/config/tool input hashes already owned by the workflow.
- Python runtime and Vision wheelhouse: target plus the scripts containing the fixed release URLs, byte lengths and SHA-256 identities.
- Job summaries report seconds and Base SDK/Python/Vision cache state where applicable.

## Root scripts

- `pnpm test:fast`: narrow source/classifier regression for ordinary development.
- `pnpm check:affected -- --base <sha> --head <sha>`: emit the executable plan.
- `pnpm smoke:app-dir`: native app-directory smoke for an already prepared closure.
- `pnpm verify:rc`: full RC source/component/release verification without publication.
- `pnpm audit:full`: long full-contract audit; performance remains separate/optional.

## Formal hard gates remain closed

This change moves cost; it does not delete release truth. Exact Desktop artifact digests/bytes, exact Profile desired-state bytes, fresh install, predecessor update, failed-health rollback, data retention, signing, Feed/download activation and public readback remain in the existing release/admission/publication owners and final T18 acceptance. A cache hit, source test, candidate file, or prepared publication bundle cannot satisfy those receipts.

## T04 handoff

The T01 tests project the integrated T04 inventory as exactly 15 total/accepted components, zero blocked components and 19 target jobs. A retirement diff containing the removed xin root plus inventory/packaged-closure inputs is Base-only (`run_base=true`, no plugin publication); a later unknown path below the deleted root also fails closed to Base without reading the deleted package manifest. The validator deliberately still reports the stale `@deepseek-ai/dsh-launch-environment` Base-v7 ABI union mismatch after that projection. T18 owns that contract correction; T01 adds no bypass.
