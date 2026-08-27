import { useCallback, useEffect, useLayoutEffect, useState, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import css from './schedules-page.module.css'

export type ScheduleIcon = 'create' | 'refresh' | 'edit' | 'delete'

export interface SchedulesPageProps {
  prepareSchedulePrompt: (prompt: string, sessionId?: string) => Promise<void>
  callSchedules: () => Promise<unknown>
  scheduleIcons: Record<ScheduleIcon, ComponentType<{ size?: number }>>
  toggleSidebar: () => void
  PanelIcon: ComponentType<{ size?: number }>
}

interface ScheduleRecordItem {
  id: string
  session_id: string
  session_title: string
  kind: 'after' | 'at' | 'every'
  prompt: string
  scheduledAt: string
  afterSeconds?: number
  everySeconds?: number
}

interface ScheduleItem extends ScheduleRecordItem { state: 'scheduled' | 'overdue' }
interface CompletedScheduleItem extends ScheduleRecordItem { state: 'completed'; completedAt: string }
interface ScheduleRunItem extends ScheduleRecordItem { ranAt: string }

function scheduleRule(item: ScheduleRecordItem): string {
  if (item.kind === 'every') return `每 ${Math.round((item.everySeconds ?? 0) / 60)} 分钟`
  if (item.kind === 'after') return `创建后 ${Math.round((item.afterSeconds ?? 0) / 60)} 分钟`
  return '指定时间'
}

function scheduleRecord(row: Partial<ScheduleRecordItem>): boolean {
  return typeof row.id === 'string' && typeof row.session_id === 'string' && typeof row.session_title === 'string'
    && ['after', 'at', 'every'].includes(String(row.kind)) && typeof row.prompt === 'string'
    && typeof row.scheduledAt === 'string'
}

function parseSchedules(response: unknown): {
  items: ScheduleItem[]
  completed: CompletedScheduleItem[]
  recentRuns: ScheduleRunItem[]
  errors: number
} {
  const value = response as { ok?: boolean; value?: {
    schema_version?: number
    items?: unknown[]
    completed?: unknown[]
    recent_runs?: unknown[]
    errors?: unknown[]
  }; error?: { message?: string } }
  if (value?.ok !== true || value.value?.schema_version !== 1 || !Array.isArray(value.value.items)
    || !Array.isArray(value.value.completed) || !Array.isArray(value.value.recent_runs)) {
    throw new Error(value?.error?.message ?? '定时任务暂时无法读取。')
  }
  const items = value.value.items.filter((item): item is ScheduleItem => {
    const row = item as Partial<ScheduleItem>
    return scheduleRecord(row) && ['scheduled', 'overdue'].includes(String(row.state))
  })
  const completed = value.value.completed.filter((item): item is CompletedScheduleItem => {
    const row = item as Partial<CompletedScheduleItem>
    return scheduleRecord(row) && row.state === 'completed' && typeof row.completedAt === 'string'
  })
  const recentRuns = value.value.recent_runs.filter((item): item is ScheduleRunItem => {
    const row = item as Partial<ScheduleRunItem>
    return scheduleRecord(row) && typeof row.ranAt === 'string'
  })
  if (items.length !== value.value.items.length || completed.length !== value.value.completed.length
    || recentRuns.length !== value.value.recent_runs.length) throw new Error('定时任务数据格式无效。')
  return { items, completed, recentRuns, errors: Array.isArray(value.value.errors) ? value.value.errors.length : 0 }
}

/** Register Schedule as one native @ reference provider; execution stays Agent-local. */
export function registerScheduleTrigger(ctx: any): void {
  const source: InputTriggerSource = {
    trigger: '@',
    name: '定时任务',
    order: -20,
    candidates(_session, { query }) {
      return Promise.resolve('定时任务'.includes(query)
        ? [{ name: '定时任务', description: '创建、查看或删除原生定时任务' }]
        : [])
    },
    lexicon() { return ['定时任务'] },
    onPick() {
      return { insert: { source: '定时任务', ref: 'schedule', label: '@定时任务', clipboardText: '@定时任务' } }
    },
    codec: {
      clipboardText: () => '@定时任务',
      serialize: (_ref, signal) => {
        signal.throwIfAborted()
        return Promise.resolve('@定时任务')
      },
    },
  }
  ctx.effect(() => ctx.inputTriggers.registerSource(source), 'e-mate-shell: @定时任务 source')
}

export function SchedulesPage({
  prepareSchedulePrompt,
  callSchedules,
  scheduleIcons,
  toggleSidebar,
  PanelIcon,
}: SchedulesPageProps) {
  const [target, setTarget] = useState<Element | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ScheduleItem[]>([])
  const [completed, setCompleted] = useState<CompletedScheduleItem[]>([])
  const [runs, setRuns] = useState<ScheduleRunItem[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [readErrors, setReadErrors] = useState(0)
  const CreateIcon = scheduleIcons.create
  const RefreshIcon = scheduleIcons.refresh

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = parseSchedules(await callSchedules())
      setItems(result.items)
      setCompleted(result.completed)
      setRuns(result.recentRuns)
      setReadErrors(result.errors)
    } catch (reason) {
      setItems([])
      setCompleted([])
      setRuns([])
      setReadErrors(0)
      setError(reason instanceof Error ? reason.message : '定时任务暂时无法读取。')
    } finally {
      setLoading(false)
    }
  }, [callSchedules])

  useEffect(() => { void refresh() }, [refresh])

  useLayoutEffect(() => {
    const findTarget = () => { setTarget(document.querySelector('[data-emate-product-surface]')) }
    findTarget()
    const observer = new MutationObserver(findTarget)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-phase'],
    })
    return () => { observer.disconnect() }
  }, [])

  if (target === null) return null

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = (item: ScheduleRecordItem) => normalizedQuery === ''
    || `${item.prompt} ${item.session_title} ${scheduleRule(item)}`.toLocaleLowerCase().includes(normalizedQuery)
  const visibleItems = items.filter(matches)
  const visibleCompleted = completed.filter(matches)
  const visibleRuns = runs.filter(matches)
  const visibleCount = visibleItems.length + visibleCompleted.length + visibleRuns.length
  const prepare = (key: string, prompt: string, sessionId?: string) => {
    setBusy(key)
    setError(null)
    const request = sessionId === undefined ? prepareSchedulePrompt(prompt) : prepareSchedulePrompt(prompt, sessionId)
    void request
      .catch(reason => { setError(reason instanceof Error ? reason.message : '定时任务会话暂时不可用。') })
      .finally(() => { setBusy(null) })
  }

  return createPortal(<>
    <header className={css.toolbar} data-emate-home-toolbar="">
      <button type="button" aria-label="切换任务导航" onClick={toggleSidebar}><PanelIcon size={18} /></button>
    </header>
    <main className={css.page} data-emate-schedules-page="" aria-labelledby="emate-schedules-title">
      <section className={css.schedules}>
        <header>
          <div><h1 id="emate-schedules-title">已安排的任务</h1><p>让小芯安排任务、设置提醒或持续跟进工作。</p></div>
          <div className={css.headerActions}>
            <button type="button" disabled={loading} onClick={() => { void refresh() }}><RefreshIcon size={16} />刷新</button>
            <button type="button" disabled={busy !== null} onClick={() => {
              prepare('create', '请帮我创建一个定时任务。先向我确认执行时间和任务内容，再调用 schedule_create 保存。')
            }}><CreateIcon size={16} />创建</button>
          </div>
        </header>
        <p className={css.editPolicy}>修改会先创建替代任务；只有新任务创建成功后，小芯才会删除旧任务。</p>
        <label className={css.search}>
          <input aria-label="搜索已安排任务" value={query} onChange={event => { setQuery(event.target.value) }} placeholder="搜索已安排任务" />
        </label>
        <section className={css.suggestions} aria-labelledby="emate-schedule-suggestions">
          <h2 id="emate-schedule-suggestions">建议</h2>
          <button type="button" disabled={busy !== null} onClick={() => {
            prepare('daily-summary', '请帮我创建每 24 小时执行一次的工作简报任务。先向我确认简报内容和首次开始时间，并说明固定周期从创建时刻起算；确认后调用 schedule_create 保存。')
          }}><CreateIcon size={18} /><span><strong>每日简报</strong><small>每 24 小时整理一次工作进展</small></span></button>
          <button type="button" disabled={busy !== null} onClick={() => {
            prepare('weekly-review', '请帮我创建每 7 天执行一次的工作回顾任务。先向我确认回顾范围和首次开始时间，并说明固定周期从创建时刻起算；确认后调用 schedule_create 保存。')
          }}><CreateIcon size={18} /><span><strong>每周回顾</strong><small>每 7 天整理一次近期工作</small></span></button>
          <button type="button" disabled={busy !== null} onClick={() => {
            prepare('follow-up', '请帮我创建一个跟进提醒任务。先向我确认要跟进的事项和提醒时间；确认后调用 schedule_create 保存。')
          }}><CreateIcon size={18} /><span><strong>跟进提醒</strong><small>在指定时间提醒重要事项</small></span></button>
        </section>
        <h2 className={css.listTitle}>当前任务</h2>
        <div className={css.cards}>
          {visibleItems.map(item => <article key={`${item.session_id}:${item.id}`}>
            <header><span className={item.state === 'overdue' ? css.overdue : undefined}>{item.state === 'overdue' ? '已逾期' : '已计划'}</span><small>{item.session_title}</small></header>
            <strong>{item.prompt}</strong>
            <dl><div><dt>规则</dt><dd>{scheduleRule(item)}</dd></div><div><dt>下次执行</dt><dd>{new Date(item.scheduledAt).toLocaleString()}</dd></div></dl>
            <footer>
              <button type="button" disabled={busy !== null} onClick={() => {
                prepare(item.id, `请修改定时任务 ${item.id}（当前内容：${JSON.stringify(item.prompt)}，下次执行：${item.scheduledAt}）。先向我确认新内容或时间；确认后先调用 schedule_create 创建替代任务，成功后再调用 schedule_delete 删除旧任务。`, item.session_id)
              }}><scheduleIcons.edit size={16} />修改</button>
              <button type="button" disabled={busy !== null} onClick={() => {
                prepare(item.id, `请删除定时任务 ${item.id}（内容：${JSON.stringify(item.prompt)}）。先调用 schedule_list 核对它仍存在并向我确认；只有收到确认后才调用 schedule_delete。`, item.session_id)
              }}><scheduleIcons.delete size={16} />删除</button>
            </footer>
          </article>)}
          {!loading && items.length === 0 && normalizedQuery === '' && <p className={css.empty}>当前没有待执行任务。点击“创建”后由小芯确认时间和内容。</p>}
        </div>
        {visibleCompleted.length > 0 && <>
          <h2 className={css.listTitle}>已完成</h2>
          <div className={css.cards}>
            {visibleCompleted.map(item => <article key={`completed:${item.session_id}:${item.id}`}>
              <header><span>已完成</span><small>{item.session_title}</small></header>
              <strong>{item.prompt}</strong>
              <dl><div><dt>规则</dt><dd>{scheduleRule(item)}</dd></div><div><dt>完成时间</dt><dd>{new Date(item.completedAt).toLocaleString()}</dd></div></dl>
            </article>)}
          </div>
        </>}
        {visibleRuns.length > 0 && <>
          <h2 className={css.listTitle}>最近运行</h2>
          <div className={css.cards}>
            {visibleRuns.map((item, index) => <article key={`run:${item.session_id}:${item.id}:${item.ranAt}:${index}`}>
              <header><span>已执行</span><small>{item.session_title}</small></header>
              <strong>{item.prompt}</strong>
              <dl><div><dt>计划时间</dt><dd>{new Date(item.scheduledAt).toLocaleString()}</dd></div><div><dt>执行记录</dt><dd>{new Date(item.ranAt).toLocaleString()}</dd></div></dl>
            </article>)}
          </div>
        </>}
        {!loading && normalizedQuery !== '' && visibleCount === 0 && <p className={css.empty}>没有匹配的定时任务。</p>}
        {readErrors > 0 && <p className={css.error} role="alert">有 {readErrors} 个会话的定时任务日志无法读取。</p>}
        {(loading || busy !== null) && <p className={css.status} role="status">{loading ? '正在读取定时任务…' : '正在打开所属会话…'}</p>}
        {error !== null && <p className={css.error} role="alert">{error}</p>}
      </section>
    </main>
  </>, target)
}
