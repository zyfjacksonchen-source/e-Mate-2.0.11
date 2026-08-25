import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Session } from '@deepseek-ai/dsh-session'
import { PersistenceCoordinator } from '@deepseek-ai/dsh-session-persistence'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const packageRoot = new URL('../', import.meta.url)
const workspaceRoot = new URL('../', packageRoot)
const manifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as {
  name?: unknown
  version?: unknown
  bin?: Record<string, unknown>
  exports?: Record<string, unknown>
  files?: unknown
  scripts?: Record<string, unknown>
  dsh?: { bundle?: { patch?: unknown }; client?: unknown }
  build?: {
    productName?: unknown
    appId?: unknown
    asarUnpack?: unknown
    extraResources?: unknown
    afterPack?: unknown
    electronFuses?: unknown
    files?: unknown
    mac?: {
      artifactName?: unknown
      hardenedRuntime?: unknown
      icon?: unknown
      mergeASARs?: unknown
      notarize?: unknown
      target?: unknown
      x64ArchFiles?: unknown
    }
    win?: { icon?: unknown; target?: unknown }
    nsis?: Record<string, unknown>
    linux?: { icon?: unknown }
  }
  dependencies?: Record<string, unknown>
  optionalDependencies?: Record<string, unknown>
  devDependencies?: Record<string, unknown>
  peerDependencies?: Record<string, unknown>
}
const workspaceManifest = JSON.parse(readFileSync(new URL('package.json', workspaceRoot), 'utf8')) as {
  version?: unknown
  resolutions?: Record<string, unknown>
  scripts?: Record<string, unknown>
}

describe('published package surface', () => {
  it('registers the e-Mate desktop launcher', () => {
    expect(manifest.name).toBe('@e-mate/desktop')
    expect(manifest.bin).toEqual({ 'e-mate-desktop': 'lib/bin.js' })
  })

  it('exposes the Host plugin and desktop-owned client face', () => {
    expect(manifest.exports).toHaveProperty('./client')
    expect(manifest.exports).toHaveProperty('./windows-pwsh-sandbox', {
      types: './lib/types/windows-pwsh-sandbox.d.ts',
      default: './lib/windows-pwsh-sandbox.js',
    })
    expect(manifest.exports).toHaveProperty('./windows-directory-picker', {
      types: './lib/types/windows-directory-picker.d.ts',
      default: './lib/windows-directory-picker.js',
    })
    expect(manifest.exports).toHaveProperty('./terminal', {
      types: './lib/types/terminal.d.ts',
      default: './lib/terminal.js',
    })
    expect(manifest.exports).toHaveProperty('./pnpm', {
      types: './lib/types/pnpm.d.ts',
      default: './lib/pnpm.js',
    })
    expect(manifest.exports).toHaveProperty('./profile-service', {
      types: './lib/types/profile-service.d.ts',
      default: './lib/profile-service.js',
    })
    expect(manifest.exports).toHaveProperty('./profiles', {
      types: './lib/types/profiles.d.ts',
      default: './lib/profiles.js',
    })
    expect(manifest.exports).toHaveProperty('./updates', {
      types: './lib/types/updates.d.ts',
      default: './lib/updates.js',
    })
    expect(manifest.exports).toHaveProperty('./agent-update', {
      types: './lib/types/agent-update.d.ts',
      default: './lib/agent-update.js',
    })
    expect(manifest.exports).not.toHaveProperty('./computer-use-setup')
    expect(manifest.exports).not.toHaveProperty('./windows-acl-runner')
    expect(manifest.exports).not.toHaveProperty('./desktop-cli')
    expect(manifest.exports).not.toHaveProperty('./desktop-runtime-environment')
    expect(manifest.exports).not.toHaveProperty('./desktop-terminal')
    expect(manifest.exports).not.toHaveProperty('./update-checker')
    expect(manifest.exports).not.toHaveProperty('./update-download')
    expect(manifest.exports).toHaveProperty('./package.json')
    expect(manifest.dsh?.bundle).toEqual({ patch: './cordis.patch.yml' })
    expect(manifest.dsh?.client).toEqual({
      platform: 'web',
      inject: [
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-ui-theme',
      ],
    })
    const patch = readFileSync(new URL('cordis.patch.yml', packageRoot), 'utf8')
    expect(patch).toContain("name: '@e-mate/desktop'")
    expect(patch).toContain("name: '@e-mate/desktop/terminal'")
    expect(patch).toContain("name: '@e-mate/desktop/pnpm'")
    expect(patch).toContain("name: '@e-mate/desktop/updates'")
    expect(patch).toContain("name: '@e-mate/desktop/agent-update'")
    expect(patch).not.toContain('desktop-computer-use-setup')
    expect(patch).not.toContain('desktop-profiles')
  })

  it('keeps unaudited marketplace packages out of the published runtime', () => {
    expect(manifest.dependencies).not.toHaveProperty('dshmarket')
    expect(manifest.optionalDependencies ?? {}).not.toHaveProperty('dshmarket')
  })

  it('runs only the pinned rc.7 Harness packages', () => {
    const runtime = Object.entries(manifest.dependencies ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
    expect(runtime.length).toBeGreaterThan(0)
    expect(runtime.every(([, version]) => version === '0.1.0-rc.7')).toBe(true)
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    expect(lockfile).not.toMatch(/^\s*version: 0\.1\.0-rc\.6$/mu)
  })

  it('marks the DSH Workspace browser as the desktop folder-drop target', () => {
    const patchPath = './patches/dsh-client-ui-workspace@0.1.0-rc.7.patch'
    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-client-ui-workspace@npm:0.1.0-rc.7': expect.stringContaining(patchPath),
      '@deepseek-ai/dsh-client-ui-workspace@npm:^0.1.0-rc.7': expect.stringContaining(patchPath),
    })
    const patch = readFileSync(new URL(patchPath, workspaceRoot), 'utf8')
    const installedClient = readFileSync(new URL(
      'node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js',
      packageRoot,
    ), 'utf8')
    expect(patch).toContain('data-dsh-workspace-drop-target')
    expect(installedClient).toContain('data-dsh-workspace-drop-target')
  })

  it('builds public Host plugins and their private native bootstraps', () => {
    const config = readFileSync(new URL('tsdown.config.ts', packageRoot), 'utf8')

    expect(config).toContain("'windows-pwsh-sandbox': 'src/windows-pwsh-sandbox.ts'")
    expect(config).toContain("'windows-directory-picker': 'src/windows-directory-picker.ts'")
    expect(config).toContain("'windows-acl-runner': 'src/windows-acl-runner.ts'")
    expect(config).toContain("'desktop-cli': 'src/desktop-cli.ts'")
    expect(config).toContain("'desktop-runtime-environment': 'src/desktop-runtime-environment.ts'")
    expect(config).toContain("'desktop-terminal': 'src/desktop-terminal.ts'")
    expect(config).toContain("'profile-manager': 'src/profile-manager.ts'")
    expect(config).toContain("'profile-service': 'src/profile-service.ts'")
    expect(config).toContain("pnpm: 'src/pnpm.ts'")
    expect(config).toContain("profiles: 'src/profiles.ts'")
    expect(config).toContain("terminal: 'src/terminal.ts'")
    expect(config).toContain("'update-download': 'src/update-download.ts'")
    expect(config).toContain("'mac-update-helper': 'src/mac-update-helper.ts'")
    expect(config).toContain("'mac-update-installer': 'src/mac-update-installer.ts'")
    expect(config).toContain("updates: 'src/updates.ts'")
    expect(config).toContain("'agent-update': 'src/agent-update.ts'")
    expect(config).toContain("entry: { preload: 'src/preload.ts' }")
    expect(config).toContain("entryFileNames: 'preload.cjs'")
  })

  it('keeps target Python preparation out of the portable Base SDK build', () => {
    expect(manifest.scripts?.build).toBe('yarn run prepare:python && yarn run build:sdk')
    expect(manifest.scripts?.['build:sdk']).not.toContain('prepare:python')
  })

  it('installs Host command PATHs after the launch snapshot and before profile boot', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const recover = main.indexOf('await resolveDesktopShellEnvironment')
    const applyRecovered = main.indexOf('Object.entries(shellEnvironmentResolution.updates)')
    const snapshot = main.indexOf('const environment = loadLayeredEnv')
    const install = main.indexOf('const pnpmRuntime = installDesktopPnpmRuntime')
    const prepare = main.indexOf('const prepared = prepareDesktopProfile')
    const installDsh = main.indexOf('const dshRuntime = process.platform === \'win32\'')
    const boot = main.indexOf('const ctx = await boot')
    const beginRendererHealth = main.indexOf('runtime.beginRendererBootMonitoring()')
    const mount = main.indexOf('await runtime.mountScheduled(')
    const rendererHealth = main.indexOf('const rendererReport = await rendererBoot')
    const electronReady = main.indexOf('await app.whenReady()')
    const nativeReadyAck = main.indexOf("'.release-native-ready-ack'")
    const releaseAck = main.indexOf("'.release-health-ack'")
    const profileCleanup = main.indexOf('for (const path of deferredProfileCleanup)')
    const cleanup = main.indexOf('const cleanup = app.isPackaged')

    expect(recover).toBeGreaterThanOrEqual(0)
    expect(applyRecovered).toBeGreaterThan(recover)
    expect(snapshot).toBeGreaterThan(applyRecovered)
    expect(install).toBeGreaterThan(snapshot)
    expect(nativeReadyAck).toBeGreaterThan(electronReady)
    expect(nativeReadyAck).toBeLessThan(snapshot)
    expect(prepare).toBeGreaterThan(install)
    expect(installDsh).toBeGreaterThan(prepare)
    expect(boot).toBeGreaterThan(prepare)
    expect(boot).toBeGreaterThan(installDsh)
    expect(beginRendererHealth).toBeGreaterThan(boot)
    expect(mount).toBeGreaterThan(boot)
    expect(mount).toBeGreaterThan(beginRendererHealth)
    expect(rendererHealth).toBeGreaterThan(mount)
    expect(releaseAck).toBeGreaterThan(rendererHealth)
    expect(releaseAck).toBeLessThan(profileCleanup)
    expect(profileCleanup).toBeGreaterThan(mount)
    expect(cleanup).toBeGreaterThan(profileCleanup)
    expect(cleanup).toBeGreaterThan(mount)
    expect(main).toContain("'@e-mate/desktop: packaged pnpm runtime PATH'")
    expect(main).toContain("'@e-mate/desktop: packaged dsh runtime PATH'")
    expect(main).toContain("process.env.EMATE_RELEASE_HEALTH_PROBE === '1'")
    expect(main).toContain("'.release-native-ready-ack'")
    expect(main).toContain("'.release-health-ack'")
    expect(main).toContain('disposePnpmRuntime?.()')
    expect(main).toContain('disposeDshRuntime?.()')
  })

  it('uses the upstream child-environment scrub around login-shell recovery', () => {
    const shellEnvironment = readFileSync(new URL('src/shell-environment.ts', packageRoot), 'utf8')

    expect(shellEnvironment).toContain('scrubbedParentEnv')
    expect(shellEnvironment).toContain('SENSITIVE_ENV_PATTERN')
    expect(shellEnvironment).toContain('DSH_ENV_PREFIX')
    expect(shellEnvironment).toContain('DESKTOP_SHELL_ENVIRONMENT_KEYS')
  })

  it('commits recoverable plugin installs only after Renderer health', () => {
    const main = readFileSync(new URL('src/main.ts', packageRoot), 'utf8')
    const pnpm = readFileSync(new URL('src/pnpm.ts', packageRoot), 'utf8')
    const claim = main.indexOf('const recoveryClaim = await installRecovery.claim()')
    const prepare = main.indexOf('const prepared = prepareDesktopProfile')
    const rendererHealth = main.indexOf('const rendererReport = await rendererBoot')
    const installHealth = main.indexOf('await installRecovery.markHealthy(verifyingInstall.transactionId)')

    expect(claim).toBeGreaterThanOrEqual(0)
    expect(claim).toBeLessThan(prepare)
    expect(installHealth).toBeGreaterThan(rendererHealth)
    expect(main).toContain("runtime.rendererBootFailureReason ?? 'startup-failed'")
    expect(main).toContain('await installRecovery.recordFailure(')
    expect(pnpm).toContain('plugin add must use the recoverable install boundary')
    expect(pnpm).toContain('async runPluginInstall(')
    expect(pnpm).toContain('await this.installRecovery.seal(active.recoveryTransactionId)')
  })

  it('fixes the installed application identity', () => {
    expect(manifest.version).toBe(workspaceManifest.version)
    expect(manifest.build?.productName).toBe('e-Mate')
    expect(manifest.build?.appId).toBe('net.ecoremedia.e-mate')
    expect(manifest.build?.asarUnpack).toEqual([
      'package.json',
      'cordis.patch.yml',
      'build/**',
      'lib/**',
      'node_modules/**',
    ])
    expect(manifest.build?.electronFuses).toEqual({ runAsNode: true })
    expect(manifest.files).toEqual(expect.arrayContaining([
      'base-contract.json',
      'build/app-icon.png',
      'build/app-icon-mac.png',
      'build/tray-icon.svg',
      'build/tray-icon*.png',
      'docs/**',
      'lib/**/*.cjs',
    ]))
    expect(manifest.build?.files).toEqual([
      'base-contract.json',
      'build/e-mate-profile/**',
      'build/app-icon.png',
      'build/app-icon-mac.png',
      'build/tray-icon.svg',
      'build/tray-icon*.png',
      'cordis.patch.yml',
      'lib/**',
      'package.json',
      'node_modules/@earendil-works/pi-ai/dist/providers/data/.manifest.json',
      '!node_modules/node-pty/build/**',
      '!node_modules/**/node-pty/build/**',
    ])
    expect(manifest.build?.extraResources).toEqual([
      { from: 'build/python-runtime', to: 'python-runtime' },
    ])
    expect(manifest.build?.mac?.icon).toBe('build/app-icon-mac.png')
    expect(manifest.build?.mac?.mergeASARs).toBe(false)
    expect(manifest.build?.win?.icon).toBe('build/app-icon.png')
    expect(manifest.build?.win?.target).toEqual([{
      target: 'nsis',
      arch: ['x64'],
    }])
    expect(manifest.build?.nsis).toEqual({
      license: 'THIRD_PARTY_NOTICES.md',
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      differentialPackage: false,
      shortcutName: 'e-Mate',
      useZip: true,
      artifactName: 'e-Mate-${version}-win-${arch}-Setup.${ext}',
    })
    expect(manifest.build?.linux).toBeUndefined()
  })

  it('separates unsigned smoke packaging from the signed macOS release', () => {
    const packageDir = readFileSync(new URL('scripts/package-dir.mjs', packageRoot), 'utf8')

    expect(manifest.scripts?.['build:sdk']).toContain('node scripts/sync-emate-profile.mjs')
    expect(manifest.scripts?.['build:sdk']).not.toContain('sync-emate-plugin-bundles.mjs')
    expect(manifest.scripts?.['build:sdk']).toContain('node scripts/generate-mac-app-icon.mjs')
    expect(manifest.scripts?.['package:dir']).toBe('yarn run build && node scripts/package-dir.mjs')
    expect(packageDir).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'")
    expect(packageDir).toContain("import { prepareInstalledMacUniversalRuntime } from './mac-universal.ts'")
    expect(packageDir).toContain("if (process.platform === 'darwin') prepareInstalledMacUniversalRuntime(packageRoot)")
    expect(manifest.scripts?.['dist:mac']).toBe('node scripts/release-mac.ts')
    expect(manifest.scripts?.['dist:mac-unsigned-release']).toBe('node scripts/package-mac-unsigned-release.ts')
    expect(manifest.scripts?.['dist:mac-smoke']).toBe('node scripts/package-mac.ts')
    expect(manifest.scripts?.['dist:win']).toBe('node scripts/package-win.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run build')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run typecheck')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/e-mate-profile-win.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/package-win.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/update-checker.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/update-download.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('tests/windows-volume-diagnostics.spec.ts')
    expect(manifest.scripts?.['check:win-package']).toContain('yarn run verify:closure')
    expect(manifest.scripts?.['verify:cli']).toBe('node scripts/verify-cli-runtime.mjs')
    expect(manifest.scripts?.check).toContain('yarn run verify:cli')
    expect(workspaceManifest.scripts?.['dist:mac']).toBe('yarn workspace @e-mate/desktop dist:mac')
    expect(workspaceManifest.scripts?.['dist:mac-unsigned-release'])
      .toBe('yarn workspace @e-mate/desktop dist:mac-unsigned-release')
    expect(workspaceManifest.scripts?.['dist:mac-smoke'])
      .toBe('yarn workspace @e-mate/desktop dist:mac-smoke')
    expect(workspaceManifest.scripts?.['dist:win'])
      .toBe('yarn workspace @e-mate/desktop dist:win')
    expect(manifest.build?.afterPack).toBe('./scripts/verify-packaged-runtime.ts')
    expect(manifest.build?.mac).toEqual(expect.objectContaining({
      hardenedRuntime: true,
      mergeASARs: false,
      notarize: true,
      target: ['dir'],
      x64ArchFiles: expect.stringContaining('node-pty/prebuilds/darwin-*'),
    }))
    expect(String(manifest.build?.mac?.x64ArchFiles))
      .toContain('python-runtime/darwin-*/**')
    expect(String(manifest.build?.mac?.x64ArchFiles))
      .not.toContain('xin-assistant')
    expect(manifest.build?.files).toContain('!node_modules/node-pty/build/**')
    expect(manifest.build?.files).toContain('!node_modules/**/node-pty/build/**')
    expect(manifest.devDependencies?.['@electron/asar']).toBe('3.4.1')
  })

  it('keeps publishable macOS bytes isolated from the CI-only smoke output', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/desktop-release.yml', packageRoot), 'utf8')
    const signerPatch = readFileSync(new URL('../.yarn/patches/@electron-osx-sign-npm-1.3.3-sequential-walk.patch', packageRoot), 'utf8')

    expect(workflow).toContain('yarn dist:mac-unsigned-release')
    expect(workflow).toContain('dist/mac-unsigned-release/e-Mate-')
    expect(workflow).not.toContain('dist:mac-smoke')
    expect(workflow).not.toContain('/mac-smoke/')
    expect(workspaceManifest.resolutions?.['@electron/osx-sign@npm:1.3.3'])
      .toContain('@electron-osx-sign-npm-1.3.3-sequential-walk.patch')
    expect(signerPatch).toContain('for (const child of children)')
    expect(signerPatch).toContain('-        return await Promise.all(children.map(async (child) => {')
  })

  it('keeps one fixed e-Mate orange tray source for generated native assets', () => {
    const source = readFileSync(new URL('build/tray-icon.svg', packageRoot), 'utf8')

    expect(source.match(/#F06418/gu)).toHaveLength(1)
    expect(source).not.toMatch(/<style\b|prefers-color-scheme/iu)
    for (const filename of [
      'tray-iconTemplate.png',
      'tray-iconTemplate@2x.png',
      'tray-icon-blue.png',
      'tray-icon-blue@1.25x.png',
      'tray-icon-blue@1.5x.png',
      'tray-icon-blue@2x.png',
    ]) {
      expect(readFileSync(new URL(`build/${filename}`, packageRoot)).byteLength).toBeGreaterThan(0)
    }
  })

  it('generates rounded cross-platform and inset macOS application icons', async () => {
    const sourceFile = readFileSync(new URL('build/app-icon.png', packageRoot))
    const source = await sharp(sourceFile).metadata()
    const sourcePixels = await sharp(sourceFile).ensureAlpha().raw().toBuffer()
    const icon = sharp(readFileSync(new URL('build/app-icon-mac.png', packageRoot)))
    const metadata = await icon.metadata()
    const { info } = await icon
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 0 })
      .toBuffer({ resolveWithObject: true })

    expect(metadata).toEqual(expect.objectContaining({
      format: 'png',
      width: 1024,
      height: 1024,
      space: 'rgb16',
      depth: 'ushort',
      bitsPerSample: 16,
      channels: 4,
      hasAlpha: true,
    }))
    expect(metadata.icc).toEqual(source.icc)
    expect(sourcePixels[3]).toBe(0)
    expect(sourcePixels[(512 * 1024 + 512) * 4 + 3]).toBe(255)
    expect(info.width).toBeLessThan(824)
    expect(info.width).toBeGreaterThan(700)
    expect(info.height).toBe(info.width)
  })

  it('keeps Electron out of production dependencies consumed by electron-builder', () => {
    expect(manifest.dependencies).not.toHaveProperty('electron')
    expect(manifest.peerDependencies?.electron).toBe('43.4.0')
    expect(manifest.devDependencies?.electron).toBe('43.4.0')
    expect(manifest.dependencies?.pnpm).toBe('11.7.0')
  })

  it('packages the native-compiled Koffi Windows runtime', () => {
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')

    expect(manifest.dependencies?.koffi).toBe('3.1.5')
    expect(workspaceManifest.resolutions).toMatchObject({
      'koffi@npm:^3.1.0': '3.1.5',
    })
    expect(lockfile).toContain('"koffi@npm:3.1.5":')
    expect(lockfile).toContain('@koromix/koffi-win32-x64@npm:3.1.5')
    expect(lockfile).not.toContain('"koffi@npm:3.1.4":')
    expect(lockfile).not.toContain('@koromix/koffi-win32-x64@npm:3.1.4')
  })

  it('keeps the DSH node-pty runtime from duplicating an already-unpacked ASAR helper path', () => {
    const runtimePatch = 'patch:node-pty@npm%3A1.2.0-beta.15#./.yarn/patches/node-pty-npm-1.2.0-beta.15-asar-unpacked-path.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const patch = readFileSync(
      new URL('.yarn/patches/node-pty-npm-1.2.0-beta.15-asar-unpacked-path.patch', workspaceRoot),
      'utf8',
    )
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const installed = readFileSync(workspaceRequire.resolve('node-pty/lib/unixTerminal.js'), 'utf8')

    expect(workspaceManifest.resolutions).toMatchObject({
      'node-pty@npm:1.2.0-beta.15': runtimePatch,
    })
    expect(lockfile).toContain('node-pty@patch:node-pty@npm%3A1.2.0-beta.15#./.yarn/patches/node-pty-npm-1.2.0-beta.15-asar-unpacked-path.patch')
    expect(patch).toContain("path.sep + 'app.asar' + path.sep")
    expect(installed).toContain("path.sep + 'app.asar' + path.sep")
    expect(installed).not.toContain("replace('app.asar', 'app.asar.unpacked')")
    expect(manifest.dependencies).not.toHaveProperty('dsh-better-sidebar')
    expect(workspaceManifest.resolutions).not.toHaveProperty('node-pty@npm:^1.1.0')
    expect(lockfile).not.toContain('dsh-better-sidebar@')
  })

  it('resolves electron-builder through the pinned app-builder-lib keychain patch', () => {
    const patchResolution = 'patch:app-builder-lib@npm%3A26.15.3#./patches/app-builder-lib@26.15.3.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const patch = readFileSync(new URL('patches/app-builder-lib@26.15.3.patch', workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const electronBuilderManifest = workspaceRequire.resolve('electron-builder/package.json')
    const electronBuilderRequire = createRequire(electronBuilderManifest)
    const appBuilderManifest = electronBuilderRequire.resolve('app-builder-lib/package.json')
    const installedCodeSign = readFileSync(join(dirname(appBuilderManifest), 'out/codeSign/macCodeSign.js'), 'utf8')

    expect(workspaceManifest.resolutions).toMatchObject({
      'app-builder-lib@npm:26.15.3': patchResolution,
    })
    expect(lockfile).toContain('app-builder-lib@patch:app-builder-lib@npm%3A26.15.3#./patches/app-builder-lib@26.15.3.patch')
    expect(patch).toContain('importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)')
    expect(patch).toContain('"-k", keychainPassword, keychainFile')
    expect(installedCodeSign).toContain('importCerts(keychainFile, certPaths, cscPasswords, keychainPassword)')
    expect(installedCodeSign).toContain('"-k", keychainPassword, keychainFile')
  })

  it('starts restricted Windows shells with a hidden console show state', () => {
    const patchResolution = 'patch:@deepseek-ai/dsh-sandbox-windows-acl@npm%3A0.1.0-rc.7#./patches/dsh-sandbox-windows-acl@0.1.0-rc.7.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const patch = readFileSync(new URL('patches/dsh-sandbox-windows-acl@0.1.0-rc.7.patch', workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const sandboxManifest = workspaceRequire.resolve('@deepseek-ai/dsh-sandbox-windows-acl/package.json')
    const sandboxLocalManifest = workspaceRequire.resolve('@deepseek-ai/dsh-sandbox-local/package.json')
    const sandboxLocalRequire = createRequire(sandboxLocalManifest)
    const sandboxLib = join(dirname(sandboxManifest), 'lib')
    const runtimeChunks = readdirSync(sandboxLib).filter(name => /^types-.*\.js$/u.test(name))

    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-sandbox-windows-acl@npm:0.1.0-rc.7': patchResolution,
      '@deepseek-ai/dsh-sandbox-windows-acl@npm:^0.1.0-rc.7': patchResolution,
    })
    expect(sandboxLocalRequire.resolve('@deepseek-ai/dsh-sandbox-windows-acl/package.json'))
      .toBe(sandboxManifest)
    expect(lockfile).toContain('@deepseek-ai/dsh-sandbox-windows-acl@patch:@deepseek-ai/dsh-sandbox-windows-acl@npm%3A0.1.0-rc.7#./patches/dsh-sandbox-windows-acl@0.1.0-rc.7.patch')
    expect(patch.match(/^\+\s*dwFlags: 257,\r?$/gmu)).toHaveLength(2)
    expect(patch.match(/^\+\s*wShowWindow: 0,\r?$/gmu)).toHaveLength(2)
    expect(runtimeChunks).toHaveLength(1)
    const installedRuntime = readFileSync(join(sandboxLib, runtimeChunks[0] as string), 'utf8')
    expect(installedRuntime.match(/dwFlags: 257,/gu)).toHaveLength(2)
    expect(installedRuntime.match(/wShowWindow: 0,/gu)).toHaveLength(2)
    expect(installedRuntime).toContain('api.createProcessAsUserW(token, null, commandLine, null, null, 1, 0, null')
    expect(installedRuntime).toContain('api.createProcessAsUserW(token, null, commandLine, null, null, 1, 4, null')
    expect(installedRuntime).not.toContain('134217728')
  })

  it('ignores redundant shell escalation metadata under the current policy', () => {
    const bashPatch = 'patch:@deepseek-ai/dsh-tool-bash@npm%3A0.1.0-rc.7#~/.yarn/patches/@deepseek-ai-dsh-tool-bash-npm-0.1.0-rc.7-b4db1f9f9e.patch'
    const pwshPatch = 'patch:@deepseek-ai/dsh-tool-pwsh@npm%3A0.1.0-rc.7#~/.yarn/patches/@deepseek-ai-dsh-tool-pwsh-npm-0.1.0-rc.7-5c1a523622.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))

    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-tool-bash@npm:^0.1.0-rc.7': bashPatch,
      '@deepseek-ai/dsh-tool-pwsh@npm:^0.1.0-rc.7': pwshPatch,
    })
    expect(lockfile).toContain('@deepseek-ai/dsh-tool-bash@patch:@deepseek-ai/dsh-tool-bash@npm%3A0.1.0-rc.7#~/.yarn/patches/')
    expect(lockfile).toContain('@deepseek-ai/dsh-tool-pwsh@patch:@deepseek-ai/dsh-tool-pwsh@npm%3A0.1.0-rc.7#~/.yarn/patches/')
    for (const packageName of ['@deepseek-ai/dsh-tool-bash', '@deepseek-ai/dsh-tool-pwsh']) {
      const packageManifest = workspaceRequire.resolve(`${packageName}/package.json`)
      const installed = readFileSync(join(dirname(packageManifest), 'lib/index.js'), 'utf8')
      expect(installed).toContain('const redundantEscalation =')
      expect(installed).toContain('if (!redundantEscalation) validateEscalationArgs(')
    }
  })

  it('ignores redundant filesystem escalation metadata under the current policy', () => {
    const fsPatch = 'patch:@deepseek-ai/dsh-tool-fs@npm%3A0.1.0-rc.7#~/.yarn/patches/@deepseek-ai-dsh-tool-fs-npm-0.1.0-rc.7-redundant-escalation.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))

    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-tool-fs@npm:^0.1.0-rc.7': fsPatch,
    })
    expect(lockfile).toContain('@deepseek-ai/dsh-tool-fs@patch:@deepseek-ai/dsh-tool-fs@npm%3A0.1.0-rc.7#~/.yarn/patches/')
    const packageManifest = workspaceRequire.resolve('@deepseek-ai/dsh-tool-fs/package.json')
    const installed = readFileSync(join(dirname(packageManifest), 'lib/index.js'), 'utf8')
    expect(installed).toContain('const redundantEscalation =')
    expect(installed).toContain('if (!redundantEscalation) validateEscalationArgs(')
    expect(installed).toContain('args.justification === void 0 || redundantEscalation')
  })

  it('packages the native Session envelope and exact legacy image reader', () => {
    const sessionPatch = '@deepseek-ai-dsh-session-npm-0.1.0-rc.7-ignorable.patch'
    const persistencePatch = '@deepseek-ai-dsh-session-persistence-npm-0.1.0-rc.7-emate-image.patch'
    const lockfile = readFileSync(new URL('yarn.lock', workspaceRoot), 'utf8')

    expect(workspaceManifest.resolutions).toMatchObject({
      '@deepseek-ai/dsh-session@npm:0.1.0-rc.7': expect.stringContaining(sessionPatch),
      '@deepseek-ai/dsh-session@npm:^0.1.0-rc.7': expect.stringContaining(sessionPatch),
      '@deepseek-ai/dsh-session-persistence@npm:0.1.0-rc.7': expect.stringContaining(persistencePatch),
      '@deepseek-ai/dsh-session-persistence@npm:^0.1.0-rc.7': expect.stringContaining(persistencePatch),
    })
    expect(lockfile).toContain('@deepseek-ai/dsh-session@patch:@deepseek-ai/dsh-session@npm%3A0.1.0-rc.7#~/.yarn/patches/')
    expect(lockfile).toContain('@deepseek-ai/dsh-session-persistence@patch:@deepseek-ai/dsh-session-persistence@npm%3A0.1.0-rc.7#~/.yarn/patches/')

    const session = Session.create('session-desktop-package-test' as never)
    const append = session.append as unknown as (
      type: string,
      data: unknown,
      options: { ignorable: true },
    ) => { ignorable?: true }
    expect(append.call(session, 'emate/image-output', { attachmentId: 'image-1' }, { ignorable: true }))
      .toMatchObject({ ignorable: true })

    type EventValidator = {
      backend: { locate: () => undefined }
      assertEventsSupported(meta: { id: string }, events: readonly { type: string; seq: number }[]): void
    }
    const validator = Object.create(PersistenceCoordinator.prototype) as EventValidator
    validator.backend = { locate: () => undefined }
    expect(() => validator.assertEventsSupported(
      { id: 'session-desktop-package-test' },
      [{ type: 'emate/image-output', seq: 105 }],
    )).not.toThrow()
    expect(() => validator.assertEventsSupported(
      { id: 'session-desktop-package-test' },
      [{ type: 'future/required-event', seq: 106 }],
    )).toThrow(/future\/required-event/u)
  })
})
