import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { searchCapabilityStatus } from '../src/capability.ts'

const root = new URL('../', import.meta.url)

test('profile replaces built-in search and uses only credential references', async () => {
  const [manifest, patch, source] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8'),
    readFile(new URL('cordis.patch.yml', root), 'utf8'),
    readFile(new URL('src/index.ts', root), 'utf8'),
  ])
  const pkg = JSON.parse(manifest)
  assert.equal(pkg.version, '2.0.10')
  assert.deepEqual(pkg.dependencies, { '@modelcontextprotocol/sdk': '1.29.0' })
  assert.equal(pkg.peerDependencies, undefined)
  assert.equal(pkg.eMate.harnessVersion, '0.1.0-rc.7')
  assert.equal(pkg.eMate.mcpSdkVersion, '1.29.0')
  assert.match(patch, /searchProvider: search-mcp/u)
  assert.match(patch, /web-search-deepseek[\s\S]*disabled: true/u)
  assert.match(source, /credentialRef: z\.string\(\)\.role\('credential-ref'\)/u)
  assert.match(source, /emateCapabilities/u)
  assert.match(source, /capabilities\.register\(/u)
  assert.match(source, /id: 'web-search'/u)
  assert.doesNotMatch(source, /apiKey:\s*z\./u)
  assert.doesNotMatch(source, /\.\.\.process\.env/u)
  assert.doesNotMatch(source, /String\(error\)/u)
})

test('capability status stays fail-closed and reads only credential presence', async () => {
  assert.deepEqual(searchCapabilityStatus({ server: 'missing', needsCredential: false, credentialRef: '', credentialConfigured: false }), {
    state: 'setup-required', detail: '尚未配置 MCP 搜索服务。', action_ids: [],
  })
  assert.deepEqual(searchCapabilityStatus({ server: 'invalid', needsCredential: false, credentialRef: '', credentialConfigured: false }), {
    state: 'blocked', detail: '默认 MCP 搜索服务不在当前配置中。', action_ids: [],
  })
  assert.deepEqual(searchCapabilityStatus({ server: 'configured', needsCredential: true, credentialRef: '', credentialConfigured: false }), {
    state: 'setup-required', detail: 'MCP 搜索服务尚未绑定凭据引用。', action_ids: [],
  })
  assert.deepEqual(searchCapabilityStatus({ server: 'configured', needsCredential: true, credentialRef: 'TAVILY_API_KEY', credentialConfigured: false }), {
    state: 'setup-required', detail: 'MCP 搜索凭据尚未在本机配置。', action_ids: [],
  })
  assert.deepEqual(searchCapabilityStatus({ server: 'configured', needsCredential: true, credentialRef: 'TAVILY_API_KEY', credentialConfigured: true }), {
    state: 'setup-required', detail: 'MCP 搜索配置已就绪；真实服务联通验收尚未完成。', action_ids: [],
  })
  assert.deepEqual(searchCapabilityStatus({ server: 'configured', needsCredential: false, credentialRef: '', credentialConfigured: false }), {
    state: 'setup-required', detail: 'MCP 搜索配置已就绪；真实服务联通验收尚未完成。', action_ids: [],
  })
})
