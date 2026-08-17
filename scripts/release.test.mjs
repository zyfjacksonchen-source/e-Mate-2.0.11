import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { assertEvidenceSource, BUNDLED_PLUGIN_PACKAGES, generateEvidence, isAcceptedReleaseCommit, RELEASE_PACKAGES, verifyRelease, VERSION } from './release.mjs'
import {
  buildR2Inventory,
  matchesR2Head,
  normalizeProductionPublicOrigin,
  R2_BUCKET,
  R2_PREFIX,
  R2_PUBLIC_ORIGIN,
} from './publish-r2.mjs'

const HARNESS_COMMIT = '47f943859bef60e4160492346772ded9b24f765a'
const DIGEST = '0'.repeat(64)
const R2_FIXTURE_PUBLIC_ORIGIN = 'https://downloads.e-mate.example'
const SOURCE_COMMIT = '70ff2ce2e340682f4aad2be27e4ec8f1d74ee913'

async function file(root, relative, content = '') {
  const path = join(root, ...relative.split('/'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

function filename(name) {
  return `${name.slice(1).replace('/', '-')}-${VERSION}.tgz`
}

async function pack(directory, expected, mutate = manifest => manifest) {
  const stage = join(directory, 'main-all-all')
  const packageRoot = join(stage, 'package')
  const manifest = mutate({
    name: expected.name,
    version: VERSION,
    license: 'MIT',
    publishConfig: { access: 'public' },
  })
  await file(packageRoot, 'package.json', `${JSON.stringify(manifest)}\n`)
  await file(packageRoot, 'LICENSE', 'MIT\n')
  await file(packageRoot, 'README.md', '# fixture\n')

  manifest.dependencies ??= { yaml: '2.9.0' }
  await file(packageRoot, 'package.json', `${JSON.stringify(manifest)}\n`)
  await file(packageRoot, 'lib/bin.js')
  await file(packageRoot, 'profile/cordis.patch.yml', '[]\n')
  await file(packageRoot, 'profile/plugins/emate-shell/index.js')
  await file(packageRoot, 'THIRD_PARTY_NOTICES.txt')
  await file(packageRoot, 'runtime/harness/apps/cli/lib/bin.js')
  await file(packageRoot, 'runtime/harness/node_modules/@deepseek-ai/dsh/package.json', JSON.stringify({
    name: '@deepseek-ai/dsh', version: '0.1.0-rc.5', license: 'MIT',
  }))
  await file(packageRoot, 'runtime/source-manifest.json', JSON.stringify({
    product_version: VERSION, version: '0.1.0-rc.5', commit: HARNESS_COMMIT,
  }))
  const receipts = []
  for (const name of BUNDLED_PLUGIN_PACKAGES) {
    const directory = name.slice('@e-mate/dsh-plugin-'.length)
    receipts.push({ name, version: VERSION, directory })
    await file(packageRoot, `profile/bundles/${directory}/package.json`, JSON.stringify({
      name, version: VERSION, license: 'MIT', main: 'lib/index.js',
    }))
    await file(packageRoot, `profile/bundles/${directory}/lib/index.js`)
  }
  await file(packageRoot, 'profile/bundles/registry.json', JSON.stringify({
    schema_version: 1,
    product: 'e-Mate',
    version: VERSION,
    harness_version: '0.1.0-rc.5',
    harness_commit: HARNESS_COMMIT,
    packages: receipts,
  }))

  const archive = join(directory, filename(expected.name))
  execFileSync('tar', ['-czf', archive, '-C', stage, 'package'])
  return archive
}

async function fixture(mutateMain) {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-release-test-'))
  await pack(root, RELEASE_PACKAGES[0], mutateMain)
  return root
}

test('release evidence requires the one bundled package and emits hashes plus SPDX', async () => {
  const root = await fixture()
  const output = join(root, 'evidence')
  try {
    const result = await generateEvidence(root, output, SOURCE_COMMIT)
    assert.equal(result.release.length, 1)
    assert.deepEqual(result.manifest.publish_order, RELEASE_PACKAGES.map(item => item.name))
    assert.equal(result.manifest.publish_order.at(-1), '@e-mate/dsh')
    assert.equal(readFileSync(join(output, 'SHA256SUMS'), 'utf8').trim().split('\n').length, 1)
    assert.match(readFileSync(join(output, 'EVIDENCE_SHA256SUMS'), 'utf8'), /e-mate-2\.0\.7\.spdx\.json/u)
    assert.equal(result.spdx.spdxVersion, 'SPDX-2.3')
    assert.ok(result.spdx.packages.some(item => item.name === '@deepseek-ai/dsh'))
    assert.ok(result.spdx.packages.some(item => item.name === '@e-mate/dsh-plugin-memory-evolve'))
    for (const name of ['qrcode', 'dijkstrajs', 'pngjs']) {
      assert.equal(result.spdx.packages.find(item => item.name === name)?.licenseDeclared, 'MIT')
    }
    const r2 = buildR2Inventory(root, output, result.manifest.source_commit, R2_FIXTURE_PUBLIC_ORIGIN)
    assert.equal(r2.bucket, R2_BUCKET)
    assert.equal(r2.public_origin, R2_FIXTURE_PUBLIC_ORIGIN)
    assert.equal(r2.prefix, R2_PREFIX)
    assert.equal(r2.objects.length, 6)
    assert.ok(r2.objects.every(item => item.key === `${R2_PREFIX}/${item.filename}` && item.url === `${R2_FIXTURE_PUBLIC_ORIGIN}/${item.key}`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release evidence refuses dirty or mismatched source attribution', () => {
  const clean = (command, args) => args[0] === 'rev-parse' ? SOURCE_COMMIT : ''
  assert.equal(assertEvidenceSource({}, clean), SOURCE_COMMIT)
  assert.throws(
    () => assertEvidenceSource({ GITHUB_SHA: 'a'.repeat(40) }, clean),
    /does not match the checked-out HEAD/u,
  )
  assert.throws(
    () => assertEvidenceSource({}, (command, args) => args[0] === 'rev-parse' ? SOURCE_COMMIT : '?? untracked'),
    /requires a clean worktree/u,
  )
})

test('publication accepts only the exact 40-character release commit', () => {
  assert.equal(isAcceptedReleaseCommit({ GITHUB_SHA: SOURCE_COMMIT, EMATE_ACCEPTED_SHA: SOURCE_COMMIT }), true)
  assert.equal(isAcceptedReleaseCommit({ GITHUB_SHA: DIGEST, EMATE_ACCEPTED_SHA: DIGEST }), false)
  assert.equal(isAcceptedReleaseCommit({ GITHUB_SHA: SOURCE_COMMIT, EMATE_ACCEPTED_SHA: 'a'.repeat(40) }), false)
})

test('R2 immutable readback includes download metadata as well as bytes identity', () => {
  const item = {
    filename: 'e-mate-dsh-2.0.7.tgz',
    size: 207,
    sha256: DIGEST,
    contentType: 'application/gzip',
  }
  const head = {
    ContentLength: item.size,
    ContentType: item.contentType,
    ContentDisposition: `attachment; filename="${item.filename}"`,
    CacheControl: 'public,max-age=31536000,immutable',
    Metadata: { sha256: item.sha256 },
  }
  assert.equal(matchesR2Head(head, item), true)
  assert.equal(matchesR2Head({ ...head, CacheControl: 'no-cache' }, item), false)
  assert.equal(matchesR2Head({ ...head, Metadata: { sha256: 'f'.repeat(64) } }, item), false)
})

test('production R2 download origin is the owned public bucket', () => {
  assert.equal(normalizeProductionPublicOrigin(R2_PUBLIC_ORIGIN), R2_PUBLIC_ORIGIN)
  assert.throws(
    () => normalizeProductionPublicOrigin('https://dl.ecoremedia.net'),
    /e-Mate Cloudflare R2 public bucket origin/u,
  )
  assert.throws(
    () => normalizeProductionPublicOrigin('https://pub-0123456789abcdef0123456789abcdef.r2.dev'),
    /e-Mate Cloudflare R2 public bucket origin/u,
  )
  assert.throws(
    () => normalizeProductionPublicOrigin('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com'),
    /e-Mate Cloudflare R2 public bucket origin/u,
  )
})

test('release verification rejects a legacy platform package dependency', async () => {
  const root = await fixture(manifest => ({ ...manifest }))
  try {
    await pack(root, RELEASE_PACKAGES[0], manifest => ({
      ...manifest,
      optionalDependencies: { '@e-mate/dsh-runtime-darwin-arm64': VERSION },
    }))
    assert.throws(() => verifyRelease(root), /must not depend on legacy Runtime or Browser platform packages/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('release verification rejects temporary Harness build bytes', async () => {
  const root = await fixture()
  try {
    const stage = join(root, 'main-all-all')
    await file(join(stage, 'package'), 'runtime/.harness-build-stale/leak.txt', 'temporary build bytes')
    execFileSync('tar', ['-czf', join(root, filename('@e-mate/dsh')), '-C', stage, 'package'])
    assert.throws(() => verifyRelease(root), /temporary Harness build directory/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('GitHub release packs once and validates the same tarball on three platforms', () => {
  const requireFromDsh = createRequire(resolve('packages/dsh/package.json'))
  const { parse } = requireFromDsh('yaml')
  const workspace = JSON.parse(readFileSync('package.json', 'utf8'))
  const published = JSON.parse(readFileSync('packages/dsh/package.json', 'utf8'))
  assert.equal(published.dependencies.qrcode, '1.5.4')
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
  const release = parse(readFileSync('.github/workflows/release.yml', 'utf8'))
  assert.deepEqual(published.os, ['darwin', 'win32'])
  assert.equal(published.cpu, undefined)
  assert.ok(workspace.scripts.test.indexOf("--filter './packages/dsh-plugin-*'") < workspace.scripts.test.indexOf('--filter @e-mate/dsh test'))
  const ciChecks = ci.jobs.source.steps.find(step => step.name === 'Check target pin and e-Mate behavior').run
  assert.match(ciChecks, /^pnpm test$/mu)
  assert.doesNotMatch(ciChecks, /--filter @e-mate\/dsh test/u)
  assert.deepEqual(Object.keys(ci.jobs), ['source'])
  assert.deepEqual(
    release.jobs['clean-install'].strategy.matrix.include.map(item => [item.platform, item.runner]),
    [['darwin-arm64', 'macos-15'], ['darwin-x64', 'macos-15-intel'], ['win32-x64', 'windows-2025']],
  )
  assert.deepEqual(Object.keys(release.jobs), ['pack', 'clean-install', 'evidence', 'publish', 'registry-install', 'r2'])
  assert.equal(release.jobs['clean-install'].needs, 'pack')
  assert.equal(release.jobs.evidence.needs, 'pack')
  assert.deepEqual(release.jobs.publish.needs, ['clean-install', 'evidence'])
  assert.match(release.jobs.publish.steps.at(-1).run, /release\.mjs publish --from dist\/npm/u)
  const cleanInstall = release.jobs['clean-install'].steps.find(step => step.name === 'Install tarballs with npm and run setup checks')
  assert.equal((cleanInstall.run.match(/node "\$cli" setup$/gmu) ?? []).length, 2)
  const registryInstall = release.jobs['registry-install'].steps.find(step => step.name === 'Read back npm and run a clean registry install')
  assert.match(registryInstall.run, /update --version 2\.0\.7 --json/u)
  assert.match(registryInstall.run, /installed_package_integrity/u)
  assert.match(registryInstall.run, /previous_package_integrity/u)
  assert.match(registryInstall.run, /node "\$cli" stop/u)
  assert.equal(release.jobs.r2.needs, 'registry-install')
  assert.deepEqual(release.on.push.branches, ['main'])
  const r2 = release.jobs.r2.steps.find(step => step.name === 'Publish immutable release bytes to Cloudflare R2')
  assert.match(r2.run, /publish-r2\.mjs/u)
  assert.equal(r2.env.EMATE_R2_PUBLIC_ORIGIN, '${{ vars.EMATE_R2_PUBLIC_ORIGIN }}')
  assert.equal(release.on.workflow_dispatch.inputs.publish.default, false)
  assert.ok(release.jobs.publish.steps.every(step => !/\b(?:build|pack)\b/u.test(step.run ?? '')))
  assert.match(readFileSync('.gitattributes', 'utf8'), /^\* text=auto eol=lf$/mu)
})
