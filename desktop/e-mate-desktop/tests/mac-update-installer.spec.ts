import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createMacUpdateDurableDirectory,
  claimMacUpdatePendingTransaction,
  confirmMacUpdateCommit,
  performLegacyMacUpdateSwap,
  performMacUpdateSwap,
  readMacUpdateRequest,
  readMacUpdateRequestEnvelope,
  readMacUpdateStartupResult,
  recoverPendingMacUpdateStartup,
  resumePendingMacUpdateStartup,
  waitForMacUpdateCommit,
  writeMacUpdateDurableJson,
  writeMacUpdateInstalledBaseReceipt,
  writeMacUpdateStartupAck,
  type MacUpdateDurableIO,
  type LegacyMacUpdateRequest,
  type LegacyMacUpdateSwapAdapter,
  type MacUpdateRequest,
  type MacUpdateRecoveryAdapter,
  type MacUpdateSwapAdapter,
} from '../src/mac-update-installer.ts'

const temporaryRoots: string[] = []

type DurableFailpoint = 'write' | 'file-sync' | 'file-close' | 'rename' | 'directory-sync' | 'first-directory-sync'

function durableJsonIO(failpoint?: DurableFailpoint) {
  const events: string[] = []
  const mkdirs: Array<{ path: string; mode: number }> = []
  const opens: Array<{ path: string; flags: number; mode: number | undefined }> = []
  const renames: Array<readonly [string, string]> = []
  const removed: string[] = []
  const descriptors = new Map<number, 'file' | 'directory'>()
  let directorySyncs = 0
  let temporary: string | undefined
  const io: MacUpdateDurableIO = {
    lstat: lstatSync,
    mkdir: (path, mode) => {
      mkdirs.push({ path, mode })
      mkdirSync(path, { mode })
    },
    open: (path, flags, mode) => {
      const kind = mode === 0o600 ? 'file' : 'directory'
      const descriptor = openSync(path, flags, mode)
      descriptors.set(descriptor, kind)
      opens.push({ path, flags, mode })
      events.push(`open-${kind}`)
      if (kind === 'file') temporary = path
      return descriptor
    },
    write: (descriptor, data) => {
      events.push('write-file')
      if (failpoint === 'write') throw new Error('write failed')
      writeFileSync(descriptor, data, 'utf8')
    },
    sync: (descriptor) => {
      const kind = descriptors.get(descriptor)
      if (kind === undefined) throw new Error('test descriptor is unknown')
      events.push(`sync-${kind}`)
      if (kind === 'directory') directorySyncs += 1
      if (failpoint === `${kind}-sync`) throw new Error(`${kind} fsync failed`)
      if (kind === 'directory' && failpoint === 'first-directory-sync' && directorySyncs === 1) {
        throw new Error('directory fsync failed')
      }
      fsyncSync(descriptor)
    },
    close: (descriptor) => {
      const kind = descriptors.get(descriptor)
      if (kind === undefined) throw new Error('test descriptor is unknown')
      events.push(`close-${kind}`)
      descriptors.delete(descriptor)
      closeSync(descriptor)
      if (failpoint === `${kind}-close`) throw new Error(`${kind} close failed`)
    },
    rename: (from, to) => {
      events.push('rename')
      if (failpoint === 'rename') throw new Error('rename failed')
      renames.push([from, to])
      renameSync(from, to)
    },
    remove: (path) => {
      events.push('remove')
      removed.push(path)
      rmSync(path, { force: true })
    },
  }
  return {
    events,
    io,
    mkdirs,
    opens,
    removed,
    renames,
    temporary: () => {
      if (temporary === undefined) throw new Error('test temporary path is unavailable')
      return temporary
    },
  }
}

function request(): MacUpdateRequest {
  return {
    schemaVersion: 1,
    transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    parentPid: 123,
    currentApp: '/Applications/e-Mate.app',
    appId: 'net.ecoremedia.e-mate',
    currentVersion: '2.0.10',
    targetVersion: '2.0.12',
    stagedApp: '/Applications/.e-Mate-2.0.12-aaaaaaaa.staged.app',
    backupApp: '/Applications/.e-Mate-2.0.10-aaaaaaaa.backup.app',
    failedApp: '/Applications/.e-Mate-2.0.12-aaaaaaaa.failed.app',
    trashApp: '/Users/test/.Trash/e-Mate 2.0.10 Update Backup aaaaaaaa.app',
    receiptPath: '/tmp/update/receipt.json',
    helperReadyPath: '/tmp/update/helper-ready.json',
    shutdownReadyPath: '/tmp/update/shutdown-ready.json',
    ackPath: '/tmp/update/startup-ack.json',
    ackToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    installedBaseReceiptPath: '/tmp/update/installed-base.json',
    previousInstalledBaseReceipt: null,
    sourceCommit: 'c'.repeat(40),
    baseContractId: 'e-mate-desktop-profile-v7-dsh-2bc16230975f',
    scheduleProtocolFloor: 2,
    manifestIdentity: 'f'.repeat(64),
    targetArch: process.arch === 'x64' ? 'x64' : 'arm64',
    artifact: {
      url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v2.0.12/${'c'.repeat(40)}/e-Mate-2.0.12-mac-universal.dmg`,
      bytes: 1024,
      sha256: 'd'.repeat(64),
    },
  }
}

function commitIdentity(update: MacUpdateRequest) {
  return {
    transactionId: update.transactionId,
    token: update.ackToken,
    version: update.targetVersion,
    sourceCommit: update.sourceCommit,
    baseContractId: update.baseContractId,
    scheduleProtocolFloor: update.scheduleProtocolFloor,
    manifestIdentity: update.manifestIdentity,
    artifact: update.artifact,
    currentApp: update.currentApp,
    appId: 'net.ecoremedia.e-mate',
    targetArch: update.targetArch,
  }
}

function commitMessage(update: MacUpdateRequest, type = 'emate-mac-update-commit') {
  return { schemaVersion: 1, type, ...commitIdentity(update) }
}

function durableAck(update: MacUpdateRequest) {
  return {
    schemaVersion: 1,
    status: 'healthy',
    ...commitIdentity(update),
    pid: 123,
    acknowledgedAt: '2026-08-25T00:00:00.000Z',
  }
}

function ackEnvironment(update: MacUpdateRequest, path: string): NodeJS.ProcessEnv {
  return {
    EMATE_MAC_UPDATE_ACK_PATH: path,
    EMATE_MAC_UPDATE_ACK_TOKEN: update.ackToken,
    EMATE_MAC_UPDATE_ACK_VERSION: update.targetVersion,
    EMATE_MAC_UPDATE_ACK_TRANSACTION_ID: update.transactionId,
    EMATE_MAC_UPDATE_ACK_SOURCE_COMMIT: update.sourceCommit,
    EMATE_MAC_UPDATE_ACK_BASE_CONTRACT_ID: update.baseContractId,
    EMATE_MAC_UPDATE_ACK_SCHEDULE_PROTOCOL_FLOOR: String(update.scheduleProtocolFloor),
    EMATE_MAC_UPDATE_ACK_MANIFEST_IDENTITY: update.manifestIdentity,
    EMATE_MAC_UPDATE_ACK_ARTIFACT: JSON.stringify(update.artifact),
    EMATE_MAC_UPDATE_ACK_CURRENT_APP: update.currentApp,
    EMATE_MAC_UPDATE_ACK_APP_ID: 'net.ecoremedia.e-mate',
    EMATE_MAC_UPDATE_ACK_TARGET_ARCH: update.targetArch,
  }
}

function legacyTransactionRequest(root: string) {
  const transactionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const token = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const canonicalRoot = realpathSync(root)
  const state = join(canonicalRoot, 'updates', '2.0.14', `install-${transactionId}`)
  mkdirSync(state, { recursive: true })
  const suffix = transactionId.slice(0, 8)
  const currentApp = '/Applications/e-Mate.app'
  return {
    requestPath: join(state, 'request.json'),
    ackPath: join(state, 'startup-ack.json'),
    environment: {
      EMATE_MAC_UPDATE_ACK_PATH: join(state, 'startup-ack.json'),
      EMATE_MAC_UPDATE_ACK_TOKEN: token,
      EMATE_MAC_UPDATE_ACK_VERSION: '2.0.14',
    } satisfies NodeJS.ProcessEnv,
    request: {
      schemaVersion: 1,
      transactionId,
      parentPid: 123,
      currentApp,
      currentVersion: '2.0.12',
      targetVersion: '2.0.14',
      stagedApp: `/Applications/.e-Mate-2.0.14-${suffix}.staged.app`,
      backupApp: `/Applications/.e-Mate-2.0.12-${suffix}.backup.app`,
      failedApp: `/Applications/.e-Mate-2.0.14-${suffix}.failed.app`,
      trashApp: join(homedir(), '.Trash', `e-Mate 2.0.12 Update Backup ${suffix}.app`),
      receiptPath: join(state, 'receipt.json'),
      helperReadyPath: join(state, 'helper-ready.json'),
      shutdownReadyPath: join(state, 'shutdown-ready.json'),
      ackPath: join(state, 'startup-ack.json'),
      ackToken: token,
    },
  }
}

function installedBaseReceipt(update: MacUpdateRequest) {
  return {
    schemaVersion: 1,
    documentType: 'emate.installed-base-receipt',
    transactionId: update.transactionId,
    appVersion: update.targetVersion,
    sourceCommit: update.sourceCommit,
    baseContractId: update.baseContractId,
    scheduleProtocolFloor: update.scheduleProtocolFloor,
    manifestIdentity: update.manifestIdentity,
    currentApp: update.currentApp,
    appId: 'net.ecoremedia.e-mate',
    targetArch: update.targetArch,
    carrier: { kind: 'dmg', artifact: update.artifact },
    installedAt: '2026-08-25T00:00:00.000Z',
  }
}

function transactionReceipt(update: MacUpdateRequest, status: string) {
  return {
    schemaVersion: 1,
    transactionId: update.transactionId,
    status,
    token: update.ackToken,
    currentVersion: update.currentVersion,
    targetVersion: update.targetVersion,
    sourceCommit: update.sourceCommit,
    baseContractId: update.baseContractId,
    scheduleProtocolFloor: update.scheduleProtocolFloor,
    manifestIdentity: update.manifestIdentity,
    artifact: update.artifact,
    currentApp: update.currentApp,
    appId: 'net.ecoremedia.e-mate',
    targetArch: update.targetArch,
    updatedAt: '2026-08-25T00:00:02.000Z',
  }
}

function transactionRequest(root: string, transactionId = request().transactionId): { update: MacUpdateRequest; requestPath: string } {
  const base = request()
  const canonicalRoot = realpathSync(root)
  const state = join(canonicalRoot, 'updates', base.targetVersion, `install-${transactionId}`)
  mkdirSync(state, { recursive: true })
  const suffix = transactionId.slice(0, 8)
  const update: MacUpdateRequest = {
    ...base,
    transactionId,
    stagedApp: `/Applications/.e-Mate-${base.targetVersion}-${suffix}.staged.app`,
    backupApp: `/Applications/.e-Mate-${base.currentVersion}-${suffix}.backup.app`,
    failedApp: `/Applications/.e-Mate-${base.targetVersion}-${suffix}.failed.app`,
    trashApp: join(homedir(), '.Trash', `e-Mate ${base.currentVersion} Update Backup ${suffix}.app`),
    receiptPath: join(state, 'receipt.json'),
    helperReadyPath: join(state, 'helper-ready.json'),
    shutdownReadyPath: join(state, 'shutdown-ready.json'),
    ackPath: join(state, 'startup-ack.json'),
    installedBaseReceiptPath: join(canonicalRoot, 'updates', 'installed-base.json'),
  }
  return { update, requestPath: join(state, 'request.json') }
}

function adapter(
  events: string[],
  healthy: () => Promise<void>,
  candidateExits: boolean[] = [true],
): MacUpdateSwapAdapter {
  return {
    validateTarget: (path, version) => { events.push(`validate-target:${path}:${version}`) },
    validateInstalled: (path, version) => { events.push(`validate-installed:${path}:${version}`) },
    assertMissing: path => { events.push(`missing:${path}`) },
    rename: (from, to) => { events.push(`rename:${from}:${to}`) },
    remove: path => { events.push(`remove:${path}`) },
    launch: (path, _update, updated) => {
      events.push(`launch:${path}:${updated ? 'update' : 'rollback'}`)
      return { pid: 456, exitCode: null, signalCode: null } as never
    },
    waitForHealthy: async () => { await healthy() },
    signalCandidate: (_child, signal) => { events.push(`signal:${signal}`) },
    waitForExit: async (_child, timeoutMs) => {
      const exited = candidateExits.shift() ?? false
      events.push(`candidate-${exited ? 'gone' : 'alive'}:${String(timeoutMs)}`)
      return exited
    },
    confirmCandidate: async update => { events.push(`confirm:${update.transactionId}`) },
    writeInstalledBaseReceipt: update => {
      events.push(`installed-base:${update.transactionId}`)
      return () => { events.push(`restore-installed-base:${update.transactionId}`) }
    },
    validateInstalledBaseReceipt: () => {},
    writeReceipt: (_update, status) => { events.push(`receipt:${status}`) },
    armConfirmation: () => {},
  }
}

function legacyAdapter(events: string[], healthy: () => Promise<void>): LegacyMacUpdateSwapAdapter {
  return {
    validateTarget: (path, version) => { events.push(`validate-target:${path}:${version}`) },
    validateInstalled: (path, version) => { events.push(`validate-installed:${path}:${version}`) },
    assertMissing: path => { events.push(`missing:${path}`) },
    rename: (from, to) => { events.push(`rename:${from}:${to}`) },
    remove: path => { events.push(`remove:${path}`) },
    launch: (path, _update, updated) => {
      events.push(`launch:${path}:${updated ? 'update' : 'rollback'}`)
      return { pid: undefined, exitCode: null, signalCode: null } as never
    },
    waitForHealthy: async () => { await healthy() },
    writeReceipt: (_update, status) => { events.push(`receipt:${status}`) },
  }
}

function ipcCandidate(message?: unknown, applied?: unknown, stayAlive = false) {
  return spawn(process.execPath, ['--eval', [
    "const message = process.env.EMATE_TEST_IPC === undefined ? undefined : JSON.parse(process.env.EMATE_TEST_IPC)",
    "const applied = process.env.EMATE_TEST_APPLIED === undefined ? undefined : JSON.parse(process.env.EMATE_TEST_APPLIED)",
    "process.on('message', value => { if (value?.type !== 'emate-mac-update-commit-confirmed') return; if (applied !== undefined) process.send?.(applied, () => process.exit(0)); else if (process.env.EMATE_TEST_STAY !== '1') process.exit(0) })",
    "if (message !== undefined) process.send?.(message)",
    stayAlive ? 'setInterval(() => {}, 1000)' : 'setTimeout(() => process.exit(0), 10)',
  ].join(';')], {
    env: {
      ...process.env,
      ...(message === undefined ? {} : { EMATE_TEST_IPC: JSON.stringify(message) }),
      ...(applied === undefined ? {} : { EMATE_TEST_APPLIED: JSON.stringify(applied) }),
      ...(stayAlive ? { EMATE_TEST_STAY: '1' } : {}),
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('detached macOS update replacement', () => {
  it('creates each missing transaction directory then fsyncs its parent in order', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-durable-directory-'))
    temporaryRoots.push(root)
    const updates = join(root, 'updates')
    const version = join(updates, '2.0.13')
    const stateDirectory = join(version, 'install-transaction')
    const harness = durableJsonIO()

    createMacUpdateDurableDirectory(stateDirectory, harness.io)

    expect(harness.mkdirs).toEqual([
      { path: updates, mode: 0o700 },
      { path: version, mode: 0o700 },
      { path: stateDirectory, mode: 0o700 },
    ])
    expect(harness.opens.map(entry => entry.path)).toEqual([root, updates, version])
    expect(harness.events).toEqual([
      'open-directory', 'sync-directory', 'close-directory',
      'open-directory', 'sync-directory', 'close-directory',
      'open-directory', 'sync-directory', 'close-directory',
    ])
  })

  it('stops the missing directory chain when a parent-directory fsync fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-durable-directory-'))
    temporaryRoots.push(root)
    const updates = join(root, 'updates')
    const stateDirectory = join(updates, '2.0.13', 'install-transaction')
    const harness = durableJsonIO('directory-sync')

    expect(() => createMacUpdateDurableDirectory(stateDirectory, harness.io))
      .toThrow('directory fsync failed')

    expect(harness.mkdirs).toEqual([{ path: updates, mode: 0o700 }])
    expect(harness.events).toEqual(['open-directory', 'sync-directory', 'close-directory'])
    expect(lstatSync(updates).isDirectory()).toBe(true)
    expect(() => lstatSync(join(updates, '2.0.13'))).toThrow()
  })

  it('commits the transaction directory before the detached helper can start', () => {
    const source = readFileSync(new URL('../src/mac-update-installer.ts', import.meta.url), 'utf8')
    const durableDirectory = source.indexOf('createMacUpdateDurableDirectory(stateDirectory)')
    const helperSpawn = source.indexOf('helper = spawn(', durableDirectory)

    expect(durableDirectory).toBeGreaterThanOrEqual(0)
    expect(helperSpawn).toBeGreaterThan(durableDirectory)
  })

  it('atomically rejects a concurrent macOS update owner', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-pending-owner-'))
    temporaryRoots.push(root)
    const first = transactionRequest(root)
    const second = transactionRequest(root, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
    writeMacUpdateDurableJson(first.requestPath, first.update)
    writeMacUpdateDurableJson(second.requestPath, second.update)

    claimMacUpdatePendingTransaction(first.update, first.requestPath)

    expect(() => claimMacUpdatePendingTransaction(second.update, second.requestPath))
      .toThrow('another macOS update transaction is pending')
    expect(JSON.parse(readFileSync(join(root, 'updates', 'pending-mac-update.json'), 'utf8')))
      .toEqual(expect.objectContaining(commitIdentity(first.update)))
  })

  it('rejects a symlinked or schema-expanded helper request', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-helper-request-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    const referent = join(dirname(requestPath), 'request-referent.json')
    writeFileSync(referent, JSON.stringify(update))
    symlinkSync(referent, requestPath)

    expect(() => readMacUpdateRequest(requestPath)).toThrow('not a real file')

    rmSync(requestPath)
    writeFileSync(requestPath, JSON.stringify({ ...update, unexpected: true }))
    expect(() => readMacUpdateRequest(requestPath)).toThrow('request is invalid')
  })

  it('selects the exact 2.0.12 request envelope before modern validation', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-legacy-helper-request-'))
    temporaryRoots.push(root)
    const legacy = legacyTransactionRequest(root)
    writeMacUpdateDurableJson(legacy.requestPath, legacy.request)

    expect(readMacUpdateRequestEnvelope(legacy.requestPath)).toEqual({
      kind: 'legacy-2.0.12',
      request: legacy.request,
    })

    writeMacUpdateDurableJson(legacy.requestPath, { ...legacy.request, unexpected: true })
    expect(() => readMacUpdateRequestEnvelope(legacy.requestPath)).toThrow('request envelope is invalid')
  })

  it('keeps bound update requests on the modern protocol', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-bound-helper-request-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    writeMacUpdateDurableJson(requestPath, update)

    expect(readMacUpdateRequestEnvelope(requestPath)).toEqual({ kind: 'bound-v1', request: update })
  })

  it('rejects a symlinked pending owner receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-pending-owner-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    writeMacUpdateDurableJson(requestPath, update)
    const referent = join(root, 'pending-referent.json')
    writeFileSync(referent, JSON.stringify({ requestPath }))
    symlinkSync(referent, join(root, 'updates', 'pending-mac-update.json'))

    expect(() => recoverPendingMacUpdateStartup(
      root,
      update.targetVersion,
      join(update.currentApp, 'Contents', 'MacOS', 'e-Mate'),
    )).toThrow('not a real file')
  })

  it('durably publishes private JSON in file-sync, rename, directory-sync order', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-durable-json-'))
    temporaryRoots.push(root)
    const target = join(root, 'receipt.json')
    writeFileSync(target, 'old', { mode: 0o644 })
    const harness = durableJsonIO()

    writeMacUpdateDurableJson(target, { status: 'healthy' }, harness.io)

    expect(harness.events).toEqual([
      'open-file', 'write-file', 'sync-file', 'close-file', 'rename',
      'open-directory', 'sync-directory', 'close-directory',
    ])
    expect(harness.opens).toEqual([
      {
        path: harness.temporary(),
        flags: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        mode: 0o600,
      },
      { path: root, flags: constants.O_RDONLY, mode: undefined },
    ])
    expect(dirname(harness.temporary())).toBe(root)
    expect(harness.renames).toEqual([[harness.temporary(), target]])
    expect(harness.removed).toEqual([])
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ status: 'healthy' })
    if (process.platform !== 'win32') expect(statSync(target).mode & 0o777).toBe(0o600)
  })

  it('keeps the old target and cleans only its temporary file when file fsync fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-durable-json-'))
    temporaryRoots.push(root)
    const target = join(root, 'receipt.json')
    writeFileSync(target, 'old')
    const harness = durableJsonIO('file-sync')

    expect(() => writeMacUpdateDurableJson(target, { status: 'healthy' }, harness.io))
      .toThrow('file fsync failed')

    expect(harness.events).toEqual(['open-file', 'write-file', 'sync-file', 'close-file', 'remove'])
    expect(harness.renames).toEqual([])
    expect(harness.removed).toEqual([harness.temporary()])
    expect(readFileSync(target, 'utf8')).toBe('old')
    expect(readdirSync(root)).toEqual(['receipt.json'])
  })

  it('reports directory fsync failure after rename without claiming durable success', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-durable-json-'))
    temporaryRoots.push(root)
    const target = join(root, 'receipt.json')
    writeFileSync(target, 'old')
    const harness = durableJsonIO('directory-sync')

    expect(() => writeMacUpdateDurableJson(target, { status: 'healthy' }, harness.io))
      .toThrow('directory fsync failed')

    expect(harness.events).toEqual([
      'open-file', 'write-file', 'sync-file', 'close-file', 'rename',
      'open-directory', 'sync-directory', 'close-directory',
    ])
    expect(harness.renames).toEqual([[harness.temporary(), target]])
    expect(harness.removed).toEqual([])
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ status: 'healthy' })
  })

  it.each([
    ['write', 'write failed', ['open-file', 'write-file', 'close-file', 'remove']],
    ['file-close', 'file close failed', ['open-file', 'write-file', 'sync-file', 'close-file', 'remove']],
    ['rename', 'rename failed', ['open-file', 'write-file', 'sync-file', 'close-file', 'rename', 'remove']],
  ] as const)('preserves the old target and cleans the exact temporary on %s failure', (failpoint, message, events) => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-durable-json-'))
    temporaryRoots.push(root)
    const target = join(root, 'receipt.json')
    writeFileSync(target, 'old')
    const harness = durableJsonIO(failpoint)

    expect(() => writeMacUpdateDurableJson(target, { status: 'healthy' }, harness.io)).toThrow(message)

    expect(harness.events).toEqual(events)
    expect(harness.removed).toEqual([harness.temporary()])
    expect(readFileSync(target, 'utf8')).toBe('old')
    expect(readdirSync(root)).toEqual(['receipt.json'])
  })

  it('performs zero filesystem I/O on Windows', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-durable-json-'))
    temporaryRoots.push(root)
    const harness = durableJsonIO()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')

    expect(() => writeMacUpdateDurableJson(join(root, 'receipt.json'), { status: 'healthy' }, harness.io))
      .toThrow('unavailable on Windows')

    expect(harness.events).toEqual([])
    expect(harness.opens).toEqual([])
    expect(harness.mkdirs).toEqual([])
    expect(readdirSync(root)).toEqual([])
  })

  it('replaces a target symlink without modifying its referent', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-durable-json-'))
    temporaryRoots.push(root)
    const referent = join(root, 'referent.json')
    const target = join(root, 'receipt.json')
    writeFileSync(referent, 'referent')
    symlinkSync(referent, target)

    writeMacUpdateDurableJson(target, { status: 'healthy' })

    expect(lstatSync(target).isSymbolicLink()).toBe(false)
    expect(JSON.parse(readFileSync(target, 'utf8'))).toEqual({ status: 'healthy' })
    expect(readFileSync(referent, 'utf8')).toBe('referent')
  })

  it('moves the validated old app to Trash only after the new app reports healthy', async () => {
    const events: string[] = []
    const update = request()

    await performMacUpdateSwap(update, adapter(events, async () => { events.push('healthy') }))

    expect(events).toEqual([
      `validate-target:${update.stagedApp}:2.0.12`,
      `validate-installed:${update.currentApp}:2.0.10`,
      `missing:${update.backupApp}`,
      `missing:${update.failedApp}`,
      `missing:${update.trashApp}`,
      `rename:${update.currentApp}:${update.backupApp}`,
      `rename:${update.stagedApp}:${update.currentApp}`,
      `validate-target:${update.currentApp}:2.0.12`,
      'receipt:installed-awaiting-health',
      `launch:${update.currentApp}:update`,
      'healthy',
      `installed-base:${update.transactionId}`,
      `confirm:${update.transactionId}`,
      'receipt:completed',
      `rename:${update.backupApp}:${update.trashApp}`,
    ])
  })

  it('upgrades an exact 2.0.12 request only after the 2.0.14 legacy acknowledgement is healthy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-legacy-swap-'))
    temporaryRoots.push(root)
    const update = legacyTransactionRequest(root).request as LegacyMacUpdateRequest
    const events: string[] = []

    await performLegacyMacUpdateSwap(update, legacyAdapter(events, async () => { events.push('healthy') }))

    expect(events).toEqual([
      `validate-target:${update.stagedApp}:2.0.14`,
      `validate-installed:${update.currentApp}:2.0.12`,
      `missing:${update.backupApp}`,
      `missing:${update.failedApp}`,
      `missing:${update.trashApp}`,
      `rename:${update.currentApp}:${update.backupApp}`,
      `rename:${update.stagedApp}:${update.currentApp}`,
      `validate-target:${update.currentApp}:2.0.14`,
      'receipt:installed-awaiting-health',
      `launch:${update.currentApp}:update`,
      'healthy',
      `rename:${update.backupApp}:${update.trashApp}`,
      'receipt:completed',
    ])
  })

  it('restores 2.0.12 when the legacy 2.0.14 candidate never becomes healthy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-legacy-swap-'))
    temporaryRoots.push(root)
    const update = legacyTransactionRequest(root).request as LegacyMacUpdateRequest
    const events: string[] = []

    await expect(performLegacyMacUpdateSwap(update, legacyAdapter(events, async () => {
      throw new Error('startup acknowledgement failed')
    }))).rejects.toThrow('startup acknowledgement failed')

    expect(events).toContain(`rename:${update.currentApp}:${update.failedApp}`)
    expect(events).toContain(`rename:${update.backupApp}:${update.currentApp}`)
    expect(events).toContain(`validate-installed:${update.currentApp}:2.0.12`)
    expect(events).toContain(`remove:${update.failedApp}`)
    expect(events).toContain('receipt:rolled-back')
    expect(events).toContain(`launch:${update.currentApp}:rollback`)
  })

  it('durably marks commit-ready after applied and clears the owner only after backup cleanup', async () => {
    const events: string[] = []
    const update = request()
    const operations: MacUpdateSwapAdapter = {
      ...adapter(events, async () => { events.push('healthy') }),
      armConfirmation: () => { events.push('pending:confirmation-armed') },
      commitTransaction: () => { events.push('pending:commit-ready') },
      finalizeTransaction: () => { events.push('pending:clear') },
    }

    await performMacUpdateSwap(update, operations)

    expect(events.indexOf(`installed-base:${update.transactionId}`)).toBeLessThan(events.indexOf('pending:confirmation-armed'))
    expect(events.indexOf('pending:confirmation-armed')).toBeLessThan(events.indexOf(`confirm:${update.transactionId}`))
    expect(events.indexOf(`confirm:${update.transactionId}`)).toBeLessThan(events.indexOf('pending:commit-ready'))
    expect(events.indexOf('pending:commit-ready')).toBeLessThan(events.indexOf('receipt:completed'))
    expect(events.indexOf('receipt:completed')).toBeLessThan(events.indexOf(`rename:${update.backupApp}:${update.trashApp}`))
    expect(events.indexOf(`rename:${update.backupApp}:${update.trashApp}`)).toBeLessThan(events.indexOf('pending:clear'))
  })

  it('rolls back when the ack rename is readable but its parent fsync fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-update-ack-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    writeMacUpdateDurableJson(requestPath, update)
    claimMacUpdatePendingTransaction(update, requestPath)
    const ackPath = update.ackPath
    const events: string[] = []
    const sender = vi.fn(async () => async () => {})
    const harness = durableJsonIO('directory-sync')
    const operations = adapter(events, async () => {
      await writeMacUpdateStartupAck(root, update.targetVersion, ackEnvironment(update, ackPath), harness.io, sender)
    })

    await expect(performMacUpdateSwap(update, operations)).rejects.toThrow('directory fsync failed')

    expect(JSON.parse(readFileSync(ackPath, 'utf8'))).toEqual(expect.objectContaining({
      transactionId: update.transactionId,
      token: update.ackToken,
      version: update.targetVersion,
    }))
    expect(sender).not.toHaveBeenCalled()
    expect(events).not.toContain(`installed-base:${update.transactionId}`)
    expect(events).not.toContain(`rename:${update.backupApp}:${update.trashApp}`)
    expect(events).toContain(`rename:${update.backupApp}:${update.currentApp}`)
  })

  it('requires bound native child-process IPC and revalidates the durable ack', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-update-ipc-'))
    temporaryRoots.push(root)
    const update = { ...request(), ackPath: join(root, 'startup-ack.json') }
    writeFileSync(update.ackPath, JSON.stringify(durableAck(update)))
    const child = ipcCandidate(
      commitMessage(update),
      commitMessage(update, 'emate-mac-update-commit-applied'),
      true,
    )
    const exit = new Promise<number | null>(resolve => { child.once('exit', resolve) })

    await expect(waitForMacUpdateCommit(update, child, 1_000)).resolves.toBeUndefined()
    await expect(confirmMacUpdateCommit(update, child)).resolves.toBeUndefined()
    await expect(exit).resolves.toBe(0)
  })

  it('does not treat the helper send callback as candidate commit-applied', async () => {
    const update = request()
    const child = ipcCandidate(undefined, undefined, true)
    const confirmation = confirmMacUpdateCommit(update, child, 100)
    try {
      await expect(confirmation).rejects.toThrow('commit-applied')
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('does not kill or roll back a real candidate when commit-applied is lost', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-update-applied-lost-'))
    temporaryRoots.push(root)
    const update = { ...request(), ackPath: join(root, 'startup-ack.json') }
    writeFileSync(update.ackPath, JSON.stringify(durableAck(update)))
    const events: string[] = []
    let child: ReturnType<typeof ipcCandidate> | undefined
    const operations: MacUpdateSwapAdapter = {
      ...adapter(events, async () => {}),
      launch: (path) => {
        events.push(`launch:${path}:update`)
        child = ipcCandidate(commitMessage(update), undefined, true)
        return child
      },
      waitForHealthy: async (candidate, launched) => {
        await waitForMacUpdateCommit(candidate, launched, 1_000)
      },
      confirmCandidate: async (candidate, launched) => {
        await confirmMacUpdateCommit(candidate, launched, 100)
      },
    }

    try {
      await expect(performMacUpdateSwap(update, operations)).rejects.toThrow('commit-applied')
      expect(child?.exitCode).toBeNull()
      expect(events).toContain('receipt:committed-unknown')
      expect(events).not.toContain('signal:SIGTERM')
      expect(events).not.toContain(`restore-installed-base:${update.transactionId}`)
      expect(events).not.toContain(`rename:${update.backupApp}:${update.currentApp}`)
      expect(events).not.toContain(`rename:${update.backupApp}:${update.trashApp}`)
    } finally {
      child?.kill('SIGKILL')
    }
  })

  it.each([
    'candidate exit',
    'applied lost',
    'wrong source commit',
    'wrong Base contract',
    'wrong Schedule floor',
    'wrong manifest identity',
    'wrong selected artifact',
    'wrong canonical app',
    'wrong app id',
    'wrong target arch',
  ])('rejects %s after commit confirmation', async (label) => {
    const update = request()
    let applied: unknown
    if (label !== 'candidate exit' && label !== 'applied lost') {
      applied = commitMessage(update, 'emate-mac-update-commit-applied')
      if (label === 'wrong source commit') applied = { ...applied as object, sourceCommit: 'e'.repeat(40) }
      else if (label === 'wrong Base contract') applied = { ...applied as object, baseContractId: 'wrong-base' }
      else if (label === 'wrong Schedule floor') applied = { ...applied as object, scheduleProtocolFloor: 3 }
      else if (label === 'wrong manifest identity') applied = { ...applied as object, manifestIdentity: 'e'.repeat(64) }
      else if (label === 'wrong selected artifact') {
        applied = { ...applied as object, artifact: { ...update.artifact, sha256: 'e'.repeat(64) } }
      } else if (label === 'wrong canonical app') applied = { ...applied as object, currentApp: '/Applications/Other.app' }
      else if (label === 'wrong app id') applied = { ...applied as object, appId: 'invalid.app' }
      else if (label === 'wrong target arch') applied = { ...applied as object, targetArch: update.targetArch === 'arm64' ? 'x64' : 'arm64' }
    }
    const stayAlive = label !== 'candidate exit'
    const child = ipcCandidate(undefined, applied, stayAlive)
    try {
      await expect(confirmMacUpdateCommit(update, child, 100)).rejects.toThrow(/commit-applied/u)
    } finally {
      child.kill('SIGKILL')
    }
  })

  it.each([
    ['no IPC', false, 'before startup commit'],
    ['forged IPC', true, 'did not report'],
    ['wrong token', true, 'did not report'],
    ['wrong transaction', true, 'did not report'],
    ['wrong version', true, 'did not report'],
    ['wrong source commit', true, 'did not report'],
    ['wrong Base contract', true, 'did not report'],
    ['wrong Schedule floor', true, 'did not report'],
    ['wrong manifest identity', true, 'did not report'],
    ['wrong selected artifact', true, 'did not report'],
    ['wrong canonical app', true, 'did not report'],
    ['wrong app id', true, 'did not report'],
    ['wrong target arch', true, 'did not report'],
    ['forged durable ack', true, 'did not report'],
    ['timeout', true, 'did not report'],
  ] as const)('rejects a durable ack with %s', async (label, stayAlive, error) => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-update-ipc-'))
    temporaryRoots.push(root)
    const update = { ...request(), ackPath: join(root, 'startup-ack.json') }
    const ack = durableAck(update)
    if (label === 'forged durable ack') ack.token = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    writeFileSync(update.ackPath, JSON.stringify(ack))
    let message: unknown = commitMessage(update)
    if (label === 'no IPC' || label === 'timeout') message = undefined
    else if (label === 'forged IPC') message = { type: 'forged' }
    else if (label === 'wrong token') message = { ...commitMessage(update), token: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }
    else if (label === 'wrong transaction') message = { ...commitMessage(update), transactionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }
    else if (label === 'wrong version') message = { ...commitMessage(update), version: '2.0.13' }
    else if (label === 'wrong source commit') message = { ...commitMessage(update), sourceCommit: 'e'.repeat(40) }
    else if (label === 'wrong Base contract') message = { ...commitMessage(update), baseContractId: 'wrong-base' }
    else if (label === 'wrong Schedule floor') message = { ...commitMessage(update), scheduleProtocolFloor: 3 }
    else if (label === 'wrong manifest identity') message = { ...commitMessage(update), manifestIdentity: 'e'.repeat(64) }
    else if (label === 'wrong selected artifact') {
      message = { ...commitMessage(update), artifact: { ...update.artifact, sha256: 'e'.repeat(64) } }
    } else if (label === 'wrong canonical app') message = { ...commitMessage(update), currentApp: '/Applications/Other.app' }
    else if (label === 'wrong app id') message = { ...commitMessage(update), appId: 'invalid.app' }
    else if (label === 'wrong target arch') message = { ...commitMessage(update), targetArch: update.targetArch === 'arm64' ? 'x64' : 'arm64' }
    const child = ipcCandidate(message, undefined, stayAlive)
    try {
      const timeoutMs = label === 'no IPC' ? 1_000 : 100
      await expect(waitForMacUpdateCommit(update, child, timeoutMs)).rejects.toThrow(error)
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('does not clean the old backup when the durable installed-base receipt fails', async () => {
    const update = request()
    const events: string[] = []
    const operations: MacUpdateSwapAdapter = {
      ...adapter(events, async () => { events.push('healthy') }),
      writeInstalledBaseReceipt: () => {
        events.push('installed-base-failed')
        throw new Error('installed-base fsync failed')
      },
    }

    await expect(performMacUpdateSwap(update, operations)).rejects.toThrow('installed-base fsync failed')

    expect(events).toContain('installed-base-failed')
    expect(events).not.toContain(`rename:${update.backupApp}:${update.trashApp}`)
    expect(events).toContain(`rename:${update.backupApp}:${update.currentApp}`)
  })

  it('preserves the candidate, installed receipt, owner, and backup when confirmation becomes unknown', async () => {
    const update = request()
    const events: string[] = []
    const operations: MacUpdateSwapAdapter = {
      ...adapter(events, async () => { events.push('healthy') }),
      confirmCandidate: async () => {
        events.push('confirm-failed')
        throw new Error('IPC confirmation failed')
      },
    }

    await expect(performMacUpdateSwap(update, operations)).rejects.toThrow('IPC confirmation failed')

    expect(events).toContain(`installed-base:${update.transactionId}`)
    expect(events).toContain('receipt:committed-unknown')
    expect(events).not.toContain(`restore-installed-base:${update.transactionId}`)
    expect(events).not.toContain(`launch:${update.currentApp}:rollback`)
    expect(events).not.toContain(`rename:${update.backupApp}:${update.currentApp}`)
    expect(events).not.toContain(`rename:${update.backupApp}:${update.trashApp}`)
    expect(events).not.toContain('signal:SIGTERM')
  })

  it('stays forward-only when the durable completed receipt fails after candidate applied', async () => {
    const update = request()
    const events: string[] = []
    const operations: MacUpdateSwapAdapter = {
      ...adapter(events, async () => { events.push('healthy') }),
      writeReceipt: (_request, status) => {
        events.push(`receipt:${status}`)
        if (status === 'completed') throw new Error('commit receipt failed')
      },
    }

    await expect(performMacUpdateSwap(update, operations)).rejects.toThrow('commit receipt failed')

    expect(events).not.toContain(`restore-installed-base:${update.transactionId}`)
    expect(events).toContain('receipt:committed-unknown')
    expect(events).toContain(`confirm:${update.transactionId}`)
    expect(events).not.toContain(`rename:${update.backupApp}:${update.trashApp}`)
    expect(events).not.toContain(`rename:${update.backupApp}:${update.currentApp}`)
  })

  it('rolls back only when the durable confirmation arm fails before any confirmation send', async () => {
    const update = request()
    const events: string[] = []
    const operations: MacUpdateSwapAdapter = {
      ...adapter(events, async () => { events.push('healthy') }),
      armConfirmation: () => { events.push('arm-failed'); throw new Error('arm fsync failed') },
    }

    await expect(performMacUpdateSwap(update, operations)).rejects.toThrow('arm fsync failed')

    expect(events).toContain('arm-failed')
    expect(events).not.toContain(`confirm:${update.transactionId}`)
    expect(events).toContain(`restore-installed-base:${update.transactionId}`)
    expect(events).toContain(`rename:${update.backupApp}:${update.currentApp}`)
    expect(events).not.toContain(`rename:${update.backupApp}:${update.trashApp}`)
  })

  it('durably binds the installed Base receipt to the transaction and selected carrier', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-installed-base-'))
    temporaryRoots.push(root)
    const update = { ...request(), installedBaseReceiptPath: join(root, 'installed-base.json') }

    writeMacUpdateInstalledBaseReceipt(update)

    expect(JSON.parse(readFileSync(update.installedBaseReceiptPath, 'utf8'))).toEqual(expect.objectContaining({
      schemaVersion: 1,
      documentType: 'emate.installed-base-receipt',
      transactionId: update.transactionId,
      appVersion: update.targetVersion,
      sourceCommit: update.sourceCommit,
      baseContractId: update.baseContractId,
      scheduleProtocolFloor: update.scheduleProtocolFloor,
      manifestIdentity: update.manifestIdentity,
      currentApp: update.currentApp,
      appId: update.appId,
      targetArch: update.targetArch,
      carrier: { kind: 'dmg', artifact: update.artifact },
    }))
  })

  it('restores the exact prior installed Base receipt when a later commit step fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-installed-base-'))
    temporaryRoots.push(root)
    const previous = '{"schemaVersion":1,"appVersion":"2.0.10"}\n'
    const update = {
      ...request(),
      installedBaseReceiptPath: join(root, 'installed-base.json'),
      previousInstalledBaseReceipt: previous,
    }
    writeFileSync(update.installedBaseReceiptPath, previous)

    const restore = writeMacUpdateInstalledBaseReceipt(update)
    expect(readFileSync(update.installedBaseReceiptPath, 'utf8')).not.toBe(previous)

    restore()
    expect(readFileSync(update.installedBaseReceiptPath, 'utf8')).toBe(previous)
  })

  it('restores the exact prior receipt when the new receipt rename is readable but not durable', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-installed-base-'))
    temporaryRoots.push(root)
    const previous = '{"schemaVersion":1,"appVersion":"2.0.10"}\n'
    const update = {
      ...request(),
      installedBaseReceiptPath: join(root, 'installed-base.json'),
      previousInstalledBaseReceipt: previous,
    }
    writeFileSync(update.installedBaseReceiptPath, previous)
    const harness = durableJsonIO('first-directory-sync')

    expect(() => writeMacUpdateInstalledBaseReceipt(update, harness.io)).toThrow('directory fsync failed')

    expect(readFileSync(update.installedBaseReceiptPath, 'utf8')).toBe(previous)
    expect(harness.events.filter(event => event === 'rename')).toHaveLength(2)
  })

  it('restores and relaunches the old app when healthy startup is not observed', async () => {
    const events: string[] = []
    const update = request()

    await expect(performMacUpdateSwap(update, adapter(events, async () => {
      throw new Error('startup timeout')
    }))).rejects.toThrow('startup timeout')

    expect(events).toEqual(expect.arrayContaining([
      'signal:SIGTERM',
      'candidate-gone:10000',
      `rename:${update.currentApp}:${update.failedApp}`,
      `rename:${update.backupApp}:${update.currentApp}`,
      `remove:${update.failedApp}`,
      `launch:${update.currentApp}:rollback`,
      'receipt:rolled-back',
    ]))
    expect(events.filter(event => event.startsWith('signal:') || event.startsWith('candidate-')))
      .toEqual(['signal:SIGTERM', 'candidate-gone:10000'])
    expect(events.indexOf('candidate-gone:10000')).toBeLessThan(events.indexOf(`rename:${update.currentApp}:${update.failedApp}`))
    expect(events.indexOf('candidate-gone:10000')).toBeLessThan(events.indexOf(`launch:${update.currentApp}:rollback`))
    expect(events).not.toContain(`rename:${update.backupApp}:${update.trashApp}`)
  })

  it('escalates from TERM to KILL and proves the candidate is gone before rollback', async () => {
    const events: string[] = []
    const update = request()

    await expect(performMacUpdateSwap(update, adapter(events, async () => {
      throw new Error('startup timeout')
    }, [false, true]))).rejects.toThrow('startup timeout')

    expect(events).toEqual(expect.arrayContaining([
      'signal:SIGTERM',
      'candidate-alive:10000',
      'signal:SIGKILL',
      'candidate-gone:5000',
    ]))
    expect(events.filter(event => event.startsWith('signal:') || event.startsWith('candidate-')))
      .toEqual(['signal:SIGTERM', 'candidate-alive:10000', 'signal:SIGKILL', 'candidate-gone:5000'])
    expect(events.indexOf('candidate-gone:5000')).toBeLessThan(events.indexOf(`rename:${update.currentApp}:${update.failedApp}`))
    expect(events.indexOf('candidate-gone:5000')).toBeLessThan(events.indexOf(`launch:${update.currentApp}:rollback`))
  })

  it('fails rollback without renaming or relaunching while the killed candidate remains alive', async () => {
    const events: string[] = []
    const update = request()

    await expect(performMacUpdateSwap(update, adapter(events, async () => {
      throw new Error('startup timeout')
    }, [false, false]))).rejects.toThrow('macOS update failed and rollback failed')

    expect(events.filter(event => event.startsWith('signal:') || event.startsWith('candidate-')))
      .toEqual(['signal:SIGTERM', 'candidate-alive:10000', 'signal:SIGKILL', 'candidate-alive:5000'])
    expect(events).toContain('receipt:rollback-failed')
    expect(events).not.toContain(`rename:${update.currentApp}:${update.failedApp}`)
    expect(events).not.toContain(`rename:${update.backupApp}:${update.currentApp}`)
    expect(events).not.toContain(`launch:${update.currentApp}:rollback`)
  })

  it('fails rollback without touching the installed apps when candidate signaling is forbidden', async () => {
    const events: string[] = []
    const update = request()
    const operations: MacUpdateSwapAdapter = {
      ...adapter(events, async () => { throw new Error('startup timeout') }),
      signalCandidate: (_child, signal) => {
        events.push(`signal:${signal}`)
        throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
      },
    }

    await expect(performMacUpdateSwap(update, operations)).rejects.toThrow('macOS update failed and rollback failed')

    expect(events).toContain('receipt:rollback-failed')
    expect(events).not.toContain(`rename:${update.currentApp}:${update.failedApp}`)
    expect(events).not.toContain(`rename:${update.backupApp}:${update.currentApp}`)
    expect(events).not.toContain(`launch:${update.currentApp}:rollback`)
  })

  it('never rolls back a healthy update when post-commit cleanup fails', async () => {
    const events: string[] = []
    const update = request()
    const base = adapter(events, async () => { events.push('healthy') })
    const operations: MacUpdateSwapAdapter = {
      ...base,
      rename: (from, to) => {
        events.push(`rename:${from}:${to}`)
        if (from === update.backupApp && to === update.trashApp) throw new Error('Trash unavailable')
      },
      remove: path => {
        events.push(`remove:${path}`)
        if (path === update.backupApp) throw new Error('cleanup blocked')
      },
    }

    await expect(performMacUpdateSwap(update, operations)).resolves.toBeUndefined()

    expect(events).toContain('receipt:completed-cleanup-failed')
    expect(events).not.toContain(`rename:${update.currentApp}:${update.failedApp}`)
    expect(events).not.toContain(`launch:${update.currentApp}:rollback`)
  })

  it('accepts the exact 2.0.12 three-field acknowledgement only after probation applies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-legacy-update-ack-'))
    temporaryRoots.push(root)
    const legacy = legacyTransactionRequest(root)
    writeMacUpdateDurableJson(legacy.requestPath, legacy.request)
    const sender = vi.fn(async () => async () => {})

    const acknowledgement = await writeMacUpdateStartupAck(
      root,
      '2.0.14',
      legacy.environment,
      undefined,
      sender,
    )

    expect(acknowledgement).toEqual(expect.objectContaining({
      status: 'installed',
      currentVersion: '2.0.14',
      targetVersion: '2.0.14',
    }))
    expect(() => lstatSync(legacy.ackPath)).toThrow()
    expect(sender).not.toHaveBeenCalled()

    await acknowledgement?.commitApplied()

    expect(JSON.parse(readFileSync(legacy.ackPath, 'utf8'))).toEqual({
      schemaVersion: 1,
      status: 'healthy',
      token: legacy.request.ackToken,
      version: '2.0.14',
      pid: process.pid,
      acknowledgedAt: expect.any(String),
    })
    expect(sender).not.toHaveBeenCalled()
  })

  it.each([
    'missing path',
    'missing token',
    'missing version',
    'mixed modern field',
    'unknown field',
    'wrong predecessor request',
    'expanded legacy request',
  ])('rejects non-exact legacy acknowledgement input: %s', async (label) => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-legacy-update-ack-'))
    temporaryRoots.push(root)
    const legacy = legacyTransactionRequest(root)
    const environment: NodeJS.ProcessEnv = { ...legacy.environment }
    const requestValue: Record<string, unknown> = { ...legacy.request }
    if (label === 'missing path') delete environment.EMATE_MAC_UPDATE_ACK_PATH
    else if (label === 'missing token') delete environment.EMATE_MAC_UPDATE_ACK_TOKEN
    else if (label === 'missing version') delete environment.EMATE_MAC_UPDATE_ACK_VERSION
    else if (label === 'mixed modern field') environment.EMATE_MAC_UPDATE_ACK_TRANSACTION_ID = legacy.request.transactionId
    else if (label === 'unknown field') environment.EMATE_MAC_UPDATE_ACK_UNEXPECTED = 'forged'
    else if (label === 'wrong predecessor request') requestValue.currentVersion = '2.0.11'
    else requestValue.unexpected = 'forged'
    writeMacUpdateDurableJson(legacy.requestPath, requestValue)
    const sender = vi.fn(async () => async () => {})

    await expect(writeMacUpdateStartupAck(root, '2.0.14', environment, undefined, sender))
      .rejects.toThrow(/macOS update startup acknowledgement environment is invalid|legacy macOS update request is invalid/u)

    expect(() => lstatSync(legacy.ackPath)).toThrow()
    expect(sender).not.toHaveBeenCalled()
  })

  it('rejects a legacy request changed during probation before writing its acknowledgement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-legacy-update-ack-'))
    temporaryRoots.push(root)
    const legacy = legacyTransactionRequest(root)
    writeMacUpdateDurableJson(legacy.requestPath, legacy.request)
    const acknowledgement = await writeMacUpdateStartupAck(root, '2.0.14', legacy.environment)
    writeMacUpdateDurableJson(legacy.requestPath, { ...legacy.request, parentPid: 456 })

    expect(acknowledgement).toBeDefined()
    await expect(acknowledgement!.commitApplied()).rejects.toThrow('request changed before startup commit')

    expect(() => lstatSync(legacy.ackPath)).toThrow()
  })

  it('keeps the legacy predecessor rollbackable when probation never applies its acknowledgement', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-legacy-update-ack-'))
    temporaryRoots.push(root)
    const legacy = legacyTransactionRequest(root)
    writeMacUpdateDurableJson(legacy.requestPath, legacy.request)
    const acknowledgement = await writeMacUpdateStartupAck(root, '2.0.14', legacy.environment)
    const events: string[] = []
    const update = request()

    await expect(performMacUpdateSwap(update, adapter(events, async () => {
      expect(() => lstatSync(legacy.ackPath)).toThrow()
      throw new Error('probation failed before Schedule admission')
    }))).rejects.toThrow('probation failed before Schedule admission')

    expect(acknowledgement).toBeDefined()
    expect(() => lstatSync(legacy.ackPath)).toThrow()
    expect(events).toContain(`rename:${update.currentApp}:${update.backupApp}`)
    expect(events).toContain(`rename:${update.currentApp}:${update.failedApp}`)
    expect(events).toContain(`rename:${update.backupApp}:${update.currentApp}`)
    expect(events).toContain('receipt:rolled-back')
    expect(events).toContain(`launch:${update.currentApp}:rollback`)
  })

  it('writes the update acknowledgement only inside the matching update transaction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-update-ack-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    const path = update.ackPath
    const token = update.ackToken
    writeMacUpdateDurableJson(requestPath, update)
    claimMacUpdatePendingTransaction(update, requestPath)
    const sender = vi.fn(async () => async () => {})
    await expect(writeMacUpdateStartupAck(root, '2.0.12', ackEnvironment(update, path), undefined, sender))
      .resolves.toEqual(expect.objectContaining({ status: 'installed', currentVersion: '2.0.12', targetVersion: '2.0.12' }))

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(expect.objectContaining({
      schemaVersion: 1,
      status: 'healthy',
      transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      token,
      version: '2.0.12',
      sourceCommit: update.sourceCommit,
      baseContractId: update.baseContractId,
      scheduleProtocolFloor: update.scheduleProtocolFloor,
      manifestIdentity: update.manifestIdentity,
      artifact: update.artifact,
      currentApp: update.currentApp,
      appId: 'net.ecoremedia.e-mate',
      targetArch: update.targetArch,
    }))
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({
      type: 'emate-mac-update-commit',
      transactionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      token,
      version: '2.0.12',
      sourceCommit: update.sourceCommit,
      baseContractId: update.baseContractId,
      scheduleProtocolFloor: update.scheduleProtocolFloor,
      manifestIdentity: update.manifestIdentity,
      artifact: update.artifact,
      currentApp: update.currentApp,
      appId: 'net.ecoremedia.e-mate',
      targetArch: update.targetArch,
    }))
    await expect(writeMacUpdateStartupAck(
      root,
      '2.0.12',
      ackEnvironment(update, join(root, '..', 'startup-ack.json')),
      undefined,
      sender,
    )).rejects.toThrow('path is invalid')
  })

  it.each([
    'wrong source commit',
    'wrong Base contract',
    'wrong Schedule floor',
    'wrong manifest identity',
    'wrong selected artifact',
    'wrong canonical app',
    'wrong app id',
    'wrong target arch',
    'unknown acknowledgement key',
  ])('rejects candidate acknowledgement environment with %s before durable write', async (label) => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-update-ack-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    writeMacUpdateDurableJson(requestPath, update)
    claimMacUpdatePendingTransaction(update, requestPath)
    const environment = ackEnvironment(update, update.ackPath)
    if (label === 'wrong source commit') environment.EMATE_MAC_UPDATE_ACK_SOURCE_COMMIT = 'e'.repeat(40)
    else if (label === 'wrong Base contract') environment.EMATE_MAC_UPDATE_ACK_BASE_CONTRACT_ID = 'wrong-base'
    else if (label === 'wrong Schedule floor') environment.EMATE_MAC_UPDATE_ACK_SCHEDULE_PROTOCOL_FLOOR = '3'
    else if (label === 'wrong manifest identity') environment.EMATE_MAC_UPDATE_ACK_MANIFEST_IDENTITY = 'e'.repeat(64)
    else if (label === 'wrong selected artifact') {
      environment.EMATE_MAC_UPDATE_ACK_ARTIFACT = JSON.stringify({ ...update.artifact, sha256: 'e'.repeat(64) })
    } else if (label === 'wrong canonical app') environment.EMATE_MAC_UPDATE_ACK_CURRENT_APP = '/Applications/Other.app'
    else if (label === 'wrong app id') environment.EMATE_MAC_UPDATE_ACK_APP_ID = 'invalid.app'
    else if (label === 'wrong target arch') {
      environment.EMATE_MAC_UPDATE_ACK_TARGET_ARCH = update.targetArch === 'arm64' ? 'x64' : 'arm64'
    } else environment.EMATE_MAC_UPDATE_ACK_UNEXPECTED = 'forged'
    const sender = vi.fn(async () => async () => {})

    await expect(writeMacUpdateStartupAck(root, update.targetVersion, environment, undefined, sender))
      .rejects.toThrow('environment is invalid')

    expect(sender).not.toHaveBeenCalled()
    expect(() => lstatSync(update.ackPath)).toThrow()
  })

  it('rejects a symlinked candidate ack path without touching its referent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-update-ack-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    writeMacUpdateDurableJson(requestPath, update)
    claimMacUpdatePendingTransaction(update, requestPath)
    const referent = join(root, 'forged-ack.json')
    writeFileSync(referent, 'forged')
    symlinkSync(referent, update.ackPath)
    const sender = vi.fn(async () => async () => {})

    await expect(writeMacUpdateStartupAck(
      root,
      update.targetVersion,
      ackEnvironment(update, update.ackPath),
      undefined,
      sender,
    )).rejects.toThrow('path already exists')

    expect(lstatSync(update.ackPath).isSymbolicLink()).toBe(true)
    expect(readFileSync(referent, 'utf8')).toBe('forged')
    expect(sender).not.toHaveBeenCalled()
  })

  it('reports a persisted rollback after the restored app becomes healthy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-update-result-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    const path = update.receiptPath
    const token = update.ackToken
    writeMacUpdateDurableJson(requestPath, update)
    writeMacUpdateDurableJson(path, transactionReceipt(update, 'rolled-back'))

    await expect(readMacUpdateStartupResult(root, '2.0.10', {
      EMATE_MAC_UPDATE_RESULT_PATH: path,
      EMATE_MAC_UPDATE_RESULT_TOKEN: token,
      EMATE_MAC_UPDATE_RESULT_VERSION: '2.0.12',
    })).resolves.toEqual({ status: 'rolled-back', currentVersion: '2.0.10', targetVersion: '2.0.12' })
  })

  it('forward-resumes the same installed candidate after a potentially-applied helper crash', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-pending-recovery-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    writeMacUpdateDurableJson(requestPath, update)
    claimMacUpdatePendingTransaction(update, requestPath)
    const pendingPath = join(root, 'updates', 'pending-mac-update.json')
    const owner = JSON.parse(readFileSync(pendingPath, 'utf8')) as Record<string, unknown>
    writeMacUpdateDurableJson(pendingPath, { ...owner, phase: 'confirmation-armed', updatedAt: '2026-08-25T00:00:01.000Z' })
    writeMacUpdateDurableJson(update.ackPath, durableAck(update))
    writeMacUpdateDurableJson(update.installedBaseReceiptPath, installedBaseReceipt(update))
    writeMacUpdateDurableJson(update.receiptPath, transactionReceipt(update, 'committed-unknown'))
    const present = new Set([update.currentApp, update.backupApp])
    const events: string[] = []
    const recovery: MacUpdateRecoveryAdapter = {
      existsDirectory: path => present.has(path),
      validateInstalled: (path, version) => { events.push(`validate:${path}:${version}`) },
      assertMissing: path => {
        events.push(`missing:${path}`)
        if (present.has(path)) throw new Error('path exists')
      },
      rename: (from, to) => {
        events.push(`rename:${from}:${to}`)
        if (!present.delete(from) || present.has(to)) throw new Error('invalid rename')
        present.add(to)
      },
      remove: path => {
        events.push(`remove:${path}`)
        if (!present.delete(path)) throw new Error('invalid remove')
      },
      restoreInstalledBaseReceipt: () => { throw new Error('must not restore a potentially applied receipt') },
      writeReceipt: (candidate, status) => {
        events.push(`receipt:${status}`)
        writeMacUpdateDurableJson(candidate.receiptPath, transactionReceipt(candidate, status))
      },
      finalizeTransaction: () => {
        events.push('finalize')
        rmSync(join(root, 'updates', 'pending-mac-update.json'))
      },
      helperIsLive: () => false,
    }

    expect(recoverPendingMacUpdateStartup(
      root,
      update.targetVersion,
      join(update.currentApp, 'Contents', 'MacOS', 'e-Mate'),
      recovery,
    )).toEqual({ status: 'forward-resume', relaunch: false })
    expect(events).not.toContain('restore-installed-base')
    expect(events.some(event => event.startsWith('rename:'))).toBe(false)

    const resumed = resumePendingMacUpdateStartup(
      root,
      update.targetVersion,
      join(update.currentApp, 'Contents', 'MacOS', 'e-Mate'),
      recovery,
    )
    await resumed.commitApplied()

    expect(events).toContain('receipt:committed-unknown')
    expect(events).toContain('receipt:completed')
    expect(events).toContain(`rename:${update.backupApp}:${update.trashApp}`)
    expect(events).toContain('finalize')
    expect(JSON.parse(readFileSync(update.receiptPath, 'utf8')).status).toBe('completed')
    expect(() => lstatSync(pendingPath)).toThrow()
    expect(present).toEqual(new Set([update.currentApp, update.trashApp]))
  })

  it('finishes backup cleanup after a detached helper crashes with a durable completed receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-pending-recovery-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    writeMacUpdateDurableJson(requestPath, update)
    claimMacUpdatePendingTransaction(update, requestPath)
    const pendingPath = join(root, 'updates', 'pending-mac-update.json')
    const owner = JSON.parse(readFileSync(pendingPath, 'utf8')) as Record<string, unknown>
    writeMacUpdateDurableJson(pendingPath, { ...owner, phase: 'commit-ready', updatedAt: '2026-08-25T00:00:01.000Z' })
    writeMacUpdateDurableJson(update.receiptPath, transactionReceipt(update, 'completed'))
    writeMacUpdateDurableJson(update.installedBaseReceiptPath, installedBaseReceipt(update))
    const present = new Set([update.currentApp, update.backupApp])
    const events: string[] = []
    const recovery: MacUpdateRecoveryAdapter = {
      existsDirectory: path => present.has(path),
      validateInstalled: (path, version) => { events.push(`validate:${path}:${version}`) },
      assertMissing: path => { if (present.has(path)) throw new Error('path exists') },
      rename: (from, to) => {
        events.push(`rename:${from}:${to}`)
        if (!present.delete(from) || present.has(to)) throw new Error('invalid rename')
        present.add(to)
      },
      remove: path => { events.push(`remove:${path}`); present.delete(path) },
      restoreInstalledBaseReceipt: () => { throw new Error('must not restore a committed receipt') },
      writeReceipt: (_request, status) => { events.push(`receipt:${status}`) },
      finalizeTransaction: () => { events.push('finalize'); rmSync(pendingPath) },
      helperIsLive: () => false,
    }

    expect(recoverPendingMacUpdateStartup(
      root,
      update.targetVersion,
      join(update.currentApp, 'Contents', 'MacOS', 'e-Mate'),
      recovery,
    )).toEqual({ status: 'committed', relaunch: false })
    expect(events).toEqual([
      `validate:${update.currentApp}:${update.targetVersion}`,
      `rename:${update.backupApp}:${update.trashApp}`,
      'finalize',
    ])
    expect(present).toEqual(new Set([update.currentApp, update.trashApp]))
  })

  it.each([
    ['missing', undefined],
    ['torn', '{'],
    ['wrong identity', 'wrong-identity'],
    ['invalid installedAt', 'invalid-installed-at'],
  ])('fails closed for a completed transaction with a %s installed Base receipt', (_label, receiptFixture) => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-completed-receipt-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    writeMacUpdateDurableJson(requestPath, update)
    claimMacUpdatePendingTransaction(update, requestPath)
    const pendingPath = join(root, 'updates', 'pending-mac-update.json')
    const owner = JSON.parse(readFileSync(pendingPath, 'utf8')) as Record<string, unknown>
    writeMacUpdateDurableJson(pendingPath, { ...owner, phase: 'commit-ready', updatedAt: '2026-08-25T00:00:01.000Z' })
    writeMacUpdateDurableJson(update.receiptPath, transactionReceipt(update, 'completed'))
    if (receiptFixture === '{') writeFileSync(update.installedBaseReceiptPath, receiptFixture)
    else if (receiptFixture === 'wrong-identity') {
      writeMacUpdateDurableJson(update.installedBaseReceiptPath, {
        ...installedBaseReceipt(update),
        manifestIdentity: 'e'.repeat(64),
      })
    } else if (receiptFixture === 'invalid-installed-at') {
      writeMacUpdateDurableJson(update.installedBaseReceiptPath, {
        ...installedBaseReceipt(update),
        installedAt: 'not-an-iso-timestamp',
      })
    }
    const events: string[] = []
    const recovery: MacUpdateRecoveryAdapter = {
      existsDirectory: path => path === update.currentApp || path === update.backupApp,
      validateInstalled: (path, version) => { events.push(`validate:${path}:${version}`) },
      assertMissing: () => {},
      rename: (from, to) => { events.push(`rename:${from}:${to}`) },
      remove: path => { events.push(`remove:${path}`) },
      restoreInstalledBaseReceipt: () => { events.push('restore') },
      writeReceipt: (_request, status) => { events.push(`receipt:${status}`) },
      finalizeTransaction: () => { events.push('finalize') },
      helperIsLive: () => false,
    }

    expect(() => recoverPendingMacUpdateStartup(
      root,
      update.targetVersion,
      join(update.currentApp, 'Contents', 'MacOS', 'e-Mate'),
      recovery,
    )).toThrow()
    expect(events.some(event => event.startsWith('rename:') || event === 'finalize')).toBe(false)
  })

  it('rechecks the helper lease immediately before rollback and performs zero mutation if it becomes live', () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-helper-lease-'))
    temporaryRoots.push(root)
    const { update, requestPath } = transactionRequest(root)
    writeMacUpdateDurableJson(requestPath, update)
    claimMacUpdatePendingTransaction(update, requestPath)
    const pendingPath = join(root, 'updates', 'pending-mac-update.json')
    const owner = JSON.parse(readFileSync(pendingPath, 'utf8')) as Record<string, unknown>
    writeMacUpdateDurableJson(pendingPath, { ...owner, helperPid: 4242, updatedAt: '2026-08-25T00:00:01.000Z' })
    const events: string[] = []
    let checks = 0
    const recovery: MacUpdateRecoveryAdapter = {
      existsDirectory: path => path === update.currentApp,
      validateInstalled: (path, version) => { events.push(`validate:${path}:${version}`) },
      assertMissing: path => { events.push(`missing:${path}`) },
      rename: (from, to) => { events.push(`rename:${from}:${to}`) },
      remove: path => { events.push(`remove:${path}`) },
      restoreInstalledBaseReceipt: () => { events.push('restore') },
      writeReceipt: (_request, status) => { events.push(`receipt:${status}`) },
      finalizeTransaction: () => { events.push('finalize') },
      helperIsLive: () => { checks += 1; return checks === 2 },
    }

    expect(() => recoverPendingMacUpdateStartup(
      root,
      update.currentVersion,
      join(update.currentApp, 'Contents', 'MacOS', 'e-Mate'),
      recovery,
    )).toThrow('live macOS update helper')
    expect(checks).toBe(2)
    expect(events).toEqual([`validate:${update.currentApp}:${update.currentVersion}`])
  })
})
