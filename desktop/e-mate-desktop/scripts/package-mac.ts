/** Build the unsigned e-Mate macOS DMG with dsh-desktop's native packager. */

import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareInstalledMacUniversalRuntime } from './mac-universal.ts'

const SIGNING_ENVIRONMENT_VARIABLES = [
  'APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_ID',
  'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_ID', 'APPLE_KEYCHAIN',
  'APPLE_KEYCHAIN_PROFILE', 'APPLE_TEAM_ID', 'CSC_IDENTITY_AUTO_DISCOVERY',
  'CSC_FOR_PULL_REQUEST', 'CSC_INSTALLER_KEY_PASSWORD', 'CSC_INSTALLER_LINK',
  'CSC_KEYCHAIN', 'CSC_KEY_PASSWORD', 'CSC_LINK', 'CSC_NAME', 'MACOS_SIGN_IDENTITY',
  'MAC_CERT_P12_BASE64',
] as const

function withoutSigningEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitized = { ...env }
  for (const name of SIGNING_ENVIRONMENT_VARIABLES) delete sanitized[name]
  return sanitized
}

/** Injectable native macOS packaging boundary used by focused tests. */
export interface MacSmokePackageOptions {
  /** Environment inherited by the packaging command. */
  readonly env: NodeJS.ProcessEnv
  /** Platform executing the package build. */
  readonly platform: NodeJS.Platform
  /** Node architecture executing the package build. */
  readonly arch: string
  /** Node version executing the package build. */
  readonly nodeVersion: string
  /** Repository root containing the Yarn workspace. */
  readonly workspaceRoot: string
  /** Desktop package root containing electron-builder configuration. */
  readonly desktopRoot: string
  /** Dedicated smoke output directory, isolated from signed release artifacts. */
  readonly outputDir: string
  /** Remove only the dedicated generated smoke output before packaging. */
  readonly resetOutput: () => void
  /** Validate and prepare both architecture-specific runtime trees. */
  readonly prepareRuntime: () => void
  /** Absolute electron-builder CLI module. */
  readonly builderCli: string
  /** Absolute packaged-DMG verification script. */
  readonly verifier: string
  /** Node executable used to run package-local scripts. */
  readonly nodeExecutable: string
  /** Execute one packaging command. */
  readonly run: (
    command: string,
    args: readonly string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
  ) => void
  /** Report non-secret packaging progress. */
  readonly log: (message: string) => void
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

function defaultOptions(): MacSmokePackageOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const workspaceRoot = resolve(desktopRoot, '..')
  const require = createRequire(import.meta.url)
  const outputDir = resolve(desktopRoot, 'dist', 'mac-release')
  return {
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    workspaceRoot,
    desktopRoot,
    outputDir,
    resetOutput: () => rmSync(outputDir, { recursive: true, force: true }),
    prepareRuntime: () => prepareInstalledMacUniversalRuntime(desktopRoot),
    builderCli: require.resolve('electron-builder/cli.js'),
    verifier: fileURLToPath(new URL('./verify-mac-smoke.ts', import.meta.url)),
    nodeExecutable: process.execPath,
    run,
    log: message => console.log(message),
  }
}

/**
 * Run the release gates and package one unsigned universal macOS DMG.
 * @param options - Injectable process and command boundaries.
 */
export function packageMacSmoke(options: MacSmokePackageOptions = defaultOptions()): void {
  if (options.platform !== 'darwin') {
    throw new Error('macOS DMG smoke must be built on a native macOS host')
  }
  if (options.arch !== 'x64' && options.arch !== 'arm64') {
    throw new Error(`macOS DMG smoke requires x64 or arm64 Node; received ${options.arch}`)
  }
  const versionMatch = /^(\d+)\.(\d+)\./u.exec(options.nodeVersion)
  const major = Number(versionMatch?.[1])
  const minor = Number(versionMatch?.[2])
  if (!((major === 22 && minor >= 19) || major === 24)) {
    throw new Error(
      `macOS DMG smoke requires Node 22.19+ or Node 24.x with bundled Corepack; received ${options.nodeVersion}`,
    )
  }

  const cleanEnvironment = withoutSigningEnvironment(options.env)
  options.log('Building the unsigned e-Mate macOS DMG with the dsh-desktop package flow.')
  if (options.env.DSH_PACKAGE_CHECK_ALREADY_RAN !== '1') {
    options.run(
      'corepack',
      ['yarn', 'workspace', '@e-mate/desktop', 'check:mac-package'],
      options.workspaceRoot,
      cleanEnvironment,
    )
  } else {
    options.log('Skipping the macOS package preflight; the package gate already passed.')
  }
  options.resetOutput()
  options.prepareRuntime()
  options.run(
    options.nodeExecutable,
    [
      options.builderCli,
      '--mac',
      'dmg',
      '--universal',
      '--publish',
      'never',
      '--config.mac.notarize=false',
      '--config.npmRebuild=false',
      `--config.directories.output=${options.outputDir}`,
    ],
    options.desktopRoot,
    {
      ...cleanEnvironment,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
  )
  options.run(
    options.nodeExecutable,
    [options.verifier, options.outputDir],
    options.desktopRoot,
    cleanEnvironment,
  )
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    packageMacSmoke()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
