import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { strToU8, zipSync } from 'fflate'
import { apply, nativeCandidate } from '../lib/index.js'
import {
  createSkillHubClient,
  createSkillHubStore,
  SkillHubRecoveryPendingError,
} from '../lib/skill-hub.js'

const roots = []
test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryHome() {
  const root = mkdtempSync(join(tmpdir(), 'emate-skill-hub-'))
  roots.push(root)
  return root
}

function skillArchive(slug, version, invocation = '') {
  const markdown = `---\nname: ${slug}\ndescription: ${slug} behavior test\nversion: ${version}\n${invocation}---\n\nRun ${slug} ${version}.\n`
  const payload = Buffer.from(zipSync({ 'SKILL.md': strToU8(markdown) }, { level: 6 }))
  return {
    payload,
    card: {
      slug,
      version,
      package_sha256: createHash('sha256').update(payload).digest('hex'),
    },
  }
}

function nativeContext() {
  return { get: () => undefined, logger: { warn() {} } }
}

function lifecycleStore(dshHome) {
  const ctx = nativeContext()
  return createSkillHubStore({
    dshHome,
    validateCandidate: (root, slug, signal) => nativeCandidate(ctx, root, slug, signal),
    validateActive: (path, slug, signal) => nativeCandidate(ctx, dirname(path), slug, signal),
    validateAbsent: async (path) => {
      if (existsSync(path)) throw new Error('Skill remains at its active path')
    },
    invalidate() {},
  })
}

function acceptedCompletion() {
  return { state: 'accepted', value: { schema_version: 1, status: 'installed' } }
}

async function install(store, archive, options = {}) {
  return store.install({
    ...archive,
    claim: async () => options.receipt ?? `receipt-${archive.card.version}`,
    complete: options.complete ?? (async () => acceptedCompletion()),
  })
}

test('native rc.7 parser is the install commit gate', async () => {
  const dshHome = temporaryHome()
  const store = lifecycleStore(dshHome)
  const invalid = skillArchive('invalid-policy', '1.0.0', 'disable-model-invocation: maybe\n')
  let claimed = false

  await assert.rejects(store.install({
    ...invalid,
    claim: async () => { claimed = true; return 'must-not-be-issued' },
    complete: async () => acceptedCompletion(),
  }), /native DSH parser/)
  assert.equal(claimed, false)
  assert.equal(existsSync(join(dshHome, 'skills', 'invalid-policy')), false)
  assert.equal(existsSync(join(dshHome, 'e-mate', 'skill-hub', 'transactions', 'invalid-policy')), false)
})

test('one Skill Hub owner closes install, disable, enable, and uninstall through native readback', async () => {
  const dshHome = temporaryHome()
  const store = lifecycleStore(dshHome)
  const archive = skillArchive('meeting-notes', '1.0.0')

  assert.equal((await install(store, archive)).status, 'installed')
  assert.equal((await store.inventory()).at(0).ready, true)
  assert.equal((await store.disable('meeting-notes')).status, 'disabled')
  assert.equal(existsSync(join(dshHome, 'skills', 'meeting-notes')), false)
  assert.equal((await store.inventory()).at(0).ready, false)
  assert.equal((await store.enable('meeting-notes')).status, 'installed')
  assert.equal((await store.uninstall('meeting-notes')).status, 'uninstalled')
  assert.deepEqual(await store.inventory(), [])
  assert.equal(existsSync(join(dshHome, 'skills', 'meeting-notes')), false)
})

test('an installed Skill loads through the real rc.7 model-facing skill Tool', async () => {
  const dshHome = temporaryHome()
  await install(lifecycleStore(dshHome), skillArchive('agent-loadable', '1.0.0'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SkillRegistry)
  ctx.skills.registerProvider(control => new FileSystemSkillProvider(ctx, control, {
    providerName: 'emate-skill-hub-acceptance',
    includeDefaultRoots: false,
    customSkillDirs: [join(dshHome, 'skills')],
    dshHome,
    watch: false,
  }))
  await ctx.plugin(ToolSkill)
  try {
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: 'skill-hub-load',
      name: 'skill',
      arguments: { name: 'agent-loadable' },
    })
    assert.equal(result.isError, false)
    assert.equal(result.content[0]?.type, 'text')
    assert.match(result.content[0].text, /Run agent-loadable 1\.0\.0\./u)
  } finally {
    await ctx.fiber.dispose()
  }
})

test('same-slug mutations serialize so an earlier failure cannot roll back a later success', async () => {
  const dshHome = temporaryHome()
  const store = lifecycleStore(dshHome)
  await install(store, skillArchive('serial-skill', '1.0.0'))

  let releaseSecond
  let completionStarted
  const completionGate = new Promise(resolve => { releaseSecond = resolve })
  const reachedCompletion = new Promise(resolve => { completionStarted = resolve })
  const claimed = []
  const second = skillArchive('serial-skill', '2.0.0')
  const third = skillArchive('serial-skill', '3.0.0')
  const updateTwo = store.update({
    ...second,
    claim: async () => { claimed.push('2.0.0'); return 'receipt-2' },
    complete: async (_receipt, status) => {
      if (status === 'failed') return acceptedCompletion()
      completionStarted()
      await completionGate
      return { state: 'rejected', error: new Error('server rejected v2') }
    },
  })
  await reachedCompletion
  const updateThree = store.update({
    ...third,
    claim: async () => { claimed.push('3.0.0'); return 'receipt-3' },
    complete: async () => acceptedCompletion(),
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(claimed, ['2.0.0'])
  releaseSecond()
  await assert.rejects(updateTwo, /server rejected v2/)
  assert.equal((await updateThree).version, '3.0.0')
  assert.deepEqual(claimed, ['2.0.0', '3.0.0'])
  assert.match(readFileSync(join(dshHome, 'skills', 'serial-skill', 'SKILL.md'), 'utf8'), /3\.0\.0/)
})

test('install cannot silently become update while exact same-version revalidation stays idempotent', async () => {
  const dshHome = temporaryHome()
  const store = lifecycleStore(dshHome)
  const first = skillArchive('explicit-update', '1.0.0')
  await install(store, first)
  assert.equal((await install(store, first)).unchanged, true)
  let claimed = false
  await assert.rejects(store.install({
    ...skillArchive('explicit-update', '2.0.0'),
    claim: async () => { claimed = true; return 'must-not-claim' },
    complete: async () => acceptedCompletion(),
  }), /explicit update action/)
  assert.equal(claimed, false)
})

test('lost completion response preserves the old Skill and restart reconciliation commits the candidate', async () => {
  const dshHome = temporaryHome()
  const store = lifecycleStore(dshHome)
  await install(store, skillArchive('recoverable', '1.0.0'))
  const next = skillArchive('recoverable', '2.0.0')

  await assert.rejects(store.update({
    ...next,
    claim: async () => 'receipt-response-lost',
    complete: async () => ({ state: 'unknown', error: new Error('response lost') }),
  }), SkillHubRecoveryPendingError)
  assert.match(readFileSync(join(dshHome, 'skills', 'recoverable', 'SKILL.md'), 'utf8'), /1\.0\.0/)
  assert.equal((await store.inventory()).at(0).recovery_pending, true)

  assert.deepEqual(await store.recover({ reconcile: async () => 'installed' }), [
    { slug: 'recoverable', status: 'recovered' },
  ])
  assert.match(readFileSync(join(dshHome, 'skills', 'recoverable', 'SKILL.md'), 'utf8'), /2\.0\.0/)
  assert.equal((await store.inventory()).at(0).version, '2.0.0')
})

test('publication confirmation can bind the exact immutable bytes before upload', async () => {
  const dshHome = temporaryHome()
  const skill = join(dshHome, 'skills', 'share-me')
  mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: share-me\ndescription: share me\nversion: 1.2.3\n---\n\nOriginal.\n')
  let uploaded
  const store = { inventory: async () => [] }
  const hub = createSkillHubClient({
    dshHome,
    store,
    baseUrl: 'https://dl.ecoremedia.net/ecorex-agent/client/skill-hub/v1',
    async request(url, init) {
      assert.equal(url.pathname, '/ecorex-agent/client/skill-hub/v1/skills')
      uploaded = JSON.parse(init.body)
      const payload = Buffer.from(uploaded.bundle_base64, 'base64')
      const sha256 = createHash('sha256').update(payload).digest('hex')
      return Response.json({
        slug: 'share-me', version: '1.2.3', package_sha256: sha256,
        title: 'Share me', summary: 'Published behavior test', package_size_bytes: payload.byteLength,
        category: 'third_party', tags: [],
        uploader: { nickname: 'Owner', author_ref: `author_${'b'.repeat(24)}` },
        provenance: { brand: 'e-Mate', original_platform: null, original_url: null },
        installation_status: 'installed_enabled', readiness: 'ready',
      })
    },
  })

  const preview = hub.previewPublication('share-me')
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: share-me\ndescription: changed\nversion: 9.9.9\n---\n\nChanged.\n')
  const receipt = await hub.publishPrepared(preview, 'third_party')
  assert.equal(receipt.version, '1.2.3')
  assert.equal(uploaded.slug, 'share-me')
  assert.equal(createHash('sha256').update(Buffer.from(uploaded.bundle_base64, 'base64')).digest('hex'), preview.package_sha256)
})

test('Agent natural language surface registers the complete typed lifecycle and confirms exact publication bytes', async () => {
  const dshHome = temporaryHome()
  const skill = join(dshHome, 'skills', 'natural-share')
  mkdirSync(skill, { recursive: true })
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: natural-share\ndescription: natural language publication\nversion: 2.3.4\n---\n\nShare.\n')
  const tools = []
  const prompts = []
  const questions = []
  const jobs = []
  const routes = []
  const download = skillArchive('shared-download', '4.5.6')
  const downloadCard = {
    ...download.card,
    title: 'Shared download', summary: 'Natural language download', package_size_bytes: download.payload.byteLength,
    category: 'third_party', tags: ['shared'],
    uploader: { nickname: 'Other user', author_ref: `author_${'c'.repeat(24)}` },
    provenance: { brand: 'e-Mate', original_platform: null, original_url: null },
    installation_status: 'not_installed', readiness: 'ready',
  }
  let provider
  const ctx = {
    get: name => name === 'emateIdentity' ? { request: async (url) => {
      if (url.pathname.endsWith('/skills/shared-download')) {
        return Response.json({ schema_version: 1, skill: downloadCard, versions: [downloadCard] })
      }
      if (url.pathname.endsWith('/skills/shared-download/versions/4.5.6/package')) {
        return new Response(download.payload, { headers: { 'x-skill-content-sha256': download.card.package_sha256 } })
      }
      throw new Error('network mutation must start only inside the Job')
    } } : undefined,
    logger: { warn() {} },
    skills: {
      registerProvider(factory) {
        provider = factory({ signal: new AbortController().signal, invalidate() {} })
      },
      async get(slug, options) {
        const observed = await provider.list(options)
        const candidates = Array.isArray(observed) ? observed : observed.candidates
        const candidate = candidates.find(value => value.name === slug)
        return candidate === undefined ? undefined : provider.get(candidate, options)
      },
    },
    jobs: {
      attachController() {},
      start(specification) { jobs.push(specification); return `job-${jobs.length}` },
      list: () => [],
      get() { throw new Error('not used') },
      read() { throw new Error('not used') },
      kill() { throw new Error('not used') },
    },
    userQuestions: {
      async ask({ questions: asked }) {
        questions.push(...asked)
        return { answers: [{ selected: [asked[0].options[0].label] }] }
      },
    },
    systemPrompt: { section(value) { prompts.push(value); return () => {} } },
    connection: { rpc: { handle: () => () => {} } },
    webServer: { register(value) { routes.push(value); return () => {} } },
    tools: { register(value) { tools.push(value) } },
    effect(callback) { return callback() },
  }
  await apply(ctx, { dshHome, baseUrl: 'https://dl.ecoremedia.net/ecorex-agent/client/skill-hub/v1' })

  assert.deepEqual(tools.map(tool => tool.name).sort(), [
    'e_mate_skill_hub_delete_publication',
    'e_mate_skill_hub_detail',
    'e_mate_skill_hub_disable',
    'e_mate_skill_hub_download',
    'e_mate_skill_hub_enable',
    'e_mate_skill_hub_install',
    'e_mate_skill_hub_inventory',
    'e_mate_skill_hub_publish',
    'e_mate_skill_hub_search',
    'e_mate_skill_hub_uninstall',
    'e_mate_skill_hub_update',
  ])
  assert.match(prompts.at(0).text, /natural language/)
  assert.match(prompts.at(0).text, /install\/update\/enable\/disable\/uninstall/)
  assert.match(prompts.at(0).text, /e_mate_skill_hub_publish/)

  const publish = tools.find(tool => tool.name === 'e_mate_skill_hub_publish')
  const started = await publish.execute({ slug: 'natural-share', category: 'third_party' }, {
    agent: { id: 'agent-test' },
    signal: new AbortController().signal,
  })
  assert.deepEqual(started, { job_id: 'job-1', status: 'running' })
  assert.match(questions.at(0).question, /natural-share@2\.3\.4/)
  assert.match(questions.at(0).detail, /SHA-256: [0-9a-f]{64}/)
  assert.equal(jobs.length, 1)

  const downloadTool = tools.find(tool => tool.name === 'e_mate_skill_hub_download')
  assert.deepEqual(await downloadTool.execute({ slug: 'shared-download', version: '4.5.6' }, {
    agent: { id: 'agent-test' },
    signal: new AbortController().signal,
  }), { job_id: 'job-2', status: 'running' })
  const execution = jobs[1].run()
  const terminal = await execution.done
  assert.equal(terminal.status, 'completed')
  const result = JSON.parse(terminal.output)
  let responseStatus
  let responseBody
  routes.at(0).handler({ method: 'GET', url: `/api/e-mate/skill-hub.download?id=${result.download_id}` }, {
    writeHead(status) { responseStatus = status },
    end(body) { responseBody = body },
  })
  assert.equal(responseStatus, 200)
  assert.deepEqual(Buffer.from(responseBody), download.payload)
  routes.at(0).handler({ method: 'GET', url: `/api/e-mate/skill-hub.download?id=${result.download_id}` }, {
    writeHead(status) { responseStatus = status },
    end() {},
  })
  assert.equal(responseStatus, 404)
})
