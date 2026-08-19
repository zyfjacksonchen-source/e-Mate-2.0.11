/** Agent-facing bootstrap for the native macOS Computer Use permission pane. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from './runtime.ts'

export const name = 'desktop-computer-use-setup'
export const inject = ['desktopRuntime', 'systemPrompt', 'tools']

export function apply(ctx: Context): void {
  if (ctx.desktopRuntime.platform !== 'darwin') return
  ctx.systemPrompt.section({
    name: 'emate:computer-use-setup',
    order: 181,
    text: `## e-Mate 本机权限

当原生 Computer Use 明确返回 macOS 辅助功能权限未授予时，调用一次 \`e_mate_computer_use_accessibility_setup\`。它只向 macOS 登记 e-Mate 并打开“隐私与安全性 → 辅助功能”；用户完成系统强制的添加或开关后，必须重试原生 Computer Use。只有重试成功才能声称权限生效。Full Access 不绕过 macOS TCC。`,
  })
  ctx.tools.register(defineTool({
    name: 'e_mate_computer_use_accessibility_setup',
    description: '当 Computer Use 报告 macOS 辅助功能权限未授予时，登记 e-Mate 并打开系统辅助功能权限页。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['granted', 'settings-opened'], required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'granted'
          ? 'e-Mate 已获得 macOS 辅助功能权限。'
          : '已打开“隐私与安全性 → 辅助功能”。请添加或开启 e-Mate；完成后重试 Computer Use。',
      }],
    },
    async execute() {
      const granted = await ctx.desktopRuntime.openComputerUseAccessibilitySetup()
      return { status: granted ? 'granted' as const : 'settings-opened' as const }
    },
  }))
}
