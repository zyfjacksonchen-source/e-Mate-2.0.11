import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('keeps one native Composer owner and decorates its semantic frame host', async () => {
  const host = await readFile(resolve(root, 'src/index.ts'), 'utf8')
  const client = await readFile(resolve(root, 'src/client/index.tsx'), 'utf8')
  const css = await readFile(resolve(root, 'src/client/style.module.css'), 'utf8')
  const emittedClient = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

  assert.match(host, /settings\.register\(GLASS_NAMESPACE, GlassSettingsSchema\)/)
  assert.match(client, /settingsScope\.bind<GlassSettings>/)
  assert.match(client, /name: 'conversation\.input\.right'/)
  assert.match(client, /closest\('\[data-emate-composer-frame-host\]'\)/)
  assert.match(css, /\[data-emate-composer-frame-host\]\[data-emate-glass-palette\]/)
  assert.doesNotMatch(`${client}\n${css}`, /data-composer-card|emate-composer-frame-bottom/)
  assert.match(css, /inset:\s*-2px/)
  assert.match(css, /border-radius:\s*24px/)
  assert.match(css, /animation:\s*emate-glass-orbit 4s linear infinite/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /@media \(forced-colors: active\)/)
  assert.match(emittedClient, /animation:4s linear infinite/)
  assert.match(emittedClient, /prefers-reduced-motion:reduce[\s\S]*animation:none/)
  assert.doesNotMatch(emittedClient, /animation:(?:6|12)s linear infinite/)
  assert.doesNotMatch(`${host}\n${client}\n${css}`, /MutationObserver|localStorage|tapIndex|backdrop-filter/)
  assert.equal(manifest.eMate.harnessCommit, 'f97e3814fe677b35e2c0a4cdaec70c1fc1c8e1f4')
})
