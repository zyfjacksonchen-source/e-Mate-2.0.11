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
import css from './image-gallery.module.css'

interface ImageDisclosureData {
  imageCount: number
}

interface ImageDisclosureState extends ImageDisclosureData {
  sourceSeq: number
}

interface ToolImagesData {
  images: readonly { attachment: ImageAttachmentRef }[]
}

interface ToolImagesState extends ToolImagesData {
  sourceSeq: number
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

function toolImages(event: Parameters<ConversationNodeDefinition<ToolImagesState>['match']>[0]): ToolImagesData['images'] {
  if (event.type !== 'tool/result') return []
  return event.data.message.content.flatMap(block => block.type === 'tool-result'
    ? block.content.filter(image => image.type === 'image').map(image => ({ attachment: image.attachment }))
    : [])
}

export const toolImagesDefinition: ConversationNodeDefinition<ToolImagesState> = {
  kind: 'e-mate-tool-images',
  target: 'chat',
  match: event => {
    if (event.type !== 'tool/result' || !isAppendSurfaceEvent(event)) return null
    const images = toolImages(event)
    return images.length === 0 ? null : { id: `tool-images:${event.data.message.id}`, role: 'start' }
  },
  start: (_context, match) => ({ images: toolImages(match.event), sourceSeq: match.event.seq }),
  update: context => context.state,
  buildViewNode: context => context.state === undefined ? null : ({
    key: context.key,
    kind: 'e-mate-tool-images',
    id: context.id,
    target: 'chat',
    anchorSeq: context.state.sourceSeq + 0.02,
    location: locationOf(context),
    visibility: 'visible',
    data: { images: context.state.images },
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
  const [expanded, setExpanded] = useState(false)
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
  const [expanded, setExpanded] = useState(false)
  const controlId = `e-mate-tool-images-${node.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  return <section className={css.toolImages} data-emate-tool-images="">
    <button
      type="button"
      className={css.button}
      aria-expanded={expanded}
      aria-controls={controlId}
      onClick={() => { setExpanded(value => !value) }}
    >
      <IconBrowseOutline16 className={css.icon} />
      <strong>已查看 {node.data.images.length} 张图像</strong>
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
    <div id={controlId} hidden={!expanded}>
      <ImageGallery images={node.data.images} load={loadImage} align="start" labels={imageLabels} />
      <div className={css.names} aria-label="图片文件名">
        {node.data.images.map(({ attachment }, index) => (
          <span key={`${attachment.attachmentId}:${index}`} title={attachment.name ?? imageLabels.image}>
            {attachment.name ?? `图片 ${index + 1}`}
          </span>
        ))}
      </div>
    </div>
  </section>
}
