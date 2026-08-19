/**
 * Fail-closed rc.5 adapter boundary for dsh-vision-toolkit.
 *
 * The pinned Harness has no enterprise-owned multimodal-provider policy seam.
 * Registering the upstream remote tools would therefore expose user-editable
 * provider and model fields outside e-Mate model policy. The adapter keeps the
 * upstream atomic exposure rule: while that seam is absent it installs no
 * Python environment and registers none of the ten execution tools.
 */
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'

export const name = '@e-mate/dsh-plugin-vision-toolkit'
export const inject = ['tools', 'skills', 'emateCapabilities']

export const VISION_TOOLKIT_SETTINGS_NAMESPACE = settingsNamespace('vision-toolkit')
export const VISION_POLICY_BLOCK_CODE = 'EMATE_VISION_POLICY_SEAM_MISSING'
export const UPSTREAM_COMMIT = '29850a83871d4b7a7cc13e251420c5a440e2f69e'

export interface VisionToolkitAdapterConfig {
  runtime: {
    mode: 'managed'
  }
}

export const Config: Schema<VisionToolkitAdapterConfig> = z.object({
  runtime: z.object({
    mode: z.union(['managed'] as const).default('managed'),
  }),
})

const UPSTREAM_TOOL_NAMES = [
  'vision_glance',
  'vision_ground',
  'vision_detect',
  'vision_trace',
  'vision_crop',
  'vision_pixel_diff',
  'vision_long_screenshot_ocr',
  'vision_extract_foreground',
  'vision_dominant_colors',
  'vision_html_screenshot',
] as const

export interface VisionAdapterStatus {
  state: 'blocked'
  code: typeof VISION_POLICY_BLOCK_CODE
  harnessVersion: '0.1.0-rc.7'
  upstreamCommit: typeof UPSTREAM_COMMIT
  managedRuntime: 'deferred'
  runtimeInstalled: false
  toolsRegistered: 0
  blockedTools: readonly string[]
  reason: string
}

/** Stable, credential-free status projected to both humans and the Agent. */
export const ADAPTER_STATUS: VisionAdapterStatus = Object.freeze({
  state: 'blocked',
  code: VISION_POLICY_BLOCK_CODE,
  harnessVersion: '0.1.0-rc.7',
  upstreamCommit: UPSTREAM_COMMIT,
  managedRuntime: 'deferred',
  runtimeInstalled: false,
  toolsRegistered: 0,
  blockedTools: Object.freeze([...UPSTREAM_TOOL_NAMES]),
  reason: 'Harness 0.1.0-rc.7 has no enterprise-owned multimodal provider policy seam; exposing the upstream provider/model Settings would bypass e-Mate model policy.',
})

const STATUS_SKILL: SkillRegistration = {
  name: 'vision-tools',
  description: 'Reports the fail-closed status of the pinned Vision Toolkit adapter.',
  whenToUse: 'Load when a task requests OCR, image understanding, grounding, or visual comparison and Vision Toolkit tools are absent.',
  source: 'bundled',
  content: `# Vision Toolkit status

The pinned e-Mate 2.0.10 adapter is fail-closed with code ${VISION_POLICY_BLOCK_CODE}.
Call vision_toolkit_status for the exact release and blocked-tool list. Do not
infer image contents, claim OCR ran, install Python packages, or substitute a
different vision provider. The managed runtime remains uninstalled until an
enterprise-owned multimodal provider policy seam is available.`,
}

function statusValue(): JsonValue {
  return {
    state: ADAPTER_STATUS.state,
    code: ADAPTER_STATUS.code,
    harnessVersion: ADAPTER_STATUS.harnessVersion,
    upstreamCommit: ADAPTER_STATUS.upstreamCommit,
    managedRuntime: ADAPTER_STATUS.managedRuntime,
    runtimeInstalled: ADAPTER_STATUS.runtimeInstalled,
    toolsRegistered: ADAPTER_STATUS.toolsRegistered,
    blockedTools: [...ADAPTER_STATUS.blockedTools],
    reason: ADAPTER_STATUS.reason,
  }
}

/** Register only truthful status surfaces; no runtime or vision Tool is mounted. */
export function apply(ctx: Context, config: VisionToolkitAdapterConfig): void {
  let current = (): VisionToolkitAdapterConfig => config
  installSettingsSection(ctx, VISION_TOOLKIT_SETTINGS_NAMESPACE, Config, config, {
    setSource(source) { current = source },
    onChange() {
      if (current().runtime.mode !== 'managed') {
        throw new Error('vision-toolkit runtime.mode must remain managed')
      }
    },
  })
  ctx.skills.register(STATUS_SKILL)
  ctx.tools.register(defineTool({
    name: 'vision_toolkit_status',
    description: 'Report why the pinned e-Mate Vision Toolkit adapter is unavailable without installing or executing a runtime.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string', enum: ['blocked'], required: true },
          code: { type: 'string', enum: [VISION_POLICY_BLOCK_CODE], required: true },
          harnessVersion: { type: 'string', required: true },
          upstreamCommit: { type: 'string', required: true },
          managedRuntime: { type: 'string', enum: ['deferred'], required: true },
          runtimeInstalled: { type: 'boolean', required: true },
          toolsRegistered: { type: 'integer', required: true },
          blockedTools: { type: 'array', items: { type: 'string' }, required: true },
          reason: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: () => Promise.resolve(statusValue()),
    presentCall: () => ({ card: 'generic', title: 'Vision Toolkit status', kind: 'read' }),
  }))
  const capabilities = (ctx as Context & { emateCapabilities: { register(definition: unknown): () => void } }).emateCapabilities
  ctx.effect(() => capabilities.register({
    id: 'vision-ocr',
    title: '视觉 / OCR',
    summary: '通过受企业模型策略约束的 Vision Toolkit 处理 OCR 与图像理解；缺少策略绑定时保持关闭。',
    icon_key: 'ocr',
    order: 45,
    actions: [],
    status: async () => ({
      state: ADAPTER_STATUS.state,
      detail: `固定运行时缺少企业多模态模型策略绑定；Vision/OCR 工具保持禁用（${ADAPTER_STATUS.code}）。`,
      action_ids: [],
    }),
  }), 'emate.vision-toolkit: capability metadata')
  ctx.logger.warn('%s: %s', VISION_POLICY_BLOCK_CODE, ADAPTER_STATUS.reason)
}
