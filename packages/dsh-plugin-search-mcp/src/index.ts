/** e-Mate's rc.7 adapter for the pinned dsh-search-mcp provider. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { WebError, type WebSearchProvider, type WebSearchResult } from '@deepseek-ai/dsh-web'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import {
  SEARCH_CREDENTIAL_ACTION,
  searchCapabilityStatus,
} from './capability.ts'
import {
  extractSearchResult,
  resolveSearchLimit,
  resolveServer,
  validateSearchConfig,
  type ResolvedServer,
  type SearchMcpConfig,
  type SearchMcpServerConfig,
} from './contract.ts'

export { extractSearchResult, resolveSearchLimit, resolveServer, validateSearchConfig } from './contract.ts'
export type { ResolvedServer, SearchMcpConfig, SearchMcpServerConfig } from './contract.ts'

export const name = '@e-mate/dsh-plugin-search-mcp'
export const inject = ['web', 'credentials', 'emateCapabilities']
export const SEARCH_MCP_PROVIDER_ID = 'search-mcp'
export const SEARCH_MCP_SETTINGS_NAMESPACE = settingsNamespace('search-mcp')

const serverSchema = z.object({
  id: z.string(),
  kind: z.string().default('tavily'),
  credentialRef: z.string().role('credential-ref').default(''),
  maxResults: z.number().step(1).min(1).max(50),
})

export const Config: Schema<SearchMcpConfig> = z.object({
  defaultServer: z.string().default(''),
  maxResults: z.number().step(1).min(1).max(50).default(8),
  searchTimeoutMs: z.number().step(1).min(1000).max(120000).default(30000),
  servers: z.array(serverSchema).default([]),
})

type Server = SearchMcpServerConfig

type SearchContext = Context & { emateCapabilities: { register(definition: unknown): () => void } }

interface ProviderOptions {
  servers: Server[]
  defaultServer: string
  maxResults: number
  searchTimeoutMs: number
  resolveKey(server: ResolvedServer): Promise<string | undefined>
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
    if (key === undefined) {
      throw new WebError(
        `search-mcp server "${resolved.id}" has no resolvable credentialRef`,
        'WEB_PROVIDER_ERROR',
      )
    }
    const maxResults = resolveSearchLimit(resolved, request.maxResults, options.maxResults)
    const timeout = AbortSignal.timeout(options.searchTimeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    return extractSearchResult(await callMcpSearch(resolved, key, request.query, maxResults, combined), maxResults)
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
  const transport = new StreamableHTTPClientTransport(httpUrl(server, key), {
    requestInit: {
      headers: httpHeaders(server, key),
      signal,
    },
  })
  const client = new Client({ name: '@e-mate/dsh-plugin-search-mcp', version: '2.0.11' }, { capabilities: {} })
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
  const url = new URL(server.url)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') {
    throw new WebError(`search-mcp server "${server.id}" has an unsafe catalog URL`, 'WEB_PROVIDER_ERROR')
  }
  if (key !== undefined && server.authStyle === 'query') {
    url.searchParams.set(server.authParam, key)
  }
  return url
}

function httpHeaders(server: ResolvedServer, key: string | undefined): Record<string, string> {
  return key !== undefined && server.authStyle === 'header'
    ? { [server.authParam]: key }
    : {}
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

/** Register one live Settings-backed search provider with the pinned rc.7 Web client. */
export function apply(ctx: Context, config: SearchMcpConfig): void {
  validateSearchConfig(config)
  let current = (): SearchMcpConfig => config
  installSettingsSection(ctx, SEARCH_MCP_SETTINGS_NAMESPACE, Config, config, {
    setSource(source) { current = source },
    onChange() {},
    validate: validateSearchConfig,
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
  const searchContext = ctx as SearchContext
  const capabilities = searchContext.emateCapabilities
  ctx.effect(() => capabilities.register({
    id: 'web-search',
    title: '网络搜索',
    summary: '通过 e-Mate 原生 Web 工具调用已配置的 MCP 搜索服务，不建立额外浏览器传输。',
    icon_key: 'browser',
    order: 30,
    actions: [{ id: SEARCH_CREDENTIAL_ACTION, label: '配置/更新凭据', kind: 'primary', input: 'credential' }],
    status: async (signal: AbortSignal) => {
      signal.throwIfAborted()
      const settings = current()
      if (settings.servers.length === 0) return searchCapabilityStatus({
        server: 'missing', needsCredential: false, credentialRef: '', credentialConfigured: false, credentialWritable: false,
      })
      const server = settings.defaultServer.length === 0
        ? settings.servers[0]
        : settings.servers.find(item => item.id === settings.defaultServer)
      if (server === undefined) return searchCapabilityStatus({
        server: 'invalid', needsCredential: false, credentialRef: '', credentialConfigured: false, credentialWritable: false,
      })
      const resolved = resolveServer(server)
      const credential = await ctx.credentials.describe(credentialRef(resolved.credentialRef))
      return searchCapabilityStatus({
        server: 'configured',
        needsCredential: true,
        credentialRef: resolved.credentialRef,
        credentialConfigured: credential.configured,
        credentialWritable: credential.writable,
      })
    },
  }), 'emate.search-mcp: capability metadata')
}
