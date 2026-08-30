import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

export type ImageGalleryStatus = 'completed' | 'review-required' | 'failed'

export interface ImageGalleryItem {
  readonly callId: string
  readonly childSessionId?: string
  readonly revision: number
  readonly status: ImageGalleryStatus
  readonly operation: 'generate' | 'edit' | 'fusion' | 'unknown'
  readonly attachment?: ImageAttachmentRef
  readonly failureCode?: string
}

const RECEIPT_KEYS = new Set([
  'billing_status', 'call_id', 'child_session_id', 'client_request_id', 'content', 'failure_code', 'job_id',
  'model', 'operation', 'output', 'parent_session_id', 'provider_request_id', 'revision', 'schema_version',
  'sources', 'status', 'verification', 'verifier',
])
const ATTACHMENT_ID = /^sha256:[0-9a-f]{64}$/u

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function imageRef(value: unknown, strict: boolean): ImageAttachmentRef | undefined {
  if (!record(value) || typeof value.attachmentId !== 'string' || value.attachmentId.length === 0) return undefined
  if (strict && (!ATTACHMENT_ID.test(value.attachmentId)
    || !['image/png', 'image/jpeg', 'image/webp'].includes(String(value.mediaType))
    || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1
    || !Number.isSafeInteger(value.width) || Number(value.width) < 1
    || !Number.isSafeInteger(value.height) || Number(value.height) < 1
    || value.name !== undefined && (typeof value.name !== 'string' || value.name.length > 255 || /[\\/\0]/u.test(value.name)))) return undefined
  return value as unknown as ImageAttachmentRef
}

function imageContent(value: unknown, strict: boolean): ImageAttachmentRef[] | undefined {
  if (!Array.isArray(value) || value.length > 1) return undefined
  const images: ImageAttachmentRef[] = []
  for (const block of value) {
    if (!record(block) || block.type !== 'image') return undefined
    const attachment = imageRef(block.attachment, strict)
    if (attachment === undefined) return undefined
    images.push(attachment)
  }
  return images
}

/** Parse only the frozen v2 receipt plus its exact pre-v2 historical terminal form. */
export function parseImageOutputReceipt(value: unknown): ImageGalleryItem | null {
  if (!record(value)) return null
  const keys = Object.keys(value)
  if (keys.length === 2 && keys.includes('call_id') && keys.includes('content')) {
    const images = imageContent(value.content, false)
    return typeof value.call_id === 'string' && value.call_id !== '' && images?.length === 1
      ? { callId: value.call_id, revision: 0, status: 'completed', operation: 'unknown', attachment: images[0] }
      : null
  }
  if (keys.some(key => !RECEIPT_KEYS.has(key))
    || value.schema_version !== 2
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || Number(value.revision) > 3
    || typeof value.call_id !== 'string' || value.call_id === ''
    || value.child_session_id !== undefined
      && (typeof value.child_session_id !== 'string' || value.child_session_id === '')
    || !['generate', 'edit', 'fusion'].includes(String(value.operation))
    || !['running', 'completed', 'needs-review', 'failed', 'cancelled', 'unknown'].includes(String(value.status))
    || !['not-submitted', 'recorded', 'unknown'].includes(String(value.billing_status))
    || typeof value.parent_session_id !== 'string' || value.parent_session_id === ''
    || !Array.isArray(value.sources) || !record(value.verifier) || !record(value.verification)) return null
  const images = imageContent(value.content, true)
  if (images === undefined) return null
  const status = String(value.status)
  if (status === 'running') return null
  if ((status === 'completed' || status === 'needs-review') !== (images.length === 1)) return null
  const failureCode = typeof value.failure_code === 'string' && value.failure_code !== ''
    ? value.failure_code
    : undefined
  return {
    callId: value.call_id,
    ...(value.child_session_id === undefined ? {} : { childSessionId: value.child_session_id as string }),
    revision: Number(value.revision),
    status: status === 'completed' ? 'completed' : status === 'needs-review' ? 'review-required' : 'failed',
    operation: value.operation as ImageGalleryItem['operation'],
    ...(images[0] === undefined ? {} : { attachment: images[0] }),
    ...(failureCode === undefined ? {} : { failureCode }),
  }
}

export function imageReceiptRole(item: ImageGalleryItem): 'start' | 'update' {
  return item.revision === 3 ? 'update' : 'start'
}
