// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime } from '../../../../../../upstream/deepseek-harness/packages/test-support/client-runtime/lib/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeaderControls } from '../src/client/header-controls.tsx'
import { registerHeaderControls, registerManagedPresetSurfaces } from '../src/client/index.ts'

const Icon = () => <svg />

afterEach(() => {
  cleanup()
  delete document.body.dataset.dshDesktopMode
})

describe('desktop header controls', () => {
  it('moves status, theme, and native settings into the Session header in compatibility mode', () => {
    const toggleTheme = vi.fn()
    const openSettings = vi.fn()

    render(<HeaderControls
      getThemeScheme={() => 'dark'}
      subscribeTheme={() => () => {}}
      toggleTheme={toggleTheme}
      openSettings={openSettings}
      LightIcon={Icon}
      DarkIcon={Icon}
      SettingsIcon={Icon}
    />)

    expect(screen.getByRole('status', { name: '运行时已连接' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切换到明亮模式' }))
    expect(toggleTheme).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
    expect(openSettings).toHaveBeenCalledOnce()
  })

  it('keeps its own controls on the same 32px center line as Share', () => {
    const controls = readFileSync('src/client/header-controls.module.css', 'utf8')
    const share = readFileSync('src/client/session-share.module.css', 'utf8')
    expect(controls).toMatch(/display:\s*inline-flex[\s\S]*height:\s*32px/u)
    expect(share.match(/top:\s*1px/gu)).toHaveLength(2)
    expect(share).toMatch(/\.trigger\s*\{[\s\S]*?height:\s*32px/u)
  })

  it('assembles across multiple DSH Sessions without redeclaring the root settings slot', async () => {
    type RootProps = PropsRenderSlots<'conversation.session.header.utilities'>
    const Root = ({ renderSlot, SessionProvider }: RootProps) => (
      <SessionProvider empty={() => null}>
        {() => renderSlot('conversation.session.header.utilities', {})}
      </SessionProvider>
    )
    const runtime = await SlotTestRuntime.create()
    runtime.provide('theme', {
      getTheme: () => ({ active: { colorScheme: 'dark' } }),
      setTheme: vi.fn(),
    } as never)
    await runtime.root.declare({
      'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
    } as never, Root as never)
    await runtime.mount({ inject: ['slots', 'theme'], apply: registerHeaderControls })
    runtime.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'session-share-fixture',
      order: -20,
      priority: -1,
    } as never, () => <button type="button">分享当前任务</button>)
    const view = runtime.renderRoot()
    await runtime.sessions.add({ id: 'header-session-1' })
    for (let index = 2; index <= 6; index++) {
      await runtime.sessions.add({ id: `header-session-${index}` }, { current: false })
    }
    const headerEntry = runtime.slots.entries('conversation.session.header.utilities')
      .find(entry => entry.options.id === 'e-mate-header-controls')
    const hiddenSettingsTrigger = document.createElement('button')
    hiddenSettingsTrigger.hidden = true
    hiddenSettingsTrigger.dataset.emateSettingsTrigger = ''
    const openSettings = vi.fn()
    hiddenSettingsTrigger.addEventListener('click', openSettings)
    view.container.append(hiddenSettingsTrigger)
    expect(headerEntry?.options.children).toBeUndefined()
    fireEvent.click(view.getByRole('button', { name: '打开设置' }))
    expect(openSettings).toHaveBeenCalledOnce()
    expect(view.getByRole('button', { name: '分享当前任务' })).toBeTruthy()
    expect(view.container.querySelector('[data-emate-header-controls]')).not.toBeNull()
    await runtime.dispose()
  })

  it('does not depend on the unreachable advanced Desktop titlebar slot', () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    expect(source).not.toContain("ctx.slots.inject('desktop.titlebar.utilities'")
  })

  it('shadows only the product-facing preset selectors while preserving the native preset plugin', async () => {
    type RootProps = PropsRenderSlots<
      'conversation.hero.agentPreset' | 'conversation.session.header.actions' | 'settings.general.item'
    >
    const Root = ({ renderSlot, SessionProvider }: RootProps) => <>
      {renderSlot('conversation.hero.agentPreset', {})}
      {renderSlot('settings.general.item', {})}
      <SessionProvider empty={() => null}>
        {() => renderSlot('conversation.session.header.actions', {})}
      </SessionProvider>
    </>
    const runtime = await SlotTestRuntime.create()
    await runtime.root.declare({
      'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'settings.general.item': { kind: 'list', scope: 'root' },
    } as never, Root as never)
    await runtime.mount({ inject: ['slots'], apply: registerManagedPresetSurfaces })
    runtime.slots.register({ name: 'conversation.hero.agentPreset' } as never, () => <span>标准模式</span>)
    runtime.slots.register({ name: 'settings.general.item', id: 'agent-preset' } as never, () => <span>Agent 预设</span>)
    await runtime.sessions.add({ id: 'preset-session' })
    runtime.slots.register({ name: 'conversation.session.header.actions', id: 'agent-preset' } as never, () => <span>标准模式</span>)
    const view = runtime.renderRoot()
    expect(view.queryByText('标准模式')).toBeNull()
    expect(view.queryByText('Agent 预设')).toBeNull()
    expect(runtime.slots.entries('conversation.hero.agentPreset')).toHaveLength(2)
    expect(runtime.slots.entries('settings.general.item')).toHaveLength(2)
    expect(runtime.slots.entries('conversation.session.header.actions')).toHaveLength(2)
    await runtime.dispose()
  })
})
