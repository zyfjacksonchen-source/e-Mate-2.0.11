import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Context } from '../upstream/deepseek-harness/vendor/cordis/lib/index.js'
import SessionStore from '../upstream/deepseek-harness/packages/core/session/lib/index.js'
import JsonlSessionPersistence from '../upstream/deepseek-harness/packages/session/session-persistence-jsonl/lib/index.js'

const SESSION_ID = 'e-mate-performance-5000-v1'
const EVENT_COUNT = 5_000
const TURN_COUNT = EVENT_COUNT / 8
const BASE_TIME = Date.UTC(2026, 0, 1)
const RUNTIME_TAIL_TYPES = new Set([
  'approval/policy',
  'permission/preset',
  'sandbox/mode',
  'session/end-seed',
])

function fixtureEvents() {
  const events = []
  for (let turn = 1; turn <= TURN_COUNT; turn += 1) {
    const seq = events.length
    const callSeq = seq + 3
    const time = BASE_TIME + seq * 10
    const callId = `perf-call-${turn}`
    events.push(
      { type: 'turn/start', seq, time, data: { turn } },
      {
        type: 'user/message', seq: seq + 1, time: time + 1,
        data: {
          id: `perf-user-${turn}`, role: 'user',
          content: [{ type: 'text', text: `Performance user message ${turn}` }],
          source: { kind: 'user' },
        },
        surfaceOp: 'append',
      },
      { type: 'step/start', seq: seq + 2, time: time + 2, data: { turn, step: 1 } },
      {
        type: 'tool/call', seq: seq + 3, time: time + 3,
        data: { turn, step: 1, callId, name: 'performance_fixture', arguments: JSON.stringify({ turn }) },
      },
      {
        type: 'tool/result', seq: seq + 4, time: time + 4,
        data: {
          turn, step: 1,
          message: {
            id: `perf-tool-result-${turn}`,
            role: 'user',
            content: [{
              type: 'tool-result', toolCallId: callId,
              content: [{ type: 'text', text: `Result ${turn}` }], isError: false,
            }],
            source: { kind: 'tool', callId },
          },
        },
        sourceEventSeqs: [callSeq], surfaceOp: 'append',
      },
      {
        type: 'assistant/message', seq: seq + 5, time: time + 5,
        data: {
          turn, step: 1,
          message: {
            id: `perf-assistant-${turn}`, role: 'assistant',
            content: [{ type: 'text', text: `Performance assistant response ${turn}` }],
            source: { kind: 'model', provider: 'performance-fixture', model: 'performance-fixture' },
          },
        },
        surfaceOp: 'append',
      },
      { type: 'step/end', seq: seq + 6, time: time + 6, data: { turn, step: 1 } },
      { type: 'turn/end', seq: seq + 7, time: time + 7, data: { turn, reason: { kind: 'completed' } } },
    )
  }
  if (events.length !== EVENT_COUNT || events.some((event, seq) => event.seq !== seq)) {
    throw new Error('performance fixture event sequence is invalid')
  }
  return events
}

function digest(events) {
  return createHash('sha256').update(JSON.stringify(events)).digest('hex')
}

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    cwd: { type: 'string' },
  },
  strict: true,
})
if (values.root === undefined) throw new Error('--root is required')

const root = resolve(values.root)
const cwd = resolve(values.cwd ?? process.cwd())
const events = fixtureEvents()
const expectedDigest = digest(events)
const ctx = new Context()
const sessionFiber = await ctx.plugin(SessionStore)
const persistenceFiber = await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })

try {
  const existing = (await ctx.sessionPersistence.list()).find(item => item.id === SESSION_ID)
  if (existing === undefined) {
    await ctx.sessionPersistence.create({ version: 0, id: SESSION_ID, createdAt: BASE_TIME, cwd })
    for (let offset = 0; offset < events.length; offset += 500) {
      await ctx.sessionPersistence.append(SESSION_ID, events.slice(offset, offset + 500))
    }
  }
  const inspected = await ctx.sessionPersistence.inspect(SESSION_ID)
  const fixture = inspected.events.slice(0, EVENT_COUNT)
  const observedDigest = digest(fixture)
  if (fixture.length !== EVENT_COUNT || observedDigest !== expectedDigest) {
    throw new Error(`existing ${SESSION_ID} does not start with the fixed 5,000-event dataset (${fixture.length} fixture events, ${observedDigest})`)
  }
  const runtimeTail = inspected.events.slice(EVENT_COUNT)
  const invalidTailIndex = runtimeTail.findIndex((event, index) =>
    event.seq !== EVENT_COUNT + index || !RUNTIME_TAIL_TYPES.has(event.type))
  if (invalidTailIndex >= 0) {
    const event = runtimeTail[invalidTailIndex]
    throw new Error(`existing ${SESSION_ID} has a non-runtime event after the fixed dataset at seq ${String(event?.seq)} (${String(event?.type)})`)
  }
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    session_id: SESSION_ID,
    event_count: EVENT_COUNT,
    turn_count: TURN_COUNT,
    events_sha256: observedDigest,
    runtime_tail_event_count: runtimeTail.length,
    root,
    cwd,
    reused: existing !== undefined,
  })}\n`)
} finally {
  await persistenceFiber.dispose()
  await sessionFiber.dispose()
  await ctx.fiber.dispose()
}
