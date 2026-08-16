import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  ConversationLocation,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'

type ActivityStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled' | 'interrupted'

interface ActivityGroupData {
  turn: number
  startTime: number
  endTime?: number
  status: ActivityStatus
}

interface ActivityGroupState extends ActivityGroupData {
  firstActivitySeq?: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'e-mate-activity-group': ActivityGroupData
  }
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

export const activityGroupDefinition: ConversationNodeDefinition<ActivityGroupState> = {
  kind: 'e-mate-activity-group',
  target: 'chat',
  match: event => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'step/start' || event.type === 'turn/end') {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('e-Mate activity group requires turn/start')
    return { turn: match.event.data.turn, startTime: match.event.time, status: 'running' }
  },
  update: (context, match) => {
    if (match.event.type === 'step/start' && context.state.firstActivitySeq === undefined) {
      return { ...context.state, firstActivitySeq: match.event.seq }
    }
    if (match.event.type === 'turn/end') {
      const reason = match.event.data.reason
      const status = reason.kind === 'completed' || reason.kind === 'max-tokens'
        ? 'completed'
        : reason.kind === 'error'
          ? 'failed'
          : reason.kind === 'blocked'
            ? 'blocked'
            : reason.kind === 'interrupted'
              ? 'interrupted'
              : 'cancelled'
      return { ...context.state, endTime: match.event.time, status }
    }
    return context.state
  },
  publication: match => match.event.type === 'turn/start' ? 'none' : 'immediate',
  buildViewNode: context => {
    const state = context.state
    if (state?.firstActivitySeq === undefined) return null
    return {
      key: context.key,
      kind: 'e-mate-activity-group',
      id: context.id,
      target: 'chat',
      anchorSeq: state.firstActivitySeq - 0.02,
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

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const tail = `${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return hours === 0 ? tail : `${hours}:${tail}`
}

function statusLabel(status: ActivityStatus): string {
  if (status === 'running') return '已工作'
  if (status === 'failed') return '执行失败'
  if (status === 'blocked') return '已阻塞'
  if (status === 'cancelled') return '已取消'
  if (status === 'interrupted') return '已中断'
  return '已处理'
}

interface OriginalPresentation {
  hidden: boolean
  id: string
}

function activityMembers(headerRow: HTMLElement): HTMLElement[] {
  const members: HTMLElement[] = []
  let sibling = headerRow.nextElementSibling as HTMLElement | null
  while (sibling !== null) {
    const kind = sibling.dataset.chatFlowKind
    if (kind === 'e-mate-activity-group' || kind === 'user' || kind === 'steering') break
    if (kind === 'tool-call' || kind === 'command') {
      if (sibling.querySelector('[data-state="error"], [data-state="stopped"]') === null) members.push(sibling)
    } else if (kind === 'assistant-step') {
      for (const think of sibling.querySelectorAll<HTMLElement>('[data-variant="think"]')) {
        const body = think.parentElement
        members.push(body !== null && body.children.length === 1 ? sibling : think)
      }
    }
    sibling = sibling.nextElementSibling as HTMLElement | null
  }
  return [...new Set(members)]
}

export function ActivityGroup({ node }: ChatNodeViewProps<'e-mate-activity-group'>) {
  const { turn, startTime, endTime, status } = node.data
  const running = status === 'running'
  const collapsible = running || status === 'completed'
  const rootRef = useRef<HTMLDivElement>(null)
  const originalsRef = useRef(new Map<HTMLElement, OriginalPresentation>())
  const memberIdRef = useRef(0)
  const [expanded, setExpanded] = useState(running)
  const expandedRef = useRef(expanded)
  expandedRef.current = collapsible ? expanded : true
  const [controls, setControls] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const controlId = `e-mate-activity-${node.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`

  useEffect(() => {
    if (!running) setExpanded(false)
  }, [running])

  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { window.clearInterval(timer) }
  }, [running])

  useLayoutEffect(() => {
    const headerRow = rootRef.current?.closest<HTMLElement>('[data-chat-flow-kind="e-mate-activity-group"]')
    const flow = headerRow?.parentElement
    if (headerRow === undefined || headerRow === null || flow === null || flow === undefined) return undefined
    let frame: number | undefined
    const tail = flow.querySelector<HTMLElement>(`[data-turn-tail="${turn}"]`)
    if (tail !== null) {
      tail.setAttribute('data-emate-activity-tail', '')
      tail.setAttribute('data-emate-activity-tail-status', status)
    }
    const restore = (element: HTMLElement, original: OriginalPresentation) => {
      element.hidden = original.hidden
      element.removeAttribute('data-emate-activity-member')
      if (element.id.startsWith(`${controlId}-member-`)) element.id = original.id
    }
    const sync = () => {
      frame = undefined
      const members = activityMembers(headerRow)
      const current = new Set(members)
      for (const [element, original] of originalsRef.current) {
        if (!current.has(element)) {
          restore(element, original)
          originalsRef.current.delete(element)
        }
      }
      for (const element of members) {
        if (!originalsRef.current.has(element)) {
          originalsRef.current.set(element, { hidden: element.hidden, id: element.id })
          if (element.id === '') {
            memberIdRef.current += 1
            element.id = `${controlId}-member-${memberIdRef.current}`
          }
          element.setAttribute('data-emate-activity-member', '')
        }
        const original = originalsRef.current.get(element)
        if (original !== undefined) element.hidden = expandedRef.current ? original.hidden : true
      }
      const nextControls = members.map(element => element.id).filter(Boolean).join(' ')
      setControls(currentControls => currentControls === nextControls ? currentControls : nextControls)
    }
    const schedule = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(sync)
    }
    sync()
    const observer = running ? new MutationObserver(schedule) : null
    observer?.observe(flow, { attributes: true, attributeFilter: ['data-state'], childList: true, subtree: true })
    return () => {
      observer?.disconnect()
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      for (const [element, original] of originalsRef.current) restore(element, original)
      originalsRef.current.clear()
      tail?.removeAttribute('data-emate-activity-tail')
      tail?.removeAttribute('data-emate-activity-tail-status')
    }
  }, [controlId, running, status, turn])

  useLayoutEffect(() => {
    for (const [element, original] of originalsRef.current) {
      element.hidden = collapsible ? (expanded ? original.hidden : true) : original.hidden
    }
  }, [collapsible, expanded])

  const elapsed = (endTime ?? now) - startTime
  const label = statusLabel(status)
  const hasControls = controls !== ''
  const content = <>
    {running && <span data-emate-thinking-host="" aria-hidden="true" />}
    <span>{label} {duration(elapsed)}</span>
    {collapsible && <IconChevronDownOutline14 aria-hidden="true" />}
  </>
  return <div
    ref={rootRef}
    data-emate-activity-header=""
    data-emate-activity-status={status}
    data-state={running ? 'running' : 'settled'}
    hidden={!hasControls && (status === 'running' || status === 'completed')}
  >
    {collapsible
      ? <button
          type="button"
          data-emate-activity-toggle=""
          aria-label={`${running ? '思考中 ' : ''}${label} ${duration(elapsed)}`}
          aria-expanded={hasControls ? expanded : undefined}
          aria-controls={controls || undefined}
          aria-live={running ? 'polite' : undefined}
          disabled={!hasControls}
          onClick={() => { setExpanded(value => !value) }}
        >{content}</button>
      : <div data-emate-activity-toggle="" role="status">{content}</div>}
  </div>
}
