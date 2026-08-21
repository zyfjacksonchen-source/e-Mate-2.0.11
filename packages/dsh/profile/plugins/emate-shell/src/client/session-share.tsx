import {
  IconDownloadOutline16,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './session-share.module.css'

interface Props {
  sessionId: string
  useSessionLogDownload: <T>(selector: (state: SessionLogDownloadState) => T) => T
  requestDownload: (sessionId: string) => Promise<void>
  dismissDownload: (sessionId: string) => void
}

interface SessionLogDownloadEntry {
  readonly open: boolean
  readonly status: 'downloading' | 'success' | 'error'
  readonly error: string | null
}

interface SessionLogDownloadState {
  readonly bySession: Record<string, SessionLogDownloadEntry | undefined>
}

export function SessionShareAction({
  sessionId, useSessionLogDownload, requestDownload, dismissDownload,
}: Props) {
  const download = useSessionLogDownload(state => state.bySession[sessionId])
  const downloading = download?.status === 'downloading'

  return <>
    <button
      type="button"
      className={css.trigger}
      disabled={downloading}
      aria-busy={downloading}
      aria-label="导出当前任务"
      title="导出当前任务"
      onClick={() => { void requestDownload(sessionId) }}
    >
      <IconDownloadOutline16 size={16} />
    </button>
    <Modal
      open={download?.open === true}
      onClose={() => { dismissDownload(sessionId) }}
      title="导出任务"
      closeLabel="关闭导出"
      description="将当前任务、子任务和附件保存为本地 ZIP。"
      className={css.dialog}
    >
      <section className={css.archive} aria-labelledby="session-archive-title">
        <div>
          <strong id="session-archive-title">下载会话归档</strong>
          <span>保存当前任务、子任务和附件的本地 ZIP。</span>
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
    </Modal>
  </>
}
