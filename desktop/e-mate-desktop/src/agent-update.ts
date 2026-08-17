/** Agent-facing Tool that delegates to the one native desktop updater. */

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

当用户明确要求更新 e-Mate 时，只调用已注册的 \`e_mate_desktop_update\` Tool。不得调用 npm、pnpm、旧版 e-mate CLI 或自行下载安装包。该 Tool 复用应用唯一的桌面更新服务，并通过原生确认、下载、完整性校验和安装器交接完成流程。只根据 Tool 返回的 status、installedVersion、latestVersion 与原生界面报告状态；Tool 返回 update-available 不等于新版本已安装，用户完成安装并重新打开后才可核对版本。`,
  })
  ctx.tools.register(defineTool({
    name: 'e_mate_desktop_update',
    description: '检查并启动 e-Mate 桌面版的官方更新流程。仅在用户明确要求更新时调用。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['up-to-date', 'update-available', 'check-failed'], required: true },
          installedVersion: { type: 'string' },
          latestVersion: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'up-to-date'
          ? `当前已是最新版本：e-Mate ${value.installedVersion}（最新发布 ${value.latestVersion}）。`
          : value.status === 'update-available'
            ? `已检查到 e-Mate ${value.latestVersion}；当前安装版本为 ${value.installedVersion}。请以原生更新窗口和重启后的版本号为准。`
            : '桌面更新检查没有得到可验证结果，请稍后重试。',
      }],
    },
    async execute() {
      const result = await ctx.desktopUpdates.runInteractiveUpdate()
      return result === null
        ? { status: 'check-failed' as const }
        : {
            status: result.status,
            installedVersion: result.currentVersion,
            latestVersion: result.latestVersion,
          }
    },
  }))
}
