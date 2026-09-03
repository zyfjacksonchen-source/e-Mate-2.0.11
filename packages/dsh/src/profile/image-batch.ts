import { createHash } from 'node:crypto'

const MIN_TASKS = 2
const MAX_TASKS = 8
const DEFAULT_CONCURRENCY = 3
const MAX_CONCURRENCY = 4
const MAX_PROMPT_CHARS = 20_000
const MAX_IMAGE_URLS = 16
const MAX_NATIVE_ID_CHARS = 256
const ATTACHMENT_ID = /^sha256:[0-9a-f]{64}$/u
const NATIVE_ID = /^[^\u0000-\u001f\u007f]+$/u

type ImageOperation = 'generate' | 'edit' | 'fusion'

export interface NormalizedImageBatchTask {
  readonly ordinal: number
  readonly prompt: string
  readonly promptSha256: string
  readonly attachmentIds: readonly string[]
  readonly operation: ImageOperation
}

export interface NormalizedImageBatchRequest {
  readonly tasks: readonly NormalizedImageBatchTask[]
  readonly concurrency: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function nativeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_NATIVE_ID_CHARS || !NATIVE_ID.test(value)) {
    throw new Error(`${label} must be a valid 1 to ${MAX_NATIVE_ID_CHARS} character native ID`)
  }
  return value
}

function ordinal(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from 1 to ${maximum}`)
  }
  return value as number
}

function tupleSha256(values: readonly (string | number)[]): string {
  const hash = createHash('sha256')
  for (const value of values) {
    const bytes = Buffer.from(String(value), 'utf8')
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(bytes.byteLength))
    hash.update(length).update(bytes)
  }
  return hash.digest('hex')
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== 'string') throw new Error('image batch task prompt must be a string')
  const prompt = value.trim()
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS || prompt.includes('\0')) {
    throw new Error(`image batch task prompt must contain 1 to ${MAX_PROMPT_CHARS} characters without NUL`)
  }
  return prompt
}

export function imageBatchPromptSha256(prompt: unknown): string {
  return createHash('sha256').update(normalizePrompt(prompt), 'utf8').digest('hex')
}

export function imageBatchId(parentSessionId: unknown, parentCallId: unknown): string {
  return `sha256:${tupleSha256([
    'emate-image-batch-v1',
    nativeId(parentSessionId, 'parentSessionId'),
    nativeId(parentCallId, 'parentCallId'),
    0,
  ])}`
}

export function imageBatchTaskId(parentSessionId: unknown, parentCallId: unknown, taskOrdinal: unknown): string {
  return `sha256:${tupleSha256([
    'emate-image-task-v1',
    nativeId(parentSessionId, 'parentSessionId'),
    nativeId(parentCallId, 'parentCallId'),
    ordinal(taskOrdinal, MAX_TASKS, 'task ordinal'),
  ])}`
}

export function imageBatchEventId(parentSessionId: unknown, parentCallId: unknown, eventOrdinal: unknown): string {
  return `sha256:${tupleSha256([
    'emate-image-batch-event-v1',
    nativeId(parentSessionId, 'parentSessionId'),
    nativeId(parentCallId, 'parentCallId'),
    ordinal(eventOrdinal, Number.MAX_SAFE_INTEGER, 'event ordinal'),
  ])}`
}

export function normalizeImageBatchRequest(value: unknown): NormalizedImageBatchRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ['tasks', 'concurrency'])
    || !Object.hasOwn(value, 'tasks') || !Array.isArray(value.tasks)) {
    throw new Error('image batch accepts only tasks and optional concurrency')
  }
  if (value.tasks.length < MIN_TASKS || value.tasks.length > MAX_TASKS) {
    throw new Error(`image batch requires ${MIN_TASKS} to ${MAX_TASKS} tasks`)
  }
  const concurrency = value.concurrency === undefined ? DEFAULT_CONCURRENCY : value.concurrency
  if (!Number.isSafeInteger(concurrency) || (concurrency as number) < 1 || (concurrency as number) > MAX_CONCURRENCY) {
    throw new Error(`image batch concurrency must be an integer from 1 to ${MAX_CONCURRENCY}`)
  }
  const tasks = value.tasks.map((raw, index): NormalizedImageBatchTask => {
    if (!isRecord(raw) || !hasOnlyKeys(raw, ['prompt', 'image_url']) || !Object.hasOwn(raw, 'prompt')) {
      throw new Error('image batch tasks accept only prompt and optional image_url')
    }
    const prompt = normalizePrompt(raw.prompt)
    const imageUrl = raw.image_url
    const ids = imageUrl === undefined ? [] : Array.isArray(imageUrl) ? imageUrl : [imageUrl]
    if (ids.length > MAX_IMAGE_URLS || ids.some(id => typeof id !== 'string' || !ATTACHMENT_ID.test(id))) {
      throw new Error(`image_url must contain at most ${MAX_IMAGE_URLS} exact sha256 attachment IDs`)
    }
    const attachmentIds = Object.freeze([...new Set(ids as string[])])
    const operation: ImageOperation = attachmentIds.length === 0 ? 'generate' : attachmentIds.length === 1 ? 'edit' : 'fusion'
    return Object.freeze({
      ordinal: index + 1,
      prompt,
      promptSha256: imageBatchPromptSha256(prompt),
      attachmentIds,
      operation,
    })
  })
  return Object.freeze({ tasks: Object.freeze(tasks), concurrency: concurrency as number })
}

/** Internal defineTool parameter mapping for later activation; this module never registers it. */
export function imageBatchParameters() {
  return {
    tasks: {
      type: 'array', required: true, minItems: MIN_TASKS, maxItems: MAX_TASKS,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          prompt: { type: 'string', required: true, minLength: 1, maxLength: MAX_PROMPT_CHARS },
          image_url: {
            oneOf: [
              { type: 'string', pattern: ATTACHMENT_ID.source },
              { type: 'array', minItems: 0, maxItems: MAX_IMAGE_URLS, items: { type: 'string', pattern: ATTACHMENT_ID.source } },
            ],
          },
        },
      },
    },
    concurrency: { type: 'integer', minimum: 1, maximum: MAX_CONCURRENCY, default: DEFAULT_CONCURRENCY },
  }
}
