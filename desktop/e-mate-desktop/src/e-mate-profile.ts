import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unpackedAsarPath } from './packaged-runtime-path.ts'

export const EMATE_PROFILE_NAME = 'e-mate'

const desktopManifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version?: unknown }
export const EMATE_DESKTOP_PROFILE_VERSION = desktopManifest.version
if (typeof EMATE_DESKTOP_PROFILE_VERSION !== 'string'
  || !/^\d+\.\d+\.\d+$/u.test(EMATE_DESKTOP_PROFILE_VERSION)) {
  throw new Error('e-Mate desktop package version must be a stable semantic version')
}
const HARNESS_COMMIT = 'df78045a127e32cb5b942defba52c539590d1596'
const sourceRoot = unpackedAsarPath(
  fileURLToPath(new URL('../build/e-mate-profile/', import.meta.url)),
)
interface ComponentInventoryEntry {
  readonly id: string
  readonly root: string
  readonly kind: 'profile' | 'platform-profile'
  readonly desktop: 'hot-profile' | 'platform-profile' | 'blocked'
  readonly cli: boolean
}
const componentInventory = JSON.parse(
  readFileSync(join(sourceRoot, 'component-inventory.json'), 'utf8'),
) as { schema_version?: unknown; components?: unknown }
if (componentInventory.schema_version !== 1 || !Array.isArray(componentInventory.components)
  || componentInventory.components.some(entry => entry === null || typeof entry !== 'object'
    || typeof (entry as ComponentInventoryEntry).id !== 'string'
    || !['hot-profile', 'platform-profile', 'blocked'].includes((entry as ComponentInventoryEntry).desktop))) {
  throw new Error('e-Mate component inventory is invalid')
}
const desktopComponents = componentInventory.components as ComponentInventoryEntry[]
const PLUGIN_PACKAGES = desktopComponents
  .filter(component => component.desktop !== 'blocked' && component.id.startsWith('@e-mate/dsh-plugin-'))
  .map(component => component.id)

/** Components whose complete closure can currently move independently of the Base. */
export const EMATE_UPDATEABLE_PROFILE_COMPONENT_IDS = [
  ...desktopComponents
    .filter(component => component.desktop !== 'blocked')
    .map(component => component.id),
] as readonly string[]

/** Verified content-addressed component roots selected for one Desktop boot. */
export interface EmateProfileGeneration {
  readonly id: string
  readonly componentDirectories: ReadonlyMap<string, string>
}

const ECOSYSTEM_PLUGIN_PACKAGES = [
  { name: '@kelearns/dsh-navigation-bar', version: '0.2.1', entry: 'index.js', client: true, patchName: "'@kelearns/dsh-navigation-bar'" },
  { name: '@omdsh-dev/dsh-genui', version: '0.8.3', entry: 'lib/index.js', client: true, patchName: "'@omdsh-dev/dsh-genui'" },
  { name: 'dsh-at-file', version: '0.6.2', entry: 'lib/index.js', client: true, patchName: 'dsh-at-file' },
  { name: 'dsh-better-sidebar', version: '0.12.2', entry: 'lib/index.js', client: true, patchName: "'dsh-better-sidebar'" },
  { name: 'dsh-file-viewer', version: '0.1.0', entry: 'lib/index.js', client: true, patchName: "'dsh-file-viewer'" },
  { name: 'dsh-turn-fold', version: '0.2.2', entry: 'index.js', client: true, patchName: 'dsh-turn-fold' },
  { name: 'dsh-visualize', version: '0.1.0', entry: 'lib/index.mjs', client: true, patchName: "'dsh-visualize'" },
] as const

const PROFILE_PLUGIN_PACKAGES = [
  ...PLUGIN_PACKAGES,
  ...ECOSYSTEM_PLUGIN_PACKAGES.map(plugin => plugin.name),
]
const MANAGED_PROFILE_PACKAGES = new Set<string>(PROFILE_PLUGIN_PACKAGES)
const RETIRED_PROFILE_PACKAGES = new Set([
  '@e-mate/dsh-plugin-browser',
  '@e-mate/dsh-plugin-browser-panel',
  '@e-mate/dsh-plugin-im',
  '@e-mate/dsh-plugin-subagent',
  '@yuxianglin/dsh-bridge-browser',
  'dsh-search-mcp',
])
const OWNED_PROFILE_PACKAGES = new Set([...MANAGED_PROFILE_PACKAGES, ...RETIRED_PROFILE_PACKAGES])
const PROFILE_INSTALL_RECEIPT = '.e-mate-install.json'
const COMPONENT_STORE_METADATA = new Set(['.e-mate-component.json', '.e-mate-component-manifest.json'])

const DEFAULT_SETTINGS = 'ui-theme:\n  preference: dark\nagent-default-model:\n  provider: e-mate-enterprise\n  model: gpt-5.6-luna\n  reasoningEffort: max\n'
const DEFAULT_MODEL_SETTINGS = 'agent-default-model:\n  provider: e-mate-enterprise\n  model: gpt-5.6-luna\n  reasoningEffort: max\n'

function atomicWrite(path: string, content: string | NodeJS.ArrayBufferView, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, content, { mode })
    renameSync(temporary, path)
    chmodSync(path, mode)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function sha256Bytes(bytes: string | NodeJS.ArrayBufferView): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function bundledComponentSource(id: string): string {
  return id === '@e-mate/dsh-client-shell'
    ? join(sourceRoot, 'plugins', 'emate-shell')
    : join(sourceRoot, 'bundles', id.slice('@e-mate/dsh-plugin-'.length))
}

function componentSource(id: string, generation?: EmateProfileGeneration): string {
  return generation?.componentDirectories.get(id) ?? bundledComponentSource(id)
}

function packageVersion(source: string, expectedName: string): string {
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
    name?: unknown
    version?: unknown
  }
  if (manifest.name !== expectedName || typeof manifest.version !== 'string'
    || !/^\d+\.\d+\.\d+$/u.test(manifest.version)) {
    throw new Error(`${expectedName} component package identity is invalid`)
  }
  return manifest.version
}

function validateGeneration(generation?: EmateProfileGeneration): void {
  if (generation === undefined) return
  if (!/^[0-9a-f]{64}$/u.test(generation.id)
    || generation.componentDirectories.size !== EMATE_UPDATEABLE_PROFILE_COMPONENT_IDS.length
    || EMATE_UPDATEABLE_PROFILE_COMPONENT_IDS.some(id => !generation.componentDirectories.has(id))) {
    throw new Error('e-Mate Profile generation component set is invalid')
  }
}

function packageEntry(name: string): string {
  return createRequire(import.meta.url).resolve(name)
}

function dependencyEntry(packageManifest: string, name: string): string {
  return createRequire(packageManifest).resolve(name)
}

function emptyPatch(patch: string): boolean {
  return patch.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
    .join('\n') === '[]'
}

function samePath(left: string, right: string): boolean {
  const normalized = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path
  return normalized(realpathSync(left)) === normalized(realpathSync(right))
}

/** Keep package metadata patchable while loading large immutable directories from the app bundle. */
function installManagedPackage(
  source: string,
  target: string,
  deferCleanup?: (path: string) => void,
): void {
  const previous = `${target}.e-mate-stale-${process.pid}-${randomUUID()}`
  let movedPrevious = false
  try {
    if (existsSync(target)) {
      renameSync(target, previous)
      movedPrevious = true
    }
    mkdirSync(target, { recursive: true })
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (COMPONENT_STORE_METADATA.has(entry.name)) continue
      const from = join(source, entry.name)
      const to = join(target, entry.name)
      if (statSync(from).isDirectory()) {
        symlinkSync(resolve(from), to, process.platform === 'win32' ? 'junction' : 'dir')
      } else {
        cpSync(from, to, { force: true })
      }
    }
    if (movedPrevious) {
      if (deferCleanup === undefined) rmSync(previous, { recursive: true, force: true })
      else deferCleanup(previous)
    }
  } catch (cause) {
    rmSync(target, { recursive: true, force: true })
    if (movedPrevious && !existsSync(target)) renameSync(previous, target)
    throw cause
  }
}

function managedPackageCurrent(
  source: string,
  target: string,
  overrides: ReadonlyMap<string, string> = new Map(),
): boolean {
  try {
    return readdirSync(source, { withFileTypes: true })
      .filter(entry => !COMPONENT_STORE_METADATA.has(entry.name))
      .every(entry => {
      const from = join(source, entry.name)
      const to = join(target, entry.name)
      const sourceMetadata = statSync(from)
      const targetMetadata = lstatSync(to)
      return sourceMetadata.isDirectory()
        ? targetMetadata.isSymbolicLink() && samePath(from, to)
        : targetMetadata.isFile() && !targetMetadata.isSymbolicLink()
          && (overrides.has(entry.name)
            ? sha256Bytes(overrides.get(entry.name)!) === sha256(to)
            : sourceMetadata.size === targetMetadata.size && sha256(from) === sha256(to))
      })
  } catch {
    return false
  }
}

interface ManagedBundleManifest {
  readonly main: string
  readonly dsh: { readonly bundle: { readonly patch: string }; readonly client?: { readonly platform?: string } }
}

function adaptedPluginPatch(source: string, name: string): ReadonlyMap<string, string> {
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as ManagedBundleManifest
  if (manifest.dsh.client?.platform === 'web') return new Map()
  const patchName = manifest.dsh.bundle.patch.replace(/^\.\//u, '')
  let patch = readFileSync(join(source, patchName), 'utf8')
  if (emptyPatch(patch)) return new Map()
  const marker = `name: '${name}'`
  if (patch.split(marker).length !== 2) throw new Error(`${name} bundle entry is not uniquely localizable`)
  patch = patch.replace(marker, `name: './node_modules/${name}/${manifest.main}'`)
  return new Map([[patchName, patch]])
}

function adaptedEcosystemPatch(
  source: string,
  expected: (typeof ECOSYSTEM_PLUGIN_PACKAGES)[number],
): ReadonlyMap<string, string> {
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
    dsh?: { bundle?: { patch?: string } }
  }
  const declaredPatch = manifest.dsh?.bundle?.patch
  if (typeof declaredPatch !== 'string') throw new Error(`${expected.name} has no bundle patch`)
  const patchName = declaredPatch.replace(/^\.\//u, '')
  const marker = `name: ${expected.patchName}`
  const patch = readFileSync(join(source, patchName), 'utf8')
  if (patch.split(marker).length !== 2) {
    throw new Error(`${expected.name} bundle entry is not uniquely localizable`)
  }
  return new Map([[
    patchName,
    patch.replace(marker, `name: './node_modules/${expected.name}/${expected.entry}'`),
  ]])
}

function installedProfileCurrent(
  profile: string,
  dshHome: string,
  generation?: EmateProfileGeneration,
): boolean {
  try {
    const receipt = JSON.parse(readFileSync(join(profile, PROFILE_INSTALL_RECEIPT), 'utf8')) as Record<string, unknown>
    if (receipt.schema_version !== 1
      || receipt.version !== EMATE_DESKTOP_PROFILE_VERSION
      || receipt.harness_commit !== HARNESS_COMMIT
      || receipt.dsh_home !== resolve(dshHome)
      || receipt.source_root !== resolve(sourceRoot)
      || receipt.profile_generation !== (generation?.id ?? 'bundled')) return false

    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
      dsh?: { profile?: { bundles?: unknown[] } }
    }
    const dependencies = manifest.dependencies ?? {}
    for (const name of PLUGIN_PACKAGES) {
      if (dependencies[name] !== packageVersion(componentSource(name, generation), name)) return false
    }
    for (const plugin of ECOSYSTEM_PLUGIN_PACKAGES) {
      if (dependencies[plugin.name] !== plugin.version) return false
    }
    for (const name of RETIRED_PROFILE_PACKAGES) {
      if (dependencies[name] !== undefined) return false
    }
    const bundles = manifest.dsh?.profile?.bundles
    const managedBundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...PROFILE_PLUGIN_PACKAGES]
    if (!Array.isArray(bundles)
      || managedBundles.some((name, index) => bundles[index] !== name)
      || [...RETIRED_PROFILE_PACKAGES].some(name => bundles.includes(name))) return false

    if (!managedPackageCurrent(
      componentSource('@e-mate/dsh-client-shell', generation),
      join(profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar'),
    )) return false
    for (const name of PLUGIN_PACKAGES) {
      const source = componentSource(name, generation)
      if (!managedPackageCurrent(
        source,
        join(profile, 'node_modules', ...name.split('/')),
        adaptedPluginPatch(source, name),
      )) return false
    }
    for (const plugin of ECOSYSTEM_PLUGIN_PACKAGES) {
      const source = join(sourceRoot, 'ecosystem', plugin.name)
      if (!managedPackageCurrent(
        source,
        join(profile, 'node_modules', plugin.name),
        adaptedEcosystemPatch(source, plugin),
      )) return false
    }

    return [
      join(profile, 'cordis.patch.yml'),
      join(profile, 'cordis.yml'),
      join(profile, 'plugins', 'runtime-binding.json'),
      join(profile, 'plugins', 'health.js'),
      join(profile, 'plugins', 'model-policy.js'),
      join(profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar', 'package.json'),
      ...PLUGIN_PACKAGES.map(name => join(profile, 'node_modules', ...name.split('/'), 'package.json')),
      ...ECOSYSTEM_PLUGIN_PACKAGES.map(plugin => join(profile, 'node_modules', plugin.name, 'package.json')),
    ].every(existsSync)
  } catch {
    return false
  }
}

/** Install or repair only the e-Mate-owned profile files before Desktop boot. */
export function installEmateDesktopProfile(
  dshHome: string,
  deferCleanup?: (path: string) => void,
  generation?: EmateProfileGeneration,
): string {
  validateGeneration(generation)
  const profile = join(dshHome, 'profiles', EMATE_PROFILE_NAME)
  const data = join(dshHome, 'e-mate')
  for (const directory of [
    profile,
    join(data, 'attachments'),
    join(data, 'general'),
    join(data, 'memory'),
    join(data, 'cache'),
    join(data, 'migrations'),
    join(data, 'run'),
    join(data, 'logs'),
  ]) mkdirSync(directory, { recursive: true })

  const settings = join(dshHome, 'settings.yaml')
  if (!existsSync(settings)) {
    atomicWrite(settings, DEFAULT_SETTINGS, 0o600)
  } else {
    const current = readFileSync(settings, 'utf8')
    if (!/^agent-default-model\s*:/mu.test(current)) {
      atomicWrite(settings, `${current}${current.endsWith('\n') ? '' : '\n'}${DEFAULT_MODEL_SETTINGS}`, 0o600)
    }
  }
  if (installedProfileCurrent(profile, dshHome, generation)) return profile

  rmSync(join(profile, PROFILE_INSTALL_RECEIPT), { force: true })
  cpSync(join(sourceRoot, 'plugins'), join(profile, 'plugins'), { recursive: true, force: true })
  atomicWrite(
    join(profile, 'cordis.patch.yml'),
    `${readFileSync(join(sourceRoot, 'cordis.patch.yml'), 'utf8').trimEnd()}\n\n- id: dsh-file-viewer\n  config:\n    allowAbsolutePaths: false\n`,
  )
  atomicWrite(join(profile, 'cordis.yml'), '[]\n')
  rmSync(join(dshHome, 'browser-extension'), { recursive: true, force: true })
  let previous: {
    dependencies?: Record<string, unknown>
    dsh?: { profile?: { bundles?: unknown[] } }
  } = {}
  try { previous = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) } catch {}
  const externalDependencies = Object.entries(previous.dependencies ?? {})
    .filter(([name, version]) => !OWNED_PROFILE_PACKAGES.has(name) && typeof version === 'string')
  const externalBundles = (Array.isArray(previous.dsh?.profile?.bundles) ? previous.dsh.profile.bundles : [])
    .filter((name): name is string => typeof name === 'string' && !OWNED_PROFILE_PACKAGES.has(name)
      && name !== '@deepseek-ai/dsh-base' && name !== '@deepseek-ai/dsh-web-app')
  atomicWrite(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-e-mate',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries([
      ...PLUGIN_PACKAGES.map(name => [name, packageVersion(componentSource(name, generation), name)]),
      ...ECOSYSTEM_PLUGIN_PACKAGES.map(plugin => [plugin.name, plugin.version]),
      ...externalDependencies,
    ]),
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...PROFILE_PLUGIN_PACKAGES, ...externalBundles],
      },
    },
  }, null, 2)}\n`)

  const shellSource = componentSource('@e-mate/dsh-client-shell', generation)
  const shellTarget = join(profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar')
  mkdirSync(dirname(shellTarget), { recursive: true })
  installManagedPackage(shellSource, shellTarget, deferCleanup)

  for (const name of PLUGIN_PACKAGES) {
    const source = componentSource(name, generation)
    const target = join(profile, 'node_modules', ...name.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    installManagedPackage(source, target, deferCleanup)
    for (const [patchName, patch] of adaptedPluginPatch(source, name)) {
      atomicWrite(join(target, patchName), patch)
    }
  }

  for (const expected of ECOSYSTEM_PLUGIN_PACKAGES) {
    const sourceManifest = join(sourceRoot, 'ecosystem', expected.name, 'package.json')
    const source = dirname(sourceManifest)
    const target = join(profile, 'node_modules', expected.name)
    const manifest = JSON.parse(readFileSync(sourceManifest, 'utf8')) as {
      name?: string
      version?: string
      license?: string
      main?: string
      exports?: Record<string, unknown>
      dsh?: { bundle?: { patch?: string }; client?: { platform?: string } }
    }
    const rootExport = manifest.exports?.['.']
    const rootEntry = typeof rootExport === 'string'
      ? rootExport
      : rootExport && typeof rootExport === 'object'
        ? (rootExport as { default?: unknown }).default
        : undefined
    if (manifest.name !== expected.name || manifest.version !== expected.version
      || manifest.license !== 'MIT'
      || (expected.client
        ? manifest.dsh?.client?.platform !== 'web'
        : manifest.dsh?.client !== undefined)
      || (manifest.main !== expected.entry && rootEntry !== `./${expected.entry}`)
      || (expected.client && manifest.exports?.['./client'] === undefined)
      || typeof manifest.dsh?.bundle?.patch !== 'string') {
      throw new Error(`${expected.name} package contract does not match the pinned e-Mate desktop profile`)
    }
    installManagedPackage(source, target, deferCleanup)
    for (const [patchName, patch] of adaptedEcosystemPatch(source, expected)) {
      atomicWrite(join(target, patchName), patch)
    }
  }

  const tools = packageEntry('@deepseek-ai/dsh-tools')
  const storage = packageEntry('@deepseek-ai/dsh-storage-domain')
  const llm = packageEntry('@deepseek-ai/dsh-llm')
  const schedule = packageEntry('@deepseek-ai/dsh-schedule')
  const credentials = packageEntry('@deepseek-ai/dsh-credentials')
  const environment = packageEntry('@deepseek-ai/dsh-launch-environment')
  const storageManifest = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-storage-domain/package.json')
  const zod = dependencyEntry(storageManifest, 'zod')
  atomicWrite(join(profile, 'plugins', 'runtime-binding.json'), `${JSON.stringify({
    schema_version: 1,
    product: 'e-Mate',
    version: EMATE_DESKTOP_PROFILE_VERSION,
    dsh_home: resolve(dshHome),
    harness_commit: HARNESS_COMMIT,
    tools_module: tools,
    tools_module_sha256: sha256(tools),
    storage_domain_module: storage,
    storage_domain_module_sha256: sha256(storage),
    llm_module: llm,
    llm_module_sha256: sha256(llm),
    schedule_module: schedule,
    schedule_module_sha256: sha256(schedule),
    credentials_module: credentials,
    credentials_module_sha256: sha256(credentials),
    launch_environment_module: environment,
    launch_environment_module_sha256: sha256(environment),
    zod_module: zod,
    zod_module_sha256: sha256(zod),
  }, null, 2)}\n`, 0o600)

  const registry = JSON.parse(readFileSync(join(sourceRoot, 'bundles', 'registry.json'), 'utf8')) as {
    product?: string
    version?: string
    harness_commit?: string
    packages?: unknown[]
  }
  if (registry.product !== 'e-Mate' || registry.version !== EMATE_DESKTOP_PROFILE_VERSION
    || registry.harness_commit !== HARNESS_COMMIT
    || !Array.isArray(registry.packages)
    || PLUGIN_PACKAGES.some(name => !registry.packages!.some(candidate => (
      candidate !== null && typeof candidate === 'object'
      && (candidate as { name?: unknown }).name === name
    )))) {
    throw new Error('e-Mate desktop profile bundle registry is invalid')
  }
  const generatedPlugins = readdirSync(join(profile, 'plugins'))
  if (!generatedPlugins.includes('health.js') || !generatedPlugins.includes('model-policy.js')) {
    throw new Error('e-Mate desktop profile plugins are incomplete')
  }
  atomicWrite(join(profile, PROFILE_INSTALL_RECEIPT), `${JSON.stringify({
    schema_version: 1,
    version: EMATE_DESKTOP_PROFILE_VERSION,
    harness_commit: HARNESS_COMMIT,
    dsh_home: resolve(dshHome),
    source_root: resolve(sourceRoot),
    profile_generation: generation?.id ?? 'bundled',
  }, null, 2)}\n`, 0o600)
  return profile
}
