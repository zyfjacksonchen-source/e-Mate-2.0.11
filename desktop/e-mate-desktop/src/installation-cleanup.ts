/** Remove obsolete packaged e-Mate copies from the two standard macOS application folders. */

import { execFileSync } from 'node:child_process'
import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { compareSemVerVersions, parseSemVer } from './update-checker.ts'

const APP_ID = 'net.ecoremedia.e-mate'
const APP_NAME = /^e-Mate(?: .+)?\.app$/u

export interface MacApplicationCopy {
  readonly path: string
  readonly version: string
}

export interface MacApplicationCleanupResult {
  readonly removed: readonly string[]
  readonly failed: readonly string[]
}

export function macAppBundleFromExecutable(executable: string): string | undefined {
  const macos = dirname(resolve(executable))
  const contents = dirname(macos)
  const bundle = dirname(contents)
  return basename(macos) === 'MacOS' && basename(contents) === 'Contents' && bundle.endsWith('.app')
    ? bundle
    : undefined
}

function readCopy(path: string): MacApplicationCopy | undefined {
  const metadata = lstatSync(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return undefined
  const value = JSON.parse(execFileSync('/usr/bin/plutil', [
    '-convert', 'json', '-o', '-', join(path, 'Contents', 'Info.plist'),
  ], { encoding: 'utf8', timeout: 2_000, maxBuffer: 64 * 1024 })) as Record<string, unknown>
  const version = value.CFBundleShortVersionString
  return value.CFBundleIdentifier === APP_ID && typeof version === 'string'
    && parseSemVer(version)?.prerelease.length === 0
    ? { path: realpathSync(path), version }
    : undefined
}

export function discoverMacApplicationCopies(directories: readonly string[]): MacApplicationCopy[] {
  const copies: MacApplicationCopy[] = []
  for (const directory of directories) {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !APP_NAME.test(entry.name)) continue
      try {
        const copy = readCopy(join(directory, entry.name))
        if (copy !== undefined) copies.push(copy)
      } catch {
        // An unreadable or malformed bundle is not safe to remove automatically.
      }
    }
  }
  return copies
}

export function obsoleteMacApplicationCopies(
  copies: readonly MacApplicationCopy[],
  currentPath: string,
  currentVersion: string,
  canonicalPaths: readonly string[],
): string[] {
  const current = realpathSync(currentPath)
  if (!canonicalPaths.some(path => {
    try { return realpathSync(path) === current } catch { return false }
  }) || parseSemVer(currentVersion)?.prerelease.length !== 0) return []
  if (copies.some(copy => (compareSemVerVersions(copy.version, currentVersion) ?? 1) > 0)) return []
  return copies
    .filter(copy => copy.path !== current && (compareSemVerVersions(copy.version, currentVersion) ?? 1) <= 0)
    .map(copy => copy.path)
}

export async function cleanupObsoleteMacApplications(options: {
  readonly platform: NodeJS.Platform
  readonly currentExecutable: string
  readonly currentVersion: string
  readonly homeDirectory: string
  readonly trash: (path: string) => Promise<void>
  readonly copies?: readonly MacApplicationCopy[]
  readonly applicationDirectories?: readonly string[]
}): Promise<MacApplicationCleanupResult> {
  if (options.platform !== 'darwin') return { removed: [], failed: [] }
  const currentPath = macAppBundleFromExecutable(options.currentExecutable)
  if (currentPath === undefined) return { removed: [], failed: [] }
  const directories = options.applicationDirectories ?? ['/Applications', join(options.homeDirectory, 'Applications')]
  const canonicalPaths = directories.map(directory => join(directory, 'e-Mate.app'))
  const obsolete = obsoleteMacApplicationCopies(
    options.copies ?? discoverMacApplicationCopies(directories),
    currentPath,
    options.currentVersion,
    canonicalPaths,
  )
  const removed: string[] = []
  const failed: string[] = []
  for (const path of obsolete) {
    try {
      await options.trash(path)
      removed.push(path)
    } catch {
      failed.push(path)
    }
  }
  return { removed, failed }
}
