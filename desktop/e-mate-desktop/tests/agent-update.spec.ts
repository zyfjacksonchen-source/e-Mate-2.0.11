import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/agent-update.ts'

describe('e-Mate natural-language update trigger', () => {
  it('delegates to the one native lifecycle without owning update logic', async () => {
    const result = { status: 'handled' as const, installedVersion: '2.0.17' }
    const runInteractiveUpdate = vi.fn(async () => result)
    const section = vi.fn()
    const register = vi.fn()
    const ctx = {
      desktopUpdates: { runInteractiveUpdate },
      systemPrompt: { section },
      tools: { register },
    } as unknown as Context

    apply(ctx)

    const guidance = section.mock.calls[0]?.[0]?.text as string
    expect(guidance).toContain('相同的 dsh-desktop 原生更新流程')
    expect(guidance).toContain('不得自行请求版本、下载安装包或执行替换')
    const tool = register.mock.calls[0]?.[0] as {
      name: string
      execute(args: object): Promise<unknown>
      output: { render(args: object, value: typeof result): Array<{ text: string }> }
    }
    expect(tool.name).toBe('e_mate_desktop_update')
    await expect(tool.execute({})).resolves.toEqual(result)
    expect(runInteractiveUpdate).toHaveBeenCalledOnce()
    expect(tool.output.render({}, result)[0]?.text).toContain('原生更新流程')
  })
})
