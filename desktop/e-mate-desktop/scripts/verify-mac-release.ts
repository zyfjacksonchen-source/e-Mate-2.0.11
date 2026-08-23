/** Verify the signed application sealed inside one macOS release DMG. */

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MACOS_UNIVERSAL_NATIVE_ENTRIES } from './mac-universal.ts'

// This timeout detects a broken candidate. Startup performance is a paired installed-artifact
// comparison against accepted e-Mate 2.0.11, so this verifier must not invent an absolute budget.
const RELEASE_HEALTH_TIMEOUT_MS = 180_000
const RELEASE_SHUTDOWN_TIMEOUT_MS = 10_000

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function waitForExit(pid: number, timeoutMs: number): boolean {
  const sleeper = new Int32Array(new SharedArrayBuffer(4))
  const deadline = Date.now() + timeoutMs
  while (processAlive(pid) && Date.now() < deadline) Atomics.wait(sleeper, 0, 0, 100)
  return !processAlive(pid)
}

function terminateProcess(pid: number): void {
  try { process.kill(pid, 'SIGTERM') } catch { return }
  if (!waitForExit(pid, RELEASE_SHUTDOWN_TIMEOUT_MS)) {
    try { process.kill(pid, 'SIGKILL') } catch {}
  }
}

function terminateProbeChrome(userDataDir: string): void {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error('/bin/ps failed while cleaning the release browser probe')
  for (const line of result.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.+)$/u.exec(line)
    if (match === null || !match[2]!.includes(`--user-data-dir=${userDataDir}`)) continue
    terminateProcess(Number(match[1]))
  }
}

/** Injectable filesystem and command boundaries for release verification. */
export interface MacReleaseVerificationOptions {
  /** Directory containing exactly one release DMG. */
  readonly distDir: string
  /** Installed application name inside the mounted image. */
  readonly productName: string
  /** Signed/notarized Developer ID release or formal ad-hoc-signed unsigned release. */
  readonly mode: 'signed-notarized' | 'unsigned-adhoc'
  /** Return regular DMG files in the distribution directory. */
  readonly listDmgs: (distDir: string) => readonly string[]
  /** Create a private empty mount point. */
  readonly makeMountPoint: () => string
  /** Execute one macOS verification command. */
  readonly run: (command: string, args: readonly string[]) => void
  /** Prove native arm64 interaction and x86_64 Electron readiness from isolated fresh profiles. */
  readonly launch: (executable: string, architectures: readonly ('arm64' | 'x86_64')[]) => void
  /** Keep the packaged native helper bound to its immutable plugin manifest. */
  readonly verifyComputerUseHelper: (unpackedRoot: string) => void
  /** Briefly allow terminated Electron helpers to release the mounted image before a retry. */
  readonly waitBeforeDetachRetry: () => void
  /** Remove the detached empty mount point. */
  readonly removeMountPoint: (mountPoint: string) => void
}

function launchArchitecture(executable: string, arch: 'arm64' | 'x86_64', root: string): void {
  let processGroup: number | undefined
  try {
    const userData = join(root, `user-data-${arch}`)
    // ponytail: Rosetta proves the x86_64 package can enter Electron; native Intel performance
    // belongs on Intel hardware, not a fresh translation cache on an Apple Silicon runner.
    const acknowledgement = arch === 'x86_64' ? '.release-native-ready-ack' : '.release-health-ack'
    const healthAck = join(userData, acknowledgement)
    const healthFailure = join(userData, '.release-health-failure')
    const outcome = arch === 'x86_64' ? 'Electron native readiness' : 'an interactive shell'
    const startedAt = Date.now()
    const child = spawn('/usr/bin/arch', [`-${arch}`, executable, `--user-data-dir=${userData}`], {
      env: { ...process.env, DSH_HOME: join(root, `dsh-${arch}`), EMATE_RELEASE_HEALTH_PROBE: '1' },
      stdio: 'ignore',
      detached: true,
    })
    if (child.pid === undefined) throw new Error(`${arch} packaged application did not start`)
    processGroup = child.pid
    const sleeper = new Int32Array(new SharedArrayBuffer(4))
    const deadline = startedAt + RELEASE_HEALTH_TIMEOUT_MS
    while (!existsSync(healthAck)) {
      if (existsSync(healthFailure)) {
        throw new Error(`${arch} packaged application failed before ${outcome}: ${readFileSync(healthFailure, 'utf8')}`)
      }
      try {
        process.kill(child.pid, 0)
      } catch {
        throw new Error(`${arch} packaged application exited before ${outcome}`)
      }
      if (Date.now() >= deadline) {
        throw new Error(`${arch} packaged application did not acknowledge ${outcome} within ${String(RELEASE_HEALTH_TIMEOUT_MS / 1000)} seconds`)
      }
      Atomics.wait(sleeper, 0, 0, 200)
    }
    const elapsedMs = Date.now() - startedAt
    console.log(`${arch} ${outcome} acknowledged in ${String(elapsedMs)} ms`)
  } finally {
    if (processGroup !== undefined) {
      terminateProcess(-processGroup)
    }
    terminateProbeChrome(join(root, `dsh-${arch}`, 'runtime', 'cdp-chrome'))
  }
}

function launch(executable: string, architectures: readonly ('arm64' | 'x86_64')[]): void {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-release-'))
  try {
    const sourceApp = dirname(dirname(dirname(executable)))
    const installedApp = join(root, 'Applications', basename(sourceApp))
    run('/usr/bin/ditto', [sourceApp, installedApp])
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', installedApp])
    const installedExecutable = join(installedApp, 'Contents', 'MacOS', basename(executable))
    for (const architecture of architectures) launchArchitecture(installedExecutable, architecture, root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function listDmgs(distDir: string): readonly string[] {
  return readdirSync(distDir)
    .filter(name => name.endsWith('.dmg'))
    .map(name => join(distDir, name))
    .filter(path => statSync(path).isFile())
}

function verifyComputerUseHelper(unpackedRoot: string): void {
  const nativeRoot = join(unpackedRoot, 'build', 'e-mate-profile', 'bundles', 'computer-use', 'native', 'macos')
  const manifest = JSON.parse(readFileSync(join(nativeRoot, 'manifest.json'), 'utf8')) as {
    readonly binary?: { readonly path?: unknown; readonly sha256?: unknown }
  }
  const relativePath = manifest.binary?.path
  const expected = manifest.binary?.sha256
  if (relativePath !== 'bin/dsh-computer-use-helper' || typeof expected !== 'string' || !/^[a-f0-9]{64}$/u.test(expected)) {
    throw new Error('packaged Computer Use helper manifest is invalid')
  }
  const actual = createHash('sha256').update(readFileSync(join(nativeRoot, relativePath))).digest('hex')
  if (actual !== expected) throw new Error('packaged Computer Use helper does not match its manifest')
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`)
  }
}

function defaultOptions(): MacReleaseVerificationOptions {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    distDir: process.argv[2] === undefined
      ? join(packageRoot, 'dist', 'mac-release')
      : resolve(process.argv[2]),
    productName: 'e-Mate',
    mode: process.argv.includes('--unsigned-adhoc') ? 'unsigned-adhoc' : 'signed-notarized',
    listDmgs,
    makeMountPoint: () => mkdtempSync(join(tmpdir(), 'dsh-desktop-dmg-')),
    run,
    launch,
    verifyComputerUseHelper,
    waitBeforeDetachRetry: () => { run('/bin/sleep', ['1']) },
    removeMountPoint: mountPoint => rmdirSync(mountPoint),
  }
}

/**
 * Mount and verify the application contained in the unique release DMG.
 * @param options - Filesystem and command boundaries.
 * @returns The verified DMG and application paths.
 */
export function verifyMacRelease(
  options: MacReleaseVerificationOptions = defaultOptions(),
): { readonly appPath: string; readonly dmgPath: string } {
  const dmgs = options.listDmgs(options.distDir)
  if (dmgs.length !== 1) {
    throw new Error(
      `macOS release verification requires exactly one DMG in ${options.distDir}; found ${String(dmgs.length)}`,
    )
  }

  const dmgPath = dmgs[0]!
  const mountPoint = options.makeMountPoint()
  const appPath = join(mountPoint, `${options.productName}.app`)
  let mounted = false
  let failure: unknown

  try {
    options.run('hdiutil', ['verify', dmgPath])
    options.run('hdiutil', ['attach', dmgPath, '-mountpoint', mountPoint, '-nobrowse', '-readonly'])
    mounted = true
    options.run('plutil', ['-lint', join(appPath, 'Contents', 'Info.plist')])
    const executablePath = join(appPath, 'Contents', 'MacOS', options.productName)
    options.run('lipo', [executablePath, '-verify_arch', 'x86_64'])
    options.run('lipo', [executablePath, '-verify_arch', 'arm64'])
    const unpackedRoot = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked')
    for (const entry of MACOS_UNIVERSAL_NATIVE_ENTRIES) {
      options.run('lipo', [join(unpackedRoot, entry.path), '-verify_arch', entry.arch])
    }
    options.verifyComputerUseHelper(unpackedRoot)
    options.run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
    if (options.mode === 'signed-notarized') {
      options.run('spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath])
      options.run('xcrun', ['stapler', 'validate', appPath])
    } else {
      options.launch(executablePath, ['arm64', 'x86_64'])
    }
  } catch (cause) {
    failure = cause
  }

  const cleanupFailures: unknown[] = []
  if (mounted) {
    let detachFailure: unknown
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        options.run('hdiutil', ['detach', mountPoint])
        detachFailure = undefined
        break
      } catch (cause) {
        detachFailure = cause
        if (attempt < 4) options.waitBeforeDetachRetry()
      }
    }
    if (detachFailure !== undefined) {
      try {
        options.run('hdiutil', ['detach', mountPoint, '-force'])
        detachFailure = undefined
      } catch (cause) {
        detachFailure = cause
      }
    }
    if (detachFailure !== undefined) cleanupFailures.push(detachFailure)
  }
  try {
    options.removeMountPoint(mountPoint)
  } catch (cause) {
    cleanupFailures.push(cause)
  }

  if (failure !== undefined || cleanupFailures.length > 0) {
    const failures = failure === undefined ? cleanupFailures : [failure, ...cleanupFailures]
    throw new AggregateError(failures, `failed to verify macOS release DMG ${basename(dmgPath)}`)
  }
  return { appPath, dmgPath }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const verified = verifyMacRelease()
    console.log(`macOS release verification passed: ${verified.dmgPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    if (error instanceof AggregateError) {
      for (const cause of error.errors) console.error(cause instanceof Error ? cause.message : String(cause))
    }
    process.exitCode = 1
  }
}
