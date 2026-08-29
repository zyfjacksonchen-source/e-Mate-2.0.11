import { useEffect, useState } from 'react'
import css from './home.module.css'
import { QuickTemplates } from './quick-templates.tsx'
import { SchedulesPage, type SchedulesPageProps } from './schedules-page.tsx'

interface Props {
  prepareTemplateDraft: (prompt: string) => void | Promise<void>
}

export function HomeProjection({ prepareTemplateDraft }: Props) {
  return (
    <div className={css.home} data-emate-home="">
      <section className={css.hero} aria-labelledby="emate-home-title" data-emate-home-hero="">
        <div className={css.heroStage}>
          <img src="/assets/e-mate/team-hero.png" alt="e-Mate 五位办公助手" />
        </div>
        <h1 id="emate-home-title">和<span>小芯</span>一起开始工作吧</h1>
        <p>告诉我的目标，我会帮你拆解步骤、调用工具、完成任务。</p>
      </section>
      <QuickTemplates prepareDraft={prepareTemplateDraft} />
    </div>
  )
}

/** Preserve the standalone schedules route in the root overlay seat. */
export function SchedulesOverlayProjection(props: SchedulesPageProps) {
  const [pathname, setPathname] = useState(() => location.pathname)

  useEffect(() => {
    const sync = () => { setPathname(location.pathname) }
    addEventListener('popstate', sync)
    return () => { removeEventListener('popstate', sync) }
  }, [])

  return pathname === '/schedules' ? <SchedulesPage {...props} /> : null
}
