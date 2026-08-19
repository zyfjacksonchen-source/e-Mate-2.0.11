import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupObsoleteMacApplications,
  macAppBundleFromExecutable,
  obsoleteMacApplicationCopies,
} from '../src/installation-cleanup.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function app(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(join(path, 'Contents', 'MacOS'), { recursive: true })
  return realpathSync(path)
}

describe('packaged macOS installation cleanup', () => {
  it('keeps the canonical newest app and selects only older or duplicate standard copies', () => {
    const root = mkdtempSync(join(tmpdir(), 'emate-app-cleanup-'))
    roots.push(root)
    const current = app(root, 'e-Mate.app')
    const old = app(root, 'e-Mate 2.0.7.app')
    const duplicate = app(root, 'e-Mate 2.0.10 QA.app')
    expect(macAppBundleFromExecutable(join(current, 'Contents', 'MacOS', 'e-Mate'))).toBe(current)
    expect(obsoleteMacApplicationCopies([
      { path: current, version: '2.0.10' },
      { path: old, version: '2.0.7' },
      { path: duplicate, version: '2.0.10' },
    ], current, '2.0.10', [current])).toEqual([old, duplicate])
  })

  it('fails closed when the running app is noncanonical or another standard copy is newer', () => {
    const root = mkdtempSync(join(tmpdir(), 'emate-app-cleanup-'))
    roots.push(root)
    const current = app(root, 'e-Mate.app')
    const old = app(root, 'e-Mate 2.0.7.app')
    const newer = app(root, 'e-Mate 2.0.11.app')
    expect(obsoleteMacApplicationCopies([
      { path: current, version: '2.0.10' }, { path: old, version: '2.0.7' }, { path: newer, version: '2.0.11' },
    ], current, '2.0.10', [current])).toEqual([])
    expect(obsoleteMacApplicationCopies([
      { path: current, version: '2.0.10' }, { path: old, version: '2.0.7' },
    ], current, '2.0.10', [old])).toEqual([])
  })

  it('moves obsolete copies to Trash and reports individual failures', async () => {
    const root = mkdtempSync(join(tmpdir(), 'emate-app-cleanup-'))
    roots.push(root)
    const current = app(root, 'e-Mate.app')
    const old = app(root, 'e-Mate 2.0.7.app')
    const duplicate = app(root, 'e-Mate 2.0.10 QA.app')
    const trash = vi.fn(async (path: string) => { if (path === duplicate) throw new Error('busy') })
    const result = await cleanupObsoleteMacApplications({
      platform: 'darwin',
      currentExecutable: join(current, 'Contents', 'MacOS', 'e-Mate'),
      currentVersion: '2.0.10',
      homeDirectory: root,
      trash,
      applicationDirectories: [root],
      copies: [
        { path: current, version: '2.0.10' },
        { path: old, version: '2.0.7' },
        { path: duplicate, version: '2.0.10' },
      ],
    })
    expect(result).toEqual({ removed: [old], failed: [duplicate] })
    expect(trash).toHaveBeenCalledTimes(2)
  })
})
