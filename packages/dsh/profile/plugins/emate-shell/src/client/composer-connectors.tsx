import { useLayoutEffect, useRef, type ComponentType } from 'react'

interface Props {
  LinkIcon: ComponentType<{ size?: number }>
  openConnections: () => void
}

export const CONNECTORS_PATH = '/capabilities?category=collaboration'
export const COMPOSER_PLACEHOLDER = '给小芯发送消息，支持粘贴图片或文件'

export function routeToConnections(): void {
  const returnPath = `${location.pathname}${location.search}${location.hash}`
  history.pushState({ eMateSettingsReturn: returnPath }, '', CONNECTORS_PATH)
  dispatchEvent(new PopStateEvent('popstate'))
}

export function ComposerConnectors({ LinkIcon, openConnections }: Props) {
  const control = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const textarea = control.current?.closest('[data-composer-card]')?.querySelector('textarea')
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.disabled) return undefined
    const previous = textarea.placeholder
    textarea.placeholder = COMPOSER_PLACEHOLDER
    return () => {
      if (textarea.placeholder === COMPOSER_PLACEHOLDER) textarea.placeholder = previous
    }
  })

  return (
    <button
      ref={control}
      data-emate-composer-connectors=""
      type="button"
      aria-label="打开能力中心的外部连接"
      onClick={openConnections}
    >
      <LinkIcon size={14} />
      <span>外部连接</span>
    </button>
  )
}
