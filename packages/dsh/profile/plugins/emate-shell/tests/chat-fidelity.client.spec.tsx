// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActivityGroup, activityGroupDefinition } from '../src/client/activity-group.tsx'
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
const genuiRoot = resolve('../../bundles/genui')
const genuiPackage = readFileSync(resolve(genuiRoot, 'package.json'), 'utf8')
const genuiPatch = readFileSync(resolve(genuiRoot, 'cordis.patch.yml'), 'utf8')
const genuiServer = readFileSync(resolve(genuiRoot, 'lib/index.js'), 'utf8')
const genuiClient = readFileSync(resolve(genuiRoot, 'lib/client.js'), 'utf8')

describe('target conversation fidelity contract', () => {
  it('leaves Message, Retry, Turn status and Tool disclosure to the pinned target', () => {
    expect(source).not.toMatch(/retry-attempts|long-message-disclosure|e-mate-message-disclosure/u)
    expect(source).not.toContain("key: 'model-retry'")
    expect(source).toContain("key: 'e-mate-activity-group'")
    expect(targetMessage).toContain('export const RetryNodeView')
    expect(targetMessage).toContain('<ModelRetryItem node={data.current}')
    expect(targetMessage).toContain('function UserStyleBubble')
    expect(targetAssistant).toContain('<ReasoningRow')
    expect(targetChat).toContain('<ChatNodeSeat')
    expect(targetChat).toContain('<TurnStatus startTime={runningTurnStart}')
    expect(targetTool).toContain('<DisclosureRow')
  })

  it('keeps chat CSS on presentation metadata without tool-name dispatch', () => {
    expect(chatCss).not.toMatch(/data-tool=["'](?:Read|Search|Web|Edit|Terminal|Bash)/u)
    expect(chatCss).toContain('[data-emate-activity-toggle]')
    expect(chatCss).toContain('[data-turn-tail][data-emate-activity-tail]')
    expect(chatCss).toContain("[data-state='running'] [data-disclosure-row]::after")
    expect(chatCss).toContain('@keyframes emate-text-shimmer')
    expect(chatCss).toContain("[data-chat-flow-kind='assistant-step'] [data-align='start']")
    expect(chatCss).toContain("[data-chat-flow-kind='e-mate-image-disclosure']")
    expect(chatCss).toContain("[data-sample='bash'] + div > button")
    expect(chatCss).toMatch(/\[data-slot='conversation'\] \[aria-expanded\]:focus-visible[^}]*outline: none;[^}]*box-shadow: none;/u)
    expect(homeCss).toContain('--dsw-static-deepseek-500: var(--emate-color-brand);')
    expect(homeCss).toContain('--dsw-alias-state-business-primary: var(--emate-color-brand);')
  })

  it('derives one collapsible activity group from real turn boundaries', () => {
    const start = { type: 'turn/start', seq: 1, time: 1_000, data: { turn: 7 } }
    const step = { type: 'step/start', seq: 3, time: 1_100, data: { turn: 7, step: 1 } }
    const end = { type: 'turn/end', seq: 8, time: 5_000, data: { turn: 7, reason: { kind: 'completed' } } }
    expect(activityGroupDefinition.match(start as never)).toEqual({ id: '7', role: 'start' })
    expect(activityGroupDefinition.match(step as never)).toEqual({ id: '7', role: 'update' })
    expect(activityGroupDefinition.match(end as never)).toEqual({ id: '7', role: 'update' })
    const initial = activityGroupDefinition.start({} as never, { event: start } as never, {} as never)
    const active = activityGroupDefinition.update({ state: initial } as never, { event: step } as never)
    const settled = activityGroupDefinition.update({ state: active } as never, { event: end } as never)
    expect(settled).toMatchObject({
      turn: 7,
      startTime: 1_000,
      firstActivitySeq: 3,
      endTime: 5_000,
      status: 'completed',
    })

    const view = render(<div data-chat-flow="">
      <div data-chat-flow-kind="e-mate-activity-group">
        <ActivityGroup node={{
          key: 'activity:7',
          data: { turn: 7, startTime: 1_000, endTime: 5_000, status: 'completed' },
        } as never} />
      </div>
      <div data-chat-flow-kind="assistant-step" data-testid="think-row"><div><div data-variant="think">Reasoning</div></div></div>
      <div data-chat-flow-kind="tool-call" data-testid="tool-row"><div data-state="ok">Read</div></div>
      <div data-chat-flow-kind="tool-call" data-testid="error-row"><div data-state="error">Failed</div></div>
      <div data-chat-flow-kind="assistant-step" data-testid="answer-row"><p>Final answer</p></div>
    </div>)
    const button = screen.getByRole('button', { name: '已处理 00:04' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('think-row').hidden).toBe(true)
    expect(screen.getByTestId('tool-row').hidden).toBe(true)
    expect(screen.getByTestId('error-row').hidden).toBe(false)
    expect(screen.getByTestId('answer-row').hidden).toBe(false)
    expect(button.getAttribute('aria-controls')?.split(' ')).toHaveLength(2)
    fireEvent.click(button)
    expect(screen.getByTestId('think-row').hidden).toBe(false)
    expect(screen.getByTestId('tool-row').hidden).toBe(false)
    view.unmount()
  })

  it('keeps the real running activity expanded for the existing Domino host', () => {
    const view = render(<div data-chat-flow="">
      <div data-chat-flow-kind="e-mate-activity-group">
        <ActivityGroup node={{
          key: 'activity:8',
          data: { turn: 8, startTime: Date.now() - 68_000, status: 'running' },
        } as never} />
      </div>
      <div data-chat-flow-kind="assistant-step" data-testid="running-think"><div><div data-variant="think">Reasoning</div></div></div>
      <div data-chat-flow-kind="tool-call" data-testid="running-tool"><div data-state="running">Terminal</div></div>
    </div>)
    const button = screen.getByRole('button', { name: /思考中 已工作 01:08/u })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(view.container.querySelector('[data-emate-thinking-host]')).not.toBeNull()
    expect(screen.getByTestId('running-think').hidden).toBe(false)
    expect(screen.getByTestId('running-tool').hidden).toBe(false)
    view.unmount()
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

  it('projects durable tool-result images through the target ImageGallery after reload', () => {
    const attachment = { attachmentId: 'sha256:one', mediaType: 'image/png', bytes: 10, width: 1, height: 1 }
    const event = {
      type: 'tool/result', seq: 8, time: 8, surfaceOp: 'append',
      data: { message: { id: 'tool-result-1', content: [{
        type: 'tool-result', toolCallId: 'call-1', isError: false,
        content: [{ type: 'text', text: 'Generated 1 image.' }, { type: 'image', attachment }],
      }] } },
    }
    expect(toolImagesDefinition.match(event as never)).toEqual({ id: 'tool-images:tool-result-1', role: 'start' })

    render(<ToolImageGallery node={{ key: 'tool-images:test', data: { images: [{ attachment }] } } as never} loadImage={vi.fn()} />)
    const button = screen.getByRole('button', { name: '已查看 1 张图像' })
    const gallery = screen.getByText('1 images')
    expect(gallery.parentElement?.hidden).toBe(true)
    fireEvent.click(button)
    expect(gallery.hasAttribute('data-target-image-gallery')).toBe(true)
    expect(gallery.parentElement?.hidden).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('true')
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
      <div data-emate-activity-header="" data-state="running">
        <span data-emate-thinking-host="" />
      </div>
      <div role="status" aria-live="polite">Deep diving...<span>15秒</span></div>
      <div role="status" aria-live="polite">正在上传</div>
    </>)
    const target = view.container.querySelector<HTMLElement>('[role="status"][data-emate-thinking-status]')!
    const activityHost = view.container.querySelector<HTMLElement>('[data-emate-thinking-host]')!
    const unrelated = [...view.container.querySelectorAll<HTMLElement>('[role="status"]')]
      .find(node => node.textContent === '正在上传')!
    expect(target.hidden).toBe(true)
    expect(target.hasAttribute('data-emate-thinking-status')).toBe(true)
    expect(target.textContent).not.toContain('Deep diving...')
    expect(activityHost.textContent).toContain('思考中')
    expect(activityHost.querySelectorAll('i')).toHaveLength(4)
    expect(unrelated.hasAttribute('data-emate-thinking-status')).toBe(false)
    expect(thinkingCss).toContain('var(--dsw-alias-label-secondary)')
    expect(thinkingCss).toContain('@keyframes emate-domino')
    expect(thinkingCss).toContain('width: 16px')
    view.unmount()
    expect(target.hasAttribute('data-emate-thinking-status')).toBe(false)
    expect(target.textContent).toContain('Deep diving...')
  })
})
