import {
  lstatSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { parse } from 'yaml'

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_FILES = 256
const MAX_PATH_BYTES = 512
const MAX_PATH_DEPTH = 8
const MAX_EXPANSION_RATIO = 100
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const SHA256 = /^[0-9a-f]{64}$/
const BLOCKED_SUFFIXES = new Set([
  '.7z', '.bat', '.class', '.cmd', '.com', '.dll', '.dylib', '.exe', '.hta', '.jar', '.msi', '.rar', '.so', '.wasm', '.zip',
])
const BLOCKED_SEGMENTS = new Set(['.git', 'node_modules'])

function digest(payload) {
  return createHash('sha256').update(payload).digest('hex')
}

function atomicWrite(path, payload) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, payload, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function atomicJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`)
}

function archiveError(message) {
  return new Error(`Skill archive rejected: ${message}`)
}

function findEndOfCentralDirectory(payload) {
  const minimum = Math.max(0, payload.byteLength - 65_557)
  for (let offset = payload.byteLength - 22; offset >= minimum; offset -= 1) {
    if (payload.readUInt32LE(offset) === 0x06054b50) return offset
  }
  throw archiveError('ZIP end record is missing')
}

function validatePath(raw, directory) {
  if (raw !== raw.normalize('NFC')) throw archiveError('paths must use NFC Unicode normalization')
  if (raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || /[\x00-\x1f\x7f]/.test(raw)) {
    throw archiveError('an absolute, control, or non-POSIX path was found')
  }
  const value = directory ? raw.replace(/\/+$/, '') : raw
  const parts = value.split('/')
  if (parts.length === 0 || parts.length > MAX_PATH_DEPTH || parts.some(part => part === '' || part === '.' || part === '..')) {
    throw archiveError('a traversal, empty, or over-deep path was found')
  }
  if (Buffer.byteLength(value) > MAX_PATH_BYTES) throw archiveError('a path is too long')
  if (parts.some(part => BLOCKED_SEGMENTS.has(part.toLowerCase()))) throw archiveError('repository or dependency trees are not Skill resources')
  if (!directory) {
    const lower = parts.at(-1).toLowerCase()
    const dot = lower.lastIndexOf('.')
    if (BLOCKED_SUFFIXES.has(dot < 0 ? '' : lower.slice(dot))) throw archiveError('an executable or nested archive was found')
    if (lower === 'package.json') throw archiveError('npm packages are not Skill Hub archives')
  }
  return value
}

function centralDirectory(payload) {
  if (!Buffer.isBuffer(payload) || payload.byteLength < 22 || payload.byteLength > MAX_ARCHIVE_BYTES) {
    throw archiveError('input must be a ZIP no larger than 10 MiB')
  }
  const end = findEndOfCentralDirectory(payload)
  const disk = payload.readUInt16LE(end + 4)
  const centralDisk = payload.readUInt16LE(end + 6)
  const entries = payload.readUInt16LE(end + 10)
  const centralSize = payload.readUInt32LE(end + 12)
  const centralOffset = payload.readUInt32LE(end + 16)
  if (disk !== 0 || centralDisk !== 0 || entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw archiveError('multi-disk and ZIP64 archives are unsupported')
  }
  if (entries === 0 || entries > MAX_FILES * 2 || centralOffset + centralSize > end) {
    throw archiveError('central directory bounds are invalid')
  }
  const records = []
  const seen = new Set()
  let offset = centralOffset
  let total = 0
  let compressedTotal = 0
  let files = 0
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > end || payload.readUInt32LE(offset) !== 0x02014b50) throw archiveError('central directory entry is invalid')
    const flags = payload.readUInt16LE(offset + 8)
    const method = payload.readUInt16LE(offset + 10)
    const compressed = payload.readUInt32LE(offset + 20)
    const expanded = payload.readUInt32LE(offset + 24)
    const nameLength = payload.readUInt16LE(offset + 28)
    const extraLength = payload.readUInt16LE(offset + 30)
    const commentLength = payload.readUInt16LE(offset + 32)
    const externalAttributes = payload.readUInt32LE(offset + 38)
    const localOffset = payload.readUInt32LE(offset + 42)
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength
    if (nameLength === 0 || recordEnd > end) throw archiveError('central directory name is invalid')
    const nameBytes = payload.subarray(offset + 46, offset + 46 + nameLength)
    if ((flags & 0x800) === 0 && nameBytes.some(byte => byte > 0x7f)) {
      throw archiveError('non-ASCII paths must carry the ZIP UTF-8 flag')
    }
    const raw = nameBytes.toString('utf8')
    const directory = raw.endsWith('/')
    const path = validatePath(raw, directory)
    const folded = path.toLowerCase()
    if (seen.has(folded)) throw archiveError('duplicate or case-colliding paths were found')
    seen.add(folded)
    if ((flags & 0x1) !== 0) throw archiveError('encrypted entries are forbidden')
    if (method !== 0 && method !== 8) throw archiveError('only stored or deflated entries are supported')
    if (localOffset + 30 > centralOffset || payload.readUInt32LE(localOffset) !== 0x04034b50) {
      throw archiveError('a local file header is invalid')
    }
    const localFlags = payload.readUInt16LE(localOffset + 6)
    const localMethod = payload.readUInt16LE(localOffset + 8)
    const localNameLength = payload.readUInt16LE(localOffset + 26)
    const localExtraLength = payload.readUInt16LE(localOffset + 28)
    const localNameStart = localOffset + 30
    const localDataStart = localNameStart + localNameLength + localExtraLength
    if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength
      || localDataStart + compressed > centralOffset
      || !payload.subarray(localNameStart, localNameStart + localNameLength).equals(nameBytes)) {
      throw archiveError('local and central ZIP records do not match')
    }
    const mode = (externalAttributes >>> 16) & 0xffff
    const fileType = mode & 0xf000
    if (directory) {
      if (fileType !== 0 && fileType !== 0x4000) throw archiveError('a directory has a special file mode')
    } else {
      if (fileType !== 0 && fileType !== 0x8000) throw archiveError('links, devices, and special files are forbidden')
      if ((mode & 0o111) !== 0) throw archiveError('executable file modes are forbidden')
      if (expanded > MAX_FILE_BYTES) throw archiveError('a file exceeds 2 MiB')
      if (compressed > 0 && expanded > compressed * MAX_EXPANSION_RATIO) throw archiveError('an entry expansion ratio is unsafe')
      files += 1
      total += expanded
      compressedTotal += compressed
      records.push({ path, expanded })
    }
    offset = recordEnd
  }
  if (offset !== centralOffset + centralSize || files === 0 || files > MAX_FILES || total > MAX_ARCHIVE_BYTES) {
    throw archiveError('file inventory or expanded size is invalid')
  }
  if (compressedTotal > 0 && total > compressedTotal * MAX_EXPANSION_RATIO) throw archiveError('aggregate expansion ratio is unsafe')
  return records
}

function frontmatter(markdown) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(markdown)
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) throw archiveError('SKILL.md is missing YAML frontmatter')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (match === null || Buffer.byteLength(match[1]) > 16 * 1024) throw archiveError('SKILL.md frontmatter is invalid')
  const data = parse(match[1], { maxAliasCount: 0 })
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw archiveError('SKILL.md frontmatter must be an object')
  if (typeof data.name !== 'string' || !SKILL_NAME.test(data.name)) throw archiveError('SKILL.md name is invalid')
  if (typeof data.description !== 'string' || data.description.trim() === '') throw archiveError('SKILL.md description is required')
  const version = data.version ?? '0.0.0'
  if (typeof version !== 'string' || !VERSION.test(version)) throw archiveError('SKILL.md version is invalid')
  return { name: data.name, version }
}

export function inspectSkillArchive(payload, expected = {}) {
  const records = centralDirectory(payload)
  const entries = unzipSync(payload)
  const files = new Map()
  for (const record of records) {
    const content = entries[record.path]
    if (!(content instanceof Uint8Array) || content.byteLength !== record.expanded) {
      throw archiveError('decompressed inventory does not match the ZIP directory')
    }
    files.set(record.path, Buffer.from(content))
  }
  if (!files.has('SKILL.md')) throw archiveError('one root SKILL.md is required')
  const metadata = frontmatter(files.get('SKILL.md'))
  if (expected.slug !== undefined && metadata.name !== expected.slug) throw archiveError('SKILL.md name does not match the selected slug')
  if (expected.version !== undefined && metadata.version !== expected.version) throw archiveError('SKILL.md version does not match the selected version')
  const sha256 = digest(payload)
  if (expected.sha256 !== undefined && (!SHA256.test(expected.sha256) || sha256 !== expected.sha256)) {
    throw archiveError('package SHA-256 does not match the catalog')
  }
  return { ...metadata, sha256, files }
}

function realDirectory(path, label) {
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${label} must be a real directory`)
}

function prepareSkillInstall(payload, { dshHome, slug, version, sha256 }) {
  if (!SKILL_NAME.test(slug) || !VERSION.test(version) || !SHA256.test(sha256)) throw new Error('Skill install identity is invalid')
  const bundle = inspectSkillArchive(payload, { slug, version, sha256 })
  const root = join(dshHome, 'skills')
  mkdirSync(root, { recursive: true })
  realDirectory(root, 'Skill root')
  const target = join(root, slug)
  const temporary = join(root, `.${slug}.${randomUUID()}.tmp`)
  const backup = join(root, `.${slug}.${randomUUID()}.rollback`)
  const receipt = join(dshHome, 'e-mate', 'migrations', `skill-${slug}.json`)
  const previousReceipt = existsSync(receipt) ? readFileSync(receipt) : undefined
  let movedOld = false
  let switched = false
  try {
    mkdirSync(temporary, { recursive: false })
    for (const [path, content] of bundle.files) {
      const destination = join(temporary, ...path.split('/'))
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, content, { mode: 0o600, flag: 'wx' })
    }
    if (existsReal(target)) {
      renameSync(target, backup)
      movedOld = true
    }
    renameSync(temporary, target)
    switched = true
    atomicJson(receipt, {
      schema_version: 1,
      slug,
      version,
      package_sha256: sha256,
      status: 'pending-server-receipt',
      staged_at: new Date().toISOString(),
    })
    let settled = false
    const result = { slug, version, package_sha256: sha256, receipt }
    return {
      result,
      commit() {
        if (settled) return result
        let recoveryPending = false
        try {
          atomicJson(receipt, {
            schema_version: 1,
            slug,
            version,
            package_sha256: sha256,
            status: 'installed',
            installed_at: new Date().toISOString(),
          })
        } catch {
          recoveryPending = true
        }
        try {
          rmSync(backup, { recursive: true, force: true })
        } catch {
          recoveryPending = true
        }
        settled = true
        return recoveryPending ? { ...result, recovery_pending: true } : result
      },
      rollback() {
        if (settled) return
        rmSync(target, { recursive: true, force: true })
        if (movedOld) renameSync(backup, target)
        if (previousReceipt === undefined) rmSync(receipt, { force: true })
        else atomicWrite(receipt, previousReceipt)
        settled = true
      },
    }
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    if (switched) rmSync(target, { recursive: true, force: true })
    if (movedOld && !existsReal(target)) renameSync(backup, target)
    if (previousReceipt === undefined) rmSync(receipt, { force: true })
    else atomicWrite(receipt, previousReceipt)
    throw error
  }
}

export function installSkillArchive(payload, options) {
  return prepareSkillInstall(payload, options).commit()
}

function skillCard(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Skill Hub card is invalid')
  const card = value
  if (!SKILL_NAME.test(card.slug) || !VERSION.test(card.version) || !SHA256.test(card.package_sha256)
    || typeof card.title !== 'string' || typeof card.summary !== 'string') {
    throw new Error('Skill Hub card identity is invalid')
  }
  return {
    slug: card.slug,
    version: card.version,
    package_sha256: card.package_sha256,
    title: card.title,
    summary: card.summary,
    category: card.category,
    tags: Array.isArray(card.tags) ? card.tags.filter(tag => typeof tag === 'string') : [],
  }
}

function hubBase(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
    || url.pathname !== '/ecorex-agent/client/skill-hub/v1') {
    throw new Error('Skill Hub must use the configured HTTPS product endpoint')
  }
  return url
}

async function readBounded(response, maximum, label) {
  const header = response.headers.get('content-length')
  if (header !== null) {
    const length = Number(header)
    if (!Number.isSafeInteger(length) || length < 0) throw new Error(`${label} content length is invalid`)
    if (length > maximum) throw new Error(`${label} response is too large`)
  }
  if (response.body === null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximum) {
        await reader.cancel()
        throw new Error(`${label} response is too large`)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

async function responseJson(response, label) {
  const payload = await readBounded(response, 2 * 1024 * 1024, label)
  let value
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
  } catch {
    throw new Error(`${label} response is not JSON`)
  }
  if (!response.ok) {
    const detail = typeof value?.detail === 'string' ? value.detail : `${label} failed with HTTP ${response.status}`
    throw new Error(detail)
  }
  return value
}

function encodeSegment(value, pattern, label) {
  if (!pattern.test(value)) throw new Error(`${label} is invalid`)
  return encodeURIComponent(value)
}

async function packageBytes(response, expectedSha256) {
  if (!response.ok) throw new Error(`Skill package download failed with HTTP ${response.status}`)
  const declared = response.headers.get('x-skill-content-sha256')
  if (declared !== expectedSha256) throw new Error('Skill package response digest is invalid')
  const payload = await readBounded(response, MAX_ARCHIVE_BYTES, 'Skill package')
  if (digest(payload) !== expectedSha256) {
    throw new Error('Skill package bytes do not match the catalog')
  }
  return payload
}

function requestId(prefix) {
  return `${prefix}:${randomUUID()}`
}

function decodeArchiveBase64(value) {
  if (typeof value !== 'string'
    || value.length < 4
    || value.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw archiveError('base64 upload is invalid or too large')
  }
  const payload = Buffer.from(value, 'base64')
  if (payload.toString('base64') !== value) throw archiveError('base64 upload is not canonical')
  return payload
}

function installedSkillArchive(dshHome, slug) {
  if (!SKILL_NAME.test(slug)) throw new Error('installed Skill name is invalid')
  const root = join(dshHome, 'skills', slug)
  realDirectory(root, 'installed Skill')
  const files = {}
  let count = 0
  let total = 0
  const walk = (directory, relative = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`
      const target = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('installed Skill contains a symbolic link')
      if (entry.isDirectory()) {
        walk(target, path)
        continue
      }
      const info = lstatSync(target)
      if (!entry.isFile() || !info.isFile() || info.nlink !== 1 || (info.mode & 0o111) !== 0) {
        throw new Error('installed Skill contains a linked, special, or executable file')
      }
      validatePath(path, false)
      if (info.size > MAX_FILE_BYTES || ++count > MAX_FILES || (total += info.size) > MAX_ARCHIVE_BYTES) {
        throw new Error('installed Skill exceeds publication limits')
      }
      const content = readFileSync(target)
      const after = lstatSync(target)
      if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1
        || after.dev !== info.dev || after.ino !== info.ino || after.size !== info.size || after.mtimeMs !== info.mtimeMs) {
        throw new Error('installed Skill changed while it was being packaged')
      }
      files[path] = new Uint8Array(content)
    }
  }
  walk(root)
  const payload = Buffer.from(zipSync(files, { level: 6 }))
  inspectSkillArchive(payload, { slug })
  return payload
}

export function createSkillHubClient({ request, dshHome, baseUrl = 'https://dl.ecoremedia.net/ecorex-agent/client/skill-hub/v1' }) {
  if (typeof request !== 'function') throw new Error('Skill Hub requires the authenticated identity transport')
  const base = hubBase(baseUrl)
  const call = (path, init = {}) => request(new URL(`${base.pathname}${path}`, base.origin), {
    ...init,
    headers: { accept: 'application/json', ...init.headers },
    redirect: 'error',
  })

  const detail = async (slug) => {
    const response = await call(`/skills/${encodeSegment(slug, SKILL_NAME, 'Skill slug')}`)
    const value = await responseJson(response, 'Skill detail')
    if (!Array.isArray(value.versions) || value.versions.length === 0) throw new Error('Skill detail versions are invalid')
    return { skill: skillCard(value.skill), versions: value.versions.map(skillCard) }
  }

  const select = async (slug, version) => {
    const value = await detail(slug)
    const selected = version === undefined ? value.skill : value.versions.find(card => card.version === version)
    if (selected === undefined) throw new Error(`Skill ${slug}@${version} was not found`)
    return selected
  }

  const download = async (slug, version, signal) => {
    const card = await select(slug, version)
    signal?.throwIfAborted()
    const response = await call(`/skills/${encodeSegment(card.slug, SKILL_NAME, 'Skill slug')}/versions/${encodeSegment(card.version, VERSION, 'Skill version')}/package`, { signal })
    const payload = await packageBytes(response, card.package_sha256)
    inspectSkillArchive(payload, { slug: card.slug, version: card.version, sha256: card.package_sha256 })
    return { card, payload }
  }

  const publishPayload = async (payload, category, signal) => {
    if (!['third_party', 'content_creation', 'office_productivity'].includes(category)) throw new Error('Skill category is invalid')
    const inspected = inspectSkillArchive(payload)
    const value = await responseJson(await call('/skills', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: inspected.name,
        category,
        bundle_base64: payload.toString('base64'),
        client_request_id: requestId('publish'),
      }),
    }), 'Skill publication')
    const card = skillCard(value)
    if (card.slug !== inspected.name
      || card.version !== inspected.version
      || card.package_sha256 !== inspected.sha256) {
      throw new Error('Skill publication receipt does not match the uploaded archive')
    }
    return card
  }

  return {
    async search(query = '', signal) {
      if (typeof query !== 'string' || query.length > 128) throw new Error('Skill search query is invalid')
      const parameters = new URLSearchParams({ query, limit: '24' })
      const value = await responseJson(await call(`/skills?${parameters}`, { signal }), 'Skill catalog')
      if (value.schema_version !== 1 || !Array.isArray(value.items) || value.items.length > 24) throw new Error('Skill catalog response is invalid')
      return value.items.map(skillCard)
    },
    detail,
    async download(slug, version, signal) {
      const { card, payload } = await download(slug, version, signal)
      const id = `${card.slug}-${card.version}-${card.package_sha256.slice(0, 12)}`
      const path = join(dshHome, 'e-mate', 'cache', 'skill-hub', 'downloads', `${id}.zip`)
      mkdirSync(dirname(path), { recursive: true })
      try {
        writeFileSync(path, payload, { flag: 'wx', mode: 0o600 })
      } catch (error) {
        if (!error || typeof error !== 'object' || error.code !== 'EEXIST'
          || digest(readFileSync(path)) !== card.package_sha256) throw error
      }
      return { ...card, download_id: id, bytes: payload.byteLength }
    },
    async install(slug, version, signal) {
      const card = await select(slug, version)
      const intent = await responseJson(await call(`/skills/${encodeSegment(card.slug, SKILL_NAME, 'Skill slug')}/versions/${encodeSegment(card.version, VERSION, 'Skill version')}/install-intent`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ package_sha256: card.package_sha256, client_request_id: requestId('install') }),
      }), 'Skill install intent')
      if (typeof intent.install_intent !== 'string') throw new Error('Skill install intent response is invalid')
      const downloaded = await download(card.slug, card.version, signal)
      const claimed = await responseJson(await call('/install-intents/consume', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ install_intent: intent.install_intent }),
      }), 'Skill install claim')
      if (typeof claimed.completion_receipt !== 'string') throw new Error('Skill install claim response is invalid')
      let transaction
      let completionState = 'not-sent'
      try {
        transaction = prepareSkillInstall(downloaded.payload, {
          dshHome, slug: card.slug, version: card.version, sha256: card.package_sha256,
        })
        completionState = 'in-flight'
        const completion = await call('/install-intents/complete', {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ completion_receipt: claimed.completion_receipt, status: 'installed' }),
        })
        completionState = completion.ok ? 'accepted' : 'rejected'
        if (!completion.ok) await responseJson(completion, 'Skill install completion')
        let responseWarning = false
        try {
          await responseJson(completion, 'Skill install completion')
        } catch {
          responseWarning = true
        }
        const installed = transaction.commit()
        return {
          slug: installed.slug,
          version: installed.version,
          package_sha256: installed.package_sha256,
          ...((installed.recovery_pending || responseWarning) ? { recovery_pending: true } : {}),
        }
      } catch (error) {
        if (completionState === 'in-flight') {
          throw new Error('Skill install completion is uncertain; the verified local Skill remains pending server-receipt reconciliation', { cause: error })
        }
        transaction?.rollback()
        try {
          await call('/install-intents/complete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ completion_receipt: claimed.completion_receipt, status: 'failed' }),
          })
        } catch {}
        throw error
      }
    },
    async publish(slug, category, signal) {
      const payload = installedSkillArchive(dshHome, slug)
      return publishPayload(payload, category, signal)
    },
    async publishArchive(bundleBase64, category, signal) {
      return publishPayload(decodeArchiveBase64(bundleBase64), category, signal)
    },
  }
}

function existsReal(path) {
  try {
    realDirectory(path, 'installed Skill')
    return true
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false
    throw error
  }
}
