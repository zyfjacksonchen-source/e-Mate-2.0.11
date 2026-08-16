import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import css from './home.module.css'

interface SessionRow {
  id: string
  displayTitle: string
  running: boolean
  completed?: boolean
  pendingInteraction?: unknown
  blank: boolean
  updatedAt: number
  projectionValues?: {
    tokenUsage?: {
      uncachedInputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheWriteTokens: number
    }
  }
}

interface SessionState {
  ids: string[]
  byId: Record<string, SessionRow>
  current?: string
}

interface Props {
  useSessions: <T>(selector: (state: SessionState) => T) => T
  openSession: (id: string) => void
  prepareSchedulePrompt: (prompt: string) => Promise<void>
  scheduleIcons: Record<ScheduleIcon, ComponentType<{ size?: number }>>
  toggleSidebar: () => void
  openSettings: () => void
  getThemeScheme: () => 'light' | 'dark'
  subscribeTheme: (listener: () => void) => () => void
  toggleTheme: () => void
  PanelIcon: ComponentType<{ size?: number }>
  LightIcon: ComponentType<{ size?: number }>
  DarkIcon: ComponentType<{ size?: number }>
  SettingsIcon: ComponentType<{ size?: number }>
}

type ScheduleIcon = 'create' | 'list' | 'edit' | 'run' | 'pause' | 'resume' | 'delete'

const SCHEDULE_ACTIONS = [
  ['create', '创建定时任务', '告诉小芯执行时间、内容和发送通道', '请帮我创建一个定时任务。先向我确认执行时间、任务内容和发送通道，再调用定时任务能力保存：'],
  ['list', '查看定时任务', '从 e-Mate 读取当前任务，不在页面伪造状态', '请调用定时任务能力，列出我当前的全部定时任务和下次执行时间。'],
  ['edit', '修改定时任务', '修改名称、内容或执行时间并保留原投递目标', '请调用定时任务能力，先列出当前任务，再让我选择一个任务并说明要修改的字段。'],
  ['run', '立即运行一次', '不改变原计划的下次执行时间', '请调用定时任务能力，先列出当前任务，再让我选择一个任务立即运行一次。'],
  ['pause', '暂停定时任务', '选择任务后由 e-Mate 立即停用', '请调用定时任务能力，先列出当前启用的定时任务，再让我选择要暂停的任务。'],
  ['resume', '恢复定时任务', '选择任务后由 e-Mate 重新启用', '请调用定时任务能力，先列出当前暂停的定时任务，再让我选择要恢复的任务。'],
  ['delete', '删除定时任务', '删除前由小芯再次向你确认', '请调用定时任务能力，先列出当前定时任务，再让我选择要删除的任务；删除前必须再次确认。'],
] as const satisfies ReadonlyArray<readonly [ScheduleIcon, string, string, string]>

interface ToolbarProps extends Pick<Props,
  'toggleSidebar' | 'openSettings' | 'getThemeScheme' | 'subscribeTheme' | 'toggleTheme'
  | 'PanelIcon' | 'LightIcon' | 'DarkIcon' | 'SettingsIcon'> {}

function HomeToolbar({
  toggleSidebar,
  openSettings,
  getThemeScheme,
  subscribeTheme,
  toggleTheme,
  PanelIcon,
  LightIcon,
  DarkIcon,
  SettingsIcon,
}: ToolbarProps) {
  const themeScheme = useSyncExternalStore(subscribeTheme, getThemeScheme, getThemeScheme)
  const ThemeIcon = themeScheme === 'dark' ? DarkIcon : LightIcon

  return (
    <header className={css.toolbar} data-emate-home-toolbar="">
      <button type="button" aria-label="切换任务导航" onClick={toggleSidebar}><PanelIcon size={18} /></button>
      <div>
        <span className={css.runtimeStatus} role="status" aria-label="运行时已连接" />
        <button type="button" aria-label={themeScheme === 'dark' ? '切换到明亮模式' : '切换到暗色模式'} onClick={toggleTheme}><ThemeIcon size={18} /></button>
        <button type="button" aria-label="打开设置" onClick={openSettings}><SettingsIcon size={18} /></button>
      </div>
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
  scheduleIcons,
  toggleSidebar,
  openSettings,
  getThemeScheme,
  subscribeTheme,
  toggleTheme,
  PanelIcon,
  LightIcon,
  DarkIcon,
  SettingsIcon,
}: Props) {
  const current = useSessions(state => state.current)
  const ids = useSessions(state => state.ids)
  const byId = useSessions(state => state.byId)
  const [pathname, setPathname] = useState(() => location.pathname)
  const [target, setTarget] = useState<Element | null>(null)
  const [scheduleBusy, setScheduleBusy] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const schedules = pathname === '/schedules'
  const show = schedules || current === undefined || byId[current]?.blank === true

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
      setTarget(document.querySelector(schedules
        ? '[data-phase]'
        : '[data-phase="hero"] [data-chain-overlay-fallback="conversation.composer"] > div'))
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
  }, [current, schedules, show])

  if (!show || target === null) return null

  if (schedules) {
    return createPortal(
      <>
        <HomeToolbar {...{
          toggleSidebar, openSettings, getThemeScheme, subscribeTheme, toggleTheme,
          PanelIcon, LightIcon, DarkIcon, SettingsIcon,
        }} />
        <main className={css.schedulesPage} data-emate-schedules-page="" aria-labelledby="emate-schedules-title">
          <section className={css.schedules}>
            <header>
              <div><small>e-Mate Scheduler</small><h1 id="emate-schedules-title">定时任务</h1></div>
              <p>操作将在当前会话中执行，由 e-Mate 返回真实结果。</p>
            </header>
            <div>
              {SCHEDULE_ACTIONS.map(([icon, title, description, prompt]) => {
                const Icon = scheduleIcons[icon]
                return (
                  <button
                    key={title}
                    type="button"
                    disabled={scheduleBusy !== null}
                    onClick={() => {
                      setScheduleBusy(title)
                      setScheduleError(null)
                      void prepareSchedulePrompt(prompt)
                        .catch(error => { setScheduleError(error instanceof Error ? error.message : '定时任务会话暂时不可用。') })
                        .finally(() => { setScheduleBusy(null) })
                    }}
                  >
                    <Icon size={20} />
                    <span><strong>{title}</strong><small>{description}</small></span>
                  </button>
                )
              })}
            </div>
            <p className={css.scheduleNote}>此页面不缓存任务清单；查看、修改和执行状态始终以 e-Mate 返回的事实为准。</p>
            {scheduleBusy !== null && <p className={css.scheduleStatus} role="status">正在准备“{scheduleBusy}”会话…</p>}
            {scheduleError !== null && <p className={css.scheduleError} role="alert">{scheduleError}</p>}
          </section>
        </main>
      </>,
      target,
    )
  }

  const sessions = ids.map(id => byId[id]).filter((row): row is SessionRow => row !== undefined)
  const visible = sessions.filter(row => !row.blank)
  const waiting = sessions.filter(row => row.pendingInteraction !== undefined).length
  const completed = visible.filter(row => row.completed === true).length
  const tokenUsage = visible.reduce((total, row) => {
    const usage = row.projectionValues?.tokenUsage
    return usage === undefined
      ? total
      : total + usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  }, 0)
  const recent = [...visible]
    .sort((left, right) => right.updatedAt - left.updatedAt)
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
      {createPortal(<HomeToolbar {...{
        toggleSidebar, openSettings, getThemeScheme, subscribeTheme, toggleTheme,
        PanelIcon, LightIcon, DarkIcon, SettingsIcon,
      }} />, target.closest('[data-phase]') ?? target)}
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
          <article><small>Token 消耗量</small><strong>{tokenUsage.toLocaleString('zh-CN')}</strong><span>本机可核对用量</span></article>
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
