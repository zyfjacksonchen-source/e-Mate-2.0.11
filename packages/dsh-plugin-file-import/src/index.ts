import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, realpath, unlink, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  allowedMediaType,
  CHANNEL,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  type ImportedFile,
} from './contract.ts'

export const name = 'emate-file-import'
export const inject = ['connection', 'workspaceRegistry']

interface WorkspaceView {
  readonly path: string
  readonly sessionIds: readonly string[]
}

interface EncodedFile {
  readonly bytes: Buffer
  readonly displayName: string
  readonly mediaType: string
  readonly storedName: string
}

export class ImportValidationError extends Error {}

function badRequest(message: string) {
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [] } } }
}

function unavailable() {
  return { ok: false, error: { code: 'unavailable', message: '文件暂时无法导入当前工作区。', details: {} } }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function validatedDisplayName(value: unknown): string {
  if (typeof value !== 'string') throw new ImportValidationError('文件名无效。')
  const name = value.normalize('NFC')
  if (name !== value || name === '' || name === '.' || name === '..' || name !== name.trim()
    || name.startsWith('.') || Buffer.byteLength(name, 'utf8') > 160
    || /[<>:"/\\|?*\u0000-\u001f]/u.test(name) || /[. ]$/u.test(name)) {
    throw new ImportValidationError('文件名无效。')
  }
  const device = name.slice(0, name.indexOf('.') < 0 ? undefined : name.indexOf('.')).toUpperCase()
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(device)) {
    throw new ImportValidationError('文件名无效。')
  }
  if (allowedMediaType(name) === undefined) throw new ImportValidationError('不支持此文件类型。')
  return name
}

function storedName(displayName: string): string {
  return displayName.replace(/[\s@]+/gu, '_')
}

function decodeFiles(payload: unknown): { sessionId: string; files: EncodedFile[] } {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ImportValidationError('导入请求无效。')
  }
  const body = payload as Record<string, unknown>
  if (!exactKeys(body, ['files', 'session_id'])
    || typeof body.session_id !== 'string' || body.session_id.length < 1 || body.session_id.length > 256
    || !Array.isArray(body.files) || body.files.length < 1 || body.files.length > MAX_FILES) {
    throw new ImportValidationError('导入请求无效。')
  }
  let total = 0
  const files = body.files.map((entry): EncodedFile => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ImportValidationError('导入文件无效。')
    }
    const item = entry as Record<string, unknown>
    if (!exactKeys(item, ['bytes_base64', 'media_type', 'name'])
      || typeof item.bytes_base64 !== 'string'
      || item.bytes_base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(item.bytes_base64)
      || typeof item.media_type !== 'string' || item.media_type.length > 127) {
      throw new ImportValidationError('导入文件无效。')
    }
    const displayName = validatedDisplayName(item.name)
    const mediaType = allowedMediaType(displayName) as string
    const bytes = Buffer.from(item.bytes_base64, 'base64')
    if (bytes.byteLength > MAX_FILE_BYTES || bytes.toString('base64') !== item.bytes_base64) {
      throw new ImportValidationError('导入文件无效。')
    }
    total += bytes.byteLength
    if (total > MAX_TOTAL_BYTES) throw new ImportValidationError('单次导入文件总量超过 32 MiB。')
    return { bytes, displayName, mediaType, storedName: storedName(displayName) }
  })
  return { sessionId: body.session_id, files }
}

async function workspaceRoot(ctx: any, sessionId: string): Promise<string> {
  const workspace = (ctx.workspaceRegistry.list() as WorkspaceView[])
    .find(candidate => candidate.sessionIds.includes(sessionId))
  if (workspace === undefined) throw new ImportValidationError('当前会话没有绑定工作区。')
  const root = await realpath(workspace.path)
  if (!(await lstat(root)).isDirectory()) throw new ImportValidationError('当前工作区不可用。')
  return root
}

async function managedImports(root: string): Promise<string> {
  let current = root
  for (const segment of ['.e-mate', 'imports']) {
    const candidate = join(current, segment)
    await mkdir(candidate, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error
    })
    const info = await lstat(candidate)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ImportValidationError('工作区导入目录不安全。')
    current = await realpath(candidate)
    if (!inside(root, current)) throw new ImportValidationError('工作区导入目录越界。')
  }
  return current
}

function collisionName(name: string, index: number): string {
  if (index === 1) return name
  const extension = extname(name)
  return `${name.slice(0, name.length - extension.length)}-${index}${extension}`
}

async function publishFile(directory: string, input: EncodedFile, signal?: AbortSignal): Promise<{ path: string; name: string }> {
  signal?.throwIfAborted()
  const temporary = join(directory, `.import-${randomUUID()}.tmp`)
  await writeFile(temporary, input.bytes, { flag: 'wx', flush: true, mode: 0o600, signal })
  try {
    for (let index = 1; index <= 999; index += 1) {
      signal?.throwIfAborted()
      const name = collisionName(input.storedName, index)
      const target = join(directory, name)
      try {
        await link(temporary, target)
        const info = await lstat(target)
        if (!info.isFile() || info.isSymbolicLink()) {
          await unlink(target).catch(() => {})
          throw new ImportValidationError('导入结果不是普通文件。')
        }
        return { path: target, name }
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new ImportValidationError('同名文件过多，无法安全导入。')
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

export async function importIntoWorkspace(root: string, files: readonly EncodedFile[], signal?: AbortSignal): Promise<ImportedFile[]> {
  const directory = await managedImports(root)
  const published: string[] = []
  try {
    const result: ImportedFile[] = []
    for (const file of files) {
      if (await realpath(directory) !== directory) throw new ImportValidationError('工作区导入目录已变化。')
      const saved = await publishFile(directory, file, signal)
      published.push(saved.path)
      result.push({
        bytes: file.bytes.byteLength,
        display_name: file.displayName,
        media_type: file.mediaType,
        relative_path: ['.e-mate', 'imports', saved.name].join('/'),
        stored_name: saved.name,
      })
    }
    return result
  } catch (error) {
    await Promise.all(published.map(path => unlink(path).catch(() => {})))
    throw error
  }
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.connection.rpc.handle(
    CHANNEL,
    async (endpoint: string, payload: unknown, signal: AbortSignal) => {
      if (endpoint !== 'import') return badRequest('未知文件导入操作。')
      try {
        const request = decodeFiles(payload)
        const root = await workspaceRoot(ctx, request.sessionId)
        const files = await importIntoWorkspace(root, request.files, signal)
        return { ok: true, value: { schema_version: 1, files } }
      } catch (error) {
        return error instanceof ImportValidationError ? badRequest(error.message) : unavailable()
      }
    },
    { authority: 'loopback' },
  ), 'emate.fileImport: loopback session-bound import')
}
