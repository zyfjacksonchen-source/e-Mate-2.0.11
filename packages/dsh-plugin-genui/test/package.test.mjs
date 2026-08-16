import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('uses the e-Mate module identity and pinned rc.5 compatibility receipt', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@e-mate/dsh-plugin-genui')
  assert.equal(manifest.eMate.harnessVersion, '0.1.0-rc.5')
  assert.equal(manifest.eMate.harnessCommit, '47f943859bef60e4160492346772ded9b24f765a')
  assert.equal(manifest.peerDependencies, undefined)

  const host = await readFile(resolve(root, 'lib/index.js'), 'utf8')
  const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  assert.match(host, /@e-mate\/dsh-plugin-genui\/assets/)
  assert.match(client, /id:\s*["'`]@e-mate\/dsh-plugin-genui["'`]/)
  assert.doesNotMatch(`${host}\n${client}`, /@omdsh-dev\/dsh-genui/)
})
