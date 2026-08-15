import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { loadTargetTools, readManagedBinding } from './target-runtime.js'

export const name = 'emate-office-ocr'
export const inject = ['tools', 'fs', 'subprocess', 'webServer', 'emateCapabilities']

const PRODUCT_VERSION = '2.0.7'
const WORKER_LOCK_SHA256 = 'cea6914a347a2a9a80f61260bea9d66d7d2fa2ad7e42434e6ecdafc63d8f8fd5'
const WORKER_SOURCE_COMMIT = '564a6b6c1d43fb6831dd4a5cd8026e472f063311'
const OFFICE_MEMORY_LIMIT = 512 * 1024 * 1024
const OFFICE_MAX_BYTES = 5 * 1024 * 1024
const OCR_MAX_BYTES = 8 * 1024 * 1024
const WORKER_IO_MAX_BYTES = 12 * 1024 * 1024
const ARTIFACT_ID = /^office_artifact:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u
const SHA256 = /^[0-9a-f]{64}$/u
const TEST_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const OFFICE_FAMILIES = {
  document: {
    extension: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  spreadsheet: {
    extension: '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  presentation: {
    extension: '.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  pdf: { extension: '.pdf', mime: 'application/pdf' },
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function contained(root, relative, label) {
  if (typeof relative !== 'string' || relative === '' || relative.includes('\0') || isAbsolute(relative)) {
    throw new Error(`${label} path is invalid`)
  }
  const path = resolve(root, relative)
  if (!path.startsWith(`${root}${sep}`)) throw new Error(`${label} path escapes the Runtime package`)
  return path
}

function verifiedFile(path, expected, label) {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || !SHA256.test(expected) || sha256(readFileSync(path)) !== expected) {
    throw new Error(`${label} checksum mismatch`)
  }
}

export function loadRuntimeBinding(bindingPath = join(import.meta.dirname, 'runtime-binding.json')) {
  const binding = readManagedBinding(bindingPath)
  if (binding.package !== `@e-mate/dsh-runtime-${process.platform}-${process.arch}`
    || !isAbsolute(binding.dsh_home)
    || !isAbsolute(binding.runtime_root)
    || !SHA256.test(binding.manifest_sha256)) {
    throw new Error('e-Mate Runtime binding is invalid')
  }
  const root = resolve(binding.runtime_root)
  const manifestPayload = readFileSync(join(root, 'emate-runtime.json'))
  if (sha256(manifestPayload) !== binding.manifest_sha256) throw new Error('e-Mate Runtime manifest checksum mismatch')
  const manifest = JSON.parse(manifestPayload.toString('utf8'))
  if (!isRecord(manifest)
    || manifest.schema_version !== 1
    || manifest.package !== binding.package
    || manifest.version !== PRODUCT_VERSION
    || manifest.os !== process.platform
    || manifest.cpu !== process.arch
    || manifest.python_version !== '3.11.15'
    || manifest.worker_lock_sha256 !== WORKER_LOCK_SHA256
    || manifest.source_commit !== WORKER_SOURCE_COMMIT
    || manifest.office !== true
    || manifest.ocr !== true
    || !Number.isSafeInteger(manifest.payload_files)
    || manifest.payload_files < 1
    || !SHA256.test(manifest.payload_sha256)
    || !Array.isArray(manifest.models)
    || manifest.models.length < 3) {
    throw new Error('e-Mate Runtime manifest is invalid')
  }
  const python = contained(root, manifest.python, 'Python')
  const worker = contained(root, manifest.worker, 'Worker')
  verifiedFile(python, manifest.python_sha256, 'Python')
  verifiedFile(worker, manifest.worker_sha256, 'Worker')
  for (const model of manifest.models) {
    if (!isRecord(model) || !Number.isSafeInteger(model.size) || model.size < 1) {
      throw new Error('OCR model manifest is invalid')
    }
    const path = contained(root, model.path, 'OCR model')
    const metadata = lstatSync(path)
    if (!metadata.isFile() || metadata.size !== model.size) throw new Error('OCR model size mismatch')
    verifiedFile(path, model.sha256, 'OCR model')
  }
  return {
    root,
    python,
    worker,
    dshHome: resolve(binding.dsh_home),
    package: binding.package,
  }
}

function workerEnvironment() {
  const env = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]))
  env.LANG = process.env.LANG ?? 'C.UTF-8'
  env.LC_ALL = process.env.LC_ALL ?? 'C.UTF-8'
  env.PYTHONHASHSEED = '0'
  env.PYTHONNOUSERSITE = '1'
  if (process.platform === 'win32') {
    env.SYSTEMROOT = process.env.SYSTEMROOT ?? process.env.SystemRoot
    env.WINDIR = process.env.WINDIR
  }
  return env
}

export async function runWorker(ctx, runtime, packId, operation, payload, signal) {
  signal?.throwIfAborted()
  const request = JSON.stringify({ schema_version: 1, pack_id: packId, operation, payload })
  if (Buffer.byteLength(request) > WORKER_IO_MAX_BYTES) throw new Error(`${packId} request exceeds the Worker boundary`)
  const argv = [runtime.python, '-I', '-B', runtime.worker, runtime.root]
  if (packId === 'office' && (operation === 'read' || operation === 'edit')) {
    argv.push('--office-read-memory-limit', String(OFFICE_MEMORY_LIMIT))
  }
  const handle = ctx.subprocess.spawn({
    argv,
    cwd: runtime.root,
    stdio: {
      stdin: { data: request },
      stdout: { maxBytes: WORKER_IO_MAX_BYTES },
      stderr: { maxBytes: 64 * 1024 },
    },
    graceMs: 3_000,
    signal,
    env: workerEnvironment(),
  })
  const outcome = await handle.done
  signal?.throwIfAborted()
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  if (stdout === undefined || stderr === undefined || stdout.lossy || stderr.lossy) {
    throw new Error(`${packId} Worker output exceeded its boundary`)
  }
  if (outcome.exitCode !== 0 || outcome.signal !== null) {
    const detail = stderr.text.trim().slice(0, 240)
    throw new Error(`${packId} Worker failed (${outcome.signal ?? `exit ${String(outcome.exitCode)}`})${detail === '' ? '' : `: ${detail}`}`)
  }
  let response
  try {
    response = JSON.parse(stdout.text)
  } catch {
    throw new Error(`${packId} Worker returned invalid JSON`)
  }
  if (!isRecord(response)
    || response.schema_version !== 1
    || response.pack_id !== packId
    || response.status !== 'success'
    || !isRecord(response.result)) {
    throw new Error(`${packId} Worker returned an invalid response`)
  }
  return response.result
}

function artifactRoot(runtime) {
  return join(runtime.dshHome, 'e-mate', 'attachments', 'office')
}

function atomicWrite(path, content) {
  mkdirSync(resolve(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  let descriptor
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, content)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    renameSync(temporary, path)
    try {
      const directory = openSync(resolve(path, '..'), 'r')
      try { fsyncSync(directory) } finally { closeSync(directory) }
    } catch {
      // Windows does not expose directory fsync through Node; the file itself is durable.
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporary, { force: true })
  }
}

function safeFilename(value, family) {
  const extension = OFFICE_FAMILIES[family].extension
  const raw = typeof value === 'string' ? basename(value).trim() : ''
  let name = raw.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, '-').replace(/\s+/gu, ' ').slice(0, 100)
  if (name === '' || name === '.' || name === '..') name = `e-Mate-office${extension}`
  if (extname(name).toLowerCase() !== extension) name += extension
  return name
}

function artifactMetadataPath(runtime, id) {
  const match = ARTIFACT_ID.exec(id)
  if (match === null) throw new Error('Office artifact id is invalid')
  return join(artifactRoot(runtime), `${match[1]}.json`)
}

function readArtifact(runtime, id) {
  const metadata = JSON.parse(readFileSync(artifactMetadataPath(runtime, id), 'utf8'))
  const family = isRecord(metadata) ? OFFICE_FAMILIES[metadata.family] : undefined
  if (family === undefined
    || metadata.schema_version !== 1
    || metadata.artifact_id !== id
    || typeof metadata.filename !== 'string'
    || metadata.mime_type !== family.mime
    || !Number.isSafeInteger(metadata.size_bytes)
    || metadata.size_bytes < 1
    || metadata.size_bytes > OFFICE_MAX_BYTES
    || !SHA256.test(metadata.sha256)
    || metadata.content_file !== `${metadata.sha256}${family.extension}`) {
    throw new Error('Office artifact receipt is invalid')
  }
  const contentPath = contained(artifactRoot(runtime), metadata.content_file, 'Office artifact')
  const content = readFileSync(contentPath)
  if (content.byteLength !== metadata.size_bytes || sha256(content) !== metadata.sha256) {
    throw new Error('Office artifact integrity check failed')
  }
  return { metadata, content }
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8 * 1024 * 1024
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new Error('Office Worker returned invalid artifact bytes')
  }
  const content = Buffer.from(value, 'base64')
  if (content.toString('base64') !== value) throw new Error('Office Worker returned invalid artifact bytes')
  return content
}

function saveArtifact(runtime, result, requestedFilename) {
  const family = OFFICE_FAMILIES[result.family]
  if (family === undefined || result.provider !== 'python-office-formats-v1'
    || result.mime_type !== family.mime || result.extension !== family.extension
    || !isRecord(result.validation)) {
    throw new Error('Office Worker returned invalid artifact metadata')
  }
  const content = decodeBase64(result.content_base64)
  if (content.byteLength !== result.size_bytes || content.byteLength > OFFICE_MAX_BYTES) {
    throw new Error('Office Worker artifact size mismatch')
  }
  const digest = sha256(content)
  const root = artifactRoot(runtime)
  mkdirSync(root, { recursive: true })
  const contentPath = join(root, `${digest}${family.extension}`)
  if (existsSync(contentPath)) {
    const existing = readFileSync(contentPath)
    if (existing.byteLength !== content.byteLength || sha256(existing) !== digest) {
      throw new Error('Office artifact CAS collision')
    }
  } else {
    atomicWrite(contentPath, content)
  }
  const artifactId = `office_artifact:${randomUUID()}`
  const filename = safeFilename(requestedFilename, result.family)
  const metadata = {
    schema_version: 1,
    artifact_id: artifactId,
    family: result.family,
    filename,
    mime_type: result.mime_type,
    size_bytes: content.byteLength,
    sha256: digest,
    content_file: `${digest}${family.extension}`,
    created_at: new Date().toISOString(),
  }
  atomicWrite(artifactMetadataPath(runtime, artifactId), `${JSON.stringify(metadata, null, 2)}\n`)
  return {
    artifact_id: artifactId,
    family: result.family,
    filename,
    mime_type: result.mime_type,
    size_bytes: content.byteLength,
    sha256: digest,
    download_url: `/api/e-mate/office.download?id=${encodeURIComponent(artifactId)}`,
    validation: result.validation,
  }
}

async function inputBytes(ctx, runtime, args, exec, maximum) {
  const hasPath = typeof args.path === 'string' && args.path.trim() !== ''
  const hasArtifact = typeof args.artifact_id === 'string' && args.artifact_id !== ''
  if (hasPath === hasArtifact) throw new Error('provide exactly one path or artifact_id')
  if (hasArtifact) {
    const artifact = readArtifact(runtime, args.artifact_id)
    if (artifact.content.byteLength > maximum) throw new Error('input exceeds the capability byte limit')
    return { content: artifact.content, source: args.artifact_id, family: artifact.metadata.family }
  }
  const cwd = exec.agent?.session.header.cwd
  const target = await ctx.fs.resolve(args.path, { ...(cwd === undefined ? {} : { cwd }), signal: exec.signal })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info === undefined) {
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    throw new Error(`cannot read "${target.displayPath}": not found`)
  }
  if (info.type !== 'file') throw new Error(`cannot read "${target.displayPath}": not a regular file`)
  if (info.size !== undefined && info.size > maximum) throw new Error(`cannot read "${target.displayPath}": file is too large`)
  const content = Buffer.from(await ctx.fs.readBytes(target, exec.signal, maximum))
  ctx.emit('fs/observed', target, { kind: 'present', version: info.version }, exec)
  return { content, source: target.displayPath }
}

const artifactOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      artifact_id: { type: 'string', required: true },
      family: { type: 'string', required: true, enum: Object.keys(OFFICE_FAMILIES) },
      filename: { type: 'string', required: true },
      mime_type: { type: 'string', required: true },
      size_bytes: { type: 'integer', required: true },
      sha256: { type: 'string', required: true },
      download_url: { type: 'string', required: true },
      validation: { type: 'json', required: true },
    },
  },
  render: (_args, value) => [{
    type: 'text',
    text: `Created ${value.filename} (${value.size_bytes} bytes, SHA-256 ${value.sha256}). Download: ${value.download_url}. Reopen it with artifact_id ${value.artifact_id}.`,
  }],
  presentationMeta: (_args, value) => ({
    eMateOfficeArtifact: {
      artifact_id: value.artifact_id,
      family: value.family,
      filename: value.filename,
      mime_type: value.mime_type,
      size_bytes: value.size_bytes,
      sha256: value.sha256,
      download_url: value.download_url,
    },
  }),
}

function officeParameters(source) {
  return {
    family: {
      type: 'string', required: true, enum: Object.keys(OFFICE_FAMILIES),
      description: 'Office format family: document=DOCX, spreadsheet=XLSX, presentation=PPTX, pdf=PDF.',
    },
    ...(source ? {
      path: { type: 'string', description: 'Workspace file path. Provide exactly one of path or artifact_id.' },
      artifact_id: { type: 'string', description: 'Immutable artifact id from an earlier e-Mate Office result. Provide exactly one of path or artifact_id.' },
    } : {}),
  }
}

function registerCapabilities(ctx, runtime, runtimeError) {
  const capabilities = ctx.get('emateCapabilities')
  if (capabilities === undefined) throw new Error('e-Mate Office/OCR requires emateCapabilities')
  for (const definition of [
    {
      id: 'office', title: 'Office', summary: '创建、读取、修改并导出 DOCX、XLSX、PPTX 和 PDF。', order: 20,
      icon_key: 'office', packId: 'office', operation: 'probe', payload: {},
    },
    {
      id: 'ocr', title: 'OCR', summary: '使用本地 RapidOCR 识别图片文字，图片内容不上传。', order: 30,
      icon_key: 'ocr', packId: 'ocr', operation: 'extract', payload: { content_base64: TEST_PNG },
    },
  ]) {
    ctx.effect(() => capabilities.register({
      id: definition.id,
      title: definition.title,
      summary: definition.summary,
      icon_key: definition.icon_key,
      order: definition.order,
      actions: [{ id: 'self-test', label: '运行自检', kind: 'secondary' }],
      status: async () => runtime === undefined
        ? { state: 'blocked', detail: runtimeError, action_ids: [] }
        : { state: 'ready', detail: `${runtime.package}@${PRODUCT_VERSION}`, action_ids: ['self-test'] },
      invoke: async (_action, _data, signal) => runWorker(ctx, runtime, definition.packId, definition.operation, definition.payload, signal),
    }))
  }
}

function registerDownload(ctx, runtime) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/e-mate/office.download',
    handler(req, res) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' })
        res.end()
        return
      }
      const ids = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.getAll('id')
      if (ids.length !== 1) {
        res.writeHead(400)
        res.end('one artifact id is required')
        return
      }
      let artifact
      try {
        artifact = readArtifact(runtime, ids[0])
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        res.writeHead(message.includes('integrity') ? 409 : 404)
        res.end(message.includes('integrity') ? 'artifact integrity check failed' : 'artifact not found')
        return
      }
      const fallback = `e-mate-office${OFFICE_FAMILIES[artifact.metadata.family].extension}`
      const encoded = encodeURIComponent(artifact.metadata.filename).replace(/[!'()*]/gu, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
      res.writeHead(200, {
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
        'Content-Length': artifact.content.byteLength,
        'Content-Type': artifact.metadata.mime_type,
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(req.method === 'HEAD' ? undefined : artifact.content)
    },
  }), 'emate.office: verified artifact download')
}

function registerTools(ctx, runtime, defineTool) {
  ctx.tools.register(defineTool({
    name: 'e_mate_ocr_extract',
    description: 'Extract text from one local PNG, JPEG, WebP, GIF, BMP, or TIFF image with the bundled offline RapidOCR worker.',
    parameters: { path: { type: 'string', required: true, description: 'Image path relative to the current e-Mate session workspace, or an absolute path allowed by its filesystem provider.' } },
    timeoutMs: 180_000,
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['success', 'empty'] },
          text: { type: 'string', required: true },
          blocks: { type: 'array', required: true, items: { type: 'json' } },
          latency_ms: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text === '' ? 'No text was detected.' : value.text }],
    },
    async execute(args, exec) {
      const input = await inputBytes(ctx, runtime, args, exec, OCR_MAX_BYTES)
      const result = await runWorker(ctx, runtime, 'ocr', 'extract', { content_base64: input.content.toString('base64') }, exec.signal)
      if (!['success', 'empty'].includes(result.status) || result.provider !== 'rapidocr_onnxruntime'
        || typeof result.text !== 'string' || !Array.isArray(result.blocks) || !Number.isSafeInteger(result.latencyMs)) {
        throw new Error('OCR Worker returned an invalid result')
      }
      return {
        source: input.source,
        provider: result.provider,
        status: result.status,
        text: result.text,
        blocks: result.blocks,
        latency_ms: result.latencyMs,
      }
    },
    presentCall: args => ({ card: 'generic', title: `OCR ${args.path}`, kind: 'read', locations: [{ path: args.path }] }),
  }))

  ctx.tools.register(defineTool({
    name: 'e_mate_office_read',
    description: 'Read and inspect one DOCX, XLSX, PPTX, or PDF from the current workspace or an immutable e-Mate Office artifact.',
    parameters: officeParameters(true),
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          source: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          family: { type: 'string', required: true, enum: Object.keys(OFFICE_FAMILIES) },
          text: { type: 'string', required: true },
          structure: { type: 'json', required: true },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text === '' ? JSON.stringify(value.structure) : value.text }],
    },
    async execute(args, exec) {
      const input = await inputBytes(ctx, runtime, args, exec, OFFICE_MAX_BYTES)
      if (input.family !== undefined && input.family !== args.family) throw new Error('artifact family does not match the requested Office family')
      const result = await runWorker(ctx, runtime, 'office', 'read', { family: args.family, content_base64: input.content.toString('base64') }, exec.signal)
      if (result.provider !== 'python-office-formats-v1' || result.family !== args.family
        || typeof result.text !== 'string' || !isRecord(result.structure)
        || !Array.isArray(result.warnings) || typeof result.truncated !== 'boolean') {
        throw new Error('Office Worker returned an invalid read result')
      }
      return { source: input.source, ...result }
    },
    presentCall: args => ({
      card: 'generic', title: `Read ${args.family}`, kind: 'read',
      ...(args.path === undefined ? {} : { locations: [{ path: args.path }] }),
      rawInput: args.artifact_id,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'e_mate_office_create',
    description: 'Create a validated DOCX, XLSX, PPTX, or PDF as an immutable downloadable e-Mate artifact. For document/PDF content use {sections:[{heading,level?,paragraphs:[]}],tables?:[{rows:[[]]}]}; spreadsheet uses {sheets:[{name,rows:[[]]}]}; presentation uses {slides:[{title,bullets:[]}]}.',
    parameters: {
      ...officeParameters(false),
      title: { type: 'string', required: true, description: 'Document title.' },
      content: { type: 'json', required: true, description: 'Structured content matching the selected family.' },
      filename: { type: 'string', description: 'Download filename; the correct extension is appended when needed.' },
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    output: artifactOutput,
    async execute(args, exec) {
      if (!isRecord(args.content)) throw new Error('content must be a JSON object')
      const result = await runWorker(ctx, runtime, 'office', 'create', { ...args.content, family: args.family, title: args.title }, exec.signal)
      return saveArtifact(runtime, result, args.filename ?? args.title)
    },
    presentCall: args => ({ card: 'generic', title: `Create ${args.family}`, kind: 'execute', rawInput: args.title }),
  }))

  ctx.tools.register(defineTool({
    name: 'e_mate_office_edit',
    description: 'Open an existing DOCX, XLSX, PPTX, or PDF, verify it, and create a new immutable replacement from complete structured content. The source artifact is never overwritten.',
    parameters: {
      ...officeParameters(true),
      title: { type: 'string', required: true, description: 'Replacement document title.' },
      content: { type: 'json', required: true, description: 'Complete replacement content using the same structure as e_mate_office_create.' },
      filename: { type: 'string', description: 'Download filename for the new immutable artifact.' },
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    output: artifactOutput,
    async execute(args, exec) {
      if (!isRecord(args.content)) throw new Error('content must be a JSON object')
      const input = await inputBytes(ctx, runtime, args, exec, OFFICE_MAX_BYTES)
      if (input.family !== undefined && input.family !== args.family) throw new Error('artifact family does not match the requested Office family')
      const result = await runWorker(ctx, runtime, 'office', 'edit', {
        ...args.content,
        family: args.family,
        title: args.title,
        content_base64: input.content.toString('base64'),
      }, exec.signal)
      return saveArtifact(runtime, result, args.filename ?? args.title)
    },
    presentCall: args => ({
      card: 'generic', title: `Edit ${args.family}`, kind: 'execute',
      ...(args.path === undefined ? {} : { locations: [{ path: args.path }] }),
      rawInput: args.artifact_id ?? args.title,
    }),
  }))
}

export async function apply(ctx, config = {}) {
  let runtime
  let runtimeError
  try {
    runtime = loadRuntimeBinding(config.bindingPath)
  } catch (error) {
    runtimeError = error instanceof Error ? error.message : String(error)
  }
  registerCapabilities(ctx, runtime, runtimeError)
  if (runtime === undefined) return
  const { defineTool } = await loadTargetTools(config.bindingPath)
  registerDownload(ctx, runtime)
  registerTools(ctx, runtime, defineTool)
}
