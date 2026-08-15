import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, posix, resolve, win32 } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function normalizeUpdateTarget(value) {
  if (value === undefined || value === 'latest') return 'latest'
  if (!VERSION_RE.test(value)) throw new Error(`invalid update version ${JSON.stringify(value)}`)
  return value
}

function parseVersion(value) {
  const match = VERSION_RE.exec(value)
  if (match === null) throw new Error(`invalid installed version ${JSON.stringify(value)}`)
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split('.') ?? [],
  }
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const x = a.prerelease[index]
    const y = b.prerelease[index]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1
    if (xn !== yn) return xn ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}

export function globalPrefixForBinPath(binPath, platform = process.platform) {
  const path = platform === 'win32' ? win32 : posix
  const absolute = path.resolve(binPath)
  const suffix = platform === 'win32'
    ? path.join('node_modules', '@e-mate', 'dsh', 'lib', 'bin.js')
    : path.join('lib', 'node_modules', '@e-mate', 'dsh', 'lib', 'bin.js')
  const marker = `${path.sep}${suffix}`
  if (!absolute.endsWith(marker)) throw new Error('e-Mate update requires a global npm installation')
  const sliced = absolute.slice(0, -marker.length)
  const prefix = sliced.endsWith(':') ? `${sliced}${path.sep}` : sliced || path.parse(absolute).root
  if (!path.isAbsolute(prefix)) throw new Error('e-Mate global npm prefix is invalid')
  return path.normalize(prefix)
}

function updaterPaths(dshHome, requestId) {
  const root = join(dshHome, 'e-mate')
  return {
    root,
    request: join(root, 'run', 'updates', `${requestId}.json`),
    lock: join(root, 'run', 'update.lock'),
    receipt: join(root, 'migrations', `online-update-${requestId}.json`),
    stage: join(dshHome, 'update-staging', requestId),
    snapshot: join(dshHome, 'update-snapshots', requestId, 'e-mate'),
    failedData: join(dshHome, 'update-snapshots', requestId, 'failed-e-mate'),
  }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function claimUpdateLock(path, requestId, ownerPid = process.pid) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(requestId) || !Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    throw new Error('invalid online update lock identity')
  }
  mkdirSync(dirname(path), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(path, `${JSON.stringify({ schema_version: 1, request_id: requestId, owner_pid: ownerPid, state: 'starting' })}\n`, {
        flag: 'wx',
        mode: 0o600,
      })
      return
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const current = readJson(path)
      if (current?.schema_version !== 1 || typeof current.request_id !== 'string'
        || !Number.isSafeInteger(current.owner_pid) || current.owner_pid <= 0) {
        throw new Error('online update lock is invalid; no update was scheduled')
      }
      if (processAlive(current.owner_pid)) throw new Error(`online update ${current.request_id} is already running`)
      rmSync(path, { force: true })
    }
  }
  throw new Error('online update lock could not be acquired')
}

function handoffUpdateLock(path, requestId, ownerPid) {
  const current = readJson(path)
  if (current?.request_id !== requestId) throw new Error('online update lock identity changed before helper start')
  atomicJson(path, { schema_version: 1, request_id: requestId, owner_pid: ownerPid, state: 'running' })
}

async function requireHelperUpdateLock(path, requestId) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const current = readJson(path)
    if (current?.request_id !== requestId) throw new Error('online update helper lock identity changed')
    if (current.state === 'running' && current.owner_pid === process.pid) return
    await new Promise(resolveWait => setTimeout(resolveWait, 10))
  }
  throw new Error('online update helper lock handoff timed out')
}

export function releaseUpdateLock(path, requestId) {
  try {
    if (readJson(path)?.request_id === requestId) rmSync(path, { force: true })
  } catch {
    // A malformed lock is kept for explicit recovery rather than deleting an unknown owner's lock.
  }
}

export function scheduleOnlineUpdate({ target, dshHome, binPath, currentVersion }) {
  const normalized = normalizeUpdateTarget(target)
  const requestId = randomUUID()
  const paths = updaterPaths(dshHome, requestId)
  claimUpdateLock(paths.lock, requestId)
  try {
    atomicJson(paths.request, {
      schema_version: 1,
      request_id: requestId,
      target: normalized,
      current_version: currentVersion,
      requested_at: new Date().toISOString(),
    })
    const child = spawn(process.execPath, [binPath, '__update-helper', requestId], {
      detached: true,
      env: { ...process.env, DSH_HOME: dshHome, EMATE_NO_OPEN: '1' },
      stdio: 'ignore',
    })
    if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error('online update helper did not start')
    handoffUpdateLock(paths.lock, requestId, child.pid)
    child.unref()
    return { request_id: requestId, target: normalized, status: 'scheduled', helper_pid: child.pid }
  } catch (error) {
    rmSync(paths.request, { force: true })
    releaseUpdateLock(paths.lock, requestId)
    throw error
  }
}

function npmCli() {
  const candidates = process.platform === 'win32'
    ? [join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    : [join(dirname(dirname(process.execPath)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  const found = candidates.find(existsSync)
  if (found === undefined) throw new Error('npm paired with the active Node installation is unavailable')
  return found
}

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `command failed with status ${String(result.status)}`).trim())
  }
  return result.stdout
}

function runNpm(args, options = {}) {
  return runNode([npmCli(), ...args], options)
}

function stageTarget(paths, target, environment) {
  rmSync(paths.stage, { recursive: true, force: true })
  mkdirSync(paths.stage, { recursive: true })
  runNpm([
    'install', '--prefix', paths.stage, '--no-audit', '--no-fund', '--package-lock=false',
    `@e-mate/dsh@${target}`,
  ], { env: environment })
  const packageRoot = join(paths.stage, 'node_modules', '@e-mate', 'dsh')
  const manifest = readJson(join(packageRoot, 'package.json'))
  const stagedBin = join(packageRoot, 'lib', 'bin.js')
  if (manifest.name !== '@e-mate/dsh' || !VERSION_RE.test(manifest.version) || !existsSync(stagedBin)) {
    throw new Error('staged e-Mate package identity is invalid')
  }
  const checkHome = join(paths.stage, 'check-home')
  const output = runNode([stagedBin, 'setup', '--check', '--json'], {
    env: { ...environment, DSH_HOME: checkHome, EMATE_STAGING_CHECK: '1' },
  })
  const report = JSON.parse(output)
  if (report.product !== 'e-Mate' || report.version !== manifest.version || report.ok !== true) {
    throw new Error('staged e-Mate dependency closure failed its environment check')
  }
  return { version: manifest.version, stagedBin }
}

async function health(state) {
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/api/e-mate/health`, {
      signal: AbortSignal.timeout(1_000),
    })
    return response.ok ? await response.json() : undefined
  } catch {
    return undefined
  }
}

async function requireIdleManagedInstance(dshHome) {
  const statePath = join(dshHome, 'e-mate', 'run', 'instance.json')
  if (!existsSync(statePath)) return undefined
  const state = readJson(statePath)
  const current = await health(state)
  if (current?.instance_id !== state.instance_id) {
    throw new Error('managed instance identity could not be verified; update made no changes')
  }
  if (current.active_runs !== 0) {
    throw new Error(`online update refused: ${String(current.active_runs)} active run(s)`)
  }
  return state
}

function snapshotData(paths) {
  rmSync(dirname(paths.snapshot), { recursive: true, force: true })
  mkdirSync(dirname(paths.snapshot), { recursive: true })
  if (existsSync(paths.root)) cpSync(paths.root, paths.snapshot, { recursive: true, preserveTimestamps: true })
}

function restoreData(paths) {
  if (!existsSync(paths.snapshot)) return
  rmSync(paths.failedData, { recursive: true, force: true })
  if (existsSync(paths.root)) renameSync(paths.root, paths.failedData)
  cpSync(paths.snapshot, paths.root, { recursive: true, preserveTimestamps: true })
}

function writeReceipt(paths, request, fields) {
  atomicJson(paths.receipt, {
    schema_version: 1,
    product: 'e-Mate',
    request_id: request.request_id,
    requested_version: request.target,
    previous_version: request.current_version,
    ...fields,
    finished_at: new Date().toISOString(),
  })
}

export async function runOnlineUpdateHelper({ requestId, dshHome, binPath }) {
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId)) throw new Error('invalid update request id')
  const paths = updaterPaths(dshHome, requestId)
  await requireHelperUpdateLock(paths.lock, requestId)
  const request = readJson(paths.request)
  if (request.request_id !== requestId || request.schema_version !== 1) throw new Error('update request identity is invalid')
  const environment = { ...process.env, DSH_HOME: dshHome, EMATE_NO_OPEN: '1' }
  const globalPrefix = globalPrefixForBinPath(binPath)
  let staged
  let changed = false
  let previousPort
  try {
    staged = stageTarget(paths, request.target, environment)
    if (compareVersions(staged.version, request.current_version) < 0) {
      throw new Error(`online downgrade refused: ${request.current_version} -> ${staged.version}`)
    }
    runNpm(['view', `@e-mate/dsh@${request.current_version}`, 'version', '--json'], { env: environment })
    const running = await requireIdleManagedInstance(dshHome)
    previousPort = running?.port
    if (running !== undefined) runNode([binPath, 'stop'], { env: environment })
    snapshotData(paths)
    changed = true
    runNpm([
      'install', '--global', '--prefix', globalPrefix, '--no-audit', '--no-fund', `@e-mate/dsh@${staged.version}`,
    ], { env: environment })
    if (runNode([binPath, '--version'], { env: environment }).trim() !== staged.version) {
      throw new Error('activated e-Mate package version does not match the staged release')
    }
    runNode([binPath, 'setup'], { env: environment })
    runNode([binPath, 'launch', '--port', String(running?.port ?? 3080)], { env: environment })
    writeReceipt(paths, request, { status: 'completed', installed_version: staged.version })
    return { status: 'completed', version: staged.version, receipt: paths.receipt }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (changed) {
      try {
        runNpm([
          'install', '--global', '--prefix', globalPrefix, '--no-audit', '--no-fund',
          `@e-mate/dsh@${request.current_version}`,
        ], { env: environment })
        restoreData(paths)
        runNode([binPath, 'setup'], { env: environment })
        runNode([binPath, 'launch', ...(previousPort === undefined ? [] : ['--port', String(previousPort)])], { env: environment })
      } catch (rollbackError) {
        const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        writeReceipt(paths, request, { status: 'rollback-failed', error: message, rollback_error: rollback })
        throw new Error(`online update failed (${message}); rollback also failed (${rollback})`)
      }
    }
    writeReceipt(paths, request, { status: changed ? 'rolled-back' : 'failed-before-change', error: message })
    throw error
  } finally {
    rmSync(paths.stage, { recursive: true, force: true })
    rmSync(paths.request, { force: true })
    releaseUpdateLock(paths.lock, requestId)
  }
}
