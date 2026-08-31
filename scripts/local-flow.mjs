#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto'
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
import { canonicalProfileJson } from '../desktop/e-mate-desktop/src/profile-release.ts'
import { parseProfileBaseContract } from '../desktop/e-mate-desktop/src/profile-release.ts'
import { createSigningControlBundle } from './signing-control-bundle.mjs'
import {
  COMPATIBILITY_RECEIPT_PATH,
  PROFILE_SNAPSHOT_PATH,
  SIGNER_ACTION_OWNER,
  SIGNER_ACTION_USES,
  SIGNER_DISPATCH_REQUEST_PATH,
  SIGNER_RESULT_PATH,
  SIGNER_RESULT_OWNER_RECEIPT_PATH,
  SIGNING_BUNDLE_PATH,
  SIGNING_INPUT_RECEIPT_PATH,
  SIGNING_INPUT_REQUEST_PATH,
  buildProtectedSignerDispatchRequest,
  buildSigningInputOwnerRequest,
  collectSigningControlFiles,
  validateCompatibilityCarrierReceipt,
  validateProtectedSignerResultDirectory,
  validateProtectedSignerResultOwnerReceipt,
  validateSigningInputOwnerReceipt,
} from './signer-transport.mjs'

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
const CLOUDFLARE_OWNER = 'codex-cloudflare-plugin'
const MANIFEST_OWNER = SIGNER_ACTION_OWNER
const MANIFEST_SIGNING_CONTEXT = 'e-mate-desktop-release-manifest-v2\0'
const COMPATIBILITY_REPOSITORY = 'zyfjacksonchen-source/e-Mate-2.0.11'
const COMPATIBILITY_WORKFLOW = '.github/workflows/desktop-compatibility-attestation.yml'
export const IMMUTABLE_REQUEST_PATH = 'publication/immutable-owner-request.json'
const IMMUTABLE_RECEIPT_PATH = 'publication/immutable-owner-receipt.json'
const COMPATIBILITY_REQUEST_PATH = 'publication/compatibility-attestation-request.json'
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
const CURRENT_PUBLIC_READER_INSTALLER = Object.freeze({
  url: `${R2_PUBLIC_ORIGIN}/desktop/releases/v2.0.15/297b90df2426137edb398b023d8137a085ed8508/e-Mate-2.0.15-mac-universal.dmg`,
  bytes: 402547931,
  sha256: '6d79a359738c26a9be1d091614875ba426db5314c91f0e4afbe8b582b583ac3a',
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
const MANIFEST_PLATFORM_INPUTS = 'emate.local-manifest-platform-inputs'
const MANIFEST_INPUT_LEDGER = 'emate.local-manifest-input-ledger'
const MANIFEST_INPUT_BINDING = 'emate.local-manifest-input-binding'
const LOCAL_CANDIDATE_PROVENANCE = 'emate.local-candidate-provenance'
const MANIFEST_TREE_CONTEXT = Buffer.from('e-mate-local-manifest-input-tree-v1\0', 'utf8')
const PROFILE_TREE_CONTEXT = Buffer.from('e-mate-staged-profile-tree-v1\0', 'utf8')
const PROFILE_TARGETS = Object.freeze(['darwin-arm64', 'darwin-x64', 'win32-x64'])
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

async function pnpmLifecycleSource(env, execPath) {
  if (PNPM_VERSION === undefined) throw new Error(`unsupported packageManager: ${String(PACKAGE.packageManager)}`)
  const invocation = pinnedPnpmInvocation(PNPM_VERSION, [], { env, execPath })
  const node = await realpath(execPath).catch(() => { throw new Error('active standalone Node executable is unavailable') })
  const entry = await realpath(invocation.args[0]).catch(() => { throw new Error('inherited pinned pnpm entry is unavailable') })
  const [nodeMetadata, entryMetadata] = await Promise.all([lstat(node), lstat(entry)])
  if (!nodeMetadata.isFile()) throw new Error('active standalone Node executable is unavailable')
  if (!entryMetadata.isFile() || entryMetadata.size <= 0 || entryMetadata.size > 16 * 1024 * 1024) {
    throw new Error('inherited pinned pnpm entry is not a bounded regular file')
  }
  return { node, entry, bytes: entryMetadata.size, sha256: await fileDigest(entry) }
}

function pnpmCarrierModule(source) {
  return [
    '#!/usr/bin/env node',
    "'use strict'",
    "const { spawnSync } = require('node:child_process')",
    "const { createHash } = require('node:crypto')",
    "const { readFileSync, realpathSync, statSync } = require('node:fs')",
    `const expected = ${JSON.stringify(source)}`,
    'try {',
    '  const node = realpathSync(process.execPath)',
    '  const entry = realpathSync(expected.entry)',
    '  const metadata = statSync(entry)',
    "  const sha256 = createHash('sha256').update(readFileSync(entry)).digest('hex')",
    '  if (node !== expected.node || entry !== expected.entry || !metadata.isFile()',
    '    || metadata.size !== expected.bytes || sha256 !== expected.sha256) {',
    "    throw new Error('pinned pnpm entry drifted')",
    '  }',
    '  const child = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {',
    "    stdio: 'inherit',",
    '    env: { ...process.env, npm_execpath: entry, npm_node_execpath: node },',
    '  })',
    '  if (child.error !== undefined) throw child.error',
    "  if (!Number.isInteger(child.status)) throw new Error('pinned pnpm child did not return an exit status')",
    '  process.exitCode = child.status',
    '} catch (cause) {',
    "  process.stderr.write(`pnpm lifecycle carrier: ${cause instanceof Error ? cause.message : String(cause)}\\n`)",
    '  process.exitCode = 1',
    '}',
    '',
  ].join('\n')
}

export function windowsPnpmShim(execPath) {
  const node = win32.normalize(execPath)
  if (!win32.isAbsolute(node) || win32.basename(node).toLowerCase() !== 'node.exe'
    || /[%!"&|<>^\r\n]/u.test(node)) throw new Error('Windows pnpm carrier requires a safe absolute node.exe path')
  return `@ECHO OFF\r\n"${node}" "%~dp0pnpm-carrier.cjs" %*\r\n`
}

export function selectWindowsPnpmCommand(output, directory) {
  const command = String(output).split(/\r?\n/u).map(value => value.trim()).find(Boolean)
  if (command === undefined || win32.basename(command).toLowerCase() !== 'pnpm.cmd'
    || win32.dirname(win32.normalize(command)).toLowerCase() !== win32.normalize(directory).toLowerCase()) {
    throw new Error('Windows pnpm.cmd must resolve to the run-scoped carrier')
  }
  return command
}

async function verifyPnpmLifecycleCommand(cwd, source, script, env, platform, directory) {
  const direct = spawnSync(source.node, [script, '--version'], { cwd, encoding: 'utf8', env })
  if (direct.error !== undefined || direct.status !== 0 || direct.stdout.trim() !== PNPM_VERSION) {
    throw new Error(`pnpm lifecycle carrier must run pnpm ${String(PNPM_VERSION)} with the active standalone Node`)
  }
  const command = platform === 'win32'
    ? spawnSync(env.ComSpec ?? env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm --version'], { cwd, encoding: 'utf8', env })
    : spawnSync('pnpm', ['--version'], { cwd, encoding: 'utf8', env })
  if (command.error !== undefined || command.status !== 0 || command.stdout.trim() !== PNPM_VERSION) {
    throw new Error(`nested package scripts cannot resolve pinned pnpm ${String(PNPM_VERSION)}`)
  }
  if (platform === 'win32') {
    const located = spawnSync('where.exe', ['pnpm'], { encoding: 'utf8', env })
    if (located.error !== undefined || located.status !== 0) throw new Error('Windows run-scoped pnpm.cmd is unavailable')
    selectWindowsPnpmCommand(located.stdout, directory)
  }
}

export async function preparePnpmLifecycleCarrier(cwd, {
  env = process.env, execPath = process.execPath, platform = process.platform,
} = {}) {
  const source = await pnpmLifecycleSource(env, execPath)
  const directory = await mkdtemp(join(tmpdir(), 'emate-pnpm-lifecycle-'))
  try {
    const script = join(directory, platform === 'win32' ? 'pnpm-carrier.cjs' : 'pnpm')
    await writeFile(script, pnpmCarrierModule(source), { flag: 'wx', mode: 0o700 })
    if (platform === 'win32') {
      await writeFile(join(directory, 'pnpm.cmd'), windowsPnpmShim(source.node), { flag: 'wx', mode: 0o700 })
    } else {
      const node = join(directory, 'node')
      await symlink(source.node, node)
      if (await realpath(node) !== source.node) throw new Error('pnpm lifecycle Node shim target drifted')
    }
    const carrierEnv = {
      ...env,
      PATH: `${directory}${env.PATH ? `${delimiter}${env.PATH}` : ''}`,
      ...(platform === 'win32' && env.PATHEXT === undefined
        ? { PATHEXT: '.COM;.EXE;.BAT;.CMD' }
        : {}),
    }
    await verifyPnpmLifecycleCommand(cwd, source, script, carrierEnv, platform, directory)
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

export function sourceIdentity(root = ROOT) {
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
        '--manifest-out', '<return-directory>/manifest-inputs/windows',
        '--remote-request', '<request-file>',
      ],
    },
    return: {
      directory: '<return-directory>',
      receipt: WINDOWS_REMOTE_RESULT_FILE,
      artifacts: 'artifacts/windows',
      manifest_inputs: 'manifest-inputs/windows',
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

export async function loadRun(id, root = RUN_ROOT) {
  if (!RUN_ID.test(id ?? '')) throw new Error('invalid --run id')
  const directory = join(root, id)
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

function safeManifestPath(value) {
  return typeof value === 'string' && value !== '' && !isAbsolute(value) && !value.includes('\\')
    && value === value.normalize('NFC') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

async function manifestFile(root, path, label = path) {
  if (!safeManifestPath(path)) throw new Error(`manifest input path is invalid: ${String(path)}`)
  const absolute = join(root, ...path.split('/'))
  const metadata = await lstat(absolute)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular file`)
  return { path, bytes: metadata.size, sha256: await cleanDigest(absolute, label) }
}

async function manifestTree(root, excluded = new Set()) {
  const entries = []
  for (const path of await allFiles(root)) {
    const name = relativePath(root, path)
    if (!excluded.has(name)) entries.push(await manifestFile(root, name))
  }
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  return {
    entries,
    file_count: entries.length,
    total_bytes: totalBytes,
    sha256: digest(Buffer.concat([MANIFEST_TREE_CONTEXT, Buffer.from(JSON.stringify(entries))])),
  }
}

async function copyTree(source, destination) {
  const files = await allFiles(source)
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true })
  for (const path of files) {
    const name = relativePath(source, path)
    const output = join(destination, ...name.split('/'))
    await mkdir(dirname(output), { recursive: true })
    await copyFile(path, output)
  }
}

function profileBase(value) {
  const keys = value?.profile_signing_keys
  if (value?.schema_version !== 1 || typeof value.id !== 'string' || value.id === ''
    || !Number.isSafeInteger(value.schedule_protocol_floor) || value.schedule_protocol_floor < 1
    || !SOURCE_SHA.test(value.harness_commit ?? '') || !Array.isArray(keys) || keys.length === 0
    || keys.some(key => !exactKeys(key, ['id', 'algorithm', 'public_key_spki_der_base64'])
      || !MANIFEST_KEY_ID.test(key.id ?? '') || key.algorithm !== 'ed25519'
      || typeof key.public_key_spki_der_base64 !== 'string' || key.public_key_spki_der_base64 === '')) {
    throw new Error('local manifest Base contract is invalid')
  }
  return {
    id: value.id,
    schedule_protocol_floor: value.schedule_protocol_floor,
    harness_commit: value.harness_commit,
    trusted_signing_key_ids: keys.map(key => key.id),
  }
}

function manifestInventory(value) {
  if (value?.schema_version !== 1 || !Array.isArray(value.components)) throw new Error('local manifest component inventory is invalid')
  const accepted = value.components.filter(component => component?.desktop !== 'blocked')
  if (accepted.length === 0 || accepted.some(component => typeof component.id !== 'string'
    || !['profile', 'platform-profile'].includes(component.kind)
    || component.kind === 'platform-profile' && (!Array.isArray(component.targets)
      || !isDeepStrictEqual(component.targets.map(target => `${target.platform}-${target.arch}`), PROFILE_TARGETS)))) {
    throw new Error('local manifest component inventory accepted set is invalid')
  }
  return accepted
}

function componentSlug(id) {
  const slug = id.replace(/^@e-mate\//u, '')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) throw new Error(`local manifest component id is invalid: ${id}`)
  return slug
}

function platformComponentJobs(inventory, platform) {
  const targetNames = platform === 'macos' ? PROFILE_TARGETS.slice(0, 2) : PROFILE_TARGETS.slice(2)
  return manifestInventory(inventory).flatMap(component => {
    if (component.kind === 'profile') return platform === 'macos' ? [{ component, target: null }] : []
    return targetNames.map(target => ({
      component,
      target: component.targets.find(candidate => `${candidate.platform}-${candidate.arch}` === target),
    }))
  })
}

function targetName(target) {
  return target === null ? null : `${target.platform}-${target.arch}`
}

function payloadRelative(job) {
  const root = `unsigned-components/${componentSlug(job.component.id)}`
  return job.target === null ? root : `${root}/${targetName(job.target)}`
}

async function unsignedComponentPayload(root, job, sourceCommit) {
  const payload = payloadRelative(job)
  const manifestPath = `${payload}/manifest.json`
  const manifest = await json(join(root, ...manifestPath.split('/')))
  if (manifest?.schema_version !== 1 || manifest.id !== job.component.id || manifest.kind !== job.component.kind
    || manifest.source_commit !== sourceCommit || !isDeepStrictEqual(manifest.target, job.target)) {
    throw new Error(`unsigned component payload is invalid: ${job.component.id}/${String(targetName(job.target))}`)
  }
  return { id: job.component.id, target: targetName(job.target), manifest: await manifestFile(root, manifestPath) }
}

function validToolchain(value) {
  return exactKeys(value, ['node', 'pnpm', 'yarn', 'npm'])
    && /^\d+\.\d+\.\d+$/u.test(value.node ?? '') && value.pnpm === PNPM_VERSION
    && value.yarn === YARN_VERSION && PACKAGE_VERSION.test(value.npm ?? '')
}

async function platformManifestEvidence(directory, platform, sourceCommit, toolchain) {
  if (!['macos', 'windows'].includes(platform) || !SOURCE_SHA.test(sourceCommit ?? '') || !validToolchain(toolchain)) {
    throw new Error('local manifest platform identity is invalid')
  }
  const baseBytes = await readFile(join(directory, 'base-contract.json'))
  const inventoryBytes = await readFile(join(directory, 'component-inventory.json'))
  const base = profileBase(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(baseBytes)))
  const inventory = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inventoryBytes))
  const jobs = platformComponentJobs(inventory, platform)
  const payloads = []
  for (const job of jobs) payloads.push(await unsignedComponentPayload(directory, job, sourceCommit))
  const profileReceipt = await json(join(directory, 'profile-build-receipt.json'))
  const profileTree = await manifestTree(join(directory, 'profile-artifact'))
  const stagedInventoryBytes = await readFile(join(directory, 'profile-artifact', 'dsh', 'profile', 'component-inventory.json'))
  if (!exactKeys(profileReceipt, [
    'schema_version', 'document_type', 'source_commit', 'base_contract_id', 'inventory_sha256',
    'staged_profile_tree_sha256', 'file_count', 'total_bytes',
  ]) || profileReceipt.schema_version !== 1 || profileReceipt.document_type !== 'emate.desktop-profile-build-receipt'
    || profileReceipt.source_commit !== sourceCommit || profileReceipt.base_contract_id !== base.id
    || !inventoryBytes.equals(stagedInventoryBytes) || profileReceipt.inventory_sha256 !== digest(inventoryBytes)
    || !SHA256.test(profileReceipt.staged_profile_tree_sha256 ?? '')
    || profileReceipt.staged_profile_tree_sha256 !== digest(Buffer.concat([
      PROFILE_TREE_CONTEXT, Buffer.from(canonicalProfileJson(profileTree.entries), 'utf8'),
    ]))
    || profileReceipt.file_count !== profileTree.file_count || profileReceipt.total_bytes !== profileTree.total_bytes) {
    throw new Error(`${platform} Profile build receipt does not match its exact staged tree`)
  }
  const tree = await manifestTree(directory, new Set(['platform-inputs.json']))
  return {
    schema_version: 1,
    document_type: MANIFEST_PLATFORM_INPUTS,
    platform,
    version: VERSION,
    source_commit: sourceCommit,
    source_status: 'committed-clean',
    targets: platform === 'macos' ? PROFILE_TARGETS.slice(0, 2) : PROFILE_TARGETS.slice(2),
    toolchain,
    base_contract: { ...await manifestFile(directory, 'base-contract.json'), ...base },
    component_inventory: await manifestFile(directory, 'component-inventory.json'),
    profile_build_receipt: await manifestFile(directory, 'profile-build-receipt.json'),
    profile_artifact: {
      root: 'profile-artifact', file_count: profileTree.file_count,
      total_bytes: profileTree.total_bytes, sha256: profileReceipt.staged_profile_tree_sha256,
    },
    unsigned_component_payloads: payloads,
    profile_signing: 'awaiting-existing-owner',
    tree: { file_count: tree.file_count, total_bytes: tree.total_bytes, sha256: tree.sha256 },
  }
}

export async function createPlatformManifestInputReceipt(directory, { platform, sourceCommit, toolchain }) {
  const receipt = await platformManifestEvidence(directory, platform, sourceCommit, toolchain)
  await atomicJson(join(directory, 'platform-inputs.json'), receipt)
  return receipt
}

async function verifyPlatformManifestInputs(directory, platform, sourceCommit) {
  const receipt = await json(join(directory, 'platform-inputs.json'))
  const expected = await platformManifestEvidence(directory, platform, sourceCommit, receipt?.toolchain)
  if (!isDeepStrictEqual(receipt, expected)) throw new Error(`${platform} manifest input receipt is invalid`)
  return { receipt, descriptor: await manifestFile(directory, 'platform-inputs.json') }
}

function validManifestDescriptor(value) {
  return exactKeys(value, ['path', 'bytes', 'sha256']) && safeManifestPath(value.path)
    && Number.isSafeInteger(value.bytes) && value.bytes > 0 && SHA256.test(value.sha256 ?? '')
}

function manifestInputBinding(run) {
  const value = run?.manifest_inputs
  if (!exactKeys(value, [
    'schema_version', 'document_type', 'status', 'ledger', 'base_contract', 'component_inventory',
    'profile_build_receipts', 'platform_receipts', 'artifact_receipts', 'local_candidate_provenance',
    'profile_signing', 'client_compatible_provenance', 'targets',
  ]) || value.schema_version !== 1 || value.document_type !== MANIFEST_INPUT_BINDING
    || value.status !== 'complete-unsigned-inputs' || !validManifestDescriptor(value.ledger)
    || !exactKeys(value.base_contract, [
      'path', 'bytes', 'sha256', 'id', 'schedule_protocol_floor', 'harness_commit', 'trusted_signing_key_ids',
    ]) || !validManifestDescriptor({ path: value.base_contract.path, bytes: value.base_contract.bytes, sha256: value.base_contract.sha256 })
    || typeof value.base_contract.id !== 'string' || value.base_contract.id === ''
    || !Number.isSafeInteger(value.base_contract.schedule_protocol_floor) || value.base_contract.schedule_protocol_floor < 1
    || !SOURCE_SHA.test(value.base_contract.harness_commit ?? '')
    || !Array.isArray(value.base_contract.trusted_signing_key_ids) || value.base_contract.trusted_signing_key_ids.length === 0
    || value.base_contract.trusted_signing_key_ids.some(id => !MANIFEST_KEY_ID.test(id))
    || !validManifestDescriptor(value.component_inventory)
    || !exactKeys(value.profile_build_receipts, Object.keys(PLATFORMS))
    || !exactKeys(value.platform_receipts, Object.keys(PLATFORMS))
    || !exactKeys(value.artifact_receipts, Object.keys(PLATFORMS))
    || !Object.values(value.profile_build_receipts).every(validManifestDescriptor)
    || !Object.values(value.platform_receipts).every(validManifestDescriptor)
    || !Object.values(value.artifact_receipts).every(validManifestDescriptor)
    || !validManifestDescriptor(value.local_candidate_provenance)
    || value.profile_signing !== 'awaiting-existing-owner'
    || value.client_compatible_provenance !== 'open-existing-owner'
    || !isDeepStrictEqual(value.targets, PROFILE_TARGETS)) throw new Error('full publication manifest inputs are incomplete')
  return value
}

function prefixedDescriptor(prefix, descriptor) {
  return { ...descriptor, path: `${prefix}/${descriptor.path}` }
}

function localCandidateProvenance(run, platforms, artifacts) {
  return {
    schema_version: 1,
    document_type: LOCAL_CANDIDATE_PROVENANCE,
    provenance_mode: 'local-clean-source-native-build-receipts',
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    source_status: 'committed-clean',
    distribution_origin: R2_PUBLIC_ORIGIN,
    toolchains: Object.fromEntries(Object.entries(platforms).map(([name, value]) => [name, value.receipt.toolchain])),
    artifact_receipts: artifacts,
    manifest_input_receipts: Object.fromEntries(Object.entries(platforms).map(([name, value]) => [name, value.descriptor])),
    profile_signing: 'awaiting-existing-owner',
    client_compatible_provenance: 'open-existing-owner',
  }
}

export async function finalizeManifestInputLedger(directory, run) {
  if (!RUN_ID.test(run?.run_id ?? '') || run.version !== VERSION || !SOURCE_SHA.test(run.source_commit ?? '')) {
    throw new Error('manifest input run identity is invalid')
  }
  const root = join(directory, 'manifest-inputs')
  const platforms = Object.fromEntries(await Promise.all(Object.keys(PLATFORMS).map(async platform => [
    platform,
    await verifyPlatformManifestInputs(join(root, 'platforms', platform), platform, run.source_commit),
  ])))
  if (platforms.macos.receipt.base_contract.sha256 !== platforms.windows.receipt.base_contract.sha256
    || platforms.macos.receipt.component_inventory.sha256 !== platforms.windows.receipt.component_inventory.sha256) {
    throw new Error('native manifest input Base or inventory drifted across platforms')
  }
  const artifacts = {}
  for (const platform of Object.keys(PLATFORMS)) {
    await verifyLocalArtifact(join(directory, 'artifacts', platform), platform, run.source_commit)
    const path = `artifacts/${platform}/local-artifact-receipt.json`
    artifacts[platform] = await manifestFile(directory, path)
  }
  const provenance = localCandidateProvenance(run, platforms, artifacts)
  if (/\/(?:Users|home)\/|[A-Za-z]:\\Users\\/u.test(JSON.stringify(provenance))) {
    throw new Error('local candidate provenance contains a developer path')
  }
  await atomicJson(join(root, 'local-candidate-provenance.json'), provenance)
  const tree = await manifestTree(root, new Set(['manifest-inputs.json']))
  const ledger = {
    schema_version: 1,
    document_type: MANIFEST_INPUT_LEDGER,
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    source_status: 'committed-clean',
    distribution_origin: R2_PUBLIC_ORIGIN,
    profile_signing: 'awaiting-existing-owner',
    client_compatible_provenance: 'open-existing-owner',
    targets: [...PROFILE_TARGETS],
    base_contract: platforms.macos.receipt.base_contract,
    component_inventory: platforms.macos.receipt.component_inventory,
    platform_receipts: Object.fromEntries(Object.entries(platforms).map(([name, value]) => [name, value.descriptor])),
    artifact_receipts: artifacts,
    local_candidate_provenance: await manifestFile(root, 'local-candidate-provenance.json'),
    files: tree.entries,
  }
  await atomicJson(join(root, 'manifest-inputs.json'), ledger)
  const binding = {
    schema_version: 1,
    document_type: MANIFEST_INPUT_BINDING,
    status: 'complete-unsigned-inputs',
    ledger: await manifestFile(directory, 'manifest-inputs/manifest-inputs.json'),
    base_contract: { ...ledger.base_contract, path: `manifest-inputs/platforms/macos/${ledger.base_contract.path}` },
    component_inventory: prefixedDescriptor('manifest-inputs/platforms/macos', ledger.component_inventory),
    profile_build_receipts: Object.fromEntries(Object.entries(platforms).map(([name, value]) => [
      name, prefixedDescriptor(`manifest-inputs/platforms/${name}`, value.receipt.profile_build_receipt),
    ])),
    platform_receipts: Object.fromEntries(Object.entries(platforms).map(([name, value]) => [
      name, prefixedDescriptor(`manifest-inputs/platforms/${name}`, value.descriptor),
    ])),
    artifact_receipts: artifacts,
    local_candidate_provenance: prefixedDescriptor('manifest-inputs', ledger.local_candidate_provenance),
    profile_signing: ledger.profile_signing,
    client_compatible_provenance: ledger.client_compatible_provenance,
    targets: [...ledger.targets],
  }
  run.manifest_inputs = binding
  await verifyManifestInputLedger(directory, run)
  return binding
}

export async function verifyManifestInputLedger(directory, run) {
  const binding = manifestInputBinding(run)
  const ledgerFile = await manifestFile(directory, binding.ledger.path)
  if (!isDeepStrictEqual(ledgerFile, binding.ledger)) throw new Error('manifest input ledger drifted from run binding')
  const ledger = await json(join(directory, ...binding.ledger.path.split('/')))
  const root = join(directory, 'manifest-inputs')
  const platforms = Object.fromEntries(await Promise.all(Object.keys(PLATFORMS).map(async platform => [
    platform,
    await verifyPlatformManifestInputs(join(root, 'platforms', platform), platform, run.source_commit),
  ])))
  const artifacts = {}
  for (const platform of Object.keys(PLATFORMS)) {
    await verifyLocalArtifact(join(directory, 'artifacts', platform), platform, run.source_commit)
    artifacts[platform] = await manifestFile(directory, `artifacts/${platform}/local-artifact-receipt.json`)
  }
  const provenancePath = join(root, 'local-candidate-provenance.json')
  const provenance = await json(provenancePath)
  if (!isDeepStrictEqual(provenance, localCandidateProvenance(run, platforms, artifacts))) {
    throw new Error('local candidate provenance is invalid')
  }
  const tree = await manifestTree(root, new Set(['manifest-inputs.json']))
  const expected = {
    schema_version: 1,
    document_type: MANIFEST_INPUT_LEDGER,
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    source_status: 'committed-clean',
    distribution_origin: R2_PUBLIC_ORIGIN,
    profile_signing: 'awaiting-existing-owner',
    client_compatible_provenance: 'open-existing-owner',
    targets: [...PROFILE_TARGETS],
    base_contract: platforms.macos.receipt.base_contract,
    component_inventory: platforms.macos.receipt.component_inventory,
    platform_receipts: Object.fromEntries(Object.entries(platforms).map(([name, value]) => [name, value.descriptor])),
    artifact_receipts: artifacts,
    local_candidate_provenance: await manifestFile(root, 'local-candidate-provenance.json'),
    files: tree.entries,
  }
  if (!isDeepStrictEqual(ledger, expected)
    || !isDeepStrictEqual(binding.base_contract, { ...expected.base_contract, path: `manifest-inputs/platforms/macos/${expected.base_contract.path}` })
    || !isDeepStrictEqual(binding.component_inventory, prefixedDescriptor('manifest-inputs/platforms/macos', expected.component_inventory))
    || !isDeepStrictEqual(binding.profile_build_receipts, Object.fromEntries(Object.entries(platforms).map(([name, value]) => [
      name, prefixedDescriptor(`manifest-inputs/platforms/${name}`, value.receipt.profile_build_receipt),
    ])))
    || !isDeepStrictEqual(binding.platform_receipts, Object.fromEntries(Object.entries(platforms).map(([name, value]) => [
      name, prefixedDescriptor(`manifest-inputs/platforms/${name}`, value.descriptor),
    ])))
    || !isDeepStrictEqual(binding.artifact_receipts, artifacts)
    || !isDeepStrictEqual(binding.local_candidate_provenance, prefixedDescriptor('manifest-inputs', expected.local_candidate_provenance))) {
    throw new Error('manifest input ledger is invalid')
  }
  return ledger
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

function checkedSync(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(result.stderr.trim() || `${command} ${args.join(' ')} exited with ${String(result.status)}`)
}

async function candidatePreflight() {
  let identity
  await runCandidateStages([
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'pinned-package-manager',
      run: async () => (await preparePnpmLifecycleCarrier(ROOT)).cleanup(),
    },
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

function addCheck(checks, command, args, env) {
  const key = JSON.stringify([command, args, env])
  if (!checks.some(item => item.key === key)) checks.push({ key, command, args, ...(env === undefined ? {} : { env }) })
}

export function devChecks(plan, paths) {
  const checks = []
  const tests = [...new Set(paths.filter(path => path.startsWith('scripts/') && path.endsWith('.test.mjs')))].sort()
  // This test imports emitted Harness libraries and test:fast already runs it after the Base prepare.
  const earlyTests = plan.lane === 'base'
    ? tests.filter(path => path !== 'scripts/create-chat-state-fixture.test.mjs')
    : tests
  const localFlowOnly = paths.length > 0 && paths.every(path => [
    'package.json', 'scripts/local-flow.mjs', 'scripts/local-flow.test.mjs', 'docs/development-log.md',
  ].includes(path))
  if (earlyTests.length > 0) addCheck(checks, 'node', ['--test', ...earlyTests])
  if ((localFlowOnly || paths.some(path => path.startsWith('scripts/local-flow')))
    && !tests.includes('scripts/local-flow.test.mjs')) {
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
    if (tests.length === 0) addCheck(checks, 'node', ['scripts/change-impact.mjs', '--check-contract'])
  } else {
    addCheck(checks, 'pnpm', ['--dir', 'upstream/deepseek-harness', 'install', '--frozen-lockfile'], { CI: 'true' })
    addCheck(checks, 'pnpm', ['run', 'build:harness'])
    addCheck(checks, 'pnpm', ['run', 'test:fast'])
  }
  return checks.map(({ key: _key, ...check }) => check)
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
  const pnpmCarrier = await preparePnpmLifecycleCarrier(ROOT)
  try {
    const { directory, run } = await createRun('dev', identity, {
      status: 'running', impact: plan, checks, affected_computer_use: scenarios,
    })
    const log = join(directory, 'logs', 'dev.log')
    try {
      for (const check of checks) {
        const env = check.env === undefined ? pnpmCarrier.env : { ...pnpmCarrier.env, ...check.env }
        if (check.command === 'pnpm') await runPnpm(check.args, { cwd: ROOT, log, env })
        else await runLogged(process.execPath, check.args, { cwd: ROOT, log, env })
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
  } finally {
    await pnpmCarrier.cleanup()
  }
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

async function capturePlatformManifestInputs(sourceRoot, platform, output, sourceCommit, log, npmVersion, env) {
  const scratch = join(sourceRoot, '.release-cache', `local-flow-manifest-${platform}`)
  await rm(scratch, { recursive: true, force: true })
  await mkdir(scratch, { recursive: true })
  try {
    await runLogged(process.execPath, ['scripts/stage-desktop-profile-artifact.mjs'], { cwd: sourceRoot, log, env })
    await copyFile(join(sourceRoot, 'desktop/e-mate-desktop/base-contract.json'), join(scratch, 'base-contract.json'))
    await copyFile(join(sourceRoot, 'packages/dsh/profile/component-inventory.json'), join(scratch, 'component-inventory.json'))
    await copyTree(join(sourceRoot, '.release-cache/profile-artifact'), join(scratch, 'profile-artifact'))
    await runLogged(process.execPath, [
      'scripts/desktop-admission.mjs', 'profile-build-receipt',
      '--commit', sourceCommit,
      '--profile', '.release-cache/profile-artifact',
      '--inventory', 'packages/dsh/profile/component-inventory.json',
      '--base-contract', 'desktop/e-mate-desktop/base-contract.json',
      '--out', relativePath(sourceRoot, join(scratch, 'profile-build-receipt.json')),
    ], { cwd: sourceRoot, log, env })
    const inventory = await json(join(scratch, 'component-inventory.json'))
    for (const job of platformComponentJobs(inventory, platform)) {
      const target = targetName(job.target)
      const args = [
        'scripts/component-release.mjs', 'emit', '--component', job.component.id,
        '--source-commit', sourceCommit,
        ...(target === null ? [] : ['--target', target]),
        '--out', relativePath(sourceRoot, join(scratch, ...payloadRelative(job).split('/'))),
      ]
      await runLogged(process.execPath, args, { cwd: sourceRoot, log, env })
    }
    await createPlatformManifestInputReceipt(scratch, {
      platform,
      sourceCommit,
      toolchain: { node: process.versions.node, pnpm: PNPM_VERSION, yarn: YARN_VERSION, npm: npmVersion },
    })
    await copyTree(scratch, output)
    await verifyPlatformManifestInputs(output, platform, sourceCommit)
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function platformBuild(sourceRoot, platform, output, manifestOutput, log) {
  const expectedPlatform = platform === 'macos' ? 'darwin' : 'win32'
  let pnpmCarrier, npmCollector
  let buildEnv = process.env
  await runCandidateStages([
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'native-platform',
      run: () => {
        if (process.platform !== expectedPlatform) throw new Error(`${platform} candidate must build on native ${expectedPlatform}`)
        if (platform === 'windows') validateRemoteHostname(hostname())
      },
    },
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'pinned-package-manager',
      run: async () => {
        pnpmCarrier = await preparePnpmLifecycleCarrier(sourceRoot)
        buildEnv = pnpmCarrier.env
      },
    },
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'desktop-npm-collector',
      run: async () => { npmCollector = await prepareNpmCollectorCarrier(join(sourceRoot, 'desktop'), { env: buildEnv }) },
    },
    {
      category: CANDIDATE_FAILURE.SOURCE,
      stage: 'release-boundary',
      run: () => runLogged(process.execPath, ['scripts/change-impact.mjs', '--check-contract'], { cwd: sourceRoot, log, env: buildEnv }),
    },
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'root-install',
      run: () => runPnpm(['install', '--frozen-lockfile'], { cwd: sourceRoot, log, env: buildEnv }),
    },
    {
      category: CANDIDATE_FAILURE.TOOLCHAIN,
      stage: 'harness-install',
      run: () => runPnpm(['--dir', 'upstream/deepseek-harness', 'install', '--frozen-lockfile'], {
        cwd: sourceRoot, log, env: { ...buildEnv, CI: 'true' },
      }),
    },
    {
      category: CANDIDATE_FAILURE.SOURCE,
      stage: 'harness-host-client-web',
      run: () => runPnpm(['run', 'build:harness'], { cwd: sourceRoot, log, env: buildEnv }),
    },
    {
      category: CANDIDATE_FAILURE.COMPONENT_ABI,
      stage: 'component-emitted-abi',
      run: () => runLogged(process.execPath, ['scripts/component-run.mjs', 'build'], { cwd: sourceRoot, log, env: buildEnv }),
    },
    {
      category: CANDIDATE_FAILURE.SOURCE,
      stage: 'profile-build',
      run: () => runPnpm(['--filter', '@e-mate/dsh', 'build'], { cwd: sourceRoot, log, env: buildEnv }),
    },
    {
      category: CANDIDATE_FAILURE.PACKAGING,
      stage: 'native-runtime-inputs',
      run: () => runLogged(platform === 'macos' ? 'python3' : 'python', [
        'packages/dsh-plugin-vision-toolkit/scripts/prepare-wheels.py',
        '--root', 'packages/dsh-plugin-vision-toolkit',
        '--targets', platform === 'macos' ? 'darwin-arm64,darwin-x64' : 'win32-x64',
      ], { cwd: sourceRoot, log, env: buildEnv }),
    },
    {
      category: CANDIDATE_FAILURE.PACKAGING,
      stage: 'desktop-install',
      run: () => runYarn(['install', '--immutable'], { cwd: join(sourceRoot, 'desktop'), log, env: npmCollector.env }),
    },
    {
      category: CANDIDATE_FAILURE.COMPONENT_ABI,
      stage: 'manifest-input-ledger',
      run: () => capturePlatformManifestInputs(
        sourceRoot, platform, manifestOutput, git(['rev-parse', 'HEAD'], sourceRoot), log, npmCollector.version, buildEnv,
      ),
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
  ]).finally(() => Promise.all([npmCollector?.cleanup(), pnpmCarrier?.cleanup()]))
}

async function readWindowsRemoteRequest(path, run) {
  const metadata = await regularFile(path, 'Windows Codex Remote request')
  if (metadata.size > 1024 * 1024) throw new Error('Windows Codex Remote request is too large')
  const bytes = await readFile(path)
  assertCleanArtifactBytes(bytes, 'Windows Codex Remote request')
  const request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  return { bytes, request: validateWindowsRemoteRequest(request, run ?? request) }
}

function windowsRemoteResult(request, verified, requestSha256, artifactReceiptSha256, manifestReceipt, host, log) {
  if (!SHA256.test(requestSha256 ?? '') || !SHA256.test(artifactReceiptSha256 ?? '')) {
    throw new Error('Windows Codex Remote result digest is invalid')
  }
  if (!exactKeys(log, ['file', 'bytes', 'sha256']) || log.file !== 'windows.log'
    || !Number.isSafeInteger(log.bytes) || log.bytes <= 0 || !SHA256.test(log.sha256 ?? '')) {
    throw new Error('Windows Codex Remote log receipt is invalid')
  }
  if (!exactKeys(manifestReceipt, ['file', 'bytes', 'sha256'])
    || manifestReceipt.file !== 'manifest-inputs/windows/platform-inputs.json'
    || !Number.isSafeInteger(manifestReceipt.bytes) || manifestReceipt.bytes <= 0
    || !SHA256.test(manifestReceipt.sha256 ?? '')) throw new Error('Windows manifest input receipt is invalid')
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
    manifest_input_receipt: manifestReceipt,
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
  const manifest = await verifyPlatformManifestInputs(join(directory, 'manifest-inputs', 'windows'), 'windows', request.source_commit)
  const log = await windowsRemoteLog(directory)
  await atomicJson(join(directory, WINDOWS_REMOTE_RESULT_FILE), windowsRemoteResult(
    request, verified, digest(bytes), await fileDigest(receiptPath), {
      file: 'manifest-inputs/windows/platform-inputs.json',
      bytes: manifest.descriptor.bytes,
      sha256: manifest.descriptor.sha256,
    }, hostname(), log.descriptor,
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
  await rm(join(directory, 'manifest-inputs', 'platforms', 'windows'), { recursive: true, force: true })
  delete run.manifest_inputs
  run.platforms.windows = blockedWindowsState(run.source_commit, failure)
}

export async function importWindowsRemoteResult(resultDirectory, output, run, requestPath, manifestDestination = `${output}-manifest-inputs`) {
  const { bytes: requestBytes, request } = await readWindowsRemoteRequest(requestPath, run)
  if (!isDeepStrictEqual(run.platforms?.windows, {
    status: 'awaiting-codex-remote',
    source_commit: run.source_commit,
    request: 'windows-remote/request.json',
    request_sha256: digest(requestBytes),
  })) throw new Error('Windows Codex Remote import requires the exact awaiting request state')
  const rootEntries = (await readdir(resultDirectory)).sort()
  if (!isDeepStrictEqual(rootEntries, ['artifacts', WINDOWS_REMOTE_RESULT_FILE, 'manifest-inputs', 'windows.log'])) {
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
  const manifestRoot = join(resultDirectory, 'manifest-inputs')
  const manifestRootMetadata = await lstat(manifestRoot)
  if (!manifestRootMetadata.isDirectory() || manifestRootMetadata.isSymbolicLink()
    || !isDeepStrictEqual(await readdir(manifestRoot), ['windows'])) {
    throw new Error('Windows Codex Remote manifest input root is invalid')
  }
  const manifest = await verifyPlatformManifestInputs(join(manifestRoot, 'windows'), 'windows', run.source_commit)
  const artifactReceiptPath = join(artifacts, 'local-artifact-receipt.json')
  const resultPath = join(resultDirectory, WINDOWS_REMOTE_RESULT_FILE)
  const resultMetadata = await regularFile(resultPath, 'Windows Codex Remote result receipt')
  if (resultMetadata.size > 1024 * 1024) throw new Error('Windows Codex Remote result receipt is too large')
  const resultBytes = await readFile(resultPath)
  assertCleanArtifactBytes(resultBytes, 'Windows Codex Remote result receipt')
  const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(resultBytes))
  const log = await windowsRemoteLog(resultDirectory)
  const expected = windowsRemoteResult(
    request, verified, digest(requestBytes), await fileDigest(artifactReceiptPath), {
      file: 'manifest-inputs/windows/platform-inputs.json',
      bytes: manifest.descriptor.bytes,
      sha256: manifest.descriptor.sha256,
    }, result?.host, log.descriptor,
  )
  if (!isDeepStrictEqual(result, expected)) throw new Error('Windows Codex Remote result receipt is invalid')

  const staging = `${output}.importing-${randomBytes(4).toString('hex')}`
  const manifestOutput = resolve(manifestDestination)
  const manifestStaging = `${manifestOutput}.importing-${randomBytes(4).toString('hex')}`
  try {
    await mkdir(staging, { recursive: true })
    for (const name of await readdir(artifacts)) await copyFile(join(artifacts, name), join(staging, name))
    const imported = await verifyLocalArtifact(staging, 'windows', run.source_commit)
    await copyTree(join(manifestRoot, 'windows'), manifestStaging)
    await verifyPlatformManifestInputs(manifestStaging, 'windows', run.source_commit)
    await rm(output, { recursive: true, force: true })
    await rename(staging, output)
    await rm(manifestOutput, { recursive: true, force: true })
    await mkdir(dirname(manifestOutput), { recursive: true })
    await rename(manifestStaging, manifestOutput)
    return { receipt: result, receipt_path: resultPath, log_path: log.path, primary: imported.primary }
  } finally {
    await rm(staging, { recursive: true, force: true })
    await rm(manifestStaging, { recursive: true, force: true })
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
    await verifyPlatformManifestInputs(join(directory, 'manifest-inputs', 'platforms', 'macos'), 'macos', run.source_commit)
    const windows = markWindowsUnavailable(run)
    const requestPath = join(directory, windows.request)
    const { bytes } = await readWindowsRemoteRequest(requestPath, run)
    if (digest(bytes) !== windows.request_sha256) throw new Error('Windows unavailable waiver request drifted')
    run.platforms.windows = windows
    run.status = 'built-macos-only'
    delete run.manifest_inputs
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
    const imported = await importWindowsRemoteResult(
      resolve(values.windowsResult), output, run, requestPath,
      join(directory, 'manifest-inputs', 'platforms', 'windows'),
    )
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
    if (run.status === 'built') await finalizeManifestInputLedger(directory, run)
    await writeComputerUseTemplates(directory, run.source_commit, { ...artifacts, windows: imported.primary })
    await saveRun(directory, run)
    await writeChecksums(directory)
    process.stdout.write(`${JSON.stringify({ run_id: run.run_id, source_commit: run.source_commit, platforms: run.platforms }, null, 2)}\n`)
    return
  }
  const selection = selectCandidatePlatforms(run, values.retry ?? 'all')
  for (const platform of selection.reuse) {
    await verifyLocalArtifact(join(directory, 'artifacts', platform), platform, run.source_commit)
    await verifyPlatformManifestInputs(join(directory, 'manifest-inputs', 'platforms', platform), platform, run.source_commit)
    run.platforms[platform].status = 'reused'
  }
  if (selection.build.length === 0) {
    run.status = Object.values(run.platforms).every(item => ['passed', 'reused'].includes(item.status)) ? 'built' : 'partial'
    if (run.status === 'built') await finalizeManifestInputLedger(directory, run)
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
      await rm(join(directory, 'manifest-inputs', 'platforms', platform), { recursive: true, force: true })
      delete run.manifest_inputs
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
        const manifestTemporary = join(scratch, 'macos-manifest-inputs')
        await runLogged(process.execPath, [
          join(source, 'scripts', 'local-flow.mjs'), '_platform-build', '--platform', 'macos',
          '--out', temporary, '--manifest-out', manifestTemporary, '--source-commit', run.source_commit,
        ], { cwd: source, log })
        await mkdir(dirname(output), { recursive: true })
        await rm(output, { recursive: true, force: true })
        await mkdir(output)
        for (const name of await readdir(temporary)) await copyFile(join(temporary, name), join(output, name))
        await copyTree(manifestTemporary, join(directory, 'manifest-inputs', 'platforms', 'macos'))
        const verified = await verifyLocalArtifact(output, platform, run.source_commit)
        await verifyPlatformManifestInputs(join(directory, 'manifest-inputs', 'platforms', 'macos'), 'macos', run.source_commit)
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
    if (run.status === 'built') await finalizeManifestInputLedger(directory, run)
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

function installerObjectRecords(run) {
  if (publicationScope(run) !== 'full') return objectRecords(run)
  const expected = new Set(['macos', 'windows'].map(platform => releaseArtifactName(platform, run.version)))
  const records = objectRecords(run).filter(object => expected.has(basename(object.key)))
  if (records.length !== 2 || new Set(records.map(object => object.platform)).size !== 2) {
    throw new Error('full publication requires exactly the verified macOS and Windows installers')
  }
  return records.map(object => ({ ...object, url: `${R2_PUBLIC_ORIGIN}/${object.key}` }))
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
  const candidateMac = run.verification?.artifacts?.macos?.primary
  if (sameVersion && (!Number.isSafeInteger(candidateMac?.bytes) || candidateMac.bytes <= 0
    || !SHA256.test(candidateMac.sha256 ?? ''))) {
    throw new Error('current replacement Reader attestation requires the exact candidate macOS installer')
  }
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
    legacy_pointer: {
      key: CURRENT_PUBLIC_POINTERS.legacy.key,
      action: 'unchanged',
      reason: 'pre-2.0.15-manual-replacement-only',
    },
    reader_attestation: sameVersion ? {
      source_mode: 'candidate',
      current_version: run.version,
      expected_status: 'up-to-date',
      installer: {
        url: `${R2_PUBLIC_ORIGIN}/desktop/releases/v${run.version}/${run.source_commit}/e-Mate-${run.version}-mac-universal.dmg`,
        bytes: candidateMac.bytes,
        sha256: candidateMac.sha256,
      },
    } : {
      source_mode: 'public-predecessor',
      current_version: CURRENT_PUBLIC_VERSION,
      expected_status: 'update-available',
      installer: { ...CURRENT_PUBLIC_READER_INSTALLER },
    },
    activation_order: ['manual', 'signed'],
    rollback_order: sameVersion ? ['signed', 'manual'] : ['signed'],
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
  return {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-request',
    operation: 'publish-installers-immutable',
    mode: dryRun ? 'dry-run' : 'apply',
    status: 'ready-for-existing-owner',
    authority: CLOUDFLARE_OWNER,
    distribution_origin: R2_PUBLIC_ORIGIN,
    release_scope: 'full-installers-immutable-only',
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    transaction_mode: transaction.mode,
    manual_reinstall_required_for_existing_2_0_15: transaction.manual_reinstall_required_for_existing_2_0_15,
    rebuild: false,
    macos_publication_mode: 'unsigned',
    installer_security: INSTALLER_SECURITY,
    immutable_objects: installerObjectRecords(run),
    completion: {
      order: [
        'immutable-create-only-or-already-exact', 'authenticated-full-byte-readback', 'public-full-byte-readback',
      ],
      terminal_state: 'immutable-installers-verified',
      next_request: 'schema-2-compatibility-attestation',
    },
    delete_objects: [],
  }
}

function validActivationStageEvidence(value, run) {
  const exactFiles = [
    'desktop-candidate.json', releaseArtifactName('macos', run.version), releaseArtifactName('windows', run.version),
  ]
  const immutable = value?.immutable_publication
  const compatibility = value?.compatibility_attestation
  const artifact = compatibility?.artifact
  return exactKeys(value, ['immutable_publication', 'compatibility_attestation'])
    && exactKeys(immutable, ['status', 'request_sha256', 'receipt_sha256']) && immutable.status === 'passed'
    && SHA256.test(immutable.request_sha256 ?? '') && SHA256.test(immutable.receipt_sha256 ?? '')
    && exactKeys(compatibility, [
      'status', 'request_sha256', 'repository', 'workflow', 'ref', 'head_sha', 'run_id', 'run_attempt', 'artifact',
    ]) && compatibility.status === 'passed' && SHA256.test(compatibility.request_sha256 ?? '')
    && compatibility.repository === COMPATIBILITY_REPOSITORY && compatibility.workflow === COMPATIBILITY_WORKFLOW
    && compatibility.ref === 'refs/heads/main' && compatibility.head_sha === run.source_commit
    && /^[1-9][0-9]*$/u.test(compatibility.run_id ?? '') && compatibility.run_attempt === 1
    && exactKeys(artifact, ['role', 'name', 'artifact_id', 'digest', 'exact_files'])
    && artifact.role === 'desktop_candidate' && artifact.name === `e-mate-desktop-release-${run.source_commit}`
    && /^[1-9][0-9]*$/u.test(artifact.artifact_id ?? '') && /^sha256:[0-9a-f]{64}$/u.test(artifact.digest ?? '')
    && isDeepStrictEqual(artifact.exact_files, exactFiles)
}

function strictBase64(value) {
  if (typeof value !== 'string' || value === '') return
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) return
  return bytes
}

async function validateDesktopSignerResult(resultRoot, run) {
  const runRoot = resolve(resultRoot, '..', '..')
  const signedPath = join(resultRoot, 'desktop-release-signed.json')
  const planPath = join(resultRoot, 'cloudflare-publication-plan.json')
  const handoffPath = join(resultRoot, 'cloudflare-plugin-handoff.json')
  const readerPath = join(resultRoot, 'desktop-update-reader-attestation.json')
  const signedBytes = await readFile(signedPath)
  const [signed, plan, handoff, reader] = await Promise.all([
    json(signedPath), json(planPath), json(handoffPath), json(readerPath),
  ])
  const signedDescriptor = await manifestFile(resultRoot, 'desktop-release-signed.json')
  const planDescriptor = await manifestFile(resultRoot, 'cloudflare-publication-plan.json')
  const handoffDescriptor = await manifestFile(resultRoot, 'cloudflare-plugin-handoff.json')
  const readerDescriptor = await manifestFile(resultRoot, 'desktop-update-reader-attestation.json')
  if (!exactKeys(handoff, [
    'schema_version', 'document_type', 'status', 'owner', 'repository', 'source_commit', 'run_id', 'version',
    'data_plane', 'inputs', 'compatibility_attestation', 'github_verification', 'profile_signing', 'files',
    'production_state', 'next_owner',
  ]) || handoff.schema_version !== 1 || handoff.document_type !== 'emate.local-schema2-signer-receipt'
    || handoff.status !== 'passed' || handoff.owner !== SIGNER_ACTION_OWNER
    || handoff.repository !== COMPATIBILITY_REPOSITORY || handoff.source_commit !== run.source_commit
    || handoff.run_id !== run.run_id || handoff.version !== run.version
    || !sameRecord(handoff.data_plane, {
      origin: R2_PUBLIC_ORIGIN, installer_download: 'cloudflare-r2-only', online_update: 'cloudflare-r2-only',
      rollback: 'cloudflare-r2-only', github_role: 'compatibility-attestation-carrier-only',
      github_built_or_tested_installer_bytes: false,
    }) || !sameRecord(handoff.production_state, {
      r2_write_performed: false, public_readback_performed: false,
      active_pointer_changed: false, legacy_pointer_changed: false,
    }) || handoff.next_owner !== 'main-local-flow-activation'
    || !exactKeys(handoff.files, ['signed_manifest', 'publication_plan'])
    || !isDeepStrictEqual(handoff.files.signed_manifest, {
      ...signedDescriptor,
      schema_version: 2,
      version: run.version,
      base_contract_id: signed.base_contract_id,
      schedule_protocol_floor: signed.schedule_protocol_floor,
      signature_key_id: signed.signature?.key_id,
      verification: 'passed',
      identity_sha256: handoff.files.signed_manifest.identity_sha256,
    }) || !isDeepStrictEqual(handoff.files.publication_plan, planDescriptor)) {
    throw new Error('protected schema-2 Desktop signer handoff is invalid')
  }
  const profileAggregate = await manifestFile(resultRoot, 'profile-component-aggregate.json')
  const compatibilityOwnerReceipt = await json(join(runRoot, COMPATIBILITY_RECEIPT_PATH))
  const expectedInputs = {
    immutable_request: await runDescriptor(runRoot, IMMUTABLE_REQUEST_PATH),
    immutable_receipt: await runDescriptor(runRoot, IMMUTABLE_RECEIPT_PATH),
    compatibility_request: await runDescriptor(runRoot, COMPATIBILITY_REQUEST_PATH),
    profile_component_aggregate: {
      path: 'profile-signing/profile-component-aggregate.json',
      bytes: profileAggregate.bytes,
      sha256: profileAggregate.sha256,
    },
  }
  if (!isDeepStrictEqual(handoff.inputs, expectedInputs)) {
    throw new Error('protected schema-2 signer input descriptors drifted')
  }
  const github = handoff.github_verification
  if (github?.repository !== COMPATIBILITY_REPOSITORY
    || !sameRecord(github.protected_main, { ref: 'refs/heads/main', head_sha: run.source_commit, verified_current: true })
    || github.workflow?.path !== COMPATIBILITY_WORKFLOW || github.workflow.event !== 'workflow_dispatch'
    || github.workflow.status !== 'completed' || github.workflow.conclusion !== 'success'
    || github.workflow.run_id !== compatibilityOwnerReceipt.run.id || github.workflow.run_attempt !== 1
    || !sameRecord(github.workflow.job, {
      name: compatibilityOwnerReceipt.job.name, status: 'completed', conclusion: 'success', unique: true,
    }) || github.artifact?.name !== compatibilityOwnerReceipt.artifact.name
    || github.artifact.artifact_id !== compatibilityOwnerReceipt.artifact.artifact_id
    || github.artifact.digest !== compatibilityOwnerReceipt.artifact.digest
    || github.artifact.bytes !== compatibilityOwnerReceipt.artifact.bytes
    || github.artifact.run_id !== compatibilityOwnerReceipt.run.id
    || github.artifact.source_commit !== run.source_commit || github.artifact.expired !== false
    || !isDeepStrictEqual(github.artifact.archive, compatibilityOwnerReceipt.artifact.archive)) {
    throw new Error('protected schema-2 signer GitHub verification is invalid')
  }
  if (!exactKeys(signed, [
    'schema_version', 'document_type', 'release_status', 'version', 'source_commit', 'base_contract_id',
    'schedule_protocol_floor', 'profile_component_aggregate', 'github_artifact_provenance', 'artifacts', 'signature',
  ]) || signed.schema_version !== 2 || signed.document_type !== 'emate.desktop-release-manifest'
    || signed.release_status !== 'admitted' || signed.version !== run.version || signed.source_commit !== run.source_commit
    || !exactKeys(signed.signature, ['algorithm', 'key_id', 'value']) || signed.signature.algorithm !== 'ed25519'
    || signedBytes.byteLength > 16 * 1024 || JSON.stringify(signed).includes('github.com')) {
    throw new Error('protected schema-2 Desktop signed manifest is invalid')
  }
  const base = parseProfileBaseContract(await json(join(ROOT, 'desktop/e-mate-desktop/base-contract.json')))
  const key = base?.profile_signing_keys.find(candidate => candidate.id === signed.signature.key_id)
  const publicKey = strictBase64(key?.public_key_spki_der_base64)
  const signature = strictBase64(signed.signature.value)
  const { signature: ignoredSignature, ...unsigned } = signed
  if (base === undefined || key === undefined || publicKey === undefined || signature?.byteLength !== 64
    || signed.base_contract_id !== base.id || signed.schedule_protocol_floor !== base.schedule_protocol_floor
    || !verifySignature(null, Buffer.concat([
      Buffer.from(MANIFEST_SIGNING_CONTEXT), Buffer.from(canonicalProfileJson(unsigned), 'utf8'),
    ]), createPublicKey({ key: publicKey, format: 'der', type: 'spki' }), signature)) {
    throw new Error('protected schema-2 Desktop signature is not Base-trusted')
  }
  const records = installerObjectRecords(run)
  for (const [manifestPlatform, platform] of [['darwin', 'macos'], ['win32', 'windows']]) {
    const artifact = signed.artifacts?.[manifestPlatform]
    const expected = records.find(record => record.platform === platform)
    if (!exactKeys(artifact, ['url', 'bytes', 'sha256', 'build_run_id']) || expected === undefined
      || artifact.url !== expected.url || artifact.bytes !== expected.bytes || artifact.sha256 !== expected.sha256
      || artifact.build_run_id !== handoff.compatibility_attestation?.run_id) {
      throw new Error(`protected schema-2 Desktop ${manifestPlatform} artifact is invalid`)
    }
  }
  const transaction = releaseTransactionPlan(run)
  const readerPlan = transaction.reader_attestation
  if (!exactKeys(reader, ['schema_version', 'document_type', 'status', 'endpoint', 'reader', 'manifest', 'outcome'])
    || reader.schema_version !== 1 || reader.document_type !== 'emate.desktop-update-reader-attestation'
    || reader.status !== 'passed' || reader.endpoint !== `${R2_PUBLIC_ORIGIN}/desktop/signed/latest.json`
    || !exactKeys(reader.reader, ['source_mode', 'current_version', 'installer', 'module'])
    || reader.reader.source_mode !== readerPlan.source_mode || reader.reader.current_version !== readerPlan.current_version
    || !isDeepStrictEqual(reader.reader.installer, readerPlan.installer)
    || !exactKeys(reader.reader.module, ['bytes', 'sha256']) || !Number.isSafeInteger(reader.reader.module.bytes)
    || reader.reader.module.bytes <= 0 || !SHA256.test(reader.reader.module.sha256 ?? '')
    || !exactKeys(reader.manifest, ['schema_version', 'version', 'source_commit', 'bytes', 'sha256', 'signing_context'])
    || reader.manifest.schema_version !== 2 || reader.manifest.version !== signed.version
    || reader.manifest.source_commit !== signed.source_commit || reader.manifest.bytes !== signedDescriptor.bytes
    || reader.manifest.sha256 !== signedDescriptor.sha256 || reader.manifest.signing_context !== MANIFEST_SIGNING_CONTEXT
    || !isDeepStrictEqual(reader.outcome, {
      status: readerPlan.expected_status, current_version: readerPlan.current_version, latest_version: signed.version,
    })) {
    throw new Error('protected schema-2 bundled Reader attestation is invalid')
  }
  const stageEvidence = {
    immutable_publication: {
      status: 'passed', request_sha256: handoff.inputs?.immutable_request?.sha256,
      receipt_sha256: handoff.inputs?.immutable_receipt?.sha256,
    },
    compatibility_attestation: handoff.compatibility_attestation,
  }
  if (!validActivationStageEvidence(stageEvidence, run)
    || plan.owner !== SIGNER_ACTION_OWNER || plan.status !== 'ready-for-main-local-flow-activation'
    || plan.next_owner !== 'main-local-flow-activation'
    || !isDeepStrictEqual(plan.compatibility_attestation, handoff.compatibility_attestation)
    || !isDeepStrictEqual(plan.github_verification, handoff.github_verification)
    || !isDeepStrictEqual(plan.profile_signing, handoff.profile_signing)
    || !isDeepStrictEqual(plan.signed_manifest, handoff.files.signed_manifest)
    || handoff.profile_signing?.status !== 'passed'
    || handoff.profile_signing.signature_key_id !== signed.signature.key_id
    || !isDeepStrictEqual(handoff.profile_signing.legacy_component_aggregate, signed.profile_component_aggregate)) {
    throw new Error('protected schema-2 signer plan or provenance is invalid')
  }
  return {
    stageEvidence, signedDescriptor, planDescriptor, handoffDescriptor, readerDescriptor, handoff, plan, signed,
  }
}

export function buildActivationRequest(run, {
  dryRun = false, versionChoice, stageEvidence, signerResult,
} = {}) {
  verifiedComputerUse(run)
  const transaction = releaseTransactionPlan(run, versionChoice)
  if (!validActivationStageEvidence(stageEvidence, run)) {
    throw new Error('activation requires passed immutable publication and compatibility carrier evidence')
  }
  if (signerResult !== undefined && (!validManifestDescriptor(signerResult.receipt)
    || !validManifestDescriptor(signerResult.owner_receipt)
    || !validManifestDescriptor(signerResult.desktop?.update_reader_attestation))) {
    throw new Error('activation requires exact signer result, bundled Reader, and GitHub API owner receipt descriptors')
  }
  const manifestInputs = manifestInputBinding(run)
  const signedManifestPath = signerResult?.desktop?.signed_manifest?.path ?? POINTER_TARGET.artifact_path
  const pointerTarget = { ...POINTER_TARGET, artifact_path: signedManifestPath }
  const pointerNames = transaction.mode === 'new-version' ? ['signed'] : ['manual', 'signed']
  const pointers = Object.fromEntries(pointerNames.map(name => [name, {
    key: transaction.current_public_pointers[name].key,
    expected_current: { ...transaction.current_public_pointers[name].identity },
    target: { ...pointerTarget },
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
    prior_stages: stageEvidence,
    rebuild: false,
    macos_publication_mode: 'unsigned',
    installer_security: INSTALLER_SECURITY,
    immutable_objects: installerObjectRecords(run).map(object => ({
      platform: object.platform,
      key: object.key,
      url: object.url,
      bytes: object.bytes,
      sha256: object.sha256,
      action: 'require-already-exact',
      authenticated_readback: 'required',
      public_full_byte_readback: 'required',
    })),
    manifest_admission_and_signing: {
      owner: MANIFEST_OWNER,
      inputs: manifestInputs,
      compatibility_attestation: stageEvidence.compatibility_attestation,
      profile_signing: signerResult === undefined ? {
        status: 'awaiting-existing-owner',
        authority: 'existing-production-profile-signing-owner',
        final_component_manifests: 'not-produced-by-local-flow',
        final_profile_generation: 'not-produced-by-local-flow',
        final_component_aggregate: 'not-produced-by-local-flow',
      } : {
        status: 'passed',
        owner: SIGNER_ACTION_OWNER,
        component_aggregate: signerResult.profile.aggregate,
        publication_plan: signerResult.profile.plan,
        signed_desired_states: signerResult.profile.activations.map(activation => ({
          target: activation.target,
          generation: activation.generation,
          source_path: activation.object.source_path,
          bytes: activation.object.bytes,
          sha256: activation.object.sha256,
        })),
      },
      client_compatible_provenance: 'required-real-github-api-evidence',
      signed_manifest: {
        artifact_path: signedManifestPath,
        schema_version: 2,
        document_type: 'emate.desktop-release-manifest',
        release_status: 'admitted',
        signing_context: MANIFEST_SIGNING_CONTEXT,
        signature: { algorithm: 'ed25519', key_source: 'existing-base-profile_signing_keys' },
        max_bytes: 16 * 1024,
        ...(signerResult === undefined ? {} : {
          bytes: signerResult.desktop.signed_manifest.bytes,
          sha256: signerResult.desktop.signed_manifest.sha256,
        }),
      },
      handoff: signerResult === undefined ? {
        status: 'ready-for-cloudflare-plugin',
        exact_files: [
          'desktop-release-signed.json', 'desktop-update-reader-attestation.json',
          'cloudflare-publication-plan.json', 'cloudflare-plugin-handoff.json',
        ],
      } : {
        status: 'verified-local-import',
        signer_result_receipt: signerResult.receipt,
        signer_result_owner_receipt: signerResult.owner_receipt,
        publication_plan: signerResult.desktop.publication_plan,
        signer_handoff: signerResult.desktop.signer_handoff,
        update_reader_attestation: signerResult.desktop.update_reader_attestation,
        github_run_id: signerResult.github_run_id,
        action: SIGNER_ACTION_USES,
      },
    },
    ...(signerResult === undefined ? {} : {
      profile_publication: {
        status: 'ready-for-cloudflare-owner',
        distribution_origin: R2_PUBLIC_ORIGIN,
        component_payload_source: 'exact-local-run-only',
        github_result_contains_component_payloads: false,
        immutable_objects: signerResult.profile.immutable_objects,
        activations: signerResult.profile.activations,
      },
    }),
    publication_and_activation: {
      current_public_pointer_readback: 'required-before-pointer-write',
      manual_manifest: {
        ...transaction.manual_manifest,
        expected_current: transaction.mode === 'new-version'
          ? 'must-not-exist'
          : { ...transaction.current_public_pointers.manual.identity },
        target: { ...pointerTarget },
        authenticated_readback: 'required',
        public_full_byte_readback: 'required',
      },
      pointers,
      legacy_pointer: { ...transaction.legacy_pointer },
      activation_order: [...transaction.activation_order],
      recovery: { ...POINTER_RECOVERY, accepted_current_states: [...POINTER_RECOVERY.accepted_current_states] },
      order: [
        'immutable-publication-receipt-verified', 'compatibility-carrier-receipt-verified',
        'existing-owner-admission-ed25519-signing-and-bundled-reader-attestation', 'current-public-three-pointer-readbacks',
        transaction.mode === 'new-version' ? 'manual-manifest-create-only-and-readbacks' : 'manual-pointer-cas-and-readbacks',
        'signed-pointer-cas-and-readbacks', 'legacy-pointer-verified-unchanged',
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

export function validateImmutablePublicationReceipt(receipt, run, requestSha256) {
  const transaction = releaseTransactionPlan(run)
  if (!exactKeys(receipt, [
    'schema_version', 'document_type', 'operation', 'status', 'authority', 'release_scope',
    'macos_publication_mode', 'installer_security', 'distribution_origin', 'run_id', 'version',
    'source_commit', 'transaction_mode', 'request_sha256', 'immutable_objects', 'deleted_objects',
  ]) || receipt.schema_version !== 1 || receipt.document_type !== 'emate.local-cloudflare-owner-receipt'
    || receipt.operation !== 'publish-installers-immutable' || receipt.status !== 'passed'
    || receipt.authority !== CLOUDFLARE_OWNER || receipt.release_scope !== 'full-installers-immutable-only'
    || receipt.macos_publication_mode !== 'unsigned' || !unsignedInstallerSecurity(receipt.installer_security)
    || receipt.distribution_origin !== R2_PUBLIC_ORIGIN || receipt.run_id !== run.run_id
    || receipt.version !== run.version || receipt.source_commit !== run.source_commit
    || receipt.transaction_mode !== transaction.mode || !SHA256.test(requestSha256 ?? '')
    || receipt.request_sha256 !== requestSha256 || !Array.isArray(receipt.immutable_objects)
    || !Array.isArray(receipt.deleted_objects) || receipt.deleted_objects.length !== 0) {
    throw new Error('immutable installer publication owner receipt is invalid')
  }
  const expectedObjects = installerObjectRecords(run)
  if (receipt.immutable_objects.length !== expectedObjects.length) {
    throw new Error('immutable installer publication receipt set is invalid')
  }
  for (const expected of expectedObjects) {
    const object = receipt.immutable_objects.find(item => item?.key === expected.key)
    const authenticated = object?.authenticated_readback
    const publicReadback = object?.public_full_byte_readback
    if (!exactKeys(object, [
      'platform', 'key', 'url', 'bytes', 'sha256', 'write', 'authenticated_readback', 'public_full_byte_readback',
    ]) || object.platform !== expected.platform || object.key !== expected.key || object.url !== expected.url
      || object.bytes !== expected.bytes || object.sha256 !== expected.sha256
      || !['created', 'already-exact'].includes(object.write)
      || !exactKeys(authenticated, ['status', 'bytes', 'sha256']) || authenticated.status !== 'passed'
      || authenticated.bytes !== expected.bytes || authenticated.sha256 !== expected.sha256
      || !exactKeys(publicReadback, ['status', 'url', 'bytes', 'sha256']) || publicReadback.status !== 'passed'
      || publicReadback.url !== expected.url || publicReadback.bytes !== expected.bytes
      || publicReadback.sha256 !== expected.sha256) {
      throw new Error(`immutable installer publication receipt is invalid: ${expected.key}`)
    }
  }
  return receipt
}

export function buildCompatibilityAttestationRequest(run, immutableReceipt, {
  immutableRequestSha256,
  immutableReceiptSha256,
} = {}) {
  if (!SHA256.test(immutableRequestSha256 ?? '') || !SHA256.test(immutableReceiptSha256 ?? '')) {
    throw new Error('compatibility attestation requires exact immutable publication digests')
  }
  validateImmutablePublicationReceipt(immutableReceipt, run, immutableRequestSha256)
  const transaction = releaseTransactionPlan(run)
  const records = installerObjectRecords(run)
  const darwin = records.find(record => record.platform === 'macos')
  const win32 = records.find(record => record.platform === 'windows')
  if (darwin === undefined || win32 === undefined) throw new Error('compatibility attestation installer set is invalid')
  const artifactName = `e-mate-desktop-release-${run.source_commit}`
  const exactFiles = ['desktop-candidate.json', basename(darwin.key), basename(win32.key)]
  return {
    schema_version: 1,
    document_type: 'emate.local-desktop-compatibility-attestation-request',
    status: 'ready-for-manual-dispatch',
    purpose: 'schema-2-desktop-candidate-provenance',
    control_plane: 'github-candidate-provenance-carrier',
    data_plane: {
      origin: R2_PUBLIC_ORIGIN,
      installer_download: 'cloudflare-r2-only',
      online_update: 'cloudflare-r2-only',
      rollback: 'cloudflare-r2-only',
    },
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    transaction_mode: transaction.mode,
    manual_reinstall_required_for_existing_2_0_15: transaction.manual_reinstall_required_for_existing_2_0_15,
    immutable_publication: {
      status: 'passed',
      request: { path: IMMUTABLE_REQUEST_PATH, sha256: immutableRequestSha256 },
      receipt: { path: IMMUTABLE_RECEIPT_PATH, sha256: immutableReceiptSha256 },
    },
    workflow: {
      repository: COMPATIBILITY_REPOSITORY,
      path: COMPATIBILITY_WORKFLOW,
      event: 'workflow_dispatch',
      ref: 'refs/heads/main',
      required_head: run.source_commit,
      required_run_attempt: 1,
      artifact_name: artifactName,
      exact_files: exactFiles,
      semantics: {
        role: 'candidate-provenance-materialization',
        legacy_build_run_id: 'actual-github-workflow-run-id',
        github_built_or_tested_installer_bytes: false,
        dispatch_performed_by_local_flow: false,
      },
    },
    inputs: {
      source_sha: run.source_commit,
      version: run.version,
      macos_bytes: String(darwin.bytes),
      macos_sha256: darwin.sha256,
      windows_bytes: String(win32.bytes),
      windows_sha256: win32.sha256,
    },
    installers: {
      darwin: {
        name: basename(darwin.key), url: darwin.url, bytes: darwin.bytes, sha256: darwin.sha256,
        build_source_commit: run.source_commit,
      },
      win32: {
        name: basename(win32.key), url: win32.url, bytes: win32.bytes, sha256: win32.sha256,
        build_source_commit: run.source_commit,
      },
    },
    provenance_requirements: {
      schema_version: 1,
      document_type: 'emate.github-artifact-provenance',
      source_commit: run.source_commit,
      role: 'desktop_candidate',
      artifact_name: artifactName,
      artifact_id: 'required-from-github-api',
      archive_digest: 'required-from-github-api',
      run_id: 'required-from-github-api',
      run_attempt: 1,
    },
    next_owner: MANIFEST_OWNER,
    forbidden_actions: [
      'build-installers', 'test-installers', 'sign-manifest', 'write-r2', 'activate-pointer', 'serve-user-downloads',
    ],
  }
}

function validateProfilePublicationReceipt(receipt, request) {
  const expected = request.profile_publication
  if (!exactKeys(receipt, ['status', 'aggregate_sha256', 'immutable_objects', 'activations'])
    || receipt.status !== 'passed'
    || receipt.aggregate_sha256 !== request.manifest_admission_and_signing.profile_signing.component_aggregate.aggregate_sha256
    || !Array.isArray(receipt.immutable_objects) || receipt.immutable_objects.length !== expected.immutable_objects.length
    || !Array.isArray(receipt.activations) || receipt.activations.length !== expected.activations.length) {
    throw new Error('Profile Cloudflare publication receipt is invalid')
  }
  for (const item of expected.immutable_objects) {
    const actual = receipt.immutable_objects.find(candidate => candidate?.key === item.key)
    if (!exactKeys(actual, [
      'key', 'bytes', 'sha256', 'write', 'authenticated_readback', 'public_full_byte_readback',
    ]) || actual.bytes !== item.bytes || actual.sha256 !== item.sha256
      || !['created', 'already-exact'].includes(actual.write)
      || !sameRecord(actual.authenticated_readback, { status: 'passed', bytes: item.bytes, sha256: item.sha256 })
      || !sameRecord(actual.public_full_byte_readback, {
        status: 'passed', url: item.url, bytes: item.bytes, sha256: item.sha256,
      })) throw new Error(`Profile immutable publication receipt is invalid: ${item.key}`)
  }
  for (const expectedActivation of expected.activations) {
    const actual = receipt.activations.find(candidate => candidate?.target === expectedActivation.target)
    const item = expectedActivation.object
    const expectedCurrent = expectedActivation.expected_current
    if (!exactKeys(actual, [
      'target', 'key', 'expected_current', 'write', 'after', 'authenticated_readback', 'public_full_byte_readback',
    ]) || actual.target !== expectedActivation.target || actual.key !== item.key
      || !isDeepStrictEqual(actual.expected_current, expectedCurrent)
      || !['passed', 'already-exact'].includes(actual.write)
      || !exactKeys(actual.after, ['bytes', 'sha256', 'etag']) || actual.after.bytes !== item.bytes
      || actual.after.sha256 !== item.sha256 || !ETAG.test(actual.after.etag ?? '')
      || !sameRecord(actual.authenticated_readback, { status: 'passed', ...actual.after })
      || !sameRecord(actual.public_full_byte_readback, {
        status: 'passed', url: item.url, bytes: item.bytes, sha256: item.sha256,
      })) throw new Error(`Profile activation receipt is invalid: ${expectedActivation.target}`)
  }
  return receipt
}

export function validatePublicationReceipt(receipt, run, requestSha256, request) {
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
  const pointerNames = transaction.mode === 'new-version' ? ['signed'] : ['manual', 'signed']
  const receiptKeys = [
    'schema_version', 'document_type', 'operation', 'status', 'macos_publication_mode', 'installer_security',
    'distribution_origin', 'run_id', 'version', 'source_commit', 'transaction_mode', 'request_sha256',
    'current_public_pointers', 'manifest_admission', 'immutable_objects', 'pointers', 'activation_order',
    ...(transaction.mode === 'new-version' ? ['manual_manifest'] : []),
    ...(request?.profile_publication === undefined ? [] : ['profile_publication']), 'deleted_objects',
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
  const expectedObjects = installerObjectRecords(run)
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
  const importedSigner = request?.profile_publication !== undefined
  const expectedPlanStatus = importedSigner
    ? request.manifest_admission_and_signing.handoff.publication_plan.status
    : 'ready-for-cloudflare-plugin'
  const expectedHandoffStatus = importedSigner
    ? request.manifest_admission_and_signing.handoff.signer_handoff.status
    : 'ready-for-cloudflare-plugin'
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
    || !SHA256.test(admission.publication_plan.sha256 ?? '') || admission.publication_plan.status !== expectedPlanStatus
    || !exactKeys(admission.admission_receipt, ['file', 'sha256', 'status'])
    || admission.admission_receipt.file !== 'cloudflare-plugin-handoff.json'
    || !SHA256.test(admission.admission_receipt.sha256 ?? '') || admission.admission_receipt.status !== expectedHandoffStatus) {
    throw new Error('Desktop manifest admission/signature receipt is invalid')
  }
  if (request?.profile_publication !== undefined) {
    const expectedSigned = request.manifest_admission_and_signing.signed_manifest
    const expectedPlan = request.manifest_admission_and_signing.handoff.publication_plan
    const expectedHandoff = request.manifest_admission_and_signing.handoff.signer_handoff
    if (admission.signed_manifest.file !== basename(expectedSigned.artifact_path)
      || admission.signed_manifest.bytes !== expectedSigned.bytes
      || admission.signed_manifest.sha256 !== expectedSigned.sha256
      || admission.publication_plan.file !== basename(expectedPlan.path)
      || admission.publication_plan.sha256 !== expectedPlan.sha256
      || admission.admission_receipt.file !== basename(expectedHandoff.path)
      || admission.admission_receipt.sha256 !== expectedHandoff.sha256) {
      throw new Error('Desktop manifest admission receipt drifted from imported signer bytes')
    }
    validateProfilePublicationReceipt(receipt.profile_publication, request)
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
    immutable_objects: installerObjectRecords(run).map(object => ({ key: object.key, action: 'retain' })),
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
  publicationRequest,
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
  const publication = validatePublicationReceipt(publicationReceipt, run, publicationRequestSha256, publicationRequest)
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
  const publicationRequest = await json(publicationRequestPath)
  const publicationRequestSha256 = await fileDigest(publicationRequestPath)
  const publicationReceiptSha256 = await fileDigest(publicationReceiptPath)
  const publicationReceipt = validatePublicationReceipt(
    await json(publicationReceiptPath), run, publicationRequestSha256, publicationRequest,
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
    publicationRequest,
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

export function publicationAction(run, {
  dryRun = false, ownerReceipt, compatibilityReceipt, signerResult, signerResultOwnerReceipt,
} = {}) {
  const status = run.publication?.status ?? 'not-requested'
  if (![
    'not-requested', 'dry-run', 'awaiting-immutable-owner',
    'awaiting-compatibility-attestation', 'awaiting-signing-input-owner',
    'awaiting-protected-signer', 'awaiting-activation-owner', 'passed',
  ].includes(status)) throw new Error('publication run state is invalid')
  if (status === 'passed') throw new Error('publication is already passed for this run')
  if (status === 'awaiting-compatibility-attestation') {
    if (dryRun || ownerReceipt !== undefined || signerResult !== undefined || signerResultOwnerReceipt !== undefined) {
      throw new Error('publication awaiting compatibility attestation accepts only its exact compatibility receipt')
    }
    return compatibilityReceipt === undefined ? 'resume-compatibility' : 'import-compatibility'
  }
  if (status === 'awaiting-signing-input-owner') {
    if (dryRun || compatibilityReceipt !== undefined || signerResult !== undefined || signerResultOwnerReceipt !== undefined) {
      throw new Error('publication awaiting signing-input owner accepts only its exact owner receipt')
    }
    return ownerReceipt === undefined ? 'resume-signing-input' : 'import-signing-input'
  }
  if (status === 'awaiting-protected-signer') {
    if (dryRun || ownerReceipt !== undefined || compatibilityReceipt !== undefined) {
      throw new Error('publication awaiting protected signer accepts only its exact signer result')
    }
    if ((signerResult === undefined) !== (signerResultOwnerReceipt === undefined)) {
      throw new Error('protected signer result and its GitHub API owner receipt must be imported together')
    }
    return signerResult === undefined ? 'resume-signer' : 'import-signer'
  }
  if (status === 'awaiting-activation-owner') {
    if (dryRun || compatibilityReceipt !== undefined || signerResult !== undefined || signerResultOwnerReceipt !== undefined) {
      throw new Error('publication awaiting activation owner accepts only its exact owner receipt')
    }
    return ownerReceipt === undefined ? 'resume-activation' : 'import-activation'
  }
  if (status === 'awaiting-immutable-owner') {
    if (dryRun) throw new Error('publication awaiting the existing owner cannot return to dry-run')
    if (compatibilityReceipt !== undefined || signerResult !== undefined || signerResultOwnerReceipt !== undefined) {
      throw new Error('publication awaiting the existing owner cannot change stages')
    }
    return ownerReceipt === undefined ? 'resume-immutable' : 'import-immutable'
  }
  if (ownerReceipt !== undefined || compatibilityReceipt !== undefined || signerResult !== undefined
    || signerResultOwnerReceipt !== undefined) {
    throw new Error('publication result import requires the exact awaiting request state')
  }
  return dryRun ? 'dry-run' : 'emit-immutable'
}

export function awaitingImmutablePublicationState(run, requestSha256) {
  return {
    status: 'awaiting-immutable-owner',
    scope: 'full-installers-immutable-only',
    owner: CLOUDFLARE_OWNER,
    request: IMMUTABLE_REQUEST_PATH,
    request_sha256: requestSha256,
    transaction_mode: run.release_transaction.mode,
  }
}

function awaitingCompatibilityAttestationState(run, {
  immutableRequestSha256, immutableReceiptSha256, compatibilityRequestSha256,
}) {
  return {
    status: 'awaiting-compatibility-attestation',
    scope: 'full',
    owner: 'github-candidate-provenance-carrier',
    immutable_request: IMMUTABLE_REQUEST_PATH,
    immutable_request_sha256: immutableRequestSha256,
    immutable_receipt: IMMUTABLE_RECEIPT_PATH,
    immutable_receipt_sha256: immutableReceiptSha256,
    request: COMPATIBILITY_REQUEST_PATH,
    request_sha256: compatibilityRequestSha256,
    transaction_mode: run.release_transaction.mode,
  }
}

function awaitingSigningInputOwnerState(run, bindings) {
  return {
    status: 'awaiting-signing-input-owner',
    scope: 'full',
    owner: CLOUDFLARE_OWNER,
    immutable_request: IMMUTABLE_REQUEST_PATH,
    immutable_request_sha256: bindings.immutableRequestSha256,
    immutable_receipt: IMMUTABLE_RECEIPT_PATH,
    immutable_receipt_sha256: bindings.immutableReceiptSha256,
    compatibility_request: COMPATIBILITY_REQUEST_PATH,
    compatibility_request_sha256: bindings.compatibilityRequestSha256,
    compatibility_receipt: COMPATIBILITY_RECEIPT_PATH,
    compatibility_receipt_sha256: bindings.compatibilityReceiptSha256,
    control_bundle: SIGNING_BUNDLE_PATH,
    control_bundle_bytes: bindings.bundle.bytes,
    control_bundle_sha256: bindings.bundle.sha256,
    request: SIGNING_INPUT_REQUEST_PATH,
    request_sha256: bindings.requestSha256,
    transaction_mode: run.release_transaction.mode,
  }
}

function awaitingProtectedSignerState(run, previous, bindings) {
  return {
    status: 'awaiting-protected-signer',
    scope: 'full',
    owner: SIGNER_ACTION_OWNER,
    immutable_request: previous.immutable_request,
    immutable_request_sha256: previous.immutable_request_sha256,
    immutable_receipt: previous.immutable_receipt,
    immutable_receipt_sha256: previous.immutable_receipt_sha256,
    compatibility_request: previous.compatibility_request,
    compatibility_request_sha256: previous.compatibility_request_sha256,
    compatibility_receipt: previous.compatibility_receipt,
    compatibility_receipt_sha256: previous.compatibility_receipt_sha256,
    control_bundle: previous.control_bundle,
    control_bundle_bytes: previous.control_bundle_bytes,
    control_bundle_sha256: previous.control_bundle_sha256,
    signing_input_request: previous.request,
    signing_input_request_sha256: previous.request_sha256,
    signing_input_receipt: SIGNING_INPUT_RECEIPT_PATH,
    signing_input_receipt_sha256: bindings.receiptSha256,
    request: SIGNER_DISPATCH_REQUEST_PATH,
    request_sha256: bindings.requestSha256,
    action: SIGNER_ACTION_USES,
    transaction_mode: run.release_transaction.mode,
  }
}

function awaitingActivationOwnerState(run, previous, bindings) {
  return {
    status: 'awaiting-activation-owner',
    scope: 'full',
    owner: OWNER,
    immutable_request: previous.immutable_request,
    immutable_request_sha256: previous.immutable_request_sha256,
    immutable_receipt: previous.immutable_receipt,
    immutable_receipt_sha256: previous.immutable_receipt_sha256,
    compatibility_request: previous.compatibility_request,
    compatibility_request_sha256: previous.compatibility_request_sha256,
    compatibility_receipt: previous.compatibility_receipt,
    compatibility_receipt_sha256: previous.compatibility_receipt_sha256,
    signing_input_request: previous.signing_input_request,
    signing_input_request_sha256: previous.signing_input_request_sha256,
    signing_input_receipt: previous.signing_input_receipt,
    signing_input_receipt_sha256: previous.signing_input_receipt_sha256,
    signer_dispatch_request: previous.request,
    signer_dispatch_request_sha256: previous.request_sha256,
    signer_result: SIGNER_RESULT_PATH,
    signer_result_receipt_sha256: bindings.signerResultReceiptSha256,
    signer_result_owner_receipt: SIGNER_RESULT_OWNER_RECEIPT_PATH,
    signer_result_owner_receipt_sha256: bindings.signerResultOwnerReceiptSha256,
    request: 'publication/cloudflare-owner-request.json',
    request_sha256: bindings.requestSha256,
    transaction_mode: run.release_transaction.mode,
  }
}

async function validateImmutablePublicationRequest(directory, request) {
  const path = join(directory, IMMUTABLE_REQUEST_PATH)
  if (!isDeepStrictEqual(await json(path), request)) throw new Error('immutable installer publication owner request is invalid')
  const requestSha256 = await fileDigest(path)
  return { path, requestSha256 }
}

async function validateAwaitingImmutablePublication(directory, run, request) {
  const { path, requestSha256 } = await validateImmutablePublicationRequest(directory, request)
  if (!isDeepStrictEqual(run.publication, awaitingImmutablePublicationState(run, requestSha256))) {
    throw new Error('publication requires the exact awaiting immutable request state')
  }
  return { path, requestSha256 }
}

async function validateAwaitingCompatibilityAttestation(directory, run, immutableRequest) {
  const { requestSha256: immutableRequestSha256 } = await validateImmutablePublicationRequest(directory, immutableRequest)
  const immutableReceiptPath = join(directory, IMMUTABLE_RECEIPT_PATH)
  const immutableReceipt = validateImmutablePublicationReceipt(
    await json(immutableReceiptPath), run, immutableRequestSha256,
  )
  const immutableReceiptSha256 = await fileDigest(immutableReceiptPath)
  const request = buildCompatibilityAttestationRequest(run, immutableReceipt, {
    immutableRequestSha256,
    immutableReceiptSha256,
  })
  const path = join(directory, COMPATIBILITY_REQUEST_PATH)
  if (!isDeepStrictEqual(await json(path), request)) throw new Error('compatibility attestation request is invalid')
  const requestSha256 = await fileDigest(path)
  if (!isDeepStrictEqual(run.publication, awaitingCompatibilityAttestationState(run, {
    immutableRequestSha256, immutableReceiptSha256, compatibilityRequestSha256: requestSha256,
  }))) throw new Error('publication requires the exact awaiting compatibility request state')
  return { path, requestSha256 }
}

async function runDescriptor(directory, path) {
  return manifestFile(directory, path, path)
}

async function compatibilityBindings(directory, run) {
  const immutableRequest = buildPublicationRequest(run)
  const { requestSha256: immutableRequestSha256 } = await validateImmutablePublicationRequest(directory, immutableRequest)
  const immutableReceiptPath = join(directory, IMMUTABLE_RECEIPT_PATH)
  const immutableReceipt = validateImmutablePublicationReceipt(
    await json(immutableReceiptPath), run, immutableRequestSha256,
  )
  const immutableReceiptSha256 = await fileDigest(immutableReceiptPath)
  const compatibilityRequest = buildCompatibilityAttestationRequest(run, immutableReceipt, {
    immutableRequestSha256, immutableReceiptSha256,
  })
  const compatibilityRequestPath = join(directory, COMPATIBILITY_REQUEST_PATH)
  if (!isDeepStrictEqual(await json(compatibilityRequestPath), compatibilityRequest)) {
    throw new Error('compatibility attestation request is invalid')
  }
  const compatibilityRequestSha256 = await fileDigest(compatibilityRequestPath)
  const compatibilityReceiptPath = join(directory, COMPATIBILITY_RECEIPT_PATH)
  const compatibilityReceiptInput = await json(compatibilityReceiptPath)
  const compatibilityReceipt = validateCompatibilityCarrierReceipt(
    compatibilityReceiptInput, run, compatibilityRequest, compatibilityRequestSha256,
  )
  return {
    immutableRequest,
    compatibilityRequest,
    compatibilityReceipt,
    immutableRequestDescriptor: await runDescriptor(directory, IMMUTABLE_REQUEST_PATH),
    immutableReceiptDescriptor: await runDescriptor(directory, IMMUTABLE_RECEIPT_PATH),
    compatibilityRequestDescriptor: await runDescriptor(directory, COMPATIBILITY_REQUEST_PATH),
    compatibilityReceiptDescriptor: await runDescriptor(directory, COMPATIBILITY_RECEIPT_PATH),
  }
}

async function validateAwaitingSigningInputOwner(directory, run) {
  const bindings = await compatibilityBindings(directory, run)
  const bundle = await runDescriptor(directory, SIGNING_BUNDLE_PATH)
  const request = buildSigningInputOwnerRequest(run, {
    bundle,
    compatibility: {
      request: bindings.compatibilityRequestDescriptor,
      receipt: bindings.compatibilityReceiptDescriptor,
    },
  })
  const path = join(directory, SIGNING_INPUT_REQUEST_PATH)
  if (!isDeepStrictEqual(await json(path), request)) throw new Error('protected signer control-object request is invalid')
  const requestSha256 = await fileDigest(path)
  if (!isDeepStrictEqual(run.publication, awaitingSigningInputOwnerState(run, {
    immutableRequestSha256: bindings.immutableRequestDescriptor.sha256,
    immutableReceiptSha256: bindings.immutableReceiptDescriptor.sha256,
    compatibilityRequestSha256: bindings.compatibilityRequestDescriptor.sha256,
    compatibilityReceiptSha256: bindings.compatibilityReceiptDescriptor.sha256,
    bundle,
    requestSha256,
  }))) throw new Error('publication requires the exact awaiting signing-input request state')
  return { ...bindings, bundle, request, path, requestSha256 }
}

async function validateAwaitingProtectedSigner(directory, run) {
  const previous = { ...run.publication }
  const signingInputRequestPath = join(directory, SIGNING_INPUT_REQUEST_PATH)
  const signingInputRequest = await json(signingInputRequestPath)
  const signingInputRequestSha256 = await fileDigest(signingInputRequestPath)
  if (signingInputRequestSha256 !== previous.signing_input_request_sha256) {
    throw new Error('protected signer control-object request descriptor drifted')
  }
  const signingInputReceiptPath = join(directory, SIGNING_INPUT_RECEIPT_PATH)
  const signingInputReceipt = validateSigningInputOwnerReceipt(
    await json(signingInputReceiptPath), signingInputRequest, signingInputRequestSha256,
  )
  const signingInputReceiptSha256 = await fileDigest(signingInputReceiptPath)
  const compatibilityReceipt = await json(join(directory, COMPATIBILITY_RECEIPT_PATH))
  const descriptors = {
    immutable_request: await runDescriptor(directory, IMMUTABLE_REQUEST_PATH),
    immutable_receipt: await runDescriptor(directory, IMMUTABLE_RECEIPT_PATH),
    compatibility_request: await runDescriptor(directory, COMPATIBILITY_REQUEST_PATH),
    compatibility_receipt: await runDescriptor(directory, COMPATIBILITY_RECEIPT_PATH),
    signing_input_request: await runDescriptor(directory, SIGNING_INPUT_REQUEST_PATH),
    signing_input_receipt: await runDescriptor(directory, SIGNING_INPUT_RECEIPT_PATH),
  }
  const request = buildProtectedSignerDispatchRequest(run, {
    compatibilityReceipt, controlReceipt: signingInputReceipt, descriptors,
  })
  const path = join(directory, SIGNER_DISPATCH_REQUEST_PATH)
  if (!isDeepStrictEqual(await json(path), request)) throw new Error('protected signer dispatch request is invalid')
  const requestSha256 = await fileDigest(path)
  const signingInputState = {
    status: 'awaiting-signing-input-owner', scope: previous.scope, owner: CLOUDFLARE_OWNER,
    immutable_request: previous.immutable_request,
    immutable_request_sha256: previous.immutable_request_sha256,
    immutable_receipt: previous.immutable_receipt,
    immutable_receipt_sha256: previous.immutable_receipt_sha256,
    compatibility_request: previous.compatibility_request,
    compatibility_request_sha256: previous.compatibility_request_sha256,
    compatibility_receipt: previous.compatibility_receipt,
    compatibility_receipt_sha256: previous.compatibility_receipt_sha256,
    control_bundle: previous.control_bundle,
    control_bundle_bytes: previous.control_bundle_bytes,
    control_bundle_sha256: previous.control_bundle_sha256,
    request: previous.signing_input_request,
    request_sha256: previous.signing_input_request_sha256,
    transaction_mode: previous.transaction_mode,
  }
  if (!isDeepStrictEqual(previous, awaitingProtectedSignerState(run, signingInputState, {
    receiptSha256: signingInputReceiptSha256, requestSha256,
  }))) throw new Error('publication requires the exact awaiting protected-signer state')
  return { request, path, requestSha256, signingInputReceipt, compatibilityReceipt, descriptors }
}

async function importProtectedSignerResult(directory, run, externalResult, externalOwnerReceipt) {
  const previous = { ...run.publication }
  const awaiting = await validateAwaitingProtectedSigner(directory, run)
  const external = await validateProtectedSignerResultDirectory(
    externalResult, run, awaiting.request, awaiting.requestSha256,
  )
  const externalResultReceipt = await manifestFile(external.root, 'signer-result-receipt.json')
  const ownerReceipt = validateProtectedSignerResultOwnerReceipt(
    await json(externalOwnerReceipt), run, awaiting.request, awaiting.requestSha256, externalResultReceipt,
  )
  if (ownerReceipt.run.id !== external.receipt.github_run_id
    || ownerReceipt.artifact.name !== external.receipt.artifact_name) {
    throw new Error('protected signer result and GitHub owner receipt provenance diverged')
  }
  const resultPath = join(directory, SIGNER_RESULT_PATH)
  await copyTree(external.root, resultPath)
  const imported = await validateProtectedSignerResultDirectory(
    resultPath, run, awaiting.request, awaiting.requestSha256,
  )
  const ownerReceiptPath = join(directory, SIGNER_RESULT_OWNER_RECEIPT_PATH)
  await atomicJson(ownerReceiptPath, ownerReceipt)
  const desktop = await validateDesktopSignerResult(resultPath, run)
  const { verifyCompactLocalProfileSignerResult } = await import('./publish-profile-r2.mjs')
  const profile = await verifyCompactLocalProfileSignerResult({
    root: ROOT,
    runRoot: directory,
    request: join(directory, IMMUTABLE_REQUEST_PATH),
    result: resultPath,
  })
  const prefixed = descriptor => ({ ...descriptor, path: `${SIGNER_RESULT_PATH}/${descriptor.path}` })
  const signerResult = {
    receipt: prefixed(await runDescriptor(resultPath, 'signer-result-receipt.json')),
    owner_receipt: await runDescriptor(directory, SIGNER_RESULT_OWNER_RECEIPT_PATH),
    github_run_id: imported.receipt.github_run_id,
    desktop: {
      signed_manifest: prefixed(desktop.signedDescriptor),
      publication_plan: { ...prefixed(desktop.planDescriptor), status: desktop.plan.status },
      signer_handoff: { ...prefixed(desktop.handoffDescriptor), status: desktop.handoff.status },
      update_reader_attestation: prefixed(desktop.readerDescriptor),
    },
    profile: {
      ...profile,
      aggregate: prefixed(profile.aggregate),
      plan: prefixed(profile.plan),
    },
  }
  const request = buildActivationRequest(run, {
    stageEvidence: desktop.stageEvidence,
    signerResult,
  })
  const path = join(directory, 'publication', 'cloudflare-owner-request.json')
  await atomicJson(path, request)
  const requestSha256 = await fileDigest(path)
  return {
    path,
    state: awaitingActivationOwnerState(run, previous, {
      signerResultReceiptSha256: imported.receiptIdentity.sha256,
      signerResultOwnerReceiptSha256: signerResult.owner_receipt.sha256,
      requestSha256,
    }),
  }
}

async function validateAwaitingActivationOwner(directory, run) {
  const state = run.publication
  if (!exactKeys(state, [
    'status', 'scope', 'owner', 'immutable_request', 'immutable_request_sha256', 'immutable_receipt',
    'immutable_receipt_sha256', 'compatibility_request', 'compatibility_request_sha256',
    'compatibility_receipt', 'compatibility_receipt_sha256', 'signing_input_request',
    'signing_input_request_sha256', 'signing_input_receipt', 'signing_input_receipt_sha256',
    'signer_dispatch_request', 'signer_dispatch_request_sha256', 'signer_result',
    'signer_result_receipt_sha256', 'signer_result_owner_receipt', 'signer_result_owner_receipt_sha256',
    'request', 'request_sha256', 'transaction_mode',
  ]) || state.status !== 'awaiting-activation-owner' || state.scope !== 'full' || state.owner !== OWNER
    || state.request !== 'publication/cloudflare-owner-request.json'
    || state.signer_result !== SIGNER_RESULT_PATH || state.transaction_mode !== run.release_transaction.mode
    || state.signer_result_owner_receipt !== SIGNER_RESULT_OWNER_RECEIPT_PATH
    || ![state.immutable_request_sha256, state.immutable_receipt_sha256,
      state.compatibility_request_sha256, state.compatibility_receipt_sha256,
      state.signing_input_request_sha256, state.signing_input_receipt_sha256,
      state.signer_dispatch_request_sha256, state.signer_result_receipt_sha256,
      state.signer_result_owner_receipt_sha256, state.request_sha256]
      .every(value => SHA256.test(value ?? ''))) {
    throw new Error('publication requires the exact awaiting activation-owner state')
  }
  const path = join(directory, state.request)
  const request = await json(path)
  const requestSha256 = await fileDigest(path)
  if (requestSha256 !== state.request_sha256 || request.run_id !== run.run_id
    || request.source_commit !== run.source_commit || request.operation !== 'publish'
    || request.distribution_origin !== R2_PUBLIC_ORIGIN
    || request.manifest_admission_and_signing?.handoff?.signer_result_receipt?.sha256
      !== state.signer_result_receipt_sha256
    || request.manifest_admission_and_signing?.handoff?.signer_result_owner_receipt?.sha256
      !== state.signer_result_owner_receipt_sha256
    || await fileDigest(join(directory, state.signer_result_owner_receipt))
      !== state.signer_result_owner_receipt_sha256) {
    throw new Error('activation owner request drifted from its exact awaiting state')
  }
  return { path, request, requestSha256 }
}

async function importActivationOwnerReceipt(directory, run, externalReceipt) {
  const awaiting = await validateAwaitingActivationOwner(directory, run)
  const receipt = validatePublicationReceipt(
    await json(externalReceipt), run, awaiting.requestSha256, awaiting.request,
  )
  const receiptPath = join(directory, 'publication', 'cloudflare-owner-receipt.json')
  await atomicJson(receiptPath, receipt)
  return {
    path: awaiting.path,
    state: {
      status: 'passed',
      scope: 'full',
      owner: OWNER,
      request: relativePath(directory, awaiting.path),
      request_sha256: awaiting.requestSha256,
      receipt: relativePath(directory, receiptPath),
      receipt_sha256: await fileDigest(receiptPath),
      signer_result: SIGNER_RESULT_PATH,
      signer_result_receipt_sha256: run.publication.signer_result_receipt_sha256,
      signer_result_owner_receipt: SIGNER_RESULT_OWNER_RECEIPT_PATH,
      signer_result_owner_receipt_sha256: run.publication.signer_result_owner_receipt_sha256,
      completed_at: now(),
    },
  }
}

async function publish(values) {
  const { directory, run } = await loadRun(values.run)
  assertVerificationMatches(run, await verifyRun(directory, run))
  const scope = publicationScope(run)
  if (scope === 'macos-immutable-dmg-only') {
    if (values.versionChoice !== undefined || run.release_transaction !== undefined) {
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
        status: 'passed', scope: request.release_scope, request_sha256: requestSha256, owner: OWNER,
      }
    } else {
      run.publication = {
        status: values.dryRun ? 'dry-run' : 'awaiting-existing-owner', scope: request.release_scope,
        request_sha256: requestSha256, owner: OWNER,
      }
    }
    await saveRun(directory, run)
    await writeChecksums(directory)
    process.stdout.write(`${JSON.stringify({ run_id: run.run_id, publication: run.publication, request: relativePath(directory, path) }, null, 2)}\n`)
    return
  }

  await verifyManifestInputLedger(directory, run)
  const transaction = releaseTransactionPlan(run, values.versionChoice)
  if (run.release_transaction === undefined) run.release_transaction = transaction
  const action = publicationAction(run, values)
  const immutableRequest = buildPublicationRequest(run, { dryRun: action === 'dry-run' })
  const immutableRequestPath = join(directory, IMMUTABLE_REQUEST_PATH)
  let outputPath = immutableRequestPath
  if (action === 'dry-run' || action === 'emit-immutable') {
    await atomicJson(immutableRequestPath, immutableRequest)
    const requestSha256 = await fileDigest(immutableRequestPath)
    run.publication = action === 'dry-run'
      ? { status: 'dry-run', scope: 'full-installers-immutable-only', owner: CLOUDFLARE_OWNER, request_sha256: requestSha256 }
      : awaitingImmutablePublicationState(run, requestSha256)
  } else if (action === 'resume-immutable') {
    await validateAwaitingImmutablePublication(directory, run, immutableRequest)
  } else if (action === 'import-immutable') {
    const { requestSha256: immutableRequestSha256 } = await validateAwaitingImmutablePublication(
      directory, run, immutableRequest,
    )
    const immutableReceipt = validateImmutablePublicationReceipt(
      await json(resolve(values.ownerReceipt)), run, immutableRequestSha256,
    )
    const immutableReceiptPath = join(directory, IMMUTABLE_RECEIPT_PATH)
    await atomicJson(immutableReceiptPath, immutableReceipt)
    const immutableReceiptSha256 = await fileDigest(immutableReceiptPath)
    const compatibilityRequest = buildCompatibilityAttestationRequest(run, immutableReceipt, {
      immutableRequestSha256,
      immutableReceiptSha256,
    })
    outputPath = join(directory, COMPATIBILITY_REQUEST_PATH)
    await atomicJson(outputPath, compatibilityRequest)
    run.publication = awaitingCompatibilityAttestationState(run, {
      immutableRequestSha256,
      immutableReceiptSha256,
      compatibilityRequestSha256: await fileDigest(outputPath),
    })
  } else if (action === 'resume-compatibility') {
    const resumed = await validateAwaitingCompatibilityAttestation(directory, run, immutableRequest)
    outputPath = resumed.path
  } else if (action === 'import-compatibility') {
    const resumed = await validateAwaitingCompatibilityAttestation(directory, run, immutableRequest)
    const compatibilityRequest = await json(resumed.path)
    const compatibilityReceipt = validateCompatibilityCarrierReceipt(
      await json(resolve(values.compatibilityReceipt)), run, compatibilityRequest, resumed.requestSha256,
    )
    await atomicJson(join(directory, COMPATIBILITY_RECEIPT_PATH), compatibilityReceipt)
    const bindings = await compatibilityBindings(directory, run)
    const files = await collectSigningControlFiles(directory, run)
    const snapshot = await runDescriptor(directory, PROFILE_SNAPSHOT_PATH)
    const bundlePath = join(directory, SIGNING_BUNDLE_PATH)
    const bundleResult = await createSigningControlBundle({
      root: directory,
      output: bundlePath,
      files,
      metadata: {
        schema_version: 1,
        document_type: 'emate.local-protected-signer-control-input',
        run_id: run.run_id,
        version: run.version,
        source_commit: run.source_commit,
        transaction_mode: run.release_transaction.mode,
        reader_attestation: run.release_transaction.reader_attestation,
        predecessors: {
          immutable_request: bindings.immutableRequestDescriptor,
          immutable_receipt: bindings.immutableReceiptDescriptor,
          compatibility_request: bindings.compatibilityRequestDescriptor,
          compatibility_receipt: bindings.compatibilityReceiptDescriptor,
          profile_current_snapshot: snapshot,
        },
        hydrated_installers: installerObjectRecords(run).map(object => ({
          platform: object.platform, name: basename(object.key), key: object.key, url: object.url,
          bytes: object.bytes, sha256: object.sha256,
        })),
        disclosure: 'public-control-input-containing-verified-future-public-product-bytes',
      },
    })
    const bundle = { path: SIGNING_BUNDLE_PATH, bytes: bundleResult.bytes, sha256: bundleResult.sha256 }
    const request = buildSigningInputOwnerRequest(run, {
      bundle,
      compatibility: {
        request: bindings.compatibilityRequestDescriptor,
        receipt: bindings.compatibilityReceiptDescriptor,
      },
    })
    outputPath = join(directory, SIGNING_INPUT_REQUEST_PATH)
    await atomicJson(outputPath, request)
    run.publication = awaitingSigningInputOwnerState(run, {
      immutableRequestSha256: bindings.immutableRequestDescriptor.sha256,
      immutableReceiptSha256: bindings.immutableReceiptDescriptor.sha256,
      compatibilityRequestSha256: bindings.compatibilityRequestDescriptor.sha256,
      compatibilityReceiptSha256: bindings.compatibilityReceiptDescriptor.sha256,
      bundle,
      requestSha256: await fileDigest(outputPath),
    })
  } else if (action === 'resume-signing-input') {
    const resumed = await validateAwaitingSigningInputOwner(directory, run)
    outputPath = resumed.path
  } else if (action === 'import-signing-input') {
    const previous = { ...run.publication }
    const awaiting = await validateAwaitingSigningInputOwner(directory, run)
    const receipt = validateSigningInputOwnerReceipt(
      await json(resolve(values.ownerReceipt)), awaiting.request, awaiting.requestSha256,
    )
    const receiptPath = join(directory, SIGNING_INPUT_RECEIPT_PATH)
    await atomicJson(receiptPath, receipt)
    const receiptSha256 = await fileDigest(receiptPath)
    const descriptors = {
      immutable_request: awaiting.immutableRequestDescriptor,
      immutable_receipt: awaiting.immutableReceiptDescriptor,
      compatibility_request: awaiting.compatibilityRequestDescriptor,
      compatibility_receipt: awaiting.compatibilityReceiptDescriptor,
      signing_input_request: await runDescriptor(directory, SIGNING_INPUT_REQUEST_PATH),
      signing_input_receipt: await runDescriptor(directory, SIGNING_INPUT_RECEIPT_PATH),
    }
    const request = buildProtectedSignerDispatchRequest(run, {
      compatibilityReceipt: awaiting.compatibilityReceipt,
      controlReceipt: receipt,
      descriptors,
    })
    outputPath = join(directory, SIGNER_DISPATCH_REQUEST_PATH)
    await atomicJson(outputPath, request)
    run.publication = awaitingProtectedSignerState(run, previous, {
      receiptSha256,
      requestSha256: await fileDigest(outputPath),
    })
  } else if (action === 'resume-signer') {
    const resumed = await validateAwaitingProtectedSigner(directory, run)
    outputPath = resumed.path
  } else if (action === 'import-signer') {
    const imported = await importProtectedSignerResult(
      directory, run, resolve(values.signerResult), resolve(values.signerResultOwnerReceipt),
    )
    outputPath = imported.path
    run.publication = imported.state
  } else if (action === 'resume-activation') {
    const resumed = await validateAwaitingActivationOwner(directory, run)
    outputPath = resumed.path
  } else if (action === 'import-activation') {
    const completed = await importActivationOwnerReceipt(directory, run, resolve(values.ownerReceipt))
    outputPath = completed.path
    run.publication = completed.state
  }
  await saveRun(directory, run)
  await writeChecksums(directory)
  process.stdout.write(`${JSON.stringify({
    run_id: run.run_id, publication: run.publication, request: relativePath(directory, outputPath),
  }, null, 2)}\n`)
}

async function rollback(values) {
  const { directory, run } = await loadRun(values.run)
  assertVerificationMatches(run, await verifyRun(directory, run))
  const action = rollbackAction(run, values)
  let publicationReceipt, publicationRequest, publicationRequestSha256, publicationReceiptSha256
  const receiptPath = join(directory, 'publication', 'cloudflare-owner-receipt.json')
  if (!values.dryRun) {
    const publicationRequestPath = join(directory, 'publication', 'cloudflare-owner-request.json')
    publicationRequest = await json(publicationRequestPath)
    publicationRequestSha256 = await fileDigest(publicationRequestPath)
    publicationReceiptSha256 = await fileDigest(receiptPath)
    publicationReceipt = validatePublicationReceipt(
      await json(receiptPath), run, publicationRequestSha256, publicationRequest,
    )
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
      'manifest-out': { type: 'string' },
      'windows-result': { type: 'string' },
      'windows-unavailable': { type: 'boolean', default: false },
      'remote-request': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'owner-receipt': { type: 'string' },
      'compatibility-receipt': { type: 'string' },
      'signer-result': { type: 'string' },
      'signer-result-owner-receipt': { type: 'string' },
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
      compatibilityReceipt: values['compatibility-receipt'],
      signerResult: values['signer-result'],
      signerResultOwnerReceipt: values['signer-result-owner-receipt'],
      sourceCommit: values['source-commit'],
      manifestOut: values['manifest-out'],
      windowsResult: values['windows-result'],
      windowsUnavailable: values['windows-unavailable'],
      remoteRequest: values['remote-request'],
      versionChoice: values['version-choice'],
    },
  }
}

function validateCommandOptions(command, values) {
  const internal = command === '_platform-build'
  const publicationImportCount = [values.ownerReceipt, values.compatibilityReceipt, values.signerResult]
    .filter(value => value !== undefined).length
  const hasSignerResultOwnerReceipt = values.signerResultOwnerReceipt !== undefined
  if (!['dev', 'candidate', 'verify', 'publish', 'rollback'].includes(command) && !internal) {
    throw new Error('flow command must be dev, candidate, verify, publish, or rollback')
  }
  if (command === 'dev' && (values.run !== undefined || values.retry !== undefined || values.dryRun
    || values.platform !== undefined || values.out !== undefined || values.manifestOut !== undefined || values.sourceCommit !== undefined || publicationImportCount > 0 || hasSignerResultOwnerReceipt
    || values.windowsResult !== undefined || values.windowsUnavailable || values.remoteRequest !== undefined || values.versionChoice !== undefined)) {
    throw new Error('dev does not accept options')
  }
  if (command === 'candidate' && (values.dryRun || values.platform !== undefined || values.out !== undefined
    || values.manifestOut !== undefined || values.sourceCommit !== undefined || publicationImportCount > 0 || hasSignerResultOwnerReceipt || values.remoteRequest !== undefined || values.versionChoice !== undefined
    || values.windowsResult !== undefined && (values.run === undefined || values.retry !== undefined || values.windowsUnavailable)
    || values.windowsUnavailable && (values.run === undefined || values.retry !== undefined))) {
    throw new Error('candidate accepts --run/--retry, --run with --windows-result, or --run --windows-unavailable')
  }
  if (command === 'verify' && (values.run === undefined || values.retry !== undefined || values.dryRun
    || values.platform !== undefined || values.out !== undefined || values.manifestOut !== undefined || values.sourceCommit !== undefined || publicationImportCount > 0 || hasSignerResultOwnerReceipt
    || values.windowsResult !== undefined || values.windowsUnavailable || values.remoteRequest !== undefined || values.versionChoice !== undefined)) {
    throw new Error('verify requires only --run <id>')
  }
  if (command === 'publish' && (values.run === undefined || values.retry !== undefined
    || values.platform !== undefined || values.out !== undefined || values.manifestOut !== undefined || values.sourceCommit !== undefined
    || values.windowsResult !== undefined || values.windowsUnavailable || values.remoteRequest !== undefined
    || publicationImportCount > 1 || (values.signerResult === undefined) !== !hasSignerResultOwnerReceipt
    || values.dryRun && (publicationImportCount > 0 || hasSignerResultOwnerReceipt))) {
    throw new Error('publish requires --run <id> and accepts one of --version-choice, --dry-run, --owner-receipt, --compatibility-receipt, or --signer-result')
  }
  if (command === 'rollback' && (values.run === undefined || values.retry !== undefined
    || values.platform !== undefined || values.out !== undefined || values.manifestOut !== undefined || values.sourceCommit !== undefined
    || values.windowsResult !== undefined || values.windowsUnavailable || values.remoteRequest !== undefined || values.versionChoice !== undefined
    || values.compatibilityReceipt !== undefined || values.signerResult !== undefined || hasSignerResultOwnerReceipt
    || values.dryRun && values.ownerReceipt !== undefined)) {
    throw new Error('rollback requires --run <id> and accepts only --dry-run or --owner-receipt')
  }
  if (internal && (values.run !== undefined || values.retry !== undefined || values.dryRun || publicationImportCount > 0 || hasSignerResultOwnerReceipt
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
    if (!['macos', 'windows'].includes(values.platform) || values.out === undefined || values.manifestOut === undefined
      || !SOURCE_SHA.test(values.sourceCommit ?? '')) {
      throw new Error('invalid internal platform build arguments')
    }
    if (git(['rev-parse', 'HEAD']) !== values.sourceCommit || git(['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
      throw new Error('internal platform build requires the exact clean source copy')
    }
    const output = resolve(values.out)
    const manifestOutput = resolve(values.manifestOut)
    if (values.remoteRequest === undefined) {
      await platformBuild(ROOT, values.platform, output, manifestOutput, join(dirname(output), `${values.platform}.log`))
    } else {
      const requestPath = resolve(values.remoteRequest)
      const { request } = await readWindowsRemoteRequest(requestPath)
      if (request.source_commit !== values.sourceCommit) throw new Error('Windows Codex Remote request source does not match the build')
      await platformBuild(ROOT, 'windows', join(output, 'artifacts', 'windows'), manifestOutput, join(output, 'windows.log'))
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
