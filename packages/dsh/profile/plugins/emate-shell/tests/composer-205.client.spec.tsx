// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPOSER_PLACEHOLDER, ComposerConnectors, ComposerMentions } from '../src/client/composer-connectors.tsx'
import { registerComputerUseTrigger } from '../src/client/composer-mentions.ts'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

const Icon = () => <svg />

afterEach(() => {
  cleanup()
  delete document.body.dataset.dshDesktopPlatform
})

describe('e-Mate 2.0.15 composer projection', () => {
  it('routes external connections into the existing collaboration capability surface', () => {
    const openConnections = vi.fn()
    render(<ComposerConnectors LinkIcon={Icon} openConnections={openConnections} />)
    fireEvent.click(screen.getByRole('button', { name: '打开外部连接能力中心' }))
    expect(openConnections).toHaveBeenCalledOnce()
  })

  it('keeps the resident live Harness textarea placeholder', () => {
    render(<div data-composer-card="">
      <textarea defaultValue="" placeholder="描述你想要构建的内容" />
      <ComposerMentions openMentions={() => {}} />
    </div>)
    expect(screen.getByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeTruthy()
  })

  it('keeps the target blocker reason on a disabled textarea', () => {
    render(<div data-composer-card="">
      <textarea disabled placeholder="当前模型不可用，请先选择模型" />
      <ComposerMentions openMentions={() => {}} />
    </div>)
    expect(screen.getByPlaceholderText('当前模型不可用，请先选择模型')).toBeTruthy()
  })

  it('has one visible native @ launcher, no visible slash affordance, and returns focus to the textarea', () => {
    const openMentions = vi.fn()
    render(<div data-composer-card="">
      <textarea defaultValue="请处理" />
      <ComposerMentions openMentions={openMentions} />
    </div>)
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    textarea.setSelectionRange(3, 3)
    fireEvent.click(screen.getByRole('button', { name: '插入引用' }))
    expect(openMentions).toHaveBeenCalledWith({ start: 3, end: 3 })
    expect(document.activeElement).toBe(textarea)
    expect(screen.getAllByText('@')).toHaveLength(1)
    const styles = readFileSync('src/client/home.module.css', 'utf8')
    expect(styles).not.toContain("content: '/'")
    expect(styles).toMatch(/button:first-child[\s\S]*display:\s*none !important/u)
  })

  it('keeps a picked @电脑操控 reference visible in the native composer', () => {
    document.body.dataset.dshDesktopPlatform = 'darwin'
    let registered: InputTriggerSource | undefined
    registerComputerUseTrigger({
      effect(run: () => () => void) { return run() },
      inputTriggers: {
        registerSource(source: InputTriggerSource) {
          registered = source
          return () => {}
        },
      },
    })
    expect(registered?.onPick({
      candidate: { name: '电脑操控', hint: '可插入' },
      session: { sessionId: 'session-1' as never },
      position: 'inline',
      via: 'menu',
      span: { start: 0, end: 5, draftRev: 1 },
    })).toEqual({
      insert: { source: '电脑操控', ref: 'computer-use', label: '@电脑操控', clipboardText: '@电脑操控' },
    })
    const signal = new AbortController().signal
    expect(registered?.codec?.serialize('computer-use', signal)).resolves.toBe('@电脑操控')
    expect(readFileSync('src/client/home.module.css', 'utf8')).toContain("font-family: 'DshChipCell', -apple-system")
  })

  it('uses the target input trigger and input-bar contracts without a parallel transport', async () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    const home = readFileSync('src/client/home.tsx', 'utf8')
    const styles = readFileSync('src/client/home.module.css', 'utf8')
    const nativeRoot = readFileSync('../../../../../upstream/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx', 'utf8')
    expect(source).toContain("ctx.slots.inject('conversation.input.right'")
    expect(source).toContain("ctx.slots.inject('conversation.input.left'")
    expect(source).toMatch(/id: 'e-mate-mentions',[\s\S]*?order: 11/u)
    expect(source).toContain("'/capabilities?category=collaboration'")
    const mentions = readFileSync('src/client/composer-mentions.ts', 'utf8')
    expect(mentions).toContain("name: '电脑操控'")
    expect(mentions).toContain("label: '@电脑操控'")
    expect(source).not.toContain('<computer-use explicit="true">')
    expect(mentions).not.toMatch(/faceOf\('(?:goal|todos)'\)|kind: 'goal'|kind: 'plan'|<goal|<plan-item/u)
    expect(mentions).toContain("execute(session.sessionId, '/plan')")
    expect(mentions).toContain("'slash/input-consume-token'")
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|EventSource)\s*\(/u)
    await waitFor(() => expect(styles).toContain('[data-composer-card]'))
    expect(nativeRoot).toMatch(/className=\{clsx\(css\.composerStack[\s\S]*?data-emate-composer-frame-host=""/u)
    expect(home).not.toContain('data-emate-composer-frame-host')
    expect(styles).toMatch(/\[data-emate-composer-frame-host\][\s\S]*?\[data-slot='conversation\.composer\.bar'\]/u)
    expect(styles).toMatch(/\[data-emate-composer-frame-host\][\s\S]*?\[data-slot='conversation\.hero\.workspace'\]/u)
    expect(styles).toMatch(/\[data-phase='active'\] \[data-emate-composer-frame-host\][\s\S]*?align-self:\s*center;[\s\S]*?width:\s*min\(var\(--dsh-composer-card-max-width\), 100%\)/u)
    expect(styles).toMatch(/\[data-emate-composer-frame-host\] > \[data-slot='conversation\.composer\.bar'\] > div\)[^{]*\{[^}]*padding:\s*0 !important/u)
    expect(styles).not.toContain('2 * var(--dsh-composer-side-clearance)')
    expect(styles).toMatch(/\[data-phase='hero'\] \[data-composer-seat\][\s\S]*?padding-bottom:\s*32px/u)
    expect(styles).toMatch(/\[data-phase='hero'\] \[data-emate-composer-frame-host\][\s\S]*?padding-bottom:\s*0/u)
    expect(styles).toMatch(/\[data-emate-composer-frame-host\][^{]*\{[^}]*--emate-composer-frame-radius:\s*24px;[^}]*position:\s*relative;[^}]*border-radius:\s*var\(--emate-composer-frame-radius\)/u)
    expect(styles).toMatch(/\[data-emate-composer-frame-host\][\s\S]*?\[data-composer-card\][\s\S]*?border-radius:\s*var\(--emate-composer-frame-radius\) !important/u)
    expect(styles).toMatch(/\[data-emate-composer-frame-host\]:has\(\[data-slot='conversation\.hero\.workspace'\]\)[\s\S]*?border-radius:\s*var\(--emate-composer-frame-radius\) var\(--emate-composer-frame-radius\) 0 0 !important/u)
    expect(styles).not.toContain('--emate-composer-frame-bottom')
  })
})
