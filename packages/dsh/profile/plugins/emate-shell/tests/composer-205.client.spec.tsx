// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPOSER_PLACEHOLDER, ComposerConnectors, CONNECTORS_PATH, routeToConnections } from '../src/client/composer-connectors.tsx'
import { ConnectionsSettings } from '../src/client/connections.tsx'
import { SettingsChrome } from '../src/client/settings-chrome.tsx'

const Icon = () => <svg />

afterEach(() => {
  cleanup()
  history.replaceState(null, '', '/')
})

describe('final e-Mate 2.0.5 composer projection', () => {
  it('routes the connector control through the real settings connections section', () => {
    history.replaceState(null, '', '/chat/session-1')
    const popstate = vi.fn()
    addEventListener('popstate', popstate, { once: true })
    render(<ComposerConnectors LinkIcon={Icon} openConnections={routeToConnections} />)
    fireEvent.click(screen.getByRole('button', { name: '打开飞书和腾讯文档连接器' }))
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

  it('selects the existing settings.section row rather than mounting another page', async () => {
    history.replaceState(null, '', CONNECTORS_PATH)
    const selectConnections = vi.fn()
    render(
      <div role="dialog">
        <nav>
          <button type="button" aria-current="true">个人资料</button>
          <button type="button" onClick={selectConnections}>外部连接</button>
        </nav>
        <SettingsChrome />
      </div>,
    )
    await waitFor(() => { expect(selectConnections).toHaveBeenCalledOnce() })
  })

  it('shows only the real Feishu and Tencent Docs catalog items on the focused route', async () => {
    history.replaceState(null, '', CONNECTORS_PATH)
    const items = [
      ['feishu', '飞书'],
      ['tencent-docs', '腾讯文档'],
      ['wechat', '微信'],
      ['dingtalk', '钉钉'],
    ].map(([id, title]) => ({ id, title, summary: `${title} summary`, state: 'blocked', detail: `${title} detail`, fields: [] }))
    render(<ConnectionsSettings
      callConnections={async () => ({ ok: true, value: { schema_version: 1, items } })}
      setCredential={async () => {}}
      unsetCredential={async () => {}}
      LinkIcon={Icon}
      RefreshIcon={Icon}
    />)
    await waitFor(() => { expect(screen.getByText('飞书')).toBeTruthy() })
    expect(screen.getByText('腾讯文档')).toBeTruthy()
    expect(screen.queryByText('微信')).toBeNull()
    expect(screen.queryByText('钉钉')).toBeNull()
  })

  it('keeps the target InputBar transport and source 2.0.5 geometry contract', () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    const styles = readFileSync('src/client/home.module.css', 'utf8')
    expect(source).toContain("ctx.slots.inject('conversation.input.right'")
    expect(source).toContain('routeToConnections')
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|EventSource)\s*\(/u)
    expect(styles).toContain("[data-composer-card]")
    expect(styles).toContain('min-height: 112px')
    expect(styles).toContain('background: transparent !important')
    expect(styles).toContain('border-radius: 24px 24px 0 0 !important')
    expect(styles).toContain('border-radius: 0 0 24px 24px')
    expect(styles).toContain("background: url('/assets/e-mate/send.svg') center / contain no-repeat")
    expect(styles).toContain('display: inline-flex !important')
    expect(styles).toContain('border-radius: 10px !important')
    expect(styles).toContain("button[aria-label='发送消息']::after")
  })
})
