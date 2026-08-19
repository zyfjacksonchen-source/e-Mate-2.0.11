import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  verifyMacRelease,
  type MacReleaseVerificationOptions,
} from '../scripts/verify-mac-release.ts'
import { MACOS_UNIVERSAL_NATIVE_ENTRIES } from '../scripts/mac-universal.ts'

function options(overrides: Partial<MacReleaseVerificationOptions> = {}) {
  const calls: Array<{ command: string; args: readonly string[] }> = []
  const launches: Array<{ executable: string; arch: 'arm64' | 'x86_64' }> = []
  const removeMountPoint = vi.fn()
  const waitBeforeDetachRetry = vi.fn()
  const verifyComputerUseHelper = vi.fn()
  const value: MacReleaseVerificationOptions = {
    distDir: '/release/dist',
    productName: 'e-Mate',
    mode: 'signed-notarized',
    listDmgs: () => ['/release/dist/e-Mate-2.0.0-universal.dmg'],
    makeMountPoint: () => '/private/tmp/dsh-desktop-dmg-test',
    run: (command, args) => { calls.push({ command, args: [...args] }) },
    launch: (executable, architectures) => {
      for (const arch of architectures) launches.push({ executable, arch })
    },
    verifyComputerUseHelper,
    waitBeforeDetachRetry,
    removeMountPoint,
    ...overrides,
  }
  return { calls, launches, removeMountPoint, verifyComputerUseHelper, waitBeforeDetachRetry, value }
}

describe('macOS release artifact verification', () => {
  it('isolates forced-stop architecture probes from each other', () => {
    const source = readFileSync(new URL('../scripts/verify-mac-release.ts', import.meta.url), 'utf8')
    expect(source).toContain('DSH_HOME: join(root, `dsh-${arch}`)')
    expect(source).not.toContain("DSH_HOME: join(root, 'dsh')")
    expect(source).toContain("run('/usr/bin/ditto', [sourceApp, installedApp])")
    expect(source).toContain('launchArchitecture(installedExecutable, architecture, root)')
    expect(source).toContain("arch === 'x86_64' ? ROSETTA_RELEASE_HEALTH_TIMEOUT_MS : RELEASE_HEALTH_TIMEOUT_MS")
  })

  it('mounts one DMG and verifies signature, Gatekeeper, and the stapled ticket', () => {
    const harness = options()
    const appPath = join('/private/tmp/dsh-desktop-dmg-test', 'e-Mate.app')

    expect(verifyMacRelease(harness.value)).toEqual({
      appPath,
      dmgPath: '/release/dist/e-Mate-2.0.0-universal.dmg',
    })

    expect(harness.calls).toEqual([
      {
        command: 'hdiutil',
        args: ['verify', '/release/dist/e-Mate-2.0.0-universal.dmg'],
      },
      {
        command: 'hdiutil',
        args: [
          'attach', '/release/dist/e-Mate-2.0.0-universal.dmg',
          '-mountpoint', '/private/tmp/dsh-desktop-dmg-test', '-nobrowse', '-readonly',
        ],
      },
      {
        command: 'plutil',
        args: ['-lint', join(appPath, 'Contents', 'Info.plist')],
      },
      {
        command: 'lipo',
        args: [join(appPath, 'Contents', 'MacOS', 'e-Mate'), '-verify_arch', 'x86_64'],
      },
      {
        command: 'lipo',
        args: [join(appPath, 'Contents', 'MacOS', 'e-Mate'), '-verify_arch', 'arm64'],
      },
      ...MACOS_UNIVERSAL_NATIVE_ENTRIES.map(entry => ({
        command: 'lipo',
        args: [
          join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', entry.path),
          '-verify_arch', entry.arch,
        ],
      })),
      {
        command: 'codesign',
        args: ['--verify', '--deep', '--strict', '--verbose=2', appPath],
      },
      {
        command: 'spctl',
        args: ['--assess', '--type', 'execute', '--verbose=4', appPath],
      },
      {
        command: 'xcrun',
        args: ['stapler', 'validate', appPath],
      },
      {
        command: 'hdiutil',
        args: ['detach', '/private/tmp/dsh-desktop-dmg-test'],
      },
    ])
    expect(harness.removeMountPoint).toHaveBeenCalledWith('/private/tmp/dsh-desktop-dmg-test')
    expect(harness.verifyComputerUseHelper).toHaveBeenCalledWith(join(appPath, 'Contents', 'Resources', 'app.asar.unpacked'))
    expect(harness.launches).toEqual([])
  })

  it('accepts only a complete ad-hoc signature and proves both packaged architectures launch', () => {
    const harness = options({ mode: 'unsigned-adhoc' })
    const appPath = join('/private/tmp/dsh-desktop-dmg-test', 'e-Mate.app')
    const executable = join(appPath, 'Contents', 'MacOS', 'e-Mate')

    verifyMacRelease(harness.value)

    expect(harness.calls.some(call => call.command === 'codesign')).toBe(true)
    expect(harness.calls.some(call => call.command === 'spctl')).toBe(false)
    expect(harness.calls.some(call => call.command === 'xcrun')).toBe(false)
    expect(harness.launches).toEqual([
      { executable, arch: 'x86_64' },
      { executable, arch: 'arm64' },
    ])
  })

  it('rejects absent or ambiguous release images before mounting', () => {
    for (const dmgs of [[], ['/one.dmg', '/two.dmg']]) {
      const harness = options({ listDmgs: () => dmgs })
      expect(() => verifyMacRelease(harness.value)).toThrow(`found ${String(dmgs.length)}`)
      expect(harness.calls).toEqual([])
    }
  })

  it('detaches the image and preserves verification and cleanup failures', () => {
    const verifyFailure = new Error('Gatekeeper rejected the app')
    const detachFailure = new Error('detach failed')
    const harness = options({
      run: (command, args) => {
        harness.calls.push({ command, args: [...args] })
        if (command === 'spctl') throw verifyFailure
        if (command === 'hdiutil' && args[0] === 'detach') throw detachFailure
      },
    })

    let caught: unknown
    try {
      verifyMacRelease(harness.value)
    } catch (cause) {
      caught = cause
    }

    expect(caught).toBeInstanceOf(AggregateError)
    expect((caught as AggregateError).errors).toEqual([verifyFailure, detachFailure])
    expect(harness.calls.filter(call => call.command === 'hdiutil' && call.args[0] === 'detach')).toHaveLength(6)
    expect(harness.calls).toContainEqual({
      command: 'hdiutil',
      args: ['detach', '/private/tmp/dsh-desktop-dmg-test', '-force'],
    })
    expect(harness.waitBeforeDetachRetry).toHaveBeenCalledTimes(4)
    expect(harness.removeMountPoint).toHaveBeenCalledOnce()
  })
})
