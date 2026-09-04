import assert from 'node:assert/strict'
import test from 'node:test'

const moduleUrl = new URL('../src/profile/image-batch-events.ts', import.meta.url)
const globalsBefore = Reflect.ownKeys(globalThis)
const listenersBefore = new Map(['beforeExit', 'exit', 'uncaughtException', 'unhandledRejection'].map(name => [name, process.listenerCount(name)]))
const eventsModule = await import(`${moduleUrl.href}?purity=1`)
const globalsAfter = Reflect.ownKeys(globalThis)
const listenersAfter = new Map([...listenersBefore.keys()].map(name => [name, process.listenerCount(name)]))

const {
  imageBatchProjectionDefinition,
  reduceImageBatchEvent,
  validateImageBatchEvent,
} = eventsModule
const { imageBatchEventId, imageBatchId, imageBatchTaskId } = await import('../src/profile/image-batch.ts')

const SESSION = 'parent-session'
const CALL = 'parent-call'
const TIME = '2026-02-17T12:34:56.000Z'
const PROMPTS = ['1'.repeat(64), '2'.repeat(64)]
const A = `sha256:${'a'.repeat(64)}`

const clone = value => structuredClone(value)
const rejects = fn => assert.throws(fn, /invalid image batch event:/u)
const common = ordinal => ({
  schema_version: 1,
  event_id: imageBatchEventId(SESSION, CALL, ordinal),
  batch_id: imageBatchId(SESSION, CALL),
  parent_session_id: SESSION,
  parent_call_id: CALL,
  occurred_at: TIME,
})
const queued = ordinal => ({
  task_id: imageBatchTaskId(SESSION, CALL, ordinal),
  ordinal,
  revision: 1,
  state: 'queued',
  submission_status: 'not-submitted',
  prompt_sha256: PROMPTS[ordinal - 1],
  image_url: ordinal === 1 ? [] : [A],
})
const created = (ordinal = 1, concurrency = 3) => ({
  ...common(ordinal), kind: 'created', concurrency, tasks: [queued(1), queued(2)],
})
const linked = (task, revision = task.revision + 1) => ({
  ...task, revision, child_session_id: `child-${task.ordinal}`, updated_at: TIME,
})
const pointer = (task, status = 'completed', revision = 2, event_seq = 7) => ({
  owner_session_id: task.child_session_id,
  call_id: `imagegen-${task.ordinal}`,
  revision,
  event_seq,
  status,
})
const running = (task, revision = task.revision + 1) => ({
  ...task, revision, state: 'running', submission_status: 'submitted', job_id: `job-${task.ordinal}`, updated_at: TIME,
})
const completed = (task, revision = task.revision + 1, receipt = pointer(task)) => ({
  ...task, revision, state: 'completed', submission_status: 'submitted', receipt, updated_at: TIME,
})
const failed = (task, revision = task.revision + 1, extra = {}) => ({
  ...task, revision, state: 'failed', failure_code: 'contract-failed', updated_at: TIME, ...extra,
})
const cancelled = (task, revision = task.revision + 1) => ({
  ...task, revision, state: 'cancelled', failure_code: 'cancelled', updated_at: TIME,
})
const interrupted = (task, revision = task.revision + 1) => ({
  ...task, revision, state: 'interrupted', submission_status: 'not-submitted', failure_code: 'not-submitted', updated_at: TIME,
})
const eventFor = (ordinal, kind, task) => ({ ...common(ordinal), kind, task })
const terminal = (ordinal, status, tasks) => ({ ...common(ordinal), kind: 'terminal', status, tasks })
const append = (state, event) => reduceImageBatchEvent(state, event, SESSION)
const nextOrdinal = state => (state?.accepted_events.length ?? 0) + 1
const appendTask = (state, kind, task) => append(state, eventFor(nextOrdinal(state), kind, task))

function completedAndInterruptedEvents() {
  let state
  const sequence = [created()]
  state = append(state, sequence[0])
  const link = linked(state.tasks[0], 4)
  sequence.push(eventFor(2, 'task-linked', link)); state = append(state, sequence.at(-1))
  const run = running(state.tasks[0], 8)
  sequence.push(eventFor(3, 'task-state', run)); state = append(state, sequence.at(-1))
  const done = completed(state.tasks[0], 12)
  sequence.push(eventFor(4, 'task-state', done)); state = append(state, sequence.at(-1))
  const stopped = interrupted(state.tasks[1], 9)
  sequence.push(eventFor(5, 'task-state', stopped)); state = append(state, sequence.at(-1))
  sequence.push(terminal(6, 'partial', state.tasks)); state = append(state, sequence.at(-1))
  return { sequence, state }
}

function schemaNode(kind, properties = {}) {
  return {
    kind,
    ...properties,
    strict() { this.isStrict = true; return this },
    optional() { this.isOptional = true; return this },
    int() { this.isInteger = true; return this },
    min(value) { this.minimum = value; return this },
    max(value) { this.maximum = value; return this },
    regex(value) { this.pattern = value; return this },
    refine(check, message) { this.refinement = { check, message }; return this },
    parse(value) { parseSchema(this, value); return value },
  }
}
function parseSchema(schema, value) {
  if (schema.isOptional && value === undefined) return
  if (schema.kind === 'array') {
    assert(Array.isArray(value)); if (schema.minimum !== undefined) assert(value.length >= schema.minimum)
    if (schema.maximum !== undefined) assert(value.length <= schema.maximum)
    for (const item of value) parseSchema(schema.item, item)
  } else if (schema.kind === 'object') {
    assert(value !== null && typeof value === 'object' && !Array.isArray(value))
    if (schema.isStrict) assert(Object.keys(value).every(key => Object.hasOwn(schema.shape, key)))
    for (const [key, child] of Object.entries(schema.shape)) parseSchema(child, value[key])
  } else if (schema.kind === 'string') {
    assert.equal(typeof value, 'string'); if (schema.minimum !== undefined) assert(value.length >= schema.minimum)
    if (schema.maximum !== undefined) assert(value.length <= schema.maximum); if (schema.pattern !== undefined) assert(schema.pattern.test(value))
  } else if (schema.kind === 'number') {
    assert.equal(typeof value, 'number'); if (schema.isInteger) assert(Number.isInteger(value))
    if (schema.minimum !== undefined) assert(value >= schema.minimum); if (schema.maximum !== undefined) assert(value <= schema.maximum)
  } else if (schema.kind === 'enum') assert(schema.values.includes(value))
  else if (schema.kind === 'literal') assert.equal(value, schema.value)
  if (schema.refinement !== undefined) assert(schema.refinement.check(value), schema.refinement.message)
}
const z = {
  array: item => schemaNode('array', { item }),
  enum: values => schemaNode('enum', { values }),
  literal: value => schemaNode('literal', { value }),
  number: () => schemaNode('number'),
  object: shape => schemaNode('object', { shape }),
  string: () => schemaNode('string'),
  record: () => { throw new Error('projection checkpoint must not use record') },
  unknown: () => { throw new Error('projection checkpoint must not use unknown') },
}

test('module is pure and exports only the validator, reducer, and projection factory', () => {
  assert.deepEqual(Reflect.ownKeys(globalThis), globalsAfter)
  assert.deepEqual(globalsBefore, globalsAfter)
  assert.deepEqual(listenersBefore, listenersAfter)
  assert.deepEqual(Object.keys(eventsModule).sort(), [
    'imageBatchProjectionDefinition', 'reduceImageBatchEvent', 'validateImageBatchEvent',
  ])
})

test('validator accepts and freezes all four exact schema-1 event kinds', () => {
  const create = validateImageBatchEvent(created(), { eventOrdinal: 1, parentSessionId: SESSION, parentCallId: CALL })
  const linkTask = linked(create.tasks[0])
  const link = validateImageBatchEvent(eventFor(2, 'task-linked', linkTask), { eventOrdinal: 2, parentSessionId: SESSION, parentCallId: CALL })
  const runTask = running(link.task)
  const state = validateImageBatchEvent(eventFor(3, 'task-state', runTask), { eventOrdinal: 3, parentSessionId: SESSION, parentCallId: CALL })
  const finalTasks = [completed(state.task), interrupted(create.tasks[1])]
  const end = validateImageBatchEvent(terminal(4, 'partial', finalTasks), { eventOrdinal: 4, parentSessionId: SESSION, parentCallId: CALL })
  assert.deepEqual([create.kind, link.kind, state.kind, end.kind], ['created', 'task-linked', 'task-state', 'terminal'])
  assert(Object.isFrozen(create) && Object.isFrozen(create.tasks) && Object.isFrozen(create.tasks[0]) && Object.isFrozen(create.tasks[1].image_url))
  assert(Object.isFrozen(link.task) && Object.isFrozen(end.tasks))
})

test('validator recomputes every identity and enforces created order, uniqueness, and concurrency', () => {
  for (const mutate of [
    value => { value.event_id = imageBatchEventId(SESSION, CALL, 2) },
    value => { value.batch_id = imageBatchId(SESSION, 'other') },
    value => { value.parent_session_id = 'other' },
    value => { value.parent_call_id = 'other' },
    value => { value.tasks[0].task_id = imageBatchTaskId(SESSION, CALL, 2) },
    value => { value.tasks.reverse() },
    value => { value.tasks[1] = clone(value.tasks[0]) },
    value => { value.concurrency = 0 },
    value => { value.concurrency = 5 },
  ]) {
    const value = created(); mutate(value)
    rejects(() => validateImageBatchEvent(value, { eventOrdinal: 1, parentSessionId: SESSION, parentCallId: CALL }))
  }
  rejects(() => validateImageBatchEvent(created(), { eventOrdinal: 1, parentSessionId: SESSION, parentCallId: CALL, extra: true }))
})

test('validator rejects noncanonical snapshots, unsafe scalars, invalid dates, and extra data', () => {
  const mutations = [
    value => { value.extra = true },
    value => { value.kind = { toString: () => 'created' } },
    value => { value.occurred_at = '2026-02-30T12:00:00Z' },
    value => { value.tasks[0].revision = 2 },
    value => { value.tasks[0].state = { toString: () => 'queued' } },
    value => { value.tasks[0].submission_status = 1 },
    value => { value.tasks[0].submission_status = { toString: () => 'not-submitted' } },
    value => { value.tasks[0].prompt_sha256 = 'A'.repeat(64) },
    value => { value.tasks[0].image_url = [A, A] },
    value => { value.tasks[0].image_url = Array(17).fill(A).map((id, i) => i ? `sha256:${String(i).padStart(64, '0')}` : id) },
    value => { value.tasks[0].child_session_id = 'child' },
    value => { value.tasks[0].failure_code = 'NOT_ALLOWED' },
    value => { value.tasks[0].updated_at = 'not-a-date' },
  ]
  for (const mutate of mutations) {
    const value = created(); mutate(value)
    rejects(() => validateImageBatchEvent(value, { eventOrdinal: 1, parentSessionId: SESSION, parentCallId: CALL }))
  }
  const terminalEvent = terminal(1, { toString: () => 'failed' }, [failed(queued(1)), interrupted(queued(2))])
  rejects(() => validateImageBatchEvent(terminalEvent, { eventOrdinal: 1, parentSessionId: SESSION, parentCallId: CALL }))
})

test('receipt validation is pointer-only and state-specific', () => {
  const create = validateImageBatchEvent(created(), { eventOrdinal: 1, parentSessionId: SESSION, parentCallId: CALL })
  const run = running(linked(create.tasks[0]))
  const done = completed(run)
  validateImageBatchEvent(eventFor(2, 'task-state', done), { eventOrdinal: 2, parentSessionId: SESSION, parentCallId: CALL })
  for (const mutate of [
    task => { task.receipt.attachment = { attachmentId: A } },
    task => { task.receipt.owner_session_id = 'other-child' },
    task => { task.receipt.revision = 1 },
    task => { task.receipt.revision = 4 },
    task => { task.receipt.event_seq = -1 },
    task => { task.receipt.status = 'needs-review' },
    task => { task.receipt.status = { toString: () => 'completed' } },
    task => { task.failure_code = 'unexpected' },
  ]) {
    const task = clone(done); mutate(task)
    rejects(() => validateImageBatchEvent(eventFor(2, 'task-state', task), { eventOrdinal: 2, parentSessionId: SESSION, parentCallId: CALL }))
  }
})

test('reducer accepts strict revision increases, split link/state events, and legal review receipt advancement', () => {
  let state = append(undefined, created())
  state = appendTask(state, 'task-linked', linked(state.tasks[0], 10))
  state = appendTask(state, 'task-state', running(state.tasks[0], 20))
  const reviewReceipt = pointer(state.tasks[0], 'needs-review', 2, 30)
  const review = { ...state.tasks[0], revision: 30, state: 'needs-review', receipt: reviewReceipt }
  state = appendTask(state, 'task-state', review)
  const finalReceipt = pointer(state.tasks[0], 'completed', 3, 31)
  state = appendTask(state, 'task-state', completed(state.tasks[0], 40, finalReceipt))
  assert.equal(state.tasks[0].state, 'completed')
  assert.equal(state.tasks[0].receipt.revision, 3)
})

test('reducer permits every ADR transition and rejects regressions, repeats, and cross-batch injection', () => {
  for (const target of ['failed', 'cancelled', 'interrupted']) {
    let state = append(undefined, created())
    const task = target === 'failed' ? failed(state.tasks[0]) : target === 'cancelled' ? cancelled(state.tasks[0]) : interrupted(state.tasks[0])
    state = appendTask(state, 'task-state', task)
    assert.equal(state.tasks[0].state, target)
  }
  for (const target of ['needs-review', 'completed', 'failed', 'cancelled', 'unknown']) {
    let state = append(undefined, created())
    state = appendTask(state, 'task-linked', linked(state.tasks[0]))
    state = appendTask(state, 'task-state', running(state.tasks[0]))
    const task = target === 'needs-review'
      ? { ...state.tasks[0], revision: 4, state: target, receipt: pointer(state.tasks[0], target) }
      : target === 'completed' ? completed(state.tasks[0])
        : target === 'failed' ? failed(state.tasks[0])
          : target === 'cancelled' ? cancelled(state.tasks[0])
            : { ...failed(state.tasks[0]), state: 'unknown', submission_status: 'unknown', failure_code: 'outcome-unknown' }
    state = appendTask(state, 'task-state', task)
    assert.equal(state.tasks[0].state, target)
  }
  let state = append(undefined, created())
  state = appendTask(state, 'task-linked', linked(state.tasks[0]))
  const repeat = running(state.tasks[0], state.tasks[0].revision)
  rejects(() => appendTask(state, 'task-state', repeat))
  const wrong = eventFor(nextOrdinal(state), 'task-state', failed(state.tasks[0]))
  wrong.parent_call_id = 'other'; wrong.batch_id = imageBatchId(SESSION, 'other'); wrong.event_id = imageBatchEventId(SESSION, 'other', nextOrdinal(state))
  rejects(() => append(state, wrong))
  state = appendTask(state, 'task-state', running(state.tasks[0]))
  state = appendTask(state, 'task-state', completed(state.tasks[0]))
  rejects(() => appendTask(state, 'task-state', { ...state.tasks[0], revision: 99, state: 'running', receipt: undefined }))
})

test('queued unknown requires a durable child link and preserves ambiguous submission', () => {
  let linkedState = append(undefined, created())
  linkedState = appendTask(linkedState, 'task-linked', linked(linkedState.tasks[0]))
  linkedState = appendTask(linkedState, 'task-state', {
    ...linkedState.tasks[0], revision: linkedState.tasks[0].revision + 1,
    state: 'unknown', submission_status: 'unknown', failure_code: 'provider-outcome-unknown', updated_at: TIME,
  })
  assert.equal(linkedState.tasks[0].state, 'unknown')
  assert.equal(linkedState.tasks[0].submission_status, 'unknown')
  assert.equal(linkedState.tasks[0].child_session_id, 'child-1')

  const unlinked = append(undefined, created())
  rejects(() => appendTask(unlinked, 'task-state', {
    ...unlinked.tasks[0], revision: 2, state: 'unknown', submission_status: 'unknown',
    failure_code: 'provider-outcome-unknown', updated_at: TIME,
  }))
})

test('exact duplicate events are idempotent while same-ID conflicts are corruption', () => {
  const first = append(undefined, created())
  assert.equal(append(first, clone(created())), first)
  const conflicting = created()
  conflicting.occurred_at = '2026-02-17T12:34:57.000Z'
  rejects(() => append(first, conflicting))
})

test('terminal summary is unique and deterministically covers completed, partial, cancelled, and failed', () => {
  const cases = [
    ['completed', (a, b) => [completed(running(linked(a))), completed(running(linked(b)))], 'completed'],
    ['partial', (a, b) => [failed(running(linked(a)), 4, { receipt: pointer(linked(a), 'completed') }), interrupted(b)], 'partial'],
    ['cancelled', (a, b) => [cancelled(a), interrupted(b)], 'cancelled'],
    ['failed', (a, b) => [failed(a), interrupted(b)], 'failed'],
  ]
  for (const [, makeTasks, expected] of cases) {
    let state = append(undefined, created())
    const tasks = makeTasks(state.tasks[0], state.tasks[1])
    for (const task of tasks) {
      if (task.child_session_id) state = appendTask(state, 'task-linked', linked(state.tasks[task.ordinal - 1]))
      if (task.job_id) state = appendTask(state, 'task-state', running(state.tasks[task.ordinal - 1]))
      const current = state.tasks[task.ordinal - 1]
      state = appendTask(state, 'task-state', { ...task, revision: current.revision + 10 })
    }
    const end = terminal(nextOrdinal(state), expected, state.tasks)
    state = append(state, end)
    assert.equal(state.status, expected)
    assert.equal(append(state, clone(end)), state)
    rejects(() => append(state, terminal(nextOrdinal(state), expected, state.tasks)))
  }
})

test('whole snapshots preserve proven image pointers on failed tasks in both image and failure projections', () => {
  let state = append(undefined, created())
  state = appendTask(state, 'task-linked', linked(state.tasks[0]))
  state = appendTask(state, 'task-state', running(state.tasks[0]))
  state = appendTask(state, 'task-state', failed(state.tasks[0], 9, { receipt: pointer(state.tasks[0], 'completed') }))
  state = appendTask(state, 'task-state', interrupted(state.tasks[1]))
  state = append(state, terminal(nextOrdinal(state), 'partial', state.tasks))
  const view = imageBatchProjectionDefinition(z, SESSION).view([state])[0]
  assert.equal(view.tasks[0].state, 'failed')
  assert.equal(view.image_evidence.length, 1)
  assert.equal(view.failures.length, 2)
  assert.equal(view.image_evidence[0].receipt.status, 'completed')
  assert.deepEqual(Object.keys(view.image_evidence[0].receipt).sort(), ['call_id', 'event_seq', 'owner_session_id', 'revision', 'status'])
  assert(!JSON.stringify(view).includes('attachment'))
})

test('projection schema describes the strict public view rather than reducer checkpoints', () => {
  const schema = imageBatchProjectionDefinition(z, SESSION).schema
  assert.equal(schema.kind, 'array')
  const row = schema.item
  assert.equal(row.kind, 'object')
  assert.equal(row.isStrict, true)
  assert.deepEqual(Object.keys(row.shape).sort(), [
    'batch_id', 'concurrency', 'failures', 'image_evidence', 'parent_call_id', 'parent_session_id',
    'schema_version', 'status', 'tasks', 'terminal_event_id',
  ])
  assert.equal(row.shape.accepted_events, undefined)
  assert.deepEqual(row.shape.status.values, ['completed', 'partial', 'failed', 'cancelled'])
  assert.equal(row.shape.status.isOptional, true)
  assert.equal(row.shape.terminal_event_id.isOptional, true)
  assert.equal(row.refinement.check({}), true)
  assert.equal(row.refinement.check({ status: 'failed' }), false)
  assert.equal(row.refinement.check({ terminal_event_id: 'x' }), false)
  assert.equal(row.refinement.check({ status: 'failed', terminal_event_id: 'x' }), true)

  const tasks = row.shape.tasks
  assert.deepEqual([tasks.minimum, tasks.maximum], [2, 8])
  assert.deepEqual(Object.keys(tasks.item.shape).sort(), [
    'child_session_id', 'failure_code', 'image_url', 'job_id', 'ordinal', 'prompt_sha256',
    'receipt', 'revision', 'state', 'submission_status', 'task_id', 'updated_at',
  ])
  const evidence = row.shape.image_evidence
  assert.equal(evidence.maximum, 8)
  assert.deepEqual(Object.keys(evidence.item.shape).sort(), ['child_session_id', 'ordinal', 'receipt', 'task_id'])
  assert.deepEqual(evidence.item.shape.receipt.shape.status.values, ['completed'])
  assert.equal(evidence.item.shape.receipt.shape.revision.minimum, 2)
  assert.equal(tasks.item.shape.receipt.shape.revision.minimum, 2)
  const failures = row.shape.failures
  assert.equal(failures.maximum, 8)
  assert.deepEqual(Object.keys(failures.item.shape).sort(), [
    'child_session_id', 'failure_code', 'job_id', 'ordinal', 'receipt', 'state', 'task_id',
  ])
  assert.deepEqual(failures.item.shape.state.values, ['failed', 'cancelled', 'unknown', 'interrupted'])
})

test('projection schema parses public init, created, running, and terminal views', () => {
  const projection = imageBatchProjectionDefinition(z, SESSION)
  let state = projection.init()
  assert.deepEqual(projection.schema.parse(projection.view(state)), [])
  state = projection.apply(state, { type: 'emate/image-batch', data: created() })
  projection.schema.parse(projection.view(state))
  const firstLink = linked(projection.view(state)[0].tasks[0])
  state = projection.apply(state, { type: 'emate/image-batch', data: eventFor(2, 'task-linked', firstLink) })
  state = projection.apply(state, { type: 'emate/image-batch', data: eventFor(3, 'task-state', running(firstLink)) })
  projection.schema.parse(projection.view(state))
  state = projection.apply(state, { type: 'emate/image-batch', data: eventFor(4, 'task-state', completed(state[0].tasks[0])) })
  state = projection.apply(state, { type: 'emate/image-batch', data: eventFor(5, 'task-state', interrupted(state[0].tasks[1])) })
  state = projection.apply(state, { type: 'emate/image-batch', data: terminal(6, 'partial', state[0].tasks) })
  const view = projection.view(state)
  assert.equal(projection.schema.parse(view), view)

  for (const mutate of [
    row => { row.accepted_events = [] },
    row => { delete row.image_evidence },
    row => { delete row.failures },
    row => { row.image_evidence[0].receipt.status = 'failed' },
    row => { row.failures[0].extra = true },
    row => { delete row.terminal_event_id },
  ]) {
    const bad = structuredClone(view); mutate(bad[0])
    assert.throws(() => projection.schema.parse(bad))
  }
})

test('reducer cannot create checkpoint rows beyond schema bounds', () => {
  const originalStringify = JSON.stringify
  try {
    JSON.stringify = value => value?.kind === 'created' ? 'x'.repeat(65_537) : originalStringify(value)
    rejects(() => append(undefined, created()))
  } finally {
    JSON.stringify = originalStringify
  }

  const state = clone(append(undefined, created()))
  state.accepted_events = Array.from({ length: 34 }, (_, index) => ({
    event_id: imageBatchEventId(SESSION, CALL, index + 1),
    canonical: '{}',
  }))
  rejects(() => append(state, eventFor(35, 'task-linked', linked(state.tasks[0]))))
})

test('projection factory exposes immutable queued and running state before the parent turn closes', () => {
  const projection = imageBatchProjectionDefinition(z, SESSION)
  assert.equal(projection.key, 'eMateImageBatches')
  assert.equal(projection.schema.kind, 'array')
  assert.equal(projection.stateVersion, 1)
  let state = projection.init()
  const unrelated = { type: 'message', data: { text: 'still open' } }
  assert.equal(projection.apply(state, unrelated), state)
  state = projection.apply(state, { type: 'emate/image-batch', data: created() })
  let view = projection.view(state)
  assert.equal(view[0].tasks[0].state, 'queued')
  assert.equal(view[0].status, undefined)
  const link = linked(view[0].tasks[0])
  state = projection.apply(state, { type: 'emate/image-batch', data: eventFor(2, 'task-linked', link) })
  state = projection.apply(state, { type: 'emate/image-batch', data: eventFor(3, 'task-state', running(link)) })
  view = projection.view(state)
  assert.equal(view[0].tasks[0].state, 'running')
  assert(Object.isFrozen(state) && Object.isFrozen(view) && Object.isFrozen(view[0]) && Object.isFrozen(view[0].tasks[0]))
  assert.throws(() => view.push({}), TypeError)
})

test('projection isolates batches by recomputed identity and deterministic replay', () => {
  const projection = imageBatchProjectionDefinition(z, SESSION)
  const { sequence, state: expected } = completedAndInterruptedEvents()
  const first = sequence.reduce((state, data) => projection.apply(state, { type: 'emate/image-batch', data }), projection.init())
  const second = sequence.reduce((state, data) => projection.apply(state, { type: 'emate/image-batch', data: clone(data) }), projection.init())
  assert.deepEqual(first, second)
  assert.deepEqual(first[0], expected)
  const unknown = eventFor(1, 'task-state', failed(queued(1)))
  rejects(() => projection.apply(projection.init(), { type: 'emate/image-batch', data: unknown }))
})

test('10,000 seeded legal and illegal state sequences preserve terminal, image, identity, duplicate, and summary invariants', () => {
  const ITERATIONS = 5_000
  const EXPECTED_SEQUENCE_COUNT = 10_000
  const taskCounts = [2, 4, 5, 8]
  const finalStatuses = ['completed', 'partial', 'cancelled', 'failed']
  const corruptionsSeen = new Set()
  const statusesSeen = new Set()
  const countsSeen = new Set()
  let seed = 0x217501
  let sequenceCount = 0
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000)

  const context = (session, call, ordinal) => ({
    schema_version: 1,
    event_id: imageBatchEventId(session, call, ordinal),
    batch_id: imageBatchId(session, call),
    parent_session_id: session,
    parent_call_id: call,
    occurred_at: TIME,
  })
  const initialTask = (session, call, ordinal, prompt) => ({
    task_id: imageBatchTaskId(session, call, ordinal),
    ordinal,
    revision: 1,
    state: 'queued',
    submission_status: 'not-submitted',
    prompt_sha256: prompt,
    image_url: random() < 0.5 ? [] : [`sha256:${ordinal.toString(16).padStart(64, '0')}`],
  })
  const event = (session, call, ordinal, kind, task) => ({ ...context(session, call, ordinal), kind, task })
  const add = (state, sequence, session, data) => {
    const next = reduceImageBatchEvent(state, data, session)
    assert.equal(reduceImageBatchEvent(next, clone(data), session), next, 'every exact duplicate must be idempotent')
    sequence.push(data)
    return next
  }
  const finishTask = (state, sequence, session, call, index, outcome) => {
    let task = state.tasks[index]
    const appendTaskEvent = (kind, next) => {
      state = add(state, sequence, session, event(session, call, state.accepted_events.length + 1, kind, next))
      task = state.tasks[index]
    }
    if (outcome === 'interrupted') {
      appendTaskEvent('task-state', { ...task, revision: task.revision + 1, state: 'interrupted',
        failure_code: 'not-submitted', updated_at: TIME })
      return state
    }
    if ((outcome === 'failed' || outcome === 'cancelled') && random() < 0.35) {
      appendTaskEvent('task-state', { ...task, revision: task.revision + 1, state: outcome,
        failure_code: outcome === 'failed' ? 'preflight' : 'cancelled', updated_at: TIME })
      return state
    }
    appendTaskEvent('task-linked', { ...task, revision: task.revision + 1,
      child_session_id: `child-${call}-${task.ordinal}`, updated_at: TIME })
    if (outcome === 'unknown' && random() < 0.35) {
      appendTaskEvent('task-state', { ...task, revision: task.revision + 1, state: 'unknown',
        submission_status: 'unknown', failure_code: 'outcome-unknown', updated_at: TIME })
      return state
    }
    appendTaskEvent('task-state', { ...task, revision: task.revision + 1, state: 'running',
      submission_status: 'submitted', job_id: `job-${call}-${task.ordinal}`, updated_at: TIME })
    const receipt = (status, revision = 2, event_seq = state.accepted_events.length + 10) => ({
      owner_session_id: task.child_session_id,
      call_id: `imagegen-${call}-${task.ordinal}`,
      revision,
      event_seq,
      status,
    })
    if (outcome === 'completed' && random() < 0.25) {
      appendTaskEvent('task-state', { ...task, revision: task.revision + 1, state: 'needs-review',
        receipt: receipt('needs-review'), updated_at: TIME })
      appendTaskEvent('task-state', { ...task, revision: task.revision + 1, state: 'completed',
        receipt: receipt('completed', 3, task.receipt.event_seq + 1), updated_at: TIME })
      return state
    }
    const stateName = outcome === 'image-failed' ? 'failed' : outcome
    const result = { ...task, revision: task.revision + 1, state: stateName, updated_at: TIME }
    if (stateName === 'completed') result.receipt = receipt('completed')
    else {
      result.failure_code = stateName === 'unknown' ? 'outcome-unknown' : stateName
      if (stateName === 'unknown') result.submission_status = 'unknown'
      if (outcome === 'image-failed') result.receipt = receipt('completed')
    }
    appendTaskEvent('task-state', result)
    return state
  }

  for (let round = 0; round < ITERATIONS; round += 1) {
    const session = `property-session-${round}`
    const call = `property-call-${round}`
    const count = taskCounts[round % taskCounts.length]
    const expectedStatus = finalStatuses[round % finalStatuses.length]
    const commonPrompt = (round % 3).toString(16).padStart(64, '0')
    const tasks = Array.from({ length: count }, (_, index) => initialTask(
      session, call, index + 1,
      round % 3 === 0 ? commonPrompt : (round * 8 + index + 1).toString(16).padStart(64, '0'),
    ))
    const create = { ...context(session, call, 1), kind: 'created', concurrency: 1 + round % 4, tasks }
    const sequence = []
    let state = add(undefined, sequence, session, create)
    const outcomes = expectedStatus === 'completed'
      ? Array(count).fill('completed')
      : expectedStatus === 'partial'
        ? Array.from({ length: count }, (_, index) => index === 0 ? 'completed' : index === 1 ? 'interrupted'
          : ['completed', 'failed', 'cancelled', 'unknown', 'image-failed'][Math.floor(random() * 5)])
        : expectedStatus === 'cancelled'
          ? Array.from({ length: count }, () => random() < 0.5 ? 'cancelled' : 'interrupted')
          : Array.from({ length: count }, () => random() < 0.5 ? 'failed' : 'unknown')
    for (let index = 0; index < count; index += 1) state = finishTask(state, sequence, session, call, index, outcomes[index])
    const preTerminalState = state
    const end = { ...context(session, call, state.accepted_events.length + 1), kind: 'terminal', status: expectedStatus, tasks: state.tasks }
    state = add(state, sequence, session, end)
    sequenceCount += 1

    const view = imageBatchProjectionDefinition(z, session).view([state])[0]
    const completedIds = state.tasks.filter(task => task.receipt?.status === 'completed').map(task => task.task_id)
    assert.equal(state.accepted_events.filter(item => JSON.parse(item.canonical).kind === 'terminal').length, 1)
    assert.equal(state.status, expectedStatus)
    assert.equal(view.terminal_event_id, end.event_id)
    assert.equal(view.tasks.length, count)
    assert.deepEqual(view.image_evidence.map(item => item.task_id), completedIds, 'no completed image pointer may be lost')
    assert.deepEqual(view.failures.map(item => item.task_id),
      state.tasks.filter(task => task.state !== 'completed').map(task => task.task_id),
      'final summary must include every failed task, including image-bearing failures')
    rejects(() => reduceImageBatchEvent(state, {
      ...context(session, call, state.accepted_events.length + 1), kind: 'terminal', status: expectedStatus, tasks: state.tasks,
    }, session))
    statusesSeen.add(state.status)
    countsSeen.add(count)

    const corrupt = clone(end)
    const requestedCorruption = Math.floor(round / 4) % 8
    const pointerTask = corrupt.tasks.find(task => task.receipt)
    const childTask = corrupt.tasks.find(task => task.child_session_id)
    let corruption = requestedCorruption
    if ((corruption === 3 || corruption === 4 || corruption === 5) && pointerTask === undefined) corruption = 7
    if (corruption === 2 && childTask === undefined) corruption = 1
    let expectedRejection
    if (corruption === 0) {
      corrupt.parent_call_id = `foreign-call-${round}`
      expectedRejection = /cross-batch event injection/u
    } else if (corruption === 1) {
      corrupt.tasks[0].task_id = imageBatchTaskId(session, `foreign-call-${round}`, 1)
      expectedRejection = /task_id does not match its parent and ordinal/u
    } else if (corruption === 2) {
      childTask.child_session_id = `foreign-child-${round}`
      if (childTask.receipt) childTask.receipt.owner_session_id = childTask.child_session_id
      expectedRejection = /terminal must contain the current complete ordered task snapshots/u
    } else if (corruption === 3) {
      pointerTask.receipt.call_id = `foreign-image-call-${round}`
      expectedRejection = /terminal must contain the current complete ordered task snapshots/u
    } else if (corruption === 4) {
      pointerTask.receipt.client_request_id = `foreign-client-${round}`
      expectedRejection = /object keys do not match the schema/u
    } else if (corruption === 5) {
      pointerTask.receipt.revision = pointerTask.receipt.revision === 2 ? 3 : 2
      expectedRejection = /terminal must contain the current complete ordered task snapshots/u
    } else if (corruption === 6) {
      corrupt.occurred_at = '2026-02-30T12:34:56.000Z'
      expectedRejection = /occurred_at is invalid/u
    } else {
      corrupt.batch_id = imageBatchId(session, `foreign-call-${round}`)
      expectedRejection = /cross-batch event injection/u
    }
    const acceptedState = clone(state)
    const acceptedView = clone(view)
    assert.throws(() => reduceImageBatchEvent(preTerminalState, corrupt, session), expectedRejection)
    assert.deepEqual(state, acceptedState, 'a rejected unseen event must not mutate the accepted terminal state')
    assert.deepEqual(imageBatchProjectionDefinition(z, session).view([state])[0], acceptedView,
      'a rejected unseen event must not mutate the accepted terminal view')
    corruptionsSeen.add(corruption)
    sequenceCount += 1
  }

  assert.equal(ITERATIONS * 2, EXPECTED_SEQUENCE_COUNT)
  assert.equal(sequenceCount, EXPECTED_SEQUENCE_COUNT)
  assert.deepEqual([...countsSeen].sort((a, b) => a - b), taskCounts)
  assert.deepEqual([...statusesSeen].sort(), [...finalStatuses].sort())
  assert.deepEqual([...corruptionsSeen].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7])
})
