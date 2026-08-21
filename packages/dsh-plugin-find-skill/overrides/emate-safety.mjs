import { lstat, readFile, rm } from 'node:fs/promises'
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

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
