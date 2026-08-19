import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  IconArchiveOutline20,
  IconChevronDownOutline14,
  IconChecklistOutline14,
  IconCloseOutline16,
  IconCopyOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconFolderOpenOutline16,
  IconGoalOutline16,
  IconDarkOutline16,
  IconLightOutline16,
  IconLinkOutline16,
  IconNewChatOutline16,
  IconPanelLeftOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconTrashOutline16,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { AccountControl, AccountSettings } from './account.tsx'
import { ArtifactCapsules } from './artifact-capsules.tsx'
import './chat-chrome.module.css'
import { ComposerConnectors } from './composer-connectors.tsx'
import { HomeProjection } from './home.tsx'
import { HeaderControls } from './header-controls.tsx'
import { IdentityGate } from './identity.tsx'
import { ImageDisclosure, imageDisclosureDefinition, ToolImageGallery, toolImagesDefinition } from './image-gallery.tsx'
import { LegacyArtifacts, legacyArtifactDefinition } from './legacy-artifacts.tsx'
import { isGeneralWorkspace, SidebarRoot } from './sidebar.tsx'
import { SessionRouteProjection } from './session-route.tsx'
import { SessionShareAction } from './session-share.tsx'
import {
  SettingsChrome,
  SettingsCloseLabel,
  SettingsTitle,
  SettingsTrigger,
} from './settings-chrome.tsx'
import { ThinkingStatusBranding } from './thinking-status.tsx'

export const inject = [
  'slots', 'layout', 'sessions', 'workspaces', 'connection', 'conversation', 'conversationEvents', 'theme',
  'sessionLogDownload', 'inputTriggers',
]

export function registerSessionShare(ctx: any): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'session-log-download',
    order: -20,
    priority: -1,
    inject: () => ({
      callShare: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.share', endpoint, payload),
      hooks: { sessionLogDownload: ctx.sessionLogDownload.store },
      requestDownload: (sessionId: string) => ctx.sessionLogDownload.download(sessionId),
      dismissDownload: (sessionId: string) => { ctx.sessionLogDownload.dismiss(sessionId) },
    }),
  }, SessionShareAction))
}

/** Mount the advanced-Desktop utilities through its declared titlebar slot. */
export function registerHeaderControls(ctx: any): void {
  ctx.slots.inject('desktop.titlebar.utilities', () => ctx.slots.register({
    name: 'desktop.titlebar.utilities',
    id: 'e-mate-header-controls',
    order: -30,
    children: {
      'sidebar.settings': { kind: 'single', scope: 'root' },
    },
    inject: () => ({
      getThemeScheme: () => ctx.theme.getTheme().active.colorScheme,
      subscribeTheme: (listener: () => void) => ctx.on('theme/change', listener),
      toggleTheme: () => {
        const scheme = ctx.theme.getTheme().active.colorScheme
        ctx.theme.setTheme(scheme === 'dark' ? 'light' : 'dark')
      },
      LightIcon: IconLightOutline16,
      DarkIcon: IconDarkOutline16,
      UserIcon: IconUserOutline16,
      callIdentity: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.identity', endpoint, payload),
    }),
  }, HeaderControls))
}

export function registerComputerUseTrigger(ctx: any): void {
  const source: InputTriggerSource = {
    trigger: '@',
    name: '功能',
    order: -20,
    candidates(_session, { query }) {
      const isMac = /Mac/u.test(navigator.userAgent) || /Mac/u.test(navigator.platform)
      return Promise.resolve(isMac && '电脑操控'.includes(query)
        ? [{ name: '电脑操控', description: '显式指定使用 dsh-computer-use 操作当前电脑' }]
        : [])
    },
    lexicon() { return ['电脑操控'] },
    onPick() {
      return { insert: { source: '功能', ref: 'computer-use', label: '@电脑操控', clipboardText: '@电脑操控' } }
    },
    codec: {
      clipboardText: () => '@电脑操控',
      serialize: (_ref, signal) => {
        signal.throwIfAborted()
        return Promise.resolve('<computer-use explicit="true">用户已显式指定使用电脑操控完成本次请求。</computer-use>')
      },
    },
  }
  ctx.effect(() => ctx.inputTriggers.registerSource(source), 'e-mate-shell: @电脑操控 source')
}

function SkipTargetOnboarding({ complete }: { complete: () => void }) {
  useEffect(complete, [complete])
  return null
}

function HiddenSessionStats() { return null }

export function apply(ctx: any): void {
  registerComputerUseTrigger(ctx)
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'stats',
    priority: -1,
  }, HiddenSessionStats))
  const startSession = (workspaceId?: string) => {
    const target = workspaceId ?? ctx.workspaces.list.getSnapshot().items.find(isGeneralWorkspace)?.workspaceId
    if (target === undefined) {
      console.warn('e-Mate general workspace is not ready')
      return
    }
    if (workspaceId === undefined && ['/capabilities', '/settings', '/schedules'].includes(location.pathname)) {
      history.pushState(null, '', '/')
      dispatchEvent(new PopStateEvent('popstate'))
      return
    }
    ctx.workspaces.startSession(target)
  }

  const prepareSchedulePrompt = async (prompt: string, requestedSessionId?: string) => {
    if (requestedSessionId !== undefined) {
      const requestedScope = ctx.sessions.scope(requestedSessionId)
      if (requestedScope === undefined) throw new Error(`session "${requestedSessionId}" is not addressable`)
      ctx.conversation.input.for(requestedScope).setDraft(prompt)
      ctx.sessions.open(requestedSessionId)
      const route = `/chat/${encodeURIComponent(requestedSessionId)}`
      if (location.pathname !== route) history.pushState(null, '', route)
      dispatchEvent(new PopStateEvent('popstate'))
      return
    }
    const workspaceState = ctx.workspaces.list.getSnapshot()
    const current = ctx.sessions.list.getSnapshot().current
    let workspace = current === undefined
      ? undefined
      : workspaceState.items.find((item: any) => item.sessionIds.includes(current))
    workspace ??= workspaceState.items.find((item: any) => item.workspaceId === workspaceState.recentWorkspaceId)
      ?? workspaceState.items[0]
    if (workspace === undefined) {
      const path = await ctx.workspaces.pickDirectory()
      if (path === null) throw new Error('请选择项目文件夹后继续。')
      workspace = await ctx.workspaces.create({ path })
    }
    const sessionId = await ctx.workspaces.connectWorkspace(workspace.workspaceId)
    const scope = ctx.sessions.scope(sessionId)
    if (scope === undefined) throw new Error(`session "${sessionId}" is not addressable`)
    ctx.conversation.input.for(scope).setDraft(prompt)
    ctx.sessions.open(sessionId)
    const route = `/chat/${encodeURIComponent(sessionId)}`
    if (location.pathname !== route) history.pushState(null, '', route)
    dispatchEvent(new PopStateEvent('popstate'))
  }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'e-mate-session-route',
    order: -200,
    inject: () => ({
      getSessions: () => ctx.sessions.list.getSnapshot(),
      openSession: (id: string) => { ctx.sessions.open(id) },
      startHomeSession: () => { startSession() },
    }),
  }, SessionRouteProjection))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'e-mate-thinking-status',
    order: -190,
  }, ThinkingStatusBranding))
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'e-mate-artifact-capsules',
    order: 100,
  }, ArtifactCapsules))
  ctx.conversationEvents.register(imageDisclosureDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'e-mate-image-disclosure',
  }, ImageDisclosure))
  ctx.conversationEvents.register(toolImagesDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'e-mate-tool-images',
  }, ToolImageGallery))
  ctx.conversationEvents.register(legacyArtifactDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'legacy-artifacts',
    inject: () => ({ canDownload: ctx.connection.isLoopback }),
  }, LegacyArtifacts))
  registerSessionShare(ctx)
  registerHeaderControls(ctx)
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'e-mate-connectors',
    order: 20,
    inject: () => ({
      LinkIcon: IconLinkOutline16,
      callConnections: () => ctx.connection.rpc.call('/emate.mcpManage', 'active', {}),
    }),
  }, ComposerConnectors))
  ctx.effect(
    () => ctx.slots.register({
      name: 'sidebar',
      children: {
        'sidebar.primary.action': { kind: 'list', scope: 'root' },
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
      inject: () => ({
        createPortal,
        NewChatIcon: IconNewChatOutline16,
        PanelIcon: IconPanelLeftOutline16,
        SearchIcon: IconSearchOutline16,
        ScheduleIcon: IconChecklistOutline14,
        ChevronIcon: IconChevronDownOutline14,
        FolderIcon: IconFolderOpenOutline16,
        PlusIcon: IconPlusOutline16,
        EllipsisIcon: IconEllipsisOutline16,
        CopyIcon: IconCopyOutline16,
        EditIcon: IconEditOutline16,
        ArchiveIcon: IconArchiveOutline20,
        CloseIcon: IconCloseOutline16,
        startSession,
        openSchedules: () => {
          if (location.pathname === '/schedules') return
          history.pushState(null, '', '/schedules')
          dispatchEvent(new PopStateEvent('popstate'))
        },
        openSession: (id: string) => { ctx.sessions.open(id) },
        pickWorkspace: async () => {
          const path = await ctx.workspaces.pickDirectory()
          if (path === null) return null
          return (await ctx.workspaces.create({ path })).workspaceId
        },
        renameSession: async (id: string, title: string) => {
          const session = ctx.sessions.binding(id)?.session
          if (session === undefined) throw new Error(`unknown session "${id}"`)
          const result = await session.rename(title)
          if (!result.ok) throw new Error(result.error.message)
        },
        archiveSession: async (id: string) => { await ctx.workspaces.archiveSession(id) },
        toggleSidebar: () => { ctx.layout.toggleSidebar() },
        getThemeScheme: () => ctx.theme.getTheme().active.colorScheme,
        subscribeTheme: (listener: () => void) => ctx.on('theme/change', listener),
        toggleTheme: () => {
          const scheme = ctx.theme.getTheme().active.colorScheme
          ctx.theme.setTheme(scheme === 'dark' ? 'light' : 'dark')
        },
        LightIcon: IconLightOutline16,
        DarkIcon: IconDarkOutline16,
      }),
    }, SidebarRoot),
    'emate-shell: sidebar slot',
  )
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'e-mate-home',
    order: -20,
    inject: () => ({
      openSession: (id: string) => { ctx.sessions.open(id) },
      prepareSchedulePrompt,
      callSchedules: () => ctx.connection.rpc.call('/emate.schedules', 'list', {}),
      closeDetails: () => { ctx.layout.closeDetails() },
      toggleSidebar: () => { ctx.layout.toggleSidebar() },
      PanelIcon: IconPanelLeftOutline16,
      scheduleIcons: {
        create: IconGoalOutline16,
        refresh: IconRefreshOutline16,
        edit: IconEditOutline16,
        delete: IconTrashOutline16,
      },
    }),
  }, HomeProjection))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'e-mate-identity-gate',
    order: -100,
    inject: () => ({
      callIdentity: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.identity', endpoint, payload),
    }),
  }, IdentityGate))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'e-mate-user-center',
    order: 100,
    inject: () => ({
      UserIcon: IconUserOutline16,
      expandSidebar: () => { ctx.layout.toggleSidebar() },
      callIdentity: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.identity', endpoint, payload),
    }),
  }, AccountControl))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'profile',
    order: -100,
    label: '个人资料',
    inject: () => ({
      callIdentity: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.identity', endpoint, payload),
    }),
  }, AccountSettings))
  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action',
    id: 'e-mate-settings-header',
    order: -100,
  }, SettingsChrome))
  ctx.slots.inject('settings.trigger', () => ctx.slots.register({
    name: 'settings.trigger',
    priority: -1,
    inject: () => ({ SettingsIcon: IconSettingsOutline16 }),
  }, SettingsTrigger))
  ctx.slots.inject('settings.header', () => ctx.slots.register({
    name: 'settings.header',
    priority: -1,
  }, SettingsTitle))
  ctx.slots.inject('settings.close', () => ctx.slots.register({
    name: 'settings.close',
    priority: -1,
  }, SettingsCloseLabel))
  for (const [id, order] of [['welcome-notice', -100], ['deepseek-official', 0]] as const) {
    ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
      name: 'settings.onboarding',
      id,
      order,
      priority: -1,
    }, SkipTargetOnboarding))
  }
}
