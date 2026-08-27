import { useState, useSyncExternalStore, type ComponentType } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  DesktopUpdateBridge,
  DesktopUpdateState,
} from '../../../../../../../desktop/e-mate-desktop/src/update-presentation.ts'
import { SessionShareAction, type SessionShareActionProps } from './session-share.tsx'
import { collectInternalSubagentIds, highlightedProductSessionId, isTopLevelProductSession } from './session-visibility.ts'
import css from './header-controls.module.css'

type Icon = ComponentType<{ size?: number }>

interface Props extends Omit<SessionShareActionProps, 'sessionId'> {
  useSessions: <T>(selector: (state: SessionListState) => T) => T
  updates?: DesktopUpdateBridge
  getThemeScheme: () => 'light' | 'dark'
  subscribeTheme: (listener: () => void) => () => void
  toggleTheme: () => void
  openSettings: () => void
  LightIcon: Icon
  DarkIcon: Icon
  UpdateIcon: Icon
  SettingsIcon: Icon
}

const IN_PROGRESS = new Set<DesktopUpdateState['stage']>([
  'checking', 'available', 'confirming', 'downloading', 'verifying', 'staging',
  'waiting-shutdown', 'replacing', 'restarting', 'health-check', 'rolling-back',
])
const CANCELLABLE = new Set<DesktopUpdateState['stage']>(['checking', 'available', 'downloading'])

function progress(state: DesktopUpdateState | undefined): number | undefined {
  return state?.bytes !== undefined && state.total !== undefined && state.total > 0
    ? Math.min(100, Math.round(state.bytes / state.total * 100))
    : undefined
}

function updateLabel(state: DesktopUpdateState | undefined, requesting: boolean): string {
  if (requesting && state === undefined) return '检查中'
  if (state === undefined) return '检查更新'
  const percent = progress(state)
  switch (state.stage) {
    case 'checking': return '检查中'
    case 'available': return state.version === undefined ? '发现更新' : `发现 ${state.version}`
    case 'confirming': return '等待更新确认'
    case 'downloading': return percent === undefined ? '下载更新中' : `下载更新 ${percent}%`
    case 'verifying': return '校验更新中'
    case 'staging': return '准备更新中'
    case 'waiting-shutdown': return '等待应用退出'
    case 'replacing': return '替换应用中'
    case 'restarting': return '正在重启'
    case 'health-check': return '检查更新结果'
    case 'rolling-back': return '正在回滚'
    case 'rolled-back': return '已回滚，可重试'
    case 'failed': return '更新失败，可重试'
    case 'completed': return state.version === undefined ? '已是最新版本' : `已更新至 ${state.version}`
  }
}

export function UpdateControl({
  updates,
  UpdateIcon,
  compact = true,
}: {
  updates: DesktopUpdateBridge
  UpdateIcon: Icon
  compact?: boolean
}) {
  const state = useSyncExternalStore(updates.subscribe, updates.getState, updates.getState)
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState('')
  const busy = requesting || (state !== undefined && IN_PROGRESS.has(state.stage))
  const cancellable = state !== undefined && CANCELLABLE.has(state.stage)
  const percent = progress(state)
  const label = updateLabel(state, requesting)
  const actionLabel = busy
    ? cancellable ? `取消更新${percent === undefined ? '' : `（${percent}%）`}` : label
    : state === undefined ? '检查更新' : `再次检查更新（${label}）`

  return <>
    <button
      type="button"
      className={`${css.updateControl} ${compact ? '' : css.updateWide}`}
      title={actionLabel}
      aria-label={actionLabel}
      aria-busy={busy || undefined}
      disabled={busy && !cancellable}
      onClick={() => {
        setError('')
        if (busy) {
          if (!updates.cancel()) setError('当前更新阶段无法取消。')
          return
        }
        setRequesting(true)
        void updates.runInteractiveUpdate().catch(reason => {
          setError(reason instanceof Error ? reason.message : '暂时无法检查更新。')
        }).finally(() => { setRequesting(false) })
      }}
    >
      <UpdateIcon size={18} />
      <span className={`${css.updateDot} ${state === undefined ? '' : css[state.stage]}`} aria-hidden="true" />
      {!compact && <span>{label}</span>}
    </button>
    {error !== '' && <span className={css.updateError} role="alert">{error}</span>}
  </>
}

const routeSubscribe = (listener: () => void): (() => void) => {
  addEventListener('popstate', listener)
  return () => { removeEventListener('popstate', listener) }
}
const routeSnapshot = (): string => location.pathname

/** e-Mate utilities projected once over DSH's complete root frame. */
export function HeaderControls({
  useSessions,
  updates,
  getThemeScheme,
  subscribeTheme,
  toggleTheme,
  openSettings,
  callShare,
  useSessionLogDownload,
  requestDownload,
  dismissDownload,
  LightIcon,
  DarkIcon,
  UpdateIcon,
  SettingsIcon,
}: Props) {
  const themeScheme = useSyncExternalStore(subscribeTheme, getThemeScheme, getThemeScheme)
  const pathname = useSyncExternalStore(routeSubscribe, routeSnapshot, routeSnapshot)
  const currentSessionId = useSessions(state => state.current)
  const sessionId = useSessions(state => {
    const candidate = highlightedProductSessionId(state)
    if (candidate === undefined || candidate !== currentSessionId
      || pathname !== `/chat/${encodeURIComponent(candidate)}`) return undefined
    const row = state.byId[candidate]
    return row !== undefined && !row.blank
      && isTopLevelProductSession(row, collectInternalSubagentIds(state)) ? candidate : undefined
  })
  const ThemeIcon = themeScheme === 'dark' ? DarkIcon : LightIcon

  return (
    <div className={css.controls} aria-label="应用工具" data-emate-header-controls="">
      {sessionId !== undefined && <SessionShareAction
        sessionId={sessionId}
        callShare={callShare}
        useSessionLogDownload={useSessionLogDownload}
        requestDownload={requestDownload}
        dismissDownload={dismissDownload}
      />}
      {updates !== undefined && <UpdateControl updates={updates} UpdateIcon={UpdateIcon} />}
      <button type="button" title={themeScheme === 'dark' ? '切换到明亮模式' : '切换到暗色模式'} aria-label={themeScheme === 'dark' ? '切换到明亮模式' : '切换到暗色模式'} onClick={toggleTheme}>
        <ThemeIcon size={18} />
      </button>
      <button type="button" title="打开设置" aria-label="打开设置" onClick={openSettings}>
        <SettingsIcon size={18} />
      </button>
    </div>
  )
}
