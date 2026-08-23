import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context, Service } from '../../../upstream/deepseek-harness/vendor/cordis/lib/index.js'
import WebRuntime from '../../../upstream/deepseek-harness/packages/web/web/lib/index.js'
import * as GptSearch from '../lib/web-search.mjs'

class CredentialProbe extends Service {
  constructor(ctx, value) {
    super(ctx, 'credentials')
    this.value = value
    this.refs = []
  }

  async resolve(ref) {
    this.refs.push(String(ref))
    return this.value === undefined ? undefined : { value: this.value, source: 'test' }
  }
}

const payload = {
  output: [
    { type: 'web_search_call', id: 'search_1', status: 'completed' },
    {
      type: 'message',
      content: [{
        type: 'output_text',
        text: '当前答案。',
        annotations: [
          { type: 'url_citation', url: 'https://example.com/a', title: '来源 A' },
          { type: 'url_citation', url: 'https://example.com/a', title: '重复来源' },
          { type: 'url_citation', url: 'https://example.com/b', title: '' },
        ],
      }],
    },
  ],
}

test('maps cited Responses output and fails closed without native search evidence', () => {
  assert.deepEqual(GptSearch.mapResponsesPayload(payload), {
    content: '当前答案。',
    sources: [
      { url: 'https://example.com/a', title: '来源 A' },
      { url: 'https://example.com/b' },
    ],
    truncated: false,
  })
  assert.throws(
    () => GptSearch.mapResponsesPayload({ output: [{ type: 'message', content: [] }] }),
    error => error.code === 'WEB_PROVIDER_ERROR',
  )
})

test('composes with the real rc.7 web seam, resolves the managed credential per call, and disposes', async t => {
  const ctx = new Context()
  t.after(async () => ctx.fiber.dispose())
  await ctx.plugin(WebRuntime, { searchProvider: GptSearch.GPT_RESPONSES_PROVIDER_ID })
  await ctx.plugin(CredentialProbe, 'managed-search-key-for-test-000000000')
  const credentials = ctx.credentials
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const plugin = await ctx.plugin(GptSearch, {
    apiKeyEnv: GptSearch.DEFAULT_CREDENTIAL_REF,
    baseURL: GptSearch.DEFAULT_BASE_URL,
    model: GptSearch.DEFAULT_MODEL,
    allowInsecureHttp: true,
    maxOutputTokens: 2048,
  })
  const result = await ctx.web.search({ query: 'e-Mate 最新信息', maxResults: 1 })
  assert.equal(result.truncated, true)
  assert.equal(result.sources.length, 1)
  assert.deepEqual(credentials.refs, [GptSearch.DEFAULT_CREDENTIAL_REF])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${GptSearch.DEFAULT_BASE_URL}/responses`)
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.headers.authorization, 'Bearer managed-search-key-for-test-000000000')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: GptSearch.DEFAULT_MODEL,
    input: 'e-Mate 最新信息',
    tools: [{ type: 'web_search' }],
    max_output_tokens: 2048,
  })

  await plugin.dispose()
  await assert.rejects(
    ctx.web.search({ query: 'disposed' }),
    error => error.code === 'WEB_PROVIDER_CONFIGURED_MISSING',
  )
})

test('rejects accidental insecure transport and never falls back around managed Credentials', async t => {
  const ctx = new Context()
  t.after(async () => ctx.fiber.dispose())
  await ctx.plugin(WebRuntime, { searchProvider: GptSearch.GPT_RESPONSES_PROVIDER_ID })
  await assert.rejects(
    async () => await ctx.plugin(GptSearch, {
      apiKeyEnv: GptSearch.DEFAULT_CREDENTIAL_REF,
      baseURL: GptSearch.DEFAULT_BASE_URL,
      model: GptSearch.DEFAULT_MODEL,
      allowInsecureHttp: false,
      maxOutputTokens: 2048,
    }),
    /transport boundary/,
  )

  await ctx.plugin(GptSearch, {
    apiKeyEnv: GptSearch.DEFAULT_CREDENTIAL_REF,
    baseURL: GptSearch.DEFAULT_BASE_URL,
    model: GptSearch.DEFAULT_MODEL,
    allowInsecureHttp: true,
    maxOutputTokens: 2048,
  })
  await assert.rejects(
    ctx.web.search({ query: 'no credential' }),
    error => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING',
  )
})
