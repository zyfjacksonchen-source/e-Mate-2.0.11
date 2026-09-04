import { allowedMediaType, normalizedSafeFileName, type ImportedFile } from '../contract.ts'

export type FileReference = Omit<ImportedFile, 'bytes'>
export const FILE_REFERENCE_SOURCE = 'e-mate/file-import'

/** Read only the managed import directory, never an arbitrary workspace path. */
function fromPath(path: string): FileReference | undefined {
  const prefix = '.e-mate/imports/'
  if (!path.startsWith(prefix)) return undefined
  const name = path.slice(prefix.length)
  const media = allowedMediaType(name)
  if (normalizedSafeFileName(name) !== name || /[@\s]/u.test(name) || media === undefined) return undefined
  return { relative_path: path, stored_name: name, display_name: name, media_type: media }
}

/** Migrate legacy imported drafts; ordinary @ workspace mentions remain native. */
export function importedDraft(text: string): { text: string; files: FileReference[] } {
  const files = new Map<string, FileReference>()
  const clean = text.replace(/(^|\s)@(\.e-mate\/imports\/\S+)/gu, (token, space: string, path: string) => {
    const file = fromPath(path)
    if (file === undefined) return token
    files.set(path, file)
    return space
  })
  return { text: files.size === 0 ? text : clean.trimEnd(), files: [...files.values()] }
}

/** Project a durable user/steering node without altering its logged model text. */
export function importedMessage(content: readonly any[], source: unknown) {
  const names = new Map<string, FileReference>()
  const mentions = source !== null && typeof source === 'object' ? (source as { mentions?: unknown }).mentions : undefined
  if (Array.isArray(mentions)) for (const mention of mentions) {
    if (mention?.source !== FILE_REFERENCE_SOURCE || typeof mention.ref !== 'string') continue
    try {
      const value = JSON.parse(mention.ref)
      const file = typeof value?.relative_path === 'string' ? fromPath(value.relative_path) : undefined
      if (file !== undefined && normalizedSafeFileName(value.display_name) === value.display_name
        && value.stored_name === file.stored_name && value.media_type === file.media_type) {
        names.set(file.relative_path, { ...file, display_name: value.display_name })
      }
    } catch { /* An invalid optional label never changes the actual submitted path. */ }
  }
  const files = new Map<string, FileReference>()
  const projected = content.map(block => {
    if (block?.type !== 'text' || typeof block.text !== 'string') return block
    const result = importedDraft(block.text)
    for (const file of result.files) files.set(file.relative_path, names.get(file.relative_path) ?? file)
    return result.files.length === 0 ? block : { ...block, text: result.text }
  })
  return { content: projected, files: [...files.values()] }
}
