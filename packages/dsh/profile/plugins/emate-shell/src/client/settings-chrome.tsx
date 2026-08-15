import { useEffect, useRef, type ComponentType } from 'react'
import css from './settings-chrome.module.css'

const SETTINGS_PATH = '/settings'
const SETTINGS_RETURN_KEY = 'eMateSettingsReturn'
const SETTINGS_BRAND_COPY = new Map([
  ['插件', '能力中心'],
  ['Plugins', 'Capabilities'],
  ['插件视图', '能力视图'],
  ['Plugin views', 'Capability views'],
  ['插件配置', '能力配置'],
  ['Plugin configuration', 'Capability configuration'],
  ['配置和查看本部署已安装的插件。', '配置和查看 e-Mate 已安装的能力。'],
  ['Configure and inspect the plugins installed in this deployment.', 'Configure and inspect the capabilities installed in e-Mate.'],
  ['DeepSeek 搜索提供方。', 'e-Mate 搜索服务。'],
  ['The DeepSeek search provider.', 'The e-Mate search service.'],
])

export function applySettingsBrandCopy(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node !== null) {
    const value = node.nodeValue ?? ''
    const replacement = SETTINGS_BRAND_COPY.get(value.trim())
    if (replacement !== undefined) node.nodeValue = value.replace(value.trim(), replacement)
    node = walker.nextNode()
  }
}

interface TriggerProps {
  wide: boolean
  SettingsIcon: ComponentType<{ size?: number }>
}

export function SettingsTrigger({ wide, SettingsIcon }: TriggerProps) {
  const label = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const trigger = label.current?.closest('button')
    if (!(trigger instanceof HTMLButtonElement)) return undefined
    trigger.dataset.emateSettingsTrigger = ''

    let open = document.querySelector('[data-emate-settings-content]') !== null
    const syncPanel = () => {
      const shouldOpen = location.pathname === SETTINGS_PATH
      const isOpen = document.querySelector('[data-emate-settings-content]') !== null
      if (shouldOpen && !isOpen) trigger.click()
      if (!shouldOpen && isOpen) {
        document.querySelector<HTMLElement>('[data-emate-settings-close]')?.closest('button')?.click()
      }
    }
    const observer = new MutationObserver(() => {
      const isOpen = document.querySelector('[data-emate-settings-content]') !== null
      if (isOpen === open) {
        syncPanel()
        return
      }
      open = isOpen
      if (isOpen && location.pathname !== SETTINGS_PATH) {
        const returnPath = `${location.pathname}${location.search}${location.hash}`
        history.pushState({ [SETTINGS_RETURN_KEY]: returnPath }, '', SETTINGS_PATH)
        dispatchEvent(new PopStateEvent('popstate'))
      } else if (!isOpen && location.pathname === SETTINGS_PATH) {
        if (typeof history.state?.[SETTINGS_RETURN_KEY] === 'string') history.back()
        else {
          history.replaceState(history.state, '', '/')
          dispatchEvent(new PopStateEvent('popstate'))
        }
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })
    addEventListener('popstate', syncPanel)
    syncPanel()
    return () => {
      observer.disconnect()
      removeEventListener('popstate', syncPanel)
      delete trigger.dataset.emateSettingsTrigger
    }
  }, [])

  return (
    <>
      <SettingsIcon size={18} />
      <span ref={label} className={wide ? css.triggerLabel : css.visuallyHidden}>设置</span>
    </>
  )
}

export function SettingsTitle() {
  return <>设置</>
}

export function SettingsCloseLabel() {
  return <span data-emate-settings-close="">关闭设置</span>
}

export function SettingsChrome() {
  const heading = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dialog = heading.current?.closest('[role="dialog"]')
    if (dialog === null || dialog === undefined) return undefined
    const sync = () => {
      applySettingsBrandCopy(dialog)
      if (new URLSearchParams(location.search).get('section') !== 'connections') return
      const target = [...dialog.querySelectorAll<HTMLButtonElement>('nav button')]
        .find(button => button.textContent?.trim() === '外部连接')
      if (target !== undefined && target.getAttribute('aria-current') !== 'true') target.click()
    }
    const observer = new MutationObserver(sync)
    observer.observe(dialog, { childList: true, characterData: true, subtree: true })
    sync()
    return () => { observer.disconnect() }
  }, [])
  return (
    <div ref={heading} className={css.heading} data-emate-settings-header="" data-emate-settings-content="">
      <h1>设置</h1>
      <p>管理个人资料、常规设置、知识和记忆。</p>
    </div>
  )
}
