import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { AccountControl } from './account.tsx'
import css from './header-controls.module.css'

type Icon = ComponentType<{ size?: number }>

interface Props {
  renderSlot: (name: string, props: Record<string, unknown>) => ReactNode
  getThemeScheme: () => 'light' | 'dark'
  subscribeTheme: (listener: () => void) => () => void
  toggleTheme: () => void
  LightIcon: Icon
  DarkIcon: Icon
  UserIcon: Icon
  callIdentity: (endpoint: string, payload: Record<string, unknown>) => Promise<{
    ok: boolean
    value?: unknown
    error?: { message?: string }
  }>
}

/** e-Mate utilities projected into DSH's existing Session header utility seat. */
export function HeaderControls({
  renderSlot,
  getThemeScheme,
  subscribeTheme,
  toggleTheme,
  LightIcon,
  DarkIcon,
  UserIcon,
  callIdentity,
}: Props) {
  const themeScheme = useSyncExternalStore(subscribeTheme, getThemeScheme, getThemeScheme)
  const ThemeIcon = themeScheme === 'dark' ? DarkIcon : LightIcon
  if (document.body.dataset.dshDesktopMode !== 'advanced') return null

  return (
    <div className={css.controls} aria-label="应用工具" data-emate-header-controls="">
      <span className={css.runtimeStatus} role="status" aria-label="运行时已连接" />
      <button type="button" aria-label={themeScheme === 'dark' ? '切换到明亮模式' : '切换到暗色模式'} onClick={toggleTheme}>
        <ThemeIcon size={18} />
      </button>
      <span className={css.settings}>{renderSlot('sidebar.settings', { wide: false })}</span>
      <AccountControl
        callIdentity={callIdentity}
        wide={false}
        placement="header"
        UserIcon={UserIcon}
        expandSidebar={() => {}}
      />
    </div>
  )
}
