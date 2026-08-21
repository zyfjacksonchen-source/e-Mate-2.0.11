// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import * as SessionLogExport from '../../../../../../upstream/deepseek-harness/packages/session-query/session-log-export/src/client/index.ts'
import { inject, registerSessionShare } from '../src/client/index.ts'
import { SessionShareAction } from '../src/client/session-share.tsx'

afterEach(cleanup)

describe('session share plugin', () => {
  it('starts the native Session ZIP export without opening an unavailable public-share surface', () => {
    const requestDownload = vi.fn(async () => {})
    const dismissDownload = vi.fn()
    render(<SessionShareAction
      sessionId="session-207"
      useSessionLogDownload={selector => selector({ bySession: {} })}
      requestDownload={requestDownload}
      dismissDownload={dismissDownload}
    />)

    fireEvent.click(screen.getByRole('button', { name: '导出当前任务' }))
    expect(requestDownload).toHaveBeenCalledWith('session-207')
    expect(screen.queryByText('分享服务不可用')).toBeNull()
  })

  it('projects the existing Session export state without a second transport or store', () => {
    const requestDownload = vi.fn(async () => {})
    const dismissDownload = vi.fn()
    render(<SessionShareAction
      sessionId="session-207"
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
    expect(source).toContain('ctx.sessionLogDownload.download(sessionId)')
    expect(manifest.dsh.client.inject).toContain('@deepseek-ai/dsh-session-log-export')
    expect(component).not.toMatch(/\bcallShare\s*\(/u)
    expect(`${source}\n${component}`).not.toMatch(/\b(?:fetch|WebSocket|EventSource|createSnapshotStore|defineStore)\s*\(/u)
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
      requestDownload: (sessionId: string) => Promise<void>
    })()
    expect(face.hooks.sessionLogDownload).toBe(ctx.sessionLogDownload.store)
    await expect(face.requestDownload('session-boot')).resolves.toBeUndefined()
    expect(ctx.sessionLogDownload.store.getSnapshot().bySession['session-boot']?.status).toBe('error')

    await ctx.fiber.dispose()
  })
})
