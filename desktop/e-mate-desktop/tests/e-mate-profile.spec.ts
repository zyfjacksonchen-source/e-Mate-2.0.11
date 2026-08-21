import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EMATE_DESKTOP_PROFILE_VERSION,
  EMATE_UPDATEABLE_PROFILE_COMPONENT_IDS,
  installEmateDesktopProfile,
} from '../src/e-mate-profile.ts'
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
    expect(manifest.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      ...EMATE_UPDATEABLE_PROFILE_COMPONENT_IDS.filter(id => id.startsWith('@e-mate/dsh-plugin-')),
      '@kelearns/dsh-navigation-bar',
      'dsh-at-file',
      'dsh-file-viewer',
      'dsh-visualize',
    ])
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-im')
    expect(manifest.dsh.profile.bundles).toContain('@e-mate/dsh-plugin-vision-toolkit')
    expect(manifest.dsh.profile.bundles).toContain('@e-mate/dsh-plugin-better-sidebar')
    expect(manifest.dsh.profile.bundles).toContain('@e-mate/dsh-plugin-genui')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-xin-assistant')
    expect(manifest.dsh.profile.bundles).not.toContain('dsh-search-mcp')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-subagent')
    expect(existsSync(join(profile, 'node_modules', '@kelearns', 'dsh-navigation-bar', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-genui', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-vision-toolkit', 'lib', 'index.mjs'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-cdp', 'lib', 'index.mjs'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-skill-hub', 'lib', 'index.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-tool-search', 'lib', 'index.mjs'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-file-import', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-computer-use', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-find-skill', 'lib', 'index.js'))).toBe(true)
    const findSkillPatch = readFileSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-find-skill', 'cordis.patch.yml'), 'utf8')
    expect(findSkillPatch).toContain("cliCommand: 'pnpm dlx skills@1.5.22'")
    expect(findSkillPatch).toContain('/tree/skills-v2.0.11-r1/skills/connect-feishu-cli')
    expect(findSkillPatch).not.toContain('/tree/main/skills/connect-feishu-cli')
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-mcp-manage', 'lib', 'index.mjs'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'lib', 'index.js'))).toBe(true)
    expect(lstatSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'assets')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-xin-assistant'))).toBe(false)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'assets', 'pdf2json', 'pdfparser.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'assets', 'noto-sans-sc', 'files', 'noto-sans-sc-4-wght-normal.woff2'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', 'dsh-at-file', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-better-sidebar', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', 'dsh-better-sidebar'))).toBe(false)
    expect(existsSync(join(profile, 'node_modules', 'dsh-file-viewer', 'lib', 'client.js'))).toBe(true)
    const fileViewerHost = readFileSync(join(profile, 'node_modules', 'dsh-file-viewer', 'lib', 'index.js'), 'utf8')
    const fileViewerClient = readFileSync(join(profile, 'node_modules', 'dsh-file-viewer', 'lib', 'client.js'), 'utf8')
    expect(fileViewerHost).toContain('/usr/bin/open')
    expect(fileViewerHost).toContain('Invoke-Item -LiteralPath $env:E_MATE_OPEN_PATH')
    expect(fileViewerClient).not.toContain('"file-viewer: file open router"')
    expect(fileViewerClient).toContain('name: "conversation.session.header.actions"')
    expect(fileViewerClient).toContain('coordinator.openInSystem(sessionId, path)')
    const searchMcpHost = readFileSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-search-mcp', 'lib', 'index.mjs'), 'utf8')
    expect(searchMcpHost).toContain('https://mcp.tavily.com/mcp/')
    expect(searchMcpHost).not.toMatch(/StdioClientTransport|duckduckgo|\bnpx\b/u)
    expect(existsSync(join(profile, 'node_modules', 'dsh-search-mcp'))).toBe(false)
    expect(existsSync(join(profile, 'node_modules', 'dsh-turn-fold'))).toBe(false)
    expect(existsSync(join(profile, 'node_modules', 'dsh-visualize', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(home, 'browser-extension'))).toBe(false)
    mkdirSync(join(home, 'browser-extension'))
    writeFileSync(join(home, 'ext-bridge-token'), 'retired-token')
    installEmateDesktopProfile(home)
    expect(existsSync(join(home, 'browser-extension'))).toBe(false)
    expect(existsSync(join(home, 'ext-bridge-token'))).toBe(false)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-browser'))).toBe(false)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-browser-panel'))).toBe(false)
    expect(existsSync(join(profile, 'plugins', 'runtime-binding.json'))).toBe(true)
    const runtimeBinding = JSON.parse(readFileSync(join(profile, 'plugins', 'runtime-binding.json'), 'utf8')) as {
      version?: string
      schedule_module?: string
      schedule_module_sha256?: string
    }
    expect(runtimeBinding.version).toBe(EMATE_DESKTOP_PROFILE_VERSION)
    expect(runtimeBinding.schedule_module).toContain('@deepseek-ai/dsh-schedule')
    expect(runtimeBinding.schedule_module_sha256).toMatch(/^[0-9a-f]{64}$/u)
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
    expect(rows.map(row => row.id)).not.toContain('desktop-computer-use-setup')
    expect(rows.find(row => row.id === 'emate-cdp')).toEqual(expect.objectContaining({
      name: './node_modules/@e-mate/dsh-plugin-cdp/lib/index.mjs',
    }))
    expect(rows.map(row => row.id)).not.toContain('bridge-browser')
    expect(rows.find(row => row.id === 'emate-genui')).toEqual(expect.objectContaining({
      name: '@e-mate/dsh-plugin-genui',
    }))
    expect(rows.map(row => row.id)).not.toContain('genui')
    expect(rows.find(row => row.id === 'vision-toolkit')).toEqual(expect.objectContaining({
      name: '@e-mate/dsh-plugin-vision-toolkit',
    }))
    expect(rows.map(row => row.id)).not.toContain('desktop-vision-toolkit')
    expect(rows.find(row => row.id === 'dsh-navigation-bar')).toEqual(expect.objectContaining({
      name: '@kelearns/dsh-navigation-bar',
    }))
    expect(rows.find(row => row.id === 'emate-better-sidebar')).toEqual(expect.objectContaining({
      name: '@e-mate/dsh-plugin-better-sidebar',
    }))
    expect(rows.map(row => row.id)).not.toContain('better-sidebar')
    expect(rows.find(row => row.id === 'search-mcp')).toEqual(expect.objectContaining({
      name: './node_modules/@e-mate/dsh-plugin-search-mcp/lib/index.mjs',
    }))
    expect(rows.find(row => row.id === 'emate-file-import')).toEqual(expect.objectContaining({
      name: '@e-mate/dsh-plugin-file-import',
    }))
    expect(rows.find(row => row.id === 'emate-computer-use')).toEqual(expect.objectContaining({
      name: '@e-mate/dsh-plugin-computer-use',
    }))
    expect(rows.find(row => row.id === 'emate-find-skill')).toEqual(expect.objectContaining({
      name: '@e-mate/dsh-plugin-find-skill',
    }))
    expect(rows.find(row => row.id === 'emate-mcp-manage')).toEqual(expect.objectContaining({
      name: './node_modules/@e-mate/dsh-plugin-mcp-manage/lib/index.mjs',
    }))
    expect(rows.map(row => row.id)).not.toContain('emate-xin-assistant')
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
    expect(rows.map(row => row.id)).not.toContain('dsh-turn-fold')
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

  it('reuses a complete immutable profile and repairs it when a required file disappears', () => {
    const home = mkdtempSync(join(tmpdir(), 'e-mate-desktop-profile-'))
    roots.push(home)
    const profile = installEmateDesktopProfile(home)
    const cdpManifest = join(profile, 'node_modules', '@e-mate', 'dsh-plugin-cdp', 'package.json')
    const sentinel = join(profile, 'node_modules', '@e-mate', 'dsh-plugin-cdp', '.warm-start-sentinel')
    const firstModified = readFileSync(join(profile, '.e-mate-install.json'), 'utf8')

    writeFileSync(sentinel, 'preserved only when the immutable install is reused')
    installEmateDesktopProfile(home)
    expect(readFileSync(join(profile, '.e-mate-install.json'), 'utf8')).toBe(firstModified)
    expect(existsSync(sentinel)).toBe(true)

    rmSync(cdpManifest)
    installEmateDesktopProfile(home)
    expect(existsSync(cdpManifest)).toBe(true)
    expect(existsSync(sentinel)).toBe(false)
  })

  it('defers removal of replaced managed packages until the desktop is interactive', () => {
    const home = mkdtempSync(join(tmpdir(), 'e-mate-desktop-profile-'))
    roots.push(home)
    const profile = installEmateDesktopProfile(home)
    const cdpPackage = join(profile, 'node_modules', '@e-mate', 'dsh-plugin-cdp')
    const sentinel = join(cdpPackage, '.old-package-sentinel')
    const deferred: string[] = []
    writeFileSync(sentinel, 'old package tree')
    rmSync(join(cdpPackage, 'package.json'))

    installEmateDesktopProfile(home, path => { deferred.push(path) })

    expect(existsSync(join(cdpPackage, 'package.json'))).toBe(true)
    expect(deferred.some(path => existsSync(join(path, '.old-package-sentinel')))).toBe(true)
    for (const path of deferred) rmSync(path, { recursive: true, force: true })
  })

  it('preserves a native DSH plugin dependency and bundle across managed profile repair', () => {
    const home = mkdtempSync(join(tmpdir(), 'e-mate-desktop-profile-'))
    roots.push(home)
    const profile = installEmateDesktopProfile(home)
    const manifestPath = join(profile, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dependencies['@xmanrui/dsh-im'] = 'github:zyfjacksonchen-source/dsh-im#f984f73dcd67692141d4e475c8fbe887e2ce7062'
    manifest.dependencies['@e-mate/dsh-plugin-im'] = '2.0.8'
    manifest.dependencies['@e-mate/dsh-plugin-xin-assistant'] = '2.0.10'
    manifest.dependencies['@yuxianglin/dsh-bridge-browser'] = '0.0.1'
    manifest.dependencies['dsh-better-sidebar'] = '0.12.2'
    manifest.dependencies['dsh-turn-fold'] = '0.2.2'
    const retiredXin = join(profile, 'node_modules', '@e-mate', 'dsh-plugin-xin-assistant')
    const retiredSidebar = join(profile, 'node_modules', 'dsh-better-sidebar')
    const retiredTurnFold = join(profile, 'node_modules', 'dsh-turn-fold')
    mkdirSync(retiredXin, { recursive: true })
    mkdirSync(retiredSidebar, { recursive: true })
    mkdirSync(retiredTurnFold, { recursive: true })
    writeFileSync(join(retiredXin, 'stale.txt'), 'retired', { flag: 'w' })
    writeFileSync(join(retiredSidebar, 'stale.txt'), 'retired', { flag: 'w' })
    writeFileSync(join(retiredTurnFold, 'stale.txt'), 'retired', { flag: 'w' })
    manifest.dsh.profile.bundles.push(
      '@xmanrui/dsh-im',
      '@e-mate/dsh-plugin-im',
      '@e-mate/dsh-plugin-xin-assistant',
      '@yuxianglin/dsh-bridge-browser',
      'dsh-better-sidebar',
      'dsh-turn-fold',
    )
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    installEmateDesktopProfile(home)

    const repaired = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest
    expect(repaired.dependencies['@xmanrui/dsh-im']).toBe(
      'github:zyfjacksonchen-source/dsh-im#f984f73dcd67692141d4e475c8fbe887e2ce7062',
    )
    expect(repaired.dsh.profile.bundles.at(-1)).toBe('@xmanrui/dsh-im')
    expect(repaired.dependencies['@e-mate/dsh-plugin-im']).toBeUndefined()
    expect(repaired.dependencies['@e-mate/dsh-plugin-xin-assistant']).toBeUndefined()
    expect(repaired.dependencies['@yuxianglin/dsh-bridge-browser']).toBeUndefined()
    expect(repaired.dependencies['dsh-better-sidebar']).toBeUndefined()
    expect(repaired.dependencies['dsh-turn-fold']).toBeUndefined()
    expect(repaired.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-im')
    expect(repaired.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-xin-assistant')
    expect(repaired.dsh.profile.bundles).not.toContain('@yuxianglin/dsh-bridge-browser')
    expect(repaired.dsh.profile.bundles).not.toContain('dsh-better-sidebar')
    expect(repaired.dsh.profile.bundles).not.toContain('dsh-turn-fold')
    expect(existsSync(retiredXin)).toBe(false)
    expect(existsSync(retiredSidebar)).toBe(false)
    expect(existsSync(retiredTurnFold)).toBe(false)
  })
})
