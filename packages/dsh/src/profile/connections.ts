import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { loadTargetTools } from './target-runtime.js'

export const name = 'emate-connections'
export const inject = ['credentials', 'connection', 'webServer', 'emateCapabilities', 'tools', 'systemPrompt']
export const CONNECTIONS_CHANNEL = '/emate.connections'

const CONNECTION_SETUP_TOOL = 'e_mate_connection_setup'
const AGENT_CONNECTIONS = new Map([
  ['feishu', '飞书'],
  ['tencent-docs', '腾讯文档'],
  ['wechat', '微信'],
])

const WEIXIN_QR_BASE_URL = 'https://ilinkai.weixin.qq.com/'
const WEIXIN_QR_TTL_MS = 5 * 60_000
const WEIXIN_CREDENTIAL_REFS = Object.freeze({
  token: 'EMATE_WECHAT_BOT_TOKEN',
  account: 'EMATE_WECHAT_ACCOUNT_ID',
  owner: 'EMATE_WECHAT_OWNER_USER_ID',
  baseUrl: 'EMATE_WECHAT_BASE_URL',
})
const ACTIVE_QR_STATES = new Set(['pending', 'scanned', 'needs-verification'])
const QR_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const FEISHU_DEVICE_URL = 'https://accounts.feishu.cn/oauth/v1/device_authorization'
const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token'
const TENCENT_MCP_URL = 'https://docs.qq.com/openapi/mcp'
const TENCENT_RESOURCE_METADATA_URL = `${TENCENT_MCP_URL}/.well-known/oauth-protected-resource`
const TENCENT_AUTH_SERVER = 'https://docs.qq.com'
const TENCENT_AUTH_METADATA_URL = `${TENCENT_AUTH_SERVER}/.well-known/oauth-authorization-server`
const TENCENT_AUTHORIZATION_URL = `${TENCENT_AUTH_SERVER}/scenario/open-claw.html?authType=2`
const TENCENT_REGISTRATION_URL = `${TENCENT_MCP_URL}/oauth/register`
const TENCENT_TOKEN_URL = `${TENCENT_MCP_URL}/oauth/token`
const TENCENT_CALLBACK_PATH = '/emate.oauth.tencent-docs/callback'
const DEVICE_ATTEMPT_TTL_MAX_MS = 15 * 60_000
const ACTIVE_OAUTH_STATES = new Set(['pending'])
const DEVICE_CODE = /^[\x21-\x7E]{1,4096}$/u
const USER_CODE = /^[\x21-\x7E]{1,64}$/u
const OAUTH_TOKEN = /^[\x21-\x7E]{1,16384}$/u
const OAUTH_CREDENTIAL_REFS = Object.freeze({
  feishu: {
    access: 'EMATE_FEISHU_USER_ACCESS_TOKEN',
    refresh: 'EMATE_FEISHU_REFRESH_TOKEN',
    metadata: 'EMATE_FEISHU_OAUTH_METADATA',
  },
  'tencent-docs': {
    access: 'EMATE_TENCENT_DOCS_TOKEN',
    refresh: 'EMATE_TENCENT_DOCS_REFRESH_TOKEN',
    metadata: 'EMATE_TENCENT_DOCS_OAUTH_METADATA',
    client: 'EMATE_TENCENT_DOCS_OAUTH_CLIENT_ID',
    clientRedirect: 'EMATE_TENCENT_DOCS_OAUTH_REDIRECT_URI',
  },
})


const definitions = [
  {
    id: 'feishu',
    title: '飞书',
    summary: '连接飞书消息、文档与云空间。',
    order: 50,
    fields: [
      { ref: 'EMATE_FEISHU_APP_ID', label: 'App ID', secret: false },
      { ref: 'EMATE_FEISHU_APP_SECRET', label: 'App Secret', secret: true },
    ],
    oauth: true,
    pending: '官方用户授权已保存在本机；消息适配器完成真实连接验收前不会启用。',
  },
  {
    id: 'tencent-docs',
    title: '腾讯文档',
    summary: '通过官方远程 MCP 连接腾讯文档。',
    order: 60,
    fields: [],
    oauth: true,
    pending: '官方 MCP OAuth 已保存在本机；CredentialRef MCP 适配完成前不会启用。',
  },
  {
    id: 'wechat',
    title: '微信',
    summary: '使用设备扫码连接微信消息。',
    order: 70,
    fields: [],
    qr: true,
    blocked: '微信扫码授权可用；消息运行适配完成真实收发验收前不会启用。',
  },
  {
    id: 'dingtalk',
    title: '钉钉',
    summary: '连接钉钉 Stream 消息通道。',
    order: 80,
    fields: [
      { ref: 'EMATE_DINGTALK_CLIENT_ID', label: 'Client ID', secret: false },
      { ref: 'EMATE_DINGTALK_CLIENT_SECRET', label: 'Client Secret', secret: true },
    ],
    pending: '凭据已保存在本机；官方 Stream 适配完成真实连接验收前不会启用。',
  },
]

function badRequest(message) {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every(key => allowed.includes(key))
}

function connectionSetupId(value) {
  if (!exactKeys(value, ['connection_id'])
    || typeof value.connection_id !== 'string'
    || !AGENT_CONNECTIONS.has(value.connection_id)) {
    throw new Error('connection setup requires one supported connection_id')
  }
  return value.connection_id
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isWeixinHost(hostname) {
  const value = hostname.toLowerCase().replace(/\.$/u, '')
  return value === 'weixin.qq.com' || value.endsWith('.weixin.qq.com')
}

function trustedWeixinUrl(value) {
  const raw = text(value)
  if (raw === null) throw new Error('invalid Weixin URL')
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
  if (url.protocol !== 'https:' || !isWeixinHost(url.hostname) || (url.port !== '' && url.port !== '443')) {
    throw new Error('untrusted Weixin URL')
  }
  url.username = ''
  url.password = ''
  url.hash = ''
  return url
}

function trustedWeixinBaseUrl(value) {
  const url = trustedWeixinUrl(value)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.toString()
}

async function readBoundedJson(response) {
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('response body is missing')
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 65_536) {
      await reader.cancel()
      throw new Error('Weixin response is too large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder().decode(bytes))
}

async function boundedJson(response) {
  if (!response.ok) throw new Error('Weixin request failed')
  return readBoundedJson(response)
}

async function requestWeixin(fetchImpl, { baseUrl = WEIXIN_QR_BASE_URL, endpoint, method, body, timeoutMs, signal }) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(new URL(endpoint, trustedWeixinBaseUrl(baseUrl)), {
      method,
      headers: {
        'iLink-App-Id': 'bot',
        'iLink-App-ClientVersion': String((2 << 16) | (4 << 8) | 6),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: controller.signal,
    })
    return await boundedJson(response)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function publicQr(attempt) {
  return {
    connection_id: 'wechat',
    attempt_id: attempt.id,
    state: attempt.state,
    expires_at: attempt.expiresAt,
    ...(attempt.qrCodeDataUrl === undefined ? {} : { qr_code_data_url: attempt.qrCodeDataUrl }),
    ...(attempt.state === 'needs-verification' ? { verification_required: true } : {}),
    detail: attempt.detail,
  }
}

async function restoreCredential(credentials, ref, previous) {
  if (previous?.value) await credentials.set(ref, previous.value)
  else await credentials.unset(ref)
}

async function storeWeixinAuthorization(credentials, response) {
  const values = new Map([
    [WEIXIN_CREDENTIAL_REFS.token, text(response.bot_token)],
    [WEIXIN_CREDENTIAL_REFS.account, text(response.ilink_bot_id)],
    [WEIXIN_CREDENTIAL_REFS.owner, text(response.ilink_user_id)],
    [WEIXIN_CREDENTIAL_REFS.baseUrl, trustedWeixinBaseUrl(response.baseurl ?? WEIXIN_QR_BASE_URL)],
  ])
  if ([...values.values()].some(value => value === null)) throw new Error('incomplete Weixin authorization')
  const previous = new Map()
  const written = []
  try {
    for (const [ref, value] of values) {
      previous.set(ref, await credentials.resolve(ref).catch(() => undefined))
      await credentials.set(ref, value)
      written.push(ref)
    }
  } catch (error) {
    await Promise.allSettled(written.reverse().map(ref => restoreCredential(credentials, ref, previous.get(ref))))
    throw error
  }
}

export function createWeixinQrProvider(credentials, { fetchImpl = fetch, encodeQr = value => QRCode.toDataURL(value, {
  type: 'image/png', errorCorrectionLevel: 'M', margin: 2, width: 320,
}), now = Date.now } = {}) {
  const attempts = new Map()

  const getAttempt = (id) => {
    const attempt = attempts.get(id)
    if (attempt === undefined) throw new Error('unknown QR attempt')
    if (now() >= attempt.expiresAt && ACTIVE_QR_STATES.has(attempt.state)) {
      attempt.state = 'expired'
      attempt.detail = '二维码已过期，请重新生成。'
      attempt.qrcode = undefined
      attempt.qrCodeDataUrl = undefined
    }
    return attempt
  }

  return Object.freeze({
    async begin(signal) {
      for (const attempt of attempts.values()) {
        if (ACTIVE_QR_STATES.has(attempt.state)) {
          attempt.state = 'cancelled'
          attempt.detail = '扫码授权已取消。'
          attempt.qrcode = undefined
          attempt.qrCodeDataUrl = undefined
        }
      }
      const response = await requestWeixin(fetchImpl, {
        method: 'POST',
        endpoint: 'ilink/bot/get_bot_qrcode?bot_type=3',
        body: { local_token_list: [] },
        timeoutMs: 10_000,
        signal,
      })
      const qrcode = text(response?.qrcode)
      const verificationUrl = trustedWeixinUrl(response?.qrcode_img_content).toString()
      if (qrcode === null) throw new Error('Weixin QR token is missing')
      const qrCodeDataUrl = await encodeQr(verificationUrl)
      if (typeof qrCodeDataUrl !== 'string' || qrCodeDataUrl.length > 1_000_000 || !QR_DATA_URL.test(qrCodeDataUrl)) {
        throw new Error('invalid QR image')
      }
      const attempt = {
        id: randomUUID(),
        baseUrl: WEIXIN_QR_BASE_URL,
        state: 'pending',
        expiresAt: now() + WEIXIN_QR_TTL_MS,
        qrcode,
        qrCodeDataUrl,
        detail: '请使用微信扫描二维码。',
      }
      if (attempts.size >= 8) attempts.delete(attempts.keys().next().value)
      attempts.set(attempt.id, attempt)
      return publicQr(attempt)
    },
    async poll(id, verifyCode, signal) {
      const attempt = getAttempt(id)
      if (!ACTIVE_QR_STATES.has(attempt.state)) return publicQr(attempt)
      const endpoint = new URL('ilink/bot/get_qrcode_status', attempt.baseUrl)
      endpoint.searchParams.set('qrcode', attempt.qrcode)
      if (verifyCode !== undefined) endpoint.searchParams.set('verify_code', verifyCode)
      const response = await requestWeixin(fetchImpl, {
        baseUrl: attempt.baseUrl,
        method: 'GET',
        endpoint: `${endpoint.pathname}${endpoint.search}`,
        timeoutMs: 35_000,
        signal,
      })
      if (response?.status === 'wait') {
        attempt.state = 'pending'
        attempt.detail = '等待微信扫码。'
      } else if (response?.status === 'scaned' || response?.status === 'scaned_but_redirect') {
        if (response.status === 'scaned_but_redirect') {
          attempt.baseUrl = trustedWeixinBaseUrl(response.redirect_host ?? attempt.baseUrl)
        }
        attempt.state = 'scanned'
        attempt.detail = '已扫码，请在手机端确认。'
      } else if (response?.status === 'need_verifycode') {
        attempt.state = 'needs-verification'
        attempt.detail = '请输入手机端显示的配对码。'
      } else if (response?.status === 'confirmed') {
        await storeWeixinAuthorization(credentials, response)
        attempt.state = 'authorized'
        attempt.detail = '微信授权已保存；消息运行适配完成前不会启用。'
        attempt.qrcode = undefined
        attempt.qrCodeDataUrl = undefined
      } else if (response?.status === 'expired') {
        attempt.state = 'expired'
        attempt.detail = '二维码已过期，请重新生成。'
        attempt.qrcode = undefined
        attempt.qrCodeDataUrl = undefined
      } else if (response?.status === 'verify_code_blocked') {
        attempt.state = 'failed'
        attempt.detail = '配对码多次错误，请重新生成二维码。'
        attempt.qrcode = undefined
        attempt.qrCodeDataUrl = undefined
      } else if (response?.status === 'binded_redirect') {
        const existing = await credentials.resolve(WEIXIN_CREDENTIAL_REFS.token).catch(() => undefined)
        attempt.state = existing?.value ? 'authorized' : 'failed'
        attempt.detail = existing?.value
          ? '微信授权已存在于本机安全凭据库。'
          : '该微信账号已绑定，但本机没有可恢复的授权。'
        attempt.qrcode = undefined
        attempt.qrCodeDataUrl = undefined
      } else {
        throw new Error('unknown Weixin QR status')
      }
      return publicQr(attempt)
    },
    cancel(id) {
      const attempt = getAttempt(id)
      if (ACTIVE_QR_STATES.has(attempt.state)) {
        attempt.state = 'cancelled'
        attempt.detail = '扫码授权已取消。'
        attempt.qrcode = undefined
        attempt.qrCodeDataUrl = undefined
      }
      return publicQr(attempt)
    },
  })
}

function trustedOAuthVerificationUrl(connectionId, value) {
  const raw = text(value)
  if (raw === null) throw new Error('OAuth verification URL is missing')
  const url = new URL(raw)
  const trusted = connectionId === 'feishu'
    ? url.origin === 'https://accounts.feishu.cn' && url.pathname === '/oauth/v1/device/verify'
    : url.origin === TENCENT_AUTH_SERVER && url.pathname === '/scenario/open-claw.html'
  if (!trusted || url.username || url.password || url.hash || (url.port !== '' && url.port !== '443')) {
    throw new Error('untrusted OAuth verification URL')
  }
  return url.toString()
}

function safeInteger(value, fallback, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback
}

async function requestOAuthJson(fetchImpl, url, init, signal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal })
    return { ok: response.ok, value: await readBoundedJson(response) }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function tokenValue(value) {
  return typeof value === 'string' && OAUTH_TOKEN.test(value) ? value : null
}

async function replaceCredentials(credentials, values) {
  const previous = new Map()
  const written = []
  try {
    for (const [ref, value] of values) {
      previous.set(ref, await credentials.resolve(ref).catch(() => undefined))
      if (value === null) await credentials.unset(ref)
      else await credentials.set(ref, value)
      written.push(ref)
    }
  } catch (error) {
    await Promise.allSettled(written.reverse().map(ref => restoreCredential(credentials, ref, previous.get(ref))))
    throw error
  }
}

async function storeOAuthAuthorization(credentials, attempt, response, now) {
  const accessToken = tokenValue(response?.access_token)
  const refreshToken = tokenValue(response?.refresh_token)
  if (accessToken === null || (response?.token_type !== undefined && response.token_type !== 'Bearer')) {
    throw new Error('invalid OAuth token response')
  }
  const expiresIn = safeInteger(response?.expires_in, 3_600, 1, 31 * 24 * 60 * 60)
  const refreshExpiresIn = refreshToken === null
    ? null
    : safeInteger(response?.refresh_token_expires_in ?? response?.refresh_expires_in, 7 * 24 * 60 * 60, 1, 366 * 24 * 60 * 60)
  const scope = typeof response?.scope === 'string' && response.scope.length <= 4096 ? response.scope : ''
  const refs = OAUTH_CREDENTIAL_REFS[attempt.connectionId]
  await replaceCredentials(credentials, new Map([
    [refs.access, accessToken],
    [refs.refresh, refreshToken],
    [refs.metadata, JSON.stringify({
      schema_version: 1,
      provider: attempt.connectionId,
      token_type: 'Bearer',
      scope,
      expires_at: new Date(now() + expiresIn * 1_000).toISOString(),
      ...(refreshExpiresIn === null ? {} : { refresh_expires_at: new Date(now() + refreshExpiresIn * 1_000).toISOString() }),
    })],
  ]))
}

function publicOAuth(attempt) {
  return {
    connection_id: attempt.connectionId,
    attempt_id: attempt.id,
    state: attempt.state,
    expires_at: attempt.expiresAt,
    ...(attempt.verificationUrl === undefined ? {} : { authorization_url: attempt.verificationUrl }),
    ...(attempt.userCode === undefined ? {} : { user_code: attempt.userCode }),
    ...(attempt.qrCodeDataUrl === undefined ? {} : { qr_code_data_url: attempt.qrCodeDataUrl }),
    detail: attempt.detail,
  }
}

function clearOAuthSecrets(attempt) {
  attempt.deviceCode = undefined
  attempt.userCode = undefined
  attempt.clientSecret = undefined
  attempt.stateNonce = undefined
  attempt.codeVerifier = undefined
  attempt.verificationUrl = undefined
  attempt.qrCodeDataUrl = undefined
}

function trustedTencentRedirectUri(value) {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.pathname !== TENCENT_CALLBACK_PATH || url.search || url.hash || url.username || url.password) {
    throw new Error('invalid Tencent Docs loopback redirect URI')
  }
  return url.toString()
}

function validateTencentMetadata(resource, authorization) {
  if (resource?.resource !== TENCENT_MCP_URL
    || !Array.isArray(resource.authorization_servers)
    || resource.authorization_servers.length !== 1
    || resource.authorization_servers[0] !== TENCENT_AUTH_SERVER
    || !Array.isArray(resource.scopes_supported)
    || !resource.scopes_supported.includes('docs:read')
    || !resource.scopes_supported.includes('docs:write')
    || !Array.isArray(resource.bearer_methods_supported)
    || !resource.bearer_methods_supported.includes('header')
    || authorization?.issuer !== TENCENT_AUTH_SERVER
    || authorization.authorization_endpoint !== TENCENT_AUTHORIZATION_URL
    || authorization.registration_endpoint !== TENCENT_REGISTRATION_URL
    || authorization.token_endpoint !== TENCENT_TOKEN_URL
    || !Array.isArray(authorization.grant_types_supported)
    || !authorization.grant_types_supported.includes('authorization_code')
    || !authorization.grant_types_supported.includes('refresh_token')
    || !Array.isArray(authorization.token_endpoint_auth_methods_supported)
    || !authorization.token_endpoint_auth_methods_supported.includes('none')
    || !Array.isArray(authorization.code_challenge_methods_supported)
    || !authorization.code_challenge_methods_supported.includes('S256')) {
    throw new Error('Tencent Docs OAuth metadata does not match the managed contract')
  }
}

export function createOfficialOAuthProvider(credentials, {
  fetchImpl = fetch,
  encodeQr = value => QRCode.toDataURL(value, {
    type: 'image/png', errorCorrectionLevel: 'M', margin: 2, width: 320,
  }),
  now = Date.now,
  tencentRedirectUri,
} = {}) {
  const attempts = new Map()

  const getAttempt = (id) => {
    const attempt = attempts.get(id)
    if (attempt === undefined) throw new Error('unknown OAuth attempt')
    if (now() >= attempt.expiresAt && ACTIVE_OAUTH_STATES.has(attempt.state)) {
      attempt.state = 'expired'
      attempt.detail = '官方授权链接已过期，请重新生成。'
      clearOAuthSecrets(attempt)
    }
    return attempt
  }

  const redirectUri = () => trustedTencentRedirectUri(tencentRedirectUri)

  const tencentClient = async (signal) => {
    const refs = OAUTH_CREDENTIAL_REFS['tencent-docs']
    const expectedRedirect = redirectUri()
    const [saved, savedRedirect] = await Promise.all([
      credentials.resolve(refs.client).catch(() => undefined),
      credentials.resolve(refs.clientRedirect).catch(() => undefined),
    ])
    if (saved?.value && DEVICE_CODE.test(saved.value) && savedRedirect?.value === expectedRedirect) return saved.value
    const [resource, authorization] = await Promise.all([
      requestOAuthJson(fetchImpl, TENCENT_RESOURCE_METADATA_URL, { method: 'GET' }, signal),
      requestOAuthJson(fetchImpl, TENCENT_AUTH_METADATA_URL, { method: 'GET' }, signal),
    ])
    if (!resource.ok || !authorization.ok) throw new Error('Tencent Docs OAuth discovery failed')
    validateTencentMetadata(resource.value, authorization.value)
    const registered = await requestOAuthJson(fetchImpl, TENCENT_REGISTRATION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'e-Mate 2.0.8',
        application_type: 'native',
        redirect_uris: [expectedRedirect],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'docs:read docs:write',
      }),
    }, signal)
    const clientId = tokenValue(registered.value?.client_id)
    if (!registered.ok || clientId === null
      || registered.value?.client_secret !== undefined
      || (registered.value?.token_endpoint_auth_method !== undefined
        && registered.value.token_endpoint_auth_method !== 'none')) {
      throw new Error('Tencent Docs OAuth client registration failed')
    }
    await replaceCredentials(credentials, new Map([
      [refs.client, clientId],
      [refs.clientRedirect, expectedRedirect],
    ]))
    return clientId
  }

  const beginFeishu = async (signal) => {
    const [app, secret] = await Promise.all([
      credentials.resolve('EMATE_FEISHU_APP_ID'),
      credentials.resolve('EMATE_FEISHU_APP_SECRET'),
    ])
    const clientId = typeof app?.value === 'string' && /^cli_[A-Za-z0-9]{8,128}$/u.test(app.value) ? app.value : null
    const clientSecret = tokenValue(secret?.value)
    if (clientId === null || clientSecret === null) throw new Error('Feishu App ID and App Secret are required')
    const response = await requestOAuthJson(fetchImpl, FEISHU_DEVICE_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ client_id: clientId, scope: 'offline_access' }),
    }, signal)
    if (!response.ok || response.value?.error !== undefined) throw new Error('Feishu device authorization failed')
    const deviceCode = tokenValue(response.value?.device_code)
    const userCode = text(response.value?.user_code)
    if (deviceCode === null || userCode === null || !USER_CODE.test(userCode)) {
      throw new Error('incomplete Feishu device authorization response')
    }
    return {
      clientId,
      clientSecret,
      deviceCode,
      userCode,
      verificationUrl: trustedOAuthVerificationUrl(
        'feishu', response.value?.verification_uri_complete ?? response.value?.verification_uri,
      ),
      expiresIn: safeInteger(response.value?.expires_in, 300, 30, DEVICE_ATTEMPT_TTL_MAX_MS / 1_000),
      interval: safeInteger(response.value?.interval, 5, 1, 60),
    }
  }

  const beginTencent = async (signal) => {
    const clientId = await tencentClient(signal)
    const stateNonce = randomBytes(32).toString('base64url')
    const codeVerifier = randomBytes(32).toString('base64url')
    const authorizationUrl = new URL(TENCENT_AUTHORIZATION_URL)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('client_id', clientId)
    authorizationUrl.searchParams.set('redirect_uri', redirectUri())
    authorizationUrl.searchParams.set('scope', 'docs:read docs:write')
    authorizationUrl.searchParams.set('resource', TENCENT_MCP_URL)
    authorizationUrl.searchParams.set('state', stateNonce)
    authorizationUrl.searchParams.set('code_challenge', createHash('sha256').update(codeVerifier).digest('base64url'))
    authorizationUrl.searchParams.set('code_challenge_method', 'S256')
    return {
      clientId,
      stateNonce,
      codeVerifier,
      verificationUrl: trustedOAuthVerificationUrl('tencent-docs', authorizationUrl.toString()),
      expiresIn: 10 * 60,
      interval: 1,
    }
  }

  const finish = async (attempt, result) => {
    const error = typeof result.value?.error === 'string' ? result.value.error : null
    if (error === 'access_denied' || error === 'expired_token' || error === 'invalid_grant') {
      attempt.state = error === 'access_denied' ? 'denied' : 'expired'
      attempt.detail = error === 'access_denied' ? '用户拒绝了官方授权。' : '官方授权链接已过期，请重新生成。'
    } else if (!result.ok || error !== null) {
      attempt.state = 'failed'
      attempt.detail = '官方授权失败，请重新生成。'
    } else {
      try {
        await storeOAuthAuthorization(credentials, attempt, result.value, now)
        attempt.state = 'authorized'
        attempt.detail = `${attempt.connectionId === 'feishu' ? '飞书' : '腾讯文档'}官方授权已保存到本机安全凭据库。`
      } catch {
        attempt.state = 'failed'
        attempt.detail = '官方授权无法保存到本机安全凭据库，请重新生成。'
      }
    }
    clearOAuthSecrets(attempt)
    return publicOAuth(attempt)
  }

  return Object.freeze({
    async begin(connectionId, signal) {
      if (connectionId !== 'feishu' && connectionId !== 'tencent-docs') throw new Error('unsupported OAuth connection')
      for (const attempt of attempts.values()) {
        if (attempt.connectionId === connectionId && ACTIVE_OAUTH_STATES.has(attempt.state)) {
          attempt.state = 'cancelled'
          attempt.detail = '官方授权已取消。'
          clearOAuthSecrets(attempt)
        }
      }
      const started = connectionId === 'feishu' ? await beginFeishu(signal) : await beginTencent(signal)
      const qrCodeDataUrl = await encodeQr(started.verificationUrl)
      if (typeof qrCodeDataUrl !== 'string' || qrCodeDataUrl.length > 1_000_000 || !QR_DATA_URL.test(qrCodeDataUrl)) {
        throw new Error('invalid OAuth QR image')
      }
      const attempt = {
        id: randomUUID(),
        connectionId,
        state: 'pending',
        expiresAt: now() + started.expiresIn * 1_000,
        nextPollAt: now() + started.interval * 1_000,
        intervalMs: started.interval * 1_000,
        ...started,
        qrCodeDataUrl,
        detail: `请在${connectionId === 'feishu' ? '飞书' : '腾讯文档'}官方页面完成授权。`,
      }
      if (attempts.size >= 8) attempts.delete(attempts.keys().next().value)
      attempts.set(attempt.id, attempt)
      return publicOAuth(attempt)
    },
    async poll(connectionId, id, signal) {
      const attempt = getAttempt(id)
      if (attempt.connectionId !== connectionId) throw new Error('OAuth attempt connection mismatch')
      if (!ACTIVE_OAUTH_STATES.has(attempt.state) || connectionId === 'tencent-docs' || now() < attempt.nextPollAt) {
        return publicOAuth(attempt)
      }
      attempt.nextPollAt = now() + attempt.intervalMs
      const result = await requestOAuthJson(fetchImpl, FEISHU_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: DEVICE_GRANT,
          device_code: attempt.deviceCode,
          client_id: attempt.clientId,
          client_secret: attempt.clientSecret,
        }),
      }, signal)
      const error = typeof result.value?.error === 'string' ? result.value.error : null
      if (error === 'authorization_pending') return publicOAuth(attempt)
      if (error === 'slow_down') {
        attempt.intervalMs = Math.min(attempt.intervalMs + 5_000, 60_000)
        attempt.nextPollAt = now() + attempt.intervalMs
        return publicOAuth(attempt)
      }
      return finish(attempt, result)
    },
    async completeTencentCallback(value, signal) {
      const callback = new URL(value)
      const expected = new URL(redirectUri())
      if (callback.origin !== expected.origin || callback.pathname !== expected.pathname || callback.hash
        || callback.username || callback.password
        || [...callback.searchParams.keys()].some(key => !['code', 'state', 'error', 'error_description'].includes(key))
        || [...new Set(callback.searchParams.keys())].some(key => callback.searchParams.getAll(key).length !== 1)) {
        throw new Error('invalid Tencent Docs OAuth callback')
      }
      const stateNonce = callback.searchParams.get('state')
      const attempt = [...attempts.values()].find(candidate => candidate.connectionId === 'tencent-docs'
        && ACTIVE_OAUTH_STATES.has(candidate.state) && candidate.stateNonce === stateNonce)
      if (attempt === undefined) throw new Error('unknown Tencent Docs OAuth callback')
      if (!ACTIVE_OAUTH_STATES.has(getAttempt(attempt.id).state)) return publicOAuth(attempt)
      const callbackError = callback.searchParams.get('error')
      if (callbackError !== null) {
        attempt.state = callbackError === 'access_denied' ? 'denied' : 'failed'
        attempt.detail = callbackError === 'access_denied' ? '用户拒绝了官方授权。' : '腾讯文档官方授权失败，请重新生成。'
        clearOAuthSecrets(attempt)
        return publicOAuth(attempt)
      }
      const code = callback.searchParams.get('code')
      if (code === null || !DEVICE_CODE.test(code)) throw new Error('invalid Tencent Docs authorization code')
      let result
      try {
        result = await requestOAuthJson(fetchImpl, TENCENT_TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: attempt.clientId,
            redirect_uri: redirectUri(),
            code_verifier: attempt.codeVerifier,
            resource: TENCENT_MCP_URL,
          }),
        }, signal)
      } catch {
        attempt.state = 'failed'
        attempt.detail = '腾讯文档官方授权失败，请重新生成。'
        clearOAuthSecrets(attempt)
        return publicOAuth(attempt)
      }
      return finish(attempt, result)
    },
    cancel(connectionId, id) {
      const attempt = getAttempt(id)
      if (attempt.connectionId !== connectionId) throw new Error('OAuth attempt connection mismatch')
      if (ACTIVE_OAUTH_STATES.has(attempt.state)) {
        attempt.state = 'cancelled'
        attempt.detail = '官方授权已取消。'
        clearOAuthSecrets(attempt)
      }
      return publicOAuth(attempt)
    },
  })
}

async function project(ctx, definition) {
  const fields = []
  for (const field of definition.fields) {
    const view = await ctx.credentials.describe(field.ref)
    fields.push({ ...field, ...view })
  }
  const qrConfigured = definition.qr === true
    && (await ctx.credentials.describe(WEIXIN_CREDENTIAL_REFS.token)).configured === true
  const oauthConfigured = definition.oauth === true
    && (await ctx.credentials.describe(OAUTH_CREDENTIAL_REFS[definition.id].access)).configured === true
  const fieldsConfigured = fields.length > 0 && fields.every(field => field.configured)
  const configured = definition.oauth === true ? oauthConfigured : fieldsConfigured || qrConfigured
  const state = definition.blocked === undefined ? configured ? 'blocked' : 'setup-required' : 'blocked'
  const detail = definition.blocked
    ?? (configured
      ? definition.pending
      : definition.oauth === true && fields.length > 0 && !fieldsConfigured
        ? '请先保存官方应用凭据，再生成用户授权链接。'
        : definition.oauth === true
          ? '请生成并打开官方授权链接。'
          : '请在设置的“外部连接”中完成本机配置。')
  return {
    id: definition.id,
    title: definition.title,
    summary: definition.summary,
    order: definition.order,
    state,
    detail,
    fields,
    qr_supported: definition.qr === true,
    oauth_supported: definition.oauth === true,
  }
}

export async function apply(ctx, config = {}) {
  const capabilities = ctx.get('emateCapabilities')
  if (capabilities === undefined) throw new Error('e-Mate connections requires emateCapabilities')
  if (ctx.webServer.host !== '127.0.0.1' || !Number.isSafeInteger(ctx.webServer.port)
    || ctx.webServer.port < 1 || ctx.webServer.port > 65_535) {
    throw new Error('e-Mate Tencent Docs OAuth requires the target loopback webServer')
  }
  const tencentRedirectUri = `http://127.0.0.1:${ctx.webServer.port}${TENCENT_CALLBACK_PATH}`
  const weixinQr = createWeixinQrProvider(ctx.credentials)
  const oauth = createOfficialOAuthProvider(ctx.credentials, { tencentRedirectUri })
  const { defineTool } = await loadTargetTools(config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json'))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TENCENT_CALLBACK_PATH,
    async handler(req, res) {
      const headers = {
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
      }
      if (req.headers.host !== `127.0.0.1:${ctx.webServer.port}`) {
        res.writeHead(403, headers)
        res.end('<!doctype html><meta charset="utf-8"><title>e-Mate</title>请求已拒绝。')
        return
      }
      if (req.method !== 'GET') {
        res.writeHead(405, { ...headers, allow: 'GET' })
        res.end('<!doctype html><meta charset="utf-8"><title>e-Mate</title>请求方法不受支持。')
        return
      }
      try {
        const result = await oauth.completeTencentCallback(new URL(req.url ?? '', tencentRedirectUri))
        res.writeHead(200, headers)
        res.end(`<!doctype html><meta charset="utf-8"><title>e-Mate 腾讯文档授权</title>${result.state === 'authorized' ? '腾讯文档授权已保存，可以关闭此页面。' : '腾讯文档授权未完成，请返回 e-Mate 重试。'}`)
      } catch {
        res.writeHead(400, headers)
        res.end('<!doctype html><meta charset="utf-8"><title>e-Mate 腾讯文档授权</title>授权回调无效，请返回 e-Mate 重试。')
      }
    },
  }), 'emate.connections: Tencent Docs OAuth callback on target webServer')

  ctx.systemPrompt.section({
    name: 'emate:connections',
    order: 181,
    text: `When the user asks to connect or configure 飞书、腾讯文档 or 微信, call the registered \`${CONNECTION_SETUP_TOOL}\` Tool with the exact connection_id. This Tool only requests the existing local e-Mate authorization UI. Never ask the user to send App IDs, secrets, tokens, pairing codes, or QR credentials in chat; never use a browser Tool for this setup; and never claim the connector is active until its real local status says so.`,
  })
  ctx.tools.register(defineTool({
    name: CONNECTION_SETUP_TOOL,
    description: 'Open the existing local e-Mate authorization UI for exactly one supported external connection. Use this for natural-language requests to connect or configure 飞书, 腾讯文档, or 微信. This Tool never accepts credentials and does not activate a connector by itself.',
    parameters: {
      connection_id: {
        type: 'string',
        required: true,
        enum: [...AGENT_CONNECTIONS.keys()],
        description: 'Exact local connection to configure.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          connection_id: { type: 'string', required: true },
          state: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已请求打开本机“外部连接”中的${AGENT_CONNECTIONS.get(value.connection_id)}授权界面；凭据只在该界面提交。`,
      }],
    },
    isConcurrencySafe: () => true,
    execute(args) {
      return { connection_id: connectionSetupId(args), state: 'authorization-ui-requested' }
    },
    presentCall: args => ({
      card: 'generic',
      title: `打开${AGENT_CONNECTIONS.get(connectionSetupId(args))}连接`,
      kind: 'read',
    }),
  }))

  for (const definition of definitions) {
    ctx.effect(() => capabilities.register({
      id: definition.id,
      title: definition.title,
      summary: definition.summary,
      icon_key: 'collaboration',
      order: definition.order,
      actions: [],
      async status() {
        const item = await project(ctx, definition)
        return { state: item.state, detail: item.detail, action_ids: [] }
      },
    }), `emate.connections: ${definition.id} capability`)
  }

  ctx.effect(() => ctx.connection.rpc.handle(
    CONNECTIONS_CHANNEL,
    async (endpoint, payload) => {
      if (endpoint === 'catalog' && exactKeys(payload, [])) return {
        ok: true,
        value: {
          schema_version: 1,
          items: await Promise.all(definitions.map(definition => project(ctx, definition))),
        },
      }
      if (endpoint === 'qr.begin' && exactKeys(payload, ['connection_id']) && payload.connection_id === 'wechat') {
        try {
          return { ok: true, value: await weixinQr.begin() }
        } catch {
          return badRequest('微信扫码服务暂时不可用，请稍后重试。')
        }
      }
      if (endpoint === 'qr.poll' && exactKeys(payload, ['connection_id', 'attempt_id', 'verify_code'])
        && payload.connection_id === 'wechat'
        && typeof payload.attempt_id === 'string'
        && /^[0-9a-f-]{36}$/iu.test(payload.attempt_id)
        && (payload.verify_code === undefined || /^\d{4,8}$/u.test(payload.verify_code))) {
        try {
          return { ok: true, value: await weixinQr.poll(payload.attempt_id, payload.verify_code) }
        } catch {
          return badRequest('微信扫码服务暂时不可用，请稍后重试。')
        }
      }
      if (endpoint === 'qr.cancel' && exactKeys(payload, ['connection_id', 'attempt_id'])
        && payload.connection_id === 'wechat'
        && typeof payload.attempt_id === 'string'
        && /^[0-9a-f-]{36}$/iu.test(payload.attempt_id)) {
        try {
          return { ok: true, value: weixinQr.cancel(payload.attempt_id) }
        } catch {
          return badRequest('微信扫码服务暂时不可用，请稍后重试。')
        }
      }
      if (endpoint === 'oauth.begin' && exactKeys(payload, ['connection_id'])
        && (payload.connection_id === 'feishu' || payload.connection_id === 'tencent-docs')) {
        try {
          return { ok: true, value: await oauth.begin(payload.connection_id) }
        } catch {
          return badRequest('官方授权暂不可用，请确认应用配置与网络后重试。')
        }
      }
      if (endpoint === 'oauth.poll' && exactKeys(payload, ['connection_id', 'attempt_id'])
        && (payload.connection_id === 'feishu' || payload.connection_id === 'tencent-docs')
        && typeof payload.attempt_id === 'string'
        && /^[0-9a-f-]{36}$/iu.test(payload.attempt_id)) {
        try {
          return { ok: true, value: await oauth.poll(payload.connection_id, payload.attempt_id) }
        } catch {
          return badRequest('官方授权状态读取失败，请稍后重试。')
        }
      }
      if (endpoint === 'oauth.cancel' && exactKeys(payload, ['connection_id', 'attempt_id'])
        && (payload.connection_id === 'feishu' || payload.connection_id === 'tencent-docs')
        && typeof payload.attempt_id === 'string'
        && /^[0-9a-f-]{36}$/iu.test(payload.attempt_id)) {
        try {
          return { ok: true, value: oauth.cancel(payload.connection_id, payload.attempt_id) }
        } catch {
          return badRequest('官方授权取消失败，请刷新后重试。')
        }
      }
      return badRequest('unknown e-Mate connections endpoint')
    },
    { authority: 'loopback' },
  ), 'emate.connections: target-native RPC channel')
}
