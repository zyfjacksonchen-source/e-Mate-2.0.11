import { imageBatchEventId, imageBatchId, imageBatchTaskId } from './image-batch.ts'

const EVENT_TYPE = 'emate/image-batch'
const PROJECTION_KEY = 'eMateImageBatches'
const MAX_REVISION = 2_147_483_647
const MAX_ACCEPTED_EVENTS = 34
const MAX_CANONICAL_EVENT_CHARS = 65_536
const DERIVED_ID = /^sha256:[0-9a-f]{64}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const ATTACHMENT_ID = DERIVED_ID
const NATIVE_ID = /^[^\u0000-\u001f\u007f]+$/u
const FAILURE_CODE = /^[a-z0-9][a-z0-9._-]*$/u
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u
const TASK_STATES = new Set(['queued', 'running', 'needs-review', 'completed', 'failed', 'cancelled', 'unknown', 'interrupted'])
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled', 'unknown', 'interrupted'])
const SUBMISSION_STATUSES = new Set(['not-submitted', 'submitted', 'unknown'])
const RECEIPT_STATUSES = new Set(['completed', 'needs-review', 'failed', 'cancelled', 'unknown'])
const TRANSITIONS = new Set([
  'queued:running', 'queued:failed', 'queued:cancelled', 'queued:unknown', 'queued:interrupted',
  'running:needs-review', 'running:completed', 'running:failed', 'running:cancelled', 'running:unknown',
  'needs-review:completed', 'needs-review:failed', 'needs-review:cancelled', 'needs-review:unknown',
])

export type ImageBatchTaskState = 'queued' | 'running' | 'needs-review' | 'completed' | 'failed' | 'cancelled' | 'unknown' | 'interrupted'
export type ImageBatchStatus = 'completed' | 'partial' | 'failed' | 'cancelled'
export interface ImageBatchReceiptPointer {
  readonly owner_session_id: string
  readonly call_id: string
  readonly revision: number
  readonly event_seq: number
  readonly status: 'completed' | 'needs-review' | 'failed' | 'cancelled' | 'unknown'
}
export interface ImageBatchTaskSnapshot {
  readonly task_id: string
  readonly ordinal: number
  readonly revision: number
  readonly state: ImageBatchTaskState
  readonly submission_status: 'not-submitted' | 'submitted' | 'unknown'
  readonly prompt_sha256: string
  readonly image_url: readonly string[]
  readonly child_session_id?: string
  readonly job_id?: string
  readonly receipt?: ImageBatchReceiptPointer
  readonly failure_code?: string
  readonly updated_at?: string
}
export interface ImageBatchEventValidationContext {
  readonly eventOrdinal: number
  readonly parentSessionId: string
  readonly parentCallId: string
}
interface ImageBatchEventBase {
  readonly schema_version: 1
  readonly event_id: string
  readonly batch_id: string
  readonly parent_session_id: string
  readonly parent_call_id: string
  readonly occurred_at: string
}
interface ImageBatchCreatedEvent extends ImageBatchEventBase {
  readonly kind: 'created'
  readonly concurrency: number
  readonly tasks: readonly ImageBatchTaskSnapshot[]
}
interface ImageBatchTaskLinkedEvent extends ImageBatchEventBase { readonly kind: 'task-linked'; readonly task: ImageBatchTaskSnapshot }
interface ImageBatchTaskStateEvent extends ImageBatchEventBase { readonly kind: 'task-state'; readonly task: ImageBatchTaskSnapshot }
interface ImageBatchTerminalEvent extends ImageBatchEventBase {
  readonly kind: 'terminal'
  readonly status: ImageBatchStatus
  readonly tasks: readonly ImageBatchTaskSnapshot[]
}
type ValidatedImageBatchEvent = ImageBatchCreatedEvent | ImageBatchTaskLinkedEvent | ImageBatchTaskStateEvent | ImageBatchTerminalEvent

interface ImageBatchProjectionSchema {
  int(): ImageBatchProjectionSchema
  max(value: number): ImageBatchProjectionSchema
  min(value: number): ImageBatchProjectionSchema
  optional(): ImageBatchProjectionSchema
  regex(pattern: RegExp): ImageBatchProjectionSchema
  refine(check: (value: any) => boolean, message?: string): ImageBatchProjectionSchema
  strict(): ImageBatchProjectionSchema
}
interface ImageBatchProjectionSchemaFactory {
  array(item: ImageBatchProjectionSchema): ImageBatchProjectionSchema
  enum(values: readonly string[]): ImageBatchProjectionSchema
  literal(value: number): ImageBatchProjectionSchema
  number(): ImageBatchProjectionSchema
  object(shape: Readonly<Record<string, ImageBatchProjectionSchema>>): ImageBatchProjectionSchema
  string(): ImageBatchProjectionSchema
}

export interface ImageBatchReducerState {
  readonly schema_version: 1
  readonly batch_id: string
  readonly parent_session_id: string
  readonly parent_call_id: string
  readonly concurrency: number
  readonly tasks: readonly ImageBatchTaskSnapshot[]
  readonly status?: ImageBatchStatus
  readonly terminal_event_id?: string
  readonly accepted_events: readonly { readonly event_id: string; readonly canonical: string }[]
}

function fail(message: string): never { throw new Error(`invalid image batch event: ${message}`) }
function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const keys = Object.keys(value)
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !required.includes(key) && !optional.includes(key))) {
    fail('object keys do not match the schema')
  }
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) fail(`${label} is out of bounds`)
  return value as number
}
function stringMatching(value: unknown, pattern: RegExp, min: number, max: number, label: string): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || !pattern.test(value)) fail(`${label} is invalid`)
  return value
}
function nativeId(value: unknown, label: string): string { return stringMatching(value, NATIVE_ID, 1, 256, label) }
function timestamp(value: unknown, label: string): string {
  const text = stringMatching(value, TIMESTAMP, 20, 35, label)
  const match = TIMESTAMP.exec(text)!
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const hour = Number(match[4]); const minute = Number(match[5]); const second = Number(match[6])
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const offset = text.endsWith('Z') ? undefined : text.slice(-6)
  if (month < 1 || month > 12 || day < 1 || day > days || hour > 23 || minute > 59 || second > 59
    || offset !== undefined && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) fail(`${label} is invalid`)
  return text
}
function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) frozen(child)
    Object.freeze(value)
  }
  return value
}
function same(left: unknown, right: unknown): boolean { return JSON.stringify(left) === JSON.stringify(right) }

function receipt(value: unknown): ImageBatchReceiptPointer {
  if (!isRecord(value)) fail('receipt must be an object')
  exactKeys(value, ['owner_session_id', 'call_id', 'revision', 'event_seq', 'status'])
  const status = value.status
  if (typeof status !== 'string' || !RECEIPT_STATUSES.has(status)) fail('receipt status is invalid')
  return {
    owner_session_id: nativeId(value.owner_session_id, 'receipt owner_session_id'),
    call_id: nativeId(value.call_id, 'receipt call_id'),
    revision: integer(value.revision, 2, 3, 'receipt revision'),
    event_seq: integer(value.event_seq, 0, Number.MAX_SAFE_INTEGER, 'receipt event_seq'),
    status,
  } as ImageBatchReceiptPointer
}

function taskSnapshot(value: unknown, mode: 'created' | 'linked' | 'state' | 'terminal'): ImageBatchTaskSnapshot {
  if (!isRecord(value)) fail('task snapshot must be an object')
  const required = ['task_id', 'ordinal', 'revision', 'state', 'submission_status', 'prompt_sha256', 'image_url']
  const optional = ['child_session_id', 'job_id', 'receipt', 'failure_code', 'updated_at']
  exactKeys(value, required, optional)
  const state = value.state
  const submission = value.submission_status
  if (typeof state !== 'string' || typeof submission !== 'string'
    || !TASK_STATES.has(state) || !SUBMISSION_STATUSES.has(submission)) fail('task state or submission status is invalid')
  const ordinal = integer(value.ordinal, 1, 8, 'task ordinal')
  const revision = integer(value.revision, 1, MAX_REVISION, 'task revision')
  const urls = value.image_url
  if (!Array.isArray(urls) || urls.length > 16 || urls.some(id => typeof id !== 'string' || !ATTACHMENT_ID.test(id))
    || new Set(urls).size !== urls.length) fail('image_url must be an ordered unique attachment list')
  const child = Object.hasOwn(value, 'child_session_id') ? nativeId(value.child_session_id, 'child_session_id') : undefined
  const job = Object.hasOwn(value, 'job_id') ? nativeId(value.job_id, 'job_id') : undefined
  const pointer = Object.hasOwn(value, 'receipt') ? receipt(value.receipt) : undefined
  const failure = Object.hasOwn(value, 'failure_code')
    ? stringMatching(value.failure_code, FAILURE_CODE, 1, 128, 'failure_code') : undefined
  const updated = Object.hasOwn(value, 'updated_at') ? timestamp(value.updated_at, 'updated_at') : undefined
  const result: ImageBatchTaskSnapshot = {
    task_id: stringMatching(value.task_id, DERIVED_ID, 71, 71, 'task_id'), ordinal, revision,
    state: state as ImageBatchTaskState, submission_status: submission as ImageBatchTaskSnapshot['submission_status'],
    prompt_sha256: stringMatching(value.prompt_sha256, SHA256, 64, 64, 'prompt_sha256'), image_url: [...urls] as string[],
    ...(child === undefined ? {} : { child_session_id: child }), ...(job === undefined ? {} : { job_id: job }),
    ...(pointer === undefined ? {} : { receipt: pointer }), ...(failure === undefined ? {} : { failure_code: failure }),
    ...(updated === undefined ? {} : { updated_at: updated }),
  }
  if (job !== undefined && child === undefined) fail('job_id requires child_session_id')
  if (pointer !== undefined && (child === undefined || pointer.owner_session_id !== child)) fail('receipt must point to the linked child Session')
  if (mode === 'created') {
    if (revision !== 1 || state !== 'queued' || submission !== 'not-submitted' || child || job || pointer || failure) fail('created task fields are invalid')
  } else if (mode === 'linked') {
    if (revision < 2 || state !== 'queued' || submission !== 'not-submitted' || !child || job || pointer || failure) fail('task-linked fields are invalid')
  } else {
    if (mode === 'terminal' && !TERMINAL_STATES.has(state)) fail('terminal contains a nonterminal task')
    if (state === 'queued') fail('task-state cannot contain queued')
    if (state === 'running' && (!child || !job || pointer || failure)) fail('running task fields are invalid')
    if ((state === 'needs-review' || state === 'completed')
      && (!child || !job || !pointer || submission !== 'submitted' || failure
        || pointer.status !== (state === 'completed' ? 'completed' : 'needs-review'))) fail(`${state} task fields are invalid`)
    if (state === 'interrupted' && (submission !== 'not-submitted' || child || job || pointer)) fail('interrupted task fields are invalid')
    if (TERMINAL_STATES.has(state) && state !== 'completed' && !failure) fail('terminal failure requires failure_code')
    if (pointer && state !== 'completed' && state !== 'needs-review') {
      const expected = state === 'failed' && pointer.status === 'completed' ? 'completed' : state
      if (pointer.status !== expected) fail('terminal task and receipt statuses conflict')
    }
  }
  return frozen(result)
}

function baseEvent(value: unknown) {
  if (!isRecord(value)) fail('event must be an object')
  const kind = value.kind
  if (typeof kind !== 'string') fail('kind is invalid')
  const common = ['schema_version', 'event_id', 'kind', 'batch_id', 'parent_session_id', 'parent_call_id', 'occurred_at']
  const required = kind === 'created' ? [...common, 'concurrency', 'tasks']
    : kind === 'task-linked' || kind === 'task-state' ? [...common, 'task']
      : kind === 'terminal' ? [...common, 'status', 'tasks'] : fail('kind is invalid')
  exactKeys(value, required)
  if (value.schema_version !== 1) fail('schema_version must be 1')
  return {
    value, kind, event_id: stringMatching(value.event_id, DERIVED_ID, 71, 71, 'event_id'),
    batch_id: stringMatching(value.batch_id, DERIVED_ID, 71, 71, 'batch_id'),
    parent_session_id: nativeId(value.parent_session_id, 'parent_session_id'),
    parent_call_id: nativeId(value.parent_call_id, 'parent_call_id'), occurred_at: timestamp(value.occurred_at, 'occurred_at'),
  }
}

export function validateImageBatchEvent(value: unknown, context: ImageBatchEventValidationContext): Readonly<ValidatedImageBatchEvent> {
  if (!isRecord(context)) fail('validation context must be an object')
  exactKeys(context as unknown as Record<string, unknown>, ['eventOrdinal', 'parentSessionId', 'parentCallId'])
  const eventOrdinal = integer(context.eventOrdinal, 1, Number.MAX_SAFE_INTEGER, 'event ordinal')
  const expectedSession = nativeId(context.parentSessionId, 'expected parent Session')
  const expectedCall = nativeId(context.parentCallId, 'expected parent call')
  const base = baseEvent(value)
  if (base.parent_session_id !== expectedSession || base.parent_call_id !== expectedCall) fail('parent Session or call identity mismatch')
  if (base.batch_id !== imageBatchId(expectedSession, expectedCall)) fail('batch_id does not match its parent identity')
  if (base.event_id !== imageBatchEventId(expectedSession, expectedCall, eventOrdinal)) fail('event_id is not the expected accepted-event ordinal')
  let result: ValidatedImageBatchEvent
  if (base.kind === 'created') {
    const concurrency = integer(base.value.concurrency, 1, 4, 'concurrency')
    if (!Array.isArray(base.value.tasks) || base.value.tasks.length < 2 || base.value.tasks.length > 8) fail('created tasks length is invalid')
    const tasks = base.value.tasks.map(item => taskSnapshot(item, 'created'))
    result = { schema_version: 1, event_id: base.event_id, kind: 'created', batch_id: base.batch_id,
      parent_session_id: base.parent_session_id, parent_call_id: base.parent_call_id, occurred_at: base.occurred_at, concurrency, tasks }
  } else if (base.kind === 'task-linked' || base.kind === 'task-state') {
    const task = taskSnapshot(base.value.task, base.kind === 'task-linked' ? 'linked' : 'state')
    result = { schema_version: 1, event_id: base.event_id, kind: base.kind, batch_id: base.batch_id,
      parent_session_id: base.parent_session_id, parent_call_id: base.parent_call_id, occurred_at: base.occurred_at, task }
  } else {
    const status = base.value.status
    if (typeof status !== 'string' || !['completed', 'partial', 'failed', 'cancelled'].includes(status)) fail('terminal status is invalid')
    if (!Array.isArray(base.value.tasks) || base.value.tasks.length < 2 || base.value.tasks.length > 8) fail('terminal tasks length is invalid')
    const tasks = base.value.tasks.map(item => taskSnapshot(item, 'terminal'))
    result = { schema_version: 1, event_id: base.event_id, kind: 'terminal', batch_id: base.batch_id,
      parent_session_id: base.parent_session_id, parent_call_id: base.parent_call_id, occurred_at: base.occurred_at,
      status: status as ImageBatchStatus, tasks }
  }
  const tasks = result.kind === 'created' || result.kind === 'terminal' ? result.tasks : [result.task]
  if (tasks.some((task, index) => task.ordinal !== index + 1 && base.kind !== 'task-linked' && base.kind !== 'task-state')) fail('tasks are reordered')
  for (const task of tasks) if (task.task_id !== imageBatchTaskId(expectedSession, expectedCall, task.ordinal)) fail('task_id does not match its parent and ordinal')
  if (new Set(tasks.map(task => task.task_id)).size !== tasks.length || new Set(tasks.map(task => task.ordinal)).size !== tasks.length) fail('task identities are not unique')
  return frozen(result)
}

function immutableTaskFieldsMatch(left: ImageBatchTaskSnapshot, right: ImageBatchTaskSnapshot): boolean {
  return left.task_id === right.task_id && left.ordinal === right.ordinal && left.prompt_sha256 === right.prompt_sha256
    && same(left.image_url, right.image_url)
}
function batchStatus(tasks: readonly ImageBatchTaskSnapshot[]): ImageBatchStatus {
  const images = tasks.filter(task => task.receipt?.status === 'completed').length
  const failures = tasks.filter(task => task.state !== 'completed').length
  if (tasks.every(task => task.state === 'completed') && images === tasks.length && failures === 0) return 'completed'
  if (images > 0 && failures > 0) return 'partial'
  if (images === 0 && tasks.every(task => task.state === 'cancelled' || task.state === 'interrupted')) return 'cancelled'
  return 'failed'
}

export function reduceImageBatchEvent(state: ImageBatchReducerState | undefined, value: unknown,
  expectedParentSessionId?: string): ImageBatchReducerState {
  const untrusted = baseEvent(value)
  const session = expectedParentSessionId === undefined ? untrusted.parent_session_id : nativeId(expectedParentSessionId, 'expected parent Session')
  const call = state?.parent_call_id ?? untrusted.parent_call_id
  if (state !== undefined && (untrusted.batch_id !== state.batch_id || untrusted.parent_session_id !== state.parent_session_id
    || untrusted.parent_call_id !== state.parent_call_id)) fail('cross-batch event injection')
  const duplicateIndex = state?.accepted_events.findIndex(item => item.event_id === untrusted.event_id) ?? -1
  const ordinal = duplicateIndex === -1 ? (state?.accepted_events.length ?? 0) + 1 : duplicateIndex + 1
  if (ordinal > MAX_ACCEPTED_EVENTS) fail('accepted event count exceeds the protocol maximum')
  const event = validateImageBatchEvent(value, { eventOrdinal: ordinal, parentSessionId: session, parentCallId: call })
  const canonical = JSON.stringify(event)
  if (canonical.length > MAX_CANONICAL_EVENT_CHARS) fail('canonical event exceeds the checkpoint maximum')
  if (duplicateIndex !== -1) {
    if (state!.accepted_events[duplicateIndex].canonical !== canonical) fail('event_id conflicts with an accepted event')
    return state!
  }
  if (state === undefined) {
    if (event.kind !== 'created') fail('created must be the first event')
    return frozen({ schema_version: 1, batch_id: event.batch_id, parent_session_id: event.parent_session_id,
      parent_call_id: event.parent_call_id, concurrency: event.concurrency, tasks: event.tasks,
      accepted_events: [{ event_id: event.event_id, canonical }] })
  }
  if (state.terminal_event_id !== undefined) fail('batch is already terminal')
  let tasks = state.tasks
  let status = state.status
  let terminalEventId = state.terminal_event_id
  if (event.kind === 'created') fail('created may occur only once')
  if (event.kind === 'task-linked' || event.kind === 'task-state') {
    const next = event.task
    const index = next.ordinal - 1
    const current = tasks[index]
    if (current === undefined || !immutableTaskFieldsMatch(current, next)) fail('task identity or immutable fields changed')
    if (next.revision <= current.revision) fail('task revision must strictly increase')
    if (event.kind === 'task-linked') {
      if (current.state !== 'queued' || current.child_session_id !== undefined) fail('task-linked requires one unlinked queued task')
    } else {
      if (!TRANSITIONS.has(`${current.state}:${next.state}`)) fail('illegal task state transition')
      if (current.state === 'queued' && next.state === 'unknown' && current.child_session_id === undefined) {
        fail('queued to unknown requires an existing child link')
      }
      if (current.child_session_id !== next.child_session_id) fail('task-state must preserve the exact child link')
      if (current.job_id !== undefined && current.job_id !== next.job_id) fail('task-state must preserve the exact job link')
      if (current.receipt !== undefined) {
        if (next.receipt === undefined) fail('task-state must preserve receipt evidence')
        const sameReceipt = current.receipt.owner_session_id === next.receipt.owner_session_id
          && current.receipt.call_id === next.receipt.call_id
        const advancedReceipt = sameReceipt && next.receipt.revision > current.receipt.revision
          && next.receipt.event_seq > current.receipt.event_seq
        if (!same(current.receipt, next.receipt) && !advancedReceipt) fail('task-state receipt pointer must be preserved or advance')
      }
    }
    tasks = tasks.map((task, taskIndex) => taskIndex === index ? next : task)
  } else {
    if (event.tasks.length !== tasks.length || event.tasks.some((task: ImageBatchTaskSnapshot, index: number) => !same(task, tasks[index]))) {
      fail('terminal must contain the current complete ordered task snapshots')
    }
    if (!tasks.every(task => TERMINAL_STATES.has(task.state))) fail('terminal requires every task to be terminal')
    status = batchStatus(tasks)
    if (event.status !== status) fail('terminal status does not match task evidence')
    terminalEventId = event.event_id
  }
  return frozen({ ...state, tasks: [...tasks], ...(status === undefined ? {} : { status }),
    ...(terminalEventId === undefined ? {} : { terminal_event_id: terminalEventId }),
    accepted_events: [...state.accepted_events, { event_id: event.event_id, canonical }] })
}

function publicBatch(state: ImageBatchReducerState) {
  const image_evidence = state.tasks.filter(task => task.receipt?.status === 'completed').map(task => ({
    task_id: task.task_id, ordinal: task.ordinal, child_session_id: task.child_session_id!, receipt: task.receipt!,
  }))
  const failures = state.tasks.filter(task => TERMINAL_STATES.has(task.state) && task.state !== 'completed').map(task => ({
    task_id: task.task_id, ordinal: task.ordinal, state: task.state, failure_code: task.failure_code!,
    ...(task.child_session_id === undefined ? {} : { child_session_id: task.child_session_id }),
    ...(task.job_id === undefined ? {} : { job_id: task.job_id }),
    ...(task.receipt === undefined ? {} : { receipt: task.receipt }),
  }))
  return frozen({ schema_version: 1, batch_id: state.batch_id, parent_session_id: state.parent_session_id,
    parent_call_id: state.parent_call_id, concurrency: state.concurrency, tasks: state.tasks,
    image_evidence, failures, ...(state.status === undefined ? {} : { status: state.status }),
    ...(state.terminal_event_id === undefined ? {} : { terminal_event_id: state.terminal_event_id }) })
}

/** Pure rc.7 Session projection definition. Importing this module does not register it. */
export function imageBatchProjectionDefinition(z: ImageBatchProjectionSchemaFactory, expectedParentSessionId?: string) {
  const nativeIdSchema = () => z.string().min(1).max(256).regex(NATIVE_ID)
  const receiptSchema = z.object({
    owner_session_id: nativeIdSchema(),
    call_id: nativeIdSchema(),
    revision: z.number().int().min(2).max(3),
    event_seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    status: z.enum(['completed', 'needs-review', 'failed', 'cancelled', 'unknown']),
  }).strict()
  const taskSchema = z.object({
    task_id: z.string().regex(DERIVED_ID),
    ordinal: z.number().int().min(1).max(8),
    revision: z.number().int().min(1).max(MAX_REVISION),
    state: z.enum(['queued', 'running', 'needs-review', 'completed', 'failed', 'cancelled', 'unknown', 'interrupted']),
    submission_status: z.enum(['not-submitted', 'submitted', 'unknown']),
    prompt_sha256: z.string().regex(SHA256),
    image_url: z.array(z.string().regex(ATTACHMENT_ID)).max(16),
    child_session_id: nativeIdSchema().optional(),
    job_id: nativeIdSchema().optional(),
    receipt: receiptSchema.optional(),
    failure_code: z.string().min(1).max(128).regex(FAILURE_CODE).optional(),
    updated_at: z.string().min(20).max(35).regex(TIMESTAMP).optional(),
  }).strict()
  const completedReceiptSchema = z.object({
    owner_session_id: nativeIdSchema(),
    call_id: nativeIdSchema(),
    revision: z.number().int().min(2).max(3),
    event_seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    status: z.enum(['completed']),
  }).strict()
  const evidenceSchema = z.object({
    task_id: z.string().regex(DERIVED_ID),
    ordinal: z.number().int().min(1).max(8),
    child_session_id: nativeIdSchema(),
    receipt: completedReceiptSchema,
  }).strict()
  const failureSchema = z.object({
    task_id: z.string().regex(DERIVED_ID),
    ordinal: z.number().int().min(1).max(8),
    state: z.enum(['failed', 'cancelled', 'unknown', 'interrupted']),
    failure_code: z.string().min(1).max(128).regex(FAILURE_CODE),
    child_session_id: nativeIdSchema().optional(),
    job_id: nativeIdSchema().optional(),
    receipt: receiptSchema.optional(),
  }).strict()
  const publicRowSchema = z.object({
    schema_version: z.literal(1),
    batch_id: z.string().regex(DERIVED_ID),
    parent_session_id: nativeIdSchema(),
    parent_call_id: nativeIdSchema(),
    concurrency: z.number().int().min(1).max(4),
    tasks: z.array(taskSchema).min(2).max(8),
    image_evidence: z.array(evidenceSchema).max(8),
    failures: z.array(failureSchema).max(8),
    status: z.enum(['completed', 'partial', 'failed', 'cancelled']).optional(),
    terminal_event_id: z.string().regex(DERIVED_ID).optional(),
  }).strict().refine(value => (value.status === undefined) === (value.terminal_event_id === undefined),
    'status and terminal_event_id must be present together')
  const stateSchema = z.array(publicRowSchema)
  return {
    key: PROJECTION_KEY,
    schema: stateSchema,
    stateVersion: 1,
    init: () => frozen([] as ImageBatchReducerState[]),
    apply(state: readonly ImageBatchReducerState[], event: { readonly type?: unknown; readonly data?: unknown }) {
      if (event?.type !== EVENT_TYPE) return state
      const untrusted = baseEvent(event.data)
      const index = state.findIndex(batch => batch.batch_id === untrusted.batch_id)
      if (index === -1 && untrusted.kind !== 'created') fail('event refers to an unknown batch')
      const next = reduceImageBatchEvent(index === -1 ? undefined : state[index], event.data, expectedParentSessionId)
      return frozen(index === -1 ? [...state, next] : state.map((batch, batchIndex) => batchIndex === index ? next : batch))
    },
    view: (state: readonly ImageBatchReducerState[]) => frozen(state.map(publicBatch)),
  }
}
