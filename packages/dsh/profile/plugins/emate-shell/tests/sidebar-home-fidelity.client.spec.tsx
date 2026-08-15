// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeProjection } from '../src/client/home.tsx'
import { SidebarRoot } from '../src/client/sidebar.tsx'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  history.replaceState(null, '', '/')
})

const Icon = () => <svg />
const homeToolbarProps = {
  toggleSidebar: vi.fn(),
  openSettings: vi.fn(),
  getThemeScheme: () => 'light' as const,
  subscribeTheme: () => () => {},
  toggleTheme: vi.fn(),
  PanelIcon: Icon,
  LightIcon: Icon,
  DarkIcon: Icon,
  SettingsIcon: Icon,
}

describe('pinned e-Mate Sidebar and Home projection', () => {
  it('keeps the current Sidebar hierarchy while driving real session and workspace actions', async () => {
    const sessions = {
      ids: ['project-session', 'general-session'],
      byId: {
        'project-session': { id: 'project-session', displayTitle: '项目任务', running: false, blank: false, updatedAt: 2 },
        'general-session': { id: 'general-session', displayTitle: '通用任务', running: true, blank: false, updatedAt: 1 },
      },
      current: 'general-session',
      phase: 'ready' as const,
    }
    const workspaces = {
      items: [
        { workspaceId: 'workspace-1', path: '/work/quarterly', title: '季度报告', sessionIds: ['project-session'] },
        { workspaceId: 'workspace-general', path: '/home/test/.dsh/e-mate/general', title: '通用会话', sessionIds: ['general-session'] },
      ],
      archivedSessionIds: [],
      phase: 'ready' as const,
    }
    const startSession = vi.fn()
    const openSession = vi.fn()
    const openSchedules = vi.fn()
    const pickWorkspace = vi.fn(async () => 'workspace-1')

    render(<SidebarRoot
      collapsed={false}
      width={248}
      renderSlot={(name) => name === 'sidebar.primary.action' ? <button type="button">能力中心</button> : null}
      createPortal={createPortal}
      useSessions={selector => selector(sessions)}
      useWorkspaces={selector => selector(workspaces)}
      NewChatIcon={Icon}
      PanelIcon={Icon}
      SearchIcon={Icon}
      ScheduleIcon={Icon}
      ChevronIcon={Icon}
      FolderIcon={Icon}
      PlusIcon={Icon}
      EllipsisIcon={Icon}
      CopyIcon={Icon}
      EditIcon={Icon}
      ArchiveIcon={Icon}
      CloseIcon={Icon}
      startSession={startSession}
      openSchedules={openSchedules}
      openSession={openSession}
      pickWorkspace={pickWorkspace}
      renameSession={async () => {}}
      archiveSession={async () => {}}
      toggleSidebar={() => {}}
    />)

    expect(screen.getByRole('button', { name: '新建任务' }).textContent).toContain('新任务')
    expect(screen.getByRole('button', { name: '新建任务' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: '定时任务' }))
    expect(openSchedules).toHaveBeenCalledOnce()
    expect(screen.getByRole('region', { name: '项目' }).textContent).toContain('季度报告')
    expect(screen.getByRole('region', { name: '项目' }).textContent).not.toContain('通用会话')
    expect(screen.getByRole('region', { name: '会话' }).textContent).toContain('通用任务')
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    expect(startSession).toHaveBeenCalledWith()
    fireEvent.click(screen.getByRole('button', { name: '打开任务：通用任务' }))
    expect(openSession).toHaveBeenCalledWith('general-session')
    const taskMenu = screen.getByLabelText('管理任务：通用任务').closest('details')!
    fireEvent.click(screen.getByLabelText('管理任务：通用任务'))
    fireEvent.click(within(taskMenu).getByRole('button', { name: '重命名' }))
    expect(screen.getByRole('dialog', { name: '重命名任务' }).getAttribute('aria-modal')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '添加项目文件夹' }))
    await waitFor(() => { expect(startSession).toHaveBeenCalledWith('workspace-1') })
  })

  it('uses current e-Mate Home copy and projects durable token/session facts', async () => {
    const phase = document.createElement('main')
    phase.dataset.phase = 'hero'
    const overlay = document.createElement('div')
    overlay.dataset.chainOverlayFallback = 'conversation.composer'
    const target = document.createElement('div')
    overlay.append(target)
    phase.append(overlay)
    document.body.append(phase)
    const openSession = vi.fn()
    const state = {
      ids: ['session-1'],
      byId: {
        'session-1': {
          id: 'session-1',
          displayTitle: '真实任务',
          running: false,
          completed: true,
          blank: false,
          updatedAt: Date.now(),
          projectionValues: {
            tokenUsage: { uncachedInputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40 },
          },
        },
      },
      current: undefined,
    }

    render(<HomeProjection
      {...homeToolbarProps}
      useSessions={selector => selector(state)}
      openSession={openSession}
      prepareSchedulePrompt={async () => {}}
      scheduleIcons={{ create: Icon, list: Icon, edit: Icon, run: Icon, pause: Icon, resume: Icon, delete: Icon }}
    />)
    await waitFor(() => { expect(screen.getByRole('heading', { name: '今日使用概览' })).not.toBeNull() })
    expect(screen.getByRole('heading', { name: '和小芯一起开始工作吧' })).not.toBeNull()
    expect(screen.getByText('Token 消耗量').parentElement?.textContent).toContain('100')
    expect(screen.getByRole('heading', { name: '任务趋势（近 7 天）' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '切换任务导航' }))
    fireEvent.click(screen.getByRole('button', { name: '切换到暗色模式' }))
    fireEvent.click(screen.getByRole('button', { name: '打开设置' }))
    expect(homeToolbarProps.toggleSidebar).toHaveBeenCalled()
    expect(homeToolbarProps.toggleTheme).toHaveBeenCalled()
    expect(homeToolbarProps.openSettings).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /真实任务/u }))
    expect(openSession).toHaveBeenCalledWith('session-1')
  })

  it('mounts the pinned schedule actions and writes the selected prompt through the target composer action', async () => {
    history.replaceState(null, '', '/schedules')
    const phase = document.createElement('main')
    phase.dataset.phase = 'active'
    document.body.append(phase)
    const prepareSchedulePrompt = vi.fn(async () => {})
    const state = { ids: [], byId: {}, current: undefined }

    render(<HomeProjection
      {...homeToolbarProps}
      useSessions={selector => selector(state)}
      openSession={() => {}}
      prepareSchedulePrompt={prepareSchedulePrompt}
      scheduleIcons={{ create: Icon, list: Icon, edit: Icon, run: Icon, pause: Icon, resume: Icon, delete: Icon }}
    />)

    await waitFor(() => { expect(screen.getByRole('heading', { name: '定时任务' })).not.toBeNull() })
    expect(screen.getAllByRole('button').filter(button => button.querySelector('strong'))).toHaveLength(7)
    fireEvent.click(screen.getByRole('button', { name: /创建定时任务/u }))
    await waitFor(() => {
      expect(prepareSchedulePrompt).toHaveBeenCalledWith('请帮我创建一个定时任务。先向我确认执行时间、任务内容和发送通道，再调用定时任务能力保存：')
    })
  })

  it('keeps schedule prompt handoff on the target workspace/session/input path', () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    const home = readFileSync('src/client/home.tsx', 'utf8')
    const styles = readFileSync('src/client/home.module.css', 'utf8')
    expect(source).toMatch(/ctx\.workspaces\.pickDirectory\(\)/u)
    expect(source).toMatch(/ctx\.workspaces\.create\(\{ path \}\)/u)
    expect(source).toMatch(/ctx\.workspaces\.connectWorkspace\(workspace\.workspaceId\)/u)
    expect(source).toMatch(/ctx\.sessions\.scope\(sessionId\)/u)
    expect(source).toMatch(/ctx\.conversation\.input\.for\(scope\)\.setDraft\(prompt\)/u)
    expect(source).toMatch(/ctx\.sessions\.open\(sessionId\)/u)
    expect(source).toMatch(/ctx\.workspaces\.list\.getSnapshot\(\)\.items\.find\(isGeneralWorkspace\)/u)
    expect(source).toMatch(/workspaceId === undefined && \['\/capabilities', '\/settings', '\/schedules'\]\.includes\(location\.pathname\)[\s\S]*?history\.pushState\(null, '', '\/'\)[\s\S]*?dispatchEvent\(new PopStateEvent\('popstate'\)\)[\s\S]*?return[\s\S]*?ctx\.workspaces\.startSession\(target\)/u)
    expect(source).toMatch(/ctx\.layout\.toggleSidebar\(\)/u)
    expect(source).toMatch(/ctx\.theme\.getTheme\(\)\.active\.colorScheme/u)
    expect(source).toMatch(/ctx\.theme\.setTheme\(/u)
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|EventSource)\s*\(/u)
    expect(styles).toMatch(/:global\(\[data-slot='conversation'\] > div\[data-phase\]\)\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;/u)
    expect(styles).toContain('--dsw-alias-button-info-fill: var(--emate-color-brand);')
    expect(home).not.toMatch(/Runtime Scheduler|由 Runtime|从 Runtime/u)
  })

  it('keeps the target mobile session title clear of the real sidebar trigger', () => {
    const styles = readFileSync('src/client/sidebar.module.css', 'utf8')
    expect(styles).toMatch(/@media \(max-width: 767px\) \{[\s\S]*?div\[data-sidebar-collapsed\]:has\(> \[data-shell-overlay\]\) \[data-slot='conversation\.session\.header'\] > header\) \{[\s\S]*?padding-left: 64px;/u)
    expect(styles).toMatch(/\[data-slot='conversation\.session\.header'\] > header > div:first-child\) \{[\s\S]*?min-height: 44px;/u)
    expect(styles).toMatch(/\.mobileOpen \{[\s\S]*?left: 12px;[\s\S]*?width: 44px;[\s\S]*?height: 44px;/u)
  })
})
