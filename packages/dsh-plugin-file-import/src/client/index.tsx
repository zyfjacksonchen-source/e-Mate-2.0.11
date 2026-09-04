import { createElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ComponentType, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { IconPaperclipOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  ALLOWED_MEDIA_BY_EXTENSION, allowedMediaType, CHANNEL, COMPOSER_DROP_TARGET, fileBadge, fileDropRoute,
  MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, WORKSPACE_DROP_TARGET,
} from '../contract.ts'
import { normalizedImage } from './image.ts'
import { importedDraft, importedMessage, type FileReference } from './references.ts'
import { parseImportResult, safeThrownImportMessage } from './result.ts'
import css from './style.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'e-mate.conversation.composer': { kind: 'single'; scope: 'session-maybe'; owner: { nativeProps: any; InputBar: ComponentType<any> } }
  }
}

export const inject = ['slots', 'connection', 'inputTriggers', 'conversation', 'sessions']
export const FILE_PICK_EVENT = 'e-mate:file-picker-requested'

const IMAGE_MEDIA = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const IMAGE_MEDIA_BY_EXTENSION: Readonly<Record<string, string>> = {
  gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}
interface ImportRow {
  readonly id: string
  readonly displayName: string
  readonly mediaType: string
  readonly phase: 'importing' | 'error'
  readonly message?: string
}
interface FileInputActions {
  addFiles(files: readonly FileReference[], draft?: string): boolean
  removeFile(path: string): void
}
interface FileImportProps {
  readonly sessionId: string | undefined
  readonly input: { readonly draft: string; readonly phase: string; readonly fileRefs: readonly FileReference[] }
  readonly inputActions: FileInputActions
  readonly isLoopback: boolean
  readonly callImport: (payload: Record<string, unknown>) => Promise<unknown>
  readonly addImages: (files: readonly File[]) => string | null
  readonly renderComposer: (parts: { accessory: ReactNode; controls: ReactNode; pending: boolean }) => ReactNode
}
const EMPTY_INPUT = { draft: '', phase: 'plain', fileRefs: [] }
const ABSENT_ACTIONS: FileInputActions = { addFiles: () => false, removeFile() {} }

function imageType(file: File): string | undefined {
  if (IMAGE_MEDIA.has(file.type)) return file.type
  if (file.type !== '') return undefined
  return IMAGE_MEDIA_BY_EXTENSION[file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()]
}

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

function errorRows(files: readonly File[], message: string): ImportRow[] {
  return files.map(file => ({ id: crypto.randomUUID(), displayName: file.name || '未命名文件', mediaType: file.type, phase: 'error', message }))
}

export function FileCards({ files, remove, open }: {
  files: readonly FileReference[]
  remove?: (path: string) => void
  open?: (path: string) => void
}) {
  return <>{files.map(file => <div key={file.relative_path} className={css.row} data-emate-resource-path={file.relative_path}>
    <button type="button" className={css.file} disabled={open === undefined} title={file.display_name}
      aria-label={`打开 ${file.display_name}`} onClick={() => { open?.(file.relative_path) }}>
      <span className={css.badge} aria-hidden="true">{fileBadge(file.display_name, file.media_type)}</span>
      <span className={css.name}>{file.display_name}</span>
    </button>
    {remove !== undefined && <button type="button" className={css.dismiss} aria-label={`移除 ${file.display_name}`}
      onClick={() => { remove(file.relative_path) }}>×</button>}
  </div>)}</>
}

export function FileImportControl({ sessionId, input, inputActions, isLoopback, callImport, addImages, renderComposer }: FileImportProps) {
  const picker = useRef<HTMLInputElement>(null)
  const owner = useRef<string | undefined>(sessionId)
  const generation = useRef(0)
  const migrate = useRef(true)
  const dismissed = useRef(new Set<string>())
  const intakeBusy = useRef(false)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [busy, setBusy] = useState(false)
  const disabled = busy || sessionId === undefined || input.phase === 'adjudicating' || input.phase === 'submitting' || !isLoopback
  useLayoutEffect(() => {
    owner.current = sessionId
    generation.current += 1
    migrate.current = true
    setRows([])
    intakeBusy.current = false
    setBusy(false)
    return () => { owner.current = undefined }
  }, [sessionId])

  useLayoutEffect(() => {
    if (!migrate.current || (input.draft === '' && input.fileRefs.length === 0)) return
    const legacy = importedDraft(input.draft)
    if (legacy.files.length > 0) {
      try { if (inputActions.addFiles(legacy.files, legacy.text)) migrate.current = false }
      catch {
        migrate.current = false
        setRows([{ id: 'restore-error', displayName: '附件草稿', mediaType: '', phase: 'error', message: '附件草稿无法恢复，请重新选择文件。' }])
      }
    } else migrate.current = false
  }, [input.draft, input.fileRefs, input.phase, inputActions])

  const importFiles = useCallback(async (files: readonly File[]) => {
    const requestSession = sessionId
    const requestGeneration = generation.current
    const current = () => owner.current === requestSession && generation.current === requestGeneration
    if (files.length === 0) return
    if (!isLoopback || sessionId === undefined) {
      setRows(current => [...current, ...errorRows(files, '本地文件导入仅支持当前电脑上的 e-Mate。')])
      return
    }
    const accepted: File[] = []
    const rejected: File[] = []
    for (const file of files) (allowedMediaType(file.name) === undefined ? rejected : accepted).push(file)
    if (rejected.length > 0) setRows(current => [...current, ...errorRows(rejected, '仅支持办公文档、PDF、文本、结构化数据和常见归档。')])
    if (accepted.length === 0) return
    if (accepted.length > MAX_FILES || accepted.some(file => file.size > MAX_FILE_BYTES)
      || accepted.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) {
      setRows(current => [...current, ...errorRows(accepted, '单次最多 8 个文件；单文件 16 MiB，总计 32 MiB。')])
      return
    }
    const pending = accepted.map(file => ({
      id: crypto.randomUUID(), displayName: file.name, mediaType: allowedMediaType(file.name) as string, phase: 'importing' as const,
    }))
    setRows(current => [...current, ...pending])
    try {
      const encoded = await Promise.all(accepted.map(async file => ({ name: file.name, media_type: allowedMediaType(file.name), bytes_base64: await base64Of(file) })))
      if (!current()) return
      const result = parseImportResult(await callImport({ session_id: sessionId, files: encoded }))
      if (!current()) return
      if (!result.ok) {
        setRows(current => current.map(row => pending.some(item => item.id === row.id) ? { ...row, phase: 'error', message: result.message } : row))
        return
      }
      if (result.files.length !== pending.length) throw new Error('response count mismatch')
      const files = result.files.filter((_file, index) => !dismissed.current.has(pending[index]!.id))
      if (!inputActions.addFiles(files)) {
        setRows(current => current.map(row => pending.some(item => item.id === row.id)
          ? { ...row, phase: 'error', message: '当前正在发送消息，文件未加入草稿，请重试。' } : row))
        return
      }
      setRows(current => current.filter(row => !pending.some(item => item.id === row.id)))
    } catch (error) {
      if (!current()) return
      setRows(current => current.map(row => pending.some(item => item.id === row.id)
        ? { ...row, phase: 'error', message: safeThrownImportMessage(error) } : row))
    } finally {
      for (const item of pending) dismissed.current.delete(item.id)
    }
  }, [callImport, inputActions, isLoopback, sessionId])

  const intake = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) return
    if (intakeBusy.current) {
      setRows(current => [...current, ...errorRows(files, '附件正在导入，请稍后重试。')])
      return
    }
    intakeBusy.current = true
    const requestSession = sessionId
    const requestGeneration = generation.current
    const current = () => owner.current === requestSession && generation.current === requestGeneration
    setBusy(true)
    const images: File[] = []
    const ordinary: File[] = []
    for (const file of files) {
      const mediaType = imageType(file)
      if (mediaType === undefined) ordinary.push(file)
      else try { images.push(await normalizedImage(file, mediaType)) }
      catch {
        if (current()) setRows(current => [...current, ...errorRows([file], '图片读取失败，请重新选择。')])
      }
    }
    if (!current()) return
    try {
      if (images.length > 0) {
        const message = addImages(images)
        if (message !== null) setRows(current => [...current, ...errorRows(images, message)])
      }
      if (ordinary.length > 0) await importFiles(ordinary)
    } finally { if (current()) { intakeBusy.current = false; setBusy(false) } }
  }, [addImages, importFiles, sessionId])

  useEffect(() => {
    const onDrop = (event: DragEvent): void => {
      const items = Array.from(event.dataTransfer?.items ?? [])
      const directory = items.some(item => (item as DataTransferItem & { webkitGetAsEntry?(): { isDirectory: boolean } | null }).webkitGetAsEntry?.()?.isDirectory)
      const files = Array.from(event.dataTransfer?.files ?? [])
      const target = event.target instanceof Element ? event.target : undefined
      const route = fileDropRoute({
        composerTarget: target !== undefined && target.closest(COMPOSER_DROP_TARGET) !== null,
        directory, normalizeImage: files.some(file => imageType(file) !== undefined && file.type === ''),
        ordinary: files.some(file => imageType(file) === undefined),
        workspaceTarget: target !== undefined && target.closest(WORKSPACE_DROP_TARGET) !== null,
      })
      if (route === 'pass') return
      event.preventDefault()
      event.stopImmediatePropagation()
      window.dispatchEvent(new Event('dragend'))
      const routed = route === 'intake-all' ? files : files.filter(file => imageType(file) !== undefined)
      if (routed.length > 0) void intake(routed)
    }
    const onPaste = (event: ClipboardEvent): void => {
      if (!(event.target instanceof HTMLTextAreaElement) || event.clipboardData === null) return
      const files = Array.from(event.clipboardData.items).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null)
      const fallback = files.length > 0 ? files : Array.from(event.clipboardData.files)
      if (!fallback.some(file => imageType(file) === undefined || file.type === '')) return
      event.preventDefault()
      event.stopImmediatePropagation()
      void intake(fallback)
    }
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('paste', onPaste, true)
    return () => { document.removeEventListener('drop', onDrop, true); document.removeEventListener('paste', onPaste, true) }
  }, [intake])

  useEffect(() => {
    const open = (event: Event): void => {
      if (event instanceof CustomEvent && event.detail?.sessionId === sessionId && !disabled) picker.current?.click()
    }
    document.addEventListener(FILE_PICK_EVENT, open)
    return () => { document.removeEventListener(FILE_PICK_EVENT, open) }
  }, [disabled, sessionId])

  const choose = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    void intake(files)
  }
  return renderComposer({
    pending: busy,
    controls: <>
      <button type="button" className={css.button} aria-label="添加本地图片或文件"
        title={isLoopback ? '添加本地图片或文件' : '本地文件导入仅支持当前电脑'} disabled={disabled}
        onClick={() => { picker.current?.click() }}><IconPaperclipOutline16 size={16} /></button>
      <input ref={picker} hidden type="file" multiple
        accept={`${[...IMAGE_MEDIA].join(',')},${Object.keys(ALLOWED_MEDIA_BY_EXTENSION).map(extension => `.${extension}`).join(',')}`} onChange={choose} />
    </>,
    accessory: input.fileRefs.length + rows.length === 0 ? null : <div className={css.rows} role="status" aria-live="polite" aria-label="附件">
      <FileCards files={input.fileRefs} remove={inputActions.removeFile} />
      {rows.map(row => <div key={row.id} className={css.row} data-phase={row.phase}>
        <span className={css.badge} aria-hidden="true">{fileBadge(row.displayName, row.mediaType)}</span>
        <span className={css.name} title={row.displayName}>{row.displayName}</span>
        <span className={css.phase} title={row.message}>{row.phase === 'importing' ? '导入中…' : row.message}</span>
        <button type="button" className={css.dismiss} aria-label={`移除 ${row.displayName}`} onClick={() => {
          dismissed.current.add(row.id)
          setRows(current => current.filter(item => item.id !== row.id))
        }}>×</button>
      </div>)}
    </div>,
  })
}

/** Native image admission, including refusals, without synthetic DOM drops. */
export function addNativeImages(ctx: any, sessionId: string, files: readonly File[]): string | null {
  let images: readonly any[] = []
  try {
    const scope = ctx.sessions.scope(sessionId)
    const target = ctx.sessions.binding(sessionId)?.session
    if (scope === undefined || target === undefined) return '当前会话不可用，图片未加入草稿。'
    const shell = ctx.conversation.input.for(scope)
    const input = shell.state.getSnapshot()
    const existing = ctx.conversation.draftImages(input.imageIds)
    const limits = target.projections.faceOf('imageLimits').getSnapshot()
    if (limits !== undefined) {
      if (files.some(file => !limits.mediaTypes.includes(file.type))) return '仅支持 PNG、JPEG、WebP 和 GIF 图片。'
      if (existing.length + files.length > limits.maxImagesPerMessage) return `最多可添加 ${limits.maxImagesPerMessage} 张图片。`
      if (files.some(file => file.size > limits.maxImageBytes)) return '图片超过单文件大小限制。'
      const bytes = existing.reduce((sum: number, image: any) => sum + image.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0)
      if (bytes > limits.maxMessageImageBytes) return '图片总大小超过当前消息限制。'
    }
    images = ctx.conversation.createDraftImages(files)
    if (shell.addImages(images.map(image => image.id))) return null
    ctx.conversation.releaseDraftImages(images)
    return '当前正在发送消息，图片未加入草稿，请稍后重试。'
  } catch {
    ctx.conversation.releaseDraftImages(images)
    return '图片无法加入草稿，请重试。'
  }
}

export function apply(ctx: Context): void {
  const source: InputTriggerSource = {
    trigger: '@', name: '文件', order: -30,
    candidates(_session, { query }) { return Promise.resolve('文件'.includes(query) ? [{ name: '文件', description: '选择本地图片或文件' }] : []) },
    onPick({ session, span }) {
      const scope = ctx.sessions.scope(session.sessionId)
      if (scope === undefined) return 'handled'
      if (!scope.bail(scope, 'slash/input-consume-token', { guard: { kind: 'span', span } })) {
        ctx.conversation.input.for(scope).notify('info', '输入已变化，请重新选择文件。')
        return 'handled'
      }
      document.dispatchEvent(new CustomEvent(FILE_PICK_EVENT, { detail: { sessionId: session.sessionId } }))
      return 'handled'
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'file-import: @文件 source')
  ctx.slots.inject('e-mate.conversation.composer', () => {
    return ctx.slots.register({ name: 'e-mate.conversation.composer' }, function FileImportComposer({ nativeProps: props, InputBar }: any) {
      const input = props.useInput((state: any) => state) ?? EMPTY_INPUT
      return <FileImportControl sessionId={props.sessionId} input={input} inputActions={props.inputActions ?? ABSENT_ACTIONS}
        isLoopback={ctx.connection.isLoopback}
        callImport={payload => ctx.connection.rpc.call(CHANNEL, 'import', payload)}
        addImages={files => props.sessionId === undefined ? '请先选择工作区。' : addNativeImages(ctx, props.sessionId, files)}
        renderComposer={({ accessory, controls, pending }) => createElement(InputBar, {
          ...props,
          blocked: props.blocked ?? (pending ? { reason: '附件正在导入，请稍候。' } : undefined),
          accessory: accessory === null ? props.accessory : props.accessory == null ? accessory : <>{props.accessory}{accessory}</>,
          leftItems: <>{props.leftItems}{controls}</>,
        })} />
    })
  })
  ctx.slots.inject('conversation.chat.node', () => {
    const disposers = (['user', 'steering'] as const).map(key => {
      const native = ctx.slots.entries('conversation.chat.node').find((entry: any) => entry.options?.key === key && (entry.options?.priority ?? 0) === 0)
      if (native?.component === undefined) throw new Error('native user message renderer is unavailable')
      return ctx.slots.register({ name: 'conversation.chat.node', key, priority: -1, inject: native.inject, locale: native.locale }, function FileMessage(props: any) {
        const projected = importedMessage(props.node.data.content, props.node.data.source)
        if (projected.files.length === 0) return createElement(native.component as any, props)
        return <div className={css.message}>
          <div className={css.rows}><FileCards files={projected.files} open={props.openFile} /></div>
          {createElement(native.component as any, { ...props, node: { ...props.node, data: { ...props.node.data, content: projected.content } } })}
        </div>
      })
    })
    return () => { for (const dispose of disposers) dispose() }
  })
}
