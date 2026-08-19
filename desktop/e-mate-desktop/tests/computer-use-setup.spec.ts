import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/computer-use-setup.ts'

describe('e-Mate Agent Computer Use setup', () => {
  it('opens the native macOS Accessibility setup and requires a real retry', async () => {
    const openComputerUseAccessibilitySetup = vi.fn(async () => false)
    const section = vi.fn()
    const register = vi.fn()
    const ctx = {
      desktopRuntime: { platform: 'darwin', openComputerUseAccessibilitySetup },
      systemPrompt: { section },
      tools: { register },
    } as unknown as Context

    apply(ctx)

    expect(section.mock.calls[0]?.[0]?.text).toContain('必须重试原生 Computer Use')
    const tool = register.mock.calls[0]?.[0] as { name: string; execute(args: object): Promise<unknown> }
    expect(tool.name).toBe('e_mate_computer_use_accessibility_setup')
    await expect(tool.execute({})).resolves.toEqual({ status: 'settings-opened' })
    expect(openComputerUseAccessibilitySetup).toHaveBeenCalledOnce()
  })

  it('does not register a macOS-only helper on other platforms', () => {
    const section = vi.fn()
    const register = vi.fn()
    apply({
      desktopRuntime: { platform: 'win32' },
      systemPrompt: { section },
      tools: { register },
    } as unknown as Context)

    expect(section).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })
})
