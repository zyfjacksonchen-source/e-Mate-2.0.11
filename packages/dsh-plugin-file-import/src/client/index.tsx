import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { IconPaperclipOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  ALLOWED_MEDIA_BY_EXTENSION,
  allowedMediaType,
  appendImportedMentions,
  CHANNEL,
  COMPOSER_DROP_TARGET,
  fileBadge,
  fileDropRoute,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  WORKSPACE_DROP_TARGET,
  type ImportedFile,
} from '../contract.ts'
import { normalizedImage } from './image.ts'
import css from './style.module.css'

export const inject = ['slots', 'connection', 'inputTriggers']
export const FILE_PICK_EVENT = 'e-mate:file-picker-requested'

const IMAGE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const IMAGE_MEDIA_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}

type RpcResult = { ok: boolean; value?: unknown; error?: { message?: string } }
type ImportPhase = 'importing' | 'ready' | 'error'
interface ImportRow {
  readonly id: string
  readonly displayName: string
  readonly mediaType: string
  readonly phase: ImportPhase
  readonly message?: string
  readonly relativePath?: string
}

interface FileImportProps {
  readonly sessionId: string
  readonly input: { readonly draft: string; readonly phase: string }
  readonly inputActions: { setDraft(text: string): void }
  readonly isLoopback: boolean
  readonly callImport: (payload: Record<string, unknown>) => Promise<RpcResult>
}

function imageType(file: File): string | undefined {
  if (IMAGE_MEDIA.has(file.type)) return file.type
  if (file.type !== '') return undefined
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  return IMAGE_MEDIA_BY_EXTENSION[extension]
}

function dropImages(files: readonly File[]): void {
  const transfer = new DataTransfer()
  for (const file of files) transfer.items.add(file)
  document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
}

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function importedFiles(value: unknown): ImportedFile[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('文件导入响应无效。')
  const body = value as Record<string, unknown>
  if (body.schema_version !== 1 || !Array.isArray(body.files)) throw new Error('文件导入响应无效。')
  return body.files.map((entry): ImportedFile => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('文件导入响应无效。')
    const file = entry as Record<string, unknown>
    if (!Number.isSafeInteger(file.bytes) || typeof file.display_name !== 'string'
      || typeof file.media_type !== 'string' || typeof file.relative_path !== 'string'
      || !/^\.e-mate\/imports\/[^/@\s]+$/u.test(file.relative_path)
      || typeof file.stored_name !== 'string' || file.relative_path !== `.e-mate/imports/${file.stored_name}`) {
      throw new Error('文件导入响应无效。')
    }
    return file as unknown as ImportedFile
  })
}

function errorRows(files: readonly File[], message: string): ImportRow[] {
  return files.map(file => ({
    id: crypto.randomUUID(), displayName: file.name || '未命名文件', mediaType: file.type, phase: 'error', message,
  }))
}

export function FileImportControl({ sessionId, input, inputActions, isLoopback, callImport }: FileImportProps) {
  const picker = useRef<HTMLInputElement>(null)
  const owner = useRef(sessionId)
  owner.current = sessionId
  const draft = useRef(input.draft)
  draft.current = input.draft
  const [rows, setRows] = useState<ImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const disabled = busy || input.phase === 'adjudicating' || input.phase === 'submitting' || !isLoopback

  const importFiles = useCallback(async (files: readonly File[]) => {
    const requestSession = sessionId
    if (files.length === 0) return
    if (!isLoopback) {
      setRows(current => [...current, ...errorRows(files, '本地文件导入仅支持当前电脑上的 e-Mate。')])
      return
    }
    const accepted: File[] = []
    const rejected: File[] = []
    for (const file of files) (allowedMediaType(file.name) === undefined ? rejected : accepted).push(file)
    if (rejected.length > 0) {
      setRows(current => [...current, ...errorRows(rejected, '仅支持办公文档、PDF、文本、结构化数据和常见归档。')])
    }
    const total = accepted.reduce((sum, file) => sum + file.size, 0)
    if (accepted.length === 0) return
    if (accepted.length > MAX_FILES || accepted.some(file => file.size > MAX_FILE_BYTES) || total > MAX_TOTAL_BYTES) {
      setRows(current => [...current, ...errorRows(accepted, '单次最多 8 个文件；单文件 16 MiB，总计 32 MiB。')])
      return
    }

    const pending = accepted.map(file => ({
      id: crypto.randomUUID(), displayName: file.name, mediaType: allowedMediaType(file.name) as string, phase: 'importing' as const,
    }))
    setRows(current => [...current, ...pending])
    setBusy(true)
    try {
      const encoded = await Promise.all(accepted.map(async file => ({
        name: file.name,
        media_type: allowedMediaType(file.name),
        bytes_base64: await base64Of(file),
      })))
      if (owner.current !== requestSession) return
      const result = await callImport({ session_id: sessionId, files: encoded })
      if (owner.current !== requestSession) return
      if (!result.ok) throw new Error(result.error?.message ?? '文件导入失败。')
      const imported = importedFiles(result.value)
      if (imported.length !== pending.length) throw new Error('文件导入响应数量不一致。')
      inputActions.setDraft(appendImportedMentions(draft.current, imported))
      setRows(current => current.map(row => {
        const index = pending.findIndex(item => item.id === row.id)
        const file = index < 0 ? undefined : imported[index]
        return file === undefined ? row : {
          ...row, phase: 'ready', displayName: file.display_name, mediaType: file.media_type, relativePath: file.relative_path,
        }
      }))
    } catch (error) {
      if (owner.current !== requestSession) return
      const message = error instanceof Error ? error.message : '文件导入失败。'
      setRows(current => current.map(row => pending.some(item => item.id === row.id) ? { ...row, phase: 'error', message } : row))
    } finally {
      if (owner.current === requestSession) setBusy(false)
    }
  }, [callImport, inputActions, isLoopback, sessionId])

  useEffect(() => {
    setRows([])
    setBusy(false)
  }, [sessionId])

  const intake = useCallback(async (files: readonly File[]) => {
    const requestSession = sessionId
    const images: File[] = []
    const ordinary: File[] = []
    for (const file of files) {
      const mediaType = imageType(file)
      if (mediaType === undefined) ordinary.push(file)
      else images.push(await normalizedImage(file, mediaType))
    }
    if (owner.current !== requestSession) return
    if (images.length > 0) dropImages(images)
    if (ordinary.length > 0) void importFiles(ordinary)
  }, [importFiles, sessionId])

  useEffect(() => {
    const onDrop = (event: DragEvent): void => {
      const items = Array.from(event.dataTransfer?.items ?? [])
      const directory = items.some(item => (item as DataTransferItem & { webkitGetAsEntry?(): { isDirectory: boolean } | null }).webkitGetAsEntry?.()?.isDirectory)
      const files = Array.from(event.dataTransfer?.files ?? [])
      const normalizeImage = files.some(file => imageType(file) !== undefined && file.type === '')
      const ordinary = files.some(file => imageType(file) === undefined)
      const target = event.target instanceof Element ? event.target : undefined
      const route = fileDropRoute({
        composerTarget: target !== undefined && target.closest(COMPOSER_DROP_TARGET) !== null,
        directory,
        normalizeImage,
        ordinary,
        workspaceTarget: target !== undefined && target.closest(WORKSPACE_DROP_TARGET) !== null,
      })
      if (route === 'pass') return
      event.preventDefault()
      event.stopImmediatePropagation()
      // This capture listener owns the drop, so finish the native image drag
      // state that would otherwise be cleared by its blocked bubble listener.
      window.dispatchEvent(new Event('dragend'))
      const routedFiles = route === 'intake-all' ? files : files.filter(file => imageType(file) !== undefined)
      if (routedFiles.length > 0) queueMicrotask(() => { void intake(routedFiles) })
    }
    const onPaste = (event: ClipboardEvent): void => {
      if (!(event.target instanceof HTMLTextAreaElement) || event.clipboardData === null) return
      const files = Array.from(event.clipboardData.items)
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null)
      const fallback = files.length > 0 ? files : Array.from(event.clipboardData.files)
      const normalizeImage = fallback.some(file => imageType(file) !== undefined && file.type === '')
      const ordinary = fallback.some(file => imageType(file) === undefined)
      if (!ordinary && !normalizeImage) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void intake(fallback)
    }
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('paste', onPaste, true)
    return () => {
      document.removeEventListener('drop', onDrop, true)
      document.removeEventListener('paste', onPaste, true)
    }
  }, [intake])

  useEffect(() => {
    const open = (event: Event): void => {
      if (!(event instanceof CustomEvent) || event.detail?.sessionId !== sessionId || disabled) return
      picker.current?.click()
    }
    document.addEventListener(FILE_PICK_EVENT, open)
    return () => { document.removeEventListener(FILE_PICK_EVENT, open) }
  }, [disabled, sessionId])

  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    void intake(files)
  }

  return <span className={css.root}>
    <button
      type="button"
      className={css.button}
      aria-label="添加本地图片或文件"
      title={isLoopback ? '添加本地图片或文件' : '本地文件导入仅支持当前电脑'}
      disabled={disabled}
      onClick={() => { picker.current?.click() }}
    ><IconPaperclipOutline16 size={16} /></button>
    <input
      ref={picker}
      hidden
      type="file"
      multiple
      accept={`${[...IMAGE_MEDIA].join(',')},${Object.keys(ALLOWED_MEDIA_BY_EXTENSION).map(extension => `.${extension}`).join(',')}`}
      onChange={choose}
    />
    {rows.length > 0 && <span className={css.rows} role="status" aria-live="polite">
      {rows.map(row => <span
        key={row.id}
        className={css.row}
        data-phase={row.phase}
        data-emate-resource-path={row.phase === 'ready' ? row.relativePath : undefined}
      >
        <span className={css.badge} aria-hidden="true">{fileBadge(row.displayName, row.mediaType)}</span>
        <span className={css.name} title={row.displayName}>{row.displayName}</span>
        <span className={css.phase}>{row.phase === 'importing' ? '导入中…' : row.phase === 'ready' ? '已就绪' : row.message}</span>
        {row.phase === 'error' && <button type="button" className={css.dismiss} aria-label={`关闭 ${row.displayName} 的错误`} onClick={() => {
          setRows(current => current.filter(item => item.id !== row.id))
        }}>×</button>}
      </span>)}
    </span>}
  </span>
}

export function apply(ctx: Context): void {
  const source: InputTriggerSource = {
    trigger: '@',
    name: '文件',
    order: -30,
    candidates(_session, { query }) {
      return Promise.resolve('文件'.includes(query) ? [{ name: '文件', description: '选择本地图片或文件' }] : [])
    },
    onPick({ session }) {
      document.dispatchEvent(new CustomEvent(FILE_PICK_EVENT, { detail: { sessionId: session.sessionId } }))
      return 'handled'
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'file-import: @文件 source')
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'e-mate-file-import',
    order: 10,
    inject: () => ({
      isLoopback: ctx.connection.isLoopback,
      callImport: (payload: Record<string, unknown>) => ctx.connection.rpc.call(CHANNEL, 'import', payload),
    }),
  }, FileImportControl))
}
