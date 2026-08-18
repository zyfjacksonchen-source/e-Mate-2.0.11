import {
  useEffect, useId, useLayoutEffect, useRef, useState,
  type ComponentType,
} from 'react'
import css from './composer-connectors.module.css'

interface ActiveConnection {
  name: string
  transport: 'streamable-http' | 'stdio'
  active: true
  authorized: boolean
}

interface Props {
  LinkIcon: ComponentType<{ size?: number }>
  callConnections: () => Promise<unknown>
}

export const COMPOSER_PLACEHOLDER = '给小芯发送消息，支持粘贴图片或文件'

function activeConnections(value: unknown): ActiveConnection[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('外部连接响应无效。')
  const response = value as Record<string, unknown>
  if (response.ok !== true || response.value === null || typeof response.value !== 'object' || Array.isArray(response.value)) {
    throw new Error('外部连接读取失败。')
  }
  const body = response.value as Record<string, unknown>
  if (body.schema_version !== 1 || !Array.isArray(body.items)) throw new Error('外部连接响应无效。')
  return body.items.map((entry): ActiveConnection => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('外部连接响应无效。')
    const item = entry as Record<string, unknown>
    if (typeof item.name !== 'string' || !['streamable-http', 'stdio'].includes(String(item.transport))
      || item.active !== true || typeof item.authorized !== 'boolean') throw new Error('外部连接响应无效。')
    return item as unknown as ActiveConnection
  })
}

export function ComposerConnectors({ LinkIcon, callConnections }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const control = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<ActiveConnection[]>([])
  const [error, setError] = useState('')
  const id = useId()

  useLayoutEffect(() => {
    const textarea = control.current?.closest('[data-composer-card]')?.querySelector('textarea')
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.disabled) return undefined
    const previous = textarea.placeholder
    textarea.placeholder = COMPOSER_PLACEHOLDER
    return () => {
      if (textarea.placeholder === COMPOSER_PLACEHOLDER) textarea.placeholder = previous
    }
  })

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => { document.removeEventListener('mousedown', close) }
  }, [open])

  const load = (): void => {
    setLoading(true)
    setError('')
    void callConnections().then(
      value => { setItems(activeConnections(value)) },
      () => { setError('暂时无法读取外部连接。') },
    ).finally(() => { setLoading(false) })
  }

  return <div ref={root} className={css.root}>
    <button
      ref={control}
      data-emate-composer-connectors=""
      type="button"
      aria-label="查看已生效的外部连接"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? `${id}-menu` : undefined}
      onClick={() => {
        if (open) setOpen(false)
        else { setOpen(true); load() }
      }}
    >
      <LinkIcon size={14} />
      <span>外部连接</span>
    </button>
    {open && <div id={`${id}-menu`} className={css.menu} role="menu" aria-label="已生效的外部连接">
      <strong>已生效的外部连接</strong>
      {loading && <span className={css.note}>读取中…</span>}
      {!loading && error !== '' && <span className={css.error}>{error}</span>}
      {!loading && error === '' && items.length === 0 && <span className={css.note}>
        暂无连接。直接告诉小芯你要连接的服务，它会查找并安装对应 Skill。
      </span>}
      {!loading && error === '' && items.map(item => <span key={item.name} className={css.item} role="menuitem">
        <span className={css.dot} aria-hidden="true" />
        <span><b>{item.name}</b><small>{item.transport === 'stdio' ? '本地 MCP' : '远程 MCP'}</small></span>
      </span>)}
    </div>}
  </div>
}
