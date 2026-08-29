import { useLayoutEffect, useRef, useState, type ComponentType } from 'react'
import css from './composer-connectors.module.css'

interface ConnectorsProps {
  LinkIcon: ComponentType<{ size?: number }>
  openConnections: () => void
}

interface MentionsProps {
  openMentions: (selection: { start: number; end: number }) => void
  input?: { phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting' }
}

export const COMPOSER_PLACEHOLDER = '给小芯发送消息，支持粘贴图片或文件'

export function ComposerMentions({ openMentions, input }: MentionsProps) {
  const control = useRef<HTMLButtonElement>(null)
  const [error, setError] = useState('')
  const busy = input?.phase === 'adjudicating' || input?.phase === 'submitting'

  useLayoutEffect(() => {
    const textarea = control.current?.closest('[data-composer-card]')?.querySelector('textarea')
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.disabled) return undefined
    const previous = textarea.placeholder
    textarea.placeholder = COMPOSER_PLACEHOLDER
    return () => {
      if (textarea.placeholder === COMPOSER_PLACEHOLDER) textarea.placeholder = previous
    }
  })

  return <div className={css.root}>
    <button
      ref={control}
      data-emate-composer-mentions=""
      type="button"
      title="插入引用"
      aria-label="插入引用"
      aria-haspopup="listbox"
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={() => {
        const textarea = control.current?.closest('[data-composer-card]')?.querySelector('textarea')
        if (!(textarea instanceof HTMLTextAreaElement)) return
        setError('')
        try {
          openMentions({ start: textarea.selectionStart, end: textarea.selectionEnd })
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : '暂时无法插入引用。')
        } finally {
          textarea.focus()
        }
      }}
    ><span aria-hidden="true">@</span></button>
    {error !== '' && <span className={css.error} role="alert">{error}</span>}
  </div>
}

export function ComposerConnectors({ LinkIcon, openConnections }: ConnectorsProps) {
  return <div className={css.root}>
    <button
      data-emate-composer-connectors=""
      type="button"
      title="打开外部连接能力中心"
      aria-label="打开外部连接能力中心"
      onClick={openConnections}
    >
      <LinkIcon size={14} />
      <span>外部连接</span>
    </button>
  </div>
}
