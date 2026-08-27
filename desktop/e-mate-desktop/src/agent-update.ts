/** Agent-facing Tool that delegates to the one native desktop updater. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from './updates.ts'
import { formatUpdateBytes, profileUpdateCapabilitySummary } from './update-presentation.ts'

export const name = 'desktop-agent-update'
export const inject = ['desktopUpdates', 'systemPrompt', 'tools']

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'emate:desktop-update',
    order: 180,
    text: `## e-Mate 桌面更新

当用户用自然语言明确要求“检查更新”或“更新 e-Mate”时，只调用已注册的 \`e_mate_desktop_update\` Tool。不得调用 npm、pnpm、旧版 e-mate CLI 或自行下载安装包。该 Tool 复用应用唯一的桌面更新服务：优先检查兼容的已签名能力发布代，原生确认框展示发布版本、代、能力摘要和下载量；确认后仅下载变化内容，原子选择新代并重启，启动健康后才提交，失败自动回滚。只有当前应用版本无法兼容时才进入整包更新；base-required 表示尚无可安装的兼容版本。只根据 Tool 返回值和原生界面报告状态，不得自行声称更新成功。`,
  })
  ctx.tools.register(defineTool({
    name: 'e_mate_desktop_update',
    description: '检查并启动 e-Mate 桌面版的官方更新流程。仅在用户明确要求更新时调用。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['up-to-date', 'base-required', 'declined', 'superseded', 'scheduled', 'failed'], required: true },
          installedVersion: { type: 'string' },
          latestVersion: { type: 'string' },
          updateKind: { type: 'string', enum: ['base', 'components'] },
          componentGeneration: { type: 'string' },
          components: { type: 'array', items: { type: 'string' } },
          downloadBytes: { type: 'number' },
          requiredBaseContracts: { type: 'array', items: { type: 'string' } },
          stage: { type: 'string', enum: ['checking', 'available', 'confirming', 'downloading', 'verifying', 'staging', 'waiting-shutdown', 'replacing', 'restarting', 'health-check', 'completed', 'rolling-back', 'rolled-back', 'failed'] },
          version: { type: 'string' },
          bytes: { type: 'number' },
          total: { type: 'number' },
          cached: { type: 'boolean' },
          mandatory: { type: 'boolean' },
          minimumSupportedVersion: { type: 'string' },
          code: { type: 'string' },
          diagnosticId: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'up-to-date'
          ? `当前已是最新版本：e-Mate ${value.installedVersion}（最新发布 ${value.latestVersion}）。`
          : value.status === 'scheduled'
            ? value.updateKind === 'components'
              ? `已验证 e-Mate ${value.latestVersion} 的新发布代；${profileUpdateCapabilitySummary(value.components?.length ?? 0)}下载大小：${value.downloadBytes === undefined ? '待确认' : formatUpdateBytes(value.downloadBytes)}。正在原子切换并重启，启动检查失败将自动回滚。`
              : `e-Mate ${value.latestVersion} 已完成下载与校验，正在自动安装并重启；启动检查失败将自动恢复原版本。`
            : value.status === 'base-required'
              ? `e-Mate ${value.latestVersion} 需要更新应用版本后才能使用；当前仍保持 e-Mate ${value.installedVersion}。`
            : value.status === 'declined'
              ? `已取消更新；当前仍为 e-Mate ${value.installedVersion}。`
              : value.status === 'superseded'
                ? `发布版本已变化，请重新确认更新到 e-Mate ${value.latestVersion}。`
                : `e-Mate 更新未完成，原生通知已显示失败结果；请稍后重试${value.diagnosticId === undefined ? '。' : `（诊断编号：${value.diagnosticId}）。`}`,
      }],
    },
    async execute() {
      const result = await ctx.desktopUpdates.runInteractiveUpdate()
      return { ...result, ...ctx.desktopUpdates.getState() }
    },
  }))
}
