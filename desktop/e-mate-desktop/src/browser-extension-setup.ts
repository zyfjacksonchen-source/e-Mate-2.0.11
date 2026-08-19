/** Agent-facing bootstrap for the packaged e-Mate browser extension. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from './runtime.ts'

export const name = 'desktop-browser-extension-setup'
export const inject = ['desktopRuntime', 'systemPrompt', 'tools']

export function apply(ctx: Context): void {
  const computerUseGuidance = ctx.desktopRuntime.platform === 'darwin'
    ? `\n\n当 Computer Use 返回辅助功能权限不是 granted 时，调用一次 \`e_mate_computer_use_accessibility_setup\`。它会向 macOS 登记 e-Mate 并直接打开“隐私与安全性 → 辅助功能”；请用户只完成系统强制的添加或开关，然后重试 Computer Use。只有重试成功后才能继续或声称权限已生效。`
    : ''
  ctx.systemPrompt.section({
    name: 'emate:browser-extension-setup',
    order: 181,
    text: `## e-Mate 本机能力安装

当 dsh-browser 明确返回“e-Mate 浏览器扩展未连接”时，调用一次 \`e_mate_browser_extension_setup\`。它只打开 Chrome 扩展管理页和 e-Mate 内置扩展目录；随后在 macOS 上立即复用已安装的 Computer Use 原生工具完成“开发者模式 → 加载已解压的扩展程序 → 选择 browser-extension 目录”，不要把步骤转交给用户。浏览器或系统强制要求用户确认权限时才请求用户操作。最后必须重试原生 browser Tool；只有真实连接并成功读取页面后才能声称安装完成。Windows 当前没有 Computer Use provider，Tool 打开安装入口后应如实说明仍需要一次浏览器侧确认，不得伪称自动完成。${computerUseGuidance}`,
  })
  ctx.tools.register(defineTool({
    name: 'e_mate_browser_extension_setup',
    description: '当 e-Mate 浏览器扩展未连接时，打开浏览器扩展管理页和内置扩展目录，为 Agent 的 Computer Use 自动安装流程做准备。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', const: 'setup-opened', required: true },
          platform: { type: 'string', enum: ['darwin', 'win32', 'linux'], required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.platform === 'darwin'
          ? 'Chrome 扩展管理页和 e-Mate 内置扩展目录已打开。请继续使用 Computer Use 完成加载，并以 browser Tool 重试成功作为完成标准。'
          : '浏览器扩展管理页和 e-Mate 内置扩展目录已打开；当前平台仍需完成浏览器侧确认。',
      }],
    },
    async execute() {
      await ctx.desktopRuntime.openBrowserExtensionSetup()
      return { status: 'setup-opened' as const, platform: ctx.desktopRuntime.platform }
    },
  }))
  if (ctx.desktopRuntime.platform === 'darwin') {
    ctx.tools.register(defineTool({
      name: 'e_mate_computer_use_accessibility_setup',
      description: '当 Computer Use 报告 macOS 辅助功能权限未授予时，登记 e-Mate 并直接打开系统辅助功能权限页。',
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
}
