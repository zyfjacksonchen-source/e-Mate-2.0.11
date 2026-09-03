import { allowedMediaType, MAX_FILE_BYTES, MAX_FILES, normalizedSafeFileName, type ImportedFile } from '../contract.ts'

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
