import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProfileUpdateAvailable, ProfileUpdateContext } from '../src/profile-update.ts'
import type { DesktopShellSpec } from '../src/runtime.ts'

const updateAvailable = {
  status: 'update-available',
  currentVersion: '2.0.10',
  latestVersion: '2.1.0',
  sourceCommit: 'a'.repeat(40),
  baseContractId: 'e-mate-desktop-profile-v7',
  scheduleProtocolFloor: 1,
  manifestIdentity: 'b'.repeat(64),
  artifact: {
    url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v2.1.0/${'a'.repeat(40)}/e-Mate-2.1.0-mac-universal.dmg`,
    bytes: 1024,
    sha256: '0'.repeat(64),
  },
} as const

const windowsUpdateAvailable = {
  ...updateAvailable,
  artifact: {
    ...updateAvailable.artifact,
    url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v2.1.0/${'a'.repeat(40)}/e-Mate-2.1.0-win-x64-Setup.exe`,
  },
} as const

const terminal = vi.hoisted(() => ({ open: vi.fn() }))
const updater = vi.hoisted(() => ({ download: vi.fn() }))
const releaseChecker = vi.hoisted(() => ({ check: vi.fn() }))
const macUpdater = vi.hoisted(() => ({
  preflight: vi.fn(),
  schedule: vi.fn(),
  markShutdownReady: vi.fn(),
}))
const childProcess = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const listeners = new Map<string, Listener[]>()
  const child = {
    once: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return child
    }),
    off: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, (listeners.get(event) ?? []).filter(candidate => candidate !== listener))
      return child
    }),
    unref: vi.fn(),
  }
  return {
    child,
    emit(event: string, ...args: unknown[]) {
      const current = [...(listeners.get(event) ?? [])]
      listeners.delete(event)
      for (const listener of current) listener(...args)
    },
    reset() { listeners.clear() },
    spawn: vi.fn(() => child),
  }
})

vi.mock('../src/desktop-terminal.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/desktop-terminal.ts')>(),
  openDesktopTerminal: terminal.open,
}))

vi.mock('../src/update-download.ts', () => ({
  downloadDesktopUpdate: updater.download,
}))

vi.mock('../src/update-checker.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/update-checker.ts')>(),
  checkForStableUpdate: releaseChecker.check,
}))

vi.mock('../src/mac-update-installer.ts', () => ({
  preflightMacUpdateInstallation: macUpdater.preflight,
  scheduleMacUpdateInstallation: macUpdater.schedule,
}))

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: childProcess.spawn,
}))

const electron = vi.hoisted(() => {
  const browserWindowOptions: unknown[] = []
  const browserWindowThemeSources: string[] = []
  const browserWindows: BrowserWindow[] = []
  const browserWindowOn = vi.fn()
  const browserWindowOff = vi.fn()
  const loadURL = vi.fn(async (_url: string) => {})
  const menuTemplates: unknown[][] = []
  const menuPopups: Array<ReturnType<typeof vi.fn>> = []
  const notifications: Notification[] = []
  const dialog = {
    showErrorBox: vi.fn(),
    showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false })),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
    showSaveDialog: vi.fn(async (): Promise<{ canceled: boolean; filePath?: string }> => ({ canceled: true })),
  }
  const appIcon = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const templateIcon = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const blueIcon = {
    isEmpty: vi.fn(() => false),
    setTemplateImage: vi.fn(),
  }
  const webContents = {
    on: vi.fn(),
    off: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    executeJavaScript: vi.fn(async (): Promise<unknown> => null),
    copyImageAt: vi.fn(),
    send: vi.fn(),
  }
  const ipcMain = { on: vi.fn(), off: vi.fn(), handle: vi.fn(), removeHandler: vi.fn() }
  const nativeTheme = {
    themeSource: 'system',
    shouldUseDarkColors: false,
    on: vi.fn(),
    off: vi.fn(),
  }
  const systemPreferences = {
    isTrustedAccessibilityClient: vi.fn(() => false),
  }

  class BrowserWindow {
    readonly webContents = webContents
    accessibleTitle = ''

    constructor(options: unknown) {
      browserWindowOptions.push(options)
      browserWindowThemeSources.push(nativeTheme.themeSource)
      browserWindows.push(this)
    }

    readonly isDestroyed = vi.fn(() => false)
    readonly isMinimized = vi.fn(() => false)
    readonly restore = vi.fn()
    readonly show = vi.fn()
    readonly hide = vi.fn()
    readonly isVisible = vi.fn(() => this.show.mock.calls.length > 0)
    readonly focus = vi.fn()
    readonly on = browserWindowOn
    readonly off = browserWindowOff
    readonly once = vi.fn()
    readonly destroy = vi.fn()
    readonly loadURL = loadURL
    readonly removeMenu = vi.fn()
    readonly setTitleBarOverlay = vi.fn()
  }

  class Tray {
    readonly image: unknown
    readonly setToolTip = vi.fn()
    readonly setContextMenu = vi.fn()
    readonly on = vi.fn()
    readonly off = vi.fn()
    readonly destroy = vi.fn()

    constructor(image: unknown) {
      this.image = image
      trays.push(this)
    }
  }

  class Notification {
    static readonly isSupported = vi.fn(() => true)
    readonly once = vi.fn()
    readonly show = vi.fn()

    constructor(readonly options: unknown) {
      notifications.push(this)
    }
  }

  const trays: Tray[] = []
  const createFromPath = vi.fn((path: string) => {
    if (path.endsWith('app-icon.png')) return appIcon
    if (path.endsWith('tray-iconTemplate.png')) return templateIcon
    if (path.endsWith('tray-icon-blue.png')) return blueIcon
    throw new Error(`unexpected image path ${path}`)
  })

  return {
    app: {
      dock: { setIcon: vi.fn() },
      getPath: vi.fn((name: string): string => name === 'home' ? '/tmp/dsh-home' : '/tmp/dsh-desktop-user-data'),
      getVersion: vi.fn(() => '43.4.0'),
      isPackaged: false,
      on: vi.fn(),
      off: vi.fn(),
    },
    appIcon,
    blueIcon,
    BrowserWindow,
    browserWindowOptions,
    browserWindowThemeSources,
    browserWindows,
    browserWindowOff,
    browserWindowOn,
    loadURL,
    dialog,
    ipcMain,
    clipboard: { writeImage: vi.fn(), writeText: vi.fn() },
    Menu: {
      buildFromTemplate: vi.fn((template: unknown[]) => {
        menuTemplates.push(template)
        const popup = vi.fn()
        menuPopups.push(popup)
        return { popup }
      }),
    },
    webContents,
    menuTemplates,
    menuPopups,
    nativeImage: {
      createFromBuffer: vi.fn(() => ({ isEmpty: () => false })),
      createFromPath,
    },
    nativeTheme,
    net: { fetch: vi.fn() },
    Notification,
    notifications,
    shell: {
      openExternal: vi.fn(async () => {}),
      openPath: vi.fn(async () => ''),
      showItemInFolder: vi.fn(),
    },
    systemPreferences,
    templateIcon,
    Tray,
    trays,
  }
})

vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: electron.BrowserWindow,
  clipboard: electron.clipboard,
  dialog: electron.dialog,
  ipcMain: electron.ipcMain,
  Menu: electron.Menu,
  nativeImage: electron.nativeImage,
  nativeTheme: electron.nativeTheme,
  net: electron.net,
  Notification: electron.Notification,
  shell: electron.shell,
  systemPreferences: electron.systemPreferences,
  Tray: electron.Tray,
}))

const spec: DesktopShellSpec = {
  mode: 'compatibility',
  width: 1280,
  height: 840,
  minWidth: 900,
  minHeight: 640,
  url: 'http://127.0.0.1:43120/',
  productName: 'e-Mate',
  windowTitle: 'e-Mate',
  iconPath: '/tmp/app-icon.png',
  trayIcons: {
    templatePath: '/tmp/tray-iconTemplate.png',
    bluePath: '/tmp/tray-icon-blue.png',
  },
  readThemeSource: vi.fn(() => 'system' as const),
  resourceRoots: () => ['/tmp'],
  resourceSessionRoot: sessionId => sessionId === 'session-1' ? '/tmp' : undefined,
  requestQuit: () => {},
  requestModeChange: vi.fn(async () => {}),
}

describe('Electron compatibility runtime', () => {
  beforeEach(() => {
    electron.app.isPackaged = false
    electron.browserWindowOptions.length = 0
    electron.browserWindowThemeSources.length = 0
    electron.browserWindows.length = 0
    electron.trays.length = 0
    electron.menuTemplates.length = 0
    electron.menuPopups.length = 0
    electron.notifications.length = 0
    childProcess.reset()
    vi.clearAllMocks()
    updater.download.mockReset()
    releaseChecker.check.mockReset()
    releaseChecker.check.mockResolvedValue(updateAvailable)
    macUpdater.preflight.mockReset()
    macUpdater.schedule.mockReset()
    macUpdater.schedule.mockResolvedValue({ markShutdownReady: macUpdater.markShutdownReady })
    electron.loadURL.mockReset()
    electron.loadURL.mockResolvedValue(undefined)
    electron.dialog.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
    electron.dialog.showOpenDialog.mockReset()
    electron.dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    electron.shell.openPath.mockResolvedValue('')
    electron.systemPreferences.isTrustedAccessibilityClient.mockReturnValue(false)
    electron.nativeTheme.themeSource = 'system'
    electron.nativeTheme.shouldUseDarkColors = false
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fails closed when the selected Base Schedule package lacks native admission', async () => {
    const { loadClosedScheduleDeliveryAdmission } = await import('../src/electron-runtime.ts')
    const root = mkdtempSync(join(tmpdir(), 'e-mate-schedule-admission-'))
    const schedule = join(root, 'node_modules', '@deepseek-ai', 'dsh-schedule')
    try {
      mkdirSync(schedule, { recursive: true })
      writeFileSync(join(root, 'package.json'), '{}\n')
      writeFileSync(join(schedule, 'package.json'), '{"name":"@deepseek-ai/dsh-schedule","type":"module","main":"index.js"}\n')
      writeFileSync(join(schedule, 'index.js'), 'export const fixture = true\n')

      await expect(loadClosedScheduleDeliveryAdmission(pathToFileURL(join(root, 'package.json')).href))
        .rejects.toThrow('selected Base Schedule package has no delivery admission')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('uses the native macOS frame, Dock icon, and template tray image', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule(spec)

    expect(electron.browserWindowOptions).toHaveLength(0)
    await runtime.mountScheduled()

    expect(electron.browserWindowOptions).toHaveLength(1)
    const options = electron.browserWindowOptions[0]
    expect(options).toEqual(expect.objectContaining({
      title: '',
      width: 1280,
      height: 840,
      show: false,
      webPreferences: {
        preload: expect.stringMatching(/preload\.cjs$/),
        additionalArguments: [expect.stringMatching(/^--e-mate-desktop-bootstrap=/u)],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    }))
    expect(options).not.toHaveProperty('autoHideMenuBar')
    for (const option of [
      'frame',
      'titleBarStyle',
      'titleBarOverlay',
      'trafficLightPosition',
      'transparent',
      'vibrancy',
      'visualEffectState',
      'backgroundMaterial',
      'roundedCorners',
      'thickFrame',
    ]) {
      expect(options).not.toHaveProperty(option)
    }
    expect(electron.browserWindows[0]?.accessibleTitle).toBe('e-Mate')
    expect(spec.readThemeSource).toHaveBeenCalledOnce()
    expect(electron.nativeTheme.themeSource).toBe('system')
    expect(electron.browserWindows[0]?.removeMenu).not.toHaveBeenCalled()
    expect(electron.app.dock.setIcon).toHaveBeenCalledWith(electron.appIcon)
    expect(electron.templateIcon.setTemplateImage).toHaveBeenCalledWith(true)
    expect(electron.trays[0]?.image).toBe(electron.templateIcon)
    expect(electron.menuTemplates[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Quit' }),
    ]))
    expect(electron.menuTemplates[0]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: expect.stringContaining('Mode') }),
    ]))

    const contextMenuListener = electron.webContents.on.mock.calls.find(([event]) => event === 'context-menu')?.[1]
    expect(contextMenuListener).toEqual(expect.any(Function))
    contextMenuListener({}, {
      isEditable: false,
      selectionText: '可复制内容',
      editFlags: { canCut: false, canCopy: true, canPaste: false },
    })
    await vi.waitFor(() => { expect(electron.menuTemplates.at(-1)).toHaveLength(3) })
    expect(electron.menuTemplates.at(-1)).toEqual([
      expect.objectContaining({ role: 'copy', enabled: true }),
      expect.objectContaining({ type: 'separator' }),
      expect.objectContaining({ role: 'selectAll' }),
    ])
    expect(electron.menuPopups.at(-1)).toHaveBeenCalledWith({ window: electron.browserWindows[0] })

    electron.webContents.executeJavaScript.mockResolvedValueOnce({
      kind: 'file', name: '报告.docx', path: '/tmp/e-mate-workspace/报告.docx',
      root: '/tmp/e-mate-workspace', sessionId: 'session-1',
    })
    contextMenuListener({}, {
      x: 40,
      y: 80,
      isEditable: false,
      selectionText: '',
      editFlags: { canCut: false, canCopy: false, canPaste: false },
    })
    await vi.waitFor(() => {
      expect(electron.menuTemplates.at(-1)?.map(item => (item as { label?: string }).label).filter(Boolean))
        .toEqual(['另存为…', '复制路径', '复制文件内容', '打开方式', '在 Finder 中显示'])
    })
    const menuCount = electron.menuTemplates.length
    electron.webContents.executeJavaScript.mockResolvedValueOnce({ kind: 'handled' })
    contextMenuListener({}, {
      x: 40,
      y: 80,
      isEditable: false,
      selectionText: '',
      editFlags: { canCut: false, canCopy: false, canPaste: false },
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(electron.menuTemplates).toHaveLength(menuCount)

    const titleListener = electron.browserWindowOn.mock.calls.find(([event]) => event === 'page-title-updated')?.[1]
    expect(titleListener).toEqual(expect.any(Function))
    const titleEvent = { preventDefault: vi.fn() }
    titleListener(titleEvent)
    expect(titleEvent.preventDefault).toHaveBeenCalledOnce()

    await release()
    expect(electron.browserWindowOff).toHaveBeenCalledWith('page-title-updated', titleListener)
    expect(electron.webContents.off).toHaveBeenCalledWith('context-menu', contextMenuListener)
    expect(electron.trays[0]?.off).toHaveBeenCalledWith('click', expect.any(Function))
  })

  it('carries the one updater state through the existing Main and Preload boundary', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const cancel = vi.fn(() => true)
    const runInteractiveUpdate = vi.fn(async () => {})
    runtime.updates.publishState({ stage: 'checking', updateKind: 'base' })
    runtime.updates.setCancelHandler(cancel)
    runtime.updates.setInteractiveUpdateHandler(runInteractiveUpdate)
    const release = runtime.schedule(spec)

    await runtime.mountScheduled()
    const read = electron.ipcMain.on.mock.calls.find(([channel]) => channel === 'emate:desktop-update-state-read')?.[1]
    const requestCancel = electron.ipcMain.on.mock.calls.find(([channel]) => channel === 'emate:desktop-update-cancel')?.[1]
    const requestUpdate = electron.ipcMain.handle.mock.calls.find(([channel]) => channel === 'emate:desktop-update-run-interactive')?.[1]
    const runResource = electron.ipcMain.handle.mock.calls.find(([channel]) => channel === 'emate:desktop-resource-run')?.[1]
    expect(read).toEqual(expect.any(Function))
    expect(requestCancel).toEqual(expect.any(Function))
    expect(requestUpdate).toEqual(expect.any(Function))
    expect(runResource).toEqual(expect.any(Function))
    const readEvent = { sender: electron.webContents, returnValue: undefined as unknown }
    read(readEvent)
    expect(readEvent.returnValue).toEqual({ stage: 'checking', updateKind: 'base' })

    runtime.updates.publishState({ stage: 'downloading', bytes: 5, total: 10 })
    expect(electron.webContents.send).toHaveBeenCalledWith(
      'emate:desktop-update-state-changed',
      { stage: 'downloading', bytes: 5, total: 10 },
    )
    const cancelEvent = { sender: electron.webContents, returnValue: undefined as unknown }
    requestCancel(cancelEvent)
    expect(cancelEvent.returnValue).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    await expect(requestUpdate({ sender: electron.webContents })).resolves.toBeUndefined()
    expect(runInteractiveUpdate).toHaveBeenCalledOnce()
    await expect(requestUpdate({ sender: {} })).rejects.toThrow('update request did not originate from owning Renderer')

    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    electron.webContents.executeJavaScript.mockResolvedValueOnce(`data:image/png;base64,${png.toString('base64')}`)
    await expect(runResource({ sender: electron.webContents }, {
      action: 'copy-image',
      resource: { kind: 'image', sessionId: 'session-1', name: 'result.png', src: 'blob:result' },
    })).resolves.toBeUndefined()
    expect(electron.nativeImage.createFromBuffer).toHaveBeenCalledWith(png)
    expect(electron.clipboard.writeImage).toHaveBeenCalledOnce()
    await expect(runResource({ sender: {} }, {
      action: 'copy-image',
      resource: { kind: 'image', sessionId: 'session-1', name: 'result.png', src: 'blob:result' },
    })).rejects.toThrow('resource request did not originate from owning Renderer')
    await expect(runResource({ sender: electron.webContents }, { action: 'unknown' }))
      .rejects.toThrow('invalid resource request')
    electron.webContents.executeJavaScript.mockResolvedValueOnce(`data:image/png;base64,${png.toString('base64')}`)
    await expect(runResource({ sender: electron.webContents }, {
      action: 'copy-image',
      resource: { kind: 'image', sessionId: 'missing', name: 'result.png', src: 'blob:result' },
    })).resolves.toBeUndefined()
    electron.webContents.executeJavaScript.mockResolvedValueOnce(`data:image/jpeg;base64,${png.toString('base64')}`)
    await expect(runResource({ sender: electron.webContents }, {
      action: 'copy-image',
      resource: { kind: 'image', sessionId: 'session-1', name: 'result.jpg', src: 'blob:result' },
    })).rejects.toThrow('image type does not match its bytes')
    electron.webContents.executeJavaScript.mockRejectedValueOnce(new Error('image-too-large'))
    await expect(runResource({ sender: electron.webContents }, {
      action: 'copy-image',
      resource: { kind: 'image', sessionId: 'session-1', name: 'result.png', src: 'blob:result' },
    })).rejects.toThrow('image-too-large')

    await release()
    expect(electron.ipcMain.off).toHaveBeenCalledWith('emate:desktop-update-state-read', read)
    expect(electron.ipcMain.off).toHaveBeenCalledWith('emate:desktop-update-cancel', requestCancel)
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith('emate:desktop-update-run-interactive')
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith('emate:desktop-resource-run')
  })

  it('removes the Renderer update carrier when window mounting fails', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    electron.loadURL.mockRejectedValueOnce(new Error('renderer unavailable'))
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule(spec)

    await expect(runtime.mountScheduled()).rejects.toThrow('renderer unavailable')
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith('emate:desktop-update-run-interactive')
    expect(electron.ipcMain.removeHandler).toHaveBeenCalledWith('emate:desktop-resource-run')
    await expect(release()).rejects.toThrow('renderer unavailable')
  })

  it('fences every file action to the live session workspace and rejects path escape', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const root = mkdtempSync(join(tmpdir(), 'e-mate-resource-root-'))
    const outside = mkdtempSync(join(tmpdir(), 'e-mate-resource-outside-'))
    const source = join(root, '报告.txt')
    const copied = join(root, '报告-copy.txt')
    const outsideFile = join(outside, 'outside.txt')
    const escape = join(root, 'escape.txt')
    writeFileSync(source, 'artifact bytes')
    writeFileSync(outsideFile, 'outside bytes')
    symlinkSync(outsideFile, escape)
    try {
      const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
      const runtime = new ElectronDesktopRuntime(async () => {})
      const release = runtime.schedule({
        ...spec,
        resourceRoots: () => [root],
        resourceSessionRoot: sessionId => sessionId === 'session-files' ? root : undefined,
      })
      await runtime.mountScheduled()
      const runResource = electron.ipcMain.handle.mock.calls.find(([channel]) => channel === 'emate:desktop-resource-run')?.[1]
      const resource = { kind: 'file', sessionId: 'session-files', root, path: source }

      await runResource({ sender: electron.webContents }, { action: 'copy-path', resource })
      expect(electron.clipboard.writeText).toHaveBeenCalledWith(realpathSync(source))
      await runResource({ sender: electron.webContents }, { action: 'reveal', resource })
      expect(electron.shell.showItemInFolder).toHaveBeenCalledWith(realpathSync(source))

      electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: copied })
      await runResource({ sender: electron.webContents }, { action: 'save-as', resource })
      expect(readFileSync(copied, 'utf8')).toBe('artifact bytes')

      electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Applications/Preview.app'] })
      const opening = runResource({ sender: electron.webContents }, { action: 'open-with', resource })
      await vi.waitFor(() => { expect(childProcess.spawn).toHaveBeenCalledWith(
        '/usr/bin/open', ['-a', '/Applications/Preview.app', '--', realpathSync(source)], expect.any(Object),
      ) })
      childProcess.emit('spawn')
      await opening

      const copying = runResource({ sender: electron.webContents }, { action: 'copy-file', resource })
      await vi.waitFor(() => { expect(childProcess.spawn).toHaveBeenLastCalledWith(
        '/usr/bin/osascript', expect.any(Array), expect.objectContaining({
          env: expect.objectContaining({ E_MATE_COPY_PATH: realpathSync(source) }),
        }),
      ) })
      childProcess.emit('spawn')
      await copying

      await expect(runResource({ sender: electron.webContents }, {
        action: 'reveal', resource: { ...resource, sessionId: 'missing' },
      })).rejects.toThrow('resource session is not active')
      await expect(runResource({ sender: electron.webContents }, {
        action: 'reveal', resource: { ...resource, root: outside, path: outsideFile },
      })).rejects.toThrow('resource workspace does not match its session')
      await expect(runResource({ sender: electron.webContents }, {
        action: 'reveal', resource: { ...resource, path: escape },
      })).rejects.toThrow('resource is not a regular workspace file')
      await expect(runResource({ sender: electron.webContents }, {
        action: 'reveal', resource: { ...resource, path: join(root, 'missing.txt') },
      })).rejects.toThrow()
      await expect(runResource({ sender: electron.webContents }, {
        action: 'reveal', resource: { ...resource, path: root },
      })).rejects.toThrow('resource is not a regular workspace file')

      await release()
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('keeps historical child image actions renderer-scoped and materializes only for download or reveal', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const root = mkdtempSync(join(tmpdir(), 'e-mate-image-resource-'))
    const originalGetPath = electron.app.getPath.getMockImplementation()
    electron.app.getPath.mockImplementation(() => root)
    try {
      const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
      const runtime = new ElectronDesktopRuntime(async () => {})
      const release = runtime.schedule({
        ...spec,
        resourceRoots: () => [root],
        resourceSessionRoot: () => undefined,
      })
      await runtime.mountScheduled()
      const runResource = electron.ipcMain.handle.mock.calls.find(([channel]) => channel === 'emate:desktop-resource-run')?.[1]
      const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      const response = `data:image/png;base64,${bytes.toString('base64')}`
      const resource = {
        kind: 'image', sessionId: 'disposed-child', name: 'result.png', src: 'blob:result',
      }

      electron.webContents.executeJavaScript.mockResolvedValueOnce(response)
      await runResource({ sender: electron.webContents }, { action: 'copy-image', resource })
      expect(electron.clipboard.writeImage).toHaveBeenCalledOnce()
      expect(existsSync(join(root, 'e-mate-resources'))).toBe(false)

      electron.webContents.executeJavaScript.mockResolvedValueOnce(response)
      await runResource({ sender: electron.webContents }, { action: 'reveal', resource })
      const revealed = electron.shell.showItemInFolder.mock.calls.at(-1)?.[0]
      expect(readFileSync(revealed)).toEqual(bytes)

      const copy = join(root, 'downloaded.png')
      electron.dialog.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: copy })
      electron.webContents.executeJavaScript.mockResolvedValueOnce(response)
      await runResource({ sender: electron.webContents }, { action: 'save-as', resource })
      expect(readFileSync(copy)).toEqual(bytes)

      await release()
    } finally {
      electron.app.getPath.mockImplementation(originalGetPath!)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps the compatibility frame synchronized with the e-Mate theme', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    electron.nativeTheme.themeSource = 'light'
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule({ ...spec, readThemeSource: () => 'dark' })

    await runtime.mountScheduled()
    expect(electron.browserWindowThemeSources).toEqual(['dark'])
    expect(electron.nativeTheme.themeSource).toBe('dark')

    runtime.setThemeSource('light')
    expect(electron.nativeTheme.themeSource).toBe('light')
    await release()
    expect(electron.nativeTheme.themeSource).toBe('light')
  })

  it('uses the Windows caption, hidden menu bar, removed menu, and fixed brand tray image', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule(spec)

    await runtime.mountScheduled()

    expect(electron.browserWindowOptions[0]).toEqual(expect.objectContaining({
      title: 'e-Mate',
      autoHideMenuBar: true,
    }))
    expect(electron.browserWindows[0]?.accessibleTitle).toBe('e-Mate')
    expect(electron.browserWindows[0]?.removeMenu).toHaveBeenCalledOnce()
    expect(electron.app.dock.setIcon).not.toHaveBeenCalled()
    expect(electron.trays[0]?.image).toBe(electron.blueIcon)
    expect(electron.templateIcon.setTemplateImage).not.toHaveBeenCalled()

    await release()
    expect(electron.trays[0]?.off).toHaveBeenCalledWith('click', expect.any(Function))
  })

  it('opens one parented Windows folder chooser and returns its selected path', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    electron.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\Work'] })
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()

    await expect(runtime.pickDirectory()).resolves.toBe('C:\\Work')
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith(
      electron.browserWindows[0],
      {
        title: '选择工作区目录',
        properties: ['openDirectory', 'dontAddToRecent'],
      },
    )

    await release()
  })

  it('single-flights one Windows chooser and opens a new generation after cancellation or failure', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    let resolveDialog!: (result: { canceled: boolean; filePaths: string[] }) => void
    electron.dialog.showOpenDialog.mockReturnValue(
      new Promise(resolve => { resolveDialog = resolve }),
    )
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()

    const first = runtime.pickDirectory()
    const repeated = runtime.pickDirectory()
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledOnce()
    resolveDialog({ canceled: true, filePaths: [] })
    await expect(Promise.all([first, repeated])).resolves.toEqual([null, null])

    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\Next'] })
    await expect(runtime.pickDirectory()).resolves.toBe('C:\\Next')
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledTimes(2)

    electron.dialog.showOpenDialog.mockRejectedValueOnce(new Error('dialog unavailable'))
    await expect(runtime.pickDirectory()).rejects.toThrow('dialog unavailable')
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\Recovered'] })
    await expect(runtime.pickDirectory()).resolves.toBe('C:\\Recovered')
    expect(electron.dialog.showOpenDialog).toHaveBeenCalledTimes(4)

    await release()
  })

  it('does not mount a registration disposed before Host boot settles', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule(spec)

    await release()

    await expect(runtime.mountScheduled()).rejects.toThrow(
      'the Cordis shell plugin did not register a window',
    )
    expect(electron.browserWindowOptions).toHaveLength(0)
  })

  it('keeps tray commands unavailable until the Web surface loads and startup commits', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    let finishLoad!: () => void
    electron.loadURL.mockImplementationOnce(() => new Promise<void>((resolve) => { finishLoad = resolve }))
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule(spec)
    const beforeInteractive = vi.fn(() => {
      expect(electron.trays).toHaveLength(1)
    })

    const mounted = runtime.mountScheduled(beforeInteractive)
    await vi.waitFor(() => { expect(electron.loadURL).toHaveBeenCalledOnce() })
    expect(electron.trays).toHaveLength(0)
    expect(beforeInteractive).not.toHaveBeenCalled()

    finishLoad()
    await mounted
    expect(beforeInteractive).toHaveBeenCalledOnce()
    expect(electron.trays).toHaveLength(1)

    await release()
  })

  it('does not expose a shell mode tray command', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const requestModeChange = vi.fn(async () => {})
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule({ ...spec, requestModeChange })

    await runtime.mountScheduled()
    const labels = (electron.menuTemplates[0] as Array<{ label?: string }>).map(item => item.label)
    expect(labels).not.toContain('Switch to Advanced Mode')
    expect(labels).not.toContain('Switch to Compatibility Mode')
    expect(requestModeChange).not.toHaveBeenCalled()

    await release()
  })

  it('rebuilds ordered effect-scoped tray contributions without replacing native commands', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const later = runtime.registerTrayItem({
      group: 'tools',
      order: 20,
      label: () => 'Later Tool',
      invoke: vi.fn(),
    })
    let statusLabel = 'Check for Updates…'
    const status = runtime.registerTrayItem({
      group: 'status',
      order: 10,
      label: () => statusLabel,
      enabled: () => false,
      invoke: vi.fn(),
    })
    const earlier = runtime.registerTrayItem({
      group: 'tools',
      order: 10,
      label: () => 'Earlier Tool',
      invoke: vi.fn(),
    })
    const release = runtime.schedule(spec)

    await runtime.mountScheduled()

    const labels = (electron.menuTemplates.at(-1) as Array<{ label?: string }>).map(item => item.label)
    expect(labels).toEqual([
      'Open e-Mate', undefined,
      'Earlier Tool', 'Later Tool', undefined,
      'Check for Updates…', undefined,
      'Quit',
    ])
    expect(electron.menuTemplates.at(-1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Check for Updates…', enabled: false }),
    ]))

    statusLabel = 'Version 2.1.0 Available'
    status.refresh()
    expect(electron.menuTemplates.at(-1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Version 2.1.0 Available', enabled: false }),
    ]))

    earlier.dispose()
    later.dispose()
    status.dispose()
    expect(electron.menuTemplates.at(-1)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Earlier Tool' }),
    ]))

    await release()
  })

  it('renders contributed radio submenus in their own profile section', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const invoke = vi.fn()
    const runtime = new ElectronDesktopRuntime(async () => {})
    runtime.registerTrayItem({
      group: 'profiles',
      order: 10,
      label: () => 'Profile: desktop',
      invoke: () => {},
      submenu: () => [{
        label: () => 'web',
        type: 'radio',
        checked: () => false,
        enabled: () => true,
        invoke,
      }],
    })
    const release = runtime.schedule(spec)

    await runtime.mountScheduled()

    const profile = (electron.menuTemplates.at(-1) as Array<{
      label?: string
      submenu?: Array<{ label?: string, type?: string, checked?: boolean, click?: () => void }>
    }>).find(item => item.label === 'Profile: desktop')
    expect(profile?.submenu).toEqual([
      expect.objectContaining({ label: 'web', type: 'radio', checked: false }),
    ])
    profile?.submenu?.[0]?.click?.()
    await vi.waitFor(() => { expect(invoke).toHaveBeenCalledOnce() })

    await release()
  })

  it('opens the active profile through the packaged terminal adapter', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    Object.defineProperty(process.versions, 'electron', {
      configurable: true,
      value: '43.4.0',
    })
    try {
      const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
      const runtime = new ElectronDesktopRuntime(async () => {})
      runtime.configureTerminal({
        profileName: 'desktop',
        profileDir: '/tmp/dsh-home/profiles/desktop',
        homeDir: '/tmp/dsh-home',
      })

      runtime.openTerminal()

      expect(terminal.open).toHaveBeenCalledWith(expect.objectContaining({
        platform: 'darwin',
        appExecutable: process.execPath,
        electronVersion: '43.4.0',
        profileName: 'desktop',
        productVersion: '2.0.15',
        profileDir: '/tmp/dsh-home/profiles/desktop',
        homeDir: '/tmp/dsh-home',
        spawn: expect.any(Function),
        onLaunchError: expect.any(Function),
      }))
      const terminalOptions = terminal.open.mock.calls[0]?.[0]
      expect(terminalOptions.dshBootstrapPath.endsWith(join('src', 'desktop-cli.js'))).toBe(true)
      expect(terminalOptions.pnpmBinPath.endsWith(join('node_modules', 'pnpm', 'bin', 'pnpm.mjs'))).toBe(true)
      expect(dirname(terminalOptions.stateDir)).toBe(join('/tmp/dsh-desktop-user-data', 'cli'))
      expect(basename(terminalOptions.stateDir)).toMatch(/^[a-f0-9]{64}$/u)
      expect(() => runtime.configureTerminal({
        profileName: 'desktop',
        profileDir: '/other',
        homeDir: '/other',
      })).toThrow('already configured')
    } finally {
      delete (process.versions as { electron?: string }).electron
    }
  })

  it('shows native errors for synchronous and asynchronous terminal launch failures', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    Object.defineProperty(process.versions, 'electron', {
      configurable: true,
      value: '43.4.0',
    })
    try {
      const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
      const runtime = new ElectronDesktopRuntime(async () => {})
      runtime.configureTerminal({
        profileName: 'desktop',
        profileDir: 'C:\\Users\\Example\\.dsh\\profiles\\desktop',
        homeDir: 'C:\\Users\\Example\\.dsh',
      })
      terminal.open.mockImplementationOnce(() => { throw new Error('cannot create launcher') })

      expect(() => { runtime.openTerminal() }).not.toThrow()
      expect(electron.dialog.showErrorBox).toHaveBeenCalledWith(
        'Unable to Open DSH Terminal',
        'cannot create launcher',
      )

      terminal.open.mockImplementationOnce((options: { onLaunchError: (cause: Error) => void }) => {
        options.onLaunchError(new Error('launcher exited with code 1'))
      })
      runtime.openTerminal()
      expect(electron.dialog.showErrorBox).toHaveBeenLastCalledWith(
        'Unable to Open DSH Terminal',
        'launcher exited with code 1',
      )
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('failed to open terminal'))
    } finally {
      delete (process.versions as { electron?: string }).electron
    }
  })

  it('shows native recovery when the renderer Loader reports a failed plugin', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 2, checkboxChecked: false })
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const onRendererBoot = vi.fn()
    const runtime = new ElectronDesktopRuntime(async () => {}, onRendererBoot)
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()
    const report = {
      status: 'failed' as const,
      plugins: ['dsh-vision-router'],
      error: 'keyed slot "tool.call.toolview" already has an entry for key "vision_crop" at priority 0',
    }

    runtime.reportRendererBoot(report)
    await vi.waitFor(() => { expect(electron.dialog.showMessageBox).toHaveBeenCalledOnce() })
    runtime.reportRendererBoot({ status: 'healthy' })

    expect(onRendererBoot).toHaveBeenCalledWith(report)
    expect(onRendererBoot).toHaveBeenCalledOnce()
    expect(electron.dialog.showMessageBox).toHaveBeenCalledOnce()
    expect(electron.dialog.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      title: 'Plugin Recovery',
      message: 'e-Mate could not load all plugins.',
      detail: expect.stringContaining('dsh-vision-router'),
      buttons: ['Open DSH Terminal', 'Restart e-Mate', 'Dismiss'],
    }))
    const recoveryCalls = electron.dialog.showMessageBox.mock.calls as unknown as Array<[{ detail?: string }]>
    expect(recoveryCalls[0]?.[0].detail).toContain('vision_crop')
    expect(electron.browserWindows[0]?.show).not.toHaveBeenCalled()
    await release()
  })

  it('shows an ordinary healthy renderer exactly once', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const onRendererBoot = vi.fn()
    const runtime = new ElectronDesktopRuntime(async () => {}, onRendererBoot)
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()
    const window = electron.browserWindows[0]
    const ready = window?.once.mock.calls.find(([event]) => event === 'ready-to-show')?.[1]
    expect(ready).toEqual(expect.any(Function))

    ready()
    runtime.show()
    expect(window?.show).not.toHaveBeenCalled()

    runtime.reportRendererBoot({ status: 'healthy' })

    expect(onRendererBoot).toHaveBeenCalledWith({ status: 'healthy' })
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled()
    expect(window?.show).toHaveBeenCalledOnce()
    expect(window?.focus).toHaveBeenCalledOnce()
    await release()
  })

  it('keeps a macOS update probation window hidden after renderer health', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {}, () => {}, true)
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()
    const window = electron.browserWindows[0]

    runtime.reportRendererBoot({ status: 'healthy' })

    expect(window?.show).not.toHaveBeenCalled()
    expect(window?.focus).not.toHaveBeenCalled()
    await release()
  })

  it('does not acknowledge probation when the Schedule latch is missing', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {}, () => {}, true)
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()
    const window = electron.browserWindows[0]
    const acknowledge = vi.fn()
    runtime.reportRendererBoot({ status: 'healthy' })

    await expect(runtime.commitRendererStartup(acknowledge))
      .rejects.toThrow('Schedule startup latch is not configured')

    expect(acknowledge).not.toHaveBeenCalled()
    expect(window?.show).not.toHaveBeenCalled()
    await release()
  })

  it('does not acknowledge probation when its window is already unavailable', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {}, () => {}, true)
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()
    const window = electron.browserWindows[0]
    const acknowledge = vi.fn()
    runtime.configureScheduleStartupLatch(() => {})
    window?.isDestroyed.mockReturnValue(true)
    runtime.reportRendererBoot({ status: 'healthy' })

    await expect(runtime.commitRendererStartup(acknowledge))
      .rejects.toThrow('macOS update window is unavailable')

    expect(acknowledge).not.toHaveBeenCalled()
    expect(window?.show).not.toHaveBeenCalled()
    await release()
  })

  it('shows a healthy macOS update only after its startup acknowledgement commits', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {}, () => {}, true)
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()
    const window = electron.browserWindows[0]
    const ready = window?.once.mock.calls.find(([event]) => event === 'ready-to-show')?.[1]
    const events: string[] = []
    window?.show.mockImplementationOnce(() => { events.push('show') })
    runtime.configureScheduleStartupLatch(() => { events.push('open-schedule') })
    const acknowledge = vi.fn(() => {
      events.push('ack')
      return async () => { events.push('applied') }
    })
    const duplicate = vi.fn()
    runtime.reportRendererBoot({ status: 'healthy' })

    await runtime.commitRendererStartup(acknowledge)
    await runtime.commitRendererStartup(duplicate)
    ready()

    expect(acknowledge).toHaveBeenCalledOnce()
    expect(duplicate).not.toHaveBeenCalled()
    expect(events).toEqual(['ack', 'show', 'open-schedule', 'applied'])
    expect(window?.show).toHaveBeenCalledOnce()
    expect(window?.focus).toHaveBeenCalledTimes(2)
    await release()
  })

  it('rejects a failed macOS startup acknowledgement without showing the probation window', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {}, () => {}, true)
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()
    const window = electron.browserWindows[0]
    runtime.configureScheduleStartupLatch(() => {})
    runtime.reportRendererBoot({ status: 'healthy' })

    await expect(runtime.commitRendererStartup(() => { throw new Error('ack write failed') }))
      .rejects.toThrow('ack write failed')
    runtime.show()
    expect(window?.show).not.toHaveBeenCalled()
    expect(window?.focus).not.toHaveBeenCalled()
    await release()
  })

  it('rechecks the same probation window after acknowledgement before opening Schedule', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {}, () => {}, true)
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()
    const window = electron.browserWindows[0]
    const openSchedule = vi.fn()
    const applied = vi.fn()
    runtime.configureScheduleStartupLatch(openSchedule)
    runtime.reportRendererBoot({ status: 'healthy' })

    await expect(runtime.commitRendererStartup(() => {
      window?.isDestroyed.mockReturnValue(true)
      return applied
    })).rejects.toThrow('macOS update window became unavailable during commit')

    expect(openSchedule).not.toHaveBeenCalled()
    expect(applied).not.toHaveBeenCalled()
    expect(window?.show).not.toHaveBeenCalled()
    await release()
  })

  it('binds the same Schedule latch idempotently and rejects a different owner', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {}, () => {}, true)
    const open = vi.fn()

    runtime.configureScheduleStartupLatch(open)

    expect(() => { runtime.configureScheduleStartupLatch(open) }).not.toThrow()
    expect(() => { runtime.configureScheduleStartupLatch(() => {}) })
      .toThrow('Schedule startup latch is already configured')
  })

  it('does not pretend to reclose probation when commit-applied IPC fails after Schedule opens', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {}, () => {}, true)
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()
    const window = electron.browserWindows[0]
    const events: string[] = []
    window?.show.mockImplementationOnce(() => { events.push('show') })
    runtime.configureScheduleStartupLatch(() => { events.push('open-schedule') })
    runtime.reportRendererBoot({ status: 'healthy' })

    await expect(runtime.commitRendererStartup(async () => async () => {
      events.push('applied')
      throw new Error('commit-applied IPC failed')
    })).rejects.toThrow('commit-applied IPC failed')

    expect(events).toEqual(['show', 'open-schedule', 'applied'])
    expect(window?.hide).not.toHaveBeenCalled()
    runtime.show()
    expect(window?.show).toHaveBeenCalledOnce()
    expect(window?.focus).toHaveBeenCalledTimes(2)
    await release()
  })

  it('keeps macOS probation hidden until asynchronous IPC confirmation settles', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {}, () => {}, true)
    const release = runtime.schedule(spec)
    await runtime.mountScheduled()
    const window = electron.browserWindows[0]
    let confirm!: () => void
    const confirmed = new Promise<void>(resolve => { confirm = resolve })
    const openSchedule = vi.fn()
    const duplicate = vi.fn()
    runtime.configureScheduleStartupLatch(openSchedule)
    runtime.reportRendererBoot({ status: 'healthy' })

    const commit = runtime.commitRendererStartup(async () => { await confirmed })
    const repeated = runtime.commitRendererStartup(duplicate)
    await Promise.resolve()
    expect(window?.show).not.toHaveBeenCalled()
    expect(window?.focus).not.toHaveBeenCalled()

    confirm()
    await Promise.all([commit, repeated])
    expect(duplicate).not.toHaveBeenCalled()
    expect(openSchedule).toHaveBeenCalledOnce()
    expect(window?.show).toHaveBeenCalledOnce()
    expect(window?.focus).toHaveBeenCalledOnce()
    await release()
  })

  it('does not block a release probe on the interactive recovery dialog', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const previous = process.env.EMATE_RELEASE_HEALTH_PROBE
    process.env.EMATE_RELEASE_HEALTH_PROBE = '1'
    try {
      const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
      const onRendererBoot = vi.fn()
      const runtime = new ElectronDesktopRuntime(async () => {}, onRendererBoot)
      const report = { status: 'failed' as const, plugins: ['broken-client'] }

      runtime.reportRendererBoot(report)

      expect(onRendererBoot).toHaveBeenCalledWith(report)
      expect(electron.dialog.showMessageBox).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete process.env.EMATE_RELEASE_HEALTH_PROBE
      else process.env.EMATE_RELEASE_HEALTH_PROBE = previous
    }
  })

  it('fails a renderer generation that never reports boot health', async () => {
    vi.useFakeTimers()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const onRendererBoot = vi.fn()
    const runtime = new ElectronDesktopRuntime(async () => {}, onRendererBoot)

    runtime.beginRendererBootMonitoring(25)
    await vi.advanceTimersByTimeAsync(25)

    expect(runtime.rendererBootFailureReason).toBe('renderer-timeout')
    expect(onRendererBoot).toHaveBeenCalledOnce()
    expect(onRendererBoot).toHaveBeenCalledWith({
      status: 'failed',
      plugins: [],
      error: 'The Renderer did not report boot health within 25ms.',
    })
  })

  it('cancels the renderer deadline after the first healthy report', async () => {
    vi.useFakeTimers()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const onRendererBoot = vi.fn()
    const runtime = new ElectronDesktopRuntime(async () => {}, onRendererBoot)

    runtime.beginRendererBootMonitoring(25)
    runtime.reportRendererBoot({ status: 'healthy' })
    await vi.advanceTimersByTimeAsync(25)

    expect(runtime.rendererBootFailureReason).toBeUndefined()
    expect(onRendererBoot).toHaveBeenCalledOnce()
    expect(onRendererBoot).toHaveBeenCalledWith({ status: 'healthy' })
  })

  it('opens the active profile terminal from plugin recovery', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    Object.defineProperty(process.versions, 'electron', {
      configurable: true,
      value: '43.4.0',
    })
    try {
      const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
      const runtime = new ElectronDesktopRuntime(async () => {})
      runtime.configureTerminal({
        profileName: 'desktop',
        profileDir: 'C:\\Users\\Example\\.dsh\\profiles\\desktop',
        homeDir: 'C:\\Users\\Example\\.dsh',
      })

      runtime.reportRendererBoot({ status: 'failed', plugins: ['dsh-vision-router'] })
      await vi.waitFor(() => { expect(terminal.open).toHaveBeenCalledOnce() })

      expect(terminal.open).toHaveBeenCalledWith(expect.objectContaining({
        profileName: 'desktop',
        profileDir: 'C:\\Users\\Example\\.dsh\\profiles\\desktop',
      }))
    } finally {
      delete (process.versions as { electron?: string }).electron
    }
  })

  it('requests an orderly restart from plugin recovery', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const restart = vi.fn(async () => {})
    const runtime = new ElectronDesktopRuntime(restart)

    runtime.reportRendererBoot({ status: 'failed', plugins: ['dsh-vision-router'] })
    await vi.waitFor(() => { expect(restart).toHaveBeenCalledOnce() })
  })

  it.each([
    {
      changedComponents: [] as ProfileUpdateAvailable['changedComponents'],
      downloadBytes: 0,
      expectedSummary: '本次仅更新发布回执，无需下载新的能力文件。',
      expectedBytes: '0 B',
    },
    {
      changedComponents: [
        { id: '@e-mate/dsh-plugin-private', version: '2.0.13', bytes: 2048 },
        { id: 'component.id', version: '2.0.13', bytes: 2048 },
      ],
      downloadBytes: 4096,
      expectedSummary: '本次包含 2 项办公能力与体验优化。',
      expectedBytes: '4.0 KiB',
    },
  ])('shows a user-facing signed update confirmation without internal identities: %#', async ({
    changedComponents,
    downloadBytes,
    expectedSummary,
    expectedBytes,
  }) => {
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const update = {
      status: 'update-available',
      currentGeneration: 'previous',
      currentSequence: 2,
      generationId: 'a'.repeat(64),
      releaseVersion: '2.0.13',
      sequence: 3,
      changedComponents,
      downloadBytes,
      release: {},
    } as unknown as ProfileUpdateAvailable
    const confirm = (runtime as unknown as {
      confirmProfileUpdate(update: ProfileUpdateAvailable): Promise<boolean>
    }).confirmProfileUpdate.bind(runtime)

    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await expect(confirm(update)).resolves.toBe(false)
    const dialogCall = (electron.dialog.showMessageBox.mock.calls as unknown as Array<[{
      title: string
      message: string
      detail: string
    }]>).at(-1)![0]
    expect(dialogCall).toEqual(expect.objectContaining({
      title: '发现 e-Mate 更新',
      message: 'e-Mate 2.0.13 第 3 代已可更新。',
      detail: expect.stringContaining(`${expectedSummary}\n\n下载大小：${expectedBytes}`),
      buttons: ['更新并重启', '稍后'],
    }))
    expect(dialogCall.detail).toContain('原子切换')
    expect(dialogCall.detail).toContain('自动回滚')
    expect([dialogCall.title, dialogCall.message, dialogCall.detail].join('\n'))
      .not.toMatch(/@e-mate\/|dsh-plugin|component\.id|插件|组件/u)
  })

  it('uses Electron networking and confirmation-gated macOS replacement', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const response = Response.json({ version: '2.1.0' })
    electron.net.fetch.mockResolvedValueOnce(response)
    updater.download.mockImplementationOnce(async (options: { onProgress?: (value: unknown) => void }) => {
      options.onProgress?.({ bytes: 512, total: 1024 })
      return '/tmp/e-Mate-2.1.0-mac.dmg'
    })
    const requestQuit = vi.fn()
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    runtime.schedule({ ...spec, requestQuit })

    await expect(runtime.updates.request('https://dl.ecoremedia.net/ecorex-agent/e-mate/desktop/latest.json', { method: 'GET' }))
      .resolves.toBe(response)
    expect(runtime.updates).toMatchObject({
      isPackaged: false,
      canDownload: false,
      currentVersion: '2.0.15',
      currentScheduleProtocolFloor: 0,
      trustedManifestKeys: [],
      statePath: join('/tmp/dsh-desktop-user-data', 'updates', 'state.json'),
    })
    runtime.configureProfileUpdates({
      base: {
        schedule_protocol_floor: 1,
        profile_signing_keys: [{
          id: 'release-key',
          algorithm: 'ed25519',
          public_key_spki_der_base64: 'test-public-key',
        }],
      },
      target: { platform: 'darwin', arch: 'arm64' },
      expectedComponentIds: [],
      generationRoot: '/tmp/generations',
      generationStatePath: '/tmp/generations/state.json',
      activeGenerationId: 'bundled',
    } as unknown as Omit<ProfileUpdateContext, 'request'>)
    expect(runtime.updates.currentScheduleProtocolFloor).toBe(1)
    expect(runtime.updates.trustedManifestKeys).toEqual([expect.objectContaining({ id: 'release-key' })])
    electron.app.isPackaged = true
    expect(runtime.updates).toMatchObject({ isPackaged: true, canDownload: true })

    await runtime.updates.showManualCheckResult({
      status: 'up-to-date',
      currentVersion: '2.0.0',
      latestVersion: '2.0.0',
    })
    expect(electron.dialog.showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'e-Mate 已是最新版本',
      detail: '已安装版本：2.0.0',
      buttons: ['知道了'],
    }))

    await runtime.updates.showManualCheckResult(null)
    expect(electron.dialog.showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({
      title: '无法检查更新',
      buttons: ['知道了'],
    }))

    runtime.updates.publishState({
      stage: 'failed',
      updateKind: 'base',
      code: 'check-signature-invalid',
      diagnosticId: '0e4b9e6d-89b7-4b32-b8d4-d5fda86506bc',
    })
    await runtime.updates.showManualCheckResult({
      status: 'failed',
      code: 'check-signature-invalid',
      retryable: false,
    })
    expect(electron.dialog.showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({
      title: '无法检查更新',
      message: '更新清单签名无法验证。',
      detail: expect.stringContaining('0e4b9e6d-89b7-4b32-b8d4-d5fda86506bc'),
    }))

    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await expect(runtime.updates.confirmDownload('2.1.0')).resolves.toBe(false)
    expect(updater.download).not.toHaveBeenCalled()

    electron.dialog.showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    await expect(runtime.updates.confirmDownload('2.1.0')).resolves.toBe(true)
    expect(electron.dialog.showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({
      detail: '将自动下载并校验安装包，安装完成后重新打开 e-Mate。',
      buttons: ['更新并重启', '稍后'],
    }))
    const controller = new AbortController()
    const updateStates: unknown[] = []
    await runtime.updates.downloadAndOpen(updateAvailable, controller.signal, state => { updateStates.push(state) })
    expect(updater.download).toHaveBeenCalledWith({
      platform: 'darwin',
      version: '2.1.0',
      artifact: updateAvailable.artifact,
      userDataPath: '/tmp/dsh-desktop-user-data',
      request: expect.any(Function),
      signal: controller.signal,
      onProgress: expect.any(Function),
    })
    expect(macUpdater.preflight).toHaveBeenCalledWith(expect.objectContaining({
      targetVersion: '2.1.0',
      currentExecutable: process.execPath,
      userDataPath: '/tmp/dsh-desktop-user-data',
      homeDirectory: '/tmp/dsh-home',
      helperModulePath: expect.stringMatching(/mac-update-helper\.js$/u),
      artifact: updateAvailable.artifact,
    }))
    expect(macUpdater.preflight.mock.invocationCallOrder[0])
      .toBeLessThan(updater.download.mock.invocationCallOrder[0]!)
    expect(releaseChecker.check).toHaveBeenCalledWith({
      currentVersion: updateAvailable.currentVersion,
      currentScheduleProtocolFloor: 1,
      platform: 'darwin',
      trustedManifestKeys: [expect.objectContaining({ id: 'release-key' })],
      signal: controller.signal,
      request: expect.any(Function),
    })
    expect(updater.download.mock.invocationCallOrder[0])
      .toBeLessThan(releaseChecker.check.mock.invocationCallOrder[0]!)
    expect(releaseChecker.check.mock.invocationCallOrder[0])
      .toBeLessThan(macUpdater.schedule.mock.invocationCallOrder[0]!)
    expect(macUpdater.schedule).toHaveBeenCalledWith(expect.objectContaining({
      dmgPath: '/tmp/e-Mate-2.1.0-mac.dmg',
      targetVersion: '2.1.0',
      currentExecutable: process.execPath,
      userDataPath: '/tmp/dsh-desktop-user-data',
      homeDirectory: '/tmp/dsh-home',
      helperModulePath: expect.stringMatching(/mac-update-helper\.js$/u),
      sourceCommit: updateAvailable.sourceCommit,
      baseContractId: updateAvailable.baseContractId,
      scheduleProtocolFloor: updateAvailable.scheduleProtocolFloor,
      manifestIdentity: updateAvailable.manifestIdentity,
      artifact: updateAvailable.artifact,
      parentPid: process.pid,
      signal: controller.signal,
    }))
    expect(updateStates).toEqual([
      { stage: 'downloading', bytes: 512, total: 1024 },
      { stage: 'verifying' },
      { stage: 'staging' },
      { stage: 'waiting-shutdown' },
    ])
    expect(requestQuit).toHaveBeenCalledWith(0)
    expect(macUpdater.markShutdownReady).not.toHaveBeenCalled()
    runtime.commitPreparedUpdateShutdown()
    expect(macUpdater.markShutdownReady).toHaveBeenCalledOnce()
    expect(electron.notifications[0]?.options).toEqual({
      title: '正在安装 e-Mate 更新',
      body: 'e-Mate 2.1.0 将自动重新打开。',
    })

    runtime.updates.notify({
      title: 'Profile Recovered',
      body: 'Reopened the last-known-good profile.',
    })
    const notification = electron.notifications.at(-1)
    expect(notification?.options).toEqual({
      title: 'Profile Recovered',
      body: 'Reopened the last-known-good profile.',
    })
    expect(notification?.show).toHaveBeenCalledOnce()
    expect(notification?.once).not.toHaveBeenCalled()
  })

  it('rejects installer handoff when the signed manifest changes after download', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    updater.download.mockResolvedValueOnce('/tmp/e-Mate-2.1.0-mac.dmg')
    releaseChecker.check.mockResolvedValueOnce({
      ...updateAvailable,
      manifestIdentity: 'c'.repeat(64),
    })
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    runtime.schedule(spec)

    await expect(runtime.updates.downloadAndOpen(updateAvailable, new AbortController().signal))
      .rejects.toThrow('signed update changed after download')
    expect(updater.download).toHaveBeenCalledOnce()
    expect(releaseChecker.check).toHaveBeenCalledOnce()
    expect(macUpdater.schedule).not.toHaveBeenCalled()
  })

  it('fails macOS path and disk preflight before an installer request', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    macUpdater.preflight.mockImplementationOnce(() => { throw new Error('macOS update has insufficient free space') })
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    runtime.schedule(spec)

    await expect(runtime.updates.downloadAndOpen(updateAvailable, new AbortController().signal))
      .rejects.toThrow('insufficient free space')
    expect(updater.download).not.toHaveBeenCalled()
    expect(macUpdater.schedule).not.toHaveBeenCalled()
  })

  it('starts the verified Windows installer before requesting orderly exit', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    updater.download.mockResolvedValueOnce('C:\\Updates\\e-Mate-2.1.0-windows.exe')
    releaseChecker.check.mockResolvedValueOnce(windowsUpdateAvailable)
    const requestQuit = vi.fn()
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    runtime.schedule({ ...spec, requestQuit })

    const pending = runtime.updates.downloadAndOpen(windowsUpdateAvailable, new AbortController().signal)
    await vi.waitFor(() => { expect(childProcess.spawn).toHaveBeenCalledOnce() })
    expect(childProcess.spawn).toHaveBeenCalledWith(
      'C:\\Updates\\e-Mate-2.1.0-windows.exe',
      ['--updated', '--force-run'],
      {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      },
    )
    expect(updater.download.mock.invocationCallOrder[0])
      .toBeLessThan(releaseChecker.check.mock.invocationCallOrder[0]!)
    expect(releaseChecker.check.mock.invocationCallOrder[0])
      .toBeLessThan(childProcess.spawn.mock.invocationCallOrder[0]!)
    expect(requestQuit).not.toHaveBeenCalled()
    childProcess.emit('spawn')
    await pending

    expect(childProcess.child.unref).toHaveBeenCalledOnce()
    expect(requestQuit).toHaveBeenCalledWith(0)
  })

  it('does not exit when the verified Windows installer fails to spawn', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    updater.download.mockResolvedValueOnce('C:\\Updates\\e-Mate-2.1.0-windows.exe')
    releaseChecker.check.mockResolvedValueOnce(windowsUpdateAvailable)
    const requestQuit = vi.fn()
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    runtime.schedule({ ...spec, requestQuit })

    const pending = runtime.updates.downloadAndOpen(windowsUpdateAvailable, new AbortController().signal)
    await vi.waitFor(() => { expect(childProcess.spawn).toHaveBeenCalledOnce() })
    childProcess.emit('error', new Error('blocked'))

    await expect(pending).rejects.toThrow('blocked')
    expect(childProcess.child.unref).not.toHaveBeenCalled()
    expect(requestQuit).not.toHaveBeenCalled()
  })

  it('does not ask for a second confirmation after a Windows update was approved', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    updater.download.mockResolvedValueOnce('C:\\Updates\\e-Mate-2.1.0-windows.exe')
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    runtime.schedule(spec)
    const dialogCalls = electron.dialog.showMessageBox.mock.calls.length

    const pending = runtime.updates.downloadAndOpen(windowsUpdateAvailable, new AbortController().signal)
    await vi.waitFor(() => { expect(childProcess.spawn).toHaveBeenCalledOnce() })
    childProcess.emit('spawn')
    await pending

    expect(electron.dialog.showMessageBox).toHaveBeenCalledTimes(dialogCalls)
  })

  it('does not exit when macOS update staging fails', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    updater.download.mockResolvedValueOnce('/tmp/e-Mate-2.1.0-mac.dmg')
    macUpdater.schedule.mockRejectedValueOnce(new Error('invalid staged bundle'))
    const requestQuit = vi.fn()
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    runtime.schedule({ ...spec, requestQuit })

    await expect(runtime.updates.downloadAndOpen(updateAvailable, new AbortController().signal))
      .rejects.toThrow('invalid staged bundle')
    expect(requestQuit).not.toHaveBeenCalled()
  })

  it('commits a ready macOS helper even if the original request signal aborts afterward', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    updater.download.mockResolvedValueOnce('/tmp/e-Mate-2.1.0-mac.dmg')
    let finishStage!: () => void
    macUpdater.schedule.mockImplementationOnce(async () => new Promise(resolve => {
      finishStage = () => { resolve({ markShutdownReady: macUpdater.markShutdownReady }) }
    }))
    const requestQuit = vi.fn()
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    runtime.schedule({ ...spec, requestQuit })
    const controller = new AbortController()

    const pending = runtime.updates.downloadAndOpen(updateAvailable, controller.signal)
    await vi.waitFor(() => { expect(macUpdater.schedule).toHaveBeenCalledOnce() })
    controller.abort()
    finishStage()

    await expect(pending).resolves.toBeUndefined()
    expect(requestQuit).toHaveBeenCalledWith(0)
  })

  it('keeps advanced material internals free of a user-visible mode switch', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    electron.nativeTheme.themeSource = 'light'
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const readThemeSource = vi.fn(() => 'dark' as const)
    const release = runtime.schedule({ ...spec, mode: 'advanced', readThemeSource })

    runtime.setThemeSource('system')
    expect(electron.nativeTheme.themeSource).toBe('light')
    await runtime.mountScheduled()

    expect(readThemeSource).toHaveBeenCalledOnce()
    expect(electron.browserWindowThemeSources).toEqual(['dark'])
    expect(electron.nativeTheme.themeSource).toBe('dark')
    expect(electron.browserWindowOptions[0]).toEqual(expect.objectContaining({
      titleBarStyle: 'hiddenInset',
      transparent: true,
      vibrancy: 'sidebar',
    }))
    expect(electron.menuTemplates[0]).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Switch to Compatibility Mode' }),
    ]))

    runtime.setThemeSource('system')
    expect(electron.nativeTheme.themeSource).toBe('system')
    await release()
    expect(electron.nativeTheme.themeSource).toBe('light')
    runtime.setThemeSource('dark')
    expect(electron.nativeTheme.themeSource).toBe('light')
  })

  it('keeps the native Windows caption symbols legible across light, dark, and system changes', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    electron.nativeTheme.shouldUseDarkColors = true
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule({ ...spec, mode: 'advanced', readThemeSource: () => 'system' })

    await runtime.mountScheduled()
    expect((electron.browserWindowOptions[0] as any).titleBarOverlay.symbolColor).toBe('#f5f5f5')
    electron.nativeTheme.shouldUseDarkColors = false
    runtime.setThemeSource('light')
    expect(electron.browserWindows[0]?.setTitleBarOverlay).toHaveBeenLastCalledWith(expect.objectContaining({
      symbolColor: '#2f3337',
    }))
    electron.nativeTheme.shouldUseDarkColors = true
    const updated = electron.nativeTheme.on.mock.calls.find(([event]) => event === 'updated')?.[1]
    expect(updated).toEqual(expect.any(Function))
    updated()
    expect(electron.browserWindows[0]?.setTitleBarOverlay).toHaveBeenLastCalledWith(expect.objectContaining({
      symbolColor: '#f5f5f5',
    }))
    await release()
    expect(electron.nativeTheme.off).toHaveBeenCalledWith('updated', updated)
  })

  it('restores the preceding native appearance when advanced loading fails', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    electron.nativeTheme.themeSource = 'light'
    electron.loadURL.mockRejectedValueOnce(new Error('renderer unavailable'))
    const { ElectronDesktopRuntime } = await import('../src/electron-runtime.ts')
    const runtime = new ElectronDesktopRuntime(async () => {})
    const release = runtime.schedule({
      ...spec,
      mode: 'advanced',
      readThemeSource: () => 'dark',
    })

    await expect(runtime.mountScheduled()).rejects.toThrow('renderer unavailable')
    expect(electron.nativeTheme.themeSource).toBe('dark')
    await expect(release()).rejects.toThrow('renderer unavailable')
    expect(electron.nativeTheme.themeSource).toBe('light')
  })
})
