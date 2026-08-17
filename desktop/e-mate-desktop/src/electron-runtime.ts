/** Electron implementation of the launcher-provided desktop runtime capability. */

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
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
import { existsSync, readFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopTerminalStateDirectory, openDesktopTerminal } from './desktop-terminal.ts'
import { packagedDependencyPath } from './packaged-runtime-path.ts'
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
import type { UpdateCheckResult } from './update-checker.ts'
import { desktopWindowOptions } from './window-options.ts'

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

const PRODUCT_VERSION = desktopProductVersion()
const RESOURCE_CONTEXT_SCRIPT = `Reflect.get(globalThis, '__EMATE_DESKTOP_RESOURCE__') ?? null`
const MAX_CONTEXT_IMAGE_BYTES = 32 * 1024 * 1024

type ResourceContext =
  | { kind: 'file'; name: string; path: string; root: string; sessionId: string }
  | { kind: 'image'; name: string; src: string; sessionId: string }

function resourceContext(value: unknown): ResourceContext | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
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

/** Native adapter used by the e-Mate launcher and owned by its Cordis shell plugin. */
export class ElectronDesktopRuntime implements DesktopRuntime {
  readonly platform: DesktopPlatform
  readonly updates: DesktopUpdateAdapter = {
    get isPackaged() { return app.isPackaged },
    get canDownload() { return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32') },
    get platform() { return process.platform === 'darwin' || process.platform === 'win32' ? process.platform : undefined },
    get currentVersion() { return PRODUCT_VERSION },
    get statePath() { return join(app.getPath('userData'), 'updates', 'state.json') },
    request: (url, init) => net.fetch(url, init),
    confirmDownload: version => this.confirmUpdateDownload(version),
    showManualCheckResult: result => this.showManualUpdateCheckResult(result),
    downloadAndOpen: (update, signal) => this.downloadAndOpenUpdate(update, signal),
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

  constructor(
    private readonly restart: () => Promise<void>,
    private readonly onRendererBoot: (report: RendererBootReport) => void = () => {},
  ) {
    if (process.platform !== 'darwin' && process.platform !== 'win32' && process.platform !== 'linux') {
      throw new Error(`@e-mate/desktop: unsupported Electron platform ${process.platform}`)
    }
    this.platform = process.platform
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
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
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
  async openBrowserExtensionSetup(): Promise<void> {
    try {
      const spec = this.terminalSpec
      if (spec === undefined) throw new Error('@e-mate/desktop: browser extension profile is not configured')
      const manifest = join(spec.homeDir, 'browser-extension', 'manifest.json')
      if (!existsSync(manifest)) throw new Error(`browser extension is missing: ${manifest}`)

      shell.showItemInFolder(manifest)
      if (this.platform === 'darwin') {
        await this.spawnNative('/usr/bin/open', ['-a', 'Google Chrome', 'chrome://extensions'])
      } else if (this.platform === 'win32') {
        const chrome = [
          process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ].find((candidate): candidate is string => candidate !== undefined && existsSync(candidate))
        if (chrome === undefined) throw new Error('Google Chrome is not installed in a standard location')
        await this.spawnNative(chrome, ['--new-tab', 'chrome://extensions'])
      } else {
        throw new Error('browser extension setup is unavailable on this platform')
      }
      await dialog.showMessageBox({
        type: 'info',
        title: '加载 e-Mate 浏览器扩展',
        message: 'Chrome 扩展页和 e-Mate 扩展目录已打开',
        detail: '开启“开发者模式”，点击“加载已解压的扩展程序”，选择已打开的 browser-extension 文件夹。首次加载不需要填写地址或 Token。',
      })
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      process.stderr.write(`@e-mate/desktop: failed to open browser extension setup: ${error.message}\n`)
      dialog.showErrorBox('无法加载 e-Mate 浏览器扩展', error.message)
    }
  }

  /** @inheritdoc */
  reportRendererBoot(report: RendererBootReport): void {
    if (this.rendererBootReported) return
    this.rendererBootReported = true
    try {
      this.onRendererBoot(report)
    } catch (cause) {
      process.stderr.write(`@e-mate/desktop: failed to persist renderer boot health: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    }
    if (report.status === 'failed') {
      void this.showRendererBootRecovery(report).catch((cause: unknown) => {
        process.stderr.write(`@e-mate/desktop: failed to show plugin recovery: ${cause instanceof Error ? cause.message : String(cause)}\n`)
      })
    }
  }

  /** @inheritdoc */
  setThemeSource(source: DesktopThemeSource): void {
    if (this.scheduled !== undefined && this.window !== undefined) {
      nativeTheme.themeSource = source
    }
  }

  /** @inheritdoc */
  async requestRestart(): Promise<void> {
    await this.restart()
  }

  /** @inheritdoc */
  prepareToQuit(): void {
    this.quitting = true
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
      title: 'e-Mate Update Available',
      message: `e-Mate ${version} is available.`,
      detail: 'Download this update now?',
      buttons: ['Download', 'Later'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    return result.response === 0
  }

  /** Report one user-triggered check without exposing network or response details. */
  private async showManualUpdateCheckResult(result: UpdateCheckResult | null): Promise<void> {
    if (result === null) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Unable to Check for Updates',
        message: 'e-Mate could not check for updates.',
        detail: 'Please try again later.',
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
      })
      return
    }

    if (result.status === 'up-to-date') {
      await dialog.showMessageBox({
        type: 'info',
        title: 'e-Mate Is Up to Date',
        message: 'No newer version of e-Mate is available.',
        detail: `Installed version: ${result.currentVersion}`,
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
      })
      return
    }

    await dialog.showMessageBox({
      type: 'info',
      title: 'e-Mate Update Available',
      message: `e-Mate ${result.latestVersion} is available.`,
      detail: 'Installer downloads are unavailable in this build.',
      buttons: ['OK'],
      defaultId: 0,
      noLink: true,
    })
  }

  /** Download a confirmed installer and hand it to the native installation flow. */
  private async downloadAndOpenUpdate(
    update: Extract<UpdateCheckResult, { status: 'update-available' }>,
    signal: AbortSignal,
  ): Promise<void> {
    if (this.platform !== 'darwin' && this.platform !== 'win32') {
      throw new Error(`@e-mate/desktop: updates are unavailable on ${this.platform}`)
    }
    const artifactPath = await downloadDesktopUpdate({
      platform: this.platform,
      version: update.latestVersion,
      artifact: update.artifact,
      userDataPath: app.getPath('userData'),
      request: (url, init) => net.fetch(url, init),
      signal,
    })
    signal.throwIfAborted()

    if (this.platform === 'darwin') {
      const openError = await shell.openPath(artifactPath)
      if (openError !== '') throw new Error(`@e-mate/desktop: failed to open update disk image: ${openError}`)
      signal.throwIfAborted()
      await dialog.showMessageBox({
        type: 'info',
        title: 'e-Mate Update Downloaded',
        message: `e-Mate ${update.latestVersion} is ready to install.`,
        detail: 'The disk image has opened. Replace e-Mate in Applications, then reopen it.',
        buttons: ['OK'],
        defaultId: 0,
        noLink: true,
      })
      return
    }

    const result = await dialog.showMessageBox({
      type: 'info',
      title: 'e-Mate Update Downloaded',
      message: `e-Mate ${update.latestVersion} is ready to install.`,
      detail: 'Restart e-Mate and run the installer now?',
      buttons: ['Restart and Install', 'Later'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (result.response !== 0) return

    const spec = this.scheduled
    if (spec === undefined) throw new Error('@e-mate/desktop: no active shell can exit for update installation')
    signal.throwIfAborted()
    await this.launchWindowsUpdateInstaller(artifactPath)
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
          windowsHide: false,
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

  private async authorizedResourcePath(spec: DesktopShellSpec, resource: Extract<ResourceContext, { kind: 'file' }>): Promise<string> {
    if (!isAbsolute(resource.path) || !isAbsolute(resource.root) || resource.path.includes('\0') || resource.root.includes('\0')) {
      throw new Error('invalid resource path')
    }
    const allowedRoots = await Promise.all(spec.resourceRoots().map(async root => realpath(root).catch(() => undefined)))
    const root = await realpath(resource.root)
    if (!allowedRoots.includes(root)) throw new Error('resource workspace is not authorized')
    const path = await realpath(resource.path)
    if (!inside(root, path) || !(await lstat(path)).isFile()) throw new Error('resource is not a regular workspace file')
    return path
  }

  private async materializeImage(window: BrowserWindow, resource: Extract<ResourceContext, { kind: 'image' }>): Promise<string> {
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
    const mediaType = match[1]!
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

  private async resourcePath(
    window: BrowserWindow,
    spec: DesktopShellSpec,
    resource: ResourceContext,
  ): Promise<string> {
    return resource.kind === 'file'
      ? this.authorizedResourcePath(spec, resource)
      : this.materializeImage(window, resource)
  }

  private async runResourceAction(
    action: 'save-as' | 'copy-path' | 'copy-file' | 'open-with' | 'reveal',
    window: BrowserWindow,
    spec: DesktopShellSpec,
    resource: ResourceContext,
  ): Promise<void> {
    const path = await this.resourcePath(window, spec, resource)
    if (action === 'save-as') {
      const selected = await dialog.showSaveDialog({
        title: '另存为', defaultPath: join(app.getPath('downloads'), safeResourceName(resource.name, basename(path))),
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
    const window = new BrowserWindow(desktopWindowOptions(spec, icon, this.platform))
    window.accessibleTitle = spec.windowTitle
    if (this.platform === 'win32') window.removeMenu()
    this.window = window

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

    app.on('activate', show)
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
      app.off('activate', show)
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
      app.off('activate', show)
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
