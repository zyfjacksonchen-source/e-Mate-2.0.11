/** Electron implementation of the launcher-provided desktop runtime capability. */

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  Notification,
  shell,
  Tray,
} from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { desktopTerminalStateDirectory, openDesktopTerminal } from './desktop-terminal.ts'
import type { DesktopRendererBootstrap } from './desktop-bootstrap-contract.ts'
import { packagedDependencyPath } from './packaged-runtime-path.ts'
import {
  checkProfileUpdate,
  installProfileUpdate,
  type DesktopProfileUpdateAdapter,
  type ProfileUpdateAvailable,
  type ProfileUpdateContext,
} from './profile-update.ts'
import {
  preflightMacUpdateInstallation,
  scheduleMacUpdateInstallation,
  type MacUpdateAppliedSender,
} from './mac-update-installer.ts'
import type {
  DesktopNotification,
  DesktopPlatform,
  DesktopRuntime,
  DesktopShellSpec,
  DesktopTerminalSpec,
  DesktopThemeSource,
  DesktopTrayItem,
  DesktopTrayItemGroup,
  DesktopTrayItemRegistration,
  DesktopUpdateAdapter,
} from './runtime.ts'
import type { RendererBootReport } from './renderer-boot-contract.ts'
import { prepareTrayIcon } from './tray-icons.ts'
import { downloadDesktopUpdate } from './update-download.ts'
import { checkForStableUpdate, type UpdateCheckResult } from './update-checker.ts'
import {
  DESKTOP_UPDATE_CANCEL,
  DESKTOP_UPDATE_RUN_INTERACTIVE,
  DESKTOP_UPDATE_STATE_CHANGED,
  DESKTOP_UPDATE_STATE_READ,
  desktopUpdateFailureSummary,
  formatUpdateBytes,
  profileUpdateCapabilitySummary,
  type DesktopUpdateState,
} from './update-presentation.ts'
import { desktopWindowOptions, windowsTitleBarOverlay } from './window-options.ts'
import {
  DESKTOP_RESOURCE_RUN,
  parseDesktopResourceRequest,
  type DesktopResource,
  type DesktopResourceAction,
} from './desktop-resource-bridge-contract.ts'

/** Return the presentation mode opposite the active generation. */
export function nextDesktopShellMode(mode: DesktopShellSpec['mode']): DesktopShellSpec['mode'] {
  return mode === 'compatibility' ? 'advanced' : 'compatibility'
}

/** Return the tray command describing the mode that will be activated. */
export function modeToggleLabel(mode: DesktopShellSpec['mode']): string {
  return mode === 'compatibility'
    ? 'Switch to Advanced Mode'
    : 'Switch to Compatibility Mode'
}

/**
 * Read the desktop package version instead of Electron's development-app version.
 * @param moduleUrl - module below the package's `src` or `lib` directory.
 * @returns validated desktop product version.
 */
export function desktopProductVersion(moduleUrl: string = import.meta.url): string {
  const value: unknown = JSON.parse(readFileSync(new URL('../package.json', moduleUrl), 'utf8'))
  if (value === null || typeof value !== 'object' || typeof (value as { version?: unknown }).version !== 'string') {
    throw new Error('@e-mate/desktop: package.json has no product version')
  }
  return (value as { version: string }).version
}

/** Resolve the CommonJS preload emitted beside the Electron runtime bundle. */
export function desktopPreloadPath(moduleUrl: string = import.meta.url): string {
  return fileURLToPath(new URL('./preload.cjs', moduleUrl))
}

const PRODUCT_VERSION = desktopProductVersion()
const RESOURCE_CONTEXT_SCRIPT = `Reflect.get(globalThis, '__EMATE_DESKTOP_RESOURCE__') ?? null`
const MAX_CONTEXT_IMAGE_BYTES = 32 * 1024 * 1024

type ResourceContext =
  | { kind: 'file'; name: string; path: string; root: string; sessionId: string }
  | { kind: 'image'; name: string; src: string; sessionId: string }
  | { kind: 'handled' }

type Resource = Exclude<ResourceContext, { kind: 'handled' }> | DesktopResource

function resourceContext(value: unknown): ResourceContext | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  if (item.kind === 'handled' && Object.keys(item).length === 1) return { kind: 'handled' }
  if (item.kind === 'file' && typeof item.name === 'string' && typeof item.path === 'string'
    && typeof item.root === 'string' && typeof item.sessionId === 'string') {
    return { kind: 'file', name: item.name, path: item.path, root: item.root, sessionId: item.sessionId }
  }
  if (item.kind === 'image' && typeof item.name === 'string' && typeof item.src === 'string'
    && item.src.startsWith('blob:') && typeof item.sessionId === 'string') {
    return { kind: 'image', name: item.name, src: item.src, sessionId: item.sessionId }
  }
  return undefined
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function safeResourceName(name: string, fallback: string): string {
  const value = basename(name).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_').trim()
  return value === '' || value === '.' || value === '..' ? fallback : value.slice(0, 180)
}

function imageMediaType(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}

/** Main-process deadline for one Renderer generation to settle its client Loader. */
export const RENDERER_BOOT_TIMEOUT_MS = 30_000

/** Failure class used by startup recovery to distinguish a hung Renderer. */
export type RendererBootFailureReason = 'renderer-failed' | 'renderer-timeout'

interface ScheduleDeliveryAdmission {
  readonly isOpen: boolean
  open(): void
}

type ScheduleDeliveryAdmissionConstructor = new (open: boolean) => ScheduleDeliveryAdmission

/** Load one closed native Schedule admission from the selected Profile Base. */
export async function loadClosedScheduleDeliveryAdmission(
  profileBaseUrl: string,
): Promise<ScheduleDeliveryAdmission> {
  const entry = createRequire(profileBaseUrl).resolve('@deepseek-ai/dsh-schedule')
  const schedule = await import(pathToFileURL(entry).href) as Record<string, unknown>
  const Admission = schedule.ScheduleDeliveryAdmission
  if (typeof Admission !== 'function') {
    throw new Error('@e-mate/desktop: selected Base Schedule package has no delivery admission')
  }
  const admission = new (Admission as ScheduleDeliveryAdmissionConstructor)(false)
  if (admission.isOpen !== false || typeof admission.open !== 'function') {
    throw new Error('@e-mate/desktop: selected Base Schedule delivery admission is invalid')
  }
  return admission
}

/** Native adapter used by the e-Mate launcher and owned by its Cordis shell plugin. */
export class ElectronDesktopRuntime implements DesktopRuntime {
  readonly platform: DesktopPlatform
  readonly updates: DesktopUpdateAdapter & {
    currentScheduleProtocolFloor: number
    trustedManifestKeys: ProfileUpdateContext['base']['profile_signing_keys']
    profile: DesktopProfileUpdateAdapter | undefined
    downloadAndOpen(
      update: Extract<UpdateCheckResult, { status: 'update-available' }>,
      signal: AbortSignal,
      report?: (state: DesktopUpdateState) => void,
    ): Promise<void>
    publishState(state: DesktopUpdateState): void
    readPublishedState(): DesktopUpdateState | undefined
    setCancelHandler(handler: (() => boolean) | undefined): void
    setInteractiveUpdateHandler(handler: (() => Promise<void>) | undefined): void
  } = {
    get isPackaged() { return app.isPackaged },
    get canDownload() { return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32') },
    get platform() { return process.platform === 'darwin' || process.platform === 'win32' ? process.platform : undefined },
    get currentVersion() { return PRODUCT_VERSION },
    currentScheduleProtocolFloor: 0,
    trustedManifestKeys: [],
    get statePath() { return join(app.getPath('userData'), 'updates', 'state.json') },
    request: (url, init) => net.fetch(url, init),
    profile: undefined,
    confirmDownload: version => this.confirmUpdateDownload(version),
    showManualCheckResult: result => this.showManualUpdateCheckResult(result),
    downloadAndOpen: (
      update: Extract<UpdateCheckResult, { status: 'update-available' }>,
      signal: AbortSignal,
      report?: (state: DesktopUpdateState) => void,
    ) => this.downloadAndOpenUpdate(update, signal, report),
    publishState: state => { this.publishUpdateState(state) },
    readPublishedState: () => this.updateState,
    setCancelHandler: handler => { this.cancelUpdate = handler },
    setInteractiveUpdateHandler: handler => { this.interactiveUpdate = handler },
    notify: notification => { this.showNotification(notification) },
  }

  private window: BrowserWindow | undefined
  private tray: Tray | undefined
  private scheduled: DesktopShellSpec | undefined
  private mountTask: Promise<void> | undefined
  private release: (() => Promise<void>) | undefined
  private quitting = false
  private readonly trayItems = new Map<symbol, DesktopTrayItem>()
  private terminalSpec: DesktopTerminalSpec | undefined
  private rendererBootReported = false
  private rendererBootMonitoring = false
  private rendererHealthy = false
  private rendererBootTimer: NodeJS.Timeout | undefined
  private bootFailureReason: RendererBootFailureReason | undefined
  private markPreparedUpdateShutdownReady: (() => void) | undefined
  private openScheduleStartupLatch: (() => void | Promise<void>) | undefined
  private rendererStartupCommitTask: Promise<void> | undefined
  private directoryPickTask: Promise<string | null> | undefined
  private profileGeneration = 'bundled'
  private updateState: DesktopUpdateState | undefined
  private cancelUpdate: (() => boolean) | undefined
  private interactiveUpdate: (() => Promise<void>) | undefined

  constructor(
    private readonly restart: () => Promise<void>,
    private readonly onRendererBoot: (report: RendererBootReport) => void = () => {},
    private rendererStartupProbation = false,
    private readonly runtimeId = randomUUID(),
  ) {
    if (process.platform !== 'darwin' && process.platform !== 'win32' && process.platform !== 'linux') {
      throw new Error(`@e-mate/desktop: unsupported Electron platform ${process.platform}`)
    }
    this.platform = process.platform
  }

  /** Bind the signed component updater to the generation selected for this process. */
  configureProfileUpdates(context: Omit<ProfileUpdateContext, 'request'>): void {
    if (this.updates.profile !== undefined) throw new Error('@e-mate/desktop: Profile updater is already configured')
    this.updates.currentScheduleProtocolFloor = context.base.schedule_protocol_floor
    this.profileGeneration = context.activeGenerationId
    this.updates.trustedManifestKeys = context.base.profile_signing_keys
    const configured: ProfileUpdateContext = {
      ...context,
      request: (url, init) => net.fetch(url, init),
    }
    this.updates.profile = {
      check: signal => checkProfileUpdate(configured, signal),
      confirm: update => this.confirmProfileUpdate(update),
      install: async (update, signal) => {
        await installProfileUpdate(configured, update, signal)
        this.showNotification({
          title: '正在安装 e-Mate 更新',
          body: `e-Mate ${update.releaseVersion} 已完成校验，将重新启动并在启动检查通过后生效。`,
        })
        void this.requestRestart().catch((cause: unknown) => {
          process.stderr.write(`@e-mate/desktop: failed to restart after component update: ${cause instanceof Error ? cause.message : String(cause)}\n`)
        })
      },
    }
  }

  /** Terminal failure class for the first Renderer boot report, when it failed. */
  get rendererBootFailureReason(): RendererBootFailureReason | undefined {
    return this.bootFailureReason
  }

  /** Arm one main-process deadline immediately before the native shell starts loading. */
  beginRendererBootMonitoring(timeoutMs: number = RENDERER_BOOT_TIMEOUT_MS): void {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('@e-mate/desktop: renderer boot timeout must be a positive integer')
    }
    if (this.rendererBootReported || this.rendererBootMonitoring) {
      throw new Error('@e-mate/desktop: renderer boot monitoring already started')
    }
    this.rendererBootMonitoring = true
    this.rendererBootTimer = setTimeout(() => {
      this.failRendererBoot(
        'renderer-timeout',
        `The Renderer did not report boot health within ${String(timeoutMs)}ms.`,
      )
    }, timeoutMs)
    this.rendererBootTimer.unref()
  }

  /** Put a recovered, potentially-applied macOS candidate back on the existing startup probation path. */
  beginRendererStartupProbation(): void {
    if (this.rendererHealthy || this.rendererStartupProbation) {
      throw new Error('@e-mate/desktop: renderer startup probation cannot be started now')
    }
    this.rendererStartupProbation = true
  }

  /** Stop a pending deadline while startup is being torn down for another failure. */
  stopRendererBootMonitoring(): void {
    this.rendererBootMonitoring = false
    if (this.rendererBootTimer !== undefined) clearTimeout(this.rendererBootTimer)
    this.rendererBootTimer = undefined
  }

  /** @inheritdoc */
  schedule(spec: DesktopShellSpec): () => Promise<void> {
    if (this.scheduled !== undefined || this.mountTask !== undefined) {
      throw new Error('@e-mate/desktop: a native shell generation is already registered')
    }
    const previousThemeSource = nativeTheme.themeSource
    this.scheduled = spec
    let disposed = false
    return async () => {
      if (disposed) return
      disposed = true
      try {
        await this.mountTask
      } finally {
        try {
          await this.release?.()
        } finally {
          this.release = undefined
          this.mountTask = undefined
          if (this.scheduled === spec) {
            nativeTheme.themeSource = previousThemeSource
            this.scheduled = undefined
          }
        }
      }
    }
  }

  /** @inheritdoc */
  mountScheduled(beforeInteractive?: () => void): Promise<void> {
    const spec = this.scheduled
    if (spec === undefined) {
      return Promise.reject(new Error('@e-mate/desktop: the Cordis shell plugin did not register a window'))
    }
    this.mountTask ??= this.mount(spec, beforeInteractive).then((release) => { this.release = release })
    return this.mountTask
  }

  /** @inheritdoc */
  show(): void {
    if (!this.rendererHealthy || this.rendererStartupProbation) return
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
  }

  /** Commit one healthy probation launch only after its durable acknowledgement succeeds. */
  async commitRendererStartup(
    commit: () => void | MacUpdateAppliedSender | Promise<void | MacUpdateAppliedSender>,
  ): Promise<void> {
    if (!this.rendererStartupProbation) return
    this.rendererStartupCommitTask ??= this.commitRendererStartupOnce(commit)
    await this.rendererStartupCommitTask
  }

  private async commitRendererStartupOnce(
    commit: () => void | MacUpdateAppliedSender | Promise<void | MacUpdateAppliedSender>,
  ): Promise<void> {
    if (!this.rendererHealthy) throw new Error('@e-mate/desktop: renderer startup is not healthy')
    const openScheduleStartupLatch = this.openScheduleStartupLatch
    if (openScheduleStartupLatch === undefined) {
      throw new Error('@e-mate/desktop: macOS update Schedule startup latch is not configured')
    }
    const window = this.window
    if (window === undefined || window.isDestroyed()) {
      throw new Error('@e-mate/desktop: macOS update window is unavailable')
    }
    const applied = await commit()
    if (this.window !== window || window.isDestroyed()) {
      throw new Error('@e-mate/desktop: macOS update window became unavailable during commit')
    }
    this.rendererStartupProbation = false
    try {
      this.show()
      if (this.window !== window || window.isDestroyed() || !window.isVisible()) {
        throw new Error('@e-mate/desktop: macOS update window did not become visible')
      }
    } catch (cause) {
      this.rendererStartupProbation = true
      if (!window.isDestroyed()) window.hide()
      throw cause
    }
    // The Schedule latch is one-way. After invoking it, failure must stay forward-only.
    await openScheduleStartupLatch()
    if (typeof applied === 'function') await applied()
  }

  /** Bind the Base-owned Schedule controller before a probation renderer can be committed. */
  configureScheduleStartupLatch(open: () => void | Promise<void>): void {
    if (this.openScheduleStartupLatch === open) return
    if (this.openScheduleStartupLatch !== undefined) {
      throw new Error('@e-mate/desktop: Schedule startup latch is already configured')
    }
    this.openScheduleStartupLatch = open
  }

  /** @inheritdoc */
  async pickDirectory(): Promise<string | null> {
    if (this.directoryPickTask !== undefined) return await this.directoryPickTask
    const task = this.showDirectoryPicker()
    this.directoryPickTask = task
    try {
      return await task
    } finally {
      if (this.directoryPickTask === task) this.directoryPickTask = undefined
    }
  }

  private async showDirectoryPicker(): Promise<string | null> {
    const options: Electron.OpenDialogOptions = {
      title: '选择工作区目录',
      properties: ['openDirectory', 'dontAddToRecent'],
    }
    const window = this.window
    const result = window === undefined || window.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(window, options)
    return result.canceled ? null : result.filePaths[0] ?? null
  }

  /** @inheritdoc */
  registerTrayItem(item: DesktopTrayItem): DesktopTrayItemRegistration {
    const key = Symbol()
    this.trayItems.set(key, item)
    this.rebuildTrayMenu()
    let active = true
    return {
      refresh: () => {
        if (active) this.rebuildTrayMenu()
      },
      dispose: () => {
        if (!active) return
        active = false
        this.trayItems.delete(key)
        this.rebuildTrayMenu()
      },
    }
  }

  /**
   * Fix the profile identity before Cordis plugins can contribute terminal commands.
   * @param spec - launcher-resolved desktop profile and Harness home.
   */
  configureTerminal(spec: DesktopTerminalSpec): void {
    if (this.terminalSpec !== undefined) {
      throw new Error('@e-mate/desktop: terminal profile is already configured')
    }
    this.terminalSpec = { ...spec }
  }

  /** @inheritdoc */
  openTerminal(): void {
    try {
      const spec = this.terminalSpec
      if (spec === undefined) {
        throw new Error('@e-mate/desktop: terminal profile is not configured')
      }
      const electronVersion = process.versions.electron
      if (electronVersion === undefined) {
        throw new Error('@e-mate/desktop: terminal requires the Electron runtime version')
      }
      openDesktopTerminal({
        platform: this.platform,
        appExecutable: process.execPath,
        dshBootstrapPath: fileURLToPath(new URL('./desktop-cli.js', import.meta.url)),
        pnpmBinPath: packagedDependencyPath(import.meta.url, 'pnpm/bin/pnpm.mjs'),
        electronVersion,
        profileName: spec.profileName,
        productVersion: PRODUCT_VERSION,
        profileDir: spec.profileDir,
        homeDir: spec.homeDir,
        stateDir: desktopTerminalStateDirectory(app.getPath('userData'), spec.profileName),
        spawn,
        onLaunchError: cause => { this.reportTerminalLaunchError(cause) },
      })
    } catch (cause) {
      this.reportTerminalLaunchError(cause)
    }
  }

  /** @inheritdoc */
  reportRendererBoot(report: RendererBootReport): void {
    if (this.rendererBootReported) return
    this.rendererBootReported = true
    this.stopRendererBootMonitoring()
    if (report.status === 'failed') this.bootFailureReason ??= 'renderer-failed'
    try {
      this.onRendererBoot(report)
    } catch (cause) {
      process.stderr.write(`@e-mate/desktop: failed to persist renderer boot health: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    }
    if (report.status === 'healthy') {
      this.rendererHealthy = true
      this.show()
    }
    if (report.status === 'failed' && process.env.EMATE_RELEASE_HEALTH_PROBE !== '1') {
      void this.showRendererBootRecovery(report).catch((cause: unknown) => {
        process.stderr.write(`@e-mate/desktop: failed to show plugin recovery: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      })
    }
  }

  /** @inheritdoc */
  setThemeSource(source: DesktopThemeSource): void {
    if (this.scheduled !== undefined && this.window !== undefined) {
      nativeTheme.themeSource = source
      this.syncWindowsTitleBarOverlay()
    }
  }

  private syncWindowsTitleBarOverlay(): void {
    if (this.platform === 'win32' && this.scheduled?.mode === 'advanced' && this.window !== undefined) {
      this.window.setTitleBarOverlay(windowsTitleBarOverlay(nativeTheme.shouldUseDarkColors))
    }
  }

  /** @inheritdoc */
  async requestRestart(): Promise<void> {
    await this.restart()
  }

  /** @inheritdoc */
  prepareToQuit(): void {
    this.quitting = true
    this.stopRendererBootMonitoring()
  }

  private failRendererBoot(reason: RendererBootFailureReason, error: string): void {
    if (!this.rendererBootMonitoring || this.rendererBootReported) return
    this.bootFailureReason = reason
    this.reportRendererBoot({ status: 'failed', plugins: [], error })
  }

  /** Allow the detached updater to replace the app only after Cordis disposed cleanly. */
  commitPreparedUpdateShutdown(): void {
    const markReady = this.markPreparedUpdateShutdownReady
    if (markReady === undefined) return
    this.markPreparedUpdateShutdownReady = undefined
    markReady()
  }

  private async showRendererBootRecovery(report: Extract<RendererBootReport, { status: 'failed' }>): Promise<void> {
    const plugins = report.plugins.length === 0
      ? 'Unknown client plugin'
      : report.plugins.map(plugin => `- ${plugin}`).join('\n')
    const error = report.error === undefined ? 'The client Loader did not provide an error message.' : report.error
    const result = await dialog.showMessageBox({
      type: 'error',
      title: 'Plugin Recovery',
      message: 'e-Mate could not load all plugins.',
      detail: `Failed plugins:\n${plugins}\n\n${error}\n\nOpen DSH Terminal to update or remove the failing third-party plugin, then restart e-Mate.`,
      buttons: ['Open DSH Terminal', 'Restart e-Mate', 'Dismiss'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    })
    if (result.response === 0) this.openTerminal()
    else if (result.response === 1) await this.requestRestart()
  }

  private contributedTrayItems(group: DesktopTrayItemGroup): Electron.MenuItemConstructorOptions[] {
    return [...this.trayItems.values()]
      .filter(item => item.group === group)
      .sort((left, right) => left.order - right.order)
      .map((item): Electron.MenuItemConstructorOptions => {
        const common = {
          label: item.label(),
          enabled: item.enabled?.() ?? true,
        }
        if (item.submenu !== undefined) {
          return {
            ...common,
            submenu: item.submenu().map(command => ({
              label: command.label(),
              enabled: command.enabled?.() ?? true,
              ...(command.type === undefined ? {} : { type: command.type }),
              ...(command.checked === undefined ? {} : { checked: command.checked() }),
              click: this.trayCommand(() => command.invoke()),
            })),
          }
        }
        return {
          ...common,
          click: this.trayCommand(() => item.invoke()),
        }
      })
  }

  /** Contain asynchronous contribution failures outside Electron menu callbacks. */
  private trayCommand(invoke: () => void | Promise<void>): () => void {
    return () => {
      void Promise.resolve().then(invoke).catch((cause: unknown) => {
        process.stderr.write(`@e-mate/desktop: tray command failed: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      })
    }
  }

  private showNotification(notification: DesktopNotification): void {
    if (!Notification.isSupported()) return
    const nativeNotification = new Notification({
      title: notification.title,
      body: notification.body,
    })
    nativeNotification.show()
  }

  /** Ask before making the fixed download endpoint's counted request. */
  private async confirmUpdateDownload(version: string): Promise<boolean> {
    const result = await dialog.showMessageBox({
      type: 'info',
      title: '发现 e-Mate 更新',
      message: `e-Mate ${version} 已可更新。`,
      detail: '将自动下载并校验安装包，安装完成后重新打开 e-Mate。',
      buttons: ['更新并重启', '稍后'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return result.response === 0
  }

  /** Show the signed update summary before any payload is downloaded. */
  private async confirmProfileUpdate(update: ProfileUpdateAvailable): Promise<boolean> {
    const capabilitySummary = profileUpdateCapabilitySummary(update.changedComponents.length)
    const result = await dialog.showMessageBox({
      type: 'info',
      title: '发现 e-Mate 更新',
      message: `e-Mate ${update.releaseVersion} 第 ${update.sequence} 代已可更新。`,
      detail: `${capabilitySummary}\n\n下载大小：${formatUpdateBytes(update.downloadBytes)}\n更新包将先完成校验，再原子切换并重启；仅在启动健康检查通过后生效，失败将自动回滚。`,
      buttons: ['更新并重启', '稍后'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return result.response === 0
  }

  /** Report one user-triggered check without exposing network or response details. */
  private async showManualUpdateCheckResult(result: UpdateCheckResult | null): Promise<void> {
    if (result === null || result.status === 'failed') {
      const failure = this.updateState?.stage === 'failed' ? this.updateState : undefined
      await dialog.showMessageBox({
        type: 'warning',
        title: '无法检查更新',
        message: desktopUpdateFailureSummary(failure?.code
          ?? (result?.code === 'check-cancelled' ? 'cancelled' : result?.code)),
        detail: failure?.diagnosticId === undefined
          ? '请稍后再试。'
          : `请稍后再试。\n\n诊断编号：${failure.diagnosticId}`,
        buttons: ['知道了'],
        defaultId: 0,
        noLink: true,
      })
      return
    }

    if (result.status === 'up-to-date') {
      await dialog.showMessageBox({
        type: 'info',
        title: 'e-Mate 已是最新版本',
        message: '当前没有更新版本。',
        detail: `已安装版本：${result.currentVersion}`,
        buttons: ['知道了'],
        defaultId: 0,
        noLink: true,
      })
      return
    }

    await dialog.showMessageBox({
      type: 'info',
      title: '发现 e-Mate 更新',
      message: `e-Mate ${result.latestVersion} 已可更新。`,
      detail: '当前构建不支持下载安装包。',
      buttons: ['知道了'],
      defaultId: 0,
      noLink: true,
    })
  }

  /** Download a confirmed installer and hand it to the native installation flow. */
  private async downloadAndOpenUpdate(
    update: Extract<UpdateCheckResult, { status: 'update-available' }>,
    signal: AbortSignal,
    report: (state: DesktopUpdateState) => void = () => {},
  ): Promise<void> {
    if (this.platform !== 'darwin' && this.platform !== 'win32') {
      throw new Error(`@e-mate/desktop: updates are unavailable on ${this.platform}`)
    }
    const helperModulePath = fileURLToPath(new URL('./mac-update-helper.js', import.meta.url))
    const macSpec = this.platform === 'darwin' ? this.scheduled : undefined
    if (this.platform === 'darwin') {
      if (macSpec === undefined) throw new Error('@e-mate/desktop: no active shell can exit for update installation')
      preflightMacUpdateInstallation({
        targetVersion: update.latestVersion,
        currentExecutable: process.execPath,
        userDataPath: app.getPath('userData'),
        homeDirectory: app.getPath('home'),
        helperModulePath,
        sourceCommit: update.sourceCommit,
        baseContractId: update.baseContractId,
        scheduleProtocolFloor: update.scheduleProtocolFloor,
        manifestIdentity: update.manifestIdentity,
        artifact: update.artifact,
      })
    }
    const artifactPath = await downloadDesktopUpdate({
      platform: this.platform,
      version: update.latestVersion,
      artifact: update.artifact,
      userDataPath: app.getPath('userData'),
      request: (url, init) => net.fetch(url, init),
      signal,
      onProgress: progress => {
        report({ stage: 'downloading', bytes: progress.bytes, total: progress.total, ...(
          progress.cached === true ? { cached: true as const } : {}
        ) })
      },
    })
    signal.throwIfAborted()
    report({ stage: 'verifying' })
    const verified = await checkForStableUpdate({
      currentVersion: update.currentVersion,
      currentScheduleProtocolFloor: this.updates.currentScheduleProtocolFloor,
      platform: this.platform,
      trustedManifestKeys: this.updates.trustedManifestKeys,
      signal,
      request: this.updates.request,
    })
    if (verified.status !== 'update-available' || verified.manifestIdentity !== update.manifestIdentity) {
      throw new Error('@e-mate/desktop: signed update changed after download')
    }
    report({ stage: 'staging' })

    if (this.platform === 'darwin') {
      const prepared = await scheduleMacUpdateInstallation({
        dmgPath: artifactPath,
        targetVersion: update.latestVersion,
        currentExecutable: process.execPath,
        userDataPath: app.getPath('userData'),
        homeDirectory: app.getPath('home'),
        helperModulePath,
        sourceCommit: update.sourceCommit,
        baseContractId: update.baseContractId,
        scheduleProtocolFloor: update.scheduleProtocolFloor,
        manifestIdentity: update.manifestIdentity,
        artifact: update.artifact,
        parentPid: process.pid,
        signal,
      })
      this.markPreparedUpdateShutdownReady = prepared.markShutdownReady
      report({ stage: 'waiting-shutdown' })
      this.showNotification({
        title: '正在安装 e-Mate 更新',
        body: `e-Mate ${update.latestVersion} 将自动重新打开。`,
      })
      this.quitting = true
      macSpec!.requestQuit(0)
      return
    }

    const spec = this.scheduled
    if (spec === undefined) throw new Error('@e-mate/desktop: no active shell can exit for update installation')
    signal.throwIfAborted()
    await this.launchWindowsUpdateInstaller(artifactPath)
    report({ stage: 'waiting-shutdown' })
    this.showNotification({
      title: '正在安装 e-Mate 更新',
      body: `e-Mate ${update.latestVersion} 将自动重新打开。`,
    })
    this.quitting = true
    spec.requestQuit(0)
  }

  /** Start the downloaded NSIS installer before releasing the current process. */
  private async launchWindowsUpdateInstaller(installerPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(installerPath, ['--updated', '--force-run'], {
          detached: true,
          stdio: 'ignore',
          shell: false,
          windowsHide: true,
        })
      } catch (cause) {
        reject(cause)
        return
      }
      const fail = (cause: Error): void => { reject(cause) }
      child.once('error', fail)
      child.once('spawn', () => {
        child.off('error', fail)
        child.once('error', cause => {
          process.stderr.write(`@e-mate/desktop: update installer failed after launch: ${cause.message}\n`)
        })
        child.unref()
        resolve()
      })
    })
  }

  private publishUpdateState(state: DesktopUpdateState): void {
    this.updateState = state
    this.window?.webContents.send(DESKTOP_UPDATE_STATE_CHANGED, state)
  }

  /** Keep native-terminal launch failures visible in a packaged GUI process. */
  private reportTerminalLaunchError(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    process.stderr.write(`@e-mate/desktop: failed to open terminal: ${error.message}\n`)
    try {
      dialog.showErrorBox('Unable to Open DSH Terminal', error.message)
    } catch (dialogCause) {
      process.stderr.write(`@e-mate/desktop: failed to show terminal error: ${dialogCause instanceof Error ? dialogCause.message : String(dialogCause)}\n`)
    }
  }

  private rebuildTrayMenu(): void {
    const tray = this.tray
    const spec = this.scheduled
    if (tray === undefined || spec === undefined) return

    const show = (): void => { this.show() }
    const tools = this.contributedTrayItems('tools')
    const profiles = this.contributedTrayItems('profiles')
    const status = this.contributedTrayItems('status')
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: `Open ${spec.productName}`, click: show },
    ]
    if (tools.length > 0) template.push({ type: 'separator' }, ...tools)
    if (profiles.length > 0) template.push({ type: 'separator' }, ...profiles)
    if (status.length > 0) template.push({ type: 'separator' }, ...status)
    template.push(
      { type: 'separator' },
      { label: 'Quit', click: () => { spec.requestQuit(0) } },
    )
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  private async authorizedSessionRoot(spec: DesktopShellSpec, sessionId: string): Promise<string> {
    const sessionRoot = spec.resourceSessionRoot(sessionId)
    if (sessionRoot === undefined) throw new Error('resource session is not active')
    const root = await realpath(sessionRoot)
    const allowedRoots = await Promise.all(spec.resourceRoots().map(async candidate => realpath(candidate).catch(() => undefined)))
    if (!allowedRoots.includes(root)) throw new Error('resource session workspace is not authorized')
    return root
  }

  private async authorizedResourcePath(
    resource: Extract<Resource, { kind: 'file' }>,
    sessionRoot: string,
  ): Promise<string> {
    if (!isAbsolute(resource.path) || !isAbsolute(resource.root) || resource.path.includes('\0') || resource.root.includes('\0')) {
      throw new Error('invalid resource path')
    }
    const root = await realpath(resource.root)
    if (root !== sessionRoot) throw new Error('resource workspace does not match its session')
    const path = await realpath(resource.path)
    if (!inside(root, path) || !(await lstat(path)).isFile()) throw new Error('resource is not a regular workspace file')
    return path
  }

  private async readImageBytes(
    window: BrowserWindow,
    resource: Extract<Resource, { kind: 'image' }>,
  ): Promise<{ bytes: Buffer; mediaType: string }> {
    const dataUrl = await window.webContents.executeJavaScript(`(async () => {
      const response = await fetch(${JSON.stringify(resource.src)});
      const blob = await response.blob();
      if (blob.size > ${String(MAX_CONTEXT_IMAGE_BYTES)}) throw new Error('image-too-large');
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    })()`) as unknown
    if (typeof dataUrl !== 'string') throw new Error('invalid image response')
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/u)
    if (match === null) throw new Error('unsupported image response')
    const encoded = match[2]!
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CONTEXT_IMAGE_BYTES || bytes.toString('base64') !== encoded) {
      throw new Error('invalid image bytes')
    }
    const mediaType = imageMediaType(bytes)
    if (mediaType === undefined || mediaType !== match[1]) throw new Error('image type does not match its bytes')
    return { bytes, mediaType }
  }

  private async materializeImage(window: BrowserWindow, resource: Extract<Resource, { kind: 'image' }>): Promise<string> {
    const { bytes, mediaType } = await this.readImageBytes(window, resource)
    const extension = mediaType === 'image/jpeg' ? '.jpg' : `.${mediaType.slice('image/'.length)}`
    const requested = safeResourceName(resource.name, `e-mate-image${extension}`)
    const name = /\.(?:png|jpe?g|webp|gif)$/iu.test(requested) ? requested : `${requested}${extension}`
    const directory = join(app.getPath('temp'), 'e-mate-resources')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${randomUUID()}-${name}`)
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
    return path
  }

  private async copyFileToClipboard(path: string): Promise<void> {
    if (this.platform === 'darwin') {
      await this.spawnNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', [
        'ObjC.import("AppKit")',
        'const app = Application.currentApplication(); app.includeStandardAdditions = true',
        'const path = app.systemAttribute("E_MATE_COPY_PATH")',
        'const board = $.NSPasteboard.generalPasteboard',
        'board.clearContents',
        'board.writeObjects([$.NSURL.fileURLWithPath($(path))])',
      ].join(';')], { E_MATE_COPY_PATH: path })
      return
    }
    if (this.platform === 'win32') {
      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
      await this.spawnNative(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-Sta', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; $files = New-Object System.Collections.Specialized.StringCollection; [void]$files.Add($env:E_MATE_COPY_PATH); [System.Windows.Forms.Clipboard]::SetFileDropList($files)',
      ], { SystemRoot: systemRoot, E_MATE_COPY_PATH: path })
      return
    }
    throw new Error('file clipboard is unavailable on this platform')
  }

  private async openWith(path: string): Promise<void> {
    if (this.platform === 'darwin') {
      const choice = await dialog.showOpenDialog({
        title: '选择打开方式', defaultPath: '/Applications', properties: ['openFile'],
        filters: [{ name: '应用程序', extensions: ['app'] }],
      })
      const application = choice.canceled ? undefined : choice.filePaths[0]
      if (application !== undefined) await this.spawnNative('/usr/bin/open', ['-a', application, '--', path])
      return
    }
    if (this.platform === 'win32') {
      const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
      await this.spawnNative(join(systemRoot, 'System32', 'rundll32.exe'), ['shell32.dll,OpenAs_RunDLL', path], { SystemRoot: systemRoot })
      return
    }
    throw new Error('open with is unavailable on this platform')
  }

  private spawnNative(command: string, args: readonly string[], extraEnv: Readonly<Record<string, string>> = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ...extraEnv },
      })
      child.once('error', reject)
      child.once('spawn', () => { child.unref(); resolve() })
    })
  }

  private async resourcePath(window: BrowserWindow, spec: DesktopShellSpec, resource: Resource): Promise<string> {
    return resource.kind === 'file'
      ? this.authorizedResourcePath(resource, await this.authorizedSessionRoot(spec, resource.sessionId))
      : this.materializeImage(window, resource)
  }

  private async runResourceAction(
    action: DesktopResourceAction,
    window: BrowserWindow,
    spec: DesktopShellSpec,
    resource: Resource,
  ): Promise<void> {
    if (action === 'copy-image') {
      if (resource.kind !== 'image') throw new Error('copy-image requires an image resource')
      const image = nativeImage.createFromBuffer((await this.readImageBytes(window, resource)).bytes)
      if (image.isEmpty()) throw new Error('invalid image bitmap')
      clipboard.writeImage(image)
      return
    }
    const path = await this.resourcePath(window, spec, resource)
    if (action === 'save-as') {
      const selected = await dialog.showSaveDialog({
        title: '另存为',
        defaultPath: join(
          app.getPath('downloads'),
          safeResourceName(resource.kind === 'image' ? resource.name : basename(resource.path), basename(path)),
        ),
      })
      if (!selected.canceled && selected.filePath !== undefined) await copyFile(path, selected.filePath)
    } else if (action === 'copy-path') clipboard.writeText(path)
    else if (action === 'copy-file') await this.copyFileToClipboard(path)
    else if (action === 'open-with') await this.openWith(path)
    else shell.showItemInFolder(path)
  }

  private async mount(
    spec: DesktopShellSpec,
    beforeInteractive: (() => void) | undefined,
  ): Promise<() => Promise<void>> {
    const icon = nativeImage.createFromPath(spec.iconPath)
    if (icon.isEmpty()) {
      throw new Error(`@e-mate/desktop: failed to load application icon ${spec.iconPath}`)
    }
    if (this.platform === 'darwin') app.dock?.setIcon(icon)
    const origin = new URL(spec.url).origin
    nativeTheme.themeSource = spec.readThemeSource()
    const bootstrap: DesktopRendererBootstrap = {
      schemaVersion: 1,
      mode: spec.mode,
      platform: this.platform,
      profileGeneration: this.profileGeneration,
      runtimeId: this.runtimeId,
      windowKind: 'main',
    }
    const window = new BrowserWindow(desktopWindowOptions(
      spec,
      icon,
      this.platform,
      desktopPreloadPath(),
      bootstrap,
      nativeTheme.shouldUseDarkColors,
    ))
    window.accessibleTitle = spec.windowTitle
    if (this.platform === 'win32') window.removeMenu()
    this.window = window

    const readUpdateState = (event: Electron.IpcMainEvent): void => {
      event.returnValue = event.sender === window.webContents ? this.updateState : undefined
    }
    const cancelUpdate = (event: Electron.IpcMainEvent): void => {
      event.returnValue = event.sender === window.webContents ? this.cancelUpdate?.() === true : false
    }
    const runInteractiveUpdate = async (event: Electron.IpcMainInvokeEvent): Promise<void> => {
      if (event.sender !== window.webContents) {
        throw new Error('@e-mate/desktop: update request did not originate from owning Renderer')
      }
      if (this.interactiveUpdate === undefined) throw new Error('@e-mate/desktop: updater is not ready')
      await this.interactiveUpdate()
    }
    ipcMain.on(DESKTOP_UPDATE_STATE_READ, readUpdateState)
    ipcMain.on(DESKTOP_UPDATE_CANCEL, cancelUpdate)
    ipcMain.handle(DESKTOP_UPDATE_RUN_INTERACTIVE, runInteractiveUpdate)
    const runDesktopResource = async (event: Electron.IpcMainInvokeEvent, value: unknown): Promise<void> => {
      if (event.sender !== window.webContents) {
        throw new Error('@e-mate/desktop: resource request did not originate from owning Renderer')
      }
      const request = parseDesktopResourceRequest(value)
      if (request === undefined) throw new Error('@e-mate/desktop: invalid resource request')
      await this.runResourceAction(request.action, window, spec, request.resource)
    }
    ipcMain.handle(DESKTOP_RESOURCE_RUN, runDesktopResource)

    const show = (): void => { this.show() }
    const close = (event: Electron.Event): void => {
      if (this.quitting) return
      event.preventDefault()
      window.hide()
    }
    const preserveBlankTitle = (event: Electron.Event): void => { event.preventDefault() }
    const showContextMenu = (_event: Electron.Event, params: Electron.ContextMenuParams): void => {
      void (async () => {
        const resource = resourceContext(await window.webContents.executeJavaScript(RESOURCE_CONTEXT_SCRIPT))
        if (resource?.kind === 'handled') return
        const template: Electron.MenuItemConstructorOptions[] = []
        if (resource?.kind === 'image') {
          template.push({ label: '复制', click: () => { window.webContents.copyImageAt(params.x, params.y) } }, { type: 'separator' })
        } else if (params.isEditable) template.push({ role: 'cut', enabled: params.editFlags.canCut })
        if (resource === undefined) {
          template.push({ role: 'copy', enabled: params.editFlags.canCopy || params.selectionText.length > 0 })
          if (params.isEditable) template.push({ role: 'paste', enabled: params.editFlags.canPaste })
          template.push({ type: 'separator' }, { role: 'selectAll' })
        } else {
          const run = (action: Parameters<ElectronDesktopRuntime['runResourceAction']>[0]) => () => {
            void this.runResourceAction(action, window, spec, resource).catch(cause => {
              process.stderr.write(`@e-mate/desktop: resource action ${action} failed: ${cause instanceof Error ? cause.message : String(cause)}\n`)
            })
          }
          template.push(
            { label: '另存为…', click: run('save-as') },
            { label: '复制路径', click: run('copy-path') },
            { label: '复制文件内容', click: run('copy-file') },
            { label: '打开方式', submenu: [{ label: '选择应用…', click: run('open-with') }] },
            { type: 'separator' },
            { label: this.platform === 'win32' ? '在资源管理器中显示' : '在 Finder 中显示', click: run('reveal') },
          )
        }
        Menu.buildFromTemplate(template).popup({ window })
      })().catch(cause => {
        process.stderr.write(`@e-mate/desktop: failed to build context menu: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      })
    }
    const navigate = (event: Electron.Event<{ url: string }>): void => {
      let targetOrigin: string | undefined
      try {
        targetOrigin = new URL(event.url).origin
      } catch {
        targetOrigin = undefined
      }
      if (targetOrigin !== origin) event.preventDefault()
    }
    const syncWindowsTitleBarOverlay = (): void => { this.syncWindowsTitleBarOverlay() }

    app.on('activate', show)
    if (this.platform === 'win32' && spec.mode === 'advanced') nativeTheme.on('updated', syncWindowsTitleBarOverlay)
    window.on('close', close)
    window.on('page-title-updated', preserveBlankTitle)
    window.webContents.on('context-menu', showContextMenu)
    window.webContents.on('will-frame-navigate', navigate)
    window.webContents.on('will-redirect', navigate)
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const target = new URL(url)
        if (target.protocol === 'https:' || target.protocol === 'http:' || target.protocol === 'mailto:') {
          void shell.openExternal(target.href).catch((cause: unknown) => {
            process.stderr.write(`@e-mate/desktop: failed to open external link: ${cause instanceof Error ? cause.message : String(cause)}\n`)
          })
        }
      } catch {
        // A malformed target is rejected with the same deny result.
      }
      return { action: 'deny' }
    })

    window.once('ready-to-show', show)
    let tray: Tray | undefined
    try {
      await window.loadURL(spec.url)
      tray = new Tray(prepareTrayIcon(spec.trayIcons, this.platform))
      this.tray = tray
      tray.setToolTip(spec.productName)
      this.rebuildTrayMenu()
      tray.on('click', show)
      beforeInteractive?.()
    } catch (cause) {
      ipcMain.off(DESKTOP_UPDATE_STATE_READ, readUpdateState)
      ipcMain.off(DESKTOP_UPDATE_CANCEL, cancelUpdate)
      ipcMain.removeHandler(DESKTOP_UPDATE_RUN_INTERACTIVE)
      ipcMain.removeHandler(DESKTOP_RESOURCE_RUN)
      app.off('activate', show)
      nativeTheme.off('updated', syncWindowsTitleBarOverlay)
      window.off('page-title-updated', preserveBlankTitle)
      window.webContents.off('context-menu', showContextMenu)
      tray?.off('click', show)
      tray?.destroy()
      window.destroy()
      this.tray = undefined
      this.window = undefined
      throw cause
    }

    if (tray === undefined) {
      throw new Error('@e-mate/desktop: native tray did not mount')
    }
    const mountedTray = tray

    let released = false
    return async () => {
      if (released) return
      released = true
      ipcMain.off(DESKTOP_UPDATE_STATE_READ, readUpdateState)
      ipcMain.off(DESKTOP_UPDATE_CANCEL, cancelUpdate)
      ipcMain.removeHandler(DESKTOP_UPDATE_RUN_INTERACTIVE)
      ipcMain.removeHandler(DESKTOP_RESOURCE_RUN)
      app.off('activate', show)
      nativeTheme.off('updated', syncWindowsTitleBarOverlay)
      window.off('close', close)
      window.off('page-title-updated', preserveBlankTitle)
      window.webContents.off('context-menu', showContextMenu)
      window.webContents.off('will-frame-navigate', navigate)
      window.webContents.off('will-redirect', navigate)
      mountedTray.off('click', show)
      mountedTray.destroy()
      if (!window.isDestroyed()) window.destroy()
      if (this.tray === mountedTray) this.tray = undefined
      if (this.window === window) this.window = undefined
    }
  }
}
