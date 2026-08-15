import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { loadTargetStorageDomain, loadTargetTools } from './target-runtime.js'

export const name = 'emate-memory'
export const inject = ['tools', 'workspaceRegistry', 'storageDomain']

const MAX_CONTENT_CHARS = 8_000
const MAX_QUERY_CHARS = 500
const MAX_TAGS = 16
const MAX_TAG_CHARS = 64
const MAX_RESULTS = 10
const MAX_LEGACY_FILE_BYTES = 8 * 1024 * 1024
const MAX_LEGACY_TOTAL_BYTES = 128 * 1024 * 1024
const LEGACY_RECEIPT = 'legacy-memory-v1.json'
const RECORD_KINDS = new Set(['memory', 'dream', 'learning'])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function stableUuid(value) {
  const digest = [...sha256(value).slice(0, 32)]
  digest[12] = '5'
  digest[16] = ['8', '9', 'a', 'b'][Number.parseInt(digest[16], 16) % 4]
  const text = digest.join('')
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function safeLegacyRoot(path) {
  const absolute = resolve(path)
  let metadata
  try {
    metadata = lstatSync(absolute)
  } catch {
    return undefined
  }
  return metadata.isDirectory() && !metadata.isSymbolicLink() ? realpathSync(absolute) : undefined
}

function readStableUtf8(path, root) {
  const absolute = resolve(path)
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) throw new Error('legacy memory file escapes its source root')
  let cursor = root
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, part)
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('legacy memory source crosses a symbolic link')
  }
  const descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size > MAX_LEGACY_FILE_BYTES) throw new Error('legacy memory file is invalid or too large')
    const content = readFileSync(descriptor)
    const after = fstatSync(descriptor)
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('legacy memory file changed while it was read')
    }
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content)
    } catch (error) {
      throw new Error('legacy memory file is not valid UTF-8', { cause: error })
    }
    return { content, text, mtimeMs: before.mtimeMs }
  } finally {
    closeSync(descriptor)
  }
}

function legacyMarkdownFiles(root) {
  const paths = []
  const main = join(root, 'MEMORY.md')
  if (existsSync(main)) paths.push(main)
  const memoryRoot = join(root, 'memory')
  if (!existsSync(memoryRoot)) return paths
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith('.') || entry.name === 'long-term') continue
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('legacy memory source contains a symbolic link')
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) paths.push(path)
    }
  }
  visit(memoryRoot)
  return paths
}

function chunkLegacyContent(value) {
  const chunks = []
  let content = value.trim()
  while (content.length > MAX_CONTENT_CHARS) {
    const newline = content.lastIndexOf('\n', MAX_CONTENT_CHARS)
    const at = newline >= MAX_CONTENT_CHARS / 2 ? newline : MAX_CONTENT_CHARS
    const chunk = content.slice(0, at).trim()
    if (chunk !== '') chunks.push(chunk)
    content = content.slice(at).trim()
  }
  if (content !== '') chunks.push(content)
  return chunks
}

function legacyKind(relativePath) {
  const parts = relativePath.split(/[\\/]/u).map(part => part.toLowerCase())
  if (parts.includes('dreams')) return 'dream'
  if (parts.includes('evolution')) return 'learning'
  return 'memory'
}

function planLegacyMemory(workspace, root) {
  const files = legacyMarkdownFiles(root)
  const sourceFiles = []
  const blockedUserFiles = []
  const records = []
  let totalBytes = 0
  const pathSha256 = sha256(workspace.path)
  const scopeKey = `workspace:${String(workspace.id)}:${pathSha256}`
  for (const path of files) {
    const relativePath = relative(root, path)
    const read = readStableUtf8(path, root)
    totalBytes += read.content.byteLength
    if (totalBytes > MAX_LEGACY_TOTAL_BYTES) throw new Error('legacy memory source exceeds the total import boundary')
    const identity = { path_sha256: sha256(relativePath), size: read.content.byteLength, sha256: sha256(read.content) }
    sourceFiles.push(identity)
    if (relativePath.split(sep).slice(0, 2).map(part => part.toLowerCase()).join('/') === 'memory/users') {
      blockedUserFiles.push(identity)
      continue
    }
    const chunks = chunkLegacyContent(read.text)
    const kind = legacyKind(relativePath)
    for (const [index, content] of chunks.entries()) {
      const id = stableUuid(`e-Mate legacy memory v1\u001f${sha256(root)}\u001f${identity.path_sha256}\u001f${index}`)
      const timestamp = new Date(read.mtimeMs).toISOString()
      records.push({
        schema_version: 1,
        id,
        scope_key: scopeKey,
        scope_type: 'workspace',
        workspace_id: String(workspace.id),
        path_sha256: pathSha256,
        kind,
        content,
        tags: [`legacy-${kind}`, 'copy-on-write-import'],
        source_session_id: `legacy:${sha256(root).slice(0, 32)}`,
        source_event_ids: [],
        source_digest: sha256(canonicalJson({ ...identity, index, content: sha256(content) })),
        created_at: timestamp,
        updated_at: timestamp,
      })
    }
  }
  return {
    fingerprint: sha256(canonicalJson({ root: sha256(root), files: sourceFiles })),
    records,
    sourceFiles,
    blockedUserFiles,
  }
}

function sameLegacyRecord(left, right) {
  return canonicalJson(left) === canonicalJson(right)
}

export async function migrateLegacyMemory(ctx, table, options = {}) {
  const dshHome = resolve(options.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'))
  const candidates = options.sources ?? [join(options.home || homedir(), 'ECoreX'), join(options.home || homedir(), 'cow')]
  const root = candidates.map(safeLegacyRoot).find(candidate => candidate !== undefined
    && (existsSync(join(candidate, 'MEMORY.md')) || existsSync(join(candidate, 'memory'))))
  const receiptPath = join(dshHome, 'e-mate', 'migrations', LEGACY_RECEIPT)
  if (root === undefined) return { source_found: false, imported_records: 0, reused_records: 0, pending_binding: false, receipt_path: receiptPath }
  if (root === dshHome || root.startsWith(`${dshHome}${sep}`) || dshHome.startsWith(`${root}${sep}`)) {
    throw new Error('legacy memory source and DSH_HOME must be disjoint')
  }
  const workspace = ctx.workspaceRegistry.list().find(candidate => candidate.path === root)
  if (workspace === undefined) {
    return { source_found: true, imported_records: 0, reused_records: 0, pending_binding: true, receipt_path: receiptPath }
  }
  if (await workspace.status() !== 'ok') throw new Error('legacy memory workspace is unavailable')
  const plan = planLegacyMemory(workspace, root)
  if (existsSync(receiptPath)) {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
    if (receipt?.schema_version !== 1 || receipt?.source_fingerprint !== plan.fingerprint) {
      throw new Error('legacy memory source changed after its completed migration')
    }
  }
  const existing = new Map([...table.entries()].map(([, record]) => [record.id, record]))
  let reused = 0
  for (const record of plan.records) {
    const current = existing.get(record.id)
    if (current === undefined) continue
    if (!sameLegacyRecord(current, record)) throw new Error(`legacy memory record ${record.id} conflicts with its stable target identity`)
    reused += 1
  }
  for (const record of plan.records) {
    if (!existing.has(record.id)) await table.put(record.id, record)
  }
  atomicJson(receiptPath, {
    schema_version: 1,
    completed_at: new Date().toISOString(),
    source_root_sha256: sha256(root),
    source_fingerprint: plan.fingerprint,
    target_workspace_id: String(workspace.id),
    target_workspace_path_sha256: sha256(workspace.path),
    source_files: plan.sourceFiles,
    blocked_user_scoped_files: plan.blockedUserFiles,
    records: plan.records.map(record => ({ id: record.id, kind: record.kind, source_digest: record.source_digest })),
  })
  return {
    source_found: true,
    imported_records: plan.records.length - reused,
    reused_records: reused,
    pending_binding: false,
    receipt_path: receiptPath,
  }
}

function sessionId(exec) {
  const id = exec.agent?.id
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) {
    throw new Error('e-Mate memory requires a live e-Mate session')
  }
  return id
}

export async function resolveMemoryScope(ctx, exec) {
  const id = sessionId(exec)
  const cwd = exec.agent?.session?.header?.cwd
  if (cwd !== undefined && (typeof cwd !== 'string' || cwd.length === 0)) {
    throw new Error('e-Mate session workspace is invalid')
  }
  if (cwd !== undefined) {
    const workspace = await ctx.workspaceRegistry.resolveByPath(cwd)
    if (workspace !== undefined) {
      if (await workspace.status() !== 'ok') throw new Error('the owning e-Mate project directory is unavailable')
      if (!workspace.sessionIds.some(candidate => String(candidate) === id)) {
        throw new Error('the e-Mate session is not bound to its owning project')
      }
      const pathSha256 = sha256(workspace.path)
      return {
        key: `workspace:${String(workspace.id)}:${pathSha256}`,
        type: 'workspace',
        workspaceId: String(workspace.id),
        pathSha256,
        sessionId: id,
      }
    }
  }
  return {
    key: `session:${sha256(id)}`,
    type: 'session',
    sessionId: id,
  }
}

function normalizedTags(value = []) {
  if (!Array.isArray(value) || value.length > MAX_TAGS) throw new Error(`tags must contain at most ${MAX_TAGS} strings`)
  const tags = value.map((tag) => {
    if (typeof tag !== 'string') throw new Error('each memory tag must be a string')
    const normalized = tag.trim()
    if (normalized.length === 0 || normalized.length > MAX_TAG_CHARS) {
      throw new Error(`each memory tag must contain 1 to ${MAX_TAG_CHARS} characters`)
    }
    return normalized
  })
  return [...new Set(tags)]
}

function normalizedContent(value) {
  if (typeof value !== 'string') throw new Error('memory content must be a string')
  const content = value.trim()
  if (content.length === 0 || content.length > MAX_CONTENT_CHARS) {
    throw new Error(`memory content must contain 1 to ${MAX_CONTENT_CHARS} characters`)
  }
  return content
}

function normalizedQuery(value) {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > MAX_QUERY_CHARS) {
    throw new Error(`memory query must contain at most ${MAX_QUERY_CHARS} characters`)
  }
  return value.trim().toLocaleLowerCase()
}

function normalizedLimit(value) {
  if (value === undefined) return 5
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESULTS) {
    throw new Error(`memory result limit must be an integer from 1 to ${MAX_RESULTS}`)
  }
  return value
}

function normalizedKind(value = 'memory') {
  if (!RECORD_KINDS.has(value)) throw new Error('memory record kind is invalid')
  return value
}

function normalizedKinds(value = ['memory']) {
  if (!Array.isArray(value) || value.length === 0 || value.some(kind => !RECORD_KINDS.has(kind))) {
    throw new Error('memory search kinds are invalid')
  }
  return new Set(value)
}

function normalizedSourceEventIds(value = []) {
  if (!Array.isArray(value) || value.length > 64) throw new Error('memory source event ids are invalid')
  return [...new Set(value.map((id) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 256) throw new Error('memory source event id is invalid')
    return id
  }))]
}

function normalizedSourceDigest(value) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw new Error('memory source digest is invalid')
  return value
}

function sameScope(record, scope) {
  return record.scope_key === scope.key
    && record.scope_type === scope.type
    && (scope.type !== 'workspace'
      || (record.workspace_id === scope.workspaceId && record.path_sha256 === scope.pathSha256))
}

function publicRecord(record) {
  return {
    memory_id: record.id,
    content: record.content,
    tags: record.tags,
    created_at: record.created_at,
    scope: record.scope_type,
  }
}

function createMemoryService(ctx, table) {
  const service = {
    async store(input, exec) {
      exec.signal?.throwIfAborted()
      const scope = await resolveMemoryScope(ctx, exec)
      const kind = normalizedKind(input.kind)
      const sourceDigest = normalizedSourceDigest(input.sourceDigest)
      if (sourceDigest !== undefined) {
        const existing = [...table.entries()].map(([, record]) => record).find(record =>
          record.kind === kind && sameScope(record, scope) && record.source_digest === sourceDigest)
        if (existing !== undefined) return existing
      }
      const now = new Date().toISOString()
      const record = {
        schema_version: 1,
        id: randomUUID(),
        scope_key: scope.key,
        scope_type: scope.type,
        ...(scope.type === 'workspace' ? {
          workspace_id: scope.workspaceId,
          path_sha256: scope.pathSha256,
        } : {}),
        kind,
        content: normalizedContent(input.content),
        tags: normalizedTags(input.tags),
        source_session_id: scope.sessionId,
        source_event_ids: normalizedSourceEventIds(input.sourceEventIds),
        ...(sourceDigest === undefined ? {} : { source_digest: sourceDigest }),
        created_at: now,
        updated_at: now,
      }
      await table.put(record.id, record)
      return record
    },
    async find(input, exec) {
      exec.signal?.throwIfAborted()
      const scope = await resolveMemoryScope(ctx, exec)
      const query = normalizedQuery(input.query)
      const limit = normalizedLimit(input.limit)
      const kinds = normalizedKinds(input.kinds)
      const sourceDigest = normalizedSourceDigest(input.sourceDigest)
      return [...table.entries()]
        .map(([, record]) => record)
        .filter(record => kinds.has(record.kind) && sameScope(record, scope))
        .filter(record => sourceDigest === undefined || record.source_digest === sourceDigest)
        .filter((record) => {
          if (query === '') return true
          return `${record.content}\n${record.tags.join('\n')}`.toLocaleLowerCase().includes(query)
        })
        .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
        .slice(0, limit)
    },
    async remember(input, exec) {
      return publicRecord(await service.store({ ...input, kind: 'memory' }, exec))
    },
    async search(input, exec) {
      return (await service.find({ ...input, kinds: ['memory'] }, exec)).map(publicRecord)
    },
  }
  return service
}

const rememberOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      memory_id: { type: 'string', required: true },
      content: { type: 'string', required: true },
      tags: { type: 'array', required: true, items: { type: 'string' } },
      created_at: { type: 'string', required: true },
      scope: { type: 'string', required: true, enum: ['workspace', 'session'] },
    },
  },
  render: (_args, value) => [{ type: 'text', text: `Remembered for this ${value.scope}: ${value.content}` }],
}

const searchOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { items: { type: 'array', required: true, items: { type: 'json' } } },
  },
  render: (_args, value) => [{
    type: 'text',
    text: value.items.length === 0
      ? 'No memory matched in this project or session.'
      : value.items.map(item => `- ${item.content}`).join('\n'),
  }],
}

export async function apply(ctx, config = {}) {
  const bindingPath = config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json')
  const [{ defineTool }, { defineDomain, domainTable, z }] = await Promise.all([
    loadTargetTools(bindingPath),
    loadTargetStorageDomain(bindingPath),
  ])
  const record = z.object({
    schema_version: z.literal(1),
    id: z.string().uuid(),
    scope_key: z.string().min(1).max(512),
    scope_type: z.enum(['workspace', 'session']),
    workspace_id: z.string().min(1).max(256).optional(),
    path_sha256: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
    kind: z.enum(['memory', 'dream', 'learning']),
    content: z.string().min(1).max(MAX_CONTENT_CHARS),
    tags: z.array(z.string().min(1).max(MAX_TAG_CHARS)).max(MAX_TAGS),
    source_session_id: z.string().min(1).max(256),
    source_event_ids: z.array(z.string().min(1).max(256)).max(64),
    source_digest: z.string().regex(/^[0-9a-f]{64}$/u).optional(),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  }).superRefine((value, refinement) => {
    const hasWorkspaceId = value.workspace_id !== undefined
    const hasPathSha256 = value.path_sha256 !== undefined
    if ((value.scope_type === 'workspace' && (!hasWorkspaceId || !hasPathSha256))
      || (value.scope_type === 'session' && (hasWorkspaceId || hasPathSha256))) {
      refinement.addIssue({ code: 'custom', message: 'workspace scope fields do not match scope_type' })
    }
  })
  const domain = await ctx.storageDomain.open(defineDomain({
    name: 'emate_memory',
    version: 1,
    tables: { records: domainTable(record) },
  }))
  ctx.effect(() => () => domain.close(), 'emate.memory: close target storage domain')
  const table = domain.table('records')
  const memory = createMemoryService(ctx, table)
  memory.legacyMigration = await migrateLegacyMemory(ctx, table, {
    dshHome: config.dshHome,
    home: config.home,
    sources: config.legacyMemorySources,
  })
  ctx.provide('emateMemory', memory)

  ctx.tools.register(defineTool({
    name: 'e_mate_memory_remember',
    description: 'Persist one user-approved fact or preference for only the current e-Mate project. If the session has no registered project, keep it isolated to this session. Never infer secrets or remember unverified claims.',
    parameters: {
      content: { type: 'string', required: true, description: 'The exact fact or preference the user asked e-Mate to remember.' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Optional short retrieval tags.' },
    },
    output: rememberOutput,
    execute: (args, exec) => memory.remember(args, exec),
    presentCall: args => ({ card: 'generic', title: 'Remember for this project', kind: 'write', rawInput: args.content }),
  }))

  ctx.tools.register(defineTool({
    name: 'e_mate_memory_search',
    description: 'Search only memories bound to the current e-Mate project. Sessions without a registered project can see only their own session-local memories.',
    parameters: {
      query: { type: 'string', description: 'Optional case-insensitive text or tag query. Omit to list recent memories.' },
      limit: { type: 'integer', description: `Optional result count from 1 to ${MAX_RESULTS}; defaults to 5.` },
    },
    output: searchOutput,
    execute: async (args, exec) => ({ items: await memory.search(args, exec) }),
    presentCall: args => ({ card: 'generic', title: 'Search project memory', kind: 'read', rawInput: args.query }),
  }))
}
