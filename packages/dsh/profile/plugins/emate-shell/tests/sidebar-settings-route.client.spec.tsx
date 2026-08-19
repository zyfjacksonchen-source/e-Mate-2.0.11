// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarRoot } from '../src/client/sidebar.tsx'

const sessionState = {
  ids: [], byId: {}, current: undefined, phase: 'ready' as const,
}
const workspaceState = {
  items: [], archivedSessionIds: [], phase: 'ready' as const,
}

function dataProps(Icon: () => React.JSX.Element) {
  return {
    useSessions: <T,>(selector: (state: typeof sessionState) => T) => selector(sessionState),
    useWorkspaces: <T,>(selector: (state: typeof workspaceState) => T) => selector(workspaceState),
    SearchIcon: Icon,
    ScheduleIcon: Icon,
    ChevronIcon: Icon,
    FolderIcon: Icon,
    PlusIcon: Icon,
    EllipsisIcon: Icon,
    CopyIcon: Icon,
    EditIcon: Icon,
    ArchiveIcon: Icon,
    CloseIcon: Icon,
    getThemeScheme: () => 'light' as const,
    subscribeTheme: () => () => {},
    toggleTheme: () => {},
    LightIcon: Icon,
    DarkIcon: Icon,
    openSession: () => {},
    openSchedules: () => {},
    pickWorkspace: async () => null,
    renameSession: async () => {},
    archiveSession: async () => {},
  }
}

afterEach(() => {
  cleanup()
  document.querySelectorAll('[data-emate-identity-gate], [data-emate-settings-content], [data-emate-settings-trigger]')
    .forEach(element => { element.remove() })
  vi.unstubAllGlobals()
  history.replaceState(null, '', '/')
})

describe('mobile settings route', () => {
  it('runs from the mounted sidebar, waits for identity, rearms after target UI disappears, and stops off-route', async () => {
    history.replaceState(null, '', '/settings')
    const identityGate = document.createElement('main')
    identityGate.dataset.emateIdentityGate = 'agreement'
    document.body.append(identityGate)
    const hiddenSettingsTrigger = document.createElement('button')
    hiddenSettingsTrigger.dataset.emateSettingsTrigger = ''
    vi.spyOn(hiddenSettingsTrigger, 'getClientRects').mockReturnValue({ length: 0 } as DOMRectList)
    document.body.append(hiddenSettingsTrigger)
    const hiddenSettingsContent = document.createElement('div')
    hiddenSettingsContent.dataset.emateSettingsContent = ''
    vi.spyOn(hiddenSettingsContent, 'getClientRects').mockReturnValue({ length: 0 } as DOMRectList)
    document.body.append(hiddenSettingsContent)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const toggleSidebar = vi.fn()
    const Icon = () => <svg />

    render(<SidebarRoot
      {...dataProps(Icon)}
      collapsed
      width={0}
      renderSlot={() => null}
      createPortal={createPortal}
      NewChatIcon={Icon}
      PanelIcon={Icon}
      startSession={() => {}}
      toggleSidebar={toggleSidebar}
    />)
    const mobileOpen = document.querySelector<HTMLButtonElement>('[data-emate-mobile-open]')
    expect(mobileOpen).not.toBeNull()
    vi.spyOn(mobileOpen!, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    const domClick = vi.spyOn(mobileOpen!, 'click')

    const documentQuery = vi.spyOn(document, 'querySelector')
    const token = document.createElement('span')
    document.body.append(token)
    await act(async () => { await Promise.resolve() })
    expect(documentQuery).not.toHaveBeenCalled()
    documentQuery.mockRestore()
    token.remove()

    act(() => { dispatchEvent(new Event('resize')) })
    expect(toggleSidebar).not.toHaveBeenCalled()
    identityGate.remove()
    await waitFor(() => { expect(toggleSidebar).toHaveBeenCalledTimes(1) })
    expect(domClick).not.toHaveBeenCalled()

    const settingsContent = document.createElement('div')
    settingsContent.dataset.emateSettingsContent = ''
    vi.spyOn(settingsContent, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    document.body.append(settingsContent)
    await act(async () => { await Promise.resolve() })
    settingsContent.remove()
    await waitFor(() => { expect(toggleSidebar).toHaveBeenCalledTimes(2) })
    expect(domClick).not.toHaveBeenCalled()

    const settingsTrigger = document.createElement('button')
    settingsTrigger.dataset.emateSettingsTrigger = ''
    vi.spyOn(settingsTrigger, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    document.body.append(settingsTrigger)
    await act(async () => { await Promise.resolve() })
    settingsTrigger.remove()
    await waitFor(() => { expect(toggleSidebar).toHaveBeenCalledTimes(3) })
    expect(domClick).not.toHaveBeenCalled()

    history.pushState(null, '', '/')
    act(() => { dispatchEvent(new PopStateEvent('popstate')) })
    act(() => { dispatchEvent(new Event('resize')) })
    expect(toggleSidebar).toHaveBeenCalledTimes(3)
    hiddenSettingsTrigger.remove()
    hiddenSettingsContent.remove()
  })

  it('rechecks a no-op target toggle on the next frame and stops after target UI becomes visible', async () => {
    history.replaceState(null, '', '/settings')
    const hiddenSettingsContent = document.createElement('div')
    hiddenSettingsContent.dataset.emateSettingsContent = ''
    vi.spyOn(hiddenSettingsContent, 'getClientRects').mockReturnValue({ length: 0 } as DOMRectList)
    document.body.append(hiddenSettingsContent)
    const frames = new Map<number, FrameRequestCallback>()
    let nextFrame = 0
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      nextFrame += 1
      frames.set(nextFrame, callback)
      return nextFrame
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id) }))
    const visibleSettingsContent = document.createElement('div')
    visibleSettingsContent.dataset.emateSettingsContent = ''
    vi.spyOn(visibleSettingsContent, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
    const toggleSidebar = vi.fn(() => {
      if (toggleSidebar.mock.calls.length === 2) document.body.append(visibleSettingsContent)
    })
    const Icon = () => <svg />

    render(<SidebarRoot
      {...dataProps(Icon)}
      collapsed
      width={0}
      renderSlot={() => null}
      createPortal={createPortal}
      NewChatIcon={Icon}
      PanelIcon={Icon}
      startSession={() => {}}
      toggleSidebar={toggleSidebar}
    />)
    const mobileOpen = document.querySelector<HTMLButtonElement>('[data-emate-mobile-open]')
    expect(mobileOpen).not.toBeNull()
    vi.spyOn(mobileOpen!, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)

    const firstFrame = frames.values().next().value
    expect(firstFrame).toBeTypeOf('function')
    frames.clear()
    act(() => { firstFrame!(0) })
    expect(toggleSidebar).toHaveBeenCalledTimes(1)
    const retryFrame = frames.values().next().value
    expect(retryFrame).toBeTypeOf('function')
    frames.clear()
    act(() => { retryFrame!(16) })
    expect(toggleSidebar).toHaveBeenCalledTimes(2)
    await waitFor(() => { expect(frames.size).toBe(0) })
    expect(toggleSidebar).toHaveBeenCalledTimes(2)

  })
})
