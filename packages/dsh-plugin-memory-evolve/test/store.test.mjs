import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../lib/index.js'
import { MemoryStore } from '../lib/store.js'

class Table {
  values = new Map()
  entries() { return this.values.entries() }
  async put(key, value) { this.values.set(key, value) }
}

const scope = sessionId => ({ kind: 'session', key: `session:${sessionId}`, sessionId })
const execution = sessionId => ({ agent: { id: sessionId } })

test('search and copy-on-write imports stay in scope and are idempotent', async () => {
  const table = new Table()
  const store = new MemoryStore(table, async exec => scope(exec.agent.id))
  await store.remember({ content: 'alpha fact', tags: ['alpha'] }, execution('a'))
  await store.remember({ content: 'beta fact', tags: ['beta'] }, execution('b'))

  assert.deepEqual((await store.search({}, execution('a'))).map(item => item.content), ['alpha fact'])
  assert.deepEqual((await store.search({}, execution('b'))).map(item => item.content), ['beta fact'])

  const source = Object.freeze([Object.freeze({
    content: 'legacy fact',
    tags: Object.freeze(['legacy']),
    sourceDigest: 'a'.repeat(64),
    createdAt: '2026-08-15T00:00:00.000Z',
  })])
  assert.deepEqual(await store.copyIn(source, execution('a')), { imported: 1, reused: 0 })
  assert.deepEqual(await store.copyIn(source, execution('a')), { imported: 0, reused: 1 })
  assert.equal(source[0].content, 'legacy fact')
  assert.deepEqual((await store.search({ query: 'legacy' }, execution('b'))), [])
})

test('Cordis adapter registers only Harness prompt and Tool seams', async () => {
  const table = new Table()
  const tools = []
  const sections = []
  const services = new Map()
  const ctx = {
    workspaceRegistry: { resolveByPath: async () => undefined },
    storageDomain: {
      open: async () => ({ table: () => table, close: async () => {} }),
    },
    tools: { register: definition => { tools.push(definition); return () => {} } },
    systemPrompt: { section: section => { sections.push(section); return () => {} } },
    effect: effect => { effect() },
    provide: (name, service) => { services.set(name, service) },
  }
  await apply(ctx)

  assert.equal(services.get('emateMemory') instanceof MemoryStore, true)
  assert.deepEqual(tools.map(tool => tool.name), ['e_mate_memory_remember', 'e_mate_memory_search'])
  assert.equal(sections.length, 1)
  assert.equal(tools[0].parameters.type, 'object')
  assert.deepEqual(tools[0].parameters.required, ['content'])
  assert.deepEqual(tools[1].output.schema.required, ['items'])

  const exec = execution('general')
  await tools[0].execute({ content: 'tool memory' }, exec)
  assert.deepEqual((await tools[1].execute({}, exec)).items.map(item => item.content), ['tool memory'])
  await assert.rejects(tools[0].execute({ content: 'x', extra: true }, exec), /arguments are invalid/)
})
