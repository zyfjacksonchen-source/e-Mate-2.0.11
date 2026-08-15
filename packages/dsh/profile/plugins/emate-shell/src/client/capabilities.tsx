import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type FormEvent } from 'react'
import css from './capabilities.module.css'

type HubCategory = 'third_party' | 'content_creation' | 'office_productivity'

interface SkillCard {
  slug: string
  version: string
  package_sha256: string
  title: string
  summary: string
  category?: HubCategory
  tags: string[]
}

interface SkillDetail {
  skill: SkillCard
  versions: SkillCard[]
}

interface InstalledSkill {
  name: string
  description: string
  modelInvocable?: boolean
}

type CapabilityIconKey = 'browser' | 'collaboration' | 'image' | 'office' | 'ocr'
type IconComponent = ComponentType<{ size?: number }>

interface BuiltinCapability {
  id: string
  title: string
  summary: string
  icon_key: CapabilityIconKey
  order: number
  state: 'ready' | 'setup-required' | 'blocked' | 'failed'
  detail?: string
  actions: Array<{ id: string; label: string; kind: 'primary' | 'secondary' }>
}

interface SessionState {
  current?: string
}

interface RpcResult {
  ok: boolean
  value?: unknown
  error?: { message?: string }
}

interface Props {
  useSessions: <T>(selector: (state: SessionState) => T) => T
  callCapabilities: (endpoint: string, payload: Record<string, unknown>) => Promise<RpcResult>
  callSkillHub: (endpoint: string, payload: Record<string, unknown>) => Promise<RpcResult>
  listInstalled: (sessionId: string) => Promise<InstalledSkill[]>
  startSession: () => void
  SearchIcon: ComponentType<{ size?: number }>
  DownloadIcon: ComponentType<{ size?: number }>
  CloseIcon: ComponentType<{ size?: number }>
  RefreshIcon: ComponentType<{ size?: number }>
  SkillIcon: ComponentType<{ size?: number }>
  capabilityIcons: Record<CapabilityIconKey, IconComponent>
}

interface ControlProps {
  wide: boolean
  SkillIcon: ComponentType<{ size?: number }>
}

type Tab = 'discover' | 'installed' | 'upload'
type JobState = {
  id: string
  label: string
  status: string
  detail?: string
  download?: { href: string; filename: string }
}

const CAPABILITY_STATE_LABELS: Record<BuiltinCapability['state'], string> = {
  ready: '可使用',
  'setup-required': '需要配置',
  blocked: '暂未启用',
  failed: '状态异常',
}

const CAPABILITY_CATEGORY_LABELS: Record<CapabilityIconKey, string> = {
  browser: '系统能力',
  office: '办公能力',
  image: '图像 / 媒体',
  collaboration: '通道',
  ocr: '数据能力',
}

const HUB_CATEGORY_LABELS: Record<HubCategory, string> = {
  third_party: '第三方',
  content_creation: '内容创作',
  office_productivity: '办公效率',
}

const JOB_STATUS_LABELS: Record<string, string> = {
  running: '进行中',
  stopping: '正在取消',
  completed: '已完成',
  failed: '失败',
  killed: '已取消',
}

function CapabilityGlyph({ capability, icons, fallback: Fallback }: {
  capability: BuiltinCapability
  icons: Record<CapabilityIconKey, IconComponent>
  fallback: IconComponent
}) {
  const Icon = icons[capability.icon_key] ?? Fallback
  return <span className={css.capabilityAvatar} data-icon={capability.icon_key}><Icon size={20} /></span>
}

function route(path: string): void {
  if (location.pathname === path) return
  history.pushState(null, '', path)
  dispatchEvent(new PopStateEvent('popstate'))
}

function message(error: unknown): string {
  const detail = error instanceof Error ? error.message : ''
  return detail.includes('/emate.skillHub/')
    ? '社区 Skill 暂时不可用；内置能力仍可正常使用。'
    : detail || '能力中心暂不可用，请稍后重试。'
}

function rpcValue(result: RpcResult, fallback: string): unknown {
  if (!result.ok) throw new Error(result.error?.message ?? fallback)
  return result.value
}

function archiveBase64(file: File): Promise<string> {
  if (file.size < 1 || file.size > 10 * 1024 * 1024) {
    throw new Error('Skill ZIP 必须大于 0 且不超过 10 MiB。')
  }
  return file.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }
    return btoa(binary)
  })
}

function downloadFromOutput(output: unknown): JobState['download'] {
  if (typeof output !== 'string' || output.length > 4096) return undefined
  try {
    const value = JSON.parse(output) as Record<string, unknown>
    if (typeof value.download_id !== 'string'
      || !/^[A-Za-z0-9.-]{8,256}$/u.test(value.download_id)
      || typeof value.slug !== 'string'
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.slug)
      || typeof value.version !== 'string'
      || !/^[0-9A-Za-z.-]{1,128}$/u.test(value.version)) return undefined
    return {
      href: `/api/e-mate/skill-hub.download?id=${encodeURIComponent(value.download_id)}`,
      filename: `e-mate-skill-${value.slug}-${value.version}.zip`,
    }
  } catch {
    return undefined
  }
}

function normal(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN')
}

export function CapabilityControl({ wide, SkillIcon }: ControlProps) {
  return (
    <button className={css.sidebarAction} data-wide={wide || undefined} type="button" aria-label="能力中心" onClick={() => { route('/capabilities') }}>
      <SkillIcon size={18} />
      {wide && <span>能力中心</span>}
    </button>
  )
}

export function CapabilitiesPage({
  useSessions,
  callCapabilities,
  callSkillHub,
  listInstalled,
  startSession,
  SearchIcon,
  DownloadIcon,
  CloseIcon,
  RefreshIcon,
  SkillIcon,
  capabilityIcons,
}: Props) {
  const currentSession = useSessions(state => state.current)
  const pageRef = useRef<HTMLElement>(null)
  const detailSlug = useRef<string | null>(null)
  const [open, setOpen] = useState(() => location.pathname === '/capabilities')
  const [left, setLeft] = useState(280)
  const [tab, setTab] = useState<Tab>('discover')
  const [query, setQuery] = useState('')
  const [installedQuery, setInstalledQuery] = useState('')
  const [items, setItems] = useState<SkillCard[]>([])
  const [builtins, setBuiltins] = useState<BuiltinCapability[]>([])
  const [installed, setInstalled] = useState<InstalledSkill[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [job, setJob] = useState<JobState | null>(null)
  const [upload, setUpload] = useState<File | null>(null)
  const [category, setCategory] = useState<HubCategory>('office_productivity')
  const [hubCategory, setHubCategory] = useState<HubCategory | 'all'>('all')
  const [hubTag, setHubTag] = useState('')
  const [capabilityCategory, setCapabilityCategory] = useState<CapabilityIconKey | 'all'>('all')
  const [capabilityNotice, setCapabilityNotice] = useState<string | null>(null)
  const [selectedCard, setSelectedCard] = useState<SkillCard | null>(null)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    const sync = () => { setOpen(location.pathname === '/capabilities') }
    addEventListener('popstate', sync)
    return () => { removeEventListener('popstate', sync) }
  }, [])

  useEffect(() => {
    if (selectedCard === null) return undefined
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      detailSlug.current = null
      setSelectedCard(null)
      setDetail(null)
    }
    addEventListener('keydown', close)
    return () => { removeEventListener('keydown', close) }
  }, [selectedCard])

  useLayoutEffect(() => {
    if (!open || pageRef.current === null) return undefined
    const overlay = pageRef.current.closest<HTMLElement>('[data-shell-overlay]')
    const frame = overlay?.parentElement
    const sidebar = frame?.firstElementChild
    if (!(sidebar instanceof HTMLElement)) return undefined
    const measure = () => { setLeft(sidebar.getBoundingClientRect().width) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(sidebar)
    return () => { observer.disconnect() }
  }, [open])

  const loadCatalog = async (nextQuery = query) => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const capabilities = rpcValue(await callCapabilities('list', {}), '内置能力读取失败。') as { schema_version?: unknown; items?: unknown }
      if (capabilities.schema_version !== 1 || !Array.isArray(capabilities.items)) throw new Error('内置能力注册表无效。')
      setBuiltins(capabilities.items as BuiltinCapability[])
      try {
        const value = rpcValue(await callSkillHub('catalog.search', { query: nextQuery.trim() }), 'Skill Hub 读取失败。') as { items?: unknown }
        if (!Array.isArray(value?.items)) throw new Error('Skill Hub 返回了无效目录。')
        setItems(value.items as SkillCard[])
      } catch (skillHubError) {
        setItems([])
        setError(message(skillHubError))
      }
    } catch (loadError) {
      setError(message(loadError))
    } finally {
      setLoading(false)
    }
  }

  const loadInstalled = async () => {
    if (loading || currentSession === undefined) return
    setLoading(true)
    setError(null)
    try {
      setInstalled(await listInstalled(currentSession))
    } catch (loadError) {
      setError(message(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open) return
    if (tab === 'discover' && items.length === 0) void loadCatalog('')
    if (tab === 'installed' && currentSession !== undefined) void loadInstalled()
  }, [currentSession, open, tab])

  useEffect(() => {
    if (job === null || !['running', 'stopping'].includes(job.status)) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      void callSkillHub('jobs.read', { job_id: job.id }).then(result => {
        if (cancelled) return
        const value = rpcValue(result, 'Skill Job 状态读取失败。') as { status?: string; detail?: string; output?: unknown }
        if (typeof value.status !== 'string') throw new Error('Skill Job 状态无效。')
        setJob(previous => {
          if (previous?.id !== job.id) return previous
          const next: JobState = { ...previous, status: value.status! }
          if (value.detail === undefined) delete next.detail
          else next.detail = value.detail
          const download = value.status === 'completed' ? downloadFromOutput(value.output) : undefined
          if (download === undefined) delete next.download
          else next.download = download
          return next
        })
      }).catch(readError => { if (!cancelled) setError(message(readError)) })
    }, 500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [callSkillHub, job])

  const startJob = async (endpoint: 'skills.install' | 'skills.download' | 'skills.publish', payload: Record<string, unknown>, label: string) => {
    if (job !== null && ['running', 'stopping'].includes(job.status)) return
    setError(null)
    try {
      const value = rpcValue(await callSkillHub(endpoint, payload), `${label}启动失败。`) as { job_id?: string; status?: string }
      if (typeof value.job_id !== 'string' || value.status !== 'running') throw new Error(`${label}未返回有效 Job。`)
      setJob({ id: value.job_id, status: value.status, label })
    } catch (operationError) {
      setError(message(operationError))
    }
  }

  const cancelJob = async () => {
    if (job === null || !['running', 'stopping'].includes(job.status)) return
    setError(null)
    try {
      rpcValue(await callSkillHub('jobs.cancel', { job_id: job.id }), 'Skill Job 取消失败。')
    } catch (cancelError) {
      setError(message(cancelError))
    }
  }

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void loadCatalog()
  }

  const publish = async () => {
    if (upload === null) return
    try {
      const bundle = await archiveBase64(upload)
      await startJob('skills.publish', { bundle_base64: bundle, category }, `发布 ${upload.name}`)
    } catch (publishError) {
      setError(message(publishError))
    }
  }

  const runCapabilityAction = async (capability: BuiltinCapability, actionId: string) => {
    if (loading) return
    setLoading(true)
    setError(null)
    setCapabilityNotice(null)
    let succeeded = false
    try {
      rpcValue(await callCapabilities('action', {
        capability_id: capability.id,
        action_id: actionId,
        data: {},
      }), '能力操作失败。')
      setCapabilityNotice(`${capability.title} 已提交操作。`)
      succeeded = true
    } catch (actionError) {
      setError(message(actionError))
    } finally {
      setLoading(false)
    }
    if (succeeded) await loadCatalog(query)
  }

  const openDetail = async (card: SkillCard) => {
    detailSlug.current = card.slug
    setSelectedCard(card)
    setDetail(null)
    setDetailLoading(true)
    setError(null)
    try {
      const value = rpcValue(await callSkillHub('catalog.detail', { slug: card.slug }), 'Skill 详情读取失败。') as { skill?: unknown; versions?: unknown }
      if (!value.skill || !Array.isArray(value.versions)) throw new Error('Skill 详情返回了无效数据。')
      if (detailSlug.current === card.slug) setDetail(value as SkillDetail)
    } catch (detailError) {
      if (detailSlug.current === card.slug) setError(message(detailError))
    } finally {
      if (detailSlug.current === card.slug) setDetailLoading(false)
    }
  }

  const closeDetail = () => {
    detailSlug.current = null
    setSelectedCard(null)
    setDetail(null)
    setDetailLoading(false)
  }

  const capabilityCategories = useMemo(() => Array.from(new Set(builtins.map(item => item.icon_key))), [builtins])
  const visibleBuiltins = useMemo(() => builtins
    .filter(item => capabilityCategory === 'all' || item.icon_key === capabilityCategory)
    .sort((leftItem, rightItem) => leftItem.order - rightItem.order), [builtins, capabilityCategory])
  const visibleItems = useMemo(() => {
    const tag = normal(hubTag)
    return items.filter(item => (hubCategory === 'all' || item.category === hubCategory)
      && (!tag || item.tags.some(value => normal(value).includes(tag))))
  }, [hubCategory, hubTag, items])
  const visibleInstalled = useMemo(() => {
    const needle = normal(installedQuery)
    return installed.filter(item => !needle || normal(`${item.name} ${item.description}`).includes(needle))
  }, [installed, installedQuery])

  if (!open) return null

  return (
    <main ref={pageRef} className={css.page} style={{ left }} data-emate-capabilities="">
      <section className={css.workspace} aria-label="能力中心">
        <header className={css.header}>
          <div><h1>能力中心</h1><p>发现、安装并管理 e-Mate 的办公能力。</p></div>
          <div className={css.headerActions}>
            <button type="button" aria-label={loading ? '正在刷新能力' : '刷新能力'} disabled={loading} onClick={() => { if (tab === 'installed') void loadInstalled(); else void loadCatalog() }}><RefreshIcon size={16} /></button>
          </div>
        </header>

        <div className={css.tabs} role="tablist" aria-label="能力中心页面">
          <button type="button" role="tab" aria-selected={tab === 'discover'} onClick={() => { setTab('discover') }}>发现</button>
          <button type="button" role="tab" aria-selected={tab === 'installed'} onClick={() => { setTab('installed') }}>已安装 <span>{installed.length}</span></button>
            <button type="button" role="tab" aria-selected={tab === 'upload'} onClick={() => { setTab('upload') }}>导入</button>
        </div>

        {error && <div className={css.error} role="alert"><span>{error}</span><button type="button" aria-label="关闭错误" onClick={() => { setError(null) }}><CloseIcon size={16} /></button></div>}
        {capabilityNotice && <div className={css.notice} role="status">{capabilityNotice}</div>}
        {job && <div className={css.job} role="status"><span>{job.label}</span><strong>{JOB_STATUS_LABELS[job.status] ?? job.status}</strong>{job.detail && <small>{job.detail}</small>}{job.download && <a href={job.download.href} download={job.download.filename}>保存 ZIP</a>}{['running', 'stopping'].includes(job.status) ? <button type="button" onClick={() => { void cancelJob() }}>取消</button> : <button type="button" aria-label="关闭任务状态" onClick={() => { setJob(null) }}><CloseIcon size={16} /></button>}</div>}

        {tab === 'discover' && (
          <section className={css.content} aria-label="e-Mate Skill Hub">
            <section className={css.community} aria-label="Skill Hub">
              <form className={css.filterRow} onSubmit={search}>
                <label className={css.search}><SearchIcon size={16} /><input type="search" value={query} placeholder="搜索 Skill Hub" maxLength={128} onChange={event => setQuery(event.target.value)} /></label>
                <select aria-label="市场分类" value={hubCategory} onChange={event => setHubCategory(event.target.value as HubCategory | 'all')}><option value="all">全部市场</option><option value="third_party">第三方</option><option value="content_creation">内容创作</option><option value="office_productivity">办公效率</option></select>
                <input aria-label="按标签筛选" value={hubTag} placeholder="标签" onChange={event => setHubTag(event.target.value)} />
                <button className={css.uploadAction} type="button" onClick={() => { setTab('upload') }}><DownloadIcon size={16} />上传 Skill</button>
              </form>
              {loading && items.length === 0 ? <p className={css.empty}>正在读取 e-Mate Skill Hub…</p> : null}
              {!loading && visibleItems.length === 0 ? <p className={css.empty}>没有匹配的 Skill。</p> : null}
              <div className={css.hubGrid}>
                {visibleItems.map(card => (
                  <article className={css.hubCard} key={`${card.slug}:${card.version}`}>
                    <div className={css.hubCardHead}><span className={css.hubAvatar}><SkillIcon size={20} /></span><span><strong>{card.title}</strong><small>{card.slug}</small></span></div>
                    <p>{card.summary}</p>
                    <div className={css.tags}>{card.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
                    <footer>
                      <span>v{card.version}{card.category ? ` · ${HUB_CATEGORY_LABELS[card.category]}` : ''}</span>
                      <div className={css.hubActions}>
                        <button type="button" disabled={detailLoading && selectedCard?.slug === card.slug} onClick={() => { void openDetail(card) }}>{detailLoading && selectedCard?.slug === card.slug ? '读取中' : '查看详情'}</button>
                        <button className={css.primary} type="button" disabled={job !== null && ['running', 'stopping'].includes(job.status)} onClick={() => { void startJob('skills.install', { slug: card.slug, version: card.version }, `安装 ${card.slug}@${card.version}`) }}>安装并启用</button>
                      </div>
                    </footer>
                  </article>
                ))}
              </div>
            </section>

            <details className={css.builtins}>
              <summary><span>本机内置能力</span><small>{builtins.length}</small></summary>
              <div className={css.builtinsBody}>
                {capabilityCategories.length > 0 && <div className={css.categoryFilter} role="group" aria-label="内置能力分类">
                  <button type="button" aria-pressed={capabilityCategory === 'all'} onClick={() => { setCapabilityCategory('all') }}><SkillIcon size={14} /><span>全部分类</span></button>
                  {capabilityCategories.map(item => {
                    const Icon = capabilityIcons[item] ?? SkillIcon
                    return <button type="button" key={item} aria-pressed={capabilityCategory === item} onClick={() => { setCapabilityCategory(item) }}><Icon size={14} /><span>{CAPABILITY_CATEGORY_LABELS[item]}</span></button>
                  })}
                </div>}
                {loading && builtins.length === 0 ? <p className={css.empty}>正在读取能力目录…</p> : null}
                {!loading && builtins.length > 0 && visibleBuiltins.length === 0 ? <p className={css.empty}>该分类暂无能力。</p> : null}
                <div className={css.capabilityGrid}>
                  {visibleBuiltins.map(capability => <article className={css.capabilityCard} key={capability.id} data-state={capability.state}>
                    <div className={css.capabilityMain}><CapabilityGlyph capability={capability} icons={capabilityIcons} fallback={SkillIcon} /><span className={css.capabilityCopy}><strong>{capability.title}</strong><small>{capability.summary}</small><em>{CAPABILITY_CATEGORY_LABELS[capability.icon_key]} · {CAPABILITY_STATE_LABELS[capability.state]}</em></span></div>
                    {capability.actions.length > 0 && <div className={css.capabilityActions}>{capability.actions.map(action => <button className={action.kind === 'primary' ? css.primary : undefined} type="button" key={action.id} disabled={loading} onClick={() => { void runCapabilityAction(capability, action.id) }}>{action.label}</button>)}</div>}
                    {capability.detail && <p className={css.capabilityDetail}>{capability.detail}</p>}
                  </article>)}
                </div>
              </div>
            </details>
          </section>
        )}

        {tab === 'installed' && (
          <section className={css.content} aria-label="已安装 Skill">
            {currentSession === undefined ? <div className={css.empty}><p>请先新建会话，以读取当前 Agent 预设真实可用的 Skill。</p><button type="button" onClick={startSession}>新建会话</button></div> : null}
            {currentSession !== undefined && <div className={css.filterRow}><label className={css.search}><SearchIcon size={16} /><input type="search" value={installedQuery} placeholder="搜索已安装 Skill" onChange={event => setInstalledQuery(event.target.value)} /></label></div>}
            {currentSession !== undefined && loading ? <p className={css.empty}>正在读取当前会话 Skill…</p> : null}
            {currentSession !== undefined && !loading && visibleInstalled.length === 0 ? <p className={css.empty}>当前会话没有匹配的 Skill。</p> : null}
            <div className={css.capabilityGrid}>
              {visibleInstalled.map(skill => <article className={css.capabilityCard} key={skill.name}><div className={css.capabilityMain}><span className={css.capabilityAvatar}><SkillIcon size={20} /></span><span className={css.capabilityCopy}><strong>{skill.name}</strong><small>{skill.description}</small><em>{skill.modelInvocable === false ? '仅用户调用' : 'Agent 可调用'}</em></span></div></article>)}
            </div>
          </section>
        )}

        {tab === 'upload' && (
          <section className={`${css.content} ${css.skillMarket}`} aria-label="发布 Skill 到 e-Mate">
            <section className={css.upload}>
              <div><SkillIcon size={20} /><span><strong>发布到 e-Mate Skill Hub</strong><small>仅接受不超过 10 MiB 的声明式 Skill ZIP；slug 和版本来自包内 SKILL.md，已发布版本不可覆盖。</small></span></div>
              <label><span>市场分类</span><select value={category} onChange={event => setCategory(event.target.value as HubCategory)}><option value="third_party">第三方</option><option value="content_creation">内容创作</option><option value="office_productivity">办公效率</option></select></label>
              <label><span>选择 Skill ZIP</span><input type="file" accept=".zip,application/zip" onChange={event => setUpload(event.target.files?.[0] ?? null)} /></label>
              <button className={css.primary} type="button" disabled={upload === null || (job !== null && ['running', 'stopping'].includes(job.status))} onClick={() => { void publish() }}>验证并发布</button>
            </section>
          </section>
        )}
      </section>

      {selectedCard && <div className={css.dialogOverlay} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeDetail() }}>
        <section className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="emate-skill-detail-title" aria-describedby="emate-skill-detail-description">
          <h2 id="emate-skill-detail-title">{selectedCard.title}</h2>
          <p id="emate-skill-detail-description">{selectedCard.summary}</p>
          <dl className={css.detailList}>
            <div><dt>slug</dt><dd>{selectedCard.slug}</dd></div>
            <div><dt>版本</dt><dd>{selectedCard.version}</dd></div>
            {selectedCard.category && <div><dt>市场分类</dt><dd>{HUB_CATEGORY_LABELS[selectedCard.category]}</dd></div>}
            <div><dt>内容摘要</dt><dd><code>{selectedCard.package_sha256}</code></dd></div>
          </dl>
          {detailLoading ? <p className={css.detailLoading}>正在读取版本历史…</p> : null}
          {detail && <div className={css.versions}><strong>版本历史</strong><ul>{detail.versions.map(version => <li key={version.version}><span>v{version.version}</span><code>{version.package_sha256.slice(0, 12)}…</code></li>)}</ul></div>}
          <p className={css.installNote}>e-Mate 会在当前设备创建绑定账号、版本和摘要的单次安装意图。</p>
          {job && <p className={css.dialogJob} role="status">{job.label} · {JOB_STATUS_LABELS[job.status] ?? job.status}</p>}
          <div className={css.dialogActions}>
            <button type="button" disabled={job !== null && ['running', 'stopping'].includes(job.status)} onClick={() => { void startJob('skills.download', { slug: selectedCard.slug, version: selectedCard.version }, `下载 ${selectedCard.slug}@${selectedCard.version}`) }}><DownloadIcon size={16} />下载 ZIP</button>
            <button className={css.primary} type="button" disabled={job !== null && ['running', 'stopping'].includes(job.status)} onClick={() => { void startJob('skills.install', { slug: selectedCard.slug, version: selectedCard.version }, `安装 ${selectedCard.slug}@${selectedCard.version}`) }}>安装并启用</button>
          </div>
          <button className={css.dialogClose} type="button" aria-label="关闭 Skill 详情" onClick={closeDetail}><CloseIcon size={16} /></button>
        </section>
      </div>}
    </main>
  )
}
