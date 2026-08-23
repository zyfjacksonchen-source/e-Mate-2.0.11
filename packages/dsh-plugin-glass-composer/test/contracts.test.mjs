import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('uses DSH settings and composer slots without a parallel browser lifecycle', async () => {
  const host = await readFile(resolve(root, 'src/index.ts'), 'utf8')
  const client = await readFile(resolve(root, 'src/client/index.tsx'), 'utf8')
  const css = await readFile(resolve(root, 'src/client/style.module.css'), 'utf8')
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

  assert.match(host, /settings\.register\(GLASS_NAMESPACE, GlassSettingsSchema\)/)
  assert.match(client, /settingsScope\.bind<GlassSettings>/)
  assert.match(client, /name: 'conversation\.input\.right'/)
  assert.match(client, /closest\('\[data-composer-card\]'\)/)
  assert.match(css, /inset:\s*-2px -2px var\(--emate-composer-frame-bottom, -2px\)/)
  assert.match(css, /border-radius:\s*var\(--emate-composer-frame-radius, inherit\)/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /@media \(forced-colors: active\)/)
  assert.doesNotMatch(`${host}\n${client}\n${css}`, /MutationObserver|localStorage|tapIndex|backdrop-filter/)
  assert.equal(manifest.eMate.harnessCommit, '2bc16230975f6cf02aa1b283b1f86de44007b059')
})
