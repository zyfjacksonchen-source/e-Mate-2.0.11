import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { apply, CHANNEL, inject, statusForPlatform } from '../lib/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('reports a verified-session-bound platform state through loopback Connection RPC', async () => {
  let handler
  let options
  const capabilities = []
  assert.equal(CHANNEL, '/emate.browserPanel')
  assert.deepEqual(inject, ['connection', 'sessions', 'emateCapabilities'])
  apply({
    effect(register) { register() },
    emateCapabilities: { register(definition) { capabilities.push(definition); return () => {} } },
    connection: { rpc: { handle(channel, next, nextOptions) { assert.equal(channel, CHANNEL); handler = next; options = nextOptions; return () => {} } } },
    sessions: { get(id) { return id === 'session-1' ? { id } : undefined } },
  })
  assert.deepEqual(capabilities.map(capability => capability.id), ['browser'])
  assert.equal((await capabilities[0].status()).state, statusForPlatform(process.platform).state)
  assert.deepEqual(capabilities[0].actions, [])
  assert.deepEqual(options, { authority: 'loopback' })
  const response = await handler('status', { session_id: 'session-1' })
  assert.equal(response.ok, true)
  assert.deepEqual(response.value, statusForPlatform(process.platform))
  assert.equal(response.value.provider_verified, false)
  assert.equal((await handler('status', { session_id: 'missing' })).ok, false)
  assert.equal((await handler('open', { session_id: 'session-1' })).ok, false)
})

test('Windows is setup-required for the selected Playwright MCP and system Edge candidate', () => {
  const status = statusForPlatform('win32')
  assert.equal(status.state, 'setup-required')
  assert.equal(status.ready, false)
  assert.equal(status.blocker, 'PLAYWRIGHT_MCP_EDGE_UNVERIFIED')
  assert.equal(status.browser_state_session_bound, false)
  assert.deepEqual(status.playwright_mcp, {
    package: '@playwright/mcp',
    version: '0.0.78',
    browser: 'system-edge',
    workspace_roots_supported: false,
    windows_acceptance_verified: false,
    code: 'PLAYWRIGHT_MCP_EDGE_UNVERIFIED',
  })
  assert.doesNotMatch(JSON.stringify(status), /unsupported|"state":"ready"/i)
})

test('macOS keeps ego-browser setup-required and unverified', () => {
  const status = statusForPlatform('darwin')
  assert.equal(status.state, 'setup-required')
  assert.equal(status.ready, false)
  assert.equal(status.blocker, 'EGO_BROWSER_RUNTIME_UNVERIFIED')
  assert.equal(status.browser_state_session_bound, false)
  assert.equal(status.ego_browser.platform_eligible, true)
  assert.equal(status.ego_browser.code, 'EGO_BROWSER_RUNTIME_UNVERIFIED')
})

test('package stays on target seams and contains no browser, transport, store, or model implementation', async () => {
  const host = await readFile(resolve(root, 'src/index.ts'), 'utf8')
  const client = await readFile(resolve(root, 'src/client/index.tsx'), 'utf8')
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  assert.match(host, /connection\.rpc\.handle\(/)
  assert.match(client, /connection\.rpc\.call\(/)
  assert.match(client, /name:\s*'conversation\.view'/)
  assert.equal(manifest.eMate.harnessVersion, '0.1.0-rc.5')
  assert.equal(manifest.eMate.harnessCommit, '47f943859bef60e4160492346772ded9b24f765a')
  assert.equal(manifest.eMate.upstream.sourceStatus, 'blocked')
  assert.equal(manifest.eMate.upstream.npmStatus, 'not-published')
  assert.equal(manifest.dependencies, undefined)
  assert.doesNotMatch(`${host}\n${client}`, /child_process|spawn\(|exec\(|new WebSocket|fetch\(|ctx\.router|ctx\.webServer|createStore|modelPolicy|allowed_model_ids/)
  assert.match(client, /EGO_BROWSER_RUNTIME_UNVERIFIED/)
})

test('publishes only the declared files', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.files, ['lib/', 'cordis.patch.yml', 'README.md', 'SOURCE.md', 'LICENSE'])
})
