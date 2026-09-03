/** Windows UI Automation backend behind the existing ComputerUseService contract. */
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import type { ComputerUseBackend, BackendActionRequest, BackendActionResult, BackendCursorAction, BackendHealth, BackendObservation, BackendObserveOptions } from '../../../upstream/plugins/dsh-computer-use/src/backend.ts'
import type { ResolvedComputerUseConfig } from '../../../upstream/plugins/dsh-computer-use/src/config.ts'
import type { ComputerAppIdentity, ComputerAppSelector, ComputerAppSummary, ComputerPermissionState, ComputerRect } from '../../../upstream/plugins/dsh-computer-use/src/types.ts'
import { ComputerUseError } from '../../../upstream/plugins/dsh-computer-use/lib/errors.js'

const REQUEST_MAX_BYTES = 256 * 1024
const STDOUT_MAX_BYTES = 4 * 1024 * 1024
const STDERR_MAX_BYTES = 64 * 1024
const REAP_TIMEOUT_MS = 2_000
const WINDOWS_COMMANDS = new Set(['health', 'resolve-app', 'list-apps', 'observe', 'act', 'release-input'])
const PERMISSIONS = new Set<ComputerPermissionState>(['granted', 'denied', 'not-determined', 'unavailable'])
interface WindowsTarget { bundleId: string; pid: number; name: string; executablePath: string; processStartTime: string; windowId: number }
interface PreparedWindowsHelper { path: string; version: string; sha256: string }
interface WindowsClientOptions { environment?: Pick<NodeJS.ProcessEnv, 'SystemRoot' | 'WINDIR'>; validateExecutable?: (path: string) => Promise<void> }

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!record(value)) return false
  const keys = Object.keys(value)
  return required.every(key => keys.includes(key)) && keys.every(key => required.includes(key) || optional.includes(key))
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function integer(value: unknown): value is number { return Number.isSafeInteger(value) }
function boundedString(value: unknown, max: number, allowEmpty = false): value is string { return typeof value === 'string' && Buffer.byteLength(value) <= max && (allowEmpty || value.length > 0) }
function stateHash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) }
function permission(value: unknown): value is ComputerPermissionState { return typeof value === 'string' && PERMISSIONS.has(value as ComputerPermissionState) }
function normalizedWindowsPath(value: unknown, label: string): string {
  if (!boundedString(value, 32768) || value.includes('\0') || !win32.isAbsolute(value) || value.split(/[\\/]+/u).includes('..')) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', label + ' must be one normalized absolute Windows path')
  const normalized = win32.normalize(value)
  if (normalized !== value || normalized.endsWith('\\..')) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', label + ' must be one normalized absolute Windows path')
  return normalized
}
function rectangle(value: unknown): ComputerRect {
  if (!exact(value, ['x', 'y', 'width', 'height']) || !finite(value.x) || !finite(value.y) || !finite(value.width) || !finite(value.height)
    || value.width <= 0 || value.height <= 0 || value.width > 32768 || value.height > 32768) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned an invalid rectangle')
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}
function rawTarget(value: unknown): WindowsTarget {
  if (!exact(value, ['bundleId', 'pid', 'name', 'executablePath', 'processStartTime', 'windowId']) || !boundedString(value.bundleId, 32768)
    || !integer(value.pid) || value.pid <= 0 || !boundedString(value.name, 512) || !boundedString(value.processStartTime, 128)
    || !integer(value.windowId) || value.windowId <= 0) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned invalid private application identity')
  const executablePath = normalizedWindowsPath(value.executablePath, 'target executable path')
  if (value.bundleId !== executablePath.toLowerCase()) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned inconsistent executable identity')
  return { bundleId: value.bundleId, pid: value.pid, name: value.name, executablePath, processStartTime: value.processStartTime, windowId: value.windowId }
}
function sameTarget(left: WindowsTarget, right: WindowsTarget): boolean {
  return left.bundleId === right.bundleId && left.pid === right.pid && left.name === right.name && left.executablePath === right.executablePath && left.processStartTime === right.processStartTime && left.windowId === right.windowId
}
function publicApp(target: WindowsTarget): ComputerAppIdentity {
  const normalized = target.executablePath.toLowerCase()
  return Object.freeze({ bundleId: 'win32:sha256:' + createHash('sha256').update(normalized).digest('hex'), pid: target.pid, name: target.name })
}
function sanitizedElement(value: unknown, position: number): BackendObservation['elements'][number] {
  const optional = ['subrole', 'title', 'label', 'value', 'enabled', 'focused', 'selected', 'frame', 'nativeIdentifier']
  if (!exact(value, ['index', 'locator', 'role', 'actions'], optional) || value.index !== position || !Array.isArray(value.locator) || value.locator.length > 64
    || !value.locator.every(part => integer(part) && part >= 0 && part <= 100_000) || !boundedString(value.role, 256)
    || !Array.isArray(value.actions) || value.actions.length > 32 || !value.actions.every(action => boundedString(action, 128))) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned an invalid UI Automation element')
  const item: BackendObservation['elements'][number] = { index: position, locator: [...value.locator] as number[], role: value.role, actions: [...value.actions] as string[] }
  for (const key of ['subrole', 'title', 'label', 'value', 'nativeIdentifier'] as const) {
    const candidate = value[key]
    if (candidate !== undefined) {
      if (!boundedString(candidate, key === 'value' ? 8192 : 4096, true)) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned oversized UI Automation text')
      item[key] = candidate
    }
  }
  for (const key of ['enabled', 'focused', 'selected'] as const) {
    const candidate = value[key]
    if (candidate !== undefined) {
      if (typeof candidate !== 'boolean') throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned invalid UI Automation state')
      item[key] = candidate
    }
  }
  if (value.frame !== undefined) item.frame = rectangle(value.frame)
  return item
}

/** Validate one helper observation and rebuild only public/backend-approved fields. */
export function sanitizeWindowsObservation(value: unknown, expected: WindowsTarget, app: ComputerAppIdentity, options: BackendObserveOptions): BackendObservation {
  if (!exact(value, ['app', 'stateHash', 'frontmost', 'window', 'treeText', 'truncated', 'elements', 'permissions'], ['screenshot'])) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned an invalid observation envelope')
  const actual = rawTarget(value.app)
  if (!sameTarget(actual, expected) || !stateHash(value.stateHash) || typeof value.frontmost !== 'boolean' || !boundedString(value.treeText, 1_048_576, true)
    || typeof value.truncated !== 'boolean' || !Array.isArray(value.elements) || value.elements.length > 5000
    || !exact(value.window, ['title', 'frame', 'id'], []) || !boundedString(value.window.title, 4096, true) || value.window.id !== expected.windowId
    || !exact(value.permissions, ['accessibility', 'screenRecording']) || !permission(value.permissions.accessibility) || !permission(value.permissions.screenRecording)) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned an invalid or replaced observation target')
  const window = { title: value.window.title, frame: rectangle(value.window.frame) }
  const elements = value.elements.map(sanitizedElement)
  let screenshot: BackendObservation['screenshot']
  if (value.screenshot !== undefined) {
    if (!exact(value.screenshot, ['path', 'width', 'height']) || !boundedString(value.screenshot.path, 32768) || value.screenshot.path !== options.screenshotPath
      || !integer(value.screenshot.width) || value.screenshot.width <= 0 || value.screenshot.width > 32768
      || !integer(value.screenshot.height) || value.screenshot.height <= 0 || value.screenshot.height > 32768) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned invalid screenshot evidence')
    screenshot = { path: value.screenshot.path, width: value.screenshot.width, height: value.screenshot.height }
  }
  if (options.screenshot === 'none' && screenshot !== undefined) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned an unrequested screenshot')
  if (options.screenshot === 'required' && screenshot === undefined) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper omitted the required screenshot')
  return { app, stateHash: value.stateHash, frontmost: value.frontmost, window, treeText: value.treeText, truncated: value.truncated, elements,
    ...(screenshot === undefined ? {} : { screenshot }), permissions: { accessibility: value.permissions.accessibility, screenRecording: value.permissions.screenRecording } }
}
function nativeRoot(): string { return fileURLToPath(new URL('../native/windows/', import.meta.url)) }
function collected(reader: SubprocessOutputReader | undefined): string {
  if (reader === undefined) return ''
  const output = reader.readFrom(0)
  if (output.lossy) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper output exceeded its protocol limit')
  return output.text
}
async function regularFile(path: string, label: string): Promise<void> {
  let info
  try { info = await lstat(path) } catch (error) { throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', label + ' is unavailable', { cause: error }) }
  if (!info.isFile() || info.isSymbolicLink()) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', label + ' must be a regular non-reparse file')
}


/** Fixed-script, integrity-checked client using only the host subprocess service. */
export class WindowsHelperClient {
  private prepared?: PreparedWindowsHelper
  private readonly ctx: Pick<Context, 'subprocess'>
  private readonly timeoutMs: number
  private readonly managedRoot: string
  private readonly platform: NodeJS.Platform
  private readonly environment: Pick<NodeJS.ProcessEnv, 'SystemRoot' | 'WINDIR'>
  private readonly validateExecutable: (path: string) => Promise<void>
  constructor(ctx: Pick<Context, 'subprocess'>, timeoutMs: number, managedRoot = nativeRoot(), platform: NodeJS.Platform = process.platform, options: WindowsClientOptions = {}) {
    this.ctx = ctx; this.timeoutMs = timeoutMs; this.managedRoot = managedRoot; this.platform = platform
    this.environment = options.environment ?? process.env
    this.validateExecutable = options.validateExecutable ?? (process.platform === 'win32' ? path => regularFile(path, 'executable') : async () => {})
  }
  get helperPath(): string { return this.prepared?.path ?? resolve(this.managedRoot, 'dsh-computer-use-helper.ps1') }
  async prepare(signal: AbortSignal): Promise<PreparedWindowsHelper> {
    if (signal.aborted) throw new ComputerUseError('COMPUTER_CANCELLED', 'Windows helper preparation was cancelled')
    if (this.platform !== 'win32') throw new ComputerUseError('COMPUTER_UNSUPPORTED_PLATFORM', 'Windows provider cannot run on ' + this.platform)
    let manifest: unknown
    try { manifest = JSON.parse(await readFile(resolve(this.managedRoot, 'manifest.json'), 'utf8')) } catch (error) { throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper manifest could not be read', { cause: error }) }
    if (!exact(manifest, ['schemaVersion', 'helperVersion', 'source']) || manifest.schemaVersion !== 1 || !boundedString(manifest.helperVersion, 64)
      || !exact(manifest.source, ['path', 'sha256']) || manifest.source.path !== 'dsh-computer-use-helper.ps1' || typeof manifest.source.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(manifest.source.sha256)) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper manifest is malformed')
    const selected = resolve(this.managedRoot, manifest.source.path)
    await regularFile(selected, 'Windows helper')
    const path = await realpath(selected)
    if (dirname(path) !== await realpath(this.managedRoot)) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper escaped its packaged directory')
    const digest = createHash('sha256').update(await readFile(path)).digest('hex')
    if (digest !== manifest.source.sha256) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper hash does not match native/windows/manifest.json')
    return this.prepared = { path, version: manifest.helperVersion, sha256: digest }
  }
  private powershellPath(): string {
    const systemRoot = this.environment.SystemRoot === undefined ? undefined : normalizedWindowsPath(this.environment.SystemRoot, 'SystemRoot')
    const winDir = this.environment.WINDIR === undefined ? undefined : normalizedWindowsPath(this.environment.WINDIR, 'WINDIR')
    if (systemRoot !== undefined && winDir !== undefined && systemRoot.toLowerCase() !== winDir.toLowerCase()) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'SystemRoot and WINDIR disagree')
    const root = systemRoot ?? winDir
    if (root === undefined) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'SystemRoot/WINDIR is unavailable')
    return win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  }
  private async reap(handle: SubprocessHandle, terminate: boolean): Promise<void> {
    if (terminate) handle.terminate()
    let exited = false
    try { exited = await handle.waitForExit(AbortSignal.timeout(REAP_TIMEOUT_MS)) } catch { exited = false }
    if (!exited) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper process tree could not be reaped')
  }
  async invoke<T>(request: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) throw new ComputerUseError('COMPUTER_CANCELLED', 'Windows helper call was cancelled')
    if (typeof request.command !== 'string' || !WINDOWS_COMMANDS.has(request.command)) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'invalid Windows helper command')
    const input = JSON.stringify({ protocolVersion: 1, ...request })
    if (Buffer.byteLength(input) > REQUEST_MAX_BYTES) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper request exceeded its protocol limit')
    const prepared = await this.prepare(signal)
    const powershell = this.powershellPath()
    await this.validateExecutable(powershell)
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const combined = AbortSignal.any([signal, timeout])
    let handle: SubprocessHandle
    try { handle = this.ctx.subprocess.spawn({ argv: [powershell, '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', prepared.path], cwd: dirname(prepared.path), stdio: { stdin: { data: input + '\n' }, stdout: { maxBytes: STDOUT_MAX_BYTES }, stderr: { maxBytes: STDERR_MAX_BYTES } }, graceMs: 1000, signal: combined, env: { SystemRoot: this.environment.SystemRoot ?? this.environment.WINDIR as string, WINDIR: this.environment.WINDIR ?? this.environment.SystemRoot as string } }) } catch (error) { throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper failed to start', { cause: error }) }
    let abortListener: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => { abortListener = () => reject(combined.reason); combined.addEventListener('abort', abortListener, { once: true }) })
    let outcome: Awaited<SubprocessHandle['done']>
    try { outcome = await Promise.race([handle.done, aborted]); await this.reap(handle, false) } catch (error) {
      try { await this.reap(handle, true) } catch (reapError) { throw reapError }
      if (combined.aborted) {
        if (signal.aborted) throw new ComputerUseError('COMPUTER_CANCELLED', 'Windows helper call was cancelled')
        throw new ComputerUseError('COMPUTER_TIMEOUT', 'Windows helper exceeded ' + this.timeoutMs + ' milliseconds')
      }
      throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper failed to run', { cause: error })
    } finally { if (abortListener !== undefined) combined.removeEventListener('abort', abortListener) }
    const stdout = collected(handle.collected.stdout)
    collected(handle.collected.stderr)
    if (outcome.exitCode !== 0 && stdout.trim().length === 0) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper exited without a valid response')
    let envelope: unknown
    try { envelope = JSON.parse(stdout) } catch (error) { throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned invalid JSON', { cause: error }) }
    if (exact(envelope, ['ok', 'value']) && envelope.ok === true) return envelope.value as T
    if (exact(envelope, ['ok', 'error']) && envelope.ok === false && exact(envelope.error, ['code', 'message']) && typeof envelope.error.message === 'string') {
      const code = typeof envelope.error.code === 'string' && ['COMPUTER_STALE_OBSERVATION', 'COMPUTER_ACTION_BLOCKED', 'COMPUTER_PROVIDER_FAILURE'].includes(envelope.error.code) ? envelope.error.code : 'COMPUTER_PROVIDER_FAILURE'
      const messages = {
        COMPUTER_STALE_OBSERVATION: 'Windows target state changed; observe again before acting.',
        COMPUTER_ACTION_BLOCKED: 'Windows denied the requested UI action because required desktop or integrity authority is unavailable.',
        COMPUTER_PROVIDER_FAILURE: 'Windows Computer Use provider failed.',
      } as const
      throw new ComputerUseError(code as keyof typeof messages, messages[code as keyof typeof messages])
    }
    throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned an invalid envelope')
  }
  info(): PreparedWindowsHelper { if (this.prepared === undefined) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper is not prepared'); return { ...this.prepared } }
}

/** Windows backend retaining native target facts only in object-identity sidecars. */
export class WindowsBackend implements Omit<ComputerUseBackend, 'name'> {
  readonly name = 'windows-uia' as const
  readonly client: WindowsHelperClient
  private readonly config: ResolvedComputerUseConfig
  private readonly targets = new WeakMap<ComputerAppIdentity, WindowsTarget>()
  private readonly platform: NodeJS.Platform
  constructor(ctx: Context, config: ResolvedComputerUseConfig, options: { managedRoot?: string; platform?: NodeJS.Platform; client?: WindowsClientOptions } = {}) {
    this.config = config; this.platform = options.platform ?? process.platform
    this.client = new WindowsHelperClient(ctx, config.actionTimeoutMs, options.managedRoot, this.platform, options.client)
  }
  get helperPath(): string { return this.client.helperPath }
  private async remember(target: WindowsTarget): Promise<ComputerAppIdentity> {
    if (process.platform === 'win32') await regularFile(target.executablePath, 'target executable')
    const app = publicApp(target); this.targets.set(app, target); return app
  }
  private async target(app: ComputerAppIdentity): Promise<WindowsTarget> {
    const target = this.targets.get(app)
    if (target === undefined) throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', 'Windows application identity is cloned, expired, or belongs to another backend')
    if (process.platform === 'win32') await regularFile(target.executablePath, 'target executable')
    return target
  }
  private async rows(value: unknown): Promise<Array<{ target: WindowsTarget; app: ComputerAppIdentity; frontmost: boolean; accessibility: ComputerPermissionState; screenRecording: ComputerPermissionState }>> {
    if (!Array.isArray(value) || value.length > 256) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned invalid application rows')
    return await Promise.all(value.map(async row => {
      if (!exact(row, ['bundleId', 'pid', 'name', 'executablePath', 'processStartTime', 'windowId', 'frontmost', 'accessibility', 'screenRecording'])
        || typeof row.frontmost !== 'boolean' || !permission(row.accessibility) || !permission(row.screenRecording)) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned invalid application row')
      const target = rawTarget({ bundleId: row.bundleId, pid: row.pid, name: row.name, executablePath: row.executablePath, processStartTime: row.processStartTime, windowId: row.windowId })
      return { target, app: await this.remember(target), frontmost: row.frontmost, accessibility: row.accessibility, screenRecording: row.screenRecording }
    }))
  }
  async resolveApp(selector: ComputerAppSelector, signal: AbortSignal): Promise<ComputerAppIdentity> {
    if (selector.bundleId !== undefined) {
      if (!/^win32:sha256:[a-f0-9]{64}$/u.test(selector.bundleId)) throw new ComputerUseError('COMPUTER_APP_NOT_FOUND', 'Windows bundleId must be an opaque win32 SHA-256 identifier')
      const matches = (await this.rows(await this.client.invoke<unknown>({ command: 'list-apps' }, signal))).filter(row => row.app.bundleId === selector.bundleId && (selector.pid === undefined || row.app.pid === selector.pid) && (selector.name === undefined || row.app.name === selector.name))
      if (matches.length !== 1) throw new ComputerUseError('COMPUTER_APP_NOT_FOUND', 'opaque Windows application selector did not resolve to exactly one window')
      return matches[0].app
    }
    if (selector.pid === undefined && selector.name === undefined) throw new ComputerUseError('COMPUTER_APP_NOT_FOUND', 'Windows application selector requires bundleId, pid, or name')
    const target = rawTarget(await this.client.invoke<unknown>({ command: 'resolve-app', selector: { ...(selector.pid === undefined ? {} : { pid: selector.pid }), ...(selector.name === undefined ? {} : { name: selector.name }) } }, signal))
    return await this.remember(target)
  }
  async listApps(signal: AbortSignal): Promise<ComputerAppSummary[]> {
    return (await this.rows(await this.client.invoke<unknown>({ command: 'list-apps' }, signal))).map(row => {
      const summary = { bundleId: row.app.bundleId, pid: row.app.pid, name: row.app.name, frontmost: row.frontmost, accessibility: row.accessibility, screenRecording: row.screenRecording }
      this.targets.set(summary, row.target)
      return summary
    })
  }
  async observe(app: ComputerAppIdentity, options: BackendObserveOptions, signal: AbortSignal): Promise<BackendObservation> {
    const target = await this.target(app)
    if (!integer(options.maxNodes) || options.maxNodes < 10 || options.maxNodes > 5000 || !integer(options.maxDepth) || options.maxDepth < 1 || options.maxDepth > 64 || !integer(options.maxTextBytes) || options.maxTextBytes < 1024 || options.maxTextBytes > 1_048_576 || (options.screenshot !== 'none' && !boundedString(options.screenshotPath, 32768))) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'invalid Windows observation bounds')
    return sanitizeWindowsObservation(await this.client.invoke<unknown>({ command: 'observe', app: target, options: { ...options } }, signal), target, app, options)
  }
  async act(request: BackendActionRequest, signal: AbortSignal): Promise<BackendActionResult> {
    const target = await this.target(request.app)
    if (request.window === undefined || !exact(request.window, ['title', 'frame'], ['id']) || request.window.id !== undefined || !stateHash(request.expectedStateHash)) throw new ComputerUseError('COMPUTER_STALE_OBSERVATION', 'Windows action lacks exact private target/state binding')
    const window = { id: target.windowId, title: request.window.title, frame: rectangle(request.window.frame) }
    try {
      const value = await this.client.invoke<unknown>({ command: 'act', request: { action: request.action, app: target, expectedStateHash: request.expectedStateHash, interaction: request.interaction, ...(request.element === undefined ? {} : { element: request.element }), window, limits: { maxNodes: this.config.maxNodes, maxDepth: this.config.maxDepth, maxTextBytes: this.config.maxTextBytes } } }, signal)
      if (!exact(value, ['channel', 'activation', 'pointerInput', 'pointerRouting', 'cleanupComplete', 'targetVerified', 'target'])
        || typeof value.channel !== 'string' || !['accessibility', 'coordinates', 'keyboard'].includes(value.channel)
        || typeof value.activation !== 'string' || !['not-requested', 'already-frontmost', 'activated'].includes(value.activation)
        || typeof value.pointerInput !== 'boolean' || typeof value.pointerRouting !== 'string' || !['none', 'target-process'].includes(value.pointerRouting)
        || value.cleanupComplete !== true || value.targetVerified !== true || !exact(value.target, ['bundleId', 'pid', 'name', 'executablePath', 'processStartTime', 'windowId', 'preStateHash'])
        || value.target.preStateHash !== request.expectedStateHash || !sameTarget(rawTarget({ bundleId: value.target.bundleId, pid: value.target.pid, name: value.target.name, executablePath: value.target.executablePath, processStartTime: value.target.processStartTime, windowId: value.target.windowId }), target)
        || (value.pointerInput && value.pointerRouting !== 'target-process')) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned invalid action or cleanup evidence')
      return { channel: value.channel as BackendActionResult['channel'], activation: value.activation as BackendActionResult['activation'], pointerInput: value.pointerInput, pointerRouting: value.pointerRouting as BackendActionResult['pointerRouting'] }
    } catch (error) {
      try {
        const cleanup = await this.client.invoke<unknown>({ command: 'release-input', action: request.action, app: target, window }, AbortSignal.timeout(REAP_TIMEOUT_MS))
        if (!exact(cleanup, ['cleanupComplete', 'target']) || cleanup.cleanupComplete !== true || !sameTarget(rawTarget(cleanup.target), target)) throw new Error('invalid cleanup evidence')
      } catch (cleanupError) { throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows action failed and key/button cleanup could not be verified', { cause: cleanupError }) }
      throw error
    }
  }
  async visualizeCursor(_action: BackendCursorAction, _phase: 'before' | 'after', signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (this.config.interaction.cursorVisualization !== 'hidden') throw new ComputerUseError('COMPUTER_ACTION_BLOCKED', 'Windows cursor visualization is unavailable; configure it as hidden')
  }
  async dispose(): Promise<void> {}
  async health(signal: AbortSignal): Promise<BackendHealth> {
    await this.client.prepare(signal)
    const value = await this.client.invoke<unknown>({ command: 'health' }, signal)
    if (!exact(value, ['helperVersion', 'accessibility', 'screenRecording']) || !boundedString(value.helperVersion, 64) || !permission(value.accessibility) || !permission(value.screenRecording)) throw new ComputerUseError('COMPUTER_PROVIDER_FAILURE', 'Windows helper returned invalid health evidence')
    return { helperVersion: value.helperVersion, helperSha256: this.client.info().sha256, accessibility: value.accessibility, screenRecording: value.screenRecording }
  }
  async openSettings(): Promise<void> { throw new ComputerUseError('COMPUTER_ACTION_BLOCKED', 'Windows Computer Use has no macOS permission settings action') }
}
