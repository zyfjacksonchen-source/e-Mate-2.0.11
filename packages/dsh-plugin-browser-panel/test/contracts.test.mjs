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
  assert.deepEqual(inject, ['connection', 'sessions', 'emateCapabilities', 'emateBrowser'])
  apply({
    effect(register) { register() },
    emateCapabilities: { register(definition) { capabilities.push(definition); return () => {} } },
    connection: { rpc: { handle(channel, next, nextOptions) { assert.equal(channel, CHANNEL); handler = next; options = nextOptions; return () => {} } } },
    emateBrowser: { status: () => ({ connected: true, connected_at: '2026-08-16T00:00:00.000Z' }) },
    sessions: { get(id) { return id === 'session-1' ? { id } : undefined } },
  })
  assert.deepEqual(capabilities.map(capability => capability.id), ['browser'])
  assert.equal((await capabilities[0].status()).state, statusForPlatform(process.platform, { connected: true }).state)
  assert.deepEqual(capabilities[0].actions, [])
  assert.deepEqual(options, { authority: 'loopback' })
  const response = await handler('status', { session_id: 'session-1' })
  assert.equal(response.ok, true)
  assert.deepEqual(response.value, statusForPlatform(process.platform, { connected: true, connected_at: '2026-08-16T00:00:00.000Z' }))
  assert.equal((await handler('status', { session_id: 'missing' })).ok, false)
  assert.equal((await handler('open', { session_id: 'session-1' })).ok, false)
})

test('Windows uses dsh-browser but remains gated on real Windows acceptance', () => {
  const status = statusForPlatform('win32', { connected: true })
  assert.equal(status.state, 'setup-required')
  assert.equal(status.ready, false)
  assert.equal(status.blocker, 'DSH_BROWSER_WINDOWS_ACCEPTANCE_PENDING')
  assert.equal(status.browser_state_session_bound, true)
  assert.equal(status.provider, 'dsh-browser')
})

test('macOS is ready only while the dsh-browser extension is connected', () => {
  assert.equal(statusForPlatform('darwin').blocker, 'DSH_BROWSER_EXTENSION_NOT_CONNECTED')
  const status = statusForPlatform('darwin', { connected: true })
  assert.equal(status.state, 'ready')
  assert.equal(status.ready, true)
  assert.equal(status.browser_state_session_bound, true)
  assert.equal(status.provider, 'dsh-browser')
})

test('panel stays a target-native projection of the dsh-browser Host service', async () => {
  const host = await readFile(resolve(root, 'src/index.ts'), 'utf8')
  const client = await readFile(resolve(root, 'src/client/index.tsx'), 'utf8')
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  assert.match(host, /connection\.rpc\.handle\(/)
  assert.match(client, /connection\.rpc\.call\(/)
  assert.match(client, /name:\s*'conversation\.view'/)
  assert.equal(manifest.eMate.harnessVersion, '0.1.0-rc.6')
  assert.equal(manifest.eMate.harnessCommit, undefined)
  assert.equal(manifest.eMate.upstream.commit, 'b20ecd51eca800e00fc40bd7973271bf62a1b1d2')
  assert.equal(manifest.dependencies, undefined)
  assert.doesNotMatch(`${host}\n${client}`, /child_process|spawn\(|exec\(|new WebSocket|fetch\(|ctx\.router|ctx\.webServer|createStore|modelPolicy|allowed_model_ids/)
  assert.match(host, /emateBrowser\.status\(\)/)
  assert.match(client, /DSH_BROWSER_EXTENSION_NOT_CONNECTED/)
  assert.match(client, /加载已解压的扩展程序/)
  assert.match(client, /~\/\.dsh\/browser-extension/)
})

test('publishes only the declared files', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.files, ['lib/', 'cordis.patch.yml', 'README.md', 'SOURCE.md', 'LICENSE'])
})
