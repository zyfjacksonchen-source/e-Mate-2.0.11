import { createElement, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './activity-fold.module.css'

type ChatNode = {
  key: string
  kind: string
  location?: { kind?: string; turn?: { turn?: number } }
  data?: {
    status?: string
    blocks?: readonly { kind?: string; text?: string }[]
    root?: Record<string, unknown>
  }
}

export interface ActivityFoldSummary {
  turn: number
  headerKey: string
  toolCount: number
  reasoningCount: number
  running: boolean
}

const expandedTurns = new Set<string>()
const listeners = new Set<() => void>()

function turnOf(node: ChatNode): number | undefined {
  const location = node.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn?.turn : undefined
}

function hasReasoning(node: ChatNode): boolean {
  return node.kind === 'assistant-step'
    && node.data?.blocks?.some(block => block.kind === 'reasoning') === true
}

function reasoningBlocks(node: ChatNode): number {
  return node.kind === 'assistant-step'
    ? node.data?.blocks?.filter(block => block.kind === 'reasoning').length ?? 0
    : 0
}

function hasNaturalMessage(node: ChatNode): boolean {
  if (node.kind !== 'assistant-step') return false
  if (node.data?.status === 'interrupted') return true
  return node.data?.blocks?.some((block) => {
    if (block.kind === 'text') return (block.text ?? '').trim().length > 0
    return block.kind !== 'reasoning' && block.kind !== 'tool-call'
  }) === true
}

function isProcessNode(node: ChatNode): boolean {
  return node.kind === 'tool-call' || node.kind === 'context' || hasReasoning(node)
}

function isRunning(node: ChatNode): boolean {
  if (node.kind === 'assistant-step') return node.data?.status === 'running'
  return node.kind === 'tool-call' && node.data?.root !== undefined && !('kind' in node.data.root)
}

/** Project one turn's process-only nodes without rewriting any DSH event. */
export function activityFoldSummary(
  order: readonly string[],
  nodes: ReadonlyMap<string, ChatNode>,
  node: ChatNode,
): ActivityFoldSummary | null {
  const turn = turnOf(node)
  if (turn === undefined) return null
  const process = order
    .map(key => nodes.get(key))
    .filter((candidate): candidate is ChatNode => candidate !== undefined
      && turnOf(candidate) === turn
      && isProcessNode(candidate))
  const header = process[0]
  if (header === undefined) return null
  return {
    turn,
    headerKey: header.key,
    toolCount: process.filter(candidate => candidate.kind === 'tool-call').length,
    reasoningCount: process.reduce((count, candidate) => count + reasoningBlocks(candidate), 0),
    running: process.some(isRunning),
  }
}

function stateKey(sessionId: string, turn: number): string {
  return `${sessionId}:${turn}`
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function setExpanded(sessionId: string, turn: number, expanded: boolean): void {
  const key = stateKey(sessionId, turn)
  const changed = expanded ? !expandedTurns.has(key) : expandedTurns.has(key)
  if (!changed) return
  if (expanded) expandedTurns.add(key)
  else expandedTurns.delete(key)
  for (const listener of listeners) listener()
}

function useExpanded(sessionId: string, turn: number | undefined): boolean {
  return useSyncExternalStore(subscribe, () => turn !== undefined && expandedTurns.has(stateKey(sessionId, turn)))
}

function label(summary: ActivityFoldSummary): string {
  const counts: string[] = []
  if (summary.toolCount > 0) counts.push(`${summary.toolCount} 次工具调用`)
  if (summary.reasoningCount > 0) counts.push(`${summary.reasoningCount} 条思考`)
  return `${summary.running ? '正在运行' : '运行过程'}${counts.length > 0 ? ` · ${counts.join('，')}` : ''}`
}

function ActivityHeader({ summary, sessionId, expanded, children }: {
  summary: ActivityFoldSummary
  sessionId: string
  expanded: boolean
  children?: ReactNode
}) {
  return (
    <div className={css.group} data-emate-activity-fold data-running={summary.running || undefined}>
      <DisclosureRow
        rowClassName={css.header}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title={label(summary)}
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(sessionId, summary.turn, !expanded) }}
      >
        {children}
      </DisclosureRow>
    </div>
  )
}

function nativeComponent(ctx: any, kind: string): any {
  const entry = ctx.slots.entries('conversation.chat.node')
    .find((candidate: any) => candidate.options?.key === kind && (candidate.options?.priority ?? 0) === 0)
  if (entry?.component === undefined) throw new Error(`native DSH renderer "${kind}" is unavailable`)
  return entry.component
}

function renderNative(ctx: any, kind: string, props: any): ReactNode {
  const Component = nativeComponent(ctx, kind)
  if (kind !== 'tool-call') return createElement(Component, props)
  const renderSlot = (key: string, owner: Record<string, unknown>, options: { entryKey?: string; fallback?: ReactNode }) => {
    if (key !== 'tool.call.toolview') return options.fallback ?? null
    const entry = ctx.slots.entriesOfSlot(key)
      .find((candidate: any) => candidate.options?.key === options.entryKey)
    if (entry?.component === undefined) return options.fallback ?? null
    // Current rc.7 atomic Tool views and accepted GenUI use only the standard
    // session kit plus owner props. If that native contract grows, abdicate to
    // the unwrapped DSH renderer instead of silently dropping an injected face.
    if (entry.inject !== undefined || entry.store !== undefined || entry.children !== undefined
      || (entry.locale !== undefined && entry.locale !== 'conversation')) {
      throw new Error(`tool view "${options.entryKey ?? ''}" requires an unsupported injected face`)
    }
    return createElement(entry.component, { ...props, ...owner })
  }
  return createElement(Component, { ...props, renderSlot })
}

function hiddenMarker(): ReactNode {
  return <span data-emate-process-hidden aria-hidden style={{ display: 'none' }} />
}

function createProcessRenderer(ctx: any, kind: 'assistant-step' | 'tool-call' | 'context') {
  return function ProcessRenderer(props: any) {
    const { node, sessionId, useSession } = props as { node: ChatNode; sessionId: string; useSession: (selector: any) => any }
    const order = useSession((snapshot: any) => snapshot.chat.order) as readonly string[]
    const nodes = useSession((snapshot: any) => snapshot.chat.nodes) as ReadonlyMap<string, ChatNode>
    const summary = useMemo(() => activityFoldSummary(order, nodes, node), [node, nodes, order])
    const expanded = useExpanded(sessionId, summary?.turn)

    if (summary === null || !isProcessNode(node)) return renderNative(ctx, kind, props)
    const header = node.key === summary.headerKey
    const natural = hasNaturalMessage(node)

    if (kind === 'assistant-step' && natural) {
      return (
        <div
          className={css.message}
          data-emate-process-collapsed={!expanded || undefined}
          data-emate-process-expanded={expanded || undefined}
        >
          {header && <ActivityHeader summary={summary} sessionId={sessionId} expanded={expanded} />}
          {renderNative(ctx, kind, props)}
        </div>
      )
    }

    if (!header) return expanded ? renderNative(ctx, kind, props) : hiddenMarker()
    return (
      <ActivityHeader summary={summary} sessionId={sessionId} expanded={expanded}>
        {expanded ? renderNative(ctx, kind, props) : null}
      </ActivityHeader>
    )
  }
}

/** Fold only DSH process nodes; assistant prose remains owned by its native renderer. */
export function registerActivityFold(ctx: any): void {
  for (const kind of ['assistant-step', 'tool-call', 'context'] as const) {
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
      name: 'conversation.chat.node',
      key: kind,
      priority: -1,
      locale: 'conversation',
    }, createProcessRenderer(ctx, kind)))
  }
}
