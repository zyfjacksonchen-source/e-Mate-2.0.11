/** Natural-language trigger for the one native desktop updater. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from './updates.ts'

export const name = 'desktop-agent-update'
export const inject = ['desktopUpdates', 'systemPrompt', 'tools']

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'emate:desktop-update',
    order: 180,
    text: `## e-Mate 桌面更新

当用户明确要求检查或更新 e-Mate 时，只调用 \`e_mate_desktop_update\`。该工具只触发与托盘“检查更新”相同的 dsh-desktop 原生更新流程；不得自行请求版本、下载安装包或执行替换。结果以原生对话框和安装器为准。`,
  })
  ctx.tools.register(defineTool({
    name: 'e_mate_desktop_update',
    description: '打开 e-Mate 唯一的原生检查更新流程。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['handled'], required: true },
          installedVersion: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: `已打开 e-Mate 原生更新流程；当前版本 ${value.installedVersion}。请按原生对话框继续。`,
      }],
    },
    execute: async () => await ctx.desktopUpdates.runInteractiveUpdate(),
  }))
}
