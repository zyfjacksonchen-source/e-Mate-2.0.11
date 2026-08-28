import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/agent-update.ts'

describe('e-Mate Agent desktop update Tool', () => {
  it('delegates only to the native updater service', async () => {
    const runInteractiveUpdate = vi.fn(async () => ({
      status: 'up-to-date' as const,
      installedVersion: '2.0.10',
      latestVersion: '2.0.10',
    }))
    const section = vi.fn()
    const register = vi.fn()
    const getState = vi.fn(() => ({ stage: 'completed' as const, updateKind: 'base' as const }))
    const ctx = {
      desktopUpdates: { runInteractiveUpdate, getState },
      systemPrompt: { section },
      tools: { register },
    } as unknown as Context

    apply(ctx)

    expect(section).toHaveBeenCalledWith(expect.objectContaining({
      name: 'emate:desktop-update',
      text: expect.stringContaining('e_mate_desktop_update'),
    }))
    const guidance = section.mock.calls[0]?.[0]?.text as string
    expect(guidance).toContain('能力摘要和下载量')
    expect(guidance).toContain('base-required')
    expect(guidance).not.toContain('e-mate update --json')
    expect(guidance).not.toContain('npm install')
    expect(guidance).not.toMatch(/@e-mate\/|dsh-plugin|component\.id|插件|组件/u)
    const tool = register.mock.calls[0]?.[0] as {
      name: string
      execute(args: object, exec: object): Promise<unknown>
      output: {
        render(args: object, value: Record<string, unknown>): Array<{ type: string; text: string }>
      }
    }
    expect(tool.name).toBe('e_mate_desktop_update')
    await expect(tool.execute({}, {})).resolves.toEqual({
      status: 'up-to-date',
      installedVersion: '2.0.10',
      latestVersion: '2.0.10',
      stage: 'completed',
      updateKind: 'base',
    })
    expect(runInteractiveUpdate).toHaveBeenCalledOnce()
    expect(getState).toHaveBeenCalledOnce()

    const cases = [
      {
        value: {
          status: 'scheduled',
          installedVersion: '2.0.12',
          latestVersion: '2.0.13',
          updateKind: 'components',
          componentGeneration: 'a'.repeat(64),
          components: [],
          downloadBytes: 0,
        },
        expected: ['2.0.13', '新发布代', '仅更新发布回执', '0 B', '自动回滚'],
      },
      {
        value: {
          status: 'scheduled',
          installedVersion: '2.0.12',
          latestVersion: '2.0.13',
          updateKind: 'components',
          componentGeneration: 'b'.repeat(64),
          components: ['@e-mate/dsh-plugin-private', 'component.id'],
          downloadBytes: 4096,
        },
        expected: ['2.0.13', '新发布代', '2 项办公能力与体验优化', '4.0 KiB', '自动回滚'],
      },
      {
        value: {
          status: 'base-required',
          installedVersion: '2.0.12',
          latestVersion: '2.0.13',
          requiredBaseContracts: ['@e-mate/dsh-plugin-private', 'component.id'],
        },
        expected: ['2.0.13', '更新应用版本', '当前仍保持 e-Mate 2.0.12'],
      },
      {
        value: {
          status: 'failed',
          installedVersion: '2.0.13',
          stage: 'failed',
          code: 'check-signature-invalid',
          diagnosticId: '0e4b9e6d-89b7-4b32-b8d4-d5fda86506bc',
          retryable: false,
          failedFromStage: 'checking',
        },
        expected: ['更新清单签名无法验证', '0e4b9e6d-89b7-4b32-b8d4-d5fda86506bc'],
      },
    ]
    for (const item of cases) {
      const visible = tool.output.render({}, item.value).map(block => block.text).join('\n')
      for (const expected of item.expected) expect(visible).toContain(expected)
      expect(visible).not.toMatch(/@e-mate\/|dsh-plugin|component\.id|插件|组件/u)
    }
  })
})
