import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertEvidenceSource, BUNDLED_PLUGIN_PACKAGES, generateEvidence, isAcceptedReleaseCommit, RELEASE_PACKAGES, TARGET_NATIVE_RUNTIME_FILES, verifyRelease, VERSION } from './release.mjs'
import {
  buildR2Inventory,
  normalizeProductionPublicOrigin,
  R2_BUCKET,
  R2_PUBLIC_ORIGIN,
  writeR2PublicationPlan,
} from './publish-r2.mjs'
import { releasePrefix, releaseSource } from './release-source.mjs'
import { renderDownloadPage } from './render-download-page.mjs'
import { prepareHarnessBaseImports } from './component-base-imports.mjs'
import { stageDesktopProfileArtifact } from './stage-desktop-profile-artifact.mjs'
import {
  admitDesktopReleaseManifest,
  createDesktopArtifactCandidate,
} from '../desktop/e-mate-desktop/scripts/desktop-release-manifest.ts'
import {
  DESKTOP_VERSION_ENDPOINT,
  checkForStableUpdate,
  validateAdmittedDesktopReleaseManifest,
  validateDesktopReleaseArtifact,
  validateUnsignedAdmittedDesktopReleaseManifest,
} from '../desktop/e-mate-desktop/src/update-checker.ts'

const HARNESS_COMMIT = 'b2b1650b01f0ee88d81837a9b5c050f9f763f606'
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
    const plan = await writeR2PublicationPlan(root, output, join(root, 'r2-publication-plan.json'), SOURCE_COMMIT)
    assert.equal(plan.publication_authority, 'codex-cloudflare-plugin')
    assert.equal(plan.objects.length, 6)
    assert.ok(plan.objects.every(item => !('path' in item) && /^(?:npm|release)\/[^/]+$/u.test(item.artifact_path)))
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

test('component builds verify emitted imports before accepting their tests', () => {
  const runner = readFileSync('scripts/component-run.mjs', 'utf8')
  assert.match(runner, /'run', 'build'[\s\S]*?verifyComponentRuntimeImports\(entries, component, target\)[\s\S]*?'run', 'test'/u)
})

test('component tests resolve declared DSH imports only from the exact pinned Base packages', async () => {
  const root = mkdtempSync(join(tmpdir(), 'emate-component-base-imports-'))
  const componentRoot = join(root, 'component')
  const harnessRoot = join(root, 'harness')
  const source = join(harnessRoot, 'packages', 'skill')
  try {
    await file(source, 'package.json', JSON.stringify({
      name: '@deepseek-ai/dsh-skill', version: '0.1.0-rc.7', type: 'module', exports: './index.js',
    }))
    await file(source, 'index.js', "export const pinnedVersion = '0.1.0-rc.7'\n")
    await file(componentRoot, 'package.json', JSON.stringify({ type: 'module' }))
    await file(componentRoot, 'lib/index.js', "export { pinnedVersion } from '@deepseek-ai/dsh-skill'\n")
    prepareHarnessBaseImports({
      componentRoot,
      harnessRoot,
      baseImports: ['@deepseek-ai/dsh-skill', 'react'],
      runtimeImports: { '@deepseek-ai/dsh-skill': '0.1.0-rc.7', react: '18.3.1' },
    })
    const linked = join(componentRoot, 'node_modules', '@deepseek-ai', 'dsh-skill')
    assert.equal(lstatSync(linked).isSymbolicLink(), true)
    assert.equal(JSON.parse(readFileSync(join(linked, 'package.json'), 'utf8')).version, '0.1.0-rc.7')
    assert.equal((await import(pathToFileURL(join(componentRoot, 'lib/index.js')).href)).pinnedVersion, '0.1.0-rc.7')
    assert.throws(() => prepareHarnessBaseImports({
      componentRoot: join(root, 'mismatch'),
      harnessRoot,
      baseImports: ['@deepseek-ai/dsh-skill'],
      runtimeImports: { '@deepseek-ai/dsh-skill': '0.1.0-rc.6' },
    }), /must equal 0\.1\.0-rc\.6/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('desktop profile artifacts contain built bytes without development links', async () => {
  const root = mkdtempSync(join(tmpdir(), 'emate-profile-artifact-'))
  try {
    const packagesRoot = join(root, 'packages')
    const destination = join(root, 'artifact')
    await file(packagesRoot, 'dsh/profile/cordis.patch.yml', '[]\n')
    await file(packagesRoot, 'dsh/profile/component-inventory.json', JSON.stringify({
      schema_version: 1,
      components: [{
        id: '@e-mate/dsh-plugin-example',
        root: 'packages/dsh-plugin-example',
        desktop: 'hot-profile',
      }, {
        id: '@e-mate/dsh-plugin-retired',
        root: 'packages/dsh-plugin-retired',
        desktop: 'blocked',
      }],
    }))
    await file(packagesRoot, 'dsh/profile/plugins/emate-shell/lib/client.js', 'export {}\n')
    await file(packagesRoot, 'dsh-plugin-example/lib/index.js', 'export {}\n')
    await file(packagesRoot, 'dsh-plugin-example/lib/node_modules/hidden.js', 'throw new Error()\n')
    await file(packagesRoot, 'dsh-plugin-retired/lib/index.js', 'throw new Error()\n')
    const dependencyRoot = join(root, 'dependency-root')
    await mkdir(dependencyRoot, { recursive: true })
    await symlink(dependencyRoot, join(packagesRoot, 'dsh/profile/plugins/emate-shell/node_modules'), 'dir')

    const receipt = await stageDesktopProfileArtifact({ packagesRoot, destination })
    assert.equal(receipt.componentCount, 1)
    assert.ok(existsSync(join(destination, 'dsh/profile/cordis.patch.yml')))
    assert.ok(existsSync(join(destination, 'dsh-plugin-example/lib/index.js')))
    assert.ok(!existsSync(join(destination, 'dsh/profile/plugins/emate-shell/node_modules')))
    assert.ok(!existsSync(join(destination, 'dsh-plugin-example/lib/node_modules')))
    assert.ok(!existsSync(join(destination, 'dsh-plugin-retired')))
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
  assert.equal(ci.jobs.source.steps.find(step => step.name === 'Build pinned DeepSeek Harness').run, 'pnpm build:harness')
  assert.equal(release.jobs.pack.steps.find(step => step.name === 'Build pinned DeepSeek Harness').run, 'pnpm build:harness')
  assert.deepEqual(ci.jobs['base-platform-components'].needs, ['impact', 'source'])
  assert.deepEqual(ci.jobs['desktop-windows'].needs, ['impact', 'source'])
  assert.deepEqual(ci.jobs['desktop-macos'].needs, ['impact', 'source'])
  for (const [workflow, producer, consumers] of [
    [ci, 'source', ['desktop-windows', 'desktop-macos']],
    [desktopRelease, 'profile', ['windows', 'macos']],
  ]) {
    const stage = workflow.jobs[producer].steps.find(step => step.name === 'Stage the exact built e-Mate profile without development links')
    assert.equal(stage.run, 'node scripts/stage-desktop-profile-artifact.mjs')
    const artifact = workflow.jobs[producer].steps.find(step => step.uses === 'actions/upload-artifact@v4'
      && step.with.name.startsWith('e-mate-desktop-profile-'))
    assert.match(artifact.with.path, /\.release-cache\/profile-artifact\/dsh\/profile/u)
    assert.match(artifact.with.path, /\.release-cache\/profile-artifact\/dsh-plugin-\*\/lib/u)
    assert.doesNotMatch(artifact.with.path, /^\s*packages\/dsh\/profile$/mu)
    assert.doesNotMatch(artifact.with.path, /browser-extension/u)
    for (const consumer of consumers) {
      const job = workflow.jobs[consumer]
      assert.ok(job.needs === producer || Array.isArray(job.needs) && job.needs.includes(producer))
      assert.equal(job.steps.find(step => step.uses === 'actions/download-artifact@v4').with.path, 'packages')
      const base = job.steps.find(step => step.uses === 'actions/download-artifact@v4'
        && String(step.with.name).includes('e-mate-base-sdk-'))
      assert.equal(base.with.path, '.release-cache/base-sdk')
      assert.equal(
        job.steps.find(step => step.name === 'Install and verify the exact Base SDK').run,
        'node scripts/base-sdk.mjs install --directory .release-cache/base-sdk',
      )
    }
  }
  const desktopBaseBuild = desktopRelease.jobs.profile.steps.find(step => String(step.run).includes('pnpm build:harness')).run
  assert.match(desktopBaseBuild, /yarn build:sdk/u)
  assert.match(desktopBaseBuild, /base-sdk\.mjs emit/u)
  assert.deepEqual(
    release.jobs['clean-install'].strategy.matrix.include.map(item => [item.platform, item.runner]),
    [['darwin-arm64', 'macos-15'], ['darwin-x64', 'macos-15-intel'], ['win32-x64', 'windows-2025']],
  )
  assert.deepEqual(Object.keys(release.jobs), ['pack', 'clean-install', 'evidence'])
  assert.equal(release.jobs['clean-install'].needs, 'pack')
  assert.equal(release.jobs.evidence.needs, 'pack')
  assert.match(release.jobs.evidence.steps.find(step => step.name === 'Render the immutable candidate download page').run, /render-download-page\.mjs/u)
  const cleanInstall = release.jobs['clean-install'].steps.find(step => step.name === 'Install tarballs with npm and run setup checks')
  assert.equal((cleanInstall.run.match(/node "\$cli" setup$/gmu) ?? []).length, 2)
  assert.ok(cleanInstall.run.includes('version="$(node -p "require(process.argv[1]).version" "$npm_root/@e-mate/dsh/package.json")"'))
  assert.doesNotMatch(cleanInstall.run, /require\('\$npm_root/u)
  assert.match(readFileSync('scripts/build-harness-runtime.mjs', 'utf8'), /'--os=darwin', '--os=win32', '--cpu=arm64', '--cpu=x64'/u)
  assert.equal(release.on.push, undefined)
  assert.equal(release.on.pull_request, undefined)
  const plan = release.jobs.evidence.steps.find(step => step.name === 'Emit the Cloudflare plugin publication plan')
  assert.match(plan.run, /publish-r2\.mjs/u)
  assert.match(plan.run, /--commit "\$GITHUB_SHA"/u)
  const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8')
  assert.doesNotMatch(releaseWorkflow, /secrets\.|AWS_|ECOREX_R2_|r2-publish|aws |s3api|cloudflarestorage/u)
  const r2PlanSource = readFileSync('scripts/publish-r2.mjs', 'utf8')
  assert.match(r2PlanSource, /publication_authority: 'codex-cloudflare-plugin'/u)
  assert.doesNotMatch(r2PlanSource, /spawn\(|fetch\(|put-object|head-object|AWS_|ECOREX_R2_|cloudflarestorage/u)
  assert.doesNotMatch(readFileSync('.github/workflows/release.yml', 'utf8'), /npm view '@e-mate\/dsh@2\.0\.8'|release\.mjs publish/u)
  const desktopReleaseSource = readFileSync('.github/workflows/desktop-release.yml', 'utf8')
  const desktopManifestSource = readFileSync('desktop/e-mate-desktop/scripts/desktop-release-manifest.ts', 'utf8')
  assert.equal(desktopRelease.jobs.r2, undefined)
  assert.equal(desktopRelease.on.workflow_dispatch.inputs.publish, undefined)
  assert.equal(desktopRelease.on.workflow_dispatch.inputs.release_run_id, undefined)
  assert.equal(desktopRelease.on.workflow_dispatch.inputs.reuse_run_id.default, '')
  assert.match(desktopRelease.jobs.reuse.steps[0].run, /Build and verify the e-Mate profile/u)
  assert.match(desktopRelease.jobs.reuse.steps[0].run, /Build unsigned Windows x64 installer/u)
  assert.match(desktopRelease.jobs.reuse.steps[0].run, /test "\$source_sha" = "\$GITHUB_SHA"/u)
  assert.match(desktopRelease.jobs.macos.if, /needs\.reuse\.result == 'success'/u)
  assert.equal(desktopRelease.jobs.macos.steps.find(step => step.uses === 'actions/download-artifact@v4').with['run-id'], "${{ inputs.reuse_run_id != '' && inputs.reuse_run_id || github.run_id }}")
  assert.equal(desktopRelease.jobs.manifest.steps.find(step => step.uses === 'actions/download-artifact@v4').with['run-id'], "${{ inputs.reuse_run_id != '' && inputs.reuse_run_id || github.run_id }}")
  const candidateStep = desktopRelease.jobs.manifest.steps.find(step => step.name === 'Generate performance-pending Desktop artifact candidate')
  assert.match(candidateStep.run, /desktop-release-manifest\.ts candidate/u)
  assert.match(candidateStep.run, /--mac-commit/u)
  assert.match(candidateStep.run, /--win-run/u)
  assert.match(candidateStep.run, /--out dist\/desktop\/desktop-candidate\.json/u)
  assert.doesNotMatch(candidateStep.run, /latest\.json/u)
  assert.match(desktopManifestSource, /readFileSync\(new URL\('\.\.\/package\.json'/u)
  assert.match(desktopManifestSource, /loadProfileBaseContract/u)
  assert.match(desktopManifestSource, /schedule_protocol_floor/u)
  assert.match(desktopManifestSource, /validateUnsignedAdmittedDesktopReleaseManifest/u)
  assert.match(desktopManifestSource, /desktop-release-manifest/u)
  assert.match(desktopManifestSource, /profile_component_aggregate/u)
  assert.match(desktopManifestSource, /github_artifact_provenance/u)
  assert.doesNotMatch(desktopManifestSource, /const VERSION = '\d+\.\d+\.\d+'/u)
  for (const job of ['windows', 'macos', 'manifest']) {
    const step = desktopRelease.jobs[job].steps.find(item => item.id === 'version')
    assert.match(step.run, /node -p "require\(process\.argv\[1\]\)\.version"/u)
    assert.doesNotMatch(step.run, /node -p \\"require/u)
  }
  assert.doesNotMatch(desktopReleaseSource, /e-Mate-\d+\.\d+\.\d+-(?:mac|win)|releases\/v\d+\.\d+\.\d+/u)
  assert.doesNotMatch(desktopReleaseSource, /AWS_|ECOREX_R2_|r2-publish|aws |s3api|cloudflarestorage/u)
  assert.match(readFileSync('.gitattributes', 'utf8'), /^\* text=auto eol=lf$/mu)
})

test('one admitted producer feeds the updater, legacy 2.0.12, and download page', async t => {
  const page = renderDownloadPage(readFileSync('deploy/download-page/index.html', 'utf8'))
  const macGuide = readFileSync('deploy/download-page/install-macos.html', 'utf8')
  const scriptName = 'site.a8feef4609f9.js'
  const script = readFileSync(`deploy/download-page/${scriptName}`, 'utf8')
  assert.equal(scriptName.split('.')[1], createHash('sha256').update(script).digest('hex').slice(0, 12))
  for (const platform of ['macos', 'windows']) assert.match(page, new RegExp(`data-platform="${platform}"`, 'u'))
  for (const artifact of ['darwin', 'win32']) assert.match(script, new RegExp(`artifacts\\.${artifact}`, 'u'))
  const publishedVersion = /const VERSION = "(\d+\.\d+\.\d+)";/u.exec(script)?.[1]
  assert.equal(typeof publishedVersion, 'string')
  const baseContract = JSON.parse(readFileSync('desktop/e-mate-desktop/base-contract.json', 'utf8'))
  assert.equal(baseContract.profile_signing_keys.length, 1)
  assert.match(script, new RegExp(baseContract.profile_signing_keys[0].id, 'u'))
  assert.match(script, new RegExp(baseContract.profile_signing_keys[0].public_key_spki_der_base64.replaceAll('+', '\\+'), 'u'))
  const manifestUrl = `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/manual/v${publishedVersion}/latest.json`
  assert.match(script, /desktop\/manual\/v\$\{VERSION\}\/latest\.json/u)
  assert.equal(DESKTOP_VERSION_ENDPOINT, 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/signed/latest.json')
  assert.notEqual(DESKTOP_VERSION_ENDPOINT, 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/latest.json')
  for (const filename of [`e-Mate-${publishedVersion}-mac-universal.dmg`, `e-Mate-${publishedVersion}-win-x64-Setup.exe`]) {
    assert.match(script, new RegExp(filename.replaceAll('.', '\\.'), 'u'))
  }
  assert.match(script, /manifest\.source_commit/u)
  assert.match(script, /manifest\.base_contract_id/u)
  assert.match(script, /manifest\.schedule_protocol_floor/u)
  assert.match(script, /Number\.isSafeInteger\(artifact\.bytes\)/u)
  assert.match(script, /artifact\.build_source_commit/u)
  assert.match(script, /artifact\.build_run_id/u)
  assert.match(script, /validateManifestSignatureShape/u)
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
  const { normalizeDownloadIndex, verifyDownloadIndex } = await import(`../deploy/download-page/${scriptName}`)
  const root = mkdtempSync(join(tmpdir(), 'e-mate-public-manifest-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const commit = 'a'.repeat(40)
  const macArtifact = join(root, `e-Mate-${publishedVersion}-mac-universal.dmg`)
  const windowsArtifact = join(root, `e-Mate-${publishedVersion}-win-x64-Setup.exe`)
  await writeFile(macArtifact, 'mac')
  await writeFile(windowsArtifact, 'win')
  const candidate = join(root, 'desktop-candidate.json')
  await createDesktopArtifactCandidate({
    macArtifact,
    windowsArtifact,
    sourceCommit: commit,
    macSourceCommit: commit,
    windowsSourceCommit: commit,
    macBuildRunId: '123',
    windowsBuildRunId: '456',
    output: candidate,
  })
  const profileComponentAggregate = join(root, 'profile-component-aggregate.json')
  const performance = join(root, 'performance.json')
  const githubArtifactProvenance = join(root, 'github-artifact-provenance.json')
  await writeFile(profileComponentAggregate, JSON.stringify({
    aggregate_sha256: '1'.repeat(64),
    inventory_sha256: '2'.repeat(64),
    staged_profile_tree_sha256: '3'.repeat(64),
    targets: ['darwin-arm64', 'darwin-x64', 'win32-x64'].map(target => ({
      target,
      profile_generation: '5'.repeat(64),
      component_aggregate_sha256: '6'.repeat(64),
    })),
  }))
  await writeFile(performance, JSON.stringify({
    performance_run_id: 'performance-run-id',
    admission_sha256: '4'.repeat(64),
    signature_key_id: '0123456789abcdef',
    verifier: {},
  }))
  await writeFile(githubArtifactProvenance, JSON.stringify({
    schema_version: 1,
    document_type: 'emate.github-artifact-provenance',
    source_commit: commit,
    artifacts: [
      { role: 'desktop_candidate', name: `e-mate-desktop-release-${commit}`, artifact_id: '11', digest: `sha256:${'7'.repeat(64)}`, run_id: '123', run_attempt: 1 },
      { role: 'performance_admission', name: `e-mate-performance-admission-${commit}`, artifact_id: '12', digest: `sha256:${'8'.repeat(64)}`, run_id: '124', run_attempt: 1 },
    ],
  }))
  const output = join(root, 'latest.json')
  await admitDesktopReleaseManifest({
    candidate,
    profileComponentAggregate,
    performance,
    githubArtifactProvenance,
    output,
  })
  const manifest = JSON.parse(readFileSync(output, 'utf8'))
  assert.equal(Object.keys(manifest).length, 11)
  assert.equal(validateUnsignedAdmittedDesktopReleaseManifest(manifest), true)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const trustedKeys = [{
    id: 'e0a81164526dcbcd',
    algorithm: 'ed25519',
    public_key_spki_der_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }]
  const canonical = value => Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
      : JSON.stringify(value)
  const signedManifest = {
    ...manifest,
    signature: {
      algorithm: 'ed25519',
      key_id: trustedKeys[0].id,
      value: sign(null, Buffer.concat([
        Buffer.from('e-mate-desktop-release-manifest-v1\0', 'utf8'),
        Buffer.from(canonical(manifest), 'utf8'),
      ]), privateKey).toString('base64'),
    },
  }
  assert.equal(Object.keys(signedManifest).length, 12)
  assert.equal(validateAdmittedDesktopReleaseManifest(signedManifest, trustedKeys), true)
  await assert.doesNotReject(() => verifyDownloadIndex(signedManifest, {
    id: trustedKeys[0].id,
    spki: trustedKeys[0].public_key_spki_der_base64,
  }))
  const normalized = normalizeDownloadIndex(signedManifest)
  assert.equal(normalized.base_contract_id, manifest.base_contract_id)
  assert.equal(normalized.schedule_protocol_floor, 1)
  assert.deepEqual(normalized.downloads.map(item => item.target), ['macos-universal', 'windows-x64'])
  // Frozen 2.0.12@9fbc70ad parses only version/artifacts and therefore ignores the admitted fields.
  const legacy2012 = value => value && typeof value === 'object'
    && typeof value.version === 'string' && /^\d+\.\d+\.\d+$/u.test(value.version)
    && value.artifacts && typeof value.artifacts === 'object'
    && ['darwin', 'win32'].every(platform => validateDesktopReleaseArtifact(
      platform, value.version, value.artifacts[platform],
    ) !== null)
  assert.equal(legacy2012(signedManifest), true)
  const richFutureManifest = structuredClone(signedManifest)
  richFutureManifest.version = '9.9.9'
  for (const platform of ['darwin', 'win32']) {
    richFutureManifest.artifacts[platform].url = richFutureManifest.artifacts[platform].url.replaceAll(
      `v${publishedVersion}`, 'v9.9.9',
    ).replaceAll(`e-Mate-${publishedVersion}-`, 'e-Mate-9.9.9-')
  }
  assert.equal(legacy2012(richFutureManifest), true)
  assert.equal(validateAdmittedDesktopReleaseManifest(richFutureManifest, trustedKeys), false)
  assert.equal(await checkForStableUpdate({
    currentVersion: '2.0.11',
    currentScheduleProtocolFloor: 1,
    platform: 'darwin',
    trustedManifestKeys: trustedKeys,
    request: async url => {
      assert.equal(url, DESKTOP_VERSION_ENDPOINT)
      return Response.json(signedManifest)
    },
  }).then(result => result?.status), 'update-available')
  const oldSixField = {
    schema_version: manifest.schema_version,
    version: manifest.version,
    source_commit: manifest.source_commit,
    base_contract_id: manifest.base_contract_id,
    schedule_protocol_floor: manifest.schedule_protocol_floor,
    artifacts: manifest.artifacts,
  }
  assert.equal(validateUnsignedAdmittedDesktopReleaseManifest(oldSixField), false)
  assert.equal(validateAdmittedDesktopReleaseManifest(oldSixField, trustedKeys), false)
  assert.throws(() => normalizeDownloadIndex(oldSixField), /桌面发布清单 字段无效/u)
  const missingFloor = { ...signedManifest }
  delete missingFloor.schedule_protocol_floor
  assert.throws(() => normalizeDownloadIndex(missingFloor), /桌面发布清单 字段无效/u)
  assert.throws(() => normalizeDownloadIndex({ ...signedManifest, schedule_protocol_floor: 0 }), /桌面发布清单身份无效/u)
  assert.throws(() => normalizeDownloadIndex({
    ...signedManifest,
    artifacts: { ...signedManifest.artifacts, darwin: { ...signedManifest.artifacts.darwin, url: 'https://example.com/e-Mate.dmg' } },
  }), /桌面制品身份无效/u)
  const signatureDrift = structuredClone(signedManifest)
  signatureDrift.signature.value = `${signatureDrift.signature.value[0] === 'A' ? 'B' : 'A'}${signatureDrift.signature.value.slice(1)}`
  assert.equal(validateAdmittedDesktopReleaseManifest(signatureDrift, trustedKeys), false)
  await assert.rejects(() => verifyDownloadIndex(signatureDrift, {
    id: trustedKeys[0].id,
    spki: trustedKeys[0].public_key_spki_der_base64,
  }), /签名验证失败/u)
  assert.equal(manifestUrl.endsWith(`/desktop/manual/v${publishedVersion}/latest.json`), true)
})
