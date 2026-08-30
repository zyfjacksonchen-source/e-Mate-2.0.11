#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { classifyChangedPaths } from './change-impact.mjs'
import { pinnedPnpmInvocation, pinnedYarnInvocation } from './package-manager.mjs'
import { R2_PUBLIC_ORIGIN } from './release-source.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RUN_ROOT = join(ROOT, 'dist', 'local-runs')
const PACKAGE = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const DESKTOP_PACKAGE = JSON.parse(await readFile(join(ROOT, 'desktop', 'package.json'), 'utf8'))
const VERSION = PACKAGE.version
const PNPM_VERSION = /^pnpm@([^+]+)$/u.exec(PACKAGE.packageManager)?.[1]
const YARN_VERSION = /^yarn@([^+]+)$/u.exec(DESKTOP_PACKAGE.packageManager)?.[1]
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const SOURCE_SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const ETAG = /^[0-9a-f]{32}$/u
const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{12}-[0-9a-f]{6}$/u
const OWNER = 'existing-desktop-manifest-admission-signing-owner+codex-cloudflare-plugin'
const MANIFEST_OWNER = 'zyfjacksonchen-source/e-mate-desktop-publication@e45c3b9d1bec366ab306203574d0a7a724d7f123'
const MANIFEST_SIGNING_CONTEXT = 'e-mate-desktop-release-manifest-v2\0'
const MANIFEST_KEY_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u
const CURRENT_PUBLIC_VERSION = '2.0.15'
const CURRENT_PUBLIC_SOURCE_COMMIT = '297b90df2426137edb398b023d8137a085ed8508'
const POINTER_PREDECESSOR = Object.freeze({
  bytes: 2961,
  sha256: '838115146f74e18de0fc90e3dc586f6bd5eab706a0e6dcbc27e6ad5a79c642fb',
  etag: '61df621671e90dc90ce457494e09b295',
})
const CURRENT_PUBLIC_POINTERS = Object.freeze({
  signed: Object.freeze({ key: 'desktop/signed/latest.json' }),
  legacy: Object.freeze({ key: 'desktop/latest.json' }),
  manual: Object.freeze({ key: `desktop/manual/v${CURRENT_PUBLIC_VERSION}/latest.json` }),
})
const TRANSACTION_MODES = Object.freeze(['new-version', 'same-version-2.0.15-exception'])
const POINTER_TARGET = Object.freeze({
  artifact_path: 'desktop-release-signed.json',
  bytes: 'from-manifest-admission.signed_manifest.bytes',
  sha256: 'from-manifest-admission.signed_manifest.sha256',
  etag: 'from-conditional-write-result.etag',
})
const POINTER_RECOVERY = Object.freeze({
  accepted_current_states: Object.freeze(['exact-before', 'exact-after']),
  already_exact: 'idempotent',
  stale_etag: 'fail-closed',
  foreign_state: 'fail-closed',
  partial_activation: 'resume-ordered-prefix',
  crash_recovery: 'resume-same-request',
})
const INSTALLER_SECURITY = Object.freeze({
  darwin: Object.freeze({ code_signed: false, notarized: false }),
  win32: Object.freeze({ code_signed: false, notarized: false }),
})
export const CANDIDATE_FAILURE = Object.freeze({
  TOOLCHAIN: 'INVALID_TOOLCHAIN_BOOTSTRAP',
  SOURCE: 'SOURCE_GATE_FAILED',
  COMPONENT_ABI: 'COMPONENT_ABI_GATE_FAILED',
  PACKAGING: 'PACKAGING_FAILED',
})
const CANDIDATE_FAILURES = new Set(Object.values(CANDIDATE_FAILURE))
const FAILURE_MARKER = 'emate.local-flow-failure:'
const FULL_MATRIX = 'docs/2.0.15/REGRESSION-MATRIX.md'
const FULL_MATRIX_SCOPE = 'full-installed-startup-update-product-and-built-in-tools'
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const WINDOWS_REMOTE_HOST = 'DESKTOP-KH19ARC'
const WINDOWS_REMOTE_REQUEST = 'emate.local-windows-codex-remote-request'
const WINDOWS_REMOTE_RESULT = 'emate.local-windows-codex-remote-result'
const WINDOWS_REMOTE_RESULT_FILE = 'codex-remote-result.json'
const PLATFORMS = Object.freeze({
  macos: Object.freeze({
    artifact: `e-Mate-${VERSION}-mac-universal.dmg`,
    build: 'dist:mac-unsigned-release',
    source: 'desktop/e-mate-desktop/dist/mac-unsigned-release',
  }),
  windows: Object.freeze({
    artifact: `e-Mate-${VERSION}-win-x64-Setup.exe`,
    build: 'dist:win',
    source: 'desktop/e-mate-desktop/dist',
  }),
})
export const NPM_COLLECTOR_ARGS = Object.freeze([
  'list', '-a', '--include', 'prod', '--include', 'optional', '--omit', 'dev', '--json', '--long', '--silent', '--loglevel=error',
])
export const COMPUTER_USE_SCENARIOS = Object.freeze({
  macos: Object.freeze([
    'macos-permission-ready-current-turn',
    'macos-permission-denied',
  ]),
  windows: Object.freeze([
    'windows-native-runtime-unavailable',
  ]),
})
const POLLUTION = [
  { label: 'canary marker', ascii: /(?:emate|release|build)[-_ ]canary|canary[-_ ](?:marker|build|channel)/iu },
  { label: 'macOS developer path', ascii: /\/Users\/[A-Za-z0-9._-]+\//u, utf16: /\/\0U\0s\0e\0r\0s\0\/\0/iu },
  { label: 'Linux developer path', ascii: /\/home\/[A-Za-z0-9._-]+\//u, utf16: /\/\0h\0o\0m\0e\0\/\0/iu },
  { label: 'Windows developer path', ascii: /[A-Za-z]:\\Users\\/iu, utf16: /:\0\\\0U\0s\0e\0r\0s\0\\\0/iu },
  { label: 'private key', ascii: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
  { label: 'AWS access key', ascii: /AKIA[0-9A-Z]{16}/u },
  { label: 'API secret', ascii: /(?:sk|rk|sess)-[A-Za-z0-9_-]{20,}/u },
]

class CandidateStageError extends Error {
  constructor(category, stage, cause) {
    const message = redactLog(cause instanceof Error ? cause.message : String(cause))
    super(`${category}:${stage}: ${message}`, { cause })
    this.name = 'CandidateStageError'
    this.category = category
    this.stage = stage
    this.originalMessage = message
  }
}

export function candidateFailureDetails(cause) {
  if (!(cause instanceof CandidateStageError)) return null
  return { category: cause.category, stage: cause.stage, error: cause.originalMessage }
}

export async function runCandidateStages(stages) {
  for (const stage of stages) {
    if (!CANDIDATE_FAILURES.has(stage.category) || typeof stage.stage !== 'string' || stage.stage === '' || typeof stage.run !== 'function') {
      throw new Error('candidate stage is invalid')
    }
    try {
      await stage.run()
    } catch (cause) {
      if (cause instanceof CandidateStageError) throw cause
      throw new CandidateStageError(stage.category, stage.stage, cause)
    }
  }
}

function candidateFailureFromOutput(output) {
  const marker = output.lastIndexOf(FAILURE_MARKER)
  if (marker < 0) return null
  const line = output.slice(marker + FAILURE_MARKER.length).split('\n', 1)[0]
  try {
    const failure = JSON.parse(line)
    if (!CANDIDATE_FAILURES.has(failure?.category) || typeof failure?.stage !== 'string' || failure.stage === ''
      || typeof failure?.error !== 'string') return null
    return failure
  } catch {
    return null
  }
}

function failureOrDefault(cause, stage = 'platform-build') {
  return candidateFailureDetails(cause) ?? {
    category: CANDIDATE_FAILURE.SOURCE,
    stage,
    error: redactLog(cause instanceof Error ? cause.message : String(cause)),
  }
}

function failedPlatformState(sourceCommit, failure) {
  return {
    status: 'failed',
    source_commit: sourceCommit,
    error: `${failure.category}:${failure.stage}: ${failure.error}`,
    failure: {
      category: failure.category,
      stage: failure.stage,
      verified_product_bytes: false,
    },
  }
}

export function blockedWindowsState(sourceCommit, failure) {
  if (!SOURCE_SHA.test(sourceCommit ?? '') || !CANDIDATE_FAILURES.has(failure?.category)
    || typeof failure?.stage !== 'string' || failure.stage === '') throw new Error('blocked Windows state is invalid')
  return {
    status: 'blocked',
    source_commit: sourceCommit,
    reason: 'macos-candidate-has-no-verified-product-bytes',
    request_valid: false,
    failure: {
      category: failure.category,
      stage: failure.stage,
      verified_product_bytes: false,
    },
  }
}

function git(args, cwd = ROOT, options = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function gitZero(args, cwd = ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  return result.stdout
}

function now() {
  return new Date().toISOString()
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function fileDigest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
}

async function json(path) {
  const bytes = await readFile(path)
  if (bytes.byteLength === 0 || bytes.byteLength > 1024 * 1024) throw new Error(`invalid JSON file size: ${basename(path)}`)
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}

export async function resolveNpmCollectorCli(candidates) {
  for (const candidate of new Set(candidates)) {
    if (typeof candidate !== 'string' || !isAbsolute(candidate)) continue
    try {
      const cli = await realpath(candidate)
      const metadata = await lstat(cli)
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > 1024 * 1024
        || basename(cli) !== 'npm-cli.js' || basename(dirname(cli)) !== 'bin') continue
      const npmRoot = dirname(dirname(cli))
      if (basename(npmRoot) !== 'npm') continue
      const packageJson = await json(join(npmRoot, 'package.json'))
      if (packageJson?.name !== 'npm' || !PACKAGE_VERSION.test(packageJson.version ?? '')
        || packageJson?.bin?.npm !== 'bin/npm-cli.js') continue
      const prefix = await readFile(cli, { encoding: 'utf8' })
      if (!prefix.startsWith('#!/usr/bin/env node\n') && !prefix.startsWith('#!/usr/bin/env node\r\n')) continue
      return { cli, version: packageJson.version }
    } catch {
      // Try the next already-installed standard npm layout.
    }
  }
  throw new Error('verified npm CLI is unavailable; run flow through a Node/Corepack distribution that includes npm')
}

async function npmCollectorSource(env, execPath, platform) {
  const node = await realpath(execPath).catch(() => { throw new Error('active standalone Node executable is unavailable') })
  if (!(await lstat(node)).isFile()) throw new Error('active standalone Node executable is unavailable')
  const candidates = [platform === 'win32'
    ? join(dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : join(dirname(dirname(node)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  if (platform !== 'win32' && typeof env.COREPACK_ROOT === 'string'
    && env.COREPACK_ROOT !== '' && isAbsolute(env.COREPACK_ROOT)) {
    const corepackRoot = await realpath(env.COREPACK_ROOT).catch(() => resolve(env.COREPACK_ROOT))
    candidates.push(join(dirname(corepackRoot), 'npm', 'bin', 'npm-cli.js'))
  }
  return { node, ...await resolveNpmCollectorCli(candidates) }
}

async function verifyNpmCollectorCommand(command, prefix, expectedVersion, cwd, env) {
  const cache = await mkdtemp(join(tmpdir(), 'emate-npm-probe-'))
  const probeEnv = {
    ...env,
    NO_UPDATE_NOTIFIER: '1',
    npm_config_audit: 'false',
    npm_config_cache: cache,
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  }
  try {
    const version = spawnSync(command, [...prefix, '--version'], {
      cwd, encoding: 'utf8', env: probeEnv, maxBuffer: 16 * 1024 * 1024,
    })
    if (version.error !== undefined || version.status !== 0 || version.stdout.trim() !== expectedVersion) {
      throw new Error(`npm collector must run npm ${expectedVersion} with the active standalone Node`)
    }
    const listing = spawnSync(command, [...prefix, ...NPM_COLLECTOR_ARGS], {
      cwd, encoding: 'utf8', env: probeEnv, maxBuffer: 16 * 1024 * 1024,
    })
    if (listing.error !== undefined || ![0, 1].includes(listing.status)) {
      throw new Error('npm collector carrier cannot execute the Electron Builder npm list contract')
    }
    const tree = JSON.parse(listing.stdout)
    if (tree === null || typeof tree !== 'object' || Array.isArray(tree)) {
      throw new Error('npm collector carrier returned an invalid dependency tree')
    }
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new Error('npm collector carrier returned non-JSON output', { cause })
    throw cause
  } finally {
    await rm(cache, { recursive: true, force: true })
  }
}

export function selectWindowsNpmCommand(output, execPath) {
  const nodeDirectory = win32.dirname(win32.normalize(execPath)).toLowerCase()
  const command = String(output).split(/\r?\n/u).map(value => value.trim()).find(Boolean)
  const name = command === undefined ? '' : win32.basename(command).toLowerCase()
  if (!['npm.cmd', 'npm.exe'].includes(name)
    || win32.dirname(win32.normalize(command)).toLowerCase() !== nodeDirectory) {
    throw new Error('Windows npm.cmd must come from the same Node distribution')
  }
  return command
}

export async function verifyNpmCollectorCarrier(cwd, {
  env = process.env, execPath = process.execPath, platform = process.platform,
} = {}) {
  const source = await npmCollectorSource(env, execPath, platform)
  await verifyNpmCollectorCommand(source.node, [source.cli], source.version, cwd, env)
  if (platform === 'win32') {
    const located = spawnSync('where.exe', ['npm'], { encoding: 'utf8', env })
    if (located.error !== undefined || located.status !== 0) {
      throw new Error('Windows npm.cmd is unavailable for the Electron Builder collector')
    }
    selectWindowsNpmCommand(located.stdout, source.node)
  }
  return source
}

export async function prepareNpmCollectorCarrier(cwd, options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const source = await verifyNpmCollectorCarrier(cwd, { ...options, env, platform })
  if (platform === 'win32') return { ...source, env, cleanup: async () => {} }

  const directory = await mkdtemp(join(tmpdir(), 'emate-npm-collector-'))
  try {
    const npm = join(directory, 'npm')
    const node = join(directory, 'node')
    await symlink(source.cli, npm)
    await symlink(source.node, node)
    if (await realpath(npm) !== source.cli || await realpath(node) !== source.node) {
      throw new Error('npm collector shim target drifted')
    }
    const carrierEnv = { ...env, PATH: `${directory}${env.PATH ? `${delimiter}${env.PATH}` : ''}` }
    await verifyNpmCollectorCommand(npm, [], source.version, cwd, carrierEnv)
    return {
      ...source,
      directory,
      env: carrierEnv,
      cleanup: async () => rm(directory, { recursive: true, force: true }),
    }
  } catch (cause) {
    await rm(directory, { recursive: true, force: true })
    throw cause
  }
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => key in value)
}

function sameRecord(value, expected) {
  return exactKeys(value, Object.keys(expected))
    && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue)
}

export function validateCandidateSource({ branch, head, status }) {
  if (typeof branch !== 'string' || branch === '' || branch === 'HEAD') throw new Error('candidate source must be on one named local branch')
  if (!SOURCE_SHA.test(head ?? '')) throw new Error('candidate source SHA must be one full lowercase commit')
  if (status !== '') throw new Error('candidate source must be committed and clean')
  return { branch, source_commit: head }
}

function sourceIdentity(root = ROOT) {
  return validateCandidateSource({
    branch: git(['symbolic-ref', '--quiet', '--short', 'HEAD'], root),
    head: git(['rev-parse', 'HEAD'], root),
    status: git(['status', '--porcelain=v1', '--untracked-files=all'], root),
  })
}

export function validateRemoteHostname(value) {
  const received = String(value).trim()
  if (received !== WINDOWS_REMOTE_HOST) throw new Error(`Codex Remote hostname must be ${WINDOWS_REMOTE_HOST}; received ${received || '<empty>'}`)
  return received
}

export function windowsRemoteRequest(run) {
  if (!RUN_ID.test(run?.run_id ?? '') || run?.version !== VERSION || !SOURCE_SHA.test(run?.source_commit ?? '')
    || typeof run?.source_branch !== 'string' || run.source_branch === '' || run.source_branch === 'HEAD') {
    throw new Error('Windows Codex Remote request source is invalid')
  }
  return {
    schema_version: 1,
    document_type: WINDOWS_REMOTE_REQUEST,
    transport: 'codex-remote-handoff',
    run_id: run.run_id,
    version: VERSION,
    platform: 'windows',
    source_commit: run.source_commit,
    source_branch: run.source_branch,
    source_status: 'committed-clean',
    expected_host: WINDOWS_REMOTE_HOST,
    expected_artifact: PLATFORMS.windows.artifact,
    build: {
      command: 'corepack.cmd',
      arguments: [
        'pnpm', 'run', 'flow', '--', '_platform-build', '--platform', 'windows',
        '--out', '<return-directory>', '--source-commit', run.source_commit,
        '--remote-request', '<request-file>',
      ],
    },
    return: {
      directory: '<return-directory>',
      receipt: WINDOWS_REMOTE_RESULT_FILE,
      artifacts: 'artifacts/windows',
      log: 'windows.log',
      import: {
        command: 'corepack',
        arguments: [
          'pnpm', 'run', 'flow', '--', 'candidate', '--run', run.run_id,
          '--windows-result', '<return-directory>',
        ],
      },
    },
  }
}

function validateWindowsRemoteRequest(value, run = value) {
  let expected
  try { expected = windowsRemoteRequest(run) } catch {}
  if (expected === undefined || !isDeepStrictEqual(value, expected)) throw new Error('Windows Codex Remote request is invalid')
  return value
}

function candidateState(run, platform) {
  return run.platforms?.[platform]
}

export function selectCandidatePlatforms(run, retry = 'all') {
  if (!['all', 'macos', 'windows'].includes(retry)) throw new Error('candidate --retry must be all, macos, or windows')
  const requested = retry === 'all' ? Object.keys(PLATFORMS) : [retry]
  const build = []
  const reuse = []
  for (const platform of requested) {
    const state = candidateState(run, platform)
    if (state?.source_commit === run.source_commit && ['passed', 'reused'].includes(state.status)) reuse.push(platform)
    else build.push(platform)
  }
  return { build, reuse }
}

function validateWindowsUnavailable(value, sourceCommit) {
  if (!exactKeys(value, [
    'status', 'verification', 'source_commit', 'tested', 'reason', 'request', 'request_sha256',
  ]) || value.status !== 'REMOTE_UNAVAILABLE' || value.verification !== 'UNVERIFIED'
    || value.source_commit !== sourceCommit || value.tested !== false
    || value.reason !== 'windows-remote-unavailable'
    || value.request !== 'windows-remote/request.json' || !SHA256.test(value.request_sha256 ?? '')) {
    throw new Error('Windows must remain REMOTE_UNAVAILABLE/UNVERIFIED')
  }
  return value
}

export function markWindowsUnavailable(run) {
  const current = run.platforms?.windows
  if (!exactKeys(current, ['status', 'source_commit', 'request', 'request_sha256'])
    || current.status !== 'awaiting-codex-remote' || current.source_commit !== run.source_commit
    || current.request !== 'windows-remote/request.json' || !SHA256.test(current.request_sha256 ?? '')) {
    throw new Error('Windows unavailable waiver requires the exact awaiting request state')
  }
  return {
    status: 'REMOTE_UNAVAILABLE',
    verification: 'UNVERIFIED',
    source_commit: run.source_commit,
    tested: false,
    reason: 'windows-remote-unavailable',
    request: current.request,
    request_sha256: current.request_sha256,
  }
}

function runId(sourceCommit) {
  return `${now().replaceAll(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z')}-${sourceCommit.slice(0, 12)}-${randomBytes(3).toString('hex')}`
}

function relativePath(root, path) {
  return relative(root, path).split(sep).join('/')
}

async function regularFile(path, label = basename(path)) {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) throw new Error(`${label} must be a non-empty regular file`)
  return metadata
}

function pendingComputerUse(platform, sourceCommit, artifactSha256 = null) {
  return {
    schema_version: 1,
    document_type: 'emate.local-computer-use-receipt',
    platform,
    status: 'pending',
    data_policy: 'synthetic-test-data-only',
    source_commit: sourceCommit,
    artifact_sha256: artifactSha256,
    scenarios: platform === 'windows'
      ? [{ id: 'windows-native-runtime-unavailable', status: 'not_applicable', disposition: 'allowed_unavailable' }]
      : COMPUTER_USE_SCENARIOS[platform].map(id => ({ id, status: 'pending' })),
    screenshots: [],
    external_acceptance: null,
  }
}

async function writeComputerUseTemplates(directory, sourceCommit, artifacts = {}) {
  await atomicJson(join(directory, 'computer-use', 'scenarios.json'), {
    schema_version: 1,
    document_type: 'emate.local-computer-use-scenarios',
    data_policy: 'synthetic-test-data-only',
    source_commit: sourceCommit,
    platforms: COMPUTER_USE_SCENARIOS,
  })
  for (const platform of Object.keys(PLATFORMS)) {
    const root = join(directory, 'computer-use', platform)
    await mkdir(join(root, 'screenshots'), { recursive: true })
    const path = join(root, 'result.json')
    let current
    try { current = await json(path) } catch {}
    if (current?.status === 'passed') continue
    await atomicJson(path, pendingComputerUse(platform, sourceCommit, artifacts[platform]?.sha256 ?? null))
  }
}

async function createRun(command, identity, extra = {}) {
  await mkdir(RUN_ROOT, { recursive: true })
  const id = runId(identity.source_commit)
  const directory = join(RUN_ROOT, id)
  await mkdir(directory)
  await mkdir(join(directory, 'logs'), { recursive: true })
  await writeComputerUseTemplates(directory, identity.source_commit)
  const run = {
    schema_version: 1,
    document_type: 'emate.local-flow-run',
    run_id: id,
    command,
    version: VERSION,
    source_commit: identity.source_commit,
    source_branch: identity.branch,
    created_at: now(),
    updated_at: now(),
    ...extra,
  }
  await saveRun(directory, run)
  await writeChecksums(directory)
  return { directory, run }
}

async function saveRun(directory, run) {
  run.updated_at = now()
  await atomicJson(join(directory, 'run.json'), run)
}

async function loadRun(id) {
  if (!RUN_ID.test(id ?? '')) throw new Error('invalid --run id')
  const directory = join(RUN_ROOT, id)
  const run = await json(join(directory, 'run.json'))
  if (run.run_id !== id || run.version !== VERSION || !SOURCE_SHA.test(run.source_commit ?? '')) throw new Error('local flow run identity is invalid')
  return { directory, run }
}

async function allFiles(root, directory = root) {
  const files = []
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`run output contains a symlink: ${relativePath(root, path)}`)
    if (entry.isDirectory()) files.push(...await allFiles(root, path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`run output contains a non-file entry: ${relativePath(root, path)}`)
  }
  return files
}

async function writeChecksums(directory) {
  const files = (await allFiles(directory)).filter(path => relativePath(directory, path) !== 'SHA256SUMS')
  const rows = []
  for (const path of files) rows.push(`${await fileDigest(path)}  ${relativePath(directory, path)}`)
  await writeFile(join(directory, 'SHA256SUMS'), `${rows.join('\n')}${rows.length === 0 ? '' : '\n'}`, { mode: 0o600 })
}

async function runLogged(command, args, { cwd, log, env = process.env }) {
  await mkdir(dirname(log), { recursive: true })
  const output = createWriteStream(log, { flags: 'a', mode: 0o600 })
  let tail = ''
  const record = chunk => { tail = `${tail}${redactLog(chunk.toString('utf8'))}`.slice(-32 * 1024) }
  output.write(`$ ${redactLog([command, ...args].join(' '))}\n`)
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => { record(chunk); output.write(redactLog(chunk.toString('utf8'))); process.stdout.write(chunk) })
    child.stderr.on('data', chunk => { record(chunk); output.write(redactLog(chunk.toString('utf8'))); process.stderr.write(chunk) })
    child.on('error', cause => { output.end(); rejectPromise(cause) })
    child.on('close', code => {
      output.end(() => {
        if (code === 0) resolvePromise()
        else {
          const failure = candidateFailureFromOutput(tail)
          rejectPromise(failure === null
            ? new Error(`${command} ${args.join(' ')} exited with ${String(code)}`)
            : new CandidateStageError(failure.category, failure.stage, new Error(failure.error)))
        }
      })
    })
  })
}

function redactLog(value) {
  return String(value)
    .replace(/\/Users\/[^/\s]+/gu, '<local-user>')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/giu, '<local-user>')
    .replace(/(?:sk|rk|sess)-[A-Za-z0-9_-]{20,}/gu, '<redacted-secret>')
}

function pnpmInvocation(args, env = process.env) {
  if (PNPM_VERSION === undefined) throw new Error(`unsupported packageManager: ${String(PACKAGE.packageManager)}`)
  return pinnedPnpmInvocation(PNPM_VERSION, args, { env })
}

function assertPinnedPnpm() {
  pnpmInvocation([])
}

function checkedSync(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

async function candidatePreflight() {
  let identity
  await runCandidateStages([
    { category: CANDIDATE_FAILURE.TOOLCHAIN, stage: 'pinned-package-manager', run: assertPinnedPnpm },
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'desktop-npm-collector',
      run: () => verifyNpmCollectorCarrier(join(ROOT, 'desktop')),
    },
    {
      category: CANDIDATE_FAILURE.SOURCE,
      stage: 'release-boundary',
      run: () => checkedSync(process.execPath, ['scripts/change-impact.mjs', '--check-contract']),
    },
    { category: CANDIDATE_FAILURE.SOURCE, stage: 'clean-source-identity', run: () => { identity = sourceIdentity() } },
  ])
  return identity
}

async function runPnpm(args, options) {
  const env = options.env ?? process.env
  const invocation = pnpmInvocation(args, env)
  return runLogged(invocation.command, invocation.args, { ...options, env })
}

async function runYarn(args, options) {
  if (PNPM_VERSION === undefined || YARN_VERSION === undefined) {
    throw new Error(`unsupported packageManager pair: ${String(PACKAGE.packageManager)}, ${String(DESKTOP_PACKAGE.packageManager)}`)
  }
  const env = options.env ?? process.env
  const invocation = pinnedYarnInvocation(PNPM_VERSION, YARN_VERSION, args, { env })
  return runLogged(invocation.command, invocation.args, { ...options, env })
}

function changedPaths() {
  const paths = new Set()
  const base = (() => {
    try { return git(['merge-base', 'origin/main', 'HEAD']) } catch { return git(['rev-parse', 'HEAD']) }
  })()
  for (const value of gitZero(['diff', '--name-only', '-z', '--diff-filter=ACDMRTUXB', base, 'HEAD', '--']).split('\0')) if (value !== '') paths.add(value)
  for (const value of gitZero(['diff', '--name-only', '-z', '--diff-filter=ACDMRTUXB', '--']).split('\0')) if (value !== '') paths.add(value)
  for (const value of gitZero(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACDMRTUXB', '--']).split('\0')) if (value !== '') paths.add(value)
  for (const value of gitZero(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')) if (value !== '') paths.add(value)
  return [...paths].sort()
}

function addCheck(checks, command, args) {
  const key = JSON.stringify([command, args])
  if (!checks.some(item => item.key === key)) checks.push({ key, command, args })
}

export function devChecks(plan, paths) {
  const checks = []
  const localFlowOnly = paths.length > 0 && paths.every(path => [
    'package.json', 'scripts/local-flow.mjs', 'scripts/local-flow.test.mjs', 'docs/development-log.md',
  ].includes(path))
  if (localFlowOnly || paths.some(path => path.startsWith('scripts/local-flow'))) {
    addCheck(checks, 'node', ['--test', 'scripts/local-flow.test.mjs'])
  }
  if (localFlowOnly) {
    addCheck(checks, 'node', ['scripts/change-impact.mjs', '--check-contract'])
  } else if (plan.lane === 'docs-only' || plan.lane === 'none') {
    addCheck(checks, 'node', ['scripts/change-impact.mjs', '--check-contract'])
  } else if (plan.lane === 'plugin-only') {
    for (const component of plan.components) addCheck(checks, 'node', ['scripts/component-run.mjs', 'check', '--component', component])
  } else if (plan.lane === 'enterprise-only') {
    addCheck(checks, 'pnpm', ['run', 'enterprise:test'])
  } else if (plan.lane === 'verification-only') {
    const tests = paths.filter(path => path.startsWith('scripts/') && path.endsWith('.test.mjs'))
    if (tests.length > 0) addCheck(checks, 'node', ['--test', ...tests])
    else addCheck(checks, 'node', ['scripts/change-impact.mjs', '--check-contract'])
  } else {
    addCheck(checks, 'pnpm', ['run', 'test:fast'])
  }
  return checks.map(({ command, args }) => ({ command, args }))
}

function affectedComputerUse(plan) {
  const selected = new Set()
  if (plan.macos_runtime || plan.macos_packaging || plan.shared_runtime || plan.profile) {
    for (const scenario of COMPUTER_USE_SCENARIOS.macos) selected.add(`macos:${scenario}`)
  }
  if (plan.windows_runtime || plan.windows_packaging || plan.shared_runtime || plan.profile) {
    for (const scenario of COMPUTER_USE_SCENARIOS.windows) selected.add(`windows:${scenario}`)
  }
  return [...selected].sort()
}

async function dev() {
  const paths = changedPaths()
  const plan = paths.length === 0
    ? { lane: 'none', contract: { valid: true }, changed_paths: [], classifications: [] }
    : classifyChangedPaths(paths, { root: ROOT })
  if (plan.contract?.valid !== true) throw new Error(plan.contract?.errors?.join('\n') || 'release boundary is invalid')
  const identity = {
    branch: (() => { try { return git(['symbolic-ref', '--quiet', '--short', 'HEAD']) } catch { return 'detached' } })(),
    source_commit: git(['rev-parse', 'HEAD']),
  }
  const checks = devChecks(plan, paths)
  const scenarios = affectedComputerUse(plan)
  const { directory, run } = await createRun('dev', identity, {
    status: 'running', impact: plan, checks, affected_computer_use: scenarios,
  })
  const log = join(directory, 'logs', 'dev.log')
  try {
    for (const check of checks) {
      if (check.command === 'pnpm') await runPnpm(check.args, { cwd: ROOT, log })
      else await runLogged(process.execPath, check.args, { cwd: ROOT, log })
    }
    run.status = 'passed'
  } catch (cause) {
    run.status = 'failed'
    run.error = cause instanceof Error ? cause.message : String(cause)
    throw cause
  } finally {
    await saveRun(directory, run)
    await writeChecksums(directory)
  }
  process.stdout.write(`${JSON.stringify({ run_id: run.run_id, checks, computer_use: scenarios }, null, 2)}\n`)
}

function submodules(root) {
  const output = git(['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], root)
  return output.split('\n').map(row => {
    const split = row.indexOf(' ')
    const key = row.slice(0, split)
    const path = row.slice(split + 1)
    const name = key.slice('submodule.'.length, -'.path'.length)
    const url = git(['config', '-f', '.gitmodules', '--get', `submodule.${name}.url`], root)
    const tree = git(['ls-tree', 'HEAD', '--', path], root)
    const commit = /^160000 commit ([0-9a-f]{40})\t/u.exec(tree)?.[1]
    if (commit === undefined) throw new Error(`submodule gitlink is invalid: ${path}`)
    return { name, path, url, commit }
  })
}

function worktrees(root) {
  return git(['worktree', 'list', '--porcelain'], root).split('\n')
    .filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length))
}

function findSubmoduleSeed(root, module) {
  for (const worktree of worktrees(root)) {
    const candidate = join(worktree, module.path)
    try {
      if (git(['rev-parse', 'HEAD'], candidate) === module.commit) return candidate
    } catch {}
  }
  throw new Error(`no local checkout contains submodule ${module.path}@${module.commit}`)
}

async function cleanSourceCopy(root, destination, identity, log) {
  await runLogged('git', [
    '-c', 'protocol.file.allow=always', 'clone', '--depth', '1', '--no-tags', '--single-branch',
    '--branch', identity.branch, pathToFileURL(root).href, destination,
  ], { cwd: dirname(destination), log })
  if (git(['rev-parse', 'HEAD'], destination) !== identity.source_commit) throw new Error('clean source copy did not resolve the requested commit')
  const remote = git(['remote', 'get-url', 'origin'], root)
  git(['remote', 'set-url', 'origin', remote], destination)
  for (const module of submodules(destination)) {
    const seed = findSubmoduleSeed(root, module)
    git(['config', `submodule.${module.name}.url`, pathToFileURL(seed).href], destination)
    await runLogged('git', [
      '-c', 'protocol.file.allow=always', '-C', destination,
      'submodule', 'update', '--init', '--depth', '1', '--', module.path,
    ], { cwd: destination, log })
    git(['config', `submodule.${module.name}.url`, module.url], destination)
    git(['remote', 'set-url', 'origin', module.url], join(destination, module.path))
    if (git(['rev-parse', 'HEAD'], join(destination, module.path)) !== module.commit) throw new Error(`submodule source drifted: ${module.path}`)
  }
  const status = git(['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'], destination)
  if (status !== '') throw new Error(`clean source copy is dirty:\n${status}`)
  const gitDirectories = [join(destination, '.git'), ...submodules(destination).map(module => (
    resolve(join(destination, module.path), git(['rev-parse', '--git-dir'], join(destination, module.path)))
  ))]
  for (const gitDirectory of gitDirectories) {
    await rm(join(gitDirectory, 'logs'), { recursive: true, force: true })
    await rm(join(gitDirectory, 'FETCH_HEAD'), { force: true })
  }
  for (const path of gitDirectories.map(directory => join(directory, 'config'))) {
    const content = await readFile(path, 'utf8')
    if (/\/Users\/|[A-Za-z]:\\Users\\/u.test(content)) throw new Error(`clean source git config leaked a developer path: ${relativePath(destination, path)}`)
  }
}

export function assertCleanArtifactBytes(bytes, label) {
  const ascii = bytes.toString('latin1')
  for (const pattern of POLLUTION) {
    if (pattern.ascii?.test(ascii) || pattern.utf16?.test(ascii)) throw new Error(`${label} contains forbidden ${pattern.label}`)
  }
}

async function verifyArtifactFormat(path, size, platform) {
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(Math.min(size, 64))
    await file.read(header, 0, header.byteLength, 0)
    if (platform === 'windows') {
      const offset = header.byteLength >= 64 ? header.readUInt32LE(0x3c) : -1
      const signature = Buffer.alloc(4)
      if (offset >= 0 && offset + signature.byteLength <= size) await file.read(signature, 0, signature.byteLength, offset)
      if (header.subarray(0, 2).toString('ascii') !== 'MZ' || offset < 0 || offset + signature.byteLength > size
        || signature.toString('hex') !== '50450000') throw new Error('Windows artifact is not PE')
      return
    }
    const trailer = Buffer.alloc(Math.min(size, 512))
    await file.read(trailer, 0, trailer.byteLength, size - trailer.byteLength)
    if (trailer.byteLength < 512 || trailer.subarray(0, 4).toString('ascii') !== 'koly') throw new Error('macOS artifact is not UDIF')
  } finally {
    await file.close()
  }
}

async function cleanDigest(path, label) {
  const hash = createHash('sha256')
  let carry = Buffer.alloc(0)
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk)
    const scanned = carry.byteLength === 0 ? chunk : Buffer.concat([carry, chunk])
    assertCleanArtifactBytes(scanned, label)
    carry = scanned.subarray(Math.max(0, scanned.byteLength - 256))
  }
  return hash.digest('hex')
}

async function artifactDescriptor(path, platform) {
  const metadata = await regularFile(path, `${platform} artifact`)
  await verifyArtifactFormat(path, metadata.size, platform)
  return { name: basename(path), bytes: metadata.size, sha256: await cleanDigest(path, `${platform} artifact`) }
}

async function exportArtifact(sourceRoot, platform, output, sourceCommit) {
  const config = PLATFORMS[platform]
  const source = join(sourceRoot, ...config.source.split('/'), config.artifact)
  const descriptor = await artifactDescriptor(source, platform)
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  await copyFile(source, join(output, config.artifact))
  const blockmap = `${source}.blockmap`
  const files = [descriptor]
  let blockmapMetadata
  try {
    blockmapMetadata = await regularFile(blockmap, `${platform} blockmap`)
  } catch (cause) {
    if (cause?.code !== 'ENOENT') throw cause
  }
  if (blockmapMetadata !== undefined) {
    await copyFile(blockmap, join(output, basename(blockmap)))
    files.push({ name: basename(blockmap), bytes: blockmapMetadata.size, sha256: await cleanDigest(blockmap, `${platform} blockmap`) })
  }
  files.sort((left, right) => left.name.localeCompare(right.name))
  await atomicJson(join(output, 'local-artifact-receipt.json'), {
    schema_version: 1,
    document_type: 'emate.local-desktop-artifact',
    platform,
    source_commit: sourceCommit,
    version: VERSION,
    files,
  })
}

export async function verifyLocalArtifact(directory, platform, sourceCommit) {
  const config = PLATFORMS[platform]
  if (config === undefined || !SOURCE_SHA.test(sourceCommit ?? '')) throw new Error('local artifact identity is invalid')
  const receipt = await json(join(directory, 'local-artifact-receipt.json'))
  if (!exactKeys(receipt, ['schema_version', 'document_type', 'platform', 'source_commit', 'version', 'files'])
    || receipt.schema_version !== 1 || receipt.document_type !== 'emate.local-desktop-artifact'
    || receipt.platform !== platform || receipt.source_commit !== sourceCommit || receipt.version !== VERSION
    || !Array.isArray(receipt.files) || ![1, 2].includes(receipt.files.length)) throw new Error(`${platform} artifact receipt is invalid`)
  const expectedNames = [config.artifact, ...(receipt.files.some(file => file?.name === `${config.artifact}.blockmap`) ? [`${config.artifact}.blockmap`] : []), 'local-artifact-receipt.json'].sort()
  const actualNames = (await readdir(directory)).sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) throw new Error(`${platform} artifact directory contains an unexpected file`)
  let primary
  for (const descriptor of receipt.files) {
    if (!exactKeys(descriptor, ['name', 'bytes', 'sha256']) || basename(descriptor.name ?? '') !== descriptor.name
      || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes <= 0 || !SHA256.test(descriptor.sha256 ?? '')) {
      throw new Error(`${platform} artifact file receipt is invalid`)
    }
    const path = join(directory, descriptor.name)
    const actual = descriptor.name === config.artifact
      ? await artifactDescriptor(path, platform)
      : { name: descriptor.name, bytes: (await regularFile(path)).size, sha256: await cleanDigest(path, `${platform} blockmap`) }
    if (actual.bytes !== descriptor.bytes || actual.sha256 !== descriptor.sha256) throw new Error(`${platform} artifact drifted: ${descriptor.name}`)
    if (descriptor.name === config.artifact) primary = actual
  }
  if (primary === undefined) throw new Error(`${platform} primary artifact is missing`)
  return { receipt, primary }
}

async function platformBuild(sourceRoot, platform, output, log) {
  const expectedPlatform = platform === 'macos' ? 'darwin' : 'win32'
  let npmCollector
  await runCandidateStages([
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'native-platform',
      run: () => {
        if (process.platform !== expectedPlatform) throw new Error(`${platform} candidate must build on native ${expectedPlatform}`)
        if (platform === 'windows') validateRemoteHostname(hostname())
      },
    },
    { category: CANDIDATE_FAILURE.TOOLCHAIN, stage: 'pinned-package-manager', run: assertPinnedPnpm },
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'desktop-npm-collector',
      run: async () => { npmCollector = await prepareNpmCollectorCarrier(join(sourceRoot, 'desktop')) },
    },
    {
      category: CANDIDATE_FAILURE.SOURCE,
      stage: 'release-boundary',
      run: () => runLogged(process.execPath, ['scripts/change-impact.mjs', '--check-contract'], { cwd: sourceRoot, log }),
    },
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'root-install',
      run: () => runPnpm(['install', '--frozen-lockfile'], { cwd: sourceRoot, log }),
    },
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'harness-install',
      run: () => runPnpm(['--dir', 'upstream/deepseek-harness', 'install', '--frozen-lockfile'], {
        cwd: sourceRoot, log, env: { ...process.env, CI: 'true' },
      }),
    },
    {
      category: CANDIDATE_FAILURE.SOURCE,
      stage: 'harness-host-client-web',
      run: () => runPnpm(['run', 'build:harness'], { cwd: sourceRoot, log }),
    },
    {
      category: CANDIDATE_FAILURE.COMPONENT_ABI,
      stage: 'component-emitted-abi',
      run: () => runLogged(process.execPath, ['scripts/component-run.mjs', 'build'], { cwd: sourceRoot, log }),
    },
    {
      category: CANDIDATE_FAILURE.SOURCE,
      stage: 'profile-build',
      run: () => runPnpm(['--filter', '@e-mate/dsh', 'build'], { cwd: sourceRoot, log }),
    },
    {
      category: CANDIDATE_FAILURE.PACKAGING,
      stage: 'native-runtime-inputs',
      run: () => runLogged(platform === 'macos' ? 'python3' : 'python', [
        'packages/dsh-plugin-vision-toolkit/scripts/prepare-wheels.py',
        '--root', 'packages/dsh-plugin-vision-toolkit',
        '--targets', platform === 'macos' ? 'darwin-arm64,darwin-x64' : 'win32-x64',
      ], { cwd: sourceRoot, log }),
    },
    {
      category: CANDIDATE_FAILURE.PACKAGING,
      stage: 'desktop-install',
      run: () => runYarn(['install', '--immutable'], { cwd: join(sourceRoot, 'desktop'), log, env: npmCollector.env }),
    },
    {
      category: CANDIDATE_FAILURE.PACKAGING,
      stage: 'desktop-package',
      run: () => runYarn([PLATFORMS[platform].build], { cwd: join(sourceRoot, 'desktop'), log, env: npmCollector.env }),
    },
    {
      category: CANDIDATE_FAILURE.PACKAGING,
      stage: 'artifact-export',
      run: () => exportArtifact(sourceRoot, platform, output, git(['rev-parse', 'HEAD'], sourceRoot)),
    },
  ]).finally(() => npmCollector?.cleanup())
}

async function readWindowsRemoteRequest(path, run) {
  const metadata = await regularFile(path, 'Windows Codex Remote request')
  if (metadata.size > 1024 * 1024) throw new Error('Windows Codex Remote request is too large')
  const bytes = await readFile(path)
  assertCleanArtifactBytes(bytes, 'Windows Codex Remote request')
  const request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  return { bytes, request: validateWindowsRemoteRequest(request, run ?? request) }
}

function windowsRemoteResult(request, verified, requestSha256, artifactReceiptSha256, host, log) {
  if (!SHA256.test(requestSha256 ?? '') || !SHA256.test(artifactReceiptSha256 ?? '')) {
    throw new Error('Windows Codex Remote result digest is invalid')
  }
  if (!exactKeys(log, ['file', 'bytes', 'sha256']) || log.file !== 'windows.log'
    || !Number.isSafeInteger(log.bytes) || log.bytes <= 0 || !SHA256.test(log.sha256 ?? '')) {
    throw new Error('Windows Codex Remote log receipt is invalid')
  }
  return {
    schema_version: 1,
    document_type: WINDOWS_REMOTE_RESULT,
    transport: 'codex-remote-handoff',
    run_id: request.run_id,
    version: VERSION,
    platform: 'windows',
    host: validateRemoteHostname(host),
    source_commit: request.source_commit,
    request_sha256: requestSha256,
    artifact_receipt: {
      file: 'artifacts/windows/local-artifact-receipt.json',
      sha256: artifactReceiptSha256,
    },
    log,
    files: verified.receipt.files,
  }
}

async function windowsRemoteLog(directory) {
  const path = join(directory, 'windows.log')
  const metadata = await regularFile(path, 'Windows Codex Remote build log')
  return { path, descriptor: { file: 'windows.log', bytes: metadata.size, sha256: await cleanDigest(path, 'Windows Codex Remote build log') } }
}

async function writeWindowsRemoteResult(directory, requestPath) {
  const { bytes, request } = await readWindowsRemoteRequest(requestPath)
  const artifacts = join(directory, 'artifacts', 'windows')
  const verified = await verifyLocalArtifact(artifacts, 'windows', request.source_commit)
  const receiptPath = join(artifacts, 'local-artifact-receipt.json')
  const log = await windowsRemoteLog(directory)
  await atomicJson(join(directory, WINDOWS_REMOTE_RESULT_FILE), windowsRemoteResult(
    request, verified, digest(bytes), await fileDigest(receiptPath), hostname(), log.descriptor,
  ))
}

async function prepareWindowsRemote(directory, run) {
  const path = join(directory, 'windows-remote', 'request.json')
  await atomicJson(path, windowsRemoteRequest(run))
  run.platforms.windows = {
    status: 'awaiting-codex-remote',
    source_commit: run.source_commit,
    request: relativePath(directory, path),
    request_sha256: await fileDigest(path),
  }
}

export async function blockWindowsRemote(directory, run, failure) {
  if (['passed', 'reused'].includes(run.platforms?.windows?.status)) return
  await rm(join(directory, 'windows-remote'), { recursive: true, force: true })
  await rm(join(directory, 'artifacts', 'windows'), { recursive: true, force: true })
  run.platforms.windows = blockedWindowsState(run.source_commit, failure)
}

export async function importWindowsRemoteResult(resultDirectory, output, run, requestPath) {
  const { bytes: requestBytes, request } = await readWindowsRemoteRequest(requestPath, run)
  if (!isDeepStrictEqual(run.platforms?.windows, {
    status: 'awaiting-codex-remote',
    source_commit: run.source_commit,
    request: 'windows-remote/request.json',
    request_sha256: digest(requestBytes),
  })) throw new Error('Windows Codex Remote import requires the exact awaiting request state')
  const rootEntries = (await readdir(resultDirectory)).sort()
  if (!isDeepStrictEqual(rootEntries, ['artifacts', WINDOWS_REMOTE_RESULT_FILE, 'windows.log'])) {
    throw new Error('Windows Codex Remote result directory contains an unexpected entry')
  }
  const artifactRoot = join(resultDirectory, 'artifacts')
  const artifactRootMetadata = await lstat(artifactRoot)
  if (!artifactRootMetadata.isDirectory() || artifactRootMetadata.isSymbolicLink()
    || !isDeepStrictEqual(await readdir(artifactRoot), ['windows'])) {
    throw new Error('Windows Codex Remote artifact root is invalid')
  }
  const artifacts = join(artifactRoot, 'windows')
  const artifactDirectory = await lstat(artifacts)
  if (!artifactDirectory.isDirectory() || artifactDirectory.isSymbolicLink()) {
    throw new Error('Windows Codex Remote artifact directory is invalid')
  }
  const verified = await verifyLocalArtifact(artifacts, 'windows', run.source_commit)
  const artifactReceiptPath = join(artifacts, 'local-artifact-receipt.json')
  const resultPath = join(resultDirectory, WINDOWS_REMOTE_RESULT_FILE)
  const resultMetadata = await regularFile(resultPath, 'Windows Codex Remote result receipt')
  if (resultMetadata.size > 1024 * 1024) throw new Error('Windows Codex Remote result receipt is too large')
  const resultBytes = await readFile(resultPath)
  assertCleanArtifactBytes(resultBytes, 'Windows Codex Remote result receipt')
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(resultBytes))
  const log = await windowsRemoteLog(resultDirectory)
  const expected = windowsRemoteResult(
    request, verified, digest(requestBytes), await fileDigest(artifactReceiptPath), result?.host, log.descriptor,
  )
  if (!isDeepStrictEqual(result, expected)) throw new Error('Windows Codex Remote result receipt is invalid')

  const staging = `${output}.importing-${randomBytes(4).toString('hex')}`
  try {
    await mkdir(staging, { recursive: true })
    for (const name of await readdir(artifacts)) await copyFile(join(artifacts, name), join(staging, name))
    const imported = await verifyLocalArtifact(staging, 'windows', run.source_commit)
    await rm(output, { recursive: true, force: true })
    await rename(staging, output)
    return { receipt: result, receipt_path: resultPath, log_path: log.path, primary: imported.primary }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function candidate(values) {
  const identity = await candidatePreflight()
  if (values.run === undefined && values.retry !== undefined && values.retry !== 'all') {
    throw new Error('a new candidate must attempt both platforms; --retry selects a failed platform only with --run')
  }
  const loaded = values.run === undefined
    ? await createRun('candidate', identity, {
      status: 'running',
      platforms: Object.fromEntries(Object.keys(PLATFORMS).map(platform => [platform, { status: 'pending', source_commit: identity.source_commit }])),
      verification: { status: 'pending' }, publication: { status: 'not-requested' }, rollback: { status: 'not-requested' },
    })
    : await loadRun(values.run)
  const { directory, run } = loaded
  if (run.command !== 'candidate' || run.source_commit !== identity.source_commit) throw new Error('candidate retry must use the same clean source commit')
  if (values.windowsUnavailable) {
    if (!['passed', 'reused'].includes(run.platforms?.macos?.status)) {
      throw new Error('Windows unavailable waiver requires an immutable macOS candidate')
    }
    const macos = await verifyLocalArtifact(join(directory, 'artifacts', 'macos'), 'macos', run.source_commit)
    const windows = markWindowsUnavailable(run)
    const requestPath = join(directory, windows.request)
    const { bytes } = await readWindowsRemoteRequest(requestPath, run)
    if (digest(bytes) !== windows.request_sha256) throw new Error('Windows unavailable waiver request drifted')
    run.platforms.windows = windows
    run.status = 'built-macos-only'
    run.verification = { status: 'pending' }
    await writeComputerUseTemplates(directory, run.source_commit, { macos: macos.primary })
    await saveRun(directory, run)
    await writeChecksums(directory)
    process.stdout.write(`${JSON.stringify({ run_id: run.run_id, source_commit: run.source_commit, platforms: run.platforms }, null, 2)}\n`)
    return
  }
  if (values.windowsResult !== undefined) {
    if (['passed', 'reused'].includes(run.platforms?.windows?.status)) throw new Error('Windows candidate artifact is already immutable')
    const artifacts = {}
    for (const platform of ['macos']) {
      if (['passed', 'reused'].includes(run.platforms?.[platform]?.status)) {
        artifacts[platform] = (await verifyLocalArtifact(join(directory, 'artifacts', platform), platform, run.source_commit)).primary
      }
    }
    const requestPath = join(directory, 'windows-remote', 'request.json')
    const output = join(directory, 'artifacts', 'windows')
    const imported = await importWindowsRemoteResult(resolve(values.windowsResult), output, run, requestPath)
    const receiptPath = join(directory, 'windows-remote', 'result.json')
    await copyFile(imported.receipt_path, receiptPath)
    await copyFile(imported.log_path, join(directory, 'logs', 'windows.log'))
    run.platforms.windows = {
      status: 'passed',
      source_commit: run.source_commit,
      artifact: imported.primary,
      codex_remote: {
        host: imported.receipt.host,
        request_sha256: imported.receipt.request_sha256,
        receipt: relativePath(directory, receiptPath),
        receipt_sha256: await fileDigest(receiptPath),
      },
    }
    run.status = Object.values(run.platforms).every(item => ['passed', 'reused'].includes(item.status)) ? 'built' : 'partial'
    await writeComputerUseTemplates(directory, run.source_commit, { ...artifacts, windows: imported.primary })
    await saveRun(directory, run)
    await writeChecksums(directory)
    process.stdout.write(`${JSON.stringify({ run_id: run.run_id, source_commit: run.source_commit, platforms: run.platforms }, null, 2)}\n`)
    return
  }
  const selection = selectCandidatePlatforms(run, values.retry ?? 'all')
  for (const platform of selection.reuse) {
    await verifyLocalArtifact(join(directory, 'artifacts', platform), platform, run.source_commit)
    run.platforms[platform].status = 'reused'
  }
  if (selection.build.length === 0) {
    run.status = Object.values(run.platforms).every(item => ['passed', 'reused'].includes(item.status)) ? 'built' : 'partial'
    await saveRun(directory, run)
    await writeChecksums(directory)
    return
  }
  const scratch = await mkdtemp(join(tmpdir(), 'emate-t25-'))
  const source = join(scratch, 'source')
  const setupLog = join(directory, 'logs', 'candidate.log')
  const failures = []
  let sourceReady = !selection.build.includes('macos')
  try {
    if (selection.build.includes('macos')) {
      try {
        await runCandidateStages([{
          category: CANDIDATE_FAILURE.SOURCE,
          stage: 'clean-source-copy',
          run: () => cleanSourceCopy(ROOT, source, identity, setupLog),
        }])
        sourceReady = true
      } catch (cause) {
        const failure = failureOrDefault(cause, 'clean-source-copy')
        run.platforms.macos = failedPlatformState(run.source_commit, failure)
        await blockWindowsRemote(directory, run, failure)
        failures.push(new Error(`macos: ${run.platforms.macos.error}`))
      }
    }
    for (const platform of selection.build) {
      const output = join(directory, 'artifacts', platform)
      const log = join(directory, 'logs', `${platform}.log`)
      if (platform === 'windows') {
        if (!['passed', 'reused'].includes(run.platforms?.macos?.status)) {
          const failure = run.platforms?.macos?.failure === undefined
            ? { category: CANDIDATE_FAILURE.SOURCE, stage: 'macos-candidate', error: 'macOS candidate has no verified product bytes' }
            : { ...run.platforms.macos.failure, error: run.platforms.macos.error }
          await blockWindowsRemote(directory, run, failure)
          if (failures.length === 0) failures.push(new Error('windows: no verified macOS product bytes; no Remote request emitted'))
          await saveRun(directory, run)
          continue
        }
        await prepareWindowsRemote(directory, run)
        await saveRun(directory, run)
        continue
      }
      if (!sourceReady) continue
      run.platforms[platform] = { status: 'building', source_commit: run.source_commit }
      await saveRun(directory, run)
      try {
        const temporary = join(scratch, 'macos-out')
        await runLogged(process.execPath, [join(source, 'scripts', 'local-flow.mjs'), '_platform-build', '--platform', 'macos', '--out', temporary, '--source-commit', run.source_commit], { cwd: source, log })
        await mkdir(dirname(output), { recursive: true })
        await rm(output, { recursive: true, force: true })
        await mkdir(output)
        for (const name of await readdir(temporary)) await copyFile(join(temporary, name), join(output, name))
        const verified = await verifyLocalArtifact(output, platform, run.source_commit)
        run.platforms[platform] = { status: 'passed', source_commit: run.source_commit, artifact: verified.primary }
      } catch (cause) {
        const failure = failureOrDefault(cause)
        run.platforms[platform] = failedPlatformState(run.source_commit, failure)
        await blockWindowsRemote(directory, run, failure)
        failures.push(new Error(`${platform}: ${run.platforms[platform].error}`))
      }
      await saveRun(directory, run)
    }
    run.status = Object.values(run.platforms).every(item => ['passed', 'reused'].includes(item.status)) ? 'built' : 'partial'
    await writeComputerUseTemplates(directory, run.source_commit, Object.fromEntries(await Promise.all(Object.keys(PLATFORMS).map(async platform => {
      try { return [platform, (await verifyLocalArtifact(join(directory, 'artifacts', platform), platform, run.source_commit)).primary] } catch { return [platform, undefined] }
    }))))
    if (failures.length > 0) throw new AggregateError(failures, 'one or more candidate platforms failed')
  } finally {
    await rm(scratch, { recursive: true, force: true })
    await saveRun(directory, run)
    await writeChecksums(directory)
  }
  process.stdout.write(`${JSON.stringify({ run_id: run.run_id, source_commit: run.source_commit, platforms: run.platforms }, null, 2)}\n`)
}

function expectedComputerUseScenarios(platform) {
  return platform === 'windows'
    ? [{ id: 'windows-native-runtime-unavailable', status: 'not_applicable', disposition: 'allowed_unavailable' }]
    : COMPUTER_USE_SCENARIOS[platform].map(id => ({ id, status: 'passed' }))
}

function validateExternalAcceptance(acceptance, { platform, artifactSha256 }) {
  const coverage = [
    'installation', 'startup', 'update-download-verify-atomic-replace-relaunch-health-commit',
    'failed-health-rollback-relaunch-recovery',
    '2.0.15-fixes', 'built-in-tools', ...(platform === 'macos' ? ['computer-use'] : []),
  ]
  const computerUse = platform === 'macos'
    ? { status: 'passed', installed_artifact_sha256: artifactSha256 }
    : { status: 'not_applicable', disposition: 'allowed_unavailable', tested: false }
  if (!exactKeys(acceptance, [
    'task', 'thread_id', 'matrix', 'scope', 'status', 'host', 'tested_at', 'installed_artifact_sha256',
    'coverage', 'computer_use', 'matrix_receipt',
  ]) || !['T18', 'T22'].includes(acceptance.task) || !THREAD_ID.test(acceptance.thread_id ?? '')
    || acceptance.matrix !== FULL_MATRIX || acceptance.scope !== FULL_MATRIX_SCOPE || acceptance.status !== 'passed'
    || typeof acceptance.host !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(acceptance.host)
    || (platform === 'windows' && acceptance.host !== 'DESKTOP-KH19ARC')
    || typeof acceptance.tested_at !== 'string' || Number.isNaN(Date.parse(acceptance.tested_at))
    || new Date(acceptance.tested_at).toISOString() !== acceptance.tested_at
    || acceptance.installed_artifact_sha256 !== artifactSha256
    || JSON.stringify(acceptance.coverage) !== JSON.stringify(coverage)
    || !sameRecord(acceptance.computer_use, computerUse)
    || !exactKeys(acceptance.matrix_receipt, ['file', 'sha256'])
    || basename(acceptance.matrix_receipt.file ?? '') !== acceptance.matrix_receipt.file
    || !acceptance.matrix_receipt.file.startsWith(`${acceptance.task.toLowerCase()}-`)
    || !/^[a-z0-9][a-z0-9._-]*\.json$/u.test(acceptance.matrix_receipt.file)
    || !SHA256.test(acceptance.matrix_receipt.sha256 ?? '')) {
    throw new Error(`${platform} requires passed external T18/T22 full installed acceptance bound to the installed artifact`)
  }
  return acceptance
}

export async function verifyComputerUseReceipt(path, { platform, sourceCommit, artifactSha256 }) {
  const receipt = await json(path)
  if (receipt?.status === 'blocked') throw new Error(`${platform} Computer Use receipt is BLOCKED and cannot satisfy verify`)
  if (!exactKeys(receipt, ['schema_version', 'document_type', 'platform', 'status', 'data_policy', 'source_commit', 'artifact_sha256', 'scenarios', 'screenshots', 'external_acceptance'])
    || receipt.schema_version !== 1 || receipt.document_type !== 'emate.local-computer-use-receipt'
    || receipt.platform !== platform || receipt.status !== 'passed' || receipt.data_policy !== 'synthetic-test-data-only'
    || receipt.source_commit !== sourceCommit || receipt.artifact_sha256 !== artifactSha256
    || !Array.isArray(receipt.scenarios)
    || receipt.scenarios.length !== expectedComputerUseScenarios(platform).length
    || !receipt.scenarios.every((scenario, index) => sameRecord(scenario, expectedComputerUseScenarios(platform)[index]))
    || !Array.isArray(receipt.screenshots) || (platform === 'macos' && receipt.screenshots.length === 0)) {
    throw new Error(`${platform} Computer Use receipt is invalid or incomplete`)
  }
  const acceptance = validateExternalAcceptance(receipt.external_acceptance, { platform, artifactSha256 })
  const matrixPath = join(dirname(path), acceptance.matrix_receipt.file)
  const matrixMetadata = await regularFile(matrixPath, `${platform} external full-matrix receipt`)
  if (matrixMetadata.size > 1024 * 1024) throw new Error(`${platform} external full-matrix receipt is too large`)
  const matrixBytes = await readFile(matrixPath)
  assertCleanArtifactBytes(matrixBytes, `${platform} external full-matrix receipt`)
  if (digest(matrixBytes) !== acceptance.matrix_receipt.sha256) throw new Error(`${platform} external full-matrix receipt drifted`)
  const matrix = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(matrixBytes))
  if (!exactKeys(matrix, [
    'schema_version', 'document_type', 'task', 'thread_id', 'platform', 'scope', 'status', 'host',
    'tested_at', 'installed_artifact_sha256', 'coverage', 'computer_use',
  ]) || matrix.schema_version !== 1 || matrix.document_type !== 'emate.external-installed-matrix-receipt'
    || matrix.task !== acceptance.task || matrix.thread_id !== acceptance.thread_id || matrix.platform !== platform
    || matrix.scope !== acceptance.scope || matrix.status !== acceptance.status || matrix.host !== acceptance.host
    || matrix.tested_at !== acceptance.tested_at || matrix.installed_artifact_sha256 !== artifactSha256
    || JSON.stringify(matrix.coverage) !== JSON.stringify(acceptance.coverage)
    || !sameRecord(matrix.computer_use, acceptance.computer_use)) {
    throw new Error(`${platform} external full-matrix receipt content is invalid`)
  }
  const screenshotRoot = join(dirname(path), 'screenshots')
  for (const screenshot of receipt.screenshots) {
    if (!exactKeys(screenshot, ['file', 'sha256']) || basename(screenshot.file ?? '') !== screenshot.file
      || !/^[a-z0-9][a-z0-9._-]*\.png$/u.test(screenshot.file) || !SHA256.test(screenshot.sha256 ?? '')) {
      throw new Error(`${platform} Computer Use screenshot receipt is invalid`)
    }
    const bytes = await readFile(join(screenshotRoot, screenshot.file))
    await regularFile(join(screenshotRoot, screenshot.file))
    if (bytes.byteLength < 33 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      || bytes.subarray(12, 16).toString('ascii') !== 'IHDR' || digest(bytes) !== screenshot.sha256) {
      throw new Error(`${platform} Computer Use screenshot drifted: ${screenshot.file}`)
    }
  }
  const actual = (await readdir(screenshotRoot)).sort()
  const expected = receipt.screenshots.map(item => item.file).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${platform} Computer Use screenshot directory contains an unexpected file`)
  return receipt
}

async function verifyRun(directory, run) {
  if (run.command !== 'candidate' || !['built', 'built-macos-only'].includes(run.status)) {
    throw new Error('verify requires one complete candidate run')
  }
  let windows
  if (run.status === 'built-macos-only') {
    if (!['passed', 'reused'].includes(run.platforms?.macos?.status)
      || run.platforms.macos.source_commit !== run.source_commit) {
      throw new Error('macOS-only verify requires the accepted macOS candidate state')
    }
    windows = validateWindowsUnavailable(run.platforms?.windows, run.source_commit)
    const { bytes } = await readWindowsRemoteRequest(join(directory, windows.request), run)
    if (digest(bytes) !== windows.request_sha256) throw new Error('Windows unavailable waiver request drifted')
  }
  const artifacts = {}
  const computerUse = {}
  for (const platform of windows === undefined ? Object.keys(PLATFORMS) : ['macos']) {
    const verified = await verifyLocalArtifact(join(directory, 'artifacts', platform), platform, run.source_commit)
    const receipt = await verifyComputerUseReceipt(join(directory, 'computer-use', platform, 'result.json'), {
      platform, sourceCommit: run.source_commit, artifactSha256: verified.primary.sha256,
    })
    artifacts[platform] = verified
    computerUse[platform] = receipt.external_acceptance
  }
  return { artifacts, computerUse, windows }
}

function verificationEvidence({ artifacts, computerUse, windows }) {
  const evidence = {
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([platform, value]) => [platform, {
      primary: value.primary,
      files: value.receipt.files,
    }])),
    computer_use: computerUse,
  }
  if (windows !== undefined) evidence.windows = windows
  return evidence
}

function verificationStatus(verified) {
  return verified.windows === undefined ? 'passed' : 'passed-macos-only'
}

function assertVerificationMatches(run, verified) {
  const current = verificationEvidence(verified)
  if (run.verification?.status !== verificationStatus(verified)
    || JSON.stringify(run.verification.artifacts) !== JSON.stringify(current.artifacts)
    || JSON.stringify(run.verification.computer_use) !== JSON.stringify(current.computer_use)
    || JSON.stringify(run.verification.windows) !== JSON.stringify(current.windows)) {
    throw new Error('publish requires an unchanged passed verify run; rerun verify')
  }
}

async function verifyCommand(values) {
  const { directory, run } = await loadRun(values.run)
  try {
    const verified = await verifyRun(directory, run)
    run.verification = {
      status: verificationStatus(verified), verified_at: now(),
      ...verificationEvidence(verified),
    }
  } catch (cause) {
    run.verification = { status: 'failed', verified_at: now(), error: cause instanceof Error ? cause.message : String(cause) }
    throw cause
  } finally {
    await saveRun(directory, run)
    await writeChecksums(directory)
  }
  process.stdout.write(`${JSON.stringify({ run_id: run.run_id, verification: run.verification }, null, 2)}\n`)
}

function publicationScope(run) {
  if (run.verification?.status === 'passed') return 'full'
  if (run.verification?.status !== 'passed-macos-only') throw new Error('publish requires a passed verify run')
  const windows = validateWindowsUnavailable(run.verification.windows, run.source_commit)
  if (!isDeepStrictEqual(windows, validateWindowsUnavailable(run.platforms?.windows, run.source_commit))) {
    throw new Error('Windows unavailable verification drifted from the candidate')
  }
  return 'macos-immutable-dmg-only'
}

function releaseArtifactName(platform, version) {
  return platform === 'macos' ? `e-Mate-${version}-mac-universal.dmg` : `e-Mate-${version}-win-x64-Setup.exe`
}

function objectRecords(run) {
  const artifacts = run.verification?.artifacts
  const scope = publicationScope(run)
  const platforms = scope === 'full' ? ['macos', 'windows'] : ['macos']
  if (!exactKeys(artifacts, platforms)) throw new Error(`verified candidate must contain ${platforms.join(' and ')} platform artifacts`)
  const records = []
  for (const [platform, bundle] of Object.entries(artifacts)) {
    const artifactName = releaseArtifactName(platform, run.version)
    if (!exactKeys(bundle, ['primary', 'files']) || !exactKeys(bundle.primary, ['name', 'bytes', 'sha256'])
      || !Array.isArray(bundle.files) || ![1, 2].includes(bundle.files.length)) {
      throw new Error(`${platform} verified artifact set is invalid`)
    }
    const expectedNames = [artifactName, ...(bundle.files.some(file => file?.name === `${artifactName}.blockmap`) ? [`${artifactName}.blockmap`] : [])].sort()
    if (JSON.stringify(bundle.files.map(file => file?.name).sort()) !== JSON.stringify(expectedNames)) {
      throw new Error(`${platform} verified artifact file set is invalid`)
    }
    for (const artifact of bundle.files) {
      if (!exactKeys(artifact, ['name', 'bytes', 'sha256']) || basename(artifact.name ?? '') !== artifact.name
        || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || !SHA256.test(artifact.sha256 ?? '')) {
        throw new Error(`${platform} verified artifact descriptor is invalid`)
      }
      if (scope === 'full' || artifact.name === artifactName) {
        records.push({
          platform,
          artifact_path: `artifacts/${platform}/${artifact.name}`,
          key: `desktop/releases/v${run.version}/${run.source_commit}/${artifact.name}`,
          bytes: artifact.bytes,
          sha256: artifact.sha256,
          write: 'create-only',
        })
      }
    }
    const primary = bundle.files.find(file => file.name === artifactName)
    if (JSON.stringify(bundle.primary) !== JSON.stringify(primary)) throw new Error(`${platform} primary artifact binding is invalid`)
  }
  return records.sort((left, right) => left.platform.localeCompare(right.platform) || left.key.localeCompare(right.key))
}

function verifiedComputerUse(run) {
  const evidence = run.verification?.computer_use
  const platforms = publicationScope(run) === 'full' ? ['macos', 'windows'] : ['macos']
  if (!exactKeys(evidence, platforms)) {
    throw new Error(`publish requires ${platforms.length === 2 ? 'both' : 'macOS'} external installed acceptance receipts`)
  }
  for (const platform of platforms) {
    validateExternalAcceptance(evidence[platform], {
      platform,
      artifactSha256: run.verification.artifacts[platform].primary.sha256,
    })
  }
  return evidence
}

function numericVersion(version) {
  if (!PACKAGE_VERSION.test(version ?? '')) throw new Error('release transaction product version is invalid')
  return version.split('-', 1)[0].split('.').map(Number)
}

function compareVersions(left, right) {
  const leftParts = numericVersion(left)
  const rightParts = numericVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

export function buildReleaseTransactionPlan(run, versionChoice) {
  if (!RUN_ID.test(run?.run_id ?? '') || !SOURCE_SHA.test(run?.source_commit ?? '')) {
    throw new Error('release transaction run identity is invalid')
  }
  if (!TRANSACTION_MODES.includes(versionChoice)) throw new Error('release transaction requires an explicit version choice')
  const nextVersion = compareVersions(run.version, CURRENT_PUBLIC_VERSION) > 0
  if (versionChoice === 'new-version' ? !nextVersion : run.version !== CURRENT_PUBLIC_VERSION) {
    throw new Error('release transaction version choice does not match the frozen product version')
  }
  const sameVersion = versionChoice === 'same-version-2.0.15-exception'
  return {
    schema_version: 1,
    mode: versionChoice,
    distribution_origin: R2_PUBLIC_ORIGIN,
    run_id: run.run_id,
    product_version: run.version,
    source_commit: run.source_commit,
    current_public_version: CURRENT_PUBLIC_VERSION,
    current_public_source_commit: CURRENT_PUBLIC_SOURCE_COMMIT,
    current_public_pointers: Object.fromEntries(Object.entries(CURRENT_PUBLIC_POINTERS).map(([name, pointer]) => [name, {
      key: pointer.key,
      identity: { ...POINTER_PREDECESSOR },
    }])),
    manual_manifest: {
      key: sameVersion ? CURRENT_PUBLIC_POINTERS.manual.key : `desktop/manual/v${run.version}/latest.json`,
      write: sameVersion ? 'compare-and-swap' : 'create-only',
      rollback: sameVersion ? 'restore-by-cas' : 'retain',
    },
    activation_order: ['manual', 'signed', 'legacy'],
    rollback_order: sameVersion ? ['legacy', 'signed', 'manual'] : ['legacy', 'signed'],
    manual_reinstall_required_for_existing_2_0_15: sameVersion,
  }
}

function releaseTransactionPlan(run, versionChoice) {
  const choice = versionChoice ?? run.release_transaction?.mode
  const expected = buildReleaseTransactionPlan(run, choice)
  if (run.release_transaction !== undefined && !isDeepStrictEqual(run.release_transaction, expected)) {
    throw new Error('release transaction plan drifted from the frozen run')
  }
  return expected
}

export function buildPublicationRequest(run, { dryRun = false, versionChoice } = {}) {
  const scope = publicationScope(run)
  verifiedComputerUse(run)
  const immutableObjects = objectRecords(run)
  if (scope === 'macos-immutable-dmg-only') {
    if (versionChoice !== undefined || run.release_transaction !== undefined) {
      throw new Error('macOS-only immutable publication cannot bind a shared-pointer version choice')
    }
    return {
      schema_version: 1,
      document_type: 'emate.local-cloudflare-owner-request',
      operation: 'publish-macos-immutable',
      mode: dryRun ? 'dry-run' : 'apply',
      status: 'ready-for-existing-owner',
      authority: OWNER,
      distribution_origin: R2_PUBLIC_ORIGIN,
      release_scope: scope,
      version: run.version,
      source_commit: run.source_commit,
      rebuild: false,
      windows: run.verification.windows,
      macos_publication_mode: 'unsigned',
      installer_security: { darwin: INSTALLER_SECURITY.darwin },
      immutable_objects: immutableObjects,
      publication_and_activation: {
        immutable_public_download: {
          object_keys: immutableObjects.map(object => object.key),
          authenticated_readback: 'required',
          public_readback: 'required',
        },
        shared_update_surfaces: {
          manual_manifest: 'unchanged',
          signed_pointer: 'unchanged',
          legacy_pointer: 'unchanged',
        },
        reason: 'schema-v2-requires-darwin-and-win32',
        order: ['immutable-create-only', 'authenticated-readback', 'public-readback'],
      },
      delete_objects: [],
    }
  }
  const transaction = releaseTransactionPlan(run, versionChoice)
  const pointerNames = transaction.mode === 'new-version' ? ['signed', 'legacy'] : [...transaction.activation_order]
  const pointers = Object.fromEntries(pointerNames.map(name => [name, {
    key: transaction.current_public_pointers[name].key,
    expected_current: { ...transaction.current_public_pointers[name].identity },
    target: { ...POINTER_TARGET },
    compare_and_swap: 'required',
    authenticated_readback: 'required',
    public_full_byte_readback: 'required',
  }]))
  return {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-request',
    operation: 'publish',
    mode: dryRun ? 'dry-run' : 'apply',
    status: 'ready-for-existing-owner',
    authority: OWNER,
    distribution_origin: R2_PUBLIC_ORIGIN,
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    transaction_plan: transaction,
    rebuild: false,
    macos_publication_mode: 'unsigned',
    installer_security: INSTALLER_SECURITY,
    immutable_objects: immutableObjects,
    manifest_admission_and_signing: {
      owner: MANIFEST_OWNER,
      signed_manifest: {
        artifact_path: 'desktop-release-signed.json',
        schema_version: 2,
        document_type: 'emate.desktop-release-manifest',
        release_status: 'admitted',
        signing_context: MANIFEST_SIGNING_CONTEXT,
        signature: { algorithm: 'ed25519', key_source: 'existing-base-profile_signing_keys' },
        max_bytes: 16 * 1024,
      },
      handoff: {
        status: 'ready-for-cloudflare-plugin',
        exact_files: ['desktop-release-signed.json', 'cloudflare-publication-plan.json', 'cloudflare-plugin-handoff.json'],
      },
    },
    publication_and_activation: {
      current_public_pointer_readback: 'required-before-any-write',
      manual_manifest: {
        ...transaction.manual_manifest,
        expected_current: transaction.mode === 'new-version'
          ? 'must-not-exist'
          : { ...transaction.current_public_pointers.manual.identity },
        target: { ...POINTER_TARGET },
        authenticated_readback: 'required',
        public_full_byte_readback: 'required',
      },
      pointers,
      activation_order: [...transaction.activation_order],
      recovery: { ...POINTER_RECOVERY, accepted_current_states: [...POINTER_RECOVERY.accepted_current_states] },
      order: [
        'current-public-three-pointer-readbacks', 'existing-owner-admission-and-ed25519-manifest-signing',
        'immutable-create-only', 'authenticated-readback', 'public-readback',
        transaction.mode === 'new-version' ? 'manual-manifest-create-only-and-readbacks' : 'manual-pointer-cas-and-readbacks',
        'signed-pointer-cas-and-readbacks', 'legacy-pointer-cas-and-readbacks',
      ],
    },
    delete_objects: [],
  }
}

function validPointerIdentity(value) {
  return exactKeys(value, ['bytes', 'sha256', 'etag']) && Number.isSafeInteger(value.bytes)
    && value.bytes > 0 && SHA256.test(value.sha256 ?? '') && ETAG.test(value.etag ?? '')
}

function samePointerIdentity(value, expected) {
  return validPointerIdentity(value) && value.bytes === expected.bytes
    && value.sha256 === expected.sha256 && value.etag === expected.etag
}

function validCurrentPublicReadbacks(value, transaction) {
  if (!exactKeys(value, Object.keys(transaction.current_public_pointers))) return false
  return Object.entries(transaction.current_public_pointers).every(([name, expected]) => {
    const pointer = value[name]
    const authenticated = pointer?.authenticated_readback
    const publicReadback = pointer?.public_full_byte_readback
    return exactKeys(pointer, ['key', 'authenticated_readback', 'public_full_byte_readback'])
      && pointer.key === expected.key
      && exactKeys(authenticated, ['status', 'bytes', 'sha256', 'etag']) && authenticated.status === 'passed'
      && samePointerIdentity({ bytes: authenticated.bytes, sha256: authenticated.sha256, etag: authenticated.etag }, expected.identity)
      && exactKeys(publicReadback, ['status', 'bytes', 'sha256']) && publicReadback.status === 'passed'
      && publicReadback.bytes === expected.identity.bytes && publicReadback.sha256 === expected.identity.sha256
  })
}

function unsignedInstallerSecurity(value) {
  return exactKeys(value, ['darwin', 'win32'])
    && sameRecord(value.darwin, INSTALLER_SECURITY.darwin)
    && sameRecord(value.win32, INSTALLER_SECURITY.win32)
}

export function validatePublicationReceipt(receipt, run, requestSha256) {
  if (publicationScope(run) === 'macos-immutable-dmg-only') {
    if (!exactKeys(receipt, [
      'schema_version', 'document_type', 'operation', 'status', 'release_scope', 'windows',
      'macos_publication_mode', 'installer_security', 'distribution_origin', 'version', 'source_commit', 'request_sha256',
      'immutable_objects', 'shared_update_surfaces', 'deleted_objects',
    ]) || receipt.schema_version !== 1 || receipt.document_type !== 'emate.local-cloudflare-owner-receipt'
      || receipt.operation !== 'publish-macos-immutable' || receipt.status !== 'passed'
      || receipt.release_scope !== 'macos-immutable-dmg-only'
      || receipt.distribution_origin !== R2_PUBLIC_ORIGIN
      || !isDeepStrictEqual(receipt.windows, run.verification.windows)
      || receipt.macos_publication_mode !== 'unsigned'
      || !exactKeys(receipt.installer_security, ['darwin'])
      || !sameRecord(receipt.installer_security.darwin, INSTALLER_SECURITY.darwin)
      || receipt.version !== run.version || receipt.source_commit !== run.source_commit
      || receipt.request_sha256 !== requestSha256 || !SHA256.test(requestSha256 ?? '')
      || !Array.isArray(receipt.immutable_objects) || receipt.deleted_objects?.length !== 0
      || !sameRecord(receipt.shared_update_surfaces, {
        manual_manifest: 'unchanged', signed_pointer: 'unchanged', legacy_pointer: 'unchanged',
      })) {
      throw new Error('macOS-only publication owner receipt is invalid')
    }
    const expectedObjects = objectRecords(run)
    if (receipt.immutable_objects.length !== expectedObjects.length) {
      throw new Error('macOS-only publication immutable object receipt set is invalid')
    }
    for (const expected of expectedObjects) {
      const object = receipt.immutable_objects.find(item => item?.key === expected.key)
      if (!exactKeys(object, ['key', 'bytes', 'sha256', 'write', 'authenticated_readback', 'public_readback'])
        || object.bytes !== expected.bytes || object.sha256 !== expected.sha256
        || !['created', 'already-exact'].includes(object.write)
        || object.authenticated_readback !== 'passed' || object.public_readback !== 'passed') {
        throw new Error(`macOS-only publication immutable object receipt is invalid: ${expected.key}`)
      }
    }
    return receipt
  }
  const transaction = releaseTransactionPlan(run)
  const pointerNames = transaction.mode === 'new-version' ? ['signed', 'legacy'] : [...transaction.activation_order]
  const receiptKeys = [
    'schema_version', 'document_type', 'operation', 'status', 'macos_publication_mode', 'installer_security',
    'distribution_origin', 'run_id', 'version', 'source_commit', 'transaction_mode', 'request_sha256',
    'current_public_pointers', 'manifest_admission', 'immutable_objects', 'pointers', 'activation_order',
    ...(transaction.mode === 'new-version' ? ['manual_manifest'] : []), 'deleted_objects',
  ]
  if (!exactKeys(receipt, receiptKeys)
    || receipt.schema_version !== 1 || receipt.document_type !== 'emate.local-cloudflare-owner-receipt'
    || receipt.operation !== 'publish' || receipt.status !== 'passed' || receipt.macos_publication_mode !== 'unsigned'
    || !unsignedInstallerSecurity(receipt.installer_security)
    || receipt.distribution_origin !== R2_PUBLIC_ORIGIN || receipt.run_id !== run.run_id
    || receipt.version !== run.version || receipt.source_commit !== run.source_commit || receipt.transaction_mode !== transaction.mode
    || receipt.request_sha256 !== requestSha256 || !SHA256.test(requestSha256 ?? '')
    || !validCurrentPublicReadbacks(receipt.current_public_pointers, transaction)
    || !exactKeys(receipt.pointers, pointerNames)
    || !isDeepStrictEqual(receipt.activation_order, transaction.activation_order)
    || !Array.isArray(receipt.immutable_objects) || receipt.deleted_objects?.length !== 0) {
    throw new Error('Cloudflare publication owner receipt is invalid')
  }
  const expectedObjects = objectRecords(run)
  if (receipt.immutable_objects.length !== expectedObjects.length) throw new Error('Cloudflare immutable object receipt set is invalid')
  for (const expected of expectedObjects) {
    const object = receipt.immutable_objects.find(item => item?.key === expected.key)
    if (!exactKeys(object, ['key', 'bytes', 'sha256', 'write', 'authenticated_readback', 'public_readback'])
      || object.bytes !== expected.bytes || object.sha256 !== expected.sha256
      || !['created', 'already-exact'].includes(object.write)
      || object.authenticated_readback !== 'passed' || object.public_readback !== 'passed') {
      throw new Error(`Cloudflare immutable object receipt is invalid: ${expected.key}`)
    }
  }
  const admission = receipt.manifest_admission
  if (!exactKeys(admission, [
    'owner', 'status', 'macos_publication_mode', 'schema_version', 'document_type', 'release_status',
    'signing_context', 'signature', 'signed_manifest', 'publication_plan', 'admission_receipt',
  ]) || admission.owner !== MANIFEST_OWNER || admission.status !== 'passed'
    || admission.macos_publication_mode !== 'unsigned' || admission.schema_version !== 2
    || admission.document_type !== 'emate.desktop-release-manifest' || admission.release_status !== 'admitted'
    || admission.signing_context !== MANIFEST_SIGNING_CONTEXT
    || !exactKeys(admission.signature, ['algorithm', 'key_id', 'key_source', 'verification'])
    || admission.signature.algorithm !== 'ed25519' || !MANIFEST_KEY_ID.test(admission.signature.key_id ?? '')
    || admission.signature.key_source !== 'existing-base-profile_signing_keys' || admission.signature.verification !== 'passed'
    || !exactKeys(admission.signed_manifest, ['file', 'bytes', 'sha256'])
    || admission.signed_manifest.file !== 'desktop-release-signed.json'
    || !Number.isSafeInteger(admission.signed_manifest.bytes) || admission.signed_manifest.bytes <= 0
    || admission.signed_manifest.bytes > 16 * 1024 || !SHA256.test(admission.signed_manifest.sha256 ?? '')
    || !exactKeys(admission.publication_plan, ['file', 'sha256', 'status'])
    || admission.publication_plan.file !== 'cloudflare-publication-plan.json'
    || !SHA256.test(admission.publication_plan.sha256 ?? '') || admission.publication_plan.status !== 'ready-for-cloudflare-plugin'
    || !exactKeys(admission.admission_receipt, ['file', 'sha256', 'status'])
    || admission.admission_receipt.file !== 'cloudflare-plugin-handoff.json'
    || !SHA256.test(admission.admission_receipt.sha256 ?? '') || admission.admission_receipt.status !== 'ready-for-cloudflare-plugin') {
    throw new Error('Desktop manifest admission/signature receipt is invalid')
  }
  let appliedDuringThisAttempt = false
  for (const name of transaction.activation_order) {
    if (name === 'manual' && transaction.mode === 'new-version') {
      const manual = receipt.manual_manifest
      const authenticated = manual?.authenticated_readback
      const publicReadback = manual?.public_full_byte_readback
      if (!exactKeys(manual, ['key', 'write', 'after', 'authenticated_readback', 'public_full_byte_readback'])
        || manual.key !== transaction.manual_manifest.key || !['created', 'already-exact'].includes(manual.write)
        || !validPointerIdentity(manual.after) || manual.after.bytes !== admission.signed_manifest.bytes
        || manual.after.sha256 !== admission.signed_manifest.sha256
        || !exactKeys(authenticated, ['status', 'bytes', 'sha256', 'etag']) || authenticated.status !== 'passed'
        || !samePointerIdentity({ bytes: authenticated.bytes, sha256: authenticated.sha256, etag: authenticated.etag }, manual.after)
        || !exactKeys(publicReadback, ['status', 'bytes', 'sha256']) || publicReadback.status !== 'passed'
        || publicReadback.bytes !== manual.after.bytes || publicReadback.sha256 !== manual.after.sha256) {
        throw new Error('Cloudflare manual manifest receipt is invalid')
      }
      if (manual.write === 'created') appliedDuringThisAttempt = true
      else if (appliedDuringThisAttempt) throw new Error('Cloudflare ordered pointer recovery is invalid')
      continue
    }
    const pointer = receipt.pointers[name]
    const authenticated = pointer?.authenticated_readback
    const publicReadback = pointer?.public_full_byte_readback
    if (!exactKeys(pointer, [
      'key', 'before', 'after', 'cas', 'authenticated_readback', 'public_full_byte_readback',
    ]) || pointer.key !== transaction.current_public_pointers[name].key
      || !samePointerIdentity(pointer.before, transaction.current_public_pointers[name].identity) || !validPointerIdentity(pointer.after)
      || pointer.after.bytes !== admission.signed_manifest.bytes
      || pointer.after.sha256 !== admission.signed_manifest.sha256
      || !['passed', 'already-exact'].includes(pointer.cas)
      || !exactKeys(authenticated, ['status', 'bytes', 'sha256', 'etag']) || authenticated.status !== 'passed'
      || authenticated.bytes !== pointer.after.bytes || authenticated.sha256 !== pointer.after.sha256
      || authenticated.etag !== pointer.after.etag
      || !exactKeys(publicReadback, ['status', 'bytes', 'sha256']) || publicReadback.status !== 'passed'
      || publicReadback.bytes !== pointer.after.bytes || publicReadback.sha256 !== pointer.after.sha256) {
      throw new Error(`Cloudflare ${name} pointer receipt is invalid`)
    }
    if (pointer.cas === 'passed') appliedDuringThisAttempt = true
    else if (appliedDuringThisAttempt) throw new Error('Cloudflare ordered pointer recovery is invalid')
  }
  return receipt
}

export function buildRollbackRequest(run, publicationReceipt, {
  dryRun = false,
  publicationRequestSha256,
  publicationReceiptSha256,
} = {}) {
  if (publicationScope(run) === 'macos-immutable-dmg-only') {
    throw new Error('macOS-only immutable publication has no shared pointer rollback')
  }
  verifiedComputerUse(run)
  const transaction = releaseTransactionPlan(run)
  if (!dryRun && publicationReceipt === undefined) throw new Error('rollback requires the existing Cloudflare owner publication receipt')
  const pointers = transaction.rollback_order.map(name => ({
    key: transaction.current_public_pointers[name].key,
    expected_current: publicationReceipt === undefined
      ? {
        bytes: `from-publication-owner-receipt.pointers.${name}.after.bytes`,
        sha256: `from-publication-owner-receipt.pointers.${name}.after.sha256`,
        etag: `from-publication-owner-receipt.pointers.${name}.after.etag`,
      }
      : publicationReceipt.pointers[name].after,
    restore: publicationReceipt === undefined
      ? { ...transaction.current_public_pointers[name].identity }
      : publicationReceipt.pointers[name].before,
    compare_and_swap: 'required',
    authenticated_readback: 'required',
    public_full_byte_readback: 'required',
  }))
  return {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-request',
    operation: 'rollback',
    mode: dryRun ? 'dry-run' : 'apply',
    status: 'ready-for-existing-owner',
    authority: OWNER,
    distribution_origin: R2_PUBLIC_ORIGIN,
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    transaction_mode: transaction.mode,
    transaction_plan: transaction,
    rebuild: false,
    rollback_order: [...transaction.rollback_order],
    pointer_compare_and_swap: pointers,
    recovery: { ...POINTER_RECOVERY, accepted_current_states: [...POINTER_RECOVERY.accepted_current_states] },
    immutable_objects: objectRecords(run).map(object => ({ key: object.key, action: 'retain' })),
    manual_manifest: {
      key: transaction.manual_manifest.key,
      action: transaction.mode === 'new-version' ? 'retain' : 'restore-by-cas',
    },
    owner_receipt: {
      schema_version: 1,
      document_type: 'emate.local-cloudflare-owner-receipt',
      operation: 'rollback',
      status: 'passed',
      authority: OWNER,
      distribution_origin: R2_PUBLIC_ORIGIN,
      run_id: run.run_id ?? 'from-local-flow-run.run_id',
      version: run.version,
      source_commit: run.source_commit,
      transaction_mode: transaction.mode,
      publication_request_sha256: publicationRequestSha256 ?? 'from-publication/cloudflare-owner-request.json',
      publication_receipt_sha256: publicationReceiptSha256 ?? 'from-publication/cloudflare-owner-receipt.json',
      rollback_request_sha256: 'sha256-of-this-exact-request',
      pointer_receipts: 'ordered-before-after-cas-authenticated-and-public-readback',
      immutable_objects: 'retained',
      manual_manifest: transaction.mode === 'new-version' ? 'retained' : 'restored-by-cas',
      deleted_objects: [],
    },
    delete_objects: [],
  }
}

export function validateRollbackReceipt(receipt, run, {
  publicationRequestSha256,
  publicationReceiptSha256,
  rollbackRequestSha256,
  publicationReceipt,
  rollbackRequest,
} = {}) {
  if (!exactKeys(receipt, [
    'schema_version', 'document_type', 'operation', 'status', 'authority', 'run_id', 'version',
    'source_commit', 'distribution_origin', 'transaction_mode', 'publication_request_sha256', 'publication_receipt_sha256',
    'rollback_request_sha256', 'rollback_order', 'pointers', 'immutable_objects', 'deleted_objects',
    'manual_manifest',
  ]) || receipt.schema_version !== 1 || receipt.document_type !== 'emate.local-cloudflare-owner-receipt'
    || receipt.operation !== 'rollback' || receipt.status !== 'passed' || receipt.authority !== OWNER
    || !RUN_ID.test(run?.run_id ?? '') || receipt.run_id !== run.run_id
    || receipt.version !== run.version || receipt.source_commit !== run.source_commit
    || receipt.distribution_origin !== R2_PUBLIC_ORIGIN
    || !SHA256.test(publicationRequestSha256 ?? '') || receipt.publication_request_sha256 !== publicationRequestSha256
    || !SHA256.test(publicationReceiptSha256 ?? '') || receipt.publication_receipt_sha256 !== publicationReceiptSha256
    || !SHA256.test(rollbackRequestSha256 ?? '') || receipt.rollback_request_sha256 !== rollbackRequestSha256
    || !Array.isArray(receipt.rollback_order) || !Array.isArray(receipt.pointers)
    || !Array.isArray(receipt.immutable_objects) || !Array.isArray(receipt.deleted_objects)
    || receipt.deleted_objects.length !== 0) {
    throw new Error('Cloudflare rollback owner receipt is invalid')
  }
  const publication = validatePublicationReceipt(publicationReceipt, run, publicationRequestSha256)
  const expectedRequest = buildRollbackRequest(run, publication, {
    publicationRequestSha256,
    publicationReceiptSha256,
  })
  if (!isDeepStrictEqual(rollbackRequest, expectedRequest)
    || !isDeepStrictEqual(receipt.rollback_order, expectedRequest.rollback_order)
    || receipt.transaction_mode !== expectedRequest.transaction_mode
    || !isDeepStrictEqual(receipt.manual_manifest, {
      key: expectedRequest.manual_manifest.key,
      action: expectedRequest.manual_manifest.action === 'retain' ? 'retained' : 'restored-by-cas',
    })
    || receipt.pointers.length !== expectedRequest.pointer_compare_and_swap.length) {
    throw new Error('Cloudflare rollback owner receipt is invalid')
  }
  const retained = expectedRequest.immutable_objects.map(object => ({ key: object.key, action: 'retained' }))
  if (!isDeepStrictEqual(receipt.immutable_objects, retained)) throw new Error('Cloudflare rollback owner receipt is invalid')

  let appliedDuringThisAttempt = false
  for (const [index, expected] of expectedRequest.pointer_compare_and_swap.entries()) {
    const name = expectedRequest.rollback_order[index] ?? `index-${index}`
    const pointer = receipt.pointers[index]
    const authenticated = pointer?.authenticated_readback
    const publicReadback = pointer?.public_full_byte_readback
    if (!exactKeys(pointer, [
      'key', 'before', 'after', 'cas', 'authenticated_readback', 'public_full_byte_readback',
    ]) || pointer.key !== expected.key
      || !samePointerIdentity(pointer.before, expected.expected_current)
      || !samePointerIdentity(pointer.after, expected.restore)
      || !['passed', 'already-exact'].includes(pointer.cas)
      || !exactKeys(authenticated, ['status', 'bytes', 'sha256', 'etag']) || authenticated.status !== 'passed'
      || !samePointerIdentity({ bytes: authenticated.bytes, sha256: authenticated.sha256, etag: authenticated.etag }, pointer.after)
      || !exactKeys(publicReadback, ['status', 'bytes', 'sha256']) || publicReadback.status !== 'passed'
      || publicReadback.bytes !== pointer.after.bytes || publicReadback.sha256 !== pointer.after.sha256) {
      throw new Error(`Cloudflare ${name} rollback pointer receipt is invalid`)
    }
    if (pointer.cas === 'passed') appliedDuringThisAttempt = true
    else if (appliedDuringThisAttempt) throw new Error('Cloudflare ordered rollback recovery is invalid')
  }
  return receipt
}

function awaitingRollbackState({ publicationRequestSha256, publicationReceiptSha256, rollbackRequestSha256 }) {
  return {
    status: 'awaiting-existing-owner',
    owner: OWNER,
    delete_objects: 0,
    request: 'rollback/cloudflare-owner-request.json',
    request_sha256: rollbackRequestSha256,
    publication_request_sha256: publicationRequestSha256,
    publication_receipt_sha256: publicationReceiptSha256,
  }
}

export function rollbackAction(run, { dryRun = false, ownerReceipt } = {}) {
  const status = run.rollback?.status
  if (run.rollback !== undefined && !['dry-run', 'awaiting-existing-owner', 'passed'].includes(status)) {
    throw new Error('rollback run state is invalid')
  }
  if (status === 'passed') throw new Error('rollback is already passed for this run')
  if (status === 'awaiting-existing-owner') {
    if (dryRun) throw new Error('rollback awaiting the existing owner cannot return to dry-run')
    return ownerReceipt === undefined ? 'resume-awaiting' : 'import'
  }
  if (ownerReceipt !== undefined) throw new Error('rollback owner receipt import requires the exact awaiting request state')
  return dryRun ? 'dry-run' : 'emit'
}

function validateAwaitingRollbackRequest(run, rollbackRequest, expectedRequest, {
  publicationRequestSha256, publicationReceiptSha256, rollbackRequestSha256,
}) {
  if (!isDeepStrictEqual(rollbackRequest, expectedRequest)) throw new Error('Cloudflare rollback owner request is invalid')
  if (!isDeepStrictEqual(run.rollback, awaitingRollbackState({
    publicationRequestSha256, publicationReceiptSha256, rollbackRequestSha256,
  }))) throw new Error('rollback requires the exact awaiting request state')
}

export async function importRollbackOwnerReceipt(directory, run, ownerReceiptPath) {
  const publicationRequestPath = join(directory, 'publication', 'cloudflare-owner-request.json')
  const publicationReceiptPath = join(directory, 'publication', 'cloudflare-owner-receipt.json')
  const publicationRequestSha256 = await fileDigest(publicationRequestPath)
  const publicationReceiptSha256 = await fileDigest(publicationReceiptPath)
  const publicationReceipt = validatePublicationReceipt(
    await json(publicationReceiptPath), run, publicationRequestSha256,
  )
  const rollbackRequestPath = join(directory, 'rollback', 'cloudflare-owner-request.json')
  const rollbackRequest = await json(rollbackRequestPath)
  const expectedRequest = buildRollbackRequest(run, publicationReceipt, {
    publicationRequestSha256,
    publicationReceiptSha256,
  })
  const rollbackRequestSha256 = await fileDigest(rollbackRequestPath)
  validateAwaitingRollbackRequest(run, rollbackRequest, expectedRequest, {
    publicationRequestSha256, publicationReceiptSha256, rollbackRequestSha256,
  })
  const receipt = validateRollbackReceipt(await json(resolve(ownerReceiptPath)), run, {
    publicationRequestSha256,
    publicationReceiptSha256,
    rollbackRequestSha256,
    publicationReceipt,
    rollbackRequest,
  })
  const receiptPath = join(directory, 'rollback', 'cloudflare-owner-receipt.json')
  await atomicJson(receiptPath, receipt)
  return {
    status: 'passed',
    owner: OWNER,
    delete_objects: 0,
    request: relativePath(directory, rollbackRequestPath),
    request_sha256: rollbackRequestSha256,
    publication_request_sha256: publicationRequestSha256,
    publication_receipt_sha256: publicationReceiptSha256,
    receipt: relativePath(directory, receiptPath),
    receipt_sha256: await fileDigest(receiptPath),
    rollback_order: [...rollbackRequest.rollback_order],
    completed_at: now(),
  }
}

async function publish(values) {
  const { directory, run } = await loadRun(values.run)
  assertVerificationMatches(run, await verifyRun(directory, run))
  const scope = publicationScope(run)
  if (scope === 'full') {
    const transaction = releaseTransactionPlan(run, values.versionChoice)
    if (run.release_transaction === undefined) run.release_transaction = transaction
  } else if (values.versionChoice !== undefined || run.release_transaction !== undefined) {
    throw new Error('macOS-only immutable publication cannot bind a shared-pointer version choice')
  }
  const request = buildPublicationRequest(run, { dryRun: values.dryRun })
  const path = join(directory, 'publication', 'cloudflare-owner-request.json')
  const status = run.publication?.status
  if (!['not-requested', 'dry-run', 'awaiting-existing-owner', 'passed'].includes(status)) {
    throw new Error('publication run state is invalid')
  }
  if (status === 'passed') throw new Error('publication is already passed for this run')
  if (values.ownerReceipt !== undefined && status !== 'awaiting-existing-owner') {
    throw new Error('publication owner receipt import requires the exact awaiting request state')
  }
  if (status === 'awaiting-existing-owner' && values.dryRun) {
    throw new Error('publication awaiting the existing owner cannot return to dry-run')
  }
  if (status === 'awaiting-existing-owner') {
    if (!isDeepStrictEqual(await json(path), request)) throw new Error('Cloudflare publication owner request is invalid')
  } else {
    await atomicJson(path, request)
  }
  const requestSha256 = await fileDigest(path)
  if (status === 'awaiting-existing-owner' && run.publication.request_sha256 !== requestSha256) {
    throw new Error('publication requires the exact awaiting request state')
  }
  if (values.ownerReceipt !== undefined) {
    const receipt = validatePublicationReceipt(await json(resolve(values.ownerReceipt)), run, requestSha256)
    await atomicJson(join(directory, 'publication', 'cloudflare-owner-receipt.json'), receipt)
    run.publication = {
      status: 'passed', scope: request.release_scope ?? 'full', request_sha256: requestSha256, owner: OWNER,
      ...(run.release_transaction === undefined ? {} : { transaction_mode: run.release_transaction.mode }),
    }
  } else {
    run.publication = {
      status: values.dryRun ? 'dry-run' : 'awaiting-existing-owner', scope: request.release_scope ?? 'full',
      request_sha256: requestSha256, owner: OWNER,
      ...(run.release_transaction === undefined ? {} : { transaction_mode: run.release_transaction.mode }),
    }
  }
  await saveRun(directory, run)
  await writeChecksums(directory)
  process.stdout.write(`${JSON.stringify({ run_id: run.run_id, publication: run.publication, request: relativePath(directory, path) }, null, 2)}\n`)
}

async function rollback(values) {
  const { directory, run } = await loadRun(values.run)
  assertVerificationMatches(run, await verifyRun(directory, run))
  const action = rollbackAction(run, values)
  let publicationReceipt, publicationRequestSha256, publicationReceiptSha256
  const receiptPath = join(directory, 'publication', 'cloudflare-owner-receipt.json')
  if (!values.dryRun) {
    const publicationRequest = join(directory, 'publication', 'cloudflare-owner-request.json')
    publicationRequestSha256 = await fileDigest(publicationRequest)
    publicationReceiptSha256 = await fileDigest(receiptPath)
    publicationReceipt = validatePublicationReceipt(await json(receiptPath), run, publicationRequestSha256)
  }
  const request = buildRollbackRequest(run, publicationReceipt, {
    dryRun: values.dryRun,
    publicationRequestSha256,
    publicationReceiptSha256,
  })
  const path = join(directory, 'rollback', 'cloudflare-owner-request.json')
  if (action === 'dry-run') {
    await atomicJson(path, request)
    run.rollback = { status: 'dry-run', owner: OWNER, delete_objects: 0 }
  } else if (action === 'emit') {
    await atomicJson(path, request)
    run.rollback = awaitingRollbackState({
      publicationRequestSha256,
      publicationReceiptSha256,
      rollbackRequestSha256: await fileDigest(path),
    })
  } else if (action === 'resume-awaiting') {
    const rollbackRequestSha256 = await fileDigest(path)
    validateAwaitingRollbackRequest(run, await json(path), request, {
      publicationRequestSha256, publicationReceiptSha256, rollbackRequestSha256,
    })
  } else {
    run.rollback = await importRollbackOwnerReceipt(directory, run, values.ownerReceipt)
  }
  await saveRun(directory, run)
  await writeChecksums(directory)
  process.stdout.write(`${JSON.stringify({ run_id: run.run_id, rollback: run.rollback, request: relativePath(directory, path) }, null, 2)}\n`)
}

export function normalizeFlowArgv(argv) {
  return argv[0] === '--' && argv[1] !== '--' ? argv.slice(1) : argv
}

function argumentsFor(argv) {
  const { positionals, values } = parseArgs({
    args: normalizeFlowArgv(argv),
    allowPositionals: true,
    strict: true,
    options: {
      run: { type: 'string' },
      retry: { type: 'string' },
      platform: { type: 'string' },
      out: { type: 'string' },
      'source-commit': { type: 'string' },
      'windows-result': { type: 'string' },
      'windows-unavailable': { type: 'boolean', default: false },
      'remote-request': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'owner-receipt': { type: 'string' },
      'version-choice': { type: 'string' },
    },
  })
  if (positionals.length !== 1) throw new Error('usage: pnpm flow <dev|candidate|verify|publish|rollback> [options]')
  return {
    command: positionals[0],
    values: {
      ...values,
      dryRun: values['dry-run'],
      ownerReceipt: values['owner-receipt'],
      sourceCommit: values['source-commit'],
      windowsResult: values['windows-result'],
      windowsUnavailable: values['windows-unavailable'],
      remoteRequest: values['remote-request'],
      versionChoice: values['version-choice'],
    },
  }
}

function validateCommandOptions(command, values) {
  const internal = command === '_platform-build'
  if (!['dev', 'candidate', 'verify', 'publish', 'rollback'].includes(command) && !internal) {
    throw new Error('flow command must be dev, candidate, verify, publish, or rollback')
  }
  if (command === 'dev' && (values.run !== undefined || values.retry !== undefined || values.dryRun
    || values.platform !== undefined || values.out !== undefined || values.sourceCommit !== undefined || values.ownerReceipt !== undefined
    || values.windowsResult !== undefined || values.windowsUnavailable || values.remoteRequest !== undefined || values.versionChoice !== undefined)) {
    throw new Error('dev does not accept options')
  }
  if (command === 'candidate' && (values.dryRun || values.platform !== undefined || values.out !== undefined
    || values.sourceCommit !== undefined || values.ownerReceipt !== undefined || values.remoteRequest !== undefined || values.versionChoice !== undefined
    || values.windowsResult !== undefined && (values.run === undefined || values.retry !== undefined || values.windowsUnavailable)
    || values.windowsUnavailable && (values.run === undefined || values.retry !== undefined))) {
    throw new Error('candidate accepts --run/--retry, --run with --windows-result, or --run --windows-unavailable')
  }
  if (command === 'verify' && (values.run === undefined || values.retry !== undefined || values.dryRun
    || values.platform !== undefined || values.out !== undefined || values.sourceCommit !== undefined || values.ownerReceipt !== undefined
    || values.windowsResult !== undefined || values.windowsUnavailable || values.remoteRequest !== undefined || values.versionChoice !== undefined)) {
    throw new Error('verify requires only --run <id>')
  }
  if (command === 'publish' && (values.run === undefined || values.retry !== undefined
    || values.platform !== undefined || values.out !== undefined || values.sourceCommit !== undefined
    || values.windowsResult !== undefined || values.windowsUnavailable || values.remoteRequest !== undefined
    || values.dryRun && values.ownerReceipt !== undefined)) {
    throw new Error('publish requires --run <id> and accepts --version-choice, --dry-run, or --owner-receipt')
  }
  if (command === 'rollback' && (values.run === undefined || values.retry !== undefined
    || values.platform !== undefined || values.out !== undefined || values.sourceCommit !== undefined
    || values.windowsResult !== undefined || values.windowsUnavailable || values.remoteRequest !== undefined || values.versionChoice !== undefined
    || values.dryRun && values.ownerReceipt !== undefined)) {
    throw new Error('rollback requires --run <id> and accepts only --dry-run or --owner-receipt')
  }
  if (internal && (values.run !== undefined || values.retry !== undefined || values.dryRun || values.ownerReceipt !== undefined
    || values.windowsResult !== undefined || values.windowsUnavailable || values.versionChoice !== undefined
    || values.remoteRequest !== undefined && values.platform !== 'windows')) {
    throw new Error('invalid internal platform build options')
  }
}

async function main() {
  const { command, values } = argumentsFor(process.argv.slice(2))
  validateCommandOptions(command, values)
  if (command === 'dev') await dev()
  else if (command === 'candidate') await candidate(values)
  else if (command === 'verify') await verifyCommand(values)
  else if (command === 'publish') await publish(values)
  else if (command === 'rollback') await rollback(values)
  else if (command === '_platform-build') {
    if (!['macos', 'windows'].includes(values.platform) || values.out === undefined || !SOURCE_SHA.test(values.sourceCommit ?? '')) {
      throw new Error('invalid internal platform build arguments')
    }
    if (git(['rev-parse', 'HEAD']) !== values.sourceCommit || git(['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
      throw new Error('internal platform build requires the exact clean source copy')
    }
    const output = resolve(values.out)
    if (values.remoteRequest === undefined) {
      await platformBuild(ROOT, values.platform, output, join(dirname(output), `${values.platform}.log`))
    } else {
      const requestPath = resolve(values.remoteRequest)
      const { request } = await readWindowsRemoteRequest(requestPath)
      if (request.source_commit !== values.sourceCommit) throw new Error('Windows Codex Remote request source does not match the build')
      await platformBuild(ROOT, 'windows', join(output, 'artifacts', 'windows'), join(output, 'windows.log'))
      await writeWindowsRemoteResult(output, requestPath)
    }
  }
}

if (process.argv[1] !== undefined && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  try {
    await main()
  } catch (cause) {
    const failure = candidateFailureDetails(cause)
    if (failure !== null) process.stderr.write(`${FAILURE_MARKER}${JSON.stringify(failure)}\n`)
    process.stderr.write(`local-flow: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    if (cause instanceof AggregateError) for (const error of cause.errors) process.stderr.write(`- ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
