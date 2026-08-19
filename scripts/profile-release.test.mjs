import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { emitComponent } from './component-release.mjs'
import { composeProfileReleaseCandidate } from './profile-release.mjs'

const roots = []
test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-profile-release-'))
  roots.push(root)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyId = '0123456789abcdef'
  const baseId = 'e-mate-desktop-profile-v1-dsh-df78045a127e'
  mkdirSync(join(root, 'desktop/e-mate-desktop'), { recursive: true })
  mkdirSync(join(root, 'packages/dsh/profile'), { recursive: true })
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  execFileSync('git', [
    'update-index', '--add', '--cacheinfo',
    '160000,df78045a127e32cb5b942defba52c539590d1596,upstream/deepseek-harness',
  ], { cwd: root })
  writeJson(join(root, 'desktop/e-mate-desktop/base-contract.json'), {
    schema_version: 1,
    id: baseId,
    desktop_api: 1,
    profile_format: 1,
    desktop_reference: {
      repository: 'anywhere-labs/deepseek-harness-desktop',
      commit: '6074088f5b660206e404b3591fab51fb99c69add',
      harness_repository: 'deepseek-ai/deepseek-harness',
      harness_commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
      harness_version: '0.1.0-rc.7',
    },
    harness_version: '0.1.0-rc.7',
    harness_commit: 'df78045a127e32cb5b942defba52c539590d1596',
    profile_signing_keys: [{
      id: keyId,
      algorithm: 'ed25519',
      public_key_spki_der_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    }],
  })
  writeJson(join(root, 'desktop/e-mate-desktop/package.json'), { version: '2.0.11', dependencies: {} })
  const components = ['fixture-a', 'fixture-b'].map(slug => {
    const id = `@e-mate/dsh-plugin-${slug}`
    const componentRoot = join(root, 'packages', `dsh-plugin-${slug}`)
    mkdirSync(join(componentRoot, 'lib'), { recursive: true })
    writeFileSync(join(componentRoot, 'lib/index.js'), `export const value = ${JSON.stringify(slug)}\n`)
    writeFileSync(join(componentRoot, 'cordis.patch.yml'), '[]\n')
    writeJson(join(componentRoot, 'package.json'), {
      name: id,
      version: '2.0.11',
      type: 'module',
      main: 'lib/index.js',
      files: ['lib', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      eMate: {
        component: { schema_version: 1, id, kind: 'profile', base_contracts: [baseId] },
        harnessVersion: '0.1.0-rc.7',
        harnessCommit: 'df78045a127e32cb5b942defba52c539590d1596',
      },
      license: 'MIT',
    })
    return { id, root: `packages/dsh-plugin-${slug}`, kind: 'profile', desktop: 'hot-profile', cli: true }
  })
  writeJson(join(root, 'packages/dsh/profile/component-inventory.json'), { schema_version: 1, components })
  return {
    root,
    components,
    keyId,
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  }
}

function emit(root, id, output, commit) {
  return emitComponent({ root, id, out: output, sourceCommit: commit })
}

function artifactRequest(reference, artifact) {
  const manifest = JSON.parse(readFileSync(join(artifact, 'manifest.json'), 'utf8'))
  const objects = new Map([[reference.manifest_url, readFileSync(join(artifact, 'manifest.json'))]])
  for (const file of manifest.files) {
    const url = `${new URL('.', reference.manifest_url).href}files/${file.path.split('/').map(encodeURIComponent).join('/')}`
    objects.set(url, readFileSync(join(artifact, 'files', ...file.path.split('/'))))
  }
  return async url => {
    const bytes = objects.get(url)
    return bytes === undefined
      ? new Response(null, { status: 404 })
      : new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
  }
}

test('a changed component is merged with the complete signed accepted set before admission', async () => {
  const { root, components, keyId, privateKeyPem } = fixture()
  const firstArtifacts = join(root, 'dist/first-components')
  const firstCommit = 'a'.repeat(40)
  for (const component of components) {
    emit(root, component.id, join(firstArtifacts, component.id.split('/').at(-1)), firstCommit)
  }
  const firstOutput = join(root, 'dist/first-candidate')
  const first = await composeProfileReleaseCandidate({
    root,
    target: 'darwin-arm64',
    artifactRoots: [firstArtifacts],
    changedIds: components.map(component => component.id),
    sourceCommit: firstCommit,
    output: firstOutput,
    privateKeyPem,
    keyId,
  })
  assert.equal(first.admission.sequence, 1)
  assert.equal(first.admission.parent_generation, null)
  assert.equal(first.admission.signature_kind, 'production')
  assert.deepEqual(first.release.payload.components.map(component => component.id), components.map(component => component.id))

  const changed = components[0]
  writeFileSync(join(root, changed.root, 'lib/index.js'), 'export const value = "changed"\n')
  const secondArtifact = join(root, 'dist/second-components', changed.id.split('/').at(-1))
  const secondCommit = 'b'.repeat(40)
  emit(root, changed.id, secondArtifact, secondCommit)
  const unchangedReference = first.release.payload.components.find(component => component.id === components[1].id)
  const unchangedArtifact = join(firstArtifacts, components[1].id.split('/').at(-1))
  const second = await composeProfileReleaseCandidate({
    root,
    target: 'darwin-arm64',
    artifactRoots: [join(root, 'dist/second-components')],
    changedIds: [changed.id],
    sourceCommit: secondCommit,
    output: join(root, 'dist/second-candidate'),
    current: join(firstOutput, 'envelope.json'),
    privateKeyPem,
    keyId,
    request: artifactRequest(unchangedReference, unchangedArtifact),
  })

  assert.equal(second.admission.sequence, 2)
  assert.equal(second.admission.parent_generation, first.admission.candidate_generation)
  assert.notEqual(second.admission.candidate_generation, first.admission.candidate_generation)
  assert.deepEqual(second.admission.changed_components, [changed.id])
  assert.equal(
    second.release.payload.components.find(component => component.id === components[1].id).manifest_sha256,
    unchangedReference.manifest_sha256,
  )
  assert.equal(
    second.release.payload.components.find(component => component.id === changed.id).manifest_source_commit,
    secondCommit,
  )
})

test('composition rejects a changed artifact set that does not exactly match admission input', async () => {
  const { root, components } = fixture()
  const artifacts = join(root, 'dist/components')
  for (const component of components) emit(root, component.id, join(artifacts, component.id.split('/').at(-1)), 'c'.repeat(40))
  await assert.rejects(composeProfileReleaseCandidate({
    root,
    target: 'darwin-arm64',
    artifactRoots: [artifacts],
    changedIds: [components[0].id],
    sourceCommit: 'c'.repeat(40),
    output: join(root, 'dist/rejected'),
  }), /artifact set mismatch/u)
})
