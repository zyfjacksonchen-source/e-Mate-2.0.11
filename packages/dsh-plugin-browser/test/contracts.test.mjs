import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { BrowserBridgeServer, BROWSER_TOOL_NAMES } from '../lib/index.mjs'
import { parseBridgeFrame } from '../lib/protocol.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const caps = { textOnly: true, snapshotMaxChars: 32_000, maxInteractiveItems: 60 }

test('minimal wire accepts only browser carrier frames', () => {
  assert.equal(parseBridgeFrame(JSON.stringify({ t: 'hello', token: 'x'.repeat(43), caps })).t, 'hello')
  assert.equal(parseBridgeFrame(JSON.stringify({ t: 'rpc', method: 'session.prompt' })), undefined)
  assert.equal(parseBridgeFrame('{'), undefined)
  assert.deepEqual(BROWSER_TOOL_NAMES, [
    'browser_snapshot', 'browser_click', 'browser_type', 'browser_press', 'browser_scroll',
    'browser_navigate', 'browser_back', 'browser_forward', 'browser_reload', 'browser_get_text', 'browser_wait',
  ])
})

test('profile inserts the Host bridge without targeting a nonexistent wrapper entry', async () => {
  const patch = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /^\s*- insert:\s*$/m)
  assert.match(patch, /id:\s*emate-browser/)
  assert.doesNotMatch(patch, /id:\s*dsh-web/)
})

test('extension branding comes from the pinned source asset, not generated build output', async () => {
  const finalize = await readFile(resolve(root, 'extension/scripts/finalize.mjs'), 'utf8')
  assert.match(finalize, /upstream\/e-mate-2\.0\.5\/desktop\/src\/v1\/assets\/emate-mark\.png/u)
  assert.doesNotMatch(finalize, /packages\/dsh\/profile\/plugins\/emate-shell\/assets/u)
})

test('loopback extension carrier binds every Tool request to its real Session id', async () => {
  const token = 't'.repeat(43)
  const bridge = new BrowserBridgeServer(token, caps)
  const http = createServer()
  http.on('upgrade', (req, socket, head) => bridge.handleUpgrade(req, socket, head))
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  const address = http.address()
  assert.equal(typeof address, 'object')
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`, {
    headers: { Origin: `chrome-extension://${'a'.repeat(32)}` },
  })
  try {
    await new Promise((resolve, reject) => {
      client.once('open', resolve)
      client.once('error', reject)
    })
    client.send(JSON.stringify({ t: 'hello', token, caps }))
    await new Promise((resolve, reject) => {
      client.on('message', raw => {
        const frame = JSON.parse(String(raw))
        if (frame.t === 'hello.ok') resolve()
      })
      client.once('error', reject)
    })
    const action = new Promise((resolve, reject) => {
      client.on('message', raw => {
        const frame = JSON.parse(String(raw))
        if (frame.t !== 'tool.call') return
        try {
          assert.equal(frame.name, 'browser_snapshot')
          assert.equal(frame.sessionId, 'session-project-a')
          client.send(JSON.stringify({ t: 'tool.result', id: frame.id, ok: true, result: { text: 'page A' } }))
          resolve()
        } catch (error) { reject(error) }
      })
    })
    const result = await bridge.requestTool('browser_snapshot', {}, 'session-project-a', new AbortController().signal, 2_000)
    await action
    assert.deepEqual(result, { text: 'page A' })
    assert.equal(bridge.status().connected, true)
  } finally {
    client.close()
    await bridge.close()
    await new Promise(resolve => http.close(resolve))
  }
})

test('extension contains no second chat, Session gateway, model, or approval UI', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'extension/dist/manifest.json'), 'utf8'))
  const background = await readFile(resolve(root, 'extension/dist/background.js'), 'utf8')
  const backgroundSource = await readFile(resolve(root, 'extension/src/background/index.ts'), 'utf8')
  const host = await readFile(resolve(root, 'lib/index.mjs'), 'utf8')
  const tools = await readFile(resolve(root, 'src/tools.ts'), 'utf8')
  assert.equal(manifest.side_panel, undefined)
  assert.equal(manifest.permissions.includes('sidePanel'), false)
  assert.match(tools, /ctx\.approval\.request/)
  assert.match(tools, /overrideOf\(exec\.agent\.session\)/)
  assert.match(tools, /=== 'ask'/)
  assert.match(background, /当前标签页已绑定其他 e-Mate 会话/)
  assert.match(backgroundSource, /id !== sessionId && tabId === tab\.id/)
  assert.doesNotMatch(host, /from ["']ws["']/)
  assert.doesNotMatch(background, /session\.prompt|session\.create|model\.catalog|credentials\.|approval\.request/)
  assert.equal(await readFile(resolve(root, 'extension/dist/content.js'), 'utf8').then(text => text.includes('EMATE_BROWSER_ACTION')), true)
})

test('link clicks answer before navigation can destroy the Tool response port', async () => {
  const actions = await readFile(resolve(root, 'extension/src/content/actions.ts'), 'utf8')
  const anchor = actions.slice(actions.indexOf('if (el instanceof HTMLAnchorElement)'), actions.indexOf('if (el instanceof HTMLButtonElement'))
  assert.match(anchor, /setTimeout\(\(\) => \{ el\.click\(\) \}, 0\)/u)
  assert.doesNotMatch(anchor, /await settle\(\)/u)
})
