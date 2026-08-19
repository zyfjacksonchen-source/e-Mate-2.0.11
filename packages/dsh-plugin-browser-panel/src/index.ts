export const name = 'emate-browser-panel'
export const inject = ['connection', 'sessions', 'emateCapabilities', 'emateBrowser']
export const CHANNEL = '/emate.browserPanel'

const PLATFORM_BLOCKER = 'DSH_BROWSER_PLATFORM_UNSUPPORTED'
const CONNECTION_BLOCKER = 'DSH_BROWSER_EXTENSION_NOT_CONNECTED'
const WINDOWS_BLOCKER = 'DSH_BROWSER_WINDOWS_ACCEPTANCE_PENDING'

function badRequest(message: string) {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

/** Project the verified dsh-browser carrier state without inventing page events. */
export function statusForPlatform(platform: NodeJS.Platform, runtime: { connected?: boolean; connected_at?: string } = {}) {
  if (platform !== 'darwin' && platform !== 'win32') return {
    schema_version: 1, state: 'blocked', ready: false, blocker: PLATFORM_BLOCKER,
    provider: 'dsh-browser', session_bound: true, browser_state_session_bound: true, provider_verified: false,
  }
  const connected = runtime.connected === true
  const windowsPending = platform === 'win32'
  const ready = connected && !windowsPending
  return {
    schema_version: 1,
    state: ready ? 'ready' : 'setup-required',
    ready,
    ...(ready ? {} : { blocker: windowsPending && connected ? WINDOWS_BLOCKER : CONNECTION_BLOCKER }),
    provider: 'dsh-browser',
    upstream_commit: '01f0b216b1bde88b5f9c6575ce9fb922db6fd8fb',
    supported_platforms: ['darwin', 'win32'],
    session_bound: true,
    browser_state_session_bound: true,
    provider_verified: ready,
    connected,
    ...(runtime.connected_at === undefined ? {} : { connected_at: runtime.connected_at }),
    windows_acceptance_verified: false,
  }
}

/**
 * Expose the real Host bridge state through the existing Connection RPC and
 * conversation.view slots. Browser control remains owned by target Tools.
 */
export function apply(ctx: any): void {
  ctx.effect(() => ctx.emateCapabilities.register({
    id: 'browser',
    title: '浏览器操作',
    summary: '使用会话绑定的浏览器 Skill 与面板执行真实页面交互；未验收的平台保持不可用。',
    icon_key: 'browser',
    order: 40,
    actions: [],
    status: async () => {
      const status = statusForPlatform(process.platform, ctx.emateBrowser.status())
      const detail = status.ready
        ? 'dsh-browser 已连接；页面操作绑定当前 e-Mate 会话。'
        : status.blocker === WINDOWS_BLOCKER
          ? 'Windows 扩展已连接，仍需完成真实 Windows Computer Use 验收。'
          : status.blocker === CONNECTION_BLOCKER
            ? '请安装并启用 e-Mate 浏览器扩展。'
            : '当前平台不在 e-Mate 2.0.10 支持范围。'
      return { state: status.state, detail, action_ids: [] }
    },
  }), 'emate.browserPanel: capability metadata')
  ctx.effect(() => ctx.connection.rpc.handle(
    CHANNEL,
    async (endpoint: string, payload: unknown) => {
      if (endpoint !== 'status'
        || payload === null
        || typeof payload !== 'object'
        || Array.isArray(payload)
        || Object.keys(payload).join(',') !== 'session_id') {
        return badRequest('invalid browser-panel status request')
      }
      const sessionId = (payload as Record<string, unknown>).session_id
      if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 256
        || ctx.sessions.get(sessionId) === undefined) {
        return badRequest('unknown browser-panel session')
      }
      return {
        ok: true,
        value: statusForPlatform(process.platform, ctx.emateBrowser.status()),
      }
    },
    { authority: 'loopback' },
  ), 'emate.browserPanel: fail-closed target-native RPC status')
}
