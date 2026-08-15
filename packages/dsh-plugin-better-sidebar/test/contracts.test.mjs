import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('uses target Connection RPC and conversation view without terminal transport', async () => {
  const host = await readFile(resolve(root, 'src/index.ts'), 'utf8')
  const client = await readFile(resolve(root, 'src/client/index.tsx'), 'utf8')
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  assert.match(host, /connection\.rpc\.handle\(/)
  assert.match(client, /connection\.rpc\.call\(/)
  assert.match(client, /name:\s*'conversation\.view'/)
  assert.equal(manifest.eMate.harnessVersion, '0.1.0-rc.5')
  assert.equal(manifest.dependencies, undefined)
  assert.doesNotMatch(`${host}\n${client}`, /node-pty|new WebSocket|\/sidebar\/api|\/sidebar\/ws/)
  assert.deepEqual(manifest.eMate.excludedUpstreamFeatures, ['terminal', 'node-pty', 'standalone-websocket', 'standalone-http-api'])
})

test('host validates paths once at the loopback boundary', async () => {
  const host = await readFile(resolve(root, 'src/index.ts'), 'utf8')
  assert.match(host, /authority:\s*'loopback'/)
  assert.match(host, /realpath\(resolve\(root, \.\.\.parts\)\)/)
  assert.match(host, /MAX_FILE_BYTES = 512 \* 1024/)
  assert.match(host, /!entry\.isSymbolicLink\(\)/)
})
