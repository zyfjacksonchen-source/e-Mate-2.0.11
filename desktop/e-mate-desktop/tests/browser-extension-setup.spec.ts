import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/browser-extension-setup.ts'

describe('e-Mate Agent browser extension setup', () => {
  it('opens the native setup and requires real browser verification', async () => {
    const openBrowserExtensionSetup = vi.fn(async () => {})
    const openComputerUseAccessibilitySetup = vi.fn(async () => false)
    const section = vi.fn()
    const register = vi.fn()
    const ctx = {
      desktopRuntime: { platform: 'darwin', openBrowserExtensionSetup, openComputerUseAccessibilitySetup },
      systemPrompt: { section },
      tools: { register },
    } as unknown as Context

    apply(ctx)

    const guidance = section.mock.calls[0]?.[0]?.text as string
    expect(guidance).toContain('复用已安装的 Computer Use 原生工具')
    expect(guidance).toContain('最后必须重试原生 browser Tool')
    expect(guidance).toContain('e_mate_computer_use_accessibility_setup')
    const tools = register.mock.calls.map(call => call[0] as { name: string; execute(args: Record<string, never>): Promise<unknown> })
    const browserTool = tools.find(tool => tool.name === 'e_mate_browser_extension_setup')!
    await expect(browserTool.execute({})).resolves.toEqual({ status: 'setup-opened', platform: 'darwin' })
    expect(openBrowserExtensionSetup).toHaveBeenCalledOnce()
    const accessibilityTool = tools.find(tool => tool.name === 'e_mate_computer_use_accessibility_setup')!
    await expect(accessibilityTool.execute({})).resolves.toEqual({ status: 'settings-opened' })
    expect(openComputerUseAccessibilitySetup).toHaveBeenCalledOnce()
  })
})
