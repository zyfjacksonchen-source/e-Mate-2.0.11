import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)

test('rc.5 adapter is observable and does not expose provider or model configuration', async () => {
  const [manifest, patch, source] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8'),
    readFile(new URL('cordis.patch.yml', root), 'utf8'),
    readFile(new URL('src/index.ts', root), 'utf8'),
  ])
  const pkg = JSON.parse(manifest)
  assert.equal(pkg.version, '2.0.9')
  assert.equal(pkg.dsh.visionToolkit.adapterState, 'blocked')
  assert.equal(pkg.dependencies, undefined)
  assert.equal(pkg.peerDependencies, undefined)
  assert.equal(pkg.eMate.harnessVersion, '0.1.0-rc.7')
  assert.match(patch, /mode: managed/u)
  assert.match(source, /EMATE_VISION_POLICY_SEAM_MISSING/u)
  assert.match(source, /runtimeInstalled: false/u)
  assert.match(source, /emateCapabilities/u)
  assert.match(source, /capabilities\.register\(/u)
  assert.match(source, /id: 'vision-ocr'/u)
  assert.doesNotMatch(source, /provider:\s*z\.object/u)
  assert.doesNotMatch(source, /model:\s*z\.string/u)
  assert.doesNotMatch(manifest, /@anionex\/dsh-vision-toolkit"\s*:/u)
})
