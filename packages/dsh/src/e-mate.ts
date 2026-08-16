// e-Mate lifecycle overlay on the pinned Harness runtime.
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  lstatSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { normalizeUpdateTarget, runOnlineUpdateHelper, scheduleOnlineUpdate } from './update.js'
import { migrateLegacySessions } from './legacy-migration.js'
import { migrateLegacySchedules } from './legacy-schedule.js'
import { checkOsCredentialBackend } from './profile/credentials-os.js'

export const PRODUCT = 'e-Mate'
export const VERSION = '2.0.7'
export const PROFILE = 'e-mate'
export const DEFAULT_PORT = 3080
export const HARNESS_VERSION = '0.1.0-rc.5'
export const HARNESS_COMMIT = '47f943859bef60e4160492346772ded9b24f765a'
const PLUGIN_PACKAGES = [
  '@e-mate/dsh-plugin-better-sidebar',
  '@e-mate/dsh-plugin-browser',
  '@e-mate/dsh-plugin-browser-panel',
  '@e-mate/dsh-plugin-genui',
  '@e-mate/dsh-plugin-im',
  '@e-mate/dsh-plugin-memory-evolve',
  '@e-mate/dsh-plugin-office-skills',
  '@e-mate/dsh-plugin-search-mcp',
  '@e-mate/dsh-plugin-subagent',
  '@e-mate/dsh-plugin-vision-toolkit',
]
const UPDATE_RECEIPT_NAME = /^online-update-([0-9a-f]{8}-[0-9a-f-]{27})\.json$/iu
const UPDATE_RECEIPT_STATUS = new Set(['completed', 'rolled-back', 'rollback-failed', 'failed-before-change'])

const packageRoot = resolve(import.meta.dirname, '..')
const binPath = fileURLToPath(new URL('./bin.js', import.meta.url))
export function resolveDshHome(environment = process.env) {
  return resolve(environment.DSH_HOME || join(homedir(), '.dsh'))
}

export function managedPaths(dshHome = resolveDshHome()) {
  const data = join(dshHome, 'e-mate')
  const run = join(data, 'run')
  return {
    dshHome,
    data,
    profile: join(dshHome, 'profiles', PROFILE),
    run,
    state: join(run, 'instance.json'),
    log: join(data, 'logs', 'web.log'),
    receipt: join(data, 'migrations', 'setup-2.0.7.json'),
  }
}

function atomicWrite(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, content, { mode })
    renameSync(temporary, path)
    if (mode !== undefined) chmodSync(path, mode)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

export function latestUpdateReceipt(dshHome = resolveDshHome()) {
  const directory = join(dshHome, 'e-mate', 'migrations')
  let latest
  try {
    for (const filename of readdirSync(directory)) {
      const match = UPDATE_RECEIPT_NAME.exec(filename)
      if (match === null) continue
      const path = join(directory, filename)
      const metadata = lstatSync(path)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 2 || metadata.size > 64 * 1024) continue
      const receipt = readJson(path)
      const finished = Date.parse(receipt?.finished_at)
      if (receipt?.schema_version !== 1 || receipt.product !== PRODUCT || receipt.request_id !== match[1]
        || !UPDATE_RECEIPT_STATUS.has(receipt.status) || !Number.isFinite(finished)
        || typeof receipt.requested_version !== 'string' || typeof receipt.previous_version !== 'string'
        || (receipt.installed_version !== undefined && typeof receipt.installed_version !== 'string')) continue
      if (latest === undefined || finished > latest.finished) {
        latest = {
          finished,
          value: {
            request_id: receipt.request_id,
            status: receipt.status,
            requested_version: receipt.requested_version,
            previous_version: receipt.previous_version,
            ...(receipt.installed_version === undefined ? {} : { installed_version: receipt.installed_version }),
            finished_at: receipt.finished_at,
          },
        }
      }
    }
  } catch {
    return undefined
  }
  return latest?.value
}

export function installProfile(dshHome = resolveDshHome()) {
  const paths = managedPaths(dshHome)
  for (const directory of [
    paths.profile,
    join(paths.data, 'attachments'),
    join(paths.data, 'general'),
    join(paths.data, 'memory'),
    join(paths.data, 'cache'),
    join(paths.data, 'migrations'),
    join(paths.data, 'run'),
    join(paths.data, 'logs'),
  ]) mkdirSync(directory, { recursive: true })

  const manifest = {
    name: 'dsh-profile-e-mate',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries(PLUGIN_PACKAGES.map(name => [name, VERSION])),
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...PLUGIN_PACKAGES] } },
  }
  atomicWrite(join(paths.profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  atomicWrite(
    join(paths.profile, 'cordis.patch.yml'),
    readFileSync(join(packageRoot, 'profile', 'cordis.patch.yml')),
  )
  const generatedPlugins = readdirSync(join(packageRoot, 'profile', 'plugins'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => [`plugins/${entry.name}`, `plugins/${entry.name}`])
  const profileFiles = [
    ...generatedPlugins,
    ['plugins/identity/index.js', 'plugins/identity/index.js'],
    ['plugins/identity/agreements.js', 'plugins/identity/agreements.js'],
    ['plugins/identity/agreements/e-mate-user-agreement.md', 'plugins/identity/agreements/e-mate-user-agreement.md'],
    ['plugins/identity/agreements/yixin-enterprise-disclaimer.md', 'plugins/identity/agreements/yixin-enterprise-disclaimer.md'],
    ['plugins/emate-shell/package.json', 'node_modules/@deepseek-ai/dsh-client-ui-sidebar/package.json'],
    ['plugins/emate-shell/index.js', 'node_modules/@deepseek-ai/dsh-client-ui-sidebar/index.js'],
    ['plugins/emate-shell/lib/client.js', 'node_modules/@deepseek-ai/dsh-client-ui-sidebar/lib/client.js'],
    ['plugins/emate-shell/assets/emate-logo.png', 'node_modules/@deepseek-ai/dsh-client-ui-sidebar/assets/emate-logo.png'],
    ['plugins/emate-shell/assets/emate-mark.png', 'node_modules/@deepseek-ai/dsh-client-ui-sidebar/assets/emate-mark.png'],
    ['plugins/emate-shell/assets/e-mate-team-hero-transparent.png', 'node_modules/@deepseek-ai/dsh-client-ui-sidebar/assets/e-mate-team-hero-transparent.png'],
    ['plugins/emate-shell/assets/xiaoxin-avatar.png', 'node_modules/@deepseek-ai/dsh-client-ui-sidebar/assets/xiaoxin-avatar.png'],
    ['plugins/emate-shell/assets/lucide-send.svg', 'node_modules/@deepseek-ai/dsh-client-ui-sidebar/assets/lucide-send.svg'],
  ]
  for (const [source, target] of profileFiles) {
    atomicWrite(join(paths.profile, target), readFileSync(join(packageRoot, 'profile', source)))
  }
  for (const name of PLUGIN_PACKAGES) {
    const slug = name.slice('@e-mate/dsh-plugin-'.length)
    const source = join(packageRoot, 'profile', 'bundles', slug)
    const target = join(paths.profile, 'node_modules', ...name.split('/'))
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true, force: true })
  }
  const binding = join(paths.profile, 'plugins', 'runtime-binding.json')
  const harness = resolveHarness()
  const toolsModule = resolveHarnessModule(harness, 'packages/core/tools', '@deepseek-ai/dsh-tools')
  const storageDomainModule = resolveHarnessModule(harness, 'packages/storage/storage-domain', '@deepseek-ai/dsh-storage-domain')
  const llmModule = resolveHarnessModule(harness, 'packages/llm/llm', '@deepseek-ai/dsh-llm')
  const credentialsModule = resolveHarnessModule(harness, 'packages/credentials/credentials', '@deepseek-ai/dsh-credentials')
  const launchEnvironmentModule = resolveHarnessModule(harness, 'packages/util/launch-environment', '@deepseek-ai/dsh-launch-environment')
  const zodModule = resolveHarnessDependency(harness, 'packages/storage/storage-domain', 'zod')
  atomicWrite(binding, `${JSON.stringify({
    schema_version: 1,
    product: PRODUCT,
    version: VERSION,
    dsh_home: paths.dshHome,
    harness_commit: HARNESS_COMMIT,
    tools_module: toolsModule,
    tools_module_sha256: createHash('sha256').update(readFileSync(toolsModule)).digest('hex'),
    storage_domain_module: storageDomainModule,
    storage_domain_module_sha256: createHash('sha256').update(readFileSync(storageDomainModule)).digest('hex'),
    llm_module: llmModule,
    llm_module_sha256: createHash('sha256').update(readFileSync(llmModule)).digest('hex'),
    credentials_module: credentialsModule,
    credentials_module_sha256: createHash('sha256').update(readFileSync(credentialsModule)).digest('hex'),
    launch_environment_module: launchEnvironmentModule,
    launch_environment_module_sha256: createHash('sha256').update(readFileSync(launchEnvironmentModule)).digest('hex'),
    zod_module: zodModule,
    zod_module_sha256: createHash('sha256').update(readFileSync(zodModule)).digest('hex'),
  }, null, 2)}\n`, 0o600)
  return paths
}

function parseNodeVersion(value = process.versions.node) {
  const [major, minor] = value.split('.').map(Number)
  return { major, minor }
}

export function nodeVersionSupported(value = process.versions.node) {
  const { major, minor } = parseNodeVersion(value)
  return major >= 24 || (major === 22 && minor >= 19)
}

export function platformSupported(platform = process.platform, arch = process.arch) {
  return (platform === 'darwin' && (arch === 'arm64' || arch === 'x64'))
    || (platform === 'win32' && arch === 'x64')
}

function harnessFromDevelopmentTree() {
  const root = resolve(packageRoot, '..', '..', 'upstream', 'deepseek-harness')
  const bin = join(root, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(bin)) return undefined
  const version = readJson(join(root, 'apps', 'cli', 'package.json'))?.version
  const git = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  return { bin, version, commit: git.status === 0 ? git.stdout.trim() : undefined, source: 'development-source' }
}

function harnessFromPackage() {
  const root = join(packageRoot, 'runtime', 'harness')
  const bin = join(root, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(bin)) return undefined
  const source = readJson(join(packageRoot, 'runtime', 'source-manifest.json'))
  const version = readJson(join(root, 'apps', 'cli', 'package.json'))?.version
  return { bin, version, commit: source?.commit, source: 'packaged-runtime' }
}

export function resolveHarness() {
  const runtime = harnessFromPackage() ?? harnessFromDevelopmentTree()
  if (runtime === undefined) throw new Error('exact e-Mate local runtime is missing')
  if (runtime.version !== HARNESS_VERSION || runtime.commit !== HARNESS_COMMIT) {
    throw new Error(`e-Mate local runtime drifted (version=${String(runtime.version)}, commit=${String(runtime.commit)})`)
  }
  return runtime
}

function harnessRoot(harness) {
  return resolve(dirname(dirname(harness.bin)), '..', '..')
}

export function resolveHarnessModule(harness, packagePath, packageName) {
  const root = harnessRoot(harness)
  const manifestPath = join(root, packagePath, 'package.json')
  if (existsSync(manifestPath)) {
    const main = readJson(manifestPath)?.main
    const entry = typeof main === 'string' ? resolve(dirname(manifestPath), main) : undefined
    if (entry === undefined || !existsSync(entry)) throw new Error(`pinned runtime package ${packageName} is not built`)
    return entry
  }
  return createRequire(join(dirname(dirname(harness.bin)), 'package.json')).resolve(packageName)
}

function resolveHarnessDependency(harness, packagePath, dependencyName) {
  const manifestPath = join(harnessRoot(harness), packagePath, 'package.json')
  return createRequire(existsSync(manifestPath)
    ? manifestPath
    : join(dirname(dirname(harness.bin)), 'package.json')).resolve(dependencyName)
}

function nearestExisting(path) {
  let candidate = path
  while (!existsSync(candidate)) {
    const parent = dirname(candidate)
    if (parent === candidate) break
    candidate = parent
  }
  return candidate
}

function writableCheck(path) {
  try {
    accessSync(nearestExisting(path), constants.W_OK)
    return { ok: true, detail: path }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

async function sqliteCheck(paths) {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const databases = [join(paths.data, 'sessions.sqlite3'), join(paths.data, 'state.sqlite3')]
      .filter(existsSync)
    if (databases.length === 0) {
      const db = new DatabaseSync(':memory:')
      db.close()
    } else {
      for (const path of databases) {
        const db = new DatabaseSync(path, { readOnly: true })
        db.prepare('PRAGMA quick_check').get()
        db.close()
      }
    }
    return { ok: true, detail: databases.length === 0 ? 'node:sqlite available' : `${databases.length} database(s) readable` }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function pluginBundleCheck(root = join(packageRoot, 'profile', 'bundles')) {
  try {
    const registry = readJson(join(root, 'registry.json'))
    if (registry?.schema_version !== 1
      || registry.product !== PRODUCT
      || registry.version !== VERSION
      || registry.harness_version !== HARNESS_VERSION
      || registry.harness_commit !== HARNESS_COMMIT
      || !Array.isArray(registry.packages)
      || JSON.stringify(registry.packages.map(item => item?.name)) !== JSON.stringify(PLUGIN_PACKAGES)) {
      throw new Error('plugin bundle registry is invalid')
    }
    for (const name of PLUGIN_PACKAGES) {
      const slug = name.slice('@e-mate/dsh-plugin-'.length)
      const bundleRoot = join(root, slug)
      const manifest = readJson(join(bundleRoot, 'package.json'))
      if (manifest?.name !== name || manifest?.version !== VERSION || manifest?.license !== 'MIT'
        || typeof manifest?.main !== 'string' || !existsSync(join(bundleRoot, manifest.main))
        || typeof manifest?.dsh?.bundle?.patch !== 'string'
        || !existsSync(join(bundleRoot, manifest.dsh.bundle.patch))) {
        throw new Error(`${name} bundle is incomplete`)
      }
      if (manifest?.dsh?.client !== undefined && !existsSync(join(bundleRoot, 'lib', 'client.js'))) {
        throw new Error(`${name} client bundle is incomplete`)
      }
    }
    return { ok: true, detail: `${PLUGIN_PACKAGES.length} pinned DSH plugin bundle(s)` }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

function profileCheck(paths) {
  const manifest = readJson(join(paths.profile, 'package.json'))
  const bundles = manifest?.dsh?.profile?.bundles
  const patch = join(paths.profile, 'cordis.patch.yml')
  const plugins = [
    join(paths.profile, 'plugins', 'health.js'),
    join(paths.profile, 'plugins', 'agent-operations.js'),
    join(paths.profile, 'plugins', 'capabilities.js'),
    join(paths.profile, 'plugins', 'connections.js'),
    join(paths.profile, 'plugins', 'qr-generation.js'),
    join(paths.profile, 'plugins', 'credentials-os.js'),
    join(paths.profile, 'plugins', 'settings-document-boundary.js'),
    join(paths.profile, 'plugins', 'skill-hub-agent.js'),
    join(paths.profile, 'plugins', 'image-generation.js'),
    join(paths.profile, 'plugins', 'model-policy.js'),
    join(paths.profile, 'plugins', 'audit.js'),
    join(paths.profile, 'plugins', 'legacy-migration.js'),
    join(paths.profile, 'plugins', 'schedule-import.js'),
    join(paths.profile, 'plugins', 'runtime-binding.json'),
    join(paths.profile, 'plugins', 'identity', 'index.js'),
    join(paths.profile, 'plugins', 'identity', 'agreements.js'),
    join(paths.profile, 'plugins', 'identity', 'agreements', 'e-mate-user-agreement.md'),
    join(paths.profile, 'plugins', 'identity', 'agreements', 'yixin-enterprise-disclaimer.md'),
    join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar', 'package.json'),
    join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar', 'index.js'),
    join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar', 'lib', 'client.js'),
    join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar', 'assets', 'emate-logo.png'),
    join(paths.profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar', 'assets', 'emate-mark.png'),
  ]
  let patchValid = false
  try {
    const document = parseYaml(readFileSync(patch, 'utf8'))
    const rows = Array.isArray(document)
      ? document.flatMap(operation => Array.isArray(operation?.insert) ? operation.insert : operation?.id ? [operation] : [])
      : []
    const byId = new Map(rows.map(row => [row?.id, row]))
    patchValid = byId.get('schedule')?.name === '@deepseek-ai/dsh-schedule'
      && byId.get('credentials')?.name === '@deepseek-ai/dsh-credentials-local'
      && byId.get('credentials')?.disabled === true
      && byId.get('emate-settings-document-boundary')?.name === './plugins/settings-document-boundary.js'
      && byId.get('emate-credentials-os')?.name === './plugins/credentials-os.js'
      && byId.get('emate-connections')?.name === './plugins/connections.js'
      && byId.get('emate-qr-generation')?.name === './plugins/qr-generation.js'
      && byId.get('emate-model-policy')?.name === './plugins/model-policy.js'
      && byId.get('emate-audit')?.name === './plugins/audit.js'
      && JSON.stringify(byId.get('emate-audit')?.inject) === JSON.stringify([
        'connection', 'sessionPersistence', 'storageDomain', 'timer', 'emateModelPolicy', 'emateIdentity',
      ])
      && byId.get('emate-schedule-import')?.name === './plugins/schedule-import.js'
      && byId.get('emate-legacy-migration')?.name === './plugins/legacy-migration.js'
      && byId.get('emate-agent-operations')?.name === './plugins/agent-operations.js'
      && !byId.has('emate-office-ocr')
      && !byId.has('emate-browser-computer-use')
      && !byId.has('emate-memory')
      && !byId.has('emate-dream')
      && !byId.has('emate-learning')
  } catch {
    patchValid = false
  }
  const managedPlugins = PLUGIN_PACKAGES.every(name => {
    const root = join(paths.profile, 'node_modules', ...name.split('/'))
    const packageManifest = readJson(join(root, 'package.json'))
    return packageManifest?.name === name && packageManifest?.version === VERSION
      && typeof packageManifest?.main === 'string' && existsSync(join(root, packageManifest.main))
      && (packageManifest?.dsh?.client === undefined || existsSync(join(root, 'lib', 'client.js')))
  })
  const expectedBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...PLUGIN_PACKAGES]
  const expectedDependencies = Object.fromEntries(PLUGIN_PACKAGES.map(name => [name, VERSION]))
  const ok = JSON.stringify(bundles) === JSON.stringify(expectedBundles)
    && JSON.stringify(manifest?.dependencies) === JSON.stringify(expectedDependencies)
    && patchValid && plugins.every(existsSync) && managedPlugins
  return { ok, detail: ok ? paths.profile : 'managed e-mate profile is missing or drifted; run e-mate setup' }
}

function check(id, result, required = true) {
  return { id, required, status: result.ok ? 'pass' : required ? 'fail' : 'warning', detail: result.detail }
}

export async function checkEnvironment({ dshHome = resolveDshHome(), includeProfile = true } = {}) {
  const paths = managedPaths(dshHome)
  const supported = platformSupported()
  let harness
  try {
    harness = resolveHarness()
  } catch (error) {
    harness = { error: error instanceof Error ? error.message : String(error) }
  }
  const credentialStore = await checkOsCredentialBackend()
  const checks = [
    check('node', { ok: nodeVersionSupported(), detail: process.versions.node }),
    check('platform', { ok: supported, detail: `${process.platform}-${process.arch}` }),
    check('harness', harness.error === undefined
      ? { ok: true, detail: `${harness.source} ${HARNESS_VERSION} ${HARNESS_COMMIT}` }
      : { ok: false, detail: harness.error }),
    check('plugin_bundles', pluginBundleCheck()),
    check('dsh_home_writable', writableCheck(dshHome)),
    check('sqlite', await sqliteCheck(paths)),
    check('credential_store', credentialStore),
  ]
  if (includeProfile) checks.push(check('profile', profileCheck(paths)))
  return {
    product: PRODUCT,
    version: VERSION,
    ok: checks.every(item => !item.required || item.status === 'pass'),
    checks,
  }
}

function printCheckReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  for (const item of report.checks) {
    const marker = item.status === 'pass' ? 'PASS' : item.status === 'warning' ? 'WARN' : 'FAIL'
    console.log(`${marker.padEnd(4)} ${item.id}: ${item.detail}`)
  }
  console.log(report.ok ? 'e-Mate environment is ready.' : 'e-Mate environment is not ready.')
}

function readState(paths = managedPaths()) {
  const state = readJson(paths.state)
  return state?.product === PRODUCT && state?.profile === PROFILE ? state : undefined
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function fetchHealth(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/e-mate/health`, {
      signal: AbortSignal.timeout(800),
    })
    if (!response.ok) return undefined
    const health = await response.json()
    return health?.product === PRODUCT && health?.version === VERSION && health?.profile === PROFILE
      ? health
      : undefined
  } catch {
    return undefined
  }
}

export async function managedStatus(dshHome = resolveDshHome()) {
  const paths = managedPaths(dshHome)
  const state = readState(paths)
  const latest_update = latestUpdateReceipt(dshHome)
  if (state === undefined) return { running: false, healthy: false, product: PRODUCT, version: VERSION, latest_update }
  const alive = pidAlive(state.pid)
  const health = alive ? await fetchHealth(state.port) : undefined
  const healthy = health?.instance_id === state.instance_id
  return { ...state, running: alive, healthy, health, latest_update }
}

async function portAvailable(port) {
  return await new Promise(resolvePort => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolvePort(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePort(true)))
  })
}

function parsePort(value) {
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port ${JSON.stringify(value)}`)
  return port
}

function parseLaunchArgs(args) {
  let port = DEFAULT_PORT
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--port' || args[index + 1] === undefined) {
      throw new Error(`launch accepts only --port <1-65535>, got ${JSON.stringify(args[index])}`)
    }
    port = parsePort(args[index + 1])
    index += 1
  }
  return { port }
}

function assertLoopbackWebArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--host') {
      if (args[index + 1] !== '127.0.0.1') throw new Error('e-Mate web is loopback-only; --host must be 127.0.0.1')
      index += 1
    } else if (argument.startsWith('--host=') && argument !== '--host=127.0.0.1') {
      throw new Error('e-Mate web is loopback-only; --host must be 127.0.0.1')
    }
  }
}

async function runChild(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  const forward = signal => {
    if (child.exitCode === null) child.kill(signal)
  }
  const onTerm = () => forward('SIGTERM')
  const onInterrupt = () => forward('SIGINT')
  process.on('SIGTERM', onTerm)
  process.on('SIGINT', onInterrupt)
  try {
    return await new Promise((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolveExit(code ?? (signal === 'SIGINT' ? 130 : 1)))
    })
  } finally {
    process.off('SIGTERM', onTerm)
    process.off('SIGINT', onInterrupt)
  }
}

export async function runWeb(args, dshHome = resolveDshHome()) {
  assertLoopbackWebArgs(args)
  const paths = managedPaths(dshHome)
  if (!profileCheck(paths).ok) throw new Error('managed profile unavailable; run e-mate setup')
  const harness = resolveHarness()
  const webArgs = args.some(argument => argument === '--host' || argument.startsWith('--host='))
    ? args
    : ['--host', '127.0.0.1', ...args]
  return runChild(process.execPath, [harness.bin, '--profile', PROFILE, ...webArgs], {
    env: { ...process.env, DSH_HOME: dshHome },
  })
}

function openBrowser(url) {
  if (process.env.EMATE_NO_OPEN === '1') return
  const child = process.platform === 'darwin'
    ? spawn('/usr/bin/open', [url], { detached: true, stdio: 'ignore' })
    : spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], { detached: true, stdio: 'ignore' })
  child.unref()
}

async function waitForManagedHealth(state, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await fetchHealth(state.port)
    if (health?.instance_id === state.instance_id) return health
    if (!pidAlive(state.pid)) break
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  return undefined
}

export async function launchManaged(args = [], dshHome = resolveDshHome()) {
  const { port } = parseLaunchArgs(args)
  const paths = managedPaths(dshHome)
  const existing = await managedStatus(dshHome)
  if (existing.healthy) {
    openBrowser(existing.url)
    return existing
  }
  if (existing.running) throw new Error(`managed PID ${existing.pid} is alive but unhealthy; e-mate will not replace or kill it`)
  if (!profileCheck(paths).ok) throw new Error('managed profile unavailable; run e-mate setup')
  resolveHarness()
  if (!await portAvailable(port)) {
    throw new Error(`port ${port} is occupied by a non-managed or unhealthy process; nothing was stopped`)
  }

  mkdirSync(dirname(paths.log), { recursive: true })
  mkdirSync(paths.run, { recursive: true })
  const output = openSync(paths.log, 'a')
  const instanceId = randomUUID()
  const url = `http://127.0.0.1:${port}/`
  const child = spawn(process.execPath, [binPath, 'web', '--port', String(port)], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      DSH_HOME: dshHome,
      EMATE_INSTANCE_ID: instanceId,
      EMATE_MANAGED: '1',
    },
    stdio: ['ignore', output, output],
  })
  child.unref()
  closeSync(output)
  const state = {
    product: PRODUCT,
    version: VERSION,
    profile: PROFILE,
    instance_id: instanceId,
    pid: child.pid,
    port,
    url,
    log: paths.log,
    started_at: new Date().toISOString(),
  }
  atomicWrite(paths.state, `${JSON.stringify(state, null, 2)}\n`, 0o600)
  const health = await waitForManagedHealth(state)
  if (health === undefined) {
    if (pidAlive(child.pid)) child.kill('SIGTERM')
    const current = readState(paths)
    if (current?.instance_id === instanceId) rmSync(paths.state, { force: true })
    throw new Error(`managed web failed health check; see ${paths.log}`)
  }
  openBrowser(url)
  return { ...state, running: true, healthy: true, health }
}

export async function stopManaged(dshHome = resolveDshHome()) {
  const paths = managedPaths(dshHome)
  const state = readState(paths)
  if (state === undefined) return { stopped: false, detail: 'not running' }
  if (!pidAlive(state.pid)) {
    rmSync(paths.state, { force: true })
    return { stopped: false, detail: 'removed stale instance state' }
  }
  const health = await fetchHealth(state.port)
  if (health?.instance_id !== state.instance_id) {
    throw new Error('instance identity could not be verified; no process was stopped')
  }
  process.kill(state.pid, 'SIGTERM')
  const deadline = Date.now() + 10000
  while (pidAlive(state.pid) && Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  if (pidAlive(state.pid)) throw new Error(`managed PID ${state.pid} did not stop within 10 seconds`)
  const current = readState(paths)
  if (current?.instance_id === state.instance_id) rmSync(paths.state, { force: true })
  return { stopped: true, instance_id: state.instance_id }
}

function installShortcut(environment = process.env) {
  if (process.platform === 'darwin') {
    const desktop = environment.EMATE_DESKTOP_DIR || join(homedir(), 'Desktop')
    mkdirSync(desktop, { recursive: true })
    const path = join(desktop, 'e-Mate.command')
    atomicWrite(path, "#!/bin/zsh\nexec /bin/zsh -lic 'exec e-mate launch'\n", 0o755)
    return path
  }
  if (process.platform === 'win32') {
    const script = [
      "$desktop = [Environment]::GetFolderPath('Desktop')",
      "$final = Join-Path $desktop 'e-Mate.lnk'",
      "$temp = Join-Path $desktop ('e-Mate.' + [guid]::NewGuid().ToString() + '.tmp.lnk')",
      '$shell = New-Object -ComObject WScript.Shell',
      '$shortcut = $shell.CreateShortcut($temp)',
      '$shortcut.TargetPath = $env:ComSpec',
      '$shortcut.Arguments = \'/d /c start "" e-mate launch\'',
      '$shortcut.Save()',
      'Move-Item -LiteralPath $temp -Destination $final -Force',
      'Write-Output $final',
    ].join('; ')
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'failed to create Windows shortcut')
    return result.stdout.trim()
  }
  throw new Error('desktop shortcut is unsupported on this platform')
}

async function setup() {
  const report = await checkEnvironment({ includeProfile: false })
  if (!report.ok) {
    printCheckReport(report, false)
    throw new Error('required e-Mate runtime and plugin closure is incomplete; setup made no changes')
  }
  const current = await managedStatus()
  if (current.healthy && current.health.active_runs > 0) {
    throw new Error(`setup refused: ${current.health.active_runs} active run(s)`)
  }
  if (current.running) await stopManaged()
  const paths = installProfile()
  const migration = await migrateWithHarnessPersistence(paths.dshHome)
  const scheduleMigration = migrateLegacySchedules({ dshHome: paths.dshHome })
  const shortcut = installShortcut()
  atomicWrite(paths.receipt, `${JSON.stringify({
    product: PRODUCT,
    version: VERSION,
    profile: PROFILE,
    shortcut,
    legacy_migration: migration,
    legacy_schedule_migration: scheduleMigration,
    installed_at: new Date().toISOString(),
  }, null, 2)}\n`, 0o600)
  const verified = await checkEnvironment()
  if (!verified.ok) throw new Error('post-setup environment check failed')
  console.log(`e-Mate ${VERSION} setup complete.`)
  console.log(`Shortcut: ${shortcut}`)
  return 0
}

async function migrateWithHarnessPersistence(dshHome) {
  const harness = resolveHarness()
  const [{ Context }, { default: SessionStore }, { default: JsonlSessionPersistence }] = await Promise.all([
    import(pathToFileURL(resolveHarnessModule(harness, 'vendor/cordis', '@deepseek-ai/cordis')).href),
    import(pathToFileURL(resolveHarnessModule(harness, 'packages/core/session', '@deepseek-ai/dsh-session')).href),
    import(pathToFileURL(resolveHarnessModule(harness, 'packages/session/session-persistence-jsonl', '@deepseek-ai/dsh-session-persistence-jsonl')).href),
  ])
  const ctx = new Context()
  let sessionsFiber
  let persistenceFiber
  try {
    sessionsFiber = await ctx.plugin(SessionStore)
    persistenceFiber = await ctx.plugin(JsonlSessionPersistence, { root: join(dshHome, 'sessions') })
    return await migrateLegacySessions({ sessionPersistence: ctx.sessionPersistence, dshHome })
  } finally {
    await persistenceFiber?.dispose()
    await sessionsFiber?.dispose()
  }
}

async function forwardProfile(args) {
  if (args[0] !== '--profile' || args[1] !== PROFILE) {
    throw new Error('e-mate only boots the managed e-mate profile')
  }
  const paths = managedPaths()
  if (!profileCheck(paths).ok) throw new Error('managed profile unavailable; run e-mate setup')
  const harness = resolveHarness()
  return runChild(process.execPath, [harness.bin, ...args], {
    env: { ...process.env, DSH_HOME: paths.dshHome },
  })
}

function help() {
  console.log(`e-Mate ${VERSION}

Usage:
  e-mate setup [--check] [--json]
  e-mate web [--port <port>]
  e-mate launch [--port <port>]
  e-mate update [--version <version>] [--json]
  e-mate status
  e-mate stop
  e-mate --profile e-mate --dump-config
  e-mate --version`)
}

export async function main(args) {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    help()
    return 0
  }
  if (args[0] === '--version' || args[0] === '-V') {
    console.log(VERSION)
    return 0
  }
  if (args[0] === '--profile') return forwardProfile(args)
  if (args[0] === 'web') return runWeb(args.slice(1))
  if (args[0] === 'launch') {
    const status = await launchManaged(args.slice(1))
    console.log(`${status.url} (PID ${status.pid}, instance ${status.instance_id})`)
    return 0
  }
  if (args[0] === 'update') {
    let target
    let json = false
    for (let index = 1; index < args.length; index += 1) {
      if (args[index] === '--json') {
        json = true
      } else if (args[index] === '--version' && args[index + 1] !== undefined) {
        if (target !== undefined) throw new Error('--version may be specified only once')
        target = args[index + 1]
        index += 1
      } else {
        throw new Error(`unknown update option ${JSON.stringify(args[index])}`)
      }
    }
    const normalized = normalizeUpdateTarget(target)
    const status = await managedStatus()
    if (status.running && !status.healthy) throw new Error('managed instance is unhealthy; update made no changes')
    if (status.health?.active_runs > 0) {
      throw new Error(`online update refused: ${String(status.health.active_runs)} active run(s)`)
    }
    const scheduled = scheduleOnlineUpdate({
      target: normalized,
      dshHome: resolveDshHome(),
      binPath,
      currentVersion: VERSION,
    })
    console.log(json ? JSON.stringify(scheduled) : `e-Mate update ${scheduled.request_id} scheduled (${scheduled.target}).`)
    return 0
  }
  if (args[0] === '__update-helper') {
    if (args.length !== 2) throw new Error('invalid internal update invocation')
    await runOnlineUpdateHelper({ requestId: args[1], dshHome: resolveDshHome(), binPath })
    return 0
  }
  if (args[0] === 'status') {
    if (args.length !== 1) throw new Error('status takes no arguments')
    const status = await managedStatus()
    console.log(JSON.stringify(status, null, 2))
    return status.healthy ? 0 : 1
  }
  if (args[0] === 'stop') {
    if (args.length !== 1) throw new Error('stop takes no arguments')
    console.log(JSON.stringify(await stopManaged(), null, 2))
    return 0
  }
  if (args[0] === 'setup') {
    const options = new Set(args.slice(1))
    for (const option of options) {
      if (option !== '--check' && option !== '--json') throw new Error(`unknown setup option ${JSON.stringify(option)}`)
    }
    if (options.has('--json') && !options.has('--check')) throw new Error('--json requires --check')
    if (options.has('--check')) {
      const report = await checkEnvironment({ includeProfile: process.env.EMATE_STAGING_CHECK !== '1' })
      printCheckReport(report, options.has('--json'))
      return report.ok ? 0 : 1
    }
    return setup()
  }
  throw new Error(`unknown command ${JSON.stringify(args[0])}; run e-mate --help`)
}
