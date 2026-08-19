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

当用户用自然语言明确要求“检查更新”“更新插件”或“更新 e-Mate”时，只调用已注册的 \`e_mate_desktop_update\` Tool。不得调用 npm、pnpm、旧版 e-mate CLI 或自行下载安装包。该 Tool 复用应用唯一的桌面更新服务：优先检查与当前 Base 兼容的已签名组件代，原生确认框展示发布版本、变化组件和下载量；确认后仅下载变化内容，原子选择新代并重启，Renderer 健康后才提交，失败自动回滚。只有组件发布明确要求新 Base 时才进入整包更新；base-required 表示当前 Base 不兼容且尚无可安装的 Base 发布。只根据 Tool 返回值和原生界面报告状态，不得自行声称更新成功。`,
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
          updateKind: { type: 'string', enum: ['components'] },
          componentGeneration: { type: 'string' },
          components: { type: 'array', items: { type: 'string' } },
          downloadBytes: { type: 'number' },
          requiredBaseContracts: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.status === 'up-to-date'
          ? `当前已是最新版本：e-Mate ${value.installedVersion}（最新发布 ${value.latestVersion}）。`
          : value.status === 'scheduled'
            ? value.updateKind === 'components'
              ? `已验证并选择 e-Mate ${value.latestVersion} 组件代；变化组件：${value.components?.join('、') || '无组件字节变化'}。正在重启并等待健康验收。`
              : `e-Mate ${value.latestVersion} 已完成下载与校验，正在自动安装并重启。`
            : value.status === 'base-required'
              ? `组件发布 ${value.latestVersion} 与当前 e-Mate ${value.installedVersion} Base 不兼容，需要先发布并升级受支持的 Base。`
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
