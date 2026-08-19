import { useLayoutEffect, useRef } from 'react'

const MARKER = 'data-emate-produced-file'

function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Hide workspace paths once per native turn-tail row, outside the token stream. */
export function ArtifactCapsules() {
  const marker = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const row = marker.current?.parentElement?.querySelector<HTMLElement>('[data-produced-files-row]')
    if (row === null || row === undefined) return undefined
    const originals = new Map<HTMLButtonElement, { label: string | null; title: string }>()
    const sync = () => {
      for (const button of row.querySelectorAll<HTMLButtonElement>(':scope > button[title]')) {
        const original = originals.get(button) ?? {
          label: button.getAttribute('aria-label'),
          title: button.title,
        }
        if (!originals.has(button)) originals.set(button, original)
        const name = button.textContent?.trim() || basename(original.title)
        if (button.title !== name) button.title = name
        if (button.getAttribute('aria-label') !== `打开 ${name}`) button.setAttribute('aria-label', `打开 ${name}`)
        if (!button.hasAttribute(MARKER)) button.setAttribute(MARKER, '')
      }
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(row, { childList: true })
    return () => {
      observer.disconnect()
      for (const [button, original] of originals) {
        if (!button.isConnected) continue
        button.title = original.title
        if (original.label === null) button.removeAttribute('aria-label')
        else button.setAttribute('aria-label', original.label)
        button.removeAttribute(MARKER)
      }
    }
  }, [])
  return <span ref={marker} hidden data-emate-produced-files-adapter="" />
}
