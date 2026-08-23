import {
  IconCopyOutline16,
  IconDownloadOutline16,
  IconShareOutline16,
  IconTrashOutline16,
  Modal,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef, useState } from 'react'
import css from './session-share.module.css'

export interface SessionShareActionProps {
  sessionId: string | undefined
  callShare: (endpoint: string, payload: unknown) => Promise<unknown>
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

interface ShareLink {
  readonly share_id: string
  readonly public_url: string
  readonly expires_at: string
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function responseValue(result: unknown): unknown {
  const envelope = record(result)
  if (envelope?.ok !== true) {
    const error = record(envelope?.error)
    throw new Error(typeof error?.message === 'string' ? error.message : '在线分享请求失败。')
  }
  return envelope.value
}

function shareValue(value: unknown): ShareLink {
  const item = record(value)
  if (typeof item?.share_id !== 'string' || typeof item.public_url !== 'string'
    || typeof item.expires_at !== 'string' || !/^[A-Za-z0-9_-]{32}$/u.test(item.share_id)
    || !Number.isFinite(Date.parse(item.expires_at)) || Date.parse(item.expires_at) <= Date.now()) {
    throw new Error('分享服务返回了无效链接。')
  }
  const url = new URL(item.public_url)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.pathname !== `/s/${item.share_id}` || url.search !== '' || url.hash !== '') {
    throw new Error('分享服务返回了无效链接。')
  }
  return {
    share_id: item.share_id,
    public_url: url.toString(),
    expires_at: item.expires_at,
  }
}

function shareLink(result: unknown): ShareLink {
  const value = record(responseValue(result))
  if (value?.schema_version !== 1) throw new Error('分享服务返回了无效链接。')
  return shareValue(value)
}

function shareLinks(result: unknown): ShareLink[] {
  const value = record(responseValue(result))
  if (value?.schema_version !== 1 || !Array.isArray(value.shares) || value.shares.length > 50) {
    throw new Error('分享服务返回了无效链接列表。')
  }
  const shares = value.shares.map(shareValue)
  if (new Set(shares.map(share => share.share_id)).size !== shares.length) {
    throw new Error('分享服务返回了无效链接列表。')
  }
  return shares
}

export function SessionShareAction({
  sessionId, callShare, useSessionLogDownload, requestDownload, dismissDownload,
}: SessionShareActionProps) {
  const download = useSessionLogDownload(state => sessionId === undefined ? undefined : state.bySession[sessionId])
  const downloading = download?.status === 'downloading'
  const currentSession = useRef(sessionId)
  const operation = useRef(0)
  const [open, setOpen] = useState(false)
  const [shares, setShares] = useState<ShareLink[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    operation.current += 1
    currentSession.current = sessionId
    setOpen(false)
    setShares([])
    setBusy(null)
    setError('')
    setNotice('')
  }, [sessionId])

  const refresh = async (requestedSession: string) => {
    const currentOperation = ++operation.current
    setBusy('list')
    setError('')
    setNotice('')
    try {
      const listed = shareLinks(await callShare('list', { session_id: requestedSession }))
      if (operation.current !== currentOperation || currentSession.current !== requestedSession) return
      setShares(listed)
    } catch (failure) {
      if (operation.current === currentOperation && currentSession.current === requestedSession) {
        setError(failure instanceof Error ? failure.message : '无法读取在线分享，请稍后重试。')
      }
    } finally {
      if (operation.current === currentOperation && currentSession.current === requestedSession) setBusy(null)
    }
  }

  const create = async () => {
    if (busy !== null || sessionId === undefined) return
    const requestedSession = sessionId
    const currentOperation = ++operation.current
    setBusy('create')
    setError('')
    setNotice('')
    try {
      const created = shareLink(await callShare('create', { session_id: requestedSession }))
      if (operation.current !== currentOperation || currentSession.current !== requestedSession) return
      setShares([created])
      setNotice('公开链接已创建。')
    } catch (failure) {
      if (operation.current !== currentOperation || currentSession.current !== requestedSession) return
      const message = failure instanceof Error ? failure.message : '在线分享请求失败。'
      try {
        const recovered = shareLinks(await callShare('list', { session_id: requestedSession }))
        if (operation.current !== currentOperation || currentSession.current !== requestedSession) return
        setShares(recovered)
        if (recovered.length > 0) setNotice('已从服务恢复公开链接。')
        else setError(message)
      } catch {
        if (operation.current === currentOperation && currentSession.current === requestedSession) setError(message)
      }
    } finally {
      if (operation.current === currentOperation && currentSession.current === requestedSession) setBusy(null)
    }
  }

  const copy = async (share: ShareLink) => {
    setError('')
    setNotice(await writeClipboard(share.public_url) ? '链接已复制。' : '无法写入剪贴板，请手动复制链接。')
  }

  const revoke = async (share: ShareLink) => {
    if (busy !== null || sessionId === undefined) return
    const requestedSession = sessionId
    const currentOperation = ++operation.current
    setBusy(`revoke:${share.share_id}`)
    setError('')
    setNotice('')
    try {
      const value = record(responseValue(await callShare('revoke', { share_id: share.share_id })))
      if (value?.schema_version !== 1 || value.revoked !== true) throw new Error('分享服务返回了无效撤销结果。')
      if (operation.current !== currentOperation || currentSession.current !== requestedSession) return
      setShares(current => current.filter(item => item.share_id !== share.share_id))
      setNotice('公开链接已撤销。')
    } catch (failure) {
      if (operation.current === currentOperation && currentSession.current === requestedSession) {
        setError(failure instanceof Error ? failure.message : '无法撤销在线分享。')
      }
    } finally {
      if (operation.current === currentOperation && currentSession.current === requestedSession) setBusy(null)
    }
  }

  return <>
    <button
      type="button"
      className={css.trigger}
      aria-label="分享当前任务"
      title={sessionId === undefined ? '开始任务后可分享' : '分享当前任务'}
      disabled={sessionId === undefined}
      onClick={() => {
        if (sessionId === undefined) return
        setOpen(true)
        setShares([])
        void refresh(sessionId)
      }}
    >
      <IconShareOutline16 size={16} />
    </button>
    <Modal
      open={open}
      onClose={() => {
        operation.current += 1
        setOpen(false)
        setBusy(null)
      }}
      title="分享任务"
      closeLabel="关闭分享"
      description="创建公开链接后，任何拿到链接的人都可以下载当前任务、子任务和附件归档。"
      className={css.dialog}
    >
      <section className={css.online} aria-labelledby="session-share-title">
        <div>
          <strong id="session-share-title">在线公开链接</strong>
          <span>{busy === 'list'
            ? '正在读取当前任务的公开链接…'
            : shares.length === 0
              ? '链接默认保留 7 天，可随时撤销。'
              : `已找回 ${shares.length} 个可管理链接。`}</span>
          {error !== '' && <small role="alert">{error}</small>}
          {notice !== '' && <small role="status">{notice}</small>}
        </div>
        {shares.map((share, index) => <article className={css.shareRow} key={share.share_id}>
          <div>
            <a href={share.public_url} target="_blank" rel="noreferrer">{share.public_url}</a>
            <small>有效期至 {new Intl.DateTimeFormat('zh-CN', {
              dateStyle: 'medium', timeStyle: 'short',
            }).format(new Date(share.expires_at))}</small>
          </div>
          <div className={css.actions}>
            <button
              type="button"
              className={css.secondary}
              aria-label={`复制链接 ${index + 1}`}
              onClick={() => { void copy(share) }}
            >
              <IconCopyOutline16 size={16} />复制链接
            </button>
            <button
              type="button"
              className={css.danger}
              aria-label={`撤销链接 ${index + 1}`}
              disabled={busy !== null}
              aria-busy={busy === `revoke:${share.share_id}`}
              onClick={() => { void revoke(share) }}
            >
              <IconTrashOutline16 size={16} />
              {busy === `revoke:${share.share_id}` ? '正在撤销…' : '撤销链接'}
            </button>
          </div>
        </article>)}
        {shares.length === 0 && busy !== 'list' && <button
            type="button"
            className={css.primary}
            disabled={busy !== null}
            aria-busy={busy === 'create'}
            onClick={() => { void create() }}
          >
            <IconShareOutline16 size={16} />
            {busy === 'create' ? '正在创建…' : '创建公开链接'}
          </button>}
      </section>
      <section className={css.archive} aria-labelledby="session-archive-backup-title">
        <div>
          <strong id="session-archive-backup-title">本地备用归档</strong>
          <span>仅保存到本机，不会创建公开链接。</span>
        </div>
        <button
          type="button"
          className={css.secondary}
          disabled={downloading}
          aria-busy={downloading}
          onClick={() => {
            if (sessionId === undefined) return
            setOpen(false)
            void requestDownload(sessionId)
          }}
        >
          <IconDownloadOutline16 size={16} />
          {downloading ? '正在准备…' : '导出 ZIP'}
        </button>
      </section>
    </Modal>
    <Modal
      open={download?.open === true}
      onClose={() => { if (sessionId !== undefined) dismissDownload(sessionId) }}
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
          className={css.primary}
          disabled={downloading}
          aria-busy={downloading}
          onClick={() => { if (sessionId !== undefined) void requestDownload(sessionId) }}
        >
          <IconDownloadOutline16 size={16} />
          {downloading ? '正在准备…' : '下载 ZIP'}
        </button>
      </section>
    </Modal>
  </>
}

/** The root application tool group owns sharing; suppress only DSH's old header export button. */
export function HiddenSessionLogExport() { return null }
