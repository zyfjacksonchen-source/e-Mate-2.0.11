import { useEffect, useRef } from 'react'

interface SessionListState {
  phase: 'pending' | 'ready'
  current?: string
  byId: Record<string, unknown>
}

interface Props {
  useSessions: <T>(selector: (state: SessionListState) => T) => T
  getSessions: () => SessionListState
  openSession: (id: string) => void
  startHomeSession: () => void
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
  getSessions,
  openSession,
  startHomeSession,
}: Props) {
  const phase = useSessions(state => state.phase)
  const current = useSessions(state => state.current)
  const initialized = useRef(false)
  const pending = useRef<PendingRoute>(null)

  const applyLocation = () => {
    const state = getSessions()
    if (state.phase !== 'ready') return
    if (location.pathname === '/') {
      pending.current = null
      startHomeSession()
      return
    }
    if (!location.pathname.startsWith('/chat')) return
    const id = chatId(location.pathname)
    if (id === null || !Object.prototype.hasOwnProperty.call(state.byId, id)) {
      history.replaceState(null, '', '/')
      pending.current = null
      startHomeSession()
      return
    }
    pending.current = state.current === id ? null : id
    if (state.current !== id) {
      try {
        openSession(id)
      } catch {
        history.replaceState(null, '', '/')
        pending.current = null
        startHomeSession()
      }
    }
  }

  useEffect(() => {
    const onPopState = () => { applyLocation() }
    addEventListener('popstate', onPopState)
    return () => { removeEventListener('popstate', onPopState) }
  }, [getSessions, openSession, startHomeSession])

  useEffect(() => {
    if (phase !== 'ready') return
    if (!initialized.current) {
      initialized.current = true
      applyLocation()
      return
    }
    if (pending.current !== null) {
      if (pending.current === current) {
        pending.current = null
      } else {
        return
      }
    }
    if (!['/', '/chat'].some(prefix => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`))) return
    const path = current === undefined ? '/' : `/chat/${encodeURIComponent(current)}`
    if (location.pathname !== path) history.pushState(null, '', path)
  }, [current, phase])

  return null
}
