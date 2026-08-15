// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import {
  ImageDisclosure,
  imageDisclosureDefinition,
  longMessageDefinition,
} from '../src/client/long-message-disclosure.tsx'
import { RetryAttempts } from '../src/client/retry-attempts.tsx'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  isAppendSurfaceEvent: (event: { surfaceOp?: string }) => event.surfaceOp === 'append',
}))

const activity = readFileSync(resolve('src/client/activity-header.tsx'), 'utf8')
const activityCss = readFileSync(resolve('src/client/activity-header.module.css'), 'utf8')
const disclosure = readFileSync(resolve('src/client/long-message-disclosure.tsx'), 'utf8')
const disclosureCss = readFileSync(resolve('src/client/long-message-disclosure.module.css'), 'utf8')
const chatCss = readFileSync(resolve('src/client/chat-chrome.module.css'), 'utf8')

describe('chat fidelity contract', () => {
  it('keeps the real activity clock, terminal clock and collapsible running group', () => {
    expect(activity).toContain("if (status === 'running') return '已工作'")
    expect(activity).toContain("if (reason.kind === 'blocked') return 'blocked'")
    expect(activity).toContain("if (status === 'blocked') return '已阻塞'")
    expect(activity).toContain("if (reason.kind === 'interrupted') return 'interrupted'")
    expect(activity).toContain("if (status === 'interrupted') return '已中断'")
    expect(activity).toContain("return 'cancelled'")
    expect(activity).toContain("String(minutes).padStart(2, '0')")
    expect(activity).toContain("state === 'ok' || state === 'running'")
    expect(activity).not.toContain("disabled={status === 'running'}")
  })

  it('keeps the activity header aligned with the collapsed-running prototype', () => {
    expect(activity).toMatch(/<strong>\s*<span>\{statusLabel\(status\)\}<\/span>\{' '\}\s*<time>\{elapsedLabel\}<\/time>\s*<\/strong>/)
    expect(activity).toContain('<IconChevronDownOutline14 className={css.chevron} />')
    expect(activityCss).toMatch(/\.root \{[^}]*width: fit-content;[^}]*font-size: 22px;[^}]*font-weight: 400;[^}]*line-height: 1\.45;[^}]*\}/)
    expect(activityCss).toMatch(/\.chevron \{[^}]*width: 18px;[^}]*height: 18px;[^}]*\}/)
    expect(activityCss).not.toContain('transform:')
  })

  it('restores prototype prose and user-bubble typography without restyling structured Markdown', () => {
    expect(chatCss).toContain("div:not([data-emate-long-text]) > p:not(:has(code, img, video, audio))")
    expect(chatCss).toMatch(/p:not\(:has\(code, img, video, audio\)\)\) \{[^}]*max-width: 1180px;[^}]*margin: 0 0 18px !important;[^}]*font-size: 26px;[^}]*line-height: 1\.58;[^}]*letter-spacing: -0\.01em;/)
    expect(chatCss).toContain("[data-chat-flow-kind='user'] [data-time-hover-root] > div:first-child")
    expect(chatCss).toMatch(/div:last-child:not\(\[data-align\]\)\) \{[^}]*padding: 12px 16px 13px;[^}]*border-radius: 25px;[^}]*font-size: 24px;[^}]*font-weight: 500;[^}]*line-height: 1\.45;[^}]*letter-spacing: -0\.012em;/)
    expect(chatCss).toMatch(/@media \(max-width: 767px\) \{[\s\S]*font-size: 18px;[\s\S]*font-size: 17px;/)
  })

  it('measures one Markdown DOM and exposes functional expand and download controls', () => {
    expect(disclosure).toContain('text.scrollHeight > 160')
    expect(disclosure).toContain("data-emate-long-disclosure-host")
    expect(disclosure).toContain("data-emate-long-download-host")
    expect(disclosure).toContain("new Blob([copy.innerText]")
    expect(disclosure).toContain("expanded ? '收起文本' : '展开文本'")
  })

  it('does not add a measurement row for provably short plain text', () => {
    const user = (text: string) => ({
      type: 'user/message', seq: 1, time: 1, surfaceOp: 'append',
      data: { id: 'user-1', source: { kind: 'user' }, content: [{ type: 'text', text }] },
    })
    expect(longMessageDefinition.match(user('short message') as never)).toBeNull()
    expect(longMessageDefinition.match(user('x'.repeat(49)) as never)).not.toBeNull()
    expect(longMessageDefinition.match(user('![image](https://x)') as never)).not.toBeNull()
    expect(longMessageDefinition.match(user('line one\nline two') as never)).not.toBeNull()
  })

  it('collapses the target assistant ImageGallery without replacing its DOM', () => {
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
    const gallery = view.container.querySelector<HTMLElement>('[data-align="start"]')!
    const original = gallery
    const button = screen.getByRole('button', { name: '已查看 2 张图像' })
    expect(gallery.hidden).toBe(true)
    expect(button.getAttribute('aria-controls')).toBe(gallery.id)
    expect(button.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(button)
    expect(gallery).toBe(original)
    expect(gallery.hidden).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(button)
    expect(gallery.hidden).toBe(true)

    cleanup()
    expect(gallery.hidden).toBe(false)
    expect(gallery.id).toBe('')
  })

  it('fails closed when an image event has no target gallery', () => {
    render(<div data-chat-flow="">
      <div data-chat-flow-kind="assistant-step"><p>no gallery</p></div>
      <div data-chat-flow-kind="e-mate-image-disclosure">
        <ImageDisclosure node={{ key: 'image:missing', data: { imageCount: 1 } } as never} />
      </div>
    </div>)
    expect(screen.queryByRole('button', { name: '已查看 1 张图像' })).toBeNull()
  })

  it('keeps image and Tool disclosures on stable target DOM seams', () => {
    expect(disclosure).toContain("querySelectorAll<HTMLElement>('[data-align=\"start\"]')")
    expect(disclosure).toContain('item.gallery.hidden = true')
    expect(disclosure).toContain('gallery.hidden = !expanded')
    expect(disclosure).toContain('<IconBrowseOutline16 className={css.imageIcon} />')
    expect(disclosureCss).toMatch(/\.imageButton \{[^}]*min-height: 44px;[^}]*font-size: 22px;/)
    expect(disclosureCss).toMatch(/\[data-emate-image-gallery\]\[hidden\][^}]*display: none !important;/)
    expect(disclosureCss).toContain(".imageButton[aria-expanded='true'] .imageChevron")
    expect(chatCss).toContain("[data-chat-flow-kind='tool-call'] [data-disclosure-row]")
    expect(chatCss).toMatch(/\[data-chat-flow-kind='tool-call'\] \[data-disclosure-row\][^}]*box-sizing: border-box;[^}]*min-height: 44px;/)
    expect(chatCss).toMatch(/\[data-chat-flow-kind='tool-call'\] \[data-variant='bash'\][^}]*box-sizing: border-box;[^}]*min-height: 44px;[^}]*font-size: 22px;/)
    expect(chatCss).toContain("[data-variant='bash'][aria-expanded]")
    expect(chatCss).toContain("[data-variant='bash'][aria-expanded='true']")
    expect(chatCss).toContain("[data-align='start'] > [data-variant='single']")
    expect(chatCss).toContain('width: clamp(112px, 18vw, 160px) !important')
  })

  it('disconnects terminal activity groups from the shared flow observer', () => {
    expect(activity).toContain("status === 'running' ? new MutationObserver(mark) : null")
  })

  it('keeps every target-projected retry attempt visible in one correlated row group', () => {
    render(<RetryAttempts node={{ data: {
      attempts: [
        {
          kind: 'model-retry', seq: 3, time: 3, retryId: 'retry-1', turn: 1, step: 1,
          provider: 'fake', mode: 'normal', policyKey: 'normal', retry: 1, maxRetries: 2,
          delayMs: 900, failure: { code: 'TRANSPORT', message: 'first failure' }, retryState: 'started',
        },
        {
          kind: 'model-retry', seq: 5, time: 5, retryId: 'retry-1', turn: 1, step: 1,
          provider: 'fake', mode: 'normal', policyKey: 'normal', retry: 2, maxRetries: 2,
          delayMs: 900, failure: { code: 'TRANSPORT', message: 'second failure' }, retryState: 'cancelled',
        },
      ],
      current: {
        kind: 'model-retry', seq: 5, time: 5, retryId: 'retry-1', turn: 1, step: 1,
        provider: 'fake', mode: 'normal', policyKey: 'normal', retry: 2, maxRetries: 2,
        delayMs: 900, failure: { code: 'TRANSPORT', message: 'second failure' }, retryState: 'cancelled',
      },
    } } as never} />)

    const chain = screen.getByText('上次尝试失败').closest('[data-emate-retry-attempts]')
    expect(chain).not.toBeNull()
    expect(within(chain!).getByText('上次尝试失败')).toBeTruthy()
    expect(within(chain!).getByText('第 1 次 · 1s')).toBeTruthy()
    expect(within(chain!).getByText('重试已取消')).toBeTruthy()
    expect(within(chain!).getByText('第 2 次 · 1s')).toBeTruthy()

    const started = {
      kind: 'model-retry', seq: 8, time: 8, retryId: 'retry-2', turn: 2, step: 1,
      provider: 'fake', mode: 'normal', policyKey: 'normal', retry: 1, maxRetries: 2,
      delayMs: 900, failure: { code: 'TRANSPORT', message: 'retrying' }, retryState: 'started',
    }
    render(<RetryAttempts node={{ data: { attempts: [started], current: started } } as never} />)
    expect(screen.getByText('正在重试')).toBeTruthy()
  })
})
