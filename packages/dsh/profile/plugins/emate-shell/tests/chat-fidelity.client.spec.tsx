// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImageDisclosure, imageDisclosureDefinition, ToolImageGallery, toolImagesDefinition } from '../src/client/image-gallery.tsx'
import { ThinkingStatusBranding } from '../src/client/thinking-status.tsx'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  isAppendSurfaceEvent: (event: { surfaceOp?: string }) => event.surfaceOp === 'append',
}))

vi.mock('@deepseek-ai/dsh-client-ui-attachment', () => ({
  ImageGallery: ({ images }: { images: unknown[] }) => <div data-target-image-gallery="">{images.length} images</div>,
}))

const source = readFileSync(resolve('src/client/index.ts'), 'utf8')
const gallery = readFileSync(resolve('src/client/image-gallery.tsx'), 'utf8')
const galleryCss = readFileSync(resolve('src/client/image-gallery.module.css'), 'utf8')
const chatCss = readFileSync(resolve('src/client/chat-chrome.module.css'), 'utf8')
const thinkingCss = readFileSync(resolve('src/client/thinking-status.module.css'), 'utf8')
const homeCss = readFileSync(resolve('src/client/home.module.css'), 'utf8')
const targetRoot = resolve('../../../../../upstream/deepseek-harness/packages/client')
const targetMessage = readFileSync(resolve(targetRoot, 'ui-conversation/src/client/chat/MessageItem.tsx'), 'utf8')
const targetAssistant = readFileSync(resolve(targetRoot, 'ui-conversation/src/client/chat/AssistantMarkdown.tsx'), 'utf8')
const targetChat = readFileSync(resolve(targetRoot, 'ui-conversation/src/client/chat/ChatView.tsx'), 'utf8')
const targetTool = readFileSync(resolve(targetRoot, 'ui-tool/src/client/tool/components/ToolRow.tsx'), 'utf8')
const targetImages = readFileSync(resolve(targetRoot, 'ui-attachment/src/MessageImage.tsx'), 'utf8')
const targetLightbox = readFileSync(resolve(targetRoot, 'ui-attachment/src/ImageLightbox.tsx'), 'utf8')
const targetBundlePatch = readFileSync(resolve(targetRoot, '../bundle/web-app/cordis.patch.yml'), 'utf8')
const genuiRoot = resolve('../../bundles/genui')
const genuiPackage = readFileSync(resolve(genuiRoot, 'package.json'), 'utf8')
const genuiPatch = readFileSync(resolve(genuiRoot, 'cordis.patch.yml'), 'utf8')
const genuiServer = readFileSync(resolve(genuiRoot, 'lib/index.js'), 'utf8')
const genuiClient = readFileSync(resolve(genuiRoot, 'lib/client.js'), 'utf8')

describe('target conversation fidelity contract', () => {
  it('leaves Message, Retry, Turn status and Tool disclosure to the pinned target', () => {
    expect(source).not.toMatch(/activity-header|retry-attempts|long-message-disclosure|e-mate-message-disclosure/u)
    expect(source).not.toContain("key: 'model-retry'")
    expect(targetMessage).toContain('export const RetryNodeView')
    expect(targetMessage).toContain('<ModelRetryItem node={data.current}')
    expect(targetMessage).toContain('function UserStyleBubble')
    expect(targetAssistant).toContain('<ReasoningRow')
    expect(targetChat).toContain('<ChatNodeSeat')
    expect(targetChat).toContain('<TurnStatus startTime={runningTurnStart}')
    expect(targetTool).toContain('<DisclosureRow')
    expect(targetBundlePatch).toContain('id: ui-deliverables')
  })

  it('keeps target renderers while applying only the e-Mate type scale, gallery and disabled-trajectory boundary', () => {
    expect(chatCss).not.toMatch(/data-chat-flow-kind='(?:steering|model-retry|turn-error|command)'/u)
    expect(chatCss).not.toMatch(/data-turn-tail|data-emate-activity/u)
    expect(chatCss).toContain('--dsw-font-markdown-base: 14px/22px')
    expect(chatCss).toContain("[data-chat-flow-kind='user'] [data-time-hover-root]")
    expect(chatCss).toContain('"PingFang SC"')
    expect(chatCss).toContain('font-size: 14px !important;')
    expect(chatCss).toContain("[data-chat-flow-kind='tool-call'] [data-disclosure-row]")
    expect(chatCss).toContain('font-size: 13px;')
    expect(chatCss).toContain('width: 14px;')
    expect(chatCss).toContain("[data-chat-flow-kind='assistant-step'] [data-align='start']")
    expect(chatCss).toContain('[data-produced-files-row] > button[title]')
    expect(chatCss).toContain('Beautiful UI Tool Chips icon geometry (MIT)')
    expect(chatCss).toContain("div:has(> [data-disclosure-row] [data-context-source])")
    expect(chatCss).toContain("[data-chat-flow-kind='e-mate-image-disclosure']")
    expect(chatCss).toContain("[data-sample='bash'] + div > button")
    expect(chatCss).toMatch(/\[data-slot='conversation'\] \[aria-expanded\]:focus-visible[^}]*outline: none;[^}]*box-shadow: none;/u)
    expect(homeCss).toContain('--dsw-static-deepseek-500: var(--emate-color-brand);')
    expect(homeCss).toContain('--dsw-alias-state-business-primary: var(--emate-color-brand);')
    expect(source).toContain("ctx.slots.inject('conversation.composer.dock'")
    expect(source).toMatch(/id: 'stats',[\s\S]*?priority: -1/u)
  })

  it('styles the target produced-file buttons without registering a competing turn-tail chain entry', () => {
    expect(source).not.toContain("ctx.slots.inject('conversation.chat.turnTail'")
    expect(source).not.toContain('e-mate-artifact-capsules')
    expect(chatCss).toContain('[data-produced-files-row] > button[title]')
  })

  it('shows the target ImageGallery by default without replacing its DOM or lightbox', () => {
    const event = {
      type: 'assistant/message', seq: 5, time: 5, surfaceOp: 'append',
      data: { message: { id: 'assistant-1', content: [
        { type: 'text', text: 'result' },
        { type: 'image', attachment: { attachmentId: 'one' } },
        { type: 'image', attachment: { attachmentId: 'two' } },
      ] } },
    }
    expect(imageDisclosureDefinition.match(event as never)).toEqual({ id: 'assistant:assistant-1', role: 'start' })

    const view = render(<div data-chat-flow="">
      <div data-chat-flow-kind="assistant-step">
        <div data-align="start"><button type="button">first image</button></div>
      </div>
      <div data-chat-flow-kind="e-mate-image-disclosure">
        <ImageDisclosure node={{ key: 'image:test', data: { imageCount: 2 } } as never} />
      </div>
    </div>)
    const targetGallery = view.container.querySelector<HTMLElement>('[data-align="start"]')!
    const original = targetGallery
    const button = screen.getByRole('button', { name: '已查看 2 张图像' })
    expect(targetGallery.hidden).toBe(false)
    expect(button.getAttribute('aria-controls')).toBe(targetGallery.id)
    expect(button.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(button)
    expect(targetGallery).toBe(original)
    expect(targetGallery.hidden).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('false')

    cleanup()
    expect(targetGallery.hidden).toBe(false)
    expect(targetGallery.id).toBe('')
    expect(targetImages).toContain('export function ImageGallery')
    expect(targetImages).toContain('<MessageImage')
    expect(targetImages).toContain('<ImageLightbox')
    expect(targetLightbox).toContain('role="dialog"')
    expect(gallery).toContain("querySelectorAll<HTMLElement>('[data-align=\"start\"]')")
    expect(galleryCss).toContain('[data-emate-image-gallery][hidden]')
  })

  it('projects durable custom image events through the target ImageGallery without model-visible image input', () => {
    const attachment = {
      attachmentId: 'sha256:one', mediaType: 'image/png', bytes: 10, width: 1, height: 1, name: 'e-Mate-image.png',
    }
    const event = {
      type: 'emate/image-output', seq: 8, time: 8,
      data: { call_id: 'call-1', content: [{ type: 'image', attachment }] },
    }
    expect(toolImagesDefinition.match(event as never)).toEqual({ id: 'tool-images:call-1', role: 'start' })

    render(<ToolImageGallery node={{ key: 'tool-images:test', data: { images: [{ attachment }] } } as never} loadImage={vi.fn()} />)
    const button = screen.getByRole('button', { name: '已查看 1 张图像' })
    const gallery = screen.getByText('1 images')
    expect(gallery.parentElement?.hidden).toBe(false)
    expect(gallery.hasAttribute('data-target-image-gallery')).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button)
    expect(gallery.parentElement?.hidden).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('e-Mate-image.png')).toBeTruthy()
  })

  it('keeps dsh-genui registered on target slots and real plugin metadata', () => {
    expect(JSON.parse(genuiPackage)).toMatchObject({
      name: '@e-mate/dsh-plugin-genui',
      version: '2.0.11',
      dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
    })
    expect(genuiPatch).toContain('id: emate-genui')
    expect(genuiPatch).toContain("name: '@e-mate/dsh-plugin-genui'")
    expect(genuiServer).toContain('tools.register(createRenderUiTool())')
    expect(genuiServer).toContain('tools.register(createValidateDshUiTool())')
    expect(genuiClient).toContain('tool.call.toolview')
    expect(genuiClient).toContain('conversation.input.dock')
    expect(genuiClient).toContain('data-genui-tool')
    expect(genuiClient).toContain('data-genui-panel')
  })

  it('brands only target running statuses without rescanning the document during token streaming', async () => {
    const view = render(<>
      <ThinkingStatusBranding />
      <div role="status" aria-live="polite">Deep diving...<span>15秒</span></div>
      <div role="status" aria-live="polite">正在上传</div>
    </>)
    const target = screen.getByRole('status', { name: '思考中' })
    const unrelated = [...view.container.querySelectorAll<HTMLElement>('[role="status"]')]
      .find(node => node.textContent === '正在上传')!
    expect(target.hasAttribute('data-emate-thinking-status')).toBe(true)
    expect(target.textContent).not.toContain('Deep diving...')
    expect(target.textContent).toContain('思考中')
    expect(target.querySelectorAll('i')).toHaveLength(4)
    expect(unrelated.hasAttribute('data-emate-thinking-status')).toBe(false)
    expect(thinkingCss).toContain('var(--dsw-alias-label-secondary)')
    expect(thinkingCss).toContain('@keyframes emate-domino')
    expect(thinkingCss).toContain('width: 16px')

    const documentQuery = vi.spyOn(document, 'querySelectorAll')
    const stream = document.createElement('div')
    view.container.append(stream)
    await act(async () => {
      for (let index = 0; index < 50; index += 1) stream.append(document.createElement('span'))
      await Promise.resolve()
    })
    expect(documentQuery).not.toHaveBeenCalled()

    const lateTarget = document.createElement('div')
    lateTarget.setAttribute('role', 'status')
    lateTarget.setAttribute('aria-live', 'polite')
    lateTarget.append('Deep diving...')
    await act(async () => {
      view.container.append(lateTarget)
      await Promise.resolve()
    })
    expect(lateTarget.hasAttribute('data-emate-thinking-status')).toBe(true)
    expect(documentQuery).not.toHaveBeenCalled()
    documentQuery.mockRestore()

    view.unmount()
    expect(target.hasAttribute('data-emate-thinking-status')).toBe(false)
    expect(target.textContent).toContain('Deep diving...')
  })
})
