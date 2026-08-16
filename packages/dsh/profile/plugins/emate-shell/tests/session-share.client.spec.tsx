// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionShareAction } from '../src/client/session-share.tsx'

afterEach(cleanup)

describe('session share plugin', () => {
  it('mounts the 2.0.5 share affordance and exposes the truthful unavailable boundary', async () => {
    const callShare = vi.fn(async () => ({
      ok: true,
      value: {
        schema_version: 1,
        ready: false,
        blocker: 'public-share-provider-not-configured',
      },
    }))
    render(<SessionShareAction sessionId="session-207" callShare={callShare} />)

    fireEvent.click(screen.getByRole('button', { name: '分享当前任务' }))
    expect(await screen.findByRole('dialog', { name: '分享任务' })).toBeTruthy()
    await waitFor(() => { expect(screen.getByText('分享服务不可用')).toBeTruthy() })
    expect(screen.getByText(/本地会话归档/u)).toBeTruthy()
    expect(callShare).toHaveBeenCalledWith('status', {})
    fireEvent.click(screen.getByRole('button', { name: '关闭分享' }))
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: '分享任务' })).toBeNull() })
  })

  it('registers only through the target session utility slot and Connection RPC', () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    const component = readFileSync('src/client/session-share.tsx', 'utf8')
    expect(source).toContain("ctx.slots.inject('conversation.session.header.utilities'")
    expect(source).toContain("ctx.connection.rpc.call('/emate.share', endpoint, payload)")
    expect(`${source}\n${component}`).not.toMatch(/\b(?:fetch|WebSocket|EventSource)\s*\(/u)
  })
})
