import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_INSTALLER_QUIT_FLAG,
  isDesktopInstallerQuitRequest,
} from '../src/desktop-installer-quit.ts'

describe('Desktop installer quit request', () => {
  it('accepts only the dedicated flag on Windows', () => {
    expect(DESKTOP_INSTALLER_QUIT_FLAG).toBe('--emate-installer-quit')
    expect(isDesktopInstallerQuitRequest(
      ['e-Mate.exe', DESKTOP_INSTALLER_QUIT_FLAG],
      'win32',
    )).toBe(true)
    expect(isDesktopInstallerQuitRequest(['e-Mate.exe', '--quit'], 'win32')).toBe(false)
    expect(isDesktopInstallerQuitRequest(
      ['e-Mate', DESKTOP_INSTALLER_QUIT_FLAG],
      'darwin',
    )).toBe(false)
  })

  it('handles first- and second-instance requests without showing a window', () => {
    const main = readFileSync(join(process.cwd(), 'src', 'main.ts'), 'utf8')
    const lock = main.indexOf('if (!app.requestSingleInstanceLock())')
    const earlyQuit = main.indexOf(
      'if (isDesktopInstallerQuitRequest(process.argv, process.platform))',
    )
    const startup = main.indexOf('let current: Context')
    const secondInstance = main.indexOf("app.on('second-instance', (_event, argv) => {")
    const secondQuit = main.indexOf(
      'if (isDesktopInstallerQuitRequest(argv, process.platform))',
      secondInstance,
    )
    const show = main.indexOf('runtime.show()', secondQuit)

    expect(lock).toBeGreaterThanOrEqual(0)
    expect(earlyQuit).toBeGreaterThan(lock)
    expect(earlyQuit).toBeLessThan(startup)
    expect(secondInstance).toBeGreaterThan(startup)
    expect(secondQuit).toBeGreaterThan(secondInstance)
    expect(secondQuit).toBeLessThan(show)
    expect(main.slice(secondQuit, show)).toContain('requestQuit(0)')
  })
})
