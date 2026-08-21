/**
 * DSH-native per-agent tool discovery with progressive schema disclosure.
 * Adapted from vibeinging/dsh-tool-search at 265ce76eda21b211dc4a4c8f30d73a6826f035ca.
 * @module @e-mate/dsh-plugin-tool-search
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'emate-tool-search'
export const inject = ['agents', 'tools']
export const TOOL_SEARCH_NAME = 'tool_search'

export interface Config {
  alwaysVisible?: string[]
  maxResults?: number
  maxQueryChars?: number
}

const RESULT_STATUSES = ['loaded', 'already_loaded', 'unavailable'] as const
type ResultStatus = typeof RESULT_STATUSES[number]

interface ResolvedConfig {
  readonly alwaysVisible: readonly RegExp[]
  readonly maxResults: number
  readonly maxQueryChars: number
}

interface CatalogEntry {
  readonly schema: ToolSchema
  readonly normalizedName: string
  readonly normalizedDescription: string
  readonly tokens: readonly string[]
  readonly frequencies: ReadonlyMap<string, number>
}

interface AgentState {
  readonly agent: Agent
  readonly catalog: ReadonlyMap<string, CatalogEntry>
  readonly selectedNames: Set<string>
  allowedNames: string[]
  liftRestriction?: () => void
  removeSearchTool?: () => void
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

function tokenize(value: string): string[] {
  return normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? []
}

function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1)
  return result
}

function catalogEntry(schema: ToolSchema): CatalogEntry {
  const tokens = [...tokenize(schema.name), ...tokenize(schema.description)]
  return {
    schema,
    normalizedName: normalizeText(schema.name),
    normalizedDescription: normalizeText(schema.description),
    tokens,
    frequencies: termFrequencies(tokens),
  }
}

function bm25(
  termFrequency: number,
  documentFrequency: number,
  documentLength: number,
  averageDocumentLength: number,
  documentCount: number,
): number {
  const k1 = 1.2
  const b = 0.75
  const inverseDocumentFrequency = Math.log(
    1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
  )
  return inverseDocumentFrequency * (
    termFrequency * (k1 + 1)
    / (termFrequency + k1 * (1 - b + b * documentLength / averageDocumentLength))
  )
}

function rankCatalog(query: string, entries: readonly CatalogEntry[]): CatalogEntry[] {
  if (entries.length === 0) return []
  const normalizedQuery = normalizeText(query)
  const queryTokens = [...new Set(tokenize(query))]
  const rawTerms = new Set(normalizedQuery.split(/\s+/u).filter(Boolean))
  const documentFrequency = new Map<string, number>()
  for (const term of queryTokens) {
    documentFrequency.set(term, entries.filter(entry => entry.frequencies.has(term)).length)
  }
  const averageDocumentLength = Math.max(
    1,
    entries.reduce((total, entry) => total + entry.tokens.length, 0) / entries.length,
  )
  return entries
    .map((entry) => {
      let score = 0
      if (entry.normalizedName === normalizedQuery) score += 1_000_000
      if (rawTerms.has(entry.normalizedName)) score += 100_000
      if (normalizedQuery && entry.normalizedName.includes(normalizedQuery)) score += 1_000
      if (normalizedQuery && entry.normalizedDescription.includes(normalizedQuery)) score += 100
      const nameTokens = new Set(tokenize(entry.schema.name))
      for (const term of queryTokens) {
        const frequency = entry.frequencies.get(term) ?? 0
        if (frequency > 0) {
          score += bm25(
            frequency,
            documentFrequency.get(term) ?? 0,
            entry.tokens.length,
            averageDocumentLength,
            entries.length,
          )
        }
        if (nameTokens.has(term)) score += 50
        if (entry.normalizedName.startsWith(term)) score += 20
      }
      return { entry, score }
    })
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || compareNames(left.entry.schema.name, right.entry.schema.name))
    .map(result => result.entry)
}

function wildcard(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

function positiveInteger(field: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`tool-search: ${field} must be a positive safe integer`)
  }
  return resolved
}

function resolveConfig(config: Config): ResolvedConfig {
  const patterns = config.alwaysVisible ?? []
  const seen = new Set<string>()
  const alwaysVisible = patterns.map((pattern) => {
    if (!pattern || pattern.trim() !== pattern || seen.has(pattern)) {
      throw new Error('tool-search: alwaysVisible entries must be unique non-empty strings without surrounding whitespace')
    }
    seen.add(pattern)
    return wildcard(pattern)
  })
  return {
    alwaysVisible,
    maxResults: positiveInteger('maxResults', config.maxResults, 5),
    maxQueryChars: positiveInteger('maxQueryChars', config.maxQueryChars, 512),
  }
}

function matchesAlwaysVisible(name: string, config: ResolvedConfig): boolean {
  return config.alwaysVisible.some(pattern => pattern.test(name))
}

/**
 * Restore only a tool set the pinned Agent Loop already persisted in its own
 * request/header. The presence of tool_search distinguishes a post-plugin
 * header from a legacy header that exposed every tool.
 */
function restoreSelection(agent: Agent, eligibleNames: ReadonlySet<string>, config: ResolvedConfig): Set<string> {
  const tools = agent.session.requestHeader()?.tools
  if (tools === undefined || !tools.some(tool => tool.name === TOOL_SEARCH_NAME)) return new Set()
  return new Set(tools
    .map(tool => tool.name)
    .filter(toolName => eligibleNames.has(toolName) && !matchesAlwaysVisible(toolName, config)))
}

function renderResult(value: {
  readonly tools: readonly { readonly name: string; readonly status: ResultStatus }[]
  readonly remainingDeferred: number
}): string {
  if (value.tools.length === 0) return 'No matching tools found.'
  return `Tool search results:\n${value.tools.map(tool => `- ${tool.name}: ${tool.status}`).join('\n')}`
    + `\nRemaining deferred tools: ${value.remainingDeferred}.`
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const states = new Map<Agent, AgentState>()
  let registryMutationDepth = 0

  function mutateRegistry<T>(operation: () => T): T {
    registryMutationDepth += 1
    try {
      return operation()
    } finally {
      registryMutationDepth -= 1
    }
  }

  function desiredAllowedNames(state: AgentState): string[] {
    return [...state.catalog.keys()]
      .filter(toolName => state.selectedNames.has(toolName) || matchesAlwaysVisible(toolName, resolved))
      .sort(compareNames)
  }

  function refreshRestriction(state: AgentState): void {
    const nextNames = desiredAllowedNames(state)
    if (state.liftRestriction !== undefined
      && nextNames.length === state.allowedNames.length
      && nextNames.every((name, index) => name === state.allowedNames[index])) return
    const liftNext = mutateRegistry(() => state.agent.ctx.tools.restrict({ allow: nextNames }))
    const liftPrevious = state.liftRestriction
    state.liftRestriction = liftNext
    state.allowedNames = nextNames
    if (liftPrevious !== undefined) mutateRegistry(liftPrevious)
  }

  function search(
    state: AgentState,
    rawQuery: string,
    requestedLimit: number | undefined,
    caller: Agent | undefined,
    parent: symbol | undefined,
  ): { query: string; tools: { name: string; status: ResultStatus }[]; remainingDeferred: number } {
    if (caller !== state.agent) throw new Error('tool_search requires its owning live agent')
    if (parent !== undefined) throw new Error('tool_search supports Native Tool Mode only')
    const query = rawQuery.trim()
    if (!query) throw new Error('tool_search query must not be blank')
    if (query.length > resolved.maxQueryChars) {
      throw new Error(`tool_search query exceeds maxQueryChars (${resolved.maxQueryChars})`)
    }
    const limit = requestedLimit ?? resolved.maxResults
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > resolved.maxResults) {
      throw new Error(`tool_search limit must be an integer from 1 to ${resolved.maxResults}`)
    }
    const matches = rankCatalog(query, [...state.catalog.values()]).slice(0, limit)
    const visibleBefore = new Set(ctx.tools.schemas(state.agent).map(schema => schema.name))
    const previousSelection = new Set(state.selectedNames)
    for (const entry of matches) state.selectedNames.add(entry.schema.name)
    if (state.selectedNames.size !== previousSelection.size) {
      try {
        refreshRestriction(state)
      } catch (error: unknown) {
        state.selectedNames.clear()
        for (const name of previousSelection) state.selectedNames.add(name)
        refreshRestriction(state)
        throw error
      }
    }
    const visibleAfter = new Set(ctx.tools.schemas(state.agent).map(schema => schema.name))
    return {
      query,
      tools: matches.map(entry => ({
        name: entry.schema.name,
        status: !visibleAfter.has(entry.schema.name)
          ? 'unavailable'
          : visibleBefore.has(entry.schema.name) ? 'already_loaded' : 'loaded',
      })),
      remainingDeferred: [...state.catalog.keys()].filter(name => !visibleAfter.has(name)).length,
    }
  }

  function install(agent: Agent): void {
    if (states.has(agent)) return
    const inheritedSchemas = ctx.tools.schemas(agent)
    // Code/both modes own their own generated SDK disclosure. Do not layer a
    // Native-only search transport over that presentation.
    if (inheritedSchemas.some(schema => schema.name === 'run_code')) return
    const catalog = new Map(inheritedSchemas.map(schema => [schema.name, catalogEntry(schema)]))
    const eligibleNames = new Set(catalog.keys())
    const state: AgentState = {
      agent,
      catalog,
      selectedNames: restoreSelection(agent, eligibleNames, resolved),
      allowedNames: [],
    }
    states.set(agent, state)
    try {
      state.removeSearchTool = mutateRegistry(() => agent.ctx.tools.register(defineTool({
        name: TOOL_SEARCH_NAME,
        description: 'Search currently deferred tools by capability or exact name. Matching tools become available on the next model step.',
        parameters: {
          query: {
            type: 'string',
            required: true,
            description: `Capability or exact tool name to find (maximum ${resolved.maxQueryChars} characters).`,
          },
          limit: {
            type: 'integer',
            description: `Maximum matches to load, from 1 to ${resolved.maxResults}.`,
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string', required: true },
              tools: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true },
                    status: { type: 'string', required: true, enum: [...RESULT_STATUSES] },
                  },
                },
              },
              remainingDeferred: { type: 'integer', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
        },
        presentCall: args => ({ card: 'generic', title: '查找工具', kind: 'search', rawInput: args.query }),
        presentResult: (_args, result) => ({
          card: 'generic',
          title: result.isError ? '工具查找失败' : '工具已披露',
          content: result.content,
        }),
        execute: (args, exec) => Promise.resolve(search(state, args.query, args.limit, exec.agent, exec.parent)),
      })))
      refreshRestriction(state)
    } catch (error: unknown) {
      states.delete(agent)
      mutateRegistry(() => { state.removeSearchTool?.() })
      throw error
    }
  }

  function uninstall(agent: Agent): void {
    const state = states.get(agent)
    if (state === undefined) return
    states.delete(agent)
    mutateRegistry(() => {
      state.liftRestriction?.()
      state.removeSearchTool?.()
    })
  }

  ctx.on('agent/created', ({ agent }) => { install(agent) })
  ctx.on('agent/disposed', ({ agent }) => { uninstall(agent) })
  ctx.on('tools/change', () => {
    if (registryMutationDepth > 0) return
    // Rebuild from the real post-policy inherited view. Tool-set changes are
    // rare; this keeps one source of truth and avoids a second tool registry.
    for (const agent of ctx.agents.list()) {
      uninstall(agent)
      install(agent)
    }
  })
  for (const agent of ctx.agents.list()) install(agent)
  ctx.effect(() => () => {
    for (const agent of [...states.keys()]) uninstall(agent)
  }, 'emate-tool-search: per-agent native restrictions')
}

