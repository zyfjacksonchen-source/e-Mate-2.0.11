import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopNotification,
  DesktopRuntime,
  DesktopTrayItem,
} from '../src/runtime.ts'
import type { DesktopReleaseSigningKey, UpdateCheckResult } from '../src/update-checker.ts'
import type { DesktopProfileUpdateAdapter, ProfileUpdateAvailable } from '../src/profile-update.ts'
import { apply, Config, inject, type Config as UpdateConfig, type InteractiveUpdateResult } from '../src/updates.ts'

const testConfig: UpdateConfig = {
  enabled: true,
  initialDelayMs: 10,
  intervalMs: 1000,
  requestTimeoutMs: 1000,
}

const BUNDLED_TO_B_PROMPT = 'bf9e83d3eefba3bcb20cc11f9640d2c598ae6e83bee5c53b5d4d94ce1291322b'
const A_TO_B_PROMPT = 'edfff6d9f21745628565983c573472d57fc10650e1012559c479626b2f193f59'
const C_TO_B_PROMPT = '6dc1916effcc7915941805b471f2a06c5f5a8b290592417f4cfd0c1db4bdd372'

const SOURCE_COMMIT = 'a'.repeat(40)
const MANIFEST_SIGNATURE_CONTEXT = Buffer.from('e-mate-desktop-release-manifest-v1\0', 'utf8')
const { privateKey: manifestPrivateKey, publicKey: manifestPublicKey } = generateKeyPairSync('ed25519')
const TRUSTED_MANIFEST_KEYS: readonly DesktopReleaseSigningKey[] = [{
  id: 'desktop-release-test-key',
  algorithm: 'ed25519',
  public_key_spki_der_base64: manifestPublicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
}]

function versionResponse(
  version: unknown,
  scheduleProtocolFloor: unknown = 1,
  mutate?: (manifest: Record<string, any>) => void,
): Response {
  const manifest = versionManifest(version, scheduleProtocolFloor)
  if (mutate === undefined) return Response.json(manifest)
  const { signature: _, ...unsigned } = manifest
  mutate(unsigned)
  return Response.json(signManifest(unsigned))
}

function versionManifest(version: unknown, scheduleProtocolFloor: unknown = 1): Record<string, any> {
  const release = typeof version === 'string' ? version : 'invalid'
  return signManifest({
    schema_version: 1,
    document_type: 'emate.desktop-release-manifest',
    release_status: 'admitted',
    version,
    source_commit: SOURCE_COMMIT,
    base_contract_id: 'e-mate-desktop-profile-v7-dsh-2bc16230975f',
    schedule_protocol_floor: scheduleProtocolFloor,
    profile_component_aggregate: {
      aggregate_sha256: '1'.repeat(64),
      inventory_sha256: '2'.repeat(64),
      staged_profile_tree_sha256: '3'.repeat(64),
      targets: ['darwin-arm64', 'darwin-x64', 'win32-x64'].map(target => ({
        target,
        profile_generation: '5'.repeat(64),
        component_aggregate_sha256: '6'.repeat(64),
      })),
    },
    performance: {
      performance_run_id: 'performance-run-id',
      admission_sha256: '4'.repeat(64),
      signature_key_id: '0123456789abcdef',
      verifier: {},
    },
    github_artifact_provenance: {
      schema_version: 1,
      document_type: 'emate.github-artifact-provenance',
      source_commit: SOURCE_COMMIT,
      artifacts: [
        { role: 'desktop_candidate', name: `e-mate-desktop-release-${SOURCE_COMMIT}`, artifact_id: '11', digest: `sha256:${'7'.repeat(64)}`, run_id: '123', run_attempt: 1 },
        { role: 'performance_admission', name: `e-mate-performance-admission-${SOURCE_COMMIT}-attempt-1`, artifact_id: '12', digest: `sha256:${'8'.repeat(64)}`, run_id: '124', run_attempt: 1 },
      ],
    },
    artifacts: {
      darwin: {
        url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v${encodeURIComponent(release)}/${SOURCE_COMMIT}/e-Mate-${release}-mac-universal.dmg`,
        bytes: 1024,
        sha256: '0'.repeat(64),
        build_source_commit: SOURCE_COMMIT,
        build_run_id: '123',
      },
      win32: {
        url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v${encodeURIComponent(release)}/${SOURCE_COMMIT}/e-Mate-${release}-win-x64-Setup.exe`,
        bytes: 1024,
        sha256: '0'.repeat(64),
        build_source_commit: SOURCE_COMMIT,
        build_run_id: '456',
      },
    },
  })
}

function signManifest(manifest: Record<string, any>): Record<string, any> {
  return {
    ...manifest,
    signature: {
      algorithm: 'ed25519',
      key_id: TRUSTED_MANIFEST_KEYS[0]!.id,
      value: sign(
        null,
        Buffer.concat([MANIFEST_SIGNATURE_CONTEXT, Buffer.from(canonicalJson(manifest), 'utf8')]),
        manifestPrivateKey,
      ).toString('base64'),
    },
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function profileUpdate(currentGeneration: string, generationId = 'b'.repeat(64)): ProfileUpdateAvailable {
  return {
    status: 'update-available',
    currentGeneration,
    currentSequence: currentGeneration === 'bundled' ? 0 : 3,
    generationId,
    releaseVersion: '2.0.12',
    sequence: 4,
    changedComponents: [{ id: '@e-mate/dsh-client-shell', version: '2.0.12', bytes: 99 }],
    downloadBytes: 99,
    release: {} as ProfileUpdateAvailable['release'],
  }
}

function parseWithOldBaseV2Reader(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid state')
  const record = value as Record<string, unknown>
  if (record.version !== 2
    || (record.lastPromptedVersion !== undefined && typeof record.lastPromptedVersion !== 'string')
    || (record.lastPromptedGeneration !== undefined
      && (typeof record.lastPromptedGeneration !== 'string' || !/^[0-9a-f]{64}$/u.test(record.lastPromptedGeneration)))
    || Object.keys(record).some(key => !['version', 'lastPromptedVersion', 'lastPromptedGeneration'].includes(key))) {
    throw new Error('invalid state')
  }
  return record
}

interface Harness {
  readonly statePath: string
  readonly tray: DesktopTrayItem
  readonly notifications: DesktopNotification[]
  readonly warnings: unknown[][]
  readonly confirmDownload: ReturnType<typeof vi.fn>
  readonly showManualCheckResult: ReturnType<typeof vi.fn>
  readonly downloadAndOpen: ReturnType<typeof vi.fn>
  readonly refresh: ReturnType<typeof vi.fn>
  readonly registrationDispose: ReturnType<typeof vi.fn>
  runInteractiveUpdate(): Promise<InteractiveUpdateResult>
  dispose(): Promise<void>
}

async function createHarness(options: {
  readonly packaged?: boolean
  readonly canDownload?: boolean
  readonly config?: UpdateConfig
  readonly request?: DesktopRuntime['updates']['request']
  readonly confirmDownload?: (version: string) => Promise<boolean>
  readonly showManualCheckResult?: (result: UpdateCheckResult | null) => Promise<void>
  readonly downloadAndOpen?: DesktopRuntime['updates']['downloadAndOpen']
  readonly notify?: (notification: DesktopNotification) => void
  readonly profile?: DesktopProfileUpdateAdapter
  readonly state?: string
  readonly currentScheduleProtocolFloor?: number
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-updates-'))
  const statePath = join(root, 'private', 'state.json')
  if (options.state !== undefined) {
    await mkdir(join(root, 'private'), { recursive: true })
    await writeFile(statePath, options.state, { mode: 0o600 })
  }
  const notifications: DesktopNotification[] = []
  const warnings: unknown[][] = []
  const refresh = vi.fn()
  const registrationDispose = vi.fn()
  const confirmDownload = vi.fn(options.confirmDownload ?? (async () => false))
  const showManualCheckResult = vi.fn(options.showManualCheckResult ?? (async () => {}))
  const downloadAndOpen = vi.fn(options.downloadAndOpen ?? (async () => {}))
  let tray: DesktopTrayItem | undefined
  let disposer: (() => void | Promise<void>) | undefined
  const runtime = {
    updates: {
      isPackaged: options.packaged ?? true,
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: options.currentScheduleProtocolFloor ?? 1,
      trustedManifestKeys: TRUSTED_MANIFEST_KEYS,
      statePath,
      canDownload: options.canDownload ?? true,
      request: options.request ?? (async () => versionResponse('2.0.0')),
      ...(options.profile === undefined ? {} : { profile: options.profile }),
      confirmDownload,
      showManualCheckResult,
      downloadAndOpen,
      notify: options.notify ?? ((notification: DesktopNotification) => { notifications.push(notification) }),
    },
    registerTrayItem: (item: DesktopTrayItem) => {
      tray = item
      return { refresh, dispose: registrationDispose }
    },
  } as unknown as DesktopRuntime
  const ctx = {
    desktopRuntime: runtime,
    logger: { warn: (...args: unknown[]) => { warnings.push(args) } },
    provide: vi.fn((key: string, value: unknown) => { Object.assign(ctx, { [key]: value }) }),
    effect: (register: () => (() => void | Promise<void>)) => {
      disposer = register()
      return disposer
    },
  } as unknown as Context

  apply(ctx, options.config ?? testConfig)
  if (tray === undefined) throw new Error('Update tray item was not registered.')
  return {
    statePath,
    tray,
    notifications,
    warnings,
    confirmDownload,
    showManualCheckResult,
    downloadAndOpen,
    refresh,
    registrationDispose,
    runInteractiveUpdate: () => ctx.desktopUpdates.runInteractiveUpdate(),
    dispose: async () => { await disposer?.() },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('desktop update Host plugin', () => {
  it('uses the signed component updater first for a natural-language/manual request', async () => {
    const release = {
      status: 'update-available',
      currentGeneration: 'bundled',
      currentSequence: 0,
      generationId: 'a'.repeat(64),
      releaseVersion: '2.0.12',
      sequence: 2,
      changedComponents: [{ id: '@e-mate/dsh-plugin-memory-evolve', version: '2.0.12', bytes: 321 }],
      downloadBytes: 321,
      release: {} as ProfileUpdateAvailable['release'],
    } satisfies ProfileUpdateAvailable
    const profile = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => true),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const baseRequest = vi.fn(async () => versionResponse('2.1.0'))
    const harness = await createHarness({
      profile,
      request: baseRequest,
      config: { ...testConfig, initialDelayMs: 10_000 },
    })

    await expect(harness.runInteractiveUpdate()).resolves.toEqual({
      status: 'scheduled',
      installedVersion: '2.0.0',
      latestVersion: '2.0.12',
      updateKind: 'components',
      componentGeneration: release.generationId,
      components: ['@e-mate/dsh-plugin-memory-evolve'],
      downloadBytes: 321,
    })
    expect(profile.check).toHaveBeenCalledTimes(2)
    expect(profile.confirm).toHaveBeenCalledWith(release)
    expect(profile.install).toHaveBeenCalledOnce()
    await expect(stat(harness.statePath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(baseRequest).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('e-Mate 2.0.12 Update Available')
    expect(harness.tray.label()).not.toMatch(/@e-mate\/|dsh-plugin|component\.id|插件|组件/u)
  })

  it('stores a declined Profile pair that the old Base v2 reader accepts', async () => {
    vi.useFakeTimers()
    const release = {
      status: 'update-available',
      currentGeneration: 'bundled',
      currentSequence: 0,
      generationId: 'b'.repeat(64),
      releaseVersion: '2.0.12',
      sequence: 4,
      changedComponents: [{ id: '@e-mate/dsh-client-shell', version: '2.0.12', bytes: 99 }],
      downloadBytes: 99,
      release: {} as ProfileUpdateAvailable['release'],
    } satisfies ProfileUpdateAvailable
    const profile = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => false),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const harness = await createHarness({ profile })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(profile.confirm).toHaveBeenCalledOnce() })
    await vi.waitFor(async () => {
      expect(parseWithOldBaseV2Reader(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 2,
        lastPromptedGeneration: BUNDLED_TO_B_PROMPT,
      })
    })

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    await vi.waitFor(() => { expect(profile.check).toHaveBeenCalledTimes(2) })
    expect(profile.confirm).toHaveBeenCalledOnce()
    expect(profile.install).not.toHaveBeenCalled()
  })

  it('does not repeat a component prompt while the current and target generation pair is unchanged', async () => {
    vi.useFakeTimers()
    const release = {
      status: 'update-available',
      currentGeneration: 'bundled',
      currentSequence: 0,
      generationId: 'b'.repeat(64),
      releaseVersion: '2.0.12',
      sequence: 4,
      changedComponents: [{ id: '@e-mate/dsh-client-shell', version: '2.0.12', bytes: 99 }],
      downloadBytes: 99,
      release: {} as ProfileUpdateAvailable['release'],
    } satisfies ProfileUpdateAvailable
    const profile = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => false),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const harness = await createHarness({
      profile,
      state: JSON.stringify({
        version: 2,
        lastPromptedGeneration: BUNDLED_TO_B_PROMPT,
      }),
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(profile.check).toHaveBeenCalledOnce() })
    expect(profile.confirm).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
      version: 2,
      lastPromptedGeneration: BUNDLED_TO_B_PROMPT,
    })
  })

  it('prompts for the same target after the current generation rolls back to bundled', async () => {
    vi.useFakeTimers()
    const release = {
      status: 'update-available',
      currentGeneration: 'bundled',
      currentSequence: 0,
      generationId: 'b'.repeat(64),
      releaseVersion: '2.0.12',
      sequence: 4,
      changedComponents: [{ id: '@e-mate/dsh-client-shell', version: '2.0.12', bytes: 99 }],
      downloadBytes: 99,
      release: {} as ProfileUpdateAvailable['release'],
    } satisfies ProfileUpdateAvailable
    const profile = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => false),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const harness = await createHarness({
      profile,
      state: JSON.stringify({
        version: 2,
        lastPromptedGeneration: A_TO_B_PROMPT,
      }),
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(profile.confirm).toHaveBeenCalledOnce() })
    expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
      version: 2,
      lastPromptedGeneration: BUNDLED_TO_B_PROMPT,
    })
  })

  it('prompts for the same target after the current generation changes', async () => {
    vi.useFakeTimers()
    const release = {
      status: 'update-available',
      currentGeneration: 'c'.repeat(64),
      currentSequence: 3,
      generationId: 'b'.repeat(64),
      releaseVersion: '2.0.12',
      sequence: 4,
      changedComponents: [{ id: '@e-mate/dsh-client-shell', version: '2.0.12', bytes: 99 }],
      downloadBytes: 99,
      release: {} as ProfileUpdateAvailable['release'],
    } satisfies ProfileUpdateAvailable
    const profile = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => false),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const harness = await createHarness({
      profile,
      state: JSON.stringify({
        version: 2,
        lastPromptedGeneration: A_TO_B_PROMPT,
      }),
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(profile.confirm).toHaveBeenCalledOnce() })
    expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
      version: 2,
      lastPromptedGeneration: C_TO_B_PROMPT,
    })
  })

  it('migrates a target-only v2 state and prompts once from bundled', async () => {
    vi.useFakeTimers()
    const release = {
      status: 'update-available',
      currentGeneration: 'bundled',
      currentSequence: 0,
      generationId: 'b'.repeat(64),
      releaseVersion: '2.0.12',
      sequence: 4,
      changedComponents: [{ id: '@e-mate/dsh-client-shell', version: '2.0.12', bytes: 99 }],
      downloadBytes: 99,
      release: {} as ProfileUpdateAvailable['release'],
    } satisfies ProfileUpdateAvailable
    const profile = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => false),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const harness = await createHarness({
      profile,
      state: JSON.stringify({
        version: 2,
        lastPromptedVersion: '2.1.0',
        lastPromptedGeneration: release.generationId,
      }),
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(profile.confirm).toHaveBeenCalledOnce() })
    expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
      version: 2,
      lastPromptedVersion: '2.1.0',
      lastPromptedGeneration: BUNDLED_TO_B_PROMPT,
    })
  })

  it('does not suppress a real A to B retry after activation fails and remains on A', async () => {
    vi.useFakeTimers()
    const release = profileUpdate('a'.repeat(64))
    const profile = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => true),
      install: vi.fn(async () => { throw new Error('activation failed') }),
    } satisfies DesktopProfileUpdateAdapter
    const harness = await createHarness({ profile })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(profile.install).toHaveBeenCalledOnce() })
    await expect(stat(harness.statePath)).rejects.toMatchObject({ code: 'ENOENT' })

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    await vi.waitFor(() => { expect(profile.install).toHaveBeenCalledTimes(2) })
    expect(profile.confirm).toHaveBeenCalledTimes(2)
    await expect(stat(harness.statePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('clears an old A to B decline before scheduling so a failed B activation can retry from A', async () => {
    const release = profileUpdate('a'.repeat(64))
    const acceptedProfile = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => true),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const accepted = await createHarness({
      packaged: false,
      profile: acceptedProfile,
      state: JSON.stringify({ version: 2, lastPromptedGeneration: A_TO_B_PROMPT }),
    })

    await expect(accepted.runInteractiveUpdate()).resolves.toMatchObject({ status: 'scheduled' })
    const clearedState = await readFile(accepted.statePath, 'utf8')
    expect(parseWithOldBaseV2Reader(clearedState)).toEqual({ version: 2 })

    const rolledBackProfile = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => false),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const rolledBack = await createHarness({ profile: rolledBackProfile, state: clearedState })

    await vi.waitFor(() => { expect(rolledBackProfile.confirm).toHaveBeenCalledOnce() })
    expect(rolledBackProfile.install).not.toHaveBeenCalled()
    await vi.waitFor(async () => {
      expect(parseWithOldBaseV2Reader(await readFile(rolledBack.statePath, 'utf8'))).toEqual({
        version: 2,
        lastPromptedGeneration: A_TO_B_PROMPT,
      })
    })
  })

  it('does not persist a Profile pair when confirmation throws or the offer is superseded', async () => {
    const release = profileUpdate('a'.repeat(64))
    const throwing = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => { throw new Error('dialog failed') }),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const failed = await createHarness({
      packaged: false,
      profile: throwing,
      config: { ...testConfig, enabled: false },
    })

    await expect(failed.runInteractiveUpdate()).resolves.toMatchObject({ status: 'failed' })
    await expect(stat(failed.statePath)).rejects.toMatchObject({ code: 'ENOENT' })

    const rotated = profileUpdate('a'.repeat(64), 'c'.repeat(64))
    const supersededProfile = {
      check: vi.fn().mockResolvedValueOnce(release).mockResolvedValueOnce(rotated),
      confirm: vi.fn(async () => true),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const superseded = await createHarness({
      packaged: false,
      profile: supersededProfile,
      config: { ...testConfig, enabled: false },
    })

    await expect(superseded.runInteractiveUpdate()).resolves.toMatchObject({
      status: 'superseded',
      componentGeneration: rotated.generationId,
    })
    expect(supersededProfile.install).not.toHaveBeenCalled()
    await expect(stat(superseded.statePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not persist a declined Profile pair after the update owner is disposed', async () => {
    vi.useFakeTimers()
    const release = profileUpdate('a'.repeat(64))
    let resolveConfirmation!: (confirmed: boolean) => void
    const confirmation = new Promise<boolean>(resolve => { resolveConfirmation = resolve })
    const profile = {
      check: vi.fn(async () => release),
      confirm: vi.fn(async () => await confirmation),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const harness = await createHarness({ profile })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(profile.confirm).toHaveBeenCalledOnce() })
    await harness.dispose()
    resolveConfirmation(false)
    await Promise.resolve()
    await Promise.resolve()

    await expect(stat(harness.statePath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('serializes concurrent Base and Profile prompt writes without dropping either v2 field', async () => {
    vi.useFakeTimers()
    const release = profileUpdate('bundled')
    let resolveProfileConfirmation!: (confirmed: boolean) => void
    const profileConfirmation = new Promise<boolean>(resolve => { resolveProfileConfirmation = resolve })
    const profile = {
      check: vi.fn()
        .mockResolvedValueOnce(release)
        .mockRejectedValueOnce(new Error('Profile check unavailable')),
      confirm: vi.fn(async () => await profileConfirmation),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const harness = await createHarness({
      profile,
      request: async () => versionResponse('2.1.0'),
      confirmDownload: async () => false,
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(profile.confirm).toHaveBeenCalledOnce() })
    const basePrompt = harness.runInteractiveUpdate()
    resolveProfileConfirmation(false)
    await expect(basePrompt).resolves.toMatchObject({ status: 'declined', latestVersion: '2.1.0' })
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 2,
        lastPromptedVersion: '2.1.0',
        lastPromptedGeneration: BUNDLED_TO_B_PROMPT,
      })
    })
  })

  it('does not let one failed state write poison the next serialized mutation', async () => {
    const release = profileUpdate('bundled')
    let resolveProfileConfirmation!: (confirmed: boolean) => void
    const profileConfirmation = new Promise<boolean>(resolve => { resolveProfileConfirmation = resolve })
    const profile = {
      check: vi.fn()
        .mockResolvedValueOnce(release)
        .mockRejectedValueOnce(new Error('Profile check unavailable')),
      confirm: vi.fn(async () => await profileConfirmation),
      install: vi.fn(async () => {}),
    } satisfies DesktopProfileUpdateAdapter
    const harness = await createHarness({
      packaged: false,
      profile,
      state: JSON.stringify({ version: 2 }),
      request: async () => versionResponse('2.1.0'),
      confirmDownload: async () => false,
    })

    const profilePrompt = harness.runInteractiveUpdate()
    await vi.waitFor(() => { expect(profile.confirm).toHaveBeenCalledOnce() })
    await rm(harness.statePath)
    await mkdir(harness.statePath)
    resolveProfileConfirmation(false)
    await expect(profilePrompt).resolves.toMatchObject({ status: 'declined', updateKind: 'components' })
    await rm(harness.statePath, { recursive: true })

    await expect(harness.runInteractiveUpdate()).resolves.toMatchObject({ status: 'declined', latestVersion: '2.1.0' })
    expect(parseWithOldBaseV2Reader(await readFile(harness.statePath, 'utf8'))).toEqual({
      version: 2,
      lastPromptedVersion: '2.1.0',
      lastPromptedGeneration: BUNDLED_TO_B_PROMPT,
    })
  })

  it('reports Base-required when no compatible Desktop Base is published', async () => {
    const profile = {
      check: vi.fn(async () => ({
        status: 'base-required' as const,
        currentGeneration: 'bundled',
        currentSequence: 0,
        releaseVersion: '2.0.12',
        sequence: 3,
        requiredBaseContracts: ['e-mate-desktop-profile-v1-dsh-rc7'],
      })),
      confirm: vi.fn(),
      install: vi.fn(),
    } satisfies DesktopProfileUpdateAdapter
    const harness = await createHarness({ profile, request: async () => versionResponse('2.0.0') })

    await expect(harness.runInteractiveUpdate()).resolves.toEqual({
      status: 'base-required',
      installedVersion: '2.0.0',
      latestVersion: '2.0.12',
      requiredBaseContracts: ['e-mate-desktop-profile-v1-dsh-rc7'],
    })
    expect(profile.confirm).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([{
      title: '需要更新 e-Mate',
      body: 'e-Mate 2.0.12 需要更新应用版本后才能使用。',
    }])
  })

  it('exposes the packaged 60-second and six-hour background policy', () => {
    expect(inject).toEqual(['desktopRuntime'])
    expect(Config({} as UpdateConfig)).toEqual({
      enabled: true,
      initialDelayMs: 60_000,
      intervalMs: 21_600_000,
      requestTimeoutMs: 15_000,
    })
    expect(() => Config({ intervalMs: 0 } as UpdateConfig)).toThrow()
    expect(() => Config({ requestTimeoutMs: 0 } as UpdateConfig)).toThrow()
  })

  it.each([
    { packaged: false, enabled: true },
    { packaged: true, enabled: false },
  ])('reports a manual up-to-date result while automatic polling is disabled: %#', async ({ packaged, enabled }) => {
    vi.useFakeTimers()
    const request = vi.fn(async () => versionResponse('2.0.0'))
    const harness = await createHarness({
      packaged,
      request,
      config: { ...testConfig, enabled },
    })

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    expect(request).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('Check for Updates…')
    await expect(harness.runInteractiveUpdate()).resolves.toEqual({
      status: 'up-to-date',
      installedVersion: '2.0.0',
      latestVersion: '2.0.0',
    })
    expect(request).toHaveBeenCalledOnce()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith({
      status: 'up-to-date',
      currentVersion: '2.0.0',
      latestVersion: '2.0.0',
    })
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
  })

  it('prompts once for a background update and persists only state v2 prompt history', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => versionResponse('2.1.0'))
    const harness = await createHarness({ request })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.confirmDownload).toHaveBeenCalledWith('2.1.0') })
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('e-Mate 2.1.0 Available')
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 2,
        lastPromptedVersion: '2.1.0',
      })
    })
    if (process.platform !== 'win32') {
      expect((await stat(harness.statePath)).mode & 0o777).toBe(0o600)
    }

    await vi.advanceTimersByTimeAsync(testConfig.intervalMs)
    await vi.waitFor(() => { expect(request).toHaveBeenCalledTimes(2) })
    expect(harness.confirmDownload).toHaveBeenCalledOnce()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
  })

  it('downloads and opens only after confirmation', async () => {
    vi.useFakeTimers()
    let resolveDownload!: () => void
    const download = new Promise<void>(resolve => { resolveDownload = resolve })
    const harness = await createHarness({
      request: async () => versionResponse('2.1.0'),
      confirmDownload: async () => true,
      downloadAndOpen: async () => download,
    })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    const [update, signal] = harness.downloadAndOpen.mock.calls[0] as [
      Extract<UpdateCheckResult, { status: 'update-available' }>,
      AbortSignal,
    ]
    expect(update).toMatchObject({ latestVersion: '2.1.0', artifact: { bytes: 1024 } })
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    expect(harness.tray.label()).toBe('Downloading e-Mate 2.1.0…')
    expect(harness.notifications).toEqual([])

    resolveDownload()
    await vi.waitFor(() => { expect(harness.tray.label()).toBe('e-Mate 2.1.0 Available') })
    expect(harness.notifications).toEqual([])
    expect(harness.tray.label()).toBe('e-Mate 2.1.0 Available')
  })

  it('treats a manual available-version selection as a fresh confirmation', async () => {
    const confirmDownload = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      confirmDownload,
    })

    await expect(harness.runInteractiveUpdate()).resolves.toEqual({
      status: 'declined',
      installedVersion: '2.0.0',
      latestVersion: '2.1.0',
    })
    expect(confirmDownload).toHaveBeenCalledOnce()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('e-Mate 2.1.0 Available')

    await expect(harness.runInteractiveUpdate()).resolves.toEqual({
      status: 'scheduled',
      installedVersion: '2.0.0',
      latestVersion: '2.1.0',
    })
    expect(confirmDownload).toHaveBeenCalledTimes(2)
    expect(harness.downloadAndOpen).toHaveBeenCalledOnce()
    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
  })

  it('rechecks the version after confirmation and skips a rotated download', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(versionResponse('2.1.0'))
      .mockResolvedValueOnce(versionResponse('2.2.0'))
    const harness = await createHarness({
      packaged: false,
      request,
      confirmDownload: async () => true,
    })

    await expect(harness.runInteractiveUpdate()).resolves.toEqual({
      status: 'superseded',
      installedVersion: '2.0.0',
      latestVersion: '2.2.0',
    })

    expect(request).toHaveBeenCalledTimes(2)
    expect(harness.confirmDownload).toHaveBeenCalledWith('2.1.0')
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    expect(harness.tray.label()).toBe('e-Mate 2.2.0 Available')
  })

  it('fails closed before confirmation when the release is below the installed Schedule protocol floor', async () => {
    const request = vi.fn(async () => versionResponse('99.0.0', 1))
    const harness = await createHarness({
      config: { ...testConfig, enabled: false },
      currentScheduleProtocolFloor: 2,
      request,
      confirmDownload: async () => true,
    })

    await expect(harness.runInteractiveUpdate()).resolves.toEqual({
      status: 'failed',
      installedVersion: '2.0.0',
    })
    expect(request).toHaveBeenCalledOnce()
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
  })

  it('rechecks the Schedule protocol floor after confirmation', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(versionResponse('2.1.0', 2))
      .mockResolvedValueOnce(versionResponse('2.1.0', 3))
    const harness = await createHarness({
      config: { ...testConfig, enabled: false },
      currentScheduleProtocolFloor: 1,
      request,
      confirmDownload: async () => true,
    })

    await expect(harness.runInteractiveUpdate()).resolves.toEqual({
      status: 'superseded',
      installedVersion: '2.0.0',
      latestVersion: '2.1.0',
    })
    expect(harness.confirmDownload).toHaveBeenCalledOnce()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
  })

  it.each([
    ['Profile aggregate', (manifest: Record<string, any>) => { manifest.profile_component_aggregate.aggregate_sha256 = '9'.repeat(64) }],
    ['performance run', (manifest: Record<string, any>) => { manifest.performance.performance_run_id = 'performance-run-rotated' }],
    ['performance admission', (manifest: Record<string, any>) => { manifest.performance.admission_sha256 = '9'.repeat(64) }],
    ['performance verifier', (manifest: Record<string, any>) => { manifest.performance.verifier = { run_id: '999' } }],
    ['GitHub provenance', (manifest: Record<string, any>) => { manifest.github_artifact_provenance.artifacts[0].digest = `sha256:${'9'.repeat(64)}` }],
    ['other platform artifact', (manifest: Record<string, any>) => { manifest.artifacts.win32.sha256 = '9'.repeat(64) }],
  ])('rejects the confirmed update after %s identity drift', async (_label, mutate) => {
    const request = vi.fn()
      .mockResolvedValueOnce(versionResponse('2.1.0'))
      .mockResolvedValueOnce(versionResponse('2.1.0', 1, mutate))
    const harness = await createHarness({
      config: { ...testConfig, enabled: false },
      request,
      confirmDownload: async () => true,
    })

    await expect(harness.runInteractiveUpdate()).resolves.toEqual({
      status: 'superseded',
      installedVersion: '2.0.0',
      latestVersion: '2.1.0',
    })
    expect(request).toHaveBeenCalledTimes(2)
    expect(harness.confirmDownload).toHaveBeenCalledOnce()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
  })

  it.each([
    ['up-to-date', async () => versionResponse('2.0.0')],
    ['failed', async () => new Response('unavailable', { status: 503 })],
  ] as const)('keeps an automatic %s result silent', async (_case, request) => {
    vi.useFakeTimers()
    const requestSpy = vi.fn(request)
    const harness = await createHarness({ request: requestSpy })

    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(requestSpy).toHaveBeenCalledOnce() })

    expect(harness.showManualCheckResult).not.toHaveBeenCalled()
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
  })

  it.each([
    ['same version', async () => versionResponse('2.0.0'), {
      status: 'up-to-date', currentVersion: '2.0.0', latestVersion: '2.0.0',
    }],
    ['older version', async () => versionResponse('1.9.9'), {
      status: 'up-to-date', currentVersion: '2.0.0', latestVersion: '1.9.9',
    }],
    ['invalid version', async () => versionResponse('v2.1.0'), null],
    ['service unavailable', async () => new Response('unavailable', { status: 503 }), null],
    ['network failure', async () => { throw new TypeError('offline') }, null],
  ] as const)('reports a manual %s result without prompting or downloading', async (_case, request, expected) => {
    const harness = await createHarness({ packaged: false, request })

    await harness.tray.invoke()

    expect(harness.showManualCheckResult).toHaveBeenCalledWith(expected)
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(harness.tray.label()).toBe('Check for Updates…')
  })

  it('silently resets legacy state and does not use it as an available version cache', async () => {
    vi.useFakeTimers()
    const harness = await createHarness({
      request: async () => versionResponse('2.1.0'),
      state: JSON.stringify({
        version: 1,
        checkedVersion: '2.0.0',
        etag: '"legacy"',
        lastNotifiedVersion: '2.1.0',
        availableRelease: {
          tagName: 'v2.1.0',
          version: '2.1.0',
          htmlUrl: 'https://example.test/legacy',
        },
      }),
    })

    expect(harness.tray.label()).toBe('Check for Updates…')
    await vi.advanceTimersByTimeAsync(testConfig.initialDelayMs)
    await vi.waitFor(() => { expect(harness.confirmDownload).toHaveBeenCalledWith('2.1.0') })
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(harness.statePath, 'utf8'))).toEqual({
        version: 2,
        lastPromptedVersion: '2.1.0',
      })
    })
    expect(harness.warnings).toEqual([])
  })

  it('does not prompt on a platform without a fixed download entry', async () => {
    const harness = await createHarness({
      packaged: false,
      canDownload: false,
      request: async () => versionResponse('2.1.0'),
    })

    await harness.tray.invoke()

    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'update-available',
      currentVersion: '2.0.0',
      latestVersion: '2.1.0',
    }))
    expect(harness.downloadAndOpen).not.toHaveBeenCalled()
    expect(harness.notifications).toEqual([])
    expect(harness.tray.label()).toBe('Check for Updates…')
  })

  it('shares one pending download and reports a visible failure result', async () => {
    let rejectDownload!: (cause: Error) => void
    const download = new Promise<void>((_resolve, reject) => { rejectDownload = reject })
    const harness = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      confirmDownload: async () => true,
      downloadAndOpen: async () => download,
    })

    const first = harness.runInteractiveUpdate()
    await vi.waitFor(() => { expect(harness.downloadAndOpen).toHaveBeenCalledOnce() })
    const second = harness.runInteractiveUpdate()
    expect(harness.downloadAndOpen).toHaveBeenCalledOnce()
    rejectDownload(new Error('offline'))
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'failed', installedVersion: '2.0.0', latestVersion: '2.1.0' },
      { status: 'failed', installedVersion: '2.0.0', latestVersion: '2.1.0' },
    ])

    expect(harness.downloadAndOpen).toHaveBeenCalledOnce()
    expect(harness.notifications).toEqual([expect.objectContaining({ title: 'e-Mate Update Failed' })])
    expect(harness.warnings).toEqual([])
    expect(harness.tray.label()).toBe('e-Mate 2.1.0 Available')
  })

  it('aborts checks and downloads and removes the tray item on effect disposal', async () => {
    let checkSignal: AbortSignal | undefined
    const checking = await createHarness({
      packaged: false,
      request: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        checkSignal = init.signal as AbortSignal
        checkSignal.addEventListener('abort', () => {
          reject(new DOMException('disposed', 'AbortError'))
        }, { once: true })
      }),
    })
    const pendingCheck = checking.tray.invoke()
    await vi.waitFor(() => { expect(checkSignal).toBeDefined() })
    await checking.dispose()
    await pendingCheck
    expect(checkSignal?.aborted).toBe(true)
    expect(checking.registrationDispose).toHaveBeenCalledOnce()
    expect(checking.notifications).toEqual([])

    let downloadSignal: AbortSignal | undefined
    const downloading = await createHarness({
      packaged: false,
      request: async () => versionResponse('2.1.0'),
      confirmDownload: async () => true,
      downloadAndOpen: async (_version, signal) => new Promise<void>((_resolve, reject) => {
        downloadSignal = signal
        signal.addEventListener('abort', () => {
          reject(new DOMException('disposed', 'AbortError'))
        }, { once: true })
      }),
    })
    const pendingDownload = downloading.tray.invoke()
    await vi.waitFor(() => { expect(downloadSignal).toBeDefined() })
    await downloading.dispose()
    await pendingDownload
    expect(downloadSignal?.aborted).toBe(true)
    expect(downloading.registrationDispose).toHaveBeenCalledOnce()
    expect(downloading.notifications).toEqual([])
    expect(downloading.warnings).toEqual([])
  })

  it('does not wait for an open manual result dialog during disposal', async () => {
    let closeDialog!: () => void
    const dialog = new Promise<void>(resolve => { closeDialog = resolve })
    const harness = await createHarness({
      packaged: false,
      showManualCheckResult: async () => dialog,
    })
    const pending = harness.tray.invoke()
    await vi.waitFor(() => { expect(harness.showManualCheckResult).toHaveBeenCalledOnce() })

    await harness.dispose()
    expect(harness.registrationDispose).toHaveBeenCalledOnce()

    closeDialog()
    await pending
  })

  it('reports a timed-out shared manual request and restores the idle tray label', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init.signal as AbortSignal
      signals.push(signal)
      signal.addEventListener('abort', () => {
        reject(new DOMException('cancelled', 'AbortError'))
      }, { once: true })
    }))
    const harness = await createHarness({ packaged: false, request })

    const first = harness.tray.invoke()
    const second = harness.tray.invoke()
    await vi.waitFor(() => { expect(request).toHaveBeenCalledOnce() })
    expect(harness.tray.label()).toBe('Checking for Updates…')
    await vi.advanceTimersByTimeAsync(testConfig.requestTimeoutMs)
    await Promise.all([first, second])

    expect(signals[0]?.aborted).toBe(true)
    expect(harness.confirmDownload).not.toHaveBeenCalled()
    expect(harness.showManualCheckResult).toHaveBeenCalledWith(null)
    expect(harness.notifications).toEqual([])
    expect(harness.warnings).toEqual([])
    expect(harness.tray.label()).toBe('Check for Updates…')
  })
})
