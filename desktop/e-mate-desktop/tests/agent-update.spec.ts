import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/agent-update.ts'

describe('e-Mate Agent desktop update Tool', () => {
  it('delegates only to the native updater service', async () => {
    const runInteractiveUpdate = vi.fn(async () => ({
      status: 'up-to-date' as const,
      currentVersion: '2.0.7',
      latestVersion: '2.0.7',
    }))
    const section = vi.fn()
    const register = vi.fn()
    const ctx = {
      desktopUpdates: { runInteractiveUpdate },
      systemPrompt: { section },
      tools: { register },
    } as unknown as Context

    apply(ctx)

    expect(section).toHaveBeenCalledWith(expect.objectContaining({
      name: 'emate:desktop-update',
      text: expect.stringContaining('e_mate_desktop_update'),
    }))
    const guidance = section.mock.calls[0]?.[0]?.text as string
    expect(guidance).not.toContain('e-mate update --json')
    expect(guidance).not.toContain('npm install')
    const tool = register.mock.calls[0]?.[0] as {
      name: string
      execute(args: object, exec: object): Promise<unknown>
    }
    expect(tool.name).toBe('e_mate_desktop_update')
    await expect(tool.execute({}, {})).resolves.toEqual({
      status: 'up-to-date',
      installedVersion: '2.0.7',
      latestVersion: '2.0.7',
    })
    expect(runInteractiveUpdate).toHaveBeenCalledOnce()
  })
})
