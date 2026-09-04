import { memo } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import { MessageImage } from '@deepseek-ai/dsh-client-ui-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ImageBatchClientBatch, ImageBatchClientTask, ImageBatchClientTaskState } from './image-batch-client.ts'
import { parseImageOutputReceipt } from './image-gallery-contract.ts'
import css from './image-batch-progress.module.css'

interface UseSessions {
  <T>(selector: (snapshot: SessionListState) => T, equal?: (left: T, right: T) => boolean): T
}

interface ImageBatchProgressProps {
  readonly batches: readonly ImageBatchClientBatch[]
  readonly useSessions: UseSessions
  readonly loadImage: (attachment: ImageAttachmentRef, ownerSessionId?: string) => Promise<string>
}

interface ExactPreview {
  readonly attachment: ImageAttachmentRef
  readonly ownerSessionId: string
}

const stateLabels: Readonly<Record<ImageBatchClientTaskState, string>> = {
  queued: '排队中',
  running: '正在生成',
  'needs-review': '待确认',
  completed: '已完成',
  failed: '生成失败',
  cancelled: '已取消',
  unknown: '结果未知',
  interrupted: '未开始',
}

const imageLabels = {
  image: '图像',
  open: '查看原图',
  openNamed: (label: string) => '查看原图：' + label,
  loading: '正在加载图像…',
  loadFailed: '图像加载失败，点击重试',
  lightbox: { dialog: '原图预览', close: '关闭原图预览' },
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactPreview(sessions: SessionListState, task: ImageBatchClientTask): ExactPreview | undefined {
  const childSessionId = task.childSessionId
  const pointer = task.receipt
  if (childSessionId === undefined || pointer === undefined || pointer.ownerSessionId !== childSessionId
    || (pointer.status !== 'completed' && pointer.status !== 'needs-review')) return undefined
  const values = sessions.byId[childSessionId]?.projectionValues as Readonly<Record<string, unknown>> | undefined
  const rows = values?.eMateImageReceipts
  if (!Array.isArray(rows)) return undefined
  for (const row of rows) {
    if (!record(row) || row.seq !== pointer.eventSeq || !record(row.receipt)) continue
    const receipt = row.receipt
    if (receipt.parent_session_id !== childSessionId || receipt.child_session_id !== undefined
      || receipt.call_id !== pointer.callId || receipt.revision !== pointer.revision || receipt.status !== pointer.status) continue
    const item = parseImageOutputReceipt(receipt)
    if (item?.attachment === undefined) return undefined
    return { attachment: item.attachment, ownerSessionId: childSessionId }
  }
  return undefined
}

function samePreview(left: ExactPreview | undefined, right: ExactPreview | undefined): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined || left.ownerSessionId !== right.ownerSessionId) return false
  const a = left.attachment; const b = right.attachment
  return a.attachmentId === b.attachmentId && a.mediaType === b.mediaType && a.bytes === b.bytes
    && a.width === b.width && a.height === b.height && a.name === b.name
}

const ImageBatchTaskCard = memo(function ImageBatchTaskCard({ task, useSessions, loadImage }: {
  readonly task: ImageBatchClientTask
  readonly useSessions: UseSessions
  readonly loadImage: ImageBatchProgressProps['loadImage']
}) {
  const preview = useSessions(sessions => exactPreview(sessions, task), samePreview)
  const label = '第 ' + task.ordinal + ' 张图片：' + stateLabels[task.state]
  return <article className={css.card} data-task-id={task.taskId} data-state={task.state} aria-label={label}>
    <div className={css.preview}>
      {preview === undefined
        ? <div className={css.placeholder} aria-hidden="true"><span /></div>
        : <MessageImage
            attachment={preview.attachment}
            load={attachment => loadImage(attachment, preview.ownerSessionId)}
            variant="tile"
            labels={imageLabels}
          />}
    </div>
    <div className={css.meta}>
      <strong>图片 {task.ordinal}</strong>
      <span>{stateLabels[task.state]}</span>
    </div>
  </article>
})

/**
 * Render batches owned by exact image_batch calls in one parent Turn.
 * @param props - exact parent batches, native child Session hook, and Attachment image loader.
 * @returns the live batch cards, or null until an exact parent batch is projected.
 */
export function ImageBatchProgress({ batches, useSessions, loadImage }: ImageBatchProgressProps) {
  if (batches.length === 0) return null
  return <div className={css.root} aria-live="polite" aria-label="图片批次进度">
    {batches.map(batch => <section
      key={batch.batchId}
      className={css.batch}
      aria-label={'图片批次，共 ' + batch.tasks.length + ' 张'}
      aria-busy={!batch.terminal}
      data-batch-id={batch.batchId}
    >
      <div className={css.grid} role="list">
        {batch.tasks.map(task => <div key={task.taskId} role="listitem">
          <ImageBatchTaskCard task={task} useSessions={useSessions} loadImage={loadImage} />
        </div>)}
      </div>
    </section>)}
  </div>
}
