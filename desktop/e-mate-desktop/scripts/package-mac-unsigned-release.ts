/** Build the formal ad-hoc-signed macOS release without Developer ID credentials. */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareInstalledMacUniversalRuntime } from './mac-universal.ts'
import { withoutMacReleaseSecrets } from './release-preflight.ts'

export interface MacUnsignedReleaseOptions {
  readonly env: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly nodeVersion: string
  readonly workspaceRoot: string
  readonly desktopRoot: string
  readonly outputDir: string
  readonly resetOutput: () => void
  readonly prepareRuntime: () => void
  readonly builderCli: string
  readonly verifier: string
  readonly nodeExecutable: string
  readonly yarnCli: string
  readonly run: (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv) => void
  readonly log: (message: string) => void
}

function run(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

function defaultOptions(): MacUnsignedReleaseOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  const yarnCli = process.env.npm_execpath
  if (yarnCli === undefined || !isAbsolute(yarnCli)) {
    throw new Error('formal unsigned macOS release must run through the pinned Yarn workspace')
  }
  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    workspaceRoot,
    desktopRoot,
    outputDir: resolve(desktopRoot, 'dist', 'mac-unsigned-release'),
    resetOutput: () => rmSync(resolve(desktopRoot, 'dist', 'mac-unsigned-release'), { recursive: true, force: true }),
    prepareRuntime: () => prepareInstalledMacUniversalRuntime(desktopRoot),
    builderCli: createRequire(import.meta.url).resolve('electron-builder/cli.js'),
    verifier: fileURLToPath(new URL('./verify-mac-release.ts', import.meta.url)),
    nodeExecutable: process.execPath,
    yarnCli,
    run,
    log: message => console.log(message),
  }
}

/** Build and verify the only unsigned macOS artifact eligible for publication. */
export function packageMacUnsignedRelease(options: MacUnsignedReleaseOptions = defaultOptions()): void {
  if (options.platform !== 'darwin') throw new Error('formal unsigned macOS release must be built on macOS')
  if (options.arch !== 'x64' && options.arch !== 'arm64') {
    throw new Error(`formal unsigned macOS release requires x64 or arm64 Node; received ${options.arch}`)
  }
  const version = /^(\d+)\.(\d+)\./u.exec(options.nodeVersion)
  const major = Number(version?.[1])
  const minor = Number(version?.[2])
  if (!((major === 22 && minor >= 19) || major === 24)) {
    throw new Error(`formal unsigned macOS release requires Node 22.19+ or Node 24.x; received ${options.nodeVersion}`)
  }

  const cleanEnvironment = withoutMacReleaseSecrets(options.env)
  options.log('Building the formal ad-hoc-signed macOS release; this is not the CI smoke artifact.')
  options.run(options.yarnCli, [
    'workspace', '@e-mate/desktop', 'check:mac-package',
  ], options.workspaceRoot, cleanEnvironment)
  options.resetOutput()
  options.prepareRuntime()
  options.run(options.nodeExecutable, [
    options.builderCli,
    '--mac', 'dmg', '--universal', '--publish', 'never',
    '--config.forceCodeSigning=true',
    '--config.mac.identity=-',
    '--config.mac.notarize=false',
    '--config.mac.signIgnore=app\\.asar\\.unpacked/build/e-mate-profile/bundles/computer-use/native/macos/bin/dsh-computer-use-helper$',
    '--config.npmRebuild=false',
    `--config.directories.output=${options.outputDir}`,
  ], options.desktopRoot, { ...cleanEnvironment, CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
  options.run(options.nodeExecutable, [options.verifier, options.outputDir, '--unsigned-adhoc'], options.desktopRoot, cleanEnvironment)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    packageMacUnsignedRelease()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
