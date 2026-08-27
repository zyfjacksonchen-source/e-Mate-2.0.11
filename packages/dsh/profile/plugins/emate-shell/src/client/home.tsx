import { useEffect, useLayoutEffect, useMemo, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import css from './home.module.css'
import { SchedulesPage, type SchedulesPageProps } from './schedules-page.tsx'
import { collectInternalSubagentIds, isTopLevelProductSession } from './session-visibility.ts'
import { newestSessionFirst } from './sidebar.tsx'
import { formatTokenCount } from './token-format.ts'

interface Props extends SchedulesPageProps {
  useSessions: <T>(selector: (state: SessionListState) => T) => T
  openSession: (id: string) => void
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

function dayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

export function HomeProjection({
  useSessions,
  openSession,
  prepareSchedulePrompt,
  callSchedules,
  scheduleIcons,
  toggleSidebar,
  closeDetails,
  PanelIcon,
}: Props) {
  const sessionSnapshot = useSessions(state => state)
  const { byId, current } = sessionSnapshot
  const internalSubagentIds = useMemo(() => collectInternalSubagentIds(sessionSnapshot), [sessionSnapshot])
  const productSessions = useMemo(() => sessionSnapshot.ids
    .map(id => byId[id])
    .filter((row): row is SessionSummary => row !== undefined
      && isTopLevelProductSession(row, internalSubagentIds)),
  [byId, internalSubagentIds, sessionSnapshot.ids])
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

  const visible = productSessions.filter(row => !row.blank)
  const waiting = productSessions.filter(row => row.pendingInteraction !== undefined).length
  const completed = visible.filter(row => row.completed === true).length
  const tokenUsage = visible.reduce((total, row) => {
    const usage = row.projectionValues?.tokenUsage
    return usage === undefined
      ? total
      : total + usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  }, 0)
  const recent = [...visible]
    .sort(newestSessionFirst)
    .slice(0, 2)
  const today = new Date()
  const dayCounts = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - offset))
    const key = dayKey(date.getTime())
    return {
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      count: visible.filter(row => dayKey(row.updatedAt) === key).length,
    }
  })
  const maximum = Math.max(1, ...dayCounts.map(item => item.count))

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

      <section className={css.overview} aria-labelledby="emate-overview-title" data-emate-home-overview="">
        <header>
          <h2 id="emate-overview-title">今日使用概览</h2>
          <span><i aria-hidden="true" />数据来自本机任务与 Token 记录</span>
        </header>
        <div className={css.metrics}>
          <article><small>完成任务数</small><strong>{completed}</strong><span>本机完成提醒</span></article>
          <article><small>等待任务</small><strong>{waiting}</strong><span>{waiting ? '等待小芯处理' : '当前无等待'}</span></article>
          <article><small>Token 消耗量</small><strong>{formatTokenCount(tokenUsage)}</strong><span>本机可核对用量</span></article>
          <article><small>任务成功率</small><strong>暂无</strong><span>等待审计结果对账</span></article>
        </div>
        <div className={css.report}>
          <section>
            <h3>任务趋势（近 7 天）</h3>
            <div className={css.trend} aria-label="最近七天任务活动">
              {dayCounts.map(item => (
                <span key={item.label} title={`${item.label}：${item.count} 个任务`}>
                  <i style={{ height: `${Math.max(2, item.count / maximum * 100)}%` }} aria-hidden="true" />
                  <small>{item.label}</small>
                </span>
              ))}
            </div>
          </section>
          <section>
            <h3>最近任务</h3>
            {recent.length ? (
              <ul className={css.recent}>
                {recent.map(row => (
                  <li key={row.id}>
                    <button type="button" onClick={() => { openSession(row.id) }}>
                      <span>{row.displayTitle}</span><small>{row.running ? '进行中' : '已结束'}</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p>完成首个任务后会显示在这里。</p>}
          </section>
          <section>
            <h3>工作摘要</h3>
            <p>{completed ? `本机有 ${completed} 项任务完成提醒；成功率以审计对账为准。` : '今天还没有可核对的已结束任务。告诉小芯目标即可开始。'}</p>
          </section>
        </div>
      </section>
      </>, target)}
    </>
  )
}
