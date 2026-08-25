import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assembleProductionEvidence,
  evaluateEvidence,
  exitCodeForGateStatus,
  verifyProductionArtifacts,
} from './performance-parity.mjs'

const canonical = value => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value)
const sha256 = value => createHash('sha256').update(value).digest('hex')

const diagnostic = () => ({
  local_pre_provider_ms: 10,
  submit_to_host_ms: 1,
  turn_to_request_header_ms: 9,
  policy_ms: 2,
  quota_ms: 2,
  prepare_ms: 2,
  adapter_to_first_chunk_ms: 90,
})

const sample = (index, overrides = {}, candidate = false) => {
  const scenario = index <= 10 ? 'short-text' : index <= 20 ? 'history-20' : 'read-only-tool'
  const attempts = scenario === 'read-only-tool' ? 2 : 1
  return {
    pair_id: `pair-${String(index).padStart(2, '0')}`,
    scenario,
    arm_order: index % 2 === 0 ? 'AB' : 'BA',
    path_execution_ordinal: index,
    session_id_sha256: sha256(`session-${String(index)}`),
    turn: scenario === 'history-20' ? 21 : 1,
    step: scenario === 'read-only-tool' ? 2 : 1,
    submit_to_first_visible_text_ms: 100,
    user_message_to_first_text_delta_ms: 100,
    first_chunk_to_paint_ms: 10,
    output_tokens_per_second: 100,
    ...(scenario === 'read-only-tool' ? {
      tool_result_to_next_request_ms: 20,
    } : {}),
    queue_wait_ms: 0,
    requests: Array.from({ length: attempts }, (_, attempt) => ({
      ordinal: attempt + 1,
      request_id_sha256: sha256(`request-${String(index)}-${String(attempt + 1)}`),
      request_header_sha256: sha256(`header-${String(index)}-${String(attempt + 1)}`),
      request_header_bytes: 100,
      request_tool_count: 1,
      ...(candidate ? { diagnostic: null } : {}),
    })),
    provider_attempts: Array.from({ length: attempts }, (_, attempt) => ({
      ordinal: attempt + 1,
      request_id_sha256: sha256(`request-${String(index)}-${String(attempt + 1)}`),
      provider_invocation_id_sha256: sha256(`invocation-${String(index)}-${String(attempt + 1)}`),
      provider_response_id_sha256: sha256(`response-${String(index)}-${String(attempt + 1)}`),
      provider_usage_sha256: sha256(`usage-${String(index)}-${String(attempt + 1)}`),
      input_tokens: 10,
      output_tokens: 10,
    })),
    duplicate_model_request_count: 0,
    duplicate_tool_execution_count: 0,
    duplicate_job_execution_count: 0,
    duplicate_deliverable_count: 0,
    ...overrides,
  }
}

function evidence(candidateOverrides = {}, count = 30) {
  const baseline = Array.from({ length: count }, (_, index) => sample(index + 1))
  const candidate = Array.from({ length: count }, (_, index) => sample(index + 1, candidateOverrides, true))
  return {
    schema_version: 2,
    comparison_kind: 'installed-2.0.12-vs-2.0.13',
    performance_run_id: 'performance-run-test-v2',
    evidence_kind: 'keyless-target-loop-collector-fixture',
    harness_commit: 'b2b1650b01f0ee88d81837a9b5c050f9f763f606',
    baseline_harness_commit: 'fixture-only',
    performance_model: {
      route_id: 'fixture-route', provider: 'provider', model: 'model', reasoning_effort: 'medium',
    },
    paths: {
      baseline: { samples: baseline },
      emate_online: { samples: candidate },
      emate_enterprise_unavailable_valid_cache: {
        enterprise_state: {
          endpoint: 'unavailable', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox',
        },
        samples: structuredClone(candidate),
      },
    },
  }
}

test('accepts 30 paired samples and keeps keyless evidence production-blocked', () => {
  assert.equal(evaluateEvidence(evidence({
    submit_to_first_visible_text_ms: 150,
    user_message_to_first_text_delta_ms: 150,
    output_tokens_per_second: 97,
  })).gate_status, 'fixture-passed-production-blocked')
  const relabelled = evidence()
  relabelled.evidence_kind = 'production-real-provider'
  relabelled.baseline_harness_commit = '2bc16230975f6cf02aa1b283b1f86de44007b059'
  assert.equal(evaluateEvidence(relabelled).gate_status, 'fixture-passed-production-blocked')
  assert.deepEqual(evaluateEvidence(relabelled).production_receipt_failures, ['PRODUCTION_RUN_RECEIPT_INCOMPLETE'])

  for (const [pathName, path] of Object.entries(relabelled.paths)) {
    const candidate = pathName !== 'baseline'
    const body = {
      performance_run_id: relabelled.performance_run_id,
      harness_commit: candidate
        ? 'b2b1650b01f0ee88d81837a9b5c050f9f763f606'
        : '2bc16230975f6cf02aa1b283b1f86de44007b059',
      provider: 'provider', model: 'model', reasoning_level: 'medium', tool: 'tool', dataset_sha256: 'a'.repeat(64),
      acceptance_identity_sha256: '9'.repeat(64),
      sample_ids_sha256: sha256(canonical(path.samples.map(item => item.pair_id))),
      raw_samples_sha256: sha256(canonical(path.samples)),
      raw_samples_artifact: { kind: 'raw-samples', path: 'raw.json', sha256: 'b'.repeat(64) },
      native_trace_artifact: { kind: 'native-session-trace', path: 'native.json', sha256: 'd'.repeat(64) },
      provider_receipt_artifact: { kind: 'provider-invocation-receipt', path: 'trace.json', sha256: 'c'.repeat(64) },
      request_header_artifact: { kind: 'request-headers', path: 'headers.json', sha256: 'a'.repeat(64) },
      renderer_paint_artifact: { kind: 'renderer-paint-trace', path: 'paint.json', sha256: 'b'.repeat(64) },
      installed_runtime_artifact: { kind: 'installed-runtime-receipt', path: 'installed.json', sha256: 'e'.repeat(64) },
      environment: {
        machine_id_sha256: 'd'.repeat(64), os: 'macOS', arch: 'arm64', node: '24.19.0', browser: '149', network_profile: 'fixed',
      },
      runtime: {
        product: 'e-mate-desktop',
        product_version: candidate ? '2.0.13' : '2.0.12',
        source_commit: candidate ? 'e'.repeat(40) : '4'.repeat(40),
        desktop_reference_commit: '6074088f5b660206e404b3591fab51fb99c69add',
        base_contract_id: candidate ? 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0' : 'dsh-desktop-rc7',
        profile_generation: candidate ? 'candidate-generation' : 'baseline-generation',
        composition_sha256: candidate ? 'f'.repeat(64) : '1'.repeat(64),
        client_bundle_sha256: candidate ? '2'.repeat(64) : '3'.repeat(64),
        desktop_artifact_sha256: candidate ? '6'.repeat(64) : '7'.repeat(64),
        desktop_artifact_bytes: candidate ? 200 : 100,
      },
      install_receipt: {
        installation_kind: 'installed-application', target: 'darwin-arm64', bundle_id: 'com.emate.desktop',
        package_sha256: candidate ? '6'.repeat(64) : '7'.repeat(64), package_bytes: candidate ? 200 : 100,
        installed_executable_sha256: candidate ? '8'.repeat(64) : '9'.repeat(64), installed_executable_bytes: 50,
        installed_at: '2026-08-14T23:59:00.000Z', launched_at: '2026-08-15T00:00:00.000Z',
      },
      started_at: '2026-08-15T00:00:00.000Z',
      finished_at: '2026-08-15T00:01:00.000Z',
    }
    if (candidate) {
      body.enterprise_receipt = {
        endpoint: pathName === 'emate_online' ? 'available' : 'unavailable',
        inference_gateway: 'available',
        lease_sha256: '4'.repeat(64),
        model_policy_sha256: '5'.repeat(64),
        audit_outbox_sha256: pathName === 'emate_online' ? '6'.repeat(64) : '7'.repeat(64),
        lease_refreshed_at: '2026-08-14T23:00:00.000Z',
        policy_refreshed_at: '2026-08-14T23:00:00.000Z',
        lease_expires_at: '2026-08-15T02:00:00.000Z',
        policy_expires_at: '2026-08-15T02:00:00.000Z',
        finished_at: '2026-08-15T00:01:00.000Z',
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

  const missingBaselineHarness = structuredClone(relabelled)
  delete missingBaselineHarness.baseline_harness_commit
  assert.equal(evaluateEvidence(missingBaselineHarness).gate_status, 'failed')

  const wrongBaselineHarness = structuredClone(relabelled)
  wrongBaselineHarness.baseline_harness_commit = wrongBaselineHarness.harness_commit
  assert.equal(evaluateEvidence(wrongBaselineHarness).gate_status, 'failed')

  const sameRuntime = structuredClone(relabelled)
  const forged = sameRuntime.paths.emate_online.run_receipt
  forged.runtime = sameRuntime.paths.baseline.run_receipt.runtime
  forged.install_receipt = sameRuntime.paths.baseline.run_receipt.install_receipt
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

test('evaluates each scenario independently instead of pooling distributions', () => {
  const observed = evidence()
  for (const path of [observed.paths.baseline, observed.paths.emate_online, observed.paths.emate_enterprise_unavailable_valid_cache]) {
    for (const item of path.samples) {
      if (item.scenario !== 'short-text') {
        item.submit_to_first_visible_text_ms = 1_000
        item.user_message_to_first_text_delta_ms = 1_000
      }
    }
  }
  for (const path of [observed.paths.emate_online, observed.paths.emate_enterprise_unavailable_valid_cache]) {
    for (const item of path.samples.filter(candidate => candidate.scenario === 'short-text')) {
      item.submit_to_first_visible_text_ms = 160
      item.user_message_to_first_text_delta_ms = 160
    }
  }
  const result = evaluateEvidence(observed)
  assert.equal(result.gate_status, 'failed')
  assert.ok(result.failures.some(failure => failure.includes('short-text: p50 submit_to_first_visible_text_ms')))
})

test('keeps Tool timing absent outside read-only-tool and rejects obsolete body-start fields', () => {
  assert.equal(evaluateEvidence(evidence()).gate_status, 'fixture-passed-production-blocked')
  const placeholder = evidence()
  placeholder.paths.emate_online.samples[0].tool_result_to_next_request_ms = 0
  placeholder.paths.emate_enterprise_unavailable_valid_cache.samples[0].tool_result_to_next_request_ms = 0
  assert.equal(evaluateEvidence(placeholder).gate_status, 'failed')
})

test('invalidates the superseded flat schema-version-2 sample shape', () => {
  const legacy = evidence()
  for (const path of Object.values(legacy.paths)) {
    const item = path.samples[0]
    delete item.requests
    delete item.provider_attempts
    item.request_header_sha256 = '0'.repeat(64)
    item.request_header_bytes = 100
    item.request_tool_count = 1
    item.provider_invocation_id_sha256 = '1'.repeat(64)
    item.provider_response_id_sha256 = '2'.repeat(64)
    item.provider_usage_sha256 = '3'.repeat(64)
    item.input_tokens = 10
    item.output_tokens = 10
  }
  assert.equal(legacy.schema_version, 2)
  assert.equal(evaluateEvidence(legacy).gate_status, 'failed')
})

test('requires one Provider request for text scenarios and two ordered requests for read-only-tool', () => {
  const missingSecond = evidence()
  for (const path of [missingSecond.paths.emate_online, missingSecond.paths.emate_enterprise_unavailable_valid_cache]) {
    const tool = path.samples.find(item => item.scenario === 'read-only-tool')
    tool.requests.pop()
    tool.provider_attempts.pop()
  }
  assert.equal(evaluateEvidence(missingSecond).gate_status, 'failed')

  const unexpectedSecond = evidence()
  for (const path of [unexpectedSecond.paths.emate_online, unexpectedSecond.paths.emate_enterprise_unavailable_valid_cache]) {
    const text = path.samples.find(item => item.scenario === 'short-text')
    text.requests.push({ ...text.requests[0], ordinal: 2, request_header_sha256: 'f'.repeat(64) })
    text.provider_attempts.push({
      ...text.provider_attempts[0], ordinal: 2,
      provider_invocation_id_sha256: 'e'.repeat(64), provider_response_id_sha256: 'd'.repeat(64),
    })
  }
  assert.equal(evaluateEvidence(unexpectedSecond).gate_status, 'failed')

  const secondHeaderDrift = evidence()
  for (const path of [secondHeaderDrift.paths.emate_online, secondHeaderDrift.paths.emate_enterprise_unavailable_valid_cache]) {
    const tool = path.samples.find(item => item.scenario === 'read-only-tool')
    tool.requests[1].request_header_sha256 = 'f'.repeat(64)
  }
  const headerResult = evaluateEvidence(secondHeaderDrift)
  assert.equal(headerResult.gate_status, 'failed')
  assert.ok(headerResult.failures.some(failure => failure.includes('request header mismatch')))

  const duplicateProviderAttempt = evidence()
  for (const path of [duplicateProviderAttempt.paths.emate_online, duplicateProviderAttempt.paths.emate_enterprise_unavailable_valid_cache]) {
    const tool = path.samples.find(item => item.scenario === 'read-only-tool')
    tool.provider_attempts[1].provider_invocation_id_sha256 = tool.provider_attempts[0].provider_invocation_id_sha256
  }
  assert.equal(evaluateEvidence(duplicateProviderAttempt).gate_status, 'failed')
})

test('validates candidate-only diagnostics without using them as a parity gate', () => {
  const observed = evidence()
  for (const path of [observed.paths.emate_online, observed.paths.emate_enterprise_unavailable_valid_cache]) {
    for (const item of path.samples) {
      for (const attempt of item.requests) attempt.diagnostic = diagnostic()
    }
  }
  observed.paths.emate_online.samples[0].requests[0].diagnostic.local_pre_provider_ms = 100_000
  assert.equal(evaluateEvidence(observed).gate_status, 'fixture-passed-production-blocked')
  observed.paths.emate_online.samples[0].requests[0].diagnostic.policy_ms = -1
  assert.equal(evaluateEvidence(observed).gate_status, 'failed')
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
  const slowTool = evidence()
  for (const path of [slowTool.paths.emate_online, slowTool.paths.emate_enterprise_unavailable_valid_cache]) {
    for (const item of path.samples.filter(candidate => candidate.scenario === 'read-only-tool')) {
      item.tool_result_to_next_request_ms = 30
    }
  }
  assert.equal(evaluateEvidence(slowTool).gate_status, 'failed')
  const invalidOffline = evidence()
  invalidOffline.paths.emate_enterprise_unavailable_valid_cache.enterprise_state.lease = 'expired'
  assert.equal(evaluateEvidence(invalidOffline).gate_status, 'failed')
})

const nativeFields = [
  'pair_id', 'scenario', 'arm_order', 'path_execution_ordinal', 'session_id_sha256', 'turn', 'step',
  'user_message_to_first_text_delta_ms', 'output_tokens_per_second',
  'queue_wait_ms',
  'duplicate_model_request_count', 'duplicate_tool_execution_count',
  'duplicate_job_execution_count', 'duplicate_deliverable_count',
]
const nativeToolFields = ['tool_result_to_next_request_ms']
const requestFields = ['pair_id', 'requests']
const paintFields = ['pair_id', 'submit_to_first_visible_text_ms', 'first_chunk_to_paint_ms']
const providerFields = ['pair_id', 'provider_attempts']
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]))

test('assembles only linked installed-state artifacts and rejects a rehashed semantic mismatch', async t => {
  const root = await mkdtemp(join(tmpdir(), 'e-mate-performance-v2-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const performanceRunId = 'performance-production-test-v2'
  const sampleIdsSha256 = sha256(canonical(Array.from({ length: 30 }, (_, index) => `pair-${String(index + 1).padStart(2, '0')}`)))
  const paths = {}
  const writeJson = async (name, value) => {
    await writeFile(join(root, name), `${JSON.stringify(value, null, 2)}\n`)
    return name
  }
  for (const pathName of ['baseline', 'emate_online', 'emate_enterprise_unavailable_valid_cache']) {
    const candidate = pathName !== 'baseline'
    const samples = Array.from({ length: 30 }, (_, index) => sample(index + 1, {}, candidate))
    const binding = { schema_version: 2, performance_run_id: performanceRunId, path_name: pathName, sample_ids_sha256: sampleIdsSha256 }
    const native = {
      ...binding, kind: 'native-session-trace', source: 'dsh-session-events',
      samples: samples.map(item => pick(item, item.scenario === 'read-only-tool'
        ? [...nativeFields, ...nativeToolFields]
        : nativeFields)),
    }
    const provider = {
      ...binding, kind: 'provider-invocation-receipt', source: 'managed-provider-receipts',
      provider: 'e-mate-enterprise', model: 'gpt-5.6-luna', reasoning_level: 'medium',
      samples: samples.map(item => pick(item, providerFields)),
    }
    const request = {
      ...binding, kind: 'request-headers', source: 'dsh-request-header-waterfall',
      samples: samples.map(item => pick(item, requestFields)),
    }
    const paint = {
      ...binding, kind: 'renderer-paint-trace', source: 'desktop-renderer-paint',
      samples: samples.map(item => pick(item, paintFields)),
    }
    const runtime = {
      product: 'e-mate-desktop', product_version: candidate ? '2.0.13' : '2.0.12',
      source_commit: candidate ? 'e'.repeat(40) : '4'.repeat(40),
      desktop_reference_commit: '6074088f5b660206e404b3591fab51fb99c69add',
      base_contract_id: candidate ? 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0' : 'dsh-desktop-rc7',
      profile_generation: candidate ? 'candidate-generation' : 'baseline-generation',
      composition_sha256: candidate ? 'f'.repeat(64) : '1'.repeat(64),
      client_bundle_sha256: candidate ? '2'.repeat(64) : '3'.repeat(64),
      desktop_artifact_sha256: candidate ? '6'.repeat(64) : '7'.repeat(64),
      desktop_artifact_bytes: candidate ? 200 : 100,
    }
    const installReceipt = {
      installation_kind: 'installed-application', target: 'darwin-arm64', bundle_id: 'com.emate.desktop',
      package_sha256: runtime.desktop_artifact_sha256, package_bytes: runtime.desktop_artifact_bytes,
      installed_executable_sha256: candidate ? '8'.repeat(64) : '9'.repeat(64), installed_executable_bytes: 50,
      installed_at: '2026-08-14T23:59:00.000Z', launched_at: '2026-08-15T00:00:00.000Z',
    }
    const installed = {
      ...binding, kind: 'installed-runtime-receipt', source: 'installed-application',
      runtime, install_receipt: installReceipt,
    }
    const prefix = pathName.replaceAll('_', '-')
    paths[pathName] = {
      tool: 'read-only-probe', dataset_sha256: 'a'.repeat(64), acceptance_identity_sha256: 'b'.repeat(64),
      started_at: '2026-08-15T00:00:00.000Z', finished_at: '2026-08-15T00:01:00.000Z',
      environment: {
        machine_id_sha256: 'd'.repeat(64), os: 'macOS', arch: 'arm64', node: '24.19.0', browser: '149', network_profile: 'fixed',
      },
      native_trace_artifact: await writeJson(`${prefix}.native.json`, native),
      provider_receipt_artifact: await writeJson(`${prefix}.provider.json`, provider),
      request_header_artifact: await writeJson(`${prefix}.headers.json`, request),
      renderer_paint_artifact: await writeJson(`${prefix}.paint.json`, paint),
      installed_runtime_artifact: await writeJson(`${prefix}.installed.json`, installed),
      ...(candidate ? {
        enterprise_state: pathName === 'emate_online'
          ? { endpoint: 'available', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox' }
          : { endpoint: 'unavailable', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox' },
        enterprise_receipt_artifact: await writeJson(`${prefix}.enterprise.json`, {
          ...binding, kind: 'enterprise-runtime-receipt', source: 'e-mate-enterprise-state',
          receipt: {
            endpoint: pathName === 'emate_online' ? 'available' : 'unavailable',
            inference_gateway: 'available',
            lease_sha256: '4'.repeat(64), model_policy_sha256: '5'.repeat(64),
            audit_outbox_sha256: pathName === 'emate_online' ? '6'.repeat(64) : '7'.repeat(64),
            lease_refreshed_at: '2026-08-14T23:00:00.000Z',
            policy_refreshed_at: '2026-08-14T23:00:00.000Z',
            lease_expires_at: '2026-08-15T02:00:00.000Z',
            policy_expires_at: '2026-08-15T02:00:00.000Z',
            finished_at: '2026-08-15T00:01:00.000Z',
          },
        }),
      } : {}),
    }
  }
  const manifest = {
    schema_version: 2,
    comparison_kind: 'installed-2.0.12-vs-2.0.13',
    performance_run_id: performanceRunId,
    evidence_kind: 'production-real-provider',
    harness_commit: 'b2b1650b01f0ee88d81837a9b5c050f9f763f606',
    baseline_harness_commit: '2bc16230975f6cf02aa1b283b1f86de44007b059',
    performance_model: {
      route_id: 'luna', provider: 'e-mate-enterprise', model: 'gpt-5.6-luna', reasoning_effort: 'medium',
    },
    paths,
  }
  const manifestPath = join(root, 'manifest.json')
  const outputPath = join(root, 'evidence.json')
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const assembled = await assembleProductionEvidence(manifestPath, outputPath)
  const verified = await verifyProductionArtifacts(assembled, outputPath)
  assert.deepEqual(assembled.performance_model, manifest.performance_model)
  assert.deepEqual(verified.performance_model, manifest.performance_model)
  assert.equal(assembled.baseline_harness_commit, manifest.baseline_harness_commit)
  assert.equal(verified.baseline_harness_commit, manifest.baseline_harness_commit)
  assert.equal(assembled.paths.baseline.run_receipt.harness_commit, '2bc16230975f6cf02aa1b283b1f86de44007b059')
  assert.equal(assembled.paths.emate_online.run_receipt.harness_commit, 'b2b1650b01f0ee88d81837a9b5c050f9f763f606')
  assert.equal(assembled.paths.emate_enterprise_unavailable_valid_cache.run_receipt.harness_commit, 'b2b1650b01f0ee88d81837a9b5c050f9f763f606')
  assert.equal(evaluateEvidence(verified).gate_status, 'passed')

  const missingBaselineHarnessManifest = structuredClone(manifest)
  delete missingBaselineHarnessManifest.baseline_harness_commit
  const missingBaselineHarnessManifestPath = join(root, 'missing-baseline-harness-manifest.json')
  await writeFile(missingBaselineHarnessManifestPath, `${JSON.stringify(missingBaselineHarnessManifest, null, 2)}\n`)
  await assert.rejects(
    assembleProductionEvidence(missingBaselineHarnessManifestPath, join(root, 'missing-baseline-harness-evidence.json')),
    /production assembly manifest is invalid/u,
  )

  const wrongBaselineHarnessManifest = structuredClone(manifest)
  wrongBaselineHarnessManifest.baseline_harness_commit = manifest.harness_commit
  const wrongBaselineHarnessManifestPath = join(root, 'wrong-baseline-harness-manifest.json')
  await writeFile(wrongBaselineHarnessManifestPath, `${JSON.stringify(wrongBaselineHarnessManifest, null, 2)}\n`)
  await assert.rejects(
    assembleProductionEvidence(wrongBaselineHarnessManifestPath, join(root, 'wrong-baseline-harness-evidence.json')),
    /production assembly manifest is invalid/u,
  )

  const expandedModelManifest = structuredClone(manifest)
  expandedModelManifest.performance_model.extra = 'not-closed'
  const expandedModelManifestPath = join(root, 'expanded-model-manifest.json')
  await writeFile(expandedModelManifestPath, `${JSON.stringify(expandedModelManifest, null, 2)}\n`)
  await assert.rejects(
    assembleProductionEvidence(expandedModelManifestPath, join(root, 'expanded-model-evidence.json')),
    /production assembly manifest is invalid/u,
  )

  const mismatchedModelManifest = structuredClone(manifest)
  mismatchedModelManifest.performance_model.model = 'gpt-5.6-sol'
  const mismatchedModelManifestPath = join(root, 'mismatched-model-manifest.json')
  await writeFile(mismatchedModelManifestPath, `${JSON.stringify(mismatchedModelManifest, null, 2)}\n`)
  await assert.rejects(
    assembleProductionEvidence(mismatchedModelManifestPath, join(root, 'mismatched-model-evidence.json')),
    /baseline assembly artifacts are incomplete or inconsistent/u,
  )

  const wrongHarness = structuredClone(verified)
  const wrongHarnessReceipt = wrongHarness.paths.baseline.run_receipt
  wrongHarnessReceipt.harness_commit = manifest.harness_commit
  const wrongHarnessBody = { ...wrongHarnessReceipt }
  delete wrongHarnessBody.receipt_sha256
  wrongHarnessReceipt.receipt_sha256 = sha256(canonical(wrongHarnessBody))
  assert.ok(evaluateEvidence(wrongHarness).production_receipt_failures.includes('PRODUCTION_RUN_RECEIPT_INCOMPLETE'))

  const wrongCandidateHarness = structuredClone(verified)
  const wrongCandidateHarnessReceipt = wrongCandidateHarness.paths.emate_online.run_receipt
  wrongCandidateHarnessReceipt.harness_commit = manifest.baseline_harness_commit
  const wrongCandidateHarnessBody = { ...wrongCandidateHarnessReceipt }
  delete wrongCandidateHarnessBody.receipt_sha256
  wrongCandidateHarnessReceipt.receipt_sha256 = sha256(canonical(wrongCandidateHarnessBody))
  assert.ok(evaluateEvidence(wrongCandidateHarness).production_receipt_failures.includes('PRODUCTION_RUN_RECEIPT_INCOMPLETE'))

  const wrongModel = structuredClone(verified)
  wrongModel.performance_model = { ...wrongModel.performance_model, model: 'gpt-5.6-sol' }
  assert.ok(evaluateEvidence(wrongModel).production_receipt_failures.includes('PRODUCTION_RUN_RECEIPT_INCOMPLETE'))

  await symlink(paths.baseline.native_trace_artifact, join(root, 'linked.native.json'))
  const linkedManifest = structuredClone(manifest)
  linkedManifest.paths.baseline.native_trace_artifact = 'linked.native.json'
  const linkedManifestPath = join(root, 'linked-manifest.json')
  await writeFile(linkedManifestPath, `${JSON.stringify(linkedManifest, null, 2)}\n`)
  await assert.rejects(
    assembleProductionEvidence(linkedManifestPath, join(root, 'linked-evidence.json')),
    /regular file/u,
  )

  const paintPath = join(root, 'baseline.paint.json')
  const changedPaint = JSON.parse(await readFile(paintPath, 'utf8'))
  changedPaint.samples[0].first_chunk_to_paint_ms += 1
  const changedBytes = Buffer.from(`${JSON.stringify(changedPaint, null, 2)}\n`)
  await writeFile(paintPath, changedBytes)
  const changedReceipt = assembled.paths.baseline.run_receipt
  changedReceipt.renderer_paint_artifact.sha256 = sha256(changedBytes)
  const changedReceiptBody = { ...changedReceipt }
  delete changedReceiptBody.receipt_sha256
  changedReceipt.receipt_sha256 = sha256(canonical(changedReceiptBody))
  assert.notEqual(evaluateEvidence(verified).gate_status, 'passed')
  const rejected = await verifyProductionArtifacts(assembled, outputPath)
  assert.equal(evaluateEvidence(rejected).gate_status, 'failed')
})
