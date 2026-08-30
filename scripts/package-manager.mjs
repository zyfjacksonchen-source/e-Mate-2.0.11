import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

function verifiedEntry(name, version, entry, env, execPath) {
  if (!existsSync(entry)) throw new Error(`pinned ${name} ${version} entry is missing`)
  const result = spawnSync(execPath, [entry, '--version'], { encoding: 'utf8', env })
  if (result.error?.code === 'ENOENT') throw new Error(`cannot verify pinned ${name}: active Node executable is unavailable`, { cause: result.error })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0 || result.stdout.trim() !== version) {
    throw new Error(`requires pinned ${name} ${version}; received ${result.stdout.trim() || '<unavailable>'}`)
  }
  return entry
}

function inheritedPnpmEntry(version, env, execPath) {
  const entry = env.npm_execpath
  if (typeof entry !== 'string' || !isAbsolute(entry) || !basename(entry).toLowerCase().includes('pnpm')) {
    throw new Error('must run through the inherited pinned pnpm entry')
  }
  return verifiedEntry('pnpm', version, resolve(entry), env, execPath)
}

export function pinnedPnpmInvocation(version, args, { env = process.env, execPath = process.execPath } = {}) {
  const entry = inheritedPnpmEntry(version, env, execPath)
  return { command: execPath, args: [entry, ...args], env }
}

export function pinnedYarnInvocation(pnpmVersion, yarnVersion, args, { env = process.env, execPath = process.execPath } = {}) {
  const pnpmEntry = inheritedPnpmEntry(pnpmVersion, env, execPath)
  const versionRoot = dirname(dirname(pnpmEntry))
  if (basename(versionRoot) !== pnpmVersion || basename(dirname(versionRoot)).toLowerCase() !== 'pnpm') {
    throw new Error('inherited pnpm entry is outside the Corepack cache layout')
  }
  const cacheRoot = dirname(dirname(versionRoot))
  const yarnEntry = verifiedEntry('yarn', yarnVersion, join(cacheRoot, 'yarn', yarnVersion, 'yarn.js'), env, execPath)
  return { command: execPath, args: [yarnEntry, ...args], env }
}
