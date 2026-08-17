import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import QRCode from 'qrcode'
import { loadTargetTools } from './target-runtime.js'

export const name = 'emate-connections'
export const inject = ['credentials', 'connection', 'emateCapabilities', 'tools', 'systemPrompt']
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
    pending: '凭据已保存在本机；消息适配器完成真实连接验收前不会启用。',
  },
  {
    id: 'tencent-docs',
    title: '腾讯文档',
    summary: '通过官方远程 MCP 连接腾讯文档。',
    order: 60,
    fields: [
      { ref: 'EMATE_TENCENT_DOCS_TOKEN', label: 'OAuth Token', secret: true },
    ],
    pending: '凭据已保存在本机；CredentialRef OAuth/MCP 适配完成前不会启用。',
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

function operationFailed(message = '微信扫码服务暂时不可用，请稍后重试。') {
  return { ok: false, error: { code: 'wechat-qr-failed', message, details: { issues: [] } } }
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

async function boundedJson(response) {
  if (!response.ok) throw new Error('Weixin request failed')
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('Weixin response body is missing')
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

async function project(ctx, definition) {
  const fields = []
  for (const field of definition.fields) {
    const view = await ctx.credentials.describe(field.ref)
    fields.push({ ...field, ...view })
  }
  const qrConfigured = definition.qr === true
    && (await ctx.credentials.describe(WEIXIN_CREDENTIAL_REFS.token)).configured === true
  const configured = (fields.length > 0 && fields.every(field => field.configured)) || qrConfigured
  const state = definition.blocked === undefined ? configured ? 'blocked' : 'setup-required' : 'blocked'
  const detail = definition.blocked
    ?? (configured ? definition.pending : '请在设置的“外部连接”中完成本机配置。')
  return {
    id: definition.id,
    title: definition.title,
    summary: definition.summary,
    order: definition.order,
    state,
    detail,
    fields,
    qr_supported: definition.qr === true,
  }
}

export async function apply(ctx, config = {}) {
  const capabilities = ctx.get('emateCapabilities')
  if (capabilities === undefined) throw new Error('e-Mate connections requires emateCapabilities')
  const weixinQr = createWeixinQrProvider(ctx.credentials)
  const { defineTool } = await loadTargetTools(config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json'))

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
          return operationFailed()
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
          return operationFailed()
        }
      }
      if (endpoint === 'qr.cancel' && exactKeys(payload, ['connection_id', 'attempt_id'])
        && payload.connection_id === 'wechat'
        && typeof payload.attempt_id === 'string'
        && /^[0-9a-f-]{36}$/iu.test(payload.attempt_id)) {
        try {
          return { ok: true, value: weixinQr.cancel(payload.attempt_id) }
        } catch {
          return operationFailed()
        }
      }
      return badRequest('unknown e-Mate connections endpoint')
    },
    { authority: 'loopback' },
  ), 'emate.connections: target-native RPC channel')
}
