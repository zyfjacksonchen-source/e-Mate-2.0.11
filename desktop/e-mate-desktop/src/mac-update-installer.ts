/** Detached, rollback-safe replacement for a validated macOS desktop update. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { MACOS_UNIVERSAL_NATIVE_ENTRIES } from './mac-universal-inventory.ts'
import { macAppBundleFromExecutable } from './installation-cleanup.ts'
import { compareSemVerVersions, parseSemVer } from './update-checker.ts'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const ACK_PATH = 'EMATE_MAC_UPDATE_ACK_PATH'
const ACK_TOKEN = 'EMATE_MAC_UPDATE_ACK_TOKEN'
const ACK_VERSION = 'EMATE_MAC_UPDATE_ACK_VERSION'
const APP_ID = 'net.ecoremedia.e-mate'
const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f-]{27}$/u
const TOKEN = /^[0-9a-f-]{36}$/u
const RECEIPT_POLL_MS = 200
const HELPER_READY_TIMEOUT_MS = 10_000
const PARENT_EXIT_TIMEOUT_MS = 60_000
const STARTUP_TIMEOUT_MS = 60_000

export interface MacUpdateRequest {
  schemaVersion: 1
  transactionId: string
  parentPid: number
  currentApp: string
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
}

export interface PreparedMacUpdateInstallation {
  /** Commit application shutdown only after the Cordis tree disposed successfully. */
  markShutdownReady(): void
}

export interface MacUpdateStartupResult {
  readonly status: 'installed' | 'rolled-back' | 'failed'
  readonly currentVersion: string
  readonly targetVersion: string
}

export interface ScheduleMacUpdateOptions {
  readonly dmgPath: string
  readonly targetVersion: string
  readonly currentExecutable: string
  readonly userDataPath: string
  readonly homeDirectory: string
  readonly helperModulePath: string
  readonly parentPid?: number
  readonly signal?: AbortSignal
}

export interface MacUpdateSwapAdapter {
  readonly rename: (from: string, to: string) => void
  readonly remove: (path: string) => void
  readonly assertMissing: (path: string) => void
  readonly validateTarget: (appPath: string, version: string) => void
  readonly validateInstalled: (appPath: string, version: string) => void
  readonly launch: (appPath: string, request: MacUpdateRequest, updated: boolean) => ChildProcess
  readonly waitForHealthy: (request: MacUpdateRequest, child: ChildProcess) => Promise<void>
  readonly writeReceipt: (request: MacUpdateRequest, status: string, error?: unknown) => void
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

function atomicJson(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  renameSync(temporary, path)
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function receipt(request: MacUpdateRequest, status: string, error?: unknown): void {
  atomicJson(request.receiptPath, {
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

function validateRequest(value: unknown, requestPath: string): MacUpdateRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('macOS update request is invalid')
  const request = value as Partial<MacUpdateRequest>
  if (request.schemaVersion !== 1 || typeof request.transactionId !== 'string' || !TRANSACTION_ID.test(request.transactionId)
    || !Number.isSafeInteger(request.parentPid) || (request.parentPid ?? 0) <= 1
    || typeof request.currentApp !== 'string' || typeof request.stagedApp !== 'string'
    || typeof request.backupApp !== 'string' || typeof request.failedApp !== 'string'
    || typeof request.trashApp !== 'string' || typeof request.receiptPath !== 'string'
    || typeof request.helperReadyPath !== 'string' || typeof request.shutdownReadyPath !== 'string'
    || typeof request.ackPath !== 'string' || typeof request.ackToken !== 'string' || !TOKEN.test(request.ackToken)
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
    || resolve(request.ackPath) !== join(root, 'startup-ack.json')) {
    throw new Error('macOS update state path escaped its transaction directory')
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
  const environment = { ...process.env }
  delete environment[RUN_AS_NODE]
  delete environment[ACK_PATH]
  delete environment[ACK_TOKEN]
  delete environment[ACK_VERSION]
  environment.EMATE_MAC_UPDATE_RESULT_PATH = request.receiptPath
  environment.EMATE_MAC_UPDATE_RESULT_TOKEN = request.ackToken
  environment.EMATE_MAC_UPDATE_RESULT_VERSION = request.targetVersion
  if (updated) {
    environment[ACK_PATH] = request.ackPath
    environment[ACK_TOKEN] = request.ackToken
    environment[ACK_VERSION] = request.targetVersion
  }
  const child = spawn(join(appPath, 'Contents', 'MacOS', 'e-Mate'), [], {
    detached: true,
    stdio: 'ignore',
    env: environment,
  })
  child.unref()
  return child
}

async function waitForHealthy(request: MacUpdateRequest, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('updated e-Mate exited before startup became healthy')
    try {
      const value = readJson(request.ackPath) as Record<string, unknown>
      if (value.schemaVersion === 1 && value.status === 'healthy' && value.token === request.ackToken
        && value.version === request.targetVersion) return
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' && !(cause instanceof SyntaxError)) throw cause
    }
    await new Promise(resolveWait => setTimeout(resolveWait, RECEIPT_POLL_MS))
  }
  throw new Error('updated e-Mate did not report a healthy startup')
}

const defaultSwapAdapter: MacUpdateSwapAdapter = {
  rename: renameSync,
  remove: path => rmSync(path, { recursive: true, force: true }),
  assertMissing,
  validateTarget: validateBundle,
  validateInstalled: validateInstalledBundle,
  launch: launchApp,
  waitForHealthy,
  writeReceipt: receipt,
}

/** Replace one staged bundle, restoring the old application if healthy startup is not observed. */
export async function performMacUpdateSwap(
  request: MacUpdateRequest,
  adapter: MacUpdateSwapAdapter = defaultSwapAdapter,
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
        if (replaced) adapter.remove(request.failedApp)
      }
      adapter.launch(request.currentApp, request, false)
      adapter.writeReceipt(request, 'rolled-back', cause)
    } catch (rollbackCause) {
      adapter.writeReceipt(request, 'rollback-failed', new AggregateError([cause, rollbackCause]))
      throw new AggregateError([cause, rollbackCause], 'macOS update failed and rollback failed')
    }
    throw cause
  }
  // Renderer health is the commit boundary. Cleanup and receipt failures must never remove a healthy update.
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
      const value = readJson(path) as Record<string, unknown>
      if (value.schemaVersion === 1 && value.status === status && value.token === request.ackToken
        && value.transactionId === request.transactionId) return
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' && !(cause instanceof SyntaxError)) throw cause
    }
    await new Promise(resolveWait => setTimeout(resolveWait, RECEIPT_POLL_MS))
  }
  throw new Error(`macOS update timed out waiting for ${status}`)
}

async function waitForShutdownReady(request: MacUpdateRequest): Promise<void> {
  const deadline = Date.now() + PARENT_EXIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const value = readJson(request.shutdownReadyPath) as Record<string, unknown>
      if (value.schemaVersion === 1 && value.status === 'shutdown-ready' && value.token === request.ackToken
        && value.transactionId === request.transactionId) return
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' && !(cause instanceof SyntaxError)) throw cause
    }
    if (!processIsRunning(request.parentPid)) throw new Error('e-Mate exited before completing Cordis shutdown')
    await new Promise(resolveWait => setTimeout(resolveWait, RECEIPT_POLL_MS))
  }
  throw new Error('macOS update timed out waiting for Cordis shutdown')
}

/** Validate and stage an update, then launch the detached replacement helper. */
export async function scheduleMacUpdateInstallation(options: ScheduleMacUpdateOptions): Promise<PreparedMacUpdateInstallation> {
  if (process.platform !== 'darwin') throw new Error('macOS update installation is unavailable on this platform')
  options.signal?.throwIfAborted()
  const targetVersion = stableVersion(options.targetVersion)
  const userDataPath = realDirectory(options.userDataPath)
  const homeDirectory = realDirectory(options.homeDirectory)
  const trashDirectory = realDirectory(join(homeDirectory, '.Trash'))
  accessSync(trashDirectory, constants.W_OK)
  const dmgPath = realFile(options.dmgPath)
  if (!inside(join(userDataPath, 'updates', targetVersion), dmgPath)) throw new Error('macOS update disk image is outside the validated update cache')
  const currentApp = macAppBundleFromExecutable(options.currentExecutable)
  if (currentApp === undefined) throw new Error('macOS update requires a packaged application bundle')
  const resolvedCurrent = realDirectory(currentApp)
  const canonical = [join('/Applications', 'e-Mate.app'), join(homeDirectory, 'Applications', 'e-Mate.app')]
    .some(path => {
      try { return realpathSync(path) === resolvedCurrent } catch { return false }
    })
  if (!canonical) throw new Error('macOS update requires the canonical e-Mate.app install path')
  accessSync(dirname(resolvedCurrent), constants.W_OK)
  const currentVersion = bundleMetadata(resolvedCurrent).version
  if ((compareSemVerVersions(targetVersion, currentVersion) ?? 0) <= 0) {
    throw new Error('macOS update target must be newer than the installed version')
  }
  if (statSync(trashDirectory).dev !== statSync(dirname(resolvedCurrent)).dev) {
    throw new Error('macOS update backup Trash must be on the application volume')
  }
  const transactionId = randomUUID()
  const stateDirectory = join(userDataPath, 'updates', targetVersion, `install-${transactionId}`)
  mkdirSync(stateDirectory, { recursive: false, mode: 0o700 })
  const suffix = transactionId.slice(0, 8)
  const installDirectory = dirname(resolvedCurrent)
  const stagedApp = join(installDirectory, `.e-Mate-${targetVersion}-${suffix}.staged.app`)
  const backupApp = join(installDirectory, `.e-Mate-${currentVersion}-${suffix}.backup.app`)
  const failedApp = join(installDirectory, `.e-Mate-${targetVersion}-${suffix}.failed.app`)
  const trashApp = join(trashDirectory, `e-Mate ${currentVersion} Update Backup ${suffix}.app`)
  for (const path of [stagedApp, backupApp, failedApp, trashApp]) assertMissing(path)

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
  } catch (cause) {
    rmSync(stagedApp, { recursive: true, force: true })
    throw cause
  } finally {
    if (mounted) run('/usr/bin/hdiutil', ['detach', mountPoint])
    rmSync(mountPoint, { recursive: true, force: true })
  }

  const request: MacUpdateRequest = {
    schemaVersion: 1,
    transactionId,
    parentPid: options.parentPid ?? process.pid,
    currentApp: resolvedCurrent,
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
  }
  const requestPath = join(stateDirectory, 'request.json')
  let helper: ChildProcess | undefined
  try {
    atomicJson(requestPath, request)
    options.signal?.throwIfAborted()
    const relativeHelper = relative(resolvedCurrent, options.helperModulePath)
    if (!inside(resolvedCurrent, resolve(options.helperModulePath)) || basename(relativeHelper) !== 'mac-update-helper.js') {
      throw new Error('macOS update helper is outside the installed application')
    }
    const stagedHelper = join(stagedApp, relativeHelper)
    realFile(stagedHelper)
    helper = spawn(join(stagedApp, 'Contents', 'MacOS', 'e-Mate'), [stagedHelper, requestPath], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, [RUN_AS_NODE]: '1' },
    })
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
        atomicJson(request.shutdownReadyPath, {
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
    throw cause
  }
}

/** A new application calls this only after its renderer has reported healthy. */
export function writeMacUpdateStartupAck(
  userDataPath: string,
  currentVersion: string,
  environment: NodeJS.ProcessEnv = process.env,
): MacUpdateStartupResult | undefined {
  const path = environment[ACK_PATH]
  const token = environment[ACK_TOKEN]
  const version = environment[ACK_VERSION]
  if (path === undefined && token === undefined && version === undefined) return undefined
  if (path === undefined || token === undefined || version === undefined || !TOKEN.test(token) || version !== currentVersion) {
    throw new Error('macOS update startup acknowledgement environment is invalid')
  }
  const root = realDirectory(userDataPath)
  const expectedRoot = realDirectory(join(root, 'updates', stableVersion(version)))
  const resolvedPath = join(realDirectory(dirname(path)), basename(path))
  if (!isAbsolute(path) || !inside(expectedRoot, resolvedPath) || basename(path) !== 'startup-ack.json') {
    throw new Error('macOS update startup acknowledgement path is invalid')
  }
  atomicJson(resolvedPath, {
    schemaVersion: 1,
    status: 'healthy',
    token,
    version,
    pid: process.pid,
    acknowledgedAt: new Date().toISOString(),
  })
  return { status: 'installed', currentVersion, targetVersion: version }
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
  const deadline = Date.now() + HELPER_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const value = readJson(resolvedPath) as Record<string, unknown>
      if (value.schemaVersion !== 1 || value.token !== token || value.targetVersion !== targetVersion) {
        throw new Error('macOS update result receipt is invalid')
      }
      if (value.status === 'completed' || value.status === 'completed-cleanup-failed') {
        return { status: 'installed', currentVersion, targetVersion }
      }
      if (value.status === 'rolled-back' || value.status === 'failed-before-change') {
        return { status: 'rolled-back', currentVersion, targetVersion }
      }
      if (value.status === 'rollback-failed') return { status: 'failed', currentVersion, targetVersion }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT' && !(cause instanceof SyntaxError)) throw cause
    }
    await new Promise(resolveWait => setTimeout(resolveWait, RECEIPT_POLL_MS))
  }
  throw new Error('macOS update result did not become available')
}

export async function runMacUpdateHelper(requestPath: string): Promise<void> {
  const request = validateRequest(readJson(requestPath), requestPath)
  let swapStarted = false
  try {
    atomicJson(request.helperReadyPath, {
      schemaVersion: 1,
      transactionId: request.transactionId,
      status: 'helper-ready',
      token: request.ackToken,
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
