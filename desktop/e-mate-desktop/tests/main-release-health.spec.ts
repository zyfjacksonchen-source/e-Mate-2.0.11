import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const startup = vi.hoisted(() => ({
  boot: vi.fn(),
  exits: [] as number[],
  recover: vi.fn(),
  resume: vi.fn(),
  root: '',
  writeAck: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    exit: vi.fn(),
    getPath: vi.fn(() => startup.root),
    getVersion: vi.fn(() => '2.0.13'),
    isPackaged: false,
    off: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
    relaunch: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    setName: vi.fn(),
    whenReady: vi.fn(async () => {}),
  },
  BrowserWindow: class {},
  clipboard: {},
  dialog: { showMessageBox: vi.fn() },
  Menu: {},
  nativeImage: {},
  nativeTheme: {},
  net: { fetch: vi.fn() },
  Notification: class {},
  shell: { trashItem: vi.fn() },
  Tray: class {},
}))

vi.mock('@deepseek-ai/dsh-app-boot', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-app-boot')>(),
  boot: startup.boot,
  installFailLoud: vi.fn(),
  loadLayeredEnv: vi.fn(() => ({})),
  resolveProfileDir: vi.fn(),
}))

vi.mock('@deepseek-ai/dsh-home-paths', () => ({
  resolveDshHome: vi.fn(() => join(startup.root, 'dsh')),
}))

vi.mock('../src/desktop-runtime-environment.ts', () => ({
  installDesktopDshRuntime: vi.fn(),
  installDesktopPnpmRuntime: vi.fn(() => ({
    clearEnvironmentPath: join(startup.root, 'clear-environment.json'),
    dispose: vi.fn(),
    nodeBinDir: join(startup.root, 'node-bin'),
    nodeShimPath: join(startup.root, 'node'),
  })),
}))

vi.mock('../src/install-recovery.ts', () => ({
  desktopInstallRecoveryStatePath: vi.fn(() => join(startup.root, 'install-recovery.json')),
  DesktopInstallRecoveryStore: class {
    async claim() { return { action: 'none' } }
  },
}))

vi.mock('../src/packaged-runtime-path.ts', () => ({
  packagedDependencyPath: vi.fn(() => join(startup.root, 'pnpm.mjs')),
}))

vi.mock('../src/profile-manager.ts', () => ({
  beginDesktopProfileStartup: vi.fn(() => ({
    profileName: 'e-mate',
    state: { lastKnownGood: 'e-mate' },
  })),
  markDesktopProfileFailed: vi.fn(),
  markDesktopProfileHealthy: vi.fn(),
}))

vi.mock('../src/e-mate-profile.ts', () => ({
  EMATE_DESKTOP_PROFILE_VERSION: '2.0.13',
  EMATE_PROFILE_NAME: 'e-mate',
  EMATE_UPDATEABLE_PROFILE_COMPONENT_IDS: [],
  emateProfileComponentSources: vi.fn(() => []),
  installEmateDesktopProfile: vi.fn(),
}))

vi.mock('../src/mac-update-installer.ts', () => ({
  readMacUpdateStartupResult: vi.fn(),
  recoverPendingMacUpdateStartup: startup.recover,
  resumePendingMacUpdateStartup: startup.resume,
  writeMacUpdateStartupAck: startup.writeAck,
}))

vi.mock('../src/profile.ts', () => ({
  prepareDesktopProfile: vi.fn(() => ({
    bareModuleBaseUrl: pathToFileURL(join(startup.root, 'profile', 'package.json')).href,
    homeDir: join(startup.root, 'dsh'),
    mode: 'advanced',
    patches: [],
    profile: { dir: join(startup.root, 'profile') },
    rootConfig: join(startup.root, 'profile', 'root.yml'),
    skippedOptionalEntries: [],
  })),
}))

vi.mock('../src/profile-generation.ts', () => ({
  BUNDLED_PROFILE_GENERATION: 'bundled',
  markProfileGenerationFailed: vi.fn(),
  markProfileGenerationHealthy: vi.fn(),
  resolveProfileGenerationStartup: vi.fn(async () => ({
    generation: undefined,
    generation_id: 'bundled',
    rolled_back_from: [],
    state: { active: 'bundled', last_known_good: 'bundled' },
  })),
}))

vi.mock('../src/profile-release.ts', () => ({
  loadProfileBaseContract: vi.fn(() => ({
    runtime_imports: {},
    schedule_protocol_floor: 1,
  })),
  profileReleaseTarget: vi.fn(() => ({ arch: 'arm64', platform: 'darwin' })),
}))

vi.mock('../src/module-resolution.ts', () => ({
  installProfilePackageResolver: vi.fn(() => vi.fn()),
}))

vi.mock('../src/vision-toolkit.ts', () => ({
  bundledPythonPath: vi.fn(() => new URL('../package.json', import.meta.url).pathname),
}))

vi.mock('../src/shell-environment.ts', () => ({
  resolveDesktopShellEnvironment: vi.fn(async () => ({ updates: {} })),
}))

vi.mock('../src/shutdown.ts', () => ({
  createDesktopExitCoordinator: vi.fn(() => ({
    finish: vi.fn(),
    requestRelaunch: vi.fn(),
  })),
  createDesktopShutdown: vi.fn(() => ({
    request: vi.fn(async (code: number) => { startup.exits.push(code) }),
  })),
  installShutdownRequests: vi.fn(() => vi.fn()),
}))

vi.mock('../src/windows-volume-diagnostics.ts', () => ({
  diagnoseWindowsVolumes: vi.fn(() => []),
  formatWindowsVolumeConcern: vi.fn(),
}))

const acknowledgementKeys = [
  'EMATE_MAC_UPDATE_ACK_PATH',
  'EMATE_MAC_UPDATE_ACK_TOKEN',
  'EMATE_MAC_UPDATE_ACK_VERSION',
  'EMATE_MAC_UPDATE_ACK_TRANSACTION_ID',
] as const
const savedEnvironment = Object.fromEntries(
  ['EMATE_RELEASE_HEALTH_PROBE', ...acknowledgementKeys].map(key => [key, process.env[key]]),
)
const savedElectronVersion = Object.getOwnPropertyDescriptor(process.versions, 'electron')

beforeEach(() => {
  startup.exits.length = 0
  startup.root = mkdtempSync(join(tmpdir(), 'e-mate-main-probe-'))
  const profile = join(startup.root, 'profile')
  const schedule = join(profile, 'node_modules', '@deepseek-ai', 'dsh-schedule')
  mkdirSync(schedule, { recursive: true })
  writeFileSync(join(profile, 'package.json'), '{}\n')
  writeFileSync(join(schedule, 'package.json'), '{"name":"@deepseek-ai/dsh-schedule","type":"module","main":"index.js"}\n')
  writeFileSync(join(schedule, 'index.js'), 'export const fixture = true\n')
  startup.boot.mockReset()
  startup.recover.mockReset().mockReturnValue({ status: 'none' })
  startup.resume.mockReset()
  startup.writeAck.mockReset()
  Object.defineProperty(process.versions, 'electron', { configurable: true, value: '43.4.0' })
  for (const key of acknowledgementKeys) delete process.env[key]
  process.env.EMATE_RELEASE_HEALTH_PROBE = '1'
  vi.resetModules()
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

afterEach(() => {
  rmSync(startup.root, { recursive: true, force: true })
  for (const key of ['EMATE_RELEASE_HEALTH_PROBE', ...acknowledgementKeys]) {
    const value = savedEnvironment[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  if (savedElectronVersion === undefined) delete (process.versions as { electron?: string }).electron
  else Object.defineProperty(process.versions, 'electron', savedElectronVersion)
  vi.restoreAllMocks()
})

describe('release health probe startup', () => {
  it.each([
    ['PATH only', { EMATE_MAC_UPDATE_ACK_PATH: '/tmp/startup-ack.json' }],
    ['TOKEN only', { EMATE_MAC_UPDATE_ACK_TOKEN: 'probe-token' }],
    ['VERSION only', { EMATE_MAC_UPDATE_ACK_VERSION: '2.0.13' }],
    ['TRANSACTION only', { EMATE_MAC_UPDATE_ACK_TRANSACTION_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    ['complete acknowledgement', {
      EMATE_MAC_UPDATE_ACK_PATH: '/tmp/startup-ack.json',
      EMATE_MAC_UPDATE_ACK_TOKEN: 'probe-token',
      EMATE_MAC_UPDATE_ACK_VERSION: '2.0.13',
      EMATE_MAC_UPDATE_ACK_TRANSACTION_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }],
  ])('fails closed for a health probe with %s', async (_label, environment) => {
    Object.assign(process.env, environment)

    await import('../src/main.ts')
    await vi.waitFor(() => { expect(startup.exits).toEqual([1]) })

    const nativeReadyAck = join(startup.root, '.release-native-ready-ack')
    const healthFailure = join(startup.root, '.release-health-failure')
    expect(existsSync(nativeReadyAck)).toBe(false)
    expect(readFileSync(healthFailure, 'utf8'))
      .toContain('a macOS update startup cannot run as a release health probe')
  })
})

describe('Schedule startup admission wiring', () => {
  it('does not require the old Base admission export for ordinary startup', async () => {
    delete process.env.EMATE_RELEASE_HEALTH_PROBE
    startup.boot.mockRejectedValueOnce(new Error('ordinary boot stopped'))

    await import('../src/main.ts')
    await vi.waitFor(() => { expect(startup.exits).toEqual([1]) })

    expect(startup.boot).toHaveBeenCalledOnce()
    expect(startup.writeAck).not.toHaveBeenCalled()
    expect(startup.resume).not.toHaveBeenCalled()
    expect(process.stderr.write).not.toHaveBeenCalledWith(
      expect.stringContaining('selected Base Schedule package has no delivery admission'),
    )
  })

  it.each(['acknowledgement', 'forward-resume'] as const)(
    'fails closed before boot or acknowledgement when the %s probation Base lacks native admission',
    async (mode) => {
      delete process.env.EMATE_RELEASE_HEALTH_PROBE
      if (mode === 'acknowledgement') {
        Object.assign(process.env, {
          EMATE_MAC_UPDATE_ACK_PATH: '/tmp/startup-ack.json',
          EMATE_MAC_UPDATE_ACK_TOKEN: 'probe-token',
          EMATE_MAC_UPDATE_ACK_VERSION: '2.0.13',
          EMATE_MAC_UPDATE_ACK_TRANSACTION_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        })
      } else {
        startup.recover.mockReturnValue({ status: 'forward-resume' })
      }

      await import('../src/main.ts')
      await vi.waitFor(() => { expect(startup.exits).toEqual([1]) })

      expect(startup.boot).not.toHaveBeenCalled()
      expect(startup.writeAck).not.toHaveBeenCalled()
      expect(startup.resume).not.toHaveBeenCalled()
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('selected Base Schedule package has no delivery admission'),
      )
    },
  )
})
