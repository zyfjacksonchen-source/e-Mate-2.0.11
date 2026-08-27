import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  compareSkillVersions,
  createSkillHubClient,
  createSkillHubStore,
  skillHubFailure,
  SkillHubOperationError,
  SkillHubRecoveryPendingError,
} from './skill-hub.js'

export const name = 'emate-skill-hub'
export const inject = ['tools', 'jobs', 'skills', 'userQuestions', 'systemPrompt', 'emateIdentity', 'connection', 'webServer']
export const SKILL_HUB_CHANNEL = '/emate.skillHub'
const SKILL_SLUG = /^(?=.{2,96}$)[a-z0-9]+(?:-[a-z0-9]+)*$/u
const SKILL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u
const DOWNLOAD_TTL_MS = 5 * 60 * 1_000
const MAX_BROWSER_DOWNLOADS = 32

const JOB_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    job_id: { type: 'string', required: true },
    status: { type: 'string', required: true, const: 'running' },
  },
}

function startJob(ctx, owner, signal, label, operation) {
  signal?.throwIfAborted()
  const jobId = ctx.jobs.start({
    kind: 'emate-skill',
    label,
    ...(owner === undefined ? {} : { owner }),
    outputLimitBytes: 32 * 1024,
    run: () => {
      const controller = new AbortController()
      const done = Promise.resolve()
        .then(() => operation(controller.signal))
        .then(
          value => ({ status: 'completed', detail: label, output: JSON.stringify(value) }),
          error => ({
            status: controller.signal.aborted && !(error instanceof SkillHubRecoveryPendingError) ? 'killed' : 'failed',
            detail: error instanceof Error ? error.message : String(error),
            output: JSON.stringify({ schema_version: 1, error: skillHubFailure(error) }),
          }),
        )
      return { cancel: reason => controller.abort(reason), done }
    },
  })
  return { job_id: jobId, status: 'running' }
}

function badRequest(message) {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, required, optional = []) {
  const keys = Object.keys(value).sort()
  return required.every(key => keys.includes(key))
    && keys.every(key => required.includes(key) || optional.includes(key))
}

function skillTarget(payload) {
  return exactKeys(payload, ['slug'], ['version'])
    && typeof payload.slug === 'string' && SKILL_SLUG.test(payload.slug)
    && (payload.version === undefined || (typeof payload.version === 'string' && SKILL_VERSION.test(payload.version)))
}

function localSkillTarget(payload) {
  return exactKeys(payload, ['slug']) && typeof payload.slug === 'string' && SKILL_SLUG.test(payload.slug)
}

function inside(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function workspaceSkillArchive(agent, identity) {
  const parts = typeof identity === 'string' ? identity.split('/') : []
  const name = parts[2]
  if (parts.length !== 3 || parts[0] !== '.e-mate' || parts[1] !== 'imports'
    || name === '' || name !== name.normalize('NFC') || !name.toLowerCase().endsWith('.zip')
    || Buffer.byteLength(name) > 200 || /[\x00-\x1f\x7f\\]/u.test(name)) {
    throw new Error('Skill publication artifact identity is invalid')
  }
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string') throw new Error('Skill publication artifact requires a session workspace')
  const root = realpathSync(cwd)
  const state = join(root, '.e-mate')
  const importPath = join(state, 'imports')
  for (const directory of [state, importPath]) {
    const info = lstatSync(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Skill publication import boundary is invalid')
  }
  const imports = realpathSync(importPath)
  const selected = join(root, ...parts)
  const selectedInfo = lstatSync(selected)
  if (!selectedInfo.isFile() || selectedInfo.isSymbolicLink() || selectedInfo.nlink !== 1) {
    throw new Error('Skill publication artifact must be one bounded regular ZIP')
  }
  const target = realpathSync(selected)
  if (!inside(root, imports) || !inside(imports, target)) throw new Error('Skill publication artifact is outside the session import boundary')
  const before = lstatSync(target)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 10 * 1024 * 1024) {
    throw new Error('Skill publication artifact must be one bounded regular ZIP')
  }
  const payload = readFileSync(target)
  const after = lstatSync(target)
  if (!after.isFile() || after.isSymbolicLink() || after.nlink !== 1
    || after.dev !== before.dev || after.ino !== before.ino
    || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error('Skill publication artifact changed while it was being read')
  }
  return payload
}

async function confirmMutation(ctx, exec, { id, header, question, detail, approve }) {
  if (exec.agent === undefined) throw new Error('Skill Hub mutation requires an owning Agent session')
  const answer = await ctx.userQuestions.ask({
    agent: exec.agent,
    signal: exec.signal,
    questions: [{
      id,
      header,
      question,
      detail,
      options: [
        { label: approve, description: '执行上面显示的精确 Skill Hub 操作。' },
        { label: '取消', description: '不联网，也不修改本机或已发布 Skill。' },
      ],
    }],
  })
  if (answer.answers[0]?.selected.includes(approve) !== true) throw new Error('Skill Hub operation was cancelled by the user')
}

const jobOutput = {
  schema: JOB_SCHEMA,
  render: (_args, value) => [{ type: 'text', text: `Started e-Mate Skill Hub job ${value.job_id}.` }],
}

export async function nativeCandidate(ctx, root, slug, signal) {
  const lifecycle = new AbortController()
  const provider = new FileSystemSkillProvider(ctx, {
    signal: lifecycle.signal,
    invalidate() {},
  }, {
    providerName: `emate-skill-hub-candidate-${slug}`,
    includeDefaultRoots: false,
    customSkillDirs: [root],
    watch: false,
  })
  try {
    const observed = await provider.list({ signal })
    const candidates = Array.isArray(observed) ? observed : observed.candidates
    const expected = resolve(root, slug, 'SKILL.md')
    const candidate = candidates.find(value => value.name === slug && value.path !== undefined && resolve(value.path) === expected)
    if (candidate === undefined || candidates.some(value => value.name === slug && value !== candidate)) {
      throw new Error(`Skill ${slug} is not uniquely visible to the native DSH parser`)
    }
    const definition = await provider.get(candidate, { signal })
    if (definition === undefined || definition.name !== slug || definition.path === undefined
      || resolve(definition.path) !== expected || definition.resourceBase?.kind !== 'directory'
      || resolve(definition.resourceBase.path) !== resolve(root, slug)) {
      throw new Error(`Skill ${slug} cannot be loaded by the native DSH provider`)
    }
    return definition
  } catch (error) {
    throw new SkillHubOperationError('native-provider', error instanceof Error ? error.message : String(error), { cause: error })
  } finally {
    lifecycle.abort(new Error('candidate validation complete'))
    await provider.dispose()
  }
}

export async function apply(ctx, config = {}) {
  const identity = ctx.get('emateIdentity')
  if (identity === undefined) throw new Error('e-Mate Skill Hub requires emateIdentity')
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  let activeProvider
  let invalidateActive = () => {}
  ctx.skills.registerProvider(control => {
    invalidateActive = control.invalidate
    activeProvider = new FileSystemSkillProvider(ctx, control, {
      providerName: 'emate-skill-hub',
      includeDefaultRoots: false,
      customSkillDirs: [join(dshHome, 'skills')],
      dshHome,
      watch: false,
    })
    return activeProvider
  })
  ctx.effect(function* () {
    yield async () => { await activeProvider?.dispose() }
  }, 'emate.skillHub: native provider')
  const activeDefinition = async (path, slug, signal) => {
    try {
      invalidateActive()
      const definition = await ctx.skills.get(slug, { signal })
      if (definition === undefined || definition.path === undefined
        || resolve(definition.path) !== resolve(path, 'SKILL.md')
        || definition.resourceBase?.kind !== 'directory'
        || resolve(definition.resourceBase.path) !== resolve(path)) {
        throw new Error(`Skill ${slug} is not active through the native DSH registry`)
      }
      return definition
    } catch (error) {
      throw new SkillHubOperationError('native-provider', error instanceof Error ? error.message : String(error), { cause: error })
    }
  }
  const store = createSkillHubStore({
    dshHome,
    validateCandidate: (root, slug, signal) => nativeCandidate(ctx, root, slug, signal),
    validateActive: activeDefinition,
    validateAbsent: async (path, slug, signal) => {
      try {
        invalidateActive()
        const definition = await ctx.skills.get(slug, { signal })
        if (definition?.path !== undefined && resolve(definition.path) === resolve(path)) {
          throw new Error(`Skill ${slug} remains visible through the native DSH registry`)
        }
      } catch (error) {
        throw new SkillHubOperationError('native-provider', error instanceof Error ? error.message : String(error), { cause: error })
      }
    },
    invalidate: invalidateActive,
  })
  const hub = createSkillHubClient({
    request: identity.request.bind(identity),
    dshHome,
    store,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  })
  const browserDownloadRoot = join(dshHome, 'e-mate', 'cache', 'skill-hub', 'downloads')
  rmSync(browserDownloadRoot, { recursive: true, force: true })
  const browserDownloads = new Map()
  ctx.jobs.attachController('emate-skill-hub-ui')
  ctx.effect(() => {
    const controller = new AbortController()
    void hub.recover(controller.signal).then(results => {
      for (const result of results) {
        if (result.status === 'recovery-pending') ctx.logger.warn(`Skill Hub recovery remains pending for ${result.slug}: ${result.error ?? 'control plane unavailable'}`)
      }
    }).catch(error => { ctx.logger.warn(`Skill Hub startup recovery failed: ${error instanceof Error ? error.message : String(error)}`) })
    return () => { controller.abort(new Error('Skill Hub disposed')) }
  }, 'emate.skillHub: startup recovery')

  const pruneDownloads = () => {
    const now = Date.now()
    for (const [id, receipt] of browserDownloads) {
      if (receipt.expires_at > now && browserDownloads.size <= MAX_BROWSER_DOWNLOADS) continue
      browserDownloads.delete(id)
      rmSync(receipt.path, { force: true })
    }
  }
  const registerDownload = (result) => {
    browserDownloads.set(result.download_id, {
      path: join(browserDownloadRoot, `${result.download_id}.zip`),
      filename: `e-mate-skill-${result.slug}-${result.version}.zip`,
      sha256: result.archive_sha256,
      expires_at: Date.now() + DOWNLOAD_TTL_MS,
    })
    pruneDownloads()
    return result
  }
  ctx.effect(() => () => {
    browserDownloads.clear()
    rmSync(browserDownloadRoot, { recursive: true, force: true })
  }, 'emate.skillHub: browser download cache')

  const uiJob = id => {
    try {
      const snapshot = ctx.jobs.get(id)
      return snapshot.kind === 'emate-skill' && snapshot.ownerSession === undefined ? snapshot : undefined
    } catch {
      return undefined
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/e-mate/skill-hub.download',
    handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        res.end()
        return
      }
      const ids = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.getAll('id')
      if (ids.length !== 1) {
        res.writeHead(400)
        res.end('one download id is required')
        return
      }
      const receipt = browserDownloads.get(ids[0])
      if (receipt === undefined || receipt.expires_at <= Date.now()) {
        if (receipt !== undefined) rmSync(receipt.path, { force: true })
        browserDownloads.delete(ids[0])
        res.writeHead(404)
        res.end('download not found')
        return
      }
      let payload
      try {
        payload = readFileSync(receipt.path)
      } catch {
        browserDownloads.delete(ids[0])
        res.writeHead(404)
        res.end('download not found')
        return
      }
      if (createHash('sha256').update(payload).digest('hex') !== receipt.sha256) {
        browserDownloads.delete(ids[0])
        rmSync(receipt.path, { force: true })
        res.writeHead(409)
        res.end('download integrity check failed')
        return
      }
      res.writeHead(200, {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${receipt.filename}"`,
        'Content-Length': payload.byteLength,
        'Content-Type': 'application/zip',
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : payload)
      if (req.method === 'GET') {
        browserDownloads.delete(ids[0])
        rmSync(receipt.path, { force: true })
      }
    },
  }), 'emate.skillHub: verified browser download')

  const skillHubRpc = async (endpoint, payload, signal) => {
      if (!isRecord(payload)) return badRequest('e-Mate Skill Hub payload must be an object')
      if (endpoint === 'catalog.search') {
        if (!exactKeys(payload, [], ['query', 'category', 'tag', 'source', 'cursor', 'limit'])) {
          return badRequest('catalog.search payload is invalid')
        }
        return { ok: true, value: await hub.search(payload, signal) }
      }
      if (endpoint === 'catalog.detail') {
        if (!exactKeys(payload, ['slug'], ['cursor', 'limit']) || typeof payload.slug !== 'string'
          || (payload.cursor !== undefined && typeof payload.cursor !== 'string')
          || (payload.limit !== undefined && typeof payload.limit !== 'number')) {
          return badRequest('catalog.detail payload is invalid')
        }
        return { ok: true, value: await hub.detail(payload.slug, { cursor: payload.cursor, limit: payload.limit }, signal) }
      }
      if (endpoint === 'inventory.list') {
        if (!exactKeys(payload, [])) return badRequest('inventory.list payload is invalid')
        return { ok: true, value: { schema_version: 1, items: await hub.inventory(signal) } }
      }
      if (endpoint === 'skills.install' || endpoint === 'skills.update' || endpoint === 'skills.download') {
        const update = endpoint === 'skills.update'
        const valid = update
          ? exactKeys(payload, ['slug'], ['version', 'allow_downgrade'])
            && typeof payload.slug === 'string' && SKILL_SLUG.test(payload.slug)
            && (payload.version === undefined || (typeof payload.version === 'string' && SKILL_VERSION.test(payload.version)))
            && (payload.allow_downgrade === undefined || typeof payload.allow_downgrade === 'boolean')
          : skillTarget(payload)
        if (!valid) return badRequest(`${endpoint} payload is invalid`)
        const action = endpoint === 'skills.install' ? 'Install' : endpoint === 'skills.update' ? 'Update' : 'Download'
        const operation = endpoint === 'skills.install' ? hub.install : endpoint === 'skills.update' ? hub.update : hub.download
        const started = startJob(ctx, undefined, signal, `${action} e-Mate Skill: ${payload.slug}${payload.version === undefined ? '' : `@${payload.version}`}`, async jobSignal => {
          const result = await operation(payload.slug, payload.version, jobSignal, { allowDowngrade: payload.allow_downgrade === true })
          return endpoint === 'skills.download' ? registerDownload(result) : result
        })
        return { ok: true, value: started }
      }
      if (['skills.enable', 'skills.disable', 'skills.uninstall'].includes(endpoint)) {
        if (!localSkillTarget(payload)) return badRequest(`${endpoint} payload is invalid`)
        const action = endpoint.slice('skills.'.length)
        const started = startJob(ctx, undefined, signal, `${action} e-Mate Skill: ${payload.slug}`, jobSignal => hub[action](payload.slug, jobSignal))
        return { ok: true, value: started }
      }
      if (endpoint === 'skills.publish') {
        if (!exactKeys(payload, ['bundle_base64', 'category'])
          || typeof payload.bundle_base64 !== 'string'
          || typeof payload.category !== 'string') {
          return badRequest('skills.publish payload is invalid')
        }
        const started = startJob(ctx, undefined, signal, 'Publish e-Mate Skill', jobSignal => hub.publishArchive(payload.bundle_base64, payload.category, jobSignal))
        return { ok: true, value: started }
      }
      if (endpoint === 'skills.delete-publication') {
        if (!exactKeys(payload, ['slug', 'version'])
          || typeof payload.slug !== 'string' || !SKILL_SLUG.test(payload.slug)
          || typeof payload.version !== 'string' || !SKILL_VERSION.test(payload.version)) {
          return badRequest('skills.delete-publication payload is invalid')
        }
        return { ok: true, value: startJob(ctx, undefined, signal, `Delete published Skill: ${payload.slug}@${payload.version}`, async jobSignal => {
          const publication = await hub.ownedPublication(payload.slug, payload.version, jobSignal)
          return hub.deletePublication(publication, jobSignal)
        }) }
      }
      if (endpoint === 'jobs.list') {
        if (!exactKeys(payload, [])) return badRequest('jobs.list payload is invalid')
        return { ok: true, value: { items: ctx.jobs.list().filter(job => job.kind === 'emate-skill' && job.ownerSession === undefined) } }
      }
      if (endpoint === 'jobs.read') {
        if (!exactKeys(payload, ['job_id']) || typeof payload.job_id !== 'string' || uiJob(payload.job_id) === undefined) {
          return badRequest('jobs.read payload is invalid or not owned by Skill Hub UI')
        }
        const read = ctx.jobs.read(payload.job_id)
        return { ok: true, value: { ...read.snapshot, output: read.text } }
      }
      if (endpoint === 'jobs.cancel') {
        if (!exactKeys(payload, ['job_id']) || typeof payload.job_id !== 'string' || uiJob(payload.job_id) === undefined) {
          return badRequest('jobs.cancel payload is invalid or not owned by Skill Hub UI')
        }
        return { ok: true, value: { result: ctx.jobs.kill(payload.job_id, undefined, 'cancelled by Skill Hub UI') } }
      }
      return badRequest('unknown e-Mate Skill Hub endpoint')
  }
  ctx.effect(() => ctx.connection.rpc.handle(
    SKILL_HUB_CHANNEL,
    async (...args) => {
      try { return await skillHubRpc(...args) } catch (error) {
        return { ok: false, error: { ...skillHubFailure(error), details: { issues: [] } } }
      }
    },
    { authority: 'loopback' },
  ), 'emate.skillHub: target-native RPC channel')

  const jsonOutput = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
  ctx.tools.register(defineTool({
    name: 'e_mate_skill_hub_search',
    description: 'Search or page through other users\' shared Skills in the authenticated e-Mate Skill Hub. Read-only.',
    parameters: {
      query: { type: 'string', description: 'Search text; omit for the catalog.' },
      category: { type: 'string', enum: ['third_party', 'content_creation', 'office_productivity'] },
      tag: { type: 'string' },
      cursor: { type: 'string', description: 'Opaque next_cursor returned by the preceding page. Omit on the first page; never invent a cursor or send an empty value.' },
      limit: { type: 'integer', description: 'Page size from 1 to 100.' },
    },
    output: jsonOutput,
    execute: (args, exec) => hub.search(args, exec.signal),
    presentCall: args => ({ card: 'generic', title: 'Search e-Mate Skill Hub', kind: 'read', rawInput: args.query }),
  }))
  ctx.tools.register(defineTool({
    name: 'e_mate_skill_hub_detail',
    description: 'Read one Skill Hub Skill and its immutable version history before choosing an action. Read-only.',
    parameters: {
      slug: { type: 'string', required: true, description: 'Exact Skill Hub slug.' },
      cursor: { type: 'string', description: 'Opaque next_cursor for immutable version history.' },
      limit: { type: 'integer', description: 'Version page size from 1 to 100.' },
    },
    output: jsonOutput,
    execute: (args, exec) => hub.detail(args.slug, { cursor: args.cursor, limit: args.limit }, exec.signal),
    presentCall: args => ({ card: 'generic', title: 'Read Skill Hub detail', kind: 'read', rawInput: args.slug }),
  }))
  ctx.tools.register(defineTool({
    name: 'e_mate_skill_hub_inventory',
    description: 'List locally installed or disabled Skills owned by Skill Hub receipts and their native DSH readiness. Read-only.',
    parameters: {},
    output: jsonOutput,
    execute: async (_args, exec) => ({ schema_version: 1, items: await hub.inventory(exec.signal) }),
    presentCall: () => ({ card: 'generic', title: 'Read local Skill Hub inventory', kind: 'read' }),
  }))

  const exactCard = async (args, signal) => {
    return args.version === undefined ? (await hub.detail(args.slug, signal)).skill : hub.version(args.slug, args.version, signal)
  }
  const ownedLocal = async (slug, signal) => {
    const item = (await hub.inventory(signal)).find(candidate => candidate.slug === slug)
    if (item === undefined) throw new Error(`Skill ${slug} is not owned by the local Skill Hub lifecycle`)
    return item
  }
  const startMutation = async (exec, specification) => {
    await confirmMutation(ctx, exec, specification.confirm)
    return startJob(ctx, exec.agent, exec.signal, specification.label, specification.run)
  }

  for (const definition of [
    {
      action: 'download',
      description: 'Download one exact immutable shared Skill package to the bounded e-Mate cache without installing it.',
      title: 'Download e-Mate Skill',
      run: async (card, _args, signal) => registerDownload(await hub.download(card.slug, card.version, signal)),
    },
    {
      action: 'install',
      description: 'Verify and atomically install one exact shared Skill through the native DSH Skill provider.',
      title: 'Install e-Mate Skill',
      run: (card, _args, signal) => hub.install(card.slug, card.version, signal),
    },
    {
      action: 'update',
      description: 'Atomically update an existing Skill Hub-owned Skill to one exact immutable version.',
      title: 'Update e-Mate Skill',
      run: (card, args, signal) => hub.update(card.slug, card.version, signal, { allowDowngrade: args.allow_downgrade === true }),
    },
  ]) {
    ctx.tools.register(defineTool({
      name: `e_mate_skill_hub_${definition.action}`,
      description: definition.description,
      parameters: {
        slug: { type: 'string', required: true, description: 'Exact Skill Hub slug selected from search/detail.' },
        version: { type: 'string', description: 'Exact immutable version; omit to resolve the current latest before confirmation.' },
        ...(definition.action === 'update' ? { allow_downgrade: { type: 'boolean', description: 'True only when the user explicitly chose a lower version.' } } : {}),
      },
      output: jobOutput,
      async execute(args, exec) {
        const card = await exactCard(args, exec.signal)
        let current
        let downgrade = false
        if (definition.action === 'update') {
          current = await ownedLocal(card.slug, exec.signal)
          downgrade = compareSkillVersions(card.version, current.version) < 0
          if (downgrade && args.allow_downgrade !== true) {
            throw new Error(`Skill ${card.slug}@${card.version} is lower than installed ${current.version}; set allow_downgrade only after the user explicitly chooses this downgrade`)
          }
        }
        const actionLabel = downgrade ? '降级' : definition.action === 'download' ? '下载' : definition.action === 'install' ? '安装并启用' : '更新'
        return startMutation(exec, {
          label: `${definition.title}: ${card.slug}@${card.version}`,
          confirm: {
            id: `skill-hub-${definition.action}`,
            header: 'Skill Hub',
            question: `是否${actionLabel} ${card.slug}@${card.version}？`,
            detail: `${current === undefined ? '' : `当前版本: ${current.version}\n`}目标 SHA-256: ${card.package_sha256}\n发布者: ${card.uploader.nickname} (${card.uploader.author_ref})`,
            approve: downgrade ? '降级' : definition.action === 'download' ? '下载' : definition.action === 'install' ? '安装' : '更新',
          },
          run: signal => definition.run(card, args, signal),
        })
      },
      presentCall: args => ({ card: 'generic', title: definition.title, kind: 'execute', rawInput: `${args.slug}${args.version === undefined ? '' : `@${args.version}`}` }),
    }))
  }

  for (const definition of [
    { action: 'enable', title: 'Enable e-Mate Skill', label: '启用', run: (slug, signal) => hub.enable(slug, signal) },
    { action: 'disable', title: 'Disable e-Mate Skill', label: '禁用', run: (slug, signal) => hub.disable(slug, signal) },
    { action: 'uninstall', title: 'Uninstall e-Mate Skill', label: '卸载', run: (slug, signal) => hub.uninstall(slug, signal) },
  ]) {
    ctx.tools.register(defineTool({
      name: `e_mate_skill_hub_${definition.action}`,
      description: `${definition.label} one exact locally installed Skill owned by the Skill Hub receipt.`,
      parameters: { slug: { type: 'string', required: true, description: 'Exact slug from e_mate_skill_hub_inventory.' } },
      output: jobOutput,
      async execute(args, exec) {
        const item = await ownedLocal(args.slug, exec.signal)
        return startMutation(exec, {
          label: `${definition.title}: ${item.slug}@${item.version}`,
          confirm: {
            id: `skill-hub-${definition.action}`,
            header: '本机 Skill',
            question: `是否${definition.label} ${item.slug}@${item.version}？`,
            detail: `SHA-256: ${item.package_sha256}\n发布者: ${item.uploader?.nickname ?? '旧回执未记录'}${item.uploader?.author_ref === undefined ? '' : ` (${item.uploader.author_ref})`}\n当前状态: ${item.status}`,
            approve: definition.label,
          },
          run: signal => definition.run(item.slug, signal),
        })
      },
      presentCall: args => ({ card: 'generic', title: definition.title, kind: definition.action === 'uninstall' ? 'delete' : 'edit', rawInput: args.slug }),
    }))
  }

  ctx.tools.register(defineTool({
    name: 'e_mate_skill_hub_publish',
    description: 'Upload and publish one installed declarative Skill or one exact ZIP imported into this Harness session workspace. Never accepts an arbitrary host path or a JavaScript plugin.',
    parameters: {
      source: { type: 'string', required: true, enum: ['installed', 'workspace-artifact'], description: 'Use installed for a native user Skill, or workspace-artifact for an attached/imported ZIP.' },
      identity: { type: 'string', required: true, description: 'Exact installed Skill slug, or exact .e-mate/imports/*.zip identity shown in this session.' },
      category: { type: 'string', required: true, enum: ['third_party', 'content_creation', 'office_productivity'] },
    },
    output: jobOutput,
    async execute(args, exec) {
      if (!['installed', 'workspace-artifact'].includes(args.source) || typeof args.identity !== 'string'
        || !['third_party', 'content_creation', 'office_productivity'].includes(args.category)) {
        throw new Error('Skill publication target is invalid')
      }
      let publication
      if (args.source === 'installed') {
        if (!SKILL_SLUG.test(args.identity)) throw new Error('Installed Skill publication identity is invalid')
        await activeDefinition(join(dshHome, 'skills', args.identity), args.identity, exec.signal)
        publication = hub.previewPublication(args.identity)
      } else {
        const payload = workspaceSkillArchive(exec.agent, args.identity)
        await hub.validatePublication(payload, exec.signal)
        publication = hub.previewArchive(payload)
      }
      await confirmMutation(ctx, exec, {
        id: 'skill-hub-publish',
        header: '发布 Skill',
        question: `是否上传并发布 ${publication.slug}@${publication.version}？`,
        detail: `来源: ${args.source === 'installed' ? `本机原生 Skill ${args.identity}` : `当前会话产物 ${args.identity}`}\n内容 SHA-256: ${publication.package_sha256}\nZIP SHA-256: ${publication.archive_sha256}\n分类: ${args.category}\n服务端会按当前登录账号校验发布身份和不可覆盖版本。`,
        approve: '上传并发布',
      })
      return startJob(ctx, exec.agent, exec.signal, `Publish e-Mate Skill: ${publication.slug}@${publication.version}`, signal => hub.publishPrepared(publication, args.category, signal))
    },
    presentCall: args => ({ card: 'generic', title: 'Publish e-Mate Skill', kind: 'execute', rawInput: args.identity }),
  }))
  ctx.tools.register(defineTool({
    name: 'e_mate_skill_hub_delete_publication',
    description: 'Delete one exact immutable Skill publication owned by the authenticated user. The service refuses other users\' publications.',
    parameters: {
      slug: { type: 'string', required: true },
      version: { type: 'string', required: true },
    },
    output: jobOutput,
    async execute(args, exec) {
      if (typeof args.slug !== 'string' || !SKILL_SLUG.test(args.slug)
        || typeof args.version !== 'string' || !SKILL_VERSION.test(args.version)) {
        throw new Error('Skill publication deletion target is invalid')
      }
      const publication = await hub.ownedPublication(args.slug, args.version, exec.signal)
      await confirmMutation(ctx, exec, {
        id: 'skill-hub-delete-publication',
        header: '删除已发布 Skill',
        question: `是否删除你发布的 ${args.slug}@${args.version}？`,
        detail: `SHA-256: ${publication.package_sha256}\n发布者: ${publication.uploader.nickname} (${publication.uploader.author_ref})\n该所有权和摘要来自当前登录账号的服务端回读；只删除服务端精确版本，不卸载本机 Skill。`,
        approve: '删除发布',
      })
      return startJob(ctx, exec.agent, exec.signal, `Delete published Skill: ${args.slug}@${args.version}`, signal => hub.deletePublication(publication, signal))
    },
    presentCall: args => ({ card: 'generic', title: 'Delete published Skill', kind: 'delete', rawInput: `${args.slug}@${args.version}` }),
  }))

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'emate:skill-hub',
    order: 181,
    text: 'When the user asks in natural language to find or use another user\'s shared Skill, use e_mate_skill_hub_search/detail and then the exact install/update/enable/disable/uninstall Tool. When the user asks to upload or share a local Skill, use e_mate_skill_hub_publish with either its native installed slug or the exact .e-mate/imports/*.zip identity produced by this session; when they ask to remove their own published immutable version, use e_mate_skill_hub_delete_publication. Read local ownership/readiness with e_mate_skill_hub_inventory. Every mutation shows a native confirmation and returns a DSH Job: do not bypass it with shell commands, do not invent host paths, slugs, versions, digests, or ownership, and do not claim success until the Job completes.',
  }), 'emate.skillHub: natural-language operations')
}
