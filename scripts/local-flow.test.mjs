import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CANDIDATE_FAILURE,
  COMPUTER_USE_SCENARIOS,
  NPM_COLLECTOR_ARGS,
  assertCleanArtifactBytes,
  blockWindowsRemote,
  blockedWindowsState,
  buildActivationRequest,
  buildCompatibilityAttestationRequest,
  buildPublicationRequest,
  buildReleaseTransactionPlan,
  buildRollbackRequest,
  candidateFailureDetails,
  createPlatformManifestInputReceipt,
  devChecks,
  finalizeManifestInputLedger,
  importRollbackOwnerReceipt,
  importWindowsRemoteResult,
  markWindowsUnavailable,
  normalizeFlowArgv,
  publicationAction,
  prepareNpmCollectorCarrier,
  preparePnpmLifecycleCarrier,
  resolveNpmCollectorCli,
  rollbackAction,
  runCandidateStages,
  selectPythonCommand,
  selectWindowsNpmCommand,
  selectWindowsPnpmCommand,
  selectCandidatePlatforms,
  validateCandidateSource,
  validateImmutablePublicationReceipt,
  validatePublicationReceipt,
  validateRollbackReceipt,
  validateRemoteHostname,
  verifyManifestInputLedger,
  verifyComputerUseReceipt,
  verifyLocalArtifact,
  verifyNpmCollectorCarrier,
  windowsPnpmShim,
  windowsRemoteRequest,
} from './local-flow.mjs'
import { pinnedYarnInvocation } from './package-manager.mjs'
import { canonicalProfileJson } from '../desktop/e-mate-desktop/src/profile-release.ts'
import {
  R2_ORIGIN as SIGNER_R2_ORIGIN,
  SIGNER_ACTION_OWNER,
  SIGNER_ACTION_USES,
  SIGNER_DISPATCH_REQUEST_PATH,
  SIGNER_RESULT_RECEIPT,
  assembleProtectedSignerResult,
  buildProtectedSignerDispatchRequest,
  buildSigningInputOwnerRequest,
  collectSigningControlFiles,
  materializeProtectedSignerDispatchRequest,
  validateProtectedSignerResultDirectory,
  validateProtectedSignerResultOwnerReceipt,
  validatePublicControlRun,
  validateSigningInputOwnerReceipt,
} from './signer-transport.mjs'
import { createSigningControlBundle } from './signing-control-bundle.mjs'

const SHA = 'a'.repeat(40)
const MAC_SHA = 'b'.repeat(64)
const WIN_SHA = 'c'.repeat(64)
const MAC_BLOCKMAP_SHA = 'd'.repeat(64)
const WIN_BLOCKMAP_SHA = 'e'.repeat(64)
const R2_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const RUN_ID = '20260830T000000Z-aaaaaaaaaaaa-abcdef'
const POINTER_BEFORE = Object.freeze({
  bytes: 2961,
  sha256: '838115146f74e18de0fc90e3dc586f6bd5eab706a0e6dcbc27e6ad5a79c642fb',
  etag: '61df621671e90dc90ce457494e09b295',
})

async function temporary() {
  return mkdtemp(join(tmpdir(), 'emate-local-flow-test-'))
}

async function isolatedNodeDistribution(root) {
  const node = join(root, 'bin', process.platform === 'win32' ? 'node.exe' : 'node')
  await mkdir(join(root, 'bin'), { recursive: true })
  await copyFile(process.execPath, node)
  await chmod(node, 0o755)
  return node
}

async function npmCarrierFixture(root, {
  cliName = 'npm-cli.js',
  eol = '\n',
  listOutput = JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: {} }),
  manifest = {},
  shebang = '#!/usr/bin/env node',
} = {}) {
  const corepackRoot = join(root, 'lib', 'node_modules', 'corepack')
  const npmRoot = join(root, 'lib', 'node_modules', 'npm')
  const cli = join(npmRoot, 'bin', cliName)
  await mkdir(corepackRoot, { recursive: true })
  await mkdir(join(npmRoot, 'bin'), { recursive: true })
  await writeFile(join(npmRoot, 'package.json'), `${JSON.stringify({
    name: 'npm',
    version: '11.17.0',
    bin: { npm: 'bin/npm-cli.js' },
    ...manifest,
  })}\n`)
  await writeFile(cli, [
    shebang,
    "const fs = require('node:fs')",
    'const args = process.argv.slice(2)',
    "if (process.env.T25_NPM_LOG) fs.appendFileSync(process.env.T25_NPM_LOG, `${JSON.stringify({ args, execPath: fs.realpathSync(process.execPath) })}\\n`)",
    "if (args[0] === '--version') process.stdout.write('11.17.0\\n')",
    `else if (args[0] === 'list') process.stdout.write(${JSON.stringify(`${listOutput}\n`)})`,
    'else process.exitCode = 2',
  ].join(eol))
  await chmod(cli, 0o755)
  return { cli, corepackRoot }
}

async function pnpmLifecycleFixture(root, version = '11.7.0') {
  const entry = join(root, 'v1', 'pnpm', '11.7.0', 'bin', 'pnpm.cjs')
  await mkdir(join(root, 'v1', 'pnpm', '11.7.0', 'bin'), { recursive: true })
  await writeFile(entry, [
    "const { spawnSync } = require('node:child_process')",
    "const { readFileSync } = require('node:fs')",
    'const args = process.argv.slice(2)',
    `if (args[0] === '--version') process.stdout.write(${JSON.stringify(`${version}\n`)})`,
    "else if (args[0] === 'run') {",
    "  const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts?.[args[1]]",
    "  const result = spawnSync(script, { cwd: process.cwd(), encoding: 'utf8', env: process.env, shell: true })",
    "  process.stdout.write(result.stdout ?? '')",
    "  process.stderr.write(result.stderr ?? '')",
    '  process.exitCode = result.status ?? 1',
    '} else process.exitCode = 2',
  ].join('\n'))
  return entry
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

async function manifestPlatformFixture(root, platform) {
  const targets = [
    { platform: 'darwin', arch: 'arm64', runtime_abi: 'fixture', minimum_os: '14.0', signing: { scheme: 'adhoc', identity: 'adhoc' }, native_paths: ['native/macos'] },
    { platform: 'darwin', arch: 'x64', runtime_abi: 'fixture', minimum_os: '14.0', signing: { scheme: 'adhoc', identity: 'adhoc' }, native_paths: ['native/macos'] },
    { platform: 'win32', arch: 'x64', runtime_abi: 'none', minimum_os: '10.0', signing: { scheme: 'unsigned', identity: 'none' }, native_paths: [] },
  ]
  const inventory = {
    schema_version: 1,
    components: [
      { id: '@e-mate/dsh-plugin-portable', root: 'packages/dsh-plugin-portable', kind: 'profile', desktop: 'hot-profile' },
      { id: '@e-mate/dsh-plugin-native', root: 'packages/dsh-plugin-native', kind: 'platform-profile', desktop: 'platform-profile', targets },
    ],
  }
  const base = {
    schema_version: 1,
    id: 'e-mate-desktop-profile-fixture',
    schedule_protocol_floor: 1,
    harness_commit: '1'.repeat(40),
    profile_signing_keys: [{
      id: 'fixture-key', algorithm: 'ed25519',
      public_key_spki_der_base64: 'MCowBQYDK2VwAyEA0+3XBSNHP2aAp7jg++srGAjEpIICRypfzX5WWykO4oM=',
    }],
  }
  const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  const inventoryBytes = jsonBytes(inventory)
  await mkdir(join(root, 'profile-artifact', 'dsh', 'profile'), { recursive: true })
  await mkdir(join(root, 'profile-artifact', 'dsh-plugin-portable', 'lib'), { recursive: true })
  await writeFile(join(root, 'base-contract.json'), jsonBytes(base))
  await writeFile(join(root, 'component-inventory.json'), inventoryBytes)
  await writeFile(join(root, 'profile-artifact', 'dsh', 'profile', 'component-inventory.json'), inventoryBytes)
  await writeFile(join(root, 'profile-artifact', 'dsh-plugin-portable', 'lib', 'index.js'), 'export {}\n')
  const profileFiles = [
    ['dsh/profile/component-inventory.json', inventoryBytes],
    ['dsh-plugin-portable/lib/index.js', Buffer.from('export {}\n')],
  ].map(([path, bytes]) => ({ path, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const profileTreeSha256 = createHash('sha256')
    .update(Buffer.from('e-mate-staged-profile-tree-v1\0', 'utf8'))
    .update(canonicalProfileJson(profileFiles))
    .digest('hex')
  await writeFile(join(root, 'profile-build-receipt.json'), jsonBytes({
    schema_version: 1,
    document_type: 'emate.desktop-profile-build-receipt',
    source_commit: SHA,
    base_contract_id: base.id,
    inventory_sha256: createHash('sha256').update(inventoryBytes).digest('hex'),
    staged_profile_tree_sha256: profileTreeSha256,
    file_count: profileFiles.length,
    total_bytes: profileFiles.reduce((sum, file) => sum + file.bytes, 0),
  }))
  const jobs = platform === 'macos'
    ? [{ component: inventory.components[0], target: null }, { component: inventory.components[1], target: targets[0] }, { component: inventory.components[1], target: targets[1] }]
    : [{ component: inventory.components[1], target: targets[2] }]
  for (const job of jobs) {
    const slug = job.component.id.replace('@e-mate/', '')
    const target = job.target === null ? null : `${job.target.platform}-${job.target.arch}`
    const payload = join(root, 'unsigned-components', slug, ...(target === null ? [] : [target]))
    const packageBytes = jsonBytes({ name: job.component.id, version: '2.0.15', main: 'lib/index.js' })
    await mkdir(join(payload, 'files'), { recursive: true })
    await writeFile(join(payload, 'files', 'package.json'), packageBytes)
    await writeFile(join(payload, 'manifest.json'), jsonBytes({
      schema_version: 1,
      id: job.component.id,
      kind: job.component.kind,
      target: job.target,
      source_commit: SHA,
      base_contracts: [base.id],
      schedule_protocol_floor: 1,
      total_bytes: packageBytes.byteLength,
      files: [{
        path: 'package.json', bytes: packageBytes.byteLength,
        sha256: createHash('sha256').update(packageBytes).digest('hex'), mode: '0644',
      }],
    }))
  }
  await createPlatformManifestInputReceipt(root, {
    platform,
    sourceCommit: SHA,
    toolchain: { node: process.versions.node, pnpm: '11.7.0', yarn: '4.18.0', npm: '11.17.0' },
  })
}

async function windowsRemoteFixture(root) {
  const run = {
    run_id: RUN_ID,
    version: '2.0.15',
    source_commit: SHA,
    source_branch: 'release/2.0.15-final-integration-r5',
  }
  const request = windowsRemoteRequest(run)
  const requestPath = join(root, 'request.json')
  const requestBytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`)
  await writeFile(requestPath, requestBytes)
  run.platforms = { windows: {
    status: 'awaiting-codex-remote',
    source_commit: SHA,
    request: 'windows-remote/request.json',
    request_sha256: createHash('sha256').update(requestBytes).digest('hex'),
  } }
  const artifacts = join(root, 'returned', 'artifacts', 'windows')
  const fixture = await artifactFixture(artifacts, 'windows')
  const manifestRoot = join(root, 'returned', 'manifest-inputs', 'windows')
  await manifestPlatformFixture(manifestRoot, 'windows')
  const resultPath = join(root, 'returned', 'codex-remote-result.json')
  const logBytes = Buffer.from('Windows build completed\n')
  await writeFile(join(root, 'returned', 'windows.log'), logBytes)
  const writeResult = async (files = fixture.files, extra = {}) => {
    const receiptBytes = await readFile(join(artifacts, 'local-artifact-receipt.json'))
    const manifestReceiptBytes = await readFile(join(manifestRoot, 'platform-inputs.json'))
    await writeFile(resultPath, `${JSON.stringify({
      schema_version: 1,
      document_type: 'emate.local-windows-codex-remote-result',
      transport: 'ssh',
      run_id: RUN_ID,
      version: '2.0.15',
      platform: 'windows',
      host: 'LAPTOP-ADQ973JN',
      source_commit: SHA,
      request_sha256: createHash('sha256').update(requestBytes).digest('hex'),
      artifact_receipt: {
        file: 'artifacts/windows/local-artifact-receipt.json',
        sha256: createHash('sha256').update(receiptBytes).digest('hex'),
      },
      manifest_input_receipt: {
        file: 'manifest-inputs/windows/platform-inputs.json',
        bytes: manifestReceiptBytes.byteLength,
        sha256: createHash('sha256').update(manifestReceiptBytes).digest('hex'),
      },
      log: {
        file: 'windows.log', bytes: logBytes.byteLength,
        sha256: createHash('sha256').update(logBytes).digest('hex'),
      },
      files,
      ...extra,
    }, null, 2)}\n`)
  }
  await writeResult()
  return { artifacts, fixture, request, requestPath, resultPath, returned: join(root, 'returned'), run, writeResult }
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
    coverage: [
      'installation', 'startup', 'update-download-verify-atomic-replace-relaunch-health-commit',
      'failed-health-rollback-relaunch-recovery',
      '2.0.15-fixes', 'built-in-tools', ...(platform === 'macos' ? ['computer-use'] : []),
    ],
    computer_use: platform === 'macos'
      ? { status: 'passed', installed_artifact_sha256: artifactSha256 }
      : { status: 'not_applicable', disposition: 'allowed_unavailable', tested: false },
    matrix_receipt: { file: `${task.toLowerCase()}-full-matrix.json`, sha256: 'f'.repeat(64) },
  }
}

function manifestInputsFixture() {
  const descriptor = (path, sha256 = '9'.repeat(64)) => ({ path, bytes: 10, sha256 })
  return {
    schema_version: 1,
    document_type: 'emate.local-manifest-input-binding',
    status: 'complete-unsigned-inputs',
    ledger: descriptor('manifest-inputs/manifest-inputs.json'),
    base_contract: {
      ...descriptor('manifest-inputs/platforms/macos/base-contract.json'),
      id: 'e-mate-desktop-profile-v14-dsh-d19aae6da310',
      schedule_protocol_floor: 1,
      harness_commit: '1'.repeat(40),
      trusted_signing_key_ids: ['e0a81164526dcbcd'],
    },
    component_inventory: descriptor('manifest-inputs/platforms/macos/component-inventory.json'),
    profile_build_receipts: {
      macos: descriptor('manifest-inputs/platforms/macos/profile-build-receipt.json'),
      windows: descriptor('manifest-inputs/platforms/windows/profile-build-receipt.json'),
    },
    platform_receipts: {
      macos: descriptor('manifest-inputs/platforms/macos/platform-inputs.json'),
      windows: descriptor('manifest-inputs/platforms/windows/platform-inputs.json'),
    },
    artifact_receipts: {
      macos: descriptor('artifacts/macos/local-artifact-receipt.json'),
      windows: descriptor('artifacts/windows/local-artifact-receipt.json'),
    },
    local_candidate_provenance: descriptor('manifest-inputs/local-candidate-provenance.json'),
    profile_signing: 'awaiting-existing-owner',
    client_compatible_provenance: 'open-existing-owner',
    targets: ['darwin-arm64', 'darwin-x64', 'win32-x64'],
  }
}

function verifiedRun(version = '2.0.15') {
  const macPrimary = { name: `e-Mate-${version}-mac-universal.dmg`, bytes: 10, sha256: MAC_SHA }
  const winPrimary = { name: `e-Mate-${version}-win-x64-Setup.exe`, bytes: 20, sha256: WIN_SHA }
  return {
    run_id: RUN_ID,
    version,
    source_commit: SHA,
    manifest_inputs: manifestInputsFixture(),
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

function bindTransaction(run, mode = run.version === '2.0.15' ? 'same-version-2.0.15-exception' : 'new-version') {
  run.release_transaction = buildReleaseTransactionPlan(run, mode)
  return run
}

function protectedSignerRun() {
  const run = verifiedRun()
  Object.assign(run, {
    schema_version: 1,
    document_type: 'emate.local-flow-run',
    command: 'candidate',
    source_branch: 'release/2.0.15',
    created_at: '2026-08-30T00:00:00.000Z',
    updated_at: '2026-08-30T01:00:00.000Z',
    status: 'built',
    platforms: {
      macos: { status: 'passed', source_commit: SHA, artifact: run.verification.artifacts.macos.primary },
      windows: {
        status: 'passed', source_commit: SHA, artifact: run.verification.artifacts.windows.primary,
        codex_remote: {
          transport: 'ssh', host: 'LAPTOP-ADQ973JN', request_sha256: '1'.repeat(64),
          receipt: 'windows-remote/result.json', receipt_sha256: '2'.repeat(64),
        },
      },
    },
    rollback: { status: 'not-requested' },
  })
  run.verification.verified_at = '2026-08-30T00:30:00.000Z'
  bindTransaction(run)
  run.publication = {
    status: 'awaiting-compatibility-attestation',
    scope: 'full',
    owner: 'github-candidate-provenance-carrier',
    immutable_request: 'publication/immutable-owner-request.json',
    immutable_request_sha256: '3'.repeat(64),
    immutable_receipt: 'publication/immutable-owner-receipt.json',
    immutable_receipt_sha256: '4'.repeat(64),
    request: 'publication/compatibility-attestation-request.json',
    request_sha256: '5'.repeat(64),
    transaction_mode: run.release_transaction.mode,
  }
  return run
}

async function fileDescriptor(root, path) {
  const bytes = await readFile(join(root, ...path.split('/')))
  return { path, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
}

function publicationFixture(run, requestSha256 = '1'.repeat(64), { dryRun = true } = {}) {
  bindTransaction(run)
  const request = buildPublicationRequest(run, { dryRun })
  const transaction = run.release_transaction
  const target = { bytes: 2961, sha256: '2'.repeat(64), etag: '2'.repeat(32) }
  const pointer = (key, cas = 'passed') => ({
    key,
    before: POINTER_BEFORE,
    after: target,
    cas,
    authenticated_readback: { status: 'passed', ...target },
    public_full_byte_readback: { status: 'passed', bytes: target.bytes, sha256: target.sha256 },
  })
  const currentPublicPointers = Object.fromEntries(Object.entries(transaction.current_public_pointers).map(([name, current]) => [name, {
    key: current.key,
    authenticated_readback: { status: 'passed', ...current.identity },
    public_full_byte_readback: { status: 'passed', bytes: current.identity.bytes, sha256: current.identity.sha256 },
  }]))
  const pointerNames = transaction.mode === 'new-version' ? ['signed'] : transaction.activation_order
  return { request, target, receipt: {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-receipt',
    operation: 'publish',
    status: 'passed',
    macos_publication_mode: 'unsigned',
    installer_security: {
      darwin: { code_signed: false, notarized: false },
      win32: { code_signed: false, notarized: false },
    },
    distribution_origin: R2_ORIGIN,
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    transaction_mode: transaction.mode,
    request_sha256: requestSha256,
    current_public_pointers: currentPublicPointers,
    manifest_admission: {
      owner: 'zyfjacksonchen-source/e-mate-desktop-publication@93c707e2b7d833db3df4ee0013455b905232e1f6',
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
      signed_manifest: { file: 'desktop-release-signed.json', bytes: target.bytes, sha256: target.sha256 },
      publication_plan: { file: 'cloudflare-publication-plan.json', sha256: '4'.repeat(64), status: 'ready-for-cloudflare-plugin' },
      admission_receipt: { file: 'cloudflare-plugin-handoff.json', sha256: '5'.repeat(64), status: 'ready-for-cloudflare-plugin' },
    },
    immutable_objects: request.immutable_objects.map(object => ({
      key: object.key, bytes: object.bytes, sha256: object.sha256,
      write: 'created', authenticated_readback: 'passed', public_readback: 'passed',
    })),
    pointers: Object.fromEntries(pointerNames.map(name => [name, pointer(transaction.current_public_pointers[name].key)])),
    activation_order: [...transaction.activation_order],
    ...(transaction.mode === 'new-version' ? { manual_manifest: {
      key: transaction.manual_manifest.key,
      write: 'created',
      after: target,
      authenticated_readback: { status: 'passed', ...target },
      public_full_byte_readback: { status: 'passed', bytes: target.bytes, sha256: target.sha256 },
    } } : {}),
    deleted_objects: [],
  } }
}

function immutablePublicationFixture(run, requestSha256 = '1'.repeat(64), { dryRun = true } = {}) {
  bindTransaction(run)
  const request = buildPublicationRequest(run, { dryRun })
  return { request, receipt: {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-receipt',
    operation: 'publish-installers-immutable',
    status: 'passed',
    authority: 'codex-cloudflare-plugin',
    release_scope: 'full-installers-immutable-only',
    macos_publication_mode: 'unsigned',
    installer_security: {
      darwin: { code_signed: false, notarized: false },
      win32: { code_signed: false, notarized: false },
    },
    distribution_origin: R2_ORIGIN,
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    transaction_mode: run.release_transaction.mode,
    request_sha256: requestSha256,
    immutable_objects: request.immutable_objects.map(object => ({
      platform: object.platform,
      key: object.key,
      url: object.url,
      bytes: object.bytes,
      sha256: object.sha256,
      write: 'created',
      authenticated_readback: { status: 'passed', bytes: object.bytes, sha256: object.sha256 },
      public_full_byte_readback: {
        status: 'passed', url: object.url, bytes: object.bytes, sha256: object.sha256,
      },
    })),
    deleted_objects: [],
  } }
}

function activationStageEvidence(run) {
  return {
    immutable_publication: {
      status: 'passed',
      request_sha256: '1'.repeat(64),
      receipt_sha256: '2'.repeat(64),
    },
    compatibility_attestation: {
      status: 'passed',
      request_sha256: '3'.repeat(64),
      repository: 'zyfjacksonchen-source/e-Mate-2.0.11',
      workflow: '.github/workflows/desktop-compatibility-attestation.yml',
      ref: 'refs/heads/main',
      head_sha: run.source_commit,
      run_id: '123',
      run_attempt: 1,
      artifact: {
        role: 'desktop_candidate',
        name: `e-mate-desktop-release-${run.source_commit}`,
        artifact_id: '456',
        digest: `sha256:${'4'.repeat(64)}`,
        exact_files: [
          'desktop-candidate.json',
          `e-Mate-${run.version}-mac-universal.dmg`,
          `e-Mate-${run.version}-win-x64-Setup.exe`,
        ],
      },
    },
  }
}

function macOnlyVerifiedRun() {
  const macPrimary = { name: 'e-Mate-2.0.15-mac-universal.dmg', bytes: 10, sha256: MAC_SHA }
  const windows = {
    status: 'REMOTE_UNAVAILABLE',
    verification: 'UNVERIFIED',
    source_commit: SHA,
    tested: false,
    reason: 'windows-remote-unavailable',
    request: 'windows-remote/request.json',
    request_sha256: '1'.repeat(64),
  }
  return {
    version: '2.0.15',
    source_commit: SHA,
    platforms: { windows },
    verification: {
      status: 'passed-macos-only',
      artifacts: {
        macos: { primary: macPrimary, files: [macPrimary, { name: `${macPrimary.name}.blockmap`, bytes: 11, sha256: MAC_BLOCKMAP_SHA }] },
      },
      computer_use: { macos: acceptance('macos', MAC_SHA) },
      windows,
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

test('candidate rejects a fallback pnpm before creating a run', async () => {
  const root = await temporary()
  const entry = join(root, 'pnpm.cjs')
  const runRoot = fileURLToPath(new URL('../dist/local-runs', import.meta.url))
  try {
    await writeFile(entry, "process.stdout.write('11.19.0\\n')\n")
    const before = await readdir(runRoot).catch(() => [])
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./local-flow.mjs', import.meta.url)), 'candidate'], {
      encoding: 'utf8',
      env: { ...process.env, npm_execpath: entry },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /INVALID_TOOLCHAIN_BOOTSTRAP.*pinned-package-manager/u)
    assert.deepEqual(await readdir(runRoot).catch(() => []), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('candidate rejects a missing Desktop npm collector carrier before creating a run', async () => {
  const root = await temporary()
  const entry = join(root, 'pnpm.cjs')
  const runRoot = fileURLToPath(new URL('../dist/local-runs', import.meta.url))
  try {
    const node = await isolatedNodeDistribution(join(root, 'node-distribution'))
    await writeFile(entry, "process.stdout.write('11.7.0\\n')\n")
    const before = await readdir(runRoot).catch(() => [])
    const result = spawnSync(node, [fileURLToPath(new URL('./local-flow.mjs', import.meta.url)), 'candidate'], {
      encoding: 'utf8',
      env: { ...process.env, COREPACK_ROOT: '', PATH: '/usr/bin:/bin', npm_execpath: entry },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /INVALID_TOOLCHAIN_BOOTSTRAP.*desktop-npm-collector/u)
    assert.deepEqual(await readdir(runRoot).catch(() => []), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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

test('candidate preflight classifies the first deterministic failure and never enters packaging', async () => {
  const trace = []
  await assert.rejects(runCandidateStages([
    { category: CANDIDATE_FAILURE.TOOLCHAIN, stage: 'pinned-package-manager', run: async () => trace.push('toolchain') },
    { category: CANDIDATE_FAILURE.SOURCE, stage: 'release-boundary', run: async () => trace.push('contract') },
    {
      category: CANDIDATE_FAILURE.SOURCE,
      stage: 'harness-client-typecheck',
      run: async () => { trace.push('client-typecheck'); throw new Error('TS18048') },
    },
    { category: CANDIDATE_FAILURE.COMPONENT_ABI, stage: 'component-emitted-abi', run: async () => trace.push('component') },
    { category: CANDIDATE_FAILURE.PACKAGING, stage: 'desktop-package', run: async () => trace.push('packaging') },
  ]), error => {
    assert.deepEqual(candidateFailureDetails(error), {
      category: 'SOURCE_GATE_FAILED', stage: 'harness-client-typecheck', error: 'TS18048',
    })
    return true
  })
  assert.deepEqual(trace, ['toolchain', 'contract', 'client-typecheck'])
})

test('a failed macOS source gate removes and invalidates the Windows request', async () => {
  const root = await temporary()
  const failure = {
    category: CANDIDATE_FAILURE.COMPONENT_ABI,
    stage: 'component-emitted-abi',
    error: 'stale Base ABI',
  }
  const run = { source_commit: SHA, platforms: { windows: { status: 'awaiting-codex-remote' } } }
  try {
    await mkdir(join(root, 'windows-remote'), { recursive: true })
    await mkdir(join(root, 'artifacts', 'windows'), { recursive: true })
    await writeFile(join(root, 'windows-remote', 'request.json'), '{}')
    await writeFile(join(root, 'artifacts', 'windows', 'candidate.exe'), 'not-product-bytes')
    await blockWindowsRemote(root, run, failure)
    await assert.rejects(readFile(join(root, 'windows-remote', 'request.json')), { code: 'ENOENT' })
    await assert.rejects(readFile(join(root, 'artifacts', 'windows', 'candidate.exe')), { code: 'ENOENT' })
    assert.deepEqual(run.platforms.windows, blockedWindowsState(SHA, failure))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('dev reuses the local classifier plan and selects the smallest local-flow check', () => {
  assert.deepEqual(devChecks({ lane: 'base' }, [
    'package.json', 'scripts/local-flow.mjs', 'scripts/local-flow.test.mjs', 'docs/development-log.md',
  ]), [
    { command: 'node', args: ['--test', 'scripts/local-flow.test.mjs'] },
    { command: 'node', args: ['scripts/change-impact.mjs', '--check-contract'] },
  ])
  assert.deepEqual(devChecks({ lane: 'base' }, [
    'scripts/local-flow.mjs', 'packages/dsh-client-shell/src/client/index.ts',
  ]), [
    { command: 'node', args: ['--test', 'scripts/local-flow.test.mjs'] },
    {
      command: 'pnpm',
      args: ['--dir', 'upstream/deepseek-harness', 'install', '--frozen-lockfile'],
      env: { CI: 'true' },
    },
    { command: 'pnpm', args: ['run', 'build:harness'] },
    { command: 'pnpm', args: ['run', 'test:fast'] },
  ])
  assert.deepEqual(devChecks({ lane: 'base' }, [
    'scripts/local-flow.mjs', 'scripts/local-flow.test.mjs',
    'scripts/create-chat-state-fixture.test.mjs', 'scripts/release.test.mjs',
    'scripts/stage-desktop-profile-artifact.mjs',
  ]), [
    { command: 'node', args: ['--test', 'scripts/local-flow.test.mjs', 'scripts/release.test.mjs'] },
    {
      command: 'pnpm',
      args: ['--dir', 'upstream/deepseek-harness', 'install', '--frozen-lockfile'],
      env: { CI: 'true' },
    },
    { command: 'pnpm', args: ['run', 'build:harness'] },
    { command: 'pnpm', args: ['run', 'test:fast'] },
  ])
  assert.deepEqual(devChecks({ lane: 'plugin-only', components: ['@e-mate/example'] }, ['packages/example/src/index.ts']), [
    { command: 'node', args: ['scripts/component-run.mjs', 'check', '--component', '@e-mate/example'] },
  ])
})

test('native Windows routing accepts only request-authorized host identities', () => {
  const request = windowsRemoteRequest({
    run_id: RUN_ID, version: '2.0.15', source_commit: SHA, source_branch: 'release/2.0.15',
  })
  assert.equal(validateRemoteHostname('LAPTOP-ADQ973JN\r\n', request), 'LAPTOP-ADQ973JN')
  assert.equal(validateRemoteHostname('DESKTOP-KH19ARC', request), 'DESKTOP-KH19ARC')
  assert.throws(() => validateRemoteHostname('win-codex', request), /not authorized/u)
  assert.throws(() => validateRemoteHostname('OTHER-HOST', request), /not authorized/u)
})

test('Windows candidate keeps one request/import seam with SSH-first and Codex Remote fallback', async () => {
  const source = await readFile(new URL('./local-flow.mjs', import.meta.url), 'utf8')
  const request = windowsRemoteRequest({
    run_id: RUN_ID, version: '2.0.15', source_commit: SHA, source_branch: 'release/2.0.15',
  })
  assert.deepEqual(request.transport, { preferred: 'ssh', fallback: 'codex-remote-handoff' })
  assert.deepEqual(request.authorized_hosts, [
    { transport: 'ssh', alias: 'win-codex', hostname: 'LAPTOP-ADQ973JN' },
    { transport: 'codex-remote-handoff', hostname: 'DESKTOP-KH19ARC' },
  ])
  assert.doesNotMatch(source, /runLogged\(['"](?:ssh|scp)['"]/u)
  assert.match(source, /emate\.local-windows-codex-remote-request/u)
  assert.match(source, /emate\.local-windows-codex-remote-result/u)
})

test('Windows Codex Remote import binds source, host, receipt, artifact bytes, and pollution', async () => {
  const root = await temporary()
  try {
    const remote = await windowsRemoteFixture(root)
    const output = join(root, 'imported')
    const imported = await importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath)
    assert.deepEqual(imported.primary, remote.fixture.primary)

    const payload = join(remote.returned, 'manifest-inputs', 'windows', 'unsigned-components', 'dsh-plugin-native', 'win32-x64', 'manifest.json')
    const payloadBytes = await readFile(payload)
    await rm(payload)
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /ENOENT|no such file/u)
    await writeFile(payload, payloadBytes)
    await writeFile(payload, Buffer.concat([payloadBytes, Buffer.from('\n')]))
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /manifest input receipt is invalid/u)
    await writeFile(payload, payloadBytes)

    await remote.writeResult(remote.fixture.files, { host: 'OTHER-HOST' })
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /not authorized/u)
    await remote.writeResult(remote.fixture.files, { transport: 'codex-remote-handoff' })
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /result receipt is invalid/u)
    await remote.writeResult(remote.fixture.files, { transport: 'codex-remote-handoff', host: 'DESKTOP-KH19ARC' })
    assert.deepEqual((await importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath)).primary, remote.fixture.primary)
    await remote.writeResult(remote.fixture.files, { schema_version: 2 })
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /result receipt is invalid/u)
    await remote.writeResult([{ ...remote.fixture.files[0], name: 'wrong.exe' }])
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /result receipt is invalid/u)

    await writeFile(join(remote.artifacts, remote.fixture.primary.name), Buffer.concat([pe(), Buffer.from('changed')]))
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /drifted/u)

    const polluted = Buffer.concat([pe(), Buffer.from('release-canary')])
    const pollutedFiles = [{
      name: remote.fixture.primary.name,
      bytes: polluted.byteLength,
      sha256: createHash('sha256').update(polluted).digest('hex'),
    }]
    await writeFile(join(remote.artifacts, remote.fixture.primary.name), polluted)
    await writeFile(join(remote.artifacts, 'local-artifact-receipt.json'), `${JSON.stringify({
      schema_version: 1,
      document_type: 'emate.local-desktop-artifact',
      platform: 'windows',
      source_commit: SHA,
      version: '2.0.15',
      files: pollutedFiles,
    }, null, 2)}\n`)
    await remote.writeResult(pollutedFiles)
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /canary marker/u)

    await writeFile(remote.requestPath, `${JSON.stringify({
      ...remote.request,
      authorized_hosts: [...remote.request.authorized_hosts, { transport: 'ssh', hostname: 'OTHER-HOST' }],
    })}\n`)
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /request is invalid/u)
    await writeFile(remote.requestPath, `${JSON.stringify({ ...remote.request, source_commit: 'd'.repeat(40) })}\n`)
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /request is invalid/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows Codex Remote import requires the exact awaiting request state', async () => {
  const root = await temporary()
  try {
    const remote = await windowsRemoteFixture(root)
    const awaiting = structuredClone(remote.run.platforms.windows)
    const invalid = [
      undefined,
      { ...awaiting, status: 'pending' },
      { ...awaiting, status: 'failed' },
      { ...awaiting, status: 'building' },
      { ...awaiting, source_commit: 'd'.repeat(40) },
      { ...awaiting, request: 'windows-remote/other.json' },
      { ...awaiting, request_sha256: 'e'.repeat(64) },
      { ...awaiting, unexpected: true },
    ]
    for (const state of invalid) {
      if (state === undefined) delete remote.run.platforms.windows
      else remote.run.platforms.windows = state
      await assert.rejects(
        importWindowsRemoteResult(remote.returned, join(root, 'imported'), remote.run, remote.requestPath),
        /exact awaiting request state/u,
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('full publication binds exact local manifest inputs and fails closed on run, file, or path drift', async () => {
  const root = await temporary()
  const directory = join(root, 'run')
  const run = { run_id: RUN_ID, version: '2.0.15', source_commit: SHA }
  try {
    await artifactFixture(join(directory, 'artifacts', 'macos'), 'macos')
    await artifactFixture(join(directory, 'artifacts', 'windows'), 'windows')
    await manifestPlatformFixture(join(directory, 'manifest-inputs', 'platforms', 'macos'), 'macos')
    await manifestPlatformFixture(join(directory, 'manifest-inputs', 'platforms', 'windows'), 'windows')
    const binding = await finalizeManifestInputLedger(directory, run)
    const ledger = await verifyManifestInputLedger(directory, run)
    assert.equal(binding.profile_signing, 'awaiting-existing-owner')
    assert.equal(binding.client_compatible_provenance, 'open-existing-owner')
    assert.deepEqual(binding.targets, ['darwin-arm64', 'darwin-x64', 'win32-x64'])
    assert.equal(ledger.files.every(file => file.path && file.bytes > 0 && /^[0-9a-f]{64}$/u.test(file.sha256)), true)
    const provenance = await readFile(join(directory, binding.local_candidate_provenance.path), 'utf8')
    assert.doesNotMatch(provenance, /github|artifact_id|build_run_id|ci_run_id|profile_run_id|\/Users\/|[A-Za-z]:\\Users\\|BEGIN [A-Z ]*PRIVATE KEY|(?:sk|rk|sess)-[A-Za-z0-9_-]{20,}/iu)

    const publishRun = bindTransaction(verifiedRun())
    publishRun.manifest_inputs = binding
    const request = buildPublicationRequest(publishRun, { dryRun: true })
    assert.equal(request.distribution_origin, R2_ORIGIN)
    assert.equal(request.operation, 'publish-installers-immutable')
    assert.equal('manifest_admission_and_signing' in request, false)
    const activation = buildActivationRequest(publishRun, {
      dryRun: true,
      stageEvidence: activationStageEvidence(publishRun),
    })
    assert.deepEqual(activation.manifest_admission_and_signing.inputs, binding)

    await writeFile(join(root, 'advanced-current-checkout.txt'), 'new unrelated source checkout state\n')
    assert.equal((await verifyManifestInputLedger(directory, run)).source_commit, SHA)

    const basePath = join(directory, binding.base_contract.path)
    const baseBytes = await readFile(basePath)
    await writeFile(basePath, Buffer.concat([baseBytes, Buffer.from('\n')]))
    await assert.rejects(verifyManifestInputLedger(directory, run), /drift|invalid/u)
    await writeFile(basePath, baseBytes)

    const platformReceiptPath = join(directory, binding.platform_receipts.windows.path)
    const platformReceiptBytes = await readFile(platformReceiptPath)
    await writeFile(platformReceiptPath, Buffer.concat([platformReceiptBytes, Buffer.from('\n')]))
    await assert.rejects(verifyManifestInputLedger(directory, run), /ledger|receipt|provenance/u)
    await writeFile(platformReceiptPath, platformReceiptBytes)

    const extra = join(directory, 'manifest-inputs', 'unexpected.txt')
    await writeFile(extra, 'unexpected\n')
    await assert.rejects(verifyManifestInputLedger(directory, run), /ledger is invalid/u)
    await rm(extra)

    const escape = join(directory, 'manifest-inputs', 'escape')
    await symlink(join(root, 'advanced-current-checkout.txt'), escape)
    await assert.rejects(verifyManifestInputLedger(directory, run), /contains a symlink/u)
    await rm(escape)

    await assert.rejects(verifyManifestInputLedger(directory, { ...run, run_id: '20260830T000000Z-bbbbbbbbbbbb-abcdef' }), /provenance|ledger/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local manifest inputs reject same-size staged Profile content drift', async () => {
  const root = await temporary()
  try {
    await manifestPlatformFixture(root, 'macos')
    await writeFile(join(root, 'profile-artifact', 'dsh-plugin-portable', 'lib', 'index.js'), 'export{ }\n')
    await assert.rejects(createPlatformManifestInputReceipt(root, {
      platform: 'macos',
      sourceCommit: SHA,
      toolchain: { node: process.versions.node, pnpm: '11.7.0', yarn: '4.18.0', npm: '11.17.0' },
    }), /Profile build receipt does not match its exact staged tree/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Windows unavailable waiver accepts only the exact awaiting Remote request and remains unverified', () => {
  const awaiting = {
    status: 'awaiting-codex-remote',
    source_commit: SHA,
    request: 'windows-remote/request.json',
    request_sha256: '1'.repeat(64),
  }
  assert.deepEqual(markWindowsUnavailable({ source_commit: SHA, platforms: { windows: awaiting } }), {
    status: 'REMOTE_UNAVAILABLE',
    verification: 'UNVERIFIED',
    source_commit: SHA,
    tested: false,
    reason: 'windows-remote-unavailable',
    request: 'windows-remote/request.json',
    request_sha256: '1'.repeat(64),
  })
  for (const state of [undefined, { ...awaiting, status: 'failed' }, { ...awaiting, status: 'building' }, {
    ...awaiting, source_commit: 'd'.repeat(40),
  }, { ...awaiting, unexpected: true }]) {
    assert.throws(() => markWindowsUnavailable({ source_commit: SHA, platforms: { windows: state } }), /exact awaiting request/u)
  }
})

test('Windows unavailable CLI flag is run-scoped and mutually exclusive with retry or result import', async () => {
  const script = fileURLToPath(new URL('./local-flow.mjs', import.meta.url))
  for (const args of [
    ['candidate', '--windows-unavailable'],
    ['candidate', '--run', RUN_ID, '--windows-unavailable', '--retry', 'windows'],
    ['candidate', '--run', RUN_ID, '--windows-unavailable', '--windows-result', 'returned'],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /candidate accepts/u)
  }
})

test('CLI normalizes exactly one leading pnpm delimiter before parsing', async () => {
  const direct = ['_platform-build', '--platform', 'windows']
  assert.deepEqual(normalizeFlowArgv(direct), direct)
  assert.deepEqual(normalizeFlowArgv(['--', ...direct]), direct)
  assert.deepEqual(normalizeFlowArgv(['--', '--', ...direct]), ['--', '--', ...direct])
  assert.deepEqual(normalizeFlowArgv(['not-a-command']), ['not-a-command'])

  const source = await readFile(new URL('./local-flow.mjs', import.meta.url), 'utf8')
  assert.match(source, /args: normalizeFlowArgv\(argv\)/u)

  const script = fileURLToPath(new URL('./local-flow.mjs', import.meta.url))
  for (const args of [['_platform-build'], ['--', '_platform-build']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /invalid internal platform build arguments/u)
  }
  for (const [args, expected] of [
    [['--', '--', '_platform-build'], /usage: pnpm flow/u],
    [['--', 'not-a-command'], /flow command must be/u],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, expected)
  }
})

test('rollback accepts only a run-scoped owner receipt import or dry run', () => {
  const script = fileURLToPath(new URL('./local-flow.mjs', import.meta.url))
  const missingRun = '20991231T235959Z-aaaaaaaaaaaa-abcdef'
  const accepted = spawnSync(process.execPath, [
    script, 'rollback', '--run', missingRun, '--owner-receipt', 'owner.json',
  ], { encoding: 'utf8' })
  assert.equal(accepted.status, 1)
  assert.doesNotMatch(accepted.stderr, /rollback requires/u)
  assert.match(accepted.stderr, /ENOENT|no such file/iu)
  const rejected = spawnSync(process.execPath, [
    script, 'rollback', '--run', missingRun, '--dry-run', '--owner-receipt', 'owner.json',
  ], { encoding: 'utf8' })
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /accepts only --dry-run or --owner-receipt/u)
})

test('rollback state is monotonic and only the exact awaiting run accepts an owner receipt', () => {
  assert.equal(rollbackAction({}, {}), 'emit')
  assert.equal(rollbackAction({}, { dryRun: true }), 'dry-run')
  assert.equal(rollbackAction({ rollback: { status: 'dry-run' } }, {}), 'emit')
  assert.throws(() => rollbackAction({ rollback: { status: 'unknown' } }, {}), /run state is invalid/u)
  assert.throws(() => rollbackAction({}, { ownerReceipt: 'owner.json' }), /exact awaiting request state/u)
  const awaiting = { rollback: { status: 'awaiting-existing-owner' } }
  assert.equal(rollbackAction(awaiting, {}), 'resume-awaiting')
  assert.equal(rollbackAction(awaiting, { ownerReceipt: 'owner.json' }), 'import')
  assert.throws(() => rollbackAction(awaiting, { dryRun: true }), /cannot return to dry-run/u)
  assert.throws(() => rollbackAction({ rollback: { status: 'passed' } }, {}), /already passed/u)
  assert.throws(() => rollbackAction({ rollback: { status: 'passed' } }, { dryRun: true }), /already passed/u)
  assert.throws(() => rollbackAction(
    { rollback: { status: 'passed' } }, { ownerReceipt: 'owner.json' },
  ), /already passed/u)
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

test('verify requires update/relaunch, failed-health rollback, and macOS Computer Use in its full installed matrix', async () => {
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
    incomplete.external_acceptance.coverage = incomplete.external_acceptance.coverage
      .filter(item => item !== 'update-download-verify-atomic-replace-relaunch-health-commit')
    await writeFile(incompleteWindows, `${JSON.stringify(incomplete)}\n`)
    await assert.rejects(verifyComputerUseReceipt(incompleteWindows, {
      platform: 'windows', sourceCommit: SHA, artifactSha256: WIN_SHA,
    }), /full installed acceptance/u)
    const noRollbackWindows = await computerUseFixture(join(root, 'no-rollback-windows'), 'windows', WIN_SHA)
    const noRollback = JSON.parse(await readFile(noRollbackWindows, 'utf8'))
    noRollback.external_acceptance.coverage = noRollback.external_acceptance.coverage
      .filter(item => item !== 'failed-health-rollback-relaunch-recovery')
    await writeFile(noRollbackWindows, `${JSON.stringify(noRollback)}\n`)
    await assert.rejects(verifyComputerUseReceipt(noRollbackWindows, {
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

test('same-version exception is frozen before immutable R2 publication and remains reversible', () => {
  const run = bindTransaction(verifiedRun())
  const publish = buildPublicationRequest(run, { dryRun: true })
  assert.equal(publish.mode, 'dry-run')
  assert.equal(publish.operation, 'publish-installers-immutable')
  assert.equal(publish.release_scope, 'full-installers-immutable-only')
  assert.equal(publish.distribution_origin, R2_ORIGIN)
  assert.equal(publish.transaction_mode, 'same-version-2.0.15-exception')
  assert.equal(publish.manual_reinstall_required_for_existing_2_0_15, true)
  assert.equal(publish.macos_publication_mode, 'unsigned')
  assert.deepEqual(publish.installer_security, {
    darwin: { code_signed: false, notarized: false },
    win32: { code_signed: false, notarized: false },
  })
  assert.equal(publish.authority, 'codex-cloudflare-plugin')
  assert.doesNotMatch(JSON.stringify(publish), /macos_signer_run_id|macos_signed_artifact_id/u)
  assert.deepEqual(publish.immutable_objects.map(item => item.key), [
    `desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-mac-universal.dmg`,
    `desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-win-x64-Setup.exe`,
  ])
  assert.deepEqual(publish.completion, {
    order: ['immutable-create-only-or-already-exact', 'authenticated-full-byte-readback', 'public-full-byte-readback'],
    terminal_state: 'immutable-installers-verified',
    next_request: 'schema-2-compatibility-attestation',
  })
  assert.doesNotMatch(JSON.stringify(publish), /desktop\/(?:manual|signed)\/|desktop\/latest\.json|desktop-release-signed|signature/iu)
  assert.deepEqual(publish.delete_objects, [])
  const activation = buildActivationRequest(run, { dryRun: true, stageEvidence: activationStageEvidence(run) })
  assert.equal(activation.mode, 'dry-run')
  assert.equal(activation.transaction_plan.mode, 'same-version-2.0.15-exception')
  assert.equal(activation.transaction_plan.manual_reinstall_required_for_existing_2_0_15, true)
  assert.deepEqual(activation.manifest_admission_and_signing.inputs, run.manifest_inputs)
  assert.equal(activation.manifest_admission_and_signing.owner,
    'zyfjacksonchen-source/e-mate-desktop-publication@93c707e2b7d833db3df4ee0013455b905232e1f6')
  assert.deepEqual(activation.manifest_admission_and_signing.signed_manifest, {
    artifact_path: 'desktop-release-signed.json',
    schema_version: 2,
    document_type: 'emate.desktop-release-manifest',
    release_status: 'admitted',
    signing_context: 'e-mate-desktop-release-manifest-v2\0',
    signature: { algorithm: 'ed25519', key_source: 'existing-base-profile_signing_keys' },
    max_bytes: 16 * 1024,
  })
  assert.deepEqual(activation.publication_and_activation.activation_order, ['manual', 'signed'])
  assert.deepEqual(Object.keys(activation.publication_and_activation.pointers), ['manual', 'signed'])
  for (const [name, key] of [
    ['manual', 'desktop/manual/v2.0.15/latest.json'],
    ['signed', 'desktop/signed/latest.json'],
  ]) {
    assert.deepEqual(activation.publication_and_activation.pointers[name], {
      key,
      expected_current: POINTER_BEFORE,
      target: {
        artifact_path: 'desktop-release-signed.json',
        bytes: 'from-manifest-admission.signed_manifest.bytes',
        sha256: 'from-manifest-admission.signed_manifest.sha256',
        etag: 'from-conditional-write-result.etag',
      },
      compare_and_swap: 'required',
      authenticated_readback: 'required',
      public_full_byte_readback: 'required',
    })
  }
  assert.deepEqual(activation.publication_and_activation.recovery, {
    accepted_current_states: ['exact-before', 'exact-after'],
    already_exact: 'idempotent',
    stale_etag: 'fail-closed',
    foreign_state: 'fail-closed',
    partial_activation: 'resume-ordered-prefix',
    crash_recovery: 'resume-same-request',
  })
  assert.equal(activation.publication_and_activation.manual_manifest.write, 'compare-and-swap')
  assert.deepEqual(activation.immutable_objects.map(object => object.action), ['require-already-exact', 'require-already-exact'])
  assert.doesNotMatch(JSON.stringify(activation), /https:\/\/github\.com|actions\/artifact/iu)
  const missingCarrier = structuredClone(activationStageEvidence(run))
  delete missingCarrier.compatibility_attestation.artifact.artifact_id
  assert.throws(() => buildActivationRequest(run, { stageEvidence: missingCarrier }), /compatibility carrier evidence/u)
  const rollback = buildRollbackRequest(run, undefined, { dryRun: true })
  assert.equal(rollback.mode, 'dry-run')
  assert.equal(rollback.distribution_origin, R2_ORIGIN)
  assert.deepEqual(rollback.rollback_order, ['signed', 'manual'])
  assert.deepEqual(rollback.pointer_compare_and_swap.map(item => item.key), [
    'desktop/signed/latest.json', 'desktop/manual/v2.0.15/latest.json',
  ])
  assert.deepEqual(rollback.owner_receipt, {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-receipt',
    operation: 'rollback',
    status: 'passed',
    authority: 'existing-desktop-manifest-admission-signing-owner+codex-cloudflare-plugin',
    distribution_origin: R2_ORIGIN,
    run_id: RUN_ID,
    version: '2.0.15',
    source_commit: SHA,
    transaction_mode: 'same-version-2.0.15-exception',
    publication_request_sha256: 'from-publication/cloudflare-owner-request.json',
    publication_receipt_sha256: 'from-publication/cloudflare-owner-receipt.json',
    rollback_request_sha256: 'sha256-of-this-exact-request',
    pointer_receipts: 'ordered-before-after-cas-authenticated-and-public-readback',
    immutable_objects: 'retained',
    manual_manifest: 'restored-by-cas',
    deleted_objects: [],
  })
  assert.deepEqual(rollback.immutable_objects.map(item => item.action), ['retain', 'retain'])
  assert.equal(rollback.immutable_objects.some(item => item.key === 'desktop/manual/v2.0.15/latest.json'), false)
  assert.deepEqual(rollback.manual_manifest, { key: 'desktop/manual/v2.0.15/latest.json', action: 'restore-by-cas' })
  assert.deepEqual(rollback.delete_objects, [])
  assert.throws(() => buildRollbackRequest(run), /publication receipt/u)
  const noWindowsMatrix = structuredClone(run)
  delete noWindowsMatrix.verification.computer_use.windows
  assert.throws(() => buildPublicationRequest(noWindowsMatrix), /both external installed acceptance receipts/u)
})

test('full publication uploads immutable R2 installers before compatibility attestation or signing', () => {
  const run = bindTransaction(verifiedRun())
  const request = buildPublicationRequest(run, { dryRun: true })
  assert.equal(request.operation, 'publish-installers-immutable')
  assert.equal(request.release_scope, 'full-installers-immutable-only')
  assert.deepEqual(request.immutable_objects.map(object => object.key), [
    `desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-mac-universal.dmg`,
    `desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-win-x64-Setup.exe`,
  ])
  assert.equal('manifest_admission_and_signing' in request, false)
  assert.equal('publication_and_activation' in request, false)
  assert.doesNotMatch(JSON.stringify(request), /desktop\/(?:manual|signed)\/|desktop\/latest\.json/iu)
})

test('immutable receipt unlocks one exact schema-2 compatibility carrier request', () => {
  const run = verifiedRun()
  const immutableRequestSha256 = '1'.repeat(64)
  const immutableReceiptSha256 = '2'.repeat(64)
  const { receipt } = immutablePublicationFixture(run, immutableRequestSha256)
  assert.equal(validateImmutablePublicationReceipt(receipt, run, immutableRequestSha256), receipt)
  const request = buildCompatibilityAttestationRequest(run, receipt, {
    immutableRequestSha256,
    immutableReceiptSha256,
  })
  assert.equal(request.control_plane, 'github-candidate-provenance-carrier')
  assert.deepEqual(request.data_plane, {
    origin: R2_ORIGIN,
    installer_download: 'cloudflare-r2-only',
    online_update: 'cloudflare-r2-only',
    rollback: 'cloudflare-r2-only',
  })
  assert.deepEqual(request.immutable_publication, {
    status: 'passed',
    request: { path: 'publication/immutable-owner-request.json', sha256: immutableRequestSha256 },
    receipt: { path: 'publication/immutable-owner-receipt.json', sha256: immutableReceiptSha256 },
  })
  assert.deepEqual(request.workflow, {
    repository: 'zyfjacksonchen-source/e-Mate-2.0.11',
    path: '.github/workflows/desktop-compatibility-attestation.yml',
    event: 'workflow_dispatch',
    ref: 'refs/heads/main',
    required_head: SHA,
    required_run_attempt: 1,
    artifact_name: `e-mate-desktop-release-${SHA}`,
    exact_files: [
      'desktop-candidate.json',
      'e-Mate-2.0.15-mac-universal.dmg',
      'e-Mate-2.0.15-win-x64-Setup.exe',
    ],
    semantics: {
      role: 'candidate-provenance-materialization',
      legacy_build_run_id: 'actual-github-workflow-run-id',
      github_built_or_tested_installer_bytes: false,
      dispatch_performed_by_local_flow: false,
    },
  })
  assert.deepEqual(Object.values(request.installers).map(installer => installer.url), [
    `${R2_ORIGIN}/desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-mac-universal.dmg`,
    `${R2_ORIGIN}/desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-win-x64-Setup.exe`,
  ])
  assert.deepEqual(Object.keys(request.inputs), [
    'source_sha', 'version', 'macos_bytes', 'macos_sha256', 'windows_bytes', 'windows_sha256',
  ])
  assert.deepEqual(request.forbidden_actions, [
    'build-installers', 'test-installers', 'sign-manifest', 'write-r2', 'activate-pointer', 'serve-user-downloads',
  ])
  assert.equal(request.provenance_requirements.run_attempt, 1)
  assert.equal(request.provenance_requirements.artifact_id, 'required-from-github-api')
  assert.equal(request.provenance_requirements.run_id, 'required-from-github-api')
  const wrongOrigin = structuredClone(receipt)
  wrongOrigin.immutable_objects[0].url = 'https://github.com/releases/file.dmg'
  assert.throws(() => validateImmutablePublicationReceipt(wrongOrigin, run, immutableRequestSha256), /receipt is invalid/u)
  const wrongReadback = structuredClone(receipt)
  wrongReadback.immutable_objects[1].public_full_byte_readback.sha256 = '3'.repeat(64)
  assert.throws(() => validateImmutablePublicationReceipt(wrongReadback, run, immutableRequestSha256), /receipt is invalid/u)
  const incomplete = structuredClone(receipt)
  incomplete.immutable_objects.pop()
  assert.throws(() => validateImmutablePublicationReceipt(incomplete, run, immutableRequestSha256), /receipt set is invalid/u)
  assert.throws(() => validateImmutablePublicationReceipt({ ...receipt, source_commit: '4'.repeat(40) }, run,
    immutableRequestSha256), /owner receipt is invalid/u)
  assert.throws(() => buildCompatibilityAttestationRequest(run, receipt, {
    immutableRequestSha256: '3'.repeat(64), immutableReceiptSha256,
  }), /receipt is invalid/u)
})

test('publication state advances monotonically and stops at the external signer handoff', () => {
  assert.equal(publicationAction({}, {}), 'emit-immutable')
  assert.equal(publicationAction({}, { dryRun: true }), 'dry-run')
  assert.throws(() => publicationAction({}, { ownerReceipt: 'receipt.json' }), /exact awaiting request state/u)
  const immutable = { publication: { status: 'awaiting-immutable-owner' } }
  assert.equal(publicationAction(immutable, {}), 'resume-immutable')
  assert.equal(publicationAction(immutable, { ownerReceipt: 'receipt.json' }), 'import-immutable')
  assert.throws(() => publicationAction(immutable, { dryRun: true }), /cannot return to dry-run/u)
  const compatibility = { publication: { status: 'awaiting-compatibility-attestation' } }
  assert.equal(publicationAction(compatibility, {}), 'resume-compatibility')
  assert.equal(publicationAction(compatibility, { compatibilityReceipt: 'receipt.json' }), 'import-compatibility')
  assert.throws(() => publicationAction(compatibility, { ownerReceipt: 'receipt.json' }), /accepts only its exact/u)
  const signingInput = { publication: { status: 'awaiting-signing-input-owner' } }
  assert.equal(publicationAction(signingInput, {}), 'resume-signing-input')
  assert.equal(publicationAction(signingInput, { ownerReceipt: 'receipt.json' }), 'import-signing-input')
  const signer = { publication: { status: 'awaiting-protected-signer' } }
  assert.equal(publicationAction(signer, {}), 'resume-signer')
  assert.throws(() => publicationAction(signer, { signerResult: 'result' }), /imported together/u)
  assert.equal(publicationAction(signer, {
    signerResult: 'result', signerResultOwnerReceipt: 'owner-receipt.json',
  }), 'import-signer')
  const activation = { publication: { status: 'awaiting-activation-owner' } }
  assert.equal(publicationAction(activation, {}), 'resume-activation')
  assert.equal(publicationAction(activation, { ownerReceipt: 'receipt.json' }), 'import-activation')
  assert.throws(() => publicationAction({ publication: { status: 'awaiting-existing-owner' } }, {}), /state is invalid/u)
  assert.throws(() => publicationAction({ publication: { status: 'passed' } }, {}), /already passed/u)
})

test('protected signer public control input is closed-schema and host allowlisted', () => {
  const run = protectedSignerRun()
  assert.equal(validatePublicControlRun(run), run)
  const unknown = structuredClone(run)
  unknown.verification.artifacts.macos.primary.note = 'not allowed'
  assert.throws(() => validatePublicControlRun(unknown), /unknown object shape/u)
  const unknownHost = structuredClone(run)
  unknownHost.platforms.windows.codex_remote.host = 'OTHER-HOST'
  assert.throws(() => validatePublicControlRun(unknownHost), /unknown host/u)
  const fallbackHost = structuredClone(run)
  fallbackHost.platforms.windows.codex_remote = {
    ...fallbackHost.platforms.windows.codex_remote,
    transport: 'codex-remote-handoff', host: 'DESKTOP-KH19ARC',
  }
  assert.equal(validatePublicControlRun(fallbackHost), fallbackHost)
  const mismatchedTransport = structuredClone(run)
  mismatchedTransport.platforms.windows.codex_remote.transport = 'codex-remote-handoff'
  assert.throws(() => validatePublicControlRun(mismatchedTransport), /unknown host|transport/u)
  const developerPath = structuredClone(run)
  developerPath.source_branch = '/Users/alice/private'
  assert.throws(() => validatePublicControlRun(developerPath), /sensitive text/u)
  const error = structuredClone(run)
  error.verification.error = 'hidden failure'
  assert.throws(() => validatePublicControlRun(error), /unknown object shape|forbidden field/u)
  const fakeReader = structuredClone(run)
  fakeReader.release_transaction.reader_attestation.expected_status = 'update-available'
  assert.throws(() => validatePublicControlRun(fakeReader), /update transaction/u)
})

test('protected signer packing binds the exact public-safe scan and rejects credential fields', async t => {
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  const run = protectedSignerRun()
  const documents = {
    'run.json': run,
    'publication/immutable-owner-request.json': { safe: 'immutable-request' },
    'publication/immutable-owner-receipt.json': { safe: 'immutable-receipt' },
    'publication/compatibility-attestation-request.json': { safe: 'compatibility-request' },
    'publication/compatibility-attestation-receipt.json': { safe: 'compatibility-receipt' },
    'profile-current-snapshot.json': { safe: 'profile-snapshot' },
    'manifest-inputs/public.json': { safe: '1234567890' },
    'artifacts/macos/local-artifact-receipt.json': { files: [run.verification.artifacts.macos.primary] },
    'artifacts/windows/local-artifact-receipt.json': { files: [run.verification.artifacts.windows.primary] },
  }
  for (const [path, value] of Object.entries(documents)) {
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true })
    await writeFile(join(root, ...path.split('/')), `${JSON.stringify(value)}\n`)
  }
  const approved = await collectSigningControlFiles(root, run)
  const publicPath = join(root, 'manifest-inputs/public.json')
  const original = await readFile(publicPath)
  const drifted = Buffer.from(original.toString('utf8').replace('safe', 'evil'))
  assert.equal(drifted.byteLength, original.byteLength)
  await writeFile(publicPath, drifted)
  await assert.rejects(createSigningControlBundle({
    root,
    output: join(root, 'drifted.emate'),
    metadata: {
      schema_version: 1,
      document_type: 'emate.local-protected-signer-control-input',
      run_id: run.run_id,
      source_commit: run.source_commit,
    },
    files: approved,
  }), /approved public-safe identity/u)
  await writeFile(publicPath, '{"api_key":"abcdefghijklmnop"}\n')
  await assert.rejects(collectSigningControlFiles(root, run), /sensitive material/u)
})

test('protected signer control request and receipt bind create-only canonical R2 bytes', () => {
  const run = protectedSignerRun()
  const bindings = {
    bundle: { path: 'publication/protected-signer-control.emate', bytes: 123, sha256: '6'.repeat(64) },
    compatibility: {
      request: { path: 'publication/compatibility-attestation-request.json', bytes: 10, sha256: '7'.repeat(64) },
      receipt: { path: 'publication/compatibility-attestation-receipt.json', bytes: 11, sha256: '8'.repeat(64) },
    },
  }
  const request = buildSigningInputOwnerRequest(run, bindings)
  assert.equal(request.control_object.key, `desktop/control/schema2-signing/${SHA}/${'6'.repeat(64)}.emate-signing-control`)
  assert.equal(request.control_object.url, `${SIGNER_R2_ORIGIN}/${request.control_object.key}`)
  const requestSha256 = '9'.repeat(64)
  const receipt = {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-receipt',
    operation: request.operation,
    status: 'passed',
    authority: request.authority,
    distribution_origin: SIGNER_R2_ORIGIN,
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    transaction_mode: run.release_transaction.mode,
    request_sha256: requestSha256,
    control_object: {
      role: request.control_object.role,
      key: request.control_object.key,
      url: request.control_object.url,
      bytes: request.control_object.bytes,
      sha256: request.control_object.sha256,
      write: 'created',
      authenticated_readback: { status: 'passed', bytes: request.control_object.bytes, sha256: request.control_object.sha256 },
      public_full_byte_readback: {
        status: 'passed', url: request.control_object.url, http_status: 200,
        bytes: request.control_object.bytes, sha256: request.control_object.sha256,
      },
    },
    deleted_objects: [],
  }
  assert.equal(validateSigningInputOwnerReceipt(receipt, request, requestSha256), receipt)
  const drift = structuredClone(receipt)
  drift.control_object.public_full_byte_readback.sha256 = 'a'.repeat(64)
  assert.throws(() => validateSigningInputOwnerReceipt(drift, request, requestSha256), /receipt is invalid/u)
})

test('workflow reconstructs the exact post-bundle dispatch request and binds both late descriptors', async () => {
  const root = await temporary()
  try {
    const run = protectedSignerRun()
    const documents = {
      'run.json': run,
      'publication/immutable-owner-request.json': { immutable: 'request' },
      'publication/immutable-owner-receipt.json': { immutable: 'receipt' },
      'publication/compatibility-attestation-request.json': { compatibility: 'request' },
      'publication/compatibility-attestation-receipt.json': {
        run: { id: '123' }, artifact: { artifact_id: '456' },
      },
    }
    for (const [path, value] of Object.entries(documents)) {
      await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true })
      await writeFile(join(root, ...path.split('/')), `${JSON.stringify(value, null, 2)}\n`)
    }
    const descriptors = {
      immutable_request: await fileDescriptor(root, 'publication/immutable-owner-request.json'),
      immutable_receipt: await fileDescriptor(root, 'publication/immutable-owner-receipt.json'),
      compatibility_request: await fileDescriptor(root, 'publication/compatibility-attestation-request.json'),
      compatibility_receipt: await fileDescriptor(root, 'publication/compatibility-attestation-receipt.json'),
      signing_input_request: { path: 'publication/signing-input-owner-request.json', bytes: 101, sha256: 'b'.repeat(64) },
      signing_input_receipt: { path: 'publication/signing-input-owner-receipt.json', bytes: 102, sha256: 'c'.repeat(64) },
    }
    const control = {
      key: `desktop/control/schema2-signing/${SHA}/${'d'.repeat(64)}.emate-signing-control`,
      url: `${SIGNER_R2_ORIGIN}/desktop/control/schema2-signing/${SHA}/${'d'.repeat(64)}.emate-signing-control`,
      bytes: 999,
      sha256: 'd'.repeat(64),
    }
    const request = buildProtectedSignerDispatchRequest(run, {
      compatibilityReceipt: documents['publication/compatibility-attestation-receipt.json'],
      controlReceipt: { control_object: control },
      descriptors,
    })
    assert.equal(request.inputs.signing_input_request_sha256, descriptors.signing_input_request.sha256)
    assert.equal(request.inputs.signing_input_receipt_sha256, descriptors.signing_input_receipt.sha256)
    assert.equal(request.expected_result.owner_receipt.required, true)
    const bytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`)
    const dispatchSha256 = createHash('sha256').update(bytes).digest('hex')
    const inputs = {
      source_sha: SHA, control_key: control.key, control_url: control.url,
      control_bytes: control.bytes, control_sha256: control.sha256,
      compatibility_run_id: '123', compatibility_artifact_id: '456',
      signing_input_request_bytes: descriptors.signing_input_request.bytes,
      signing_input_request_sha256: descriptors.signing_input_request.sha256,
      signing_input_receipt_bytes: descriptors.signing_input_receipt.bytes,
      signing_input_receipt_sha256: descriptors.signing_input_receipt.sha256,
      dispatch_request_sha256: dispatchSha256,
    }
    assert.deepEqual(await materializeProtectedSignerDispatchRequest({ runRoot: root, inputs }), request)
    assert.deepEqual(JSON.parse(await readFile(join(root, SIGNER_DISPATCH_REQUEST_PATH), 'utf8')), request)
    await rm(join(root, SIGNER_DISPATCH_REQUEST_PATH))
    await assert.rejects(() => materializeProtectedSignerDispatchRequest({
      runRoot: root, inputs: { ...inputs, dispatch_request_sha256: 'e'.repeat(64) },
    }), /digest drifted/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('compact signer result is exact-set and needs independent GitHub API owner provenance', async () => {
  const root = await temporary()
  try {
    const run = protectedSignerRun()
    const dispatch = {
      workflow: { artifact_name: `e-mate-protected-schema2-signer-${SHA}` },
      source_commit: SHA,
      run_id: run.run_id,
      action: { uses: SIGNER_ACTION_USES },
      inputs: {
        control_key: `desktop/control/schema2-signing/${SHA}/${'d'.repeat(64)}.emate-signing-control`,
        control_bytes: '999', control_sha256: 'd'.repeat(64),
        compatibility_run_id: '123', compatibility_artifact_id: '456',
      },
    }
    const runRoot = join(root, 'run')
    await mkdir(join(runRoot, 'publication'), { recursive: true })
    const dispatchBytes = Buffer.from(`${JSON.stringify(dispatch, null, 2)}\n`)
    const dispatchSha256 = createHash('sha256').update(dispatchBytes).digest('hex')
    await writeFile(join(runRoot, SIGNER_DISPATCH_REQUEST_PATH), dispatchBytes)
    const desktop = join(root, 'desktop')
    const profile = join(root, 'profile')
    const desktopFiles = [
      'cloudflare-plugin-handoff.json', 'cloudflare-publication-plan.json', 'desktop-release-signed.json',
      'desktop-update-reader-attestation.json',
    ]
    const profileFiles = [
      'profile-component-aggregate.json', 'profile-desired-state/darwin-arm64.json',
      'profile-desired-state/darwin-x64.json', 'profile-desired-state/win32-x64.json',
      'profile-publication-plan.json', 'profile-signer-result.json',
    ]
    for (const [directory, files] of [[desktop, desktopFiles], [profile, profileFiles]]) {
      for (const path of files) {
        await mkdir(join(directory, ...path.split('/').slice(0, -1)), { recursive: true })
        await writeFile(join(directory, ...path.split('/')), `${path}\n`)
      }
    }
    const output = join(root, 'result')
    const result = await assembleProtectedSignerResult({
      runRoot, desktop, profile, output,
      env: {
        GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'zyfjacksonchen-source/e-Mate-2.0.11',
        GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true',
        GITHUB_RUN_ATTEMPT: '1', GITHUB_WORKFLOW_REF: 'zyfjacksonchen-source/e-Mate-2.0.11/.github/workflows/desktop-publication.yml@refs/heads/main',
        GITHUB_SHA: SHA, GITHUB_RUN_ID: '789',
      },
    })
    const validated = await validateProtectedSignerResultDirectory(output, run, dispatch, dispatchSha256)
    const resultReceipt = await fileDescriptor(output, SIGNER_RESULT_RECEIPT)
    const exactFiles = [SIGNER_RESULT_RECEIPT, ...desktopFiles, ...profileFiles].sort()
    const ownerReceipt = {
      schema_version: 1,
      document_type: 'emate.github-protected-signer-result-owner-receipt',
      status: 'passed',
      authority: 'github-api-verification-owner',
      dispatch_request_sha256: dispatchSha256,
      repository: 'zyfjacksonchen-source/e-Mate-2.0.11',
      workflow: '.github/workflows/desktop-publication.yml',
      ref: 'refs/heads/main',
      head_sha: SHA,
      run: { id: '789', attempt: 1, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_sha: SHA },
      job: { name: 'Produce protected schema-2 signer control result', status: 'completed', conclusion: 'success', unique: true },
      artifact: {
        role: 'protected_schema2_signer_result', name: dispatch.workflow.artifact_name,
        artifact_id: '987', digest: `sha256:${'a'.repeat(64)}`, bytes: 1200, run_id: '789',
        source_commit: SHA, expired: false,
        archive: { bytes: 1200, sha256: 'a'.repeat(64), exact_files: exactFiles },
      },
      result: { receipt: resultReceipt, exact_files: exactFiles },
      verification: { protected_main: 'passed', workflow: 'passed', job: 'passed', artifact: 'passed', archive: 'passed' },
      production_state: { r2_write_performed: false, pointer_changed: false, user_download_exposed: false },
      next_owner: 'main-local-flow-activation',
    }
    assert.equal(result.github_run_id, '789')
    assert.equal(validated.receipt.artifact_name, dispatch.workflow.artifact_name)
    assert.equal(validateProtectedSignerResultOwnerReceipt(
      ownerReceipt, run, dispatch, dispatchSha256, resultReceipt,
    ), ownerReceipt)
    const expired = structuredClone(ownerReceipt)
    expired.artifact.expired = true
    assert.throws(() => validateProtectedSignerResultOwnerReceipt(
      expired, run, dispatch, dispatchSha256, resultReceipt,
    ), /owner receipt is invalid/u)
    const digestDrift = structuredClone(ownerReceipt)
    digestDrift.artifact.digest = `sha256:${'b'.repeat(64)}`
    assert.throws(() => validateProtectedSignerResultOwnerReceipt(
      digestDrift, run, dispatch, dispatchSha256, resultReceipt,
    ), /owner receipt is invalid/u)
    const bytesDrift = structuredClone(ownerReceipt)
    bytesDrift.artifact.bytes += 1
    assert.throws(() => validateProtectedSignerResultOwnerReceipt(
      bytesDrift, run, dispatch, dispatchSha256, resultReceipt,
    ), /owner receipt is invalid/u)
    await writeFile(join(output, 'extra.json'), '{}\n')
    await assert.rejects(() => validateProtectedSignerResultDirectory(output, run, dispatch, dispatchSha256), /file set/u)
    await rm(join(output, 'extra.json'))
    const signedPath = join(output, 'desktop-release-signed.json')
    const original = await readFile(signedPath)
    await writeFile(signedPath, Buffer.alloc(original.byteLength, 120))
    await assert.rejects(() => validateProtectedSignerResultDirectory(output, run, dispatch, dispatchSha256), /bytes drifted/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('version-bound R2 transaction rejects implicit choice and binds the exact public predecessor', () => {
  const sameVersionRun = verifiedRun()
  assert.throws(() => buildReleaseTransactionPlan(sameVersionRun), /explicit version choice/u)
  assert.throws(() => buildPublicationRequest(sameVersionRun), /explicit version choice/u)

  const replacement = buildReleaseTransactionPlan(sameVersionRun, 'same-version-2.0.15-exception')
  assert.equal(replacement.mode, 'same-version-2.0.15-exception')
  assert.equal(replacement.manual_reinstall_required_for_existing_2_0_15, true)
  assert.deepEqual(Object.values(replacement.current_public_pointers).map(pointer => pointer.identity), [
    POINTER_BEFORE, POINTER_BEFORE, POINTER_BEFORE,
  ])
  assert.deepEqual(replacement.activation_order, ['manual', 'signed'])
  assert.deepEqual(replacement.rollback_order, ['signed', 'manual'])
  assert.deepEqual(replacement.legacy_pointer, {
    key: 'desktop/latest.json', action: 'unchanged', reason: 'pre-2.0.15-manual-replacement-only',
  })
  assert.deepEqual(replacement.reader_attestation, {
    source_mode: 'candidate', current_version: '2.0.15', expected_status: 'up-to-date',
    installer: {
      url: `${R2_ORIGIN}/desktop/releases/v2.0.15/${SHA}/e-Mate-2.0.15-mac-universal.dmg`,
      bytes: 10, sha256: MAC_SHA,
    },
  })

  const nextVersionRun = verifiedRun('2.0.16')
  const nextVersion = buildReleaseTransactionPlan(nextVersionRun, 'new-version')
  assert.equal(nextVersion.mode, 'new-version')
  assert.equal(nextVersion.manual_reinstall_required_for_existing_2_0_15, false)
  assert.equal(nextVersion.manual_manifest.key, 'desktop/manual/v2.0.16/latest.json')
  assert.equal(nextVersion.manual_manifest.write, 'create-only')
  assert.deepEqual(nextVersion.activation_order, ['manual', 'signed'])
  assert.deepEqual(nextVersion.rollback_order, ['signed'])
  assert.equal(nextVersion.reader_attestation.source_mode, 'public-predecessor')
  assert.equal(nextVersion.reader_attestation.current_version, '2.0.15')
  assert.equal(nextVersion.reader_attestation.expected_status, 'update-available')
  assert.deepEqual(nextVersion.reader_attestation.installer, {
    url: `${R2_ORIGIN}/desktop/releases/v2.0.15/297b90df2426137edb398b023d8137a085ed8508/e-Mate-2.0.15-mac-universal.dmg`,
    bytes: 402547931,
    sha256: '6d79a359738c26a9be1d091614875ba426db5314c91f0e4afbe8b582b583ac3a',
  })

  assert.throws(() => buildReleaseTransactionPlan(sameVersionRun, 'new-version'), /version choice/u)
  assert.throws(() => buildReleaseTransactionPlan(nextVersionRun, 'same-version-2.0.15-exception'), /version choice/u)

  const drifted = bindTransaction(verifiedRun())
  drifted.release_transaction.current_public_pointers.legacy.identity.etag = '8'.repeat(32)
  assert.throws(() => buildPublicationRequest(drifted), /transaction plan drifted/u)
})

test('new-version transaction creates manual bytes, advances only signed, and freezes legacy', () => {
  const run = bindTransaction(verifiedRun('2.0.16'), 'new-version')
  const publish = buildPublicationRequest(run, { dryRun: true })
  assert.equal(publish.distribution_origin, R2_ORIGIN)
  assert.equal(publish.transaction_mode, 'new-version')
  assert.equal(publish.operation, 'publish-installers-immutable')
  assert.deepEqual(run.release_transaction.activation_order, ['manual', 'signed'])
  assert.deepEqual(run.release_transaction.manual_manifest, {
    key: 'desktop/manual/v2.0.16/latest.json',
    write: 'create-only',
    rollback: 'retain',
  })
  assert.equal(publish.immutable_objects.every(object => object.key.includes('/v2.0.16/')), true)
  assert.doesNotMatch(JSON.stringify(publish), /desktop\/(?:manual|signed)\/|desktop\/latest\.json|github\.com/iu)
  const activation = buildActivationRequest(run, { dryRun: true, stageEvidence: activationStageEvidence(run) })
  assert.deepEqual(activation.publication_and_activation.activation_order, ['manual', 'signed'])
  assert.deepEqual(Object.keys(activation.publication_and_activation.pointers), ['signed'])
  assert.deepEqual(activation.publication_and_activation.legacy_pointer, {
    key: 'desktop/latest.json', action: 'unchanged', reason: 'pre-2.0.15-manual-replacement-only',
  })
  assert.deepEqual(activation.publication_and_activation.manual_manifest, {
    key: 'desktop/manual/v2.0.16/latest.json',
    write: 'create-only',
    rollback: 'retain',
    expected_current: 'must-not-exist',
    target: {
      artifact_path: 'desktop-release-signed.json',
      bytes: 'from-manifest-admission.signed_manifest.bytes',
      sha256: 'from-manifest-admission.signed_manifest.sha256',
      etag: 'from-conditional-write-result.etag',
    },
    authenticated_readback: 'required',
    public_full_byte_readback: 'required',
  })
  assert.deepEqual(activation.publication_and_activation.pointers.signed.expected_current, POINTER_BEFORE)

  const requestSha256 = '1'.repeat(64)
  const { receipt } = publicationFixture(run, requestSha256)
  assert.equal(validatePublicationReceipt(receipt, run, requestSha256), receipt)
  assert.throws(() => validatePublicationReceipt({ ...receipt, distribution_origin: 'https://github.com/releases' }, run, requestSha256), /publication owner receipt/u)
  const staleCurrent = structuredClone(receipt)
  staleCurrent.current_public_pointers.manual.authenticated_readback.etag = '8'.repeat(32)
  assert.throws(() => validatePublicationReceipt(staleCurrent, run, requestSha256), /publication owner receipt/u)
  const publicationReceiptSha256 = '6'.repeat(64)
  const rollbackRequestSha256 = '7'.repeat(64)
  const rollback = buildRollbackRequest(run, receipt, {
    publicationRequestSha256: requestSha256,
    publicationReceiptSha256,
  })
  assert.deepEqual(rollback.rollback_order, ['signed'])
  assert.deepEqual(rollback.pointer_compare_and_swap.map(pointer => pointer.key), ['desktop/signed/latest.json'])
  assert.deepEqual(rollback.manual_manifest, { key: 'desktop/manual/v2.0.16/latest.json', action: 'retain' })
  assert.equal(rollback.delete_objects.length, 0)
  const rollbackReceipt = {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-receipt',
    operation: 'rollback',
    status: 'passed',
    authority: 'existing-desktop-manifest-admission-signing-owner+codex-cloudflare-plugin',
    distribution_origin: R2_ORIGIN,
    run_id: RUN_ID,
    version: '2.0.16',
    source_commit: SHA,
    transaction_mode: 'new-version',
    publication_request_sha256: requestSha256,
    publication_receipt_sha256: publicationReceiptSha256,
    rollback_request_sha256: rollbackRequestSha256,
    rollback_order: ['signed'],
    pointers: rollback.pointer_compare_and_swap.map(pointer => ({
      key: pointer.key,
      before: pointer.expected_current,
      after: pointer.restore,
      cas: 'passed',
      authenticated_readback: { status: 'passed', ...pointer.restore },
      public_full_byte_readback: { status: 'passed', bytes: pointer.restore.bytes, sha256: pointer.restore.sha256 },
    })),
    immutable_objects: rollback.immutable_objects.map(object => ({ key: object.key, action: 'retained' })),
    manual_manifest: { key: 'desktop/manual/v2.0.16/latest.json', action: 'retained' },
    deleted_objects: [],
  }
  assert.equal(validateRollbackReceipt(rollbackReceipt, run, {
    publicationRequestSha256: requestSha256,
    publicationReceiptSha256,
    rollbackRequestSha256,
    publicationReceipt: receipt,
    rollbackRequest: rollback,
  }), rollbackReceipt)
})

test('macOS-only waiver publishes immutable bytes without a schema-2 manifest or shared pointer mutation', () => {
  const run = macOnlyVerifiedRun()
  assert.equal('manifest_inputs' in run, false)
  const publish = buildPublicationRequest(run, { dryRun: true })
  assert.equal(publish.operation, 'publish-macos-immutable')
  assert.equal(publish.distribution_origin, R2_ORIGIN)
  assert.equal(publish.release_scope, 'macos-immutable-dmg-only')
  assert.deepEqual(publish.windows, run.verification.windows)
  assert.deepEqual(publish.installer_security, { darwin: { code_signed: false, notarized: false } })
  assert.equal(publish.immutable_objects.length, 1)
  assert.equal(publish.immutable_objects.every(item => item.platform === 'macos'), true)
  assert.equal(publish.immutable_objects[0].key.endsWith('.dmg'), true)
  assert.equal('manifest_admission_and_signing' in publish, false)
  assert.doesNotMatch(JSON.stringify(publish), /desktop\/(?:manual|signed)\/|desktop\/latest\.json/u)
  assert.deepEqual(publish.publication_and_activation.shared_update_surfaces, {
    manual_manifest: 'unchanged',
    signed_pointer: 'unchanged',
    legacy_pointer: 'unchanged',
  })
  assert.throws(() => buildRollbackRequest(run, undefined, { dryRun: true }), /no shared pointer rollback/u)
  const forged = structuredClone(run)
  forged.platforms.windows.tested = true
  assert.throws(() => buildPublicationRequest(forged), /REMOTE_UNAVAILABLE\/UNVERIFIED/u)

  const requestSha256 = '2'.repeat(64)
  const receipt = {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-receipt',
    operation: 'publish-macos-immutable',
    status: 'passed',
    release_scope: 'macos-immutable-dmg-only',
    windows: run.verification.windows,
    distribution_origin: R2_ORIGIN,
    macos_publication_mode: 'unsigned',
    installer_security: { darwin: { code_signed: false, notarized: false } },
    version: '2.0.15',
    source_commit: SHA,
    request_sha256: requestSha256,
    immutable_objects: publish.immutable_objects.map(object => ({
      key: object.key, bytes: object.bytes, sha256: object.sha256,
      write: 'created', authenticated_readback: 'passed', public_readback: 'passed',
    })),
    shared_update_surfaces: {
      manual_manifest: 'unchanged', signed_pointer: 'unchanged', legacy_pointer: 'unchanged',
    },
    deleted_objects: [],
  }
  assert.equal(validatePublicationReceipt(receipt, run, requestSha256), receipt)
  assert.throws(() => validatePublicationReceipt({
    ...receipt, shared_update_surfaces: { ...receipt.shared_update_surfaces, legacy_pointer: 'passed' },
  }, run, requestSha256), /macOS-only publication owner receipt/u)
})

test('publication receipt requires exact ordered CAS completion and per-pointer full readbacks', () => {
  const run = verifiedRun()
  const requestSha256 = '1'.repeat(64)
  const { target, receipt } = publicationFixture(run, requestSha256)
  assert.equal(validatePublicationReceipt(receipt, run, requestSha256), receipt)
  assert.throws(() => validatePublicationReceipt({ ...receipt, immutable_objects: receipt.immutable_objects.slice(1) }, run, requestSha256), /object receipt set/u)
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
      signed: { ...receipt.pointers.signed, before: { ...POINTER_BEFORE, sha256: '3'.repeat(64) } },
    },
  }, run, requestSha256), /signed pointer receipt/u)
  assert.throws(() => validatePublicationReceipt({
    ...receipt, pointers: {
      ...receipt.pointers,
      signed: { ...receipt.pointers.signed, before: { ...POINTER_BEFORE, etag: '3'.repeat(32) } },
    },
  }, run, requestSha256), /signed pointer receipt/u)
  const changedLegacyReadback = structuredClone(receipt)
  changedLegacyReadback.current_public_pointers.legacy.public_full_byte_readback.sha256 = '3'.repeat(64)
  assert.throws(() => validatePublicationReceipt(changedLegacyReadback, run, requestSha256), /publication owner receipt/u)
  assert.throws(() => validatePublicationReceipt({
    ...receipt, pointers: {
      ...receipt.pointers,
      manual: {
        ...receipt.pointers.manual,
        authenticated_readback: { ...receipt.pointers.manual.authenticated_readback, etag: '3'.repeat(32) },
      },
    },
  }, run, requestSha256), /manual pointer receipt/u)
  assert.throws(() => validatePublicationReceipt({
    ...receipt, activation_order: ['signed', 'manual'],
  }, run, requestSha256), /publication owner receipt/u)

  const crashRecovery = structuredClone(receipt)
  crashRecovery.pointers.manual.cas = 'already-exact'
  crashRecovery.pointers.signed.cas = 'already-exact'
  assert.equal(validatePublicationReceipt(crashRecovery, run, requestSha256), crashRecovery)

  const outOfOrderPartial = structuredClone(receipt)
  outOfOrderPartial.pointers.signed.cas = 'already-exact'
  assert.throws(() => validatePublicationReceipt(outOfOrderPartial, run, requestSha256), /ordered pointer recovery/u)

  const rollback = buildRollbackRequest(run, receipt)
  assert.deepEqual(rollback.rollback_order, ['signed', 'manual'])
  assert.deepEqual(rollback.pointer_compare_and_swap.map(item => item.key), [
    'desktop/signed/latest.json', 'desktop/manual/v2.0.15/latest.json',
  ])
  for (const item of rollback.pointer_compare_and_swap) {
    assert.equal(item.compare_and_swap, 'required')
    assert.equal(item.authenticated_readback, 'required')
    assert.equal(item.public_full_byte_readback, 'required')
    assert.deepEqual(item.expected_current, target)
    assert.deepEqual(item.restore, POINTER_BEFORE)
  }
})

test('final activation receipt preserves imported signer bytes and truthful E statuses', () => {
  const run = bindTransaction(verifiedRun())
  const requestSha256 = '1'.repeat(64)
  const signerResult = {
    receipt: { path: 'publication/protected-signer-result/signer-result-receipt.json', bytes: 100, sha256: '3'.repeat(64) },
    owner_receipt: {
      path: 'publication/protected-signer-result-owner-receipt.json', bytes: 101, sha256: 'a'.repeat(64),
    },
    github_run_id: '123',
    desktop: {
      signed_manifest: {
        path: 'publication/protected-signer-result/desktop-release-signed.json', bytes: 2961, sha256: '2'.repeat(64),
      },
      publication_plan: {
        path: 'publication/protected-signer-result/cloudflare-publication-plan.json', bytes: 200,
        sha256: '4'.repeat(64), status: 'ready-for-main-local-flow-activation',
      },
      signer_handoff: {
        path: 'publication/protected-signer-result/cloudflare-plugin-handoff.json', bytes: 300,
        sha256: '5'.repeat(64), status: 'passed',
      },
      update_reader_attestation: {
        path: 'publication/protected-signer-result/desktop-update-reader-attestation.json', bytes: 301,
        sha256: '9'.repeat(64),
      },
    },
    profile: {
      aggregate: {
        path: 'publication/protected-signer-result/profile-component-aggregate.json', bytes: 400,
        sha256: '6'.repeat(64), aggregate_sha256: '7'.repeat(64),
      },
      plan: { path: 'publication/protected-signer-result/profile-publication-plan.json', bytes: 500, sha256: '8'.repeat(64) },
      immutable_objects: [],
      activations: [],
    },
  }
  const missingReader = structuredClone(signerResult)
  delete missingReader.desktop.update_reader_attestation
  assert.throws(() => buildActivationRequest(run, {
    stageEvidence: activationStageEvidence(run), signerResult: missingReader,
  }), /bundled Reader/u)
  const request = buildActivationRequest(run, { stageEvidence: activationStageEvidence(run), signerResult })
  const { receipt } = publicationFixture(run, requestSha256)
  receipt.manifest_admission.signed_manifest = {
    file: 'desktop-release-signed.json', bytes: signerResult.desktop.signed_manifest.bytes,
    sha256: signerResult.desktop.signed_manifest.sha256,
  }
  receipt.manifest_admission.publication_plan = {
    file: 'cloudflare-publication-plan.json', sha256: signerResult.desktop.publication_plan.sha256,
    status: signerResult.desktop.publication_plan.status,
  }
  receipt.manifest_admission.admission_receipt = {
    file: 'cloudflare-plugin-handoff.json', sha256: signerResult.desktop.signer_handoff.sha256,
    status: signerResult.desktop.signer_handoff.status,
  }
  receipt.profile_publication = {
    status: 'passed', aggregate_sha256: signerResult.profile.aggregate.aggregate_sha256,
    immutable_objects: [], activations: [],
  }
  assert.equal(validatePublicationReceipt(receipt, run, requestSha256, request), receipt)
  const sameLengthManifestDrift = structuredClone(receipt)
  sameLengthManifestDrift.manifest_admission.signed_manifest.sha256 = '9'.repeat(64)
  assert.throws(() => validatePublicationReceipt(
    sameLengthManifestDrift, run, requestSha256, request,
  ), /drifted from imported signer bytes/u)
  const relabelledPlan = structuredClone(receipt)
  relabelledPlan.manifest_admission.publication_plan.status = 'ready-for-cloudflare-plugin'
  assert.throws(() => validatePublicationReceipt(
    relabelledPlan, run, requestSha256, request,
  ), /admission\/signature receipt/u)
  assert.equal(request.manifest_admission_and_signing.signed_manifest.bytes, 2961)
  assert.equal(request.manifest_admission_and_signing.signed_manifest.sha256, '2'.repeat(64))
  assert.equal(request.manifest_admission_and_signing.handoff.publication_plan.status,
    'ready-for-main-local-flow-activation')
  assert.equal(request.manifest_admission_and_signing.handoff.signer_handoff.status, 'passed')
  assert.equal([...request.immutable_objects, ...request.profile_publication.immutable_objects,
    ...request.profile_publication.activations.map(item => item.object)]
    .every(item => item.url.startsWith(`${R2_ORIGIN}/`)), true)
  assert.doesNotMatch(JSON.stringify(request.profile_publication), /github\.com/u)
  const publicationReceiptSha256 = 'b'.repeat(64)
  const rollback = buildRollbackRequest(run, receipt, {
    publicationRequestSha256: requestSha256, publicationReceiptSha256,
  })
  const rollbackRequestSha256 = 'c'.repeat(64)
  const rollbackReceipt = {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-receipt',
    operation: 'rollback', status: 'passed',
    authority: 'existing-desktop-manifest-admission-signing-owner+codex-cloudflare-plugin',
    run_id: run.run_id, version: run.version, source_commit: run.source_commit,
    distribution_origin: R2_ORIGIN, transaction_mode: run.release_transaction.mode,
    publication_request_sha256: requestSha256, publication_receipt_sha256: publicationReceiptSha256,
    rollback_request_sha256: rollbackRequestSha256,
    rollback_order: rollback.rollback_order,
    pointers: rollback.pointer_compare_and_swap.map(pointer => ({
      key: pointer.key, before: pointer.expected_current, after: pointer.restore, cas: 'passed',
      authenticated_readback: { status: 'passed', ...pointer.restore },
      public_full_byte_readback: { status: 'passed', bytes: pointer.restore.bytes, sha256: pointer.restore.sha256 },
    })),
    immutable_objects: rollback.immutable_objects.map(item => ({ key: item.key, action: 'retained' })),
    manual_manifest: { key: rollback.manual_manifest.key, action: 'restored-by-cas' },
    deleted_objects: [],
  }
  assert.equal(validateRollbackReceipt(rollbackReceipt, run, {
    publicationRequestSha256: requestSha256, publicationReceiptSha256, rollbackRequestSha256,
    publicationRequest: request, publicationReceipt: receipt, rollbackRequest: rollback,
  }), rollbackReceipt)
})

test('rollback receipt is owner-bound, non-transferable, ordered, and closes the exact run', async () => {
  const run = verifiedRun()
  const publicationRequestSha256 = '1'.repeat(64)
  const { receipt: publicationReceipt } = publicationFixture(run, publicationRequestSha256)
  const publicationReceiptSha256 = '6'.repeat(64)
  const rollbackRequestSha256 = '7'.repeat(64)
  const rollbackRequest = buildRollbackRequest(run, publicationReceipt, {
    publicationRequestSha256,
    publicationReceiptSha256,
  })
  const rollbackPointer = (name, cas = 'passed') => {
    const request = rollbackRequest.pointer_compare_and_swap.find(item => item.key === publicationReceipt.pointers[name].key)
    return {
      key: request.key,
      before: request.expected_current,
      after: request.restore,
      cas,
      authenticated_readback: { status: 'passed', ...request.restore },
      public_full_byte_readback: { status: 'passed', bytes: request.restore.bytes, sha256: request.restore.sha256 },
    }
  }
  const receipt = {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-receipt',
    operation: 'rollback',
    status: 'passed',
    authority: 'existing-desktop-manifest-admission-signing-owner+codex-cloudflare-plugin',
    distribution_origin: R2_ORIGIN,
    run_id: RUN_ID,
    version: '2.0.15',
    source_commit: SHA,
    transaction_mode: 'same-version-2.0.15-exception',
    publication_request_sha256: publicationRequestSha256,
    publication_receipt_sha256: publicationReceiptSha256,
    rollback_request_sha256: rollbackRequestSha256,
    rollback_order: ['signed', 'manual'],
    pointers: ['signed', 'manual'].map(name => rollbackPointer(name)),
    immutable_objects: rollbackRequest.immutable_objects.map(object => ({ key: object.key, action: 'retained' })),
    manual_manifest: { key: 'desktop/manual/v2.0.15/latest.json', action: 'restored-by-cas' },
    deleted_objects: [],
  }
  const identity = {
    publicationRequestSha256,
    publicationReceiptSha256,
    rollbackRequestSha256,
    publicationReceipt,
    rollbackRequest,
  }
  assert.equal(validateRollbackReceipt(receipt, run, identity), receipt)

  for (const invalid of [
    { ...receipt, authority: 'another-owner' },
    { ...receipt, run_id: '20260830T000000Z-aaaaaaaaaaaa-fedcba' },
    { ...receipt, source_commit: 'd'.repeat(40) },
    { ...receipt, version: '2.0.16' },
    { ...receipt, publication_request_sha256: '8'.repeat(64) },
    { ...receipt, publication_receipt_sha256: '8'.repeat(64) },
    { ...receipt, rollback_request_sha256: '8'.repeat(64) },
    { ...receipt, rollback_order: ['manual', 'signed'] },
    { ...receipt, immutable_objects: receipt.immutable_objects.slice(1) },
  ]) assert.throws(() => validateRollbackReceipt(invalid, run, identity), /rollback owner receipt/u)

  assert.throws(() => validateRollbackReceipt({
    ...receipt,
    pointers: receipt.pointers.map((pointer, index) => index === 0 ? { ...pointer, before: POINTER_BEFORE } : pointer),
  }, run, identity), /signed rollback pointer/u)
  assert.throws(() => validateRollbackReceipt({
    ...receipt,
    pointers: receipt.pointers.map((pointer, index) => index === 0 ? {
      ...pointer,
      public_full_byte_readback: { ...pointer.public_full_byte_readback, sha256: '8'.repeat(64) },
    } : pointer),
  }, run, identity), /signed rollback pointer/u)

  const resumed = structuredClone(receipt)
  resumed.pointers[0].cas = 'already-exact'
  resumed.pointers[1].cas = 'already-exact'
  assert.equal(validateRollbackReceipt(resumed, run, identity), resumed)
  const outOfOrder = structuredClone(receipt)
  outOfOrder.pointers[1].cas = 'already-exact'
  assert.throws(() => validateRollbackReceipt(outOfOrder, run, identity), /ordered rollback recovery/u)

  const root = await temporary()
  try {
    await mkdir(join(root, 'publication'), { recursive: true })
    await mkdir(join(root, 'rollback'), { recursive: true })
    const appliedPublicationRequest = buildPublicationRequest(run)
    const publicationRequestBytes = Buffer.from(`${JSON.stringify(appliedPublicationRequest, null, 2)}\n`)
    const actualPublicationRequestSha256 = createHash('sha256').update(publicationRequestBytes).digest('hex')
    const appliedPublicationReceipt = {
      ...publicationReceipt,
      request_sha256: actualPublicationRequestSha256,
    }
    const publicationReceiptBytes = Buffer.from(`${JSON.stringify(appliedPublicationReceipt, null, 2)}\n`)
    const actualPublicationReceiptSha256 = createHash('sha256').update(publicationReceiptBytes).digest('hex')
    const appliedRollbackRequest = buildRollbackRequest(run, appliedPublicationReceipt, {
      publicationRequestSha256: actualPublicationRequestSha256,
      publicationReceiptSha256: actualPublicationReceiptSha256,
    })
    const rollbackRequestBytes = Buffer.from(`${JSON.stringify(appliedRollbackRequest, null, 2)}\n`)
    const actualRollbackRequestSha256 = createHash('sha256').update(rollbackRequestBytes).digest('hex')
    await writeFile(join(root, 'publication', 'cloudflare-owner-request.json'), publicationRequestBytes)
    await writeFile(join(root, 'publication', 'cloudflare-owner-receipt.json'), publicationReceiptBytes)
    await writeFile(join(root, 'rollback', 'cloudflare-owner-request.json'), rollbackRequestBytes)
    const externalReceipt = {
      ...receipt,
      publication_request_sha256: actualPublicationRequestSha256,
      publication_receipt_sha256: actualPublicationReceiptSha256,
      rollback_request_sha256: actualRollbackRequestSha256,
    }
    const externalPath = join(root, 'owner-rollback-receipt.json')
    await writeFile(externalPath, `${JSON.stringify(externalReceipt, null, 2)}\n`)
    run.rollback = {
      status: 'awaiting-existing-owner',
      owner: receipt.authority,
      delete_objects: 0,
      request: 'rollback/cloudflare-owner-request.json',
      request_sha256: actualRollbackRequestSha256,
      publication_request_sha256: actualPublicationRequestSha256,
      publication_receipt_sha256: actualPublicationReceiptSha256,
    }
    const terminal = await importRollbackOwnerReceipt(root, run, externalPath)
    assert.equal(terminal.status, 'passed')
    assert.equal(terminal.request_sha256, actualRollbackRequestSha256)
    assert.equal(terminal.publication_receipt_sha256, actualPublicationReceiptSha256)
    assert.deepEqual(terminal.rollback_order, ['signed', 'manual'])
    assert.deepEqual(JSON.parse(await readFile(join(root, terminal.receipt), 'utf8')), externalReceipt)

    const wrongRun = structuredClone(run)
    wrongRun.rollback.request_sha256 = '8'.repeat(64)
    await assert.rejects(importRollbackOwnerReceipt(root, wrongRun, externalPath), /exact awaiting request state/u)
    await assert.rejects(importRollbackOwnerReceipt(root, run, join(root, 'missing.json')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Desktop Yarn builds reuse the inherited Corepack cache while npm gets the verified carrier', async () => {
  const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const desktopPackage = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'))
  const source = await readFile(new URL('./local-flow.mjs', import.meta.url), 'utf8')
  assert.equal(rootPackage.packageManager, 'pnpm@11.7.0')
  assert.equal(desktopPackage.packageManager, 'yarn@4.18.0')
  assert.equal([...source.matchAll(/run: \(\) => runYarn\(/gu)].length, 2)
  assert.match(source, /preparePnpmLifecycleCarrier\(sourceRoot\)/u)
  assert.match(source, /prepareNpmCollectorCarrier\(join\(sourceRoot, 'desktop'\), \{ env: buildEnv \}\)/u)
  assert.match(source, /runYarn\(\['install', '--immutable'\], \{ cwd: join\(sourceRoot, 'desktop'\), log, env: npmCollector\.env \}\)/u)
  assert.match(source, /runYarn\(\[PLATFORMS\[platform\]\.build\], \{ cwd: join\(sourceRoot, 'desktop'\), log, env: npmCollector\.env \}\)/u)
  assert.match(source, /\]\)\.finally\(\(\) => Promise\.all\(\[npmCollector\?\.cleanup\(\), pnpmCarrier\?\.cleanup\(\)\]\)\)/u)
  assert.doesNotMatch(source, /\['yarn', '--cwd', 'desktop'/u)
})

test('pinned pnpm lifecycle carrier serves nested scripts without PATH pnpm and rejects drift', async () => {
  const root = await temporary()
  let carrier
  try {
    const node = await isolatedNodeDistribution(join(root, 'node-distribution'))
    const entry = await pnpmLifecycleFixture(join(root, 'corepack-cache'))
    await writeFile(join(root, 'package.json'), `${JSON.stringify({ scripts: { nested: 'pnpm --version' } })}\n`)
    const env = { ...process.env, PATH: '/usr/bin:/bin', npm_execpath: entry }
    carrier = await preparePnpmLifecycleCarrier(root, { env, execPath: node, platform: process.platform })
    const shimRoot = carrier.env.PATH.split(delimiter)[0]

    const nested = spawnSync(node, [entry, 'run', 'nested'], { cwd: root, encoding: 'utf8', env: carrier.env })
    assert.equal(nested.status, 0, nested.stderr)
    assert.equal(nested.stdout.trim(), '11.7.0')

    await writeFile(entry, "process.stdout.write('11.7.0\\n')\n")
    const drift = process.platform === 'win32'
      ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm --version'], { cwd: root, encoding: 'utf8', env: carrier.env })
      : spawnSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8', env: carrier.env })
    assert.equal(drift.status, 1)
    assert.match(drift.stderr, /pinned pnpm entry drifted/u)

    await carrier.cleanup()
    carrier = undefined
    await assert.rejects(readdir(shimRoot), { code: 'ENOENT' })

    const wrong = await pnpmLifecycleFixture(join(root, 'wrong-corepack-cache'), '11.8.0')
    await assert.rejects(preparePnpmLifecycleCarrier(root, {
      env: { ...env, npm_execpath: wrong }, execPath: node, platform: process.platform,
    }), /requires pinned pnpm 11\.7\.0/u)

    assert.equal(
      selectWindowsPnpmCommand('C:\\Temp\\emate-pnpm\\pnpm.cmd\r\n', 'C:\\Temp\\emate-pnpm'),
      'C:\\Temp\\emate-pnpm\\pnpm.cmd',
    )
    assert.throws(
      () => selectWindowsPnpmCommand('C:\\Program Files\\nodejs\\pnpm.cmd\r\n', 'C:\\Temp\\emate-pnpm'),
      /run-scoped carrier/u,
    )
    assert.match(windowsPnpmShim('C:\\Program Files\\nodejs\\node.exe'), /"C:\\Program Files\\nodejs\\node\.exe" "%~dp0pnpm-carrier\.cjs" %\*/u)
    assert.throws(() => windowsPnpmShim('C:\\unsafe&node.exe'), /safe absolute node\.exe/u)
  } finally {
    await carrier?.cleanup()
    await rm(root, { recursive: true, force: true })
  }
})

test('Desktop npm collector uses one run-scoped shim carried by the active Node', async () => {
  const root = await temporary()
  const log = join(root, 'npm-invocations.jsonl')
  try {
    const distribution = join(root, 'node-distribution')
    const node = await isolatedNodeDistribution(distribution)
    const fixture = await npmCarrierFixture(join(root, 'corepack-distribution'))
    const env = { ...process.env, COREPACK_ROOT: fixture.corepackRoot, PATH: '/usr/bin:/bin', T25_NPM_LOG: log }
    const verified = await verifyNpmCollectorCarrier(root, { env, execPath: node, platform: 'darwin' })
    assert.equal(verified.version, '11.17.0')
    assert.equal(verified.cli, await realpath(fixture.cli))

    const carrier = await prepareNpmCollectorCarrier(root, { env, execPath: node, platform: 'darwin' })
    const shimRoot = carrier.env.PATH.split(delimiter)[0]
    try {
      const result = spawnSync('npm', NPM_COLLECTOR_ARGS, { cwd: root, encoding: 'utf8', env: carrier.env })
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout), { name: 'fixture', version: '1.0.0', dependencies: {} })
      const invocations = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      assert.equal(invocations.some(item => item.args[0] === '--version'), true)
      assert.equal(invocations.some(item => JSON.stringify(item.args) === JSON.stringify(NPM_COLLECTOR_ARGS)), true)
      assert.equal(invocations.every(item => item.execPath === verified.node), true)
    } finally {
      await carrier.cleanup()
    }
    await assert.rejects(readdir(shimRoot), { code: 'ENOENT' })

    const colocated = await npmCarrierFixture(distribution)
    const preferred = await verifyNpmCollectorCarrier(root, { env, execPath: node, platform: 'darwin' })
    assert.equal(preferred.cli, await realpath(colocated.cli))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Desktop npm collector accepts only exact LF or CRLF Node shebangs and preserves carrier rejection gates', async () => {
  const root = await temporary()
  try {
    const lf = await npmCarrierFixture(join(root, 'lf'))
    const crlf = await npmCarrierFixture(join(root, 'crlf'), { eol: '\r\n', manifest: { version: '11.12.1' } })
    assert.equal((await resolveNpmCollectorCli([lf.cli])).cli, await realpath(lf.cli))
    assert.deepEqual(await resolveNpmCollectorCli([crlf.cli]), { cli: await realpath(crlf.cli), version: '11.12.1' })

    const rejected = [
      await npmCarrierFixture(join(root, 'interpreter'), { shebang: '#!/usr/bin/node' }),
      await npmCarrierFixture(join(root, 'no-newline'), { eol: '' }),
      await npmCarrierFixture(join(root, 'wrapper'), { shebang: '#!/bin/sh' }),
      await npmCarrierFixture(join(root, 'manifest-name'), { manifest: { name: 'not-npm' } }),
      await npmCarrierFixture(join(root, 'manifest-bin'), { manifest: { bin: { npm: 'bin/wrapper.js' } } }),
      await npmCarrierFixture(join(root, 'manifest-version'), { manifest: { version: '11' } }),
      await npmCarrierFixture(join(root, 'path'), { cliName: 'wrapper.js' }),
    ]
    for (const fixture of rejected) {
      await assert.rejects(resolveNpmCollectorCli([fixture.cli]), /verified npm CLI/u)
    }

    const invalid = join(root, 'invalid-output')
    const fixture = await npmCarrierFixture(invalid, { eol: '\r\n', listOutput: 'not-json' })
    const node = join(invalid, 'bin', 'node')
    await mkdir(join(invalid, 'bin'), { recursive: true })
    await writeFile(node, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`)
    await chmod(node, 0o755)
    await assert.rejects(verifyNpmCollectorCarrier(root, {
      env: { ...process.env, COREPACK_ROOT: fixture.corepackRoot, PATH: '/usr/bin:/bin' },
      execPath: node,
      platform: 'darwin',
    }), /non-JSON output/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Desktop npm collector rejects wrappers and preserves the native Windows npm.cmd seam', async () => {
  const root = await temporary()
  try {
    const wrapper = join(root, 'npm')
    const fakeNode = join(root, 'runtime', 'bin', 'node')
    await writeFile(wrapper, "#!/bin/sh\nexec /application-bundled/node /application-bundled/npm-cli.js \"$@\"\n")
    await mkdir(join(root, 'runtime', 'bin'), { recursive: true })
    await writeFile(fakeNode, '#!/bin/sh\nexit 1\n')
    await chmod(wrapper, 0o755)
    await chmod(fakeNode, 0o755)
    await assert.rejects(resolveNpmCollectorCli([wrapper]), /verified npm CLI/u)
    await assert.rejects(verifyNpmCollectorCarrier(root, {
      env: { COREPACK_ROOT: '', PATH: root, npm_execpath: '' },
      execPath: fakeNode,
      platform: 'darwin',
    }), /verified npm CLI/u)
    assert.equal(
      selectWindowsNpmCommand(
        'C:\\Program Files\\nodejs\\npm\r\nC:\\Program Files\\nodejs\\npm.cmd\r\n',
        'C:\\Program Files\\nodejs\\node.exe',
      ),
      'C:\\Program Files\\nodejs\\npm.cmd',
    )
    assert.throws(
      () => selectWindowsNpmCommand('C:\\BundledApp\\npm.cmd\r\n', 'C:\\Program Files\\nodejs\\node.exe'),
      /same Node distribution/u,
    )
    assert.throws(
      () => selectWindowsNpmCommand(
        'C:\\BundledApp\\npm.cmd\r\nC:\\Program Files\\nodejs\\npm.cmd\r\n',
        'C:\\Program Files\\nodejs\\node.exe',
      ),
      /same Node distribution/u,
    )
    assert.throws(
      () => selectWindowsNpmCommand('C:\\Program Files\\nodejs\\npm\r\n', 'C:\\Program Files\\nodejs\\node.exe'),
      /same Node distribution/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Python selector bypasses WindowsApps aliases and rejects a missing interpreter', () => {
  const exact = 'C:\\Program Files\\Python312\\python.exe'
  const exactEnv = { EMATE_BUILD_PYTHON: exact }
  const exactCalls = []
  assert.deepEqual(selectPythonCommand({
    platform: 'win32',
    env: exactEnv,
    execute: (command, args, options) => {
      exactCalls.push([command, args, options.env])
      return { status: 0, stdout: 'Python 3.12.14\n', stderr: '' }
    },
  }), { command: exact, prefix: [] })
  assert.deepEqual(exactCalls, [[exact, ['--version'], exactEnv]])

  const invalidCalls = []
  assert.throws(() => selectPythonCommand({
    platform: 'win32',
    env: { EMATE_BUILD_PYTHON: 'C:\\missing\\python.exe' },
    execute: command => {
      invalidCalls.push(command)
      return { error: new Error('ENOENT'), status: null, stdout: '', stderr: '' }
    },
  }), /EMATE_BUILD_PYTHON/u)
  assert.deepEqual(invalidCalls, ['C:\\missing\\python.exe'])
  assert.throws(() => selectPythonCommand({
    platform: 'win32', env: { EMATE_BUILD_PYTHON: ' ' }, execute: () => assert.fail('must not spawn'),
  }), /EMATE_BUILD_PYTHON/u)

  const calls = []
  const selected = selectPythonCommand({
    platform: 'win32',
    execute: (command, args) => {
      calls.push([command, args])
      return command === 'py'
        ? { status: 0, stdout: 'Python 3.12.14\n', stderr: '' }
        : { status: 9009, stdout: '', stderr: 'Python was not found; Microsoft Store' }
    },
  })
  assert.deepEqual(selected, { command: 'py', prefix: ['-3'] })
  assert.deepEqual(calls, [['py', ['-3', '--version']]])

  assert.deepEqual(selectPythonCommand({
    platform: 'win32',
    execute: command => command === 'py'
      ? { error: new Error('ENOENT'), status: null, stdout: '', stderr: '' }
      : { status: 0, stdout: '', stderr: 'Python 3.12.14\n' },
  }), { command: 'python', prefix: [] })

  assert.throws(() => selectPythonCommand({
    platform: 'win32',
    execute: command => command === 'py'
      ? { error: new Error('ENOENT'), status: null, stdout: '', stderr: '' }
      : { status: 9009, stdout: '', stderr: 'Python was not found; Microsoft Store' },
  }), /Python 3 executable is unavailable/u)
})

test('runs exact Yarn from the inherited pnpm Corepack cache without corepack on PATH', async () => {
  const root = await temporary()
  const pnpmEntry = join(root, 'v1/pnpm/11.7.0/bin/pnpm.cjs')
  const yarnEntry = join(root, 'v1/yarn/4.18.0/yarn.js')
  const log = join(root, 'yarn-invocation.json')
  try {
    await mkdir(join(root, 'v1/pnpm/11.7.0/bin'), { recursive: true })
    await mkdir(join(root, 'v1/yarn/4.18.0'), { recursive: true })
    await writeFile(pnpmEntry, "process.stdout.write('11.7.0\\n')\n")
    await writeFile(yarnEntry, [
      "if (process.argv[2] === '--version') process.stdout.write('4.18.0\\n')",
      "else require('node:fs').writeFileSync(process.env.T25_PM_LOG, JSON.stringify(process.argv.slice(2)))",
    ].join('\n'))
    const env = { PATH: '/usr/bin:/bin', npm_execpath: pnpmEntry, T25_PM_LOG: log }
    const invocation = pinnedYarnInvocation('11.7.0', '4.18.0', ['install', '--immutable'], { env })
    const result = spawnSync(invocation.command, invocation.args, { encoding: 'utf8', env: invocation.env })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(await readFile(log, 'utf8')), ['install', '--immutable'])

    await writeFile(yarnEntry, "process.stdout.write('4.17.0\\n')\n")
    assert.throws(() => pinnedYarnInvocation('11.7.0', '4.18.0', [], { env }), /requires pinned yarn 4\.18\.0/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
    const projection = source.slice(start, source.indexOf('\n}\n\nasync function readWindowsRemoteRequest', start))
    assert.match(projection, /stage: 'root-install',\s*run: \(\) => runPnpm\(\['install', '--frozen-lockfile'\]/u)
    assert.match(projection, /runPnpm\(\['--dir', 'upstream\/deepseek-harness', 'install', '--frozen-lockfile'\], \{\s*cwd: sourceRoot, log, env: \{ \.\.\.buildEnv, CI: 'true' \},\s*\}\)/u)
    assert.match(projection, /stage: 'profile-build',\s*run: \(\) => runPnpm\(\['--config\.shell-emulator=true', '--filter', '@e-mate\/dsh', 'build'\]/u)
    assert.match(projection, /const python = selectPythonCommand\(\{ platform: expectedPlatform, env: buildEnv \}\)[\s\S]*?runLogged\(python\.command, \[\s*\.\.\.python\.prefix,/u)
    const order = ['release-boundary', 'harness-host-client-web', 'component-emitted-abi', 'desktop-package']
      .map(stage => projection.indexOf(`stage: '${stage}'`))
    assert.equal(order.every((offset, index) => offset >= 0 && (index === 0 || offset > order[index - 1])), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('root package exposes one flow entry and keeps SSH as request transport, not a second build owner', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const source = await readFile(new URL('./local-flow.mjs', import.meta.url), 'utf8')
  const ciWorkflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const publicationWorkflow = await readFile(new URL('../.github/workflows/desktop-publication.yml', import.meta.url), 'utf8')
  const updater = await readFile(new URL('../desktop/e-mate-desktop/src/update-checker.ts', import.meta.url), 'utf8')
  assert.equal(packageJson.scripts.flow, 'node scripts/local-flow.mjs')
  assert.doesNotMatch(source, /\bgh\b|\bwrangler\b|\bUU\b|runLogged\(['"](?:ssh|scp)['"]/u)
  assert.equal([...source.matchAll(/\.github\/workflows\//gu)].length, 1)
  assert.match(source, /const COMPATIBILITY_WORKFLOW = '\.github\/workflows\/desktop-compatibility-attestation\.yml'/u)
  assert.match(source, /preferred: 'ssh', fallback: 'codex-remote-handoff'/u)
  assert.match(ciWorkflow, /^on:\n\s+workflow_dispatch:/mu)
  assert.doesNotMatch(ciWorkflow, /^\s+(?:pull_request|push):/mu)
  const publish = source.slice(source.indexOf('async function publish'), source.indexOf('\nasync function rollback'))
  assert.ok(publish.indexOf('await verifyManifestInputLedger(directory, run)') >= 0)
  assert.ok(publish.indexOf('await verifyManifestInputLedger(directory, run)') < publish.indexOf('await atomicJson(immutableRequestPath, immutableRequest)'))
  assert.match(publicationWorkflow, /uses: zyfjacksonchen-source\/e-mate-desktop-publication\/local-schema2@93c707e2b7d833db3df4ee0013455b905232e1f6/u)
  assert.match(updater, /2: Buffer\.from\('e-mate-desktop-release-manifest-v2\\0', 'utf8'\)/u)
})

test('protected schema-2 signer workflow only verifies, signs, and emits compact control evidence', async () => {
  const workflow = await readFile(new URL('../.github/workflows/desktop-publication.yml', import.meta.url), 'utf8')
  const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'))
  assert.deepEqual([...inputs.matchAll(/^      ([a-z0-9_]+):$/gmu)].map(match => match[1]), [
    'source_sha', 'control_key', 'control_bytes', 'control_sha256', 'compatibility_run_id',
    'compatibility_artifact_id', 'signing_input_request_bytes', 'signing_input_request_sha256',
    'signing_input_receipt_bytes', 'signing_input_receipt_sha256', 'dispatch_request_sha256',
  ])
  assert.match(workflow, /name: Produce protected schema-2 signer control result/u)
  assert.match(workflow, /git switch -C main "\$GITHUB_SHA"/u)
  assert.match(workflow, /git status --porcelain=v1 --untracked-files=all/u)
  assert.match(workflow, /actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/u)
  assert.match(workflow, /actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/u)
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u)
  assert.match(workflow, /e-mate-desktop-publication\/local-schema2@93c707e2b7d833db3df4ee0013455b905232e1f6/u)
  assert.doesNotMatch(workflow, /uses: [^\n]+@v\d/u)
  assert.equal([...workflow.matchAll(/--write-out '%\{http_code\}'/gu)].length, 3)
  assert.equal([...workflow.matchAll(/--max-filesize/gu)].length, 3)
  assert.doesNotMatch(workflow, /curl[^\n]*--location/u)
  assert.match(workflow, /signer-transport\.mjs materialize-dispatch/u)
  assert.match(workflow, /publish-profile-r2\.mjs[\s\S]*--local-compact-output/u)
  assert.match(workflow, /signer-transport\.mjs assemble/u)
  assert.match(workflow, /verify-desktop-update-reader\.mjs/u)
  assert.match(workflow, /desktop-update-reader-attestation\.json/u)
  assert.match(workflow, /e-mate-protected-schema2-signer-\$\{\{ inputs\.source_sha \}\}/u)
  assert.match(workflow, /profile-desired-state\/darwin-arm64\.json,[^\n]*profile-desired-state\/win32-x64\.json/u)
  assert.doesNotMatch(workflow, /submodules: recursive|\bcorepack\b|\bpnpm\b|\byarn\b|\bnpm\b|\bwrangler\b|write-r2|activate-pointer/iu)
  const jobEnv = workflow.slice(workflow.indexOf('    env:'), workflow.indexOf('    steps:'))
  assert.doesNotMatch(jobEnv, /SIGNING_PRIVATE_KEY|SIGNING_KEY_ID/u)
  assert.equal([...workflow.matchAll(/EMATE_PROFILE_SIGNING_PRIVATE_KEY:/gu)].length, 2)
  assert.match(workflow, /R2_ORIGIN: https:\/\/pub-ada3f610c0234a76838f4e19fe2bb25e\.r2\.dev/u)
})

test('schema-2 candidate provenance workflow only materializes exact canonical R2 bytes', async () => {
  const workflow = await readFile(new URL('../.github/workflows/desktop-compatibility-attestation.yml', import.meta.url), 'utf8')
  const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'))
  assert.deepEqual([...inputs.matchAll(/^      ([a-z0-9_]+):$/gmu)].map(match => match[1]), [
    'source_sha', 'version', 'macos_bytes', 'macos_sha256', 'windows_bytes', 'windows_sha256',
  ])
  assert.match(workflow, /GITHUB_REF" = refs\/heads\/main/u)
  assert.equal(workflow.includes('test "${GITHUB_REF_PROTECTED:-}" = true'), true)
  assert.match(workflow, /GITHUB_RUN_ATTEMPT" = 1/u)
  assert.match(workflow, /desktop-compatibility-attestation\.yml@refs\/heads\/main/u)
  assert.match(workflow, /submodules: false/u)
  assert.match(workflow, /actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/u)
  assert.match(workflow, /actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38/u)
  assert.match(workflow, /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u)
  assert.doesNotMatch(workflow, /uses: [^\n]+@v\d/u)
  assert.match(workflow, /https:\/\/pub-ada3f610c0234a76838f4e19fe2bb25e\.r2\.dev/u)
  assert.equal([...workflow.matchAll(/--write-out '%\{http_code\}'/gu)].length, 2)
  assert.equal([...workflow.matchAll(/\)" = 200/gu)].length, 2)
  assert.match(workflow, /desktop-release-manifest\.ts candidate/u)
  assert.match(workflow, /--mac-run "\$GITHUB_RUN_ID"[\s\S]*--win-run "\$GITHUB_RUN_ID"/u)
  assert.match(workflow, /name: e-mate-desktop-release-\$\{\{ inputs\.source_sha \}\}/u)
  assert.match(workflow, /path: compatibility-carrier/u)
  assert.doesNotMatch(workflow, /accepted 2\.0\.13|2\.0\.13 schema-2 parser/u)
  assert.match(workflow, /desktop-candidate\.json,e-Mate-\$VERSION-mac-universal\.dmg,e-Mate-\$VERSION-win-x64-Setup\.exe/u)
  assert.doesNotMatch(workflow, /curl[^\n]*--location|submodules: recursive|corepack|\bpnpm\b|\byarn\b|\bnpm\b|\bwrangler\b|cloudflarestorage|EMATE_[A-Z_]*KEY|environment:/iu)
  assert.doesNotMatch(workflow, /write-r2|activate-pointer|desktop\/signed\/latest|desktop\/latest\.json|desktop\/manual\//iu)
  assert.doesNotMatch(workflow, /^\s+(?:url|installer_url):/mu)
})
