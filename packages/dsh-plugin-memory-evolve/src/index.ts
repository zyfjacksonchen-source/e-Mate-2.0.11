import { isAbsolute } from 'node:path'
import type { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import { resolveMemoryScope, type MemoryExecution, type MemoryWorkspaceRegistry } from './scope.ts'
import {
  MemoryStore,
  normalizeMemoryRememberInput,
  type MemoryRecord,
  type MemoryRememberInput,
  type MemoryTable,
} from './store.ts'

export const name = 'emate-memory-evolve'
export const inject = ['tools', 'systemPrompt', 'workspaceRegistry', 'storageDomain', 'userQuestions']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const RECORD_KEYS = new Set([
  'schemaVersion',
  'id',
  'scopeKey',
  'scopeKind',
  'projectId',
  'projectPathSha256',
  'content',
  'tags',
  'writtenBySessionId',
  'sourceDigest',
  'createdAt',
])

function canonicalInstant(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value
}

function parseMemoryRecord(value: unknown): MemoryRecord {
  if (!isRecord(value)
    || Object.keys(value).some(key => !RECORD_KEYS.has(key))
    || value.schemaVersion !== 1
    || typeof value.id !== 'string' || !UUID.test(value.id)
    || typeof value.scopeKey !== 'string' || value.scopeKey.length > 512
    || (value.scopeKind !== 'project' && value.scopeKind !== 'session')
    || typeof value.content !== 'string' || value.content.length < 1 || value.content.length > 8_000
    || !Array.isArray(value.tags) || value.tags.length > 16
    || value.tags.some(tag => typeof tag !== 'string' || tag.length < 1 || tag.length > 64)
    || new Set(value.tags).size !== value.tags.length
    || (value.writtenBySessionId !== undefined
      && (typeof value.writtenBySessionId !== 'string' || value.writtenBySessionId.length < 1 || value.writtenBySessionId.length > 256))
    || (value.sourceDigest !== undefined && (typeof value.sourceDigest !== 'string' || !SHA256.test(value.sourceDigest)))
    || !canonicalInstant(value.createdAt)) {
    throw new Error('stored e-Mate memory record is invalid')
  }
  if (value.scopeKind === 'project') {
    if (typeof value.projectId !== 'string' || value.projectId.length < 1 || value.projectId.length > 256
      || typeof value.projectPathSha256 !== 'string' || !SHA256.test(value.projectPathSha256)
      || value.scopeKey !== `project:${value.projectId}:${value.projectPathSha256}`) {
      throw new Error('stored e-Mate project memory identity is invalid')
    }
  } else if (value.projectId !== undefined || value.projectPathSha256 !== undefined
    || !/^session:[0-9a-f]{64}$/u.test(value.scopeKey)) {
    throw new Error('stored e-Mate session memory identity is invalid')
  }
  return value as unknown as MemoryRecord
}

const memoryRecord = { parse: parseMemoryRecord }

const memoryDomain = {
  name: 'emate_memory_evolve',
  version: 1,
  tables: { records: { valueSchema: memoryRecord } },
} as const

interface MemoryDomain {
  table(name: 'records'): MemoryTable
  close(): Promise<void>
}

interface MemoryPluginContext {
  readonly workspaceRegistry: MemoryWorkspaceRegistry
  readonly storageDomain: { open(spec: typeof memoryDomain): Promise<MemoryDomain> }
  readonly userQuestions: UserQuestionService
  readonly tools: { register(definition: unknown): () => void }
  readonly systemPrompt: {
    section(section: { name: string; order: number; text: string }): () => void
  }
  effect(effect: () => () => void | Promise<void>, label: string): void
  provide(name: 'emateMemory', service: MemoryStore): void
}

interface MemoryConfig {
  readonly sessionOnlyWorkspacePath?: string
}

const publicRecordSchema = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['memory_id', 'content', 'tags', 'created_at', 'scope'],
  properties: {
    memory_id: { type: 'string' as const },
    content: { type: 'string' as const },
    tags: { type: 'array' as const, items: { type: 'string' as const } },
    created_at: { type: 'string' as const },
    scope: { type: 'string' as const, enum: ['project', 'session'] },
  },
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function rememberInput(value: unknown): MemoryRememberInput {
  if (!isRecord(value)
    || !Object.keys(value).every(key => key === 'content' || key === 'tags')
    || !Object.hasOwn(value, 'content')) {
    throw new Error('e_mate_memory_remember arguments are invalid')
  }
  return normalizeMemoryRememberInput({
    content: value.content,
    ...(value.tags === undefined ? {} : { tags: value.tags as readonly string[] }),
  })
}

function searchInput(value: unknown): { query?: unknown; limit?: unknown } {
  if (!isRecord(value) || !Object.keys(value).every(key => key === 'query' || key === 'limit')) {
    throw new Error('e_mate_memory_search arguments are invalid')
  }
  return {
    ...(value.query === undefined ? {} : { query: value.query }),
    ...(value.limit === undefined ? {} : { limit: value.limit }),
  }
}

function deleteInput(value: unknown): string {
  if (!isRecord(value) || Object.keys(value).length !== 1 || typeof value.memory_id !== 'string' || !UUID.test(value.memory_id)) {
    throw new Error('e_mate_memory_delete arguments are invalid')
  }
  return value.memory_id
}

async function confirmRemember(
  ctx: MemoryPluginContext,
  input: MemoryRememberInput,
  execution: MemoryExecution,
): Promise<void> {
  if (execution.agent === undefined) throw new Error('e-Mate memory requires an owning Agent session')
  const answer = await ctx.userQuestions.ask({
    agent: execution.agent as never,
    signal: execution.signal,
    questions: [{
      id: 'e-mate-memory-remember',
      header: '保存记忆',
      question: '是否将以下内容保存到当前项目或会话记忆？',
      detail: input.tags.length === 0
        ? input.content
        : `${input.content}\n\n标签：${input.tags.join('、')}`,
      options: [
        { label: '保存', description: '写入当前项目；未分组会话只写入当前会话。' },
        { label: '取消', description: '不保存这条记忆。' },
      ],
    }],
  })
  if (answer.answers[0]?.selected.includes('保存') !== true) {
    throw new Error('e-Mate memory write was cancelled by the user')
  }
}

async function confirmDelete(ctx: MemoryPluginContext, memoryId: string, execution: MemoryExecution): Promise<void> {
  if (execution.agent === undefined) throw new Error('e-Mate memory requires an owning Agent session')
  const answer = await ctx.userQuestions.ask({
    agent: execution.agent as never,
    signal: execution.signal,
    questions: [{
      id: 'e-mate-memory-delete',
      header: '删除记忆',
      question: '是否从当前项目或会话中删除这条记忆？',
      detail: memoryId,
      options: [
        { label: '删除', description: '只删除当前项目或会话中匹配的记忆。' },
        { label: '取消', description: '保留这条记忆。' },
      ],
    }],
  })
  if (answer.answers[0]?.selected.includes('删除') !== true) {
    throw new Error('e-Mate memory delete was cancelled by the user')
  }
}

/** Register project-isolated memory on Harness storage, Tool, and prompt seams. */
export async function apply(ctx: MemoryPluginContext, config: MemoryConfig = {}): Promise<void> {
  if (config.sessionOnlyWorkspacePath !== undefined && !isAbsolute(config.sessionOnlyWorkspacePath)) {
    throw new Error('e-Mate session-only workspace path must be absolute')
  }
  const domain = await ctx.storageDomain.open(memoryDomain)
  ctx.effect(() => () => domain.close(), 'emate.memory-evolve: close storage domain')
  const memory = new MemoryStore(
    domain.table('records'),
    execution => resolveMemoryScope(ctx.workspaceRegistry, execution, config),
  )
  ctx.provide('emateMemory', memory)

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'emate:project-memory',
    order: 118,
    text: 'Use e_mate_memory_search to retrieve memory only when it helps the current task. Use '
      + 'e_mate_memory_remember only when the user explicitly asks to remember a verified fact or preference. '
      + 'Use e_mate_memory_delete only when the user explicitly asks to delete a specific memory. '
      + 'The runtime binds every operation to the current project; an ungrouped conversation is session-only.',
  }), 'emate.memory-evolve: prompt guidance')

  ctx.effect(() => ctx.tools.register({
    name: 'e_mate_memory_remember',
    description: 'Remember one user-approved fact or preference only for the current e-Mate project. An ungrouped conversation keeps it only in that session.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'Exact verified fact or preference the user explicitly asked e-Mate to remember.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional short retrieval tags.' },
      },
    },
    output: {
      schema: publicRecordSchema,
      render: (_args: unknown, value: { scope: string; content: string }) => [{ type: 'text', text: `Remembered for this ${value.scope}: ${value.content}` }],
    },
    execute: async (args: unknown, execution: MemoryExecution) => {
      const input = rememberInput(args)
      await confirmRemember(ctx, input, execution)
      return memory.remember(input, execution)
    },
    presentCall: (args: unknown) => isRecord(args) && typeof args.content === 'string'
      ? { card: 'generic', title: 'Remember for this project', kind: 'write', rawInput: args.content }
      : undefined,
  }), 'emate.memory-evolve: remember tool')

  ctx.effect(() => ctx.tools.register({
    name: 'e_mate_memory_search',
    description: 'Search only memory bound to the current e-Mate project. An ungrouped conversation can search only its own session memory.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive text or tag query.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Optional result count; defaults to 5.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['items'],
        properties: { items: { type: 'array', items: publicRecordSchema } },
      },
      render: (_args: unknown, value: { items: readonly { content: string }[] }) => [{
        type: 'text',
        text: value.items.length === 0
          ? 'No memory matched in this project or session.'
          : value.items.map(item => `- ${item.content}`).join('\n'),
      }],
    },
    execute: async (args: unknown, execution: MemoryExecution) => ({ items: await memory.search(searchInput(args), execution) }),
    presentCall: (args: unknown) => isRecord(args) && (args.query === undefined || typeof args.query === 'string')
      ? { card: 'generic', title: 'Search project memory', kind: 'read', rawInput: args.query }
      : undefined,
  }), 'emate.memory-evolve: search tool')

  ctx.effect(() => ctx.tools.register({
    name: 'e_mate_memory_delete',
    description: 'Delete one user-confirmed memory only from the current e-Mate project or ungrouped session.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['memory_id'],
      properties: { memory_id: { type: 'string', description: 'Exact memory_id returned by e_mate_memory_search.' } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['deleted', 'memory_id'],
        properties: { deleted: { type: 'boolean' }, memory_id: { type: 'string' } },
      },
      render: (_args: unknown, value: { deleted: boolean }) => [{
        type: 'text',
        text: value.deleted ? 'Memory deleted from this project or session.' : 'No matching memory exists in this project or session.',
      }],
    },
    execute: async (args: unknown, execution: MemoryExecution) => {
      const memoryId = deleteInput(args)
      await confirmDelete(ctx, memoryId, execution)
      return { deleted: await memory.delete(memoryId, execution), memory_id: memoryId }
    },
    presentCall: (args: unknown) => isRecord(args) && typeof args.memory_id === 'string'
      ? { card: 'generic', title: 'Delete project memory', kind: 'write', rawInput: args.memory_id }
      : undefined,
  }), 'emate.memory-evolve: delete tool')
}

export { MemoryStore } from './store.ts'
export { resolveMemoryScope } from './scope.ts'
