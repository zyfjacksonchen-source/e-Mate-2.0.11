import {
  cpSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, posix, resolve, win32 } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const SHA512_INTEGRITY_RE = /^sha512-[A-Za-z0-9+/]{86}==$/
const SHA256_RE = /^[0-9a-f]{64}$/u
const SHA512_RE = /^[0-9a-f]{128}$/u
const RELEASE_SOURCE_COMMIT_RE = /^[0-9a-f]{40}$/u
const UPDATE_REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const PRODUCT = 'e-Mate'
const VERSION = '2.0.13'
const PACKAGE_NAME = '@e-mate/dsh'
const R2_PUBLIC_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const LATEST_STABLE_URL = `${R2_PUBLIC_ORIGIN}/desktop/latest.json`
const MANIFEST_MAX_BYTES = 1024 * 1024
const TARBALL_MAX_BYTES = 512 * 1024 * 1024

function tarballFilename(version) {
  return `e-mate-dsh-${version}.tgz`
}

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

function safeReleaseUrl(value, kind, version, sourceCommit) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`R2 release ${kind} URL is invalid`)
  }
  if (url.protocol !== 'https:' || url.origin !== R2_PUBLIC_ORIGIN || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '') throw new Error(`R2 release ${kind} URL is invalid`)
  const directory = `/npm/candidates/v${version}/${sourceCommit}`
  const expected = kind === 'manifest'
    ? `${directory}/release-manifest.json`
    : `${directory}/${tarballFilename(version)}`
  if (url.pathname !== expected) {
    throw new Error(`R2 release ${kind} URL is invalid`)
  }
  return url.href
}

export function validateReleaseSource(value) {
  if (value?.schema_version !== 1 || value.product !== PRODUCT || !VERSION_RE.test(value.version ?? '')
    || value.package_name !== PACKAGE_NAME || !RELEASE_SOURCE_COMMIT_RE.test(value.source_commit ?? '')) {
    throw new Error('embedded R2 release source is invalid')
  }
  const source = {
    schema_version: 1,
    product: PRODUCT,
    version: value.version,
    package_name: PACKAGE_NAME,
    source_commit: value.source_commit,
    manifest_url: safeReleaseUrl(value.manifest_url, 'manifest', value.version, value.source_commit),
    tarball_url: safeReleaseUrl(value.tarball_url, 'tarball', value.version, value.source_commit),
  }
  if (source.tarball_url !== new URL(tarballFilename(source.version), source.manifest_url).href) {
    throw new Error('embedded R2 release source is invalid')
  }
  return source
}

export function validateLatestReleasePointer(value) {
  if (value?.schema_version !== 1 || !VERSION_RE.test(value.version ?? '')
    || !RELEASE_SOURCE_COMMIT_RE.test(value.source_commit ?? '') || value.artifacts === null
    || typeof value.artifacts !== 'object' || Array.isArray(value.artifacts)) {
    throw new Error('latest stable e-Mate release pointer is invalid')
  }
  const prefix = `${R2_PUBLIC_ORIGIN}/desktop/releases/v${value.version}/${value.source_commit}`
  for (const [platform, filename] of [
    ['darwin', `e-Mate-${value.version}-mac-universal.dmg`],
    ['win32', `e-Mate-${value.version}-win-x64-Setup.exe`],
  ]) {
    const artifact = value.artifacts[platform]
    if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)
      || artifact.url !== `${prefix}/${filename}` || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1
      || !SHA256_RE.test(artifact.sha256 ?? '')) {
      throw new Error('latest stable e-Mate release pointer is invalid')
    }
  }
  const releasePrefix = `${R2_PUBLIC_ORIGIN}/npm/candidates/v${value.version}/${value.source_commit}`
  return validateReleaseSource({
    schema_version: 1,
    product: PRODUCT,
    version: value.version,
    package_name: PACKAGE_NAME,
    source_commit: value.source_commit,
    manifest_url: `${releasePrefix}/release-manifest.json`,
    tarball_url: `${releasePrefix}/${tarballFilename(value.version)}`,
  })
}

function currentReleaseSource() {
  return validateReleaseSource(readJson(new URL('./release-source.json', import.meta.url)))
}

export function normalizeUpdateTarget(value) {
  if (value === undefined || value === 'latest') return 'latest'
  if (!VERSION_RE.test(value)) throw new Error(`invalid update version ${JSON.stringify(value)}`)
  return value
}

export function validateStagedVersion(target, version) {
  const normalized = normalizeUpdateTarget(target)
  if (!VERSION_RE.test(version)) throw new Error('staged e-Mate package version is invalid')
  if (normalized !== 'latest' && version !== normalized) {
    throw new Error(`staged e-Mate package version ${version} does not match requested version ${normalized}`)
  }
  return version
}

export function validateUpdateRequest(request, requestId) {
  if (request?.schema_version !== 1 || request.request_id !== requestId) {
    throw new Error('update request identity is invalid')
  }
  const target = normalizeUpdateTarget(request.target)
  if (request.target !== target || typeof request.current_version !== 'string'
    || !VERSION_RE.test(request.current_version)) {
    throw new Error('update request version is invalid')
  }
  const source = validateReleaseSource(request.release_source)
  const previousSource = validateReleaseSource(request.previous_release_source)
  if (target !== 'latest' && target !== source.version) throw new Error('requested R2 release is unavailable')
  if (request.current_version !== previousSource.version) throw new Error('previous R2 release identity is invalid')
  request.release_source = source
  request.previous_release_source = previousSource
  return request
}

export function parsePackageIntegrity(output) {
  let integrity
  try {
    integrity = SHA512_INTEGRITY_RE.test(output) ? output : JSON.parse(output)
  } catch {
    throw new Error('release package integrity is invalid')
  }
  if (typeof integrity !== 'string' || !SHA512_INTEGRITY_RE.test(integrity)) {
    throw new Error('release package integrity is invalid')
  }
  return integrity
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
  const snapshotRoot = join(dshHome, 'update-snapshots', requestId)
  return {
    root,
    request: join(root, 'run', 'updates', `${requestId}.json`),
    lock: join(root, 'run', 'update.lock'),
    receipt: join(root, 'migrations', `online-update-${requestId}.json`),
    stage: join(dshHome, 'update-staging', requestId),
    snapshot: join(snapshotRoot, 'e-mate'),
    failedData: join(snapshotRoot, 'failed-e-mate'),
    targetPackage: join(snapshotRoot, 'target.tgz'),
    previousPackage: join(snapshotRoot, 'previous.tgz'),
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
  if (!UPDATE_REQUEST_ID_RE.test(requestId) || !Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
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
  const releaseSource = currentReleaseSource()
  if (normalized !== 'latest' && normalized !== releaseSource.version) {
    throw new Error('requested R2 release is unavailable')
  }
  const requestId = randomUUID()
  const paths = updaterPaths(dshHome, requestId)
  claimUpdateLock(paths.lock, requestId)
  try {
    atomicJson(paths.request, {
      schema_version: 1,
      request_id: requestId,
      target: normalized,
      current_version: currentVersion,
      release_source: releaseSource,
      previous_release_source: releaseSource,
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

async function fetchJson(url) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`R2 release manifest returned HTTP ${String(response.status)}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MANIFEST_MAX_BYTES) throw new Error('R2 release manifest is too large')
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0 || bytes.length > MANIFEST_MAX_BYTES) throw new Error('R2 release manifest is too large')
  return JSON.parse(bytes.toString('utf8'))
}

export function validateReleaseManifest(value, source, target = 'latest') {
  source = validateReleaseSource(source)
  const filename = tarballFilename(source.version)
  const item = Array.isArray(value?.packages) && value.packages.length === 1 ? value.packages[0] : undefined
  if (value?.schema_version !== 1 || value.product !== PRODUCT || value.version !== source.version
    || value.source_commit !== source.source_commit || value.download?.manifest_url !== source.manifest_url
    || value.download?.tarball_url !== source.tarball_url || item?.name !== PACKAGE_NAME
    || item.version !== source.version || item.filename !== filename || item.kind !== 'main'
    || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > TARBALL_MAX_BYTES
    || !SHA256_RE.test(item.sha256 ?? '') || !SHA512_RE.test(item.sha512 ?? '')) {
    throw new Error('R2 release manifest identity is invalid')
  }
  const integrity = parsePackageIntegrity(item.integrity)
  if (integrity !== `sha512-${Buffer.from(item.sha512, 'hex').toString('base64')}`
    || value.download.sha256 !== item.sha256 || value.download.sha512 !== item.sha512
    || value.download.integrity !== integrity || value.download.size !== item.size) {
    throw new Error('R2 release manifest integrity is invalid')
  }
  validateStagedVersion(target, item.version)
  return { ...source, filename: item.filename, size: item.size, sha256: item.sha256, sha512: item.sha512, integrity }
}

async function resolveRelease(source, target) {
  return validateReleaseManifest(await fetchJson(source.manifest_url), source, target)
}

async function resolveLatestReleaseSource() {
  return validateLatestReleasePointer(await fetchJson(LATEST_STABLE_URL))
}

async function downloadRelease(release, path) {
  mkdirSync(dirname(path), { recursive: true })
  rmSync(path, { force: true })
  const response = await fetch(release.tarball_url, { redirect: 'error', signal: AbortSignal.timeout(600_000) })
  if (!response.ok || response.body === null) throw new Error(`R2 release tarball returned HTTP ${String(response.status)}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared !== release.size) throw new Error('R2 release tarball size is invalid')
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  let size = 0
  let failure
  const descriptor = openSync(path, 'wx', 0o600)
  try {
    for await (const value of response.body) {
      const chunk = Buffer.from(value)
      size += chunk.length
      if (size > release.size || size > TARBALL_MAX_BYTES) throw new Error('R2 release tarball is too large')
      sha256.update(chunk)
      sha512.update(chunk)
      writeSync(descriptor, chunk)
    }
  } catch (error) {
    failure = error
  } finally {
    closeSync(descriptor)
  }
  if (failure !== undefined) {
    rmSync(path, { force: true })
    throw failure
  }
  const sha512Hex = sha512.digest('hex')
  if (size !== release.size || sha256.digest('hex') !== release.sha256 || sha512Hex !== release.sha512
    || `sha512-${Buffer.from(sha512Hex, 'hex').toString('base64')}` !== release.integrity) {
    rmSync(path, { force: true })
    throw new Error('R2 release tarball integrity is invalid')
  }
}

async function stageTarget(paths, request, environment) {
  rmSync(paths.stage, { recursive: true, force: true })
  mkdirSync(paths.stage, { recursive: true })
  const release = await resolveRelease(request.release_source, request.target)
  await downloadRelease(release, paths.targetPackage)
  runNpm([
    'install', '--prefix', paths.stage, '--no-audit', '--no-fund', '--package-lock=false',
    paths.targetPackage,
  ], { env: environment })
  const packageRoot = join(paths.stage, 'node_modules', '@e-mate', 'dsh')
  const manifest = readJson(join(packageRoot, 'package.json'))
  const stagedBin = join(packageRoot, 'lib', 'bin.js')
  if (manifest.name !== PACKAGE_NAME || !existsSync(stagedBin)) {
    throw new Error('staged e-Mate package identity is invalid')
  }
  validateStagedVersion(request.target, manifest.version)
  const checkHome = join(paths.stage, 'check-home')
  const output = runNode([stagedBin, 'setup', '--check', '--json'], {
    env: { ...environment, DSH_HOME: checkHome, EMATE_STAGING_CHECK: '1' },
  })
  const report = JSON.parse(output)
  if (report.product !== 'e-Mate' || report.version !== manifest.version || report.ok !== true) {
    throw new Error('staged e-Mate dependency closure failed its environment check')
  }
  return { ...release, version: manifest.version, stagedBin }
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
  rmSync(paths.snapshot, { recursive: true, force: true })
  rmSync(paths.failedData, { recursive: true, force: true })
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
  if (!UPDATE_REQUEST_ID_RE.test(requestId)) throw new Error('invalid update request id')
  const paths = updaterPaths(dshHome, requestId)
  await requireHelperUpdateLock(paths.lock, requestId)
  const request = validateUpdateRequest(readJson(paths.request), requestId)
  if (request.target === 'latest') request.release_source = await resolveLatestReleaseSource()
  const environment = { ...process.env, DSH_HOME: dshHome, EMATE_NO_OPEN: '1' }
  const globalPrefix = globalPrefixForBinPath(binPath)
  let staged
  let previous
  let previousIntegrity
  let changed = false
  let previousPort
  try {
    staged = await stageTarget(paths, request, environment)
    if (compareVersions(staged.version, request.current_version) < 0) {
      throw new Error(`online downgrade refused: ${request.current_version} -> ${staged.version}`)
    }
    previous = await resolveRelease(request.previous_release_source, request.current_version)
    if (previous.tarball_url === staged.tarball_url && previous.integrity === staged.integrity) {
      cpSync(paths.targetPackage, paths.previousPackage)
    } else {
      await downloadRelease(previous, paths.previousPackage)
    }
    previousIntegrity = previous.integrity
    const running = await requireIdleManagedInstance(dshHome)
    previousPort = running?.port
    if (running !== undefined) runNode([binPath, 'stop'], { env: environment })
    snapshotData(paths)
    changed = true
    runNpm([
      'install', '--global', '--prefix', globalPrefix, '--no-audit', '--no-fund', paths.targetPackage,
    ], { env: environment })
    if (runNode([binPath, '--version'], { env: environment }).trim() !== staged.version) {
      throw new Error('activated e-Mate package version does not match the staged release')
    }
    runNode([binPath, 'setup'], { env: environment })
    runNode([binPath, 'launch', '--port', String(running?.port ?? 3080)], { env: environment })
    writeReceipt(paths, request, {
      status: 'completed',
      installed_version: staged.version,
      installed_package_integrity: staged.integrity,
      installed_manifest_url: staged.manifest_url,
      installed_source_url: staged.tarball_url,
      previous_package_integrity: previousIntegrity,
      previous_manifest_url: previous.manifest_url,
      previous_source_url: previous.tarball_url,
    })
    return { status: 'completed', version: staged.version, receipt: paths.receipt }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (changed) {
      try {
        runNpm([
          'install', '--global', '--prefix', globalPrefix, '--no-audit', '--no-fund',
          paths.previousPackage,
        ], { env: environment })
        if (runNode([binPath, '--version'], { env: environment }).trim() !== request.current_version) {
          throw new Error('rolled-back e-Mate package version does not match the cached release')
        }
        restoreData(paths)
        runNode([binPath, 'setup'], { env: environment })
        runNode([binPath, 'launch', ...(previousPort === undefined ? [] : ['--port', String(previousPort)])], { env: environment })
      } catch (rollbackError) {
        const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        writeReceipt(paths, request, {
          status: 'rollback-failed',
          error: message,
          rollback_error: rollback,
          staged_package_integrity: staged?.integrity,
          staged_source_url: staged?.tarball_url,
          previous_package_integrity: previousIntegrity,
          previous_source_url: previous?.tarball_url,
        })
        throw new Error(`online update failed (${message}); rollback also failed (${rollback})`)
      }
    }
    writeReceipt(paths, request, {
      status: changed ? 'rolled-back' : 'failed-before-change',
      error: message,
      staged_package_integrity: staged?.integrity,
      staged_source_url: staged?.tarball_url,
      previous_package_integrity: previousIntegrity,
      previous_source_url: previous?.tarball_url,
    })
    throw error
  } finally {
    rmSync(paths.stage, { recursive: true, force: true })
    rmSync(paths.request, { force: true })
    releaseUpdateLock(paths.lock, requestId)
  }
}
