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
const sidebarCss = readFileSync('src/client/sidebar.module.css', 'utf8')
const homeToolbarProps = {
  closeDetails: vi.fn(),
  toggleSidebar: vi.fn(),
  PanelIcon: Icon,
}
const sidebarUtilityProps = {
  getThemeScheme: () => 'light' as const,
  subscribeTheme: () => () => {},
  toggleTheme: vi.fn(),
  LightIcon: Icon,
  DarkIcon: Icon,
}

describe('pinned e-Mate Sidebar and Home projection', () => {
  it('keeps the current Sidebar hierarchy while driving real session and workspace actions', async () => {
    const sessions = {
      ids: ['project-session', 'general-session'],
      byId: {
        'project-session': { id: 'project-session', displayTitle: '项目任务', running: false, blank: false, updatedAt: 2 },
        'general-session': { id: 'general-session', displayTitle: '通用任务', running: true, blank: false, updatedAt: 1 },
      },
      current: undefined,
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
      renderSlot={(name) => name === 'sidebar.primary.action'
        ? <button type="button">能力中心</button>
        : name === 'sidebar.settings' ? <div data-slot="sidebar.settings"><button type="button" aria-hidden="true" tabIndex={-1} data-emate-settings-trigger="">打开设置</button></div>
          : name === 'sidebar.footer.action' ? <button type="button">用户中心</button> : null}
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
      {...sidebarUtilityProps}
    />)

    expect(screen.getByText('2.0.11')).not.toBeNull()
    expect(screen.getByRole('button', { name: '新建任务' }).textContent).toContain('新任务')
    expect(screen.getByRole('button', { name: '新建任务' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: '搜索会话' }))
    expect(screen.getByRole('textbox', { name: '搜索会话' }).getAttribute('type')).toBe('text')
    expect(screen.getAllByRole('button', { name: '关闭搜索' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '定时任务' }))
    expect(openSchedules).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status', { name: '运行时已连接' })).toBeNull()
    expect(screen.queryByRole('button', { name: '切换到暗色模式' })).toBeNull()
    expect(screen.queryByRole('button', { name: '打开设置' })).toBeNull()
    expect(document.querySelector('[data-emate-settings-trigger]')).not.toBeNull()
    expect(document.querySelector<HTMLElement>('[data-emate-settings-owner]')?.hidden).toBe(false)
    expect(sidebarCss).toMatch(/\.settingsOwner\s+:global\(button\[data-emate-settings-trigger\]\)[\s\S]*display:\s*none/u)
    expect(screen.getByRole('region', { name: '项目' }).textContent).toContain('季度报告')
    expect(screen.getByRole('region', { name: '项目' }).textContent).not.toContain('通用会话')
    expect(screen.getByRole('region', { name: '项目' }).getAttribute('data-dsh-workspace-drop-target')).toBe('')
    expect(screen.getByRole('region', { name: '会话' }).textContent).toContain('通用任务')
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    expect(startSession).toHaveBeenCalledWith()
    fireEvent.click(screen.getByRole('button', { name: '打开任务：通用任务' }))
    expect(openSession).toHaveBeenCalledWith('general-session')
    const taskMenu = screen.getByLabelText('管理任务：通用任务').closest('details')!
    fireEvent.click(screen.getByLabelText('管理任务：通用任务'))
    expect(taskMenu.open).toBe(true)
    fireEvent.pointerDown(document.body)
    expect(taskMenu.open).toBe(false)
    fireEvent.click(screen.getByLabelText('管理任务：通用任务'))
    fireEvent.click(within(taskMenu).getByRole('button', { name: '重命名' }))
    expect(screen.getByRole('dialog', { name: '重命名任务' }).getAttribute('aria-modal')).toBe('true')
    expect(sidebarCss).toContain('anchor-name: --emate-task-menu')
    expect(sidebarCss).toContain('position-anchor: --emate-task-menu')
    expect(sidebarCss).toContain('top: calc(anchor(bottom) + 4px)')
    expect(sidebarCss).toContain('right: anchor(right)')
    fireEvent.click(screen.getByRole('button', { name: '添加项目文件夹' }))
    await waitFor(() => { expect(startSession).toHaveBeenCalledWith('workspace-1') })
    history.pushState(null, '', '/chat/general-session')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await waitFor(() => { expect(screen.queryByRole('status', { name: '运行时已连接' })).toBeNull() })
    expect(screen.getByRole('button', { name: '用户中心' })).not.toBeNull()
  })

  it('batch-removes selected project and general sessions through the native archive action', async () => {
    const sessions = {
      ids: ['project-session', 'general-session'],
      byId: {
        'project-session': { id: 'project-session', displayTitle: '项目任务', running: false, blank: false, updatedAt: 2 },
        'general-session': { id: 'general-session', displayTitle: '通用任务', running: false, blank: false, updatedAt: 1 },
      },
      current: undefined,
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
    const archiveSession = vi.fn(async () => {})
    const openSession = vi.fn()

    render(<SidebarRoot
      collapsed={false}
      width={248}
      renderSlot={() => null}
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
      startSession={() => {}}
      openSchedules={() => {}}
      openSession={openSession}
      pickWorkspace={async () => null}
      renameSession={async () => {}}
      archiveSession={archiveSession}
      toggleSidebar={() => {}}
      {...sidebarUtilityProps}
    />)

    fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
    expect(screen.getByRole('checkbox', { name: '选择会话：项目任务' })).not.toBeNull()
    expect(screen.getByRole('checkbox', { name: '选择会话：通用任务' })).not.toBeNull()
    expect(screen.queryByRole('button', { name: '打开任务：通用任务' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: '删除（2）' }))
    expect(screen.getByRole('dialog', { name: '删除 2 个会话？' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => { expect(archiveSession).toHaveBeenCalledTimes(2) })
    expect(archiveSession.mock.calls.map(([id]) => id).sort()).toEqual(['general-session', 'project-session'])
    expect(screen.getByRole('status').textContent).toBe('已删除 2 个会话。')
    expect(openSession).not.toHaveBeenCalled()
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
      callSchedules={async () => ({ ok: true, value: { schema_version: 1, items: [], errors: [] } })}
      scheduleIcons={{ create: Icon, refresh: Icon, edit: Icon, delete: Icon }}
    />)
    await waitFor(() => { expect(screen.getByRole('heading', { name: '今日使用概览' })).not.toBeNull() })
    expect(homeToolbarProps.closeDetails).toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '和小芯一起开始工作吧' })).not.toBeNull()
    expect(screen.getByText('Token 消耗量').parentElement?.textContent).toContain('100')
    expect(screen.getByRole('heading', { name: '任务趋势（近 7 天）' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '切换任务导航' }))
    expect(homeToolbarProps.toggleSidebar).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /真实任务/u }))
    expect(openSession).toHaveBeenCalledWith('session-1')
  })

  it('localizes a blank session without pinning a title that blocks target auto naming', async () => {
    const renameSession = vi.fn(async () => {})
    const sessions = {
      ids: ['blank-session'],
      byId: {
        'blank-session': { id: 'blank-session', displayTitle: 'general', running: false, blank: true, updatedAt: 1 },
      },
      current: 'blank-session',
      phase: 'ready' as const,
    }
    const workspaces = {
      items: [{
        workspaceId: 'workspace-general', path: '/home/test/.dsh/e-mate/general',
        title: '通用会话', sessionIds: ['blank-session'],
      }],
      archivedSessionIds: [],
      phase: 'ready' as const,
    }

    render(<SidebarRoot
      collapsed={false}
      width={248}
      renderSlot={() => null}
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
      startSession={() => {}}
      openSchedules={() => {}}
      openSession={() => {}}
      pickWorkspace={async () => null}
      renameSession={renameSession}
      archiveSession={async () => {}}
      toggleSidebar={() => {}}
      {...sidebarUtilityProps}
    />)

    expect(screen.getByRole('button', { name: '打开任务：新会话' })).not.toBeNull()
    await waitFor(() => { expect(renameSession).not.toHaveBeenCalled() })
  })

  it('projects native schedules and writes create, edit, and delete prompts into their owning target sessions', async () => {
    history.replaceState(null, '', '/schedules')
    const phase = document.createElement('main')
    phase.dataset.phase = 'active'
    document.body.append(phase)
    const prepareSchedulePrompt = vi.fn(async () => {})
    const callSchedules = vi.fn(async () => ({ ok: true, value: {
      schema_version: 1,
      items: [{
        id: 'schedule-1', session_id: 'session-1', session_title: '日报会话', kind: 'every',
        prompt: '生成日报', everySeconds: 300, scheduledAt: '2099-08-19T12:00:00.000Z', state: 'scheduled',
      }],
      errors: [],
    } }))
    const state = { ids: [], byId: {}, current: undefined }

    render(<HomeProjection
      {...homeToolbarProps}
      useSessions={selector => selector(state)}
      openSession={() => {}}
      prepareSchedulePrompt={prepareSchedulePrompt}
      callSchedules={callSchedules}
      scheduleIcons={{ create: Icon, refresh: Icon, edit: Icon, delete: Icon }}
    />)

    await waitFor(() => { expect(screen.getByRole('heading', { name: '定时任务' })).not.toBeNull() })
    await waitFor(() => { expect(screen.getByText('生成日报')).not.toBeNull() })
    expect(callSchedules).toHaveBeenCalledOnce()
    expect(screen.getByText('日报会话')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '新任务' }))
    await waitFor(() => {
      expect(prepareSchedulePrompt).toHaveBeenCalledWith('请帮我创建一个定时任务。先向我确认执行时间和任务内容，再调用 schedule_create 保存。')
    })
    fireEvent.click(screen.getByRole('button', { name: '修改' }))
    await waitFor(() => { expect(prepareSchedulePrompt).toHaveBeenCalledWith(expect.stringContaining('schedule_create 创建替代任务'), 'session-1') })
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => { expect(prepareSchedulePrompt).toHaveBeenCalledWith(expect.stringContaining('schedule_delete'), 'session-1') })
  })

  it('keeps schedule prompt handoff on the target workspace/session/input path', () => {
    const source = readFileSync('src/client/index.ts', 'utf8')
    const home = readFileSync('src/client/home.tsx', 'utf8')
    const styles = readFileSync('src/client/home.module.css', 'utf8')
    expect(source).toMatch(/ctx\.workspaces\.pickDirectory\(\)/u)
    expect(source).toMatch(/ctx\.workspaces\.create\(\{ path \}\)/u)
    expect(source).toMatch(/ctx\.workspaces\.connectWorkspace\(workspace\.workspaceId\)/u)
    expect(source).toMatch(/ctx\.sessions\.scope\(sessionId\)/u)
    expect(source).toMatch(/ctx\.sessions\.scope\(requestedSessionId\)/u)
    expect(source).toMatch(/ctx\.conversation\.input\.for\(scope\)\.setDraft\(prompt\)/u)
    expect(source).toMatch(/ctx\.sessions\.open\(sessionId\)/u)
    expect(source).toMatch(/ctx\.workspaces\.list\.getSnapshot\(\)\.items\.find\(isGeneralWorkspace\)/u)
    expect(source).toMatch(/workspaceId === undefined && \['\/capabilities', '\/settings', '\/schedules'\]\.includes\(location\.pathname\)[\s\S]*?history\.pushState\(null, '', '\/'\)[\s\S]*?dispatchEvent\(new PopStateEvent\('popstate'\)\)[\s\S]*?return[\s\S]*?ctx\.workspaces\.startSession\(target\)/u)
    expect(source).toMatch(/ctx\.layout\.toggleSidebar\(\)/u)
    expect(source).toMatch(/ctx\.layout\.closeDetails\(\)/u)
    expect(source).toMatch(/ctx\.connection\.rpc\.call\('\/emate\.schedules', 'list', \{\}\)/u)
    expect(source).toMatch(/ctx\.theme\.getTheme\(\)\.active\.colorScheme/u)
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|EventSource)\s*\(/u)
    expect(styles).toMatch(/:global\(\[data-slot='conversation'\] > div\[data-phase\]\)\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;/u)
    expect(styles).toContain('--dsw-alias-button-info-fill: var(--emate-color-brand);')
    expect(styles).toMatch(/button:first-child > svg\) \{\s*display: none;/u)
    expect(styles).toMatch(/button:first-child::before\) \{\s*content: '\/';/u)
    expect(home).not.toMatch(/Runtime Scheduler|由 Runtime|从 Runtime/u)
  })

  it('keeps the target mobile session title clear of the real sidebar trigger', () => {
    const styles = readFileSync('src/client/sidebar.module.css', 'utf8')
    expect(styles).toMatch(/\.search input:focus-visible \{\s*box-shadow: none;/u)
    expect(styles).toMatch(/@media \(max-width: 767px\) \{[\s\S]*?div\[data-sidebar-collapsed\]:has\(> \[data-shell-overlay\]\) \[data-slot='conversation\.session\.header'\] > header\) \{[\s\S]*?padding-left: 64px;/u)
    expect(styles).toMatch(/\[data-slot='conversation\.session\.header'\] > header > div:first-child\) \{[\s\S]*?min-height: 44px;/u)
    expect(styles).toMatch(/\.mobileOpen \{[\s\S]*?left: 12px;[\s\S]*?width: 44px;[\s\S]*?height: 44px;/u)
  })
})
