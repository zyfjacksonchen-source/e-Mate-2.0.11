import type { NativeImage } from 'electron'
import { describe, expect, it } from 'vitest'
import type { DesktopShellSpec } from '../src/runtime.ts'
import type { DesktopRendererBootstrap } from '../src/desktop-bootstrap-contract.ts'
import {
  advancedWindowOptions,
  compatibilityWindowOptions,
  desktopWindowOptions,
  WINDOWS_CAPTION_SYMBOL_DARK,
  WINDOWS_CAPTION_SYMBOL_LIGHT,
} from '../src/window-options.ts'
import { WINDOWS_TITLEBAR_HEIGHT } from '../src/window-chrome.ts'

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
  readThemeSource: () => 'system',
  resourceRoots: () => ['/tmp/e-mate-workspace'],
  requestQuit: () => {},
  requestModeChange: async () => {},
}

const preload = '/tmp/preload.cjs'
const bootstrap: DesktopRendererBootstrap = {
  schemaVersion: 1,
  mode: 'compatibility',
  platform: 'darwin',
  profileGeneration: 'bundled',
  runtimeId: 'runtime-test',
  windowKind: 'main',
}

describe('compatibility BrowserWindow options', () => {
  it('preserves the native frame and enables renderer isolation', () => {
    const icon = {} as NativeImage
    const options = compatibilityWindowOptions(spec, icon, 'darwin', preload, bootstrap)

    expect(options).toEqual(expect.objectContaining({
      title: '',
      width: 1280,
      height: 840,
      minWidth: 900,
      minHeight: 640,
      show: false,
      icon,
      webPreferences: {
        preload,
        additionalArguments: [expect.stringMatching(/^--e-mate-desktop-bootstrap=/u)],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    }))
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
  })

  it('uses the native Windows caption while hiding the application menu', () => {
    const options = compatibilityWindowOptions(spec, {} as NativeImage, 'win32', preload, {
      ...bootstrap, platform: 'win32',
    })

    expect(options.title).toBe('e-Mate')
    expect(options.autoHideMenuBar).toBe(true)
  })

  it('rejects an advanced spec before BrowserWindow construction', () => {
    expect(() => compatibilityWindowOptions(
      { ...spec, mode: 'advanced' },
      {} as NativeImage,
      'darwin',
      preload,
      bootstrap,
    )).toThrow('unsupported compatibility window mode advanced')
  })

  it('uses hidden-inset transparent vibrancy on macOS advanced windows', () => {
    const advanced = { ...spec, mode: 'advanced' as const }
    const advancedBootstrap = { ...bootstrap, mode: 'advanced' as const }
    const options = advancedWindowOptions(advanced, {} as NativeImage, 'darwin', preload, advancedBootstrap)

    expect(options).toEqual(expect.objectContaining({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
      visualEffectState: 'followWindow',
    }))
    expect(desktopWindowOptions(advanced, {} as NativeImage, 'darwin', preload, advancedBootstrap)).toEqual(options)
  })

  it('uses native Windows controls, Mica, shadow, and rounded corners in advanced mode', () => {
    const options = advancedWindowOptions(
      { ...spec, mode: 'advanced' },
      {} as NativeImage,
      'win32',
      preload,
      { ...bootstrap, mode: 'advanced', platform: 'win32' },
    )

    expect(options).toEqual(expect.objectContaining({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: WINDOWS_CAPTION_SYMBOL_LIGHT,
        height: WINDOWS_TITLEBAR_HEIGHT,
      },
      backgroundMaterial: 'mica',
      hasShadow: true,
      roundedCorners: true,
      thickFrame: true,
    }))
    expect(advancedWindowOptions(
      { ...spec, mode: 'advanced' },
      {} as NativeImage,
      'win32',
      preload,
      { ...bootstrap, mode: 'advanced', platform: 'win32' },
      true,
    ).titleBarOverlay).toEqual({
      color: '#00000000', symbolColor: WINDOWS_CAPTION_SYMBOL_DARK, height: WINDOWS_TITLEBAR_HEIGHT,
    })
  })

  it('rejects advanced mode on Linux', () => {
    expect(() => advancedWindowOptions(
      { ...spec, mode: 'advanced' },
      {} as NativeImage,
      'linux',
      preload,
      { ...bootstrap, mode: 'advanced', platform: 'linux' },
    )).toThrow('supported on macOS and Windows')
  })
})
