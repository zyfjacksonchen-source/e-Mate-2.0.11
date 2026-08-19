import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EMATE_DESKTOP_PROFILE_VERSION,
  installEmateDesktopProfile,
} from '../src/e-mate-profile.ts'
import { prepareDesktopProfile } from '../src/profile.ts'
import { bundledPythonPath } from '../src/vision-toolkit.ts'

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
    expect(manifest.dsh.profile.bundles).toHaveLength(19)
    expect(manifest.dsh.profile.bundles).toEqual(expect.arrayContaining([
      '@kelearns/dsh-navigation-bar',
      '@omdsh-dev/dsh-genui',
      '@e-mate/dsh-plugin-browser',
      '@e-mate/dsh-plugin-file-import',
      '@e-mate/dsh-plugin-computer-use',
      '@e-mate/dsh-plugin-find-skill',
      '@e-mate/dsh-plugin-mcp-manage',
      '@e-mate/dsh-plugin-office-skills',
      '@e-mate/dsh-plugin-xin-assistant',
      'dsh-at-file',
      'dsh-better-sidebar',
      'dsh-file-viewer',
      'dsh-search-mcp',
      'dsh-turn-fold',
      'dsh-visualize',
    ]))
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-im')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-vision-toolkit')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-better-sidebar')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-genui')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-search-mcp')
    expect(manifest.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-subagent')
    expect(existsSync(join(profile, 'node_modules', '@kelearns', 'dsh-navigation-bar', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@omdsh-dev', 'dsh-genui', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-browser', 'lib', 'index.mjs'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-file-import', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-computer-use', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-find-skill', 'lib', 'index.js'))).toBe(true)
    const findSkillPatch = readFileSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-find-skill', 'cordis.patch.yml'), 'utf8')
    expect(findSkillPatch).toContain("cliCommand: 'pnpm dlx skills@1.5.22'")
    expect(findSkillPatch).toContain('/tree/skills-v2.0.9-r5/skills/connect-feishu-cli')
    expect(findSkillPatch).not.toContain('/tree/main/skills/connect-feishu-cli')
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-mcp-manage', 'lib', 'index.mjs'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'lib', 'index.js'))).toBe(true)
    expect(lstatSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'assets')).isSymbolicLink()).toBe(true)
    const xinPatch = readFileSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-xin-assistant', 'cordis.patch.yml'), 'utf8')
    expect(xinPatch).toContain(`pythonPath: ${JSON.stringify(bundledPythonPath())}`)
    expect(lstatSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-xin-assistant', 'runtime')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'assets', 'pdf2json', 'pdfparser.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', '@e-mate', 'dsh-plugin-office-skills', 'assets', 'noto-sans-sc', 'files', 'noto-sans-sc-4-wght-normal.woff2'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', 'dsh-at-file', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(profile, 'node_modules', 'dsh-better-sidebar', 'lib', 'client.js'))).toBe(true)
    const betterSidebarPrefs = readFileSync(join(profile, 'node_modules', 'dsh-better-sidebar', 'src', 'prefs-shared.ts'), 'utf8')
    expect(betterSidebarPrefs).toContain('openByDefault: false')
    expect(betterSidebarPrefs).toContain('interceptOpenPath: false')
    const betterSidebarClient = readFileSync(join(profile, 'node_modules', 'dsh-better-sidebar', 'lib', 'client.js'), 'utf8')
    expect(betterSidebarClient).toContain('window.location.pathname.startsWith("/chat/")')
    expect(betterSidebarClient).toContain('panelOpen: false')
    expect(betterSidebarClient).toContain('store.getPrefs().interceptOpenPath === false ||')
    expect(readFileSync(join(profile, 'node_modules', 'dsh-better-sidebar', 'lib', 'index.js'), 'utf8'))
      .toContain('interceptOpenPath: z.boolean().default(false)')
    expect(existsSync(join(profile, 'node_modules', 'dsh-file-viewer', 'lib', 'client.js'))).toBe(true)
    const fileViewerHost = readFileSync(join(profile, 'node_modules', 'dsh-file-viewer', 'lib', 'index.js'), 'utf8')
    const fileViewerClient = readFileSync(join(profile, 'node_modules', 'dsh-file-viewer', 'lib', 'client.js'), 'utf8')
    expect(fileViewerHost).toContain('/usr/bin/open')
    expect(fileViewerHost).toContain('Invoke-Item -LiteralPath $env:E_MATE_OPEN_PATH')
    expect(fileViewerClient).not.toContain('"file-viewer: file open router"')
    expect(fileViewerClient).toContain('name: "conversation.session.header.actions"')
    expect(fileViewerClient).toContain('coordinator.openInSystem(sessionId, path)')
    const searchMcpClient = readFileSync(join(profile, 'node_modules', 'dsh-search-mcp', 'lib', 'client.browser.js'), 'utf8')
    expect(searchMcpClient).toContain('key: "search-mcp"')
    const turnFoldClient = readFileSync(join(profile, 'node_modules', 'dsh-turn-fold', 'client.js'), 'utf8')
    const labelBody = /function activityHeaderLabel\(fold\) \{([\s\S]*?)\n\t\t\}/u.exec(turnFoldClient)?.[1]
    expect(labelBody).toBeDefined()
    const activityHeaderLabel = new Function('fold', labelBody ?? '') as (fold: { toolCount: number, messageCount: number }) => string
    expect(activityHeaderLabel({ toolCount: 4, messageCount: 2 })).toBe('4 次工具调用，2 条消息')
    expect(turnFoldClient).toContain('v === undefined ? false : v')
    expect(turnFoldClient).toContain('fold.activityCount > 0')
    expect(turnFoldClient).toContain('assistantMustStayVisible(node)')
    expect(turnFoldClient).toContain('toolFailed(node)')
    expect(turnFoldClient).not.toContain('turnTimings')
    expect(turnFoldClient).not.toMatch(/首 token|缓存命中|tok\/s|消耗.*token/u)
    expect(existsSync(join(profile, 'node_modules', 'dsh-visualize', 'lib', 'client.js'))).toBe(true)
    expect(existsSync(join(home, 'browser-extension', 'manifest.json'))).toBe(true)
    expect(existsSync(join(home, 'browser-extension', 'README.txt'))).toBe(true)
    const browserManifest = JSON.parse(readFileSync(join(home, 'browser-extension', 'manifest.json'), 'utf8')) as {
      name?: string
      permissions?: string[]
      side_panel?: unknown
    }
    expect(browserManifest.name).toBe('e-Mate 浏览器')
    expect(browserManifest.permissions).not.toContain('sidePanel')
    expect(browserManifest.side_panel).toBeUndefined()
    expect(readFileSync(join(home, 'browser-extension', 'background.js'), 'utf8')).not.toContain('session.prompt')
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
    expect(rows.find(row => row.id === 'desktop-browser-extension-setup')).toEqual(expect.objectContaining({
      name: '@e-mate/desktop/browser-extension-setup',
    }))
    expect(rows.find(row => row.id === 'emate-browser')).toEqual(expect.objectContaining({
      name: './node_modules/@e-mate/dsh-plugin-browser/lib/index.mjs',
    }))
    expect(rows.map(row => row.id)).not.toContain('bridge-browser')
    expect(rows.find(row => row.id === 'genui')).toEqual(expect.objectContaining({
      name: '@omdsh-dev/dsh-genui',
    }))
    expect(rows.find(row => row.id === 'dsh-navigation-bar')).toEqual(expect.objectContaining({
      name: '@kelearns/dsh-navigation-bar',
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
    expect(rows.find(row => row.id === 'emate-computer-use')).toEqual(expect.objectContaining({
      name: '@e-mate/dsh-plugin-computer-use',
    }))
    expect(rows.find(row => row.id === 'emate-find-skill')).toEqual(expect.objectContaining({
      name: '@e-mate/dsh-plugin-find-skill',
    }))
    expect(rows.find(row => row.id === 'emate-mcp-manage')).toEqual(expect.objectContaining({
      name: './node_modules/@e-mate/dsh-plugin-mcp-manage/lib/index.mjs',
    }))
    expect(rows.find(row => row.id === 'emate-xin-assistant')).toEqual(expect.objectContaining({
      name: './node_modules/@e-mate/dsh-plugin-xin-assistant/lib/index.mjs',
      config: expect.objectContaining({ pythonPath: bundledPythonPath() }),
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

  it('reuses a complete immutable profile and repairs it when a required file disappears', () => {
    const home = mkdtempSync(join(tmpdir(), 'e-mate-desktop-profile-'))
    roots.push(home)
    const profile = installEmateDesktopProfile(home)
    const browserClient = join(profile, 'node_modules', '@e-mate', 'dsh-plugin-browser', 'package.json')
    const sentinel = join(profile, 'node_modules', '@e-mate', 'dsh-plugin-browser', '.warm-start-sentinel')
    const firstModified = readFileSync(join(profile, '.e-mate-install.json'), 'utf8')

    writeFileSync(sentinel, 'preserved only when the immutable install is reused')
    installEmateDesktopProfile(home)
    expect(readFileSync(join(profile, '.e-mate-install.json'), 'utf8')).toBe(firstModified)
    expect(existsSync(sentinel)).toBe(true)

    rmSync(browserClient)
    installEmateDesktopProfile(home)
    expect(existsSync(browserClient)).toBe(true)
    expect(existsSync(sentinel)).toBe(false)
  })

  it('defers removal of replaced managed packages until the desktop is interactive', () => {
    const home = mkdtempSync(join(tmpdir(), 'e-mate-desktop-profile-'))
    roots.push(home)
    const profile = installEmateDesktopProfile(home)
    const browserPackage = join(profile, 'node_modules', '@e-mate', 'dsh-plugin-browser')
    const sentinel = join(browserPackage, '.old-package-sentinel')
    const deferred: string[] = []
    writeFileSync(sentinel, 'old package tree')
    rmSync(join(browserPackage, 'package.json'))

    installEmateDesktopProfile(home, path => { deferred.push(path) })

    expect(existsSync(join(browserPackage, 'package.json'))).toBe(true)
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
    manifest.dependencies['@yuxianglin/dsh-bridge-browser'] = '0.0.1'
    manifest.dsh.profile.bundles.push(
      '@xmanrui/dsh-im',
      '@e-mate/dsh-plugin-im',
      '@yuxianglin/dsh-bridge-browser',
    )
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    installEmateDesktopProfile(home)

    const repaired = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest
    expect(repaired.dependencies['@xmanrui/dsh-im']).toBe(
      'github:zyfjacksonchen-source/dsh-im#f984f73dcd67692141d4e475c8fbe887e2ce7062',
    )
    expect(repaired.dsh.profile.bundles.at(-1)).toBe('@xmanrui/dsh-im')
    expect(repaired.dependencies['@e-mate/dsh-plugin-im']).toBeUndefined()
    expect(repaired.dependencies['@yuxianglin/dsh-bridge-browser']).toBeUndefined()
    expect(repaired.dsh.profile.bundles).not.toContain('@e-mate/dsh-plugin-im')
    expect(repaired.dsh.profile.bundles).not.toContain('@yuxianglin/dsh-bridge-browser')
  })
})
