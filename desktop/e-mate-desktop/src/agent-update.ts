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

当用户明确要求更新 e-Mate 时，只调用已注册的 \`e_mate_desktop_update\` Tool。不得调用 npm、pnpm、旧版 e-mate CLI 或自行下载安装包。该 Tool 复用应用唯一的桌面更新服务；用户确认一次后，e-Mate 自动下载、校验、替换并重启。只根据 Tool 返回的 status、installedVersion、latestVersion 与原生界面报告状态；scheduled 表示已进入自动安装重启流程，重启后的原生通知会报告安装成功或失败回滚。`,
  })
  ctx.tools.register(defineTool({
    name: 'e_mate_desktop_update',
    description: '检查并启动 e-Mate 桌面版的官方更新流程。仅在用户明确要求更新时调用。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['up-to-date', 'declined', 'superseded', 'scheduled', 'failed'], required: true },
          installedVersion: { type: 'string' },
          latestVersion: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'up-to-date'
          ? `当前已是最新版本：e-Mate ${value.installedVersion}（最新发布 ${value.latestVersion}）。`
          : value.status === 'scheduled'
            ? `e-Mate ${value.latestVersion} 已完成下载与校验，正在自动安装并重启。`
            : value.status === 'declined'
              ? `已取消更新；当前仍为 e-Mate ${value.installedVersion}。`
              : value.status === 'superseded'
                ? `发布版本已变化，请重新确认更新到 e-Mate ${value.latestVersion}。`
                : 'e-Mate 更新未完成，原生通知已显示失败结果；请稍后重试。',
      }],
    },
    async execute() {
      return ctx.desktopUpdates.runInteractiveUpdate()
    },
  }))
}
