import { createHash } from 'node:crypto'

export const name = 'emate-share'
export const inject = ['apiProxy', 'connection', 'credentials']
export const SHARE_CHANNEL = '/emate.share'

const SHARE_ID = /^[A-Za-z0-9_-]{32}$/u
const MODEL_SESSION_REF = 'E_MATE_MODEL_SESSION_TOKEN'
const JSON_MAX_BYTES = 16 * 1024
const REQUEST_TIMEOUT_MS = 5 * 60 * 1_000

type ShareConfig = {
  rootUrl?: string
  fetchImplementation?: typeof fetch
}

const badRequest = (message: string) => ({
  ok: false,
  error: { code: 'bad-request', message, details: { issues: [] } },
})

const unavailable = (message: string) => ({
  ok: false,
  error: { code: 'unavailable', message, details: { issues: [] } },
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).toSorted()
  const expected = [...keys].toSorted()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function shareRoot(value: unknown): string {
  if (typeof value !== 'string') throw new Error('e-Mate public share service is not configured')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || (url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') {
    throw new Error('e-Mate public share service must be a fixed HTTPS origin')
  }
  return url.origin
}

async function readJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > JSON_MAX_BYTES)) {
    throw new Error('分享服务返回了无效响应。')
  }
  if (response.body === null) throw new Error('分享服务返回了无效响应。')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!(value instanceof Uint8Array) || (length += value.byteLength) > JSON_MAX_BYTES) {
      await reader.cancel()
      throw new Error('分享服务返回了无效响应。')
    }
    chunks.push(value)
  }
  if (declared !== null && length !== Number(declared)) throw new Error('分享服务返回了无效响应。')
  try {
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error('分享服务返回了无效响应。')
  }
}

function providerFailure(response: Response): never {
  if (response.status === 401 || response.status === 403) {
    throw new Error('登录状态已失效，请重新登录后再试。')
  }
  if (response.status === 413) throw new Error('任务归档超过在线分享大小限制，请改用本地导出。')
  throw new Error('在线分享服务暂时不可用，请稍后重试。')
}

type ShareValue = { share_id: string; public_url: string; expires_at: string }

function parseShareValue(value: unknown, root: string): ShareValue {
  if (!isRecord(value) || !exact(value, ['id', 'public_url', 'expires_at'])
    || typeof value.id !== 'string' || !SHARE_ID.test(value.id)
    || typeof value.public_url !== 'string' || typeof value.expires_at !== 'string') {
    throw new Error('分享服务返回了无效响应。')
  }
  const publicUrl = new URL(value.public_url)
  if (publicUrl.origin !== root || publicUrl.pathname !== `/s/${value.id}`
    || publicUrl.username !== '' || publicUrl.password !== '' || publicUrl.search !== '' || publicUrl.hash !== ''
    || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= Date.now()) {
    throw new Error('分享服务返回了无效响应。')
  }
  return {
    share_id: value.id,
    public_url: publicUrl.toString(),
    expires_at: value.expires_at,
  }
}

function parseShare(value: unknown, root: string): { schema_version: 1 } & ShareValue {
  if (!isRecord(value) || !exact(value, ['schema_version', 'share']) || value.schema_version !== 1) {
    throw new Error('分享服务返回了无效响应。')
  }
  return { schema_version: 1, ...parseShareValue(value.share, root) }
}

function parseShares(value: unknown, root: string): { schema_version: 1; shares: ShareValue[] } {
  if (!isRecord(value) || !exact(value, ['schema_version', 'shares']) || value.schema_version !== 1
    || !Array.isArray(value.shares) || value.shares.length > 50) {
    throw new Error('分享服务返回了无效响应。')
  }
  const shares = value.shares.map(share => parseShareValue(share, root))
  if (new Set(shares.map(share => share.share_id)).size !== shares.length) {
    throw new Error('分享服务返回了无效响应。')
  }
  return { schema_version: 1, shares }
}

function sessionSha256(value: unknown): string | undefined {
  return typeof value === 'string' && value.length >= 1 && value.length <= 512 && !/\p{Cc}/u.test(value)
    ? createHash('sha256').update(value).digest('hex')
    : undefined
}

async function modelToken(ctx: any): Promise<string> {
  const credential = await ctx.credentials.resolve(MODEL_SESSION_REF)
  if (typeof credential?.value !== 'string' || credential.value.length < 32) {
    throw new Error('请先登录 e-Mate，再创建在线分享。')
  }
  return credential.value
}

/**
 * Publish the pinned DSH Session ZIP through one authenticated share provider.
 * The ZIP remains the only session/attachment projection; this adapter adds no
 * second event store, transcript renderer, or client-side upload path.
 */
export function apply(ctx: any, config: ShareConfig = {}): void {
  const root = shareRoot(config.rootUrl)
  const request = config.fetchImplementation ?? fetch
  ctx.effect(() => ctx.connection.rpc.handle(
    SHARE_CHANNEL,
    async (endpoint: string, payload: unknown) => {
      if (!isRecord(payload)) return badRequest('e-Mate share payload must be an object')

      if (endpoint === 'status') {
        if (!exact(payload, [])) return badRequest('e-Mate share status payload is invalid')
        try {
          const response = await request(`${root}/healthz`, {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
          })
          const value = response.ok ? await readJson(response) : undefined
          const ready = isRecord(value) && exact(value, ['schema_version', 'ready'])
            && value.schema_version === 1 && value.ready === true
          return {
            ok: true,
            value: ready
              ? { schema_version: 1, ready: true }
              : { schema_version: 1, ready: false, blocker: 'public-share-service-unavailable' },
          }
        } catch {
          return {
            ok: true,
            value: { schema_version: 1, ready: false, blocker: 'public-share-service-unavailable' },
          }
        }
      }

      if (endpoint === 'create') {
        const sessionHash = exact(payload, ['session_id']) ? sessionSha256(payload.session_id) : undefined
        if (sessionHash === undefined) {
          return badRequest('e-Mate share session is invalid')
        }
        try {
          const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          const token = await modelToken(ctx)
          const archive = await ctx.apiProxy.downloads.sessionLog({
            sessionId: payload.session_id as string,
            includeDescendants: true,
          }, signal)
          if (!archive.ok || archive.body === null
            || archive.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/zip') {
            throw new Error('无法准备当前任务归档，请先改用本地导出检查任务数据。')
          }
          const response = await request(`${root}/v1/shares`, {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/zip',
              'x-emate-session-sha256': sessionHash,
            },
            body: archive.body,
            duplex: 'half',
          } as RequestInit & { duplex: 'half' })
          if (!response.ok) providerFailure(response)
          return { ok: true, value: parseShare(await readJson(response), root) }
        } catch (error) {
          return unavailable(error instanceof Error ? error.message : '在线分享服务暂时不可用，请稍后重试。')
        }
      }

      if (endpoint === 'list') {
        const sessionHash = exact(payload, ['session_id']) ? sessionSha256(payload.session_id) : undefined
        if (sessionHash === undefined) return badRequest('e-Mate share session is invalid')
        try {
          const response = await request(`${root}/v1/shares?session_sha256=${sessionHash}`, {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
            headers: { authorization: `Bearer ${await modelToken(ctx)}` },
          })
          if (!response.ok) providerFailure(response)
          return { ok: true, value: parseShares(await readJson(response), root) }
        } catch (error) {
          return unavailable(error instanceof Error ? error.message : '无法读取在线分享，请稍后重试。')
        }
      }

      if (endpoint === 'revoke') {
        if (!exact(payload, ['share_id']) || typeof payload.share_id !== 'string' || !SHARE_ID.test(payload.share_id)) {
          return badRequest('e-Mate share id is invalid')
        }
        try {
          const response = await request(`${root}/v1/shares/${payload.share_id}`, {
            method: 'DELETE',
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
            headers: { authorization: `Bearer ${await modelToken(ctx)}` },
          })
          if (!response.ok) providerFailure(response)
          const value = await readJson(response)
          if (!isRecord(value) || !exact(value, ['schema_version', 'revoked'])
            || value.schema_version !== 1 || value.revoked !== true) {
            throw new Error('分享服务返回了无效响应。')
          }
          return { ok: true, value: { schema_version: 1, revoked: true } }
        } catch (error) {
          return unavailable(error instanceof Error ? error.message : '无法撤销在线分享，请稍后重试。')
        }
      }

      return badRequest('e-Mate share endpoint is invalid')
    },
    { authority: 'loopback' },
  ), 'emate.share: native Session ZIP public-share adapter')
}
