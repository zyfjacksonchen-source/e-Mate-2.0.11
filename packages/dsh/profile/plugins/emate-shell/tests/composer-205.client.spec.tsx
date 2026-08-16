// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPOSER_PLACEHOLDER, ComposerConnectors, CONNECTORS_PATH, routeToConnections } from '../src/client/composer-connectors.tsx'

const Icon = () => <svg />

afterEach(() => {
  cleanup()
  history.replaceState(null, '', '/')
})

describe('final e-Mate 2.0.5 composer projection', () => {
  it('routes the connector control to the capability center external-connection subtype', () => {
    history.replaceState(null, '', '/chat/session-1')
    const popstate = vi.fn()
    addEventListener('popstate', popstate, { once: true })
    render(<ComposerConnectors LinkIcon={Icon} openConnections={routeToConnections} />)
    fireEvent.click(screen.getByRole('button', { name: '打开能力中心的外部连接' }))
    expect(`${location.pathname}${location.search}`).toBe(CONNECTORS_PATH)
    expect(history.state.eMateSettingsReturn).toBe('/chat/session-1')
    expect(popstate).toHaveBeenCalledOnce()
  })

  it('restores the 2.0.5 guide on the resident live Harness textarea', () => {
    render(
      <div data-composer-card="">
        <textarea defaultValue="" placeholder="描述你想要构建的内容" />
        <ComposerConnectors LinkIcon={Icon} openConnections={() => {}} />
      </div>,
    )
    expect(screen.getByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeTruthy()
  })

  it('keeps the target blocker reason on a disabled textarea', () => {
    render(
      <div data-composer-card="">
        <textarea disabled placeholder="当前模型不可用，请先选择模型" />
        <ComposerConnectors LinkIcon={Icon} openConnections={() => {}} />
      </div>,
    )
    expect(screen.getByPlaceholderText('当前模型不可用，请先选择模型')).toBeTruthy()
  })

  it('keeps the target InputBar transport and source 2.0.5 geometry contract', () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    const styles = readFileSync('src/client/home.module.css', 'utf8')
    expect(source).toContain("ctx.slots.inject('conversation.input.right'")
    expect(source).toContain('routeToConnections')
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|EventSource)\s*\(/u)
    expect(styles).toContain("[data-composer-card]")
    expect(styles).toContain('min-height: 112px')
    expect(styles).toContain(":global([data-slot='conversation'] > div[data-phase])")
    expect(styles).not.toMatch(/:global\(\[data-phase\]\)\s*\{/u)
    expect(styles).toMatch(/\[data-input-mirror\]\) \{\s*min-height: 44px;/u)
    expect(styles).toMatch(/@media \(max-width: 767px\)[\s\S]*flex-direction: column;/u)
    expect(styles).toContain("[data-slot='conversation.input.model'])")
    expect(styles).toContain('flex: 1 1 auto')
    expect(styles).toContain('background: transparent !important')
    expect(styles).toContain('border-radius: 24px 24px 0 0 !important')
    expect(styles).toContain('border-radius: 0 0 24px 24px')
    expect(styles).toContain("background: url('/assets/e-mate/send.svg') center / contain no-repeat")
    expect(styles).toContain('display: inline-flex !important')
    expect(styles).toContain('border-radius: 10px !important')
    expect(styles).toContain("button[aria-label='发送消息']::after")
  })
})
