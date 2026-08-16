/** Fail-closed adapter receipt for xmanrui/dsh-im on the pinned rc.5 runtime. */

interface CapabilityStatus {
  state: 'blocked'
  detail: string
  action_ids: readonly string[]
}

interface CapabilityDefinition {
  id: string
  title: string
  summary: string
  icon_key: 'collaboration'
  order: number
  actions: readonly never[]
  status(): Promise<CapabilityStatus>
}

interface AdapterContext {
  emateCapabilities: {
    register(definition: CapabilityDefinition): () => void
  }
  effect(effect: () => () => void, label: string): void
}

export const name = 'emate-dsh-im'
export const inject = ['emateCapabilities']
export const DSH_IM_BLOCK_CODE = 'EMATE_DSH_IM_RUNTIME_UNVERIFIED'
export const UPSTREAM_COMMIT = '2eea8a08bcd8ef91e8845de1f300b5715b746938'

export const DSH_IM_ADAPTER_STATUS = Object.freeze({
  state: 'blocked' as const,
  code: DSH_IM_BLOCK_CODE,
  harnessVersion: '0.1.0-rc.5' as const,
  upstreamVersion: '0.2.0' as const,
  upstreamCommit: UPSTREAM_COMMIT,
  runtimeInstalled: false as const,
  transportsRegistered: 0 as const,
  toolsRegistered: 0 as const,
  auditedChannels: Object.freeze([
    'feishu',
    'weixin',
    'dingtalk',
    'wecom',
    'telegram',
    'discord',
    'whatsapp',
  ] as const),
  excludedChannels: Object.freeze(['qq'] as const),
  reason: 'The upstream runtime targets an unverified Harness rc.6 contract and its QQ connector is UNLICENSED; project/session binding and real authorization are not yet accepted on the pinned rc.5 runtime.',
})

export function apply(ctx: AdapterContext): void {
  ctx.effect(() => ctx.emateCapabilities.register({
    id: 'dsh-im',
    title: 'IM 外部连接',
    summary: 'dsh-im 的消息通道适配边界；完成固定运行时、许可与项目绑定验收后才会启用。',
    icon_key: 'collaboration',
    order: 55,
    actions: [],
    status: async () => ({
      state: DSH_IM_ADAPTER_STATUS.state,
      detail: `运行适配尚未通过固定 rc.5 与真实授权验收（${DSH_IM_BLOCK_CODE}）。`,
      action_ids: [],
    }),
  }), 'emate.dsh-im: external connection capability metadata')
}
