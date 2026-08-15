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
}

interface Props {
  callConnections: (endpoint: string, payload: Record<string, unknown>) => Promise<RpcResult>
  setCredential: (ref: string, value: string) => Promise<void>
  unsetCredential: (ref: string) => Promise<void>
  LinkIcon: ComponentType<{ size?: number }>
  RefreshIcon: ComponentType<{ size?: number }>
}

const REF = /^[A-Za-z_][A-Za-z0-9_]*$/u

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

export function ConnectionsSettings({
  callConnections,
  setCredential,
  unsetCredential,
  LinkIcon,
  RefreshIcon,
}: Props) {
  const focused = new URLSearchParams(location.search).get('connectors') === 'feishu,tencent-docs'
  const [items, setItems] = useState<ConnectionItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [confirmRef, setConfirmRef] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

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
        <button className={css.iconButton} type="button" aria-label="刷新外部连接" disabled={busyRef !== null} onClick={() => { void load().catch(error => { setStatus(message(error)) }) }}>
          <RefreshIcon size={16} />
        </button>
      </header>

      <p className={css.note}>凭据只进入本机 Keychain 或 CurrentUser DPAPI；页面不会读取或回显已保存的值。</p>

      {status && <p className={css.notice} role="status">{status}</p>}

      <div className={css.list}>
        {items.filter(item => !focused || item.id === 'feishu' || item.id === 'tencent-docs').map(item => (
          <article className={css.row} key={item.id} data-state={item.state}>
            <span className={css.icon} aria-hidden="true"><LinkIcon size={16} /></span>
            <div className={css.body}>
              <div className={css.title}>
                <strong>{item.title}</strong>
                <span>{item.state === 'setup-required' ? '需要配置' : '暂未启用'}</span>
              </div>
              <p>{item.summary}</p>
              <small>{item.detail}</small>
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
