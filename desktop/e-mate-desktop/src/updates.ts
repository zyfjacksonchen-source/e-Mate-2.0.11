/** Cordis Host plugin for scheduled and interactive e-Mate updates. */

import { open } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import z from '@deepseek-ai/schemastery'
import type {} from './runtime.ts'
import {
  checkForStableUpdate,
  parseSemVer,
  type UpdateCheckResult,
} from './update-checker.ts'

type AvailableUpdate = Extract<UpdateCheckResult, { status: 'update-available' }>

/** Stable Cordis plugin name. */
export const name = 'desktop-updates'

/** Native adapter required for network, tray, confirmation, and installer access. */
export const inject = ['desktopRuntime']

/** The only Agent-callable entry into the native desktop updater. */
export interface DesktopUpdates {
  runInteractiveUpdate(): Promise<InteractiveUpdateResult>
}

export type InteractiveUpdateResult = {
  readonly status: 'up-to-date' | 'declined' | 'superseded' | 'scheduled' | 'failed'
  readonly installedVersion: string
  readonly latestVersion?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopUpdates: DesktopUpdates
  }
}

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_STATE_BYTES = 4 * 1024

/** Scheduled update policy. */
export interface Config {
  /** Enable background checks in packaged applications. */
  enabled: boolean
  /** Delay before the first background check after plugin activation. */
  initialDelayMs: number
  /** Delay between completion of one background check and the next attempt. */
  intervalMs: number
  /** Maximum duration of one version request before caller-owned cancellation. */
  requestTimeoutMs: number
}

/** Validated scheduled update policy. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  initialDelayMs: z.number().step(1).min(0).max(MAX_TIMER_DELAY_MS).default(60_000),
  intervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(6 * 60 * 60 * 1000),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(15_000),
})

interface UpdateStateV2 {
  readonly version: 2
  readonly lastPromptedVersion?: string
}

const EMPTY_STATE: UpdateStateV2 = { version: 2 }

/**
 * Register effect-scoped update polling and its dynamic tray command.
 * @param ctx - Host context carrying the desktop native adapter.
 * @param config - validated polling and timeout values.
 */
export function apply(ctx: Context, config: Config): void {
  const adapter = ctx.desktopRuntime.updates
  let interactiveUpdate: (() => Promise<InteractiveUpdateResult>) | undefined
  ctx.provide('desktopUpdates', {
    runInteractiveUpdate() {
      if (interactiveUpdate === undefined) {
        return Promise.reject(new Error('e-Mate desktop updater is not ready'))
      }
      return interactiveUpdate()
    },
  })
  ctx.effect(() => {
    let disposed = false
    let checking = false
    let availableUpdate: AvailableUpdate | undefined
    let downloadingVersion: string | undefined
    let state: UpdateStateV2 = EMPTY_STATE
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let requestTimer: ReturnType<typeof setTimeout> | undefined
    let requestController: AbortController | undefined
    let downloadController: AbortController | undefined
    let inFlight: Promise<UpdateCheckResult | null> | undefined
    let manualTask: Promise<InteractiveUpdateResult> | undefined
    let downloadTask: Promise<InteractiveUpdateResult> | undefined
    let refreshTray = (): void => {}

    const persistState = async (): Promise<void> => {
      try {
        await writeFileAtomic(adapter.statePath, renderState(state), {
          mode: 0o600,
          dirMode: 0o700,
        })
      } catch {
        // Update state is optional; failures must not affect application startup or user activity.
      }
    }

    const stateReady = (async () => {
      try {
        state = parseState(await readState(adapter.statePath))
      } catch (cause) {
        if (isEnoent(cause)) return
        state = EMPTY_STATE
        if (!disposed) await persistState()
      }
    })()

    const rememberPrompt = async (version: string): Promise<void> => {
      await stateReady
      if (state.lastPromptedVersion === version) return
      state = { version: 2, lastPromptedVersion: version }
      await persistState()
    }

    const startCheck = (): Promise<UpdateCheckResult | null> => {
      if (inFlight !== undefined) return inFlight
      checking = true
      refreshTray()
      const controller = new AbortController()
      requestController = controller

      const task = (async () => {
        requestTimer = setTimeout(() => { controller.abort() }, config.requestTimeoutMs)
        try {
          if (adapter.platform === undefined) return null
          return await checkForStableUpdate({
            currentVersion: adapter.currentVersion,
            platform: adapter.platform,
            signal: controller.signal,
            request: adapter.request,
          })
        } catch {
          return null
        }
      })().finally(() => {
        if (requestTimer !== undefined) clearTimeout(requestTimer)
        requestTimer = undefined
        if (requestController === controller) requestController = undefined
        inFlight = undefined
        checking = false
        refreshTray()
      })
      inFlight = task
      return task
    }

    const observeResult = (result: UpdateCheckResult | null): AvailableUpdate | undefined => {
      if (disposed || result === null) return undefined
      availableUpdate = result.status === 'update-available' && adapter.canDownload && adapter.platform !== undefined
        ? result
        : undefined
      refreshTray()
      return availableUpdate
    }

    const failed = (latestVersion?: string): InteractiveUpdateResult => ({
      status: 'failed',
      installedVersion: adapter.currentVersion,
      ...(latestVersion === undefined ? {} : { latestVersion }),
    })

    const startDownload = (update: AvailableUpdate): Promise<InteractiveUpdateResult> => {
      if (downloadTask !== undefined) return downloadTask
      const task = (async (): Promise<InteractiveUpdateResult> => {
        let confirmed: boolean
        try {
          confirmed = await adapter.confirmDownload(update.latestVersion)
        } catch {
          return failed(update.latestVersion)
        }
        if (!confirmed) {
          return { status: 'declined', installedVersion: adapter.currentVersion, latestVersion: update.latestVersion }
        }
        if (disposed) return failed(update.latestVersion)

        const confirmedUpdate = observeResult(await startCheck())
        if (!sameUpdate(confirmedUpdate, update) || disposed) {
          if (!disposed) {
            adapter.notify(confirmedUpdate === undefined
              ? { title: 'e-Mate Update Failed', body: 'The update release could not be verified. Please try again.' }
              : { title: 'e-Mate Update Changed', body: `e-Mate ${confirmedUpdate.latestVersion} is now available. Please confirm the new release.` })
          }
          return confirmedUpdate === undefined
            ? failed(update.latestVersion)
            : { status: 'superseded', installedVersion: adapter.currentVersion, latestVersion: confirmedUpdate.latestVersion }
        }

        const controller = new AbortController()
        downloadController = controller
        downloadingVersion = update.latestVersion
        refreshTray()
        try {
          await adapter.downloadAndOpen(update, controller.signal)
          return { status: 'scheduled', installedVersion: adapter.currentVersion, latestVersion: update.latestVersion }
        } catch {
          if (!disposed) {
            adapter.notify({
              title: 'e-Mate Update Failed',
              body: `e-Mate ${update.latestVersion} could not be downloaded, verified, or installed. Please try again.`,
            })
          }
          return failed(update.latestVersion)
        } finally {
          if (downloadController === controller) downloadController = undefined
          downloadingVersion = undefined
          refreshTray()
        }
      })().finally(() => {
        if (downloadTask === task) downloadTask = undefined
      })
      downloadTask = task
      return task
    }

    const offerDownload = async (update: AvailableUpdate, automatic: boolean): Promise<InteractiveUpdateResult | undefined> => {
      if (disposed || !adapter.canDownload) return failed(update.latestVersion)
      await stateReady
      if (disposed || (automatic && state.lastPromptedVersion === update.latestVersion)) return
      await rememberPrompt(update.latestVersion)
      if (!disposed) return startDownload(update)
    }

    const runManualCheck = (): Promise<InteractiveUpdateResult> => {
      if (manualTask !== undefined) return manualTask
      const task = (async (): Promise<InteractiveUpdateResult> => {
        if (availableUpdate !== undefined) {
          return (await offerDownload(availableUpdate, false)) ?? failed(availableUpdate.latestVersion)
        }
        const result = await startCheck()
        if (disposed) return failed()
        const update = observeResult(result)
        if (update !== undefined) {
          return (await offerDownload(update, false)) ?? failed(update.latestVersion)
        }
        await adapter.showManualCheckResult(result)
        return result?.status === 'up-to-date'
          ? { status: 'up-to-date', installedVersion: result.currentVersion, latestVersion: result.latestVersion }
          : failed(result?.status === 'update-available' ? result.latestVersion : undefined)
      })().catch(() => failed()).finally(() => {
        if (manualTask === task) manualTask = undefined
      })
      manualTask = task
      return task
    }
    interactiveUpdate = runManualCheck

    const runBackgroundCheck = async (): Promise<void> => {
      if (inFlight !== undefined || disposed) return
      try {
        const update = observeResult(await startCheck())
        if (update !== undefined) await offerDownload(update, true)
      } catch {
        // Scheduled checks never surface failures to the user or the application log.
      }
    }

    const scheduleBackgroundCheck = (delayMs: number): void => {
      pollTimer = setTimeout(() => {
        pollTimer = undefined
        void runBackgroundCheck().finally(() => {
          if (!disposed) scheduleBackgroundCheck(config.intervalMs)
        })
      }, delayMs)
    }

    const registration = ctx.desktopRuntime.registerTrayItem({
      group: 'status',
      order: 10,
      label: () => downloadingVersion === undefined
        ? availableUpdate === undefined
          ? checking ? 'Checking for Updates…' : 'Check for Updates…'
          : `e-Mate ${availableUpdate.latestVersion} Available`
        : `Downloading e-Mate ${downloadingVersion}…`,
      invoke: async () => { await runManualCheck() },
    })
    refreshTray = registration.refresh

    if (adapter.isPackaged && config.enabled) scheduleBackgroundCheck(config.initialDelayMs)

    return async () => {
      disposed = true
      if (interactiveUpdate === runManualCheck) interactiveUpdate = undefined
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      if (requestTimer !== undefined) clearTimeout(requestTimer)
      requestController?.abort()
      downloadController?.abort()
      registration.dispose()
      // Native dialogs are not cancellable. Await only file state and the abortable version request.
      const pending: Promise<unknown>[] = [stateReady]
      if (inFlight !== undefined) pending.push(inFlight)
      await Promise.allSettled(pending)
    }
  }, '@e-mate/desktop: update polling, confirmation, and installer handoff')
}

function sameUpdate(left: AvailableUpdate | undefined, right: AvailableUpdate): boolean {
  return left?.latestVersion === right.latestVersion
    && left.artifact.url === right.artifact.url
    && left.artifact.bytes === right.artifact.bytes
    && left.artifact.sha256 === right.artifact.sha256
}

function parseState(text: string): UpdateStateV2 {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)
    || value.version !== 2
    || (value.lastPromptedVersion !== undefined && !isStableVersion(value.lastPromptedVersion))
    || Object.keys(value).some(key => !['version', 'lastPromptedVersion'].includes(key))) {
    throw new Error('invalid v2 update state')
  }
  return value.lastPromptedVersion === undefined
    ? EMPTY_STATE
    : { version: 2, lastPromptedVersion: value.lastPromptedVersion as string }
}

async function readState(filename: string): Promise<string> {
  const handle = await open(filename, 'r')
  try {
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > MAX_STATE_BYTES) throw new Error(`update state exceeds ${MAX_STATE_BYTES} bytes`)
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

function renderState(state: UpdateStateV2): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

function isStableVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = parseSemVer(value)
  return parsed !== null && parsed.prerelease.length === 0 && parsed.version === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEnoent(value: unknown): boolean {
  return isRecord(value) && value.code === 'ENOENT'
}
