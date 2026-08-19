import { useCallback, useEffect, useLayoutEffect, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import css from './home.module.css'
import { formatTokenCount } from './token-format.ts'

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
  prepareSchedulePrompt: (prompt: string, sessionId?: string) => Promise<void>
  callSchedules: () => Promise<unknown>
  scheduleIcons: Record<ScheduleIcon, ComponentType<{ size?: number }>>
  toggleSidebar: () => void
  closeDetails: () => void
  PanelIcon: ComponentType<{ size?: number }>
}

type ScheduleIcon = 'create' | 'refresh' | 'edit' | 'delete'

interface ScheduleItem {
  id: string
  session_id: string
  session_title: string
  kind: 'after' | 'at' | 'every'
  prompt: string
  scheduledAt: string
  state: 'scheduled' | 'overdue'
  afterSeconds?: number
  everySeconds?: number
}

interface ToolbarProps extends Pick<Props, 'toggleSidebar' | 'PanelIcon'> {}

function HomeToolbar({ toggleSidebar, PanelIcon }: ToolbarProps) {
  return (
    <header className={css.toolbar} data-emate-home-toolbar="">
      <button type="button" aria-label="切换任务导航" onClick={toggleSidebar}><PanelIcon size={18} /></button>
    </header>
  )
}

function scheduleRule(item: ScheduleItem): string {
  if (item.kind === 'every') return `每 ${Math.round((item.everySeconds ?? 0) / 60)} 分钟`
  if (item.kind === 'after') return `创建后 ${Math.round((item.afterSeconds ?? 0) / 60)} 分钟`
  return '指定时间'
}

function parseSchedules(response: unknown): { items: ScheduleItem[]; errors: number } {
  const value = response as { ok?: boolean; value?: { schema_version?: number; items?: unknown[]; errors?: unknown[] }; error?: { message?: string } }
  if (value?.ok !== true || value.value?.schema_version !== 1 || !Array.isArray(value.value.items)) {
    throw new Error(value?.error?.message ?? '定时任务暂时无法读取。')
  }
  const items = value.value.items.filter((item): item is ScheduleItem => {
    const row = item as Partial<ScheduleItem>
    return typeof row.id === 'string' && typeof row.session_id === 'string' && typeof row.session_title === 'string'
      && ['after', 'at', 'every'].includes(String(row.kind)) && typeof row.prompt === 'string'
      && typeof row.scheduledAt === 'string' && ['scheduled', 'overdue'].includes(String(row.state))
  })
  if (items.length !== value.value.items.length) throw new Error('定时任务数据格式无效。')
  return { items, errors: Array.isArray(value.value.errors) ? value.value.errors.length : 0 }
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
  const current = useSessions(state => state.current)
  const ids = useSessions(state => state.ids)
  const byId = useSessions(state => state.byId)
  const [pathname, setPathname] = useState(() => location.pathname)
  const [target, setTarget] = useState<Element | null>(null)
  const [scheduleBusy, setScheduleBusy] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)
  const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([])
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleReadErrors, setScheduleReadErrors] = useState(0)
  const ScheduleCreateIcon = scheduleIcons.create
  const ScheduleRefreshIcon = scheduleIcons.refresh
  const schedules = pathname === '/schedules'
  const show = schedules || current === undefined || byId[current]?.blank === true
  const refreshSchedules = useCallback(async () => {
    setScheduleLoading(true)
    setScheduleError(null)
    try {
      const result = parseSchedules(await callSchedules())
      setScheduleItems(result.items)
      setScheduleReadErrors(result.errors)
    } catch (error) {
      setScheduleItems([])
      setScheduleError(error instanceof Error ? error.message : '定时任务暂时无法读取。')
    } finally {
      setScheduleLoading(false)
    }
  }, [callSchedules])

  useEffect(() => {
    if (schedules) void refreshSchedules()
  }, [refreshSchedules, schedules])

  useEffect(() => {
    if (show && !schedules) closeDetails()
  }, [closeDetails, schedules, show])

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
        <HomeToolbar toggleSidebar={toggleSidebar} PanelIcon={PanelIcon} />
        <main className={css.schedulesPage} data-emate-schedules-page="" aria-labelledby="emate-schedules-title">
          <section className={css.schedules}>
            <header>
              <div><small>e-Mate Scheduler</small><h1 id="emate-schedules-title">定时任务</h1></div>
              <div className={css.scheduleHeaderActions}>
                <button type="button" disabled={scheduleLoading} onClick={() => { void refreshSchedules() }}><ScheduleRefreshIcon size={16} />刷新</button>
                <button type="button" disabled={scheduleBusy !== null} onClick={() => {
                  setScheduleBusy('create')
                  void prepareSchedulePrompt('请帮我创建一个定时任务。先向我确认执行时间和任务内容，再调用 schedule_create 保存。')
                    .catch(error => { setScheduleError(error instanceof Error ? error.message : '定时任务会话暂时不可用。') })
                    .finally(() => { setScheduleBusy(null) })
                }}><ScheduleCreateIcon size={16} />新任务</button>
              </div>
            </header>
            <div className={css.scheduleCards}>
              {scheduleItems.map(item => <article key={`${item.session_id}:${item.id}`}>
                <header><span className={item.state === 'overdue' ? css.overdue : undefined}>{item.state === 'overdue' ? '已逾期' : '已计划'}</span><small>{item.session_title}</small></header>
                <strong>{item.prompt}</strong>
                <dl><div><dt>规则</dt><dd>{scheduleRule(item)}</dd></div><div><dt>下次执行</dt><dd>{new Date(item.scheduledAt).toLocaleString()}</dd></div></dl>
                <footer>
                  <button type="button" disabled={scheduleBusy !== null} onClick={() => {
                    setScheduleBusy(item.id)
                    const prompt = `请修改定时任务 ${item.id}（当前内容：${JSON.stringify(item.prompt)}，下次执行：${item.scheduledAt}）。先向我确认新内容或时间；确认后先调用 schedule_create 创建替代任务，成功后再调用 schedule_delete 删除旧任务。`
                    void prepareSchedulePrompt(prompt, item.session_id).catch(error => { setScheduleError(error instanceof Error ? error.message : '定时任务会话暂时不可用。') }).finally(() => { setScheduleBusy(null) })
                  }}><scheduleIcons.edit size={16} />修改</button>
                  <button type="button" disabled={scheduleBusy !== null} onClick={() => {
                    setScheduleBusy(item.id)
                    const prompt = `请删除定时任务 ${item.id}（内容：${JSON.stringify(item.prompt)}）。先调用 schedule_list 核对它仍存在并向我确认；只有收到确认后才调用 schedule_delete。`
                    void prepareSchedulePrompt(prompt, item.session_id).catch(error => { setScheduleError(error instanceof Error ? error.message : '定时任务会话暂时不可用。') }).finally(() => { setScheduleBusy(null) })
                  }}><scheduleIcons.delete size={16} />删除</button>
                </footer>
              </article>)}
              {!scheduleLoading && scheduleItems.length === 0 && <p className={css.scheduleEmpty}>还没有定时任务。点击“新任务”后由小芯确认时间和内容。</p>}
            </div>
            <p className={css.scheduleNote}>任务来自 DSH 原生 Schedule 事件；修改会先创建替代任务，成功后再删除旧任务。</p>
            {scheduleReadErrors > 0 && <p className={css.scheduleError} role="alert">有 {scheduleReadErrors} 个会话的定时任务日志无法读取。</p>}
            {(scheduleLoading || scheduleBusy !== null) && <p className={css.scheduleStatus} role="status">{scheduleLoading ? '正在读取定时任务…' : '正在打开所属会话…'}</p>}
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
