import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { evaluateEvidence, exitCodeForGateStatus } from './performance-parity.mjs'

const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value)
const sha256 = value => createHash('sha256').update(value).digest('hex')

const sample = (index, overrides = {}) => ({
  pair_id: `pair-${String(index).padStart(2, '0')}`,
  scenario: index <= 10 ? 'short-text' : index <= 20 ? 'history-20' : 'read-only-tool',
  arm_order: index % 2 === 0 ? 'AB' : 'BA',
  submit_to_first_visible_text_ms: 100,
  user_message_to_first_text_delta_ms: 100,
  first_chunk_to_paint_ms: 10,
  local_pre_provider_ms: 10,
  output_tokens_per_second: 100,
  tool_call_to_start_ms: 20,
  tool_result_to_next_request_ms: 20,
  queue_wait_ms: 0,
  request_header_sha256: '0'.repeat(64),
  request_header_bytes: 100,
  request_tool_count: 1,
  duplicate_model_request_count: 0,
  duplicate_tool_execution_count: 0,
  duplicate_job_execution_count: 0,
  duplicate_deliverable_count: 0,
  ...overrides,
})

function evidence(candidateOverrides = {}, count = 30) {
  const baseline = Array.from({ length: count }, (_, index) => sample(index + 1))
  const candidate = Array.from({ length: count }, (_, index) => sample(index + 1, candidateOverrides))
  return {
    schema_version: 2,
    comparison_kind: 'installed-2.0.12-vs-2.0.13',
    performance_run_id: 'performance-run-test-v2',
    evidence_kind: 'keyless-target-loop-collector-fixture',
    harness_commit: 'e13ce9d953037a2f40d866d17f5a7e00cbc15d66',
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
  assert.equal(evaluateEvidence(evidence({
    submit_to_first_visible_text_ms: 150,
    user_message_to_first_text_delta_ms: 150,
    output_tokens_per_second: 97,
    tool_call_to_start_ms: 21,
    tool_result_to_next_request_ms: 21,
  })).gate_status, 'fixture-passed-production-blocked')
  const relabelled = evidence()
  relabelled.evidence_kind = 'production-real-provider'
  assert.equal(evaluateEvidence(relabelled).gate_status, 'fixture-passed-production-blocked')
  assert.deepEqual(evaluateEvidence(relabelled).production_receipt_failures, ['PRODUCTION_RUN_RECEIPT_INCOMPLETE'])

  for (const [pathName, path] of Object.entries(relabelled.paths)) {
    const candidate = pathName !== 'baseline'
    const body = {
      performance_run_id: relabelled.performance_run_id,
      harness_commit: relabelled.harness_commit,
      provider: 'provider', model: 'model', reasoning_level: 'medium', tool: 'tool', dataset_sha256: 'a'.repeat(64),
      acceptance_identity_sha256: '9'.repeat(64),
      sample_ids_sha256: sha256(canonical(path.samples.map(item => item.pair_id))),
      raw_samples_sha256: sha256(canonical(path.samples)),
      raw_samples_artifact: { kind: 'raw-samples', path: 'raw.json', sha256: 'b'.repeat(64) },
      provider_receipt_artifact: { kind: 'trace', path: 'trace.json', sha256: 'c'.repeat(64) },
      request_header_artifact: { kind: 'request-headers', path: 'headers.json', sha256: 'a'.repeat(64) },
      renderer_paint_artifact: { kind: 'renderer-paint-trace', path: 'paint.json', sha256: 'b'.repeat(64) },
      environment: {
        machine_id_sha256: 'd'.repeat(64), os: 'macOS', arch: 'arm64', node: '24.19.0', browser: '149', network_profile: 'fixed',
      },
      runtime: {
        product: 'e-mate-desktop',
        product_version: candidate ? '2.0.13' : '2.0.12',
        source_commit: candidate ? 'e'.repeat(40) : '4'.repeat(40),
        desktop_reference_commit: '6074088f5b660206e404b3591fab51fb99c69add',
        base_contract_id: candidate ? 'e-mate-desktop-profile-v6-dsh-2bc16230975f' : 'dsh-desktop-rc7',
        profile_generation: candidate ? 'candidate-generation' : 'baseline-generation',
        composition_sha256: candidate ? 'f'.repeat(64) : '1'.repeat(64),
        client_bundle_sha256: candidate ? '2'.repeat(64) : '3'.repeat(64),
        desktop_artifact_sha256: candidate ? '6'.repeat(64) : '7'.repeat(64),
        desktop_artifact_bytes: candidate ? 200 : 100,
      },
      started_at: '2026-08-15T00:00:00.000Z',
      finished_at: '2026-08-15T00:01:00.000Z',
    }
    if (candidate) {
      body.enterprise_receipt = {
        lease_sha256: '4'.repeat(64),
        model_policy_sha256: '5'.repeat(64),
        audit_outbox_sha256: pathName === 'emate_online' ? '6'.repeat(64) : '7'.repeat(64),
      }
      body.enterprise_receipt_artifact = {
        kind: 'enterprise-runtime-receipt', path: `${pathName}-enterprise.json`, sha256: '8'.repeat(64),
      }
    }
    path.run_receipt = { ...body, receipt_sha256: sha256(canonical(body)) }
  }
  relabelled.production_artifacts_verified = true
  assert.equal(evaluateEvidence(relabelled).gate_status, 'fixture-passed-production-blocked')
  assert.equal(evaluateEvidence(relabelled).production_blocker, 'PRODUCTION_ARTIFACTS_NOT_VERIFIED')

  const sameRuntime = structuredClone(relabelled)
  const forged = sameRuntime.paths.emate_online.run_receipt
  forged.runtime = sameRuntime.paths.baseline.run_receipt.runtime
  const forgedBody = { ...forged }
  delete forgedBody.receipt_sha256
  forged.receipt_sha256 = sha256(canonical(forgedBody))
  assert.ok(evaluateEvidence(sameRuntime).production_receipt_failures.includes('PRODUCTION_CANDIDATE_RUNTIME_MISMATCH'))
})

test('uses the slow throughput tail rather than the fastest tail', () => {
  const observed = evidence()
  for (const path of [observed.paths.emate_online, observed.paths.emate_enterprise_unavailable_valid_cache]) {
    path.samples.slice(0, 14).forEach(item => { item.output_tokens_per_second = 1 })
  }
  const result = evaluateEvidence(observed)
  assert.equal(result.gate_status, 'failed')
  assert.ok(result.failures.some(failure => failure.includes('p5 throughput')))
})

test('only verified production evidence may return a successful process status', () => {
  assert.equal(exitCodeForGateStatus('passed'), 0)
  assert.equal(exitCodeForGateStatus('fixture-passed-production-blocked'), 1)
  assert.equal(exitCodeForGateStatus('failed'), 1)
})

test('fails closed on missing samples, duplicate events, latency, throughput, or offline lease metadata', () => {
  assert.equal(evaluateEvidence(evidence({}, 29)).gate_status, 'failed')
  assert.equal(evaluateEvidence(evidence({ duplicate_tool_execution_count: 1 })).gate_status, 'failed')
  assert.equal(evaluateEvidence(evidence({ submit_to_first_visible_text_ms: 201 })).gate_status, 'failed')
  assert.equal(evaluateEvidence(evidence({ output_tokens_per_second: 94 })).gate_status, 'failed')
  assert.equal(evaluateEvidence(evidence({ tool_call_to_start_ms: 22 })).gate_status, 'failed')
  const invalidOffline = evidence()
  invalidOffline.paths.emate_enterprise_unavailable_valid_cache.enterprise_state.lease = 'expired'
  assert.equal(evaluateEvidence(invalidOffline).gate_status, 'failed')
})
