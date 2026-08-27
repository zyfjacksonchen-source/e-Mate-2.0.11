/** Detached, rollback-safe replacement for a validated macOS desktop update. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  accessSync,
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { MACOS_UNIVERSAL_NATIVE_ENTRIES } from './mac-universal-inventory.ts'
import { macAppBundleFromExecutable } from './installation-cleanup.ts'
import {
  compareSemVerVersions,
  parseSemVer,
  validateDesktopReleaseArtifact,
  type DesktopReleaseArtifact,
} from './update-checker.ts'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const ACK_PATH = 'EMATE_MAC_UPDATE_ACK_PATH'
const ACK_TOKEN = 'EMATE_MAC_UPDATE_ACK_TOKEN'
const ACK_VERSION = 'EMATE_MAC_UPDATE_ACK_VERSION'
const ACK_TRANSACTION_ID = 'EMATE_MAC_UPDATE_ACK_TRANSACTION_ID'
const ACK_SOURCE_COMMIT = 'EMATE_MAC_UPDATE_ACK_SOURCE_COMMIT'
const ACK_BASE_CONTRACT_ID = 'EMATE_MAC_UPDATE_ACK_BASE_CONTRACT_ID'
const ACK_SCHEDULE_PROTOCOL_FLOOR = 'EMATE_MAC_UPDATE_ACK_SCHEDULE_PROTOCOL_FLOOR'
const ACK_MANIFEST_IDENTITY = 'EMATE_MAC_UPDATE_ACK_MANIFEST_IDENTITY'
const ACK_ARTIFACT = 'EMATE_MAC_UPDATE_ACK_ARTIFACT'
const ACK_CURRENT_APP = 'EMATE_MAC_UPDATE_ACK_CURRENT_APP'
const ACK_APP_ID = 'EMATE_MAC_UPDATE_ACK_APP_ID'
const ACK_TARGET_ARCH = 'EMATE_MAC_UPDATE_ACK_TARGET_ARCH'
const LEGACY_ACK_ENVIRONMENT_KEYS = [ACK_PATH, ACK_TOKEN, ACK_VERSION] as const
const ACK_ENVIRONMENT_KEYS = [
  ACK_PATH,
  ACK_TOKEN,
  ACK_VERSION,
  ACK_TRANSACTION_ID,
  ACK_SOURCE_COMMIT,
  ACK_BASE_CONTRACT_ID,
  ACK_SCHEDULE_PROTOCOL_FLOOR,
  ACK_MANIFEST_IDENTITY,
  ACK_ARTIFACT,
  ACK_CURRENT_APP,
  ACK_APP_ID,
  ACK_TARGET_ARCH,
] as const
const APP_ID = 'net.ecoremedia.e-mate'
const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/u
const TOKEN = /^[0-9a-f-]{36}$/u
const SOURCE_COMMIT = /^[0-9a-f]{40}$/u
const MANIFEST_IDENTITY = /^[0-9a-f]{64}$/u
const BASE_CONTRACT_ID = /^[A-Za-z0-9._-]{1,200}$/u
const RECEIPT_POLL_MS = 200
const HELPER_READY_TIMEOUT_MS = 10_000
const PARENT_EXIT_TIMEOUT_MS = 60_000
const STARTUP_TIMEOUT_MS = 60_000
const CANDIDATE_TERM_TIMEOUT_MS = 10_000
const CANDIDATE_KILL_TIMEOUT_MS = 5_000
const MAX_TRANSACTION_JSON_BYTES = 64 * 1024
const LEGACY_UPDATE_PREDECESSOR = '2.0.12'

export interface MacUpdateRequest {
  schemaVersion: 1
  transactionId: string
  parentPid: number
  currentApp: string
  appId: typeof APP_ID
  currentVersion: string
  targetVersion: string
  stagedApp: string
  backupApp: string
  failedApp: string
  trashApp: string
  receiptPath: string
  helperReadyPath: string
  shutdownReadyPath: string
  ackPath: string
  ackToken: string
  installedBaseReceiptPath: string
  /** Exact pre-transaction receipt bytes, or null when the Base has no receipt yet. */
  previousInstalledBaseReceipt: string | null
  sourceCommit: string
  baseContractId: string
  scheduleProtocolFloor: number
  manifestIdentity: string
  targetArch: 'arm64' | 'x64'
  artifact: DesktopReleaseArtifact
}

export interface LegacyMacUpdateRequest {
  schemaVersion: 1
  transactionId: string
  parentPid: number
  currentApp: string
  currentVersion: typeof LEGACY_UPDATE_PREDECESSOR
  targetVersion: string
  stagedApp: string
  backupApp: string
  failedApp: string
  trashApp: string
  receiptPath: string
  helperReadyPath: string
  shutdownReadyPath: string
  ackPath: string
  ackToken: string
}

interface MacUpdateCommitIdentity {
  readonly transactionId: string
  readonly token: string
  readonly version: string
  readonly sourceCommit: string
  readonly baseContractId: string
  readonly scheduleProtocolFloor: number
  readonly manifestIdentity: string
  readonly artifact: DesktopReleaseArtifact
  readonly currentApp: string
  readonly appId: typeof APP_ID
  readonly targetArch: 'arm64' | 'x64'
}

export interface MacUpdateCommitMessage extends MacUpdateCommitIdentity {
  readonly schemaVersion: 1
  readonly type: 'emate-mac-update-commit'
}

export interface MacUpdateCommitConfirmation extends MacUpdateCommitIdentity {
  readonly schemaVersion: 1
  readonly type: 'emate-mac-update-commit-confirmed'
}

export interface MacUpdateCommitApplied extends MacUpdateCommitIdentity {
  readonly schemaVersion: 1
  readonly type: 'emate-mac-update-commit-applied'
}

export type MacUpdateAppliedSender = () => Promise<void>
export type MacUpdateCommitSender = (message: MacUpdateCommitMessage) => Promise<MacUpdateAppliedSender>

export interface PreparedMacUpdateInstallation {
  /** Commit application shutdown only after the Cordis tree disposed successfully. */
  markShutdownReady(): void
}

export interface MacUpdateStartupResult {
  readonly status: 'installed' | 'rolled-back' | 'failed'
  readonly currentVersion: string
  readonly targetVersion: string
}

export interface MacUpdateStartupAcknowledgement extends MacUpdateStartupResult {
  /** Send only after renderer probation is lifted, the window is visible, and Schedule is opened. */
  readonly commitApplied: MacUpdateAppliedSender
}

export interface ScheduleMacUpdateOptions {
  readonly dmgPath: string
  readonly targetVersion: string
  readonly currentExecutable: string
  readonly userDataPath: string
  readonly homeDirectory: string
  readonly helperModulePath: string
  readonly sourceCommit: string
  readonly baseContractId: string
  readonly scheduleProtocolFloor: number
  readonly manifestIdentity: string
  readonly artifact: DesktopReleaseArtifact
  readonly parentPid?: number
  readonly signal?: AbortSignal
}

export type MacUpdatePreflightOptions = Omit<
  ScheduleMacUpdateOptions,
  'dmgPath' | 'parentPid' | 'signal'
>

export class MacUpdatePreflightError extends Error {
  readonly code = 'mac-preflight-failed' as const

  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'MacUpdatePreflightError'
  }
}

interface ValidatedMacUpdatePreflight {
  readonly targetVersion: string
  readonly artifact: DesktopReleaseArtifact
  readonly targetArch: 'arm64' | 'x64'
  readonly userDataPath: string
  readonly homeDirectory: string
  readonly trashDirectory: string
  readonly resolvedCurrent: string
  readonly currentVersion: string
  readonly installDirectory: string
}

export interface MacUpdateSwapAdapter {
  readonly rename: (from: string, to: string) => void
  readonly remove: (path: string) => void
  readonly assertMissing: (path: string) => void
  readonly validateTarget: (appPath: string, version: string) => void
  readonly validateInstalled: (appPath: string, version: string) => void
  readonly launch: (appPath: string, request: MacUpdateRequest, updated: boolean) => ChildProcess
  readonly waitForHealthy: (request: MacUpdateRequest, child: ChildProcess) => Promise<void>
  readonly confirmCandidate: (request: MacUpdateRequest, child: ChildProcess) => Promise<void>
  readonly signalCandidate: (child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL') => void
  readonly waitForExit: (child: ChildProcess, timeoutMs: number) => Promise<boolean>
  readonly writeInstalledBaseReceipt: (request: MacUpdateRequest) => () => void
  readonly validateInstalledBaseReceipt: (request: MacUpdateRequest) => void
  readonly writeReceipt: (request: MacUpdateRequest, status: string, error?: unknown) => void
  readonly armConfirmation: (request: MacUpdateRequest) => void
  readonly commitTransaction?: (request: MacUpdateRequest) => void
  readonly finalizeTransaction?: (request: MacUpdateRequest) => void
}

export interface LegacyMacUpdateSwapAdapter {
  readonly rename: (from: string, to: string) => void
  readonly remove: (path: string) => void
  readonly assertMissing: (path: string) => void
  readonly validateTarget: (appPath: string, version: string) => void
  readonly validateInstalled: (appPath: string, version: string) => void
  readonly launch: (appPath: string, request: LegacyMacUpdateRequest, updated: boolean) => ChildProcess
  readonly waitForHealthy: (request: LegacyMacUpdateRequest, child: ChildProcess) => Promise<void>
  readonly writeReceipt: (request: LegacyMacUpdateRequest, status: string, error?: unknown) => void
}

export interface MacUpdateRecoveryResult {
  readonly status: 'none' | 'committed' | 'rolled-back' | 'forward-resume'
  readonly relaunch: boolean
}

export interface MacUpdateRecoveryAdapter {
  readonly existsDirectory: (path: string) => boolean
  readonly validateInstalled: (path: string, version: string) => void
  readonly rename: (from: string, to: string) => void
  readonly remove: (path: string) => void
  readonly assertMissing: (path: string) => void
  readonly restoreInstalledBaseReceipt: (request: MacUpdateRequest) => void
  readonly writeReceipt: (request: MacUpdateRequest, status: string, error?: unknown) => void
  readonly finalizeTransaction: (request: MacUpdateRequest) => void
  readonly helperIsLive: (pid: number, requestPath: string) => boolean
}

export interface MacUpdateDurableIO {
  readonly lstat: (path: string) => { isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }
  readonly mkdir: (path: string, mode: number) => void
  readonly open: (path: string, flags: number, mode?: number) => number
  readonly write: (descriptor: number, data: string) => void
  readonly sync: (descriptor: number) => void
  readonly close: (descriptor: number) => void
  readonly rename: (from: string, to: string) => void
  readonly remove: (path: string) => void
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function realDirectory(path: string): string {
  const metadata = lstatSync(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`macOS update path is not a real directory: ${path}`)
  return realpathSync(path)
}

function realFile(path: string): string {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`macOS update path is not a real file: ${path}`)
  return realpathSync(path)
}

function stableVersion(value: string): string {
  const parsed = parseSemVer(value)
  if (parsed === null || parsed.prerelease.length > 0 || parsed.version !== value) {
    throw new Error('macOS update version must be stable Semantic Versioning')
  }
  return value
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function assertMissing(path: string): void {
  try {
    lstatSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw cause
  }
  throw new Error(`macOS update path already exists: ${path}`)
}

function run(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} exited ${String(result.status)}`).trim())
  return result.stdout
}

function allocatedBytes(path: string): bigint {
  const match = /^(0|[1-9][0-9]*)\s/u.exec(run('/usr/bin/du', ['-sk', path]))
  if (match === null) throw new Error('macOS update application size is unavailable')
  return BigInt(match[1]!) * 1024n
}

function bundleMetadata(appPath: string): { id: string; version: string } {
  const value = JSON.parse(run('/usr/bin/plutil', [
    '-convert', 'json', '-o', '-', join(appPath, 'Contents', 'Info.plist'),
  ])) as Record<string, unknown>
  if (value.CFBundleIdentifier !== APP_ID || typeof value.CFBundleShortVersionString !== 'string') {
    throw new Error('macOS update application identity is invalid')
  }
  return { id: APP_ID, version: stableVersion(value.CFBundleShortVersionString) }
}

function validateBundle(appPath: string, expectedVersion: string): void {
  const path = realDirectory(appPath)
  if (bundleMetadata(path).version !== expectedVersion) throw new Error('macOS update application version does not match the release')
  const executable = join(path, 'Contents', 'MacOS', 'e-Mate')
  run('/usr/bin/lipo', [executable, '-verify_arch', 'arm64'])
  run('/usr/bin/lipo', [executable, '-verify_arch', 'x86_64'])
  for (const entry of MACOS_UNIVERSAL_NATIVE_ENTRIES) {
    run('/usr/bin/lipo', [join(path, 'Contents', 'Resources', 'app.asar.unpacked', entry.path), '-verify_arch', entry.arch])
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', path])
}

function validateInstalledBundle(appPath: string, expectedVersion: string): void {
  const path = realDirectory(appPath)
  if (bundleMetadata(path).version !== expectedVersion) throw new Error('macOS update application version does not match the installed version')
  const executable = join(path, 'Contents', 'MacOS', 'e-Mate')
  run('/usr/bin/lipo', [executable, '-verify_arch', 'arm64'])
  run('/usr/bin/lipo', [executable, '-verify_arch', 'x86_64'])
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', path])
}

const defaultDurableIO: MacUpdateDurableIO = {
  lstat: lstatSync,
  mkdir: (path, mode) => { mkdirSync(path, { mode }) },
  open: (path, flags, mode) => openSync(path, flags, mode),
  write: (descriptor, data) => { writeFileSync(descriptor, data, 'utf8') },
  sync: fsyncSync,
  close: closeSync,
  rename: renameSync,
  remove: path => { rmSync(path, { force: true }) },
}

function assertMacUpdateDurableIO(): void {
  if (process.platform === 'win32') throw new Error('macOS update durable filesystem I/O is unavailable on Windows')
}

function syncMacUpdateDirectory(path: string, io: MacUpdateDurableIO): void {
  const descriptor = io.open(path, constants.O_RDONLY)
  const failures: unknown[] = []
  try { io.sync(descriptor) } catch (cause) { failures.push(cause) }
  try { io.close(descriptor) } catch (cause) { failures.push(cause) }
  if (failures.length > 1) throw new AggregateError(failures, 'macOS update directory sync failed')
  if (failures.length === 1) throw failures[0]
}

/** Create a macOS update directory chain and durably publish each new entry. */
export function createMacUpdateDurableDirectory(
  path: string,
  io: MacUpdateDurableIO = defaultDurableIO,
): void {
  assertMacUpdateDurableIO()
  const missing: string[] = []
  let current = path
  for (;;) {
    try {
      const metadata = io.lstat(current)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error(`macOS update path is not a real directory: ${current}`)
      }
      break
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      missing.push(current)
      const parent = dirname(current)
      if (parent === current) throw cause
      current = parent
    }
  }
  for (const directory of missing.reverse()) {
    io.mkdir(directory, 0o700)
    syncMacUpdateDirectory(dirname(directory), io)
  }
}

/**
 * Durably replace one macOS update JSON file; Windows requires a native write-through owner.
 * After rename, a directory-sync failure leaves final-path state uncertain and is never a commit receipt.
 */
export function writeMacUpdateDurableJson(
  path: string,
  value: unknown,
  io: MacUpdateDurableIO = defaultDurableIO,
): void {
  writeMacUpdateDurableText(path, `${JSON.stringify(value)}\n`, io)
}

function writeMacUpdateDurableText(
  path: string,
  value: string,
  io: MacUpdateDurableIO,
): void {
  assertMacUpdateDurableIO()
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let descriptor: number | undefined
  let ownsTemporary = false
  const closeDescriptor = (): void => {
    if (descriptor === undefined) return
    const current = descriptor
    descriptor = undefined
    io.close(current)
  }
  try {
    descriptor = io.open(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    )
    ownsTemporary = true
    io.write(descriptor, value)
    io.sync(descriptor)
    closeDescriptor()
    io.rename(temporary, path)
    ownsTemporary = false
    syncMacUpdateDirectory(dirname(path), io)
  } catch (cause) {
    const failures: unknown[] = [cause]
    try { closeDescriptor() } catch (closeCause) { failures.push(closeCause) }
    if (ownsTemporary) {
      try { io.remove(temporary) } catch (cleanupCause) { failures.push(cleanupCause) }
    }
    if (failures.length > 1) throw new AggregateError(failures, 'macOS update durable JSON write failed')
    throw cause
  }
}

function removeMacUpdateDurableFile(path: string, io: MacUpdateDurableIO): void {
  io.remove(path)
  syncMacUpdateDirectory(dirname(path), io)
}

function readJsonNoFollow(path: string): unknown {
  return JSON.parse(readTextNoFollow(path))
}

function readTextNoFollow(path: string): string {
  const before = lstatSync(path)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`macOS update path is not a real file: ${path}`)
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const opened = fstatSync(descriptor)
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`macOS update file changed while it was opened: ${path}`)
    }
    if (opened.size > MAX_TRANSACTION_JSON_BYTES) throw new Error(`macOS update file is too large: ${path}`)
    return readFileSync(descriptor, 'utf8')
  } finally {
    closeSync(descriptor)
  }
}

function commitIdentity(request: MacUpdateRequest): MacUpdateCommitIdentity {
  return {
    transactionId: request.transactionId,
    token: request.ackToken,
    version: request.targetVersion,
    sourceCommit: request.sourceCommit,
    baseContractId: request.baseContractId,
    scheduleProtocolFloor: request.scheduleProtocolFloor,
    manifestIdentity: request.manifestIdentity,
    artifact: request.artifact,
    currentApp: request.currentApp,
    appId: request.appId,
    targetArch: request.targetArch,
  }
}

const COMMIT_MESSAGE_KEYS = [
  'schemaVersion', 'type', 'transactionId', 'token', 'version', 'sourceCommit',
  'baseContractId', 'scheduleProtocolFloor', 'manifestIdentity', 'artifact',
  'currentApp', 'appId', 'targetArch',
] as const

function sameArtifact(value: unknown, expected: DesktopReleaseArtifact): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const artifact = value as Record<string, unknown>
  return Object.keys(artifact).length === 3
    && ['url', 'bytes', 'sha256'].every(key => Object.hasOwn(artifact, key))
    && artifact.url === expected.url && artifact.bytes === expected.bytes && artifact.sha256 === expected.sha256
}

function isBoundCommitMessage(value: unknown, type: string, expected: MacUpdateCommitIdentity): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const message = value as Record<string, unknown>
  return Object.keys(message).length === COMMIT_MESSAGE_KEYS.length
    && COMMIT_MESSAGE_KEYS.every(key => Object.hasOwn(message, key))
    && message.schemaVersion === 1 && message.type === type
    && message.transactionId === expected.transactionId && message.token === expected.token
    && message.version === expected.version && message.sourceCommit === expected.sourceCommit
    && message.baseContractId === expected.baseContractId
    && message.scheduleProtocolFloor === expected.scheduleProtocolFloor
    && message.manifestIdentity === expected.manifestIdentity
    && sameArtifact(message.artifact, expected.artifact)
    && message.currentApp === expected.currentApp && message.appId === expected.appId
    && message.targetArch === expected.targetArch
}

function receipt(request: MacUpdateRequest, status: string, error?: unknown): void {
  writeMacUpdateDurableJson(request.receiptPath, {
    schemaVersion: 1,
    transactionId: request.transactionId,
    status,
    token: request.ackToken,
    currentVersion: request.currentVersion,
    targetVersion: request.targetVersion,
    sourceCommit: request.sourceCommit,
    baseContractId: request.baseContractId,
    scheduleProtocolFloor: request.scheduleProtocolFloor,
    manifestIdentity: request.manifestIdentity,
    artifact: request.artifact,
    currentApp: request.currentApp,
    appId: request.appId,
    targetArch: request.targetArch,
    updatedAt: new Date().toISOString(),
    ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
  })
}

function legacyReceipt(request: LegacyMacUpdateRequest, status: string, error?: unknown): void {
  writeMacUpdateDurableJson(request.receiptPath, {
    schemaVersion: 1,
    transactionId: request.transactionId,
    status,
    token: request.ackToken,
    currentVersion: request.currentVersion,
    targetVersion: request.targetVersion,
    updatedAt: new Date().toISOString(),
    ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
  })
}

/** Persist the one installed Base identity before the rollback backup is cleaned. */
export function writeMacUpdateInstalledBaseReceipt(
  request: MacUpdateRequest,
  io: MacUpdateDurableIO = defaultDurableIO,
): () => void {
  let current: string | null = null
  try {
    const metadata = io.lstat(request.installedBaseReceiptPath)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('installed Base receipt is not a real file')
    }
    current = readTextNoFollow(request.installedBaseReceiptPath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
  if (current !== request.previousInstalledBaseReceipt) {
    throw new Error('installed Base receipt changed during the macOS update transaction')
  }
  const restore = (): void => {
    if (request.previousInstalledBaseReceipt === null) removeMacUpdateDurableFile(request.installedBaseReceiptPath, io)
    else writeMacUpdateDurableText(request.installedBaseReceiptPath, request.previousInstalledBaseReceipt, io)
  }
  const next = {
    schemaVersion: 1,
    documentType: 'emate.installed-base-receipt',
    transactionId: request.transactionId,
    appVersion: request.targetVersion,
    sourceCommit: request.sourceCommit,
    baseContractId: request.baseContractId,
    scheduleProtocolFloor: request.scheduleProtocolFloor,
    manifestIdentity: request.manifestIdentity,
    currentApp: request.currentApp,
    appId: request.appId,
    targetArch: request.targetArch,
    carrier: { kind: 'dmg', artifact: request.artifact },
    installedAt: new Date().toISOString(),
  }
  try {
    writeMacUpdateDurableJson(request.installedBaseReceiptPath, next, io)
  } catch (cause) {
    try {
      restore()
    } catch (restoreCause) {
      throw new AggregateError([cause, restoreCause], 'installed Base receipt commit and restore failed')
    }
    throw cause
  }
  return restore
}

const INSTALLED_BASE_RECEIPT_KEYS = [
  'schemaVersion', 'documentType', 'transactionId', 'appVersion', 'sourceCommit',
  'baseContractId', 'scheduleProtocolFloor', 'manifestIdentity', 'currentApp', 'appId',
  'targetArch', 'carrier', 'installedAt',
] as const

/** Re-read the canonical installed Base identity before any predecessor cleanup. */
function assertMacUpdateInstalledBaseReceipt(request: MacUpdateRequest): void {
  const value = readJsonNoFollow(request.installedBaseReceiptPath)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('installed Base receipt is invalid')
  }
  const installed = value as Record<string, unknown>
  const carrier = installed.carrier
  if (Object.keys(installed).length !== INSTALLED_BASE_RECEIPT_KEYS.length
    || !INSTALLED_BASE_RECEIPT_KEYS.every(key => Object.hasOwn(installed, key))
    || installed.schemaVersion !== 1 || installed.documentType !== 'emate.installed-base-receipt'
    || installed.transactionId !== request.transactionId || installed.appVersion !== request.targetVersion
    || installed.sourceCommit !== request.sourceCommit || installed.baseContractId !== request.baseContractId
    || installed.scheduleProtocolFloor !== request.scheduleProtocolFloor
    || installed.manifestIdentity !== request.manifestIdentity || installed.currentApp !== request.currentApp
    || installed.appId !== request.appId || installed.targetArch !== request.targetArch
    || !isIsoTimestamp(installed.installedAt)
    || carrier === null || typeof carrier !== 'object' || Array.isArray(carrier)
    || Object.keys(carrier).length !== 2 || !Object.hasOwn(carrier, 'kind') || !Object.hasOwn(carrier, 'artifact')
    || (carrier as Record<string, unknown>).kind !== 'dmg'
    || !sameArtifact((carrier as Record<string, unknown>).artifact, request.artifact)) {
    throw new Error('installed Base receipt is invalid')
  }
}

const REQUEST_KEYS = [
  'schemaVersion', 'transactionId', 'parentPid', 'currentApp', 'appId', 'currentVersion', 'targetVersion',
  'stagedApp', 'backupApp', 'failedApp', 'trashApp', 'receiptPath', 'helperReadyPath',
  'shutdownReadyPath', 'ackPath', 'ackToken', 'installedBaseReceiptPath',
  'previousInstalledBaseReceipt', 'sourceCommit', 'baseContractId', 'scheduleProtocolFloor',
  'manifestIdentity', 'targetArch', 'artifact',
] as const

function validateRequest(value: unknown, requestPath: string): MacUpdateRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('macOS update request is invalid')
  if (Object.keys(value).length !== REQUEST_KEYS.length
    || !REQUEST_KEYS.every(key => Object.hasOwn(value, key))) throw new Error('macOS update request is invalid')
  const request = value as Partial<MacUpdateRequest>
  if (request.schemaVersion !== 1 || typeof request.transactionId !== 'string' || !TRANSACTION_ID.test(request.transactionId)
    || !Number.isSafeInteger(request.parentPid) || (request.parentPid ?? 0) <= 1
    || typeof request.currentApp !== 'string' || request.appId !== APP_ID || typeof request.stagedApp !== 'string'
    || typeof request.backupApp !== 'string' || typeof request.failedApp !== 'string'
    || typeof request.trashApp !== 'string' || typeof request.receiptPath !== 'string'
    || typeof request.helperReadyPath !== 'string' || typeof request.shutdownReadyPath !== 'string'
    || typeof request.ackPath !== 'string' || typeof request.ackToken !== 'string' || !TOKEN.test(request.ackToken)
    || typeof request.installedBaseReceiptPath !== 'string'
    || (request.previousInstalledBaseReceipt !== null && typeof request.previousInstalledBaseReceipt !== 'string')
    || typeof request.sourceCommit !== 'string' || !SOURCE_COMMIT.test(request.sourceCommit)
    || typeof request.baseContractId !== 'string' || !BASE_CONTRACT_ID.test(request.baseContractId)
    || !Number.isSafeInteger(request.scheduleProtocolFloor) || (request.scheduleProtocolFloor ?? 0) <= 0
    || typeof request.manifestIdentity !== 'string' || !MANIFEST_IDENTITY.test(request.manifestIdentity)
    || (request.targetArch !== 'arm64' && request.targetArch !== 'x64') || request.targetArch !== process.arch
    || typeof request.currentVersion !== 'string' || typeof request.targetVersion !== 'string') {
    throw new Error('macOS update request is invalid')
  }
  stableVersion(request.currentVersion)
  stableVersion(request.targetVersion)
  if ((compareSemVerVersions(request.targetVersion, request.currentVersion) ?? 0) <= 0) {
    throw new Error('macOS update target must be newer than the installed version')
  }
  const root = realDirectory(dirname(requestPath))
  if (basename(root) !== `install-${request.transactionId}`
    || basename(dirname(root)) !== request.targetVersion
    || basename(dirname(dirname(root))) !== 'updates'
    || basename(requestPath) !== 'request.json'
    || resolve(request.receiptPath) !== join(root, 'receipt.json')
    || resolve(request.helperReadyPath) !== join(root, 'helper-ready.json')
    || resolve(request.shutdownReadyPath) !== join(root, 'shutdown-ready.json')
    || resolve(request.ackPath) !== join(root, 'startup-ack.json')
    || resolve(request.installedBaseReceiptPath) !== join(dirname(dirname(root)), 'installed-base.json')) {
    throw new Error('macOS update state path escaped its transaction directory')
  }
  const artifactKeys = request.artifact === null || typeof request.artifact !== 'object' || Array.isArray(request.artifact)
    ? []
    : Object.keys(request.artifact)
  const artifact = validateDesktopReleaseArtifact('darwin', request.targetVersion, request.artifact)
  if (artifact === null || artifactKeys.length !== 3
    || !artifactKeys.every(key => ['url', 'bytes', 'sha256'].includes(key))
    || !new URL(artifact.url).pathname.includes(`/${request.sourceCommit}/`)) {
    throw new Error('macOS update artifact identity is invalid')
  }
  const appParent = dirname(resolve(request.currentApp))
  const suffix = request.transactionId.slice(0, 8)
  if (![join('/Applications', 'e-Mate.app'), join(homedir(), 'Applications', 'e-Mate.app')]
    .includes(resolve(request.currentApp))
    || resolve(request.stagedApp) !== join(appParent, `.e-Mate-${request.targetVersion}-${suffix}.staged.app`)
    || resolve(request.backupApp) !== join(appParent, `.e-Mate-${request.currentVersion}-${suffix}.backup.app`)
    || resolve(request.failedApp) !== join(appParent, `.e-Mate-${request.targetVersion}-${suffix}.failed.app`)) {
    throw new Error('macOS update application path escaped its install directory')
  }
  if (resolve(request.trashApp) !== join(homedir(), '.Trash', `e-Mate ${request.currentVersion} Update Backup ${suffix}.app`)) {
    throw new Error('macOS update backup path escaped Trash')
  }
  return request as MacUpdateRequest
}

/** Open the helper request without following a replaceable request-file symlink. */
export function readMacUpdateRequest(requestPath: string): MacUpdateRequest {
  return validateRequest(readJsonNoFollow(requestPath), requestPath)
}

const LEGACY_REQUEST_KEYS = [
  'schemaVersion', 'transactionId', 'parentPid', 'currentApp', 'currentVersion', 'targetVersion',
  'stagedApp', 'backupApp', 'failedApp', 'trashApp', 'receiptPath', 'helperReadyPath',
  'shutdownReadyPath', 'ackPath', 'ackToken',
] as const

function validateLegacyMacUpdateRequest(value: unknown, requestPath: string): LegacyMacUpdateRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== LEGACY_REQUEST_KEYS.length
    || !LEGACY_REQUEST_KEYS.every(key => Object.hasOwn(value, key))) {
    throw new Error('legacy macOS update request is invalid')
  }
  const request = value as Partial<LegacyMacUpdateRequest>
  if (request.schemaVersion !== 1 || typeof request.transactionId !== 'string' || !TRANSACTION_ID.test(request.transactionId)
    || !Number.isSafeInteger(request.parentPid) || (request.parentPid ?? 0) <= 1
    || typeof request.currentApp !== 'string' || typeof request.stagedApp !== 'string'
    || typeof request.backupApp !== 'string' || typeof request.failedApp !== 'string'
    || typeof request.trashApp !== 'string' || typeof request.receiptPath !== 'string'
    || typeof request.helperReadyPath !== 'string' || typeof request.shutdownReadyPath !== 'string'
    || typeof request.ackPath !== 'string' || typeof request.ackToken !== 'string' || !TOKEN.test(request.ackToken)
    || request.currentVersion !== LEGACY_UPDATE_PREDECESSOR || typeof request.targetVersion !== 'string') {
    throw new Error('legacy macOS update request is invalid')
  }
  stableVersion(request.targetVersion)
  if ((compareSemVerVersions(request.targetVersion, request.currentVersion) ?? 0) <= 0) {
    throw new Error('legacy macOS update target must be newer than the installed version')
  }
  const root = realDirectory(dirname(requestPath))
  const suffix = request.transactionId.slice(0, 8)
  const appParent = dirname(resolve(request.currentApp))
  if (basename(root) !== `install-${request.transactionId}`
    || basename(dirname(root)) !== request.targetVersion || basename(dirname(dirname(root))) !== 'updates'
    || basename(requestPath) !== 'request.json'
    || resolve(request.receiptPath) !== join(root, 'receipt.json')
    || resolve(request.helperReadyPath) !== join(root, 'helper-ready.json')
    || resolve(request.shutdownReadyPath) !== join(root, 'shutdown-ready.json')
    || resolve(request.ackPath) !== join(root, 'startup-ack.json')
    || ![join('/Applications', 'e-Mate.app'), join(homedir(), 'Applications', 'e-Mate.app')]
      .includes(resolve(request.currentApp))
    || resolve(request.stagedApp) !== join(appParent, `.e-Mate-${request.targetVersion}-${suffix}.staged.app`)
    || resolve(request.backupApp) !== join(appParent, `.e-Mate-${LEGACY_UPDATE_PREDECESSOR}-${suffix}.backup.app`)
    || resolve(request.failedApp) !== join(appParent, `.e-Mate-${request.targetVersion}-${suffix}.failed.app`)
    || resolve(request.trashApp) !== join(homedir(), '.Trash', `e-Mate ${LEGACY_UPDATE_PREDECESSOR} Update Backup ${suffix}.app`)) {
    throw new Error('legacy macOS update request is invalid')
  }
  return request as LegacyMacUpdateRequest
}

/** Read the exact 2.0.12 update request without widening the modern request contract. */
export function readLegacyMacUpdateRequest(requestPath: string): LegacyMacUpdateRequest {
  return validateLegacyMacUpdateRequest(readJsonNoFollow(requestPath), requestPath)
}

export type MacUpdateRequestEnvelope =
  | { readonly kind: 'legacy-2.0.12'; readonly request: LegacyMacUpdateRequest }
  | { readonly kind: 'bound-v1'; readonly request: MacUpdateRequest }

/** Select the protocol by its exact field set before applying protocol-specific validation. */
export function readMacUpdateRequestEnvelope(requestPath: string): MacUpdateRequestEnvelope {
  const value = readJsonNoFollow(requestPath)
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value)
    if (keys.length === LEGACY_REQUEST_KEYS.length && LEGACY_REQUEST_KEYS.every(key => Object.hasOwn(value, key))) {
      return { kind: 'legacy-2.0.12', request: validateLegacyMacUpdateRequest(value, requestPath) }
    }
    if (keys.length === REQUEST_KEYS.length && REQUEST_KEYS.every(key => Object.hasOwn(value, key))) {
      return { kind: 'bound-v1', request: validateRequest(value, requestPath) }
    }
  }
  throw new Error('macOS update request envelope is invalid')
}

function sameLegacyMacUpdateRequest(left: LegacyMacUpdateRequest, right: LegacyMacUpdateRequest): boolean {
  return LEGACY_REQUEST_KEYS.every(key => left[key] === right[key])
}

interface MacUpdatePendingReceipt extends MacUpdateCommitIdentity {
  readonly schemaVersion: 1
  readonly documentType: 'emate.mac-update-pending'
  readonly requestPath: string
  readonly phase: 'pending' | 'confirmation-armed' | 'commit-ready'
  readonly helperPid: number | null
  readonly createdAt: string
  readonly updatedAt: string
}

const PENDING_KEYS = [
  'schemaVersion', 'documentType', 'requestPath', 'phase', 'helperPid', 'createdAt', 'updatedAt', 'transactionId', 'token', 'version',
  'sourceCommit', 'baseContractId', 'scheduleProtocolFloor', 'manifestIdentity', 'artifact',
  'currentApp', 'appId', 'targetArch',
] as const

function pendingReceiptPath(request: MacUpdateRequest): string {
  return join(dirname(request.installedBaseReceiptPath), 'pending-mac-update.json')
}

function pendingReceipt(
  request: MacUpdateRequest,
  requestPath: string,
  phase: MacUpdatePendingReceipt['phase'] = 'pending',
  createdAt: string = new Date().toISOString(),
  helperPid: number | null = null,
): MacUpdatePendingReceipt {
  return {
    schemaVersion: 1,
    documentType: 'emate.mac-update-pending',
    requestPath,
    phase,
    helperPid,
    createdAt,
    updatedAt: new Date().toISOString(),
    ...commitIdentity(request),
  }
}

/** Atomically claim the one updater owner before staging or spawning a helper. */
export function claimMacUpdatePendingTransaction(
  request: MacUpdateRequest,
  requestPath: string,
  io: MacUpdateDurableIO = defaultDurableIO,
): void {
  assertMacUpdateDurableIO()
  const path = pendingReceiptPath(request)
  let descriptor: number | undefined
  try {
    descriptor = io.open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    io.write(descriptor, `${JSON.stringify(pendingReceipt(request, requestPath))}\n`)
    io.sync(descriptor)
    io.close(descriptor)
    descriptor = undefined
    syncMacUpdateDirectory(dirname(path), io)
  } catch (cause) {
    if (descriptor !== undefined) {
      try { io.close(descriptor) } catch (closeCause) {
        throw new AggregateError([cause, closeCause], 'macOS update pending transaction claim failed')
      }
    }
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('another macOS update transaction is pending')
    }
    throw cause
  }
}

function matchesPendingReceipt(value: unknown, request: MacUpdateRequest, requestPath: string): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const pending = value as Record<string, unknown>
  return Object.keys(pending).length === PENDING_KEYS.length
    && PENDING_KEYS.every(key => Object.hasOwn(pending, key))
    && pending.schemaVersion === 1 && pending.documentType === 'emate.mac-update-pending'
    && pending.requestPath === requestPath
    && (pending.phase === 'pending' || pending.phase === 'confirmation-armed' || pending.phase === 'commit-ready')
    && (pending.helperPid === null || (Number.isSafeInteger(pending.helperPid) && (pending.helperPid as number) > 1))
    && typeof pending.createdAt === 'string' && typeof pending.updatedAt === 'string'
    && pending.transactionId === request.transactionId && pending.token === request.ackToken
    && pending.version === request.targetVersion && pending.sourceCommit === request.sourceCommit
    && pending.baseContractId === request.baseContractId
    && pending.scheduleProtocolFloor === request.scheduleProtocolFloor
    && pending.manifestIdentity === request.manifestIdentity
    && sameArtifact(pending.artifact, request.artifact)
    && pending.currentApp === request.currentApp && pending.appId === request.appId
    && pending.targetArch === request.targetArch
}

function assertPendingOwner(request: MacUpdateRequest, requestPath: string): MacUpdatePendingReceipt {
  const value = readJsonNoFollow(pendingReceiptPath(request))
  if (!matchesPendingReceipt(value, request, requestPath)) {
    throw new Error('macOS update pending transaction owner is invalid')
  }
  return value as MacUpdatePendingReceipt
}

function updateMacUpdatePendingTransaction(
  request: MacUpdateRequest,
  phase: MacUpdatePendingReceipt['phase'],
): void {
  const requestPath = join(dirname(request.receiptPath), 'request.json')
  const path = pendingReceiptPath(request)
  const current = assertPendingOwner(request, requestPath)
  writeMacUpdateDurableJson(path, pendingReceipt(
    request,
    requestPath,
    phase,
    current.createdAt,
    current.helperPid,
  ))
}

function assignMacUpdatePendingHelper(request: MacUpdateRequest, requestPath: string, helperPid: number): void {
  if (!Number.isSafeInteger(helperPid) || helperPid <= 1) throw new Error('macOS update helper pid is invalid')
  const current = assertPendingOwner(request, requestPath)
  if (current.phase !== 'pending' || (current.helperPid !== null && current.helperPid !== helperPid)) {
    throw new Error('macOS update pending helper owner is invalid')
  }
  writeMacUpdateDurableJson(pendingReceiptPath(request), pendingReceipt(
    request,
    requestPath,
    current.phase,
    current.createdAt,
    helperPid,
  ))
}

async function waitForMacUpdatePendingHelper(request: MacUpdateRequest, requestPath: string, helperPid: number): Promise<void> {
  const deadline = Date.now() + HELPER_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    const current = assertPendingOwner(request, requestPath)
    if (current.helperPid === helperPid) return
    if (current.helperPid !== null) throw new Error('macOS update helper lease belongs to another process')
    if (!processIsRunning(request.parentPid)) throw new Error('macOS update parent exited before assigning the helper lease')
    await new Promise(resolveWait => setTimeout(resolveWait, RECEIPT_POLL_MS))
  }
  throw new Error('macOS update helper lease was not assigned')
}

function armMacUpdatePendingConfirmation(request: MacUpdateRequest): void {
  updateMacUpdatePendingTransaction(request, 'confirmation-armed')
}

function commitMacUpdatePendingTransaction(request: MacUpdateRequest): void {
  updateMacUpdatePendingTransaction(request, 'commit-ready')
}

function clearMacUpdatePendingTransaction(request: MacUpdateRequest): void {
  const requestPath = join(dirname(request.receiptPath), 'request.json')
  assertPendingOwner(request, requestPath)
  removeMacUpdateDurableFile(pendingReceiptPath(request), defaultDurableIO)
}

function existingRealDirectory(path: string): boolean {
  try {
    realDirectory(path)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

function renameRealDirectory(from: string, to: string): void {
  realDirectory(from)
  assertMissing(to)
  renameSync(from, to)
  realDirectory(to)
}

function removeRealDirectory(path: string): void {
  realDirectory(path)
  rmSync(path, { recursive: true })
}

function restorePreviousInstalledBaseReceipt(request: MacUpdateRequest): void {
  let current: string | null = null
  try { current = readTextNoFollow(request.installedBaseReceiptPath) } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
  if (current === request.previousInstalledBaseReceipt) return
  if (request.previousInstalledBaseReceipt === null) {
    removeMacUpdateDurableFile(request.installedBaseReceiptPath, defaultDurableIO)
  } else {
    writeMacUpdateDurableText(request.installedBaseReceiptPath, request.previousInstalledBaseReceipt, defaultDurableIO)
  }
}

function macUpdateHelperIsLive(pid: number, requestPath: string): boolean {
  if (!processIsRunning(pid)) return false
  const result = spawnSync('/bin/ps', ['-ww', '-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    if (!processIsRunning(pid)) return false
    throw new Error('macOS update helper process identity could not be verified')
  }
  const command = result.stdout.trim()
  if (!command.includes('/mac-update-helper.js ') || !command.endsWith(requestPath)) {
    throw new Error('macOS update helper pid is live with an unverified process identity')
  }
  return true
}

const defaultRecoveryAdapter: MacUpdateRecoveryAdapter = {
  existsDirectory: existingRealDirectory,
  validateInstalled: validateInstalledBundle,
  rename: renameRealDirectory,
  remove: removeRealDirectory,
  assertMissing,
  restoreInstalledBaseReceipt: restorePreviousInstalledBaseReceipt,
  writeReceipt: receipt,
  finalizeTransaction: clearMacUpdatePendingTransaction,
  helperIsLive: macUpdateHelperIsLive,
}

function readPendingTransaction(
  userDataPath: string,
): { request: MacUpdateRequest; requestPath: string; owner: MacUpdatePendingReceipt } | undefined {
  const root = realDirectory(userDataPath)
  const updates = join(root, 'updates')
  try { realDirectory(updates) } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
  const path = join(updates, 'pending-mac-update.json')
  let value: unknown
  try { value = readJsonNoFollow(path) } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('macOS update pending transaction receipt is invalid')
  }
  const requestPath = (value as Record<string, unknown>).requestPath
  if (typeof requestPath !== 'string' || !isAbsolute(requestPath) || resolve(requestPath) !== requestPath
    || !inside(updates, requestPath) || basename(requestPath) !== 'request.json') {
    throw new Error('macOS update pending transaction request path is invalid')
  }
  const request = readMacUpdateRequest(requestPath)
  if (request.installedBaseReceiptPath !== join(updates, 'installed-base.json')
    || pendingReceiptPath(request) !== path || !matchesPendingReceipt(value, request, requestPath)) {
    throw new Error('macOS update pending transaction receipt is invalid')
  }
  return { request, requestPath, owner: value as MacUpdatePendingReceipt }
}

function readTransactionReceiptStatus(request: MacUpdateRequest): string | undefined {
  let value: unknown
  try { value = readJsonNoFollow(request.receiptPath) } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('macOS update transaction receipt is invalid')
  }
  const state = value as Record<string, unknown>
  const required = [
    'schemaVersion', 'transactionId', 'status', 'token', 'currentVersion', 'targetVersion',
    'sourceCommit', 'baseContractId', 'scheduleProtocolFloor', 'manifestIdentity', 'artifact',
    'currentApp', 'appId', 'targetArch', 'updatedAt',
  ]
  if ((Object.keys(state).length !== required.length && Object.keys(state).length !== required.length + 1)
    || !required.every(key => Object.hasOwn(state, key))
    || Object.keys(state).some(key => !required.includes(key) && key !== 'error')
    || state.schemaVersion !== 1 || state.transactionId !== request.transactionId
    || state.token !== request.ackToken || state.currentVersion !== request.currentVersion
    || state.targetVersion !== request.targetVersion || state.sourceCommit !== request.sourceCommit
    || state.baseContractId !== request.baseContractId
    || state.scheduleProtocolFloor !== request.scheduleProtocolFloor
    || state.manifestIdentity !== request.manifestIdentity
    || !sameArtifact(state.artifact, request.artifact) || typeof state.status !== 'string'
    || state.currentApp !== request.currentApp || state.appId !== request.appId || state.targetArch !== request.targetArch
    || typeof state.updatedAt !== 'string' || (Object.hasOwn(state, 'error') && typeof state.error !== 'string')) {
    throw new Error('macOS update transaction receipt is invalid')
  }
  return state.status
}

function sameMacUpdateRequest(left: MacUpdateRequest, right: MacUpdateRequest): boolean {
  return REQUEST_KEYS.every(key => key === 'artifact'
    ? sameArtifact(left.artifact, right.artifact)
    : left[key] === right[key])
}

function samePendingOwner(left: MacUpdatePendingReceipt, right: MacUpdatePendingReceipt): boolean {
  return left.phase === right.phase && left.helperPid === right.helperPid
    && left.createdAt === right.createdAt && left.updatedAt === right.updatedAt
    && left.requestPath === right.requestPath && left.transactionId === right.transactionId
    && left.token === right.token && left.version === right.version
    && left.sourceCommit === right.sourceCommit && left.baseContractId === right.baseContractId
    && left.scheduleProtocolFloor === right.scheduleProtocolFloor
    && left.manifestIdentity === right.manifestIdentity && left.currentApp === right.currentApp
    && left.appId === right.appId && left.targetArch === right.targetArch
    && sameArtifact(left.artifact, right.artifact)
}

function assertRecoveryOwnerInactive(
  userDataPath: string,
  expected: { request: MacUpdateRequest; requestPath: string; owner: MacUpdatePendingReceipt },
  adapter: MacUpdateRecoveryAdapter,
): MacUpdatePendingReceipt {
  const current = readPendingTransaction(userDataPath)
  if (current === undefined || current.requestPath !== expected.requestPath
    || !sameMacUpdateRequest(current.request, expected.request)
    || !samePendingOwner(current.owner, expected.owner)) {
    throw new Error('macOS update pending transaction changed during recovery')
  }
  if (current.owner.helperPid !== null && adapter.helperIsLive(current.owner.helperPid, current.requestPath)) {
    throw new Error('live macOS update helper still owns the pending transaction')
  }
  const confirmed = readPendingTransaction(userDataPath)
  if (confirmed === undefined || confirmed.requestPath !== current.requestPath
    || !sameMacUpdateRequest(confirmed.request, current.request)
    || !samePendingOwner(confirmed.owner, current.owner)) {
    throw new Error('macOS update pending transaction changed while helper liveness was checked')
  }
  return confirmed.owner
}

function assertForwardResumeState(
  userDataPath: string,
  currentVersion: string,
  currentExecutable: string,
  adapter: MacUpdateRecoveryAdapter,
): { request: MacUpdateRequest; requestPath: string } {
  const pending = readPendingTransaction(userDataPath)
  if (pending === undefined) throw new Error('forward macOS update transaction is unavailable')
  const { request, requestPath, owner } = pending
  const currentApp = macAppBundleFromExecutable(currentExecutable)
  const status = readTransactionReceiptStatus(request)
  if (currentApp === undefined || resolve(currentApp) !== request.currentApp
    || currentVersion !== request.targetVersion
    || (owner.phase === 'pending' && status !== 'committed-unknown')
    || !adapter.existsDirectory(request.currentApp) || !adapter.existsDirectory(request.backupApp)) {
    throw new Error('forward macOS update does not match the installed transaction')
  }
  if (owner.helperPid !== null && adapter.helperIsLive(owner.helperPid, requestPath)) {
    throw new Error('live macOS update helper still owns the pending transaction')
  }
  adapter.validateInstalled(request.currentApp, request.targetVersion)
  assertMacUpdateStartupAck(request)
  assertMacUpdateInstalledBaseReceipt(request)
  return { request, requestPath }
}

/** Resolve a detached-helper crash before an ordinary process can boot the pending Base. */
export function recoverPendingMacUpdateStartup(
  userDataPath: string,
  currentVersion: string,
  currentExecutable: string,
  adapter: MacUpdateRecoveryAdapter = defaultRecoveryAdapter,
): MacUpdateRecoveryResult {
  const pending = readPendingTransaction(userDataPath)
  if (pending === undefined) return { status: 'none', relaunch: false }
  const { request, requestPath, owner } = pending
  const currentApp = macAppBundleFromExecutable(currentExecutable)
  if (currentApp === undefined || resolve(currentApp) !== request.currentApp
    || (currentVersion !== request.currentVersion && currentVersion !== request.targetVersion)) {
    throw new Error('ordinary startup does not match the pending macOS update transaction')
  }
  if (owner.helperPid !== null && adapter.helperIsLive(owner.helperPid, requestPath)) {
    throw new Error('live macOS update helper still owns the pending transaction')
  }
  const status = readTransactionReceiptStatus(request)
  if (status === 'completed' || status === 'completed-cleanup-failed') {
    if (currentVersion !== request.targetVersion || !adapter.existsDirectory(request.currentApp)) {
      throw new Error('completed macOS update does not match the installed application')
    }
    adapter.validateInstalled(request.currentApp, request.targetVersion)
    assertMacUpdateInstalledBaseReceipt(request)
    assertRecoveryOwnerInactive(userDataPath, pending, adapter)
    assertMacUpdateInstalledBaseReceipt(request)
    if (adapter.existsDirectory(request.backupApp)) {
      try {
        adapter.rename(request.backupApp, request.trashApp)
      } catch (cleanupCause) {
        try {
          adapter.remove(request.backupApp)
        } catch (removeCause) {
          adapter.writeReceipt(request, 'completed-cleanup-failed', new AggregateError([cleanupCause, removeCause]))
          return { status: 'committed', relaunch: false }
        }
      }
    }
    adapter.finalizeTransaction(request)
    return { status: 'committed', relaunch: false }
  }
  if (owner.phase !== 'pending' || status === 'committed-unknown') {
    assertForwardResumeState(userDataPath, currentVersion, currentExecutable, adapter)
    return { status: 'forward-resume', relaunch: false }
  }
  let rollbackStarted = false
  try {
    if (adapter.existsDirectory(request.backupApp)) {
      adapter.validateInstalled(request.backupApp, request.currentVersion)
      const targetPresent = adapter.existsDirectory(request.currentApp)
      if (targetPresent) {
        adapter.validateInstalled(request.currentApp, request.targetVersion)
        adapter.assertMissing(request.failedApp)
      }
      const currentOwner = assertRecoveryOwnerInactive(userDataPath, pending, adapter)
      if (currentOwner.phase !== 'pending') {
        throw new Error('macOS update entered confirmation while recovery was starting')
      }
      rollbackStarted = true
      if (targetPresent) {
        adapter.rename(request.currentApp, request.failedApp)
      }
      adapter.rename(request.backupApp, request.currentApp)
      adapter.validateInstalled(request.currentApp, request.currentVersion)
      if (adapter.existsDirectory(request.failedApp)) adapter.remove(request.failedApp)
    } else {
      if (currentVersion !== request.currentVersion || !adapter.existsDirectory(request.currentApp)) {
        throw new Error('pending macOS update backup is unavailable for rollback')
      }
      adapter.validateInstalled(request.currentApp, request.currentVersion)
      const currentOwner = assertRecoveryOwnerInactive(userDataPath, pending, adapter)
      if (currentOwner.phase !== 'pending') {
        throw new Error('macOS update entered confirmation while recovery was starting')
      }
      rollbackStarted = true
      if (adapter.existsDirectory(request.stagedApp)) adapter.remove(request.stagedApp)
    }
    adapter.restoreInstalledBaseReceipt(request)
    adapter.writeReceipt(request, 'rolled-back', new Error('recovered an interrupted detached macOS update helper'))
    adapter.finalizeTransaction(request)
    return { status: 'rolled-back', relaunch: currentVersion === request.targetVersion }
  } catch (cause) {
    if (rollbackStarted) adapter.writeReceipt(request, 'rollback-failed', cause)
    throw cause
  }
}

/** Finish one potentially-applied candidate on its next probation startup; never restore the predecessor. */
export function resumePendingMacUpdateStartup(
  userDataPath: string,
  currentVersion: string,
  currentExecutable: string,
  adapter: MacUpdateRecoveryAdapter = defaultRecoveryAdapter,
): MacUpdateStartupAcknowledgement {
  const pending = assertForwardResumeState(userDataPath, currentVersion, currentExecutable, adapter)
  adapter.writeReceipt(pending.request, 'committed-unknown')
  const commitApplied = async (): Promise<void> => {
    const current = assertForwardResumeState(userDataPath, currentVersion, currentExecutable, adapter)
    if (!sameMacUpdateRequest(current.request, pending.request) || current.requestPath !== pending.requestPath) {
      throw new Error('forward macOS update transaction changed before commit')
    }
    let completed = false
    try {
      commitMacUpdatePendingTransaction(current.request)
      adapter.writeReceipt(current.request, 'completed')
      completed = true
      assertMacUpdateInstalledBaseReceipt(current.request)
      try {
        adapter.rename(current.request.backupApp, current.request.trashApp)
      } catch (cleanupCause) {
        try {
          adapter.remove(current.request.backupApp)
        } catch (removeCause) {
          adapter.writeReceipt(current.request, 'completed-cleanup-failed', new AggregateError([cleanupCause, removeCause]))
          return
        }
      }
      adapter.finalizeTransaction(current.request)
    } catch (cause) {
      try {
        adapter.writeReceipt(current.request, completed ? 'completed-cleanup-failed' : 'committed-unknown', cause)
      } catch {}
      throw cause
    }
  }
  return {
    status: 'installed',
    currentVersion,
    targetVersion: pending.request.targetVersion,
    commitApplied,
  }
}

function waitForParentExit(pid: number): Promise<void> {
  const deadline = Date.now() + PARENT_EXIT_TIMEOUT_MS
  return new Promise((resolveWait, reject) => {
    const poll = (): void => {
      try {
        process.kill(pid, 0)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ESRCH') { resolveWait(); return }
        reject(cause); return
      }
      if (Date.now() >= deadline) { reject(new Error('macOS update timed out waiting for e-Mate to exit')); return }
      setTimeout(poll, RECEIPT_POLL_MS)
    }
    poll()
  })
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw cause
  }
}

function launchApp(appPath: string, request: MacUpdateRequest, updated: boolean): ChildProcess {
  const executable = join(realDirectory(appPath), 'Contents', 'MacOS', 'e-Mate')
  realFile(executable)
  const environment = { ...process.env }
  delete environment[RUN_AS_NODE]
  for (const name of Object.keys(environment)) {
    if (name.startsWith('EMATE_MAC_UPDATE_ACK_')) delete environment[name]
  }
  environment.EMATE_MAC_UPDATE_RESULT_PATH = request.receiptPath
  environment.EMATE_MAC_UPDATE_RESULT_TOKEN = request.ackToken
  environment.EMATE_MAC_UPDATE_RESULT_VERSION = request.targetVersion
  if (updated) {
    environment[ACK_PATH] = request.ackPath
    environment[ACK_TOKEN] = request.ackToken
    environment[ACK_VERSION] = request.targetVersion
    environment[ACK_TRANSACTION_ID] = request.transactionId
    environment[ACK_SOURCE_COMMIT] = request.sourceCommit
    environment[ACK_BASE_CONTRACT_ID] = request.baseContractId
    environment[ACK_SCHEDULE_PROTOCOL_FLOOR] = String(request.scheduleProtocolFloor)
    environment[ACK_MANIFEST_IDENTITY] = request.manifestIdentity
    environment[ACK_ARTIFACT] = JSON.stringify(request.artifact)
    environment[ACK_CURRENT_APP] = request.currentApp
    environment[ACK_APP_ID] = APP_ID
    environment[ACK_TARGET_ARCH] = request.targetArch
  }
  const child = spawn(executable, [], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: environment,
  })
  child.unref()
  return child
}

function launchLegacyApp(appPath: string, request: LegacyMacUpdateRequest, updated: boolean): ChildProcess {
  const executable = join(realDirectory(appPath), 'Contents', 'MacOS', 'e-Mate')
  realFile(executable)
  const environment = { ...process.env }
  delete environment[RUN_AS_NODE]
  for (const name of Object.keys(environment)) {
    if (name.startsWith('EMATE_MAC_UPDATE_ACK_')) delete environment[name]
  }
  environment.EMATE_MAC_UPDATE_RESULT_PATH = request.receiptPath
  environment.EMATE_MAC_UPDATE_RESULT_TOKEN = request.ackToken
  environment.EMATE_MAC_UPDATE_RESULT_VERSION = request.targetVersion
  if (updated) {
    environment[ACK_PATH] = request.ackPath
    environment[ACK_TOKEN] = request.ackToken
    environment[ACK_VERSION] = request.targetVersion
  }
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', env: environment })
  child.unref()
  return child
}

const LEGACY_STARTUP_ACK_KEYS = [
  'schemaVersion', 'status', 'token', 'version', 'pid', 'acknowledgedAt',
] as const

function assertLegacyMacUpdateStartupAck(request: LegacyMacUpdateRequest): void {
  const value = readJsonNoFollow(request.ackPath)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('legacy macOS update startup acknowledgement is invalid')
  }
  const ack = value as Record<string, unknown>
  if (Object.keys(ack).length !== LEGACY_STARTUP_ACK_KEYS.length
    || !LEGACY_STARTUP_ACK_KEYS.every(key => Object.hasOwn(ack, key))
    || ack.schemaVersion !== 1 || ack.status !== 'healthy'
    || ack.token !== request.ackToken || ack.version !== request.targetVersion
    || !Number.isSafeInteger(ack.pid) || (ack.pid as number) <= 1
    || !isIsoTimestamp(ack.acknowledgedAt)) {
    throw new Error('legacy macOS update startup acknowledgement is invalid')
  }
}

async function waitForLegacyHealthy(request: LegacyMacUpdateRequest, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('updated e-Mate exited before startup became healthy')
    }
    try {
      assertLegacyMacUpdateStartupAck(request)
      return
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' && !(cause instanceof SyntaxError)
        && !(cause instanceof Error && cause.message === 'legacy macOS update startup acknowledgement is invalid')) {
        throw cause
      }
    }
    await new Promise(resolveWait => setTimeout(resolveWait, RECEIPT_POLL_MS))
  }
  throw new Error('updated e-Mate did not report a healthy legacy startup')
}

const STARTUP_ACK_KEYS = [
  'schemaVersion', 'status', 'transactionId', 'token', 'version', 'sourceCommit', 'baseContractId',
  'scheduleProtocolFloor', 'manifestIdentity', 'artifact', 'currentApp', 'appId', 'targetArch',
  'pid', 'acknowledgedAt',
] as const

function assertMacUpdateStartupAck(request: MacUpdateRequest): void {
  const value = readJsonNoFollow(request.ackPath)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('macOS update startup acknowledgement is invalid')
  }
  const ack = value as Record<string, unknown>
  if (Object.keys(ack).length !== STARTUP_ACK_KEYS.length
    || !STARTUP_ACK_KEYS.every(key => Object.hasOwn(ack, key))
    || ack.schemaVersion !== 1 || ack.status !== 'healthy'
    || ack.transactionId !== request.transactionId || ack.token !== request.ackToken
    || ack.version !== request.targetVersion || ack.sourceCommit !== request.sourceCommit
    || ack.baseContractId !== request.baseContractId
    || ack.scheduleProtocolFloor !== request.scheduleProtocolFloor
    || ack.manifestIdentity !== request.manifestIdentity
    || !sameArtifact(ack.artifact, request.artifact)
    || ack.currentApp !== request.currentApp || ack.appId !== request.appId || ack.targetArch !== request.targetArch
    || !Number.isSafeInteger(ack.pid) || (ack.pid as number) <= 1
    || typeof ack.acknowledgedAt !== 'string') {
    throw new Error('macOS update startup acknowledgement is invalid')
  }
}

/** Accept commit only from the launched candidate's native IPC channel, then re-read its durable ack. */
export function waitForMacUpdateCommit(
  request: MacUpdateRequest,
  child: ChildProcess,
  timeoutMs: number = STARTUP_TIMEOUT_MS,
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error('macOS update startup timeout is invalid'))
  }
  return new Promise((resolveWait, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (cause?: unknown): void => {
      if (settled) return
      settled = true
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
      child.off('disconnect', onDisconnect)
      if (timer !== undefined) clearTimeout(timer)
      if (cause === undefined) resolveWait()
      else reject(cause)
    }
    const onExit = (): void => { finish(new Error('updated e-Mate exited before startup commit')) }
    const onError = (cause: Error): void => { finish(cause) }
    const onDisconnect = (): void => { finish(new Error('updated e-Mate disconnected before startup commit')) }
    const onMessage = (message: unknown): void => {
      if (!isBoundCommitMessage(message, 'emate-mac-update-commit', commitIdentity(request))) return
      try {
        assertMacUpdateStartupAck(request)
        finish()
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' && !(cause instanceof SyntaxError)
          && !(cause instanceof Error && cause.message === 'macOS update startup acknowledgement is invalid')) finish(cause)
      }
    }
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
    child.once('disconnect', onDisconnect)
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(new Error('updated e-Mate exited before startup commit'))
      return
    }
    timer = setTimeout(() => {
      finish(new Error('updated e-Mate did not report a committed healthy startup'))
    }, timeoutMs)
  })
}

/** Confirm only after the installed receipt is durable, then require the same candidate to apply it. */
export function confirmMacUpdateCommit(
  request: MacUpdateRequest,
  child: ChildProcess,
  timeoutMs: number = STARTUP_TIMEOUT_MS,
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error('macOS update commit-applied timeout is invalid'))
  }
  return new Promise((resolveApplied, reject) => {
    if (!child.connected) {
      reject(new Error('updated e-Mate IPC disconnected before commit confirmation'))
      return
    }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (cause?: unknown): void => {
      if (settled) return
      settled = true
      child.off('message', onMessage)
      child.off('exit', onExit)
      child.off('error', onError)
      child.off('disconnect', onDisconnect)
      if (timer !== undefined) clearTimeout(timer)
      if (cause === undefined) resolveApplied()
      else reject(cause)
    }
    const onMessage = (value: unknown): void => {
      if (isBoundCommitMessage(value, 'emate-mac-update-commit-applied', commitIdentity(request))) finish()
    }
    const onExit = (): void => { finish(new Error('updated e-Mate exited before commit-applied')) }
    const onError = (cause: Error): void => { finish(cause) }
    const onDisconnect = (): void => { finish(new Error('updated e-Mate IPC disconnected before commit-applied')) }
    child.on('message', onMessage)
    child.once('exit', onExit)
    child.once('error', onError)
    child.once('disconnect', onDisconnect)
    timer = setTimeout(() => { finish(new Error('updated e-Mate did not report commit-applied')) }, timeoutMs)
    try {
      child.send({
        schemaVersion: 1,
        type: 'emate-mac-update-commit-confirmed',
        ...commitIdentity(request),
      } satisfies MacUpdateCommitConfirmation, (cause) => {
        if (cause !== null) finish(cause)
      })
    } catch (cause) {
      finish(cause)
    }
  })
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolveWait) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (exited: boolean): void => {
      child.off('exit', onExit)
      if (timer !== undefined) clearTimeout(timer)
      resolveWait(exited)
    }
    const onExit = (): void => { finish(true) }
    child.once('exit', onExit)
    if (child.exitCode !== null || child.signalCode !== null) {
      finish(true)
      return
    }
    timer = setTimeout(() => { finish(false) }, timeoutMs)
  })
}

async function stopCandidate(child: ChildProcess, adapter: MacUpdateSwapAdapter): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  for (const [signal, timeoutMs] of [
    ['SIGTERM', CANDIDATE_TERM_TIMEOUT_MS],
    ['SIGKILL', CANDIDATE_KILL_TIMEOUT_MS],
  ] as const) {
    try {
      adapter.signalCandidate(child, signal)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return
      throw cause
    }
    if (await adapter.waitForExit(child, timeoutMs)) return
  }
  throw new Error('updated e-Mate remained alive after SIGKILL')
}

const defaultSwapAdapter: MacUpdateSwapAdapter = {
  rename: renameRealDirectory,
  remove: removeRealDirectory,
  assertMissing,
  validateTarget: validateBundle,
  validateInstalled: validateInstalledBundle,
  launch: launchApp,
  waitForHealthy: waitForMacUpdateCommit,
  confirmCandidate: confirmMacUpdateCommit,
  signalCandidate: (child, signal) => {
    if (child.pid === undefined) throw new Error('updated e-Mate process identifier is unavailable')
    process.kill(child.pid, signal)
  },
  waitForExit,
  writeInstalledBaseReceipt: writeMacUpdateInstalledBaseReceipt,
  validateInstalledBaseReceipt: assertMacUpdateInstalledBaseReceipt,
  writeReceipt: receipt,
  armConfirmation: armMacUpdatePendingConfirmation,
  commitTransaction: commitMacUpdatePendingTransaction,
  finalizeTransaction: clearMacUpdatePendingTransaction,
}

const defaultLegacySwapAdapter: LegacyMacUpdateSwapAdapter = {
  rename: renameRealDirectory,
  remove: removeRealDirectory,
  assertMissing,
  validateTarget: validateBundle,
  validateInstalled: validateInstalledBundle,
  launch: launchLegacyApp,
  waitForHealthy: waitForLegacyHealthy,
  writeReceipt: legacyReceipt,
}

/** Preserve the exact 2.0.12 swap/ack protocol for its one-time upgrade into the current Base. */
export async function performLegacyMacUpdateSwap(
  request: LegacyMacUpdateRequest,
  adapter: LegacyMacUpdateSwapAdapter = defaultLegacySwapAdapter,
): Promise<void> {
  let oldMoved = false
  let replaced = false
  let child: ChildProcess | undefined
  try {
    adapter.validateTarget(request.stagedApp, request.targetVersion)
    adapter.validateInstalled(request.currentApp, request.currentVersion)
    adapter.assertMissing(request.backupApp)
    adapter.assertMissing(request.failedApp)
    adapter.assertMissing(request.trashApp)
    adapter.rename(request.currentApp, request.backupApp)
    oldMoved = true
    adapter.rename(request.stagedApp, request.currentApp)
    replaced = true
    adapter.validateTarget(request.currentApp, request.targetVersion)
    adapter.writeReceipt(request, 'installed-awaiting-health')
    child = adapter.launch(request.currentApp, request, true)
    await adapter.waitForHealthy(request, child)
  } catch (cause) {
    try {
      if (child?.pid !== undefined) {
        try { process.kill(child.pid, 'SIGTERM') } catch {}
      }
      if (oldMoved) {
        if (replaced) adapter.rename(request.currentApp, request.failedApp)
        adapter.rename(request.backupApp, request.currentApp)
        adapter.validateInstalled(request.currentApp, request.currentVersion)
        if (replaced) adapter.remove(request.failedApp)
      }
      adapter.writeReceipt(request, 'rolled-back', cause)
      adapter.launch(request.currentApp, request, false)
    } catch (rollbackCause) {
      adapter.writeReceipt(request, 'rollback-failed', new AggregateError([cause, rollbackCause]))
      throw new AggregateError([cause, rollbackCause], 'legacy macOS update failed and rollback failed')
    }
    throw cause
  }
  try {
    adapter.rename(request.backupApp, request.trashApp)
  } catch (cleanupCause) {
    try {
      adapter.remove(request.backupApp)
    } catch (removeCause) {
      try { adapter.writeReceipt(request, 'completed-cleanup-failed', new AggregateError([cleanupCause, removeCause])) } catch {}
      return
    }
  }
  try { adapter.writeReceipt(request, 'completed') } catch {}
}

/** Replace one staged bundle; rollback is possible only before confirmation is durably armed. */
export async function performMacUpdateSwap(
  request: MacUpdateRequest,
  adapter: MacUpdateSwapAdapter = defaultSwapAdapter,
): Promise<void> {
  let oldMoved = false
  let replaced = false
  let child: ChildProcess | undefined
  let restoreInstalledBaseReceipt: (() => void) | undefined
  let confirmationArmed = false
  try {
    adapter.validateTarget(request.stagedApp, request.targetVersion)
    adapter.validateInstalled(request.currentApp, request.currentVersion)
    adapter.assertMissing(request.backupApp)
    adapter.assertMissing(request.failedApp)
    adapter.assertMissing(request.trashApp)
    adapter.rename(request.currentApp, request.backupApp)
    oldMoved = true
    adapter.rename(request.stagedApp, request.currentApp)
    replaced = true
    adapter.validateTarget(request.currentApp, request.targetVersion)
    adapter.writeReceipt(request, 'installed-awaiting-health')
    child = adapter.launch(request.currentApp, request, true)
    await adapter.waitForHealthy(request, child)
    restoreInstalledBaseReceipt = adapter.writeInstalledBaseReceipt(request)
    adapter.armConfirmation(request)
    confirmationArmed = true
    await adapter.confirmCandidate(request, child)
    adapter.commitTransaction?.(request)
    adapter.writeReceipt(request, 'completed')
  } catch (cause) {
    if (confirmationArmed) {
      try { adapter.writeReceipt(request, 'committed-unknown', cause) } catch {}
      throw cause
    }
    try {
      if (child !== undefined) await stopCandidate(child, adapter)
      if (oldMoved) {
        if (replaced) adapter.rename(request.currentApp, request.failedApp)
        adapter.rename(request.backupApp, request.currentApp)
        if (replaced) adapter.remove(request.failedApp)
      }
      restoreInstalledBaseReceipt?.()
      adapter.writeReceipt(request, 'rolled-back', cause)
      adapter.finalizeTransaction?.(request)
      adapter.launch(request.currentApp, request, false)
    } catch (rollbackCause) {
      adapter.writeReceipt(request, 'rollback-failed', new AggregateError([cause, rollbackCause]))
      throw new AggregateError([cause, rollbackCause], 'macOS update failed and rollback failed')
    }
    throw cause
  }
  // The bound request, durable ack/installed receipt, confirmation, and candidate-applied reply are the boundary.
  try {
    adapter.validateInstalledBaseReceipt(request)
  } catch (receiptCause) {
    try { adapter.writeReceipt(request, 'completed-cleanup-failed', receiptCause) } catch {}
    return
  }
  try {
    adapter.rename(request.backupApp, request.trashApp)
    adapter.finalizeTransaction?.(request)
  } catch (cleanupCause) {
    try {
      adapter.remove(request.backupApp)
      adapter.finalizeTransaction?.(request)
    } catch (removeCause) {
      try { adapter.writeReceipt(request, 'completed-cleanup-failed', new AggregateError([cleanupCause, removeCause])) } catch {}
      return
    }
  }
}

async function waitForMarker(
  path: string,
  request: MacUpdateRequest,
  status: string,
  child?: ChildProcess,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + HELPER_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    if (child !== undefined && (child.exitCode != null || child.signalCode != null)) {
      throw new Error('macOS update helper exited before becoming ready')
    }
    try {
      const value = readJsonNoFollow(path) as Record<string, unknown>
      if (Object.keys(value).length === 6
        && ['schemaVersion', 'transactionId', 'status', 'token', 'helperPid', 'readyAt'].every(key => Object.hasOwn(value, key))
        && value.schemaVersion === 1 && value.status === status && value.token === request.ackToken
        && Number.isSafeInteger(value.helperPid) && (value.helperPid as number) > 1
        && (child?.pid === undefined || value.helperPid === child.pid)
        && typeof value.readyAt === 'string'
        && value.transactionId === request.transactionId) return
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' && !(cause instanceof SyntaxError)) throw cause
    }
    await new Promise(resolveWait => setTimeout(resolveWait, RECEIPT_POLL_MS))
  }
  throw new Error(`macOS update timed out waiting for ${status}`)
}

async function waitForShutdownReady(request: MacUpdateRequest | LegacyMacUpdateRequest): Promise<void> {
  const deadline = Date.now() + PARENT_EXIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const value = readJsonNoFollow(request.shutdownReadyPath) as Record<string, unknown>
      if (Object.keys(value).length === 5
        && ['schemaVersion', 'transactionId', 'status', 'token', 'markedAt'].every(key => Object.hasOwn(value, key))
        && value.schemaVersion === 1 && value.status === 'shutdown-ready' && value.token === request.ackToken
        && typeof value.markedAt === 'string'
        && value.transactionId === request.transactionId) return
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' && !(cause instanceof SyntaxError)) throw cause
    }
    if (!processIsRunning(request.parentPid)) throw new Error('e-Mate exited before completing Cordis shutdown')
    await new Promise(resolveWait => setTimeout(resolveWait, RECEIPT_POLL_MS))
  }
  throw new Error('macOS update timed out waiting for Cordis shutdown')
}

function validateMacUpdatePreflight(options: MacUpdatePreflightOptions): ValidatedMacUpdatePreflight {
  try {
    if (process.platform !== 'darwin') throw new Error('macOS update installation is unavailable on this platform')
    const targetVersion = stableVersion(options.targetVersion)
    const artifact = validateDesktopReleaseArtifact('darwin', targetVersion, options.artifact)
    const targetArch = process.arch
    if (!SOURCE_COMMIT.test(options.sourceCommit) || !BASE_CONTRACT_ID.test(options.baseContractId)
      || !Number.isSafeInteger(options.scheduleProtocolFloor) || options.scheduleProtocolFloor <= 0
      || !MANIFEST_IDENTITY.test(options.manifestIdentity)
      || (targetArch !== 'arm64' && targetArch !== 'x64')
      || artifact === null || !new URL(artifact.url).pathname.includes(`/${options.sourceCommit}/`)) {
      throw new Error('macOS update release identity is invalid')
    }
    const userDataPath = realDirectory(options.userDataPath)
    accessSync(userDataPath, constants.W_OK | constants.X_OK)
    const homeDirectory = realDirectory(options.homeDirectory)
    const trashDirectory = realDirectory(join(homeDirectory, '.Trash'))
    accessSync(trashDirectory, constants.W_OK | constants.X_OK)
    const currentApp = macAppBundleFromExecutable(options.currentExecutable)
    if (currentApp === undefined) throw new Error('macOS update requires a packaged application bundle')
    const resolvedCurrent = realDirectory(currentApp)
    const canonical = [join('/Applications', 'e-Mate.app'), join(homeDirectory, 'Applications', 'e-Mate.app')]
      .some(path => {
        try { return realpathSync(path) === resolvedCurrent } catch { return false }
      })
    if (!canonical) throw new Error('macOS update requires the canonical e-Mate.app install path')
    const installDirectory = dirname(resolvedCurrent)
    accessSync(installDirectory, constants.W_OK | constants.X_OK)
    const currentVersion = bundleMetadata(resolvedCurrent).version
    if ((compareSemVerVersions(targetVersion, currentVersion) ?? 0) <= 0) {
      throw new Error('macOS update target must be newer than the installed version')
    }
    const installDevice = statSync(installDirectory).dev
    if (statSync(trashDirectory).dev !== installDevice) {
      throw new Error('macOS update backup Trash must be on the application volume')
    }
    const relativeHelper = relative(resolvedCurrent, options.helperModulePath)
    if (!inside(resolvedCurrent, resolve(options.helperModulePath)) || basename(relativeHelper) !== 'mac-update-helper.js') {
      throw new Error('macOS update helper is outside the installed application')
    }
    realFile(options.helperModulePath)
    const downloadBytes = BigInt(artifact.bytes)
    const atomicSwapBytes = allocatedBytes(resolvedCurrent)
    const budgets: ReadonlyArray<readonly [string, bigint]> = statSync(userDataPath).dev === installDevice
      ? [[userDataPath, downloadBytes + atomicSwapBytes]]
      : [[userDataPath, downloadBytes], [installDirectory, atomicSwapBytes]]
    for (const [directory, requiredBytes] of budgets) {
      const filesystem = statfsSync(directory, { bigint: true })
      if (filesystem.bavail * filesystem.bsize < requiredBytes) {
        throw new Error('macOS update has insufficient free space')
      }
    }
    return {
      targetVersion,
      artifact,
      targetArch,
      userDataPath,
      homeDirectory,
      trashDirectory,
      resolvedCurrent,
      currentVersion,
      installDirectory,
    }
  } catch (cause) {
    if (cause instanceof MacUpdatePreflightError) throw cause
    throw new MacUpdatePreflightError(cause instanceof Error ? cause.message : String(cause), cause)
  }
}

/** Fail closed on macOS path, permission, volume and minimum free-space checks before downloading. */
export function preflightMacUpdateInstallation(options: MacUpdatePreflightOptions): void {
  validateMacUpdatePreflight(options)
}

/** Validate and stage an update, then launch the detached replacement helper. */
export async function scheduleMacUpdateInstallation(options: ScheduleMacUpdateOptions): Promise<PreparedMacUpdateInstallation> {
  options.signal?.throwIfAborted()
  const preflight = validateMacUpdatePreflight(options)
  const {
    targetVersion,
    artifact,
    targetArch,
    userDataPath,
    trashDirectory,
    resolvedCurrent,
    currentVersion,
    installDirectory,
  } = preflight
  const dmgPath = realFile(options.dmgPath)
  if (!inside(join(userDataPath, 'updates', targetVersion), dmgPath)) throw new Error('macOS update disk image is outside the validated update cache')
  const transactionId = randomUUID()
  const stateDirectory = join(userDataPath, 'updates', targetVersion, `install-${transactionId}`)
  createMacUpdateDurableDirectory(stateDirectory)
  const suffix = transactionId.slice(0, 8)
  const stagedApp = join(installDirectory, `.e-Mate-${targetVersion}-${suffix}.staged.app`)
  const backupApp = join(installDirectory, `.e-Mate-${currentVersion}-${suffix}.backup.app`)
  const failedApp = join(installDirectory, `.e-Mate-${targetVersion}-${suffix}.failed.app`)
  const trashApp = join(trashDirectory, `e-Mate ${currentVersion} Update Backup ${suffix}.app`)
  for (const path of [stagedApp, backupApp, failedApp, trashApp]) assertMissing(path)

  const installedBaseReceiptPath = join(userDataPath, 'updates', 'installed-base.json')
  let previousInstalledBaseReceipt: string | null = null
  try {
    previousInstalledBaseReceipt = readTextNoFollow(installedBaseReceiptPath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
  const request: MacUpdateRequest = {
    schemaVersion: 1,
    transactionId,
    parentPid: options.parentPid ?? process.pid,
    currentApp: resolvedCurrent,
    appId: APP_ID,
    currentVersion,
    targetVersion,
    stagedApp,
    backupApp,
    failedApp,
    trashApp,
    receiptPath: join(stateDirectory, 'receipt.json'),
    helperReadyPath: join(stateDirectory, 'helper-ready.json'),
    shutdownReadyPath: join(stateDirectory, 'shutdown-ready.json'),
    ackPath: join(stateDirectory, 'startup-ack.json'),
    ackToken: randomUUID(),
    installedBaseReceiptPath,
    previousInstalledBaseReceipt,
    sourceCommit: options.sourceCommit,
    baseContractId: options.baseContractId,
    scheduleProtocolFloor: options.scheduleProtocolFloor,
    manifestIdentity: options.manifestIdentity,
    targetArch,
    artifact,
  }
  const requestPath = join(stateDirectory, 'request.json')
  let helper: ChildProcess | undefined
  let claimed = false
  try {
    writeMacUpdateDurableJson(requestPath, request)
    claimMacUpdatePendingTransaction(request, requestPath)
    claimed = true
    const mountPoint = join(stateDirectory, 'mount')
    mkdirSync(mountPoint, { mode: 0o700 })
    let mounted = false
    try {
      run('/usr/bin/hdiutil', ['verify', dmgPath])
      run('/usr/bin/hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-nobrowse', '-readonly'])
      mounted = true
      const sourceApp = join(mountPoint, 'e-Mate.app')
      validateBundle(sourceApp, targetVersion)
      options.signal?.throwIfAborted()
      run('/usr/bin/ditto', ['--noqtn', sourceApp, stagedApp])
      validateBundle(stagedApp, targetVersion)
    } finally {
      if (mounted) run('/usr/bin/hdiutil', ['detach', mountPoint])
      rmSync(mountPoint, { recursive: true, force: true })
    }
    options.signal?.throwIfAborted()
    realFile(options.helperModulePath)
    helper = spawn(join(resolvedCurrent, 'Contents', 'MacOS', 'e-Mate'), [options.helperModulePath, requestPath], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, [RUN_AS_NODE]: '1' },
    })
    if (helper.pid === undefined) throw new Error('macOS update helper process identifier is unavailable')
    assignMacUpdatePendingHelper(request, requestPath, helper.pid)
    await new Promise<void>((resolveSpawn, reject) => {
      helper?.once('error', reject)
      helper?.once('spawn', resolveSpawn)
    })
    await waitForMarker(request.helperReadyPath, request, 'helper-ready', helper, options.signal)
    helper.unref()
    let marked = false
    return {
      markShutdownReady() {
        if (marked) return
        marked = true
        writeMacUpdateDurableJson(request.shutdownReadyPath, {
          schemaVersion: 1,
          transactionId: request.transactionId,
          status: 'shutdown-ready',
          token: request.ackToken,
          markedAt: new Date().toISOString(),
        })
      },
    }
  } catch (cause) {
    try { helper?.kill('SIGTERM') } catch {}
    rmSync(stagedApp, { recursive: true, force: true })
    receipt(request, 'failed-before-change', cause)
    if (claimed) clearMacUpdatePendingTransaction(request)
    throw cause
  }
}

function sendMacUpdateCommit(
  message: MacUpdateCommitMessage,
  timeoutMs: number = STARTUP_TIMEOUT_MS,
): Promise<MacUpdateAppliedSender> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error('macOS update confirmation timeout is invalid'))
  }
  return new Promise((resolveConfirmation, reject) => {
    if (typeof process.send !== 'function' || !process.connected) {
      reject(new Error('macOS update startup IPC is unavailable'))
      return
    }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (cause?: unknown): void => {
      if (settled) return
      settled = true
      process.off('message', onMessage)
      process.off('disconnect', onDisconnect)
      if (timer !== undefined) clearTimeout(timer)
      if (cause !== undefined) { reject(cause); return }
      let applied: Promise<void> | undefined
      resolveConfirmation(() => {
        applied ??= new Promise<void>((resolveSend, rejectSend) => {
          if (typeof process.send !== 'function' || !process.connected) {
            rejectSend(new Error('macOS update startup IPC disconnected before commit-applied'))
            return
          }
          try {
            process.send({
              ...message,
              type: 'emate-mac-update-commit-applied',
            } satisfies MacUpdateCommitApplied, (sendCause) => {
              if (sendCause === null) resolveSend()
              else rejectSend(sendCause)
            })
          } catch (sendCause) {
            rejectSend(sendCause)
          }
        })
        return applied
      })
    }
    const onDisconnect = (): void => { finish(new Error('macOS update helper disconnected before commit confirmation')) }
    const onMessage = (value: unknown): void => {
      if (isBoundCommitMessage(value, 'emate-mac-update-commit-confirmed', message)) finish()
    }
    process.on('message', onMessage)
    process.once('disconnect', onDisconnect)
    timer = setTimeout(() => { finish(new Error('macOS update helper did not confirm startup commit')) }, timeoutMs)
    try {
      process.send(message, (cause) => {
        if (cause !== null) finish(cause)
      })
    } catch (cause) {
      finish(cause)
    }
  })
}

function prepareLegacyMacUpdateStartupAck(
  userDataPath: string,
  currentVersion: string,
  environment: NodeJS.ProcessEnv,
  io: MacUpdateDurableIO,
): MacUpdateStartupAcknowledgement {
  const path = environment[ACK_PATH]
  const token = environment[ACK_TOKEN]
  const version = environment[ACK_VERSION]
  if (path === undefined || token === undefined || version === undefined
    || version !== currentVersion || !TOKEN.test(token)) {
    throw new Error('legacy macOS update startup acknowledgement environment is invalid')
  }
  const root = realDirectory(userDataPath)
  const expectedRoot = realDirectory(join(root, 'updates', stableVersion(version)))
  const resolvedPath = join(realDirectory(dirname(path)), basename(path))
  if (!isAbsolute(path) || !inside(expectedRoot, resolvedPath) || basename(path) !== 'startup-ack.json') {
    throw new Error('legacy macOS update startup acknowledgement path is invalid')
  }
  const requestPath = join(dirname(resolvedPath), 'request.json')
  const request = readLegacyMacUpdateRequest(requestPath)
  if (request.ackPath !== resolvedPath || request.ackToken !== token || request.targetVersion !== version) {
    throw new Error('legacy macOS update startup acknowledgement environment is invalid')
  }
  assertMissing(resolvedPath)
  const commitApplied = async (): Promise<void> => {
    const current = readLegacyMacUpdateRequest(requestPath)
    if (!sameLegacyMacUpdateRequest(current, request)) {
      throw new Error('legacy macOS update request changed before startup commit')
    }
    assertMissing(resolvedPath)
    writeMacUpdateDurableJson(resolvedPath, {
      schemaVersion: 1,
      status: 'healthy',
      token,
      version,
      pid: process.pid,
      acknowledgedAt: new Date().toISOString(),
    }, io)
  }
  return { status: 'installed', currentVersion, targetVersion: version, commitApplied }
}

/** A new application calls this only after its renderer has reported healthy. */
export async function writeMacUpdateStartupAck(
  userDataPath: string,
  currentVersion: string,
  environment: NodeJS.ProcessEnv = process.env,
  io: MacUpdateDurableIO = defaultDurableIO,
  send: MacUpdateCommitSender = sendMacUpdateCommit,
): Promise<MacUpdateStartupAcknowledgement | undefined> {
  const suppliedAckKeys = Object.keys(environment).filter(name => name.startsWith('EMATE_MAC_UPDATE_ACK_'))
  if (suppliedAckKeys.length === LEGACY_ACK_ENVIRONMENT_KEYS.length
    && LEGACY_ACK_ENVIRONMENT_KEYS.every(name => suppliedAckKeys.includes(name))) {
    return prepareLegacyMacUpdateStartupAck(userDataPath, currentVersion, environment, io)
  }
  const path = environment[ACK_PATH]
  const token = environment[ACK_TOKEN]
  const version = environment[ACK_VERSION]
  const transactionId = environment[ACK_TRANSACTION_ID]
  const sourceCommit = environment[ACK_SOURCE_COMMIT]
  const baseContractId = environment[ACK_BASE_CONTRACT_ID]
  const floorText = environment[ACK_SCHEDULE_PROTOCOL_FLOOR]
  const manifestIdentity = environment[ACK_MANIFEST_IDENTITY]
  const artifactText = environment[ACK_ARTIFACT]
  const currentApp = environment[ACK_CURRENT_APP]
  const appId = environment[ACK_APP_ID]
  const targetArch = environment[ACK_TARGET_ARCH]
  if (suppliedAckKeys.length === 0) return undefined
  let artifactValue: unknown
  try { artifactValue = artifactText === undefined ? undefined : JSON.parse(artifactText) } catch {}
  const artifact = version === undefined ? null : validateDesktopReleaseArtifact('darwin', version, artifactValue)
  const scheduleProtocolFloor = floorText === undefined ? NaN : Number(floorText)
  if (suppliedAckKeys.length !== ACK_ENVIRONMENT_KEYS.length
    || !ACK_ENVIRONMENT_KEYS.every(name => suppliedAckKeys.includes(name))
    || path === undefined || token === undefined || version === undefined || transactionId === undefined
    || sourceCommit === undefined || baseContractId === undefined || manifestIdentity === undefined
    || currentApp === undefined || appId === undefined || targetArch === undefined
    || !TOKEN.test(token) || !TRANSACTION_ID.test(transactionId) || version !== currentVersion
    || !SOURCE_COMMIT.test(sourceCommit) || !BASE_CONTRACT_ID.test(baseContractId)
    || !MANIFEST_IDENTITY.test(manifestIdentity) || appId !== APP_ID
    || (targetArch !== 'arm64' && targetArch !== 'x64') || targetArch !== process.arch
    || floorText !== String(scheduleProtocolFloor) || !Number.isSafeInteger(scheduleProtocolFloor) || scheduleProtocolFloor <= 0
    || artifact === null || !sameArtifact(artifactValue, artifact)
    || !new URL(artifact.url).pathname.includes(`/${sourceCommit}/`)) {
    throw new Error('macOS update startup acknowledgement environment is invalid')
  }
  const root = realDirectory(userDataPath)
  const expectedRoot = realDirectory(join(root, 'updates', stableVersion(version)))
  const resolvedPath = join(realDirectory(dirname(path)), basename(path))
  if (!isAbsolute(path) || !inside(expectedRoot, resolvedPath) || basename(path) !== 'startup-ack.json'
    || basename(dirname(path)) !== `install-${transactionId}`) {
    throw new Error('macOS update startup acknowledgement path is invalid')
  }
  const requestPath = join(dirname(resolvedPath), 'request.json')
  const request = readMacUpdateRequest(requestPath)
  assertPendingOwner(request, requestPath)
  if (request.ackPath !== resolvedPath || request.ackToken !== token || request.targetVersion !== version
    || request.sourceCommit !== sourceCommit || request.baseContractId !== baseContractId
    || request.scheduleProtocolFloor !== scheduleProtocolFloor || request.manifestIdentity !== manifestIdentity
    || request.currentApp !== currentApp || request.targetArch !== targetArch
    || !sameArtifact(request.artifact, artifact)) {
    throw new Error('macOS update startup acknowledgement environment is invalid')
  }
  assertMissing(resolvedPath)
  writeMacUpdateDurableJson(resolvedPath, {
    schemaVersion: 1,
    status: 'healthy',
    transactionId,
    token,
    version,
    sourceCommit,
    baseContractId,
    scheduleProtocolFloor,
    manifestIdentity,
    artifact,
    currentApp,
    appId: APP_ID,
    targetArch,
    pid: process.pid,
    acknowledgedAt: new Date().toISOString(),
  }, io)
  const commitApplied = await send({ schemaVersion: 1, type: 'emate-mac-update-commit', ...commitIdentity(request) })
  return { status: 'installed', currentVersion, targetVersion: version, commitApplied }
}

/** Read a helper result when the old application was restored after a failed update. */
export async function readMacUpdateStartupResult(
  userDataPath: string,
  currentVersion: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<MacUpdateStartupResult | undefined> {
  const path = environment.EMATE_MAC_UPDATE_RESULT_PATH
  const token = environment.EMATE_MAC_UPDATE_RESULT_TOKEN
  const targetVersion = environment.EMATE_MAC_UPDATE_RESULT_VERSION
  if (path === undefined && token === undefined && targetVersion === undefined) return undefined
  if (path === undefined || token === undefined || targetVersion === undefined || !TOKEN.test(token)) {
    throw new Error('macOS update result environment is invalid')
  }
  const root = realDirectory(userDataPath)
  const expectedRoot = realDirectory(join(root, 'updates', stableVersion(targetVersion)))
  const resolvedPath = join(realDirectory(dirname(path)), basename(path))
  if (!isAbsolute(path) || !inside(expectedRoot, resolvedPath) || basename(path) !== 'receipt.json') {
    throw new Error('macOS update result path is invalid')
  }
  const request = readMacUpdateRequest(join(dirname(resolvedPath), 'request.json'))
  if (request.receiptPath !== resolvedPath || request.ackToken !== token
    || request.targetVersion !== targetVersion || request.currentVersion !== currentVersion) {
    throw new Error('macOS update result transaction is invalid')
  }
  const deadline = Date.now() + HELPER_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const status = readTransactionReceiptStatus(request)
      if (status === 'completed' || status === 'completed-cleanup-failed') {
        return { status: 'installed', currentVersion, targetVersion }
      }
      if (status === 'rolled-back' || status === 'failed-before-change') {
        return { status: 'rolled-back', currentVersion, targetVersion }
      }
      if (status === 'rollback-failed') return { status: 'failed', currentVersion, targetVersion }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' && !(cause instanceof SyntaxError)) throw cause
    }
    await new Promise(resolveWait => setTimeout(resolveWait, RECEIPT_POLL_MS))
  }
  throw new Error('macOS update result did not become available')
}

export async function runMacUpdateHelper(requestPath: string): Promise<void> {
  const envelope = readMacUpdateRequestEnvelope(requestPath)
  if (envelope.kind === 'legacy-2.0.12') {
    await runLegacyMacUpdateHelper(envelope.request)
    return
  }
  const request = envelope.request
  await waitForMacUpdatePendingHelper(request, requestPath, process.pid)
  let swapStarted = false
  try {
    writeMacUpdateDurableJson(request.helperReadyPath, {
      schemaVersion: 1,
      transactionId: request.transactionId,
      status: 'helper-ready',
      token: request.ackToken,
      helperPid: process.pid,
      readyAt: new Date().toISOString(),
    })
    await waitForShutdownReady(request)
    await waitForParentExit(request.parentPid)
    swapStarted = true
    await performMacUpdateSwap(request)
  } catch (cause) {
    try {
      if (!lstatSync(request.receiptPath).isFile()) receipt(request, 'failed-before-change', cause)
    } catch (receiptCause) {
      if ((receiptCause as NodeJS.ErrnoException).code === 'ENOENT') receipt(request, 'failed-before-change', cause)
    }
    try {
      lstatSync(request.currentApp)
      rmSync(request.stagedApp, { recursive: true, force: true })
      if (!swapStarted && !processIsRunning(request.parentPid)) launchApp(request.currentApp, request, false)
    } catch {}
    throw cause
  }
}

async function runLegacyMacUpdateHelper(request: LegacyMacUpdateRequest): Promise<void> {
  const helperApp = macAppBundleFromExecutable(process.execPath)
  if (helperApp === undefined || realDirectory(helperApp) !== realDirectory(request.stagedApp)) {
    throw new Error('legacy macOS update helper is not running from the staged application')
  }
  validateBundle(helperApp, request.targetVersion)
  let swapStarted = false
  try {
    writeMacUpdateDurableJson(request.helperReadyPath, {
      schemaVersion: 1,
      transactionId: request.transactionId,
      status: 'helper-ready',
      token: request.ackToken,
      readyAt: new Date().toISOString(),
    })
    await waitForShutdownReady(request)
    await waitForParentExit(request.parentPid)
    swapStarted = true
    await performLegacyMacUpdateSwap(request)
  } catch (cause) {
    try {
      if (!lstatSync(request.receiptPath).isFile()) legacyReceipt(request, 'failed-before-change', cause)
    } catch (receiptCause) {
      if ((receiptCause as NodeJS.ErrnoException).code === 'ENOENT') legacyReceipt(request, 'failed-before-change', cause)
    }
    try {
      lstatSync(request.currentApp)
      rmSync(request.stagedApp, { recursive: true, force: true })
      if (!swapStarted && !processIsRunning(request.parentPid)) launchLegacyApp(request.currentApp, request, false)
    } catch {}
    throw cause
  }
}
