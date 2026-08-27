import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../../../../packages/dsh/src/profile/share.ts'

const SHARE_ID = 'S'.repeat(32)
const EXPIRES_AT = new Date(Date.now() + 86_400_000).toISOString()

function host(fetchImplementation: typeof fetch, options: {
  archive?: () => Promise<Response>
  credential?: () => Promise<{ value?: string }>
} = {}) {
  let handler: (endpoint: string, payload: unknown) => Promise<unknown>
  apply({
    apiProxy: {
      downloads: {
        sessionLog: options.archive ?? (async () => new Response(new Uint8Array([80, 75, 3, 4]), {
          headers: { 'content-type': 'application/zip' },
        })),
      },
    },
    credentials: {
      resolve: options.credential ?? (async () => ({ value: 'model-session-token-which-is-long-enough' })),
    },
    connection: {
      rpc: {
        handle: (_channel: string, callback: typeof handler) => {
          handler = callback
          return () => {}
        },
      },
    },
    effect: (factory: () => unknown) => factory(),
  }, { rootUrl: 'https://share.example', fetchImplementation })
  return (endpoint: string, payload: unknown) => handler(endpoint, payload)
}

test('Host keeps health/create/list/revoke on one versioned staged schema', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = []
  const call = host(async (input, init = {}) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.endsWith('/healthz')) {
      return Response.json({ schema_version: 1, service: 'emate-share', version: 1, ready: true })
    }
    if (url.includes('?session_sha256=')) {
      return Response.json({
        schema_version: 1,
        shares: [{ id: SHARE_ID, public_url: `https://share.example/s/${SHARE_ID}`, expires_at: EXPIRES_AT }],
      })
    }
    if (init.method === 'DELETE') return Response.json({ schema_version: 1, revoked: true })
    return Response.json({
      schema_version: 1,
      share: { id: SHARE_ID, public_url: `https://share.example/s/${SHARE_ID}`, expires_at: EXPIRES_AT },
    }, { status: 201 })
  })

  assert.deepEqual(await call('status', {}), {
    ok: true,
    value: { schema_version: 1, stage: 'preparing', service_version: 1, ready: true },
  })
  assert.equal((await call('create', { session_id: 'session-1' }) as any).value.stage, 'created')
  assert.equal((await call('list', { session_id: 'session-1' }) as any).value.stage, 'listing')
  assert.deepEqual(await call('revoke', { share_id: SHARE_ID, session_id: 'session-1' }), {
    ok: true,
    value: { schema_version: 1, stage: 'revoking', revoked: true },
  })
  const revoke = requests.at(-1)
  assert.equal(new Headers(revoke?.init.headers).get('x-emate-session-sha256'),
    '84097828fc31a8c8d29210df48901a85de7fd013f686b17be77d1be29cb7a98b')
})

test('Host maps provider and parsing failures to stable stage/code/message branches', async () => {
  const cases = [
    [new Response(null, { status: 401 }), 'authentication-required', '登录状态已失效，请重新登录后再试。'],
    [new Response(null, { status: 403 }), 'owner-required', '当前账号或任务无权管理这个公开链接。'],
    [new Response(null, { status: 413 }), 'archive-too-large', '任务归档超过在线分享大小限制，请改用本地导出。'],
    [new Response(null, { status: 503 }), 'service-unavailable', '在线分享服务暂时不可用，请稍后重试。'],
    [new Response('{', { status: 200 }), 'invalid-response', '分享服务返回了无效响应。'],
    [Response.json({
      schema_version: 1,
      share: { id: SHARE_ID, public_url: `https://other.example/s/${SHARE_ID}`, expires_at: EXPIRES_AT },
    }), 'invalid-response', '分享服务返回了无效响应。'],
  ] as const
  for (const [response, code, message] of cases) {
    const result = await host(async () => response.clone())('create', { session_id: 'session-1' }) as any
    assert.deepEqual(result.error, {
      schema_version: 1,
      stage: 'failed',
      operation: 'create',
      failed_at: 'uploading',
      code,
      message,
    })
  }

  const timeout = await host(async () => {
    throw new DOMException('private upstream timeout detail', 'TimeoutError')
  })('create', { session_id: 'session-1' }) as any
  assert.equal(timeout.error.code, 'request-timeout')
  assert.equal(timeout.error.message, '在线分享请求超时，请稍后重试。')
  assert.doesNotMatch(JSON.stringify(timeout), /private upstream/u)
})

test('Host reports credential and native Session ZIP failures at preparing without fallback upload', async () => {
  let uploads = 0
  const fetchImplementation = async () => {
    uploads += 1
    return new Response(null, { status: 500 })
  }
  const missingCredential = await host(fetchImplementation, {
    credential: async () => ({ value: undefined }),
  })('create', { session_id: 'session-1' }) as any
  assert.equal(missingCredential.error.code, 'authentication-required')
  assert.equal(missingCredential.error.failed_at, 'preparing')

  const badArchive = await host(fetchImplementation, {
    archive: async () => new Response('not a zip', { headers: { 'content-type': 'text/plain' } }),
  })('create', { session_id: 'session-1' }) as any
  assert.equal(badArchive.error.code, 'archive-unavailable')
  assert.equal(badArchive.error.failed_at, 'preparing')
  assert.equal(uploads, 0)
})
