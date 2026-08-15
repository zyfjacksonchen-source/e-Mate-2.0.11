import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

export const inject = ['slots', 'connection']

type RpcResult = { ok: boolean; value?: unknown; error?: { message?: string } }
type Status = {
  state: 'blocked' | 'setup-required'
  blocker: 'BROWSER_PANEL_SOURCE_UNAVAILABLE' | 'PLAYWRIGHT_MCP_EDGE_UNVERIFIED' | 'EGO_BROWSER_RUNTIME_UNVERIFIED'
  egoPlatformEligible?: boolean
}

interface Injected {
  callStatus: (sessionId: string) => Promise<RpcResult>
}

const styles: Record<string, CSSProperties> = {
  root: { height: '100%', display: 'grid', placeItems: 'center', padding: 24, color: 'var(--dsw-alias-label-primary)' },
  card: { width: 'min(620px, 100%)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 16, padding: 24, background: 'var(--dsw-alias-bg-layer-1)' },
  badge: { display: 'inline-flex', borderRadius: 999, padding: '4px 10px', background: 'color-mix(in srgb, var(--dsw-alias-label-warning, #b7791f) 16%, transparent)', color: 'var(--dsw-alias-label-warning, #b7791f)', fontSize: 12 },
  detail: { color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.65 },
  button: { marginTop: 8, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '7px 12px', background: 'transparent', color: 'inherit', cursor: 'pointer' },
}

function parseStatus(value: unknown): Status {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('浏览器面板状态无效。')
  const status = value as Record<string, unknown>
  if (status.schema_version !== 1 || status.ready !== false || status.provider_verified !== false) {
    throw new Error('浏览器面板状态无效。')
  }
  if (status.state === 'setup-required' && status.blocker === 'PLAYWRIGHT_MCP_EDGE_UNVERIFIED') {
    const provider = status.playwright_mcp
    if (provider === null || typeof provider !== 'object' || Array.isArray(provider)
      || (provider as Record<string, unknown>).package !== '@playwright/mcp'
      || (provider as Record<string, unknown>).version !== '0.0.78'
      || (provider as Record<string, unknown>).browser !== 'system-edge'
      || (provider as Record<string, unknown>).workspace_roots_supported !== false
      || (provider as Record<string, unknown>).windows_acceptance_verified !== false) {
      throw new Error('浏览器面板状态无效。')
    }
    return { state: 'setup-required', blocker: 'PLAYWRIGHT_MCP_EDGE_UNVERIFIED' }
  }
  const ego = status.ego_browser
  if (status.state === 'setup-required' && status.blocker === 'EGO_BROWSER_RUNTIME_UNVERIFIED'
    && ego !== null && typeof ego === 'object' && !Array.isArray(ego)
    && (ego as Record<string, unknown>).platform_eligible === true
    && (ego as Record<string, unknown>).code === 'EGO_BROWSER_RUNTIME_UNVERIFIED') {
    return {
      state: 'setup-required',
      blocker: 'EGO_BROWSER_RUNTIME_UNVERIFIED',
      egoPlatformEligible: true,
    }
  }
  if (status.state !== 'blocked' || status.blocker !== 'BROWSER_PANEL_SOURCE_UNAVAILABLE'
    || ego === null || typeof ego !== 'object' || Array.isArray(ego)
    || typeof (ego as Record<string, unknown>).platform_eligible !== 'boolean') {
    throw new Error('浏览器面板状态无效。')
  }
  return {
    state: 'blocked',
    blocker: 'BROWSER_PANEL_SOURCE_UNAVAILABLE',
    egoPlatformEligible: (ego as Record<string, unknown>).platform_eligible as boolean,
  }
}

function BrowserPanel({ sessionId, callStatus }: ConvViewProps & Injected) {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState('正在核验浏览器运行服务…')

  const refresh = useCallback(async () => {
    setMessage('正在核验浏览器运行服务…')
    try {
      const result = await callStatus(sessionId)
      if (!result.ok) throw new Error(result.error?.message ?? '浏览器面板状态读取失败。')
      setStatus(parseStatus(result.value))
      setMessage('')
    } catch (error) {
      setStatus(null)
      setMessage(error instanceof Error ? error.message : '浏览器面板状态读取失败。')
    }
  }, [callStatus, sessionId])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <section style={styles.root} aria-label="浏览器面板">
      <div style={styles.card}>
        <span style={styles.badge}>{status?.state === 'setup-required' ? '需要设置' : '不可用'}</span>
        <h2>浏览器面板</h2>
        {message !== '' ? <p role="status" style={styles.detail}>{message}</p> : (
          <>
            {status?.state === 'setup-required' ? (
              <p role="status" style={styles.detail}>{status.blocker === 'PLAYWRIGHT_MCP_EDGE_UNVERIFIED'
                ? 'Windows 已选择 @playwright/mcp@0.0.78 与系统 Edge 作为候选方案；固定的 Harness rc.5 没有 Session/项目绑定的 MCP workspace-root 路径，且真实 Windows 验收尚未完成。'
                : 'macOS 已选择 ego-browser 候选方案；真实启动、权限、任务空间隔离、清理、交互与下载验收尚未完成。'}</p>
            ) : (
              <>
                <p role="status" style={styles.detail}>目录中声明的 dsh-browser-panel 源码仓库与 npm 包均无法验证，当前也没有已验证的浏览器运行服务。e-Mate 不会伪造可用状态或浏览器事件。</p>
                <p style={styles.detail}>{status?.egoPlatformEligible === true
                  ? '当前平台可使用 macOS 专属的 ego-browser 适配，但其运行服务尚未验证，因此本面板仍保持不可用。'
                  : '当前平台没有已选定且完成验收的浏览器运行服务。'}</p>
              </>
            )}
          </>
        )}
        <button style={styles.button} type="button" onClick={() => { void refresh() }}>重新核验</button>
      </div>
    </section>
  )
}

export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'browser-panel',
    order: 30,
    label: '浏览器',
    inject: () => ({
      callStatus: (sessionId: string) =>
        ctx.connection.rpc.call('/emate.browserPanel', 'status', { session_id: sessionId }),
    }),
  }, BrowserPanel))
}
