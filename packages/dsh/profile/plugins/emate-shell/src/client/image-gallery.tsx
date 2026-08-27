import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  ConversationLocation,
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ImageGallery } from '@deepseek-ai/dsh-client-ui-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { IconBrowseOutline16, IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  imageReceiptRole,
  parseImageOutputReceipt,
  type ImageGalleryItem,
} from './image-gallery-contract.ts'
import css from './image-gallery.module.css'

interface ImageDisclosureData {
  imageCount: number
}

interface ImageDisclosureState extends ImageDisclosureData {
  sourceSeq: number
}

interface ToolImagesData {
  items: readonly ImageGalleryItem[]
}

interface ToolImagesState extends ToolImagesData {
  sourceSeq: number
}

type ImageOutputEventData = Record<string, unknown>

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Human-visible generated image kept outside model-visible message history. */
    'emate/image-output': ImageOutputEventData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'e-mate-image-disclosure': ImageDisclosureData
    'e-mate-tool-images': ToolImagesData
  }
}

function locationOf(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
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

function nativeToolItems(
  event: Parameters<ConversationNodeDefinition<ToolImagesState>['match']>[0],
): ToolImagesData['items'] {
  if (event.type === 'emate/image-output') {
    const item = parseImageOutputReceipt(event.data)
    return item === null ? [] : [item]
  }
  if (event.type !== 'tool/result') return []
  const attachments = event.data.message.content.flatMap(block => block.type === 'tool-result'
    ? block.content.filter(image => image.type === 'image').map(image => ({ attachment: image.attachment }))
    : [])
  const seen = new Set<string>()
  return attachments.flatMap(({ attachment }) => {
    if (seen.has(attachment.attachmentId)) return []
    seen.add(attachment.attachmentId)
    return [{
      callId: String(event.data.message.source.callId),
      revision: 0,
      status: 'completed' as const,
      operation: 'unknown' as const,
      attachment,
    }]
  })
}

export const toolImagesDefinition: ConversationNodeDefinition<ToolImagesState> = {
  kind: 'e-mate-tool-images',
  target: 'chat',
  match: event => {
    if (event.type !== 'emate/image-output' && (event.type !== 'tool/result' || !isAppendSurfaceEvent(event))) return null
    const items = nativeToolItems(event)
    if (items.length === 0) return null
    const item = items[0]!
    const id = event.type === 'emate/image-output' ? item.callId : event.data.message.id
    return { id: `tool-images:${id}`, role: event.type === 'emate/image-output' ? imageReceiptRole(item) : 'start' }
  },
  start: (_context, match) => ({ items: nativeToolItems(match.event), sourceSeq: match.event.seq }),
  update: (context, match) => ({ ...context.state, items: nativeToolItems(match.event) }),
  buildViewNode: context => context.state === undefined ? null : ({
    key: context.key,
    kind: 'e-mate-tool-images',
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.sourceSeq + 0.02,
    location: locationOf(context),
    visibility: 'visible',
    data: { items: context.state.items },
  }),
}

function previousAssistantRow(row: HTMLElement): HTMLElement | null {
  let sibling = row.previousElementSibling as HTMLElement | null
  for (let distance = 0; sibling !== null && distance < 4; distance += 1) {
    if (sibling.dataset.chatFlowKind === 'assistant-step') return sibling
    sibling = sibling.previousElementSibling as HTMLElement | null
  }
  return null
}

export function ImageDisclosure({ node }: ChatNodeViewProps<'e-mate-image-disclosure'>) {
  const { imageCount } = node.data
  const controlId = `e-mate-images-${node.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const rootRef = useRef<HTMLDivElement>(null)
  const galleriesRef = useRef<HTMLElement[]>([])
  const [expanded, setExpanded] = useState(true)
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null)
  const [controls, setControls] = useState('')

  useLayoutEffect(() => {
    const row = rootRef.current?.closest<HTMLElement>('[data-chat-flow-kind]')
    if (row === undefined || row === null) return undefined
    const sourceRow = previousAssistantRow(row)
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
    host.className = css.host
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
  }, [expanded])

  return (
    <div ref={rootRef} className={css.root} data-emate-image-disclosure="">
      {portalHost !== null && controls !== '' && createPortal(<button
        type="button"
        className={css.button}
        aria-expanded={expanded}
        aria-controls={controls}
        onClick={() => { setExpanded(value => !value) }}
      >
        <IconBrowseOutline16 className={css.icon} />
        <strong>已查看 {imageCount} 张图像</strong>
        <IconChevronDownOutline14 className={css.chevron} />
      </button>, portalHost)}
    </div>
  )
}

const imageLabels = {
  image: '图像',
  open: '查看原图',
  openNamed: (label: string) => `查看原图：${label}`,
  loading: '正在加载图像…',
  loadFailed: '图像加载失败，点击重试',
  lightbox: { dialog: '原图预览', close: '关闭原图预览' },
}

export function ToolImageGallery({ node, loadImage }: ChatNodeViewProps<'e-mate-tool-images'>) {
  const [expanded, setExpanded] = useState(true)
  const controlId = `e-mate-tool-images-${node.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const legacyImages = (node.data as unknown as { images?: readonly { attachment: ImageAttachmentRef }[] }).images ?? []
  const items = node.data.items ?? legacyImages.map(({ attachment }, index) => ({
    callId: `${node.key}:${index}`,
    revision: 0,
    status: 'completed' as const,
    operation: 'unknown' as const,
    attachment,
  }))
  const images = items.flatMap(item => item.attachment === undefined ? [] : [{ attachment: item.attachment }])
    .filter(({ attachment }, index, all) => all.findIndex(candidate =>
      candidate.attachment.attachmentId === attachment.attachmentId) === index)
  const reviewCount = items.filter(item => item.status === 'review-required').length
  const failedCount = items.filter(item => item.status === 'failed').length
  const summary = images.length > 0
    ? `已查看 ${images.length} 张图像${reviewCount > 0 ? ` · ${reviewCount} 张待确认` : ''}`
    : `图像任务失败${failedCount > 1 ? ` · ${failedCount} 项` : ''}`
  return <section className={css.toolImages} data-emate-tool-images="" aria-label="图片结果">
    <button
      type="button"
      className={css.button}
      aria-expanded={expanded}
      aria-controls={controlId}
      onClick={() => { setExpanded(value => !value) }}
    >
      <IconBrowseOutline16 className={css.icon} />
      <strong>{summary}</strong>
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
    <div id={controlId} hidden={!expanded} className={css.results}>
      {images.length > 0 && <ImageGallery images={images} load={loadImage} align="start" labels={imageLabels} />}
      <div className={css.names} aria-label="图片文件名">
        {items.map((item, index) => (
          <span key={`${item.callId}:${item.revision}:${index}`} data-status={item.status}>
            {item.attachment?.name ?? (item.status === 'failed' ? '生成失败' : `图片 ${index + 1}`)}
            {item.status === 'review-required' ? ' · 待确认' : item.status === 'failed' ? ' · 失败' : ''}
          </span>
        ))}
      </div>
    </div>
  </section>
}
