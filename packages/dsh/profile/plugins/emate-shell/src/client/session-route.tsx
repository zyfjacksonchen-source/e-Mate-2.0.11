import { useEffect, useRef } from 'react'

interface SessionListState {
  phase: 'pending' | 'ready'
  current?: string
  byId: Record<string, { blank?: boolean }>
}

interface WorkspaceListState {
  baselinesReady: boolean
}

interface Props {
  useSessions: <T>(selector: (state: SessionListState) => T) => T
  useWorkspaces: <T>(selector: (state: WorkspaceListState) => T) => T
  getSessions: () => SessionListState
  openSession: (id: string) => void
}

type PendingRoute = string | null

function chatId(pathname: string): string | null {
  const match = /^\/chat\/([^/]+)$/u.exec(pathname)
  if (match === null) return null
  try {
    return decodeURIComponent(match[1]!)
  } catch {
    return null
  }
}

export function SessionRouteProjection({
  useSessions,
  useWorkspaces,
  getSessions,
  openSession,
}: Props) {
  const phase = useSessions(state => state.phase)
  const current = useSessions(state => state.current)
  const workspacesReady = useWorkspaces(state => state.baselinesReady)
  const initialized = useRef(false)
  const pending = useRef<PendingRoute>(null)

  const applyLocation = () => {
    const state = getSessions()
    if (state.phase !== 'ready' || !workspacesReady) return
    if (location.pathname === '/') {
      pending.current = null
      if (state.current !== undefined && Object.prototype.hasOwnProperty.call(state.byId, state.current)) {
        history.replaceState(null, '', `/chat/${encodeURIComponent(state.current)}`)
      }
      return
    }
    if (!location.pathname.startsWith('/chat')) return
    const id = chatId(location.pathname)
    if (id === null || !Object.prototype.hasOwnProperty.call(state.byId, id)) {
      const fallback = state.current === undefined || !Object.prototype.hasOwnProperty.call(state.byId, state.current)
        ? '/'
        : `/chat/${encodeURIComponent(state.current)}`
      history.replaceState(null, '', fallback)
      pending.current = null
      return
    }
    pending.current = state.current === id ? null : id
    if (state.current !== id) openSession(id)
  }

  useEffect(() => {
    const onPopState = () => { applyLocation() }
    addEventListener('popstate', onPopState)
    return () => { removeEventListener('popstate', onPopState) }
  }, [getSessions, openSession, workspacesReady])

  useEffect(() => {
    if (phase !== 'ready' || !workspacesReady) return
    if (!initialized.current) {
      initialized.current = true
      applyLocation()
    }
    if (pending.current !== null) {
      if (pending.current === current) {
        pending.current = null
      } else {
        return
      }
    }
    const path = current === undefined ? '/' : `/chat/${encodeURIComponent(current)}`
    if (['/capabilities', '/settings', '/schedules'].includes(location.pathname)) return
    if (!['/', '/chat'].some(prefix => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`))) return
    if (location.pathname !== path) {
      history.pushState(null, '', path)
      dispatchEvent(new PopStateEvent('popstate'))
    }
  }, [current, phase, workspacesReady])

  return null
}
