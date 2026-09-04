import { imageBatchEventId, imageBatchPromptSha256, normalizeImageBatchRequest } from './image-batch.ts'
import { reduceImageBatchEvent, type ImageBatchReducerState, type ImageBatchTaskSnapshot } from './image-batch-events.ts'

const BATCH_KEY = 'eMateImageBatches'
const RECEIPT_KEY = 'eMateImageReceipts'
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'unknown', 'interrupted'])
const ATTACHMENT = /^sha256:[0-9a-f]{64}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function imageRef(value: unknown) {
  if (!isRecord(value) || typeof value.attachmentId !== 'string' || !ATTACHMENT.test(value.attachmentId)
    || !['image/png', 'image/jpeg', 'image/webp'].includes(String(value.mediaType))
    || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > 5 * 1024 * 1024
    || !Number.isSafeInteger(value.width) || Number(value.width) < 1 || Number(value.width) > 65_535
    || !Number.isSafeInteger(value.height) || Number(value.height) < 1 || Number(value.height) > 65_535
    || value.name !== undefined && (typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 255 || /[\u0000/\\]/u.test(value.name))) {
    throw new Error('durable image batch attachment reference is invalid')
  }
  return { attachmentId: value.attachmentId, mediaType: value.mediaType, bytes: Number(value.bytes),
    width: Number(value.width), height: Number(value.height), ...(value.name === undefined ? {} : { name: value.name }) }
}
function sameRef(left: ReturnType<typeof imageRef>, right: ReturnType<typeof imageRef>) {
  return left.attachmentId === right.attachmentId && left.mediaType === right.mediaType && left.bytes === right.bytes
    && left.width === right.width && left.height === right.height && left.name === right.name
}

function operationFor(task: ImageBatchTaskSnapshot) {
  return task.image_url.length === 0 ? 'generate' : task.image_url.length === 1 ? 'edit' : 'fusion'
}
function sourceRefs(value: unknown, task: ImageBatchTaskSnapshot) {
  if (!Array.isArray(value) || value.length !== task.image_url.length) throw new Error('recovery child receipt correlation is invalid')
  const refs = value.map(imageRef)
  if (refs.some((ref, index) => ref.attachmentId !== task.image_url[index])) throw new Error('recovery child receipt correlation is invalid')
  return refs
}
function sameSources(left: readonly ReturnType<typeof imageRef>[], right: readonly ReturnType<typeof imageRef>[]) {
  return left.length === right.length && left.every((ref, index) => sameRef(ref, right[index]))
}
function normalizedCall(event: unknown, task: ImageBatchTaskSnapshot) {
  if (!isRecord(event) || event.type !== 'tool/call' || !isRecord(event.data) || event.data.name !== 'imagegen'
    || typeof event.data.callId !== 'string' || typeof event.data.arguments !== 'string') return undefined
  let args
  try { args = JSON.parse(event.data.arguments) } catch { throw new Error('recovery child call arguments are corrupt') }
  let normalized
  try { normalized = normalizeImageBatchRequest({ tasks: [args, args], concurrency: 1 }).tasks[0] } catch {
    throw new Error('recovery child call arguments are corrupt')
  }
  if (imageBatchPromptSha256(normalized.prompt) !== task.prompt_sha256
    || normalized.attachmentIds.length !== task.image_url.length
    || normalized.attachmentIds.some((id, index) => id !== task.image_url[index])) {
    throw new Error('recovery child call arguments do not match parent task')
  }
  return { callId: event.data.callId, seq: event.seq }
}
function isSessionNotFound(error: unknown, id: string) {
  return error instanceof Error && error.message === 'session "' + id + '" not found'
}

/** Strictly fold only schema-1 parent batch events through the existing reducer. */
export function foldImageBatchRecovery(events: readonly { readonly type?: unknown; readonly data?: unknown }[], parentSessionId: string) {
  const states = new Map<string, ImageBatchReducerState>()
  for (const event of events) {
    if (event.type !== 'emate/image-batch') continue
    if (!isRecord(event.data) || typeof event.data.batch_id !== 'string') throw new Error('persisted image batch event is corrupt')
    const current = states.get(event.data.batch_id)
    const next = reduceImageBatchEvent(current, event.data, parentSessionId)
    states.set(next.batch_id, next)
  }
  return [...states.values()]
}

/** Deterministically classify nonterminal tasks without reopening any execution authority. */
export function classifyImageBatchCrash(state: ImageBatchReducerState): readonly ImageBatchTaskSnapshot[] {
  if (state.terminal_event_id !== undefined) return state.tasks
  return state.tasks.map(task => TERMINAL.has(task.state) ? task : Object.freeze({
    ...task,
    revision: task.revision + 1,
    state: task.child_session_id === undefined ? 'interrupted' as const : 'unknown' as const,
    submission_status: task.child_session_id === undefined ? 'not-submitted' as const : 'unknown' as const,
    failure_code: task.child_session_id === undefined ? 'not-submitted' : 'provider-outcome-unknown',
    updated_at: new Date(0).toISOString(),
  }))
}

function batchStatus(tasks: readonly ImageBatchTaskSnapshot[]) {
  const images = tasks.filter(task => task.receipt?.status === 'completed').length
  const failures = tasks.filter(task => task.state !== 'completed').length
  if (tasks.every(task => task.state === 'completed') && images === tasks.length) return 'completed'
  if (images > 0 && failures > 0) return 'partial'
  if (images === 0 && tasks.every(task => task.state === 'cancelled' || task.state === 'interrupted')) return 'cancelled'
  return 'failed'
}

async function recoverableChildTask(ctx: any, task: ImageBatchTaskSnapshot, parentSessionId: string) {
  if (task.child_session_id === undefined) return undefined
  let snapshot
  try { snapshot = await ctx.sessionProjectionCache.coldSnapshot(task.child_session_id) } catch (error) {
    if (isSessionNotFound(error, task.child_session_id)) return undefined
    throw new Error('image batch recovery child projection read failed', { cause: error })
  }
  const rows = snapshot?.values?.[RECEIPT_KEY]
  if (!Array.isArray(rows)) throw new Error('image batch recovery child projection is malformed')
  if (rows.length === 0) return undefined
  const expectedClient = 'image-' + task.task_id.slice('sha256:'.length)
  if (rows.some(row => !isRecord(row) || !isRecord(row.receipt))) {
    throw new Error('image batch recovery child projection is malformed')
  }
  const terminalRows = rows.filter(row => typeof row.receipt.status === 'string'
    && ['completed', 'failed', 'cancelled', 'unknown'].includes(row.receipt.status))
  if (terminalRows.length === 0) return undefined
  const matches = terminalRows.filter(row => row.receipt.parent_session_id === task.child_session_id
    && row.receipt.client_request_id === expectedClient)
  if (matches.length !== 1 || terminalRows.length !== 1) throw new Error('image batch recovery child receipt correlation is invalid')
  const row = matches[0]
  const receipt = row.receipt
  if (typeof receipt.call_id !== 'string' || !Number.isSafeInteger(receipt.revision) || ![2, 3].includes(Number(receipt.revision))
    || typeof receipt.job_id !== 'string' || !Number.isSafeInteger(row.seq) || row.seq < 0
    || receipt.operation !== operationFor(task)) throw new Error('image batch recovery child receipt correlation is invalid')
  const finalSources = sourceRefs(receipt.sources, task)
  let storedChild
  try { storedChild = await ctx.sessionPersistence.readFrom(task.child_session_id, 0) } catch (error) {
    if (isSessionNotFound(error, task.child_session_id)) return undefined
    throw new Error('image batch recovery child log read failed', { cause: error })
  }
  const calls = storedChild.events.map((event: unknown) => normalizedCall(event, task)).filter(Boolean)
  if (calls.length !== 1 || calls[0].callId !== receipt.call_id || calls[0].seq >= row.seq) {
    throw new Error('image batch recovery child call correlation is invalid')
  }
  const receiptEvents = storedChild.events.filter((event: any) => event.type === 'emate/image-output'
    && isRecord(event.data) && event.data.call_id === receipt.call_id && event.data.client_request_id === expectedClient)
  const finalEvents = receiptEvents.filter((event: any) => event.data.status !== 'needs-review')
  const reviews = receiptEvents.filter((event: any) => event.data.status === 'needs-review')
  if (finalEvents.length !== 1 || finalEvents[0].seq !== row.seq || finalEvents[0].data.revision !== receipt.revision) {
    throw new Error('image batch recovery child receipt history is invalid')
  }
  if (receipt.revision === 2 && reviews.length !== 0) throw new Error('image batch recovery child receipt history is invalid')
  if (receipt.revision === 3) {
    if (reviews.length !== 1 || reviews[0].data.revision !== 2 || calls[0].seq >= reviews[0].seq || reviews[0].seq >= row.seq
      || reviews[0].data.operation !== receipt.operation
      || !sameSources(sourceRefs(reviews[0].data.sources, task), finalSources)) {
      throw new Error('image batch recovery child receipt history is invalid')
    }
    const reviewOutput = imageRef(reviews[0].data.output)
    if (receipt.output !== undefined && !sameRef(reviewOutput, imageRef(receipt.output))) {
      throw new Error('image batch recovery child receipt history is invalid')
    }
  }
  const child = ctx.agents.get(task.child_session_id)
  if (child === undefined || child.id !== task.child_session_id || child.session?.header?.origin !== 'subagent'
    || child.session.header.parentSession !== parentSessionId) return undefined
  let job
  try { job = ctx.jobs.get(receipt.job_id, child) } catch (error) {
    if (error instanceof Error && error.message === 'unknown job ' + receipt.job_id) return undefined
    throw new Error('image batch recovery child Job lookup failed', { cause: error })
  }
  if (job.ownerSession !== task.child_session_id || job.kind !== 'emate-image' || !['completed', 'failed', 'killed'].includes(job.status)) {
    throw new Error('image batch recovery child Job correlation is invalid')
  }
  if (receipt.status === 'completed') {
    const attachment = imageRef(receipt.output)
    const stored = await ctx.attachments.readImage(attachment)
    if (!sameRef(imageRef(stored.ref), attachment) || !(stored.data instanceof Uint8Array)
      || stored.data.byteLength !== attachment.bytes || job.status !== 'completed') throw new Error('recovery completed child evidence is invalid')
  }
  return { receipt, pointer: { owner_session_id: task.child_session_id, call_id: receipt.call_id,
    revision: receipt.revision, event_seq: row.seq, status: receipt.status }, job }
}

/** Append one idempotent interrupted/unknown recovery plan and terminal checkpoint to a live parent Session. */
export async function recoverImageBatchSession(ctx: any, session: any) {
  let states = foldImageBatchRecovery(session.events, session.header.id)
  if (states.length === 0 || states.every(state => state.terminal_event_id !== undefined)) return states
  try {
    if (await ctx.sessions.flush(session) !== true) throw new Error('flush returned false')
  } catch (error) {
    throw new Error('image batch recovery parent durability check failed', { cause: error })
  }
  states = foldImageBatchRecovery(session.events, session.header.id)
  for (let state of states) {
    if (state.terminal_event_id !== undefined) continue
    const appendTask = async (task: ImageBatchTaskSnapshot) => {
      const data = { schema_version: 1, event_id: imageBatchEventId(state.parent_session_id, state.parent_call_id, state.accepted_events.length + 1),
        kind: 'task-state', batch_id: state.batch_id, parent_session_id: state.parent_session_id,
        parent_call_id: state.parent_call_id, occurred_at: new Date().toISOString(), task: { ...task, updated_at: new Date().toISOString() } }
      state = reduceImageBatchEvent(state, data, session.header.id)
      session.append('emate/image-batch', data, { ignorable: true })
      if (await ctx.sessions.flush(session) !== true) throw new Error('image batch recovery task flush did not reach durable storage')
    }
    for (const task of [...state.tasks]) {
      if (TERMINAL.has(task.state) || task.child_session_id === undefined) continue
      const evidence = await recoverableChildTask(ctx, task, state.parent_session_id)
      if (evidence === undefined) continue
      let current = state.tasks[task.ordinal - 1]
      if (current.state === 'queued' && evidence.receipt.billing_status === 'recorded') {
        await appendTask({ ...current, revision: current.revision + 1, state: 'running', submission_status: 'submitted',
          job_id: evidence.receipt.job_id, updated_at: new Date().toISOString() })
        current = state.tasks[task.ordinal - 1]
      }
      const completed = evidence.receipt.status === 'completed'
      await appendTask({ ...current, revision: current.revision + 1,
        state: completed ? 'completed' : evidence.receipt.status === 'cancelled' ? 'cancelled'
          : evidence.receipt.status === 'unknown' ? 'unknown' : 'failed',
        submission_status: evidence.receipt.billing_status === 'recorded' ? 'submitted'
          : evidence.receipt.billing_status === 'not-submitted' ? 'not-submitted' : 'unknown',
        job_id: evidence.receipt.job_id, receipt: evidence.pointer,
        ...(completed ? {} : { failure_code: evidence.receipt.failure_code ?? 'child-failed' }),
        updated_at: new Date().toISOString() })
    }
    const classified = classifyImageBatchCrash(state)
    for (const next of classified) {
      const current = state.tasks[next.ordinal - 1]
      if (next === current) continue
      await appendTask(next)
    }
    const data = { schema_version: 1, event_id: imageBatchEventId(state.parent_session_id, state.parent_call_id, state.accepted_events.length + 1),
      kind: 'terminal', batch_id: state.batch_id, parent_session_id: state.parent_session_id,
      parent_call_id: state.parent_call_id, occurred_at: new Date().toISOString(), status: batchStatus(state.tasks), tasks: state.tasks }
    state = reduceImageBatchEvent(state, data, session.header.id)
    session.append('emate/image-batch', data, { ignorable: true })
    if (await ctx.sessions.flush(session) !== true) throw new Error('image batch recovery terminal flush did not reach durable storage')
  }
  return foldImageBatchRecovery(session.events, session.header.id)
}

/** Install bounded idempotent recovery for current and later restored live parent Sessions. */
export async function installImageBatchRecovery(ctx: any) {
  const recovering = new WeakSet<object>()
  const recover = async (session: any) => {
    if (recovering.has(session)) return
    recovering.add(session)
    try { await recoverImageBatchSession(ctx, session) } finally { recovering.delete(session) }
  }
  ctx.on('session/created', (session: any) => { void recover(session).catch(() => ctx.logger.warn('e-Mate image batch recovery failed; recovery remains pending')) })
  for (const session of ctx.sessions.list()) await recover(session)
}

/** Rebuild the public terminal result from the durable parent and exact child receipt projections. */
export async function readDurableImageBatchResult(ctx: any, parent: any, batchId: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const parentSnapshot = ctx.sessionProjections.snapshot(parent.session)
  const batches = parentSnapshot.values[BATCH_KEY]
  if (!Array.isArray(batches)) throw new Error('durable image batch projection is unavailable')
  const matches = batches.filter(value => isRecord(value) && value.batch_id === batchId)
  if (matches.length !== 1) throw new Error('durable terminal image batch projection is ambiguous')
  const batch = matches[0]
  if (parent.id !== parent.session?.header?.id || batch.parent_session_id !== parent.id
    || typeof batch.status !== 'string' || typeof batch.terminal_event_id !== 'string'
    || !Array.isArray(batch.tasks) || !Array.isArray(batch.image_evidence) || !Array.isArray(batch.failures)) {
    throw new Error('durable terminal image batch projection is unavailable')
  }
  const tasks = batch.tasks
  if (tasks.some(task => !isRecord(task) || typeof task.task_id !== 'string' || !Number.isSafeInteger(task.ordinal))
    || new Set(tasks.map(task => task.task_id)).size !== tasks.length
    || new Set(tasks.map(task => task.ordinal)).size !== tasks.length
    || new Set(tasks.map(task => task.child_session_id).filter(Boolean)).size
      !== tasks.map(task => task.child_session_id).filter(Boolean).length) {
    throw new Error('durable image batch tasks are not unique')
  }
  const taskKey = (task: unknown) => {
    if (!isRecord(task) || typeof task.task_id !== 'string' || !Number.isSafeInteger(task.ordinal)) {
      throw new Error('durable image batch projection row is invalid')
    }
    return task.task_id + ':' + task.ordinal
  }
  const expectedEvidence = tasks.filter(task => task.receipt?.status === 'completed').map(taskKey).sort()
  const suppliedEvidence = batch.image_evidence.map(taskKey).sort()
  const expectedFailures = tasks.filter(task => TERMINAL.has(task.state) && task.state !== 'completed').map(taskKey).sort()
  const suppliedFailures = batch.failures.map(taskKey).sort()
  if (JSON.stringify(expectedEvidence) !== JSON.stringify(suppliedEvidence)
    || JSON.stringify(expectedFailures) !== JSON.stringify(suppliedFailures)
    || tasks.some((task, index) => task.ordinal !== index + 1)
    || batch.status !== batchStatus(tasks)) throw new Error('durable image batch projection sets are incomplete')
  const evidenceKeys = new Set()
  const images = []
  for (const evidence of batch.image_evidence) {
    signal.throwIfAborted()
    if (!isRecord(evidence) || typeof evidence.task_id !== 'string' || !Number.isSafeInteger(evidence.ordinal)
      || typeof evidence.child_session_id !== 'string' || !isRecord(evidence.receipt)
      || evidence.receipt.owner_session_id !== evidence.child_session_id) {
      throw new Error('durable image batch evidence is invalid')
    }
    const task = tasks.find(candidate => candidate.task_id === evidence.task_id && candidate.ordinal === evidence.ordinal)
    const evidenceKey = evidence.task_id + ':' + evidence.ordinal + ':' + evidence.child_session_id
    if (task === undefined || task.child_session_id !== evidence.child_session_id || task.receipt?.call_id !== evidence.receipt.call_id
      || task.receipt?.revision !== evidence.receipt.revision || task.receipt?.event_seq !== evidence.receipt.event_seq
      || task.receipt?.status !== evidence.receipt.status || evidenceKeys.has(evidenceKey)) throw new Error('durable image batch evidence does not match its parent task')
    evidenceKeys.add(evidenceKey)
    let snapshot
    try { snapshot = await ctx.sessionProjectionCache.coldSnapshot(evidence.child_session_id, signal) } catch (error) {
      throw new Error('durable child image receipt projection read failed', { cause: error })
    }
    const rows = snapshot.values[RECEIPT_KEY]
    if (!Array.isArray(rows)) throw new Error('durable child image receipt projection is unavailable')
    const matches = rows.filter(row => isRecord(row) && row.seq === evidence.receipt.event_seq && isRecord(row.receipt)
      && row.receipt.call_id === evidence.receipt.call_id && row.receipt.revision === evidence.receipt.revision
      && row.receipt.status === 'completed' && row.receipt.parent_session_id === evidence.child_session_id
      && row.receipt.client_request_id === 'image-' + evidence.task_id.slice('sha256:'.length)
      && row.receipt.operation === operationFor(task))
    if (matches.length !== 1) throw new Error('durable child image receipt pointer does not resolve exactly once')
    sourceRefs(matches[0].receipt.sources, task)
    const attachment = imageRef(matches[0].receipt.output)
    let stored
    try { stored = await ctx.attachments.readImage(attachment, signal) } catch (error) {
      throw new Error('durable image batch attachment CAS read failed', { cause: error })
    }
    if (!sameRef(imageRef(stored.ref), attachment) || !(stored.data instanceof Uint8Array)
      || stored.data.byteLength !== attachment.bytes) throw new Error('durable image batch attachment CAS evidence is invalid')
    images.push({ task_id: evidence.task_id, ordinal: evidence.ordinal, child_session_id: evidence.child_session_id,
      receipt: evidence.receipt, attachment })
  }
  const failureKeys = new Set()
  for (const failure of batch.failures) {
    if (!isRecord(failure) || typeof failure.task_id !== 'string' || !Number.isSafeInteger(failure.ordinal)
      || failureKeys.has(failure.task_id + ':' + failure.ordinal)) throw new Error('durable image batch failure is invalid')
    const task = tasks.find(candidate => candidate.task_id === failure.task_id && candidate.ordinal === failure.ordinal)
    if (task === undefined || task.state === 'completed' || task.child_session_id !== failure.child_session_id
      || task.job_id !== failure.job_id || task.failure_code !== failure.failure_code
      || JSON.stringify(task.receipt) !== JSON.stringify(failure.receipt)) throw new Error('durable image batch failure does not match its parent task')
    failureKeys.add(failure.task_id + ':' + failure.ordinal)
  }
  return { schema_version: 1, batch_id: batch.batch_id, status: batch.status, tasks,
    images: images.sort((left, right) => left.ordinal - right.ordinal), failures: batch.failures,
    terminal_event_id: batch.terminal_event_id }
}
