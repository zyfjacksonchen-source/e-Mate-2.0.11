import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { loadTargetStorageDomain } from './target-runtime.js'

export const name = 'emate-audit'
export const inject = ['connection', 'sessionPersistence', 'storageDomain', 'timer', 'emateModelPolicy', 'emateIdentity']
export const AUDIT_CHANNEL = '/emate.audit'

const SHA256 = /^[0-9a-f]{64}$/u
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u
const MAX_TOKEN_BUCKET = 1_000_000_000_000
const BATCH_SIZE = 64

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

function createAuditService(ctx, bindingsTable, outboxTable, auditProvider) {
  const bindings = new Map(bindingsTable.entries())
  const outbox = new Map(outboxTable.entries())
  let queued = Promise.resolve()
  let flushPromise

  const enqueue = (operation) => {
    queued = queued.then(operation, operation).catch((error) => {
      ctx.logger?.warn?.(`e-Mate audit outbox write failed: ${errorCode(error)}`)
    })
    return queued
  }

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
    enqueue(() => bindingsTable.put(key, binding))
  }

  const captureEvent = (sessionId, event) => {
    if (event?.type !== 'assistant/message' || event.data?.usage === undefined) return
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
    enqueue(() => outboxTable.put(fact.fact_id, fact))
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
    return { schema_version: 1, ...counts, pending_tokens: pendingTokens, delivered_tokens: deliveredTokens }
  }

  const flushCore = async (force) => {
    await queued
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

  const flush = ({ force = false } = {}) => {
    if (flushPromise !== undefined) return flushPromise
    flushPromise = flushCore(force).finally(() => { flushPromise = undefined })
    return flushPromise
  }

  return { captureBinding, captureEvent, drain: () => queued, flush, status }
}

async function backfill(ctx, service) {
  for (const header of await ctx.sessionPersistence.list()) {
    const { events } = await ctx.sessionPersistence.readFrom(header.id, 0)
    for (const event of events) service.captureEvent(header.id, event)
  }
  await service.drain()
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
  const domain = await ctx.storageDomain.open(defineDomain({
    name: 'emate_audit',
    version: 1,
    tables: { bindings: domainTable(binding), outbox: domainTable(outbox) },
  }))
  ctx.effect(() => () => domain.close(), 'emate.audit: close target storage domain')
  const service = createAuditService(
    ctx,
    domain.table('bindings'),
    domain.table('outbox'),
    config.auditProvider ?? { upload: records => ctx.emateIdentity.uploadAudit(records) },
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
  ctx.on('session/event', (session, event) => { service.captureEvent(session.id, event) })
  ctx.on('session/flush', () => service.drain())
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
  void backfill(ctx, service).then(
    flushSafely,
    error => { ctx.logger?.warn?.(`e-Mate audit backfill failed: ${errorCode(error)}`) },
  )
}
