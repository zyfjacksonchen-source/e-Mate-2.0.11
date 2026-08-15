/** e-Mate's rc.5 adapter for the pinned dsh-search-mcp provider. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { WebError, type WebSearchProvider, type WebSearchResult } from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'

export const name = '@e-mate/dsh-plugin-search-mcp'
export const inject = ['web', 'credentials']
export const SEARCH_MCP_PROVIDER_ID = 'search-mcp'
export const SEARCH_MCP_SETTINGS_NAMESPACE = settingsNamespace('search-mcp')

const serverSchema = z.object({
  id: z.string(),
  kind: z.string().default('custom'),
  transport: z.string().default('http'),
  url: z.string().default(''),
  command: z.string().default(''),
  args: z.array(z.string()).default([]),
  credentialRef: z.string().role('credential-ref').default(''),
  authStyle: z.string().default(''),
  authParam: z.string().default(''),
  toolName: z.string().default(''),
  maxResults: z.number().step(1).min(1).max(50),
})

export interface SearchMcpServerConfig {
  id: string
  kind: string
  transport: string
  url: string
  command: string
  args: string[]
  credentialRef: string
  authStyle: string
  authParam: string
  toolName: string
  maxResults?: number
}

export interface SearchMcpConfig {
  defaultServer: string
  maxResults: number
  searchTimeoutMs: number
  servers: SearchMcpServerConfig[]
}

export const Config: Schema<SearchMcpConfig> = z.object({
  defaultServer: z.string().default(''),
  maxResults: z.number().step(1).min(1).max(50).default(8),
  searchTimeoutMs: z.number().step(1).min(1000).max(120000).default(30000),
  servers: z.array(serverSchema).default([]),
})

type Server = SearchMcpServerConfig

interface ResolvedServer extends Server {
  transport: string
  url: string
  command: string
  args: string[]
  credentialRef: string
  authStyle: string
  authParam: string
  toolName: string
  countArg: string
  needsKey: boolean
}

interface ProviderOptions {
  servers: Server[]
  defaultServer: string
  maxResults: number
  searchTimeoutMs: number
  resolveKey(server: ResolvedServer): Promise<string | undefined>
}

interface Preset {
  transport: 'http' | 'stdio'
  url?: string
  command?: string
  args?: string[]
  authStyle?: 'query' | 'header'
  authParam?: string
  toolName: string
  countArg: string
  needsKey: boolean
}

const PRESETS: Record<string, Preset> = {
  tavily: { transport: 'http', url: 'https://mcp.tavily.com/mcp/', authStyle: 'query', authParam: 'tavilyApiKey', toolName: 'tavily_search', countArg: 'max_results', needsKey: true },
  brave: { transport: 'http', url: 'https://mcp.brave.com/mcp/', authStyle: 'query', authParam: 'braveApiKey', toolName: 'brave_web_search', countArg: 'count', needsKey: true },
  exa: { transport: 'http', url: 'https://mcp.exa.ai/mcp', authStyle: 'header', authParam: 'x-api-key', toolName: 'web_search_exa', countArg: 'numResults', needsKey: true },
  perplexity: { transport: 'http', url: 'https://mcp.perplexity.ai/mcp/', authStyle: 'query', authParam: 'pplx_api_key', toolName: 'pplx_search', countArg: 'max_results', needsKey: true },
  duckduckgo: { transport: 'stdio', command: 'npx', args: ['-y', 'duckduckgo-mcp-server'], toolName: 'ddg_web_search', countArg: '', needsKey: false },
  custom: { transport: 'http', toolName: '', countArg: '', needsKey: false },
}

/** Resolve a configured server against the pinned upstream provider catalog. */
export function resolveServer(server: Server): ResolvedServer {
  const preset = PRESETS[server.kind] ?? PRESETS.custom!
  return {
    ...server,
    transport: server.transport || preset.transport,
    url: server.url || preset.url || '',
    command: server.command || preset.command || '',
    args: server.args.length > 0 ? server.args : preset.args ?? [],
    credentialRef: server.credentialRef || '',
    authStyle: server.authStyle || preset.authStyle || '',
    authParam: server.authParam || preset.authParam || '',
    toolName: server.toolName || preset.toolName,
    countArg: preset.countArg,
    needsKey: preset.needsKey,
  }
}

class SearchMcpProvider implements WebSearchProvider {
  readonly id = SEARCH_MCP_PROVIDER_ID

  constructor(private readonly options: () => ProviderOptions) {}

  available(): boolean {
    return this.options().servers.length > 0
  }

  async search(request: { readonly query: string; readonly maxResults?: number }, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.options()
    const server = selectServer(options)
    const resolved = resolveServer(server)
    const key = await options.resolveKey(resolved)
    if (resolved.needsKey && key === undefined) {
      throw new WebError(
        `search-mcp server "${resolved.id}" has no resolvable credentialRef`,
        'WEB_PROVIDER_ERROR',
      )
    }
    const maxResults = resolved.maxResults ?? options.maxResults ?? request.maxResults ?? 8
    const timeout = AbortSignal.timeout(options.searchTimeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    return extractSearchResult(await callMcpSearch(resolved, key, request.query, maxResults, combined))
  }
}

function selectServer(options: ProviderOptions): Server {
  if (options.servers.length === 0) {
    throw new WebError('search-mcp: no server is configured', 'WEB_PROVIDER_ERROR')
  }
  if (options.defaultServer.length === 0) return options.servers[0]!
  const selected = options.servers.find(server => server.id === options.defaultServer)
  if (selected === undefined) {
    throw new WebError(`search-mcp: defaultServer "${options.defaultServer}" is not configured`, 'WEB_PROVIDER_ERROR')
  }
  return selected
}

async function callMcpSearch(
  server: ResolvedServer,
  key: string | undefined,
  query: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (server.toolName.length === 0) {
    throw new WebError(`search-mcp server "${server.id}" has no toolName`, 'WEB_PROVIDER_ERROR')
  }
  if (server.transport !== 'http' && server.transport !== 'stdio') {
    throw new WebError(`search-mcp server "${server.id}" has unsupported transport "${server.transport}"`, 'WEB_PROVIDER_ERROR')
  }
  const transport = server.transport === 'stdio'
    ? new StdioClientTransport({ command: server.command, args: server.args, env: subprocessEnvironment(server, key) })
    : new StreamableHTTPClientTransport(httpUrl(server, key), {
        requestInit: {
          headers: httpHeaders(server, key),
          signal,
        },
      })
  const client = new Client({ name: '@e-mate/dsh-plugin-search-mcp', version: '2.0.7' }, { capabilities: {} })
  try {
    await abortable(client.connect(transport), signal, `connect to ${server.id}`)
    const args: Record<string, unknown> = { query }
    if (server.countArg.length > 0) args[server.countArg] = maxResults
    const result = await abortable(client.callTool({ name: server.toolName, arguments: args }), signal, `call ${server.toolName}`)
    if (result.isError === true) {
      throw new WebError(`search-mcp server "${server.id}" reported an error`, 'WEB_PROVIDER_ERROR')
    }
    return result
  } catch (error) {
    if (error instanceof WebError) throw error
    throw new WebError(`search-mcp server "${server.id}" failed`, 'WEB_PROVIDER_ERROR', { cause: error })
  } finally {
    try {
      await client.close()
    } catch {
      // The transport has already closed; no resource remains to recover.
    }
  }
}

function httpUrl(server: ResolvedServer, key: string | undefined): URL {
  let url: URL
  try {
    url = new URL(server.url)
  } catch (error) {
    throw new WebError(`search-mcp server "${server.id}" has an invalid URL`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (key !== undefined && server.authStyle === 'query' && server.authParam.length > 0) {
    url.searchParams.set(server.authParam, key)
  }
  return url
}

function httpHeaders(server: ResolvedServer, key: string | undefined): Record<string, string> {
  return key !== undefined && server.authStyle === 'header' && server.authParam.length > 0
    ? { [server.authParam]: key }
    : {}
}

function subprocessEnvironment(server: ResolvedServer, key: string | undefined): Record<string, string> {
  const names = process.platform === 'win32'
    ? ['PATH', 'PATHEXT', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
    : ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL']
  const env = Object.fromEntries(names.flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]]))
  if (key !== undefined && server.authParam.length > 0) env[server.authParam] = key
  return env
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal, stage: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new WebError(`search-mcp aborted while trying to ${stage}`, 'WEB_ABORTED'))
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new WebError(`search-mcp aborted while trying to ${stage}`, 'WEB_ABORTED'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
}

const TITLE_KEYS = ['title', 'name', 'headline']
const SNIPPET_KEYS = ['snippet', 'content', 'description', 'text', 'excerpt', 'summary']
const DATE_KEYS = ['published_date', 'publishedDate', 'published_at', 'publish_date', 'publishedAt', 'page_age', 'age', 'date']

/** Normalize heterogeneous MCP tool results to the rc.5 Web provider result. */
export function extractSearchResult(result: unknown): WebSearchResult {
  const bucket = { sources: [] as Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }>, seen: new Set<string>(), content: '' }
  if (isRecord(result)) {
    collect(result.structuredContent, bucket)
    if (Array.isArray(result.content)) {
      for (const block of result.content) {
        if (!isRecord(block)) continue
        if (block.type === 'json') collect(block.json, bucket)
        if (block.type === 'text' && typeof block.text === 'string') {
          try {
            collect(JSON.parse(block.text), bucket)
          } catch {
            if (bucket.content.length === 0) bucket.content = block.text.trim().slice(0, 4000)
          }
        }
      }
    }
  }
  return { sources: bucket.sources, truncated: false, ...(bucket.content.length === 0 ? {} : { content: bucket.content }) }
}

function collect(
  value: unknown,
  bucket: { sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }>; seen: Set<string>; content: string },
): void {
  if (Array.isArray(value)) {
    for (const entry of value) collect(entry, bucket)
    return
  }
  if (!isRecord(value)) return
  if (typeof value.url === 'string' && /^https?:\/\//iu.test(value.url)) {
    if (!bucket.seen.has(value.url)) {
      bucket.seen.add(value.url)
      const title = firstString(value, TITLE_KEYS)
      const snippet = truncate(firstString(value, SNIPPET_KEYS), 600)
      const publishedAt = firstString(value, DATE_KEYS)
      bucket.sources.push({ url: value.url, ...(title === undefined ? {} : { title }), ...(snippet === undefined ? {} : { snippet }), ...(publishedAt === undefined ? {} : { publishedAt }) })
    }
    return
  }
  if (bucket.content.length === 0 && typeof value.answer === 'string') bucket.content = value.answer.trim().slice(0, 4000)
  for (const nested of Object.values(value)) collect(nested, bucket)
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

/** Register one live Settings-backed search provider with rc.5 Web. */
export function apply(ctx: Context, config: SearchMcpConfig): void {
  let current = (): SearchMcpConfig => config
  installSettingsSection(ctx, SEARCH_MCP_SETTINGS_NAMESPACE, Config, config, {
    setSource(source) { current = source },
    onChange() {},
  })
  ctx.web.registerSearchProvider(new SearchMcpProvider(() => ({
    servers: current().servers,
    defaultServer: current().defaultServer,
    maxResults: current().maxResults,
    searchTimeoutMs: current().searchTimeoutMs,
    resolveKey: async server => {
      if (server.credentialRef.length === 0) return undefined
      return (await ctx.credentials.resolve(credentialRef(server.credentialRef)))?.value
    },
  })))
}
