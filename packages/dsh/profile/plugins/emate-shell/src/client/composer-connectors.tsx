import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentType } from 'react'

interface Props {
  LinkIcon: ComponentType<{ size?: number }>
  openConnections: () => void
}

export const CONNECTORS_PATH = '/capabilities?category=collaboration'
export const COMPOSER_PLACEHOLDER = '给小芯发送消息，支持粘贴图片或文件'
const CONNECTION_SETUP_TOOL = 'e_mate_connection_setup'
const CONNECTION_IDS = new Set(['feishu', 'tencent-docs', 'wechat'])

interface ConversationNode {
  kind?: string
  seq?: number
  call?: { name?: string; argsRaw?: string } | null
  isError?: boolean
  subCalls?: readonly ConversationNode[]
}

interface SessionState {
  nodes: readonly ConversationNode[]
}

export function routeToConnections(): void {
  const returnPath = `${location.pathname}${location.search}${location.hash}`
  history.pushState({ eMateSettingsReturn: returnPath }, '', CONNECTORS_PATH)
  dispatchEvent(new PopStateEvent('popstate'))
}

export function routeToConnectionSetup(connectionId: string): void {
  if (!CONNECTION_IDS.has(connectionId)) return
  const target = `/settings?section=connections&connection=${encodeURIComponent(connectionId)}`
  if (`${location.pathname}${location.search}` === target) return
  const returnPath = `${location.pathname}${location.search}${location.hash}`
  history.pushState({ eMateSettingsReturn: returnPath }, '', target)
  dispatchEvent(new PopStateEvent('popstate'))
}

function latestConnectionSetup(nodes: readonly ConversationNode[]): { connectionId: string; seq: number } | null {
  let latest: { connectionId: string; seq: number } | null = null
  const visit = (node: ConversationNode) => {
    if (node.kind === 'tool-result'
      && node.isError === false
      && node.call?.name === CONNECTION_SETUP_TOOL
      && typeof node.call.argsRaw === 'string'
      && typeof node.seq === 'number') {
      try {
        const args = JSON.parse(node.call.argsRaw) as unknown
        if (args !== null && typeof args === 'object' && !Array.isArray(args)
          && Object.keys(args).length === 1
          && typeof (args as Record<string, unknown>).connection_id === 'string'
          && CONNECTION_IDS.has((args as Record<string, string>).connection_id)
          && (latest === null || node.seq > latest.seq)) {
          latest = { connectionId: (args as Record<string, string>).connection_id, seq: node.seq }
        }
      } catch {
        // A malformed persisted call is evidence, not a navigation instruction.
      }
    }
    node.subCalls?.forEach(visit)
  }
  nodes.forEach(visit)
  return latest
}

export function ConnectionIntentRouter({
  useSession,
}: {
  useSession: <T>(selector: (state: SessionState) => T) => T
}) {
  const nodes = useSession(state => state.nodes)
  const latest = useMemo(() => latestConnectionSetup(nodes), [nodes])
  const handledSeq = useRef(latest?.seq ?? -1)

  useEffect(() => {
    if (latest === null || latest.seq <= handledSeq.current) return
    handledSeq.current = latest.seq
    routeToConnectionSetup(latest.connectionId)
  }, [latest])

  return null
}

export function ComposerConnectors({ LinkIcon, openConnections }: Props) {
  const control = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const textarea = control.current?.closest('[data-composer-card]')?.querySelector('textarea')
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.disabled) return undefined
    const previous = textarea.placeholder
    textarea.placeholder = COMPOSER_PLACEHOLDER
    return () => {
      if (textarea.placeholder === COMPOSER_PLACEHOLDER) textarea.placeholder = previous
    }
  })

  return (
    <button
      ref={control}
      data-emate-composer-connectors=""
      type="button"
      aria-label="打开能力中心的外部连接"
      onClick={openConnections}
    >
      <LinkIcon size={14} />
      <span>外部连接</span>
    </button>
  )
}
