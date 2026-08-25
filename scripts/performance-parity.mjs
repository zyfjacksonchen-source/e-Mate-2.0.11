import { createHash } from 'node:crypto'
import { lstat, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

const HARNESS_COMMIT = 'b2b1650b01f0ee88d81837a9b5c050f9f763f606'
const DESKTOP_REFERENCE_COMMIT = '6074088f5b660206e404b3591fab51fb99c69add'
const EVIDENCE_SCHEMA_VERSION = 2
const MIN_SAMPLES = 30
const PATH_NAMES = ['baseline', 'emate_online', 'emate_enterprise_unavailable_valid_cache']
const PHASE_FIELDS = [
  'submit_to_host_ms',
  'turn_to_request_header_ms',
  'policy_ms',
  'quota_ms',
  'prepare_ms',
  'adapter_to_first_chunk_ms',
]
const NATIVE_SAMPLE_FIELDS = [
  'pair_id', 'scenario', 'arm_order', 'session_id_sha256', 'turn', 'step',
  'user_message_to_first_text_delta_ms', 'output_tokens_per_second',
  'tool_call_to_start_ms', 'tool_result_to_next_request_ms', 'queue_wait_ms',
  'duplicate_model_request_count', 'duplicate_tool_execution_count',
  'duplicate_job_execution_count', 'duplicate_deliverable_count',
]
const REQUEST_SAMPLE_FIELDS = [
  'pair_id', 'request_header_sha256', 'request_header_bytes', 'request_tool_count',
  'local_pre_provider_ms', ...PHASE_FIELDS,
]
const PAINT_SAMPLE_FIELDS = ['pair_id', 'submit_to_first_visible_text_ms', 'first_chunk_to_paint_ms']
const PROVIDER_SAMPLE_FIELDS = [
  'pair_id', 'provider_invocation_id_sha256', 'provider_response_id_sha256',
  'provider_usage_sha256', 'input_tokens', 'output_tokens',
]
const EVIDENCE_SAMPLE_FIELDS = [...new Set([
  ...NATIVE_SAMPLE_FIELDS,
  ...REQUEST_SAMPLE_FIELDS,
  ...PAINT_SAMPLE_FIELDS,
  ...PROVIDER_SAMPLE_FIELDS,
])]
const RUNTIME_FIELDS = [
  'product', 'product_version', 'source_commit', 'desktop_reference_commit',
  'base_contract_id', 'profile_generation', 'composition_sha256',
  'client_bundle_sha256', 'desktop_artifact_sha256', 'desktop_artifact_bytes',
]
const INSTALL_FIELDS = [
  'installation_kind', 'target', 'bundle_id', 'package_sha256', 'package_bytes',
  'installed_executable_sha256', 'installed_executable_bytes', 'installed_at', 'launched_at',
]
const ARTIFACT_DESCRIPTOR_FIELDS = ['kind', 'path', 'sha256']
const RUN_RECEIPT_FIELDS = [
  'performance_run_id', 'harness_commit', 'provider', 'model', 'reasoning_level',
  'tool', 'acceptance_identity_sha256', 'dataset_sha256', 'sample_ids_sha256',
  'raw_samples_sha256', 'raw_samples_artifact', 'native_trace_artifact',
  'provider_receipt_artifact', 'request_header_artifact', 'renderer_paint_artifact',
  'installed_runtime_artifact', 'environment', 'runtime', 'install_receipt',
  'started_at', 'finished_at', 'receipt_sha256',
]
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const verifiedProductionEvidence = new WeakMap()

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join('\n') === [...keys].sort().join('\n')
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function artifactBinding(value, kind, performanceRunId, pathName, sampleIdsSha256) {
  return isRecord(value)
    && value.schema_version === EVIDENCE_SCHEMA_VERSION
    && value.kind === kind
    && value.performance_run_id === performanceRunId
    && value.path_name === pathName
    && value.sample_ids_sha256 === sampleIdsSha256
}

function validArtifactDescriptor(value, kind) {
  return exactKeys(value, ARTIFACT_DESCRIPTOR_FIELDS)
    && value.kind === kind
    && typeof value.path === 'string' && value.path.length > 0
    && isSha256(value.sha256)
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function percentile(values, percentileValue) {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.ceil(percentileValue * ordered.length) - 1]
}

function metric(samples, name, percentileValue) {
  return percentile(samples.map(sample => sample[name]), percentileValue)
}

function validSamples(path) {
  if (!Array.isArray(path.samples) || path.samples.length < MIN_SAMPLES) return false
  const pairIds = new Set()
  const invocationIds = new Set()
  const responseIds = new Set()
  const scenarios = new Map()
  const armOrders = new Set()
  for (const sample of path.samples) {
    if (!exactKeys(sample, EVIDENCE_SAMPLE_FIELDS)
      || typeof sample.pair_id !== 'string' || pairIds.has(sample.pair_id)
      || !['short-text', 'history-20', 'read-only-tool'].includes(sample.scenario)
      || !['AB', 'BA'].includes(sample.arm_order)
      || !Number.isFinite(sample.submit_to_first_visible_text_ms) || sample.submit_to_first_visible_text_ms < 0
      || !Number.isFinite(sample.user_message_to_first_text_delta_ms) || sample.user_message_to_first_text_delta_ms < 0
      || !Number.isFinite(sample.first_chunk_to_paint_ms) || sample.first_chunk_to_paint_ms < 0
      || !Number.isFinite(sample.local_pre_provider_ms) || sample.local_pre_provider_ms < 0
      || !Number.isFinite(sample.output_tokens_per_second) || sample.output_tokens_per_second <= 0
      || !Number.isFinite(sample.tool_call_to_start_ms) || sample.tool_call_to_start_ms < 0
      || !Number.isFinite(sample.tool_result_to_next_request_ms) || sample.tool_result_to_next_request_ms < 0
      || !Number.isFinite(sample.queue_wait_ms) || sample.queue_wait_ms < 0
      || PHASE_FIELDS.some(name => !nonNegative(sample[name]))
      || !isSha256(sample.request_header_sha256)
      || !positiveInteger(sample.request_header_bytes)
      || !Number.isSafeInteger(sample.request_tool_count) || sample.request_tool_count < 0
      || !isSha256(sample.provider_invocation_id_sha256) || invocationIds.has(sample.provider_invocation_id_sha256)
      || !isSha256(sample.provider_response_id_sha256) || responseIds.has(sample.provider_response_id_sha256)
      || !isSha256(sample.provider_usage_sha256)
      || !isSha256(sample.session_id_sha256)
      || !positiveInteger(sample.turn) || !positiveInteger(sample.step)
      || !Number.isSafeInteger(sample.input_tokens) || sample.input_tokens < 0
      || !positiveInteger(sample.output_tokens)
      || sample.duplicate_model_request_count !== 0
      || sample.duplicate_tool_execution_count !== 0
      || sample.duplicate_job_execution_count !== 0
      || sample.duplicate_deliverable_count !== 0) return false
    pairIds.add(sample.pair_id)
    invocationIds.add(sample.provider_invocation_id_sha256)
    responseIds.add(sample.provider_response_id_sha256)
    scenarios.set(sample.scenario, (scenarios.get(sample.scenario) ?? 0) + 1)
    armOrders.add(sample.arm_order)
  }
  return [...scenarios.values()].every(count => count >= 10)
    && scenarios.size === 3
    && armOrders.size === 2
}

function comparePath(baseline, candidate) {
  const failures = []
  const summaries = {}
  for (const percentileValue of [0.5, 0.95]) {
    const label = `p${String(percentileValue * 100)}`
    const absoluteAllowance = percentileValue === 0.5 ? 50 : 100
    const relativeAllowance = percentileValue === 0.5 ? 0.03 : 0.05
    summaries[label] = {}
    for (const name of ['submit_to_first_visible_text_ms', 'user_message_to_first_text_delta_ms']) {
      const baseTtft = metric(baseline.samples, name, percentileValue)
      const candidateTtft = metric(candidate.samples, name, percentileValue)
      const ttftLimit = baseTtft + Math.max(absoluteAllowance, baseTtft * relativeAllowance)
      summaries[label][name] = { baseline: baseTtft, candidate: candidateTtft, limit: ttftLimit }
      if (candidateTtft > ttftLimit) failures.push(`${label} ${name} ${candidateTtft}ms > ${ttftLimit}ms`)
    }
  }

  for (const [percentileValue, throughputRate] of [[0.5, 0.03], [0.05, 0.05]]) {
    const label = `p${String(percentileValue * 100)}`
    const baseThroughput = metric(baseline.samples, 'output_tokens_per_second', percentileValue)
    const candidateThroughput = metric(candidate.samples, 'output_tokens_per_second', percentileValue)
    const throughputLimit = baseThroughput * (1 - throughputRate)
    summaries[label] ??= {}
    summaries[label].output_tokens_per_second = {
      baseline: baseThroughput,
      candidate: candidateThroughput,
      limit: throughputLimit,
    }
    if (candidateThroughput < throughputLimit) {
      failures.push(`${label} throughput ${candidateThroughput} < ${throughputLimit}`)
    }
  }

  for (const [percentileValue, allowance] of [[0.5, 10], [0.95, 25]]) {
    const label = `p${String(percentileValue * 100)}`
    const base = metric(baseline.samples, 'local_pre_provider_ms', percentileValue)
    const observed = metric(candidate.samples, 'local_pre_provider_ms', percentileValue)
    summaries[label] ??= {}
    summaries[label].local_pre_provider_ms = { baseline: base, candidate: observed, limit: base + allowance }
    if (observed > base + allowance) failures.push(`${label} local_pre_provider_ms ${observed}ms > ${base + allowance}ms`)
  }

  const basePaintP95 = metric(baseline.samples, 'first_chunk_to_paint_ms', 0.95)
  const paintP95 = metric(candidate.samples, 'first_chunk_to_paint_ms', 0.95)
  const paintP99 = metric(candidate.samples, 'first_chunk_to_paint_ms', 0.99)
  summaries.p95.first_chunk_to_paint_ms = { baseline: basePaintP95, candidate: paintP95, delta_limit: basePaintP95 + 10, absolute_limit: 50 }
  summaries.p99 = { first_chunk_to_paint_ms: { candidate: paintP99, absolute_limit: 100 } }
  if (paintP95 > basePaintP95 + 10 || paintP95 > 50) failures.push(`p95 first_chunk_to_paint_ms ${paintP95}ms exceeds +10ms or 50ms absolute limit`)
  if (paintP99 > 100) failures.push(`p99 first_chunk_to_paint_ms ${paintP99}ms > 100ms`)

  for (const name of ['tool_call_to_start_ms', 'tool_result_to_next_request_ms']) {
    const base = metric(baseline.samples, name, 0.95)
    const observed = metric(candidate.samples, name, 0.95)
    summaries.p95[name] = { baseline: base, candidate: observed, absolute_limit: base + 25, relative_limit: base * 1.05 }
    if (observed - base > 25 || (base === 0 ? observed !== 0 : observed > base * 1.05)) {
      failures.push(`p95 ${name} ${observed}ms exceeds +25ms and/or +5% limits from ${base}ms`)
    }
  }

  const baselineByPair = new Map(baseline.samples.map(sample => [sample.pair_id, sample]))
  for (const sample of candidate.samples) {
    const paired = baselineByPair.get(sample.pair_id)
    if (paired === undefined) continue
    if (sample.request_header_sha256 !== paired.request_header_sha256
      || sample.request_header_bytes !== paired.request_header_bytes
      || sample.request_tool_count !== paired.request_tool_count) {
      failures.push(`request header mismatch for ${sample.pair_id}`)
    }
  }
  return { passed: failures.length === 0, failures, summaries }
}

function validRuntimeIdentity(runtime) {
  return exactKeys(runtime, RUNTIME_FIELDS)
    && runtime.product === 'e-mate-desktop'
    && /^2\.0\.(12|13)$/.test(runtime.product_version)
    && /^[a-f0-9]{40}$/.test(runtime.source_commit)
    && runtime.desktop_reference_commit === DESKTOP_REFERENCE_COMMIT
    && typeof runtime.base_contract_id === 'string' && runtime.base_contract_id.length > 0
    && typeof runtime.profile_generation === 'string' && runtime.profile_generation.length > 0
    && isSha256(runtime.composition_sha256)
    && isSha256(runtime.client_bundle_sha256)
    && isSha256(runtime.desktop_artifact_sha256)
    && Number.isSafeInteger(runtime.desktop_artifact_bytes) && runtime.desktop_artifact_bytes > 0
}

function validInstallReceipt(receipt, runtime) {
  return exactKeys(receipt, INSTALL_FIELDS)
    && receipt.installation_kind === 'installed-application'
    && ['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(receipt.target)
    && typeof receipt.bundle_id === 'string' && receipt.bundle_id.length > 0
    && receipt.package_sha256 === runtime.desktop_artifact_sha256
    && receipt.package_bytes === runtime.desktop_artifact_bytes
    && isSha256(receipt.installed_executable_sha256)
    && positiveInteger(receipt.installed_executable_bytes)
    && Number.isFinite(Date.parse(receipt.installed_at))
    && Number.isFinite(Date.parse(receipt.launched_at))
    && Date.parse(receipt.launched_at) >= Date.parse(receipt.installed_at)
}

function installMatchesEnvironment(install, environment) {
  const os = environment.os.toLowerCase()
  const arch = environment.arch.toLowerCase()
  return install.target === 'darwin-arm64'
    ? ['darwin', 'macos'].includes(os) && arch === 'arm64'
    : install.target === 'darwin-x64'
      ? ['darwin', 'macos'].includes(os) && ['x64', 'amd64'].includes(arch)
      : ['win32', 'windows'].includes(os) && ['x64', 'amd64'].includes(arch)
}

function validEnterpriseReceipt(receipt) {
  return exactKeys(receipt, ['lease_sha256', 'model_policy_sha256', 'audit_outbox_sha256'])
    && isSha256(receipt.lease_sha256)
    && isSha256(receipt.model_policy_sha256)
    && isSha256(receipt.audit_outbox_sha256)
}

export function evaluateEvidence(evidence) {
  const failures = []
  if (evidence?.schema_version !== EVIDENCE_SCHEMA_VERSION
    || evidence?.comparison_kind !== 'installed-2.0.12-vs-2.0.13'
    || evidence?.harness_commit !== HARNESS_COMMIT) {
    failures.push('evidence schema or Harness pin mismatch')
  }
  const baseline = evidence?.paths?.baseline
  const online = evidence?.paths?.emate_online
  const offline = evidence?.paths?.emate_enterprise_unavailable_valid_cache
  for (const [name, path] of Object.entries({ baseline, emate_online: online, emate_enterprise_unavailable_valid_cache: offline })) {
    if (!validSamples(path ?? {})) failures.push(`${name} requires at least 30 unique, valid, duplicate-free samples`)
  }
  if (offline?.enterprise_state?.endpoint !== 'unavailable'
    || offline?.enterprise_state?.lease !== 'valid-cached'
    || offline?.enterprise_state?.model_policy !== 'valid-cached'
    || offline?.enterprise_state?.audit !== 'async-outbox') {
    failures.push('offline path must declare unavailable endpoint with a valid cached lease/policy and async audit outbox')
  }
  const baselineIds = baseline?.samples?.map(sample => sample.pair_id).sort().join('\n')
  for (const [name, path] of Object.entries({ emate_online: online, emate_enterprise_unavailable_valid_cache: offline })) {
    if (path?.samples?.map(sample => sample.pair_id).sort().join('\n') !== baselineIds) {
      failures.push(`${name} pair IDs do not match the baseline`)
    }
  }
  const comparisons = {}
  if (failures.length === 0) {
    for (const [name, path] of Object.entries({ emate_online: online, emate_enterprise_unavailable_valid_cache: offline })) {
      comparisons[name] = comparePath(baseline, path)
      failures.push(...comparisons[name].failures.map(failure => `${name}: ${failure}`))
    }
  }
  const production = evidence?.evidence_kind === 'production-real-provider'
  const productionReceiptFailures = production ? validateProductionReceipts(evidence) : []
  const productionArtifactsVerified = production
    && verifiedProductionEvidence.get(evidence) === sha256(canonical(evidence))
  return {
    gate_status: failures.length > 0
      ? 'failed'
      : production && productionReceiptFailures.length === 0 && productionArtifactsVerified
        ? 'passed'
        : 'fixture-passed-production-blocked',
    production_blocker: failures.length > 0
      ? undefined
      : productionReceiptFailures[0]
        ?? (production && !productionArtifactsVerified
          ? 'PRODUCTION_ARTIFACTS_NOT_VERIFIED'
          : 'REAL_PROVIDER_AND_APPROVED_ENTERPRISE_ACCEPTANCE_ACCOUNT_REQUIRED'),
    failures,
    production_receipt_failures: productionReceiptFailures,
    comparisons,
  }
}

function validateProductionReceipts(evidence) {
  const failures = []
  const paths = [
    evidence.paths?.baseline,
    evidence.paths?.emate_online,
    evidence.paths?.emate_enterprise_unavailable_valid_cache,
  ]
  const receipts = paths.map(path => path?.run_receipt)
  let receiptsComplete = true
  for (const [index, receipt] of receipts.entries()) {
    const candidate = index !== 0
    if (receipt === undefined
      || !exactKeys(receipt, candidate
        ? [...RUN_RECEIPT_FIELDS, 'enterprise_receipt', 'enterprise_receipt_artifact']
        : RUN_RECEIPT_FIELDS)
      || typeof receipt.performance_run_id !== 'string' || receipt.performance_run_id.length < 16
      || receipt.performance_run_id !== evidence.performance_run_id
      || receipt.harness_commit !== HARNESS_COMMIT
      || typeof receipt.provider !== 'string' || receipt.provider.length === 0 || receipt.provider.includes('fixture')
      || typeof receipt.model !== 'string' || receipt.model.length === 0 || receipt.model.includes('fixture')
      || typeof receipt.reasoning_level !== 'string' || receipt.reasoning_level.length === 0
      || typeof receipt.tool !== 'string' || receipt.tool.length === 0
      || !isSha256(receipt.acceptance_identity_sha256)
      || !isSha256(receipt.dataset_sha256)
      || !isSha256(receipt.sample_ids_sha256)
      || !isSha256(receipt.raw_samples_sha256)
      || !isSha256(receipt.receipt_sha256)
      || !validArtifactDescriptor(receipt.raw_samples_artifact, 'raw-samples')
      || !validArtifactDescriptor(receipt.native_trace_artifact, 'native-session-trace')
      || !validArtifactDescriptor(receipt.provider_receipt_artifact, 'provider-invocation-receipt')
      || !validArtifactDescriptor(receipt.request_header_artifact, 'request-headers')
      || !validArtifactDescriptor(receipt.renderer_paint_artifact, 'renderer-paint-trace')
      || !validArtifactDescriptor(receipt.installed_runtime_artifact, 'installed-runtime-receipt')
      || !Number.isFinite(Date.parse(receipt.started_at))
      || !Number.isFinite(Date.parse(receipt.finished_at))
      || Date.parse(receipt.finished_at) <= Date.parse(receipt.started_at)
      || !validRuntimeIdentity(receipt.runtime)
      || !validInstallReceipt(receipt.install_receipt, receipt.runtime)
      || !exactKeys(receipt.environment, ENVIRONMENT_FIELDS)
      || !ENVIRONMENT_FIELDS.every(key => typeof receipt.environment[key] === 'string' && receipt.environment[key].length > 0)
      || !isSha256(receipt.environment.machine_id_sha256)
      || !installMatchesEnvironment(receipt.install_receipt, receipt.environment)
      || (candidate && !validEnterpriseReceipt(receipt.enterprise_receipt))
      || (candidate && !validArtifactDescriptor(receipt.enterprise_receipt_artifact, 'enterprise-runtime-receipt'))) {
      failures.push('PRODUCTION_RUN_RECEIPT_INCOMPLETE')
      receiptsComplete = false
      continue
    }
    const receiptBody = { ...receipt }
    delete receiptBody.receipt_sha256
    if (receipt.receipt_sha256 !== sha256(canonical(receiptBody))) {
      failures.push('PRODUCTION_RUN_RECEIPT_DIGEST_MISMATCH')
    }
  }
  if (!receiptsComplete) return [...new Set(failures)]
  if (receipts.every(Boolean) && paths.some((path, index) => {
    const samples = path?.samples ?? []
    return receipts[index].sample_ids_sha256 !== sha256(canonical(samples.map(sample => sample.pair_id)))
      || receipts[index].raw_samples_sha256 !== sha256(canonical(samples))
  })) {
    failures.push('PRODUCTION_SAMPLE_RECEIPT_MISMATCH')
  }
  const pairingKeys = ['provider', 'model', 'reasoning_level', 'tool', 'acceptance_identity_sha256', 'dataset_sha256']
  const baseline = receipts[0]
  if (baseline !== undefined && receipts.some(receipt => pairingKeys.some(key => receipt?.[key] !== baseline[key])
    || canonical(receipt?.environment) !== canonical(baseline.environment))) {
    failures.push('PRODUCTION_PATHS_ARE_NOT_EXACTLY_PAIRED')
  }
  if (baseline?.runtime?.product !== 'e-mate-desktop'
    || baseline?.runtime?.product_version !== '2.0.12') {
    failures.push('PRODUCTION_BASELINE_RUNTIME_MISMATCH')
  }
  const online = receipts[1]
  const offline = receipts[2]
  if (online?.runtime?.product !== 'e-mate-desktop'
    || online?.runtime?.product_version !== '2.0.13'
    || canonical(online?.runtime) !== canonical(offline?.runtime)
    || canonical(baseline?.runtime) === canonical(online?.runtime)) {
    failures.push('PRODUCTION_CANDIDATE_RUNTIME_MISMATCH')
  }
  if (![online, offline].every(receipt => validEnterpriseReceipt(receipt?.enterprise_receipt)
    && receipt?.enterprise_receipt_artifact?.kind === 'enterprise-runtime-receipt'
    && isSha256(receipt?.enterprise_receipt_artifact?.sha256))) {
    failures.push('PRODUCTION_ENTERPRISE_RUNTIME_RECEIPT_INCOMPLETE')
  } else if (online.enterprise_receipt.lease_sha256 !== offline.enterprise_receipt.lease_sha256
    || online.enterprise_receipt.model_policy_sha256 !== offline.enterprise_receipt.model_policy_sha256) {
    failures.push('PRODUCTION_ENTERPRISE_STATE_NOT_PAIRED')
  }
  return [...new Set(failures)]
}

function exactSampleSet(rows, samples, fields) {
  if (!Array.isArray(rows) || rows.length !== samples.length
    || rows.some(row => !exactKeys(row, fields))) return false
  const byPair = new Map(rows.map(row => [row.pair_id, row]))
  if (byPair.size !== rows.length) return false
  return samples.every(sample => {
    const row = byPair.get(sample.pair_id)
    return row !== undefined && fields.every(field => canonical(row[field]) === canonical(sample[field]))
  })
}

function validNativeTrace(value, evidence, pathName, receipt, samples) {
  return artifactBinding(value, 'native-session-trace', evidence.performance_run_id, pathName, receipt.sample_ids_sha256)
    && exactKeys(value, [
      'schema_version', 'kind', 'source', 'performance_run_id', 'path_name',
      'sample_ids_sha256', 'samples',
    ])
    && value.source === 'dsh-session-events'
    && exactSampleSet(value.samples, samples, NATIVE_SAMPLE_FIELDS)
}

function validProviderReceipt(value, evidence, pathName, receipt, samples) {
  if (!artifactBinding(value, 'provider-invocation-receipt', evidence.performance_run_id, pathName, receipt.sample_ids_sha256)
    || !exactKeys(value, [
      'schema_version', 'kind', 'source', 'performance_run_id', 'path_name',
      'sample_ids_sha256', 'provider', 'model', 'reasoning_level', 'samples',
    ])
    || value.source !== 'managed-provider-receipts'
    || value.provider !== receipt.provider
    || value.model !== receipt.model
    || value.reasoning_level !== receipt.reasoning_level
    || !exactSampleSet(value.samples, samples, PROVIDER_SAMPLE_FIELDS)) return false
  return new Set(value.samples.map(row => row.provider_invocation_id_sha256)).size === samples.length
    && new Set(value.samples.map(row => row.provider_response_id_sha256)).size === samples.length
}

function validRequestHeaders(value, evidence, pathName, receipt, samples) {
  return artifactBinding(value, 'request-headers', evidence.performance_run_id, pathName, receipt.sample_ids_sha256)
    && exactKeys(value, [
      'schema_version', 'kind', 'source', 'performance_run_id', 'path_name',
      'sample_ids_sha256', 'samples',
    ])
    && value.source === 'dsh-request-header-waterfall'
    && exactSampleSet(value.samples, samples, REQUEST_SAMPLE_FIELDS)
}

function validRendererPaint(value, evidence, pathName, receipt, samples) {
  return artifactBinding(value, 'renderer-paint-trace', evidence.performance_run_id, pathName, receipt.sample_ids_sha256)
    && exactKeys(value, [
      'schema_version', 'kind', 'source', 'performance_run_id', 'path_name',
      'sample_ids_sha256', 'samples',
    ])
    && value.source === 'desktop-renderer-paint'
    && exactSampleSet(value.samples, samples, PAINT_SAMPLE_FIELDS)
}

function validInstalledRuntime(value, evidence, pathName, receipt) {
  return artifactBinding(value, 'installed-runtime-receipt', evidence.performance_run_id, pathName, receipt.sample_ids_sha256)
    && exactKeys(value, [
      'schema_version', 'kind', 'source', 'performance_run_id', 'path_name',
      'sample_ids_sha256', 'runtime', 'install_receipt',
    ])
    && value.source === 'installed-application'
    && canonical(value.runtime) === canonical(receipt.runtime)
    && canonical(value.install_receipt) === canonical(receipt.install_receipt)
    && validRuntimeIdentity(value.runtime)
    && validInstallReceipt(value.install_receipt, value.runtime)
}

function validEnterpriseArtifact(value, evidence, pathName, receipt) {
  return artifactBinding(value, 'enterprise-runtime-receipt', evidence.performance_run_id, pathName, receipt.sample_ids_sha256)
    && exactKeys(value, [
      'schema_version', 'kind', 'source', 'performance_run_id', 'path_name',
      'sample_ids_sha256', 'receipt',
    ])
    && value.source === 'e-mate-enterprise-state'
    && canonical(value.receipt) === canonical(receipt.enterprise_receipt)
    && validEnterpriseReceipt(value.receipt)
}

function semanticArtifactMatches(key, value, evidence, pathName, path, receipt) {
  if (key === 'raw_samples_artifact') return canonical(value) === canonical(path.samples)
  if (key === 'native_trace_artifact') return validNativeTrace(value, evidence, pathName, receipt, path.samples)
  if (key === 'provider_receipt_artifact') return validProviderReceipt(value, evidence, pathName, receipt, path.samples)
  if (key === 'request_header_artifact') return validRequestHeaders(value, evidence, pathName, receipt, path.samples)
  if (key === 'renderer_paint_artifact') return validRendererPaint(value, evidence, pathName, receipt, path.samples)
  if (key === 'installed_runtime_artifact') return validInstalledRuntime(value, evidence, pathName, receipt)
  return key === 'enterprise_receipt_artifact'
    && validEnterpriseArtifact(value, evidence, pathName, receipt)
}

export async function verifyProductionArtifacts(evidence, input) {
  if (evidence.evidence_kind !== 'production-real-provider') return evidence
  const checked = {
    schema_version: evidence.schema_version,
    comparison_kind: evidence.comparison_kind,
    performance_run_id: evidence.performance_run_id,
    evidence_kind: evidence.evidence_kind,
    harness_commit: evidence.harness_commit,
    paths: {},
  }
  const root = dirname(resolve(input))
  const seenArtifactPaths = new Set()
  for (const pathName of PATH_NAMES) {
    const path = evidence.paths?.[pathName]
    if (!exactKeys(path, pathName === 'baseline'
      ? ['samples', 'run_receipt']
      : ['enterprise_state', 'samples', 'run_receipt'])) return checked
    if (pathName !== 'baseline' && !exactKeys(path.enterprise_state, ['endpoint', 'lease', 'model_policy', 'audit'])) {
      return checked
    }
    checked.paths[pathName] = path
    const receipt = path.run_receipt
    const artifactKeys = [
      'raw_samples_artifact',
      'native_trace_artifact',
      'provider_receipt_artifact',
      'request_header_artifact',
      'renderer_paint_artifact',
      'installed_runtime_artifact',
    ]
    if (pathName !== 'baseline') artifactKeys.push('enterprise_receipt_artifact')
    for (const key of artifactKeys) {
      const artifact = receipt?.[key]
      if (typeof artifact?.path !== 'string' || !isSha256(artifact.sha256)) return checked
      const artifactPath = resolve(root, artifact.path)
      const rel = relative(root, artifactPath)
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || seenArtifactPaths.has(rel)) return checked
      seenArtifactPaths.add(rel)
      let bytes
      try {
        if (!(await lstat(artifactPath)).isFile()) return checked
        bytes = await readFile(artifactPath)
      } catch {
        return checked
      }
      if (sha256(bytes) !== artifact.sha256) return checked
      try {
        if (!semanticArtifactMatches(key, JSON.parse(bytes), checked, pathName, path, receipt)) return checked
      } catch {
        return checked
      }
    }
  }
  checked.production_artifacts_verified = true
  verifiedProductionEvidence.set(checked, sha256(canonical(checked)))
  return checked
}

function safeContainedPath(root, value) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) return undefined
  const path = resolve(root, value)
  const rel = relative(root, path)
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? undefined : { path, rel }
}

async function readAssemblyArtifact(manifestRoot, outputRoot, value) {
  const source = safeContainedPath(manifestRoot, value)
  if (source === undefined) throw new Error('assembly artifact path must stay inside the manifest directory')
  const outputRelative = relative(outputRoot, source.path)
  if (outputRelative === '..' || outputRelative.startsWith(`..${sep}`) || isAbsolute(outputRelative)) {
    throw new Error('assembly artifact path must stay inside the output evidence directory')
  }
  if (!(await lstat(source.path)).isFile()) throw new Error('assembly artifact must be a regular file')
  const bytes = await readFile(source.path)
  return {
    value: JSON.parse(bytes),
    descriptor: { path: outputRelative, sha256: sha256(bytes) },
  }
}

function rowsByPair(rows) {
  return new Map(rows.map(row => [row.pair_id, row]))
}

function joinSamples(nativeTrace, requestHeaders, rendererPaint, providerReceipt) {
  if (![nativeTrace.samples, requestHeaders.samples, rendererPaint.samples, providerReceipt.samples].every(Array.isArray)) {
    throw new Error('assembly artifacts require sample rows')
  }
  const requestByPair = rowsByPair(requestHeaders.samples)
  const paintByPair = rowsByPair(rendererPaint.samples)
  const providerByPair = rowsByPair(providerReceipt.samples)
  if ([requestByPair, paintByPair, providerByPair].some(rows => rows.size !== nativeTrace.samples.length)) {
    throw new Error('assembly artifact sample sets differ')
  }
  return nativeTrace.samples.map(nativeSample => {
    const request = requestByPair.get(nativeSample.pair_id)
    const paint = paintByPair.get(nativeSample.pair_id)
    const provider = providerByPair.get(nativeSample.pair_id)
    if (request === undefined || paint === undefined || provider === undefined) {
      throw new Error('assembly artifact sample sets differ')
    }
    return { ...nativeSample, ...request, ...paint, ...provider }
  })
}

const ASSEMBLY_PATH_FIELDS = [
  'tool', 'dataset_sha256', 'acceptance_identity_sha256', 'started_at', 'finished_at',
  'environment', 'native_trace_artifact', 'provider_receipt_artifact',
  'request_header_artifact', 'renderer_paint_artifact', 'installed_runtime_artifact',
]
const ENVIRONMENT_FIELDS = ['machine_id_sha256', 'os', 'arch', 'node', 'browser', 'network_profile']

async function assemblePath(evidence, pathName, config, manifestRoot, outputRoot) {
  const candidate = pathName !== 'baseline'
  const expectedKeys = candidate
    ? [...ASSEMBLY_PATH_FIELDS, 'enterprise_state', 'enterprise_receipt_artifact']
    : ASSEMBLY_PATH_FIELDS
  if (!exactKeys(config, expectedKeys)
    || typeof config.tool !== 'string' || config.tool.length === 0
    || !isSha256(config.dataset_sha256)
    || !isSha256(config.acceptance_identity_sha256)
    || !exactKeys(config.environment, ENVIRONMENT_FIELDS)
    || !ENVIRONMENT_FIELDS.every(key => typeof config.environment[key] === 'string' && config.environment[key].length > 0)
    || !isSha256(config.environment.machine_id_sha256)) {
    throw new Error(`${pathName} assembly metadata is invalid`)
  }

  const [native, provider, request, paint, installed, enterprise] = await Promise.all([
    readAssemblyArtifact(manifestRoot, outputRoot, config.native_trace_artifact),
    readAssemblyArtifact(manifestRoot, outputRoot, config.provider_receipt_artifact),
    readAssemblyArtifact(manifestRoot, outputRoot, config.request_header_artifact),
    readAssemblyArtifact(manifestRoot, outputRoot, config.renderer_paint_artifact),
    readAssemblyArtifact(manifestRoot, outputRoot, config.installed_runtime_artifact),
    candidate ? readAssemblyArtifact(manifestRoot, outputRoot, config.enterprise_receipt_artifact) : undefined,
  ])
  const samples = joinSamples(native.value, request.value, paint.value, provider.value)
  const sampleIdsSha256 = sha256(canonical(samples.map(sample => sample.pair_id)))
  const receipt = {
    performance_run_id: evidence.performance_run_id,
    harness_commit: evidence.harness_commit,
    provider: provider.value.provider,
    model: provider.value.model,
    reasoning_level: provider.value.reasoning_level,
    tool: config.tool,
    acceptance_identity_sha256: config.acceptance_identity_sha256,
    dataset_sha256: config.dataset_sha256,
    sample_ids_sha256: sampleIdsSha256,
    raw_samples_sha256: sha256(canonical(samples)),
    native_trace_artifact: { kind: 'native-session-trace', ...native.descriptor },
    provider_receipt_artifact: { kind: 'provider-invocation-receipt', ...provider.descriptor },
    request_header_artifact: { kind: 'request-headers', ...request.descriptor },
    renderer_paint_artifact: { kind: 'renderer-paint-trace', ...paint.descriptor },
    installed_runtime_artifact: { kind: 'installed-runtime-receipt', ...installed.descriptor },
    environment: config.environment,
    runtime: installed.value.runtime,
    install_receipt: installed.value.install_receipt,
    started_at: config.started_at,
    finished_at: config.finished_at,
    ...(candidate ? {
      enterprise_receipt: enterprise.value.receipt,
      enterprise_receipt_artifact: { kind: 'enterprise-runtime-receipt', ...enterprise.descriptor },
    } : {}),
  }
  const path = {
    ...(candidate ? { enterprise_state: config.enterprise_state } : {}),
    samples,
    run_receipt: receipt,
  }
  if (!validSamples(path)
    || !validNativeTrace(native.value, evidence, pathName, receipt, samples)
    || !validProviderReceipt(provider.value, evidence, pathName, receipt, samples)
    || !validRequestHeaders(request.value, evidence, pathName, receipt, samples)
    || !validRendererPaint(paint.value, evidence, pathName, receipt, samples)
    || !validInstalledRuntime(installed.value, evidence, pathName, receipt)
    || !installMatchesEnvironment(installed.value.install_receipt, config.environment)
    || (candidate && !validEnterpriseArtifact(enterprise.value, evidence, pathName, receipt))) {
    throw new Error(`${pathName} assembly artifacts are incomplete or inconsistent`)
  }
  const rawName = `${pathName}.raw-samples.json`
  const rawBytes = Buffer.from(`${JSON.stringify(samples, null, 2)}\n`)
  await writeFile(join(outputRoot, rawName), rawBytes, { flag: 'wx' })
  receipt.raw_samples_artifact = { kind: 'raw-samples', path: rawName, sha256: sha256(rawBytes) }
  receipt.receipt_sha256 = sha256(canonical(receipt))
  return path
}

export async function assembleProductionEvidence(manifestPath, outputPath) {
  const resolvedManifest = resolve(manifestPath)
  const resolvedOutput = resolve(outputPath)
  const manifestRoot = dirname(resolvedManifest)
  const outputRoot = dirname(resolvedOutput)
  if (manifestRoot !== outputRoot) {
    throw new Error('assembly manifest, source artifacts and output must share one evidence directory')
  }
  const manifest = JSON.parse(await readFile(resolvedManifest, 'utf8'))
  if (!exactKeys(manifest, [
    'schema_version', 'comparison_kind', 'performance_run_id', 'evidence_kind',
    'harness_commit', 'paths',
  ])
    || manifest.schema_version !== EVIDENCE_SCHEMA_VERSION
    || manifest.comparison_kind !== 'installed-2.0.12-vs-2.0.13'
    || typeof manifest.performance_run_id !== 'string' || manifest.performance_run_id.length < 16
    || manifest.evidence_kind !== 'production-real-provider'
    || manifest.harness_commit !== HARNESS_COMMIT
    || !exactKeys(manifest.paths, PATH_NAMES)) {
    throw new Error('production assembly manifest is invalid')
  }
  const evidence = {
    schema_version: manifest.schema_version,
    comparison_kind: manifest.comparison_kind,
    performance_run_id: manifest.performance_run_id,
    evidence_kind: manifest.evidence_kind,
    harness_commit: manifest.harness_commit,
    paths: {},
  }
  for (const pathName of PATH_NAMES) {
    evidence.paths[pathName] = await assemblePath(
      evidence,
      pathName,
      manifest.paths[pathName],
      manifestRoot,
      outputRoot,
    )
  }
  return evidence
}

async function fixtureRuntime() {
  const [cordis, llm, session, systemPrompt, tools, agents, agentLoop] = await Promise.all([
    import('../upstream/deepseek-harness/vendor/cordis/lib/index.js'),
    import('../upstream/deepseek-harness/packages/llm/llm/lib/index.js'),
    import('../upstream/deepseek-harness/packages/core/session/lib/index.js'),
    import('../upstream/deepseek-harness/packages/core/system-prompt/lib/index.js'),
    import('../upstream/deepseek-harness/packages/core/tools/lib/index.js'),
    import('../upstream/deepseek-harness/packages/core/agent/lib/index.js'),
    import('../upstream/deepseek-harness/packages/core/agent-loop/lib/index.js'),
  ])
  class FixtureAdapter extends llm.LlmAdapter {
    requestStarts = new Map()
    requestCounts = new Map()

    resolveModel(provider, model) {
      return Promise.resolve({ provider, id: model, name: model })
    }

    async * stream(options) {
      const sessionId = options.sessionId
      const request = (this.requestCounts.get(sessionId) ?? 0) + 1
      this.requestCounts.set(sessionId, request)
      this.requestStarts.set(`${sessionId}:${request}`, Date.now())
      if (sessionId.includes('-tool-') && request === 1) {
        await wait(20)
        const id = llm.CallId(`call-${sessionId}`)
        const args = JSON.stringify({ sampleId: sessionId })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: 'parity_probe', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'parity_probe', arguments: args } }
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      const text = '0123456789'
      await wait(20)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      for (const character of text) {
        await wait(10)
        yield { type: 'text-delta', index: 0, text: character }
      }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: text.length } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  return {
    Context: cordis.Context,
    LlmRuntime: llm.default,
    SessionId: session.SessionId,
    SessionStore: session.default,
    SystemPrompt: systemPrompt.default,
    ToolRuntime: tools.default,
    defineContentToolFixture: tools.defineContentToolFixture,
    AgentRegistry: agents.default,
    AgentLoop: agentLoop.default,
    createUserMessage: llm.createUserMessage,
    FixtureAdapter,
  }
}

function waitForIdle(ctx, agent) {
  return new Promise(resolveIdle => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolveIdle()
      }
    })
  })
}

function textDeltas(events) {
  return events.filter(event => event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta')
}

async function collectPath(name, samples, enterpriseState) {
  const {
    Context, LlmRuntime, SessionId, SessionStore, SystemPrompt, ToolRuntime,
    defineContentToolFixture, AgentRegistry, AgentLoop, createUserMessage, FixtureAdapter,
  } = await fixtureRuntime()
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new FixtureAdapter()
  ctx.llm.registerAdapter(['parity-fixture'], adapter)
  const toolStarts = new Map()
  ctx.tools.register(defineContentToolFixture({
    name: 'parity_probe',
    description: 'Measure the target Tool lifecycle.',
    parameters: { sampleId: { type: 'string' } },
    async execute({ sampleId }) {
      toolStarts.set(sampleId, Date.now())
      return [{ type: 'text', text: `observed ${sampleId}` }]
    },
  }))

  const output = []
  const fixtureHeader = canonical({ provider: 'parity-fixture', model: 'parity-fixture', tools: ['parity_probe'] })
  for (let index = 0; index < samples; index += 1) {
    const pairId = `pair-${String(index + 1).padStart(2, '0')}`
    const responseId = `${name}-response-${pairId}`
    const responseHandle = await ctx.agents.create({
      sessionId: SessionId(responseId),
      agentOptions: { provider: 'parity-fixture', model: 'parity-fixture' },
    })
    const responseAgent = responseHandle.agent
    const responseIdle = waitForIdle(ctx, responseAgent)
    responseAgent.followup(createUserMessage({ content: [{ type: 'text', text: pairId }], source: { kind: 'user' } }))
    await responseIdle
    const responseEvents = responseAgent.session.events
    const responseUser = responseEvents.find(event => event.type === 'user/message')
    const deltas = textDeltas(responseEvents)
    const response = responseEvents.find(event => event.type === 'assistant/message')
    const outputTokens = response?.type === 'assistant/message' ? response.data.usage?.outputTokens : undefined
    if (responseUser?.type !== 'user/message' || deltas.length < 2 || typeof outputTokens !== 'number') {
      throw new Error(`${responseId} did not produce the expected real response events`)
    }

    const toolId = `${name}-tool-${pairId}`
    const toolHandle = await ctx.agents.create({
      sessionId: SessionId(toolId),
      agentOptions: { provider: 'parity-fixture', model: 'parity-fixture' },
    })
    const toolAgent = toolHandle.agent
    const toolIdle = waitForIdle(ctx, toolAgent)
    toolAgent.followup(createUserMessage({ content: [{ type: 'text', text: pairId }], source: { kind: 'user' } }))
    await toolIdle
    const toolEvents = toolAgent.session.events
    const call = toolEvents.find(event => event.type === 'tool/call')
    const result = toolEvents.find(event => event.type === 'tool/result')
    const duplicateToolExecutionCount = Math.max(0, toolEvents.filter(event => event.type === 'tool/call').length - 1)
      + Math.max(0, toolEvents.filter(event => event.type === 'tool/result').length - 1)
    const duplicateModelRequestCount = Math.max(0, (adapter.requestCounts.get(responseId) ?? 0) - 1)
      + Math.max(0, (adapter.requestCounts.get(toolId) ?? 0) - 2)
    const toolStart = toolStarts.get(toolId)
    const nextRequest = adapter.requestStarts.get(`${toolId}:2`)
    if (call?.type !== 'tool/call' || result?.type !== 'tool/result'
      || toolStart === undefined || nextRequest === undefined) {
      throw new Error(`${toolId} did not produce the expected real Tool events`)
    }
    output.push({
      pair_id: pairId,
      scenario: ['short-text', 'history-20', 'read-only-tool'][index % 30 < 10 ? 0 : index % 30 < 20 ? 1 : 2],
      arm_order: index % 2 === 0 ? 'AB' : 'BA',
      session_id_sha256: sha256(responseId),
      turn: 1,
      step: 1,
      submit_to_first_visible_text_ms: deltas[0].time - responseUser.time,
      user_message_to_first_text_delta_ms: deltas[0].time - responseUser.time,
      first_chunk_to_paint_ms: 0,
      local_pre_provider_ms: 0,
      submit_to_host_ms: 0,
      turn_to_request_header_ms: 0,
      policy_ms: 0,
      quota_ms: 0,
      prepare_ms: 0,
      adapter_to_first_chunk_ms: 0,
      output_tokens_per_second: outputTokens / ((deltas.at(-1).time - deltas[0].time) / 1_000),
      tool_call_to_start_ms: toolStart - call.time,
      tool_result_to_next_request_ms: nextRequest - result.time,
      queue_wait_ms: 0,
      request_header_sha256: sha256(fixtureHeader),
      request_header_bytes: Buffer.byteLength(fixtureHeader),
      request_tool_count: 1,
      provider_invocation_id_sha256: sha256(`fixture-invocation:${name}:${pairId}`),
      provider_response_id_sha256: sha256(`fixture-response:${name}:${pairId}`),
      provider_usage_sha256: sha256(canonical({ input_tokens: 1, output_tokens: outputTokens })),
      input_tokens: 1,
      output_tokens: outputTokens,
      duplicate_model_request_count: duplicateModelRequestCount,
      duplicate_tool_execution_count: duplicateToolExecutionCount,
      duplicate_job_execution_count: 0,
      duplicate_deliverable_count: 0,
    })
    await Promise.all([responseHandle.dispose(), toolHandle.dispose()])
  }
  await ctx.fiber.dispose()
  return { path: name, enterprise_state: enterpriseState, samples: output }
}

async function createFixture(samples) {
  const baseline = await collectPath('baseline', samples, { endpoint: 'not-applicable' })
  const fixturePath = (path, enterpriseState) => ({
    path,
    enterprise_state: enterpriseState,
    samples: structuredClone(baseline.samples),
  })
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    comparison_kind: 'installed-2.0.12-vs-2.0.13',
    performance_run_id: 'fixture-performance-v2',
    evidence_kind: 'keyless-target-loop-collector-fixture',
    harness_commit: HARNESS_COMMIT,
    note: 'Collected once through the pinned real AgentLoop and cloned into equivalent comparison arms; browser paint and pre-provider values are synthetic zeros, so this validates schema/comparison only and is not production evidence.',
    paths: {
      baseline,
      emate_online: fixturePath('emate-online', {
        endpoint: 'available', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox',
      }),
      emate_enterprise_unavailable_valid_cache: fixturePath('emate-offline-valid-cache', {
        endpoint: 'unavailable', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox',
      }),
    },
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      assemble: { type: 'string' },
      fixture: { type: 'boolean', default: false },
      output: { type: 'string' },
      samples: { type: 'string', default: String(MIN_SAMPLES) },
    },
    strict: true,
  })
  const modeCount = Number(values.input !== undefined) + Number(values.assemble !== undefined) + Number(values.fixture)
  if (modeCount !== 1) throw new Error('choose exactly one of --input <production-evidence.json>, --assemble <manifest.json>, or --fixture')
  if (values.assemble !== undefined && values.output === undefined) throw new Error('--assemble requires --output in the evidence directory')
  const samples = Number(values.samples)
  if (!Number.isSafeInteger(samples) || samples < MIN_SAMPLES) throw new Error(`--samples must be an integer >= ${MIN_SAMPLES}`)
  const loaded = values.fixture
    ? await createFixture(samples)
    : values.assemble !== undefined
      ? await assembleProductionEvidence(values.assemble, values.output)
      : JSON.parse(await readFile(resolve(values.input), 'utf8'))
  const evidence = values.fixture
    ? loaded
    : await verifyProductionArtifacts(loaded, values.assemble === undefined ? values.input : values.output)
  const result = { ...evidence, decision: evaluateEvidence(evidence) }
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (values.output === undefined) process.stdout.write(serialized)
  else await writeFile(resolve(values.output), serialized)
  process.exitCode = exitCodeForGateStatus(result.decision.gate_status)
}

export const exitCodeForGateStatus = gateStatus => gateStatus === 'passed' ? 0 : 1

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) await main()
