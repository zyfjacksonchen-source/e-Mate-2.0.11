import { randomUUID } from 'node:crypto'
import {
  agreementBundleSha256,
  agreementDocuments,
} from './agreements.js'

const SESSION_REF = 'E_MATE_ENTERPRISE_SESSION'
export const MODEL_SESSION_REF = 'E_MATE_MODEL_SESSION_TOKEN'
const MAX_JSON_BYTES = 2 * 1024 * 1024
const REFRESH_EARLY_MS = 60_000
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u
const REFRESH_TOKEN = /^emate_rt_[A-Za-z0-9_-]{43}$/u
const CHAT_MODELS = [
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'deepseek',
  'doubao-seed-2-0-pro-260215',
]

type Credentials = {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

type Fetch = typeof fetch

type EnterpriseConfig = {
  authBaseUrl: string
  modelBaseUrl: string
  clientId: string
  organization: string
}

type Session = {
  schemaVersion: 1
  sessionId: string
  accessToken: string
  refreshToken: string
  expiresAt: string
  identity: {
    tenantId: string
    userId: string
    displayName: string
    roles: string[]
    weeklyTokenLimit: number
  }
  modelGateway: {
    baseUrl: string
    sessionToken: string
    expiresAt: string
    usageKeyId: string
    usagePublicKey: string
    allowedModelIds: string[]
  }
}

type ConsentPolicy = {
  schemaVersion: 1
  agreementId: string
  agreementVersion: string
  disclaimerVersion: string
  contentHash: string
}

type ConsentAcceptance = ConsentPolicy & {
  acceptanceId: string
  userId: string
  acceptedAt: string
  clientVersion: string
  locale: string
}

type ConsentStatus = {
  schemaVersion: 1
  policy: ConsentPolicy
  required: boolean
  acceptance: ConsentAcceptance | null
}

type StoredSession = {
  schema_version: 1
  remember_login: boolean
  received_at: string
  session: Session
  consent?: ConsentStatus
}

type ProviderOptions = {
  credentials: Credentials
  enterprise: EnterpriseConfig
  fetchImplementation?: Fetch
  now?: () => number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function baseUrl(value: string, label: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`e-Mate enterprise ${label} URL is invalid`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`e-Mate enterprise ${label} URL must be HTTPS without credentials, query, or fragment`)
  }
  return url.toString().replace(/\/+$/u, '')
}

function endpoint(root: string, path: string): URL {
  return new URL(`${root}/${path.replace(/^\/+/, '')}`)
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`e-Mate enterprise ${label} is invalid`)
  }
  return new Date(Date.parse(value)).toISOString()
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new Error(`e-Mate enterprise ${label} is invalid`)
  }
  return value
}

function text(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /\p{Cc}/u.test(value)) {
    throw new Error(`e-Mate enterprise ${label} is invalid`)
  }
  return value
}

function modelIds(value: unknown): string[] {
  if (!Array.isArray(value)
    || value.length < 1
    || value.length > 20
    || value.some(id => typeof id !== 'string' || !MODEL_ID.test(id))
    || new Set(value).size !== value.length) {
    throw new Error('e-Mate enterprise allowed model ids are invalid')
  }
  return [...value]
}

function session(value: unknown, expectedModelRoot: string): Session {
  if (!isRecord(value)
    || !exact(value, [
      'schemaVersion', 'sessionId', 'accessToken', 'refreshToken', 'expiresAt', 'identity', 'modelGateway',
    ])
    || value.schemaVersion !== 1
    || !isRecord(value.identity)
    || !exact(value.identity, ['tenantId', 'userId', 'displayName', 'roles', 'weeklyTokenLimit'])
    || !isRecord(value.modelGateway)
    || !exact(value.modelGateway, [
      'baseUrl', 'sessionToken', 'expiresAt', 'usageKeyId', 'usagePublicKey', 'allowedModelIds',
    ])) {
    throw new Error('e-Mate enterprise session response is invalid')
  }
  const accessToken = text(value.accessToken, 'access token', 16_384)
  const refreshToken = text(value.refreshToken, 'refresh token', 256)
  const modelToken = text(value.modelGateway.sessionToken, 'model session token', 16_384)
  const accessExpiry = timestamp(value.expiresAt, 'access expiry')
  const modelExpiry = timestamp(value.modelGateway.expiresAt, 'model expiry')
  if (!JWT.test(accessToken) || !JWT.test(modelToken) || !REFRESH_TOKEN.test(refreshToken)
    || Date.parse(modelExpiry) > Date.parse(accessExpiry)
    || baseUrl(text(value.modelGateway.baseUrl, 'model gateway URL', 2_048), 'model gateway') !== expectedModelRoot
    || !Array.isArray(value.identity.roles)
    || value.identity.roles.length < 1
    || value.identity.roles.some(role => !['TENANT_ADMIN', 'AUDIT_ADMIN', 'MEMBER'].includes(String(role)))
    || !Number.isSafeInteger(value.identity.weeklyTokenLimit)
    || Number(value.identity.weeklyTokenLimit) < 1) {
    throw new Error('e-Mate enterprise session response is invalid')
  }
  return {
    schemaVersion: 1,
    sessionId: identifier(value.sessionId, 'session id'),
    accessToken,
    refreshToken,
    expiresAt: accessExpiry,
    identity: {
      tenantId: identifier(value.identity.tenantId, 'tenant id'),
      userId: identifier(value.identity.userId, 'user id'),
      displayName: text(value.identity.displayName, 'display name', 160),
      roles: value.identity.roles.map(role => String(role)),
      weeklyTokenLimit: Number(value.identity.weeklyTokenLimit),
    },
    modelGateway: {
      baseUrl: expectedModelRoot,
      sessionToken: modelToken,
      expiresAt: modelExpiry,
      usageKeyId: identifier(value.modelGateway.usageKeyId, 'usage key id'),
      usagePublicKey: text(value.modelGateway.usagePublicKey, 'usage public key', 8_192),
      allowedModelIds: modelIds(value.modelGateway.allowedModelIds),
    },
  }
}

function consentPolicy(value: unknown): ConsentPolicy {
  if (!isRecord(value)
    || !exact(value, ['schemaVersion', 'agreementId', 'agreementVersion', 'disclaimerVersion', 'contentHash'])
    || value.schemaVersion !== 1
    || typeof value.contentHash !== 'string'
    || !/^[0-9a-f]{64}$/u.test(value.contentHash)) {
    throw new Error('e-Mate enterprise consent policy is invalid')
  }
  return {
    schemaVersion: 1,
    agreementId: identifier(value.agreementId, 'agreement id'),
    agreementVersion: text(value.agreementVersion, 'agreement version', 64),
    disclaimerVersion: text(value.disclaimerVersion, 'disclaimer version', 64),
    contentHash: value.contentHash,
  }
}

function consentAcceptance(value: unknown, policy: ConsentPolicy): ConsentAcceptance {
  if (!isRecord(value)
    || !exact(value, [
      'schemaVersion', 'agreementId', 'agreementVersion', 'disclaimerVersion', 'contentHash',
      'acceptanceId', 'userId', 'acceptedAt', 'clientVersion', 'locale',
    ])) {
    throw new Error('e-Mate enterprise consent acceptance is invalid')
  }
  const acceptedPolicy = consentPolicy({
    schemaVersion: value.schemaVersion,
    agreementId: value.agreementId,
    agreementVersion: value.agreementVersion,
    disclaimerVersion: value.disclaimerVersion,
    contentHash: value.contentHash,
  })
  if (JSON.stringify(acceptedPolicy) !== JSON.stringify(policy)) {
    throw new Error('e-Mate enterprise consent acceptance policy is invalid')
  }
  return {
    ...acceptedPolicy,
    acceptanceId: identifier(value.acceptanceId, 'consent acceptance id'),
    userId: identifier(value.userId, 'consent user id'),
    acceptedAt: timestamp(value.acceptedAt, 'consent accepted time'),
    clientVersion: text(value.clientVersion, 'consent client version', 64),
    locale: text(value.locale, 'consent locale', 32),
  }
}

function consentStatus(value: unknown): ConsentStatus {
  if (!isRecord(value)
    || !exact(value, ['schemaVersion', 'policy', 'required', 'acceptance'])
    || value.schemaVersion !== 1
    || typeof value.required !== 'boolean') {
    throw new Error('e-Mate enterprise consent status is invalid')
  }
  const policy = consentPolicy(value.policy)
  const acceptance = value.acceptance === null ? null : consentAcceptance(value.acceptance, policy)
  if (value.required !== (acceptance === null)) throw new Error('e-Mate enterprise consent status is invalid')
  return { schemaVersion: 1, policy, required: value.required, acceptance }
}

function storedSession(value: unknown, modelRoot: string): StoredSession {
  if (!isRecord(value)
    || !['consent,received_at,remember_login,schema_version,session', 'received_at,remember_login,schema_version,session']
      .includes(Object.keys(value).sort().join(','))
    || value.schema_version !== 1
    || typeof value.remember_login !== 'boolean') {
    throw new Error('e-Mate stored enterprise session is invalid')
  }
  return {
    schema_version: 1,
    remember_login: value.remember_login,
    received_at: timestamp(value.received_at, 'session received time'),
    session: session(value.session, modelRoot),
    ...(value.consent === undefined ? {} : { consent: consentStatus(value.consent) }),
  }
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_JSON_BYTES)) {
    throw new Error(`e-Mate enterprise ${label} response exceeds its boundary`)
  }
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength > MAX_JSON_BYTES || (declared !== null && body.byteLength !== Number(declared))) {
    throw new Error(`e-Mate enterprise ${label} response exceeds its boundary`)
  }
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/json') throw new Error(`e-Mate enterprise ${label} response is not JSON`)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  } catch {
    throw new Error(`e-Mate enterprise ${label} response contains invalid JSON`)
  }
  if (!response.ok) {
    const code = isRecord(value) && isRecord(value.error) && typeof value.error.code === 'string'
      ? value.error.code
      : `HTTP_${response.status}`
    const messages: Record<string, string> = {
      INVALID_GRANT: '账号或密码错误',
      APPROVAL_REQUIRED: '账号正在等待管理员审核',
      POLICY_REQUIRED: '管理员尚未配置周用量和可用模型',
      SESSION_REVOKED: '登录已失效，请重新登录',
      TOKEN_REUSED: '登录刷新凭据已失效，请重新登录',
      INVALID_CHALLENGE: '验证码无效或已过期',
      ACCOUNT_EXISTS: '该账号已存在',
    }
    throw new Error(messages[code] ?? `e-Mate enterprise ${label} failed (${code})`)
  }
  return value
}

function registration(value: unknown) {
  if (!isRecord(value)
    || !exact(value, ['schemaVersion', 'registrationId', 'status'])
    || value.schemaVersion !== 1
    || value.status !== 'PENDING_APPROVAL') {
    throw new Error('e-Mate enterprise registration receipt is invalid')
  }
  return { schema_version: 1, registration_id: identifier(value.registrationId, 'registration id'), status: 'pending_approval' }
}

function mutationReceipt(value: unknown, password: boolean) {
  if (!isRecord(value)
    || !exact(value, password
      ? ['schemaVersion', 'receiptId', 'reauthenticationRequired']
      : ['schemaVersion', 'receiptId', 'reauthenticationRequired'])
    || value.schemaVersion !== 1
    || value.reauthenticationRequired !== password) {
    throw new Error('e-Mate enterprise mutation receipt is invalid')
  }
  return {
    receipt_id: identifier(value.receiptId, 'mutation receipt id'),
    ...(password ? { reauthentication_required: true } : {}),
  }
}

function policyFor(value: StoredSession) {
  const managed = value.session.modelGateway.allowedModelIds.filter(id => [
    ...CHAT_MODELS,
    'gpt-image-2-pro',
  ].includes(id))
  const chat = CHAT_MODELS.find(id => managed.includes(id))
  if (chat === undefined) throw new Error('e-Mate enterprise policy contains no chat model')
  const allowed = new Set(managed)
  if (allowed.has('gpt-image-2-pro')) {
    allowed.add('gpt-image-2')
  }
  return {
    schema_version: 1,
    account_subject: `${value.session.identity.tenantId}:${value.session.identity.userId}`,
    revision: Math.max(1, Date.parse(value.received_at)),
    allowed_model_ids: [...allowed],
    default_chat_model_id: chat,
    default_chat_reasoning_effort: chat === 'gpt-5.6-luna' || chat === 'deepseek' ? 'max' : 'medium',
    image_primary_model_id: 'gpt-image-2-pro',
    image_fallback_upstream_model_id: 'gpt-image-2',
    issued_at: value.received_at,
    expires_at: value.session.expiresAt,
    receipt_id: value.session.sessionId,
  }
}

export function createEnterpriseIdentityProvider(options: ProviderOptions) {
  const authRoot = baseUrl(options.enterprise.authBaseUrl, 'auth')
  const modelRoot = baseUrl(options.enterprise.modelBaseUrl, 'model')
  const clientId = identifier(options.enterprise.clientId, 'client id')
  const organization = text(options.enterprise.organization, 'organization', 160).trim()
  const request = options.fetchImplementation ?? fetch
  const now = options.now ?? Date.now
  let current: StoredSession | undefined
  let initialized = false
  let refreshing: Promise<StoredSession> | undefined

  const call = async (root: string, path: string, init: RequestInit, label: string) => responseJson(await request(
    endpoint(root, path),
    { ...init, redirect: 'error', headers: { accept: 'application/json', ...init.headers } },
  ), label)

  const clear = async () => {
    current = undefined
    await Promise.all([
      options.credentials.unset(SESSION_REF),
      options.credentials.unset(MODEL_SESSION_REF),
    ])
  }

  const save = async (value: StoredSession) => {
    await options.credentials.set(SESSION_REF, JSON.stringify(value))
    try {
      await options.credentials.set(MODEL_SESSION_REF, value.session.modelGateway.sessionToken)
      current = value
    } catch (error) {
      await options.credentials.unset(SESSION_REF).catch(() => undefined)
      throw error
    }
  }

  const load = async () => {
    if (current !== undefined) return current
    if (initialized) return undefined
    initialized = true
    const hit = await options.credentials.resolve(SESSION_REF)
    if (hit === undefined) return undefined
    let value: StoredSession
    try {
      value = storedSession(JSON.parse(hit.value), modelRoot)
    } catch {
      await clear().catch(() => undefined)
      throw new Error('e-Mate stored enterprise session is invalid; sign in again')
    }
    if (!value.remember_login || Date.parse(value.session.expiresAt) <= now()) {
      await clear()
      return undefined
    }
    await options.credentials.set(MODEL_SESSION_REF, value.session.modelGateway.sessionToken)
    current = value
    return value
  }

  const refresh = async (value: StoredSession) => {
    if (refreshing !== undefined) return refreshing
    refreshing = (async () => {
      const refreshed = session(await call(authRoot, '/v1/auth/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          refreshToken: value.session.refreshToken,
          refreshRequestId: `refresh-${randomUUID()}`,
        }),
      }, 'session refresh'), modelRoot)
      const next: StoredSession = {
        schema_version: 1,
        remember_login: value.remember_login,
        received_at: new Date(now()).toISOString(),
        session: refreshed,
        ...(value.consent === undefined ? {} : { consent: value.consent }),
      }
      await save(next)
      return next
    })()
    try {
      return await refreshing
    } catch (error) {
      if (Date.parse(value.session.expiresAt) <= now()) await clear().catch(() => undefined)
      throw error
    } finally {
      refreshing = undefined
    }
  }

  const active = async (requireFreshModel: boolean) => {
    const value = await load()
    if (value === undefined) return undefined
    if (Date.parse(value.session.expiresAt) <= now()) {
      await clear()
      return undefined
    }
    if (Date.parse(value.session.modelGateway.expiresAt) <= now() + REFRESH_EARLY_MS) {
      try {
        return await refresh(value)
      } catch (error) {
        if (requireFreshModel) throw error
      }
    }
    return value
  }

  const modelCall = (value: StoredSession, path: string, init: RequestInit, label: string) => {
    return call(modelRoot, path, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${value.session.modelGateway.sessionToken}`,
      },
    }, label)
  }

  const authorized = async (path: string, init: RequestInit, label: string) => {
    const value = await active(true)
    if (value === undefined) throw new Error('e-Mate login is required')
    return modelCall(value, path, init, label)
  }

  const liveConsent = async (value: StoredSession) => {
    try {
      const status = consentStatus(await modelCall(value, '/v1/consents/current', { method: 'GET' }, 'consent status'))
      if (status.policy.contentHash !== agreementBundleSha256) {
        throw new Error('e-Mate enterprise agreement policy does not match this installed version')
      }
      const next = { ...value, consent: status }
      await save(next)
      return status
    } catch (error) {
      if (value.consent?.policy.contentHash === agreementBundleSha256) return value.consent
      throw error
    }
  }

  const provider = {
    async bootstrap() {
      const value = await active(false)
      if (value === undefined) return { authenticated: false, workspace_unlocked: false }
      const consent = await liveConsent(value)
      return {
        authenticated: true,
        workspace_unlocked: !consent.required,
        display_name: value.session.identity.displayName,
        account_status: 'active',
        weekly_token_limit: value.session.identity.weeklyTokenLimit,
        account_subject: `${value.session.identity.tenantId}:${value.session.identity.userId}`,
        agreement_receipt_id: consent.acceptance?.acceptanceId,
      }
    },
    async issueRegistrationChallenge() {
      const value = await call(authRoot, '/v1/auth/registration/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientId }),
      }, 'registration challenge')
      if (!isRecord(value)
        || !exact(value, ['schemaVersion', 'challengeId', 'imageDataUrl', 'expiresAt'])
        || value.schemaVersion !== 1) {
        throw new Error('e-Mate enterprise registration challenge is invalid')
      }
      return {
        schema_version: 1,
        challenge_id: identifier(value.challengeId, 'registration challenge id'),
        image_data_url: text(value.imageDataUrl, 'registration challenge image', 350_000),
        expires_at: timestamp(value.expiresAt, 'registration challenge expiry'),
      }
    },
    async register(input: Record<string, string>) {
      return registration(await call(authRoot, '/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          organization,
          account: input.account,
          realName: input.real_name,
          password: input.password,
          challengeId: input.challenge_id,
          verificationCode: input.verification_code,
        }),
      }, 'registration'))
    },
    async login(input: { identifier: string; password: string; remember_login: boolean }) {
      const authenticated = session(await call(authRoot, '/v1/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          organization,
          user: input.identifier,
          password: input.password,
        }),
      }, 'login'), modelRoot)
      await save({
        schema_version: 1,
        remember_login: input.remember_login,
        received_at: new Date(now()).toISOString(),
        session: authenticated,
      })
    },
    async logout(input: { client_request_id: string }) {
      const value = await active(false)
      if (value === undefined) throw new Error('e-Mate login is required')
      const receipt = mutationReceipt(await call(authRoot, '/v1/auth/logout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          refreshToken: value.session.refreshToken,
          clientRequestId: input.client_request_id,
        }),
      }, 'logout'), false)
      await clear()
      return receipt
    },
    async changePassword(input: { current_password: string; new_password: string; client_request_id: string }) {
      const value = await active(false)
      if (value === undefined) throw new Error('e-Mate login is required')
      const receipt = mutationReceipt(await call(authRoot, '/v1/auth/password/change', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId,
          refreshToken: value.session.refreshToken,
          clientRequestId: input.client_request_id,
          currentPassword: input.current_password,
          newPassword: input.new_password,
        }),
      }, 'password change'), true)
      await clear()
      return receipt
    },
    async acceptAgreements() {
      const value = await active(true)
      if (value === undefined) throw new Error('e-Mate login is required')
      const status = consentStatus(await modelCall(value, '/v1/consents/current', { method: 'GET' }, 'consent status'))
      if (status.policy.contentHash !== agreementBundleSha256) {
        throw new Error('e-Mate enterprise agreement policy does not match this installed version')
      }
      const acceptance = consentAcceptance(await modelCall(value, '/v1/consents/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...status.policy,
          termsAccepted: true,
          policyRead: true,
          lawfulUseConfirmed: true,
          clientVersion: '2.0.7',
          locale: 'zh-CN',
        }),
      }, 'consent acceptance'), status.policy)
      await save({ ...value, consent: { schemaVersion: 1, policy: status.policy, required: false, acceptance } })
    },
    async modelPolicy() {
      const value = await active(true)
      if (value === undefined) throw new Error('e-Mate login is required')
      return policyFor(value)
    },
    async usage(timezone: string) {
      const value = await authorized('/v1/usage/current', { method: 'GET' }, 'account usage')
      if (!isRecord(value)
        || !exact(value, ['schemaVersion', 'totalTokens', 'weekStartedAt', 'calculatedAt'])
        || value.schemaVersion !== 1
        || !Number.isSafeInteger(value.totalTokens)
        || Number(value.totalTokens) < 0) {
        throw new Error('e-Mate enterprise account usage is invalid')
      }
      return {
        schema_version: 1,
        scope: 'account',
        timezone,
        week: { total_tokens: Number(value.totalTokens) },
        week_started_at: timestamp(value.weekStartedAt, 'usage week start'),
        calculated_at: timestamp(value.calculatedAt, 'usage calculation time'),
      }
    },
    async authenticatedRequest(url: URL | string, init: RequestInit = {}) {
      const target = new URL(url)
      if (target.username || target.password || target.search || target.hash
        || !target.toString().startsWith(`${modelRoot}/`)) {
        throw new Error('e-Mate authenticated request target is outside the managed enterprise root')
      }
      const value = await active(true)
      if (value === undefined) throw new Error('e-Mate login is required')
      const headers = new Headers(init.headers)
      if (headers.has('authorization')) throw new Error('e-Mate authenticated request cannot override authorization')
      headers.set('authorization', `Bearer ${value.session.modelGateway.sessionToken}`)
      return request(target, { ...init, redirect: 'error', headers })
    },
    async dispose() {
      if (current?.remember_login === false) await clear()
    },
  }

  return provider
}

export const enterpriseAgreementVersions = Object.freeze({
  agreement: agreementDocuments.find(document => document.id === 'e-mate-user-agreement')?.version,
  disclaimer: agreementDocuments.find(document => document.id === 'yixin-enterprise-disclaimer')?.version,
})
