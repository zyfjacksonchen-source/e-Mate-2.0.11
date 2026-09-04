import {
  allowedMediaType, IMAGE_MEDIA_TYPES, MAX_FILE_BYTES, MAX_FILES, MAX_IMAGE_BYTES, MAX_IMAGES, MAX_IMAGE_TOTAL_BYTES,
  normalizedSafeFileName, type ImageAttachmentRef, type ImportedFile,
} from '../contract.ts'

export const SAFE_IMPORT_ERROR_MESSAGE = '文件暂时无法导入当前工作区。'

const VALIDATION_MESSAGES = new Set([
  '未知文件导入操作。',
  '导入请求无效。',
  '导入文件无效。',
  '文件名无效。',
  '不支持此文件类型。',
  '单次导入文件总量超过 32 MiB。',
  '当前会话已归档。',
  '当前会话没有绑定工作区。',
  '当前工作区不可用。',
  '工作区导入目录不安全。',
  '工作区导入目录越界。',
  '导入结果不是普通文件。',
  '同名文件过多，无法安全导入。',
  '工作区导入目录已变化。',
  '图片暂存请求无效。',
  '图片暂存数据无效。',
  '图片名称无效。',
  '图片数量超过当前消息限制。',
  '图片超过单文件大小限制。',
  '图片尺寸超过当前限制。',
  '图片总大小超过当前消息限制。',
  '仅支持 PNG、JPEG、WebP 和 GIF 图片。',
  '图片暂存已取消。',
  '当前会话不可用。',
])

type ParsedImportResult = { readonly ok: true; readonly files: ImportedFile[] }
  | { readonly ok: false; readonly message: string }

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function parseFiles(value: unknown): ImportedFile[] | undefined {
  const body = record(value)
  if (body === undefined || !exactKeys(body, ['files', 'schema_version']) || body.schema_version !== 1
    || !Array.isArray(body.files) || body.files.length < 1 || body.files.length > MAX_FILES) return undefined
  const files: ImportedFile[] = []
  const storedNames = new Set<string>()
  const relativePaths = new Set<string>()
  for (const entry of body.files) {
    const file = record(entry)
    if (file === undefined || !exactKeys(file, ['bytes', 'display_name', 'media_type', 'relative_path', 'stored_name'])
      || !Number.isSafeInteger(file.bytes) || (file.bytes as number) < 0 || (file.bytes as number) > MAX_FILE_BYTES
      || typeof file.display_name !== 'string' || normalizedSafeFileName(file.display_name) !== file.display_name
      || typeof file.media_type !== 'string' || file.media_type !== allowedMediaType(file.display_name)
      || typeof file.stored_name !== 'string' || normalizedSafeFileName(file.stored_name) !== file.stored_name
      || allowedMediaType(file.stored_name) !== file.media_type || /[@\s]/u.test(file.stored_name)
      || typeof file.relative_path !== 'string' || file.relative_path !== ".e-mate/imports/" + file.stored_name) return undefined
    const imported = file as unknown as ImportedFile
    if (storedNames.has(imported.stored_name) || relativePaths.has(imported.relative_path)) return undefined
    storedNames.add(imported.stored_name)
    relativePaths.add(imported.relative_path)
    files.push(imported)
  }
  return files
}

function parseAttachment(value: unknown): ImageAttachmentRef | undefined {
  const ref = record(value)
  if (ref === undefined || !(exactKeys(ref, ['attachmentId', 'bytes', 'height', 'mediaType', 'width'])
    || exactKeys(ref, ['attachmentId', 'bytes', 'height', 'mediaType', 'name', 'width']))
    || typeof ref.attachmentId !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(ref.attachmentId)
    || typeof ref.mediaType !== 'string' || !IMAGE_MEDIA_TYPES.includes(ref.mediaType as never)
    || !Number.isSafeInteger(ref.bytes) || (ref.bytes as number) < 1 || (ref.bytes as number) > MAX_IMAGE_BYTES
    || !Number.isSafeInteger(ref.width) || (ref.width as number) < 1
    || !Number.isSafeInteger(ref.height) || (ref.height as number) < 1
    || (ref.width as number) > Math.floor(40_000_000 / (ref.height as number))
    || ('name' in ref && (typeof ref.name !== 'string' || ref.name === '' || ref.name !== ref.name.trim()
      || ref.name.normalize('NFC') !== ref.name || new TextEncoder().encode(ref.name).byteLength > 255
      || ref.name === '.' || ref.name === '..' || ref.name.includes('/') || ref.name.includes('\\')
      || Array.from(ref.name).some(character => { const code = character.codePointAt(0) as number; return code <= 0x1f || code === 0x7f })))) return undefined
  return ref as unknown as ImageAttachmentRef
}

export type ParsedImageStageResult = { readonly ok: true; readonly attachments: ImageAttachmentRef[] }
  | { readonly ok: false; readonly message: string }

/** Strictly parse durable image staging without accepting bytes or paths. */
export function parseImageStageResult(value: unknown): ParsedImageStageResult {
  const result = record(value)
  if (result === undefined || typeof result.ok !== 'boolean') return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
  if (!result.ok) return parseImportResult(value)
  if (!exactKeys(result, ['ok', 'value'])) return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
  const body = record(result.value)
  if (body === undefined || !exactKeys(body, ['attachments', 'schema_version']) || body.schema_version !== 1
    || !Array.isArray(body.attachments) || body.attachments.length < 1 || body.attachments.length > MAX_IMAGES) {
    return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
  }
  const attachments: ImageAttachmentRef[] = []
  let total = 0
  for (const value of body.attachments) {
    const attachment = parseAttachment(value)
    if (attachment === undefined) return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
    total += attachment.bytes
    if (total > MAX_IMAGE_TOTAL_BYTES) return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
    attachments.push(attachment)
  }
  return { ok: true, attachments }
}

/** Strictly parse a custom RPC result into safe presentation data. */
export function parseImportResult(value: unknown): ParsedImportResult {
  const result = record(value)
  if (result === undefined || typeof result.ok !== 'boolean') return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
  if (result.ok) {
    if (!exactKeys(result, ['ok', 'value'])) return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
    const files = parseFiles(result.value)
    return files === undefined ? { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE } : { ok: true, files }
  }
  if (!exactKeys(result, ['error', 'ok'])) return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
  const error = record(result.error)
  if (error === undefined || !exactKeys(error, ['code', 'details', 'message'])) return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
  const details = record(error.details)
  if (error.code === 'bad-request' && typeof error.message === 'string' && VALIDATION_MESSAGES.has(error.message)
    && details !== undefined && exactKeys(details, ['issues']) && Array.isArray(details.issues) && details.issues.length === 0) {
    return { ok: false, message: error.message }
  }
  if (error.code === 'internal' && error.message === SAFE_IMPORT_ERROR_MESSAGE
    && details !== undefined && exactKeys(details, [])) return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
  return { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE }
}

/** Map thrown transport and parser values without exposing their messages. */
export function safeThrownImportMessage(_error: unknown): string {
  return SAFE_IMPORT_ERROR_MESSAGE
}
