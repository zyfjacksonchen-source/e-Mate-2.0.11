// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionRuntime, type SessionId, type SessionListState, type SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { HomeProjection } from '../src/client/home.tsx'
import {
  attachWorkspaceFromRoute,
  openSessionFromRoute,
  pickWorkspaceDirectory,
  prepareSchedulePromptFromRoute,
  startSessionFromRoute,
} from '../src/client/index.ts'
import { SessionRouteProjection } from '../src/client/session-route.tsx'
import {
  collectInternalSubagentIds,
  highlightedProductSessionId,
  isTopLevelProductSession,
} from '../src/client/session-visibility.ts'
import { newestSessionFirst, SidebarRoot } from '../src/client/sidebar.tsx'

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
const useReadyWorkspaces = <T,>(selector: (state: { baselinesReady: boolean }) => T) => selector({ baselinesReady: true })
const idleSessions = {
  list: { getSnapshot: () => ({ current: undefined }), subscribe: () => () => {} },
}

function nativeSessionState(overrides: Record<string, unknown>): SessionListState {
  return {
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    ...overrides,
  } as SessionListState
}

describe('native Subagent top-level visibility', () => {
  it('consumes the real client Session projection produced by Host session-added frames', async () => {
    const sessions = new SessionRuntime(new Context(), {} as never, {
      commands: {
        list: () => Promise.resolve({ ok: true, value: [] }),
        execute: () => Promise.resolve({ ok: true, value: undefined }),
      },
    } as never)
    sessions.handleHostEnvelope({
      rpcId: 'parent-added' as never,
      payload: { type: 'host/session-added', sessionId: 'parent' as SessionId, blank: false },
    })
    sessions.handleHostEnvelope({
      rpcId: 'child-added' as never,
      payload: {
        type: 'host/session-added', sessionId: 'child' as SessionId, blank: false,
        parentSessionId: 'parent' as SessionId, origin: 'subagent',
      },
    })
    await Promise.resolve()

    const state = sessions.list.getSnapshot()
    const internal = collectInternalSubagentIds(state)
    expect(state.byId['child' as SessionId]).toMatchObject({ parentId: 'parent', origin: 'subagent' })
    expect(state.ids.filter(id => isTopLevelProductSession(state.byId[id]!, internal))).toEqual(['parent'])
  })

  it('converges origin, lineage, catalog and current-address signals without hiding a root task', () => {
    const root = { id: 'root', displayTitle: 'root', running: false, blank: false, updatedAt: 1 } as SessionSummary
    const origin = { ...root, id: 'origin', origin: 'subagent' as const }
    const lineage = { ...root, id: 'lineage', parentId: 'root' }
    const catalog = { ...root, id: 'catalog' }
    const addressed = { ...root, id: 'addressed' }
    const state = nativeSessionState({
      ids: [root.id, origin.id, lineage.id, catalog.id, addressed.id],
      byId: { root, origin, lineage, catalog, addressed },
      current: addressed.id,
      subagentsByParent: {
        [root.id]: {
          entries: [{ kind: 'child', id: catalog.id, mode: 'one-shot', activity: 'inactive', hasChildren: false }],
          parentAvailable: true, state: 'ready', error: null,
        },
      },
      currentAddress: { parentSessionId: root.id, childSessionId: addressed.id, mode: 'one-shot' },
    })

    const internal = collectInternalSubagentIds(state)
    expect([...internal].sort()).toEqual(['addressed', 'catalog', 'lineage', 'origin'])
    expect(isTopLevelProductSession(root, internal)).toBe(true)
    expect([origin, lineage, catalog, addressed].every(row => !isTopLevelProductSession(row, internal))).toBe(true)
    expect(highlightedProductSessionId(state)).toBe(root.id)
  })

  it.each([1, 2, 4])('keeps the top-level count stable while %i children arrive and after state rebuild', (count) => {
    const parent = { id: 'parent', displayTitle: 'parent', running: false, blank: false, updatedAt: 1 } as SessionSummary
    const children = Array.from({ length: count }, (_, index) => ({
      ...parent, id: `child-${String(index)}`, origin: 'subagent' as const, updatedAt: index + 2,
    }))
    const childOnly = nativeSessionState({
      ids: children.map(row => row.id),
      byId: Object.fromEntries(children.map(row => [row.id, row])),
    })
    const settled = nativeSessionState({
      ids: [parent.id, ...children.map(row => row.id)],
      byId: { [parent.id]: parent, ...Object.fromEntries(children.map(row => [row.id, row])) },
    })

    expect(childOnly.ids.filter(id => isTopLevelProductSession(childOnly.byId[id]!, collectInternalSubagentIds(childOnly)))).toEqual([])
    for (const rebuilt of [settled, structuredClone(settled) as SessionListState]) {
      expect(rebuilt.ids.filter(id => isTopLevelProductSession(rebuilt.byId[id]!, collectInternalSubagentIds(rebuilt)))).toEqual([parent.id])
    }
  })
})

describe('pinned e-Mate Sidebar and Home projection', () => {
  it('keeps Home visible when rc.7 reuses the same blank session for a generic new task', async () => {
    history.replaceState(null, '', '/chat/existing-blank')
    const connectWorkspace = vi.fn(async () => 'existing-blank')
    const openSession = vi.fn()
    const sessions = {
      phase: 'ready' as const,
      current: 'existing-blank',
      byId: { 'existing-blank': { id: 'existing-blank', blank: true } },
    }
    const ctx = {
      workspaces: {
        list: { getSnapshot: () => ({ baselinesReady: true, items: [{ workspaceId: 'general', path: '/home/test/.dsh/e-mate/general', title: '通用会话', sessionIds: ['existing-blank'] }] }) },
        connectWorkspace,
      },
      sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} }, open: openSession },
    }

    render(<SessionRouteProjection
      useSessions={selector => selector(sessions)}
      useWorkspaces={useReadyWorkspaces}
      getSessions={() => sessions}
      openSession={vi.fn()}
      startHomeSession={() => { startSessionFromRoute(ctx) }}
    />)
    startSessionFromRoute(ctx)

    await waitFor(() => { expect(location.pathname).toBe('/') })
    expect(connectWorkspace).not.toHaveBeenCalled()
    expect(openSession).not.toHaveBeenCalled()
  })

  it('drops a late schedule handoff after the initiating route changes', async () => {
    history.replaceState(null, '', '/schedules')
    let resolveConnect!: (id: string) => void
    const connectWorkspace = vi.fn(() => new Promise<string>(resolve => { resolveConnect = resolve }))
    const setDraft = vi.fn()
    const sessions = { current: 'old-session' }
    const open = vi.fn((id: string) => { sessions.current = id })
    const ctx = {
      sessions: {
        list: { getSnapshot: () => sessions },
        open,
        scope: (id: string) => id === 'late-session' ? { id } : undefined,
      },
      workspaces: {
        list: { getSnapshot: () => ({
          items: [{ workspaceId: 'general', sessionIds: ['old-session'] }],
          recentWorkspaceId: 'general',
        }) },
        connectWorkspace,
      },
      conversation: { input: { for: () => ({ setDraft }) } },
    }

    const pending = prepareSchedulePromptFromRoute(ctx, '创建日报')
    history.pushState(null, '', '/capabilities')
    dispatchEvent(new PopStateEvent('popstate'))
    history.pushState(null, '', '/schedules')
    dispatchEvent(new PopStateEvent('popstate'))
    resolveConnect('late-session')

    await expect(pending).resolves.toBeUndefined()
    expect(location.pathname).toBe('/schedules')
    expect(sessions.current).toBe('old-session')
    expect(setDraft).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('lets only the latest rapid new-task generation navigate while both native results remain durable', async () => {
    history.replaceState(null, '', '/chat/source-session')
    const sessions = {
      current: 'source-session',
      ids: ['source-session'],
      byId: { 'source-session': { blank: false } } as Record<string, { blank: boolean }>,
    }
    const listeners = new Set<() => void>()
    const pending = new Map<string, (id: string) => void>()
    const open = vi.fn((id: string) => { sessions.current = id; listeners.forEach(listener => { listener() }) })
    const ctx = {
      sessions: {
        list: {
          getSnapshot: () => sessions,
          subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        },
        open,
      },
      workspaces: {
        list: { getSnapshot: () => ({ baselinesReady: true, items: [] }) },
        connectWorkspace: vi.fn((workspaceId: string) => new Promise<string>(resolve => {
          pending.set(workspaceId, id => {
            sessions.ids.push(id)
            sessions.byId[id] = { blank: true }
            resolve(id)
          })
        })),
      },
    }

    const first = startSessionFromRoute(ctx, 'workspace-a')
    const second = startSessionFromRoute(ctx, 'workspace-b')
    pending.get('workspace-b')?.('session-b')
    await expect(second).resolves.toBe(true)
    pending.get('workspace-a')?.('session-a')
    await expect(first).resolves.toBe(false)

    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('session-b')
    expect(sessions.ids).toEqual(['source-session', 'session-b', 'session-a'])
    expect(location.pathname).toBe('/')
  })

  it('drops a late project attachment and opens a row only through its route owner', async () => {
    history.replaceState(null, '', '/chat/source-session')
    const sessions = {
      phase: 'ready' as const,
      current: 'source-session',
      byId: {
        'source-session': { blank: false },
        'target/session': { blank: false },
      },
    }
    let resolvePick!: (path: string | null) => void
    const create = vi.fn(async () => ({ workspaceId: 'late-workspace' }))
    const ctx = {
      sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} } },
      workspaces: {
        pickDirectory: () => new Promise<string | null>(resolve => { resolvePick = resolve }),
        create,
      },
    }
    const open = vi.fn((id: string) => { sessions.current = id })

    render(<SessionRouteProjection
      useSessions={selector => selector(sessions)}
      useWorkspaces={useReadyWorkspaces}
      getSessions={() => sessions}
      openSession={open}
      startHomeSession={() => {}}
    />)

    const attaching = attachWorkspaceFromRoute(ctx)
    history.pushState(null, '', '/capabilities')
    dispatchEvent(new PopStateEvent('popstate'))
    resolvePick('/private/project')
    await expect(attaching).resolves.toBeNull()
    expect(create).not.toHaveBeenCalled()

    openSessionFromRoute('target/session')
    expect(location.pathname).toBe('/chat/target%2Fsession')
    expect(open).toHaveBeenCalledWith('target/session')
    expect(sessions.current).toBe('target/session')
  })

  it('uses only the native Workspace picker seam and fails closed when it is unavailable', async () => {
    const failure = new Error('host.pickDirectory needs the native capability; the composed picker serves "browse"')
    const pickDirectory = vi.fn()
      .mockResolvedValueOnce('/work/picked')
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(failure)
    const ctx = { workspaces: { pickDirectory } }

    await expect(pickWorkspaceDirectory(ctx)).resolves.toBe('/work/picked')
    await expect(pickWorkspaceDirectory(ctx)).resolves.toBeNull()
    await expect(pickWorkspaceDirectory(ctx)).rejects.toBe(failure)
    expect(pickDirectory).toHaveBeenCalledTimes(3)
  })

  it('keeps ownership across a same-path synthetic popstate', async () => {
    history.replaceState(null, '', '/')
    let resolvePick!: (path: string) => void
    const pickDirectory = vi.fn(() => new Promise<string>(resolve => { resolvePick = resolve }))
    const create = vi.fn(async ({ path }: { path: string }) => ({ workspaceId: `workspace:${path}` }))
    const pending = attachWorkspaceFromRoute({ sessions: idleSessions, workspaces: { pickDirectory, create } })

    dispatchEvent(new PopStateEvent('popstate'))
    resolvePick('/work/selected')

    await expect(pending).resolves.toBe('workspace:/work/selected')
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith({ path: '/work/selected' })
  })

  it('attaches once and drops late picker or attach results after a route switch', async () => {
    history.replaceState(null, '', '/')
    const create = vi.fn(async ({ path }: { path: string }) => ({ workspaceId: `workspace:${path}` }))
    const pickDirectory = vi.fn(async () => '/work/selected')
    const ctx = { sessions: idleSessions, workspaces: { pickDirectory, create } }

    await expect(attachWorkspaceFromRoute(ctx)).resolves.toBe('workspace:/work/selected')
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith({ path: '/work/selected' })

    let resolvePick!: (path: string) => void
    pickDirectory.mockReturnValueOnce(new Promise(resolve => { resolvePick = resolve }))
    const pickedLate = attachWorkspaceFromRoute(ctx)
    history.pushState(null, '', '/capabilities')
    dispatchEvent(new PopStateEvent('popstate'))
    history.pushState(null, '', '/')
    dispatchEvent(new PopStateEvent('popstate'))
    resolvePick('/work/late')
    await expect(pickedLate).resolves.toBeNull()
    expect(create).toHaveBeenCalledTimes(1)

    history.replaceState(null, '', '/')
    let resolveCreate!: (workspace: { workspaceId: string }) => void
    pickDirectory.mockResolvedValueOnce('/work/durable')
    create.mockReturnValueOnce(new Promise(resolve => { resolveCreate = resolve }))
    const createdLate = attachWorkspaceFromRoute(ctx)
    await vi.waitFor(() => { expect(create).toHaveBeenCalledWith({ path: '/work/durable' }) })
    history.pushState(null, '', '/schedules')
    dispatchEvent(new PopStateEvent('popstate'))
    resolveCreate({ workspaceId: 'workspace-durable' })
    await expect(createdLate).resolves.toBeNull()
  })

  it('keeps the current Sidebar hierarchy while driving real session and workspace actions', async () => {
    const sessions = nativeSessionState({
      ids: ['project-session', 'project-image-child', 'general-session', 'general-image-child', 'general-catalog-child'],
      byId: {
        'project-session': { id: 'project-session', displayTitle: '项目任务', running: false, blank: false, updatedAt: 2 },
        'project-image-child': { id: 'project-image-child', displayTitle: '一次性子代理记录', origin: 'subagent', running: false, blank: false, updatedAt: 4 },
        'general-session': { id: 'general-session', displayTitle: '通用任务', running: true, blank: false, updatedAt: 1 },
        'general-image-child': { id: 'general-image-child', displayTitle: '内部生图会话', parentId: 'general-session', running: false, blank: false, updatedAt: 3 },
        'general-catalog-child': { id: 'general-catalog-child', displayTitle: 'This is one e-Mate image', running: false, blank: false, updatedAt: 5 },
      },
      current: 'project-image-child',
      subagentsByParent: {
        'general-session': {
          entries: [{ kind: 'child', id: 'general-catalog-child', mode: 'one-shot', activity: 'running', hasChildren: false }],
          parentAvailable: true, state: 'ready', error: null,
        },
      },
      currentAddress: { parentSessionId: 'project-session', childSessionId: 'project-image-child', mode: 'one-shot' },
    })
    const workspaces = {
      items: [
        { workspaceId: 'workspace-1', path: '/work/quarterly', title: '季度报告', sessionIds: ['project-session', 'project-image-child'] },
        { workspaceId: 'workspace-general', path: '/home/test/.dsh/e-mate/general', title: '通用会话', sessionIds: ['general-session', 'general-image-child', 'general-catalog-child'] },
      ],
      archivedSessionIds: [],
      phase: 'ready' as const,
    }
    const startSession = vi.fn(async () => true)
    const openSession = vi.fn()
    const openSchedules = vi.fn()
    const pickWorkspace = vi.fn(async (): Promise<string | null> => 'workspace-1')

    render(<SidebarRoot
      collapsed={false}
      width={248}
      renderSlot={(name) => name === 'sidebar.primary.action'
        ? <button type="button" aria-label="能力中心">能力中心</button>
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

    expect(screen.getByText('2.0.15')).not.toBeNull()
    expect(screen.getByRole('button', { name: '新建任务' }).textContent).toContain('新任务')
    expect(screen.getByRole('button', { name: '新建任务' }).getAttribute('aria-current')).toBe('page')
    const sidebar = screen.getByRole('complementary', { name: '任务导航' })
    expect([...sidebar.querySelectorAll('button')]
      .map(button => button.getAttribute('aria-label'))
      .filter(label => ['新建任务', '搜索会话', '定时任务', '能力中心'].includes(label ?? '')))
      .toEqual(['新建任务', '搜索会话', '定时任务', '能力中心'])
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
    expect(document.querySelector('[data-emate-sidebar-footer] [data-emate-settings-trigger]')).toBeNull()
    expect(document.querySelector('[data-emate-sidebar-footer]')?.textContent).toContain('用户中心')
    expect(sidebarCss).toMatch(/\.settingsOwner\s+:global\(button\[data-emate-settings-trigger\]\)[\s\S]*display:\s*none/u)
    expect(screen.getByRole('region', { name: '项目' }).textContent).toContain('季度报告')
    expect(screen.getByRole('region', { name: '项目' }).textContent).not.toContain('通用会话')
    expect(screen.getByRole('region', { name: '项目' }).getAttribute('data-dsh-workspace-drop-target')).toBe('')
    expect(screen.getByRole('region', { name: '会话' }).textContent).toContain('通用任务')
    expect(screen.queryByText('一次性子代理记录')).toBeNull()
    expect(screen.queryByText('内部生图会话')).toBeNull()
    expect(screen.queryByText('This is one e-Mate image')).toBeNull()
    expect(screen.getByRole('button', { name: '打开任务：项目任务' }).getAttribute('aria-current')).toBe('page')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索会话' }), { target: { value: 'This is one e-Mate image' } })
    expect(screen.getByText('没有匹配的会话')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭搜索' }))
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
    let resolvePick!: (workspaceId: string | null) => void
    pickWorkspace.mockImplementationOnce(() => new Promise(resolve => { resolvePick = resolve }))
    const addProject = screen.getByRole('button', { name: '添加项目文件夹' })
    fireEvent.click(addProject)
    fireEvent.click(addProject)
    expect(pickWorkspace).toHaveBeenCalledTimes(2)
    resolvePick(null)
    await waitFor(() => { expect((addProject as HTMLButtonElement).disabled).toBe(false) })
    const privateFailure = 'directory picker failed: host.pickDirectory needs the native capability; the composed picker serves "browse"'
    pickWorkspace.mockRejectedValueOnce(new Error(privateFailure))
    fireEvent.click(addProject)
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('项目文件夹暂时无法添加，请重试。')
    })
    expect(screen.queryByText(privateFailure)).toBeNull()
    pickWorkspace.mockRejectedValueOnce(new Error(privateFailure))
    fireEvent.click(addProject)
    await waitFor(() => { expect(pickWorkspace).toHaveBeenCalledTimes(4) })
    expect(screen.getAllByText('项目文件夹暂时无法添加，请重试。')).toHaveLength(1)
    pickWorkspace.mockRejectedValueOnce(new Error('/private/legacy/project: attach failed'))
    fireEvent.click(addProject)
    await waitFor(() => { expect(pickWorkspace).toHaveBeenCalledTimes(5) })
    expect(screen.queryByText(/private\/legacy/u)).toBeNull()
    startSession.mockRejectedValueOnce(new Error('/private/session/store: create failed'))
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('新任务暂时无法创建，请重试。') })
    expect(screen.queryByText(/private\/session/u)).toBeNull()
    history.pushState(null, '', '/chat/general-session')
    window.dispatchEvent(new PopStateEvent('popstate'))
    await waitFor(() => { expect(screen.queryByRole('status', { name: '运行时已连接' })).toBeNull() })
    expect(screen.getByRole('button', { name: '用户中心' })).not.toBeNull()
  })

  it('batch-removes selected project and general sessions through the native archive action', async () => {
    const sessions = {
      ids: ['project-session', 'general-session', 'image-child'],
      byId: {
        'project-session': { id: 'project-session', displayTitle: '项目任务', running: false, blank: false, updatedAt: 2 },
        'general-session': { id: 'general-session', displayTitle: '通用任务', running: false, blank: false, updatedAt: 1 },
        'image-child': { id: 'image-child', displayTitle: 'This is one e-Mate image', origin: 'subagent' as const, running: false, blank: false, updatedAt: 3 },
      },
      current: undefined,
      phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
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
    expect(screen.queryByRole('checkbox', { name: '选择会话：This is one e-Mate image' })).toBeNull()
    expect(screen.queryByRole('button', { name: '打开任务：通用任务' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '全选' }))
    fireEvent.click(screen.getByRole('button', { name: '删除（2）' }))
    expect(screen.getByRole('dialog', { name: '删除 2 个会话？' })).not.toBeNull()
    expect(screen.getByRole('dialog', { name: '删除 2 个会话？' }).textContent).toContain('本地历史记录仍由 e-Mate 保留。')
    expect(screen.getByRole('dialog', { name: '删除 2 个会话？' }).textContent).not.toContain('DSH')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => { expect(archiveSession).toHaveBeenCalledTimes(2) })
    expect(archiveSession.mock.calls.map(([id]) => id).sort()).toEqual(['general-session', 'project-session'])
    expect(screen.getByRole('status').textContent).toBe('已删除 2 个会话。')
    expect(openSession).not.toHaveBeenCalled()
  })

  it('uses the compact e-Mate Home templates without local usage or recent-Session projections', async () => {
    const phase = document.createElement('main')
    phase.dataset.phase = 'hero'
    const overlay = document.createElement('div')
    overlay.dataset.chainOverlayFallback = 'conversation.composer'
    const target = document.createElement('div')
    overlay.append(target)
    phase.append(overlay)
    document.body.append(phase)
    const openSession = vi.fn()
    const prepareTemplateDraft = vi.fn(async () => {})
    const state = nativeSessionState({
      ids: ['session-1', 'image-child', 'catalog-child'],
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
        'image-child': {
          id: 'image-child', displayTitle: '一次性子代理记录', origin: 'subagent', running: false,
          completed: true, blank: false, updatedAt: Date.now() + 1,
          projectionValues: {
            tokenUsage: { uncachedInputTokens: 1_000, outputTokens: 1_000, cacheReadTokens: 1_000, cacheWriteTokens: 1_000 },
          },
        },
        'catalog-child': {
          id: 'catalog-child', displayTitle: 'This is one e-Mate image', running: false,
          completed: true, blank: false, updatedAt: Date.now() + 2,
          projectionValues: {
            tokenUsage: { uncachedInputTokens: 2_000, outputTokens: 2_000, cacheReadTokens: 2_000, cacheWriteTokens: 2_000 },
          },
        },
      },
      current: undefined,
      subagentsByParent: {
        'session-1': {
          entries: [{ kind: 'child', id: 'catalog-child', mode: 'one-shot', activity: 'inactive', hasChildren: false }],
          parentAvailable: true, state: 'ready', error: null,
        },
      },
    })

    render(<HomeProjection
      {...homeToolbarProps}
      useSessions={selector => selector(state)}
      openSession={openSession}
      prepareTemplateDraft={prepareTemplateDraft}
      prepareSchedulePrompt={async () => {}}
      callSchedules={async () => ({ ok: true, value: { schema_version: 1, items: [], errors: [] } })}
      scheduleIcons={{ create: Icon, refresh: Icon, edit: Icon, delete: Icon }}
    />)
    await waitFor(() => { expect(screen.getByRole('heading', { name: '办公快速模板' })).not.toBeNull() })
    expect(homeToolbarProps.closeDetails).toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '和小芯一起开始工作吧' })).not.toBeNull()
    expect(screen.queryByRole('heading', { name: '今日使用概览' })).toBeNull()
    expect(screen.queryByText('Token 消耗量')).toBeNull()
    expect(screen.getAllByRole('button').filter(button => /^\d{2}/u.test(button.textContent ?? ''))).toHaveLength(12)
    expect(screen.queryByText('一次性子代理记录')).toBeNull()
    expect(screen.queryByText('This is one e-Mate image')).toBeNull()
    expect(screen.queryByText('真实任务')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '切换任务导航' }))
    expect(homeToolbarProps.toggleSidebar).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /周报总结/u }))
    await waitFor(() => { expect(prepareTemplateDraft).toHaveBeenCalledOnce() })
    expect(openSession).not.toHaveBeenCalled()
  })

  it('keeps a non-current durable blank session without pinning a title that blocks target auto naming', async () => {
    const renameSession = vi.fn(async () => {})
    const sessions = {
      ids: ['blank-session'],
      byId: {
        'blank-session': { id: 'blank-session', displayTitle: 'general', running: false, blank: true, updatedAt: 1 },
      },
      current: undefined,
      phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
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

  it('uses updatedAt then id for the project entry, collapsed ten, and Home recents', async () => {
    const phase = document.createElement('main')
    phase.dataset.phase = 'hero'
    const overlay = document.createElement('div')
    overlay.dataset.chainOverlayFallback = 'conversation.composer'
    const target = document.createElement('div')
    overlay.append(target)
    phase.append(overlay)
    document.body.append(phase)

    const ids = ['old', ...Array.from({ length: 9 }, (_, index) => `middle-${index}`), 'same-b', 'same-a', 'newest']
    const byId = Object.fromEntries(ids.map((id, index) => [id, {
      id,
      displayTitle: `任务 ${id}`,
      running: false,
      blank: false,
      updatedAt: id === 'newest' ? 100 : id.startsWith('same-') ? 90 : index,
    }]))
    const sessions = {
      ids, byId, current: undefined, phase: 'ready' as const,
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }
    const workspaces = {
      items: [{ workspaceId: 'workspace-history', path: '/work/history', title: '项目历史', sessionIds: ids }],
      archivedSessionIds: [],
      phase: 'ready' as const,
    }
    const openSession = vi.fn()

    render(<>
      <SidebarRoot
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
        archiveSession={async () => {}}
        toggleSidebar={() => {}}
        {...sidebarUtilityProps}
      />
      <HomeProjection
        {...homeToolbarProps}
        useSessions={selector => selector(sessions)}
        openSession={openSession}
        prepareTemplateDraft={async () => {}}
        prepareSchedulePrompt={async () => {}}
        callSchedules={async () => ({ ok: true, value: { schema_version: 1, items: [], completed: [], recent_runs: [], errors: [] } })}
        scheduleIcons={{ create: Icon, refresh: Icon, edit: Icon, delete: Icon }}
      />
    </>)

    const project = screen.getByRole('region', { name: '项目' })
    const rows = within(project).getAllByRole('button', { name: /^打开任务：/u })
    expect(rows).toHaveLength(10)
    expect(rows.slice(0, 3).map(row => row.getAttribute('aria-label'))).toEqual([
      '打开任务：任务 newest',
      '打开任务：任务 same-a',
      '打开任务：任务 same-b',
    ])
    fireEvent.click(within(project).getByRole('button', { name: '项目历史' }))
    expect(openSession).toHaveBeenLastCalledWith('newest')

    await waitFor(() => { expect(screen.getByRole('heading', { name: '办公快速模板' })).not.toBeNull() })
    expect(screen.queryByRole('heading', { name: '最近任务' })).toBeNull()
    expect(screen.getAllByRole('button', { name: /周报总结|会议纪要|工作计划|汇报大纲|数据分析|方案撰写|邮件起草|文档润色|表格整理|PPT 结构|项目复盘|头脑风暴/u })).toHaveLength(12)
  })

  it('keeps the session ordering comparator stable for equal ASCII ids', () => {
    const row = { id: 'session-01', updatedAt: 1 }
    expect(newestSessionFirst(row, row)).toBe(0)
  })

  it('projects native schedules and writes create, edit, and delete prompts into their owning target sessions', async () => {
    history.replaceState(null, '', '/schedules')
    const phase = document.createElement('main')
    phase.dataset.phase = 'active'
    phase.dataset.emateProductSurface = ''
    document.body.append(phase)
    const prepareSchedulePrompt = vi.fn(async () => {})
    const callSchedules = vi.fn(async () => ({ ok: true, value: {
      schema_version: 1,
      items: [{
        id: 'schedule-1', session_id: 'session-1', session_title: '日报会话', kind: 'every',
        prompt: '生成日报', everySeconds: 300, scheduledAt: '2099-08-19T12:00:00.000Z', state: 'scheduled',
      }],
      completed: [{
        id: 'schedule-2', session_id: 'session-2', session_title: '周报会话', kind: 'at',
        prompt: '提交周报', scheduledAt: '2026-08-19T12:00:00.000Z', state: 'completed',
        completedAt: '2026-08-19T12:00:01.000Z',
      }],
      recent_runs: [{
        id: 'schedule-3', session_id: 'session-3', session_title: '项目会话', kind: 'every',
        prompt: '同步项目', everySeconds: 3600, scheduledAt: '2026-08-19T11:00:00.000Z',
        ranAt: '2026-08-19T11:00:01.000Z',
      }],
      errors: [],
    } }))
    const state = nativeSessionState({})

    render(<HomeProjection
      {...homeToolbarProps}
      useSessions={selector => selector(state)}
      openSession={() => {}}
      prepareSchedulePrompt={prepareSchedulePrompt}
      callSchedules={callSchedules}
      scheduleIcons={{ create: Icon, refresh: Icon, edit: Icon, delete: Icon }}
    />)

    await waitFor(() => { expect(screen.getByRole('heading', { name: '已安排的任务' })).not.toBeNull() })
    await waitFor(() => { expect(screen.getByText('生成日报')).not.toBeNull() })
    expect(callSchedules).toHaveBeenCalledOnce()
    expect(screen.getByText('日报会话')).not.toBeNull()
    expect(screen.getByRole('heading', { name: '已完成' })).not.toBeNull()
    expect(screen.getByText('提交周报')).not.toBeNull()
    expect(screen.getByRole('heading', { name: '最近运行' })).not.toBeNull()
    expect(screen.getByText('同步项目')).not.toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索已安排任务' }), { target: { value: '日报' } })
    expect(screen.getByText('生成日报')).not.toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索已安排任务' }), { target: { value: '不存在' } })
    expect(screen.getByText('没有匹配的定时任务。')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => {
      expect(prepareSchedulePrompt).toHaveBeenCalledWith('请帮我创建一个定时任务。先向我确认执行时间和任务内容，再调用 schedule_create 保存。')
    })
    fireEvent.change(screen.getByRole('textbox', { name: '搜索已安排任务' }), { target: { value: '' } })
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
    expect(source).toMatch(/const workspaces = ctx\.workspaces\.list\.getSnapshot\(\)[\s\S]*?workspaces\.baselinesReady !== true[\s\S]*?workspaces\.items\.find\(isGeneralWorkspace\)/u)
    expect(source).toMatch(/const sessionId = await ctx\.workspaces\.connectWorkspace\(target\)[\s\S]*?ctx\.sessions\.open\(sessionId\)[\s\S]*?history\.pushState\(null, '', '\/'\)[\s\S]*?dispatchEvent\(new PopStateEvent\('popstate'\)\)/u)
    expect(source).not.toMatch(/ctx\.sessions\.create|randomUUID|host\/session-added/u)
    expect(source).toMatch(/ctx\.layout\.toggleSidebar\(\)/u)
    expect(source).toMatch(/ctx\.layout\.closeDetails\(\)/u)
    expect(source).toMatch(/ctx\.connection\.rpc\.call\('\/emate\.schedules', 'list', \{\}\)/u)
    expect(source).toMatch(/ctx\.theme\.getTheme\(\)\.active\.colorScheme/u)
    expect(source).not.toMatch(/\b(?:fetch|WebSocket|EventSource)\s*\(/u)
    expect(styles).toMatch(/:global\(\[data-slot='conversation'\] > div\[data-phase\]\)\s*\{[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;/u)
    expect(styles).toContain('--dsw-alias-button-info-fill: var(--emate-color-brand);')
    expect(styles).toMatch(/button:first-child\) \{\s*display: none !important;/u)
    expect(styles).not.toContain("content: '/'")
    expect(home).not.toMatch(/Runtime Scheduler|由 Runtime|从 Runtime/u)
    expect(home).not.toContain('任务来自 DSH rc.7 原生 Schedule 事件')
  })

  it('keeps the target mobile session title clear of the real sidebar trigger', () => {
    const styles = readFileSync('src/client/sidebar.module.css', 'utf8')
    expect(styles).toMatch(/\.search input:focus-visible \{\s*box-shadow: none;/u)
    expect(styles).toMatch(/@media \(max-width: 767px\) \{[\s\S]*?div\[data-sidebar-collapsed\]:has\(> \[data-shell-overlay\]\) \[data-slot='conversation\.session\.header'\] > header\) \{[\s\S]*?padding-left: 64px;/u)
    expect(styles).toMatch(/\[data-slot='conversation\.session\.header'\] > header > div:first-child\) \{[\s\S]*?min-height: 44px;/u)
    expect(styles).toMatch(/\.mobileOpen \{[\s\S]*?left: 12px;[\s\S]*?width: 44px;[\s\S]*?height: 44px;/u)
  })
})
