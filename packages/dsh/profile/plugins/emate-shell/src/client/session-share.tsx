import { useState } from 'react'
import {
  IconDownloadOutline16,
  IconShareOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './session-share.module.css'

interface RpcResult {
  ok: boolean
  value?: unknown
  error?: { message?: string }
}

interface Props {
  sessionId: string
  callShare: (endpoint: string, payload: Record<string, unknown>) => Promise<RpcResult>
  useSessionLogDownload: <T>(selector: (state: SessionLogDownloadState) => T) => T
  requestDownload: (sessionId: string) => Promise<void>
  dismissDownload: (sessionId: string) => void
}

interface ShareStatus {
  schema_version: 1
  ready: false
  blocker: string
}

interface SessionLogDownloadEntry {
  readonly open: boolean
  readonly status: 'downloading' | 'success' | 'error'
  readonly error: string | null
}

interface SessionLogDownloadState {
  readonly bySession: Record<string, SessionLogDownloadEntry | undefined>
}

function validUnavailable(value: unknown): value is ShareStatus {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const status = value as Partial<ShareStatus>
  return status.schema_version === 1
    && status.ready === false
    && typeof status.blocker === 'string'
    && status.blocker.length > 0
    && status.blocker.length <= 128
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : '公开分享插件暂不可用。'
}

export function SessionShareAction({
  sessionId, callShare, useSessionLogDownload, requestDownload, dismissDownload,
}: Props) {
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [reason, setReason] = useState('公开分享插件尚未接入经验证的企业分享服务。')
  const download = useSessionLogDownload(state => state.bySession[sessionId])
  const downloading = download?.status === 'downloading'

  const inspect = async () => {
    setOpen(true)
    setChecking(true)
    setReason('')
    try {
      const result = await callShare('status', {})
      if (!result.ok) throw new Error(result.error?.message ?? '公开分享插件拒绝了请求。')
      if (!validUnavailable(result.value)) throw new Error('公开分享插件返回了无效状态。')
      setReason('公开分享服务尚未配置，当前不能创建、复制或撤销公开链接。')
    } catch (error) {
      setReason(failureMessage(error))
    } finally {
      setChecking(false)
    }
  }

  return <>
    <button
      type="button"
      className={css.trigger}
      aria-label="分享当前任务"
      title="分享当前任务"
      onClick={() => { void inspect() }}
    >
      <IconShareOutline16 size={16} />
    </button>
    <Modal
      open={open || download?.open === true}
      onClose={() => {
        setOpen(false)
        dismissDownload(sessionId)
      }}
      title="分享任务"
      closeLabel="关闭分享"
      description="链接只包含创建时已有的内容；之后的新消息不会自动加入。"
      className={css.dialog}
    >
      <section className={css.unavailable} role="status" aria-busy={checking}>
        <IconShareOutline16 size={20} />
        <div>
          <strong>{checking ? '正在检查分享服务…' : '分享服务不可用'}</strong>
          {!checking && <span>{reason}</span>}
        </div>
      </section>
      <section className={css.archive} aria-labelledby="session-archive-title">
        <div>
          <strong id="session-archive-title">下载会话归档</strong>
          <span>保存当前任务、子任务和附件的本地 ZIP，不会生成公开链接。</span>
          {download?.status === 'success' && <small role="status">会话归档已开始下载。</small>}
          {download?.status === 'error' && <small role="alert">{download.error || '无法启动会话归档下载。'}</small>}
        </div>
        <button
          type="button"
          className={css.download}
          disabled={downloading}
          aria-busy={downloading}
          onClick={() => { void requestDownload(sessionId) }}
        >
          <IconDownloadOutline16 size={16} />
          {downloading ? '正在准备…' : '下载 ZIP'}
        </button>
      </section>
      <p className={css.boundary}>公开分享服务与本地归档相互独立；服务不可用时不会生成或冒充分享链接。</p>
    </Modal>
  </>
}
