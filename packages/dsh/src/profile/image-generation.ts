import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { zipSync } from 'fflate'
import { loadTargetLlm, loadTargetTools } from './target-runtime.js'

export const name = 'emate-image-generation'
export const inject = ['tools', 'jobs', 'attachments', 'sandboxPolicy', 'emateIdentity', 'emateModelPolicy', 'emateCapabilities']

interface ImageOutputEventData {
  readonly schema_version: 2
  readonly revision: number
  readonly call_id: string
  readonly operation: 'generate' | 'edit' | 'fusion'
  readonly status: 'running' | 'completed' | 'needs-review' | 'failed' | 'cancelled' | 'unknown'
  readonly billing_status: 'not-submitted' | 'recorded' | 'unknown'
  readonly parent_session_id: string
  readonly sources: readonly ReturnType<typeof imageRef>[]
  readonly content: readonly { readonly type: 'image'; readonly attachment: ReturnType<typeof imageRef> }[]
  readonly child_session_id?: string
  readonly job_id?: string
  readonly provider_request_id?: string
  readonly client_request_id?: string
  readonly model?: string
  readonly output?: ReturnType<typeof imageRef>
  readonly verifier: {
    readonly structural: 'attachment-cas-v1'
    readonly semantic: 'not-required' | 'not-configured' | 'native-user-confirmation-v1'
  }
  readonly verification: {
    readonly structural: 'passed' | 'failed' | 'not-run'
    readonly source_output: 'distinct' | 'same' | 'not-applicable' | 'unknown'
    readonly semantic: 'passed' | 'needs-review' | 'failed' | 'not-applicable'
    readonly human_review?: {
      readonly decision: 'accepted' | 'rejected'
      readonly requirement_sha256: string
    }
    readonly text_replacement?: {
      readonly old_text_sha256: string
      readonly new_text_sha256: string
      readonly requested_regions: number | null
      readonly status: 'passed' | 'needs-review' | 'failed'
    }
  }
  readonly failure_code?: string
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Keeps one generated image durable and human-visible without adding its bytes to later model requests.
     * @mode emit
     * @param data - originating Tool call and saved image attachment.
     */
    'emate/image-output': ImageOutputEventData
  }
}

const IMAGE_MODEL = 'gpt-image-2-pro'
const IMAGE_RECEIPT_VERSION = 2
const MAX_PROMPT_CHARS = 20_000
const MAX_EDIT_IMAGES = 16
const MAX_EDIT_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_PACK_IMAGES = 100
const MAX_PACK_BYTES = 100 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 610_000
const ATTACHMENT_ID = /^sha256:[0-9a-f]{64}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function sessionIdentity(agent) {
  const id = agent?.session?.header?.id ?? agent?.id
  if (typeof id !== 'string' || id.length === 0) throw new Error('image generation requires a stable Session identity')
  return id
}

function verifier(operation, reviewDecision) {
  return {
    structural: 'attachment-cas-v1',
    semantic: operation === 'generate'
      ? 'not-required'
      : reviewDecision === undefined ? 'not-configured' : 'native-user-confirmation-v1',
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function gatewayRoot(value) {
  if (typeof value !== 'string') throw new Error('e-Mate managed image gateway is not configured')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('e-Mate managed image gateway is invalid')
  }
  url.pathname = url.pathname.replace(/\/+$/u, '')
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || !url.pathname.endsWith('/v1')) {
    throw new Error('e-Mate managed image gateway must be a fixed HTTPS Model Gateway /v1 endpoint')
  }
  return url
}

function endpoint(root, path) {
  return new URL(`${root.pathname}${path}`, root.origin)
}

async function readBounded(response, maximum, label) {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) {
    throw new Error(`${label} response exceeds the byte boundary`)
  }
  if (response.body === null) throw new Error(`${label} response body is missing`)
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!(value instanceof Uint8Array) || (length += value.byteLength) > maximum) {
      await reader.cancel()
      throw new Error(`${label} response exceeds the byte boundary`)
    }
    chunks.push(value)
  }
  if (declared !== null && length !== Number(declared)) throw new Error(`${label} Content-Length does not match the body`)
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), length)
}

async function responseJson(response, maximum, label) {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`)
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/json') throw new Error(`${label} response is not JSON`)
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(response, maximum, label)))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error
    throw new Error(`${label} response contains invalid JSON`)
  }
}

function receiptImageName(value) {
  return typeof value === 'string' && value.length <= 255 && !/[\\/\0]/u.test(value) ? value : undefined
}

function imageRef(value) {
  const name = receiptImageName(value.name)
  return {
    attachmentId: value.attachmentId,
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...(name === undefined ? {} : { name }),
  }
}

function validImageRef(value) {
  return isRecord(value)
    && typeof value.attachmentId === 'string' && ATTACHMENT_ID.test(value.attachmentId)
    && typeof value.mediaType === 'string'
    && Number.isSafeInteger(value.bytes) && value.bytes > 0
    && Number.isSafeInteger(value.width) && value.width > 0
    && Number.isSafeInteger(value.height) && value.height > 0
    && (value.name === undefined || typeof value.name === 'string')
}

function sameImageRef(left, right) {
  return validImageRef(left) && validImageRef(right)
    && left.attachmentId === right.attachmentId
    && left.mediaType === right.mediaType
    && left.bytes === right.bytes
    && left.width === right.width
    && left.height === right.height
    && receiptImageName(left.name) === receiptImageName(right.name)
}

function imageOperation(refs) {
  return refs.length === 0 ? 'generate' : refs.length === 1 ? 'edit' : 'fusion'
}

function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex')
}

function textReplacementAcceptance(prompt, status = 'needs-review') {
  const patterns = [
    /(?:共\s*)?(\d+)\s*处\s*[“"']?([^“”"'，。,.;]{1,32})[”"']?\s*(?:全部)?\s*(?:改为|改成|替换为|换成)\s*[“"']?([^“”"'，。,.;]{1,32})/iu,
    /(?:把|将)?\s*(?:图片|图像|图)?(?:中|里|上)(?:的)?\s*[“"']?([^“”"'，。,.;]{1,32})[”"']?\s*(?:全部)?\s*(?:改为|改成|替换为|换成)\s*[“"']?([^“”"'，。,.;]{1,32})/iu,
    /\breplace\s+[“"']?([^“”"'\n]{1,64})[”"']?\s+with\s+[“"']?([^“”"'\n]{1,64})/iu,
  ]
  for (const [index, pattern] of patterns.entries()) {
    const match = pattern.exec(prompt)
    if (match === null) continue
    const offset = index === 0 ? 1 : 0
    const oldText = match[1 + offset]?.trim()
    const newText = match[2 + offset]?.trim()
    if (!oldText || !newText || oldText === newText) return undefined
    const requested = index === 0 ? Number(match[1]) : null
    return {
      old_text_sha256: sha256Text(oldText),
      new_text_sha256: sha256Text(newText),
      requested_regions: Number.isSafeInteger(requested) && requested > 0 ? requested : null,
      status,
    }
  }
  return undefined
}

function failureCode(error, submitted, aborted) {
  if (aborted) return 'cancelled'
  if (error?.code === 'agent-tool-unavailable') return 'agent-tool-unavailable'
  const message = error instanceof Error ? error.message : String(error)
  const status = /HTTP (\d{3})/u.exec(message)?.[1]
  if (status !== undefined) return `http-${status}`
  return submitted ? 'provider-outcome-unknown' : 'validation-failed'
}

function requestDefinitelyRejected(error) {
  return /HTTP 413(?:\D|$)/u.test(error instanceof Error ? error.message : String(error))
}

function failedReceipt(
  callId,
  operation,
  sources,
  status,
  submitted,
  code,
  parentSessionId,
  jobId,
  clientRequestId,
  providerRequestId,
  revision = 1,
) {
  return {
    schema_version: IMAGE_RECEIPT_VERSION,
    revision,
    call_id: String(callId),
    operation,
    status,
    billing_status: providerRequestId === undefined ? submitted ? 'unknown' : 'not-submitted' : 'recorded',
    parent_session_id: parentSessionId,
    sources: sources.map(imageRef),
    content: [],
    ...(jobId === undefined ? {} : { job_id: String(jobId) }),
    ...(clientRequestId === undefined ? {} : { client_request_id: clientRequestId }),
    ...(providerRequestId === undefined ? {} : { provider_request_id: providerRequestId, model: IMAGE_MODEL }),
    verifier: verifier(operation),
    verification: {
      structural: 'not-run',
      source_output: 'unknown',
      semantic: status === 'failed' ? 'failed' : 'needs-review',
    },
    failure_code: code,
  }
}

function runningReceipt(callId, operation, sources, parentSessionId) {
  return {
    schema_version: IMAGE_RECEIPT_VERSION,
    revision: 1,
    call_id: String(callId),
    operation,
    status: 'running',
    billing_status: 'unknown',
    parent_session_id: parentSessionId,
    sources: sources.map(imageRef),
    content: [],
    verifier: verifier(operation),
    verification: {
      structural: 'not-run',
      source_output: 'unknown',
      semantic: 'needs-review',
    },
    failure_code: 'in-flight',
  }
}

function appendImageReceipt(agent, receipt) {
  agent.session.append('emate/image-output', receipt, { ignorable: true })
}

function assertFreshParentCall(agent, callId) {
  const id = String(callId ?? '')
  if (id.length === 0) throw new Error('image generation requires a stable e-Mate Tool call identity')
  const events = [...agent?.session?.events ?? []]
  const legacyTerminal = events.some(event => event?.type === 'emate/image-output'
    && exactKeys(event.data, ['call_id', 'content'])
    && event.data.call_id === id
    && Array.isArray(event.data.content)
    && event.data.content.length === 1
    && event.data.content[0]?.type === 'image'
    && validImageRef(event.data.content[0].attachment))
  const receipts = events
    .filter(event => event?.type === 'emate/image-output'
      && event.data?.schema_version === IMAGE_RECEIPT_VERSION
      && event.data?.call_id === id)
    .map(event => event.data)
  if (legacyTerminal) throw new Error('image call already has a terminal receipt; use a new explicit retry Tool call')
  if (receipts.length === 0) return
  if (receipts.every(receipt => receipt.revision === 1 && receipt.status === 'running')) {
    throw new Error('image call outcome is unknown after restart; automatic replay is disabled, use a new explicit retry Tool call')
  }
  throw new Error('image call already has a terminal receipt; use a new explicit retry Tool call')
}

function imageResultStatus(refs, value, reviewDecision) {
  const operation = imageOperation(refs)
  if (operation === 'generate') return 'completed'
  if (refs.some(ref => ref.attachmentId === value.image.attachmentId)) return 'failed'
  return reviewDecision === 'accepted' ? 'completed' : reviewDecision === 'rejected' ? 'failed' : 'needs-review'
}

function verifiedReceipt(
  callId,
  task,
  refs,
  value,
  jobId,
  parentSessionId,
  clientRequestId,
  reviewDecision,
  revision = 2,
) {
  const operation = imageOperation(refs)
  const sameSource = refs.some(ref => ref.attachmentId === value.image.attachmentId)
  const status = imageResultStatus(refs, value, reviewDecision)
  const semantic = operation === 'generate'
    ? 'not-applicable'
    : sameSource || reviewDecision === 'rejected' ? 'failed'
      : reviewDecision === 'accepted' ? 'passed' : 'needs-review'
  const textReplacement = operation === 'generate' ? undefined : textReplacementAcceptance(task.prompt, semantic)
  return {
    schema_version: IMAGE_RECEIPT_VERSION,
    revision,
    call_id: String(callId),
    operation,
    status,
    billing_status: 'recorded',
    parent_session_id: parentSessionId,
    sources: refs.map(imageRef),
    content: status === 'failed' ? [] : [{ type: 'image', attachment: imageRef(value.image) }],
    job_id: String(jobId),
    provider_request_id: value.request_id,
    client_request_id: clientRequestId,
    model: value.model,
    output: imageRef(value.image),
    verifier: verifier(operation, reviewDecision),
    verification: {
      structural: 'passed',
      source_output: operation === 'generate' ? 'not-applicable' : sameSource ? 'same' : 'distinct',
      semantic,
      ...(reviewDecision === undefined ? {} : {
        human_review: {
          decision: reviewDecision,
          requirement_sha256: sha256Text(task.prompt),
        },
      }),
      ...(textReplacement === undefined ? {} : { text_replacement: textReplacement }),
    },
    ...(sameSource
      ? { failure_code: 'source-output-same-sha256' }
      : reviewDecision === 'rejected' ? { failure_code: 'user-rejected' } : {}),
  }
}

async function reviewImageCandidate(
  ctx,
  owner,
  callId,
  task,
  refs,
  value,
  jobId,
  parentSessionId,
  clientRequestId,
  signal,
) {
  const candidate = verifiedReceipt(
    callId, task, refs, value, jobId, parentSessionId, clientRequestId,
  )
  appendImageReceipt(owner, candidate)
  const userQuestions = ctx.get('userQuestions')
  if (userQuestions === undefined) return undefined
  const approve = '确认结果'
  const reject = '拒绝结果'
  const questionId = `image-review-${jobId}`
  const sources = refs.map(imageRef)
  const output = imageRef(value.image)
  const detail = [
    '修改目标：',
    task.prompt,
    '',
    '结构化差异证据：',
    ...sources.map((source, index) => `- 源图 ${index + 1}：${source.attachmentId}（${source.width}×${source.height}）`),
    `- 候选结果：${output.attachmentId}（${output.width}×${output.height}）`,
    '- 系统只确认了源图与候选图的 SHA-256 不同；修改语义需要你对照图片确认。',
  ].join('\n')
  try {
    const answer = await userQuestions.ask({
      agent: owner,
      signal,
      questions: [{
        id: questionId,
        header: '改图结果确认',
        question: '请对照源图确认候选结果是否完整完成修改目标。',
        detail,
        options: [
          { label: approve, description: '确认候选图已完整满足修改目标。' },
          { label: reject, description: '结果不正确；本次任务失败，可显式重新修改。' },
        ],
        intent: { kind: 'image-review', approve, sources, output },
      }],
    })
    const selected = answer?.answers?.find(item => item?.id === questionId)
    return selected?.custom === undefined
      && selected?.selected?.length === 1
      && selected.selected[0] === approve
      ? 'accepted'
      : 'rejected'
  } catch (error) {
    if (signal.aborted) throw error
    return undefined
  }
}

function validVerification(value, operation, status, sameSource) {
  if (!isRecord(value)) return false
  const humanReview = value.human_review
  const textReplacement = value.text_replacement
  const keys = [
    'semantic', 'source_output', 'structural',
    ...(humanReview === undefined ? [] : ['human_review']),
    ...(textReplacement === undefined ? [] : ['text_replacement']),
  ]
  if (!exactKeys(value, keys)) return false
  if (humanReview !== undefined && (!exactKeys(humanReview, ['decision', 'requirement_sha256'])
    || !['accepted', 'rejected'].includes(humanReview.decision)
    || typeof humanReview.requirement_sha256 !== 'string' || !SHA256.test(humanReview.requirement_sha256)
    || operation === 'generate' || sameSource)) return false
  if (textReplacement !== undefined && (!exactKeys(textReplacement, [
    'new_text_sha256', 'old_text_sha256', 'requested_regions', 'status',
  ])
    || typeof textReplacement.old_text_sha256 !== 'string' || !SHA256.test(textReplacement.old_text_sha256)
    || typeof textReplacement.new_text_sha256 !== 'string' || !SHA256.test(textReplacement.new_text_sha256)
    || textReplacement.old_text_sha256 === textReplacement.new_text_sha256
    || textReplacement.requested_regions !== null
      && (!Number.isSafeInteger(textReplacement.requested_regions) || textReplacement.requested_regions < 1)
    || textReplacement.status !== value.semantic
    || operation === 'generate')) return false
  if (status === 'completed') {
    if (operation === 'generate') {
      return humanReview === undefined && value.structural === 'passed'
        && value.source_output === 'not-applicable' && value.semantic === 'not-applicable'
    }
    return !sameSource && humanReview?.decision === 'accepted'
      && value.structural === 'passed' && value.source_output === 'distinct' && value.semantic === 'passed'
  }
  if (status === 'needs-review') {
    return operation !== 'generate' && !sameSource && humanReview === undefined && value.structural === 'passed'
      && value.source_output === 'distinct' && value.semantic === 'needs-review'
  }
  if (status === 'failed' && sameSource) {
    return operation !== 'generate' && humanReview === undefined && value.structural === 'passed'
      && value.source_output === 'same' && value.semantic === 'failed'
  }
  if (status === 'failed' && humanReview?.decision === 'rejected') {
    return operation !== 'generate' && !sameSource && value.structural === 'passed'
      && value.source_output === 'distinct' && value.semantic === 'failed'
  }
  return value.structural === 'not-run' && value.source_output === 'unknown'
    && humanReview === undefined && value.semantic === (status === 'failed' ? 'failed' : 'needs-review')
}

function validReceiptV2(value, refs, parentSessionId, childSessionId) {
  const keys = new Set([
    'billing_status', 'call_id', 'child_session_id', 'content', 'failure_code', 'job_id', 'model', 'operation',
    'output', 'parent_session_id', 'provider_request_id', 'client_request_id', 'revision', 'schema_version', 'sources',
    'status', 'verification', 'verifier',
  ])
  if (!isRecord(value)
    || Object.keys(value).some(key => !keys.has(key))
    || value.schema_version !== IMAGE_RECEIPT_VERSION
    || value.revision !== 1
    || typeof value.call_id !== 'string' || value.call_id.length === 0
    || value.operation !== imageOperation(refs)
    || !['completed', 'needs-review', 'failed', 'cancelled', 'unknown'].includes(value.status)
    || !['not-submitted', 'recorded', 'unknown'].includes(value.billing_status)
    || value.parent_session_id !== parentSessionId
    || value.child_session_id !== childSessionId
    || !Array.isArray(value.sources)
    || value.sources.length !== refs.length
    || value.sources.some((ref, index) => !sameImageRef(ref, refs[index]))
    || !Array.isArray(value.content)
    || !exactKeys(value.verifier, ['semantic', 'structural'])
    || value.verifier.structural !== 'attachment-cas-v1'
    || value.verifier.semantic !== (value.operation === 'generate'
      ? 'not-required'
      : value.verification?.human_review === undefined ? 'not-configured' : 'native-user-confirmation-v1')
    || value.failure_code !== undefined && (typeof value.failure_code !== 'string' || value.failure_code.length > 128)
    || value.job_id !== undefined && (typeof value.job_id !== 'string' || value.job_id.length === 0)
    || value.provider_request_id !== undefined
      && (typeof value.provider_request_id !== 'string' || !IDENTIFIER.test(value.provider_request_id))
    || value.client_request_id !== undefined
      && (typeof value.client_request_id !== 'string' || !IDENTIFIER.test(value.client_request_id))) return false
  if (value.output !== undefined && !validImageRef(value.output)) return false
  const sameSource = value.output !== undefined && refs.some(ref => ref.attachmentId === value.output.attachmentId)
  if (!validVerification(value.verification, value.operation, value.status, sameSource)) return false
  if (value.status === 'completed' || value.status === 'needs-review') {
    return value.output !== undefined
      && value.content.length === 1
      && value.content[0]?.type === 'image'
      && sameImageRef(value.content[0]?.attachment, value.output)
      && typeof value.job_id === 'string'
      && value.billing_status === 'recorded'
      && typeof value.provider_request_id === 'string'
      && typeof value.client_request_id === 'string'
      && value.model === IMAGE_MODEL
  }
  if (value.content.length !== 0) return false
  if (value.status === 'failed' && value.billing_status === 'recorded') {
    if (typeof value.job_id !== 'string' || typeof value.provider_request_id !== 'string'
      || typeof value.client_request_id !== 'string' || value.model !== IMAGE_MODEL) return false
    return value.output !== undefined && (sameSource
      ? value.failure_code === 'source-output-same-sha256'
      : value.verification?.human_review?.decision === 'rejected' && value.failure_code === 'user-rejected')
      || value.output === undefined && value.failure_code === 'provider-result-uncommitted'
  }
  if (value.billing_status === 'unknown') {
    return ['unknown', 'cancelled'].includes(value.status)
      && value.output === undefined && typeof value.job_id === 'string'
      && typeof value.client_request_id === 'string' && value.provider_request_id === undefined
      && value.model === undefined
  }
  const hasJobScope = typeof value.job_id === 'string' && typeof value.client_request_id === 'string'
  const hasNoJobScope = value.job_id === undefined && value.client_request_id === undefined
  return value.billing_status === 'not-submitted'
    && ['failed', 'cancelled'].includes(value.status)
    && value.output === undefined && (hasJobScope || hasNoJobScope)
    && value.provider_request_id === undefined
    && value.model === undefined
}

function messageImages(messages, generatedOnly = false) {
  const images = []
  let visited = 0
  const collect = (blocks, generated = false) => {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (++visited > 20_000) throw new Error('e-Mate image history exceeds the edit lookup boundary')
      if (block?.type === 'image' && validImageRef(block.attachment) && (!generatedOnly || generated)) {
        images.push(block.attachment)
      }
      if (block?.type === 'tool-result') collect(block.content, true)
    }
  }
  for (const message of messages) collect(message?.content)
  return images
}

function eventImages(events) {
  if (!Array.isArray(events)) return []
  const images = []
  for (const event of events) {
    if (event?.type === 'emate/image-output') {
      const content = event.data?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === 'image' && validImageRef(block.attachment)) images.push(block.attachment)
        }
      }
      continue
    }
    if (event?.type === 'user/message') images.push(...messageImages([{ content: event.data?.content }]))
    else if (event?.type === 'assistant/message' || event?.type === 'tool/result') {
      images.push(...messageImages([event.data?.message]))
    }
  }
  return images
}

function uniqueImages(images, newestFirst = false) {
  const ordered = newestFirst ? [...images].reverse() : images
  const seen = new Set()
  return ordered.filter(image => {
    if (seen.has(image.attachmentId)) return false
    seen.add(image.attachmentId)
    return true
  })
}

function sessionMessages(agent) {
  const messages = agent?.session?.deriveMessages?.()
  if (!Array.isArray(messages)) throw new Error('image tools require the authoritative e-Mate conversation')
  return messages
}

function sessionImage(agent, attachmentId) {
  const image = uniqueImages([
    ...messageImages(sessionMessages(agent)),
    ...eventImages(agent?.session?.events),
  ], true)
    .find(candidate => candidate.attachmentId === attachmentId)
  if (image !== undefined) return image
  throw new Error(`image attachment ${attachmentId} is not present in this e-Mate session`)
}

function validCompletedParentReceipt(value, parentSessionId) {
  return isRecord(value)
    && [2, 3].includes(value.revision)
    && value.status === 'completed'
    && Array.isArray(value.sources)
    && (value.child_session_id === undefined || typeof value.child_session_id === 'string')
    && validReceiptV2({ ...value, revision: 1 }, value.sources, parentSessionId, value.child_session_id)
}

function successfulSessionImage(agent, attachmentId) {
  const uploaded = uniqueImages(messageImages(sessionMessages(agent)
    .filter(message => message?.source?.kind === 'user')), true)
    .find(candidate => candidate.attachmentId === attachmentId)
  if (uploaded !== undefined) return uploaded
  const parentSessionId = sessionIdentity(agent)
  const image = uniqueImages((agent?.session?.events ?? [])
    .filter(event => event?.type === 'emate/image-output'
      && validCompletedParentReceipt(event.data, parentSessionId))
    .map(event => event.data.output), true)
    .find(candidate => candidate.attachmentId === attachmentId)
  if (image !== undefined) return image
  throw new Error(`image attachment ${attachmentId} is not a successful current-session image output`)
}

function latestUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.source?.kind === 'user') return messages[index]
  }
  return undefined
}

function imageCatalogContext(agent, messages) {
  const current = uniqueImages(messageImages(latestUserMessage(messages) === undefined ? [] : [latestUserMessage(messages)]))
  const eventHistory = eventImages(agent?.session?.events)
  const recent = uniqueImages(eventHistory.length === 0 ? messageImages(messages) : eventHistory, true)
    .filter(image => !current.some(selected => selected.attachmentId === image.attachmentId))
    .slice(0, 32)
  if (current.length === 0 && recent.length === 0) return undefined
  const selected = current.length === 0 ? ''
    : `Images selected in the current user request, in attachment order: ${current.map(image => `\`${image.attachmentId}\``).join(', ')}. `
  const history = recent.length === 0 ? ''
    : `Recent images already stored in this conversation, newest first: ${recent.map(image => `\`${image.attachmentId}\``).join(', ')}. `
  return `${selected}${history}For an edit or reference request such as \"修改上图\", call imagegen with the matching exact image_url attachment ID (normally the newest image when the user says \"上图\"); never ask the user to upload an image already listed here. For several independent edits, make one imagegen call per source, one at a time, and pass exactly one image_url to each call; never send the whole selected group to every edit. Explicitly pass multiple IDs only when the user asks to fuse those references into one output. A request for a wholly new image must omit image_url. To deliver several images together, call image_pack once with their exact attachment IDs.`
}

const SESSION_IMAGE_REFERENCE = /(?:上图|这张图|该图|原图|刚才(?:生成|上传)?的?(?:那张)?图|所附图片|附件(?:中|里)的图|(?:把|将)它(?:修改|改成|修成)|\b(?:this|that|above|previous|original|uploaded|attached)\s+(?:image|picture|photo)\b)/iu
const SESSION_IMAGE_EDIT_LOCATOR = /(?:(?:^|[把将这那请，。；：\s])(?:图|图片)(?:中|上|里)(?:的)?[^\n]{0,80}(?:改|修改|替换|删除|去掉|换成|修成|调整|重绘)|(?:改|修改|替换|删除|去掉|换成|修成|调整|重绘)[^\n]{0,80}(?:这张)?(?:图|图片)(?:中|上|里)(?:的)?)/iu

function implicitEditImages(agent, task) {
  if (task.attachmentIds.length > 0) return task.attachmentIds
  const messages = sessionMessages(agent)
  const current = uniqueImages(messageImages(latestUserMessage(messages) === undefined ? [] : [latestUserMessage(messages)]))
  if (current.length === 1) return [current[0].attachmentId]
  if (current.length > 1) {
    throw new Error('multiple source images require an explicit image_url: use one exact attachment ID per independent edit, or pass the intended IDs together only for reference fusion')
  }
  const text = latestUserMessage(messages)?.content
    ?.filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('\n') ?? ''
  const request = `${text}\n${task.prompt}`
  if (!SESSION_IMAGE_REFERENCE.test(request) && !SESSION_IMAGE_EDIT_LOCATOR.test(request)) return []
  const history = eventImages(agent?.session?.events)
  const newest = uniqueImages(history.length === 0 ? messageImages(messages) : history, true)[0]
  if (newest === undefined) {
    throw new Error('image editing needs a source image in the current conversation; upload one image once and retry')
  }
  return [newest.attachmentId]
}

function normalizeTask(args) {
  if (!isRecord(args) || Object.keys(args).some(key => !['prompt', 'image_url'].includes(key))
    || typeof args.prompt !== 'string') {
    throw new Error('imagegen accepts only prompt and optional image_url')
  }
  const prompt = args.prompt.trim()
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS || prompt.includes('\0')) {
    throw new Error(`image prompt must contain 1 to ${MAX_PROMPT_CHARS} characters`)
  }
  const imageUrl = args.image_url
  const attachmentIds = imageUrl === undefined ? [] : Array.isArray(imageUrl) ? imageUrl : [imageUrl]
  if (attachmentIds.length > MAX_EDIT_IMAGES
    || attachmentIds.some(id => typeof id !== 'string' || !ATTACHMENT_ID.test(id))) {
    throw new Error('image_url must contain current-session image attachment IDs')
  }
  return { prompt, attachmentIds: [...new Set(attachmentIds)] }
}

function attemptedImageOperation(args) {
  if (!isRecord(args) || args.image_url === undefined) return 'generate'
  return Array.isArray(args.image_url) && args.image_url.length > 1 ? 'fusion' : 'edit'
}

function normalizePack(args) {
  if (!exactKeys(args, ['image_url']) || !Array.isArray(args.image_url)) {
    throw new Error('image_pack accepts only an image_url array')
  }
  const attachmentIds = [...new Set(args.image_url)]
  if (attachmentIds.length === 0 || attachmentIds.length > MAX_PACK_IMAGES
    || attachmentIds.some(id => typeof id !== 'string' || !ATTACHMENT_ID.test(id))) {
    throw new Error(`image_pack requires 1 to ${MAX_PACK_IMAGES} current-session image attachment IDs`)
  }
  return { attachmentIds }
}

function packRelativePath(attachmentIds) {
  const digest = createHash('sha256').update(attachmentIds.join('\0')).digest('hex').slice(0, 12)
  return `.e-mate/images/e-Mate-images-${digest}.zip`
}

function inside(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

async function imageWorkspace(agent) {
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('image packaging requires a current local workspace')
  const root = await realpath(cwd)
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('current image workspace is unavailable')
  return root
}

async function imagePackDirectory(root) {
  let current = root
  for (const segment of ['.e-mate', 'images']) {
    const path = join(current, segment)
    await mkdir(path, { recursive: false, mode: 0o700 }).catch(error => {
      if (error?.code !== 'EEXIST') throw error
    })
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('image package output directory is unsafe')
    current = await realpath(path)
    if (!inside(root, current)) throw new Error('image package output directory escapes the workspace')
  }
  return current
}

function imageExtension(mediaType) {
  if (mediaType === 'image/png') return 'png'
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  throw new Error(`${mediaType} is unsupported by image packaging`)
}

async function publishImagePack(root, relativePath, data, signal) {
  if (data.byteLength < 1 || data.byteLength > MAX_PACK_BYTES + 1024 * 1024) {
    throw new Error('image package output exceeds the 101 MiB limit')
  }
  const directory = await imagePackDirectory(root)
  const target = join(directory, relativePath.slice(relativePath.lastIndexOf('/') + 1))
  const existing = await lstat(target).catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })
  if (existing !== undefined) {
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== data.byteLength
      || !Buffer.from(await readFile(target, { signal })).equals(Buffer.from(data))) {
      throw new Error('an existing image package conflicts with the current attachment set')
    }
    return
  }
  const temporary = join(directory, `.image-pack-${randomUUID()}.tmp`)
  await writeFile(temporary, data, { flag: 'wx', flush: true, mode: 0o600, signal })
  try {
    await link(temporary, target)
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink()) {
      await unlink(target).catch(() => {})
      throw new Error('image package output is not a regular file')
    }
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

async function createImagePack(ctx, agent, args, signal) {
  const pack = normalizePack(args)
  const refs = pack.attachmentIds.map(id => successfulSessionImage(agent, id))
  const entries = {}
  let total = 0
  for (const [index, ref] of refs.entries()) {
    signal.throwIfAborted()
    const stored = await ctx.attachments.readImage(ref, signal)
    total += stored.data.byteLength
    if (total > MAX_PACK_BYTES) throw new Error('image package inputs exceed the 100 MiB limit')
    const name = `image-${String(index + 1).padStart(3, '0')}.${imageExtension(ref.mediaType)}`
    entries[name] = new Uint8Array(stored.data)
  }
  const relativePath = packRelativePath(pack.attachmentIds)
  const data = zipSync(entries, { level: 0 })
  await publishImagePack(await imageWorkspace(agent), relativePath, data, signal)
  return { bytes: data.byteLength, image_count: refs.length, relative_path: relativePath }
}

function assertImagePackWrite(ctx, agent) {
  const session = agent?.session
  if (session === undefined) throw new Error('image packaging requires an owning Agent session')
  if (ctx.sandboxPolicy.resolve({ session }).mode === 'read-only') {
    throw new Error('image packaging is blocked by the current read-only sandbox policy')
  }
}

function detectedImage(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mediaType: 'image/png', extension: 'png' }
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mediaType: 'image/jpeg', extension: 'jpg' }
  }
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mediaType: 'image/webp', extension: 'webp' }
  }
  throw new Error('e-Mate image result is not PNG, JPEG, or WebP')
}

function requestScope(exec) {
  const sessionId = String(exec.agent?.session?.header?.id ?? exec.agent?.id ?? '')
  const callId = String(exec.callId ?? '')
  if (sessionId.length === 0 || callId.length === 0) throw new Error('image generation requires a stable e-Mate Tool scope')
  const id = createHash('sha256').update(sessionId).update('\0').update(callId).digest('hex').slice(0, 32)
  const clientRequestId = `image-${id}`
  return {
    clientRequestId,
    headers: {
      'x-e-mate-task-id': clientRequestId,
      'x-e-mate-trace-id': clientRequestId,
      session_id: clientRequestId,
      'x-client-request-id': clientRequestId,
    },
  }
}

function createImageClient({ request, root, attachments }) {
  const imageLimit = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
  const responseLimit = Math.ceil(imageLimit * 4 / 3) + 256 * 1024

  async function execute(task, refs, signal, scope, onSubmit, onProviderResponse) {
    signal.throwIfAborted()
    const headers = new Headers({ accept: 'application/json', ...scope })
    let body
    let path
    if (refs.length === 0) {
      path = '/images/generations'
      headers.set('content-type', 'application/json')
      body = JSON.stringify({ model: IMAGE_MODEL, prompt: task.prompt })
    } else {
      path = '/images/edits'
      const form = new FormData()
      form.set('model', IMAGE_MODEL)
      form.set('prompt', task.prompt)
      const field = refs.length === 1 ? 'image' : 'image[]'
      for (const [index, ref] of refs.entries()) {
        if (!MEDIA_TYPES.has(ref.mediaType)) throw new Error(`${ref.mediaType} is unsupported by e-Mate image editing`)
        const stored = await attachments.readImage(ref, signal)
        if (stored.ref.attachmentId !== ref.attachmentId
          || stored.ref.mediaType !== ref.mediaType
          || stored.ref.bytes !== ref.bytes
          || stored.ref.width !== ref.width
          || stored.ref.height !== ref.height) {
          throw new Error('e-Mate image edit source no longer matches its attachment receipt')
        }
        if (stored.data.byteLength > MAX_EDIT_IMAGE_BYTES) throw new Error('e-Mate image edit input exceeds 5 MiB')
        const extension = ref.mediaType === 'image/png' ? 'png' : ref.mediaType === 'image/jpeg' ? 'jpg' : 'webp'
        form.append(field, new Blob([new Uint8Array(stored.data)], { type: ref.mediaType }), `image-${index + 1}.${extension}`)
      }
      body = form
    }
    signal.throwIfAborted()
    onSubmit()
    const value = await responseJson(await request(endpoint(root, path), {
      method: 'POST', headers, body, redirect: 'error', signal,
    }), responseLimit, `e-Mate image ${refs.length === 0 ? 'generation' : 'edit'}`)
    if (!exactKeys(value, ['id', 'data', 'usage']) || typeof value.id !== 'string' || !IDENTIFIER.test(value.id)
      || !Array.isArray(value.data) || value.data.length !== 1 || !isRecord(value.usage)) {
      throw new Error('e-Mate image response is invalid')
    }
    onProviderResponse(value.id)
    if (!exactKeys(value.data[0], ['b64_json']) || typeof value.data[0].b64_json !== 'string'
      || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.data[0].b64_json)) {
      throw new Error('e-Mate image response is invalid')
    }
    const data = Buffer.from(value.data[0].b64_json, 'base64')
    if (data.byteLength < 1 || data.byteLength > imageLimit
      || data.toString('base64').replace(/=+$/u, '') !== value.data[0].b64_json.replace(/=+$/u, '')) {
      throw new Error('e-Mate image response bytes are invalid')
    }
    const detected = detectedImage(data)
    const expectedId = `sha256:${createHash('sha256').update(data).digest('hex')}`
    const attachment = await attachments.saveImage({
      data,
      mediaType: detected.mediaType,
      name: `e-Mate-image.${detected.extension}`,
    })
    if (!validImageRef(attachment)
      || attachment.attachmentId !== expectedId
      || attachment.mediaType !== detected.mediaType
      || attachment.bytes !== data.byteLength) {
      throw new Error('e-Mate image output does not match its attachment receipt')
    }
    const stored = await attachments.readImage(attachment, signal)
    if (!sameImageRef(stored.ref, attachment)
      || !(stored.data instanceof Uint8Array)
      || !Buffer.from(stored.data).equals(data)) {
      throw new Error('e-Mate image output is not durable in the Attachment CAS')
    }
    return { request_id: value.id, model: IMAGE_MODEL, image: imageRef(attachment) }
  }

  return { execute }
}

function startImageJob(ctx, owner, execSignal, operation) {
  if (owner === undefined) throw new Error('image generation requires an owning e-Mate Agent')
  let result
  let signal
  const id = ctx.jobs.start({
    kind: 'emate-image',
    label: 'Generate or edit e-Mate image',
    owner,
    outputLimitBytes: 16 * 1024,
    run() {
      const controller = new AbortController()
      signal = controller.signal
      const onAbort = () => controller.abort(execSignal.reason)
      if (execSignal.aborted) controller.abort(execSignal.reason)
      else execSignal.addEventListener('abort', onAbort, { once: true })
      result = Promise.resolve().then(() => operation(controller.signal)).finally(() => {
        execSignal.removeEventListener('abort', onAbort)
      })
      return {
        cancel: reason => controller.abort(reason),
        done: result.then(
          value => ({
            status: value.status === 'completed' ? 'completed' : 'failed',
            detail: value.status === 'completed'
              ? '1 image, 0 failures'
              : value.status === 'needs-review' ? '1 image needs review' : 'image verification failed',
            output: JSON.stringify({
              image_count: value.status === 'completed' ? 1 : 0,
              failure_count: value.status === 'completed' ? 0 : 1,
              receipt_status: value.status,
              request_ids: [value.request_id],
              attachment_ids: value.status === 'completed' ? [value.image.attachmentId] : [],
            }),
          }),
          () => ({
            status: controller.signal.aborted ? 'killed' : 'failed',
            detail: controller.signal.aborted ? 'Image task cancelled' : 'Image task failed',
          }),
        ),
      }
    },
  })
  if (result === undefined || signal === undefined) throw new Error('image Job started without producer hooks')
  return { id, result, signal }
}

const imageOutput = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      job_id: { type: 'string', required: true },
      images: { type: 'array', required: true, items: { type: 'json' } },
      failures: { type: 'array', required: true, items: { type: 'json' } },
      status: { type: 'string', required: true, enum: ['completed', 'needs-review'] },
      receipt: { type: 'json', required: true },
    },
  },
  render: (_args, value) => [{
    type: 'text',
    text: value.status === 'completed'
      ? `Generated 1 structurally verified image. Current-session image attachment ID for future image_url: ${value.images[0].image.attachmentId}`
      : `The edited image was saved, but its requested visual or text change still needs human review. Current-session image attachment ID: ${value.images[0].image.attachmentId}`,
  }],
  presentationMeta: (_args, value) => {
    const image = value.images[0].image
    const locator = {
      kind: 'image-attachment',
      attachment_id: image.attachmentId,
      media_type: image.mediaType,
      bytes: image.bytes,
      width: image.width,
      height: image.height,
    }
    if (value.status === 'completed') {
      return {
        $eMateDeliverables: {
          schema_version: 1,
          items: [{
            kind: 'image',
            name: image.name ?? `e-Mate-image.${imageExtension(image.mediaType)}`,
            mime: image.mediaType,
            size: image.bytes,
            sha256: image.attachmentId.slice('sha256:'.length),
            locator,
          }],
        },
      }
    }
    return {
      $eMateDeliverables: {
        schema_version: 2,
        items: [],
        review_candidates: [{
          kind: 'image',
          operation: value.receipt.operation,
          reason: 'semantic-verifier-unavailable',
          name: `e-Mate-image-review.${imageExtension(image.mediaType)}`,
          mime: image.mediaType,
          size: image.bytes,
          sha256: image.attachmentId.slice('sha256:'.length),
          locator,
          sources: value.receipt.sources.map(source => ({
            kind: 'image-attachment',
            attachment_id: source.attachmentId,
            media_type: source.mediaType,
            bytes: source.bytes,
            width: source.width,
            height: source.height,
          })),
        }],
      },
    }
  },
}

function finalReceiptRevision(agent, callId) {
  return agent.session.events.some(event => event?.type === 'emate/image-output'
    && event.data?.call_id === String(callId)
    && event.data?.revision === 2
    && event.data?.status === 'needs-review') ? 3 : 2
}

const imagePackOutput = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      bytes: { type: 'integer', required: true },
      image_count: { type: 'integer', required: true },
      relative_path: { type: 'string', required: true },
    },
  },
  render: (_args, value) => [{
    type: 'text',
    text: `已将 ${value.image_count} 张图片打包到本地产物：${value.relative_path}（${value.bytes} bytes）。`,
  }],
  presentationMeta: (_args, value) => ({
    $eMateDeliverables: {
      schema_version: 1,
      items: [{
        kind: 'archive',
        name: value.relative_path.slice(value.relative_path.lastIndexOf('/') + 1),
        mime: 'application/zip',
        size: value.bytes,
        sha256: null,
        locator: { kind: 'workspace-file', relative_path: value.relative_path },
      }],
    },
  }),
}

export async function apply(ctx, config = {}) {
  const capabilities = ctx.get('emateCapabilities')
  if (capabilities === undefined) throw new Error('e-Mate image generation requires emateCapabilities')
  let root
  let configurationError
  try {
    root = config.rootUrl === undefined ? undefined : gatewayRoot(config.rootUrl)
  } catch (error) {
    configurationError = error instanceof Error ? error.message : String(error)
  }
  ctx.effect(() => capabilities.register({
    id: 'image-generation',
    title: '生图 / 改图',
    summary: '使用企业下发的固定图像模型生成或编辑图片，结果保存在当前本地会话。',
    icon_key: 'image',
    order: 10,
    actions: [],
    status: async () => {
      if (root === undefined) {
        return {
          state: config.rootUrl === undefined ? 'setup-required' : 'blocked',
          detail: configurationError ?? '企业管理端尚未下发生图服务地址。',
          action_ids: [],
        }
      }
      const modelPolicy = ctx.get('emateModelPolicy')
      if (modelPolicy === undefined) {
        return { state: 'blocked', detail: '图像任务运行链尚未就绪。', action_ids: [] }
      }
      if (!ctx.tools.schemas().some(schema => schema.name === 'imagegen')) {
        return { state: 'blocked', detail: '图像 Tool 注册尚未就绪。', action_ids: [] }
      }
      try {
        await modelPolicy.assertModel(IMAGE_MODEL)
        return { state: 'ready', detail: IMAGE_MODEL, action_ids: [] }
      } catch {
        return { state: 'blocked', detail: '当前账号暂不可使用图像模型。', action_ids: [] }
      }
    },
  }), 'emate.image: capability metadata')
  if (root === undefined) return
  const identity = ctx.get('emateIdentity')
  if (identity === undefined) throw new Error('managed image generation requires emateIdentity')
  const modelPolicy = ctx.get('emateModelPolicy')
  if (modelPolicy === undefined) throw new Error('managed image generation requires emateModelPolicy')
  const client = createImageClient({
    request: identity.request.bind(identity),
    root,
    attachments: ctx.attachments,
  })
  const bindingPath = config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json')
  const [{ defineTool }, { createUserMessage }] = await Promise.all([
    loadTargetTools(bindingPath),
    loadTargetLlm(bindingPath),
  ])
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const context = imageCatalogContext(agent, decision.messages)
    return context === undefined ? decision : {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text: context }],
        source: { kind: 'plugin', plugin: '@e-mate/dsh-image-generation', form: 'catalog' },
      })],
    }
  })
  ctx.effect(() => ctx.jobs.attachController('emate-image'), 'emate.image: target Job controller')
  ctx.tools.register(defineTool({
    name: 'imagegen',
    description: 'Generate or edit one independent image through the fixed e-Mate gpt-image-2-pro route. For an edit, copy the exact sha256: value labeled as the current-session image attachment ID by a prior imagegen or job_output result into image_url; never pass its Job ID, request ID, or a URL. For multiple independent edits, make separate imagegen calls one at a time and pass exactly one source ID to each call. Pass multiple explicit IDs only for reference fusion into one output. Never pass a provider, model, output path, size, quality, timeout, or concurrency policy.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'One image generation or edit instruction.' },
      image_url: {
        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        description: 'Optional exact sha256: current-session image attachment ID or ordered IDs from prior imagegen results for editing/reference fusion. Job IDs, request IDs, and URLs are invalid.',
      },
    },
    output: imageOutput,
    // The native AgentLoop owns the per-parent exclusive lane.
    isConcurrencySafe: () => false,
    timeoutMs: IMAGE_TIMEOUT_MS,
    async execute(args, exec) {
      assertFreshParentCall(exec.agent, exec.callId)
      const parentSessionId = sessionIdentity(exec.agent)
      let operation = attemptedImageOperation(args)
      let refs = []
      let task
      try {
        if (!ctx.tools.schemas(exec.agent).some(schema => schema.name === 'imagegen')) {
          const error = new Error('imagegen is unavailable in the current Agent tool scope')
          ;(error as Error & { code: string }).code = 'agent-tool-unavailable'
          throw error
        }
        exec.signal.throwIfAborted()
        task = normalizeTask(args)
        task.attachmentIds = implicitEditImages(exec.agent, task)
        operation = imageOperation(task.attachmentIds)
        refs = task.attachmentIds.map(id => sessionImage(exec.agent, id))
      } catch (error) {
        appendImageReceipt(exec.agent, failedReceipt(
          exec.callId,
          operation,
          refs,
          exec.signal.aborted ? 'cancelled' : 'failed',
          false,
          failureCode(error, false, exec.signal.aborted),
          parentSessionId,
          undefined,
          undefined,
          undefined,
          2,
        ))
        throw error
      }

      appendImageReceipt(exec.agent, runningReceipt(exec.callId, operation, refs, parentSessionId))
      let submitted = false
      let started
      let terminalJob
      let clientRequestId
      let providerRequestId
      try {
        await modelPolicy.assertModel(IMAGE_MODEL)
        exec.signal.throwIfAborted()
        const scope = requestScope(exec)
        clientRequestId = scope.clientRequestId
        started = startImageJob(ctx, exec.agent, exec.signal, async (signal) => {
          const value = await client.execute(
            task,
            refs,
            signal,
            scope.headers,
            () => { submitted = true },
            value => { providerRequestId = value },
          )
          let reviewDecision
          if (imageResultStatus(refs, value) === 'needs-review') {
            if (started?.id === undefined) throw new Error('image Job identity is unavailable for native review')
            reviewDecision = await reviewImageCandidate(
              ctx,
              exec.agent,
              exec.callId,
              task,
              refs,
              value,
              started.id,
              parentSessionId,
              clientRequestId,
              signal,
            )
          }
          return { ...value, reviewDecision, status: imageResultStatus(refs, value, reviewDecision) }
        })
        let image
        try {
          image = await started.result
        } catch (error) {
          terminalJob = await ctx.jobs.wait(started.id, IMAGE_TIMEOUT_MS, exec.agent).catch(() => undefined)
          throw error
        }
        await ctx.jobs.wait(started.id, IMAGE_TIMEOUT_MS, exec.agent, exec.signal)
        const receipt = verifiedReceipt(
          exec.callId,
          task,
          refs,
          image,
          started.id,
          parentSessionId,
          clientRequestId,
          image.reviewDecision,
          finalReceiptRevision(exec.agent, exec.callId),
        )
        appendImageReceipt(exec.agent, receipt)
        if (receipt.status === 'failed') {
          if (receipt.failure_code === 'user-rejected') {
            throw new Error('e-Mate image edit was rejected by the user; use a new explicit retry Tool call')
          }
          throw new Error('e-Mate image edit verification failed because source and output have the same SHA-256')
        }
        return {
          job_id: started.id,
          images: [{ request_id: image.request_id, model: image.model, image: image.image }],
          failures: [],
          status: receipt.status,
          receipt,
        }
      } catch (error) {
        const revision = finalReceiptRevision(exec.agent, exec.callId)
        const alreadyRecorded = exec.agent.session.events.some(event => event?.type === 'emate/image-output'
          && event.data?.schema_version === IMAGE_RECEIPT_VERSION
          && event.data?.call_id === String(exec.callId)
          && event.data?.revision === revision)
        if (!alreadyRecorded) {
          const aborted = exec.signal.aborted
          const definitelyRejected = providerRequestId === undefined && requestDefinitelyRejected(error)
          const possiblySubmitted = submitted && !definitelyRejected
          const cancelled = started?.signal.aborted === true || terminalJob?.status === 'killed' || aborted
          appendImageReceipt(exec.agent, failedReceipt(
            exec.callId,
            operation,
            refs,
            providerRequestId !== undefined
              ? 'failed'
              : cancelled ? 'cancelled' : possiblySubmitted ? 'unknown' : 'failed',
            possiblySubmitted,
            providerRequestId === undefined
              ? cancelled ? 'cancelled' : failureCode(error, possiblySubmitted, false)
              : 'provider-result-uncommitted',
            parentSessionId,
            started?.id,
            started === undefined ? undefined : clientRequestId,
            providerRequestId,
            revision,
          ))
        }
        if (error instanceof Error && [
          'e-Mate image edit was rejected by the user; use a new explicit retry Tool call',
          'e-Mate image edit verification failed because source and output have the same SHA-256',
        ].includes(error.message)) throw error
        const status = exec.agent.session.events.findLast(event => event?.type === 'emate/image-output'
          && event.data?.call_id === String(exec.callId)
          && event.data?.status !== 'running')?.data?.status ?? 'failed'
        throw new Error(`e-Mate image request ended with receipt status ${status}`)
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Generate or edit image',
      kind: 'write',
      rawInput: args.prompt,
    }),
  }))
  ctx.tools.register(defineTool({
    name: 'image_pack',
    description: 'Package already-generated current-session images into one local ZIP deliverable. Copy the exact sha256: attachment IDs from the image catalog into image_url in the desired order. Do not regenerate, transform, download by URL, or ask for an output path.',
    parameters: {
      image_url: {
        type: 'array', required: true, items: { type: 'string' },
        description: 'Exact current-session sha256: image attachment IDs to include, in archive order.',
      },
    },
    output: imagePackOutput,
    isConcurrencySafe: () => false,
    timeoutMs: 120_000,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      assertImagePackWrite(ctx, exec.agent)
      return await createImagePack(ctx, exec.agent, args, exec.signal)
    },
    presentCall: args => {
      try {
        const pack = normalizePack(args)
        const path = packRelativePath(pack.attachmentIds)
        return {
          card: 'generic', title: '打包图片', kind: 'edit', rawInput: `${pack.attachmentIds.length} images`,
          locations: [{ path }],
        }
      } catch {
        return undefined
      }
    },
  }))
}
