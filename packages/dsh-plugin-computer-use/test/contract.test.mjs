import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('computer-use adapter preserves the immutable universal helper and macOS-only bundle', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  const manifest = JSON.parse(await readFile(new URL('native/macos/manifest.json', root), 'utf8'))
  const helper = await readFile(new URL('native/macos/bin/dsh-computer-use-helper', root))
  const client = await readFile(new URL('lib/client.js', root), 'utf8')
  assert.equal(pkg.version, '2.0.9')
  assert.equal(pkg.dsh.upstream.commit, '76bfe8607f61945c1cbb84e73976e601100c13a2')
  assert.equal(pkg.eMate.harnessVersion, '0.1.0-rc.7')
  assert.match(patch, /process\.platform !== 'darwin'/u)
  assert.deepEqual(manifest.binary.architectures, ['arm64', 'x86_64'])
  assert.equal(createHash('sha256').update(helper).digest('hex'), manifest.binary.sha256)
  assert.match(client, /@e-mate\/dsh-plugin-computer-use/u)
  assert.doesNotMatch(client, /@anionex\/dsh-computer-use/u)
})
