import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { isTaskAuditUploadRejection } from './identity/task-audit-upload-rejection.js'
import { loadTargetStorageDomain } from './target-runtime.js'

export const name = 'emate-audit'
export const inject = [
  'agents', 'skills', 'tools',
  'connection', 'sessionPersistence', 'storageDomain', 'timer', 'emateModelPolicy', 'emateIdentity',
]
export const AUDIT_CHANNEL = '/emate.audit'

const SHA256 = /^[0-9a-f]{64}$/u
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u
const MAX_TOKEN_BUCKET = 1_000_000_000_000
const BATCH_SIZE = 64
const MAX_OPEN_TASKS = 128
const MAX_TASK_EVENTS = 256
const BACKFILL_SESSION_TIMEOUT_MS = 10_000
const TASK_SCENARIOS = new Set([
  'GENERAL',
  'CONTENT_CREATION',
  'DOCUMENT_EDITING',
  'SYSTEM_MAINTENANCE',
  'ASSET_PRODUCTION',
  'DATA_PROCESSING',
  'SEARCH_QUERY',
])
const TOOL_SCENARIOS = new Map([
  ['web_search', ['SEARCH_QUERY', '@deepseek-ai/dsh-tool-web', 'tool-web']],
  ['web_fetch', ['SEARCH_QUERY', '@deepseek-ai/dsh-tool-web', 'tool-web']],
  ['imagegen', ['ASSET_PRODUCTION', './plugins/image-generation.js', 'emate-image-generation']],
  ['image_pack', ['ASSET_PRODUCTION', './plugins/image-generation.js', 'emate-image-generation']],
  ['e_mate_qr_generate', ['ASSET_PRODUCTION', './plugins/qr-generation.js', 'emate-qr-generation']],
  ['office_read', ['DOCUMENT_EDITING', './node_modules/@e-mate/dsh-plugin-office-skills/lib/index.js', 'emate-office-skills']],
  ['office_write', ['DOCUMENT_EDITING', './node_modules/@e-mate/dsh-plugin-office-skills/lib/index.js', 'emate-office-skills']],
  ['bash', ['SYSTEM_MAINTENANCE', '@deepseek-ai/dsh-tool-bash', 'tool-bash']],
  ['pwsh', ['SYSTEM_MAINTENANCE', '@deepseek-ai/dsh-tool-pwsh', 'tool-pwsh']],
])
const SKILL_SCENARIOS = new Map([
  ['presentations', 'CONTENT_CREATION'],
  ['documents', 'DOCUMENT_EDITING'],
  ['pdf', 'DOCUMENT_EDITING'],
  ['spreadsheets', 'DATA_PROCESSING'],
])
const BUNDLED_SKILL_PROVIDER = 'emate-office-skills'

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function tokenBucket(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_TOKEN_BUCKET ? value : undefined
}

function validBinding(binding, provider, model) {
  return isRecord(binding)
    && binding.schema_version === 1
    && SHA256.test(binding.account_subject_sha256)
    && Number.isSafeInteger(binding.policy_revision) && binding.policy_revision >= 1
    && typeof binding.policy_receipt_id === 'string' && SAFE_ID.test(binding.policy_receipt_id)
    && typeof binding.policy_sha256 === 'string' && SHA256.test(binding.policy_sha256)
    && binding.provider === provider
    && binding.model === model
}

function bindingKey(sessionId, turn, step) {
  return `${sha256(String(sessionId))}:${turn}:${step}`
}

function taskBindingKey(sessionId, turn) {
  return `${sha256(String(sessionId))}:${turn}`
}

function taskIdentity(sessionId, turn) {
  const sessionIdSha256 = sha256(String(sessionId))
  return {
    sessionIdSha256,
    taskId: `task_${sha256(`e-Mate task v1\0${sessionIdSha256}:${turn}`)}`,
  }
}

function taskScenarioCandidate(event) {
  if (!isRecord(event) || !isRecord(event.data)) return undefined
  if (event.type === 'tool/call' && typeof event.data.name === 'string') {
    const trusted = TOOL_SCENARIOS.get(event.data.name)
    return trusted === undefined ? undefined : { name: event.data.name, scenario: trusted[0], signal: 'tool' }
  }
  const source = event.type === 'user/message' && isRecord(event.data.source) ? event.data.source : undefined
  if (source?.kind !== 'skill-invocation' || source.form !== 'instructions' || typeof source.name !== 'string') {
    return undefined
  }
  const scenario = SKILL_SCENARIOS.get(source.name)
  return scenario === undefined ? undefined : { name: source.name, scenario, signal: 'skill' }
}

/** Accept only exact Loader provenance or an exact bundled Skill winner; never inspect private payloads or bodies. */
export async function taskScenarioSignal(ctx, session, event) {
  const candidate = taskScenarioCandidate(event)
  if (candidate === undefined || !isRecord(session) || typeof session.id !== 'string') return undefined
  try {
    const agent = ctx.agents?.get?.(session.id)
    if (agent === undefined) return undefined
    if (candidate.signal === 'tool') {
      const trusted = TOOL_SCENARIOS.get(candidate.name)
      const provenance = ctx.tools?.provenance?.(candidate.name, agent)
      return trusted !== undefined
        && isRecord(provenance)
        && provenance.moduleSpecifier === trusted[1]
        && provenance.pluginName === trusted[2]
        ? trusted[0]
        : undefined
    }
    const snapshot = await ctx.skills?.snapshot?.({ cwd: session.header?.cwd, scope: agent })
    if (!isRecord(snapshot) || snapshot.complete !== true || !Array.isArray(snapshot.skills)) return undefined
    const skill = snapshot.skills.find(entry => isRecord(entry) && entry.name === candidate.name)
    return isRecord(skill)
      && skill.name === candidate.name
      && skill.source === 'bundled'
      && skill.provider === BUNDLED_SKILL_PROVIDER
      ? candidate.scenario
      : undefined
  } catch {
    return undefined
  }
}

function taskType(event) {
  if (event.type === 'turn/start') return 'RECEIVED'
  if (event.type === 'tool/call') return 'TOOL_EXECUTION'
  if (event.type === 'approval/asked') return 'PERMISSION_REQUESTED'
  if (event.type === 'assistant/message'
    && isRecord(event.data?.message?.source)
    && event.data.message.source.kind === 'model') return 'FIRST_RESPONSE'
  if (event.type !== 'turn/end' || !isRecord(event.data?.reason)) return undefined
  if (event.data.reason.kind === 'completed') return 'COMPLETED'
  if (['aborted', 'disposed', 'interrupted'].includes(event.data.reason.kind)) return 'CANCELLED'
  return 'FAILED'
}

function taskEventEnvelope(event) {
  if (!isRecord(event) || !isRecord(event.data)) return undefined
  const type = taskType(event)
  const candidate = taskScenarioCandidate(event)
  if (type === undefined && candidate === undefined) return undefined
  const turn = Number.isSafeInteger(event.data.turn) ? event.data.turn : undefined
  return {
    seq: event.seq,
    time: event.time,
    turn,
    type,
    ...(candidate === undefined ? {} : { candidate }),
  }
}

async function resolveTaskEvent(ctx, session, event) {
  const { candidate, ...envelope } = event
  if (candidate === undefined) return envelope
  const scenario = await taskScenarioSignal(ctx, session, {
    type: candidate.signal === 'tool' ? 'tool/call' : 'user/message',
    data: candidate.signal === 'tool'
      ? { name: candidate.name }
      : { source: { kind: 'skill-invocation', name: candidate.name, form: 'instructions' } },
  })
  return scenario === undefined ? envelope : { ...envelope, scenario, signal: candidate.signal }
}

export function createTaskAuditFact(sessionId, event, type, binding, turn = event?.data?.turn, scenario = 'GENERAL') {
  if (!isRecord(event)
    || !['RECEIVED', 'FIRST_RESPONSE', 'COMPLETED', 'FAILED', 'CANCELLED', 'TOOL_EXECUTION', 'PERMISSION_REQUESTED'].includes(type)
    || !Number.isSafeInteger(event.seq) || event.seq < 0
    || !Number.isSafeInteger(event.time) || event.time < 0
    || !Number.isSafeInteger(turn) || turn < 1
    || !TASK_SCENARIOS.has(scenario)
    || !isRecord(binding)
    || binding.schema_version !== 1
    || !SHA256.test(binding.account_subject_sha256)) return undefined
  const occurredAt = new Date(event.time)
  if (!Number.isFinite(occurredAt.getTime())) return undefined
  const { sessionIdSha256, taskId } = taskIdentity(sessionId, turn)
  const eventId = `taskevent_${sha256(`e-Mate task event v1\0${sessionIdSha256}:${event.seq}:${type}`)}`
  const payload = {
    schemaVersion: 1,
    eventId,
    taskId,
    type,
    scenario,
    occurredAt: occurredAt.toISOString(),
  }
  return {
    schema_version: 1,
    event_id: eventId,
    account_subject_sha256: binding.account_subject_sha256,
    payload,
    payload_sha256: sha256(canonicalJson(payload)),
    source_seq: event.seq,
    status: 'pending',
    attempt_count: 0,
    next_attempt_at: payload.occurredAt,
  }
}

export function createUsageFact(sessionId, event, binding) {
  if (!isRecord(event)
    || event.type !== 'assistant/message'
    || !Number.isSafeInteger(event.seq) || event.seq < 0
    || !Number.isSafeInteger(event.time) || event.time < 0
    || !isRecord(event.data)
    || !Number.isSafeInteger(event.data.turn) || event.data.turn < 1
    || !Number.isSafeInteger(event.data.step) || event.data.step < 1
    || !isRecord(event.data.message)
    || !isRecord(event.data.message.source)
    || event.data.message.source.kind !== 'model'
    || typeof event.data.message.source.provider !== 'string' || !SAFE_ID.test(event.data.message.source.provider)
    || typeof event.data.message.source.model !== 'string' || !SAFE_ID.test(event.data.message.source.model)
    || !isRecord(event.data.usage)) return undefined

  const usage = event.data.usage
  const inputTokens = tokenBucket(usage.inputTokens)
  const outputTokens = tokenBucket(usage.outputTokens)
  const cacheReadTokens = tokenBucket(usage.cacheReadTokens ?? 0)
  const cacheWriteTokens = tokenBucket(usage.cacheWriteTokens ?? 0)
  const reasoningTokens = tokenBucket(usage.reasoningTokens ?? 0)
  if ([inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens].includes(undefined)) {
    return undefined
  }
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  if (!Number.isSafeInteger(totalTokens) || totalTokens > MAX_TOKEN_BUCKET) return undefined

  const sessionIdSha256 = sha256(String(sessionId))
  const sourceId = `harness:${sessionIdSha256}:${event.seq}`
  const provider = event.data.message.source.provider
  const model = event.data.message.source.model
  const bound = validBinding(binding, provider, model)
  const payload = {
    schema_version: 1,
    source_service: 'e-mate-audit',
    source_id: sourceId,
    usage_kind: 'chat',
    session_id_sha256: sessionIdSha256,
    event_seq: event.seq,
    turn: event.data.turn,
    step: event.data.step,
    provider_created_at: new Date(event.time).toISOString(),
    requested_model_id: model,
    actual_model_id: model,
    actual_provider_id: provider,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_tokens: cacheReadTokens,
    cache_write_tokens: cacheWriteTokens,
    reasoning_tokens: reasoningTokens,
    total_tokens: totalTokens,
    ...(bound ? {
      account_subject_sha256: binding.account_subject_sha256,
      policy_revision: binding.policy_revision,
      policy_receipt_id: binding.policy_receipt_id,
      policy_sha256: binding.policy_sha256,
    } : {}),
  }
  const payloadSha256 = sha256(canonicalJson(payload))
  return {
    schema_version: 1,
    fact_id: `auditfact_${sha256(`e-Mate audit v1\0${sourceId}`)}`,
    payload,
    payload_sha256: payloadSha256,
    status: bound && totalTokens > 0 ? 'pending' : 'blocked',
    attempt_count: 0,
    next_attempt_at: new Date(event.time).toISOString(),
    ...(bound ? {} : { last_error_code: 'identity-policy-binding-missing-or-conflicting' }),
    ...(totalTokens > 0 ? {} : { last_error_code: 'provider-usage-zero' }),
  }
}

function errorCode(error) {
  const text = error instanceof Error ? error.message : String(error)
  return sha256(text).slice(0, 16)
}

function validateUploadReceipts(value, records) {
  if (!isRecord(value)
    || value.schema_version !== 1
    || !Array.isArray(value.receipts)
    || value.receipts.length !== records.length) {
    throw new Error('e-Mate enterprise audit receipt batch is invalid')
  }
  const expected = new Map(records.map(record => [record.fact_id, record.payload_sha256]))
  const receipts = new Map()
  for (const receipt of value.receipts) {
    if (!isRecord(receipt)
      || Object.keys(receipt).sort().join(',') !== 'accepted_at,fact_id,payload_sha256,receipt_id'
      || typeof receipt.fact_id !== 'string'
      || expected.get(receipt.fact_id) !== receipt.payload_sha256
      || typeof receipt.receipt_id !== 'string' || !SAFE_ID.test(receipt.receipt_id)
      || typeof receipt.accepted_at !== 'string' || !Number.isFinite(Date.parse(receipt.accepted_at))
      || receipts.has(receipt.fact_id)) {
      throw new Error('e-Mate enterprise audit receipt is invalid')
    }
    receipts.set(receipt.fact_id, receipt)
  }
  if (receipts.size !== expected.size) throw new Error('e-Mate enterprise audit receipt set is incomplete')
  return receipts
}

function validateTaskUploadReceipts(value, records) {
  if (!isRecord(value)
    || value.schema_version !== 1
    || !Array.isArray(value.receipts)
    || value.receipts.length !== records.length) {
    throw new Error('e-Mate enterprise task audit receipt batch is invalid')
  }
  const expected = new Map(records.map(record => [record.event_id, record.payload_sha256]))
  const receipts = new Map()
  for (const receipt of value.receipts) {
    if (!isRecord(receipt)
      || Object.keys(receipt).sort().join(',') !== 'accepted_at,event_id,payload_sha256,receipt_id'
      || typeof receipt.event_id !== 'string'
      || expected.get(receipt.event_id) !== receipt.payload_sha256
      || typeof receipt.receipt_id !== 'string' || !SAFE_ID.test(receipt.receipt_id)
      || typeof receipt.accepted_at !== 'string' || !Number.isFinite(Date.parse(receipt.accepted_at))
      || receipts.has(receipt.event_id)) {
      throw new Error('e-Mate enterprise task audit receipt is invalid')
    }
    receipts.set(receipt.event_id, receipt)
  }
  if (receipts.size !== expected.size) throw new Error('e-Mate enterprise task audit receipt set is incomplete')
  return receipts
}

function createAuditService(
  ctx,
  bindingsTable,
  outboxTable,
  auditProvider,
  taskBindingsTable,
  taskOutboxTable,
  taskAuditProvider,
) {
  const bindings = new Map(bindingsTable.entries())
  const outbox = new Map(outboxTable.entries())
  const taskBindings = new Map(taskBindingsTable.entries())
  const taskOutbox = new Map(taskOutboxTable.entries())
  const firstResponseTasks = new Set(
    [...taskOutbox.values()].filter(record => record.payload.type === 'FIRST_RESPONSE').map(record => record.payload.taskId),
  )
  const taskScenarios = new Map()
  const blockedTasks = new Set()
  for (const record of [...taskOutbox.values()].sort((left, right) => left.source_seq - right.source_seq)) {
    const taskId = record?.payload?.taskId
    const scenario = record?.payload?.scenario
    if (typeof taskId !== 'string' || !TASK_SCENARIOS.has(scenario)) continue
    const existing = taskScenarios.get(taskId)
    if (existing === undefined) taskScenarios.set(taskId, scenario)
    else if (existing !== scenario) {
      taskScenarios.set(taskId, 'GENERAL')
      blockedTasks.add(taskId)
      ctx.logger?.warn?.(`e-Mate task audit scenario conflict: ${taskId.slice(-16)}`)
    }
  }
  const openTurns = new Map()
  const openTasks = new Map()
  const queuedBySession = new Map()
  const startupQueue = Symbol('startup')
  let flushPromise

  const enqueue = (sessionId, operation) => {
    const previous = queuedBySession.get(sessionId) ?? Promise.resolve()
    const queued = previous.then(operation, operation).catch((error) => {
      ctx.logger?.warn?.(`e-Mate audit outbox write failed: ${errorCode(error)}`)
    })
    queuedBySession.set(sessionId, queued)
    void queued.then(() => {
      if (queuedBySession.get(sessionId) === queued) queuedBySession.delete(sessionId)
    })
    return queued
  }
  const drain = sessionId => queuedBySession.get(String(sessionId)) ?? Promise.resolve()
  const drainAll = () => Promise.all([...queuedBySession.values()])

  const blockTask = (taskId, code, queue = startupQueue) => {
    blockedTasks.add(taskId)
    taskScenarios.set(taskId, 'GENERAL')
    for (const record of taskOutbox.values()) {
      if (record.payload.taskId !== taskId || record.status !== 'pending') continue
      const blocked = { ...record, status: 'blocked', last_error_code: code }
      taskOutbox.set(record.event_id, blocked)
      enqueue(queue, () => taskOutboxTable.put(record.event_id, blocked))
    }
  }
  for (const taskId of blockedTasks) blockTask(taskId, 'task-scenario-conflict')

  const captureBinding = (sessionId, turn, step, provider, model, context) => {
    const key = bindingKey(sessionId, turn, step)
    const binding = {
      schema_version: 1,
      account_subject_sha256: context.account_subject_sha256,
      policy_revision: context.policy_revision,
      policy_receipt_id: context.policy_receipt_id,
      policy_sha256: context.policy_sha256,
      provider,
      model,
      created_at: new Date().toISOString(),
    }
    const existing = bindings.get(key)
    if (existing !== undefined) {
      const { created_at: _existingAt, ...existingIdentity } = existing
      const { created_at: _nextAt, ...nextIdentity } = binding
      if (canonicalJson(existingIdentity) !== canonicalJson(nextIdentity)) {
        ctx.logger?.warn?.(`e-Mate audit binding conflict: ${sha256(key).slice(0, 16)}`)
      }
      return
    }
    bindings.set(key, binding)
    enqueue(String(sessionId), () => bindingsTable.put(key, binding))
  }

  const captureEvent = (sessionId, event) => {
    const key = bindingKey(sessionId, event.data.turn, event.data.step)
    const fact = createUsageFact(sessionId, event, bindings.get(key))
    if (fact === undefined) {
      ctx.logger?.warn?.(`e-Mate audit rejected malformed usage: ${sha256(`${String(sessionId)}:${event?.seq}`).slice(0, 16)}`)
      return
    }
    const existing = outbox.get(fact.fact_id)
    if (existing !== undefined) {
      if (existing.payload_sha256 !== fact.payload_sha256) {
        ctx.logger?.warn?.(`e-Mate audit fact conflict: ${fact.fact_id.slice(-16)}`)
      }
      return
    }
    outbox.set(fact.fact_id, fact)
    enqueue(String(sessionId), () => outboxTable.put(fact.fact_id, fact))
  }

  const storeTaskFact = (sessionId, event, binding, scenario) => {
    let fact = createTaskAuditFact(sessionId, event, event.type, binding, event.turn, scenario)
    if (fact === undefined) return false
    if (blockedTasks.has(fact.payload.taskId)) {
      fact = { ...fact, status: 'blocked', last_error_code: 'task-conflict' }
    }
    if (event.type === 'FIRST_RESPONSE') {
      if (firstResponseTasks.has(fact.payload.taskId)) return true
      firstResponseTasks.add(fact.payload.taskId)
    }
    const existing = taskOutbox.get(fact.event_id)
    if (existing === undefined) {
      taskOutbox.set(fact.event_id, fact)
      enqueue(String(sessionId), () => taskOutboxTable.put(fact.event_id, fact))
    } else if (existing.payload_sha256 !== fact.payload_sha256) {
      ctx.logger?.warn?.(`e-Mate task audit fact conflict: ${fact.event_id.slice(-16)}`)
      blockTask(fact.payload.taskId, 'task-event-conflict', String(sessionId))
    }
    return true
  }

  const sealTask = (key, task) => {
    const { taskId } = taskIdentity(task.sessionId, task.turn)
    const scenario = task.persistedScenario ?? 'GENERAL'
    taskScenarios.set(taskId, scenario)
    const binding = taskBindings.get(key)
    let rejected = false
    for (const event of task.events) {
      if (!storeTaskFact(task.sessionId, event, binding, scenario)) rejected = true
    }
    if (rejected && task.live) {
      ctx.logger?.warn?.(`e-Mate task audit binding unavailable: ${sha256(key).slice(0, 16)}`)
    }
    if (openTurns.get(String(task.sessionId)) === task.turn) openTurns.delete(String(task.sessionId))
    openTasks.delete(key)
  }

  const makeTaskRoom = () => {
    while (openTasks.size >= MAX_OPEN_TASKS) {
      const oldest = openTasks.entries().next().value
      if (oldest === undefined) break
      sealTask(oldest[0], oldest[1])
    }
  }

  const captureTaskEvent = (sessionId, event, live) => {
    let turn = event.turn ?? openTurns.get(String(sessionId))
    if (event.type === 'RECEIVED') {
      if (!Number.isSafeInteger(turn) || turn < 1) return
      const previousTurn = openTurns.get(String(sessionId))
      if (previousTurn !== undefined && previousTurn !== turn) {
        const previousKey = taskBindingKey(sessionId, previousTurn)
        const previous = openTasks.get(previousKey)
        if (previous !== undefined) sealTask(previousKey, previous)
      }
      openTurns.set(String(sessionId), turn)
      const key = taskBindingKey(sessionId, turn)
      if (live && !taskBindings.has(key)) {
        const subject = ctx.emateIdentity.localAccountSubject?.()
        if (typeof subject === 'string' && subject.length > 0) {
          const binding = {
            schema_version: 1,
            account_subject_sha256: sha256(subject),
            created_at: new Date(event.time).toISOString(),
          }
          taskBindings.set(key, binding)
          enqueue(String(sessionId), () => taskBindingsTable.put(key, binding))
        }
      }
    }
    if (!Number.isSafeInteger(turn) || turn < 1) return
    const key = taskBindingKey(sessionId, turn)
    const { taskId } = taskIdentity(sessionId, turn)
    let task = openTasks.get(key)
    if (task === undefined) {
      makeTaskRoom()
      task = {
        sessionId: String(sessionId),
        turn,
        live,
        events: [],
        persistedScenario: taskScenarios.get(taskId),
        firstToolScenario: undefined,
        skillScenarios: new Set(),
      }
      openTasks.set(key, task)
    }
    const terminal = event.type === 'COMPLETED' || event.type === 'FAILED' || event.type === 'CANCELLED'
    const binding = taskBindings.get(key)
    if (task.persistedScenario !== undefined) {
      if (event.type !== undefined && !storeTaskFact(sessionId, { ...event, turn }, binding, task.persistedScenario) && live) {
        ctx.logger?.warn?.(`e-Mate task audit binding unavailable: ${sha256(key).slice(0, 16)}`)
      }
      if (terminal) {
        openTurns.delete(String(sessionId))
        openTasks.delete(key)
      }
      return
    }
    if (event.scenario !== undefined) {
      if (event.signal === 'skill') task.skillScenarios.add(event.scenario)
      else if (task.firstToolScenario === undefined) task.firstToolScenario = event.scenario
    }
    if (event.type !== undefined) task.events.push({ seq: event.seq, time: event.time, turn, type: event.type })
    if (!terminal) {
      if (task.events.length >= MAX_TASK_EVENTS) sealTask(key, task)
      return
    }
    const scenario = task.skillScenarios.size > 1
      ? 'GENERAL'
      : task.skillScenarios.size === 1
        ? task.skillScenarios.values().next().value
        : task.firstToolScenario ?? 'GENERAL'
    taskScenarios.set(taskId, scenario)
    let rejected = false
    for (const candidate of task.events) {
      if (!storeTaskFact(sessionId, candidate, binding, scenario)) rejected = true
    }
    if (rejected && live) ctx.logger?.warn?.(`e-Mate task audit binding unavailable: ${sha256(key).slice(0, 16)}`)
    openTurns.delete(String(sessionId))
    openTasks.delete(key)
  }

  const sealSession = (sessionId) => {
    const id = String(sessionId)
    for (const [key, task] of openTasks) {
      if (task.sessionId === id) sealTask(key, task)
    }
    openTurns.delete(id)
  }

  const status = () => {
    const counts = { pending: 0, delivered: 0, blocked: 0 }
    let pendingTokens = 0
    let deliveredTokens = 0
    for (const record of outbox.values()) {
      counts[record.status] += 1
      if (record.status === 'pending') pendingTokens += record.payload.total_tokens
      if (record.status === 'delivered') deliveredTokens += record.payload.total_tokens
    }
    let taskPending = 0
    let taskDelivered = 0
    let taskBlocked = 0
    for (const record of taskOutbox.values()) {
      if (record.status === 'pending') taskPending += 1
      if (record.status === 'delivered') taskDelivered += 1
      if (record.status === 'blocked') taskBlocked += 1
    }
    return {
      schema_version: 1,
      ...counts,
      pending_tokens: pendingTokens,
      delivered_tokens: deliveredTokens,
      task_events_pending: taskPending,
      task_events_delivered: taskDelivered,
      task_events_blocked: taskBlocked,
    }
  }

  const flushUsageCore = async (force) => {
    await drainAll()
    if (typeof auditProvider?.upload !== 'function') return { ...status(), delivered_now: 0, provider_ready: false }
    const now = Date.now()
    const pending = [...outbox.values()]
      .filter(record => record.status === 'pending' && (force || Date.parse(record.next_attempt_at) <= now))
      .sort((left, right) => left.payload.provider_created_at.localeCompare(right.payload.provider_created_at))
      .slice(0, BATCH_SIZE)
    if (pending.length === 0) return { ...status(), delivered_now: 0, provider_ready: true }
    try {
      const receipts = validateUploadReceipts(await auditProvider.upload(pending.map(record => ({
        fact_id: record.fact_id,
        payload_sha256: record.payload_sha256,
        payload: structuredClone(record.payload),
      }))), pending)
      for (const record of pending) {
        const receipt = receipts.get(record.fact_id)
        const { last_error_code: _lastError, ...withoutError } = record
        const delivered = {
          ...withoutError,
          status: 'delivered',
          receipt_id: receipt.receipt_id,
          delivered_at: new Date(Date.parse(receipt.accepted_at)).toISOString(),
          next_attempt_at: record.next_attempt_at,
        }
        outbox.set(record.fact_id, delivered)
        await outboxTable.put(record.fact_id, delivered)
        await Promise.resolve(ctx.emateModelPolicy.markAuditDelivered?.(record.fact_id, receipt.accepted_at))
          .catch(error => ctx.logger?.warn?.(`e-Mate local quota audit reconciliation failed: ${errorCode(error)}`))
      }
      return { ...status(), delivered_now: pending.length, provider_ready: true }
    } catch (error) {
      const code = errorCode(error)
      for (const record of pending) {
        const attempts = record.attempt_count + 1
        const deferred = {
          ...record,
          attempt_count: attempts,
          next_attempt_at: new Date(now + Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8))).toISOString(),
          last_error_code: code,
        }
        outbox.set(record.fact_id, deferred)
        await outboxTable.put(record.fact_id, deferred)
      }
      return { ...status(), delivered_now: 0, provider_ready: true, error_code: code }
    }
  }


  const flushTaskCore = async (force) => {
    await drainAll()
    if (typeof taskAuditProvider?.upload !== 'function') {
      return { delivered_now: 0, provider_ready: false }
    }
    const now = Date.now()
    const pending = [...taskOutbox.values()]
      .filter(record => record.status === 'pending' && (force || Date.parse(record.next_attempt_at) <= now))
      .sort((left, right) => left.payload.occurredAt.localeCompare(right.payload.occurredAt) || left.source_seq - right.source_seq)
      .slice(0, BATCH_SIZE)
    if (pending.length === 0) return { delivered_now: 0, provider_ready: true }
    let deliveredNow = 0
    const upload = async (records) => {
      const current = records.filter(record => taskOutbox.get(record.event_id)?.status === 'pending')
      if (current.length === 0) return
      try {
        const receipts = validateTaskUploadReceipts(await taskAuditProvider.upload(current.map(record => ({
          event_id: record.event_id,
          account_subject_sha256: record.account_subject_sha256,
          payload_sha256: record.payload_sha256,
          payload: structuredClone(record.payload),
        }))), current)
        for (const record of current) {
          const receipt = receipts.get(record.event_id)
          const { last_error_code: _lastError, ...withoutError } = record
          const delivered = {
            ...withoutError,
            status: 'delivered',
            receipt_id: receipt.receipt_id,
            delivered_at: new Date(Date.parse(receipt.accepted_at)).toISOString(),
          }
          taskOutbox.set(record.event_id, delivered)
          await taskOutboxTable.put(record.event_id, delivered)
          deliveredNow += 1
        }
      } catch (error) {
        if (!isTaskAuditUploadRejection(error)) throw error
        if (current.length > 1) {
          const middle = Math.floor(current.length / 2)
          await upload(current.slice(0, middle))
          await upload(current.slice(middle))
          return
        }
        const record = current[0]
        const blocked = {
          ...record,
          status: 'blocked',
          attempt_count: record.attempt_count + 1,
          last_error_code: error.kind === 'conflict' ? 'task-conflict' : 'invalid-audit-task',
        }
        taskOutbox.set(record.event_id, blocked)
        await taskOutboxTable.put(record.event_id, blocked)
      }
    }
    try {
      await upload(pending)
      return { delivered_now: deliveredNow, provider_ready: true }
    } catch (error) {
      const code = errorCode(error)
      for (const original of pending) {
        const record = taskOutbox.get(original.event_id)
        if (record?.status !== 'pending') continue
        const attempts = record.attempt_count + 1
        const deferred = {
          ...record,
          attempt_count: attempts,
          next_attempt_at: new Date(now + Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 8))).toISOString(),
          last_error_code: code,
        }
        taskOutbox.set(record.event_id, deferred)
        await taskOutboxTable.put(record.event_id, deferred)
      }
      return { delivered_now: deliveredNow, provider_ready: true, error_code: code }
    }
  }

  const flush = ({ force = false } = {}) => {
    if (flushPromise !== undefined) return flushPromise
    flushPromise = (async () => {
      const usage = await flushUsageCore(force)
      const tasks = await flushTaskCore(force)
      return { ...usage, task_delivered_now: tasks.delivered_now, task_provider_ready: tasks.provider_ready }
    })().finally(() => { flushPromise = undefined })
    return flushPromise
  }

  return { captureBinding, captureEvent, captureTaskEvent, drain, drainAll, flush, sealSession, status }
}

function captureHistoricalEvent(service, sessionId, event) {
  service.captureEvent(sessionId, event)
  const taskEvent = taskEventEnvelope(event)
  if (taskEvent === undefined) return
  // Durable events do not carry the Loader/Skill winner that executed then.
  const { candidate: _candidate, ...safeEvent } = taskEvent
  service.captureTaskEvent(sessionId, safeEvent, false)
}

async function inspectBounded(ctx, sessionId) {
  const controller = new AbortController()
  const cancel = ctx.timeout(
    () => controller.abort(new Error('e-Mate audit session inspection timed out')),
    BACKFILL_SESSION_TIMEOUT_MS,
  )
  try {
    return await ctx.sessionPersistence.inspect(sessionId, controller.signal)
  } finally {
    cancel()
  }
}

async function backfill(ctx, service, isLive) {
  for (const header of await ctx.sessionPersistence.list()) {
    if (isLive(header.id)) continue
    let inspection
    try {
      inspection = await inspectBounded(ctx, header.id)
    } catch (error) {
      ctx.logger?.warn?.(`e-Mate audit session inspection failed: ${errorCode(error)}`)
      continue
    }
    if (isLive(header.id)) continue
    for (const event of inspection.events) captureHistoricalEvent(service, header.id, event)
    // A non-repairing backend or live snapshot may not expose a terminal; retain
    // facts fail-closed but release its classifier before scanning the next session.
    service.sealSession(header.id)
    await service.drain(header.id)
  }
}

export async function apply(ctx, config = {}) {
  const flushIntervalMs = config.flushIntervalMs ?? 30_000
  if (!Number.isSafeInteger(flushIntervalMs) || flushIntervalMs < 1_000 || flushIntervalMs > 3_600_000) {
    throw new Error('e-Mate audit flush interval is invalid')
  }
  const { defineDomain, domainTable, z } = await loadTargetStorageDomain(
    config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json'),
  )
  const binding = z.object({
    schema_version: z.literal(1),
    account_subject_sha256: z.string().regex(SHA256),
    policy_revision: z.number().int().min(1),
    policy_receipt_id: z.string().regex(SAFE_ID),
    policy_sha256: z.string().regex(SHA256),
    provider: z.string().regex(SAFE_ID),
    model: z.string().regex(SAFE_ID),
    created_at: z.iso.datetime(),
  })
  const outbox = z.object({
    schema_version: z.literal(1),
    fact_id: z.string().regex(/^auditfact_[0-9a-f]{64}$/u),
    payload: z.json(),
    payload_sha256: z.string().regex(SHA256),
    status: z.enum(['pending', 'blocked', 'delivered']),
    attempt_count: z.number().int().min(0),
    next_attempt_at: z.iso.datetime(),
    last_error_code: z.string().max(128).optional(),
    receipt_id: z.string().regex(SAFE_ID).optional(),
    delivered_at: z.iso.datetime().optional(),
  })
  const taskBinding = z.object({
    schema_version: z.literal(1),
    account_subject_sha256: z.string().regex(SHA256),
    created_at: z.iso.datetime(),
  })
  const taskOutbox = z.object({
    schema_version: z.literal(1),
    event_id: z.string().regex(/^taskevent_[0-9a-f]{64}$/u),
    account_subject_sha256: z.string().regex(SHA256),
    payload: z.json(),
    payload_sha256: z.string().regex(SHA256),
    source_seq: z.number().int().min(0),
    status: z.enum(['pending', 'blocked', 'delivered']),
    attempt_count: z.number().int().min(0),
    next_attempt_at: z.iso.datetime(),
    last_error_code: z.string().max(128).optional(),
    receipt_id: z.string().regex(SAFE_ID).optional(),
    delivered_at: z.iso.datetime().optional(),
  })
  const domain = await ctx.storageDomain.open(defineDomain({
    name: 'emate_audit',
    version: 1,
    tables: { bindings: domainTable(binding), outbox: domainTable(outbox) },
  }))
  ctx.effect(() => () => domain.close(), 'emate.audit: close target storage domain')
  const taskDomain = await ctx.storageDomain.open(defineDomain({
    name: 'emate_task_audit',
    version: 1,
    tables: { bindings: domainTable(taskBinding), outbox: domainTable(taskOutbox) },
  }))
  ctx.effect(() => () => taskDomain.close(), 'emate.audit: close task audit storage domain')
  const service = createAuditService(
    ctx,
    domain.table('bindings'),
    domain.table('outbox'),
    config.auditProvider ?? { upload: records => ctx.emateIdentity.uploadAudit(records) },
    taskDomain.table('bindings'),
    taskDomain.table('outbox'),
    config.taskAuditProvider ?? { upload: records => ctx.emateIdentity.uploadTaskAudit(records) },
  )
  ctx.provide('emateAudit', service)
  ctx.on('agent/request', async (payload, next) => {
    const request = await next()
    try {
      const context = await ctx.emateModelPolicy.auditContext(request.model)
      service.captureBinding(payload.agent.id, payload.turn, payload.step, request.provider, request.model, context)
    } catch (error) {
      ctx.logger?.warn?.(`e-Mate audit could not bind request policy: ${errorCode(error)}`)
    }
    return request
  })
  const controllers = new Map()
  const controllerFor = (sessionId) => {
    const id = String(sessionId)
    let controller = controllers.get(id)
    if (controller === undefined) {
      controller = { id, seenThrough: -1, tail: Promise.resolve() }
      controllers.set(id, controller)
    }
    return controller
  }
  const queue = (controller, operation) => {
    controller.tail = controller.tail.then(operation, operation).catch((error) => {
      ctx.logger?.warn?.(`e-Mate task audit capture failed: ${errorCode(error)}`)
    })
  }
  const queueHistory = (session, before = Number.POSITIVE_INFINITY) => {
    const controller = controllerFor(session.id)
    if (!Array.isArray(session.events)) return controller
    for (const event of session.events) {
      if (!Number.isSafeInteger(event?.seq) || event.seq <= controller.seenThrough || event.seq >= before) continue
      controller.seenThrough = event.seq
      queue(controller, () => captureHistoricalEvent(service, controller.id, event))
    }
    return controller
  }
  ctx.on('session/event', (session, event) => {
    const taskEvent = taskEventEnvelope(event)
    if (taskEvent === undefined && (event?.type !== 'assistant/message' || event.data?.usage === undefined)) return
    const controller = queueHistory(session, event?.seq)
    if (!Number.isSafeInteger(event?.seq) || event.seq <= controller.seenThrough) return
    controller.seenThrough = event.seq
    service.captureEvent(controller.id, event)
    if (taskEvent === undefined) return
    // Start registry observation at the event boundary. Only applying the
    // redacted result waits for prior events in this Session.
    const resolved = resolveTaskEvent(ctx, session, taskEvent)
    queue(controller, async () => service.captureTaskEvent(controller.id, await resolved, true))
  })
  ctx.on('session/flush', async (session) => {
    if (typeof session?.id !== 'string') return
    const controller = queueHistory(session)
    for (;;) {
      const tail = controller.tail
      await tail
      if (tail === controller.tail) break
    }
    await service.drain(controller.id)
  })
  ctx.on('session/disposed', (session) => {
    const id = String(session.id)
    const controller = controllers.get(id)
    if (controller === undefined) return
    void controller.tail.then(async () => {
      service.sealSession(id)
      await service.drain(id)
    }).catch((error) => {
      ctx.logger?.warn?.(`e-Mate task audit disposal failed: ${errorCode(error)}`)
    }).finally(() => {
      if (controllers.get(id) === controller) controllers.delete(id)
    })
  })
  const flushSafely = () => {
    void service.flush().catch((error) => {
      ctx.logger?.warn?.(`e-Mate audit flush failed: ${errorCode(error)}`)
    })
  }
  ctx.interval(flushSafely, flushIntervalMs)
  ctx.effect(() => ctx.connection.rpc.handle(
    AUDIT_CHANNEL,
    async (endpoint, payload) => {
      if (endpoint !== 'audit.status' || !isRecord(payload) || Object.keys(payload).length !== 0) {
        return { ok: false, error: { code: 'bad-request', message: 'unknown e-Mate audit endpoint', details: { issues: [] } } }
      }
      return { ok: true, value: service.status() }
    },
    { authority: 'loopback' },
  ), 'emate.audit: target-native RPC channel')
  void Promise.resolve().then(() => backfill(
    ctx,
    service,
    sessionId => controllers.has(String(sessionId)) || ctx.agents?.get?.(sessionId) !== undefined,
  )).then(flushSafely, error => {
    ctx.logger?.warn?.(`e-Mate audit backfill failed: ${errorCode(error)}`)
  })
}
