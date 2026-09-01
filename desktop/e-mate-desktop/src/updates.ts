/** Cordis Host plugin for the one native e-Mate update lifecycle. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from './runtime.ts'
import { startDesktopUpdateLifecycle } from './update-lifecycle.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-updates'

/** Native adapter required for network, tray, confirmation, and installer access. */
export const inject = ['desktopRuntime']

/** Natural-language access to the same lifecycle used by the native tray. */
export interface DesktopUpdates {
  runInteractiveUpdate(): Promise<{
    readonly status: 'handled'
    readonly installedVersion: string
  }>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopUpdates: DesktopUpdates
  }
}

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Scheduled update policy. */
export interface Config {
  enabled: boolean
  initialDelayMs: number
  intervalMs: number
  requestTimeoutMs: number
}

/** Validated scheduled update policy copied from dsh-desktop. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  initialDelayMs: z.number().step(1).min(0).max(MAX_TIMER_DELAY_MS).default(60_000),
  intervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(6 * 60 * 60 * 1000),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(15_000),
})

/** Mount one dsh-desktop lifecycle and delegate every interactive trigger to it. */
export function apply(ctx: Context, config: Config): void {
  let lifecycle: ReturnType<typeof startDesktopUpdateLifecycle> | undefined
  ctx.provide('desktopUpdates', {
    async runInteractiveUpdate() {
      if (lifecycle === undefined) throw new Error('e-Mate desktop updater is not ready')
      await lifecycle.checkNow()
      return { status: 'handled', installedVersion: ctx.desktopRuntime.updates.currentVersion }
    },
  })
  ctx.effect(() => {
    lifecycle = startDesktopUpdateLifecycle({
      adapter: ctx.desktopRuntime.updates,
      policy: config,
      locale: () => ctx.desktopRuntime.locale,
      registerTrayItem: item => ctx.desktopRuntime.registerTrayItem(item),
    })
    ctx.desktopRuntime.updates.setInteractiveUpdateHandler?.(() => lifecycle!.checkNow())
    return async () => {
      const owner = lifecycle
      lifecycle = undefined
      ctx.desktopRuntime.updates.setInteractiveUpdateHandler?.(undefined)
      if (owner !== undefined) await owner.dispose()
    }
  }, '@e-mate/desktop: dsh-desktop update lifecycle')
}
