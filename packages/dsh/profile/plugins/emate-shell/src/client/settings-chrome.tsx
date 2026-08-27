import { useEffect, useRef, type ComponentType } from 'react'
import type { DesktopUpdateBridge } from '../../../../../../../desktop/e-mate-desktop/src/update-presentation.ts'
import { UpdateControl } from './header-controls.tsx'
import css from './settings-chrome.module.css'

const SETTINGS_PATH = '/settings'
const SETTINGS_RETURN_KEY = 'eMateSettingsReturn'
const SETTINGS_CONTENT_SELECTOR = '[data-emate-settings-content]'
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
const HIDDEN_SETTINGS_SECTIONS = new Set(['Agent 预设', 'Agent presets', '视觉工具', 'Vision'])

export function applySettingsBrandCopy(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node !== null) {
    const value = node.nodeValue ?? ''
    const replacement = SETTINGS_BRAND_COPY.get(value.trim())
    if (replacement !== undefined) node.nodeValue = value.replace(value.trim(), replacement)
    node = walker.nextNode()
  }
  for (const button of root.querySelectorAll('nav button')) {
    if (!(button instanceof HTMLButtonElement)) continue
    const hidden = HIDDEN_SETTINGS_SECTIONS.has(button.textContent?.trim() ?? '')
    button.hidden = hidden
    button.style.display = hidden ? 'none' : ''
    if (hidden) button.setAttribute('aria-hidden', 'true')
    else button.removeAttribute('aria-hidden')
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
    trigger.setAttribute('aria-hidden', 'true')
    trigger.tabIndex = -1

    let open = document.querySelector(SETTINGS_CONTENT_SELECTOR) !== null
    const syncPanel = () => {
      const shouldOpen = location.pathname === SETTINGS_PATH
      const isOpen = document.querySelector(SETTINGS_CONTENT_SELECTOR) !== null
      if (shouldOpen && !isOpen) trigger.click()
      if (!shouldOpen && isOpen) {
        document.querySelector<HTMLElement>('[data-emate-settings-close]')?.closest('button')?.click()
      }
    }
    const observer = new MutationObserver(records => {
      const changed = records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
        node instanceof Element
        && (node.matches(SETTINGS_CONTENT_SELECTOR) || node.querySelector(SETTINGS_CONTENT_SELECTOR) !== null),
      ))
      if (!changed) return
      const isOpen = document.querySelector(SETTINGS_CONTENT_SELECTOR) !== null
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
      trigger.removeAttribute('aria-hidden')
      trigger.removeAttribute('tabindex')
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

export function SettingsChrome({ updates, UpdateIcon }: {
  updates?: DesktopUpdateBridge
  UpdateIcon?: ComponentType<{ size?: number }>
} = {}) {
  const heading = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dialog = heading.current?.closest('[role="dialog"]')
    if (dialog === null || dialog === undefined) return undefined
    const sync = () => {
      applySettingsBrandCopy(dialog)
    }
    const observer = new MutationObserver(sync)
    observer.observe(dialog, { childList: true, characterData: true, subtree: true })
    sync()
    return () => { observer.disconnect() }
  }, [])
  return (
    <div ref={heading} className={css.heading} data-emate-settings-header="" data-emate-settings-content="">
      <div><h1>设置</h1>
        <p>管理个人资料、常规设置、知识和记忆。</p>
      </div>
      {updates !== undefined && UpdateIcon !== undefined
        ? <UpdateControl updates={updates} UpdateIcon={UpdateIcon} compact={false} />
        : null}
    </div>
  )
}
