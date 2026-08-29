// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime } from '../../../../../../upstream/deepseek-harness/packages/test-support/client-runtime/lib/index.js'
import { WINDOWS_CAPTION_CONTROLS_WIDTH } from '../../../../../../desktop/e-mate-desktop/src/window-chrome.ts'
import type { DesktopUpdateBridge, DesktopUpdateState } from '../../../../../../desktop/e-mate-desktop/src/update-presentation.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeaderControls } from '../src/client/header-controls.tsx'
import { SettingsChrome } from '../src/client/settings-chrome.tsx'
import {
  registerHeaderControls,
  registerManagedPresetSurfaces,
  registerRouteScopedConversationHeader,
} from '../src/client/index.ts'

const Icon = () => <svg />

function updateBridge(initial?: DesktopUpdateState) {
  let state = initial
  const listeners = new Set<(state: DesktopUpdateState) => void>()
  const bridge: DesktopUpdateBridge = {
    runInteractiveUpdate: vi.fn(async () => {}),
    getState: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    cancel: vi.fn(() => true),
  }
  return {
    bridge,
    publish(next: DesktopUpdateState) { state = next; listeners.forEach(listener => { listener(next) }) },
  }
}

afterEach(() => {
  cleanup()
  delete document.body.dataset.dshDesktopMode
  history.replaceState(null, '', '/')
})

describe('desktop header controls', () => {
  it('renders only Share and theme as the root-frame controls', () => {
    const toggleTheme = vi.fn()
    const openSettings = vi.fn()
    const updates = updateBridge()
    history.replaceState(null, '', '/chat/session-1')

    render(<HeaderControls
      getThemeScheme={() => 'dark'}
      subscribeTheme={() => () => {}}
      toggleTheme={toggleTheme}
      useSessions={selector => selector({
        current: 'session-1', ids: ['session-1'],
        byId: { 'session-1': { id: 'session-1', blank: false } },
        subagentsByParent: {}, currentAddress: undefined,
      } as never)}
      callShare={vi.fn()}
      useSessionLogDownload={selector => selector({ bySession: {} })}
      requestDownload={vi.fn()}
      dismissDownload={vi.fn()}
      LightIcon={Icon}
      DarkIcon={Icon}
    />)

    const controls = screen.getByLabelText('应用工具')
    expect([...controls.querySelectorAll('button')].map(button => button.getAttribute('aria-label'))).toEqual([
      '分享当前任务',
      '切换到明亮模式',
    ])
    expect([...controls.querySelectorAll('button')].every(button => button.title === button.getAttribute('aria-label'))).toBe(true)
    expect(screen.queryByRole('status', { name: '运行时已连接' })).toBeNull()
    expect(screen.queryByRole('button', { name: '检查更新' })).toBeNull()
    expect(screen.queryByRole('button', { name: '打开设置' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '切换到明亮模式' }))
    expect(toggleTheme).toHaveBeenCalledOnce()
    expect(updates.bridge.runInteractiveUpdate).not.toHaveBeenCalled()
    expect(openSettings).not.toHaveBeenCalled()
  })

  it('keeps theme available and clear of the native Settings close control', () => {
    history.replaceState(null, '', '/settings')
    render(<HeaderControls
      getThemeScheme={() => 'light'} subscribeTheme={() => () => {}} toggleTheme={() => {}}
      useSessions={selector => selector({ current: undefined, ids: [], byId: {}, subagentsByParent: {}, currentAddress: undefined } as never)}
      callShare={vi.fn()} useSessionLogDownload={selector => selector({ bySession: {} })}
      requestDownload={vi.fn()} dismissDownload={vi.fn()}
      LightIcon={Icon} DarkIcon={Icon}
    />)

    expect(screen.getByLabelText('应用工具').hasAttribute('data-emate-settings-route')).toBe(true)
    expect(screen.getByRole('button', { name: '切换到暗色模式' })).not.toBeNull()
    const controls = readFileSync('src/client/header-controls.module.css', 'utf8')
    expect(controls).toMatch(/\.controls\[data-emate-settings-route\][\s\S]*right:\s*calc\(72px \+ var\(--dsh-desktop-caption-safe-width, 0px\)\)/u)
    expect(controls).toMatch(/body\[data-dsh-desktop-platform='win32'\][\s\S]*\.controls\[data-emate-settings-route\]/u)
  })

  it('projects one updater state into Header and Settings with progress, cancellation, and trigger errors', async () => {
    const updates = updateBridge()
    render(<>
      <HeaderControls
        getThemeScheme={() => 'light'} subscribeTheme={() => () => {}} toggleTheme={() => {}}
        useSessions={selector => selector({ current: undefined, ids: [], byId: {}, subagentsByParent: {}, currentAddress: undefined } as never)}
        callShare={vi.fn()} useSessionLogDownload={selector => selector({ bySession: {} })}
        requestDownload={vi.fn()} dismissDownload={vi.fn()}
        LightIcon={Icon} DarkIcon={Icon}
      />
      <SettingsChrome updates={updates.bridge} UpdateIcon={Icon} />
    </>)

    expect(screen.queryByRole('button', { name: '分享当前任务' })).toBeNull()
    expect(screen.getAllByRole('button', { name: '检查更新' })).toHaveLength(1)
    act(() => { updates.publish({ stage: 'available', version: '2.0.15' }) })
    const retry = screen.getByRole('button', { name: '再次检查更新（发现 2.0.15）' })
    fireEvent.click(retry)
    expect(updates.bridge.runInteractiveUpdate).toHaveBeenCalledOnce()
    expect(updates.bridge.cancel).not.toHaveBeenCalled()
    act(() => { updates.publish({ stage: 'downloading', version: '2.0.15', bytes: 25, total: 100 }) })
    expect(screen.getAllByRole('button', { name: '取消更新（25%）' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '取消更新（25%）' }))
    expect(updates.bridge.cancel).toHaveBeenCalledOnce()
    act(() => { updates.publish({ stage: 'staging', version: '2.0.15' }) })
    expect((screen.getByRole('button', { name: '准备更新中' }) as HTMLButtonElement).disabled).toBe(true)

    const failed = updateBridge()
    vi.mocked(failed.bridge.runInteractiveUpdate).mockRejectedValueOnce(new Error('更新服务不可用'))
    cleanup()
    render(<SettingsChrome updates={failed.bridge} UpdateIcon={Icon} />)
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
    expect((await screen.findByRole('alert')).textContent).toBe('更新服务不可用')
  })

  it('offers Share only for the nonblank top-level Session owned by the current route', () => {
    const props = {
      getThemeScheme: () => 'light' as const, subscribeTheme: () => () => {}, toggleTheme: () => {},
      callShare: vi.fn(), useSessionLogDownload: (selector: any) => selector({ bySession: {} }),
      requestDownload: vi.fn(), dismissDownload: vi.fn(),
      LightIcon: Icon, DarkIcon: Icon,
    }
    const state = {
      current: 'session-1', ids: ['session-1'], byId: { 'session-1': { id: 'session-1', blank: false } },
      subagentsByParent: {}, currentAddress: undefined,
    }
    history.replaceState(null, '', '/schedules')
    const view = render(<HeaderControls {...props} useSessions={selector => selector(state as never)} />)
    expect(view.queryByRole('button', { name: '分享当前任务' })).toBeNull()
    history.replaceState(null, '', '/chat/session-1')
    fireEvent.popState(window)
    expect(view.getByRole('button', { name: '分享当前任务' })).not.toBeNull()
    view.rerender(<HeaderControls {...props} useSessions={selector => selector({
      ...state, byId: { 'session-1': { id: 'session-1', blank: true } },
    } as never)} />)
    expect(view.queryByRole('button', { name: '分享当前任务' })).toBeNull()
  })

  it('keeps share inside the one aligned root-frame group without positional offsets', () => {
    const controls = readFileSync('src/client/header-controls.module.css', 'utf8')
    const share = readFileSync('src/client/session-share.module.css', 'utf8')
    const settings = readFileSync('src/client/settings-chrome.module.css', 'utf8')
    expect(controls).toMatch(/position:\s*absolute[\s\S]*top:\s*12px[\s\S]*right:\s*calc\(24px \+ var\(--dsh-desktop-caption-safe-width, 0px\)\)[\s\S]*display:\s*inline-flex[\s\S]*gap:\s*8px[\s\S]*height:\s*32px[\s\S]*-webkit-app-region:\s*no-drag/u)
    expect(controls).toMatch(/conversation\.session\.header[\s\S]*padding-right:\s*calc\(112px \+ var\(--dsh-desktop-caption-safe-width, 0px\)\)/u)
    expect(controls).toMatch(/@media \(max-width:\s*720px\)[\s\S]*right:\s*calc\(12px \+ var\(--dsh-desktop-caption-safe-width, 0px\)\)[\s\S]*padding-right:\s*calc\(104px \+ var\(--dsh-desktop-caption-safe-width, 0px\)\)/u)
    expect(controls).toMatch(/data-dsh-desktop-platform='win32'[\s\S]*top:\s*0;[\s\S]*right:\s*var\(--dsh-desktop-caption-safe-width, 0px\);[\s\S]*gap:\s*0;[\s\S]*color:\s*var\(--dsh-desktop-caption-symbol-color, #2f3337\);/u)
    expect(controls).toMatch(/data-dsh-desktop-platform='win32'[\s\S]*width:\s*var\(--dsh-desktop-caption-button-width, 46px\);[\s\S]*min-width:\s*var\(--dsh-desktop-caption-button-width, 46px\);[\s\S]*border-radius:\s*0;/u)
    expect(controls).toMatch(/data-dsh-desktop-platform='win32'[\s\S]*button svg[\s\S]*width:\s*var\(--dsh-desktop-caption-symbol-size, 12px\);[\s\S]*height:\s*var\(--dsh-desktop-caption-symbol-size, 12px\);/u)
    expect(controls).toMatch(/data-dsh-desktop-platform='win32'[\s\S]*padding-right:\s*calc\(116px \+ var\(--dsh-desktop-caption-safe-width, 0px\)\)/u)
    expect(controls).toMatch(/\.controls > button:focus-visible[\s\S]*outline:\s*2px solid[\s\S]*outline-offset:\s*2px/u)
    expect(controls).not.toMatch(/@media[\s\S]*\.controls > button\s*\{[^}]*display:\s*none/u)
    expect(settings).toMatch(/padding:\s*16px calc\(20px \+ var\(--dsh-desktop-caption-safe-width, 0px\)\) 16px 20px !important/u)
    expect(settings).toMatch(/button:has\(\[data-emate-settings-close\]\)[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/u)
    expect(settings).toMatch(/data-emate-settings-close\]\):focus-visible[\s\S]*outline-offset:\s*-2px/u)
    expect(`${controls}\n${settings}`).not.toContain('138')
    expect(share).toMatch(/\.trigger\s*\{[\s\S]*?height:\s*32px/u)
    expect(share).not.toMatch(/position:\s*fixed|translateY|top:\s*1px|right:\s*(?:72|210)px/u)
  })

  it('keeps every core control left of the native caption at the minimum window across 100/125/150 percent', () => {
    const minimumWindowWidth = 900
    const desktop = readFileSync('../../../../../desktop/e-mate-desktop/src/index.ts', 'utf8')
    const desktopStyles = readFileSync('../../../../../desktop/e-mate-desktop/src/client/styles.ts', 'utf8')
    expect(desktop).toContain(`minWidth: z.number().step(1).min(640).default(${minimumWindowWidth})`)
    expect(desktopStyles).toMatch(/--dsh-desktop-caption-safe-width: max\(\$\{WINDOWS_CAPTION_CONTROLS_WIDTH\}px, calc\(100vw - env\(titlebar-area-x, 0px\) - env\(titlebar-area-width, 100vw\)\)\);/u)

    for (const scale of [1, 1.25, 1.5]) {
      const viewport = minimumWindowWidth / scale
      const compact = viewport <= 720
      const groupWidth = 2 * 46
      const captionLeft = viewport - WINDOWS_CAPTION_CONTROLS_WIDTH
      const groupRight = captionLeft

      expect(groupRight).toBe(captionLeft)
      expect(groupRight - groupWidth - 4).toBeGreaterThanOrEqual(0)
      expect((compact ? 108 : 116) + WINDOWS_CAPTION_CONTROLS_WIDTH).toBeLessThan(viewport)
      expect(captionLeft - 20).toBeGreaterThan(44)
    }
  })

  it('stays mounted with no current Session and exposes only the global theme control', async () => {
    type RootProps = PropsRenderSlots<'shell.overlay'>
    const Root = ({ renderSlot }: RootProps) => renderSlot('shell.overlay', {})
    const runtime = await SlotTestRuntime.create()
    runtime.provide('theme', {
      getTheme: () => ({ active: { colorScheme: 'dark' } }),
      setTheme: vi.fn(),
    } as never)
    runtime.provide('connection', { rpc: { call: vi.fn() } } as never)
    runtime.provide('sessionLogDownload', {
      store: { getSnapshot: () => ({ bySession: {} }), subscribe: () => () => {} },
      download: vi.fn(),
      dismiss: vi.fn(),
    } as never)
    await runtime.root.declare({
      'shell.overlay': { kind: 'list', scope: 'root' },
    } as never, Root as never)
    await runtime.mount({ inject: ['slots', 'theme', 'connection', 'sessionLogDownload'], apply: registerHeaderControls })
    const view = runtime.renderRoot()
    const headerEntry = runtime.slots.entries('shell.overlay')
      .find(entry => entry.options.id === 'e-mate-header-controls')
    expect(headerEntry?.options.children).toBeUndefined()
    expect(runtime.sessions.list.getSnapshot().current).toBeUndefined()
    expect(view.getByRole('button', { name: '切换到明亮模式' })).not.toBeNull()
    expect(view.queryByRole('button', { name: '打开设置' })).toBeNull()
    expect(view.queryByRole('button', { name: '检查更新' })).toBeNull()
    expect(view.container.querySelector('[data-emate-header-controls]')).not.toBeNull()
    expect(view.queryByRole('button', { name: '分享当前任务' })).toBeNull()
    await runtime.dispose()
  })

  it('does not depend on the unreachable advanced Desktop titlebar slot', () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    expect(source).not.toContain("ctx.slots.inject('desktop.titlebar.utilities'")
    expect(source).toContain("ctx.slots.inject('shell.overlay'")
  })

  it('hides resident Session header chrome throughout standalone product routes', async () => {
    type RootProps = PropsRenderSlots<'conversation.session.header'>
    const Root = ({ renderSlot, SessionProvider }: RootProps) => (
      <SessionProvider empty={() => null}>
        {() => renderSlot('conversation.session.header', {})}
      </SessionProvider>
    )
    const runtime = await SlotTestRuntime.create()
    await runtime.root.declare({
      'conversation.session.header': { kind: 'single', scope: 'session' },
    } as never, Root as never)
    await runtime.sessions.add({ id: 'session-1' })
    runtime.slots.register({ name: 'conversation.session.header' } as never, () => <header>旧会话标题</header>)
    history.replaceState(null, '', '/schedules')
    await runtime.mount({ inject: ['slots'], apply: registerRouteScopedConversationHeader })
    const view = runtime.renderRoot()

    expect(view.queryByText('旧会话标题')).toBeNull()
    act(() => {
      history.pushState(null, '', '/capabilities')
      dispatchEvent(new PopStateEvent('popstate'))
    })
    await runtime.flush()
    expect(view.queryByText('旧会话标题')).toBeNull()
    act(() => {
      history.pushState(null, '', '/chat/session-1')
      dispatchEvent(new PopStateEvent('popstate'))
    })
    await runtime.flush()
    expect(view.queryByText('旧会话标题')).not.toBeNull()
    await runtime.dispose()
  })

  it('replaces the resident conversation with one route-owned standalone surface', async () => {
    type RootProps = PropsRenderSlots<'conversation'>
    const Root = ({ renderSlot }: RootProps) => renderSlot('conversation', {})
    const runtime = await SlotTestRuntime.create()
    const closeDetails = vi.fn()
    runtime.provide('layout', { closeDetails } as never)
    await runtime.root.declare({ conversation: { kind: 'single', scope: 'root' } } as never, Root as never)
    runtime.slots.register({ name: 'conversation' } as never, () => <main>旧会话正文与输入框</main>)
    history.replaceState(null, '', '/schedules')
    await runtime.mount({ inject: ['slots', 'layout'], apply: registerRouteScopedConversationHeader })
    const view = runtime.renderRoot()

    expect(view.queryByText('旧会话正文与输入框')).toBeNull()
    expect(view.container.querySelectorAll('[data-emate-product-surface]')).toHaveLength(1)
    expect(closeDetails).toHaveBeenCalledOnce()
    act(() => {
      history.pushState(null, '', '/chat/session-1')
      dispatchEvent(new PopStateEvent('popstate'))
    })
    await runtime.flush()
    expect(view.queryByText('旧会话正文与输入框')).not.toBeNull()
    expect(view.container.querySelector('[data-emate-product-surface]')).toBeNull()
    await runtime.dispose()
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
