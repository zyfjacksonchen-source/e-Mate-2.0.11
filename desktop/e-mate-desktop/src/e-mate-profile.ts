import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unpackedAsarPath } from './packaged-runtime-path.ts'

export const EMATE_PROFILE_NAME = 'e-mate'

const VERSION = '2.0.8'
const HARNESS_COMMIT = '47f943859bef60e4160492346772ded9b24f765a'
const PLUGIN_PACKAGES = [
  '@e-mate/dsh-plugin-browser-panel',
  '@e-mate/dsh-plugin-file-import',
  '@e-mate/dsh-plugin-im',
  '@e-mate/dsh-plugin-memory-evolve',
  '@e-mate/dsh-plugin-office-skills',
] as const

const ECOSYSTEM_PLUGIN_PACKAGES = [
  { name: '@omdsh-dev/dsh-genui', version: '0.8.3', entry: 'lib/index.js', client: true, patchName: "'@omdsh-dev/dsh-genui'" },
  { name: '@yuxianglin/dsh-bridge-browser', version: '0.0.1', entry: 'lib/index.js', client: false, patchName: "'@yuxianglin/dsh-bridge-browser'" },
  { name: 'dsh-at-file', version: '0.6.2', entry: 'lib/index.js', client: true, patchName: 'dsh-at-file' },
  { name: 'dsh-better-sidebar', version: '0.12.2', entry: 'lib/index.js', client: true, patchName: "'dsh-better-sidebar'" },
  { name: 'dsh-file-viewer', version: '0.1.0', entry: 'lib/index.js', client: true, patchName: "'dsh-file-viewer'" },
  { name: 'dsh-search-mcp', version: '0.1.0', entry: 'lib/index.js', client: true, patchName: "'dsh-search-mcp'" },
  { name: 'dsh-turn-fold', version: '0.2.2', entry: 'index.js', client: true, patchName: 'dsh-turn-fold' },
  { name: 'dsh-visualize', version: '0.1.0', entry: 'lib/index.mjs', client: true, patchName: "'dsh-visualize'" },
] as const

const PROFILE_PLUGIN_PACKAGES = [
  ...PLUGIN_PACKAGES,
  ...ECOSYSTEM_PLUGIN_PACKAGES.map(plugin => plugin.name),
]

const sourceRoot = unpackedAsarPath(
  fileURLToPath(new URL('../build/e-mate-profile/', import.meta.url)),
)

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

function installBrowserExtension(dshHome: string): void {
  const source = join(sourceRoot, 'browser-extension')
  const target = join(dshHome, 'browser-extension')
  const staged = join(dshHome, `.browser-extension.${randomUUID()}.tmp`)
  const previous = join(dshHome, `.browser-extension.${randomUUID()}.previous`)
  let movedPrevious = false
  try {
    cpSync(source, staged, { recursive: true, force: true })
    if (existsSync(target)) {
      renameSync(target, previous)
      movedPrevious = true
    }
    renameSync(staged, target)
    if (movedPrevious) rmSync(previous, { recursive: true, force: true })
  } catch (cause) {
    rmSync(staged, { recursive: true, force: true })
    if (movedPrevious && !existsSync(target)) renameSync(previous, target)
    throw cause
  }
}

/** Install or repair only the e-Mate-owned profile files before Desktop boot. */
export function installEmateDesktopProfile(dshHome: string): string {
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

  cpSync(join(sourceRoot, 'plugins'), join(profile, 'plugins'), { recursive: true, force: true })
  atomicWrite(
    join(profile, 'cordis.patch.yml'),
    `${readFileSync(join(sourceRoot, 'cordis.patch.yml'), 'utf8').trimEnd()}\n\n- id: dsh-file-viewer\n  config:\n    allowAbsolutePaths: false\n`,
  )
  atomicWrite(join(profile, 'cordis.yml'), '[]\n')
  installBrowserExtension(dshHome)
  atomicWrite(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-e-mate',
    private: true,
    type: 'module',
    dependencies: Object.fromEntries([
      ...PLUGIN_PACKAGES.map(name => [name, VERSION]),
      ...ECOSYSTEM_PLUGIN_PACKAGES.map(plugin => [plugin.name, plugin.version]),
    ]),
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...PROFILE_PLUGIN_PACKAGES],
      },
    },
  }, null, 2)}\n`)

  const shellSource = join(sourceRoot, 'plugins', 'emate-shell')
  const shellTarget = join(profile, 'node_modules', '@deepseek-ai', 'dsh-client-ui-sidebar')
  rmSync(shellTarget, { recursive: true, force: true })
  mkdirSync(dirname(shellTarget), { recursive: true })
  cpSync(shellSource, shellTarget, { recursive: true, force: true })

  for (const name of PLUGIN_PACKAGES) {
    const slug = name.slice('@e-mate/dsh-plugin-'.length)
    const source = join(sourceRoot, 'bundles', slug)
    const target = join(profile, 'node_modules', ...name.split('/'))
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true, force: true })
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
      main: string
      dsh: { bundle: { patch: string }; client?: { platform?: string } }
    }
    if (manifest.dsh.client?.platform === 'web') continue
    const patchPath = join(target, manifest.dsh.bundle.patch)
    const patch = readFileSync(patchPath, 'utf8')
    if (emptyPatch(patch)) continue
    const marker = `name: '${name}'`
    if (patch.split(marker).length !== 2) {
      throw new Error(`${name} bundle entry is not uniquely localizable`)
    }
    atomicWrite(patchPath, patch.replace(marker, `name: './node_modules/${name}/${manifest.main}'`))
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
    rmSync(target, { recursive: true, force: true })
    cpSync(source, target, { recursive: true, force: true })
    const patchPath = join(target, manifest.dsh!.bundle!.patch!)
    let patch = readFileSync(patchPath, 'utf8')
    const marker = `name: ${expected.patchName}`
    if (patch.split(marker).length !== 2) {
      throw new Error(`${expected.name} bundle entry is not uniquely localizable`)
    }
    atomicWrite(patchPath, patch.replace(
      marker,
      `name: './node_modules/${expected.name}/${expected.entry}'`,
    ))
  }

  const tools = packageEntry('@deepseek-ai/dsh-tools')
  const storage = packageEntry('@deepseek-ai/dsh-storage-domain')
  const llm = packageEntry('@deepseek-ai/dsh-llm')
  const credentials = packageEntry('@deepseek-ai/dsh-credentials')
  const environment = packageEntry('@deepseek-ai/dsh-launch-environment')
  const storageManifest = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-storage-domain/package.json')
  const zod = dependencyEntry(storageManifest, 'zod')
  atomicWrite(join(profile, 'plugins', 'runtime-binding.json'), `${JSON.stringify({
    schema_version: 1,
    product: 'e-Mate',
    version: VERSION,
    dsh_home: resolve(dshHome),
    harness_commit: HARNESS_COMMIT,
    tools_module: tools,
    tools_module_sha256: sha256(tools),
    storage_domain_module: storage,
    storage_domain_module_sha256: sha256(storage),
    llm_module: llm,
    llm_module_sha256: sha256(llm),
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
  if (registry.product !== 'e-Mate' || registry.version !== VERSION
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
  return profile
}
