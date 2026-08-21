const SHARE_ID = /^[A-Za-z0-9_-]{32}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const BEARER = /^Bearer ([^\s]{32,8192})$/u
const LIST_PAGE_SIZE = 100
const MAX_LIST_PAGES = 10
const MAX_ACTIVE_SHARES = 50

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function failure(status, code) {
  return json({ error: { code } }, status)
}

function configured(env) {
  const publicOrigin = new URL(env.PUBLIC_ORIGIN)
  const validationUrl = new URL(env.MODEL_SESSION_VALIDATION_URL)
  const ttlSeconds = Number(env.SHARE_TTL_SECONDS)
  const maxUploadBytes = Number(env.MAX_UPLOAD_BYTES)
  if (publicOrigin.protocol !== 'https:' || publicOrigin.username !== '' || publicOrigin.password !== ''
    || (publicOrigin.pathname !== '' && publicOrigin.pathname !== '/') || publicOrigin.search !== '' || publicOrigin.hash !== ''
    || validationUrl.protocol !== 'https:' || validationUrl.username !== '' || validationUrl.password !== ''
    || !validationUrl.pathname.endsWith('/e-mate/model-api/v1/consents/current')
    || validationUrl.search !== '' || validationUrl.hash !== ''
    || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 300 || ttlSeconds > 30 * 24 * 60 * 60
    || !Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1 || maxUploadBytes > 100 * 1024 * 1024
    || typeof env.SHARES?.put !== 'function' || typeof env.SHARES?.get !== 'function'
    || typeof env.SHARES?.list !== 'function'
    || typeof env.SHARES?.head !== 'function' || typeof env.SHARES?.delete !== 'function') {
    throw new Error('invalid share worker configuration')
  }
  return {
    publicOrigin: publicOrigin.origin,
    validationUrl: validationUrl.toString(),
    ttlSeconds,
    maxUploadBytes,
  }
}

function base64urlJson(segment) {
  if (!/^[A-Za-z0-9_-]+$/u.test(segment) || segment.length > 5_500) return undefined
  try {
    const padded = segment.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - segment.length % 4) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function modelPrincipal(token) {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  const header = base64urlJson(parts[0])
  const claims = base64urlJson(parts[1])
  if (header?.alg !== 'EdDSA' || header.typ !== 'e-mate-model-session+jwt' || !IDENTIFIER.test(String(header.kid ?? ''))
    || claims?.schemaVersion !== 1 || !IDENTIFIER.test(String(claims.tenantId ?? ''))
    || !IDENTIFIER.test(String(claims.sub ?? '')) || !IDENTIFIER.test(String(claims.sid ?? ''))
    || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1_000)) return undefined
  return { tenantId: claims.tenantId, userId: claims.sub }
}

async function ownerSha256(principal) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${principal.tenantId}\0${principal.userId}`),
  )
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
}

async function authenticate(request, env, validationUrl, fetchImplementation) {
  const authorization = request.headers.get('authorization')
  const match = authorization === null ? null : BEARER.exec(authorization)
  if (match === null) return { response: failure(401, 'AUTHENTICATION_REQUIRED') }
  const token = match[1]
  let validation
  try {
    validation = await fetchImplementation(validationUrl, {
      method: 'GET',
      redirect: 'manual',
      headers: { authorization },
    })
  } catch {
    return { response: failure(503, 'AUTHENTICATION_UNAVAILABLE') }
  }
  if (validation.body !== null) await validation.body.cancel()
  if (!validation.ok) {
    return {
      response: failure(
        validation.status === 401 || validation.status === 403 ? 401 : 503,
        validation.status === 401 || validation.status === 403
          ? 'AUTHENTICATION_REQUIRED'
          : 'AUTHENTICATION_UNAVAILABLE',
      ),
    }
  }
  const principal = modelPrincipal(token)
  if (principal === undefined) return { response: failure(401, 'AUTHENTICATION_REQUIRED') }
  return { principal, owner: await ownerSha256(principal) }
}

function randomShareId() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

function expired(object) {
  const expiresAt = Date.parse(object.customMetadata?.expires_at ?? '')
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now()
}

function archiveKey(id) {
  return `shares/${id}.zip`
}

function ownerPrefix(owner, sessionSha256) {
  return `owners/${owner}/${sessionSha256}/`
}

function ownerKey(owner, sessionSha256, id) {
  return `${ownerPrefix(owner, sessionSha256)}${id}`
}

function shareValue(config, id, expiresAt) {
  return {
    id,
    public_url: `${config.publicOrigin}/s/${id}`,
    expires_at: expiresAt,
  }
}

async function activeShares(env, config, owner, sessionSha256) {
  const prefix = ownerPrefix(owner, sessionSha256)
  const shares = []
  let cursor
  for (let pageNumber = 0; pageNumber < MAX_LIST_PAGES; pageNumber += 1) {
    const page = await env.SHARES.list({
      prefix,
      limit: LIST_PAGE_SIZE,
      include: ['customMetadata'],
      ...(cursor === undefined ? {} : { cursor }),
    })
    for (const index of page.objects) {
      const id = index.key.slice(prefix.length)
      if (!SHARE_ID.test(id)) {
        await env.SHARES.delete(index.key)
        continue
      }
      const archive = await env.SHARES.head(archiveKey(id))
      if (archive === null || expired(archive)
        || archive.customMetadata?.owner_sha256 !== owner
        || archive.customMetadata?.session_sha256 !== sessionSha256) {
        await env.SHARES.delete(index.key)
        if (archive !== null && expired(archive)) await env.SHARES.delete(archiveKey(id))
        continue
      }
      const createdAt = Date.parse(archive.customMetadata?.created_at ?? '')
      const expiresAt = archive.customMetadata.expires_at
      if (!Number.isFinite(createdAt) || !Number.isFinite(Date.parse(expiresAt))) {
        await env.SHARES.delete(index.key)
        await env.SHARES.delete(archiveKey(id))
        continue
      }
      shares.push({ ...shareValue(config, id, expiresAt), created_at: new Date(createdAt).toISOString() })
      if (shares.length > MAX_ACTIVE_SHARES) throw new Error('active share limit exceeded')
    }
    if (!page.truncated) return shares.sort((left, right) => right.created_at.localeCompare(left.created_at))
    if (typeof page.cursor !== 'string' || page.cursor === '') throw new Error('invalid R2 list cursor')
    cursor = page.cursor
  }
  throw new Error('active share page limit exceeded')
}

async function liveObject(env, id, body) {
  const key = archiveKey(id)
  const object = body ? await env.SHARES.get(key) : await env.SHARES.head(key)
  if (object === null) return { response: failure(404, 'SHARE_NOT_FOUND') }
  if (expired(object)) {
    await env.SHARES.delete(key)
    return { response: failure(410, 'SHARE_EXPIRED') }
  }
  return { key, object }
}

function landing(id, expiresAt) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>e-Mate 分享任务</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#f5f5f5;font:16px/1.6 system-ui,sans-serif}.card{width:min(560px,calc(100% - 48px));padding:32px;border:1px solid #383838;border-radius:18px;background:#202020}.brand{color:#ff6a1a}h1{margin:.2em 0}p{color:#bbb}a{display:inline-block;margin-top:12px;padding:10px 16px;border-radius:10px;background:#ff6a1a;color:#fff;text-decoration:none}small{display:block;margin-top:18px;color:#888}</style></head>
<body><main class="card"><span class="brand">e-Mate</span><h1>分享任务归档</h1><p>分享者通过 e-Mate 创建了这个公开链接。归档包含任务、子任务和附件，下载后可查看。</p><a href="/s/${id}/archive.zip">下载任务归档（ZIP）</a><small>链接有效期至 ${expiresAt}</small></main></body></html>`
}

async function createShare(request, env, config, fetchImplementation) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  const sessionSha256 = request.headers.get('x-emate-session-sha256')
  if (contentType !== 'application/zip' || request.body === null || sessionSha256 === null || !SHA256.test(sessionSha256)) {
    return failure(400, 'INVALID_SHARE_ARCHIVE')
  }
  const auth = await authenticate(request, env, config.validationUrl, fetchImplementation)
  if (auth.response !== undefined) return auth.response
  const existing = await activeShares(env, config, auth.owner, sessionSha256)
  if (existing.length > 0) {
    await request.body.cancel()
    return json({
      schema_version: 1,
      share: shareValue(config, existing[0].id, existing[0].expires_at),
    })
  }
  const id = randomShareId()
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + config.ttlSeconds * 1_000).toISOString()
  const key = archiveKey(id)
  const stored = await env.SHARES.put(key, request.body, {
    httpMetadata: {
      contentType: 'application/zip',
      contentDisposition: 'attachment; filename="e-mate-task.zip"',
      cacheControl: 'private, no-store',
    },
    customMetadata: {
      owner_sha256: auth.owner,
      session_sha256: sessionSha256,
      created_at: createdAt,
      expires_at: expiresAt,
    },
  })
  if (!Number.isSafeInteger(stored.size) || stored.size < 1 || stored.size > config.maxUploadBytes) {
    await env.SHARES.delete(key)
    return failure(413, 'SHARE_ARCHIVE_TOO_LARGE')
  }
  try {
    await env.SHARES.put(ownerKey(auth.owner, sessionSha256, id), new Uint8Array(), {
      customMetadata: { created_at: createdAt, expires_at: expiresAt },
    })
  } catch (error) {
    await env.SHARES.delete(key)
    throw error
  }
  return json({
    schema_version: 1,
    share: shareValue(config, id, expiresAt),
  }, 201)
}

async function listShares(request, env, config, fetchImplementation, sessionSha256) {
  const auth = await authenticate(request, env, config.validationUrl, fetchImplementation)
  if (auth.response !== undefined) return auth.response
  const shares = await activeShares(env, config, auth.owner, sessionSha256)
  return json({
    schema_version: 1,
    shares: shares.map(({ created_at: _, ...share }) => share),
  })
}

async function revokeShare(request, env, config, fetchImplementation, id) {
  const auth = await authenticate(request, env, config.validationUrl, fetchImplementation)
  if (auth.response !== undefined) return auth.response
  const key = archiveKey(id)
  const object = await env.SHARES.head(key)
  if (object === null) return json({ schema_version: 1, revoked: true })
  if (object.customMetadata?.owner_sha256 !== auth.owner) return failure(403, 'SHARE_OWNER_REQUIRED')
  const sessionSha256 = object.customMetadata?.session_sha256
  if (typeof sessionSha256 !== 'string' || !SHA256.test(sessionSha256)) return failure(500, 'INVALID_SHARE_METADATA')
  await env.SHARES.delete(key)
  await env.SHARES.delete(ownerKey(auth.owner, sessionSha256, id))
  return json({ schema_version: 1, revoked: true })
}

async function publicShare(request, env, id, archive) {
  const current = await liveObject(env, id, archive)
  if (current.response !== undefined) return current.response
  const expiresAt = current.object.customMetadata.expires_at
  if (!archive) {
    const headers = {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'x-robots-tag': 'noindex, nofollow',
    }
    return new Response(request.method === 'HEAD' ? null : landing(id, expiresAt), { headers })
  }
  return new Response(request.method === 'HEAD' ? null : current.object.body, {
    headers: {
      'cache-control': 'private, no-store',
      'content-disposition': 'attachment; filename="e-mate-task.zip"',
      'content-length': String(current.object.size),
      'content-type': 'application/zip',
      'x-content-type-options': 'nosniff',
    },
  })
}

export async function handleRequest(request, env, fetchImplementation = fetch) {
  const config = configured(env)
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/healthz' && url.search === '') {
    return json({ schema_version: 1, ready: true })
  }
  if (request.method === 'POST' && url.pathname === '/v1/shares' && url.search === '') {
    return createShare(request, env, config, fetchImplementation)
  }
  if (request.method === 'GET' && url.pathname === '/v1/shares'
    && url.searchParams.size === 1 && url.searchParams.getAll('session_sha256').length === 1) {
    const sessionSha256 = url.searchParams.get('session_sha256')
    if (sessionSha256 !== null && SHA256.test(sessionSha256)) {
      return listShares(request, env, config, fetchImplementation, sessionSha256)
    }
  }
  const revoke = /^\/v1\/shares\/([A-Za-z0-9_-]{32})$/u.exec(url.pathname)
  if (request.method === 'DELETE' && url.search === '' && revoke !== null && SHARE_ID.test(revoke[1])) {
    return revokeShare(request, env, config, fetchImplementation, revoke[1])
  }
  const shared = /^\/s\/([A-Za-z0-9_-]{32})(\/archive\.zip)?$/u.exec(url.pathname)
  if ((request.method === 'GET' || request.method === 'HEAD') && url.search === ''
    && shared !== null && SHARE_ID.test(shared[1])) {
    return publicShare(request, env, shared[1], shared[2] !== undefined)
  }
  return failure(404, 'NOT_FOUND')
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env)
    } catch (error) {
      console.error(JSON.stringify({
        message: 'share request failed',
        method: request.method,
        error: error instanceof Error ? error.message : 'unknown error',
      }))
      return failure(500, 'INTERNAL_ERROR')
    }
  },
}
