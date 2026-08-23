import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
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

const HARNESS_COMMIT = '2bc16230975f6cf02aa1b283b1f86de44007b059'
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
    name: '@deepseek-ai/dsh', version: '0.1.0-rc.7', license: 'MIT',
  }))
  for (const runtimeFile of TARGET_NATIVE_RUNTIME_FILES) {
    await file(packageRoot, `runtime/harness/node_modules/${runtimeFile}`)
  }
  await file(packageRoot, 'runtime/source-manifest.json', JSON.stringify({
    product_version: VERSION, version: '0.1.0-rc.7', commit: HARNESS_COMMIT,
    adapters_sha256: createHash('sha256').update(readFileSync(
      fileURLToPath(new URL('./harness-runtime-adapters.mjs', import.meta.url)),
    )).digest('hex'),
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
    harness_version: '0.1.0-rc.7',
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
    assert.ok(readFileSync(join(output, 'EVIDENCE_SHA256SUMS'), 'utf8').includes(`e-mate-${VERSION}.spdx.json`))
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
    filename: 'e-mate-dsh-2.0.12.tgz',
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

test('release verification rejects a Harness runtime built with different Base adapters', async () => {
  const root = await fixture()
  try {
    const stage = join(root, 'main-all-all')
    const manifestPath = join(stage, 'package', 'runtime', 'source-manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    await writeFile(manifestPath, JSON.stringify({ ...manifest, adapters_sha256: 'f'.repeat(64) }))
    execFileSync('tar', ['-czf', join(root, filename('@e-mate/dsh')), '-C', stage, 'package'])
    assert.throws(() => verifyRelease(root), /wrong DeepSeek Harness closure/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('component builds reject a pnpm version different from the repository contract', async () => {
  const root = mkdtempSync(join(tmpdir(), 'emate-pnpm-version-'))
  try {
    const fakePnpm = join(root, 'pnpm.mjs')
    await writeFile(fakePnpm, "console.log('11.19.0')\n")
    let failure
    try {
      execFileSync(process.execPath, [
        'scripts/component-run.mjs',
        'build',
        '--component',
        '@e-mate/dsh-plugin-cdp',
      ], {
        env: { ...process.env, npm_execpath: fakePnpm },
        stdio: 'pipe',
      })
    } catch (error) {
      failure = error
    }
    assert.ok(failure)
    assert.match(String(failure.stderr), /component builds require pnpm 11\.7\.0, found 11\.19\.0/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('find-skill component builds prepare its exact pinned upstream workspace', () => {
  const runner = readFileSync('scripts/component-run.mjs', 'utf8')
  assert.match(runner, /component\.id === '@e-mate\/dsh-plugin-find-skill'[\s\S]*?--dir', 'upstream\/plugins\/dsh-find-skill', 'install', '--frozen-lockfile', '--ignore-scripts'/u)
})

test('GitHub release packs once and validates the same tarball on three platforms', () => {
  const requireFromDsh = createRequire(resolve('packages/dsh/package.json'))
  const { parse } = requireFromDsh('yaml')
  const workspace = JSON.parse(readFileSync('package.json', 'utf8'))
  const published = JSON.parse(readFileSync('packages/dsh/package.json', 'utf8'))
  assert.equal(published.dependencies.qrcode, '1.5.4')
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
  const release = parse(readFileSync('.github/workflows/release.yml', 'utf8'))
  const desktopRelease = parse(readFileSync('.github/workflows/desktop-release.yml', 'utf8'))
  assert.doesNotMatch(readFileSync('.github/workflows/desktop-release.yml', 'utf8'), /python-version: '3\.12\.14'/u)
  assert.deepEqual(published.os, ['darwin', 'win32'])
  assert.equal(published.cpu, undefined)
  assert.ok(workspace.scripts.test.indexOf('component-run.mjs check') < workspace.scripts.test.indexOf('--filter @e-mate/dsh test'))
  const ciChecks = ci.jobs.source.steps.find(step => step.name === 'Check target pin and e-Mate behavior').run
  assert.match(ciChecks, /^pnpm test$/mu)
  assert.doesNotMatch(ciChecks, /--filter @e-mate\/dsh test/u)
  assert.deepEqual(Object.keys(ci.jobs), [
    'impact',
    'source',
    'plugins',
    'base-platform-components',
    'profile-portable-composition',
    'profile-composition',
    'enterprise',
    'desktop-windows',
    'desktop-macos',
    'admission',
  ])
  assert.equal(ci.jobs.source.needs, 'impact')
  assert.deepEqual(ci.jobs['base-platform-components'].needs, ['impact', 'source'])
  assert.equal(ci.jobs['desktop-windows'].needs, 'source')
  assert.equal(ci.jobs['desktop-macos'].needs, 'source')
  for (const [workflow, producer] of [[ci, 'source'], [desktopRelease, 'profile']]) {
    const artifact = workflow.jobs[producer].steps.find(step => step.uses === 'actions/upload-artifact@v4'
      && step.with.name.startsWith('e-mate-desktop-profile-'))
    assert.match(artifact.with.path, /packages\/dsh-plugin-\*\/lib/u)
    assert.doesNotMatch(artifact.with.path, /browser-extension/u)
    for (const job of Object.values(workflow.jobs).filter(item => item.needs === producer)) {
      assert.equal(job.steps.find(step => step.uses === 'actions/download-artifact@v4').with.path, 'packages')
    }
  }
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
  assert.ok(cleanInstall.run.includes('version="$(node -p "require(process.argv[1]).version" "$npm_root/@e-mate/dsh/package.json")"'))
  assert.doesNotMatch(cleanInstall.run, /require\('\$npm_root/u)
  assert.match(readFileSync('scripts/build-harness-runtime.mjs', 'utf8'), /'--os=darwin', '--os=win32', '--cpu=arm64', '--cpu=x64'/u)
  assert.equal(release.jobs.r2.needs, undefined)
  assert.equal(release.on.push, undefined)
  assert.equal(release.on.pull_request, undefined)
  const r2 = release.jobs.r2.steps.find(step => step.name === 'Publish immutable release bytes to Cloudflare R2')
  assert.match(r2.run, /publish-r2\.mjs/u)
  assert.equal(r2.env.EMATE_R2_PUBLIC_ORIGIN, '${{ vars.EMATE_R2_PUBLIC_ORIGIN }}')
  assert.equal(release.on.workflow_dispatch.inputs.publish.default, false)
  assert.equal(release.on.workflow_dispatch.inputs.release_run_id.default, '')
  assert.match(release.jobs.r2.steps.find(step => step.name === 'Validate the accepted build-only run').run, /head_sha/u)
  assert.equal(release.jobs.r2.steps.find(step => step.uses === 'actions/download-artifact@v4').with['run-id'], '${{ inputs.release_run_id }}')
  assert.doesNotMatch(readFileSync('.github/workflows/release.yml', 'utf8'), /npm view '@e-mate\/dsh@2\.0\.8'|release\.mjs publish/u)
  const desktopReleaseSource = readFileSync('.github/workflows/desktop-release.yml', 'utf8')
  const desktopManifestSource = readFileSync('desktop/e-mate-desktop/scripts/desktop-release-manifest.ts', 'utf8')
  const desktopPublisher = desktopRelease.jobs.r2.steps.find(step => step.name === 'Publish accepted desktop bytes to Cloudflare R2')
  assert.equal(desktopRelease.jobs.r2.needs, undefined)
  assert.equal(desktopRelease.on.workflow_dispatch.inputs.release_run_id.default, '')
  assert.equal(desktopRelease.on.workflow_dispatch.inputs.reuse_run_id.default, '')
  assert.match(desktopRelease.jobs.reuse.steps[0].run, /Build and verify the e-Mate profile/u)
  assert.match(desktopRelease.jobs.reuse.steps[0].run, /Build unsigned Windows x64 installer/u)
  assert.match(desktopRelease.jobs.macos.if, /needs\.reuse\.result == 'success'/u)
  assert.equal(desktopRelease.jobs.macos.steps.find(step => step.uses === 'actions/download-artifact@v4').with['run-id'], "${{ inputs.reuse_run_id != '' && inputs.reuse_run_id || github.run_id }}")
  assert.equal(desktopRelease.jobs.manifest.steps.find(step => step.uses === 'actions/download-artifact@v4').with['run-id'], "${{ inputs.reuse_run_id != '' && inputs.reuse_run_id || github.run_id }}")
  assert.match(desktopRelease.jobs.manifest.steps.find(step => step.name === 'Generate exact R2 release manifest').run, /--mac-commit/u)
  assert.match(desktopRelease.jobs.manifest.steps.find(step => step.name === 'Generate exact R2 release manifest').run, /--win-run/u)
  assert.match(desktopRelease.jobs.r2.steps.find(step => step.name === 'Validate the accepted build-only run').run, /head_sha/u)
  assert.equal(desktopRelease.jobs.r2.steps.find(step => step.uses === 'actions/download-artifact@v4').with['run-id'], '${{ inputs.release_run_id }}')
  assert.match(desktopManifestSource, /readFileSync\(new URL\('\.\.\/package\.json'/u)
  assert.doesNotMatch(desktopManifestSource, /const VERSION = '\d+\.\d+\.\d+'/u)
  assert.match(desktopPublisher.run, /version="\$\(jq -er '\.version/u)
  assert.match(desktopPublisher.run, /\.artifacts\[\$platform\]\.url/u)
  assert.equal(desktopPublisher.env.EMATE_PERFORMANCE_ACCEPTED_SHA, '${{ vars.EMATE_PERFORMANCE_ACCEPTED_SHA }}')
  assert.match(desktopPublisher.run, /test "\$GITHUB_SHA" = "\$EMATE_PERFORMANCE_ACCEPTED_SHA"/u)
  assert.ok(desktopPublisher.run.lastIndexOf('public-artifact') < desktopPublisher.run.indexOf('--key desktop/latest.json'))
  for (const job of ['windows', 'macos', 'manifest']) {
    const step = desktopRelease.jobs[job].steps.find(item => item.id === 'version')
    assert.match(step.run, /node -p "require\(process\.argv\[1\]\)\.version"/u)
    assert.doesNotMatch(step.run, /node -p \\"require/u)
  }
  assert.doesNotMatch(desktopReleaseSource, /e-Mate-\d+\.\d+\.\d+-(?:mac|win)|releases\/v\d+\.\d+\.\d+/u)
  assert.match(readFileSync('.gitattributes', 'utf8'), /^\* text=auto eol=lf$/mu)
})

test('download page resolves unsigned desktop installers from the fail-closed R2 manifest', async () => {
  const page = renderDownloadPage(readFileSync('deploy/download-page/index.html', 'utf8'))
  const macGuide = readFileSync('deploy/download-page/install-macos.html', 'utf8')
  const scriptName = 'site.f64ce25824c9.js'
  const script = readFileSync(`deploy/download-page/${scriptName}`, 'utf8')
  assert.equal(scriptName.split('.')[1], createHash('sha256').update(script).digest('hex').slice(0, 12))
  const manifestUrl = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/latest.json'
  assert.match(script, new RegExp(manifestUrl.replaceAll('.', '\\.')))
  for (const platform of ['macos', 'windows']) assert.match(page, new RegExp(`data-platform="${platform}"`, 'u'))
  for (const artifact of ['darwin', 'win32']) assert.match(script, new RegExp(`artifacts\\.${artifact}`, 'u'))
  const publishedVersion = /const VERSION = "(\d+\.\d+\.\d+)";/u.exec(script)?.[1]
  assert.equal(typeof publishedVersion, 'string')
  for (const filename of [`e-Mate-${publishedVersion}-mac-universal.dmg`, `e-Mate-${publishedVersion}-win-x64-Setup.exe`]) {
    assert.match(script, new RegExp(filename.replaceAll('.', '\\.'), 'u'))
  }
  assert.match(script, /manifest\.source_commit/u)
  assert.match(script, /Number\.isSafeInteger\(artifact\.bytes\)/u)
  assert.match(script, /artifact\.build_source_commit/u)
  assert.match(script, /artifact\.build_run_id/u)
  assert.match(script, /\^\[0-9a-f\]\{64\}\$/u)
  assert.match(page, /未签名/u)
  assert.match(page, /e-Mate 会校验、替换并自动重开/u)
  assert.match(page, /\/ecorex-agent\/admin\//u)
  assert.match(macGuide, /全新安装 2\.0\.12/u)
  assert.match(macGuide, /已安装 2\.0\.11 的用户可在应用内确认更新/u)
  assert.match(macGuide, /\/usr\/bin\/arch -arm64 \/usr\/bin\/xattr -rd com\.apple\.quarantine/u)
  assert.match(macGuide, /\/usr\/bin\/arch -x86_64 \/usr\/bin\/xattr -rd com\.apple\.quarantine/u)
  assert.match(macGuide, /Password:.*输入时不会显示任何字符/u)
  assert.equal((macGuide.match(/data-copy-macos-command/gmu) ?? []).length, 2)
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
  const { normalizeDownloadIndex } = await import(`../deploy/download-page/${scriptName}`)
  const commit = 'a'.repeat(40)
  const releasePrefix = `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v${publishedVersion}/${commit}`
  const fixture = {
    schema_version: 1,
    version: publishedVersion,
    source_commit: commit,
    artifacts: {
      darwin: { url: `${releasePrefix}/e-Mate-${publishedVersion}-mac-universal.dmg`, bytes: 123, sha256: 'b'.repeat(64), build_source_commit: commit, build_run_id: '123' },
      win32: { url: `${releasePrefix}/e-Mate-${publishedVersion}-win-x64-Setup.exe`, bytes: 456, sha256: 'c'.repeat(64), build_source_commit: 'd'.repeat(40), build_run_id: '456' },
    },
  }
  assert.deepEqual(normalizeDownloadIndex(fixture).downloads.map(item => item.target), ['macos-universal', 'windows-x64'])
  assert.throws(() => normalizeDownloadIndex({
    ...fixture,
    artifacts: { ...fixture.artifacts, darwin: { ...fixture.artifacts.darwin, url: 'https://example.com/e-Mate.dmg' } },
  }), /桌面制品身份无效/u)
})
