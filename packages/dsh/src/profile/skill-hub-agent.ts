import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createSkillHubClient } from '../skill-hub.js'
import { loadTargetTools } from './target-runtime.js'

export const name = 'emate-skill-hub-agent'
export const inject = ['tools', 'jobs', 'emateIdentity', 'connection', 'webServer']
export const SKILL_HUB_CHANNEL = '/emate.skillHub'

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
          error => ({ status: controller.signal.aborted ? 'killed' : 'failed', detail: error instanceof Error ? error.message : String(error) }),
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
    && typeof payload.slug === 'string'
    && payload.slug.length > 0
    && payload.slug.length <= 128
    && (payload.version === undefined || (typeof payload.version === 'string' && payload.version.length <= 128))
}

const jobOutput = {
  schema: JOB_SCHEMA,
  render: (_args, value) => [{ type: 'text', text: `Started e-Mate Skill Hub job ${value.job_id}.` }],
}

export async function apply(ctx, config = {}) {
  const { defineTool } = await loadTargetTools(config.bindingPath)
  const identity = ctx.get('emateIdentity')
  if (identity === undefined) throw new Error('e-Mate Skill Hub requires emateIdentity')
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  const hub = createSkillHubClient({
    request: identity.request.bind(identity),
    dshHome,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  })
  const browserJobs = new Set()
  const browserDownloads = new Map()
  ctx.jobs.attachController('emate-skill-hub-ui')

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
      if (receipt === undefined) {
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
    },
  }), 'emate.skillHub: verified browser download')

  ctx.effect(() => ctx.connection.rpc.handle(
    SKILL_HUB_CHANNEL,
    async (endpoint, payload, signal) => {
      if (!isRecord(payload)) return badRequest('e-Mate Skill Hub payload must be an object')
      if (endpoint === 'catalog.search') {
        if (!exactKeys(payload, ['query']) || typeof payload.query !== 'string' || payload.query.length > 128) {
          return badRequest('catalog.search payload is invalid')
        }
        return { ok: true, value: { items: await hub.search(payload.query, signal) } }
      }
      if (endpoint === 'catalog.detail') {
        if (!exactKeys(payload, ['slug']) || typeof payload.slug !== 'string') {
          return badRequest('catalog.detail payload is invalid')
        }
        return { ok: true, value: await hub.detail(payload.slug) }
      }
      if (endpoint === 'skills.install' || endpoint === 'skills.download') {
        if (!skillTarget(payload)) return badRequest(`${endpoint} payload is invalid`)
        const action = endpoint === 'skills.install' ? 'Install' : 'Download'
        const operation = endpoint === 'skills.install' ? hub.install : hub.download
        const started = startJob(ctx, undefined, signal, `${action} e-Mate Skill: ${payload.slug}${payload.version === undefined ? '' : `@${payload.version}`}`, async jobSignal => {
          const result = await operation(payload.slug, payload.version, jobSignal)
          if (endpoint === 'skills.download') {
            browserDownloads.set(result.download_id, {
              path: join(dshHome, 'e-mate', 'cache', 'skill-hub', 'downloads', `${result.download_id}.zip`),
              filename: `e-mate-skill-${result.slug}-${result.version}.zip`,
              sha256: result.package_sha256,
            })
          }
          return result
        })
        browserJobs.add(started.job_id)
        return { ok: true, value: started }
      }
      if (endpoint === 'skills.publish') {
        if (!exactKeys(payload, ['bundle_base64', 'category'])
          || typeof payload.bundle_base64 !== 'string'
          || typeof payload.category !== 'string') {
          return badRequest('skills.publish payload is invalid')
        }
        const started = startJob(ctx, undefined, signal, 'Publish e-Mate Skill', jobSignal => hub.publishArchive(payload.bundle_base64, payload.category, jobSignal))
        browserJobs.add(started.job_id)
        return { ok: true, value: started }
      }
      if (endpoint === 'jobs.read') {
        if (!exactKeys(payload, ['job_id']) || typeof payload.job_id !== 'string' || !browserJobs.has(payload.job_id)) {
          return badRequest('jobs.read payload is invalid or not owned by Skill Hub UI')
        }
        const read = ctx.jobs.read(payload.job_id)
        return { ok: true, value: { ...read.snapshot, output: read.text } }
      }
      if (endpoint === 'jobs.cancel') {
        if (!exactKeys(payload, ['job_id']) || typeof payload.job_id !== 'string' || !browserJobs.has(payload.job_id)) {
          return badRequest('jobs.cancel payload is invalid or not owned by Skill Hub UI')
        }
        return { ok: true, value: { result: ctx.jobs.kill(payload.job_id, undefined, 'cancelled by Skill Hub UI') } }
      }
      return badRequest('unknown e-Mate Skill Hub endpoint')
    },
    { authority: 'loopback' },
  ), 'emate.skillHub: target-native RPC channel')

  ctx.tools.register(defineTool({
    name: 'e_mate_skill_hub_search',
    description: 'Search the authenticated e-Mate Skill Hub when the user asks to find or browse community Skills. This is a read-only catalog operation.',
    parameters: { query: { type: 'string', description: 'Search text; omit for the newest catalog page.' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', required: true, items: { type: 'json' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.items) }],
    },
    async execute(args, exec) {
      return { items: await hub.search(args.query ?? '', exec.signal) }
    },
    presentCall: args => ({ card: 'generic', title: 'Search e-Mate Skill Hub', kind: 'read', rawInput: args.query }),
  }))

  for (const definition of [
    {
      name: 'e_mate_skill_hub_download',
      description: 'Download one exact immutable e-Mate Skill Hub package selected by the user. The package is verified and retained in e-Mate cache but is not installed.',
      title: 'Download e-Mate Skill',
      run: (args, signal) => hub.download(args.slug, args.version, signal),
    },
    {
      name: 'e_mate_skill_hub_install',
      description: 'Download, verify, and atomically install one exact e-Mate Skill Hub package selected by the user into the local Skill provider.',
      title: 'Install e-Mate Skill',
      run: (args, signal) => hub.install(args.slug, args.version, signal),
    },
  ]) {
    ctx.tools.register(defineTool({
      name: definition.name,
      description: definition.description,
      parameters: {
        slug: { type: 'string', required: true, description: 'Exact Skill Hub slug selected by the user.' },
        version: { type: 'string', description: 'Exact immutable version; omit only when the user selected the latest catalog version.' },
      },
      output: jobOutput,
      execute: (args, exec) => {
        if (exec.agent === undefined) throw new Error('Skill Hub mutation requires an owning Agent session')
        return startJob(ctx, exec.agent, exec.signal, `${definition.title}: ${args.slug}${args.version === undefined ? '' : `@${args.version}`}`, signal => definition.run(args, signal))
      },
      presentCall: args => ({ card: 'generic', title: definition.title, kind: 'execute', rawInput: `${args.slug}${args.version === undefined ? '' : `@${args.version}`}` }),
    }))
  }

  ctx.tools.register(defineTool({
    name: 'e_mate_skill_hub_publish',
    description: 'Publish one locally installed declarative Skill to the authenticated e-Mate Skill Hub after the user explicitly asks to upload or share it. This never publishes arbitrary host paths or Cordis JavaScript plugins.',
    parameters: {
      slug: { type: 'string', required: true, description: 'Exact installed e-Mate Skill name to package and publish.' },
      category: {
        type: 'string',
        required: true,
        enum: ['third_party', 'content_creation', 'office_productivity'],
        description: 'Skill Hub category selected from the product taxonomy.',
      },
    },
    output: jobOutput,
    execute: (args, exec) => {
      if (exec.agent === undefined) throw new Error('Skill Hub mutation requires an owning Agent session')
      return startJob(ctx, exec.agent, exec.signal, `Publish e-Mate Skill: ${args.slug}`, signal => hub.publish(args.slug, args.category, signal))
    },
    presentCall: args => ({ card: 'generic', title: 'Publish e-Mate Skill', kind: 'execute', rawInput: args.slug }),
  }))
}
