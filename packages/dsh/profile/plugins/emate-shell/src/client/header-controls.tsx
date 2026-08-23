import { useSyncExternalStore, type ComponentType } from 'react'
import { SessionShareAction, type SessionShareActionProps } from './session-share.tsx'
import css from './header-controls.module.css'

type Icon = ComponentType<{ size?: number }>

interface Props extends Omit<SessionShareActionProps, 'sessionId'> {
  useSessions: <T>(selector: (state: { current?: string }) => T) => T
  getThemeScheme: () => 'light' | 'dark'
  subscribeTheme: (listener: () => void) => () => void
  toggleTheme: () => void
  openSettings: () => void
  LightIcon: Icon
  DarkIcon: Icon
  SettingsIcon: Icon
}

/** e-Mate utilities projected once over DSH's complete root frame. */
export function HeaderControls({
  useSessions,
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
  SettingsIcon,
}: Props) {
  const themeScheme = useSyncExternalStore(subscribeTheme, getThemeScheme, getThemeScheme)
  const sessionId = useSessions(state => state.current)
  const ThemeIcon = themeScheme === 'dark' ? DarkIcon : LightIcon

  return (
    <div className={css.controls} aria-label="应用工具" data-emate-header-controls="">
      <SessionShareAction
        sessionId={sessionId}
        callShare={callShare}
        useSessionLogDownload={useSessionLogDownload}
        requestDownload={requestDownload}
        dismissDownload={dismissDownload}
      />
      <span className={css.runtimeStatus} role="status" aria-label="运行时已连接" />
      <button type="button" aria-label={themeScheme === 'dark' ? '切换到明亮模式' : '切换到暗色模式'} onClick={toggleTheme}>
        <ThemeIcon size={18} />
      </button>
      <button type="button" aria-label="打开设置" onClick={openSettings}>
        <SettingsIcon size={18} />
      </button>
    </div>
  )
}
