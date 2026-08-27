// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.tsx'

type RpcResult = { ok: boolean; value?: unknown; error?: { message?: string } }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const listing = (path: string, entries: Array<{ name: string; kind: 'directory' | 'file' }>): RpcResult => ({
  ok: true,
  value: { schema_version: 1, kind: 'project', path, entries },
})

afterEach(cleanup)

describe('session-owned project files', () => {
  it('rejects stale success, rejection, first-frame state, and detached rows after a session switch', async () => {
    const alphaRoot = deferred<RpcResult>()
    const alphaDirectory = deferred<RpcResult>()
    const alphaRead = deferred<RpcResult>()
    const alphaRefresh = deferred<RpcResult>()
    const betaRoot = deferred<RpcResult>()
    let alphaLists = 0
    const callSidebar = vi.fn((endpoint: string, payload: Record<string, unknown>) => {
      if (payload.session_id === 'alpha' && endpoint === 'list') return [alphaRoot, alphaDirectory, alphaRefresh][alphaLists++]!.promise
      if (payload.session_id === 'alpha' && endpoint === 'read') return alphaRead.promise
      if (payload.session_id === 'beta' && endpoint === 'list') return betaRoot.promise
      throw new Error('unexpected sidebar call')
    })
    let View!: ComponentType<any>
    apply({
      slots: {
        inject(_name: string, register: () => void) { register() },
        register(_definition: unknown, component: ComponentType<any>) { View = component; return () => {} },
      },
      connection: { rpc: { call: callSidebar } },
    } as never)

    const view = render(<View sessionId="alpha" callSidebar={callSidebar} />)
    await act(async () => { alphaRoot.resolve(listing('', [{ name: 'old-dir', kind: 'directory' }])) })
    fireEvent.click(await screen.findByRole('button', { name: /old-dir/u }))
    await act(async () => { alphaDirectory.resolve(listing('old-dir', [{ name: 'old.txt', kind: 'file' }])) })
    const oldRow = await screen.findByRole('button', { name: /old\.txt/u })
    expect(screen.getByText('old-dir')).toBeTruthy()
    fireEvent.click(oldRow)
    await waitFor(() => expect(callSidebar).toHaveBeenCalledWith('read', { session_id: 'alpha', path: 'old-dir/old.txt' }))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(alphaLists).toBe(3))

    view.rerender(<View sessionId="beta" callSidebar={callSidebar} />)
    expect(screen.queryByText('old-dir')).toBeNull()
    expect(screen.queryByText('old.txt')).toBeNull()
    const callsAfterSwitch = callSidebar.mock.calls.length
    fireEvent.click(oldRow)
    expect(callSidebar).toHaveBeenCalledTimes(callsAfterSwitch)

    await act(async () => {
      alphaRead.resolve({ ok: true, value: { schema_version: 1, kind: 'file', path: 'old-dir/old.txt', content: 'old preview' } })
      alphaRefresh.reject(new Error('old session failed'))
    })
    expect(screen.queryByText('old preview')).toBeNull()
    expect(screen.queryByText('old session failed')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('正在读取项目文件…')

    await act(async () => { betaRoot.resolve(listing('', [{ name: 'new.txt', kind: 'file' }])) })
    expect(await screen.findByRole('button', { name: /new\.txt/u })).toBeTruthy()
    expect(screen.queryByText('old-dir')).toBeNull()
    expect(screen.queryByText('old.txt')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
