export interface SearchMcpServerConfig {
  id: string
  kind: string
  credentialRef: string
  maxResults?: number
}

export interface SearchMcpConfig {
  defaultServer: string
  maxResults: number
  searchTimeoutMs: number
  servers: SearchMcpServerConfig[]
}

type SearchProviderKind = 'tavily' | 'brave' | 'exa' | 'perplexity'

interface Preset {
  url: string
  authStyle: 'query' | 'header'
  authParam: string
  toolName: string
  countArg: string
}

export interface ResolvedServer extends SearchMcpServerConfig, Preset {
  kind: SearchProviderKind
}

const PRESETS: Record<SearchProviderKind, Preset> = {
  tavily: { url: 'https://mcp.tavily.com/mcp/', authStyle: 'query', authParam: 'tavilyApiKey', toolName: 'tavily_search', countArg: 'max_results' },
  brave: { url: 'https://mcp.brave.com/mcp/', authStyle: 'query', authParam: 'braveApiKey', toolName: 'brave_web_search', countArg: 'count' },
  exa: { url: 'https://mcp.exa.ai/mcp', authStyle: 'header', authParam: 'x-api-key', toolName: 'web_search_exa', countArg: 'numResults' },
  perplexity: { url: 'https://mcp.perplexity.ai/mcp/', authStyle: 'query', authParam: 'pplx_api_key', toolName: 'pplx_search', countArg: 'max_results' },
}

const SERVER_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u
const CREDENTIAL_REF = /^[A-Z][A-Z0-9_]{0,127}$/u
const MAX_SERVERS = 8

function isProviderKind(value: string): value is SearchProviderKind {
  return Object.hasOwn(PRESETS, value)
}

/** Fail closed before Settings can activate an endpoint or credential binding. */
export function validateSearchConfig(config: SearchMcpConfig): void {
  if (config.servers.length > MAX_SERVERS) throw new Error(`search-mcp supports at most ${MAX_SERVERS} servers`)
  const ids = new Set<string>()
  for (const server of config.servers) {
    if (!SERVER_ID.test(server.id)) throw new Error(`search-mcp server id is invalid: ${server.id}`)
    if (ids.has(server.id)) throw new Error(`search-mcp server id is duplicated: ${server.id}`)
    ids.add(server.id)
    if (!isProviderKind(server.kind)) throw new Error(`search-mcp provider is not allowed: ${server.kind}`)
    if (!CREDENTIAL_REF.test(server.credentialRef)) {
      throw new Error(`search-mcp credential reference is invalid for ${server.id}`)
    }
    if (server.maxResults !== undefined
      && (!Number.isInteger(server.maxResults) || server.maxResults < 1 || server.maxResults > 50)) {
      throw new Error(`search-mcp maxResults is invalid for ${server.id}`)
    }
  }
  if (config.defaultServer !== '' && !ids.has(config.defaultServer)) {
    throw new Error(`search-mcp default server is not configured: ${config.defaultServer}`)
  }
}

/** Resolve only an allowlisted provider; users cannot override endpoints or auth fields. */
export function resolveServer(server: SearchMcpServerConfig): ResolvedServer {
  if (!isProviderKind(server.kind)) throw new Error(`search-mcp provider is not allowed: ${server.kind}`)
  return { ...server, kind: server.kind, ...PRESETS[server.kind] }
}

export function resolveSearchLimit(server: SearchMcpServerConfig, requestMax: number | undefined, defaultMax: number): number {
  return server.maxResults ?? requestMax ?? defaultMax
}

const TITLE_KEYS = ['title', 'name', 'headline']
const SNIPPET_KEYS = ['snippet', 'content', 'description', 'text', 'excerpt', 'summary']
const DATE_KEYS = ['published_date', 'publishedDate', 'published_at', 'publish_date', 'publishedAt', 'page_age', 'age', 'date']
const MAX_RESULT_NODES = 5_000
const MAX_RESULT_DEPTH = 12

export interface NormalizedSearchResult {
  content?: string
  sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }>
  truncated: boolean
}

/** Normalize untrusted MCP output with explicit traversal and source budgets. */
export function extractSearchResult(result: unknown, maxSources = 50): NormalizedSearchResult {
  const bucket = {
    sources: [] as NormalizedSearchResult['sources'],
    seen: new Set<string>(),
    content: '',
    truncated: false,
  }
  const queue: Array<{ value: unknown; depth: number }> = []
  const enqueue = (value: unknown, depth: number): void => {
    if (depth > MAX_RESULT_DEPTH || queue.length >= MAX_RESULT_NODES) {
      bucket.truncated = true
      return
    }
    queue.push({ value, depth })
  }
  if (isRecord(result)) {
    enqueue(result.structuredContent, 0)
    if (Array.isArray(result.content)) {
      for (const block of result.content) {
        if (!isRecord(block)) continue
        if (block.type === 'json') enqueue(block.json, 0)
        if (block.type === 'text' && typeof block.text === 'string') {
          try {
            enqueue(JSON.parse(block.text), 0)
          } catch {
            if (bucket.content.length === 0) bucket.content = block.text.trim().slice(0, 4000)
          }
        }
      }
    }
  }
  const visited = new WeakSet<object>()
  for (let index = 0; index < queue.length && index < MAX_RESULT_NODES; index += 1) {
    const { value, depth } = queue[index]!
    if (typeof value !== 'object' || value === null || visited.has(value)) continue
    visited.add(value)
    if (Array.isArray(value)) {
      for (const entry of value) enqueue(entry, depth + 1)
      continue
    }
    const url = sourceUrl(value.url)
    if (url !== undefined) {
      if (!bucket.seen.has(url)) {
        bucket.seen.add(url)
        if (bucket.sources.length >= maxSources) {
          bucket.truncated = true
        } else {
          const title = truncate(firstString(value, TITLE_KEYS), 300)
          const snippet = truncate(firstString(value, SNIPPET_KEYS), 600)
          const publishedAt = truncate(firstString(value, DATE_KEYS), 100)
          bucket.sources.push({ url, ...(title === undefined ? {} : { title }), ...(snippet === undefined ? {} : { snippet }), ...(publishedAt === undefined ? {} : { publishedAt }) })
        }
      }
      continue
    }
    if (bucket.content.length === 0 && typeof value.answer === 'string') {
      bucket.content = value.answer.trim().slice(0, 4000)
    }
    for (const nested of Object.values(value)) enqueue(nested, depth + 1)
  }
  return { sources: bucket.sources, truncated: bucket.truncated, ...(bucket.content.length === 0 ? {} : { content: bucket.content }) }
}

function sourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function firstString(value: Record<string, unknown>, names: string[]): string | undefined {
  for (const name of names) {
    const candidate = value[name]
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  return undefined
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined
  return value.length > max ? `${value.slice(0, max)}…` : value
}
