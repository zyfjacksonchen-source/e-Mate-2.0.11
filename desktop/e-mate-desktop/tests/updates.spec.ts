import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopRuntime, DesktopTrayItem } from '../src/runtime.ts'
import { apply, Config, inject } from '../src/updates.ts'

describe('native desktop update owner', () => {
  it('keeps the dsh-desktop schedule defaults and one runtime injection', () => {
    expect(inject).toEqual(['desktopRuntime'])
    expect(Config({} as never)).toEqual({
      enabled: true,
      initialDelayMs: 60_000,
      intervalMs: 21_600_000,
      requestTimeoutMs: 15_000,
    })
  })

  it('delegates natural-language and tray checks to the same lifecycle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-updates-'))
    const request = vi.fn(async () => Response.json({ version: '2.1.0' }))
    const confirmDownload = vi.fn(async () => false)
    const downloadAndOpen = vi.fn(async () => {})
    let tray: DesktopTrayItem | undefined
    let rendererCheck: (() => Promise<void>) | undefined
    let dispose: (() => void | Promise<void>) | undefined
    const runtime = {
      updates: {
        isPackaged: true,
        canDownload: true,
        currentVersion: '2.0.15',
        statePath: join(root, 'state.json'),
        request,
        confirmDownload,
        showManualCheckResult: vi.fn(async () => {}),
        downloadAndOpen,
        notify: vi.fn(),
        setInteractiveUpdateHandler(handler: (() => Promise<void>) | undefined) {
          rendererCheck = handler
        },
      },
      registerTrayItem(item: DesktopTrayItem) {
        tray = item
        return { refresh: vi.fn(), dispose: vi.fn() }
      },
    } as unknown as DesktopRuntime
    const ctx = {
      desktopRuntime: runtime,
      provide(key: string, value: unknown) { Object.assign(ctx, { [key]: value }) },
      effect(register: () => (() => void | Promise<void>)) { dispose = register() },
    } as unknown as Context

    apply(ctx, Config({ enabled: false } as never))
    await expect(ctx.desktopUpdates.runInteractiveUpdate()).resolves.toEqual({
      status: 'handled',
      installedVersion: '2.0.15',
    })
    await tray!.invoke()
    await rendererCheck!()

    expect(request).toHaveBeenCalledOnce()
    expect(confirmDownload).toHaveBeenCalledTimes(3)
    expect(downloadAndOpen).not.toHaveBeenCalled()
    await dispose?.()
    expect(rendererCheck).toBeUndefined()
  })
})
