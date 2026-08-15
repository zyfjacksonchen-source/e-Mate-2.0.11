export const name = 'emate-browser-panel'
export const inject = ['connection', 'sessions', 'emateCapabilities']
export const CHANNEL = '/emate.browserPanel'

const SOURCE_BLOCKER = 'BROWSER_PANEL_SOURCE_UNAVAILABLE'
const WINDOWS_BLOCKER = 'PLAYWRIGHT_MCP_EDGE_UNVERIFIED'
const MACOS_BLOCKER = 'EGO_BROWSER_RUNTIME_UNVERIFIED'

function badRequest(message: string) {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

/** Report the selected platform provider without probing, installing, or starting it. */
export function statusForPlatform(platform: NodeJS.Platform) {
  if (platform === 'win32') {
    return {
      schema_version: 1,
      state: 'setup-required',
      ready: false,
      blocker: WINDOWS_BLOCKER,
      session_bound: true,
      browser_state_session_bound: false,
      provider_verified: false,
      playwright_mcp: {
        package: '@playwright/mcp',
        version: '0.0.78',
        browser: 'system-edge',
        workspace_roots_supported: false,
        windows_acceptance_verified: false,
        code: WINDOWS_BLOCKER,
      },
    }
  }
  if (platform === 'darwin') {
    return {
      schema_version: 1,
      state: 'setup-required',
      ready: false,
      blocker: MACOS_BLOCKER,
      session_bound: true,
      browser_state_session_bound: false,
      provider_verified: false,
      ego_browser: {
        platform_eligible: true,
        supported_platforms: ['darwin'],
        code: MACOS_BLOCKER,
      },
    }
  }
  return {
    schema_version: 1,
    state: 'blocked',
    ready: false,
    blocker: SOURCE_BLOCKER,
    session_bound: true,
    browser_state_session_bound: false,
    provider_verified: false,
    ego_browser: {
      platform_eligible: false,
      supported_platforms: ['darwin'],
      code: 'EGO_BROWSER_NOT_SELECTED',
    },
  }
}

/**
 * Expose only verified browser-panel facts. The catalog source and npm package
 * are unavailable, and no browser runtime service exists in pinned rc.5, so
 * this adapter must never claim or synthesize a controllable browser.
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
      const status = statusForPlatform(process.platform)
      const detail = status.blocker === WINDOWS_BLOCKER
        ? 'Windows Edge 候选方案尚未完成项目隔离与实机验收。'
        : status.blocker === MACOS_BLOCKER
          ? 'macOS Ego Browser 尚未完成启动、权限、隔离与下载验收。'
          : '当前平台没有已验证的浏览器运行服务。'
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
        value: statusForPlatform(process.platform),
      }
    },
    { authority: 'loopback' },
  ), 'emate.browserPanel: fail-closed target-native RPC status')
}
