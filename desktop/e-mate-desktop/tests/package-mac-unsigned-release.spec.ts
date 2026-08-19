import { describe, expect, it } from 'vitest'
import {
  packageMacUnsignedRelease,
  type MacUnsignedReleaseOptions,
} from '../scripts/package-mac-unsigned-release.ts'

interface CommandCall {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

function options(calls: CommandCall[]): MacUnsignedReleaseOptions {
  return {
    env: {
      PATH: '/usr/bin:/bin',
      SAFE_VALUE: 'kept',
      APPLE_ID: 'must-be-removed',
      CSC_LINK: 'must-be-removed',
    },
    platform: 'darwin',
    arch: 'arm64',
    nodeVersion: '22.23.2',
    workspaceRoot: '/repo/desktop',
    desktopRoot: '/repo/desktop/e-mate-desktop',
    outputDir: '/repo/desktop/e-mate-desktop/dist/mac-unsigned-release',
    resetOutput: () => {},
    prepareRuntime: () => {},
    builderCli: '/repo/desktop/node_modules/electron-builder/cli.js',
    verifier: '/repo/desktop/e-mate-desktop/scripts/verify-mac-release.ts',
    nodeExecutable: '/usr/local/bin/node',
    yarnCli: '/repo/.yarn/releases/yarn-4.18.0.cjs',
    run: (command, args, cwd, env) => { calls.push({ command, args: [...args], cwd, env: { ...env } }) },
    log: () => {},
  }
}

describe('formal unsigned macOS release packaging', () => {
  it('uses an isolated ad-hoc-signed release path and the formal verifier', () => {
    const calls: CommandCall[] = []

    packageMacUnsignedRelease(options(calls))

    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual({
      command: '/repo/.yarn/releases/yarn-4.18.0.cjs',
      args: ['workspace', '@e-mate/desktop', 'check:mac-package'],
      cwd: '/repo/desktop',
      env: { PATH: '/usr/bin:/bin', SAFE_VALUE: 'kept' },
    })
    expect(calls[1]).toEqual({
      command: '/usr/local/bin/node',
      args: [
        '/repo/desktop/node_modules/electron-builder/cli.js',
        '--mac', 'dmg', '--universal', '--publish', 'never',
        '--config.forceCodeSigning=true',
        '--config.mac.identity=-',
        '--config.mac.notarize=false',
        '--config.mac.signIgnore=app\\.asar\\.unpacked/build/e-mate-profile/bundles/computer-use/native/macos/bin/dsh-computer-use-helper$',
        '--config.npmRebuild=false',
        '--config.directories.output=/repo/desktop/e-mate-desktop/dist/mac-unsigned-release',
      ],
      cwd: '/repo/desktop/e-mate-desktop',
      env: { PATH: '/usr/bin:/bin', SAFE_VALUE: 'kept', CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    })
    expect(calls[2]).toEqual({
      command: '/usr/local/bin/node',
      args: [
        '/repo/desktop/e-mate-desktop/scripts/verify-mac-release.ts',
        '/repo/desktop/e-mate-desktop/dist/mac-unsigned-release',
        '--unsigned-adhoc',
      ],
      cwd: '/repo/desktop/e-mate-desktop',
      env: { PATH: '/usr/bin:/bin', SAFE_VALUE: 'kept' },
    })
  })

  it('rejects unsupported hosts before running commands', () => {
    const calls: CommandCall[] = []
    expect(() => packageMacUnsignedRelease({ ...options(calls), platform: 'win32' })).toThrow('must be built on macOS')
    expect(calls).toEqual([])
  })
})
