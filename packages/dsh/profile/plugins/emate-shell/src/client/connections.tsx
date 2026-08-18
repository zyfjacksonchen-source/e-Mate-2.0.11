import { useEffect, useState, type ComponentType } from 'react'
import css from './connections.module.css'

interface RpcResult {
  ok: boolean
  value?: unknown
  error?: { message?: string }
}

interface Field {
  ref: string
  label: string
  secret: boolean
  configured: boolean
  source?: string
  writable: boolean
}

interface ConnectionItem {
  id: string
  title: string
  summary: string
  state: 'setup-required' | 'blocked'
  detail: string
  fields: Field[]
  qr_supported: boolean
  oauth_supported: boolean
}

type QrState = 'pending' | 'scanned' | 'needs-verification' | 'authorized' | 'expired' | 'failed' | 'cancelled'

interface QrAttempt {
  connectionId: string
  attemptId: string
  state: QrState
  expiresAt: number
  qrCodeDataUrl?: string
  verificationRequired: boolean
  detail: string
}

type OAuthState = 'pending' | 'authorized' | 'denied' | 'expired' | 'failed' | 'cancelled'

interface OAuthAttempt {
  connectionId: 'feishu' | 'tencent-docs'
  attemptId: string
  state: OAuthState
  expiresAt: number
  authorizationUrl?: string
  userCode?: string
  qrCodeDataUrl?: string
  detail: string
}

interface Props {
  callConnections: (endpoint: string, payload: Record<string, unknown>) => Promise<RpcResult>
  setCredential: (ref: string, value: string) => Promise<void>
  unsetCredential: (ref: string) => Promise<void>
  LinkIcon: ComponentType<{ size?: number }>
  RefreshIcon: ComponentType<{ size?: number }>
}

const REF = /^[A-Za-z_][A-Za-z0-9_]*$/u
const QR_ATTEMPT = /^[0-9a-f-]{36}$/iu
const QR_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/u
const ACTIVE_QR_STATES = new Set<QrState>(['pending', 'scanned'])
const ACTIVE_OAUTH_STATES = new Set<OAuthState>(['pending'])
const OAUTH_ORIGINS = new Map([
  ['feishu', ['https://accounts.feishu.cn', '/oauth/v1/device/verify']],
  ['tencent-docs', ['https://docs.qq.com', '/scenario/open-claw.html']],
])

function message(error: unknown): string {
  return error instanceof Error ? error.message : '外部连接暂不可用。'
}

function catalog(value: unknown): ConnectionItem[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('外部连接目录无效。')
  const root = value as Record<string, unknown>
  if (root.schema_version !== 1 || !Array.isArray(root.items)) throw new Error('外部连接目录无效。')
  for (const item of root.items) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error('外部连接目录无效。')
    const entry = item as Record<string, unknown>
    if (typeof entry.id !== 'string'
      || typeof entry.title !== 'string'
      || typeof entry.summary !== 'string'
      || !['setup-required', 'blocked'].includes(String(entry.state))
      || typeof entry.detail !== 'string'
      || typeof entry.qr_supported !== 'boolean'
      || typeof entry.oauth_supported !== 'boolean'
      || !Array.isArray(entry.fields)) throw new Error('外部连接目录无效。')
    for (const field of entry.fields) {
      if (field === null || typeof field !== 'object' || Array.isArray(field)) throw new Error('外部连接凭据目录无效。')
      const credential = field as Record<string, unknown>
      if (typeof credential.ref !== 'string' || !REF.test(credential.ref)
        || typeof credential.label !== 'string'
        || typeof credential.secret !== 'boolean'
        || typeof credential.configured !== 'boolean'
        || typeof credential.writable !== 'boolean'
        || (credential.source !== undefined && typeof credential.source !== 'string')) {
        throw new Error('外部连接凭据目录无效。')
      }
    }
  }
  return root.items as ConnectionItem[]
}

function oauthAttempt(value: unknown): OAuthAttempt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('官方授权状态无效。')
  const source = value as Record<string, unknown>
  if (!['feishu', 'tencent-docs'].includes(String(source.connection_id))
    || typeof source.attempt_id !== 'string' || !QR_ATTEMPT.test(source.attempt_id)
    || !['pending', 'authorized', 'denied', 'expired', 'failed', 'cancelled'].includes(String(source.state))
    || typeof source.expires_at !== 'number' || !Number.isSafeInteger(source.expires_at)
    || typeof source.detail !== 'string'
    || (source.user_code !== undefined && (typeof source.user_code !== 'string' || !/^[\x21-\x7E]{1,64}$/u.test(source.user_code)))
    || (source.qr_code_data_url !== undefined
      && (typeof source.qr_code_data_url !== 'string' || source.qr_code_data_url.length > 1_000_000 || !QR_DATA_URL.test(source.qr_code_data_url)))) {
    throw new Error('官方授权状态无效。')
  }
  if (source.authorization_url !== undefined) {
    if (typeof source.authorization_url !== 'string') throw new Error('官方授权链接无效。')
    const url = new URL(source.authorization_url)
    const [origin, pathname] = OAUTH_ORIGINS.get(String(source.connection_id)) ?? []
    if (url.origin !== origin || url.pathname !== pathname || url.username || url.password || url.hash) {
      throw new Error('官方授权链接无效。')
    }
  }
  return {
    connectionId: source.connection_id as OAuthAttempt['connectionId'],
    attemptId: source.attempt_id,
    state: source.state as OAuthState,
    expiresAt: source.expires_at,
    ...(source.authorization_url === undefined ? {} : { authorizationUrl: source.authorization_url }),
    ...(source.user_code === undefined ? {} : { userCode: source.user_code }),
    ...(source.qr_code_data_url === undefined ? {} : { qrCodeDataUrl: source.qr_code_data_url }),
    detail: source.detail,
  }
}

function qrAttempt(value: unknown): QrAttempt {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('二维码状态无效。')
  const source = value as Record<string, unknown>
  if (source.connection_id !== 'wechat'
    || typeof source.attempt_id !== 'string' || !QR_ATTEMPT.test(source.attempt_id)
    || !['pending', 'scanned', 'needs-verification', 'authorized', 'expired', 'failed', 'cancelled'].includes(String(source.state))
    || typeof source.expires_at !== 'number' || !Number.isSafeInteger(source.expires_at)
    || typeof source.detail !== 'string'
    || (source.qr_code_data_url !== undefined
      && (typeof source.qr_code_data_url !== 'string' || source.qr_code_data_url.length > 1_000_000 || !QR_DATA_URL.test(source.qr_code_data_url)))
    || (source.verification_required !== undefined && source.verification_required !== true)) {
    throw new Error('二维码状态无效。')
  }
  return {
    connectionId: source.connection_id,
    attemptId: source.attempt_id,
    state: source.state as QrState,
    expiresAt: source.expires_at,
    ...(source.qr_code_data_url === undefined ? {} : { qrCodeDataUrl: source.qr_code_data_url }),
    verificationRequired: source.verification_required === true,
    detail: source.detail,
  }
}

export function ConnectionsSettings({
  callConnections,
  setCredential,
  unsetCredential,
  LinkIcon,
  RefreshIcon,
}: Props) {
  const focused = new URLSearchParams(location.search).get('connectors') === 'feishu,tencent-docs'
  const requested = new URLSearchParams(location.search).get('connection')
  const requestedConnection = ['feishu', 'tencent-docs', 'wechat'].includes(requested ?? '') ? requested : null
  const [items, setItems] = useState<ConnectionItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [confirmRef, setConfirmRef] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [qr, setQr] = useState<QrAttempt | null>(null)
  const [qrBusy, setQrBusy] = useState(false)
  const [verifyCode, setVerifyCode] = useState('')
  const [oauth, setOauth] = useState<OAuthAttempt | null>(null)
  const [oauthBusy, setOauthBusy] = useState(false)

  const load = async () => {
    setStatus(null)
    const result = await callConnections('catalog', {})
    if (!result.ok) throw new Error(result.error?.message ?? '外部连接目录读取失败。')
    setItems(catalog(result.value))
  }

  useEffect(() => {
    let active = true
    void load().catch(error => { if (active) setStatus(message(error)) })
    return () => { active = false }
  }, [callConnections])

  useEffect(() => {
    if (qr === null || !ACTIVE_QR_STATES.has(qr.state)) return undefined
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const result = await callConnections('qr.poll', {
          connection_id: qr.connectionId,
          attempt_id: qr.attemptId,
        })
        if (!active) return
        if (!result.ok) throw new Error(result.error?.message ?? '二维码状态读取失败。')
        const next = qrAttempt(result.value)
        setQr(next)
        if (ACTIVE_QR_STATES.has(next.state)) timer = setTimeout(() => { void poll() }, 1_000)
        else if (next.state === 'authorized') await load()
      } catch (error) {
        if (active) setStatus(message(error))
      }
    }
    timer = setTimeout(() => { void poll() }, 1_000)
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [callConnections, qr?.attemptId, qr?.connectionId, qr?.state])

  useEffect(() => {
    if (oauth === null || !ACTIVE_OAUTH_STATES.has(oauth.state)) return undefined
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const result = await callConnections('oauth.poll', {
          connection_id: oauth.connectionId,
          attempt_id: oauth.attemptId,
        })
        if (!active) return
        if (!result.ok) throw new Error(result.error?.message ?? '官方授权状态读取失败。')
        const next = oauthAttempt(result.value)
        setOauth(next)
        if (ACTIVE_OAUTH_STATES.has(next.state)) timer = setTimeout(() => { void poll() }, 1_000)
        else if (next.state === 'authorized') await load()
      } catch (error) {
        if (active) setStatus(message(error))
      }
    }
    timer = setTimeout(() => { void poll() }, 1_000)
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [callConnections, oauth?.attemptId, oauth?.connectionId, oauth?.state])

  const beginOauth = async (item: ConnectionItem) => {
    if (oauthBusy) return
    setOauthBusy(true)
    setStatus(null)
    try {
      const result = await callConnections('oauth.begin', { connection_id: item.id })
      if (!result.ok) throw new Error(result.error?.message ?? '官方授权链接生成失败。')
      setOauth(oauthAttempt(result.value))
    } catch (error) {
      setStatus(message(error))
    } finally {
      setOauthBusy(false)
    }
  }

  const cancelOauth = async () => {
    if (oauth === null || oauthBusy) return
    setOauthBusy(true)
    try {
      const result = await callConnections('oauth.cancel', {
        connection_id: oauth.connectionId,
        attempt_id: oauth.attemptId,
      })
      if (!result.ok) throw new Error(result.error?.message ?? '官方授权取消失败。')
      setOauth(oauthAttempt(result.value))
    } catch (error) {
      setStatus(message(error))
    } finally {
      setOauthBusy(false)
    }
  }

  const beginQr = async (item: ConnectionItem) => {
    if (qrBusy) return
    setQrBusy(true)
    setVerifyCode('')
    setStatus(null)
    try {
      const result = await callConnections('qr.begin', { connection_id: item.id })
      if (!result.ok) throw new Error(result.error?.message ?? '二维码生成失败。')
      setQr(qrAttempt(result.value))
    } catch (error) {
      setStatus(message(error))
    } finally {
      setQrBusy(false)
    }
  }

  const cancelQr = async () => {
    if (qr === null || qrBusy) return
    setQrBusy(true)
    try {
      const result = await callConnections('qr.cancel', {
        connection_id: qr.connectionId,
        attempt_id: qr.attemptId,
      })
      if (!result.ok) throw new Error(result.error?.message ?? '二维码取消失败。')
      setQr(qrAttempt(result.value))
    } catch (error) {
      setStatus(message(error))
    } finally {
      setQrBusy(false)
    }
  }

  const submitVerifyCode = async () => {
    if (qr === null || qrBusy || !/^\d{4,8}$/u.test(verifyCode)) return
    setQrBusy(true)
    setStatus(null)
    try {
      const result = await callConnections('qr.poll', {
        connection_id: qr.connectionId,
        attempt_id: qr.attemptId,
        verify_code: verifyCode,
      })
      if (!result.ok) throw new Error(result.error?.message ?? '配对码提交失败。')
      setVerifyCode('')
      setQr(qrAttempt(result.value))
    } catch (error) {
      setStatus(message(error))
    } finally {
      setQrBusy(false)
    }
  }

  const save = async (field: Field) => {
    const value = drafts[field.ref]?.trim() ?? ''
    if (value.length < 1 || value.length > 4096 || busyRef !== null || !field.writable) return
    setBusyRef(field.ref)
    setConfirmRef(null)
    setStatus(null)
    try {
      await setCredential(field.ref, value)
      setDrafts(current => ({ ...current, [field.ref]: '' }))
      await load()
      setStatus(`${field.label} 已保存到本机安全凭据库。`)
    } catch (error) {
      setStatus(message(error))
    } finally {
      setBusyRef(null)
    }
  }

  const clear = async (field: Field) => {
    if (confirmRef !== field.ref) {
      setConfirmRef(field.ref)
      setStatus(`再次点击“确认清除”以移除 ${field.label}。`)
      return
    }
    if (busyRef !== null || !field.writable) return
    setBusyRef(field.ref)
    setStatus(null)
    try {
      await unsetCredential(field.ref)
      setConfirmRef(null)
      await load()
      setStatus(`${field.label} 已从本机安全凭据库移除。`)
    } catch (error) {
      setStatus(message(error))
    } finally {
      setBusyRef(null)
    }
  }

  return (
    <section className={css.settings} aria-labelledby="emate-connections-settings-title">
      <header className={css.heading}>
        <h2 id="emate-connections-settings-title">外部连接</h2>
        <button className={css.iconButton} type="button" aria-label="刷新外部连接" disabled={busyRef !== null || qrBusy || oauthBusy} onClick={() => { void load().catch(error => { setStatus(message(error)) }) }}>
          <RefreshIcon size={16} />
        </button>
      </header>

      <p className={css.note}>凭据只进入本机 Keychain 或 CurrentUser DPAPI；页面不会读取或回显已保存的值。</p>

      {status && <p className={css.notice} role="status">{status}</p>}

      <div className={css.list}>
        {items.filter(item => requestedConnection !== null
          ? item.id === requestedConnection
          : !focused || item.id === 'feishu' || item.id === 'tencent-docs').map(item => (
          <article className={css.row} key={item.id} data-state={item.state}>
            <span className={css.icon} aria-hidden="true"><LinkIcon size={16} /></span>
            <div className={css.body}>
              <div className={css.title}>
                <strong>{item.title}</strong>
                <span>{item.state === 'setup-required' ? '需要配置' : '暂未启用'}</span>
              </div>
              <p>{item.summary}</p>
              <small>{item.detail}</small>
              {item.oauth_supported && <div className={css.qrActions}><button type="button" disabled={busyRef !== null || qrBusy || oauthBusy} onClick={() => { void beginOauth(item) }}>{oauthBusy ? '正在生成' : '生成官方授权链接'}</button></div>}
              {oauth?.connectionId === item.id && <section className={css.qrPanel} aria-label={`${item.title}官方授权`}>
                {oauth.qrCodeDataUrl && <img className={css.qrImage} src={oauth.qrCodeDataUrl} alt={`用于授权 ${item.title} 的一次性二维码`} />}
                {oauth.userCode && <p>授权码 <code>{oauth.userCode}</code></p>}
                {oauth.authorizationUrl && <a className={css.oauthLink} href={oauth.authorizationUrl} target="_blank" rel="noopener noreferrer">打开{item.title}官方授权页</a>}
                <p role="status">{oauth.detail}</p>
                <div className={css.actions}>
                  {oauth.state === 'pending' && <button type="button" disabled={oauthBusy} onClick={() => { void cancelOauth() }}>取消授权</button>}
                  {['denied', 'expired', 'failed', 'cancelled'].includes(oauth.state) && <button type="button" disabled={oauthBusy} onClick={() => { void beginOauth(item) }}>重新生成</button>}
                </div>
              </section>}
              {item.qr_supported && <div className={css.qrActions}><button type="button" disabled={busyRef !== null || qrBusy} onClick={() => { void beginQr(item) }}>{qrBusy ? '正在生成' : '生成授权二维码'}</button></div>}
              {qr?.connectionId === item.id && <section className={css.qrPanel} aria-label={`${item.title}扫码授权`}>
                {qr.qrCodeDataUrl && <img className={css.qrImage} src={qr.qrCodeDataUrl} alt={`用于授权 ${item.title} 的一次性二维码`} />}
                <p role="status">{qr.detail}</p>
                {qr.verificationRequired && <label className={css.qrVerification}><span>配对码</span><input inputMode="numeric" autoComplete="one-time-code" minLength={4} maxLength={8} pattern="[0-9]{4,8}" value={verifyCode} onChange={event => { setVerifyCode(event.target.value.replace(/\D/gu, '').slice(0, 8)) }} /><button type="button" disabled={qrBusy || !/^\d{4,8}$/u.test(verifyCode)} onClick={() => { void submitVerifyCode() }}>提交配对码</button></label>}
                <div className={css.actions}>
                  {['pending', 'scanned', 'needs-verification'].includes(qr.state) && <button type="button" disabled={qrBusy} onClick={() => { void cancelQr() }}>取消扫码</button>}
                  {['expired', 'failed', 'cancelled'].includes(qr.state) && <button type="button" disabled={qrBusy} onClick={() => { void beginQr(item) }}>重新生成</button>}
                </div>
              </section>}
              {item.fields.length > 0 && (
                <div className={css.fields}>
                  {item.fields.map(field => (
                    <label className={css.field} key={field.ref}>
                      <span>
                        <strong>{field.label}</strong>
                        <small>{field.configured ? `已配置${field.source ? ` · ${field.source}` : ''}` : '未配置'}</small>
                      </span>
                      <input
                        type={field.secret ? 'password' : 'text'}
                        autoComplete={field.secret ? 'new-password' : 'off'}
                        maxLength={4096}
                        disabled={busyRef !== null || !field.writable}
                        value={drafts[field.ref] ?? ''}
                        placeholder={field.configured ? '输入新值可覆盖' : `输入 ${field.label}`}
                        onChange={event => { setDrafts(current => ({ ...current, [field.ref]: event.target.value })) }}
                      />
                      <div className={css.actions}>
                        <button type="button" disabled={busyRef !== null || !field.writable || !(drafts[field.ref]?.trim())} onClick={() => { void save(field) }}>
                          {busyRef === field.ref ? '处理中' : '保存'}
                        </button>
                        {field.configured && (
                          <button className={confirmRef === field.ref ? css.danger : undefined} type="button" disabled={busyRef !== null || !field.writable} onClick={() => { void clear(field) }}>
                            {confirmRef === field.ref ? '确认清除' : '清除'}
                          </button>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
