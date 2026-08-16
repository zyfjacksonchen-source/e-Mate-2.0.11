// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImageDisclosure, imageDisclosureDefinition } from '../src/client/image-gallery.tsx'
import { ThinkingStatusBranding } from '../src/client/thinking-status.tsx'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  isAppendSurfaceEvent: (event: { surfaceOp?: string }) => event.surfaceOp === 'append',
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
  })

  it('keeps chat CSS limited to the gallery and disabled-trajectory boundary', () => {
    expect(chatCss).not.toMatch(/data-chat-flow-kind='(?:user|steering|model-retry|turn-error|command)'/u)
    expect(chatCss).not.toMatch(/data-turn-tail|data-emate-activity|data-disclosure-row/u)
    expect(chatCss).toContain("[data-chat-flow-kind='assistant-step'] [data-align='start']")
    expect(chatCss).toContain("[data-chat-flow-kind='e-mate-image-disclosure']")
    expect(chatCss).toContain("[data-sample='bash'] + div > button")
    expect(chatCss).toMatch(/\[data-slot='conversation'\] \[aria-expanded\]:focus-visible[^}]*outline: none;[^}]*box-shadow: none;/u)
    expect(homeCss).toContain('--dsw-static-deepseek-500: var(--emate-color-brand);')
    expect(homeCss).toContain('--dsw-alias-state-business-primary: var(--emate-color-brand);')
  })

  it('collapses the target ImageGallery without replacing its DOM or lightbox', () => {
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
    expect(targetGallery.hidden).toBe(true)
    expect(button.getAttribute('aria-controls')).toBe(targetGallery.id)
    expect(button.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(button)
    expect(targetGallery).toBe(original)
    expect(targetGallery.hidden).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button)
    expect(targetGallery.hidden).toBe(true)

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

  it('keeps dsh-genui registered on target slots and real plugin metadata', () => {
    expect(JSON.parse(genuiPackage)).toMatchObject({
      name: '@e-mate/dsh-plugin-genui',
      version: '2.0.7',
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

  it('brands only the target running status with the Domino loader', () => {
    const view = render(<>
      <ThinkingStatusBranding />
      <div role="status" aria-live="polite">Deep diving...<span>15秒</span></div>
      <div role="status" aria-live="polite">正在上传</div>
    </>)
    const target = screen.getByRole('status', { name: '思考中' })
    const unrelated = [...view.container.querySelectorAll<HTMLElement>('[role="status"]')]
      .find(node => node.textContent === '正在上传')!
    expect(target.hasAttribute('data-emate-thinking-status')).toBe(true)
    expect(target.textContent).toContain('Deep diving...')
    expect(target.textContent).toContain('思考中')
    expect(target.querySelectorAll('i')).toHaveLength(4)
    expect(unrelated.hasAttribute('data-emate-thinking-status')).toBe(false)
    expect(thinkingCss).toContain('var(--dsw-alias-label-secondary)')
    expect(thinkingCss).toContain('@keyframes emate-domino')
    expect(thinkingCss).toContain('width: 16px')
    view.unmount()
    expect(target.hasAttribute('data-emate-thinking-status')).toBe(false)
  })
})
