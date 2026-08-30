import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
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
  buildPublicationRequest,
  buildRollbackRequest,
  candidateFailureDetails,
  devChecks,
  importWindowsRemoteResult,
  markWindowsUnavailable,
  normalizeFlowArgv,
  prepareNpmCollectorCarrier,
  resolveNpmCollectorCli,
  runCandidateStages,
  selectWindowsNpmCommand,
  selectCandidatePlatforms,
  validateCandidateSource,
  validatePublicationReceipt,
  validateRemoteHostname,
  verifyComputerUseReceipt,
  verifyLocalArtifact,
  verifyNpmCollectorCarrier,
  windowsRemoteRequest,
} from './local-flow.mjs'
import { pinnedYarnInvocation } from './package-manager.mjs'

const SHA = 'a'.repeat(40)
const MAC_SHA = 'b'.repeat(64)
const WIN_SHA = 'c'.repeat(64)
const MAC_BLOCKMAP_SHA = 'd'.repeat(64)
const WIN_BLOCKMAP_SHA = 'e'.repeat(64)
const RUN_ID = '20260830T000000Z-aaaaaaaaaaaa-abcdef'

async function temporary() {
  return mkdtemp(join(tmpdir(), 'emate-local-flow-test-'))
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
  const resultPath = join(root, 'returned', 'codex-remote-result.json')
  const logBytes = Buffer.from('Windows build completed\n')
  await writeFile(join(root, 'returned', 'windows.log'), logBytes)
  const writeResult = async (files = fixture.files, extra = {}) => {
    const receiptBytes = await readFile(join(artifacts, 'local-artifact-receipt.json'))
    await writeFile(resultPath, `${JSON.stringify({
      schema_version: 1,
      document_type: 'emate.local-windows-codex-remote-result',
      transport: 'codex-remote-handoff',
      run_id: RUN_ID,
      version: '2.0.15',
      platform: 'windows',
      host: 'DESKTOP-KH19ARC',
      source_commit: SHA,
      request_sha256: createHash('sha256').update(requestBytes).digest('hex'),
      artifact_receipt: {
        file: 'artifacts/windows/local-artifact-receipt.json',
        sha256: createHash('sha256').update(receiptBytes).digest('hex'),
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
    await writeFile(entry, "process.stdout.write('11.7.0\\n')\n")
    const before = await readdir(runRoot).catch(() => [])
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./local-flow.mjs', import.meta.url)), 'candidate'], {
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
    { command: 'pnpm', args: ['run', 'test:fast'] },
  ])
  assert.deepEqual(devChecks({ lane: 'plugin-only', components: ['@e-mate/example'] }, ['packages/example/src/index.ts']), [
    { command: 'node', args: ['scripts/component-run.mjs', 'check', '--component', '@e-mate/example'] },
  ])
})

test('native Windows routing accepts only the Codex Remote host identity', () => {
  assert.equal(validateRemoteHostname('DESKTOP-KH19ARC\r\n'), 'DESKTOP-KH19ARC')
  assert.throws(() => validateRemoteHostname('win-codex'), /must be DESKTOP-KH19ARC/u)
})

test('Windows candidate uses one Codex Remote request/import seam without SSH transport', async () => {
  const source = await readFile(new URL('./local-flow.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bssh\b|\bscp\b|kh19arc/u)
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

    await remote.writeResult(remote.fixture.files, { host: 'OTHER-HOST' })
    await assert.rejects(importWindowsRemoteResult(remote.returned, output, remote.run, remote.requestPath), /must be DESKTOP-KH19ARC/u)
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

test('macOS-only waiver publishes immutable bytes without a schema-2 manifest or shared pointer mutation', () => {
  const run = macOnlyVerifiedRun()
  const publish = buildPublicationRequest(run, { dryRun: true })
  assert.equal(publish.operation, 'publish-macos-immutable')
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

test('Desktop Yarn builds reuse the inherited Corepack cache while npm gets the verified carrier', async () => {
  const rootPackage = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const desktopPackage = JSON.parse(await readFile(new URL('../desktop/package.json', import.meta.url), 'utf8'))
  const source = await readFile(new URL('./local-flow.mjs', import.meta.url), 'utf8')
  assert.equal(rootPackage.packageManager, 'pnpm@11.7.0')
  assert.equal(desktopPackage.packageManager, 'yarn@4.18.0')
  assert.equal([...source.matchAll(/run: \(\) => runYarn\(/gu)].length, 2)
  assert.match(source, /prepareNpmCollectorCarrier\(join\(sourceRoot, 'desktop'\)\)/u)
  assert.match(source, /runYarn\(\['install', '--immutable'\], \{ cwd: join\(sourceRoot, 'desktop'\), log, env: npmCollector\.env \}\)/u)
  assert.match(source, /runYarn\(\[PLATFORMS\[platform\]\.build\], \{ cwd: join\(sourceRoot, 'desktop'\), log, env: npmCollector\.env \}\)/u)
  assert.match(source, /\]\)\.finally\(\(\) => npmCollector\?\.cleanup\(\)\)/u)
  assert.doesNotMatch(source, /\['yarn', '--cwd', 'desktop'/u)
})

test('Desktop npm collector uses one run-scoped shim carried by the active Node', async () => {
  const root = await temporary()
  const log = join(root, 'npm-invocations.jsonl')
  try {
    const fixture = await npmCarrierFixture(root)
    const env = { ...process.env, COREPACK_ROOT: fixture.corepackRoot, PATH: '/usr/bin:/bin', T25_NPM_LOG: log }
    const verified = await verifyNpmCollectorCarrier(root, { env })
    assert.equal(verified.version, '11.17.0')
    assert.equal(verified.cli, await realpath(fixture.cli))

    const carrier = await prepareNpmCollectorCarrier(root, { env, platform: 'darwin' })
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
      selectWindowsNpmCommand('C:\\Program Files\\nodejs\\npm.cmd\r\n', 'C:\\Program Files\\nodejs\\node.exe'),
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
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
    assert.match(projection, /runPnpm\(\['--dir', 'upstream\/deepseek-harness', 'install', '--frozen-lockfile'\], \{\s*cwd: sourceRoot, log, env: \{ \.\.\.process\.env, CI: 'true' \},\s*\}\)/u)
    const order = ['release-boundary', 'harness-host-client-web', 'component-emitted-abi', 'desktop-package']
      .map(stage => projection.indexOf(`stage: '${stage}'`))
    assert.equal(order.every((offset, index) => offset >= 0 && (index === 0 || offset > order[index - 1])), true)
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
  assert.doesNotMatch(source, /\bgh\b|\.github\/|\bwrangler\b|win-codex|\bUU\b|\bssh\b|\bscp\b|kh19arc/u)
  assert.match(source, /transport: 'codex-remote-handoff'/u)
  assert.match(publicationWorkflow, /uses: zyfjacksonchen-source\/e-mate-desktop-publication@e45c3b9d1bec366ab306203574d0a7a724d7f123/u)
  assert.match(updater, /2: Buffer\.from\('e-mate-desktop-release-manifest-v2\\0', 'utf8'\)/u)
})
