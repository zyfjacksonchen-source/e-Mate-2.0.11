// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import * as SessionLogExport from '../../../../../../upstream/deepseek-harness/packages/session-query/session-log-export/src/client/index.ts'
import { inject, registerSessionShare } from '../src/client/index.ts'
import { SessionShareAction } from '../src/client/session-share.tsx'

afterEach(cleanup)

describe('session share plugin', () => {
  it('creates, copies, and revokes a real online link through the Host RPC', async () => {
    const shareId = 'A'.repeat(32)
    const callShare = vi.fn(async (endpoint: string) => endpoint === 'list'
      ? { ok: true, value: { schema_version: 1, shares: [] } }
      : endpoint === 'create' ? {
        ok: true,
        value: {
          schema_version: 1,
          share_id: shareId,
          public_url: `https://share.example/s/${shareId}`,
          expires_at: '2030-08-21T00:00:00.000Z',
        },
      } : { ok: true, value: { schema_version: 1, revoked: true } })
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const requestDownload = vi.fn(async () => {})
    const dismissDownload = vi.fn()
    render(<SessionShareAction
      sessionId="session-207"
      callShare={callShare}
      useSessionLogDownload={selector => selector({ bySession: {} })}
      requestDownload={requestDownload}
      dismissDownload={dismissDownload}
    />)

    fireEvent.click(screen.getByRole('button', { name: '分享当前任务' }))
    expect(callShare).toHaveBeenCalledWith('list', { session_id: 'session-207' })
    fireEvent.click(await screen.findByRole('button', { name: '创建公开链接' }))
    await screen.findByRole('link', { name: `https://share.example/s/${shareId}` })
    expect(callShare).toHaveBeenCalledWith('create', { session_id: 'session-207' })

    fireEvent.click(screen.getByRole('button', { name: '复制链接 1' }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith(`https://share.example/s/${shareId}`) })
    expect(screen.getByRole('status').textContent).toBe('链接已复制。')

    fireEvent.click(screen.getByRole('button', { name: '撤销链接 1' }))
    await waitFor(() => { expect(callShare).toHaveBeenCalledWith('revoke', { share_id: shareId }) })
    expect((await screen.findByRole('status')).textContent).toBe('公开链接已撤销。')
    expect(screen.getByRole('button', { name: '创建公开链接' })).toBeTruthy()
  })

  it('reads an active link back after the component is recreated and can still revoke it', async () => {
    const shareId = 'R'.repeat(32)
    const callShare = vi.fn(async (endpoint: string) => endpoint === 'list'
      ? {
        ok: true,
        value: {
          schema_version: 1,
          shares: [{
            share_id: shareId,
            public_url: `https://share.example/s/${shareId}`,
            expires_at: '2030-08-21T00:00:00.000Z',
          }],
        },
      }
      : { ok: true, value: { schema_version: 1, revoked: true } })
    render(<SessionShareAction
      sessionId="session-restarted"
      callShare={callShare}
      useSessionLogDownload={selector => selector({ bySession: {} })}
      requestDownload={vi.fn()}
      dismissDownload={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '分享当前任务' }))
    await screen.findByRole('link', { name: `https://share.example/s/${shareId}` })
    expect(callShare).toHaveBeenCalledWith('list', { session_id: 'session-restarted' })
    fireEvent.click(screen.getByRole('button', { name: '撤销链接 1' }))
    await waitFor(() => { expect(callShare).toHaveBeenCalledWith('revoke', { share_id: shareId }) })
    expect(await screen.findByRole('button', { name: '创建公开链接' })).toBeTruthy()
  })

  it('recovers the server-side link when the create response is uncertain', async () => {
    const shareId = 'U'.repeat(32)
    let listCalls = 0
    const callShare = vi.fn(async (endpoint: string) => {
      if (endpoint === 'create') return { ok: false, error: { message: '创建响应中断。' } }
      listCalls += 1
      return {
        ok: true,
        value: {
          schema_version: 1,
          shares: listCalls === 1 ? [] : [{
            share_id: shareId,
            public_url: `https://share.example/s/${shareId}`,
            expires_at: '2030-08-21T00:00:00.000Z',
          }],
        },
      }
    })
    render(<SessionShareAction
      sessionId="session-uncertain"
      callShare={callShare}
      useSessionLogDownload={selector => selector({ bySession: {} })}
      requestDownload={vi.fn()}
      dismissDownload={vi.fn()}
    />)

    fireEvent.click(screen.getByRole('button', { name: '分享当前任务' }))
    fireEvent.click(await screen.findByRole('button', { name: '创建公开链接' }))
    await screen.findByRole('link', { name: `https://share.example/s/${shareId}` })
    expect(screen.getByRole('status').textContent).toBe('已从服务恢复公开链接。')
  })

  it('keeps native Session ZIP export as a separate local backup action', () => {
    const requestDownload = vi.fn(async () => {})
    const dismissDownload = vi.fn()
    render(<SessionShareAction
      sessionId="session-207"
      callShare={vi.fn()}
      useSessionLogDownload={selector => selector({ bySession: {} })}
      requestDownload={requestDownload}
      dismissDownload={dismissDownload}
    />)

    fireEvent.click(screen.getByRole('button', { name: '分享当前任务' }))
    fireEvent.click(screen.getByRole('button', { name: '导出 ZIP' }))
    expect(requestDownload).toHaveBeenCalledWith('session-207')
    expect(screen.queryByRole('dialog', { name: '分享任务' })).toBeNull()
  })

  it('projects the existing Session export failure without a second client transport or store', () => {
    const requestDownload = vi.fn(async () => {})
    const dismissDownload = vi.fn()
    render(<SessionShareAction
      sessionId="session-207"
      callShare={vi.fn()}
      useSessionLogDownload={selector => selector({
        bySession: { 'session-207': { open: true, status: 'error', error: 'archive unavailable' } },
      })}
      requestDownload={requestDownload}
      dismissDownload={dismissDownload}
    />)

    expect(screen.getByRole('dialog', { name: '导出任务' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('archive unavailable')
    fireEvent.click(screen.getByRole('button', { name: '关闭导出' }))
    expect(dismissDownload).toHaveBeenCalledWith('session-207')
  })

  it('registers through the target session utility slot and native Session export controller', () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    const component = readFileSync('src/client/session-share.tsx', 'utf8')
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
    const registration = source.slice(
      source.indexOf("ctx.slots.inject('conversation.session.header.utilities'"),
      source.indexOf("ctx.slots.inject('conversation.input.right'"),
    )
    expect(source).toContain("ctx.slots.inject('conversation.session.header.utilities'")
    expect(source).toContain("id: 'session-log-download'")
    expect(registration).toContain('priority: -1')
    expect(registration).toContain("ctx.connection.rpc.call('/emate.share', endpoint, payload)")
    expect(source).toContain('ctx.sessionLogDownload.download(sessionId)')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-session-log-export')
    expect(component).toContain("callShare('create', { session_id: requestedSession })")
    expect(component).toContain("callShare('list', { session_id: requestedSession })")
    expect(component).toContain("callShare('revoke', { share_id: share.share_id })")
    expect(component).not.toMatch(/\b(?:fetch|WebSocket|EventSource|createSnapshotStore|defineStore)\s*\(/u)
  })

  it('boots with the target Session Export plugin and shadows its header action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: {
        'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      },
    } as never, () => null)
    ctx.provide('locale', { register: () => () => {} } as never)
    ctx.provide('connection', { rpc: { call: vi.fn() } } as never)
    await ctx.plugin(SessionLogExport).await()
    expect(inject).toContain('sessionLogDownload')
    const shareFiber = ctx.plugin({
      inject: inject.filter(service => ['slots', 'connection', 'sessionLogDownload'].includes(service)),
      apply: registerSessionShare,
    })
    await shareFiber.await()

    const entries = slots.entries('conversation.session.header.utilities')
    expect(entries).toHaveLength(2)
    expect(entries.map(entry => entry.options.priority ?? 0)).toEqual([-1, 0])
    expect(entries.map(entry => (entry.component as { name?: string }).name)).toContain('SessionLogDownloadHeaderAction')
    const winners = slots.entriesOfSlot('conversation.session.header.utilities')
    expect(winners).toHaveLength(1)
    expect(winners[0]?.component).toBe(SessionShareAction)
    expect((winners[0]?.component as { name?: string }).name).not.toBe('SessionLogDownloadHeaderAction')
    const face = (winners[0]?.inject as () => {
      hooks: { sessionLogDownload: unknown }
      callShare: (endpoint: string, payload: unknown) => Promise<unknown>
      requestDownload: (sessionId: string) => Promise<void>
    })()
    expect(face.hooks.sessionLogDownload).toBe(ctx.sessionLogDownload.store)
    await face.callShare('status', {})
    expect(ctx.connection.rpc.call).toHaveBeenCalledWith('/emate.share', 'status', {})
    await expect(face.requestDownload('session-boot')).resolves.toBeUndefined()
    expect(ctx.sessionLogDownload.store.getSnapshot().bySession['session-boot']?.status).toBe('error')

    await ctx.fiber.dispose()
  })
})
