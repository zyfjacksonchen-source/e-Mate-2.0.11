import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { generateEvidence, RELEASE_PACKAGES, verifyRelease, VERSION } from './release.mjs'
import { buildR2Inventory, matchesR2Head, normalizeProductionPublicOrigin, R2_BUCKET, R2_PREFIX } from './publish-r2.mjs'

const HARNESS_COMMIT = '47f943859bef60e4160492346772ded9b24f765a'
const DIGEST = '0'.repeat(64)
const R2_FIXTURE_PUBLIC_ORIGIN = 'https://downloads.e-mate.example'

async function file(root, relative, content = '') {
  const path = join(root, ...relative.split('/'))
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

function filename(name) {
  return `${name.slice(1).replace('/', '-')}-${VERSION}.tgz`
}

async function pack(directory, expected, mutate = manifest => manifest) {
  const stage = join(directory, `${expected.kind}-${expected.os ?? 'all'}-${expected.cpu ?? 'all'}`)
  const packageRoot = join(stage, 'package')
  const manifest = mutate({
    name: expected.name,
    version: VERSION,
    license: 'MIT',
    publishConfig: { access: 'public' },
    ...(expected.kind === 'main' ? {} : { os: [expected.os], cpu: [expected.cpu] }),
  })
  await file(packageRoot, 'package.json', `${JSON.stringify(manifest)}\n`)
  await file(packageRoot, 'LICENSE', 'MIT\n')
  await file(packageRoot, 'README.md', '# fixture\n')

  if (expected.kind === 'main') {
    manifest.dependencies ??= { yaml: '2.9.0' }
    manifest.optionalDependencies ??= Object.fromEntries(
      RELEASE_PACKAGES.filter(item => item.kind !== 'main').map(item => [item.name, VERSION]),
    )
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
  } else if (expected.kind === 'runtime') {
    await file(packageRoot, 'THIRD_PARTY_NOTICES.txt')
    await file(packageRoot, 'runtime/worker.py')
    for (const model of ['det', 'rec', 'cls']) await file(packageRoot, `runtime/${model}.onnx`, model)
    await file(packageRoot, 'emate-runtime.json', JSON.stringify({
      package: expected.name,
      version: VERSION,
      os: expected.os,
      cpu: expected.cpu,
      office: true,
      ocr: true,
      python_version: '3.11.15',
      source_commit: '564a6b6c1d43fb6831dd4a5cd8026e472f063311',
      worker: 'runtime/worker.py',
      payload_sha256: DIGEST,
      models: ['det', 'rec', 'cls'].map(name => ({ path: `runtime/${name}.onnx`, sha256: DIGEST })),
      distributions: [{ name: 'rapidocr-onnxruntime', version: '1.4.4', license: 'Apache-2.0' }],
    }))
  } else {
    await file(packageRoot, 'THIRD_PARTY_NOTICES.txt')
    await file(packageRoot, 'browser/chrome-headless-shell', 'browser')
    await file(packageRoot, 'emate-browser.json', JSON.stringify({
      package: expected.name,
      version: VERSION,
      os: expected.os,
      cpu: expected.cpu,
      chromium: true,
      engine: 'chromium-headless-shell',
      playwright_version: '1.61.1',
      browser_revision: '1228',
      browser_version: '149.0.7827.55',
      executable: 'browser/chrome-headless-shell',
      executable_sha256: DIGEST,
    }))
  }

  const archive = join(directory, filename(expected.name))
  execFileSync('tar', ['-czf', archive, '-C', stage, 'package'])
  return archive
}

async function fixture(mutateMain) {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-release-test-'))
  for (const expected of RELEASE_PACKAGES) {
    await pack(root, expected, expected.kind === 'main' && mutateMain !== undefined ? mutateMain : value => value)
  }
  return root
}

test('release evidence requires the exact seven packages and emits hashes plus SPDX', async () => {
  const root = await fixture()
  const output = join(root, 'evidence')
  try {
    const result = await generateEvidence(root, output)
    assert.equal(result.release.length, 7)
    assert.deepEqual(result.manifest.publish_order, RELEASE_PACKAGES.map(item => item.name))
    assert.equal(result.manifest.publish_order.at(-1), '@e-mate/dsh')
    assert.equal(readFileSync(join(output, 'SHA256SUMS'), 'utf8').trim().split('\n').length, 7)
    assert.match(readFileSync(join(output, 'EVIDENCE_SHA256SUMS'), 'utf8'), /e-mate-2\.0\.7\.spdx\.json/u)
    assert.equal(result.spdx.spdxVersion, 'SPDX-2.3')
    assert.ok(result.spdx.packages.some(item => item.name === '@deepseek-ai/dsh'))
    assert.ok(result.spdx.packages.some(item => item.name === 'rapidocr-onnxruntime'))
    const r2 = buildR2Inventory(root, output, result.manifest.source_commit, R2_FIXTURE_PUBLIC_ORIGIN)
    assert.equal(r2.bucket, R2_BUCKET)
    assert.equal(r2.public_origin, R2_FIXTURE_PUBLIC_ORIGIN)
    assert.equal(r2.prefix, R2_PREFIX)
    assert.equal(r2.objects.length, 12)
    assert.ok(r2.objects.every(item => item.key === `${R2_PREFIX}/${item.filename}` && item.url === `${R2_FIXTURE_PUBLIC_ORIGIN}/${item.key}`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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

test('production R2 download origin requires the bound custom domain', () => {
  assert.equal(normalizeProductionPublicOrigin('https://downloads.e-mate.example'), 'https://downloads.e-mate.example')
  assert.throws(
    () => normalizeProductionPublicOrigin('https://pub-0123456789abcdef0123456789abcdef.r2.dev'),
    /production Cloudflare R2 custom domain/u,
  )
  assert.throws(
    () => normalizeProductionPublicOrigin('https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com'),
    /production Cloudflare R2 custom domain/u,
  )
})

test('release verification rejects a workspace dependency in packed bytes', async () => {
  const root = await fixture(manifest => ({ ...manifest }))
  try {
    const main = RELEASE_PACKAGES.find(item => item.kind === 'main')
    await pack(root, main, manifest => ({ ...manifest, optionalDependencies: { '@e-mate/dsh-runtime-darwin-arm64': 'workspace:2.0.7' } }))
    assert.throws(() => verifyRelease(root), /six exact 2\.0\.7 platform packages/u)
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

test('GitHub workflows keep the target toolchain and the three supported platform lanes', () => {
  const requireFromDsh = createRequire(resolve('packages/dsh/package.json'))
  const { parse } = requireFromDsh('yaml')
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
  const release = parse(readFileSync('.github/workflows/release.yml', 'utf8'))
  assert.deepEqual(Object.keys(ci.jobs), ['source'])
  assert.deepEqual(
    release.jobs.platform.strategy.matrix.include.map(item => [item.platform, item.runner]),
    [['darwin-arm64', 'macos-15'], ['darwin-x64', 'macos-15-intel'], ['win32-x64', 'windows-2025']],
  )
  assert.deepEqual(Object.keys(release.jobs), ['platform', 'main', 'clean-install', 'evidence', 'publish', 'registry-install', 'r2'])
  assert.deepEqual(release.jobs.publish.needs, ['clean-install', 'evidence'])
  assert.match(release.jobs.publish.steps.at(-1).run, /release\.mjs publish --from dist\/npm/u)
  assert.equal(release.jobs.r2.needs, 'registry-install')
  const r2 = release.jobs.r2.steps.find(step => step.name === 'Publish immutable release bytes to Cloudflare R2')
  assert.match(r2.run, /publish-r2\.mjs/u)
  assert.equal(r2.env.EMATE_R2_PUBLIC_ORIGIN, '${{ vars.EMATE_R2_PUBLIC_ORIGIN }}')
})
