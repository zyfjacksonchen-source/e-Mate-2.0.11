import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  extractSearchResult,
  resolveSearchLimit,
  resolveServer,
  validateSearchConfig,
} from '../src/contract.ts'
import {
  SEARCH_CREDENTIAL_ACTION,
  searchCapabilityStatus,
} from '../src/capability.ts'

const root = new URL('../', import.meta.url)
const baseConfig = {
  defaultServer: 'primary',
  maxResults: 8,
  searchTimeoutMs: 30_000,
  servers: [{ id: 'primary', kind: 'tavily', credentialRef: 'TAVILY_API_KEY' }],
}

test('adapter keeps native Web and credentials seams without arbitrary transports', async () => {
  const [manifest, patch, source, runtime] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8'),
    readFile(new URL('cordis.patch.yml', root), 'utf8'),
    readFile(new URL('src/index.ts', root), 'utf8'),
    readFile(new URL('lib/index.mjs', root), 'utf8'),
  ])
  const pkg = JSON.parse(manifest)
  assert.equal(pkg.version, '2.0.12')
  assert.deepEqual(pkg.dependencies, { '@modelcontextprotocol/sdk': '1.29.0' })
  assert.equal(pkg.eMate.harnessVersion, '0.1.0-rc.7')
  assert.match(patch, /searchProvider: search-mcp/u)
  assert.match(patch, /web-search-deepseek[\s\S]*disabled: true/u)
  assert.match(source, /credentialRef: z\.string\(\)\.role\('credential-ref'\)/u)
  assert.match(source, /registerSearchProvider/u)
  assert.match(source, /StreamableHTTPClientTransport/u)
  assert.doesNotMatch(source, /StdioClientTransport|duckduckgo|\bnpx\b|\bcommand\b|\.\.\.process\.env/u)
  assert.doesNotMatch(source, /url: z\.string|authParam: z\.string|toolName: z\.string/u)
  assert.doesNotMatch(runtime, /^import .* from ["']@modelcontextprotocol\/sdk(?:\/[^"']*)?["'];?$/mu)
})

test('provider catalog binds credentials to fixed HTTPS endpoints', () => {
  validateSearchConfig(baseConfig)
  assert.deepEqual(resolveServer(baseConfig.servers[0]), {
    id: 'primary',
    kind: 'tavily',
    credentialRef: 'TAVILY_API_KEY',
    url: 'https://mcp.tavily.com/mcp/',
    authStyle: 'query',
    authParam: 'tavilyApiKey',
    toolName: 'tavily_search',
    countArg: 'max_results',
  })
  assert.throws(() => validateSearchConfig({
    ...baseConfig,
    servers: [{ id: 'primary', kind: 'custom', credentialRef: 'TOKEN' }],
  }), /not allowed/u)
  assert.throws(() => validateSearchConfig({
    ...baseConfig,
    servers: [{ id: 'primary', kind: 'tavily', credentialRef: 'bad-ref' }],
  }), /credential reference/u)
  assert.throws(() => validateSearchConfig({ ...baseConfig, defaultServer: 'missing' }), /not configured/u)
  assert.throws(() => validateSearchConfig({
    ...baseConfig,
    servers: [baseConfig.servers[0], baseConfig.servers[0]],
  }), /duplicated/u)
})

test('request result limit is not masked by the global default', () => {
  assert.equal(resolveSearchLimit(baseConfig.servers[0], 3, 8), 3)
  assert.equal(resolveSearchLimit({ ...baseConfig.servers[0], maxResults: 2 }, 3, 8), 2)
  assert.equal(resolveSearchLimit(baseConfig.servers[0], undefined, 8), 8)
})

test('untrusted MCP output is bounded, cycle-safe, and strips credential URLs', () => {
  const cyclic = { answer: 'ok', children: [] }
  cyclic.children.push(cyclic)
  for (let index = 0; index < 80; index += 1) {
    cyclic.children.push({
      url: `https://example.com/${index}`,
      title: `title-${index}`,
      snippet: 'x'.repeat(1_000),
    })
  }
  cyclic.children.push({ url: 'https://secret:token@example.com/private' })
  const result = extractSearchResult({ structuredContent: cyclic }, 50)
  assert.equal(result.sources.length, 50)
  assert.equal(result.truncated, true)
  assert.equal(result.content, 'ok')
  assert.equal(result.sources[0].snippet.length, 601)
  assert.equal(result.sources.some(source => source.url.includes('secret')), false)

  let deep = { url: 'https://too-deep.example/' }
  for (let index = 0; index < 20; index += 1) deep = { nested: deep }
  assert.deepEqual(extractSearchResult({ structuredContent: deep }), {
    sources: [], truncated: true,
  })
})

test('capability securely configures and reports the native credential', () => {
  assert.deepEqual(searchCapabilityStatus({ server: 'missing', needsCredential: false, credentialRef: '', credentialConfigured: false, credentialWritable: false }), {
    state: 'setup-required', detail: '尚未配置 MCP 搜索服务。', action_ids: [], credential_refs: {},
  })
  assert.deepEqual(searchCapabilityStatus({ server: 'invalid', needsCredential: false, credentialRef: '', credentialConfigured: false, credentialWritable: false }), {
    state: 'blocked', detail: '默认 MCP 搜索服务不在当前配置中。', action_ids: [], credential_refs: {},
  })
  assert.deepEqual(searchCapabilityStatus({ server: 'configured', needsCredential: true, credentialRef: '', credentialConfigured: false, credentialWritable: true }), {
    state: 'setup-required', detail: 'MCP 搜索服务尚未绑定凭据引用。', action_ids: [], credential_refs: {},
  })
  assert.deepEqual(searchCapabilityStatus({ server: 'configured', needsCredential: true, credentialRef: 'TAVILY_API_KEY', credentialConfigured: false, credentialWritable: true }), {
    state: 'setup-required', detail: 'MCP 搜索凭据尚未在本机配置。', action_ids: [SEARCH_CREDENTIAL_ACTION],
    credential_refs: { [SEARCH_CREDENTIAL_ACTION]: 'TAVILY_API_KEY' },
  })
  assert.deepEqual(searchCapabilityStatus({ server: 'configured', needsCredential: true, credentialRef: 'TAVILY_API_KEY', credentialConfigured: true, credentialWritable: true }), {
    state: 'ready', detail: 'MCP 搜索配置与本机凭据已就绪。', action_ids: [SEARCH_CREDENTIAL_ACTION],
    credential_refs: { [SEARCH_CREDENTIAL_ACTION]: 'TAVILY_API_KEY' },
  })
})
