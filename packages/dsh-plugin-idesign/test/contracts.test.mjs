import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const archive = resolve(root, 'vendor/deepseek-idesign-0.2.0.tarball')
const allowed = [
  'ipollowork.html-anything.blog-post',
  'ipollowork.html-anything.finance-report',
  'ipollowork.html-anything.info-funnel',
  'ipollowork.html-anything.invoice',
  'ipollowork.html-anything.magazine-poster',
]

test('pins the last MIT release and exposes the rc.7 component contract', async () => {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const digest = createHash('sha512').update(await readFile(archive)).digest('base64')
  assert.equal(digest, 'srwVnWHSnuuTgMpkfqfnhJD7OO8BtC1nzY6SUIG+gE2K+odZ1yr+GH/swyNNcRMiOPo3YdCslDGq/bkTYlAlBA==')
  assert.equal(manifest.name, '@e-mate/dsh-plugin-idesign')
  assert.equal(manifest.version, '2.0.12')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.eMate.harnessCommit, '2bc16230975f6cf02aa1b283b1f86de44007b059')
})

test('ships only local, explicitly licensed templates', async () => {
  const templateRoot = resolve(root, 'lib/templates')
  assert.deepEqual((await readdir(templateRoot)).sort(), allowed)
  for (const name of allowed) {
    const directory = resolve(templateRoot, name)
    const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'))
    const entry = await readFile(resolve(directory, manifest.entry), 'utf8')
    assert.equal(manifest.source.license, 'Apache-2.0')
    assert.doesNotMatch(entry.replaceAll('http://www.w3.org/2000/svg', ''), /https?:\/\//)
    await readFile(resolve(directory, 'LICENSE'))
    await readFile(resolve(directory, 'NOTICE'))
  }
})

test('keeps the native workspace, atomic-write and draft-only boundaries', async () => {
  const host = await readFile(resolve(root, 'lib/index.js'), 'utf8')
  const client = await readFile(resolve(root, 'lib/client.js'), 'utf8')
  const studio = await readFile(resolve(root, 'studio/dist/index.html'), 'utf8')
  assert.match(host, /MAX_TEXT_BYTES = 20 \* 1024 \* 1024/)
  assert.match(host, /Design Studio can only access the workspace design folder/)
  assert.match(host, /Symbolic links outside the workspace are not allowed/)
  assert.match(host, /await rename\(temporary, path\)/)
  assert.match(host, /routeRoot: "\/ipollowork-design"/)
  assert.match(client, /ctx\.slots\.inject\("conversation\.view"/)
  assert.match(client, /id: "@e-mate\/dsh-plugin-idesign"/)
  assert.match(client, /label: "设计"/)
  assert.match(client, /inputActions\.setDraft/)
  assert.doesNotMatch(client, /inputActions\.(?:submit|send)/)
  assert.match(studio, /__IPOLLOWORK_DESIGN_STUDIO_TOKEN_VALUE__/)
  assert.doesNotMatch(`${host}\n${client}`, /ipollowork\.wechat-article|Source Available License/)
})
