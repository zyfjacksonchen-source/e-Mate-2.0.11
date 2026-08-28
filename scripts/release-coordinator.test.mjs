import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emitState, exactArtifact, parseArgs, publicationMetadata } from './release-coordinator.mjs'

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

test('release state binds every artifact id, digest, and byte count', async t => {
  const root = await mkdtemp(join(tmpdir(), 'e-mate-release-state-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const output = join(root, 'release-state.json')
  const options = {
    source: 'a'.repeat(40), version: '2.0.15', mode: 'base', 'macos-publication-mode': 'unsigned',
    'ci-run': '1', 'macos-run': '1', 'windows-run': '1', out: output,
    ...Object.fromEntries(['profile', 'desktop', 'admission', 'macos', 'windows'].flatMap((name, index) => [
      [`${name}-artifact`, String(index + 2)],
      [`${name}-digest`, `sha256:${String(index).repeat(64)}`],
      [`${name}-bytes`, String(index + 10)],
      ...(['profile', 'desktop', 'admission'].includes(name) ? [[`${name}-run`, String(index + 20)]] : []),
    ])),
  }
  const previous = process.env.EMATE_EXPECTED_VERSION
  process.env.EMATE_EXPECTED_VERSION = '2.0.15'
  t.after(() => previous === undefined ? delete process.env.EMATE_EXPECTED_VERSION : process.env.EMATE_EXPECTED_VERSION = previous)
  emitState(options)
  const state = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(state.schema_version, 4)
  assert.equal(state.macos_publication_mode, 'unsigned')
  assert.deepEqual(state.publication_metadata, publicationMetadata('unsigned'))
  assert.deepEqual(state.stages.publication.macos, {
    run_id: '1', artifact_id: '5', artifact_digest: `sha256:${'3'.repeat(64)}`, artifact_bytes: 13,
  })
  assert.throws(() => emitState({ ...options, out: join(root, 'bad.json'), 'desktop-digest': 'bad' }), /identity is invalid/u)
  assert.throws(() => emitState({ ...options, out: join(root, 'mode.json'), 'macos-publication-mode': 'automatic' }), /exactly unsigned or signed/u)
  assert.throws(() => emitState({ ...options, out: join(root, 'owner.json'), 'macos-run': '9' }), /identity is invalid/u)
})

test('coordinator emits one release-bound website handoff and performs no publication write', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release-coordinator.yml', import.meta.url), 'utf8')
  for (const stage of ['profile-release.yml', 'desktop-release.yml', 'desktop-admission.yml']) {
    assert.match(workflow, new RegExp(stage.replaceAll('.', '\\.')))
  }
  assert.doesNotMatch(workflow, /desktop-performance\.yml|performance_workflow_run_id|performance_artifact_id/u)
  assert.match(workflow, /admitted-awaiting-cloudflare-plugin/u)
  assert.match(workflow, /website_public_origin/u)
  assert.match(workflow, /website_expected_active_target/u)
  assert.match(workflow, /website_expected_active_index/u)
  assert.match(workflow, /render-download-page\.mjs/u)
  assert.match(workflow, /--release-state release-state\.json/u)
  assert.match(workflow, /macos_publication_mode/u)
  assert.match(workflow, /inputs\.macos_publication_mode == 'signed'/u)
  assert.match(workflow, /macos_publication_mode:"unsigned",macos_unsigned_artifact_id/u)
  assert.match(workflow, /--macos-publication-mode/u)
  assert.match(workflow, /--macos-run "\$macos_run"/u)
  assert.match(workflow, /e-mate-website-handoff-\$\{\{ inputs\.source_sha \}\}/u)
  assert.doesNotMatch(workflow, /desktop-publication\.yml|wrangler|r2\.cloudflarestorage/u)
  assert.doesNotMatch(workflow, /ssh |scp |rsync |ln -s|aws |curl .*-(?:X|T)/u)
})
