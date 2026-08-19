/** Headless smoke for the complete published DSH Web profile and renderer manifest. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { runInThisContext } from 'node:vm'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'
import {
  EMATE_UPDATEABLE_PROFILE_COMPONENT_IDS,
  installEmateDesktopProfile,
} from '../lib/e-mate-profile.js'
import { installProfilePackageResolver } from '../lib/module-resolution.js'
import { prepareDesktopProfile } from '../lib/profile.js'
import { loadProfileGeneration } from '../src/profile-generation.ts'
import { loadProfileBaseContract } from '../src/profile-release.ts'

const BIN_NAME = '@e-mate/desktop-profile-smoke'
const { values: generationOptions } = parseArgs({
  options: {
    store: { type: 'string' },
    generation: { type: 'string' },
    base: { type: 'string' },
    target: { type: 'string' },
  },
})
const generationArguments = [
  generationOptions.store,
  generationOptions.generation,
  generationOptions.base,
  generationOptions.target,
]
if (generationArguments.some(value => value !== undefined)
  && generationArguments.some(value => value === undefined)) {
  throw new Error('generation smoke requires --store, --generation, --base, and --target together')
}
const selectedTarget = generationOptions.target === undefined
  ? { platform: 'win32', arch: 'x64' }
  : (() => {
      const match = /^(darwin)-(arm64|x64)$|^(win32)-(x64)$/u.exec(generationOptions.target)
      if (match === null) throw new Error(`unsupported generation smoke target: ${generationOptions.target}`)
      return { platform: match[1] ?? match[3], arch: match[2] ?? match[4] }
    })()
const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-'))
let ctx
let releasePackageResolver
let pnpmRuntime
let mountedSpec
let nativeThemeSource = 'system'
const trayItems = []

try {
  // Deliberately inject stale target state: the e-Mate desktop must still boot
  // its fixed compatibility profile without exposing a mode selector.
  writeFileSync(join(home, 'settings.yaml'), 'dsh-desktop:\n  mode: advanced\n')
  const selectedBase = generationOptions.base === undefined
    ? undefined
    : loadProfileBaseContract(generationOptions.base)
  const selectedGeneration = generationOptions.store === undefined
    ? undefined
    : await loadProfileGeneration({
        root: generationOptions.store,
        id: generationOptions.generation,
        base: selectedBase,
        expected_component_ids: EMATE_UPDATEABLE_PROFILE_COMPONENT_IDS,
        target: selectedTarget,
      })
  installEmateDesktopProfile(home, undefined, selectedGeneration === undefined ? undefined : {
    id: selectedGeneration.id,
    componentDirectories: selectedGeneration.component_directories,
  })
  const prepared = prepareDesktopProfile('1', home, selectedTarget.platform)
  const packageRoot = new URL('../', import.meta.url)
  const pnpmBinPath = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
  const electronVersion = JSON.parse(
    readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8'),
  ).version
  pnpmRuntime = installDesktopPnpmRuntime({
    platform: process.platform,
    appExecutable: process.execPath,
    pnpmBinPath,
    electronVersion,
    stateDir: join(home, 'runtime-commands'),
    environment: process.env,
  })
  releasePackageResolver = installProfilePackageResolver(
    prepared.bareModuleBaseUrl,
    selectedGeneration?.component_directories.values(),
    selectedBase?.runtime_imports,
  )
  const runtime = {
    platform: selectedTarget.platform,
    updates: {
      isPackaged: false,
      canDownload: true,
      currentVersion: '2.0.0',
      statePath: join(home, 'update-state.json'),
      request: async () => { throw new Error('profile smoke must not perform update requests') },
      confirmDownload: async () => false,
      showManualCheckResult: async () => {},
      downloadAndOpen: async () => {},
      notify: () => {},
    },
    schedule(spec) {
      mountedSpec = spec
      return async () => {}
    },
    async mountScheduled() {
      if (mountedSpec === undefined) throw new Error('desktop shell was not registered')
      nativeThemeSource = mountedSpec.readThemeSource()
    },
    show() {},
    registerTrayItem(item) {
      trayItems.push(item)
      return {
        refresh() {},
        dispose() {
          const index = trayItems.indexOf(item)
          if (index >= 0) trayItems.splice(index, 1)
        },
      }
    },
    openTerminal() {},
    setThemeSource(source) { nativeThemeSource = source },
    async requestRestart() {},
    prepareToQuit() {},
  }
  ctx = await boot(
    BIN_NAME,
    prepared.rootConfig,
    [...prepared.patches, { id: 'webserver', config: { host: '127.0.0.1', port: 0 } }],
    async (host) => {
      host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([]))
      host.provide('desktopRuntime', runtime)
      host.provide('desktopPnpmBootstrap', {
        activeProfileName: 'e-mate',
        activeProfileDir: prepared.profile.dir,
        homeDir: prepared.homeDir,
        appExecutable: process.execPath,
        pnpmBinPath,
        electronVersion,
        nodeBinDir: pnpmRuntime.nodeBinDir,
        nodeShimPath: pnpmRuntime.nodeShimPath,
        clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
        dshBootstrapPath: fileURLToPath(new URL('../lib/desktop-cli.js', import.meta.url)),
        installRecoveryStatePath: join(home, 'plugin-install-recovery', 'state.json'),
        generationId: 'profile-smoke-generation-0001',
      })
      provideCmdline(host, {
        args: ['--host', '127.0.0.1', '--port', '0'],
        exit: () => {},
      })
    },
    prepared.bareModuleBaseUrl,
  )
  await runtime.mountScheduled()

  if (ctx.get('desktopPnpm') === undefined) {
    throw new Error('assembled desktop profile is missing the desktop pnpm Host capability')
  }
  const picker = ctx.directoryPicker.capability()
  const expectedPicker = selectedTarget.platform === 'darwin' ? 'native' : 'browse'
  if (picker.kind !== expectedPicker) {
    throw new Error(`assembled ${selectedTarget.platform} profile selected ${picker.kind} instead of ${expectedPicker} directory picker`)
  }
  if (picker.kind === 'browse') {
    const listing = await picker.list(home)
    if (listing.path !== home) {
      throw new Error(`assembled Windows browse picker listed ${listing.path} instead of ${home}`)
    }
  }

  const expectedUrl = `http://127.0.0.1:${String(ctx.webServer.port)}/?dsh-desktop-mode=compatibility&dsh-desktop-platform=${selectedTarget.platform}`
  if (mountedSpec?.url !== expectedUrl) {
    throw new Error(`desktop plugin produced an unexpected renderer URL: ${String(mountedSpec?.url)}`)
  }
  if (mountedSpec?.mode !== 'compatibility') {
    throw new Error(`desktop plugin produced an unexpected shell mode: ${String(mountedSpec?.mode)}`)
  }
  if (nativeThemeSource !== 'system') {
    throw new Error(`desktop plugin produced an unexpected native theme source: ${nativeThemeSource}`)
  }
  if (!trayItems.some(item => item.label() === 'Check for Updates…')) {
    throw new Error('assembled desktop profile is missing the update tray command')
  }
  if (process.platform !== 'linux'
    && !trayItems.some(item => item.label() === 'Open DSH Terminal')) {
    throw new Error('assembled desktop profile is missing the terminal tray command')
  }
  if (trayItems.some(item => item.label().startsWith('Profile:'))) {
    throw new Error('assembled e-Mate profile unexpectedly exposes a profile selector')
  }
  const response = await fetch(expectedUrl)
  const html = await response.text()
  if (response.status !== 200) {
    throw new Error(`assembled Web root returned HTTP ${String(response.status)}`)
  }
  const bootMatch = html.match(/window\.__DSH_BOOT__ = (\{.*?\})<\/script>/u)
  if (bootMatch?.[1] === undefined) {
    throw new Error('assembled Web root is missing window.__DSH_BOOT__')
  }
  const graph = JSON.parse(bootMatch[1])
  const ids = new Set(graph.entries.map(entry => entry.id))
  for (const id of [
    '@e-mate/desktop',
    '@e-mate/dsh-plugin-file-import',
    '@e-mate/dsh-plugin-skill-hub',
    '@kelearns/dsh-navigation-bar',
    '@omdsh-dev/dsh-genui',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-sidebar',
    selectedTarget.platform === 'darwin'
      ? '@deepseek-ai/dsh-client-ui-directory-picker-native'
      : '@deepseek-ai/dsh-client-ui-directory-picker-browse',
    'dsh-at-file',
    'dsh-better-sidebar',
    'dsh-file-viewer',
    'dsh-turn-fold',
    'dsh-visualize',
  ]) {
    if (!ids.has(id)) {
      throw new Error(`assembled compatibility Web graph is missing ${id}; got ${[...ids].sort().join(', ')}`)
    }
  }
  for (const id of [selectedTarget.platform === 'darwin'
    ? '@deepseek-ai/dsh-client-ui-directory-picker-browse'
    : '@deepseek-ai/dsh-client-ui-directory-picker-native']) {
    if (ids.has(id)) throw new Error(`assembled compatibility Web graph unexpectedly includes ${id}`)
  }
  if (globalThis.__ModuleLoader__ !== undefined || globalThis.window !== undefined) {
    throw new Error('client Loader smoke requires a clean Node global')
  }
  globalThis.window = globalThis
  const registered = new Set()
  globalThis.__ModuleLoader__ = {
    load(handoff) {
      if (typeof handoff?.id !== 'string' || typeof handoff.factory !== 'function' || registered.has(handoff.id)) {
        throw new Error(`client bundle registration is invalid: ${String(handoff?.id)}`)
      }
      registered.add(handoff.id)
    },
  }
  try {
    for (const entry of graph.entries) {
      const path = entry.url
      const url = new URL(path, expectedUrl)
      if (url.origin !== new URL(expectedUrl).origin) throw new Error(`client bundle escaped the loopback origin: ${url.href}`)
      const bundle = await fetch(url)
      if (bundle.status !== 200) throw new Error(`client bundle returned HTTP ${bundle.status}: ${url.href}`)
      runInThisContext(await bundle.text(), { filename: url.href })
      if (!registered.has(entry.id)) throw new Error(`client bundle did not register its graph id: ${entry.id}`)
    }
  } finally {
    delete globalThis.__ModuleLoader__
    delete globalThis.window
  }
} finally {
  await ctx?.fiber.dispose()
  releasePackageResolver?.()
  pnpmRuntime?.dispose()
  rmSync(home, { recursive: true, force: true })
}
