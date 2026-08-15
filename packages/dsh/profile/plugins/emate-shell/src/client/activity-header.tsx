import { useEffect, useRef, useState } from 'react'
import type {
  ConversationLocation,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './activity-header.module.css'

type ActivityStatus = 'running' | 'completed' | 'failed' | 'cancelled'

interface ActivityHeaderData {
  turn: number
  startTime: number
  endTime?: number
  status: ActivityStatus
}

interface ActivityHeaderState extends ActivityHeaderData {
  firstActivitySeq?: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'e-mate-activity-group': ActivityHeaderData
  }
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

function endStatus(reason: { kind: string }): Exclude<ActivityStatus, 'running'> {
  if (reason.kind === 'completed' || reason.kind === 'max-tokens') return 'completed'
  if (reason.kind === 'error') return 'failed'
  return 'cancelled'
}

export const activityHeaderDefinition: ConversationNodeDefinition<ActivityHeaderState> = {
  kind: 'e-mate-activity-group',
  target: 'chat',
  match: event => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call' || event.type === 'turn/end') {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('e-Mate activity group requires turn/start')
    return {
      turn: match.event.data.turn,
      startTime: match.event.time,
      status: 'running',
    }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      return context.state.firstActivitySeq === undefined
        ? { ...context.state, firstActivitySeq: match.event.seq }
        : context.state
    }
    if (match.event.type === 'turn/end') {
      return {
        ...context.state,
        endTime: match.event.time,
        status: endStatus(match.event.data.reason),
      }
    }
    return context.state
  },
  publication: match => match.event.type === 'tool/call' || match.event.type === 'turn/end'
    ? 'immediate'
    : 'none',
  buildViewNode: context => {
    const state = context.state
    if (state === undefined || state.firstActivitySeq === undefined) return null
    return {
      key: context.key,
      kind: 'e-mate-activity-group',
      id: context.id,
      target: 'chat',
      anchorSeq: state.firstActivitySeq - 0.1,
      location: locationOf(context),
      visibility: 'visible',
      data: {
        turn: state.turn,
        startTime: state.startTime,
        ...(state.endTime === undefined ? {} : { endTime: state.endTime }),
        status: state.status,
      },
    }
  },
}

function durationLabel(milliseconds: number, status: ActivityStatus): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  const remainder = seconds % 60
  if (status === 'running') {
    const clock = `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    return hours === 0 ? clock : `${hours}:${clock}`
  }
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(remainder).padStart(2, '0')}s`
  if (minutes > 0) return `${String(minutes).padStart(2, '0')}m ${String(remainder).padStart(2, '0')}s`
  return `${remainder}s`
}

function statusLabel(status: ActivityStatus): string {
  if (status === 'running') return '已工作'
  if (status === 'failed') return '执行失败'
  if (status === 'cancelled') return '已取消'
  return '已处理'
}

export function ActivityHeader({ node }: ChatNodeViewProps<'e-mate-activity-group'>) {
  const { turn, startTime, endTime, status } = node.data
  const [now, setNow] = useState(() => Date.now())
  const [collapsed, setCollapsed] = useState(() => status !== 'running')
  const rootRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (status !== 'running') return undefined
    const id = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(id) }
  }, [status])

  useEffect(() => {
    if (status !== 'running') setCollapsed(true)
  }, [status])

  useEffect(() => {
    const row = rootRef.current?.closest<HTMLElement>('[data-chat-flow-kind]')
    const flow = row?.parentElement
    if (row === undefined || flow === undefined || row === null || flow === null) return undefined
    const touched = new Set<HTMLElement>()
    const mark = () => {
      const tail = flow.querySelector<HTMLElement>(`[data-turn-tail="${turn}"]`)
      if (tail !== null) {
        tail.setAttribute('data-emate-activity-tail', '')
        tail.setAttribute('data-emate-activity-tail-status', status)
        touched.add(tail)
      }
      let sibling = row.nextElementSibling as HTMLElement | null
      while (sibling !== null) {
        const kind = sibling.dataset.chatFlowKind
        if (kind === 'e-mate-activity-group' || kind === 'turn-tail') break
        if (kind === 'tool-call' || kind === 'command') {
          const states = [...sibling.querySelectorAll<HTMLElement>('[data-state]')]
            .map(element => element.dataset.state)
          if (states.length === 0 || states.every(state => state === 'ok' || state === 'running')) {
            sibling.setAttribute('data-emate-activity-member', String(turn))
            if (collapsed) sibling.setAttribute('data-emate-activity-collapsed', '')
            else sibling.removeAttribute('data-emate-activity-collapsed')
            touched.add(sibling)
          }
        }
        sibling = sibling.nextElementSibling as HTMLElement | null
      }
    }
    mark()
    const observer = status === 'running' ? new MutationObserver(mark) : null
    observer?.observe(flow, { childList: true, subtree: true })
    return () => {
      observer?.disconnect()
      for (const element of touched) {
        if (element.dataset.emateActivityMember === String(turn)) {
          element.removeAttribute('data-emate-activity-member')
          element.removeAttribute('data-emate-activity-collapsed')
        }
        if (element.dataset.turnTail === String(turn)) {
          element.removeAttribute('data-emate-activity-tail')
          element.removeAttribute('data-emate-activity-tail-status')
        }
      }
    }
  }, [collapsed, status, turn])

  const elapsed = Math.max(0, (endTime ?? now) - startTime)
  const elapsedLabel = durationLabel(elapsed, status)
  return (
    <button
      ref={rootRef}
      type="button"
      className={css.root}
      data-emate-activity-header=""
      data-emate-activity-status={status}
      aria-label={`${statusLabel(status)} ${elapsedLabel}`}
      aria-expanded={!collapsed}
      onClick={() => { setCollapsed(value => !value) }}
      aria-live={status === 'running' ? 'polite' : undefined}
    >
      <span>{statusLabel(status)}</span>
      <time>{elapsedLabel}</time>
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )
}
