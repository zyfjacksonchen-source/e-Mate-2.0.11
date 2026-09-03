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
  }
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

test('projection builds a strict full nested checkpoint schema without record unknown escape hatches', () => {
  const stateSchema = imageBatchProjectionDefinition(z, SESSION).schema
  assert.equal(stateSchema.kind, 'array')
  const state = stateSchema.item
  assert.equal(state.kind, 'object')
  assert.equal(state.isStrict, true)
  assert.deepEqual(Object.keys(state.shape).sort(), [
    'accepted_events', 'batch_id', 'concurrency', 'parent_call_id', 'parent_session_id',
    'schema_version', 'status', 'tasks', 'terminal_event_id',
  ])
  assert.deepEqual([state.shape.concurrency.minimum, state.shape.concurrency.maximum], [1, 4])
  assert.deepEqual(state.shape.status.values, ['completed', 'partial', 'failed', 'cancelled'])
  assert.equal(state.shape.status.isOptional, true)
  assert.equal(state.shape.terminal_event_id.isOptional, true)

  const tasks = state.shape.tasks
  assert.deepEqual([tasks.minimum, tasks.maximum], [2, 8])
  assert.equal(tasks.item.kind, 'object')
  assert.equal(tasks.item.isStrict, true)
  assert.deepEqual(Object.keys(tasks.item.shape).sort(), [
    'child_session_id', 'failure_code', 'image_url', 'job_id', 'ordinal', 'prompt_sha256',
    'receipt', 'revision', 'state', 'submission_status', 'task_id', 'updated_at',
  ])
  assert.deepEqual([tasks.item.shape.ordinal.minimum, tasks.item.shape.ordinal.maximum], [1, 8])
  assert.deepEqual([tasks.item.shape.revision.minimum, tasks.item.shape.revision.maximum], [1, 2_147_483_647])
  assert.deepEqual(tasks.item.shape.state.values, ['queued', 'running', 'needs-review', 'completed', 'failed', 'cancelled', 'unknown', 'interrupted'])
  assert.deepEqual(tasks.item.shape.submission_status.values, ['not-submitted', 'submitted', 'unknown'])
  assert.equal(tasks.item.shape.image_url.maximum, 16)
  assert.equal(tasks.item.shape.child_session_id.isOptional, true)

  const receipt = tasks.item.shape.receipt
  assert.equal(receipt.kind, 'object')
  assert.equal(receipt.isStrict, true)
  assert.equal(receipt.isOptional, true)
  assert.deepEqual(Object.keys(receipt.shape).sort(), ['call_id', 'event_seq', 'owner_session_id', 'revision', 'status'])
  assert.deepEqual([receipt.shape.revision.minimum, receipt.shape.revision.maximum], [1, 3])
  assert.deepEqual([receipt.shape.event_seq.minimum, receipt.shape.event_seq.maximum], [0, Number.MAX_SAFE_INTEGER])
  assert.deepEqual(receipt.shape.status.values, ['completed', 'needs-review', 'failed', 'cancelled', 'unknown'])

  const accepted = state.shape.accepted_events
  assert.equal(accepted.minimum, 1)
  assert.equal(accepted.maximum, 34)
  assert.equal(accepted.item.kind, 'object')
  assert.equal(accepted.item.isStrict, true)
  assert.deepEqual(Object.keys(accepted.item.shape).sort(), ['canonical', 'event_id'])
  assert.deepEqual([accepted.item.shape.canonical.minimum, accepted.item.shape.canonical.maximum], [1, 65_536])
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

test('seeded random disorder, duplicate insertion, and corruption never creates another terminal or loses image evidence', () => {
  const { sequence, state: terminalState } = completedAndInterruptedEvents()
  let seed = 0x217102
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000)
  for (let round = 0; round < 100; round += 1) {
    const shuffled = sequence.map(clone)
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    if (shuffled.every((event, index) => event.event_id === sequence[index].event_id)) continue
    let state
    assert.throws(() => { for (const event of shuffled) state = append(state, event) }, /invalid image batch event:/u)
  }
  let state
  for (const event of sequence) {
    state = append(state, event)
    if (random() < 0.8) assert.equal(append(state, clone(event)), state)
  }
  assert.deepEqual(state, terminalState)
  const view = imageBatchProjectionDefinition(z, SESSION).view([state])[0]
  assert.equal(view.status, 'partial')
  assert.equal(view.image_evidence.length, 1)
  for (let round = 0; round < 50; round += 1) {
    const corrupt = clone(sequence[Math.floor(random() * sequence.length)])
    corrupt.event_id = imageBatchEventId(SESSION, CALL, 1 + Math.floor(random() * sequence.length))
    corrupt.occurred_at = `2026-02-17T12:35:${String(round % 60).padStart(2, '0')}.000Z`
    rejects(() => append(state, corrupt))
    assert.equal(state.status, 'partial')
    assert.equal(imageBatchProjectionDefinition(z).view([state])[0].image_evidence.length, 1)
  }
})
