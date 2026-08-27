import { useEffect, useLayoutEffect, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import css from './home.module.css'
import { QuickTemplates } from './quick-templates.tsx'
import { SchedulesPage, type SchedulesPageProps } from './schedules-page.tsx'

interface Props extends SchedulesPageProps {
  useSessions: <T>(selector: (state: SessionListState) => T) => T
  openSession: (id: string) => void
  prepareTemplateDraft: (prompt: string) => void | Promise<void>
  closeDetails: () => void
}

interface ToolbarProps extends Pick<Props, 'toggleSidebar' | 'PanelIcon'> {}

function HomeToolbar({ toggleSidebar, PanelIcon }: ToolbarProps) {
  return (
    <header className={css.toolbar} data-emate-home-toolbar="">
      <button type="button" aria-label="切换任务导航" onClick={toggleSidebar}><PanelIcon size={18} /></button>
    </header>
  )
}

export function HomeProjection({
  useSessions,
  prepareTemplateDraft,
  prepareSchedulePrompt,
  callSchedules,
  scheduleIcons,
  toggleSidebar,
  closeDetails,
  PanelIcon,
}: Props) {
  const sessionSnapshot = useSessions(state => state)
  const { byId, current } = sessionSnapshot
  const [pathname, setPathname] = useState(() => location.pathname)
  const [target, setTarget] = useState<Element | null>(null)
  const schedules = pathname === '/schedules'
  const show = !schedules && (current === undefined || byId[current]?.blank === true)

  useEffect(() => {
    if (show) closeDetails()
  }, [closeDetails, show])

  useEffect(() => {
    const sync = () => { setPathname(location.pathname) }
    addEventListener('popstate', sync)
    return () => { removeEventListener('popstate', sync) }
  }, [])

  useLayoutEffect(() => {
    if (!show) {
      setTarget(null)
      return undefined
    }
    const findTarget = () => {
      setTarget(document.querySelector('[data-phase="hero"] [data-chain-overlay-fallback="conversation.composer"] > div'))
    }
    findTarget()
    const observer = new MutationObserver(findTarget)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-phase'],
    })
    return () => { observer.disconnect() }
  }, [current, show])

  if (schedules) return <SchedulesPage {...{ prepareSchedulePrompt, callSchedules, scheduleIcons, toggleSidebar, PanelIcon }} />
  if (!show || target === null) return null

  return (
    <>
      {createPortal(<HomeToolbar toggleSidebar={toggleSidebar} PanelIcon={PanelIcon} />, target.closest('[data-phase]') ?? target)}
      {createPortal(<>
      <section className={css.hero} aria-labelledby="emate-home-title" data-emate-home-hero="">
        <div className={css.heroStage}>
          <img src="/assets/e-mate/team-hero.png" alt="e-Mate 五位办公助手" />
        </div>
        <h1 id="emate-home-title">和<span>小芯</span>一起开始工作吧</h1>
        <p>告诉我的目标，我会帮你拆解步骤、调用工具、完成任务。</p>
      </section>
      <QuickTemplates prepareDraft={prepareTemplateDraft} />
      </>, target)}
    </>
  )
}
