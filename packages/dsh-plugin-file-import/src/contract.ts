export const CHANNEL = '/emate.fileImport'
export const MAX_FILES = 8
export const MAX_FILE_BYTES = 16 * 1024 * 1024
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGES = 20
export const MAX_IMAGE_TOTAL_BYTES = 100 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40_000_000
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export interface ImageAttachmentRef {
  readonly attachmentId: string
  readonly mediaType: typeof IMAGE_MEDIA_TYPES[number]
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}
export const COMPOSER_DROP_TARGET = '[data-composer-card]'
export const WORKSPACE_DROP_TARGET = '[data-dsh-workspace-drop-target]'

export type FileDropRoute = 'pass' | 'normalize-images' | 'intake-all'

/** Route a native drop without stealing workspace folders or page-wide ordinary files. */
export function fileDropRoute(input: {
  readonly composerTarget: boolean
  readonly directory: boolean
  readonly normalizeImage: boolean
  readonly ordinary: boolean
  readonly workspaceTarget: boolean
}): FileDropRoute {
  if (input.directory || input.workspaceTarget) return 'pass'
  if (input.composerTarget && (input.ordinary || input.normalizeImage)) return 'intake-all'
  return input.normalizeImage ? 'normalize-images' : 'pass'
}

export const ALLOWED_MEDIA_BY_EXTENSION: Readonly<Record<string, string>> = {
  '7z': 'application/x-7z-compressed',
  bz2: 'application/x-bzip2',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gz: 'application/gzip',
  json: 'application/json',
  md: 'text/markdown',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odt: 'application/vnd.oasis.opendocument.text',
  pdf: 'application/pdf',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rar: 'application/vnd.rar',
  rtf: 'application/rtf',
  tar: 'application/x-tar',
  tgz: 'application/gzip',
  tsv: 'text/tab-separated-values',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml: 'application/xml',
  xz: 'application/x-xz',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  zip: 'application/zip',
}

export interface ImportedFile {
  readonly bytes: number
  readonly display_name: string
  readonly media_type: string
  readonly relative_path: string
  readonly stored_name: string
}

export function extensionOf(name: string): string {
  const at = name.lastIndexOf('.')
  return at < 1 || at === name.length - 1 ? '' : name.slice(at + 1).toLowerCase()
}

export function allowedMediaType(name: string): string | undefined {
  return ALLOWED_MEDIA_BY_EXTENSION[extensionOf(name)]
}

/** Normalize and validate one cross-platform-safe filename. */
export function normalizedSafeFileName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.normalize('NFC')
  if (name === '' || name === '.' || name === '..' || name !== name.trim()
    || name.startsWith('.') || new TextEncoder().encode(name).byteLength > 160
    || /[<>:"/\\|?*\u0000-\u001f]/u.test(name) || /[. ]$/u.test(name)) return undefined
  const dot = name.indexOf('.')
  const device = name.slice(0, dot < 0 ? undefined : dot).toUpperCase()
  return /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(device) ? undefined : name
}

export function appendImportedMentions(draft: string, files: readonly ImportedFile[]): string {
  const prefix = draft === '' || /\s$/u.test(draft) ? draft : `${draft} `
  return `${prefix}${files.map(file => `@${file.relative_path}`).join(' ')} `
}

export function fileBadge(name: string, mediaType: string): string {
  const extension = extensionOf(name)
  if (mediaType === 'application/pdf') return 'PDF'
  if (extension === 'doc' || extension === 'docx' || extension === 'odt' || extension === 'rtf') return 'DOC'
  if (extension === 'xls' || extension === 'xlsx' || extension === 'ods' || extension === 'csv' || extension === 'tsv') return '表格'
  if (extension === 'ppt' || extension === 'pptx' || extension === 'odp') return '演示'
  if (extension === 'zip' || extension === '7z' || extension === 'rar' || extension === 'tar' || extension === 'gz' || extension === 'tgz' || extension === 'bz2' || extension === 'xz') return '压缩'
  return extension === '' ? '文件' : extension.toUpperCase().slice(0, 5)
}
