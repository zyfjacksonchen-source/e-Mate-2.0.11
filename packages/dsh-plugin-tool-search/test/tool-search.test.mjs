import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as ToolSearch from '../lib/index.mjs'
import * as Schedule from '../../../upstream/deepseek-harness/packages/schedule/schedule/lib/index.js'

const { TOOL_SEARCH_NAME } = ToolSearch

const signal = new AbortController().signal
let ordinal = 0

function fixture(name, description) {
  return defineContentToolFixture({
    name,
    description,
    parameters: {},
    async execute() { return [{ type: 'text', text: `ran:${name}` }] },
  })
}

async function harness(config = {}, install = true) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const plugin = install ? await ctx.plugin(ToolSearch, config) : undefined
  return { ctx, plugin }
}

function createAgent(ctx, id) {
  return ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
}

async function execute(ctx, agent, name, args, parent) {
  ordinal += 1
  return await ctx.tools.execute({
    callId: CallId(`tool-search-${ordinal}`),
    name,
    arguments: args,
    agent,
    signal,
    ...(parent === undefined ? {} : { parent }),
  })
}

function names(ctx, agent) {
  return ctx.tools.schemas(agent).map(schema => schema.name).sort()
}

class PersistenceProbe extends Service {
  constructor(ctx) { super(ctx, 'sessionPersistence') }
}

test('keeps pinned Schedule tools Agent-local and executes them through the native definitions', async (t) => {
  const ctx = new Context()
  t.after(async () => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(PersistenceProbe)
  ctx.on('session/flush', () => {})
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Schedule)
  await ctx.plugin(ToolSearch, { maxResults: 5 })
  const agent = createAgent(ctx, 'schedule-disclosure')

  assert.deepEqual(names(ctx, agent), ['schedule_create', 'schedule_delete', 'schedule_list', TOOL_SEARCH_NAME])
  const created = await execute(ctx, agent, 'schedule_create', { prompt: '生成日报', after_seconds: 3600 })
  assert.equal(created.isError, false)
  assert.equal(created.value.prompt, '生成日报')
  const listed = await execute(ctx, agent, 'schedule_list', {})
  assert.deepEqual(listed.value, [created.value])
  const deleted = await execute(ctx, agent, 'schedule_delete', { id: created.value.id })
  assert.deepEqual(deleted.value, { id: created.value.id, deleted: true })
  assert.deepEqual((await execute(ctx, agent, 'schedule_list', {})).value, [])
  assert.deepEqual(names(ctx, agent), ['schedule_create', 'schedule_delete', 'schedule_list', TOOL_SEARCH_NAME])
})

test('discloses deferred native tools without replacing their execution path', async (t) => {
  const { ctx } = await harness({ alwaysVisible: ['read_*'], maxResults: 2 })
  t.after(async () => ctx.fiber.dispose())
  ctx.tools.register(fixture('read_file', 'Read a local file'))
  ctx.tools.register(fixture('browser_navigate', 'Navigate the current webpage'))
  ctx.tools.register(fixture('office_write', 'Create an office document'))
  const agent = createAgent(ctx, 'native-disclosure')

  assert.deepEqual(names(ctx, agent), ['read_file', TOOL_SEARCH_NAME])
  assert.equal((await execute(ctx, agent, 'office_write', {})).isError, true)
  const found = await execute(ctx, agent, TOOL_SEARCH_NAME, { query: 'office document', limit: 1 })
  assert.deepEqual(found.value.tools, [{ name: 'office_write', status: 'loaded' }])
  assert.deepEqual(names(ctx, agent), ['office_write', 'read_file', TOOL_SEARCH_NAME])
  assert.equal((await execute(ctx, agent, 'office_write', {})).isError, false)
  assert.equal(agent.session.events.some(event => event.type === 'tool-search/selection'), false)
})

test('restores only a post-plugin request/header and never mistakes a legacy full catalog for a selection', async (t) => {
  const { ctx } = await harness({}, false)
  t.after(async () => ctx.fiber.dispose())
  ctx.tools.register(fixture('read_file', 'Read a local file'))
  ctx.tools.register(fixture('office_write', 'Create an office document'))
  const restored = createAgent(ctx, 'restored')
  restored.session.append('request/header', {
    header: {
      config: { provider: 'mock', model: 'mock' },
      tools: [
        { name: TOOL_SEARCH_NAME, description: 'Search tools', parameters: { type: 'object', properties: {} } },
        { name: 'office_write', description: 'Create an office document', parameters: { type: 'object', properties: {} } },
      ],
    },
    reason: 'initial',
  })
  const legacy = createAgent(ctx, 'legacy')
  legacy.session.append('request/header', {
    header: {
      config: { provider: 'mock', model: 'mock' },
      tools: [
        { name: 'read_file', description: 'Read a local file', parameters: { type: 'object', properties: {} } },
        { name: 'office_write', description: 'Create an office document', parameters: { type: 'object', properties: {} } },
      ],
    },
    reason: 'initial',
  })
  await ctx.plugin(ToolSearch, { alwaysVisible: ['read_*'] })

  assert.deepEqual(names(ctx, restored), ['office_write', 'read_file', TOOL_SEARCH_NAME])
  assert.deepEqual(names(ctx, legacy), ['read_file', TOOL_SEARCH_NAME])
})

test('intersects with an existing per-agent restriction and does not disclose its denied schema', async (t) => {
  const { ctx } = await harness()
  t.after(async () => ctx.fiber.dispose())
  ctx.tools.register(fixture('public_lookup', 'Find public records'))
  ctx.tools.register(fixture('secret_lookup', 'Find private records'))
  const handle = await ctx.agents.create({
    sessionId: SessionId('restricted'),
    agentOptions: { provider: 'mock', model: 'mock' },
    setup(agentCtx) { agentCtx.tools.restrict({ deny: ['secret_lookup'] }) },
  })

  const result = await execute(ctx, handle.agent, TOOL_SEARCH_NAME, { query: 'private secret' })
  assert.deepEqual(result.value.tools, [])
  assert.deepEqual(names(ctx, handle.agent), [TOOL_SEARCH_NAME])
  await handle.dispose()
})

test('rebuilds from the real inherited view when tools change', async (t) => {
  const { ctx } = await harness()
  t.after(async () => ctx.fiber.dispose())
  ctx.tools.register(fixture('first_probe', 'First capability'))
  const agent = createAgent(ctx, 'late-tool')
  ctx.tools.register(fixture('late_probe', 'Late external capability'))

  assert.deepEqual(names(ctx, agent), [TOOL_SEARCH_NAME])
  const found = await execute(ctx, agent, TOOL_SEARCH_NAME, { query: 'late external' })
  assert.deepEqual(found.value.tools, [{ name: 'late_probe', status: 'loaded' }])
})

test('rejects nested Code Mode dispatch and invalid requests without changing visibility', async (t) => {
  const { ctx } = await harness({ maxResults: 1, maxQueryChars: 8 })
  t.after(async () => ctx.fiber.dispose())
  ctx.tools.register(fixture('probe', 'Probe a target'))
  const agent = createAgent(ctx, 'invalid')
  const before = names(ctx, agent)

  for (const [args, parent] of [
    [{ query: '   ' }, undefined],
    [{ query: '123456789' }, undefined],
    [{ query: 'probe', limit: 2 }, undefined],
    [{ query: 'probe' }, Symbol('code-parent')],
  ]) assert.equal((await execute(ctx, agent, TOOL_SEARCH_NAME, args, parent)).isError, true)
  assert.deepEqual(names(ctx, agent), before)
})

test('plugin disposal restores the original native tool surface', async (t) => {
  const { ctx, plugin } = await harness()
  t.after(async () => ctx.fiber.dispose())
  ctx.tools.register(fixture('before_plugin', 'Registered capability'))
  const agent = createAgent(ctx, 'dispose')
  assert.deepEqual(names(ctx, agent), [TOOL_SEARCH_NAME])
  await plugin.dispose()
  assert.deepEqual(names(ctx, agent), ['before_plugin'])
})

test('keeps a seventy-tool native catalog out of the initial request schema', async (t) => {
  const { ctx } = await harness({ maxResults: 1 })
  t.after(async () => ctx.fiber.dispose())
  for (let index = 0; index < 70; index += 1) {
    ctx.tools.register(fixture(`synthetic_tool_${index}`, `Synthetic capability number ${index}`))
  }
  const fullCatalogBytes = Buffer.byteLength(JSON.stringify(ctx.tools.schemas()))
  const agent = createAgent(ctx, 'seventy-tools')
  const initialSchemas = ctx.tools.schemas(agent)
  const initialBytes = Buffer.byteLength(JSON.stringify(initialSchemas))

  assert.deepEqual(initialSchemas.map(schema => schema.name), [TOOL_SEARCH_NAME])
  assert.ok(initialBytes * 10 < fullCatalogBytes)
  const found = await execute(ctx, agent, TOOL_SEARCH_NAME, { query: 'synthetic_tool_42', limit: 1 })
  assert.deepEqual(found.value.tools, [{ name: 'synthetic_tool_42', status: 'loaded' }])
  assert.deepEqual(names(ctx, agent), ['synthetic_tool_42', TOOL_SEARCH_NAME])
})
