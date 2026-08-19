import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from '../upstream/deepseek-harness/vendor/cordis/lib/index.js'
import LlmRuntime, { CallId, LlmAdapter, createUserMessage } from '../upstream/deepseek-harness/packages/llm/llm/lib/index.js'
import SessionStore, { SessionId } from '../upstream/deepseek-harness/packages/core/session/lib/index.js'
import SystemPrompt from '../upstream/deepseek-harness/packages/core/system-prompt/lib/index.js'
import ToolRuntime, { defineContentToolFixture } from '../upstream/deepseek-harness/packages/core/tools/lib/index.js'
import AgentRegistry from '../upstream/deepseek-harness/packages/core/agent/lib/index.js'
import AgentLoop from '../upstream/deepseek-harness/packages/core/agent-loop/lib/index.js'

const HARNESS_COMMIT = 'df78045a127e32cb5b942defba52c539590d1596'
const DESKTOP_REFERENCE_COMMIT = '6074088f5b660206e404b3591fab51fb99c69add'
const MIN_SAMPLES = 30
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds))
const sha256 = value => createHash('sha256').update(value).digest('hex')
const isSha256 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const verifiedProductionEvidence = new WeakSet()

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

class FixtureAdapter extends LlmAdapter {
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
      const id = CallId(`call-${sessionId}`)
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
  for (const sample of path.samples) {
    if (typeof sample.pair_id !== 'string' || pairIds.has(sample.pair_id)
      || !Number.isFinite(sample.ttft_ms) || sample.ttft_ms < 0
      || !Number.isFinite(sample.output_tokens_per_second) || sample.output_tokens_per_second <= 0
      || !Number.isFinite(sample.tool_call_to_start_ms) || sample.tool_call_to_start_ms < 0
      || !Number.isFinite(sample.tool_result_to_next_request_ms) || sample.tool_result_to_next_request_ms < 0
      || sample.duplicate_event_count !== 0) return false
    pairIds.add(sample.pair_id)
  }
  return true
}

function comparePath(baseline, candidate) {
  const failures = []
  const summaries = {}
  for (const percentileValue of [0.5, 0.95]) {
    const label = `p${String(percentileValue * 100)}`
    const baseTtft = metric(baseline.samples, 'ttft_ms', percentileValue)
    const candidateTtft = metric(candidate.samples, 'ttft_ms', percentileValue)
    const ttftRate = percentileValue === 0.5 ? 0.05 : 0.10
    const ttftLimit = baseTtft + Math.max(50, baseTtft * ttftRate)
    summaries[label] = {
      ttft_ms: { baseline: baseTtft, candidate: candidateTtft, limit: ttftLimit },
    }
    if (candidateTtft > ttftLimit) failures.push(`${label} TTFT ${candidateTtft}ms > ${ttftLimit}ms`)
  }

  for (const [percentileValue, throughputRate] of [[0.5, 0.05], [0.05, 0.10]]) {
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

  for (const name of ['tool_call_to_start_ms', 'tool_result_to_next_request_ms']) {
    const base = metric(baseline.samples, name, 0.95)
    const observed = metric(candidate.samples, name, 0.95)
    summaries.p95[name] = { baseline: base, candidate: observed, absolute_limit: base + 50, relative_limit: base * 1.10 }
    if (observed - base > 50 || (base === 0 ? observed !== 0 : observed > base * 1.10)) {
      failures.push(`p95 ${name} ${observed}ms exceeds +50ms and/or +10% limits from ${base}ms`)
    }
  }
  return { passed: failures.length === 0, failures, summaries }
}

function validRuntimeIdentity(runtime) {
  return runtime !== null && typeof runtime === 'object'
    && typeof runtime.product === 'string' && runtime.product.length > 0
    && /^[a-f0-9]{40}$/.test(runtime.source_commit)
    && runtime.desktop_reference_commit === DESKTOP_REFERENCE_COMMIT
    && typeof runtime.base_contract_id === 'string' && runtime.base_contract_id.length > 0
    && typeof runtime.profile_generation === 'string' && runtime.profile_generation.length > 0
    && isSha256(runtime.composition_sha256)
    && isSha256(runtime.client_bundle_sha256)
}

function validEnterpriseReceipt(receipt) {
  return receipt !== null && typeof receipt === 'object'
    && isSha256(receipt.lease_sha256)
    && isSha256(receipt.model_policy_sha256)
    && isSha256(receipt.audit_outbox_sha256)
}

export function evaluateEvidence(evidence) {
  const failures = []
  if (evidence?.schema_version !== 1 || evidence?.harness_commit !== HARNESS_COMMIT) {
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
  return {
    gate_status: failures.length > 0
      ? 'failed'
      : production && productionReceiptFailures.length === 0 && verifiedProductionEvidence.has(evidence)
        ? 'passed'
        : 'fixture-passed-production-blocked',
    production_blocker: failures.length > 0
      ? undefined
      : productionReceiptFailures[0]
        ?? (production && !verifiedProductionEvidence.has(evidence)
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
  for (const receipt of receipts) {
    if (receipt === undefined
      || receipt.harness_commit !== HARNESS_COMMIT
      || typeof receipt.provider !== 'string' || receipt.provider.length === 0 || receipt.provider.includes('fixture')
      || typeof receipt.model !== 'string' || receipt.model.length === 0 || receipt.model.includes('fixture')
      || typeof receipt.tool !== 'string' || receipt.tool.length === 0
      || !isSha256(receipt.acceptance_identity_sha256)
      || !isSha256(receipt.dataset_sha256)
      || !isSha256(receipt.sample_ids_sha256)
      || !isSha256(receipt.raw_samples_sha256)
      || !isSha256(receipt.receipt_sha256)
      || receipt.raw_samples_artifact?.kind !== 'raw-samples'
      || !isSha256(receipt.raw_samples_artifact?.sha256)
      || !['provider-invocation-receipt', 'provider-usage-receipt', 'trace'].includes(receipt.provider_receipt_artifact?.kind)
      || !isSha256(receipt.provider_receipt_artifact?.sha256)
      || !Number.isFinite(Date.parse(receipt.started_at))
      || !Number.isFinite(Date.parse(receipt.finished_at))
      || Date.parse(receipt.finished_at) <= Date.parse(receipt.started_at)
      || !validRuntimeIdentity(receipt.runtime)
      || !['machine_id_sha256', 'os', 'arch', 'node', 'browser', 'network_profile'].every(key => typeof receipt.environment?.[key] === 'string' && receipt.environment[key].length > 0)) {
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
  const pairingKeys = ['provider', 'model', 'tool', 'acceptance_identity_sha256', 'dataset_sha256']
  const baseline = receipts[0]
  if (baseline !== undefined && receipts.some(receipt => pairingKeys.some(key => receipt?.[key] !== baseline[key])
    || canonical(receipt?.environment) !== canonical(baseline.environment))) {
    failures.push('PRODUCTION_PATHS_ARE_NOT_EXACTLY_PAIRED')
  }
  if (baseline?.runtime?.product !== 'deepseek-harness-desktop'
    || baseline?.runtime?.source_commit !== DESKTOP_REFERENCE_COMMIT) {
    failures.push('PRODUCTION_BASELINE_RUNTIME_MISMATCH')
  }
  const online = receipts[1]
  const offline = receipts[2]
  if (online?.runtime?.product !== 'e-mate-desktop'
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

async function verifyProductionArtifacts(evidence, input) {
  if (evidence.evidence_kind !== 'production-real-provider') return evidence
  const checked = { ...evidence }
  delete checked.production_artifacts_verified
  const root = dirname(resolve(input))
  for (const [pathName, path] of Object.entries(checked.paths ?? {})) {
    const receipt = path.run_receipt
    const artifactKeys = ['raw_samples_artifact', 'provider_receipt_artifact']
    if (pathName !== 'baseline') artifactKeys.push('enterprise_receipt_artifact')
    for (const key of artifactKeys) {
      const artifact = receipt?.[key]
      if (typeof artifact?.path !== 'string' || !isSha256(artifact.sha256)) return checked
      let bytes
      try {
        bytes = await readFile(resolve(root, artifact.path))
      } catch {
        return checked
      }
      if (sha256(bytes) !== artifact.sha256) return checked
      if (key === 'raw_samples_artifact') {
        try {
          if (canonical(JSON.parse(bytes)) !== canonical(path.samples)) return checked
        } catch {
          return checked
        }
      } else if (key === 'enterprise_receipt_artifact') {
        try {
          if (canonical(JSON.parse(bytes)) !== canonical(receipt.enterprise_receipt)) return checked
        } catch {
          return checked
        }
      }
    }
  }
  checked.production_artifacts_verified = true
  verifiedProductionEvidence.add(checked)
  return checked
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
    const duplicateEventCount = Math.max(0, toolEvents.filter(event => event.type === 'tool/call').length - 1)
      + Math.max(0, toolEvents.filter(event => event.type === 'tool/result').length - 1)
      + Math.max(0, responseEvents.filter(event => event.type === 'assistant/message').length - 1)
      + Math.max(0, toolEvents.filter(event => event.type === 'assistant/message').length - 2)
    const toolStart = toolStarts.get(toolId)
    const nextRequest = adapter.requestStarts.get(`${toolId}:2`)
    if (call?.type !== 'tool/call' || result?.type !== 'tool/result'
      || toolStart === undefined || nextRequest === undefined) {
      throw new Error(`${toolId} did not produce the expected real Tool events`)
    }
    output.push({
      pair_id: pairId,
      ttft_ms: deltas[0].time - responseUser.time,
      output_tokens_per_second: outputTokens / ((deltas.at(-1).time - deltas[0].time) / 1_000),
      tool_call_to_start_ms: toolStart - call.time,
      tool_result_to_next_request_ms: nextRequest - result.time,
      duplicate_event_count: duplicateEventCount,
    })
    await Promise.all([responseHandle.dispose(), toolHandle.dispose()])
  }
  await ctx.fiber.dispose()
  return { path: name, enterprise_state: enterpriseState, samples: output }
}

async function createFixture(samples) {
  return {
    schema_version: 1,
    evidence_kind: 'keyless-target-loop-collector-fixture',
    harness_commit: HARNESS_COMMIT,
    note: 'Generated by the pinned real AgentLoop; validates collection/comparison only and is not production provider evidence.',
    paths: {
      baseline: await collectPath('baseline', samples, { endpoint: 'not-applicable' }),
      emate_online: await collectPath('emate-online', samples, {
        endpoint: 'available', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox',
      }),
      emate_enterprise_unavailable_valid_cache: await collectPath('emate-offline-valid-cache', samples, {
        endpoint: 'unavailable', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox',
      }),
    },
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      fixture: { type: 'boolean', default: false },
      output: { type: 'string' },
      samples: { type: 'string', default: String(MIN_SAMPLES) },
    },
    strict: true,
  })
  const modeCount = Number(values.input !== undefined) + Number(values.fixture)
  if (modeCount !== 1) throw new Error('choose exactly one of --input <production-evidence.json> or --fixture')
  const samples = Number(values.samples)
  if (!Number.isSafeInteger(samples) || samples < MIN_SAMPLES) throw new Error(`--samples must be an integer >= ${MIN_SAMPLES}`)
  const loaded = values.fixture
    ? await createFixture(samples)
    : JSON.parse(await readFile(resolve(values.input), 'utf8'))
  const evidence = values.fixture ? loaded : await verifyProductionArtifacts(loaded, values.input)
  const result = { ...evidence, decision: evaluateEvidence(evidence) }
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (values.output === undefined) process.stdout.write(serialized)
  else await writeFile(resolve(values.output), serialized)
  process.exitCode = exitCodeForGateStatus(result.decision.gate_status)
}

export const exitCodeForGateStatus = gateStatus => gateStatus === 'passed' ? 0 : 1

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) await main()
