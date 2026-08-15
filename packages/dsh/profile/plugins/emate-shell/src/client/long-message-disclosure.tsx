import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ConversationLocation,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  IconBrowseOutline16,
  IconChevronDownOutline14,
  IconDownloadOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './long-message-disclosure.module.css'

type MessageKind = 'user' | 'assistant-step'

interface LongMessageData {
  sourceKind: MessageKind
}

interface LongMessageState extends LongMessageData {
  sourceSeq: number
}

interface ImageDisclosureData {
  imageCount: number
}

interface ImageDisclosureState extends ImageDisclosureData {
  sourceSeq: number
}

const SHORT_PLAIN_TEXT_LIMIT = 48

function needsHeightProbe(content: readonly unknown[]): boolean {
  if (content.length !== 1) return true
  const block = content[0] as { type?: unknown; text?: unknown } | undefined
  if (block?.type !== 'text' || typeof block.text !== 'string') return true
  return block.text.length > SHORT_PLAIN_TEXT_LIMIT || /[\r\n<!]/u.test(block.text)
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'e-mate-message-disclosure': LongMessageData
    'e-mate-image-disclosure': ImageDisclosureData
  }
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}

export const longMessageDefinition: ConversationNodeDefinition<LongMessageState> = {
  kind: 'e-mate-message-disclosure',
  target: 'chat',
  match: event => {
    if (event.type === 'user/message'
      && event.data.source.kind === 'user'
      && needsHeightProbe(event.data.content)
      && isAppendSurfaceEvent(event)) {
      return { id: `user:${event.data.id}`, role: 'start' }
    }
    if (event.type === 'assistant/message'
      && needsHeightProbe(event.data.message.content)
      && isAppendSurfaceEvent(event)) {
      return { id: `assistant:${event.data.message.id}`, role: 'start' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type === 'user/message') {
      return { sourceKind: 'user', sourceSeq: match.event.seq }
    }
    if (match.event.type === 'assistant/message') {
      return { sourceKind: 'assistant-step', sourceSeq: match.event.seq }
    }
    throw new Error('e-Mate message disclosure requires a durable message')
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined ? null : ({
    key: context.key,
    kind: 'e-mate-message-disclosure',
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.sourceSeq + 0.01,
    location: locationOf(context),
    visibility: 'visible',
    data: { sourceKind: context.state.sourceKind },
  }),
}

export const imageDisclosureDefinition: ConversationNodeDefinition<ImageDisclosureState> = {
  kind: 'e-mate-image-disclosure',
  target: 'chat',
  match: event => {
    if (event.type !== 'assistant/message' || !isAppendSurfaceEvent(event)) return null
    const imageCount = event.data.message.content.filter(block => block.type === 'image').length
    return imageCount === 0 ? null : { id: `assistant:${event.data.message.id}`, role: 'start' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'assistant/message') {
      throw new Error('e-Mate image disclosure requires a durable assistant message')
    }
    return {
      imageCount: match.event.data.message.content.filter(block => block.type === 'image').length,
      sourceSeq: match.event.seq,
    }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined ? null : ({
    key: context.key,
    kind: 'e-mate-image-disclosure',
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.sourceSeq + 0.02,
    location: locationOf(context),
    visibility: 'visible',
    data: { imageCount: context.state.imageCount },
  }),
}

function previousMessageRow(row: HTMLElement, sourceKind: MessageKind): HTMLElement | null {
  let sibling = row.previousElementSibling as HTMLElement | null
  for (let distance = 0; sibling !== null && distance < 4; distance += 1) {
    const kind = sibling.dataset.chatFlowKind
    if (sourceKind === 'assistant-step' && kind === 'assistant-step') return sibling
    if (sourceKind === 'user' && (kind === 'user' || kind === 'steering')) return sibling
    sibling = sibling.previousElementSibling as HTMLElement | null
  }
  return null
}

function messageText(row: HTMLElement, sourceKind: MessageKind): HTMLElement | null {
  if (sourceKind === 'user') {
    return row.querySelector<HTMLElement>('[data-time-hover-root] > div:first-child > div:last-child')
  }
  const body = row.querySelector<HTMLElement>('[data-slot="conversation.chat.node"] > div > div')
  if (body === null) return null
  return [...body.children].find((element): element is HTMLElement => element instanceof HTMLElement
    && element.matches(':has(> p, > h1, > h2, > h3, > h4, > h5, > h6, > ul, > ol, > pre, > blockquote, > table)')) ?? null
}

export function LongMessageDisclosure({ node }: ChatNodeViewProps<'e-mate-message-disclosure'>) {
  const { sourceKind } = node.data
  const controlId = `e-mate-long-${node.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const rootRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const [downloadHost, setDownloadHost] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const row = rootRef.current?.closest<HTMLElement>('[data-chat-flow-kind]')
    if (row === undefined || row === null) return undefined
    const sourceRow = previousMessageRow(row, sourceKind)
    const text = sourceRow === null ? null : messageText(sourceRow, sourceKind)
    if (text === null) return undefined
    const previousId = text.id
    text.id = controlId
    text.setAttribute('data-emate-long-text-kind', sourceKind)
    textRef.current = text
    const host = document.createElement('span')
    host.className = css.host
    host.setAttribute('data-emate-long-disclosure-host', '')
    host.setAttribute('data-source-kind', sourceKind)
    const headerHost = document.createElement('span')
    headerHost.className = css.headerHost
    headerHost.setAttribute('data-emate-long-download-host', '')
    text.append(host, headerHost)
    setPortalHost(host)
    setDownloadHost(headerHost)

    const measure = () => {
      const next = text.scrollHeight > 160
      setOverflowing(next)
      if (next) text.setAttribute('data-emate-long-text', '')
      else text.removeAttribute('data-emate-long-text')
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(text)
    return () => {
      observer.disconnect()
      text.removeAttribute('data-emate-long-text')
      text.removeAttribute('data-emate-long-text-expanded')
      text.removeAttribute('data-emate-long-text-kind')
      if (text.id === controlId) text.id = previousId
      if (textRef.current === text) textRef.current = null
      host.remove()
      headerHost.remove()
    }
  }, [controlId, sourceKind])

  useLayoutEffect(() => {
    const row = rootRef.current?.closest<HTMLElement>('[data-chat-flow-kind]')
    if (row === undefined || row === null) return undefined
    const sourceRow = previousMessageRow(row, sourceKind)
    const text = sourceRow === null ? null : messageText(sourceRow, sourceKind)
    if (text === null || !overflowing) return undefined
    if (expanded) text.setAttribute('data-emate-long-text-expanded', '')
    else text.removeAttribute('data-emate-long-text-expanded')
    portalHost?.toggleAttribute('data-expanded', expanded)
    downloadHost?.toggleAttribute('data-expanded', expanded)
    return () => { text.removeAttribute('data-emate-long-text-expanded') }
  }, [downloadHost, expanded, overflowing, portalHost, sourceKind])

  const download = () => {
    const text = textRef.current
    if (text === null) return
    const copy = text.cloneNode(true) as HTMLElement
    copy.querySelectorAll('[data-emate-long-disclosure-host], [data-emate-long-download-host]')
      .forEach(element => { element.remove() })
    const href = URL.createObjectURL(new Blob([copy.innerText], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = href
    link.download = 'e-mate-long-text.txt'
    link.click()
    URL.revokeObjectURL(href)
  }

  return (
    <div
      ref={rootRef}
      className={css.root}
      data-emate-long-disclosure=""
    >
      {portalHost !== null && overflowing && createPortal(<button
        type="button"
        className={css.button}
        aria-expanded={expanded}
        aria-controls={controlId}
        aria-label={expanded ? '收起完整消息' : '展开完整消息'}
        onClick={() => { setExpanded(value => !value) }}
      >
        {expanded ? '收起文本' : '展开文本'}
        <IconChevronDownOutline14 className={css.chevron} />
      </button>, portalHost)}
      {downloadHost !== null && overflowing && sourceKind === 'assistant-step' && createPortal(<button
        type="button"
        className={css.download}
        aria-label="下载长文本摘要"
        title="下载长文本摘要"
        onClick={download}
      >
        <IconDownloadOutline16 />
      </button>, downloadHost)}
    </div>
  )
}

export function ImageDisclosure({ node }: ChatNodeViewProps<'e-mate-image-disclosure'>) {
  const { imageCount } = node.data
  const controlId = `e-mate-images-${node.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const rootRef = useRef<HTMLDivElement>(null)
  const galleriesRef = useRef<HTMLElement[]>([])
  const [expanded, setExpanded] = useState(false)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const [controls, setControls] = useState('')

  useLayoutEffect(() => {
    const row = rootRef.current?.closest<HTMLElement>('[data-chat-flow-kind]')
    if (row === undefined || row === null) return undefined
    const sourceRow = previousMessageRow(row, 'assistant-step')
    if (sourceRow === null) return undefined
    const galleries = [...sourceRow.querySelectorAll<HTMLElement>('[data-align="start"]')]
      .filter(gallery => gallery.closest('[data-chat-flow-kind]') === sourceRow)
    const first = galleries[0]
    if (first === undefined || first.parentElement === null) return undefined

    const previous = galleries.map((gallery, index) => ({
      gallery,
      hidden: gallery.hidden,
      id: gallery.id,
      nextId: gallery.id || `${controlId}-${index + 1}`,
    }))
    for (const item of previous) {
      item.gallery.id = item.nextId
      item.gallery.hidden = true
      item.gallery.setAttribute('data-emate-image-gallery', '')
    }
    galleriesRef.current = galleries

    const host = document.createElement('span')
    host.className = css.imageHost
    host.setAttribute('data-emate-image-disclosure-host', '')
    first.parentElement.insertBefore(host, first)
    setControls(previous.map(item => item.nextId).join(' '))
    setPortalHost(host)

    return () => {
      for (const item of previous) {
        item.gallery.hidden = item.hidden
        item.gallery.removeAttribute('data-emate-image-gallery')
        if (item.gallery.id === item.nextId) item.gallery.id = item.id
      }
      galleriesRef.current = []
      host.remove()
    }
  }, [controlId])

  useLayoutEffect(() => {
    for (const gallery of galleriesRef.current) gallery.hidden = !expanded
    portalHost?.toggleAttribute('data-expanded', expanded)
  }, [expanded, portalHost])

  return (
    <div ref={rootRef} className={css.root} data-emate-image-disclosure="">
      {portalHost !== null && controls !== '' && createPortal(<button
        type="button"
        className={css.imageButton}
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={() => { setExpanded(value => !value) }}
      >
        <IconBrowseOutline16 className={css.imageIcon} />
        <strong>已查看 {imageCount} 张图像</strong>
        <IconChevronDownOutline14 className={css.imageChevron} />
      </button>, portalHost)}
    </div>
  )
}
