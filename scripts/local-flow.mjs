#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { classifyChangedPaths } from './change-impact.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const RUN_ROOT = join(ROOT, 'dist', 'local-runs')
const PACKAGE = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const VERSION = PACKAGE.version
const PNPM_VERSION = /^pnpm@([^+]+)$/u.exec(PACKAGE.packageManager)?.[1]
const SOURCE_SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{12}-[0-9a-f]{6}$/u
const OWNER = 'existing-desktop-manifest-admission-signing-owner+codex-cloudflare-plugin'
const MANIFEST_OWNER = 'zyfjacksonchen-source/e-mate-desktop-publication@e45c3b9d1bec366ab306203574d0a7a724d7f123'
const MANIFEST_SIGNING_CONTEXT = 'e-mate-desktop-release-manifest-v2\0'
const MANIFEST_KEY_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u
const POINTER_PREDECESSOR = Object.freeze({
  bytes: 2961,
  sha256: 'd26b9ffb5f30531bc5de6c9f66aab47c3718248e2ff109d82cd3a763f0c02887',
})
const INSTALLER_SECURITY = Object.freeze({
  darwin: Object.freeze({ code_signed: false, notarized: false }),
  win32: Object.freeze({ code_signed: false, notarized: false }),
})
const FULL_MATRIX = 'docs/2.0.15/REGRESSION-MATRIX.md'
const FULL_MATRIX_SCOPE = 'full-installed-startup-update-product-and-built-in-tools'
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
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
  if (received !== 'DESKTOP-KH19ARC') throw new Error(`kh19arc hostname must be DESKTOP-KH19ARC; received ${received || '<empty>'}`)
  return received
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
  output.write(`$ ${redactLog([command, ...args].join(' '))}\n`)
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', chunk => { output.write(redactLog(chunk.toString('utf8'))); process.stdout.write(chunk) })
    child.stderr.on('data', chunk => { output.write(redactLog(chunk.toString('utf8'))); process.stderr.write(chunk) })
    child.on('error', cause => { output.end(); rejectPromise(cause) })
    child.on('close', code => {
      output.end()
      if (code === 0) resolvePromise()
      else rejectPromise(new Error(`${command} ${args.join(' ')} exited with ${String(code)}`))
    })
  })
}

function redactLog(value) {
  return String(value)
    .replace(/\/Users\/[^/\s]+/gu, '<local-user>')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/giu, '<local-user>')
    .replace(/(?:sk|rk|sess)-[A-Za-z0-9_-]{20,}/gu, '<redacted-secret>')
}

function pnpmInvocation(args) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath === undefined || !npmExecPath.toLowerCase().includes('pnpm')) {
    throw new Error('local flow must run through the pinned pnpm entry: pnpm flow <command>')
  }
  return { command: process.execPath, args: [npmExecPath, ...args] }
}

function assertPinnedPnpm() {
  const invocation = pnpmInvocation(['--version'])
  const result = spawnSync(invocation.command, invocation.args, { encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0 || PNPM_VERSION === undefined || result.stdout.trim() !== PNPM_VERSION) {
    throw new Error(`candidate requires pinned pnpm ${String(PNPM_VERSION)}; received ${result.stdout.trim() || '<unavailable>'}`)
  }
}

async function runPnpm(args, options) {
  const invocation = pnpmInvocation(args)
  return runLogged(invocation.command, invocation.args, options)
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
  if (process.platform !== expectedPlatform) throw new Error(`${platform} candidate must build on native ${expectedPlatform}`)
  if (platform === 'windows') validateRemoteHostname(hostname())
  assertPinnedPnpm()
  await runPnpm(['install', '--frozen-lockfile'], { cwd: sourceRoot, log })
  await runPnpm(['--dir', 'upstream/deepseek-harness', 'install', '--frozen-lockfile'], { cwd: sourceRoot, log, env: { ...process.env, CI: 'true' } })
  await runPnpm(['run', 'build:harness'], { cwd: sourceRoot, log })
  await runPnpm(['run', 'check:release-boundary'], { cwd: sourceRoot, log })
  await runLogged(process.execPath, ['scripts/component-run.mjs', 'build'], { cwd: sourceRoot, log })
  await runPnpm(['--filter', '@e-mate/dsh', 'build'], { cwd: sourceRoot, log })
  await runLogged(platform === 'macos' ? 'python3' : 'python', [
    'packages/dsh-plugin-vision-toolkit/scripts/prepare-wheels.py',
    '--root', 'packages/dsh-plugin-vision-toolkit',
    '--targets', platform === 'macos' ? 'darwin-arm64,darwin-x64' : 'win32-x64',
  ], { cwd: sourceRoot, log })
  await runLogged(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['yarn', 'install', '--immutable'], { cwd: join(sourceRoot, 'desktop'), log })
  await runLogged(process.platform === 'win32' ? 'corepack.cmd' : 'corepack', ['yarn', PLATFORMS[platform].build], { cwd: join(sourceRoot, 'desktop'), log })
  await exportArtifact(sourceRoot, platform, output, git(['rev-parse', 'HEAD'], sourceRoot))
}

function encodedPowerShell(source) {
  return Buffer.from(source, 'utf16le').toString('base64')
}

async function capture(command, args, cwd = ROOT) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', rejectPromise)
    child.on('close', code => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString('utf8'))
      else rejectPromise(new Error(Buffer.concat(stderr).toString('utf8').trim() || `${command} failed`))
    })
  })
}

async function windowsBuild(sourceArchive, output, run, log, scratch) {
  validateRemoteHostname(await capture('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'kh19arc', 'hostname']))
  const temp = (await capture('ssh', ['kh19arc', 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell('[IO.Path]::GetTempPath()')])).trim()
  if (!/^[A-Za-z]:\\[^\r\n]+\\$/u.test(temp)) throw new Error('kh19arc returned an invalid temporary directory')
  const remoteRoot = `${temp}emate-t25\\${run.run_id}`
  const remoteArchive = `${remoteRoot}\\source.tgz`
  const remoteResult = `${remoteRoot}\\result.tgz`
  const initialize = `$ErrorActionPreference='Stop';$root='${remoteRoot.replaceAll("'", "''")}';if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force};New-Item -ItemType Directory -Path $root|Out-Null`
  const cleanup = `$root='${remoteRoot.replaceAll("'", "''")}';if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}`
  await runLogged('ssh', ['kh19arc', 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(initialize)], { cwd: ROOT, log })
  try {
    await runLogged('scp', ['-O', sourceArchive, `kh19arc:${remoteArchive.replaceAll('\\', '/')}`], { cwd: ROOT, log })
    const build = [
      "$ErrorActionPreference='Stop'",
      `$root='${remoteRoot.replaceAll("'", "''")}'`,
      'Set-Location $root',
      "New-Item -ItemType Directory -Path 'source'|Out-Null",
      "tar.exe -xzf 'source.tgz' -C 'source'",
      "Set-Location 'source'",
      `corepack pnpm run flow -- _platform-build --platform windows --out '..\\out' --source-commit ${run.source_commit}`,
      'Set-Location $root',
      "tar.exe -czf 'result.tgz' -C 'out' .",
    ].join(';')
    await runLogged('ssh', ['kh19arc', 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(build)], { cwd: ROOT, log })
    const localResult = join(scratch, 'windows-result.tgz')
    await runLogged('scp', ['-O', `kh19arc:${remoteResult.replaceAll('\\', '/')}`, localResult], { cwd: ROOT, log })
    await rm(output, { recursive: true, force: true })
    await mkdir(output, { recursive: true })
    await runLogged('tar', ['-xzf', localResult, '-C', output], { cwd: ROOT, log })
  } finally {
    await runLogged('ssh', ['kh19arc', 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedPowerShell(cleanup)], { cwd: ROOT, log }).catch(() => {})
  }
}

async function candidate(values) {
  const identity = sourceIdentity()
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
  const sourceArchive = join(scratch, 'source.tgz')
  const setupLog = join(directory, 'logs', 'candidate.log')
  const failures = []
  try {
    await cleanSourceCopy(ROOT, source, identity, setupLog)
    if (selection.build.includes('windows')) {
      await runLogged('tar', ['-czf', sourceArchive, '-C', source, '.'], {
        cwd: ROOT, log: setupLog, env: { ...process.env, COPYFILE_DISABLE: '1' },
      })
    }
    for (const platform of selection.build) {
      const output = join(directory, 'artifacts', platform)
      const log = join(directory, 'logs', `${platform}.log`)
      run.platforms[platform] = { status: 'building', source_commit: run.source_commit }
      await saveRun(directory, run)
      try {
        if (platform === 'macos') {
          const temporary = join(scratch, 'macos-out')
          await runLogged(process.execPath, [join(source, 'scripts', 'local-flow.mjs'), '_platform-build', '--platform', 'macos', '--out', temporary, '--source-commit', run.source_commit], { cwd: source, log })
          await mkdir(dirname(output), { recursive: true })
          await rm(output, { recursive: true, force: true })
          await mkdir(output)
          for (const name of await readdir(temporary)) await copyFile(join(temporary, name), join(output, name))
        } else {
          await windowsBuild(sourceArchive, output, run, log, scratch)
        }
        const verified = await verifyLocalArtifact(output, platform, run.source_commit)
        run.platforms[platform] = { status: 'passed', source_commit: run.source_commit, artifact: verified.primary }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        run.platforms[platform] = { status: 'failed', source_commit: run.source_commit, error: message }
        failures.push(new Error(`${platform}: ${message}`))
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
  const coverage = ['installation', 'startup', 'update', '2.0.15-fixes', 'built-in-tools', ...(platform === 'macos' ? ['computer-use'] : [])]
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
  if (run.command !== 'candidate' || run.status !== 'built') throw new Error('verify requires one complete candidate run')
  const artifacts = {}
  const computerUse = {}
  for (const platform of Object.keys(PLATFORMS)) {
    const verified = await verifyLocalArtifact(join(directory, 'artifacts', platform), platform, run.source_commit)
    const receipt = await verifyComputerUseReceipt(join(directory, 'computer-use', platform, 'result.json'), {
      platform, sourceCommit: run.source_commit, artifactSha256: verified.primary.sha256,
    })
    artifacts[platform] = verified
    computerUse[platform] = receipt.external_acceptance
  }
  return { artifacts, computerUse }
}

function verificationEvidence({ artifacts, computerUse }) {
  return {
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([platform, value]) => [platform, {
      primary: value.primary,
      files: value.receipt.files,
    }])),
    computer_use: computerUse,
  }
}

function assertVerificationMatches(run, verified) {
  const current = verificationEvidence(verified)
  if (run.verification?.status !== 'passed'
    || JSON.stringify(run.verification.artifacts) !== JSON.stringify(current.artifacts)
    || JSON.stringify(run.verification.computer_use) !== JSON.stringify(current.computer_use)) {
    throw new Error('publish requires an unchanged passed verify run; rerun verify')
  }
}

async function verifyCommand(values) {
  const { directory, run } = await loadRun(values.run)
  try {
    const verified = await verifyRun(directory, run)
    run.verification = {
      status: 'passed', verified_at: now(),
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

function objectRecords(run) {
  const artifacts = run.verification?.artifacts
  if (!exactKeys(artifacts, ['macos', 'windows'])) throw new Error('verified candidate must contain both platform artifacts')
  const records = []
  for (const [platform, bundle] of Object.entries(artifacts)) {
    const config = PLATFORMS[platform]
    if (!exactKeys(bundle, ['primary', 'files']) || !exactKeys(bundle.primary, ['name', 'bytes', 'sha256'])
      || !Array.isArray(bundle.files) || ![1, 2].includes(bundle.files.length)) {
      throw new Error(`${platform} verified artifact set is invalid`)
    }
    const expectedNames = [config.artifact, ...(bundle.files.some(file => file?.name === `${config.artifact}.blockmap`) ? [`${config.artifact}.blockmap`] : [])].sort()
    if (JSON.stringify(bundle.files.map(file => file?.name).sort()) !== JSON.stringify(expectedNames)) {
      throw new Error(`${platform} verified artifact file set is invalid`)
    }
    for (const artifact of bundle.files) {
      if (!exactKeys(artifact, ['name', 'bytes', 'sha256']) || basename(artifact.name ?? '') !== artifact.name
        || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || !SHA256.test(artifact.sha256 ?? '')) {
        throw new Error(`${platform} verified artifact descriptor is invalid`)
      }
      records.push({
        platform,
        artifact_path: `artifacts/${platform}/${artifact.name}`,
        key: `desktop/releases/v${run.version}/${run.source_commit}/${artifact.name}`,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        write: 'create-only',
      })
    }
    const primary = bundle.files.find(file => file.name === config.artifact)
    if (JSON.stringify(bundle.primary) !== JSON.stringify(primary)) throw new Error(`${platform} primary artifact binding is invalid`)
  }
  return records.sort((left, right) => left.platform.localeCompare(right.platform) || left.key.localeCompare(right.key))
}

function verifiedComputerUse(run) {
  const evidence = run.verification?.computer_use
  if (!exactKeys(evidence, ['macos', 'windows'])) throw new Error('publish requires both external installed acceptance receipts')
  for (const platform of Object.keys(PLATFORMS)) {
    validateExternalAcceptance(evidence[platform], {
      platform,
      artifactSha256: run.verification.artifacts[platform].primary.sha256,
    })
  }
  return evidence
}

export function buildPublicationRequest(run, { dryRun = false } = {}) {
  if (run.verification?.status !== 'passed') throw new Error('publish requires a passed verify run')
  verifiedComputerUse(run)
  const immutableObjects = objectRecords(run)
  return {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-request',
    operation: 'publish',
    mode: dryRun ? 'dry-run' : 'apply',
    status: 'ready-for-existing-owner',
    authority: OWNER,
    version: run.version,
    source_commit: run.source_commit,
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
      manual_manifest: {
        key: `desktop/manual/v${run.version}/latest.json`,
        artifact_path: 'desktop-release-signed.json',
        write: 'create-only',
        immutable_object_keys: immutableObjects.map(object => object.key),
        authenticated_readback: 'required',
        public_readback: 'required',
      },
      pointers: {
        signed: {
          key: 'desktop/signed/latest.json', expected_current: { ...POINTER_PREDECESSOR },
          compare_and_swap: 'required', body: 'exact-signed-manifest-bytes',
        },
        legacy: {
          key: 'desktop/latest.json', expected_current: { ...POINTER_PREDECESSOR },
          compare_and_swap: 'required', body: 'exact-signed-manifest-bytes', execution_order: 'last',
        },
      },
      order: [
        'existing-owner-admission-and-ed25519-manifest-signing', 'immutable-create-only', 'authenticated-readback', 'public-readback',
        'manual-signed-manifest-create-only', 'manual-manifest-signature-and-public-readback', 'signed-pointer-cas',
        'signed-pointer-public-readback', 'legacy-pointer-cas', 'legacy-pointer-public-readback',
      ],
    },
    delete_objects: [],
  }
}

function validPointerIdentity(value) {
  return exactKeys(value, ['bytes', 'sha256']) && Number.isSafeInteger(value.bytes)
    && value.bytes > 0 && SHA256.test(value.sha256 ?? '')
}

function samePointerIdentity(value, expected) {
  return validPointerIdentity(value) && value.bytes === expected.bytes && value.sha256 === expected.sha256
}

function unsignedInstallerSecurity(value) {
  return exactKeys(value, ['darwin', 'win32'])
    && sameRecord(value.darwin, INSTALLER_SECURITY.darwin)
    && sameRecord(value.win32, INSTALLER_SECURITY.win32)
}

export function validatePublicationReceipt(receipt, run, requestSha256) {
  if (!exactKeys(receipt, [
    'schema_version', 'document_type', 'operation', 'status', 'macos_publication_mode', 'installer_security',
    'version', 'source_commit', 'request_sha256', 'manifest_admission', 'immutable_objects',
    'manual_manifest', 'pointers', 'deleted_objects',
  ])
    || receipt.schema_version !== 1 || receipt.document_type !== 'emate.local-cloudflare-owner-receipt'
    || receipt.operation !== 'publish' || receipt.status !== 'passed' || receipt.macos_publication_mode !== 'unsigned'
    || !unsignedInstallerSecurity(receipt.installer_security)
    || receipt.version !== run.version || receipt.source_commit !== run.source_commit
    || receipt.request_sha256 !== requestSha256 || !SHA256.test(requestSha256 ?? '') || !exactKeys(receipt.pointers, ['signed', 'legacy'])
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
  const manifest = receipt.manual_manifest
  const manualKey = `desktop/manual/v${run.version}/latest.json`
  if (!exactKeys(manifest, ['key', 'bytes', 'sha256', 'write', 'authenticated_readback', 'public_readback'])
    || manifest.key !== manualKey || !Number.isSafeInteger(manifest.bytes) || manifest.bytes <= 0
    || !SHA256.test(manifest.sha256 ?? '') || !['created', 'already-exact'].includes(manifest.write)
    || manifest.authenticated_readback !== 'passed' || manifest.public_readback !== 'passed') {
    throw new Error('Cloudflare manual manifest receipt is invalid')
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
    || admission.signed_manifest.bytes !== manifest.bytes || admission.signed_manifest.bytes > 16 * 1024
    || admission.signed_manifest.sha256 !== manifest.sha256
    || !exactKeys(admission.publication_plan, ['file', 'sha256', 'status'])
    || admission.publication_plan.file !== 'cloudflare-publication-plan.json'
    || !SHA256.test(admission.publication_plan.sha256 ?? '') || admission.publication_plan.status !== 'ready-for-cloudflare-plugin'
    || !exactKeys(admission.admission_receipt, ['file', 'sha256', 'status'])
    || admission.admission_receipt.file !== 'cloudflare-plugin-handoff.json'
    || !SHA256.test(admission.admission_receipt.sha256 ?? '') || admission.admission_receipt.status !== 'ready-for-cloudflare-plugin') {
    throw new Error('Desktop manifest admission/signature receipt is invalid')
  }
  for (const [name, key] of [['signed', 'desktop/signed/latest.json'], ['legacy', 'desktop/latest.json']]) {
    const pointer = receipt.pointers[name]
    if (!exactKeys(pointer, ['key', 'before', 'after', 'cas', 'public_readback']) || pointer.key !== key
      || !samePointerIdentity(pointer.before, POINTER_PREDECESSOR) || !validPointerIdentity(pointer.after)
      || pointer.after.bytes !== manifest.bytes || pointer.after.sha256 !== manifest.sha256
      || pointer.cas !== 'passed' || pointer.public_readback !== 'passed') throw new Error(`Cloudflare ${name} pointer receipt is invalid`)
  }
  return receipt
}

export function buildRollbackRequest(run, publicationReceipt, { dryRun = false } = {}) {
  if (run.verification?.status !== 'passed') throw new Error('rollback requires a verified candidate run')
  verifiedComputerUse(run)
  if (!dryRun && publicationReceipt === undefined) throw new Error('rollback requires the existing Cloudflare owner publication receipt')
  const pointers = publicationReceipt === undefined
    ? [
      { key: 'desktop/signed/latest.json', expected_current: 'from-publication-owner-receipt.after', restore: { ...POINTER_PREDECESSOR } },
      { key: 'desktop/latest.json', expected_current: 'from-publication-owner-receipt.after', restore: { ...POINTER_PREDECESSOR } },
    ]
    : ['signed', 'legacy'].map(name => ({
      key: publicationReceipt.pointers[name].key,
      expected_current: publicationReceipt.pointers[name].after,
      restore: publicationReceipt.pointers[name].before,
    }))
  return {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-request',
    operation: 'rollback',
    mode: dryRun ? 'dry-run' : 'apply',
    status: 'ready-for-existing-owner',
    authority: OWNER,
    version: run.version,
    source_commit: run.source_commit,
    rebuild: false,
    pointer_compare_and_swap: pointers,
    immutable_objects: [
      ...objectRecords(run).map(object => ({ key: object.key, action: 'retain' })),
      { key: `desktop/manual/v${run.version}/latest.json`, action: 'retain' },
    ],
    delete_objects: [],
  }
}

async function publish(values) {
  const { directory, run } = await loadRun(values.run)
  assertVerificationMatches(run, await verifyRun(directory, run))
  const request = buildPublicationRequest(run, { dryRun: values.dryRun })
  const path = join(directory, 'publication', 'cloudflare-owner-request.json')
  await atomicJson(path, request)
  const requestSha256 = await fileDigest(path)
  if (values.ownerReceipt !== undefined) {
    const receipt = validatePublicationReceipt(await json(resolve(values.ownerReceipt)), run, requestSha256)
    await atomicJson(join(directory, 'publication', 'cloudflare-owner-receipt.json'), receipt)
    run.publication = { status: 'passed', request_sha256: requestSha256, owner: OWNER }
  } else {
    run.publication = { status: values.dryRun ? 'dry-run' : 'awaiting-existing-owner', request_sha256: requestSha256, owner: OWNER }
  }
  await saveRun(directory, run)
  await writeChecksums(directory)
  process.stdout.write(`${JSON.stringify({ run_id: run.run_id, publication: run.publication, request: relativePath(directory, path) }, null, 2)}\n`)
}

async function rollback(values) {
  const { directory, run } = await loadRun(values.run)
  assertVerificationMatches(run, await verifyRun(directory, run))
  let publicationReceipt
  const receiptPath = join(directory, 'publication', 'cloudflare-owner-receipt.json')
  if (!values.dryRun) {
    const publicationRequest = join(directory, 'publication', 'cloudflare-owner-request.json')
    publicationReceipt = validatePublicationReceipt(await json(receiptPath), run, await fileDigest(publicationRequest))
  }
  const request = buildRollbackRequest(run, publicationReceipt, { dryRun: values.dryRun })
  const path = join(directory, 'rollback', 'cloudflare-owner-request.json')
  await atomicJson(path, request)
  run.rollback = { status: values.dryRun ? 'dry-run' : 'awaiting-existing-owner', owner: OWNER, delete_objects: 0 }
  await saveRun(directory, run)
  await writeChecksums(directory)
  process.stdout.write(`${JSON.stringify({ run_id: run.run_id, rollback: run.rollback, request: relativePath(directory, path) }, null, 2)}\n`)
}

function argumentsFor(argv) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      run: { type: 'string' },
      retry: { type: 'string' },
      platform: { type: 'string' },
      out: { type: 'string' },
      'source-commit': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'owner-receipt': { type: 'string' },
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
    },
  }
}

function validateCommandOptions(command, values) {
  const internal = command === '_platform-build'
  if (!['dev', 'candidate', 'verify', 'publish', 'rollback'].includes(command) && !internal) {
    throw new Error('flow command must be dev, candidate, verify, publish, or rollback')
  }
  if (command === 'dev' && (values.run !== undefined || values.retry !== undefined || values.dryRun
    || values.platform !== undefined || values.out !== undefined || values.sourceCommit !== undefined || values.ownerReceipt !== undefined)) {
    throw new Error('dev does not accept options')
  }
  if (command === 'candidate' && (values.dryRun || values.platform !== undefined || values.out !== undefined
    || values.sourceCommit !== undefined || values.ownerReceipt !== undefined)) throw new Error('candidate accepts only --run and --retry')
  if (command === 'verify' && (values.run === undefined || values.retry !== undefined || values.dryRun
    || values.platform !== undefined || values.out !== undefined || values.sourceCommit !== undefined || values.ownerReceipt !== undefined)) {
    throw new Error('verify requires only --run <id>')
  }
  if (command === 'publish' && (values.run === undefined || values.retry !== undefined
    || values.platform !== undefined || values.out !== undefined || values.sourceCommit !== undefined
    || values.dryRun && values.ownerReceipt !== undefined)) {
    throw new Error('publish requires --run <id> and accepts only --dry-run or --owner-receipt')
  }
  if (command === 'rollback' && (values.run === undefined || values.retry !== undefined
    || values.platform !== undefined || values.out !== undefined || values.sourceCommit !== undefined || values.ownerReceipt !== undefined)) {
    throw new Error('rollback requires --run <id> and optionally --dry-run')
  }
  if (internal && (values.run !== undefined || values.retry !== undefined || values.dryRun || values.ownerReceipt !== undefined)) {
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
    await platformBuild(ROOT, values.platform, resolve(values.out), join(dirname(resolve(values.out)), `${values.platform}.log`))
  }
}

if (process.argv[1] !== undefined && await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url))) {
  try {
    await main()
  } catch (cause) {
    process.stderr.write(`local-flow: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    if (cause instanceof AggregateError) for (const error of cause.errors) process.stderr.write(`- ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
