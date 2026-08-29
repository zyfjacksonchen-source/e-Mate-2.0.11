import { createElement, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type {
  DesktopUpdateBridge,
  DesktopUpdateBridgeWindow,
} from '../../../../../../../desktop/e-mate-desktop/src/update-presentation.ts'
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
import { registerActivityFold } from './activity-fold.tsx'
import './theme-tokens.css'
import './chat-chrome.module.css'
import { ComposerConnectors, ComposerMentions } from './composer-connectors.tsx'
import { openMentionMenu, registerComputerUseTrigger, registerMentionSources } from './composer-mentions.ts'
import { HomeProjection, SchedulesOverlayProjection } from './home.tsx'
import { HeaderControls } from './header-controls.tsx'
import { IdentityGate } from './identity.tsx'
import { ToolImageGallery, toolImagesDefinition } from './image-gallery.tsx'
import { LegacyArtifacts, legacyArtifactDefinition } from './legacy-artifacts.tsx'
import { registerMessageModeSettings } from './message-mode-settings.tsx'
import { isGeneralWorkspace, SidebarRoot } from './sidebar.tsx'
import { SessionRouteProjection } from './session-route.tsx'
import { HiddenSessionLogExport } from './session-share.tsx'
import {
  SettingsChrome,
  SettingsCloseLabel,
  SettingsTitle,
  SettingsTrigger,
} from './settings-chrome.tsx'
import { ThinkingStatusBranding } from './thinking-status.tsx'

export const inject = [
  'slots', 'layout', 'sessions', 'workspaces', 'connection', 'conversation', 'conversationEvents', 'theme',
  'sessionLogDownload', 'inputTriggers', 'remote', 'remote.commands', 'settingsScope',
]

const desktopUpdateBridge = (): DesktopUpdateBridge | undefined =>
  (window as DesktopUpdateBridgeWindow).__EMATE_DESKTOP_UPDATES__

export function registerSessionShare(ctx: any): void {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'session-log-download',
    order: -20,
    priority: -1,
  }, HiddenSessionLogExport))
}

/** Mount e-Mate utilities once in DSH's native frame-wide overlay seat. */
export function registerHeaderControls(ctx: any): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'e-mate-header-controls',
    order: -180,
    inject: () => ({
      getThemeScheme: () => ctx.theme.getTheme().active.colorScheme,
      subscribeTheme: (listener: () => void) => ctx.on('theme/change', listener),
      toggleTheme: () => {
        const scheme = ctx.theme.getTheme().active.colorScheme
        ctx.theme.setTheme(scheme === 'dark' ? 'light' : 'dark')
      },
      hooks: { sessionLogDownload: ctx.sessionLogDownload.store },
      requestDownload: (sessionId: string) => ctx.sessionLogDownload.download(sessionId),
      dismissDownload: (sessionId: string) => { ctx.sessionLogDownload.dismiss(sessionId) },
      callShare: (endpoint: string, payload: unknown) => ctx.connection.rpc.call('/emate.share', endpoint, payload),
      LightIcon: IconLightOutline16,
      DarkIcon: IconDarkOutline16,
    }),
  }, HeaderControls))
}

function SkipTargetOnboarding({ complete }: { complete: () => void }) {
  useEffect(complete, [complete])
  return null
}

function HiddenSessionStats() { return null }
function HiddenProductSurface() { return null }

const STANDALONE_PRODUCT_ROUTES = new Set(['/settings', '/schedules', '/capabilities'])

function StandaloneProductSurface() {
  return createElement('div', {
    'data-phase': 'product',
    'data-emate-product-surface': '',
  })
}

/** Keep standalone product routes from inheriting a resident Session's body or header. */
export function registerRouteScopedConversationHeader(ctx: any): void {
  ctx.slots.inject('conversation', () => {
    let disposeShadow: (() => void) | undefined
    const sync = () => {
      const hide = STANDALONE_PRODUCT_ROUTES.has(location.pathname)
      if (hide === (disposeShadow !== undefined)) return
      if (hide) {
        ctx.layout.closeDetails()
        disposeShadow = ctx.slots.register({ name: 'conversation', priority: -1 }, StandaloneProductSurface)
      } else {
        const dispose = disposeShadow
        disposeShadow = undefined
        dispose?.()
      }
    }
    addEventListener('popstate', sync)
    sync()
    return () => {
      removeEventListener('popstate', sync)
      disposeShadow?.()
    }
  })
  ctx.slots.inject('conversation.session.header', () => {
    let disposeShadow: (() => void) | undefined
    const sync = () => {
      const hide = STANDALONE_PRODUCT_ROUTES.has(location.pathname)
      if (hide === (disposeShadow !== undefined)) return
      if (hide) {
        disposeShadow = ctx.slots.register({
          name: 'conversation.session.header',
          priority: -1,
        }, HiddenProductSurface)
      } else {
        const dispose = disposeShadow
        disposeShadow = undefined
        dispose?.()
      }
    }
    addEventListener('popstate', sync)
    sync()
    return () => {
      removeEventListener('popstate', sync)
      disposeShadow?.()
    }
  })
  ctx.slots.inject('details', () => {
    let disposeShadow: (() => void) | undefined
    const sync = () => {
      const hide = STANDALONE_PRODUCT_ROUTES.has(location.pathname)
      if (hide === (disposeShadow !== undefined)) return
      if (hide) {
        disposeShadow = ctx.slots.register({ name: 'details', priority: -1 }, HiddenProductSurface)
      } else {
        const dispose = disposeShadow
        disposeShadow = undefined
        dispose?.()
      }
    }
    addEventListener('popstate', sync)
    sync()
    return () => {
      removeEventListener('popstate', sync)
      disposeShadow?.()
    }
  })
}

/** Keep DSH presets available internally while removing product-facing mode selectors. */
export function registerManagedPresetSurfaces(ctx: any): void {
  ctx.slots.inject('conversation.hero.agentPreset', () => ctx.slots.register({
    name: 'conversation.hero.agentPreset',
    priority: -1,
  }, HiddenProductSurface))
  for (const name of ['conversation.session.header.actions', 'settings.general.item'] as const) {
    ctx.slots.inject(name, () => ctx.slots.register({
      name,
      id: 'agent-preset',
      priority: -1,
    }, HiddenProductSurface))
  }
}

interface RouteFence {
  current(): boolean
  dispose(): void
}

const routeGenerations = new WeakMap<object, number>()

function captureRouteFence(ctx: any): RouteFence {
  const generation = (routeGenerations.get(ctx) ?? 0) + 1
  routeGenerations.set(ctx, generation)
  const sourcePath = location.pathname
  const sourceSession = ctx.sessions.list.getSnapshot().current
  let stale = false
  const onNavigation = () => {
    if (location.pathname !== sourcePath) stale = true
  }
  addEventListener('popstate', onNavigation)
  const unsubscribe = ctx.sessions.list.subscribe?.(() => {
    if (ctx.sessions.list.getSnapshot().current !== sourceSession) stale = true
  }) ?? (() => {})
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    removeEventListener('popstate', onNavigation)
    unsubscribe()
  }
  return {
    current: () => routeGenerations.get(ctx) === generation && !stale && location.pathname === sourcePath
      && ctx.sessions.list.getSnapshot().current === sourceSession,
    dispose,
  }
}

/** Resolve through the native Workspace owner, then let only the owning route generation open it. */
export async function startSessionFromRoute(ctx: any, workspaceId?: string): Promise<boolean> {
  const workspaces = ctx.workspaces.list.getSnapshot()
  if (workspaces.baselinesReady !== true) throw new Error('new task unavailable')
  const target = workspaceId ?? workspaces.items.find(isGeneralWorkspace)?.workspaceId
  if (target === undefined) throw new Error('new task unavailable')
  const fence = captureRouteFence(ctx)
  try {
    const sessionId = await ctx.workspaces.connectWorkspace(target)
    if (!fence.current()) return false
    fence.dispose()
    ctx.sessions.open(sessionId)
    const route = `/chat/${encodeURIComponent(sessionId)}`
    if (location.pathname !== route) history.pushState(null, '', route)
    dispatchEvent(new PopStateEvent('popstate'))
    return true
  } catch (error: unknown) {
    if (!fence.current()) return false
    throw error
  } finally {
    fence.dispose()
  }
}

/** Keep an existing Session owner; only a true no-Session Home action resolves general. */
export async function prepareTemplateDraftFromRoute(ctx: any, prompt: string): Promise<void> {
  let sessionId = ctx.sessions.list.getSnapshot().current
  if (sessionId === undefined) {
    if (!await startSessionFromRoute(ctx)) return
    sessionId = ctx.sessions.list.getSnapshot().current
  }
  if (sessionId === undefined) throw new Error('new task unavailable')
  const scope = ctx.sessions.scope(sessionId)
  if (scope === undefined) throw new Error(`session "${sessionId}" is not addressable`)
  ctx.conversation.input.for(scope).setDraft(prompt)
}

/** Change only the route; SessionRouteProjection remains the single current-Session owner. */
export function openSessionFromRoute(id: string): void {
  const route = `/chat/${encodeURIComponent(id)}`
  if (location.pathname !== route) history.pushState(null, '', route)
  dispatchEvent(new PopStateEvent('popstate'))
}

/** Use the rc.7 Workspace runtime's single native Host directory-picker seam. */
export function pickWorkspaceDirectory(ctx: any): Promise<string | null> {
  return ctx.workspaces.pickDirectory()
}

/** Attach one picked Workspace only while the initiating route generation still owns the UI. */
export async function attachWorkspaceFromRoute(ctx: any): Promise<string | null> {
  const fence = captureRouteFence(ctx)
  try {
    const path = await pickWorkspaceDirectory(ctx)
    if (path === null || !fence.current()) return null
    const workspace = await ctx.workspaces.create({ path })
    return fence.current() ? workspace.workspaceId : null
  } catch (error: unknown) {
    if (!fence.current()) return null
    throw error
  } finally {
    fence.dispose()
  }
}

/** Hand one Schedule intent to its native Session only while the initiating route still owns the UI. */
export async function prepareSchedulePromptFromRoute(
  ctx: any,
  prompt: string,
  requestedSessionId?: string,
): Promise<void> {
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

  const fence = captureRouteFence(ctx)
  try {
    const workspaceState = ctx.workspaces.list.getSnapshot()
    const current = ctx.sessions.list.getSnapshot().current
    let workspace = current === undefined
      ? undefined
      : workspaceState.items.find((item: any) => item.sessionIds.includes(current))
    workspace ??= workspaceState.items.find((item: any) => item.workspaceId === workspaceState.recentWorkspaceId)
      ?? workspaceState.items[0]
    if (workspace === undefined) {
      const path = await ctx.workspaces.pickDirectory()
      if (!fence.current()) return
      if (path === null) throw new Error('请选择项目文件夹后继续。')
      workspace = await ctx.workspaces.create({ path })
      if (!fence.current()) return
    }
    const sessionId = await ctx.workspaces.connectWorkspace(workspace.workspaceId)
    if (!fence.current()) return
    const scope = ctx.sessions.scope(sessionId)
    if (scope === undefined) throw new Error(`session "${sessionId}" is not addressable`)
    fence.dispose()
    ctx.conversation.input.for(scope).setDraft(prompt)
    ctx.sessions.open(sessionId)
    const route = `/chat/${encodeURIComponent(sessionId)}`
    if (location.pathname !== route) history.pushState(null, '', route)
    dispatchEvent(new PopStateEvent('popstate'))
  } finally {
    fence.dispose()
  }
}

export function apply(ctx: any): void {
  const messageMode = registerMessageModeSettings(ctx)
  registerActivityFold(ctx, messageMode)
  registerComputerUseTrigger(ctx)
  registerMentionSources(ctx)
  registerManagedPresetSurfaces(ctx)
  registerRouteScopedConversationHeader(ctx)
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'stats',
    priority: -1,
  }, HiddenSessionStats))
  const startSession = (workspaceId?: string) => startSessionFromRoute(ctx, workspaceId)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'e-mate-session-route',
    order: -200,
    inject: () => ({
      getSessions: () => ctx.sessions.list.getSnapshot(),
      openSession: (id: string) => { ctx.sessions.open(id) },
    }),
  }, SessionRouteProjection))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'e-mate-thinking-status',
    order: -190,
  }, ThinkingStatusBranding))
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
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'e-mate-mentions',
    order: 11,
    inject: (sessionId: string) => ({
      openMentions: (selection: { start: number; end: number }) => {
        openMentionMenu(ctx, sessionId, selection)
      },
    }),
  }, ComposerMentions))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'e-mate-connectors',
    order: 20,
    inject: (sessionId: string) => ({
      LinkIcon: IconLinkOutline16,
      openConnections: () => {
        const route = '/capabilities?category=collaboration'
        if (`${location.pathname}${location.search}` === route) return
        history.pushState(null, '', route)
        dispatchEvent(new PopStateEvent('popstate'))
      },
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
        openSession: openSessionFromRoute,
        pickWorkspace: () => attachWorkspaceFromRoute(ctx),
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
  ctx.slots.inject('conversation.hero.content', () => ctx.slots.register({
    name: 'conversation.hero.content',
    id: 'e-mate-home',
    inject: () => ({
      prepareTemplateDraft: (prompt: string) => prepareTemplateDraftFromRoute(ctx, prompt),
    }),
  }, HomeProjection))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'e-mate-schedules',
    order: -20,
    inject: () => ({
      prepareSchedulePrompt: (prompt: string, sessionId?: string) =>
        prepareSchedulePromptFromRoute(ctx, prompt, sessionId),
      callSchedules: () => ctx.connection.rpc.call('/emate.schedules', 'list', {}),
      toggleSidebar: () => { ctx.layout.toggleSidebar() },
      PanelIcon: IconPanelLeftOutline16,
      scheduleIcons: {
        create: IconGoalOutline16,
        refresh: IconRefreshOutline16,
        edit: IconEditOutline16,
        delete: IconTrashOutline16,
      },
    }),
  }, SchedulesOverlayProjection))
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
    inject: () => ({
      updates: desktopUpdateBridge(),
      UpdateIcon: IconRefreshOutline16,
    }),
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
  for (const [id, order] of [['welcome-notice', -100]] as const) {
    ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
      name: 'settings.onboarding',
      id,
      order,
      priority: -1,
    }, SkipTargetOnboarding))
  }
}
