import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { deflateRawSync } from 'node:zlib'
import test from 'node:test'
import worker, { handleRequest, inspectSkillArchive, versionSort } from '../src/index.js'

class D1Statement {
  constructor(database, sql, values = []) {
    this.database = database
    this.sql = sql
    this.values = values
  }

  bind(...values) {
    return new D1Statement(this.database, this.sql, values)
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) }
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values)
    return { meta: { changes: Number(result.changes) } }
  }
}

class MemoryD1 {
  database = new DatabaseSync(':memory:')

  constructor() {
    this.database.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  }

  prepare(sql) {
    return new D1Statement(this.database, sql)
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.database.exec('COMMIT')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

class MemoryR2 {
  objects = new Map()

  async put(key, value, options = {}) {
    const bytes = new Uint8Array(await new Response(value).arrayBuffer())
    const object = {
      key,
      size: bytes.byteLength,
      bytes,
      customMetadata: { ...options.customMetadata },
      httpMetadata: { ...options.httpMetadata },
    }
    this.objects.set(key, object)
    return this.view(object)
  }

  async head(key) {
    const object = this.objects.get(key)
    return object === undefined ? null : this.view(object)
  }

  async get(key) {
    const object = this.objects.get(key)
    return object === undefined ? null : { ...this.view(object), body: new Blob([object.bytes]).stream() }
  }

  async list() {
    return { objects: [...this.objects.values()].map(value => this.view(value)), truncated: false }
  }

  view(object) {
    return {
      key: object.key,
      size: object.size,
      customMetadata: { ...object.customMetadata },
      httpMetadata: { ...object.httpMetadata },
    }
  }
}

const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 0 ? value >>> 1 : 0xedb88320 ^ (value >>> 1)
  CRC_TABLE[index] = value >>> 0
}

function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function zip(files) {
  const local = []
  const central = []
  let offset = 0
  for (const [path, value] of Object.entries(files)) {
    const name = Buffer.from(path, 'utf8')
    const content = Buffer.from(value)
    const compressed = deflateRawSync(content)
    const crc = crc32(content)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(content.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, compressed)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50, 0)
    record.writeUInt16LE(0x0314, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt16LE(0x800, 8)
    record.writeUInt16LE(8, 10)
    record.writeUInt32LE(crc, 16)
    record.writeUInt32LE(compressed.length, 20)
    record.writeUInt32LE(content.length, 24)
    record.writeUInt16LE(name.length, 28)
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38)
    record.writeUInt32LE(offset, 42)
    central.push(record, name)
    offset += header.length + name.length + compressed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

function skill(slug, version, tags = []) {
  return zip({
    'SKILL.md': [
      '---',
      `name: ${slug}`,
      `description: ${slug} shared behavior`,
      `version: ${version}`,
      `tags: ${JSON.stringify(tags)}`,
      '---',
      '',
      `Run ${slug}.`,
      '',
    ].join('\n'),
  })
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function modelToken(userId = 'user-1', sessionId = '01234567-89ab-4def-8123-456789abcdef') {
  return [
    base64url({ alg: 'EdDSA', typ: 'e-mate-model-session+jwt', kid: 'auth-key-1' }),
    base64url({
      schemaVersion: 1,
      tenantId: 'tenant-1',
      sub: userId,
      sid: sessionId,
      exp: Math.floor(Date.now() / 1_000) + 900,
    }),
    'x'.repeat(86),
  ].join('.')
}

function environment() {
  return {
    MODEL_SESSION_VALIDATION_URL: 'https://model.example/e-mate/model-api/v1/consents/current',
    AUTHOR_KEY: 'test-author-key-that-is-longer-than-thirty-two-bytes',
    DB: new MemoryD1(),
    PACKAGES: new MemoryR2(),
  }
}

function request(path, options = {}, userId = 'user-1', sessionId) {
  return new Request(`https://hub.example${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${modelToken(userId, sessionId)}`,
      ...options.headers,
    },
  })
}

const activeSession = async (url, init) => {
  assert.equal(url, 'https://model.example/e-mate/model-api/v1/consents/current')
  assert.match(init.headers.authorization, /^Bearer /u)
  return new Response(null, { status: 200 })
}

async function direct(env, path, options, userId, sessionId) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = activeSession
  try { return await worker.fetch(request(path, options, userId, sessionId), env) } finally { globalThis.fetch = originalFetch }
}

function publicationBody(payload, slug, category = 'third_party', requestId = 'publish:request-0001') {
  return JSON.stringify({
    slug,
    category,
    bundle_base64: payload.toString('base64'),
    client_request_id: requestId,
  })
}

test('matches the DSH client canonical Skill digest', async () => {
  const payload = zip({
    'SKILL.md': [
      '---',
      'name: cas-vector',
      'description: Canonical 内容',
      'version: 1.2.3',
      'license: MIT',
      'compatibility: ">=0.1.0,<1.0.0"',
      'tags: ["office","shared"]',
      '---',
      '',
      'Use it.',
      '',
    ].join('\n'),
    'guide/说明.md': 'hello\n',
  })
  const inspected = await inspectSkillArchive(payload)
  assert.equal(inspected.packageSha256, 'c268e7ed14e5aa798362b40d25a981d21b7c9d02e457ccc7f36d6da2150b7042')
})

test('publishes a bounded root heading as the shared catalog title', async () => {
  const env = environment()
  const payload = zip({
    'SKILL.md': [
      '---',
      'name: xhs-note-analyzer',
      'description: Shared Xiaohongshu note analysis',
      'version: 1.1.0',
      '---',
      '',
      '# 小红书笔记分析',
      '',
    ].join('\n'),
  })
  const published = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: publicationBody(payload, 'xhs-note-analyzer', 'content_creation', 'publish:xhs-title-0001'),
  }, 'user-1')
  assert.equal(published.status, 201)
  assert.equal((await published.clone().json()).title, '小红书笔记分析')

  const catalog = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills?query=%E5%B0%8F%E7%BA%A2%E4%B9%A6&limit=24', {}, 'user-2')
  assert.deepEqual((await catalog.json()).items, [await published.json()])
})

test('rejects an existing R2 object whose full package metadata is not the published identity', async () => {
  const env = environment()
  const payload = skill('r2-identity', '1.0.0')
  const inspected = await inspectSkillArchive(payload)
  await env.PACKAGES.put(`packages/${inspected.packageSha256}.zip`, payload, {
    customMetadata: { archive_sha256: inspected.archiveSha256 },
  })
  const published = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: publicationBody(payload, 'r2-identity', 'third_party', 'publish:r2-meta-0001'),
  })
  assert.equal(published.status, 409)
  assert.equal((await published.json()).error.code, 'conflict')
})

test('stops decompression at the ZIP declared expansion boundary', async () => {
  const payload = Buffer.from(skill('bounded-inflate', '1.0.0'))
  const central = payload.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  assert.notEqual(central, -1)
  payload.writeUInt32LE(1, central + 24)
  await assert.rejects(inspectSkillArchive(payload), /declared expansion budget|cannot be decompressed/u)
})

test('publishes, discovers, downloads, installs, reconciles, and tombstones one immutable Skill', async () => {
  const env = environment()
  const v1 = skill('shared-notes', '1.0.0', ['office'])
  const published = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: publicationBody(v1, 'shared-notes'),
  })
  assert.equal(published.status, 201)
  const card = await published.json()
  assert.equal(card.slug, 'shared-notes')
  assert.equal(card.version, '1.0.0')
  assert.match(card.package_sha256, /^[0-9a-f]{64}$/u)

  const replay = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: publicationBody(v1, 'shared-notes'),
  })
  assert.deepEqual(await replay.json(), card)

  const catalog = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills?query=notes&tag=office&limit=24')
  assert.deepEqual((await catalog.json()).items, [card])
  const detail = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/shared-notes')
  assert.deepEqual((await detail.json()).versions, [card])

  const downloaded = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/shared-notes/versions/1.0.0/package')
  assert.equal(downloaded.headers.get('x-skill-content-sha256'), card.package_sha256)
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), v1)

  const created = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/shared-notes/versions/1.0.0/install-intent', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: card.package_sha256, client_request_id: 'install:request-0001' }),
  })
  const intent = await created.json()
  assert.equal(intent.install_intent.length, 64)
  const claimed = await direct(env, '/ecorex-agent/client/skill-hub/v1/install-intents/consume', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ install_intent: intent.install_intent }),
  })
  const receipt = await claimed.json()
  assert.equal(receipt.completion_receipt.length, 64)
  const completed = await direct(env, '/ecorex-agent/client/skill-hub/v1/install-intents/complete', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ completion_receipt: receipt.completion_receipt, status: 'installed' }),
  })
  const completedReceipt = await completed.json()
  assert.equal(completedReceipt.status, 'installed')
  assert.equal(completedReceipt.slug, card.slug)
  assert.equal(completedReceipt.version, card.version)
  assert.equal(completedReceipt.package_sha256, card.package_sha256)
  assert.deepEqual(completedReceipt.uploader, card.uploader)
  const completionReplay = await direct(env, '/ecorex-agent/client/skill-hub/v1/install-intents/complete', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ completion_receipt: receipt.completion_receipt, status: 'installed' }),
  })
  assert.equal(completionReplay.status, 200)
  const reconciled = await direct(env, '/ecorex-agent/client/skill-hub/v1/install-intents/reconcile', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ completion_receipt: receipt.completion_receipt }),
  })
  assert.deepEqual(await reconciled.json(), completedReceipt)

  const deleted = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/shared-notes/versions/1.0.0', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: card.package_sha256, client_request_id: 'delete:request-0001' }),
  })
  assert.equal(deleted.status, 200)
  assert.deepEqual((await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills?query=&limit=24')).json()).items, [])
  const owned = await direct(env, '/ecorex-agent/client/skill-hub/v1/publications/mine?slug=shared-notes&version=1.0.0')
  assert.deepEqual((await owned.json()).items, [])
  const deletedReplay = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/shared-notes/versions/1.0.0', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: card.package_sha256, client_request_id: 'delete:request-0001' }),
  })
  assert.equal(deletedReplay.status, 200)
})

test('keeps slug ownership account-bound and restores the previous SemVer latest after deletion', async () => {
  const env = environment()
  const publish = async (version, requestId, userId = 'user-1') => direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: publicationBody(skill('versioned-skill', version), 'versioned-skill', 'content_creation', requestId),
  }, userId)
  const one = await (await publish('1.0.0', 'publish:version-0001')).json()
  const prerelease = await (await publish('2.0.0-beta.1', 'publish:version-0002')).json()
  const two = await (await publish('2.0.0', 'publish:version-0003')).json()
  const buildOne = await (await publish('2.0.0+build.1', 'publish:version-0004')).json()
  const buildTwo = await (await publish('2.0.0+build.2', 'publish:version-0005')).json()
  const latest = await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/versioned-skill')).json()
  assert.equal(latest.skill.version, '2.0.0+build.2')
  assert.deepEqual(latest.versions.map(card => card.version), [
    '2.0.0+build.2', '2.0.0+build.1', '2.0.0', '2.0.0-beta.1', '1.0.0',
  ])
  await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/versioned-skill/versions/2.0.0%2Bbuild.2', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: buildTwo.package_sha256, client_request_id: 'delete:version-0005' }),
  })
  assert.equal((await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/versioned-skill')).json()).skill.version, '2.0.0+build.1')
  await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/versioned-skill/versions/2.0.0%2Bbuild.1', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: buildOne.package_sha256, client_request_id: 'delete:version-0004' }),
  })
  assert.equal((await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/versioned-skill')).json()).skill.version, '2.0.0')
  const hijack = await publish('3.0.0', 'publish:hijack-0001', 'user-2')
  assert.equal(hijack.status, 409)
  const forbiddenDelete = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/versioned-skill/versions/2.0.0', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: two.package_sha256, client_request_id: 'delete:forbidden-0001' }),
  }, 'user-2')
  assert.equal(forbiddenDelete.status, 409)
  const deleted = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/versioned-skill/versions/2.0.0', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: two.package_sha256, client_request_id: 'delete:version-0003' }),
  })
  assert.equal(deleted.status, 200)
  const restored = await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/versioned-skill')).json()
  assert.equal(restored.skill.version, prerelease.version)
  assert.equal(restored.versions.at(-1).package_sha256, one.package_sha256)
})

test('uses opaque keyset cursors for catalog and version history', async () => {
  const env = environment()
  const publish = (slug, version, requestId) => direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: publicationBody(skill(slug, version), slug, 'third_party', requestId),
  })
  await publish('alpha-skill', '1.0.0', 'publish:cursor-0001')
  await publish('version-pages', '1.0.0', 'publish:cursor-0002')
  await publish('version-pages', '2.0.0-beta', 'publish:cursor-0003')
  await publish('version-pages', '2.0.0', 'publish:cursor-0004')

  const firstCatalog = await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills?query=&limit=1')).json()
  assert.deepEqual(firstCatalog.items.map(item => item.slug), ['alpha-skill'])
  assert.equal(typeof firstCatalog.next_cursor, 'string')
  assert.notEqual(firstCatalog.next_cursor, 'alpha-skill')
  const secondCatalog = await (await direct(env, `/ecorex-agent/client/skill-hub/v1/skills?query=&limit=1&cursor=${encodeURIComponent(firstCatalog.next_cursor)}`)).json()
  assert.deepEqual(secondCatalog.items.map(item => item.slug), ['version-pages'])
  const wrongScope = await direct(env, `/ecorex-agent/client/skill-hub/v1/skills?query=changed&limit=1&cursor=${encodeURIComponent(firstCatalog.next_cursor)}`)
  assert.equal(wrongScope.status, 422)

  await publish('semver-pages', '1.0.0-aa', 'publish:semver-0001')
  await publish('semver-pages', '1.0.0-z', 'publish:semver-0002')
  await publish('semver-pages', '1.0.0-9007199254740992', 'publish:semver-0003')
  await publish('semver-pages', '1.0.0-9007199254740993', 'publish:semver-0004')
  const semverCatalog = await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills?query=semver-pages&limit=1')).json()
  assert.equal(semverCatalog.items[0].version, '1.0.0-z')
  const semverFirst = await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/semver-pages?limit=2')).json()
  const semverSecond = await (await direct(env, `/ecorex-agent/client/skill-hub/v1/skills/semver-pages?limit=2&cursor=${encodeURIComponent(semverFirst.next_cursor)}`)).json()
  assert.deepEqual([...semverFirst.versions, ...semverSecond.versions].map(item => item.version), [
    '1.0.0-z',
    '1.0.0-aa',
    '1.0.0-9007199254740993',
    '1.0.0-9007199254740992',
  ])
  assert.equal(semverFirst.skill.version, '1.0.0-z')

  const firstVersions = await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/version-pages?limit=2')).json()
  assert.deepEqual(firstVersions.versions.map(item => item.version), ['2.0.0', '2.0.0-beta'])
  assert.equal(typeof firstVersions.next_cursor, 'string')
  assert.notEqual(firstVersions.next_cursor, '2.0.0-beta')
  const secondVersions = await (await direct(env, `/ecorex-agent/client/skill-hub/v1/skills/version-pages?limit=2&cursor=${encodeURIComponent(firstVersions.next_cursor)}`)).json()
  assert.deepEqual(secondVersions.versions.map(item => item.version), ['1.0.0'])
  assert.equal(secondVersions.skill.version, '2.0.0')
  assert.equal(secondVersions.next_cursor, null)
  const exactVersion = await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/version-pages/versions/1.0.0')).json()
  assert.equal(exactVersion.version, '1.0.0')
})

test('keeps version sort keys exact beyond three-digit numeric identifier lengths', () => {
  assert.ok(versionSort(`1.0.0-${'9'.repeat(1_000)}`) > versionSort(`1.0.0-${'9'.repeat(999)}`))
  assert.ok(versionSort('1.0.0-a-') > versionSort('1.0.0-a.1'))
})

test('rejects browser bearer transport and binds one-time install credentials to the authenticated session', async () => {
  const env = environment()
  const payload = skill('session-bound', '1.0.0')
  const card = await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: publicationBody(payload, 'session-bound', 'third_party', 'publish:session-0001'),
  })).json()
  const host = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills?query=&limit=1', {
    headers: { 'sec-fetch-mode': 'cors' },
  })
  assert.equal(host.status, 200)
  assert.deepEqual((await host.json()).items, [card])
  const browser = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills?query=&limit=1', {
    headers: { origin: 'https://renderer.invalid', 'sec-fetch-mode': 'cors' },
  })
  assert.equal(browser.status, 403)
  assert.equal((await browser.clone().json()).error.code, 'auth')
  assert.equal(browser.headers.get('access-control-allow-origin'), null)
  const browserMetadata = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills?query=&limit=1', {
    headers: { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site' },
  })
  assert.equal(browserMetadata.status, 403)

  const firstSession = '01234567-89ab-4def-8123-456789abcdef'
  const secondSession = '11234567-89ab-4def-8123-456789abcdef'
  const created = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/session-bound/versions/1.0.0/install-intent', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: card.package_sha256, client_request_id: 'install:session-0001' }),
  }, 'user-1', firstSession)
  const intent = await created.json()
  const duplicate = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/session-bound/versions/1.0.0/install-intent', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: card.package_sha256, client_request_id: 'install:session-0001' }),
  }, 'user-1', firstSession)
  assert.equal(duplicate.status, 409)
  assert.equal((await duplicate.json()).error.code, 'conflict')
  const wrongSession = await direct(env, '/ecorex-agent/client/skill-hub/v1/install-intents/consume', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ install_intent: intent.install_intent }),
  }, 'user-1', secondSession)
  assert.equal(wrongSession.status, 409)
  const claimed = await direct(env, '/ecorex-agent/client/skill-hub/v1/install-intents/consume', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ install_intent: intent.install_intent }),
  }, 'user-1', firstSession)
  const receipt = await claimed.json()
  assert.equal(receipt.slug, 'session-bound')
  assert.equal(receipt.version, '1.0.0')
  assert.equal(receipt.package_sha256, card.package_sha256)
  assert.deepEqual(receipt.uploader, card.uploader)
  const consumedAgain = await direct(env, '/ecorex-agent/client/skill-hub/v1/install-intents/consume', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ install_intent: intent.install_intent }),
  }, 'user-1', firstSession)
  assert.equal(consumedAgain.status, 409)
  const wrongCompletionSession = await direct(env, '/ecorex-agent/client/skill-hub/v1/install-intents/complete', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ completion_receipt: receipt.completion_receipt, status: 'installed' }),
  }, 'user-1', secondSession)
  assert.equal(wrongCompletionSession.status, 409)
})

test('keeps legacy duplicate intent rows deployable while concurrent request identity stays unique', async () => {
  const env = environment()
  const insert = 'INSERT INTO skill_hub_install_intents(intent_id,account_ref,slug,version,package_sha256,client_request_id,install_token_sha256,completion_token_sha256,expires_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)'
  for (const suffix of ['one', 'two']) await env.DB.prepare(insert).bind(
    `legacy_${suffix}`, 'legacy-account', 'legacy-skill', '1.0.0', 'a'.repeat(64), 'legacy:duplicate-request',
    `${suffix}${'0'.repeat(64 - suffix.length)}`, null, '2026-08-27T00:00:00.000Z', 'created',
  ).run()
  env.DB.database.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'))
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM skill_hub_install_intents WHERE account_ref=? AND client_request_id=?')
    .get('legacy-account', 'legacy:duplicate-request').count, 2)

  const payload = skill('intent-race', '1.0.0')
  const card = await (await direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: publicationBody(payload, 'intent-race', 'third_party', 'publish:intent-race-0001'),
  })).json()
  const options = {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: card.package_sha256, client_request_id: 'install:intent-race-0001' }),
  }
  const create = async () => {
    try {
      return await handleRequest(request('/ecorex-agent/client/skill-hub/v1/skills/intent-race/versions/1.0.0/install-intent', options), env, activeSession)
    } catch (error) {
      return { status: error.status }
    }
  }
  const responses = await Promise.all([
    create(),
    create(),
  ])
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409])
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS count FROM skill_hub_install_intents WHERE client_request_id=?')
    .get('install:intent-race-0001').count, 1)
})

test('does not report a tombstoned publication replay as published', async () => {
  const env = environment()
  const payload = skill('deleted-replay', '1.0.0')
  const body = publicationBody(payload, 'deleted-replay', 'third_party', 'publish:deleted-0001')
  const published = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  })
  const card = await published.json()
  await direct(env, '/ecorex-agent/client/skill-hub/v1/skills/deleted-replay/versions/1.0.0', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package_sha256: card.package_sha256, client_request_id: 'delete:deleted-0001' }),
  })
  const replay = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  })
  assert.equal(replay.status, 409)
  assert.equal((await replay.json()).error.code, 'conflict')
  const newRequestReplay = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: publicationBody(payload, 'deleted-replay', 'third_party', 'publish:deleted-0002'),
  })
  assert.equal(newRequestReplay.status, 409)
  assert.equal((await newRequestReplay.json()).error.code, 'conflict')
})

test('fails closed before storage for invalid identity and invalid archives', async () => {
  const env = environment()
  const unauthorized = await worker.fetch(new Request('https://hub.example/ecorex-agent/client/skill-hub/v1/skills?query=&limit=1'), env)
  assert.equal(unauthorized.status, 401)
  const invalid = await direct(env, '/ecorex-agent/client/skill-hub/v1/skills', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: publicationBody(Buffer.from('not-a-zip'), 'invalid-skill'),
  })
  assert.equal(invalid.status, 422)
  assert.equal(env.PACKAGES.objects.size, 0)
})
