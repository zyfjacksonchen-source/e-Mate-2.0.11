import { useEffect } from 'react'
import css from './thinking-status.module.css'

const TARGET_LABEL = 'Deep diving...'
const MARKER = 'data-emate-thinking-status'

function isTargetStatus(node: HTMLElement): boolean {
  return [...node.childNodes].some(child =>
    child.nodeType === Node.TEXT_NODE && child.textContent?.trimStart().startsWith(TARGET_LABEL),
  )
}

function createDomino(): HTMLElement {
  const host = document.createElement('span')
  host.className = css.host
  host.setAttribute('aria-hidden', 'true')

  const loader = document.createElement('span')
  loader.className = css.loader
  const domino = document.createElement('span')
  domino.className = css.domino
  for (let index = 0; index < 4; index += 1) domino.append(document.createElement('i'))
  loader.append(domino)

  const label = document.createElement('span')
  label.textContent = '思考中'
  host.append(loader, label)
  return host
}

/** Brand-only projection over the target Harness running-turn status. */
export function ThinkingStatusBranding() {
  useEffect(() => {
    const documentRoot = document
    let active = true
    const decorated = new Map<HTMLElement, { host: HTMLElement; label: string | null }>()
    const restore = (status: HTMLElement, entry: { host: HTMLElement; label: string | null }) => {
      entry.host.remove()
      status.removeAttribute(MARKER)
      if (entry.label === null) status.removeAttribute('aria-label')
      else status.setAttribute('aria-label', entry.label)
    }
    const sync = () => {
      if (!active) return
      for (const [status, entry] of decorated) {
        if (!status.isConnected) decorated.delete(status)
        else if (!entry.host.isConnected) {
          restore(status, entry)
          decorated.delete(status)
        }
      }
      for (const status of documentRoot.querySelectorAll<HTMLElement>('[role="status"][aria-live="polite"]')) {
        if (!isTargetStatus(status) || decorated.has(status)) continue
        const host = createDomino()
        const label = status.getAttribute('aria-label')
        status.setAttribute(MARKER, '')
        status.setAttribute('aria-label', '思考中')
        status.append(host)
        decorated.set(status, { host, label })
      }
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(documentRoot.body, { childList: true, subtree: true })
    return () => {
      active = false
      observer.disconnect()
      for (const [status, entry] of decorated) restore(status, entry)
    }
  }, [])
  return null
}
