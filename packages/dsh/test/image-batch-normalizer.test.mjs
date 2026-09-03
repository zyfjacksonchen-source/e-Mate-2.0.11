import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

const moduleUrl = new URL('../src/profile/image-batch.ts', import.meta.url)
const globalsBefore = Reflect.ownKeys(globalThis)
const listenersBefore = new Map(['beforeExit', 'exit', 'uncaughtException', 'unhandledRejection'].map(name => [name, process.listenerCount(name)]))
const batch = await import(`${moduleUrl.href}?purity=1`)
const globalsAfter = Reflect.ownKeys(globalThis)
const listenersAfter = new Map([...listenersBefore.keys()].map(name => [name, process.listenerCount(name)]))

const {
  imageBatchEventId,
  imageBatchId,
  imageBatchParameters,
  imageBatchPromptSha256,
  imageBatchTaskId,
  normalizeImageBatchRequest,
} = batch

const A = `sha256:${'a'.repeat(64)}`
const B = `sha256:${'b'.repeat(64)}`
const C = `sha256:${'c'.repeat(64)}`
const task = (prompt = 'draw one') => ({ prompt })
const request = count => ({ tasks: Array.from({ length: count }, (_, index) => task(`image ${index + 1}`)) })

function independentTuple(values) {
  const chunks = []
  for (const value of values) {
    const bytes = new TextEncoder().encode(String(value))
    const prefix = new Uint8Array(8)
    new DataView(prefix.buffer).setBigUint64(0, BigInt(bytes.byteLength), false)
    chunks.push(prefix, bytes)
  }
  return createHash('sha256').update(Buffer.concat(chunks.map(value => Buffer.from(value)))).digest('hex')
}

function rejects(value, pattern = /image batch|prompt|image_url|ordinal|native ID/u) {
  assert.throws(value, pattern)
}

test('module import is pure and exposes only the internal contract', () => {
  assert.deepEqual(globalsAfter, globalsBefore)
  assert.deepEqual(listenersAfter, listenersBefore)
  assert.deepEqual(Object.keys(batch).sort(), [
    'imageBatchEventId', 'imageBatchId', 'imageBatchParameters', 'imageBatchPromptSha256',
    'imageBatchTaskId', 'normalizeImageBatchRequest',
  ])
})

test('pins independent ID and prompt digest vectors including multibyte UTF-8', () => {
  assert.deepEqual([
    independentTuple(['emate-image-batch-v1', '会话-一', '调用-二', 0]),
    independentTuple(['emate-image-task-v1', '会话-一', '调用-二', 8]),
    independentTuple(['emate-image-batch-event-v1', '会话-一', '调用-二', 9]),
  ], [
    '18472d9eb8064f3ff03af0e25c00a4d7210594cf7c4aa2d9233ab4fc55f977f4',
    'fd199699748b6a3ab1bd32e547ceea43b242bf4b8f2ca49fcdb1c7c41783fa49',
    '3e7f3f05f0d3af239d0f39c32311ec3e7184db6a35ecfa716b2c8571860ba037',
  ])
  assert.equal(imageBatchId('会话-一', '调用-二'), `sha256:${independentTuple(['emate-image-batch-v1', '会话-一', '调用-二', 0])}`)
  assert.equal(imageBatchTaskId('会话-一', '调用-二', 8), `sha256:${independentTuple(['emate-image-task-v1', '会话-一', '调用-二', 8])}`)
  assert.equal(imageBatchEventId('会话-一', '调用-二', 9), `sha256:${independentTuple(['emate-image-batch-event-v1', '会话-一', '调用-二', 9])}`)
  assert.equal(imageBatchPromptSha256('画一只猫'), '65389f9c1d0ad4d5378ddcff26c6d5ac2274bb34108b63db76c6002da58cd269')
  assert.equal(imageBatchPromptSha256('  画一只猫  '), createHash('sha256').update('画一只猫', 'utf8').digest('hex'))
})

test('normalizes trimming, scalar, empty, duplicate, and omitted references', () => {
  const raw = {
    tasks: [
      { prompt: '  new image  ' },
      { prompt: '\nedit\t', image_url: A },
      { prompt: 'explicit new', image_url: [] },
      { prompt: 'duplicate edit', image_url: [A, A] },
      { prompt: 'fusion', image_url: [B, A, B, C, A] },
    ],
  }
  const value = normalizeImageBatchRequest(raw)
  assert.equal(value.concurrency, 3)
  assert.deepEqual(value.tasks.map(item => ({
    ordinal: item.ordinal, prompt: item.prompt, ids: item.attachmentIds, operation: item.operation,
  })), [
    { ordinal: 1, prompt: 'new image', ids: [], operation: 'generate' },
    { ordinal: 2, prompt: 'edit', ids: [A], operation: 'edit' },
    { ordinal: 3, prompt: 'explicit new', ids: [], operation: 'generate' },
    { ordinal: 4, prompt: 'duplicate edit', ids: [A], operation: 'edit' },
    { ordinal: 5, prompt: 'fusion', ids: [B, A, C], operation: 'fusion' },
  ])
  assert.equal(value.tasks[0].promptSha256, imageBatchPromptSha256('new image'))
})

test('copies and freezes every normalized value', () => {
  const ids = [A, B, A]
  const tasks = [{ prompt: ' first ', image_url: ids }, task('second')]
  const value = normalizeImageBatchRequest({ tasks })
  ids[0] = C
  tasks[0].prompt = 'changed'
  tasks.push(task('third'))
  assert.equal(value.tasks.length, 2)
  assert.equal(value.tasks[0].prompt, 'first')
  assert.deepEqual(value.tasks[0].attachmentIds, [A, B])
  assert(Object.isFrozen(value) && Object.isFrozen(value.tasks) && Object.isFrozen(value.tasks[0]) && Object.isFrozen(value.tasks[0].attachmentIds))
  assert.throws(() => value.tasks.push(task()), TypeError)
  assert.throws(() => { value.tasks[0].attachmentIds[0] = C }, TypeError)
})

test('accepts 2, 4, 5, and 8 ordered tasks and concurrency 1, default 3, and 4', () => {
  for (const count of [2, 4, 5, 8]) {
    const value = normalizeImageBatchRequest(request(count))
    assert.deepEqual(value.tasks.map(item => item.ordinal), Array.from({ length: count }, (_, index) => index + 1))
  }
  assert.equal(normalizeImageBatchRequest({ ...request(2), concurrency: 1 }).concurrency, 1)
  assert.equal(normalizeImageBatchRequest(request(2)).concurrency, 3)
  assert.equal(normalizeImageBatchRequest({ ...request(8), concurrency: 4 }).concurrency, 4)
})

test('rejects task, prompt, concurrency, reference, and exact-key violations', () => {
  rejects(() => normalizeImageBatchRequest(null))
  rejects(() => normalizeImageBatchRequest({}))
  rejects(() => normalizeImageBatchRequest(request(1)))
  rejects(() => normalizeImageBatchRequest(request(9)))
  for (const concurrency of [0, 5, 1.5, null, '3']) rejects(() => normalizeImageBatchRequest({ ...request(2), concurrency }))

  const invalidPrompts = [undefined, null, 1, '', ' \n ', 'a\0b', 'x'.repeat(20_001)]
  for (const prompt of invalidPrompts) rejects(() => normalizeImageBatchRequest({ tasks: [{ prompt }, task()] }))
  assert.equal(normalizeImageBatchRequest({ tasks: [{ prompt: `  ${'x'.repeat(20_000)}  ` }, task()] }).tasks[0].prompt.length, 20_000)

  const invalidImageUrls = [null, 7, {}, ['sha256:no'], [A.toUpperCase()], [A, 3], Array(17).fill(A)]
  for (const image_url of invalidImageUrls) rejects(() => normalizeImageBatchRequest({ tasks: [{ prompt: 'bad', image_url }, task()] }))

  for (const key of ['size', 'aspect', 'quality', 'model', 'provider', 'ordinal', 'output_path', 'unknown']) {
    rejects(() => normalizeImageBatchRequest({ tasks: [{ prompt: 'bad', [key]: 'x' }, task()] }))
    rejects(() => normalizeImageBatchRequest({ ...request(2), [key]: 'x' }))
  }
})

test('IDs are deterministic, domain-distinct, parent-bounded, and ordinal-sensitive', () => {
  const firstBatch = imageBatchId('session', 'call')
  assert.equal(firstBatch, imageBatchId('session', 'call'))
  const ids = [imageBatchTaskId('session', 'call', 1), imageBatchTaskId('session', 'call', 2), imageBatchEventId('session', 'call', 1)]
  assert.equal(new Set([firstBatch, ...ids]).size, 4)
  assert.notEqual(imageBatchTaskId('session', 'call', 1), imageBatchTaskId('call', 'session', 1))
  assert.match(firstBatch, /^sha256:[0-9a-f]{64}$/u)
  const orderedTaskIds = Array.from({ length: 8 }, (_, index) => imageBatchTaskId('session', 'call', index + 1))
  assert.equal(new Set(orderedTaskIds).size, 8)
  orderedTaskIds.forEach((id, index) => {
    assert.equal(id, imageBatchTaskId('session', 'call', index + 1))
    if (index > 0) assert.notEqual(id, orderedTaskIds[index - 1])
  })

  for (const parent of ['', 'x'.repeat(257), 'bad\0id', 'bad\nid', null]) {
    rejects(() => imageBatchId(parent, 'call'))
    rejects(() => imageBatchId('session', parent))
  }
  for (const value of [0, 9, 1.5, '1', null]) rejects(() => imageBatchTaskId('session', 'call', value))
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) rejects(() => imageBatchEventId('session', 'call', value))
})

test('internal schema mapping is strict, complete, fresh, and non-registering', () => {
  const first = imageBatchParameters()
  const second = imageBatchParameters()
  assert.notEqual(first, second)
  assert.deepEqual(Object.keys(first).sort(), ['concurrency', 'tasks'])
  assert.equal(first.tasks.required, true)
  assert.equal(first.tasks.minItems, 2)
  assert.equal(first.tasks.maxItems, 8)
  assert.equal(first.tasks.items.additionalProperties, false)
  assert.deepEqual(Object.keys(first.tasks.items.properties).sort(), ['image_url', 'prompt'])
  assert.equal(first.tasks.items.properties.image_url.oneOf[1].minItems, 0)
  assert.equal(first.tasks.items.properties.image_url.oneOf[1].maxItems, 16)
  assert.deepEqual(first.concurrency, { type: 'integer', minimum: 1, maximum: 4, default: 3 })
  first.tasks.minItems = 99
  assert.equal(second.tasks.minItems, 2)
})
