// @vitest-environment jsdom
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply as applyHost } from '../src/index.ts'
import {
  decodeMessageFlowSettings,
  MessageModeSettings,
  registerMessageModeSettings,
} from '../src/client/message-mode-settings.tsx'

vi.mock('node:fs', () => {
  const readFileSync = () => Buffer.from('')
  return { default: { readFileSync }, readFileSync }
})

afterEach(cleanup)

function scope(initial: unknown, status = 'ready') {
  let snapshot = { status, value: initial, writable: true }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: vi.fn(async (_field: string, value: unknown) => {
      snapshot = { ...snapshot, value: { messageFlowMode: value } }
      for (const listener of listeners) listener()
    }),
    unset: vi.fn(async () => {}),
  }
}

describe('native message-flow setting', () => {
  it('registers one Host schema whose default and damaged-value fallback are simple', () => {
    const registrations: { ns: unknown; schema: (value: unknown) => unknown }[] = []
    applyHost({
      inject: (_deps: string[], callback: (ctx: unknown) => void) => callback({
        settings: { register: (ns: unknown, schema: (value: unknown) => unknown) => { registrations.push({ ns, schema }) } },
      }),
      effect: (callback: () => unknown) => callback(),
      webServer: { register: () => () => {} },
    })

    expect(String(registrations[0]?.ns)).toBe('e-mate')
    expect(registrations[0]?.schema({})).toEqual({ messageFlowMode: 'simple' })
    expect(registrations[0]?.schema({ messageFlowMode: 'corrupt' })).toEqual({ messageFlowMode: 'simple' })
    expect(registrations[0]?.schema({ messageFlowMode: 'detailed' })).toEqual({ messageFlowMode: 'detailed' })
  })

  it('uses the Host-backed scope for restart restore and live changes', async () => {
    const persisted = scope({ messageFlowMode: 'detailed' })
    render(<MessageModeSettings scope={persisted as never} />)
    const select = screen.getByRole('combobox', { name: '消息显示模式' }) as HTMLSelectElement
    expect(select.value).toBe('detailed')

    fireEvent.change(select, { target: { value: 'simple' } })
    expect(persisted.set).toHaveBeenCalledWith('messageFlowMode', 'simple')
    expect(select.value).toBe('simple')
  })

  it('falls back before Host readiness and contributes one native General Settings row', async () => {
    expect(decodeMessageFlowSettings(undefined)).toEqual({ messageFlowMode: 'simple' })
    expect(decodeMessageFlowSettings({ messageFlowMode: 'broken' })).toEqual({ messageFlowMode: 'simple' })
    const loading = scope(undefined, 'loading')
    const view = render(<MessageModeSettings scope={loading as never} />)
    expect((screen.getByRole('combobox', { name: '消息显示模式' }) as HTMLSelectElement).disabled).toBe(true)
    view.unmount()

    const bound = scope({ messageFlowMode: 'simple' })
    const bind = vi.fn(() => bound)
    const registered: any[] = []
    registerMessageModeSettings({
      settingsScope: { bind },
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (options: unknown, component: unknown) => { registered.push({ options, component }); return () => {} },
      },
    })
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'e-mate' }))
    expect(registered[0]?.options).toMatchObject({ name: 'settings.general.item', id: 'message-flow-mode' })

    const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
    const source = readFileSync(resolve('src/client/message-mode-settings.tsx'), 'utf8')
    const index = readFileSync(resolve('src/client/index.ts'), 'utf8')
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/u)
    expect(index).toContain('ThinkingStatusBranding')
  })
})
