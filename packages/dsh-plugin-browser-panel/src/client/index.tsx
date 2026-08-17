import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

export const inject = ['slots', 'connection']

type RpcResult = { ok: boolean; value?: unknown; error?: { message?: string } }
type Status = {
  state: 'ready' | 'blocked' | 'setup-required'
  blocker?: 'DSH_BROWSER_PLATFORM_UNSUPPORTED' | 'DSH_BROWSER_EXTENSION_NOT_CONNECTED' | 'DSH_BROWSER_WINDOWS_ACCEPTANCE_PENDING'
  connected: boolean
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
  if (status.schema_version !== 1 || status.provider !== 'dsh-browser'
    || status.session_bound !== true || status.browser_state_session_bound !== true
    || typeof status.connected !== 'boolean') {
    throw new Error('浏览器面板状态无效。')
  }
  if (status.state === 'ready' && status.ready === true && status.provider_verified === true && status.connected === true) {
    return { state: 'ready', connected: true }
  }
  const blockers = new Set(['DSH_BROWSER_PLATFORM_UNSUPPORTED', 'DSH_BROWSER_EXTENSION_NOT_CONNECTED', 'DSH_BROWSER_WINDOWS_ACCEPTANCE_PENDING'])
  if ((status.state !== 'blocked' && status.state !== 'setup-required') || status.ready !== false
    || status.provider_verified !== false || !blockers.has(String(status.blocker))) throw new Error('浏览器面板状态无效。')
  return { state: status.state, blocker: status.blocker as Status['blocker'], connected: status.connected }
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
        <span style={styles.badge}>{status?.state === 'ready' ? '已连接' : status?.state === 'setup-required' ? '需要设置' : '不可用'}</span>
        <h2>浏览器面板</h2>
        {message !== '' ? <p role="status" style={styles.detail}>{message}</p> : (
          <>
            <p role="status" style={styles.detail}>{status?.state === 'ready'
              ? 'dsh-browser 已连接。浏览器动作由 Harness 真实 Tool 事件驱动，并绑定当前会话的标签页。点击扩展图标可让下一次浏览器操作改绑到当前标签页。'
              : status?.blocker === 'DSH_BROWSER_WINDOWS_ACCEPTANCE_PENDING'
                ? 'Windows 扩展已连接；真实 Windows Chrome/Edge Computer Use 尚未完成，因此保持失败关闭。'
                : status?.blocker === 'DSH_BROWSER_EXTENSION_NOT_CONNECTED'
                  ? '请在 Chrome 或 Edge 的扩展管理页启用开发者模式，选择“加载已解压的扩展程序”，再选取 e-Mate 数据目录下的 browser-extension 文件夹。默认路径为 ~/.dsh/browser-extension。扩展加载后会自动连接，无需填写地址或 token。'
                  : '当前平台不在 e-Mate 2.0.7 浏览器能力支持范围。'}</p>
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
