import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import test from 'node:test'
import {
  canonicalProfileJson,
  parseProfileBaseContract,
  parseProfileReleaseEnvelope,
  signProfileRelease,
} from '../desktop/e-mate-desktop/src/profile-release.ts'
import { BASE_CONTRACT_ID, PRODUCT_UI_REFERENCE } from './change-impact.mjs'
import { emitComponent } from './component-release.mjs'
import { HARNESS_COMMIT } from './harness-provenance.mjs'
import { composeProfileReleaseCandidate } from './profile-release.mjs'
import { createProfileBuildReceipt } from './desktop-admission.mjs'
import {
  awaitingImmutablePublicationState,
  buildPublicationRequest,
  buildReleaseTransactionPlan,
  createPlatformManifestInputReceipt,
  finalizeManifestInputLedger,
  IMMUTABLE_REQUEST_PATH,
  verifyInstalledAcceptanceReceipt,
} from './local-flow.mjs'
import {
  createProfileCurrentSnapshot,
  loadProfileCurrentSnapshot,
  materializeProfileCurrentSnapshot,
  parseProfileCurrentSnapshot,
  prepareLocalSignedProfilePublication,
  prepareProfilePublication,
  verifyCompactLocalProfileSignerResult,
  writeCompactLocalProfileSignerResult,
  writeProfilePublicationBundle,
} from './publish-profile-r2.mjs'
import {
  SIGNER_ACTION_OWNER,
  SIGNER_ACTION_USES,
  SIGNER_DISPATCH_REQUEST_PATH,
  SIGNING_BUNDLE_PATH,
  SIGNING_INPUT_RECEIPT_PATH,
  SIGNING_INPUT_REQUEST_PATH,
} from './signer-transport.mjs'

test('local Profile preparation fails closed without the production signing key', async t => {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-profile-no-key-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const output = join(root, 'must-not-exist')
  await assert.rejects(
    prepareLocalSignedProfilePublication({ root, output, env: {} }),
    /production Profile signing key is missing/u,
  )
  assert.throws(() => lstatSync(output), /ENOENT/u)
})

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function fileDescriptor(root, path) {
  const bytes = readFileSync(path)
  return {
    path: relative(root, path).split(sep).join('/'),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

function artifactBytes(platform) {
  const bytes = Buffer.alloc(platform === 'macos' ? 1024 : 128)
  if (platform === 'macos') bytes.write('koly', bytes.byteLength - 512, 'ascii')
  else {
    bytes.write('MZ', 0, 'ascii')
    bytes.writeUInt32LE(64, 0x3c)
    bytes.write('PE\0\0', 64, 'ascii')
  }
  return bytes
}

function installedAcceptance(root, platform, candidateArtifact, sourceCommit) {
  const external = {
    schema_version: 1,
    document_type: 'emate.external-installed-update-acceptance',
    platform,
    scope: 'version-bound-installed-startup-and-update-readiness',
    stage: 'same-version-replacement',
    status: 'passed',
    host: platform === 'macos' ? 'T18-MAC' : '172_16_48_13',
    ...(platform === 'windows' ? { transport: 'ssh', transport_alias: 'win-test-server' } : {}),
    tested_at: '2026-08-31T04:00:00.000Z',
    source_commit: sourceCommit,
    candidate_artifact: candidateArtifact,
    installation: {
      status: 'passed',
      version: '2.0.15',
      source_commit: sourceCommit,
      artifact: candidateArtifact,
      startup_health: 'passed',
      visible_installations: 1,
      ...(platform === 'macos'
        ? { application_path: '/Applications/e-Mate.app' }
        : {
          previous_version: '2.0.13',
          previous_application_path: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\e-Mate\\e-Mate.exe',
          previous_desktop_shortcut_target: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\e-Mate\\e-Mate.exe',
          previous_start_menu_shortcut_target: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\e-Mate\\e-Mate.exe',
          installation_directory: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\e-Mate',
          reused_existing_installation_directory: true,
          desktop_shortcuts: 1,
          desktop_shortcut_target: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\e-Mate\\e-Mate.exe',
          start_menu_shortcuts: 1,
          start_menu_shortcut_target: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\e-Mate\\e-Mate.exe',
        }),
    },
    update_download: { status: 'not_applicable', reason: 'no-real-signed-strictly-higher-version' },
    manual_migration: {
      '2.0.13': 'official-cloudflare-r2-manual-download',
      'same-version-2.0.15': 'official-cloudflare-r2-manual-download',
    },
  }
  const directory = join(root, 'installed-acceptance', platform)
  const externalPath = join(directory, 'installed-update-acceptance.json')
  mkdirSync(directory, { recursive: true })
  writeJson(externalPath, external)
  const summary = {
    scope: external.scope,
    stage: external.stage,
    status: external.status,
    host: external.host,
    ...(platform === 'windows' ? { transport: external.transport, transport_alias: external.transport_alias } : {}),
    tested_at: external.tested_at,
    source_commit: external.source_commit,
    candidate_artifact: external.candidate_artifact,
    receipt: { file: 'installed-update-acceptance.json', sha256: fileDescriptor(root, externalPath).sha256 },
  }
  writeJson(join(directory, 'result.json'), {
    schema_version: 1,
    document_type: 'emate.local-installed-update-acceptance',
    platform,
    status: 'passed',
    source_commit: sourceCommit,
    candidate_artifact: candidateArtifact,
    external_acceptance: summary,
  })
  return summary
}

function artifactFixture(root, platform, sourceCommit, version) {
  const name = platform === 'macos' ? `e-Mate-${version}-mac-universal.dmg` : `e-Mate-${version}-win-x64-Setup.exe`
  const bytes = artifactBytes(platform)
  const file = { name, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, name), bytes)
  writeJson(join(root, 'local-artifact-receipt.json'), {
    schema_version: 1, document_type: 'emate.local-desktop-artifact', platform,
    source_commit: sourceCommit, version, files: [file],
  })
  return { primary: file, files: [file] }
}

async function localSigningFixture({ root, runParent, sourceCommit, version, baseId, componentId }) {
  const runId = `20260831T120000Z-${sourceCommit.slice(0, 12)}-abcdef`
  const runRoot = join(runParent, runId)
  for (const platform of ['macos', 'windows']) {
    const platformRoot = join(runRoot, 'manifest-inputs', 'platforms', platform)
    const profile = join(platformRoot, 'profile-artifact')
    mkdirSync(join(profile, 'dsh/profile'), { recursive: true })
    copyFileSync(join(root, 'desktop/e-mate-desktop/base-contract.json'), join(platformRoot, 'base-contract.json'))
    copyFileSync(join(root, 'packages/dsh/profile/component-inventory.json'), join(platformRoot, 'component-inventory.json'))
    copyFileSync(join(root, 'packages/dsh/profile/component-inventory.json'), join(profile, 'dsh/profile/component-inventory.json'))
    await createProfileBuildReceipt({
      sourceCommit, baseContract: join(platformRoot, 'base-contract.json'),
      inventory: join(platformRoot, 'component-inventory.json'), profile,
      output: join(platformRoot, 'profile-build-receipt.json'),
    })
    mkdirSync(join(platformRoot, 'unsigned-components'), { recursive: true })
    if (platform === 'macos') emitComponent({
      root, id: componentId, sourceCommit,
      out: join(platformRoot, 'unsigned-components/dsh-plugin-fixture'),
    })
    await createPlatformManifestInputReceipt(platformRoot, {
      platform, sourceCommit,
      toolchain: { node: '24.19.0', pnpm: '11.7.0', yarn: '4.18.0', npm: '11.6.2' },
    })
  }
  const artifacts = Object.fromEntries(['macos', 'windows'].map(platform => [
    platform, artifactFixture(join(runRoot, 'artifacts', platform), platform, sourceCommit, version),
  ]))
  const acceptance = Object.fromEntries(['macos', 'windows'].map(platform => [
    platform, installedAcceptance(runRoot, platform, artifacts[platform].primary, sourceCommit),
  ]))
  for (const platform of ['macos', 'windows']) {
    await verifyInstalledAcceptanceReceipt(join(runRoot, 'installed-acceptance', platform, 'result.json'), {
      platform, sourceCommit, version, candidateArtifact: artifacts[platform].primary,
    })
  }
  const run = {
    run_id: runId, version, source_commit: sourceCommit,
    verification: {
      status: 'passed', artifacts,
      installed_acceptance: acceptance,
    },
  }
  await finalizeManifestInputLedger(runRoot, run)
  run.release_transaction = buildReleaseTransactionPlan(run, 'same-version-2.0.15-exception')
  const requestPath = join(runRoot, IMMUTABLE_REQUEST_PATH)
  mkdirSync(join(runRoot, 'publication'), { recursive: true })
  const request = buildPublicationRequest(run)
  writeJson(requestPath, request)
  const requestDescriptor = fileDescriptor(runRoot, requestPath)
  run.publication = awaitingImmutablePublicationState(run, requestDescriptor.sha256)
  writeJson(join(runRoot, 'run.json'), run)
  const snapshotPath = join(runRoot, 'profile-current-snapshot.json')
  writeJson(snapshotPath, createProfileCurrentSnapshot({
    currentByTarget: new Map([
      ['darwin-arm64', undefined], ['darwin-x64', undefined], ['win32-x64', undefined],
    ]),
    releaseVersion: version,
    baseContractId: baseId,
    capturedAt: '2026-08-31T04:00:00.000Z',
  }))
  return {
    run, runId, runRoot, requestPath, snapshotPath,
    ledgerPath: join(runRoot, 'manifest-inputs/manifest-inputs.json'),
  }
}

function rehashSnapshot(value) {
  const { snapshot_sha256: ignored, ...body } = value
  return {
    ...body,
    snapshot_sha256: createHash('sha256').update(canonicalProfileJson(body)).digest('hex'),
  }
}

test('checked-in desired state is the exact public 2.0.13 Base v7 snapshot', () => {
  const snapshot = JSON.parse(readFileSync('artifacts/release/profile-current-snapshot.json', 'utf8'))
  const releaseVersion = JSON.parse(readFileSync('desktop/e-mate-desktop/package.json', 'utf8')).version
  assert.equal(snapshot.candidate_release_version, releaseVersion)
  assert.equal(snapshot.candidate_base_contract_id, BASE_CONTRACT_ID)
  assert.deepEqual(Object.keys(snapshot.targets).sort(), ['darwin-arm64', 'darwin-x64', 'win32-x64'])
  for (const [target, current] of Object.entries(snapshot.targets)) {
    const bytes = Buffer.from(current.content_base64, 'base64')
    assert.equal(bytes.byteLength, current.bytes, target)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), current.sha256, target)
    const envelope = JSON.parse(bytes)
    assert.equal(envelope.payload.release_version, '2.0.13', target)
    assert.deepEqual(envelope.payload.base_contracts, ['e-mate-desktop-profile-v7-dsh-b2b1650b01f0'], target)
  }
})

test('Cloudflare current snapshot is closed, bounded, canonical, and network-free', t => {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-profile-current-snapshot-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const expected = {
    releaseVersion: '2.0.13',
    baseContractId: 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0',
  }
  const currentByTarget = new Map([
    ['darwin-arm64', Buffer.from('{"target":"darwin-arm64"}\n')],
    ['darwin-x64', undefined],
    ['win32-x64', Buffer.from('{"target":"win32-x64"}\n')],
  ])
  const snapshot = createProfileCurrentSnapshot({
    currentByTarget,
    ...expected,
    capturedAt: '2026-08-25T10:00:00.000Z',
  })
  const parsed = parseProfileCurrentSnapshot(snapshot, expected)
  assert.equal(parsed.currentByTarget.get('darwin-arm64').equals(currentByTarget.get('darwin-arm64')), true)
  assert.equal(parsed.currentByTarget.get('darwin-x64'), undefined)
  assert.equal(parsed.currentByTarget.get('win32-x64').equals(currentByTarget.get('win32-x64')), true)

  const path = join(root, 'snapshot.json')
  writeJson(path, snapshot)
  assert.equal(loadProfileCurrentSnapshot(path, expected).snapshot.snapshot_sha256, snapshot.snapshot_sha256)
  assert.throws(
    () => materializeProfileCurrentSnapshot(path, join(root, 'absent-output'), expected),
    /requires a present current desired state/u,
  )

  const missing = structuredClone(snapshot)
  delete missing.targets['darwin-x64']
  assert.throws(() => parseProfileCurrentSnapshot(rehashSnapshot(missing), expected), /snapshot is invalid/u)

  const noncanonical = structuredClone(snapshot)
  noncanonical.targets['darwin-arm64'].content_base64 += '='
  assert.throws(() => parseProfileCurrentSnapshot(rehashSnapshot(noncanonical), expected), /snapshot bytes are invalid/u)

  assert.throws(() => createProfileCurrentSnapshot({
    currentByTarget: new Map([
      ['darwin-arm64', Buffer.alloc(1024 * 1024 + 1)],
      ['darwin-x64', undefined],
      ['win32-x64', undefined],
    ]),
    ...expected,
    capturedAt: '2026-08-25T10:00:00.000Z',
  }), /current desired state is invalid/u)

  writeFileSync(join(root, 'malformed.json'), '{')
  assert.throws(() => loadProfileCurrentSnapshot(join(root, 'malformed.json'), expected), /snapshot JSON is invalid/u)
  writeFileSync(join(root, 'oversize.json'), Buffer.alloc(5 * 1024 * 1024 + 1))
  assert.throws(() => loadProfileCurrentSnapshot(join(root, 'oversize.json'), expected), /snapshot size is invalid/u)

  const complete = createProfileCurrentSnapshot({
    currentByTarget: new Map([
      ['darwin-arm64', Buffer.from('arm64')],
      ['darwin-x64', Buffer.from('x64')],
      ['win32-x64', Buffer.from('win')],
    ]),
    ...expected,
    capturedAt: '2026-08-25T10:00:00.000Z',
  })
  const completePath = join(root, 'complete.json')
  writeJson(completePath, complete)
  const output = join(root, 'materialized')
  materializeProfileCurrentSnapshot(completePath, output, expected)
  assert.equal(readFileSync(join(output, 'darwin-arm64.json'), 'utf8'), 'arm64')
  assert.equal(readFileSync(join(output, 'darwin-x64.json'), 'utf8'), 'x64')
  assert.equal(readFileSync(join(output, 'win32-x64.json'), 'utf8'), 'win')

  const publisher = readFileSync(new URL('./publish-profile-r2.mjs', import.meta.url), 'utf8')
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const release = readFileSync(new URL('../.github/workflows/profile-release.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(publisher, /\bfetch\s*\(/u)
  assert.doesNotMatch(ci, /curl[^]*desktop\/profile\/desired-state/u)
  assert.equal(ci.match(/--materialize-current dist\/profile-current/gu)?.length, 2)
  assert.match(release, /--snapshot artifacts\/release\/profile-current-snapshot\.json/u)
})

test('publication admits bootstrap and its direct successor before exposing active desired state', async t => {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-profile-publish-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const keyId = '0123456789abcdef'
  const baseId = BASE_CONTRACT_ID
  const releaseVersion = JSON.parse(readFileSync('desktop/e-mate-desktop/package.json', 'utf8')).version
  const componentId = '@e-mate/dsh-plugin-fixture'
  mkdirSync(join(root, 'desktop/e-mate-desktop'), { recursive: true })
  mkdirSync(join(root, 'desktop'), { recursive: true })
  mkdirSync(join(root, 'packages/dsh/profile'), { recursive: true })
  execFileSync('git', ['init', '--quiet'], { cwd: root })
  const componentRoot = join(root, 'packages/dsh-plugin-fixture')
  mkdirSync(join(componentRoot, 'lib'), { recursive: true })
  writeJson(join(root, 'desktop/e-mate-desktop/base-contract.json'), {
    schema_version: 1,
    id: baseId,
    desktop_api: 2,
    profile_format: 1,
    schedule_protocol_floor: 1,
    desktop_reference: {
      repository: 'anywhere-labs/deepseek-harness-desktop',
      commit: '6074088f5b660206e404b3591fab51fb99c69add',
      harness_repository: 'deepseek-ai/deepseek-harness',
      harness_commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
      harness_version: '0.1.0-rc.7',
    },
    harness_version: '0.1.0-rc.7',
    harness_commit: HARNESS_COMMIT,
    runtime_imports: {},
    profile_signing_keys: [{
      id: keyId,
      algorithm: 'ed25519',
      public_key_spki_der_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    }],
  })
  writeJson(join(root, 'package.json'), { version: releaseVersion, packageManager: 'pnpm@11.7.0' })
  writeJson(join(root, 'desktop/package.json'), { packageManager: 'yarn@4.18.0' })
  writeJson(join(root, 'desktop/e-mate-desktop/package.json'), { version: releaseVersion, dependencies: {} })
  writeJson(join(root, 'packages/dsh/profile/component-inventory.json'), { schema_version: 1, components: [{
    id: componentId,
    root: 'packages/dsh-plugin-fixture',
    kind: 'profile',
    desktop: 'hot-profile',
    cli: true,
  }] })
  writeJson(join(componentRoot, 'lib/index.json'), { value: true })
  writeFileSync(join(componentRoot, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(componentRoot, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  writeJson(join(componentRoot, 'package.json'), {
    name: componentId,
    version: releaseVersion,
    type: 'module',
    main: 'lib/index.json',
    files: ['lib', 'cordis.patch.yml', 'pnpm-lock.yaml'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    eMate: {
      component: { schema_version: 1, id: componentId, kind: 'profile', base_imports: [], authority_contract: { effects: [], guards: [] }, base_contracts: [baseId] },
      harnessVersion: '0.1.0-rc.7',
      harnessCommit: HARNESS_COMMIT,
    },
    license: 'MIT',
  })
  writeFileSync(join(root, '.gitignore'), 'dist/\n')
  execFileSync('git', ['add', '--all'], { cwd: root })
  execFileSync('git', [
    'update-index', '--add', '--cacheinfo',
    `160000,${HARNESS_COMMIT},upstream/deepseek-harness`,
  ], { cwd: root })
  execFileSync('git', [
    'update-index', '--add', '--cacheinfo',
    `160000,${PRODUCT_UI_REFERENCE.commit},${PRODUCT_UI_REFERENCE.path}`,
  ], { cwd: root })
  execFileSync('git', [
    '-c', 'user.name=e-Mate Test', '-c', 'user.email=test@example.invalid',
    'commit', '--quiet', '-m', 'fixture',
  ], { cwd: root })
  execFileSync('git', ['update-index', '--skip-worktree', 'upstream/deepseek-harness', PRODUCT_UI_REFERENCE.path], { cwd: root })
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

  const stagedLocal = await localSigningFixture({
    root, runParent: join(root, 'dist/local-runs'), sourceCommit, version: releaseVersion, baseId, keyId, componentId,
  })
  const runParent = mkdtempSync(join(tmpdir(), 'e-mate-external-local-run-'))
  t.after(() => rmSync(runParent, { recursive: true, force: true }))
  const runRoot = join(runParent, stagedLocal.runId)
  renameSync(stagedLocal.runRoot, runRoot)
  const local = {
    ...stagedLocal,
    runRoot,
    requestPath: join(runRoot, IMMUTABLE_REQUEST_PATH),
    snapshotPath: join(runRoot, 'profile-current-snapshot.json'),
    ledgerPath: join(runRoot, 'manifest-inputs/manifest-inputs.json'),
  }
  const signing = { EMATE_PROFILE_SIGNING_PRIVATE_KEY: privateKeyPem, EMATE_PROFILE_SIGNING_KEY_ID: keyId }
  const originalRequest = readFileSync(local.requestPath)
  const originalLedger = readFileSync(local.ledgerPath)
  const rejectLocal = async (request, output, pattern) => {
    await assert.rejects(prepareLocalSignedProfilePublication({
      root, runRoot: local.runRoot, request, currentSnapshot: local.snapshotPath, output, env: signing,
    }), pattern)
    assert.throws(() => lstatSync(output), /ENOENT/u)
  }

  const sameSizeRequest = originalRequest.toString('utf8').replace('ready-for-existing-owner', 'ready-for-existing-ownez')
  assert.equal(Buffer.byteLength(sameSizeRequest), originalRequest.byteLength)
  writeFileSync(local.requestPath, sameSizeRequest)
  await rejectLocal(local.requestPath, join(local.runRoot, 'request-tamper-output'), /publication request is invalid/u)
  writeFileSync(local.requestPath, originalRequest)

  const requestSha256 = local.run.publication.request_sha256
  local.run.publication.request_sha256 = '0'.repeat(64)
  writeJson(join(local.runRoot, 'run.json'), local.run)
  await rejectLocal(local.requestPath, join(local.runRoot, 'descriptor-output'), /request descriptor drifted/u)
  local.run.publication.request_sha256 = requestSha256
  writeJson(join(local.runRoot, 'run.json'), local.run)

  writeJson(local.requestPath, { ...JSON.parse(originalRequest.toString('utf8')), github_run_id: '123' })
  await rejectLocal(local.requestPath, join(local.runRoot, 'github-field-output'), /publication request is invalid/u)
  writeFileSync(local.requestPath, originalRequest)

  const alternateRequest = join(local.runRoot, 'alternate-request.json')
  writeFileSync(alternateRequest, originalRequest)
  await rejectLocal(alternateRequest, join(local.runRoot, 'path-output'), /canonical run publication request/u)

  const sameSizeLedger = originalLedger.toString('utf8').replace('committed-clean', 'committed-cleam')
  assert.equal(Buffer.byteLength(sameSizeLedger), originalLedger.byteLength)
  writeFileSync(local.ledgerPath, sameSizeLedger)
  await rejectLocal(local.requestPath, join(local.runRoot, 'ledger-tamper-output'), /ledger drifted/u)
  writeFileSync(local.ledgerPath, originalLedger)

  const localOutput = join(local.runRoot, 'profile-signing')
  const localResult = await prepareLocalSignedProfilePublication({
    root,
    runRoot: local.runRoot,
    request: local.requestPath,
    currentSnapshot: local.snapshotPath,
    output: localOutput,
    env: signing,
  })
  assert.equal(localResult.plan.schema_version, 2)
  assert.equal(localResult.plan.provenance.run_id, local.runId)
  assert.deepEqual(localResult.aggregate.provenance, localResult.plan.provenance)
  assert.equal([...localResult.plan.immutable_objects, ...localResult.plan.activations.map(item => item.object)]
    .every(item => new URL(item.url).origin === 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'), true)
  assert.doesNotMatch(JSON.stringify({ plan: localResult.plan, aggregate: localResult.aggregate }),
    /ci-ephemeral|accepted_ci_run_id|preparation_run_id|github(?:usercontent)?\.com/u)
  for (const directory of localResult.candidateDirectories) {
    const admission = JSON.parse(readFileSync(join(directory, 'admission.json'), 'utf8'))
    assert.deepEqual([admission.signature_kind, admission.signature_key_id], ['production', keyId])
  }
  const requestDescriptor = fileDescriptor(local.runRoot, local.requestPath)
  local.run.publication = {
    status: 'awaiting-protected-signer', scope: 'full', owner: SIGNER_ACTION_OWNER,
    immutable_request: IMMUTABLE_REQUEST_PATH, immutable_request_sha256: requestDescriptor.sha256,
    immutable_receipt: 'publication/immutable-owner-receipt.json', immutable_receipt_sha256: '1'.repeat(64),
    compatibility_request: 'publication/compatibility-attestation-request.json',
    compatibility_request_sha256: '2'.repeat(64),
    compatibility_receipt: 'publication/compatibility-attestation-receipt.json',
    compatibility_receipt_sha256: '3'.repeat(64),
    control_bundle: SIGNING_BUNDLE_PATH, control_bundle_bytes: 100, control_bundle_sha256: '4'.repeat(64),
    signing_input_request: SIGNING_INPUT_REQUEST_PATH, signing_input_request_sha256: '5'.repeat(64),
    signing_input_receipt: SIGNING_INPUT_RECEIPT_PATH, signing_input_receipt_sha256: '6'.repeat(64),
    request: SIGNER_DISPATCH_REQUEST_PATH, request_sha256: '7'.repeat(64), action: SIGNER_ACTION_USES,
    transaction_mode: local.run.release_transaction.mode,
  }
  writeJson(join(local.runRoot, 'run.json'), local.run)
  const compact = join(local.runRoot, 'profile-compact')
  const compactReceipt = writeCompactLocalProfileSignerResult(localResult, compact)
  assert.equal(compactReceipt.component_payloads_in_result, false)
  assert.deepEqual(readdirSync(compact).sort(), [
    'profile-component-aggregate.json', 'profile-desired-state', 'profile-publication-plan.json',
    'profile-signer-result.json',
  ])
  const imported = await verifyCompactLocalProfileSignerResult({
    root, runRoot: local.runRoot, request: local.requestPath, result: compact,
  })
  assert.equal(imported.immutable_objects.every(item => item.url.startsWith('https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/')), true)
  assert.equal(imported.activations.every(item => item.object.url.startsWith('https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/')), true)
  assert.equal(readdirSync(local.runRoot).some(name => name.startsWith('.profile-import-')
    || name.startsWith('.profile-aggregate-')), false)

  const planPath = join(compact, 'profile-publication-plan.json')
  const receiptPath = join(compact, 'profile-signer-result.json')
  const originalPlan = readFileSync(planPath)
  const originalCompactReceipt = readFileSync(receiptPath)
  const traversal = JSON.parse(originalPlan.toString('utf8'))
  traversal.immutable_objects[0].path = '../escaped.json'
  writeJson(planPath, traversal)
  const traversalReceipt = JSON.parse(originalCompactReceipt.toString('utf8'))
  traversalReceipt.publication_plan = fileDescriptor(compact, planPath)
  writeJson(receiptPath, traversalReceipt)
  await assert.rejects(verifyCompactLocalProfileSignerResult({
    root, runRoot: local.runRoot, request: local.requestPath, result: compact,
  }), /publication object is invalid/u)
  assert.throws(() => lstatSync(join(local.runRoot, 'escaped.json')), /ENOENT/u)
  writeFileSync(planPath, originalPlan)
  writeFileSync(receiptPath, originalCompactReceipt)
  const githubPlan = JSON.parse(originalPlan.toString('utf8'))
  githubPlan.immutable_objects[0].url = 'https://github.com/example/component.json'
  writeJson(planPath, githubPlan)
  const githubReceipt = JSON.parse(originalCompactReceipt.toString('utf8'))
  githubReceipt.publication_plan = fileDescriptor(compact, planPath)
  writeJson(receiptPath, githubReceipt)
  await assert.rejects(verifyCompactLocalProfileSignerResult({
    root, runRoot: local.runRoot, request: local.requestPath, result: compact,
  }), /publication object is invalid/u)
  writeFileSync(planPath, originalPlan)
  writeFileSync(receiptPath, originalCompactReceipt)
  const desiredState = join(compact, 'profile-desired-state/darwin-arm64.json')
  const desiredBytes = readFileSync(desiredState)
  writeFileSync(desiredState, Buffer.alloc(desiredBytes.byteLength, 120))
  await assert.rejects(verifyCompactLocalProfileSignerResult({
    root, runRoot: local.runRoot, request: local.requestPath, result: compact,
  }), /drifted/u)
  writeFileSync(desiredState, desiredBytes)
  assert.equal(readdirSync(local.runRoot).some(name => name.startsWith('.profile-import-')
    || name.startsWith('.profile-aggregate-')), false)
  const artifact = join(root, 'dist/components/fixture')
  emitComponent({ root, id: componentId, out: artifact, sourceCommit })
  const candidates = []
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
    const output = join(root, 'dist/candidates', target)
    await composeProfileReleaseCandidate({
      root,
      target,
      artifactRoots: [join(root, 'dist/components')],
      changedIds: [componentId],
      sourceCommit,
      output,
    })
    candidates.push(output)
  }
  const driftedAdmission = JSON.parse(readFileSync(join(candidates[0], 'admission.json'), 'utf8'))
  writeJson(join(candidates[0], 'admission.json'), {
    ...driftedAdmission,
    changed_components: ['@e-mate/dsh-client-shell'],
  })
  assert.throws(() => prepareProfilePublication({
    root,
    candidateDirectories: candidates,
    artifactRoots: [join(root, 'dist/components')],
    expectedChangedIds: [componentId],
    sourceCommit,
    privateKeyPem,
    keyId,
    currentByTarget: new Map([
      ['darwin-arm64', undefined], ['darwin-x64', undefined], ['win32-x64', undefined],
    ]),
    bootstrap: true,
  }), /candidate changed components do not match accepted CI impact/u)
  writeJson(join(candidates[0], 'admission.json'), {
    ...driftedAdmission,
    schedule_protocol_floor: 2,
  })
  assert.throws(() => prepareProfilePublication({
    root,
    candidateDirectories: candidates,
    artifactRoots: [join(root, 'dist/components')],
    expectedChangedIds: [componentId],
    sourceCommit,
    privateKeyPem,
    keyId,
    currentByTarget: new Map([
      ['darwin-arm64', undefined], ['darwin-x64', undefined], ['win32-x64', undefined],
    ]),
    bootstrap: true,
  }), /Profile candidate admission is invalid/u)
  writeJson(join(candidates[0], 'admission.json'), driftedAdmission)
  const publication = prepareProfilePublication({
    root,
    candidateDirectories: candidates,
    artifactRoots: [join(root, 'dist/components')],
    expectedChangedIds: [componentId],
    sourceCommit,
    privateKeyPem,
    keyId,
    currentByTarget: new Map([
      ['darwin-arm64', undefined], ['darwin-x64', undefined], ['win32-x64', undefined],
    ]),
    bootstrap: true,
  })
  assert.equal(publication.releases.length, 3)
  assert.deepEqual(publication.releases.map(release => release.target), ['darwin-arm64', 'darwin-x64', 'win32-x64'])
  assert.equal(publication.releases.every(release => release.stable.cacheControl === 'no-store'), true)
  assert.equal(publication.objects.filter(item => item.role === 'desired-state-immutable').length, 3)

  const incompatibleCurrentByTarget = new Map(candidates.map(candidate => {
    const payload = JSON.parse(readFileSync(join(candidate, 'payload.json'), 'utf8'))
    const legacy = {
      ...payload.components[0],
      id: '@e-mate/dsh-plugin-legacy',
      profile_path: 'node_modules/@e-mate/dsh-plugin-legacy',
      manifest_url: payload.components[0].manifest_url.replace('/dsh-plugin-fixture/', '/dsh-plugin-legacy/'),
    }
    const envelope = signProfileRelease({
      ...payload,
      sequence: 4,
      base_contracts: ['e-mate-desktop-profile-v2-dsh-2bc16230975f'],
      components: [legacy],
    }, privateKeyPem, keyId)
    return [`${payload.target.platform}-${payload.target.arch}`, Buffer.from(JSON.stringify(envelope))]
  }))
  const migratedBootstrap = prepareProfilePublication({
    root,
    candidateDirectories: candidates,
    artifactRoots: [join(root, 'dist/components')],
    expectedChangedIds: [componentId],
    sourceCommit,
    privateKeyPem,
    keyId,
    currentByTarget: incompatibleCurrentByTarget,
    bootstrap: true,
  })
  assert.equal(migratedBootstrap.releases.every(release => release.sequence === 1), true)

  const compatibleCurrentByTarget = new Map(candidates.map(candidate => {
    const payload = JSON.parse(readFileSync(join(candidate, 'payload.json'), 'utf8'))
    const envelope = signProfileRelease({ ...payload, sequence: 4 }, privateKeyPem, keyId)
    return [`${payload.target.platform}-${payload.target.arch}`, Buffer.from(JSON.stringify(envelope))]
  }))
  assert.throws(() => prepareProfilePublication({
    root,
    candidateDirectories: candidates,
    artifactRoots: [join(root, 'dist/components')],
    expectedChangedIds: [componentId],
    sourceCommit,
    privateKeyPem,
    keyId,
    currentByTarget: compatibleCurrentByTarget,
    bootstrap: true,
  }), /bootstrap candidate would replace an existing desired state/u)

  const bundle = join(root, 'dist/native-publication')
  const plan = writeProfilePublicationBundle(publication, bundle, new Map([
    ['darwin-arm64', undefined], ['darwin-x64', undefined], ['win32-x64', undefined],
  ]), { acceptedCiRunId: '123', preparationRunId: '456' })
  assert.equal(plan.document_type, 'emate.profile-native-cloudflare-publication-plan')
  assert.equal(plan.source_commit, sourceCommit)
  assert.equal(plan.main_commit, sourceCommit)
  assert.equal(plan.accepted_ci_run_id, '123')
  assert.equal(plan.preparation_run_id, '456')
  assert.equal(plan.base_contract_id, baseId)
  assert.equal(plan.schedule_protocol_floor, 1)
  assert.equal(plan.activations.every(item => item.expected_current === null), true)
  assert.equal(plan.immutable_objects.every(item => item.path.startsWith('immutable/')), true)
  assert.equal(plan.activations.every(item => item.object.path.startsWith('activation/')), true)
  assert.throws(() => writeProfilePublicationBundle(publication, join(root, 'dist/invalid-publication'), new Map(), {
    mainCommit: 'not-a-commit',
  }), /main commit is invalid/u)
  for (const item of [...plan.immutable_objects, ...plan.activations.map(entry => entry.object)]) {
    const bytes = readFileSync(join(bundle, ...item.path.split('/')))
    assert.equal(bytes.byteLength, item.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256)
  }
  const partialBootstrap = prepareProfilePublication({
    root,
    candidateDirectories: candidates,
    artifactRoots: [join(root, 'dist/components')],
    expectedChangedIds: [componentId],
    sourceCommit,
    privateKeyPem,
    keyId,
    currentByTarget: new Map([
      ['darwin-arm64', readFileSync(join(candidates[0], 'production-envelope.json'))],
      ['darwin-x64', undefined],
      ['win32-x64', undefined],
    ]),
    bootstrap: true,
  })
  assert.equal(partialBootstrap.releases.length, 3)
  const base = parseProfileBaseContract(JSON.parse(readFileSync(join(root, 'desktop/e-mate-desktop/base-contract.json'), 'utf8')))
  for (const candidate of candidates) {
    assert.notEqual(parseProfileReleaseEnvelope(readFileSync(join(candidate, 'production-envelope.json')), base), undefined)
  }

  const currentByTarget = new Map(candidates.map(candidate => {
    const envelope = readFileSync(join(candidate, 'production-envelope.json'))
    const target = JSON.parse(readFileSync(join(candidate, 'admission.json'), 'utf8')).target
    return [`${target.platform}-${target.arch}`, envelope]
  }))
  writeJson(join(componentRoot, 'lib/index.json'), { value: false })
  const nextSourceCommit = 'b'.repeat(40)
  const nextArtifact = join(root, 'dist/components-next/fixture')
  emitComponent({ root, id: componentId, out: nextArtifact, sourceCommit: nextSourceCommit })
  const nextCandidates = []
  for (const [index, target] of ['darwin-arm64', 'darwin-x64', 'win32-x64'].entries()) {
    const output = join(root, 'dist/candidates-next', target)
    await composeProfileReleaseCandidate({
      root,
      target,
      artifactRoots: [join(root, 'dist/components-next')],
      changedIds: [componentId],
      sourceCommit: nextSourceCommit,
      output,
      current: join(candidates[index], 'production-envelope.json'),
    })
    nextCandidates.push(output)
  }
  const successor = prepareProfilePublication({
    root,
    candidateDirectories: nextCandidates,
    artifactRoots: [join(root, 'dist/components-next')],
    expectedChangedIds: [componentId],
    sourceCommit: nextSourceCommit,
    privateKeyPem,
    currentByTarget,
    bootstrap: false,
  })
  assert.equal(successor.releases.every(release => release.sequence === 2), true)
  assert.deepEqual(successor.releases.map(release => release.changed_components), [
    [componentId], [componentId], [componentId],
  ])
  assert.equal(successor.releases.every(release => typeof release.parent_generation === 'string'), true)
  const successorBundle = join(root, 'dist/native-publication-successor')
  const successorPlan = writeProfilePublicationBundle(successor, successorBundle, currentByTarget)
  assert.equal(successorPlan.activations.every(item => item.expected_current?.sha256?.length === 64), true)
  const partialSuccessor = prepareProfilePublication({
    root,
    candidateDirectories: nextCandidates,
    artifactRoots: [join(root, 'dist/components-next')],
    expectedChangedIds: [componentId],
    sourceCommit: nextSourceCommit,
    privateKeyPem,
    keyId,
    currentByTarget: new Map([
      ['darwin-arm64', readFileSync(join(nextCandidates[0], 'production-envelope.json'))],
      ['darwin-x64', currentByTarget.get('darwin-x64')],
      ['win32-x64', currentByTarget.get('win32-x64')],
    ]),
    bootstrap: false,
  })
  assert.equal(partialSuccessor.releases.length, 3)
})
