import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { exactArtifact, parseArgs } from './release-coordinator.mjs'

test('parses only closed key-value arguments', () => {
  assert.deepEqual(parseArgs(['--source', 'a'.repeat(40), '--mode', 'base']), { source: 'a'.repeat(40), mode: 'base' })
  assert.throws(() => parseArgs(['source', 'x']), /--key value/u)
})

test('selects one exact run-bound immutable artifact', () => {
  const valid = { id: 7, name: 'candidate', expired: false, digest: `sha256:${'a'.repeat(64)}`, size_in_bytes: 1, workflow_run: { id: 5 } }
  assert.equal(exactArtifact([valid], 'candidate', '5'), valid)
  assert.throws(() => exactArtifact([valid, { ...valid, id: 8 }], 'candidate', '5'), /expected one/u)
  assert.throws(() => exactArtifact([{ ...valid, digest: null }], 'candidate', '5'), /expected one/u)
})

test('coordinator stops at the Cloudflare plugin publication boundary', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release-coordinator.yml', import.meta.url), 'utf8')
  for (const stage of ['profile-release.yml', 'desktop-release.yml', 'desktop-performance.yml', 'desktop-admission.yml']) {
    assert.match(workflow, new RegExp(stage.replaceAll('.', '\\.')))
  }
  assert.match(workflow, /admitted-awaiting-cloudflare-plugin/u)
  assert.doesNotMatch(workflow, /desktop-publication\.yml|wrangler|r2\.cloudflarestorage/u)
})
