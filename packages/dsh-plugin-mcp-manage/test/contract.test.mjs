import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { readCollectedOutput } from '../lib/collected-output.mjs'
import { parseOAuthCallback } from '../lib/oauth-callback.mjs'
import { validatePluginInstall, validatePluginPackageName } from '../lib/plugin-source.mjs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const runtime = readFileSync(new URL('../lib/index.mjs', import.meta.url), 'utf8')

test('MCP management keeps native DSH ownership and secrets out of settings', () => {
  assert.equal(manifest.version, '2.0.11')
  assert.equal(manifest.eMate.runtime, '@deepseek-ai/dsh-mcp-client')
  assert.equal(manifest.eMate.mcpSdkVersion, '1.29.0')
  assert.match(source, /ctx\.loader\.(?:create|update)/u)
  assert.match(source, /name: MCP_CLIENT/u)
  assert.match(source, /ctx\.credentials\.set/u)
  assert.match(source, /ctx\.userQuestions\.ask/u)
  assert.match(source, /ctx\.userQuestions\.ask\(\{\s*agent,/u)
  assert.match(source, /exec\.signal, exec\.agent/u)
  assert.match(source, /ctx\.tools\.schemas\(\)/u)
  assert.match(source, /servers: previousServers/u)
  assert.match(source, /authority: 'loopback'/u)
  assert.match(source, /authorizeMcp/u)
  assert.match(source, /OAUTH_CALLBACK_PORT/u)
  assert.match(source, /codeVerifier/u)
  assert.match(source, /ctx\.subprocess\.spawn/u)
  assert.match(source, /ctx\.interval/u)
  assert.match(source, /enum: \['list', 'install', 'connect', 'remove'\]/u)
  assert.match(source, /name: 'dsh_plugin_manage'/u)
  assert.match(source, /AUDITED_PLUGIN_SOURCES\.get\(packageName\)/u)
  assert.match(source, /MCP_CATALOG\.get\(args\.name\)/u)
  assert.match(source, /spec\.name === 'tencent_docs' \? token : `Bearer \$\{token\}`/u)
  assert.match(source, /Get-Clipboard -Raw/u)
  assert.match(source, /process\.platform === 'darwin' \? 'pbpaste'/u)
  assert.match(source, /Token 只会从系统剪贴板写入本机凭据库/u)
  assert.match(source, /handle\.collected\.stdout/u)
  assert.match(source, /handle\.terminate\(\)/u)
  assert.doesNotMatch(source, /readBounded\(handle\.stdout\)/u)
  assert.doesNotMatch(source, /handle\.cancel\(\)/u)
  assert.match(source, /runPluginInstall\(args, process\.cwd\(\), recovery, signal\)/u)
  assert.match(source, /rollbackPluginInstall\(receiptId\)/u)
  assert.doesNotMatch(source, /if \(previous === undefined\) await runProfilePlugin/u)
  assert.doesNotMatch(source, /source: \{ type: 'string' \}/u)
  assert.doesNotMatch(source, /status: 'installed', packageName, source/u)
  assert.doesNotMatch(runtime, /^import .* from ["']@modelcontextprotocol\/sdk(?:\/[^"']*)?["'];?$/mu)
  assert.match(source, /runtime\.requestRestart/u)
  assert.match(source, /item\?\.active !== true/u)
  assert.doesNotMatch(source, /token:\s*z\./u)
  assert.doesNotMatch(source, /authorizationCode: \{ type:/u)
})

test('collected subprocess output rejects missing or truncated clipboard data', () => {
  assert.equal(readCollectedOutput({ readFrom: offset => ({ text: offset === 0 ? 'token' : '', lossy: false }) }, 'stdout'), 'token')
  assert.throws(() => readCollectedOutput(undefined, 'stdout'), /未启用收集输出/u)
  assert.throws(
    () => readCollectedOutput({ readFrom: () => ({ text: 'tail', lossy: true }) }, 'stdout'),
    /超过安全上限/u,
  )
})

test('optional DSH plugins require a valid package name and exact GitHub commit', () => {
  assert.doesNotThrow(() => validatePluginInstall(
    '@xmanrui/dsh-im',
    'github:zyfjacksonchen-source/dsh-im#f984f73dcd67692141d4e475c8fbe887e2ce7062',
  ))
  assert.doesNotThrow(() => validatePluginPackageName('dsh-example'))
  assert.throws(() => validatePluginInstall('@xmanrui/dsh-im', 'github:zyfjacksonchen-source/dsh-im#main'), /固定 GitHub 提交/u)
  assert.throws(() => validatePluginInstall('@xmanrui/dsh-im', 'https://user:secret@example.com/plugin.git'), /固定 GitHub 提交/u)
  assert.throws(() => validatePluginPackageName('../plugin'), /包名无效/u)
})

test('OAuth callback accepts one matching state and rejects callback smuggling', () => {
  assert.deepEqual(
    parseOAuthCallback('/oauth/callback/tencent-docs?code=ok&state=nonce', '/oauth/callback/tencent-docs', 'nonce'),
    { code: 'ok' },
  )
  assert.deepEqual(
    parseOAuthCallback('/oauth/callback/tencent-docs?error=access_denied&state=nonce', '/oauth/callback/tencent-docs', 'nonce'),
    { error: 'access_denied' },
  )
  assert.throws(() => parseOAuthCallback(
    '/oauth/callback/tencent-docs?code=a&code=b&state=nonce', '/oauth/callback/tencent-docs', 'nonce',
  ), /Invalid OAuth callback/u)
  assert.throws(() => parseOAuthCallback(
    '/oauth/callback/tencent-docs?code=a&state=wrong', '/oauth/callback/tencent-docs', 'nonce',
  ), /Invalid OAuth callback/u)
  assert.throws(() => parseOAuthCallback(
    '/oauth/callback/feishu?code=a&state=nonce', '/oauth/callback/tencent-docs', 'nonce',
  ), /Invalid OAuth callback/u)
})
