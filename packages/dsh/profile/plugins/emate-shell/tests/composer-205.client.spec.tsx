// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMPOSER_PLACEHOLDER, ComposerConnectors } from '../src/client/composer-connectors.tsx'
import { registerComputerUseTrigger } from '../src/client/index.ts'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

const Icon = () => <svg />

afterEach(cleanup)

describe('e-Mate 2.0.13 composer projection', () => {
  it('opens a selector card that lists only effective native MCP connections', async () => {
    const callConnections = vi.fn(async () => ({
      ok: true,
      value: {
        schema_version: 1,
        items: [{ name: 'docs', transport: 'streamable-http', active: true, authorized: true }],
      },
    }))
    render(<ComposerConnectors LinkIcon={Icon} callConnections={callConnections} />)
    fireEvent.click(screen.getByRole('button', { name: '查看已生效的外部连接' }))
    expect(await screen.findByRole('menu', { name: '已生效的外部连接' })).toBeTruthy()
    expect(await screen.findByText('docs')).toBeTruthy()
    expect(screen.getByText('远程 MCP')).toBeTruthy()
    expect(callConnections).toHaveBeenCalledOnce()
  })

  it('guides natural-language skill discovery when no connection is active', async () => {
    render(<ComposerConnectors LinkIcon={Icon} callConnections={async () => ({
      ok: true, value: { schema_version: 1, items: [] },
    })} />)
    fireEvent.click(screen.getByRole('button', { name: '查看已生效的外部连接' }))
    expect(await screen.findByText(/直接告诉小芯/u)).toBeTruthy()
  })

  it('keeps the resident live Harness textarea placeholder', () => {
    render(<div data-composer-card="">
      <textarea defaultValue="" placeholder="描述你想要构建的内容" />
      <ComposerConnectors LinkIcon={Icon} callConnections={async () => ({})} />
    </div>)
    expect(screen.getByPlaceholderText(COMPOSER_PLACEHOLDER)).toBeTruthy()
  })

  it('keeps the target blocker reason on a disabled textarea', () => {
    render(<div data-composer-card="">
      <textarea disabled placeholder="当前模型不可用，请先选择模型" />
      <ComposerConnectors LinkIcon={Icon} callConnections={async () => ({})} />
    </div>)
    expect(screen.getByPlaceholderText('当前模型不可用，请先选择模型')).toBeTruthy()
  })

  it('keeps a picked @电脑操控 reference visible in the native composer', () => {
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
      candidate: { name: '电脑操控' },
      session: { sessionId: 'session-1' as never },
      position: 'inline',
      via: 'menu',
      span: { start: 0, end: 5, draftRev: 1 },
    })).toEqual({
      insert: { source: '功能', ref: 'computer-use', label: '@电脑操控', clipboardText: '@电脑操控' },
    })
    const signal = new AbortController().signal
    expect(registered?.codec?.serialize('computer-use', signal)).resolves.toBe('@电脑操控')
    expect(readFileSync('src/client/home.module.css', 'utf8')).toContain("font-family: 'DshChipCell', -apple-system")
  })

  it('uses the target input trigger and input-bar contracts without a parallel transport', async () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    const styles = readFileSync('src/client/home.module.css', 'utf8')
    expect(source).toContain("ctx.slots.inject('conversation.input.right'")
    expect(source).toContain("ctx.connection.rpc.call('/emate.mcpManage', 'active', {})")
    expect(source).toContain("name: '功能'")
    expect(source).toContain("label: '@电脑操控'")
    expect(source).not.toContain('<computer-use explicit="true">')
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|EventSource)\s*\(/u)
    await waitFor(() => expect(styles).toContain('[data-composer-card]'))
    expect(styles).toMatch(/\[data-phase='hero'\][\s\S]*?\[data-composer-card\][\s\S]*?--emate-composer-frame-bottom:\s*-28px/u)
    expect(styles).toMatch(/\[data-phase='hero'\][\s\S]*?\[data-composer-card\][\s\S]*?--emate-composer-frame-radius:\s*24px/u)
  })
})
