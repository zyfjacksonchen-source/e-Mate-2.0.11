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
  const shellCss = await readFile(resolve(root, '../dsh/profile/plugins/emate-shell/src/client/home.module.css'), 'utf8')
  const nativeRoot = await readFile(resolve(root, '../../upstream/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx'), 'utf8')
  const emittedClient = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))

  assert.match(host, /settings\.register\(GLASS_NAMESPACE, GlassSettingsSchema\)/)
  assert.match(client, /settingsScope\.bind<GlassSettings>/)
  assert.match(client, /name: 'conversation\.input\.right'/)
  assert.match(client, /data-emate-glass-control="" data-emate-glass-palette=\{palette\}/)
  assert.doesNotMatch(client, /closest\(|querySelector|host\.dataset|useLayoutEffect|useRef/)
  assert.match(css, /\[data-emate-composer-frame-host\]:has\(\[data-emate-glass-control\]\[data-emate-glass-palette/)
  assert.equal(nativeRoot.match(/data-emate-composer-frame-host=""/gu)?.length, 1)
  assert.match(nativeRoot, /className=\{clsx\(css\.composerStack[\s\S]*?data-emate-composer-frame-host=""/)
  assert.match(shellCss, /\[data-emate-composer-frame-host\][^}]*--emate-composer-frame-radius:\s*24px;[^}]*position:\s*relative;[^}]*border-radius:\s*var\(--emate-composer-frame-radius\)/)
  assert.match(shellCss, /\[data-phase='active'\] \[data-emate-composer-frame-host\][^}]*width:\s*min\(var\(--dsh-composer-card-max-width\), 100%\)/)
  assert.match(shellCss, /\[data-emate-composer-frame-host\] > \[data-slot='conversation\.composer\.bar'\] > div\)[^{]*\{[^}]*padding:\s*0 !important/)
  assert.doesNotMatch(`${client}\n${css}`, /data-composer-card|emate-composer-frame-bottom/)
  assert.match(css, /inset:\s*-2px/)
  assert.match(css, /border-radius:\s*inherit/)
  assert.match(css, /animation:\s*emate-glass-orbit 4s linear infinite/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /@media \(forced-colors: active\)/)
  assert.match(emittedClient, /animation:4s linear infinite/)
  assert.match(emittedClient, /prefers-reduced-motion:reduce[\s\S]*animation:none/)
  assert.doesNotMatch(emittedClient, /animation:(?:6|12)s linear infinite/)
  assert.doesNotMatch(`${host}\n${client}\n${css}`, /MutationObserver|localStorage|tapIndex|backdrop-filter/)
  assert.equal(manifest.eMate.harnessCommit, 'd19aae6da3100e836867418c2cf73bdee8a0b1a8')
})
