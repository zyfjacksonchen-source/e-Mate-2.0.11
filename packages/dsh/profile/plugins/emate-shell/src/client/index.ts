import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  IconArchiveOutline20,
  IconBrowseOutline16,
  IconChevronDownOutline14,
  IconChecklistOutline14,
  IconCloseOutline16,
  IconCopyOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconEnhanceOutline16,
  IconFolderOpenOutline16,
  IconGoalOutline16,
  IconDarkOutline16,
  IconLightOutline16,
  IconLinkOutline16,
  IconListPenOutline16,
  IconNewChatOutline16,
  IconPanelLeftOutline16,
  IconPauseOutline16,
  IconPlayOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  IconSkillOutline16,
  IconTrashOutline16,
  IconUserOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { AccountControl, AccountSettings } from './account.tsx'
import { ActivityHeader, activityHeaderDefinition } from './activity-header.tsx'
import { CapabilitiesPage, CapabilityControl } from './capabilities.tsx'
import './chat-chrome.module.css'
import { ConnectionsSettings } from './connections.tsx'
import { ComposerConnectors, routeToConnections } from './composer-connectors.tsx'
import { HomeProjection } from './home.tsx'
import { IdentityGate } from './identity.tsx'
import { LegacyArtifacts, legacyArtifactDefinition } from './legacy-artifacts.tsx'
import { LongMessageDisclosure, longMessageDefinition } from './long-message-disclosure.tsx'
import {
  OfficeArtifacts,
  officeArtifactsDefinition,
  selectOfficeArtifacts,
} from './office-artifacts.tsx'
import { isGeneralWorkspace, SidebarRoot } from './sidebar.tsx'
import { RetryAttempts } from './retry-attempts.tsx'
import { SessionRouteProjection } from './session-route.tsx'
import { SessionShareAction } from './session-share.tsx'
import {
  SettingsChrome,
  SettingsCloseLabel,
  SettingsTitle,
  SettingsTrigger,
} from './settings-chrome.tsx'

export const inject = ['slots', 'layout', 'sessions', 'workspaces', 'connection', 'conversation', 'conversationEvents', 'theme']

function SkipTargetOnboarding({ complete }: { complete: () => void }) {
  useEffect(complete, [complete])
  return null
}

export function apply(ctx: any): void {
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

  const prepareSchedulePrompt = async (prompt: string) => {
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
  ctx.conversationEvents.register(activityHeaderDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'model-retry',
    priority: -1,
  }, RetryAttempts))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'e-mate-activity-group',
  }, ActivityHeader))
  ctx.conversationEvents.register(longMessageDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'e-mate-message-disclosure',
  }, LongMessageDisclosure))
  ctx.conversationEvents.register(legacyArtifactDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'legacy-artifacts',
    inject: () => ({ canDownload: ctx.connection.isLoopback }),
  }, LegacyArtifacts))
  ctx.conversationEvents.register(officeArtifactsDefinition)
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: selectOfficeArtifacts,
    inject: () => ({ canDownload: ctx.connection.isLoopback }),
  }, OfficeArtifacts))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'e-mate-session-share',
    order: -20,
    inject: () => ({
      callShare: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.share', endpoint, payload),
    }),
  }, SessionShareAction))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'e-mate-connectors',
    order: 20,
    inject: () => ({ LinkIcon: IconLinkOutline16, openConnections: routeToConnections }),
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
      toggleSidebar: () => { ctx.layout.toggleSidebar() },
      openSettings: () => {
        if (location.pathname === '/settings') return
        history.pushState(null, '', '/settings')
        dispatchEvent(new PopStateEvent('popstate'))
      },
      getThemeScheme: () => ctx.theme.getTheme().active.colorScheme,
      subscribeTheme: (listener: () => void) => ctx.on('theme/change', listener),
      toggleTheme: () => {
        const scheme = ctx.theme.getTheme().active.colorScheme
        ctx.theme.setTheme(scheme === 'dark' ? 'light' : 'dark')
      },
      PanelIcon: IconPanelLeftOutline16,
      LightIcon: IconLightOutline16,
      DarkIcon: IconDarkOutline16,
      SettingsIcon: IconSettingsOutline16,
      scheduleIcons: {
        create: IconGoalOutline16,
        list: IconChecklistOutline14,
        edit: IconEditOutline16,
        run: IconEnhanceOutline16,
        pause: IconPauseOutline16,
        resume: IconPlayOutline16,
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
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'e-mate-capabilities',
    order: -10,
    inject: () => ({
      callCapabilities: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.capabilities', endpoint, payload),
      callSkillHub: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.skillHub', endpoint, payload),
      listInstalled: async (sessionId: string) => {
        const { result } = await ctx.connection.api.skills.list({ sessionId })
        if (!result.ok) throw new Error(`skill.list failed: ${result.error.code}: ${result.error.message}`)
        return result.value.skills
      },
      startSession: () => { startSession() },
      SearchIcon: IconSearchOutline16,
      DownloadIcon: IconDownloadOutline16,
      CloseIcon: IconCloseOutline16,
      RefreshIcon: IconRefreshOutline16,
      SkillIcon: IconSkillOutline16,
      capabilityIcons: {
        browser: IconBrowseOutline16,
        collaboration: IconLinkOutline16,
        image: IconEnhanceOutline16,
        office: IconListPenOutline16,
        ocr: IconDataOutline16,
      },
    }),
  }, CapabilitiesPage))
  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action',
    id: 'e-mate-capabilities-entry',
    order: 20,
    inject: () => ({ SkillIcon: IconSkillOutline16 }),
  }, CapabilityControl))
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
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'connections',
    order: 40,
    label: '外部连接',
    inject: () => ({
      callConnections: (endpoint: string, payload: Record<string, unknown>) =>
        ctx.connection.rpc.call('/emate.connections', endpoint, payload),
      setCredential: async (ref: string, value: string) => {
        const response = await ctx.connection.api.credentials.set({ ref, value })
        if (!response.result.ok) throw new Error(response.result.error.message)
      },
      unsetCredential: async (ref: string) => {
        const response = await ctx.connection.api.credentials.unset({ ref })
        if (!response.result.ok) throw new Error(response.result.error.message)
      },
      LinkIcon: IconLinkOutline16,
      RefreshIcon: IconRefreshOutline16,
    }),
  }, ConnectionsSettings))
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
