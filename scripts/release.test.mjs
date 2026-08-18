import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { assertEvidenceSource, BUNDLED_PLUGIN_PACKAGES, generateEvidence, isAcceptedReleaseCommit, RELEASE_PACKAGES, TARGET_NATIVE_RUNTIME_FILES, verifyRelease, VERSION } from './release.mjs'
import {
  buildR2Inventory,
  matchesR2Head,
  normalizeProductionPublicOrigin,
  R2_BUCKET,
  R2_PUBLIC_ORIGIN,
} from './publish-r2.mjs'
import { releasePrefix, releaseSource } from './release-source.mjs'
import { renderDownloadPage } from './render-download-page.mjs'

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
  await file(packageRoot, 'lib/release-source.json', JSON.stringify(releaseSource(SOURCE_COMMIT)))
  await file(packageRoot, 'profile/cordis.patch.yml', '[]\n')
  await file(packageRoot, 'profile/plugins/emate-shell/index.js')
  await file(packageRoot, 'THIRD_PARTY_NOTICES.txt')
  await file(packageRoot, 'runtime/harness/apps/cli/lib/bin.js')
  await file(packageRoot, 'runtime/harness/node_modules/@deepseek-ai/dsh/package.json', JSON.stringify({
    name: '@deepseek-ai/dsh', version: '0.1.0-rc.5', license: 'MIT',
  }))
  for (const runtimeFile of TARGET_NATIVE_RUNTIME_FILES) {
    await file(packageRoot, `runtime/harness/node_modules/${runtimeFile}`)
  }
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
    assert.equal(result.manifest.download.package_name, '@e-mate/dsh')
    assert.equal(result.manifest.download.version, VERSION)
    assert.equal(result.manifest.download.source_commit, SOURCE_COMMIT)
    assert.equal(result.manifest.download.manifest_url, releaseSource(SOURCE_COMMIT).manifest_url)
    assert.equal(result.manifest.download.tarball_url, releaseSource(SOURCE_COMMIT).tarball_url)
    assert.equal(result.manifest.download.sha256, result.release[0].sha256)
    assert.equal(result.manifest.download.sha512, result.release[0].sha512)
    assert.equal(result.manifest.download.integrity, result.release[0].integrity)
    assert.equal(readFileSync(join(output, 'SHA256SUMS'), 'utf8').trim().split('\n').length, 1)
    assert.match(readFileSync(join(output, 'EVIDENCE_SHA256SUMS'), 'utf8'), /e-mate-2\.0\.8\.spdx\.json/u)
    assert.equal(result.spdx.spdxVersion, 'SPDX-2.3')
    assert.ok(result.spdx.packages.some(item => item.name === '@deepseek-ai/dsh'))
    assert.ok(result.spdx.packages.some(item => item.name === '@e-mate/dsh-plugin-memory-evolve'))
    for (const name of ['qrcode', 'dijkstrajs', 'pngjs']) {
      assert.equal(result.spdx.packages.find(item => item.name === name)?.licenseDeclared, 'MIT')
    }
    const r2 = buildR2Inventory(root, output, result.manifest.source_commit, R2_FIXTURE_PUBLIC_ORIGIN)
    assert.equal(r2.bucket, R2_BUCKET)
    assert.equal(r2.public_origin, R2_FIXTURE_PUBLIC_ORIGIN)
    assert.equal(r2.prefix, releasePrefix(SOURCE_COMMIT))
    assert.equal(r2.objects.length, 6)
    assert.ok(r2.objects.every(item => item.key === `${releasePrefix(SOURCE_COMMIT)}/${item.filename}` && item.url === `${R2_FIXTURE_PUBLIC_ORIGIN}/${item.key}`))
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
    filename: 'e-mate-dsh-2.0.8.tgz',
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
  assert.deepEqual(Object.keys(ci.jobs), ['source', 'desktop-windows', 'desktop-macos'])
  assert.equal(ci.jobs['desktop-windows'].needs, 'source')
  assert.equal(ci.jobs['desktop-macos'].needs, 'source')
  assert.deepEqual(
    release.jobs['clean-install'].strategy.matrix.include.map(item => [item.platform, item.runner]),
    [['darwin-arm64', 'macos-15'], ['darwin-x64', 'macos-15-intel'], ['win32-x64', 'windows-2025']],
  )
  assert.deepEqual(Object.keys(release.jobs), ['pack', 'clean-install', 'evidence', 'r2'])
  assert.equal(release.jobs['clean-install'].needs, 'pack')
  assert.equal(release.jobs.evidence.needs, 'pack')
  assert.match(release.jobs.evidence.steps.find(step => step.name === 'Render the immutable candidate download page').run, /render-download-page\.mjs/u)
  const cleanInstall = release.jobs['clean-install'].steps.find(step => step.name === 'Install tarballs with npm and run setup checks')
  assert.equal((cleanInstall.run.match(/node "\$cli" setup$/gmu) ?? []).length, 2)
  assert.match(readFileSync('scripts/build-harness-runtime.mjs', 'utf8'), /'--os=darwin', '--os=win32', '--cpu=arm64', '--cpu=x64'/u)
  assert.deepEqual(release.jobs.r2.needs, ['clean-install', 'evidence'])
  assert.deepEqual(release.on.push.branches, ['main'])
  const r2 = release.jobs.r2.steps.find(step => step.name === 'Publish immutable release bytes to Cloudflare R2')
  assert.match(r2.run, /publish-r2\.mjs/u)
  assert.equal(r2.env.EMATE_R2_PUBLIC_ORIGIN, '${{ vars.EMATE_R2_PUBLIC_ORIGIN }}')
  assert.equal(release.on.workflow_dispatch.inputs.publish.default, false)
  assert.doesNotMatch(readFileSync('.github/workflows/release.yml', 'utf8'), /npm view '@e-mate\/dsh@2\.0\.8'|release\.mjs publish/u)
  assert.match(readFileSync('.gitattributes', 'utf8'), /^\* text=auto eol=lf$/mu)
})

test('download page resolves unsigned desktop installers from the fail-closed R2 manifest', async () => {
  const page = renderDownloadPage(readFileSync('deploy/download-page/index.html', 'utf8'))
  const script = readFileSync('deploy/download-page/site.527be2232a46.js', 'utf8')
  const manifestUrl = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/latest.json'
  assert.match(script, new RegExp(manifestUrl.replaceAll('.', '\\.')))
  for (const platform of ['macos', 'windows']) assert.match(page, new RegExp(`data-platform="${platform}"`, 'u'))
  for (const artifact of ['darwin', 'win32']) assert.match(script, new RegExp(`artifacts\\.${artifact}`, 'u'))
  for (const filename of ['e-Mate-2.0.8-mac-universal.dmg', 'e-Mate-2.0.8-win-x64-Setup.exe']) {
    assert.match(script, new RegExp(filename.replaceAll('.', '\\.'), 'u'))
  }
  assert.match(script, /manifest\.source_commit/u)
  assert.match(script, /Number\.isSafeInteger\(artifact\.bytes\)/u)
  assert.match(script, /\^\[0-9a-f\]\{64\}\$/u)
  assert.match(page, /未签名/u)
  assert.match(page, /告诉小芯更新 e-Mate/u)
  assert.match(page, /\/ecorex-agent\/admin\//u)
  for (const asset of [
    'emate-logo.e0bf52b1480f.png',
    'emate-mark.1a6dbbe3b5fe.png',
    'emate-desktop-workspace.622f3434f88c.jpg',
    'e-mate-hero-decor.d7f99a88447b.png',
  ]) {
    assert.ok(existsSync(`deploy/download-page/assets/${asset}`))
    assert.match(page, new RegExp(`\\./assets/${asset.replaceAll('.', '\\.')}\\b`, 'u'))
  }
  assert.doesNotMatch(page, /__EMATE_RELEASE_SOURCE_COMMIT__|npm install|nodejs\.org|e-mate setup|e-mate launch/u)
  const { normalizeDownloadIndex } = await import('../deploy/download-page/site.527be2232a46.js')
  const commit = 'a'.repeat(40)
  const releasePrefix = `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v2.0.8/${commit}`
  const fixture = {
    schema_version: 1,
    version: '2.0.8',
    source_commit: commit,
    artifacts: {
      darwin: { url: `${releasePrefix}/e-Mate-2.0.8-mac-universal.dmg`, bytes: 123, sha256: 'b'.repeat(64) },
      win32: { url: `${releasePrefix}/e-Mate-2.0.8-win-x64-Setup.exe`, bytes: 456, sha256: 'c'.repeat(64) },
    },
  }
  assert.deepEqual(normalizeDownloadIndex(fixture).downloads.map(item => item.target), ['macos-universal', 'windows-x64'])
  assert.throws(() => normalizeDownloadIndex({
    ...fixture,
    artifacts: { ...fixture.artifacts, darwin: { ...fixture.artifacts.darwin, url: 'https://example.com/e-Mate.dmg' } },
  }), /桌面制品身份无效/u)
})
