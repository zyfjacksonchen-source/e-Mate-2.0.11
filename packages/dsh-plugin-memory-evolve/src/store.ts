import { createHash, randomUUID } from 'node:crypto'
import type { MemoryExecution, MemoryScope } from './scope.ts'

const MAX_CONTENT_CHARS = 8_000
const MAX_QUERY_CHARS = 1_000
const MAX_RESULTS = 20
const MAX_TAGS = 16
const MAX_TAG_CHARS = 64
const MAX_IMPORT_ITEMS = 1_000
const SHA256 = /^[0-9a-f]{64}$/u

/** Durable project- or session-scoped memory record. */
export interface MemoryRecord {
  readonly schemaVersion: 1
  readonly id: string
  readonly scopeKey: string
  readonly scopeKind: MemoryScope['kind']
  readonly projectId?: string
  readonly projectPathSha256?: string
  readonly content: string
  readonly tags: readonly string[]
  readonly writtenBySessionId?: string
  readonly sourceDigest?: string
  readonly createdAt: string
}

/** Validated copy-on-write input produced by the separate legacy reader. */
export interface MemoryCopyInput {
  readonly content: string
  readonly tags?: readonly string[]
  readonly sourceDigest: string
  readonly createdAt: string
}

/** Minimal Harness domain table used by the adapter. */
export interface MemoryTable {
  entries(): IterableIterator<[string, MemoryRecord]>
  put(key: string, value: MemoryRecord): Promise<void>
}

export interface MemoryPublicRecord {
  readonly memory_id: string
  readonly content: string
  readonly tags: readonly string[]
  readonly created_at: string
  readonly scope: MemoryScope['kind']
}

type ScopeResolver = (execution: MemoryExecution) => Promise<MemoryScope>

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

function stableUuid(value: string): string {
  const digest = [...sha256(value).slice(0, 32)]
  digest[12] = '5'
  digest[16] = ['8', '9', 'a', 'b'][Number.parseInt(digest[16]!, 16) % 4]!
  const text = digest.join('')
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`
}

function content(value: unknown): string {
  if (typeof value !== 'string') throw new Error('memory content must be a string')
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > MAX_CONTENT_CHARS) {
    throw new Error(`memory content must contain 1 to ${MAX_CONTENT_CHARS} characters`)
  }
  return normalized
}

function tags(value: readonly string[] | undefined): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_TAGS) {
    throw new Error(`memory tags must contain at most ${MAX_TAGS} strings`)
  }
  return [...new Set(value.map((tag) => {
    if (typeof tag !== 'string') throw new Error('each memory tag must be a string')
    const normalized = tag.trim()
    if (normalized.length === 0 || normalized.length > MAX_TAG_CHARS) {
      throw new Error(`each memory tag must contain 1 to ${MAX_TAG_CHARS} characters`)
    }
    return normalized
  }))]
}

function query(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value !== 'string' || value.length > MAX_QUERY_CHARS) {
    throw new Error(`memory query must contain at most ${MAX_QUERY_CHARS} characters`)
  }
  return value.trim().toLocaleLowerCase()
}

function limit(value: unknown): number {
  if (value === undefined) return 5
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_RESULTS) {
    throw new Error(`memory result limit must be an integer from 1 to ${MAX_RESULTS}`)
  }
  return value as number
}

function isoInstant(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('memory import createdAt must be an ISO-8601 instant')
  }
  return value
}

function sameScope(record: MemoryRecord, scope: MemoryScope): boolean {
  return record.scopeKey === scope.key
    && record.scopeKind === scope.kind
    && (scope.kind === 'session'
      ? record.projectId === undefined && record.projectPathSha256 === undefined
      : record.projectId === scope.projectId && record.projectPathSha256 === scope.projectPathSha256)
}

function scopedRecord(
  scope: MemoryScope,
  value: Omit<MemoryRecord, 'scopeKey' | 'scopeKind' | 'projectId' | 'projectPathSha256'>,
): MemoryRecord {
  return {
    ...value,
    scopeKey: scope.key,
    scopeKind: scope.kind,
    ...(scope.kind === 'project'
      ? { projectId: scope.projectId, projectPathSha256: scope.projectPathSha256 }
      : {}),
  }
}

const publicRecord = (record: MemoryRecord): MemoryPublicRecord => ({
  memory_id: record.id,
  content: record.content,
  tags: record.tags,
  created_at: record.createdAt,
  scope: record.scopeKind,
})

function sameImportedRecord(left: MemoryRecord, right: MemoryRecord): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.id === right.id
    && left.scopeKey === right.scopeKey
    && left.scopeKind === right.scopeKind
    && left.projectId === right.projectId
    && left.projectPathSha256 === right.projectPathSha256
    && left.content === right.content
    && left.tags.length === right.tags.length
    && left.tags.every((tag, index) => tag === right.tags[index])
    && left.writtenBySessionId === right.writtenBySessionId
    && left.sourceDigest === right.sourceDigest
    && left.createdAt === right.createdAt
}

/** Project-isolated memory operations over the Harness storage domain. */
export class MemoryStore {
  constructor(
    private readonly table: MemoryTable,
    private readonly resolveScope: ScopeResolver,
  ) {}

  /** Store one explicitly requested memory in the current scope. */
  async remember(input: { readonly content: unknown; readonly tags?: readonly string[] }, execution: MemoryExecution): Promise<MemoryPublicRecord> {
    const scope = await this.resolveScope(execution)
    const record = scopedRecord(scope, {
      schemaVersion: 1,
      id: randomUUID(),
      content: content(input.content),
      tags: tags(input.tags),
      writtenBySessionId: scope.sessionId,
      createdAt: new Date().toISOString(),
    })
    await this.table.put(record.id, record)
    return publicRecord(record)
  }

  /** Search only the current authoritative project or session scope. */
  async search(input: { readonly query?: unknown; readonly limit?: unknown }, execution: MemoryExecution): Promise<MemoryPublicRecord[]> {
    const scope = await this.resolveScope(execution)
    const needle = query(input.query)
    return [...this.table.entries()]
      .map(([, record]) => record)
      .filter(record => sameScope(record, scope))
      .filter(record => needle === '' || `${record.content}\n${record.tags.join('\n')}`.toLocaleLowerCase().includes(needle))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, limit(input.limit))
      .map(publicRecord)
  }

  /**
   * Copy already-read legacy records into the current scope without touching their source.
   * The caller owns source discovery and read-only validation; retries are idempotent by digest.
   */
  async copyIn(inputs: readonly MemoryCopyInput[], execution: MemoryExecution): Promise<{ imported: number; reused: number }> {
    if (!Array.isArray(inputs) || inputs.length > MAX_IMPORT_ITEMS) {
      throw new Error(`memory import must contain at most ${MAX_IMPORT_ITEMS} records`)
    }
    const scope = await this.resolveScope(execution)
    const planned = inputs.map((input) => {
      if (typeof input !== 'object' || input === null || !SHA256.test(input.sourceDigest)) {
        throw new Error('memory import sourceDigest must be a SHA-256 digest')
      }
      const sourceDigest = input.sourceDigest
      return scopedRecord(scope, {
        schemaVersion: 1,
        id: stableUuid(`e-Mate memory import v1\u001f${scope.key}\u001f${sourceDigest}`),
        content: content(input.content),
        tags: tags(input.tags),
        sourceDigest,
        createdAt: isoInstant(input.createdAt),
      })
    })
    if (new Set(planned.map(record => record.id)).size !== planned.length) {
      throw new Error('memory import contains duplicate source digests')
    }

    const existing = new Map(this.table.entries())
    for (const record of planned) {
      const current = existing.get(record.id)
      if (current !== undefined && !sameImportedRecord(current, record)) {
        throw new Error(`memory import record ${record.id} conflicts with its stable identity`)
      }
    }

    let imported = 0
    let reused = 0
    for (const record of planned) {
      if (existing.has(record.id)) {
        reused += 1
      } else {
        await this.table.put(record.id, record)
        imported += 1
      }
    }
    return { imported, reused }
  }
}
