import { useEffect } from 'react'

const FILE_SELECTOR = '[data-produced-files-row] > button[title]'
const MARKER = 'data-emate-produced-file'

function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Hide workspace paths while preserving rc.7's native produced-file opener. */
export function ArtifactCapsules() {
  useEffect(() => {
    const originals = new Map<HTMLButtonElement, { label: string | null; title: string }>()
    const sync = () => {
      for (const button of document.querySelectorAll<HTMLButtonElement>(FILE_SELECTOR)) {
        const original = originals.get(button) ?? {
          label: button.getAttribute('aria-label'),
          title: button.title,
        }
        if (!originals.has(button)) originals.set(button, original)
        const name = basename(original.title)
        if (button.title !== name) button.title = name
        if (button.getAttribute('aria-label') !== `打开 ${name}`) button.setAttribute('aria-label', `打开 ${name}`)
        if (!button.hasAttribute(MARKER)) button.setAttribute(MARKER, '')
      }
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { attributes: true, attributeFilter: ['title'], childList: true, subtree: true })
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
  return null
}
