import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { evaluateEvidence } from './performance-parity.mjs'

const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value)
const sha256 = value => createHash('sha256').update(value).digest('hex')

const sample = (index, overrides = {}) => ({
  pair_id: `pair-${String(index).padStart(2, '0')}`,
  ttft_ms: 100,
  output_tokens_per_second: 100,
  tool_call_to_start_ms: 20,
  tool_result_to_next_request_ms: 20,
  duplicate_event_count: 0,
  ...overrides,
})

function evidence(candidateOverrides = {}, count = 30) {
  const baseline = Array.from({ length: count }, (_, index) => sample(index + 1))
  const candidate = Array.from({ length: count }, (_, index) => sample(index + 1, candidateOverrides))
  return {
    schema_version: 1,
    evidence_kind: 'keyless-target-loop-collector-fixture',
    harness_commit: 'df78045a127e32cb5b942defba52c539590d1596',
    paths: {
      baseline: { samples: baseline },
      emate_online: { samples: candidate },
      emate_enterprise_unavailable_valid_cache: {
        enterprise_state: {
          endpoint: 'unavailable', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox',
        },
        samples: candidate,
      },
    },
  }
}

test('accepts 30 paired samples and keeps keyless evidence production-blocked', () => {
  assert.equal(evaluateEvidence(evidence({ ttft_ms: 150, output_tokens_per_second: 95, tool_call_to_start_ms: 22, tool_result_to_next_request_ms: 22 })).gate_status, 'fixture-passed-production-blocked')
  const relabelled = evidence()
  relabelled.evidence_kind = 'production-real-provider'
  assert.equal(evaluateEvidence(relabelled).gate_status, 'fixture-passed-production-blocked')
  assert.deepEqual(evaluateEvidence(relabelled).production_receipt_failures, ['PRODUCTION_RUN_RECEIPT_INCOMPLETE'])

  for (const path of Object.values(relabelled.paths)) {
    const body = {
      harness_commit: relabelled.harness_commit,
      provider: 'provider', model: 'model', tool: 'tool', dataset_sha256: 'a'.repeat(64),
      sample_ids_sha256: sha256(canonical(path.samples.map(item => item.pair_id))),
      raw_samples_sha256: sha256(canonical(path.samples)),
      raw_samples_artifact: { kind: 'raw-samples', path: 'raw.json', sha256: 'b'.repeat(64) },
      provider_receipt_artifact: { kind: 'trace', path: 'trace.json', sha256: 'c'.repeat(64) },
      environment: {
        machine_id_sha256: 'd'.repeat(64), os: 'macOS', arch: 'arm64', node: '24.19.0', browser: '149', network_profile: 'fixed',
      },
      started_at: '2026-08-15T00:00:00.000Z',
      finished_at: '2026-08-15T00:01:00.000Z',
    }
    path.run_receipt = { ...body, receipt_sha256: sha256(canonical(body)) }
  }
  relabelled.production_artifacts_verified = true
  assert.equal(evaluateEvidence(relabelled).gate_status, 'fixture-passed-production-blocked')
  assert.equal(evaluateEvidence(relabelled).production_blocker, 'PRODUCTION_ARTIFACTS_NOT_VERIFIED')
})

test('fails closed on missing samples, duplicate events, latency, throughput, or offline lease metadata', () => {
  assert.equal(evaluateEvidence(evidence({}, 29)).gate_status, 'failed')
  assert.equal(evaluateEvidence(evidence({ duplicate_event_count: 1 })).gate_status, 'failed')
  assert.equal(evaluateEvidence(evidence({ ttft_ms: 151 })).gate_status, 'failed')
  assert.equal(evaluateEvidence(evidence({ output_tokens_per_second: 89 })).gate_status, 'failed')
  assert.equal(evaluateEvidence(evidence({ tool_call_to_start_ms: 23 })).gate_status, 'failed')
  const invalidOffline = evidence()
  invalidOffline.paths.emate_enterprise_unavailable_valid_cache.enterprise_state.lease = 'expired'
  assert.equal(evaluateEvidence(invalidOffline).gate_status, 'failed')
})
