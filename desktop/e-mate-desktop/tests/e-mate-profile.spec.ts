import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { afterEach, describe, expect, it } from 'vitest'
import { installEmateDesktopProfile } from '../src/e-mate-profile.ts'
import { prepareDesktopProfile } from '../src/profile.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('e-Mate desktop profile', () => {
  it('installs the fixed product profile and replaces legacy CLI update guidance', () => {
    const home = mkdtempSync(join(tmpdir(), 'e-mate-desktop-profile-'))
    roots.push(home)

    const profile = installEmateDesktopProfile(home)
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(manifest.dsh.profile.bundles).toHaveLength(15)
    expect(manifest.dsh.profile.bundles).toEqual(expect.arrayContaining([
      '@omdsh-dev/dsh-genui',
      '@yuxianglin/dsh-bridge-browser',
      '@e-mate/dsh-plugin-file-import',
      '@e-mate/dsh-plugin-office-skills',
      'dsh-at-file',
      'dsh-better-sidebar',
      'dsh-file-viewer',
      'dsh-search-mcp',
      'dsh-turn-fold',
      'dsh-visualize',
    ]))
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-vision-toolkit')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-browser')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-better-sidebar')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-genui')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-search-mcp')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-subagent')
    expect(existsSync(join(profile, 'node_modules', '@omdsh-dev', 'dsh-genui', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@yuxianglin', 'dsh-bridge-browser', 'lib', 'index.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-file-import', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'lib', 'index.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'assets', 'pdf2json', 'pdfparser.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'assets', 'noto-sans-sc', 'files', 'noto-sans-sc-4-wght-normal.woff2'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', 'dsh-at-file', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', 'dsh-better-sidebar', 'lib', 'client.js'))).toBe(true)
    expect(readFileSync(join(profile, 'node_modules', 'dsh-better-sidebar', 'src', 'prefs-shared.ts'), 'utf8'))
      .toContain('openByDefault: false')
    const betterSidebarClient = readFileSync(join(profile, 'node_modules', 'dsh-better-sidebar', 'lib', 'client.js'), 'utf8')
    expect(betterSidebarClient).toContain('window.location.pathname.startsWith("/chat/")')
    expect(betterSidebarClient).toContain('panelOpen: false')
    expect(existsSync(join(profile, 'node_modules', 'dsh-file-viewer', 'lib', 'client.js'))).toBe(true)
    const fileViewerHost = readFileSync(join(profile, 'node_modules', 'dsh-file-viewer', 'lib', 'index.js'), 'utf8')
    const fileViewerClient = readFileSync(join(profile, 'node_modules', 'dsh-file-viewer', 'lib', 'client.js'), 'utf8')
    expect(fileViewerHost).toContain('/usr/bin/open')
    expect(fileViewerHost).toContain('Invoke-Item -LiteralPath $env:E_MATE_OPEN_PATH')
    expect(fileViewerClient).toContain('SYSTEM_OPEN_EXTENSIONS = /\\.(?:docx|xlsx|pptx|pdf)$/iu')
    expect(fileViewerClient).toContain('coordinator.openInSystem(sessionId, path, singleFile)')
    expect(existsSync(join(profile, 'node_modules', 'dsh-search-mcp', 'lib', 'client.browser.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', 'dsh-turn-fold', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', 'dsh-visualize', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(home, 'browser-extension', 'manifest.json'))).toBe(true)
    expect(existsSync(join(home, 'browser-extension', 'SOURCE.json'))).toBe(true)
    expect(existsSync(join(profile, 'plugins', 'runtime-binding.json'))).toBe(true)
    expect(readFileSync(join(home, 'settings.yaml'), 'utf8')).toBe(
      'ui-theme:\n  preference: dark\nagent-default-model:\n  provider: e-mate-enterprise\n  model: gpt-5.6-luna\n  reasoningEffort: max\n',
    )

    const prepared = prepareDesktopProfile(undefined, home, process.platform, 'e-mate')
    const rows = composeEntries([prepared.patches])
    expect(prepared.profile.name).toBe('e-mate')
    expect(prepared.mode).toBe('compatibility')
    expect(rows.find(row => row.id === 'desktop-agent-update')).toEqual(expect.objectContaining({
      name: '@e-mate/desktop/agent-update',
    }))
    expect(rows.find(row => row.id === 'desktop-agent-update')?.disabled).not.toBe(true)
    expect(rows.find(row => row.id === 'bridge-browser')).toEqual(expect.objectContaining({
      name: '@yuxianglin/dsh-bridge-browser',
    }))
    expect(rows.find(row => row.id === 'genui')).toEqual(expect.objectContaining({
      name: '@omdsh-dev/dsh-genui',
    }))
    expect(rows.find(row => row.id === 'better-sidebar')).toEqual(expect.objectContaining({
      name: 'dsh-better-sidebar',
    }))
    expect(rows.find(row => row.id === 'search-mcp')).toEqual(expect.objectContaining({
      name: 'dsh-search-mcp',
    }))
    expect(rows.find(row => row.id === 'emate-file-import')).toEqual(expect.objectContaining({
      name: '@e-mate/dsh-plugin-file-import',
    }))
    expect(rows.find(row => row.id === 'emate-office-skills')).toEqual(expect.objectContaining({
      name: './node_modules/@e-mate/dsh-plugin-office-skills/lib/index.js',
    }))
    expect(rows.find(row => row.id === 'emate-agent-operations')?.disabled).toBe(true)
    expect(rows.map(row => row.id)).not.toContain('desktop-profiles')
    expect(rows.find(row => row.id === 'dsh-at-file')).toEqual(expect.objectContaining({
      name: 'dsh-at-file',
    }))
    expect(rows.find(row => row.id === 'dsh-file-viewer')).toEqual(expect.objectContaining({
      name: 'dsh-file-viewer',
      config: expect.objectContaining({ allowAbsolutePaths: false }),
    }))
    expect(rows.find(row => row.id === 'dsh-turn-fold')).toEqual(expect.objectContaining({
      name: 'dsh-turn-fold',
    }))
    expect(rows.find(row => row.id === 'visualize')).toEqual(expect.objectContaining({
      name: 'dsh-visualize',
    }))
  })

  it('preserves an existing theme preference and adds the managed model default once', () => {
    const home = mkdtempSync(join(tmpdir(), 'e-mate-desktop-profile-'))
    roots.push(home)
    const settings = join(home, 'settings.yaml')
    writeFileSync(settings, 'ui-theme:\n  preference: light\n')

    installEmateDesktopProfile(home)
    installEmateDesktopProfile(home)

    expect(readFileSync(settings, 'utf8')).toBe(
      'ui-theme:\n  preference: light\nagent-default-model:\n  provider: e-mate-enterprise\n  model: gpt-5.6-luna\n  reasoningEffort: max\n',
    )
  })
})
