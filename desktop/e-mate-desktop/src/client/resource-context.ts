/** Synchronous DOM facts consumed by Electron's native resource context menu. */

const RESOURCE_KEY = '__EMATE_DESKTOP_RESOURCE__'

interface SessionListSource {
  list: {
    getSnapshot(): {
      current?: unknown
      byId: Record<string, { cwd?: string } | undefined>
    }
  }
}

export function normalizedAbsolute(root: string, path: string): string | undefined {
  const slashRoot = root.replaceAll('\\', '/').replace(/\/+$/u, '')
  const slashPath = path.replaceAll('\\', '/')
  const absolute = /^(?:\/|[A-Za-z]:\/|\/\/)/u.test(slashPath)
  const prefix = absolute ? '' : `${slashRoot}/`
  const drive = `${prefix}${slashPath}`.match(/^([A-Za-z]:|\/\/[^/]+\/[^/]+|\/)/u)?.[1]
  if (drive === undefined) return undefined
  const rest = `${prefix}${slashPath}`.slice(drive.length)
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
    } else parts.push(part)
  }
  return `${drive}${drive === '/' ? '' : '/'}${parts.join('/')}`
}

/** Track the resource under the most recent renderer context-menu event. */
export function installResourceContext(sessions: SessionListSource): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    Reflect.deleteProperty(globalThis, RESOURCE_KEY)
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('[data-emate-artifact-terminal]') !== null) {
      Reflect.set(globalThis, RESOURCE_KEY, { kind: 'handled' })
      return
    }
    const snapshot = sessions.list.getSnapshot()
    const sessionId = snapshot.current
    if (typeof sessionId !== 'string') return

    const image = target.closest('img')
    if (image instanceof HTMLImageElement && image.src.startsWith('blob:')
      && (image.closest('[data-align]') !== null || image.closest('[role="dialog"]') !== null)) {
      Reflect.set(globalThis, RESOURCE_KEY, {
        kind: 'image', name: image.alt || 'e-mate-image.png', sessionId, src: image.src,
      })
      return
    }

    const marked = target.closest<HTMLElement>('[data-emate-resource-path]')
    const produced = target.closest<HTMLElement>('[data-produced-files-row] button[title]')
    const relativePath = marked?.dataset.emateResourcePath ?? produced?.getAttribute('title') ?? undefined
    const root = snapshot.byId[sessionId]?.cwd
    if (relativePath === undefined || root === undefined) return
    const path = normalizedAbsolute(root, relativePath)
    if (path === undefined) return
    Reflect.set(globalThis, RESOURCE_KEY, {
      kind: 'file', name: relativePath.split(/[\\/]/u).at(-1) ?? '文件', path, root, sessionId,
    })
  }
  document.addEventListener('contextmenu', onContextMenu, true)
  return () => {
    document.removeEventListener('contextmenu', onContextMenu, true)
    Reflect.deleteProperty(globalThis, RESOURCE_KEY)
  }
}
