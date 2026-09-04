import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installEmateDesktopProfile } from '../src/e-mate-profile.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.runIf(process.platform === 'win32')('Windows managed Profile materialization', () => {
  // Four physical Profile installs can exceed Vitest's unit-test default on a cold Windows runner.
  it('uses physical directories and repairs a missing declared main without scanning unrelated nested files', () => {
    const home = mkdtempSync(join(tmpdir(), 'e-mate-desktop-profile-win-'))
    roots.push(home)
    const profile = installEmateDesktopProfile(home)
    const receiptPath = join(profile, '.e-mate-install.json')
    const packageRoot = join(profile, 'node_modules', '@e-mate', 'dsh-plugin-schedules')
    const computerUseRoot = join(profile, 'node_modules', '@e-mate', 'dsh-plugin-computer-use')
    const computerUsePatch = readFileSync(join(computerUseRoot, 'cordis.patch.yml'), 'utf8')
    expect((computerUsePatch.match(/id: emate-computer-use/gu) ?? []).length).toBe(1)
    expect(computerUsePatch).toContain("disabled: !!js Array.of('darwin', 'win32').includes(process.platform) === false")
    expect(computerUsePatch).toContain("process.platform === 'win32' ? 'hidden' : 'visible'")
    const publicTypes = readFileSync(join(computerUseRoot, 'lib', 'types', 'types.d.ts'), 'utf8')
    expect(publicTypes).not.toMatch(/executablePath|processStartTime|windowId/u)
    expect(existsSync(join(computerUseRoot, 'native', 'windows', 'dsh-computer-use-helper.ps1'))).toBe(true)
    expect(existsSync(join(computerUseRoot, 'native', 'windows', 'manifest.json'))).toBe(true)
    const library = join(packageRoot, 'lib')
    const main = join(library, 'index.js')
    const nestedExtra = join(library, '.warm-path-does-not-scan-this-file')
    const topLevelExtra = join(packageRoot, '.unexpected-top-level-entry')
    const receipt = readFileSync(receiptPath, 'utf8')

    // The shipped process enforces Windows redirection trust, so managed payloads cannot rely on junctions.
    expect(lstatSync(packageRoot).isSymbolicLink()).toBe(false)
    expect(lstatSync(library).isSymbolicLink()).toBe(false)
    writeFileSync(nestedExtra, 'warm launch must not recurse through the package tree')
    installEmateDesktopProfile(home)
    expect(readFileSync(receiptPath, 'utf8')).toBe(receipt)
    expect(existsSync(nestedExtra)).toBe(true)

    rmSync(main)
    installEmateDesktopProfile(home)
    expect(existsSync(main)).toBe(true)
    expect(existsSync(nestedExtra)).toBe(false)
    expect(lstatSync(library).isSymbolicLink()).toBe(false)

    writeFileSync(topLevelExtra, 'managed roots are exact sets')
    installEmateDesktopProfile(home)
    expect(existsSync(topLevelExtra)).toBe(false)
  }, 30_000)
})
