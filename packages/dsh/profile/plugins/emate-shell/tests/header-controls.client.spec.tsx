// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'
import { SlotTestRuntime } from '../../../../../../upstream/deepseek-harness/packages/test-support/client-runtime/lib/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeaderControls } from '../src/client/header-controls.tsx'
import { registerHeaderControls } from '../src/client/index.ts'

const Icon = () => <svg />

afterEach(() => {
  cleanup()
  delete document.body.dataset.dshDesktopMode
})

describe('desktop header controls', () => {
  it('moves status, theme, native settings, and account controls into the Desktop title strip', () => {
    document.body.dataset.dshDesktopMode = 'advanced'
    const toggleTheme = vi.fn()
    const renderSlot = vi.fn((name: string) => name === 'sidebar.settings'
      ? <button type="button" data-emate-settings-trigger="" aria-label="打开设置"><Icon /></button>
      : null)

    render(<HeaderControls
      renderSlot={renderSlot}
      getThemeScheme={() => 'dark'}
      subscribeTheme={() => () => {}}
      toggleTheme={toggleTheme}
      LightIcon={Icon}
      DarkIcon={Icon}
      UserIcon={Icon}
      callIdentity={async () => ({ ok: false })}
    />)

    expect(screen.getByRole('status', { name: '运行时已连接' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切换到明亮模式' }))
    expect(toggleTheme).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '打开设置' })).toBeTruthy()
    expect(screen.getByLabelText('用户中心，未登录')).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith('sidebar.settings', { wide: false })
  })

  it('keeps its own controls on the same 32px center line as Share', () => {
    const controls = readFileSync('src/client/header-controls.module.css', 'utf8')
    const share = readFileSync('src/client/session-share.module.css', 'utf8')
    expect(controls).toMatch(/display:\s*inline-flex[\s\S]*height:\s*32px/u)
    expect(share.match(/top:\s*1px/gu)).toHaveLength(2)
    expect(share).toMatch(/\.trigger\s*\{[\s\S]*?height:\s*32px/u)
  })

  it('assembles through the real Desktop titlebar slot with the settings child declared', async () => {
    type RootProps = { renderSlot: (name: string, props: object) => ReactNode }
    const Root = ({ renderSlot }: RootProps) => <>{renderSlot('desktop.titlebar.utilities', {})}</>
    const runtime = await SlotTestRuntime.create()
    runtime.provide('theme', {
      getTheme: () => ({ active: { colorScheme: 'dark' } }),
      setTheme: vi.fn(),
    } as never)
    runtime.provide('connection', {
      rpc: { call: vi.fn(async () => ({ ok: false })) },
    } as never)
    await runtime.root.declare({
      'desktop.titlebar.utilities': { kind: 'list', scope: 'session-maybe' },
    } as never, Root as never)
    await runtime.mount({ inject: ['slots', 'theme', 'connection'], apply: registerHeaderControls })
    runtime.slots.register({ name: 'sidebar.settings' } as never, () => (
      <button type="button" data-emate-settings-trigger="">打开设置</button>
    ))
    document.body.dataset.dshDesktopMode = 'advanced'

    const view = runtime.renderRoot()
    expect(view.getByRole('button', { name: '打开设置' })).toBeTruthy()
    expect(view.container.querySelector('[data-emate-header-controls]')).not.toBeNull()
    await runtime.dispose()
  })
})
