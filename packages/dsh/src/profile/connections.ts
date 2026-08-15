export const name = 'emate-connections'
export const inject = ['credentials', 'connection', 'emateCapabilities']
export const CONNECTIONS_CHANNEL = '/emate.connections'


const definitions = [
  {
    id: 'feishu',
    title: '飞书',
    summary: '连接飞书消息、文档与云空间。',
    order: 50,
    fields: [
      { ref: 'EMATE_FEISHU_APP_ID', label: 'App ID', secret: false },
      { ref: 'EMATE_FEISHU_APP_SECRET', label: 'App Secret', secret: true },
    ],
    pending: '凭据已保存在本机；消息适配器完成真实连接验收前不会启用。',
  },
  {
    id: 'tencent-docs',
    title: '腾讯文档',
    summary: '通过官方远程 MCP 连接腾讯文档。',
    order: 60,
    fields: [
      { ref: 'EMATE_TENCENT_DOCS_TOKEN', label: 'OAuth Token', secret: true },
    ],
    pending: '凭据已保存在本机；CredentialRef OAuth/MCP 适配完成前不会启用。',
  },
  {
    id: 'wechat',
    title: '微信',
    summary: '使用设备扫码连接微信消息。',
    order: 70,
    fields: [],
    blocked: '设备扫码需先完成公开授权和服务条款确认。',
  },
  {
    id: 'dingtalk',
    title: '钉钉',
    summary: '连接钉钉 Stream 消息通道。',
    order: 80,
    fields: [
      { ref: 'EMATE_DINGTALK_CLIENT_ID', label: 'Client ID', secret: false },
      { ref: 'EMATE_DINGTALK_CLIENT_SECRET', label: 'Client Secret', secret: true },
    ],
    pending: '凭据已保存在本机；官方 Stream 适配完成真实连接验收前不会启用。',
  },
]

function badRequest(message) {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

async function project(ctx, definition) {
  const fields = []
  for (const field of definition.fields) {
    const view = await ctx.credentials.describe(field.ref)
    fields.push({ ...field, ...view })
  }
  const configured = fields.length > 0 && fields.every(field => field.configured)
  const state = definition.blocked === undefined ? configured ? 'blocked' : 'setup-required' : 'blocked'
  const detail = definition.blocked
    ?? (configured ? definition.pending : '请在设置的“外部连接”中完成本机配置。')
  return {
    id: definition.id,
    title: definition.title,
    summary: definition.summary,
    order: definition.order,
    state,
    detail,
    fields,
  }
}

export function apply(ctx) {
  const capabilities = ctx.get('emateCapabilities')
  if (capabilities === undefined) throw new Error('e-Mate connections requires emateCapabilities')

  for (const definition of definitions) {
    ctx.effect(() => capabilities.register({
      id: definition.id,
      title: definition.title,
      summary: definition.summary,
      icon_key: 'collaboration',
      order: definition.order,
      actions: [],
      async status() {
        const item = await project(ctx, definition)
        return { state: item.state, detail: item.detail, action_ids: [] }
      },
    }), `emate.connections: ${definition.id} capability`)
  }

  ctx.effect(() => ctx.connection.rpc.handle(
    CONNECTIONS_CHANNEL,
    async (endpoint, payload) => {
      if (endpoint !== 'catalog'
        || payload === null
        || typeof payload !== 'object'
        || Array.isArray(payload)
        || Object.keys(payload).length !== 0) {
        return badRequest('unknown e-Mate connections endpoint')
      }
      return {
        ok: true,
        value: {
          schema_version: 1,
          items: await Promise.all(definitions.map(definition => project(ctx, definition))),
        },
      }
    },
    { authority: 'loopback' },
  ), 'emate.connections: target-native RPC channel')
}
