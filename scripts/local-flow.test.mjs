import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  COMPUTER_USE_SCENARIOS,
  assertCleanArtifactBytes,
  buildPublicationRequest,
  buildRollbackRequest,
  devChecks,
  selectCandidatePlatforms,
  validateCandidateSource,
  validatePublicationReceipt,
  validateRemoteHostname,
  verifyComputerUseReceipt,
  verifyLocalArtifact,
} from './local-flow.mjs'

const SHA = 'a'.repeat(40)
const MAC_SHA = 'b'.repeat(64)
const WIN_SHA = 'c'.repeat(64)
const MAC_BLOCKMAP_SHA = 'd'.repeat(64)
const WIN_BLOCKMAP_SHA = 'e'.repeat(64)

async function temporary() {
  return mkdtemp(join(tmpdir(), 'emate-local-flow-test-'))
}

function pe() {
  const bytes = Buffer.alloc(128)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(64, 0x3c)
  bytes.write('PE\0\0', 64, 'ascii')
  return bytes
}

function udif() {
  const bytes = Buffer.alloc(1024)
  bytes.write('koly', bytes.byteLength - 512, 'ascii')
  return bytes
}

async function artifactFixture(root, platform, { blockmap = false } = {}) {
  const name = platform === 'macos'
    ? 'e-Mate-2.0.15-mac-universal.dmg'
    : 'e-Mate-2.0.15-win-x64-Setup.exe'
  const bytes = platform === 'macos' ? udif() : pe()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, name), bytes)
  const files = [{ name, bytes: bytes.byteLength, sha256 }]
  if (blockmap) {
    const blockmapBytes = Buffer.from(`${platform}-blockmap`)
    await writeFile(join(root, `${name}.blockmap`), blockmapBytes)
    files.push({ name: `${name}.blockmap`, bytes: blockmapBytes.byteLength, sha256: createHash('sha256').update(blockmapBytes).digest('hex') })
  }
  await writeFile(join(root, 'local-artifact-receipt.json'), `${JSON.stringify({
    schema_version: 1,
    document_type: 'emate.local-desktop-artifact',
    platform,
    source_commit: SHA,
    version: '2.0.15',
    files,
  }, null, 2)}\n`)
  return { primary: { name, bytes: bytes.byteLength, sha256 }, files }
}

async function computerUseFixture(root, platform, artifactSha256) {
  const screenshotRoot = join(root, 'screenshots')
  await mkdir(screenshotRoot, { recursive: true })
  const screenshot = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  const sha256 = createHash('sha256').update(screenshot).digest('hex')
  if (platform === 'macos') await writeFile(join(screenshotRoot, `${platform}.png`), screenshot)
  const externalAcceptance = acceptance(platform, artifactSha256)
  const matrixFile = externalAcceptance.matrix_receipt.file
  const matrixBytes = Buffer.from(`${JSON.stringify({
    schema_version: 1,
    document_type: 'emate.external-installed-matrix-receipt',
    task: externalAcceptance.task,
    thread_id: externalAcceptance.thread_id,
    platform,
    scope: externalAcceptance.scope,
    status: externalAcceptance.status,
    host: externalAcceptance.host,
    tested_at: externalAcceptance.tested_at,
    installed_artifact_sha256: artifactSha256,
    coverage: externalAcceptance.coverage,
    computer_use: externalAcceptance.computer_use,
  })}\n`)
  await writeFile(join(root, matrixFile), matrixBytes)
  const receipt = {
    schema_version: 1,
    document_type: 'emate.local-computer-use-receipt',
    platform,
    status: 'passed',
    data_policy: 'synthetic-test-data-only',
    source_commit: SHA,
    artifact_sha256: artifactSha256,
    scenarios: platform === 'windows'
      ? [{ id: 'windows-native-runtime-unavailable', status: 'not_applicable', disposition: 'allowed_unavailable' }]
      : COMPUTER_USE_SCENARIOS[platform].map(id => ({ id, status: 'passed' })),
    screenshots: platform === 'macos' ? [{ file: `${platform}.png`, sha256 }] : [],
    external_acceptance: {
      ...externalAcceptance,
      matrix_receipt: { file: matrixFile, sha256: createHash('sha256').update(matrixBytes).digest('hex') },
    },
  }
  const path = join(root, 'result.json')
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`)
  return path
}

function acceptance(platform, artifactSha256) {
  const task = platform === 'macos' ? 'T18' : 'T22'
  return {
    task,
    thread_id: platform === 'macos' ? '01a0447b-214f-7050-a85f-76b50ecffc8a' : '01a00000-0000-7000-8000-000000000022',
    matrix: 'docs/2.0.15/REGRESSION-MATRIX.md',
    scope: 'full-installed-startup-update-product-and-built-in-tools',
    status: 'passed',
    host: platform === 'macos' ? 'T18-MAC' : 'DESKTOP-KH19ARC',
    tested_at: '2026-08-30T00:00:00.000Z',
    installed_artifact_sha256: artifactSha256,
    coverage: ['installation', 'startup', 'update', '2.0.15-fixes', 'built-in-tools', ...(platform === 'macos' ? ['computer-use'] : [])],
    computer_use: platform === 'macos'
      ? { status: 'passed', installed_artifact_sha256: artifactSha256 }
      : { status: 'not_applicable', disposition: 'allowed_unavailable', tested: false },
    matrix_receipt: { file: `${task.toLowerCase()}-full-matrix.json`, sha256: 'f'.repeat(64) },
  }
}

function verifiedRun() {
  const macPrimary = { name: 'e-Mate-2.0.15-mac-universal.dmg', bytes: 10, sha256: MAC_SHA }
  const winPrimary = { name: 'e-Mate-2.0.15-win-x64-Setup.exe', bytes: 20, sha256: WIN_SHA }
  return {
    version: '2.0.15',
    source_commit: SHA,
    verification: {
      status: 'passed',
      artifacts: {
        macos: { primary: macPrimary, files: [macPrimary, { name: `${macPrimary.name}.blockmap`, bytes: 11, sha256: MAC_BLOCKMAP_SHA }] },
        windows: { primary: winPrimary, files: [winPrimary, { name: `${winPrimary.name}.blockmap`, bytes: 21, sha256: WIN_BLOCKMAP_SHA }] },
      },
      computer_use: {
        macos: acceptance('macos', MAC_SHA),
        windows: acceptance('windows', WIN_SHA),
      },
    },
  }
}

test('candidate source accepts only one clean committed branch identity', () => {
  assert.deepEqual(validateCandidateSource({ branch: 'feat/local', head: SHA, status: '' }), {
    branch: 'feat/local', source_commit: SHA,
  })
  assert.throws(() => validateCandidateSource({ branch: 'feat/local', head: SHA, status: ' M package.json' }), /committed and clean/u)
  assert.throws(() => validateCandidateSource({ branch: 'feat/local', head: 'abc', status: '' }), /full lowercase commit/u)
  assert.throws(() => validateCandidateSource({ branch: 'HEAD', head: SHA, status: '' }), /named local branch/u)
})

test('candidate retries only the failed side and reuses an unchanged passed side', () => {
  const run = {
    source_commit: SHA,
    platforms: {
      macos: { status: 'passed', source_commit: SHA },
      windows: { status: 'failed', source_commit: SHA },
    },
  }
  assert.deepEqual(selectCandidatePlatforms(run), { build: ['windows'], reuse: ['macos'] })
  assert.deepEqual(selectCandidatePlatforms(run, 'windows'), { build: ['windows'], reuse: [] })
  run.platforms.macos.source_commit = 'd'.repeat(40)
  assert.deepEqual(selectCandidatePlatforms(run), { build: ['macos', 'windows'], reuse: [] })
})

test('dev reuses the local classifier plan and selects the smallest local-flow check', () => {
  assert.deepEqual(devChecks({ lane: 'base' }, [
    'package.json', 'scripts/local-flow.mjs', 'scripts/local-flow.test.mjs', 'docs/development-log.md',
  ]), [
    { command: 'node', args: ['--test', 'scripts/local-flow.test.mjs'] },
    { command: 'node', args: ['scripts/change-impact.mjs', '--check-contract'] },
  ])
  assert.deepEqual(devChecks({ lane: 'plugin-only', components: ['@e-mate/example'] }, ['packages/example/src/index.ts']), [
    { command: 'node', args: ['scripts/component-run.mjs', 'check', '--component', '@e-mate/example'] },
  ])
})

test('native Windows routing accepts only the Codex SSH host identity', () => {
  assert.equal(validateRemoteHostname('DESKTOP-KH19ARC\r\n'), 'DESKTOP-KH19ARC')
  assert.throws(() => validateRemoteHostname('win-codex'), /must be DESKTOP-KH19ARC/u)
})

test('Windows PowerShell uses relative tar paths and both transfers force legacy scp protocol', async () => {
  const source = await readFile(new URL('./local-flow.mjs', import.meta.url), 'utf8')
  assert.equal(source.match(/runLogged\('scp'/gu)?.length, 2)
  assert.equal(source.match(/runLogged\('scp', \['-O',/gu)?.length, 2)
  const start = source.indexOf('    const build = [', source.indexOf('async function windowsBuild'))
  const projection = source.slice(start, source.indexOf("    ].join(';')", start))
  assert.match(projection, /'Set-Location \$root'/u)
  assert.match(projection, /"tar\.exe -xzf 'source\.tgz' -C 'source'"/u)
  assert.match(projection, /--out '\.\.\\\\out'/u)
  assert.match(projection, /"tar\.exe -czf 'result\.tgz' -C 'out' \."/u)
  assert.doesNotMatch(projection, /remoteArchive|remoteResult|\$source|\$out/u)
  assert.doesNotMatch(projection, /tar\.exe[^\n]*[A-Za-z]:[\\/]/u)
})

test('direct-run guard canonicalizes a symlinked entry while imports stay inert', { skip: process.platform === 'win32' }, async () => {
  const root = await temporary()
  try {
    const script = fileURLToPath(new URL('./local-flow.mjs', import.meta.url))
    const entry = join(root, 'local-flow.mjs')
    await symlink(script, entry)
    const direct = spawnSync(process.execPath, [entry, 'not-a-command'], { encoding: 'utf8' })
    assert.equal(direct.status, 1)
    assert.match(direct.stderr, /flow command must be/u)
    const imported = spawnSync(process.execPath, [
      '--input-type=module', '--eval', `await import(${JSON.stringify(new URL('./local-flow.mjs', import.meta.url).href)})`,
    ], { encoding: 'utf8' })
    assert.equal(imported.status, 0)
    assert.equal(imported.stderr, '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local artifact receipts bind exact clean bytes and reject extra session or screenshot files', async () => {
  const root = await temporary()
  try {
    for (const platform of ['macos', 'windows']) {
      const directory = join(root, platform)
      const fixture = await artifactFixture(directory, platform, { blockmap: platform === 'macos' })
      const verified = await verifyLocalArtifact(directory, platform, SHA)
      assert.deepEqual(verified.primary, fixture.primary)
      assert.deepEqual(verified.receipt.files, fixture.files)
    }
    await writeFile(join(root, 'windows', 'session.json'), '{}\n')
    await assert.rejects(verifyLocalArtifact(join(root, 'windows'), 'windows', SHA), /unexpected file/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pollution gate rejects canaries, credentials, and developer absolute paths', () => {
  assert.doesNotThrow(() => assertCleanArtifactBytes(Buffer.from('ordinary packaged bytes'), 'fixture'))
  assert.throws(() => assertCleanArtifactBytes(Buffer.from('release-canary'), 'fixture'), /canary marker/u)
  assert.throws(() => assertCleanArtifactBytes(Buffer.from('/Users/alice/project/private.json'), 'fixture'), /developer path/u)
  assert.throws(() => assertCleanArtifactBytes(Buffer.from('-----BEGIN PRIVATE KEY-----'), 'fixture'), /private key/u)
  assert.throws(() => assertCleanArtifactBytes(Buffer.from(`sk-${'x'.repeat(24)}`), 'fixture'), /API secret/u)
})

test('verify requires macOS Computer Use but accepts explicit Windows CU non-applicability inside its full installed matrix', async () => {
  const root = await temporary()
  try {
    for (const [platform, artifactSha256] of [['macos', MAC_SHA], ['windows', WIN_SHA]]) {
      const path = await computerUseFixture(join(root, platform), platform, artifactSha256)
      const receipt = await verifyComputerUseReceipt(path, { platform, sourceCommit: SHA, artifactSha256 })
      assert.equal(receipt.status, 'passed')
      if (platform === 'windows') {
        assert.deepEqual(receipt.scenarios, [{
          id: 'windows-native-runtime-unavailable', status: 'not_applicable', disposition: 'allowed_unavailable',
        }])
        assert.equal(receipt.screenshots.length, 0)
      }
    }
    const bad = await computerUseFixture(join(root, 'bad'), 'windows', WIN_SHA)
    await assert.rejects(verifyComputerUseReceipt(bad, {
      platform: 'windows', sourceCommit: 'd'.repeat(40), artifactSha256: WIN_SHA,
    }), /invalid or incomplete/u)
    const blocked = JSON.parse(await readFile(bad, 'utf8'))
    blocked.status = 'blocked'
    blocked.external_acceptance = null
    await writeFile(bad, `${JSON.stringify(blocked)}\n`)
    await assert.rejects(verifyComputerUseReceipt(bad, {
      platform: 'windows', sourceCommit: SHA, artifactSha256: WIN_SHA,
    }), /BLOCKED and cannot satisfy verify/u)
    blocked.status = 'passed'
    blocked.scenarios[0].status = 'passed'
    await writeFile(bad, `${JSON.stringify(blocked)}\n`)
    await assert.rejects(verifyComputerUseReceipt(bad, {
      platform: 'windows', sourceCommit: SHA, artifactSha256: WIN_SHA,
    }), /invalid or incomplete/u)
    const incompleteWindows = await computerUseFixture(join(root, 'incomplete-windows'), 'windows', WIN_SHA)
    const incomplete = JSON.parse(await readFile(incompleteWindows, 'utf8'))
    incomplete.external_acceptance.coverage = incomplete.external_acceptance.coverage.filter(item => item !== 'update')
    await writeFile(incompleteWindows, `${JSON.stringify(incomplete)}\n`)
    await assert.rejects(verifyComputerUseReceipt(incompleteWindows, {
      platform: 'windows', sourceCommit: SHA, artifactSha256: WIN_SHA,
    }), /full installed acceptance/u)
    const mismatchedMatrixPath = await computerUseFixture(join(root, 'matrix-windows'), 'windows', WIN_SHA)
    const matrixBound = JSON.parse(await readFile(mismatchedMatrixPath, 'utf8'))
    const externalMatrixPath = join(root, 'matrix-windows', matrixBound.external_acceptance.matrix_receipt.file)
    const externalMatrix = JSON.parse(await readFile(externalMatrixPath, 'utf8'))
    externalMatrix.computer_use.tested = true
    const externalMatrixBytes = Buffer.from(`${JSON.stringify(externalMatrix)}\n`)
    await writeFile(externalMatrixPath, externalMatrixBytes)
    matrixBound.external_acceptance.matrix_receipt.sha256 = createHash('sha256').update(externalMatrixBytes).digest('hex')
    await writeFile(mismatchedMatrixPath, `${JSON.stringify(matrixBound)}\n`)
    await assert.rejects(verifyComputerUseReceipt(mismatchedMatrixPath, {
      platform: 'windows', sourceCommit: SHA, artifactSha256: WIN_SHA,
    }), /receipt content is invalid/u)
    const incompleteMac = await computerUseFixture(join(root, 'incomplete-mac'), 'macos', MAC_SHA)
    const macReceipt = JSON.parse(await readFile(incompleteMac, 'utf8'))
    macReceipt.external_acceptance.computer_use.status = 'not_applicable'
    await writeFile(incompleteMac, `${JSON.stringify(macReceipt)}\n`)
    await assert.rejects(verifyComputerUseReceipt(incompleteMac, {
      platform: 'macos', sourceCommit: SHA, artifactSha256: MAC_SHA,
    }), /full installed acceptance/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('publish keeps installers unsigned while reusing the existing schema-2 manifest signer and exact predecessor CAS', () => {
  const run = verifiedRun()
  const publish = buildPublicationRequest(run, { dryRun: true })
  assert.equal(publish.mode, 'dry-run')
  assert.equal(publish.macos_publication_mode, 'unsigned')
  assert.deepEqual(publish.installer_security, {
    darwin: { code_signed: false, notarized: false },
    win32: { code_signed: false, notarized: false },
  })
  assert.match(publish.authority, /existing-desktop-manifest-admission-signing-owner/u)
  assert.doesNotMatch(JSON.stringify(publish), /macos_signer_run_id|macos_signed_artifact_id/u)
  assert.deepEqual(publish.manifest_admission_and_signing.signed_manifest, {
    artifact_path: 'desktop-release-signed.json',
    schema_version: 2,
    document_type: 'emate.desktop-release-manifest',
    release_status: 'admitted',
    signing_context: 'e-mate-desktop-release-manifest-v2\0',
    signature: { algorithm: 'ed25519', key_source: 'existing-base-profile_signing_keys' },
    max_bytes: 16 * 1024,
  })
  assert.equal(publish.manifest_admission_and_signing.owner,
    'zyfjacksonchen-source/e-mate-desktop-publication@e45c3b9d1bec366ab306203574d0a7a724d7f123')
  assert.deepEqual(publish.immutable_objects.map(item => item.key), [
    `desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-mac-universal.dmg`,
    `desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-mac-universal.dmg.blockmap`,
    `desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-win-x64-Setup.exe`,
    `desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-win-x64-Setup.exe.blockmap`,
  ])
  assert.deepEqual(publish.publication_and_activation.manual_manifest.immutable_object_keys,
    publish.immutable_objects.map(item => item.key))
  assert.deepEqual(publish.publication_and_activation.pointers.signed.expected_current, {
    bytes: 2961, sha256: 'd26b9ffb5f30531bc5de6c9f66aab47c3718248e2ff109d82cd3a763f0c02887',
  })
  assert.deepEqual(publish.publication_and_activation.pointers.legacy.expected_current,
    publish.publication_and_activation.pointers.signed.expected_current)
  assert.equal(publish.publication_and_activation.pointers.legacy.execution_order, 'last')
  assert.deepEqual(publish.delete_objects, [])
  const rollback = buildRollbackRequest(run, undefined, { dryRun: true })
  assert.equal(rollback.mode, 'dry-run')
  assert.deepEqual(rollback.immutable_objects.map(item => item.action), ['retain', 'retain', 'retain', 'retain', 'retain'])
  assert.equal(rollback.immutable_objects.at(-1).key, 'desktop/manual/v2.0.15/latest.json')
  assert.deepEqual(rollback.delete_objects, [])
  assert.throws(() => buildRollbackRequest(run), /publication receipt/u)
  const noWindowsMatrix = structuredClone(run)
  delete noWindowsMatrix.verification.computer_use.windows
  assert.throws(() => buildPublicationRequest(noWindowsMatrix), /both external installed acceptance receipts/u)
})

test('publication receipt requires existing-owner manifest admission/signature and identical manual/signed/legacy bytes', () => {
  const run = verifiedRun()
  const requestSha256 = '1'.repeat(64)
  const request = buildPublicationRequest(run, { dryRun: true })
  const manual = {
    key: 'desktop/manual/v2.0.15/latest.json', bytes: 2961, sha256: '2'.repeat(64),
    write: 'created', authenticated_readback: 'passed', public_readback: 'passed',
  }
  const receipt = {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-receipt',
    operation: 'publish',
    status: 'passed',
    macos_publication_mode: 'unsigned',
    installer_security: {
      darwin: { code_signed: false, notarized: false },
      win32: { code_signed: false, notarized: false },
    },
    version: '2.0.15',
    source_commit: SHA,
    request_sha256: requestSha256,
    manifest_admission: {
      owner: 'zyfjacksonchen-source/e-mate-desktop-publication@e45c3b9d1bec366ab306203574d0a7a724d7f123',
      status: 'passed',
      macos_publication_mode: 'unsigned',
      schema_version: 2,
      document_type: 'emate.desktop-release-manifest',
      release_status: 'admitted',
      signing_context: 'e-mate-desktop-release-manifest-v2\0',
      signature: {
        algorithm: 'ed25519', key_id: 'desktop-release-key',
        key_source: 'existing-base-profile_signing_keys', verification: 'passed',
      },
      signed_manifest: { file: 'desktop-release-signed.json', bytes: manual.bytes, sha256: manual.sha256 },
      publication_plan: { file: 'cloudflare-publication-plan.json', sha256: '4'.repeat(64), status: 'ready-for-cloudflare-plugin' },
      admission_receipt: { file: 'cloudflare-plugin-handoff.json', sha256: '5'.repeat(64), status: 'ready-for-cloudflare-plugin' },
    },
    immutable_objects: request.immutable_objects.map(object => ({
      key: object.key, bytes: object.bytes, sha256: object.sha256,
      write: 'created', authenticated_readback: 'passed', public_readback: 'passed',
    })),
    manual_manifest: manual,
    pointers: {
      signed: { key: 'desktop/signed/latest.json', before: { bytes: 2961, sha256: 'd26b9ffb5f30531bc5de6c9f66aab47c3718248e2ff109d82cd3a763f0c02887' }, after: { bytes: manual.bytes, sha256: manual.sha256 }, cas: 'passed', public_readback: 'passed' },
      legacy: { key: 'desktop/latest.json', before: { bytes: 2961, sha256: 'd26b9ffb5f30531bc5de6c9f66aab47c3718248e2ff109d82cd3a763f0c02887' }, after: { bytes: manual.bytes, sha256: manual.sha256 }, cas: 'passed', public_readback: 'passed' },
    },
    deleted_objects: [],
  }
  assert.equal(validatePublicationReceipt(receipt, run, requestSha256), receipt)
  assert.throws(() => validatePublicationReceipt({ ...receipt, immutable_objects: receipt.immutable_objects.slice(1) }, run, requestSha256), /object receipt set/u)
  assert.throws(() => validatePublicationReceipt({ ...receipt, manual_manifest: { ...manual, public_readback: 'failed' } }, run, requestSha256), /manual manifest receipt/u)
  assert.throws(() => validatePublicationReceipt({
    ...receipt,
    manifest_admission: {
      ...receipt.manifest_admission,
      signature: { ...receipt.manifest_admission.signature, verification: 'failed' },
    },
  }, run, requestSha256), /admission\/signature receipt/u)
  assert.throws(() => validatePublicationReceipt({
    ...receipt,
    manifest_admission: { ...receipt.manifest_admission, schema_version: 4 },
  }, run, requestSha256), /admission\/signature receipt/u)
  assert.throws(() => validatePublicationReceipt({
    ...receipt,
    manifest_admission: { ...receipt.manifest_admission, signing_context: 'e-mate-desktop-release-manifest-v3\0' },
  }, run, requestSha256), /admission\/signature receipt/u)
  assert.throws(() => validatePublicationReceipt({
    ...receipt,
    installer_security: {
      ...receipt.installer_security,
      darwin: { code_signed: true, notarized: false },
    },
  }, run, requestSha256), /publication owner receipt/u)
  assert.throws(() => validatePublicationReceipt({
    ...receipt,
    pointers: {
      ...receipt.pointers,
      signed: { ...receipt.pointers.signed, before: { bytes: 2961, sha256: '3'.repeat(64) } },
    },
  }, run, requestSha256), /signed pointer receipt/u)
  assert.throws(() => validatePublicationReceipt({
    ...receipt,
    pointers: { ...receipt.pointers, legacy: { ...receipt.pointers.legacy, public_readback: 'failed' } },
  }, run, requestSha256), /legacy pointer receipt/u)
})

test('desktop builds start Corepack inside the pinned Yarn project on macOS and Windows', async () => {
  const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const desktopPackage = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'))
  const source = await readFile(new URL('./local-flow.mjs', import.meta.url), 'utf8')
  assert.equal(rootPackage.packageManager, 'pnpm@11.7.0')
  assert.equal(desktopPackage.packageManager, 'yarn@4.18.0')
  assert.equal([...source.matchAll(/await runLogged\(process\.platform === 'win32' \? 'corepack\.cmd' : 'corepack', \['yarn'/gu)].length, 2)
  assert.match(source, /\['yarn', 'install', '--immutable'\], \{ cwd: join\(sourceRoot, 'desktop'\), log \}/u)
  assert.match(source, /\['yarn', PLATFORMS\[platform\]\.build\], \{ cwd: join\(sourceRoot, 'desktop'\), log \}/u)
  assert.doesNotMatch(source, /\['yarn', '--cwd', 'desktop'/u)
})

test('platform build skips Harness dev hooks in clean submodule copies', async () => {
  const root = await temporary()
  try {
    const common = join(root, '.git', 'modules', 'upstream', 'deepseek-harness')
    const config = join(common, 'config')
    await mkdir(common, { recursive: true })
    const configured = spawnSync('git', [
      'config', '--file', config, 'core.worktree', '../../../../upstream/deepseek-harness',
    ], { encoding: 'utf8' })
    assert.equal(configured.status, 0, configured.stderr)
    const worktree = spawnSync('git', ['config', '--file', config, '--get', 'core.worktree'], { encoding: 'utf8' })
    assert.equal(worktree.stdout.trim(), '../../../../upstream/deepseek-harness')

    const source = await readFile(new URL('./local-flow.mjs', import.meta.url), 'utf8')
    const start = source.indexOf('async function platformBuild')
    const projection = source.slice(start, source.indexOf('\n}\n\nfunction encodedPowerShell', start))
    assert.match(projection, /runPnpm\(\['--dir', 'upstream\/deepseek-harness', 'install', '--frozen-lockfile'\], \{ cwd: sourceRoot, log, env: \{ \.\.\.process\.env, CI: 'true' \} \}\)/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('root package exposes one flow entry and the implementation has no GitHub, Wrangler, or win-codex path', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const source = await readFile(new URL('./local-flow.mjs', import.meta.url), 'utf8')
  const publicationWorkflow = await readFile(new URL('../.github/workflows/desktop-publication.yml', import.meta.url), 'utf8')
  const updater = await readFile(new URL('../desktop/e-mate-desktop/src/update-checker.ts', import.meta.url), 'utf8')
  assert.equal(packageJson.scripts.flow, 'node scripts/local-flow.mjs')
  assert.doesNotMatch(source, /\bgh\b|\.github\/|\bwrangler\b|win-codex|\bUU\b/u)
  assert.match(source, /'kh19arc'/u)
  assert.match(publicationWorkflow, /uses: zyfjacksonchen-source\/e-mate-desktop-publication@e45c3b9d1bec366ab306203574d0a7a724d7f123/u)
  assert.match(updater, /2: Buffer\.from\('e-mate-desktop-release-manifest-v2\\0', 'utf8'\)/u)
})
