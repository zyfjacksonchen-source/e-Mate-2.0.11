import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import DesktopWindowsDirectoryPicker from '../src/windows-directory-picker.ts'

describe('desktop native DSH directory-picker adapter', () => {
  it.each(['darwin', 'win32'] as const)('registers one stable %s capability for selection and cancellation', async platform => {
    const pickDirectory = vi.fn()
      .mockResolvedValueOnce('C:\\Work')
      .mockResolvedValueOnce(null)
    const ctx = new Context()
    ctx.provide('desktopRuntime', { platform, pickDirectory } as never)
    const fiber = ctx.plugin(DesktopWindowsDirectoryPicker)
    await fiber.await()

    const picker = ctx.directoryPicker
    const capability = picker.capability()
    expect(capability.kind).toBe('native')
    expect(picker.capability()).toBe(capability)
    if (capability.kind !== 'native') throw new Error('test requires native capability')
    await expect(capability.pick(new AbortController().signal)).resolves.toBe('C:\\Work')
    await expect(capability.pick(new AbortController().signal)).resolves.toBeNull()
    expect(pickDirectory).toHaveBeenCalledTimes(2)

    await fiber.dispose()
    expect(ctx.get('directoryPicker')).toBeUndefined()
  })

  it('fails closed before and during a disconnected native pick', async () => {
    let resolvePick!: (path: string | null) => void
    const pickDirectory = vi.fn(() => new Promise<string | null>(resolve => { resolvePick = resolve }))
    const ctx = new Context()
    ctx.provide('desktopRuntime', { platform: 'win32', pickDirectory } as never)
    const fiber = ctx.plugin(DesktopWindowsDirectoryPicker)
    await fiber.await()
    const capability = ctx.directoryPicker.capability()
    if (capability.kind !== 'native') throw new Error('test requires native capability')

    const before = new AbortController()
    const beforeReason = new Error('closed before pick')
    before.abort(beforeReason)
    await expect(capability.pick(before.signal)).rejects.toBe(beforeReason)
    expect(pickDirectory).not.toHaveBeenCalled()

    const during = new AbortController()
    const pending = capability.pick(during.signal)
    const duringReason = new Error('connection closed')
    during.abort(duringReason)
    await expect(pending).rejects.toBe(duringReason)
    expect(pickDirectory).toHaveBeenCalledOnce()
    resolvePick(null)

    await fiber.dispose()
  })

  it('rejects accidental composition outside the native desktop profiles', async () => {
    const ctx = new Context()
    ctx.provide('desktopRuntime', { platform: 'linux', pickDirectory: vi.fn() } as never)
    const fiber = ctx.plugin(DesktopWindowsDirectoryPicker)

    await expect(fiber.await()).rejects.toThrow('requires a darwin or win32 desktop runtime')
  })
})
