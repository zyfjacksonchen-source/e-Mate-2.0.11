import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { loadTargetStorageDomain } from './target-runtime.js'

export const name = 'emate-model-policy'
export const inject = ['apiProxy', 'connection', 'credentials', 'settings', 'storageDomain', 'llm', 'emateIdentity']
export const MODEL_POLICY_CHANNEL = '/emate.modelPolicy'

const CHAT_MODELS = new Map([
  ['gpt-5.6-luna', { reasoning_effort: 'max' }],
  ['gpt-5.6-sol', { reasoning_effort: 'medium' }],
  ['deepseek', { reasoning_effort: 'max' }],
  ['doubao-seed-2-0-pro-260215', { reasoning_effort: 'medium' }],
])
const IMAGE_MODELS = new Set(['gpt-image-2-pro', 'gpt-image-2'])
const MANAGED_MODELS = new Set([...CHAT_MODELS.keys(), ...IMAGE_MODELS])
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u
const RECEIPT = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/u
const MAX_VALIDITY_MS = 32 * 24 * 60 * 60 * 1_000
const REFRESH_MS = 30_000

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

function publicPolicy(policy) {
  const { account_subject: _subject, ...value } = policy
  return structuredClone(value)
}

export function validateModelPolicy(value, accountSubject, now = Date.now()) {
  const keys = [
    'account_subject', 'allowed_model_ids', 'default_chat_model_id', 'default_chat_reasoning_effort',
    'expires_at', 'image_fallback_upstream_model_id', 'image_primary_model_id', 'issued_at',
    'receipt_id', 'revision', 'schema_version',
  ]
  if (!isRecord(value)
    || Object.keys(value).sort().join(',') !== keys.sort().join(',')
    || value.schema_version !== 1
    || typeof value.account_subject !== 'string' || !SUBJECT.test(value.account_subject)
    || value.account_subject !== accountSubject
    || !Number.isSafeInteger(value.revision) || value.revision < 1
    || typeof value.receipt_id !== 'string' || !RECEIPT.test(value.receipt_id)
    || typeof value.default_chat_model_id !== 'string'
    || !CHAT_MODELS.has(value.default_chat_model_id)
    || value.default_chat_reasoning_effort !== CHAT_MODELS.get(value.default_chat_model_id).reasoning_effort
    || value.image_primary_model_id !== 'gpt-image-2-pro'
    || value.image_fallback_upstream_model_id !== 'gpt-image-2'
    || !Array.isArray(value.allowed_model_ids)
    || value.allowed_model_ids.length < 1
    || value.allowed_model_ids.length > MANAGED_MODELS.size
    || new Set(value.allowed_model_ids).size !== value.allowed_model_ids.length
    || value.allowed_model_ids.some(model => typeof model !== 'string' || !MANAGED_MODELS.has(model))
    || !value.allowed_model_ids.includes(value.default_chat_model_id)
    || value.allowed_model_ids.includes('gpt-image-2') && !value.allowed_model_ids.includes('gpt-image-2-pro')) {
    throw new Error('e-Mate enterprise model policy is invalid')
  }
  const issuedAt = Date.parse(value.issued_at)
  const expiresAt = Date.parse(value.expires_at)
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)
    || issuedAt > now + 5 * 60_000
    || expiresAt <= now
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_VALIDITY_MS) {
    throw new Error('e-Mate enterprise model policy lifetime is invalid')
  }
  const policy = {
    schema_version: 1,
    account_subject: value.account_subject,
    revision: value.revision,
    allowed_model_ids: [...value.allowed_model_ids].sort(),
    default_chat_model_id: value.default_chat_model_id,
    default_chat_reasoning_effort: value.default_chat_reasoning_effort,
    image_primary_model_id: value.image_primary_model_id,
    image_fallback_upstream_model_id: value.image_fallback_upstream_model_id,
    issued_at: new Date(issuedAt).toISOString(),
    expires_at: new Date(expiresAt).toISOString(),
    receipt_id: value.receipt_id,
  }
  return {
    ...policy,
    policy_sha256: createHash('sha256').update(canonicalJson(policy)).digest('hex'),
  }
}

function policyModelId(model) {
  return model === 'deepseek-v4-flash' ? 'deepseek' : model
}

function allowed(policy, model) {
  return policy.allowed_model_ids.includes(policyModelId(model))
}

function filterGroups(groups, policy) {
  return groups
    .map(group => ({ ...group, models: group.models.filter(model => allowed(policy, model.id)) }))
    .filter(group => group.models.length > 0)
}

function unavailableCatalog(value, message) {
  return {
    ...value,
    groups: [],
    failures: [...value.failures, { id: 'e-mate-policy', name: 'e-Mate', message }],
  }
}

function modelUnavailable(request, provider, model, message = `Model "${model}" is not allowed by the current e-Mate policy.`) {
  return {
    rpcId: request.rpcId,
    result: { ok: false, error: { code: 'model-unavailable', message, details: { provider, model } } },
  }
}

const RUNTIME_REASONING = new Map([
  ['gpt-5.6-luna', { max: 'high' }],
  ['gpt-5.6-sol', { medium: 'medium' }],
  ['deepseek-v4-flash', { max: 'max' }],
  ['doubao-seed-2-0-pro-260215', { medium: 'medium' }],
])
const RUNTIME_CREDENTIAL_REFS = new Set([
  'E_MATE_MODEL_KEY_GPT',
  'E_MATE_MODEL_KEY_DEEPSEEK',
  'E_MATE_MODEL_KEY_DOUBAO',
])

function hasNativeRuntimeProjection(ctx) {
  const value = ctx.settings?.get?.('llm-pi-ai')
  if (!isRecord(value) || !isRecord(value.providers)) return false
  const providers = Object.values(value.providers)
  return providers.length > 0 && providers.every(provider => isRecord(provider)
    && typeof provider.apiKeyEnv === 'string'
    && RUNTIME_CREDENTIAL_REFS.has(provider.apiKeyEnv))
}

async function projectRuntimeModels(ctx, models) {
  if (!Array.isArray(models) || models.length < 1 || models.length > CHAT_MODELS.size) {
    throw new Error('e-Mate runtime model projection is invalid')
  }
  const credentials = new Map()
  const providers = {}
  for (const model of models) {
    if (!isRecord(model)
      || typeof model.id !== 'string'
      || typeof model.provider !== 'string'
      || typeof model.credentialRef !== 'string'
      || typeof model.api !== 'string'
      || typeof model.upstreamModelId !== 'string'
      || typeof model.upstreamBaseUrl !== 'string'
      || typeof model.upstreamApiKey !== 'string'
      || typeof model.label !== 'string'
      || !Array.isArray(model.input)
      || !Number.isSafeInteger(model.contextWindow)
      || !Number.isSafeInteger(model.maxTokens)
      || model.id === 'deepseek' && model.upstreamModelId !== 'deepseek-v4-flash'
      || !RUNTIME_CREDENTIAL_REFS.has(model.credentialRef)
      || !RUNTIME_REASONING.has(model.upstreamModelId)
      || !['openai-responses', 'openai-completions'].includes(model.api)) {
      throw new Error('e-Mate runtime model projection is invalid')
    }
    const credential = credentials.get(model.credentialRef)
    if (credential !== undefined && credential !== model.upstreamApiKey) {
      throw new Error('e-Mate runtime model routes sharing a credential reference disagree')
    }
    credentials.set(model.credentialRef, model.upstreamApiKey)
    const existing = providers[model.provider]
    if (existing !== undefined
      && (existing.api !== model.api
        || existing.baseURL !== model.upstreamBaseUrl
        || existing.apiKeyEnv !== model.credentialRef)) {
      throw new Error('e-Mate runtime model routes sharing a provider disagree')
    }
    const provider = existing ?? {
      displayName: 'e-Mate',
      apiKeyEnv: model.credentialRef,
      api: model.api,
      baseURL: model.upstreamBaseUrl,
      models: [],
    }
    provider.models.push({
      id: model.upstreamModelId,
      name: model.label,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      input: [...model.input],
      reasoningEfforts: RUNTIME_REASONING.get(model.upstreamModelId),
    })
    providers[model.provider] = provider
  }

  const previous = new Map(await Promise.all([...credentials.keys()].map(async ref => [ref, await ctx.credentials.resolve(ref)])))
  try {
    await Promise.all([...credentials].map(([ref, value]) => ctx.credentials.set(ref, value)))
    const next = { providers }
    if (canonicalJson(ctx.settings.get('llm-pi-ai')) !== canonicalJson(next)) {
      await ctx.settings.replace('llm-pi-ai', next)
    }
  } catch (error) {
    await Promise.allSettled([...previous].map(([ref, hit]) => hit === undefined
      ? ctx.credentials.unset(ref)
      : ctx.credentials.set(ref, hit.value)))
    throw error
  }
  await Promise.allSettled([...RUNTIME_CREDENTIAL_REFS]
    .filter(ref => !credentials.has(ref))
    .map(ref => ctx.credentials.unset(ref)))
}

function createService(ctx, table) {
  let cached = [...table.entries()].find(([key]) => key === 'active')?.[1]
  let runtimeReady = typeof ctx.emateIdentity.modelRuntimePolicy !== 'function' || hasNativeRuntimeProjection(ctx)
  let lastRefresh = 0
  let refreshing

  const identityState = async () => {
    const state = await ctx.emateIdentity.state()
    if (!isRecord(state)
      || state.authenticated !== true
      || state.workspace_unlocked !== true
      || typeof state.account_subject !== 'string'
      || !SUBJECT.test(state.account_subject)) {
      throw new Error('e-Mate model policy requires an authenticated, agreement-unlocked account')
    }
    return state
  }

  const validCached = (subject, now) => {
    try {
      if (!isRecord(cached) || typeof cached.policy_sha256 !== 'string') return undefined
      const { policy_sha256: expected, ...raw } = cached
      const policy = validateModelPolicy(raw, subject, now)
      return policy.policy_sha256 === expected ? policy : undefined
    } catch {
      return undefined
    }
  }

  const refresh = async ({ force = false } = {}) => {
    const state = await identityState()
    const now = Date.now()
    const current = validCached(state.account_subject, now)
    if (!force && current !== undefined && now - lastRefresh < REFRESH_MS) return current
    if (refreshing !== undefined) {
      const result = await refreshing.promise
      return result.account_subject === state.account_subject ? result : refresh({ force: true })
    }
    const promise = (async () => {
      try {
        const runtime = typeof ctx.emateIdentity.modelRuntimePolicy === 'function'
          ? await ctx.emateIdentity.modelRuntimePolicy()
          : { policy: await ctx.emateIdentity.modelPolicy() }
        const policy = validateModelPolicy(runtime.policy, state.account_subject, now)
        if (runtime.models !== undefined) {
          await projectRuntimeModels(ctx, runtime.models)
          runtimeReady = true
        }
        await table.put('active', policy)
        cached = policy
        lastRefresh = now
        return policy
      } catch (error) {
        const fallback = validCached(state.account_subject, now)
        if (fallback !== undefined) {
          lastRefresh = now
          return fallback
        }
        throw error
      }
    })()
    refreshing = { subject: state.account_subject, promise }
    try {
      return await promise
    } finally {
      if (refreshing?.promise === promise) refreshing = undefined
    }
  }

  const activeCached = () => {
    if (!runtimeReady) throw new Error('e-Mate native runtime model projection is not ready')
    const subject = typeof ctx.emateIdentity.localAccountSubject === 'function'
      ? ctx.emateIdentity.localAccountSubject()
      : cached?.account_subject
    const policy = typeof subject === 'string' ? validCached(subject, Date.now()) : undefined
    if (policy === undefined) throw new Error('e-Mate model policy cache is unavailable or expired')
    if (Date.now() - lastRefresh >= REFRESH_MS && refreshing === undefined) {
      void refresh().catch(error => ctx.logger?.warn?.('e-Mate model policy background refresh failed', error))
    }
    return policy
  }

  return {
    refresh,
    async current() { return publicPolicy(await refresh()) },
    auditContext(model) {
      const policy = activeCached()
      if (!allowed(policy, model)) throw new Error(`Model "${model}" is not allowed by the current e-Mate policy.`)
      return {
        account_subject_sha256: createHash('sha256').update(policy.account_subject).digest('hex'),
        policy_revision: policy.revision,
        policy_receipt_id: policy.receipt_id,
        policy_sha256: policy.policy_sha256,
      }
    },
    assertModel(model) {
      const policy = activeCached()
      if (!allowed(policy, model)) throw new Error(`Model "${model}" is not allowed by the current e-Mate policy.`)
      return publicPolicy(policy)
    },
  }
}

function installApiPolicy(ctx, service) {
  const originalSessionModels = ctx.apiProxy.sessions.models
  const originalSelectModel = ctx.apiProxy.sessions.selectModel
  const originalLlmModels = ctx.apiProxy.llm.models

  const sessionModels = async (request) => {
    const response = await originalSessionModels(request)
    if (!response.result.ok) return response
    try {
      const policy = await service.refresh()
      const currentAllowed = allowed(policy, response.result.value.current.model)
      return {
        ...response,
        result: {
          ok: true,
          value: {
            ...response.result.value,
            routable: response.result.value.routable && currentAllowed,
            groups: filterGroups(response.result.value.groups, policy),
          },
        },
      }
    } catch (error) {
      return {
        ...response,
        result: {
          ok: true,
          value: {
            ...unavailableCatalog(response.result.value, error instanceof Error ? error.message : String(error)),
            routable: false,
          },
        },
      }
    }
  }

  const selectModel = async (request) => {
    try {
      await service.assertModel(request.payload.model)
    } catch (error) {
      return modelUnavailable(
        request,
        request.payload.provider,
        request.payload.model,
        error instanceof Error ? error.message : String(error),
      )
    }
    return originalSelectModel(request)
  }

  const llmModels = async (request) => {
    const response = await originalLlmModels(request)
    if (!response.result.ok) return response
    try {
      const policy = await service.refresh()
      return {
        ...response,
        result: { ok: true, value: { ...response.result.value, groups: filterGroups(response.result.value.groups, policy) } },
      }
    } catch (error) {
      return {
        ...response,
        result: {
          ok: true,
          value: unavailableCatalog(response.result.value, error instanceof Error ? error.message : String(error)),
        },
      }
    }
  }

  ctx.apiProxy.sessions.models = sessionModels
  ctx.apiProxy.sessions.selectModel = selectModel
  ctx.apiProxy.llm.models = llmModels
  return () => {
    if (ctx.apiProxy.sessions.models === sessionModels) ctx.apiProxy.sessions.models = originalSessionModels
    if (ctx.apiProxy.sessions.selectModel === selectModel) ctx.apiProxy.sessions.selectModel = originalSelectModel
    if (ctx.apiProxy.llm.models === llmModels) ctx.apiProxy.llm.models = originalLlmModels
  }
}

export async function apply(ctx, config = {}) {
  const { defineDomain, domainTable, z } = await loadTargetStorageDomain(
    config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json'),
  )
  const policyRecord = z.object({
    schema_version: z.literal(1),
    account_subject: z.string().regex(SUBJECT),
    revision: z.number().int().min(1),
    allowed_model_ids: z.array(z.enum([...MANAGED_MODELS])).min(1).max(MANAGED_MODELS.size),
    default_chat_model_id: z.enum([...CHAT_MODELS.keys()]),
    default_chat_reasoning_effort: z.enum(['max', 'medium']),
    image_primary_model_id: z.literal('gpt-image-2-pro'),
    image_fallback_upstream_model_id: z.literal('gpt-image-2'),
    issued_at: z.iso.datetime(),
    expires_at: z.iso.datetime(),
    receipt_id: z.string().regex(RECEIPT),
    policy_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  const domain = await ctx.storageDomain.open(defineDomain({
    name: 'emate_model_policy',
    version: 1,
    tables: { active: domainTable(policyRecord) },
  }))
  ctx.effect(() => () => domain.close(), 'emate.modelPolicy: close target storage domain')
  const service = createService(ctx, domain.table('active'))
  ctx.provide('emateModelPolicy', service)
  ctx.effect(() => installApiPolicy(ctx, service), 'emate.modelPolicy: target ApiProxy policy projection')
  ctx.on('agent/request', async (_payload, next) => {
    const request = await next()
    await service.assertModel(request.model)
    return request
  })
  ctx.on('llm/stream', (options, next) => (async function* () {
    await service.assertModel(options.model)
    yield* next()
  })())
  ctx.effect(() => ctx.connection.rpc.handle(
    MODEL_POLICY_CHANNEL,
    async (endpoint, payload) => {
      if (endpoint !== 'policy.current' || !isRecord(payload) || Object.keys(payload).length !== 0) {
        return { ok: false, error: { code: 'bad-request', message: 'unknown e-Mate model policy endpoint', details: { issues: [] } } }
      }
      return { ok: true, value: await service.current() }
    },
    { authority: 'loopback' },
  ), 'emate.modelPolicy: target-native RPC channel')
}
