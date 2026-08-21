import { createHash } from 'node:crypto'
import { lstat, readFile, rm } from 'node:fs/promises'
import { copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const BUNDLED_CONNECTOR_FILES = ['SKILL.md', 'agents/openai.yaml']
export const BUNDLED_CONNECTOR_SKILLS = [
  'connect-feishu-cli',
  'connect-tencent-docs',
  'connect-dingtalk',
  'connect-wechat-bot',
]

export function validateManagedSkillName(value) {
  if (typeof value !== 'string' || value.length > 128 || !SKILL_NAME.test(value)) {
    throw new Error(`${String(value)} is not a valid managed skill name`)
  }
  return value
}

export function resolvePersistentSkillScope(config, source, requestedScope) {
  const allowed = config.persistentSkillSources ?? []
  if (allowed.length === 0) return requestedScope ?? config.installDefaultScope ?? 'temp'
  if (!allowed.includes(source)) throw new Error('Skill source is not an approved external-connection source')
  return 'global'
}

/** Promote legacy connector Skills from session-temporary storage before provider registration. */
export function promotePersistentSkills(config, roots) {
  const allowed = new Set(config.persistentSkillSources ?? [])
  if (allowed.size === 0) return []
  const promoted = []
  let entries
  try {
    entries = readdirSync(roots.tempSkillDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const name = validateManagedSkillName(entry.name)
      const source = join(roots.tempSkillDir, name)
      const target = join(roots.globalSkillDir, name)
      const skill = lstatSync(join(source, 'SKILL.md'))
      const receipt = lstatSync(join(source, '.dsh-find-skill.json'))
      const metadata = JSON.parse(readFileSync(join(source, '.dsh-find-skill.json'), 'utf8'))
      if (!skill.isFile() || skill.isSymbolicLink() || !receipt.isFile() || receipt.isSymbolicLink()
        || metadata?.scope !== 'temp' || !allowed.has(metadata.source)) continue
      try {
        lstatSync(target)
        continue
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      mkdirSync(roots.globalSkillDir, { recursive: true })
      renameSync(source, target)
      try {
        writeFileSync(join(target, '.dsh-find-skill.json'), JSON.stringify({ ...metadata, scope: 'global' }, null, 2), 'utf8')
      } catch (error) {
        renameSync(target, source)
        throw error
      }
      promoted.push(name)
    } catch {
      // Invalid or conflicting legacy entries remain untouched for explicit user cleanup.
    }
  }
  return promoted.sort()
}

function directoryState(path, owned = false) {
  try {
    const entry = lstatSync(path)
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      if (owned) throw new Error(`${path} is not a regular managed directory`)
      return 'conflict'
    }
    return 'directory'
  } catch (error) {
    if (error?.code === 'ENOENT') return 'missing'
    throw error
  }
}

function removeOwnedDirectory(path) {
  const state = directoryState(path, true)
  if (state === 'directory') rmSync(path, { recursive: true })
}

function skillDigest(root, name) {
  const hash = createHash('sha256')
  for (const relativePath of BUNDLED_CONNECTOR_FILES) {
    const path = join(root, name, ...relativePath.split('/'))
    const entry = lstatSync(path)
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`${path} is not a regular bundled file`)
    hash.update(relativePath)
    hash.update('\0')
    hash.update(readFileSync(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function existingSkillDigest(root, name) {
  try {
    return skillDigest(root, name)
  } catch {
    return undefined
  }
}

function readManagedMetadata(target) {
  try {
    const path = join(target, '.dsh-find-skill.json')
    const entry = lstatSync(path)
    if (!entry.isFile() || entry.isSymbolicLink()) return undefined
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

function acceptedBundledSource(name, source, currentSource) {
  return source === `e-mate-bundled:${name}`
    || source === currentSource
    || source === `https://github.com/zyfjacksonchen-source/e-Mate/tree/skills-v2.0.9/skills/${name}`
    || source === `https://github.com/zyfjacksonchen-source/e-Mate/tree/skills-v2.0.9-r2/skills/${name}`
}

function stageBundledSkill(bundledRoot, staging, name, digest) {
  mkdirSync(join(staging, 'agents'), { recursive: true })
  for (const relativePath of BUNDLED_CONNECTOR_FILES) {
    copyFileSync(
      join(bundledRoot, name, ...relativePath.split('/')),
      join(staging, ...relativePath.split('/')),
    )
  }
  writeFileSync(join(staging, '.dsh-find-skill.json'), JSON.stringify({
    source: `e-mate-bundled:${name}`,
    skill: name,
    installedAt: Date.now(),
    scope: 'global',
    bundleDigest: digest,
    bundleVersion: 1,
  }, null, 2), 'utf8')
}

function recoverBundledSwap(target, staging, backup) {
  const targetState = directoryState(target)
  const backupState = directoryState(backup, true)
  if (targetState === 'missing' && backupState === 'directory') renameSync(backup, target)
  else if (targetState === 'directory' && backupState === 'directory') removeOwnedDirectory(backup)
  removeOwnedDirectory(staging)
}

/** Reconcile signed first-party connector instructions into the device-global managed root. */
export function reconcileBundledConnectorSkills(
  config,
  roots,
  bundledRoot = fileURLToPath(new URL('./skills/', import.meta.url)),
) {
  mkdirSync(roots.globalSkillDir, { recursive: true })
  const result = { installed: [], updated: [], unchanged: [], conflicts: [] }
  for (const name of BUNDLED_CONNECTOR_SKILLS) {
    const catalog = (config.catalogSkills ?? []).filter(skill => skill.id === name)
    if (catalog.length !== 1) throw new Error(`${name} must have exactly one catalog entry`)
    const digest = skillDigest(bundledRoot, name)
    const target = join(roots.globalSkillDir, name)
    const staging = join(roots.globalSkillDir, `.${name}.e-mate-staging`)
    const backup = join(roots.globalSkillDir, `.${name}.e-mate-backup`)
    recoverBundledSwap(target, staging, backup)

    const state = directoryState(target)
    if (state === 'conflict') {
      result.conflicts.push(name)
      continue
    }
    const metadata = state === 'directory' ? readManagedMetadata(target) : undefined
    if (state === 'directory' && !acceptedBundledSource(name, metadata?.source, catalog[0].source)) {
      result.conflicts.push(name)
      continue
    }
    if (state === 'directory' && metadata?.source === `e-mate-bundled:${name}`
      && metadata.bundleDigest === digest && existingSkillDigest(roots.globalSkillDir, name) === digest) {
      result.unchanged.push(name)
      continue
    }

    stageBundledSkill(bundledRoot, staging, name, digest)
    if (state === 'directory') renameSync(target, backup)
    try {
      renameSync(staging, target)
    } catch (error) {
      if (state === 'directory' && directoryState(target) === 'missing') renameSync(backup, target)
      throw error
    }
    removeOwnedDirectory(backup)
    result[state === 'directory' ? 'updated' : 'installed'].push(name)
  }
  return result
}

function inside(root, target) {
  const path = relative(root, target)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

/** Resolve only a plugin-owned, non-symlinked skill directory with matching provenance. */
export async function inspectManagedSkill(root, name, scope) {
  const safeName = validateManagedSkillName(name)
  const resolvedRoot = resolve(root)
  const target = resolve(resolvedRoot, safeName)
  if (!inside(resolvedRoot, target)) throw new Error('managed skill path escaped its root')

  let directory
  try {
    directory = await lstat(target)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error(`${target} is not a managed skill directory`)
  }
  const skill = await lstat(join(target, 'SKILL.md'))
  if (!skill.isFile() || skill.isSymbolicLink()) throw new Error(`${target} has no regular SKILL.md`)

  let metadata
  try {
    metadata = JSON.parse(await readFile(join(target, '.dsh-find-skill.json'), 'utf8'))
  } catch {
    throw new Error(`${target} has no valid managed provenance`)
  }
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)
    || typeof metadata.source !== 'string' || metadata.source.length === 0
    || !Number.isFinite(metadata.installedAt) || metadata.scope !== scope) {
    throw new Error(`${target} has no valid managed provenance`)
  }
  return target
}

export async function removeManagedSkill(roots, tempManager, scope, name, confirm, notifyChanged) {
  const safeName = validateManagedSkillName(name)
  if (typeof confirm !== 'function') throw new Error('Skill removal requires explicit confirmation')
  const scopes = scope === undefined ? ['temp', 'project', 'global'] : [scope]
  for (const candidate of scopes) {
    if (candidate === 'temp') {
      const entry = tempManager.list().find(item => item.name === safeName)
      if (entry === undefined) continue
      const target = await inspectManagedSkill(roots.tempSkillDir, safeName, candidate)
      if (target === undefined || resolve(entry.dir) !== target) {
        throw new Error(`${safeName} is not a valid managed temp skill`)
      }
      if (!(await confirm({ name: safeName, scope: candidate, path: target }))) {
        throw new Error('Skill removal was cancelled by the user')
      }
      if (!(await tempManager.remove(safeName))) throw new Error(`${safeName} changed before it could be removed`)
      return { removed: true, name: safeName, scope: candidate }
    }
    const root = candidate === 'global' ? roots.globalSkillDir : roots.projectSkillDir
    const target = await inspectManagedSkill(root, safeName, candidate)
    if (target === undefined) continue
    if (!(await confirm({ name: safeName, scope: candidate, path: target }))) {
      throw new Error('Skill removal was cancelled by the user')
    }
    await rm(target, { recursive: true })
    notifyChanged()
    return { removed: true, name: safeName, scope: candidate }
  }
  throw new Error(`${safeName} is not installed in any managed scope`)
}

/** Minimal child environment: no model, enterprise, cloud, or API credentials. */
export function throwawayEnvironment(home, environment = process.env) {
  const names = process.platform === 'win32'
    ? ['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP']
    : ['PATH', 'TMPDIR', 'LANG', 'LC_ALL']
  const result = Object.fromEntries(names.flatMap(name =>
    typeof environment[name] === 'string' ? [[name, environment[name]]] : []))
  return {
    ...result,
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(home, '.config'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_CACHE_HOME: join(home, '.cache'),
    npm_config_cache: join(home, '.npm'),
  }
}
