import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { zipSync } from 'fflate'
import { loadTargetLlm, loadTargetTools } from './target-runtime.js'

export const name = 'emate-image-generation'
export const inject = ['tools', 'jobs', 'attachments', 'emateIdentity', 'emateModelPolicy', 'emateCapabilities']

const IMAGE_MODEL = 'gpt-image-2-pro'
const MAX_PROMPT_CHARS = 20_000
const MAX_EDIT_IMAGES = 16
const MAX_EDIT_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_PACK_IMAGES = 100
const MAX_PACK_BYTES = 100 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 610_000
const ATTACHMENT_ID = /^sha256:[0-9a-f]{64}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function gatewayRoot(value) {
  if (typeof value !== 'string') throw new Error('e-Mate managed image gateway is not configured')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('e-Mate managed image gateway is invalid')
  }
  url.pathname = url.pathname.replace(/\/+$/u, '')
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || !url.pathname.endsWith('/v1')) {
    throw new Error('e-Mate managed image gateway must be a fixed HTTPS Model Gateway /v1 endpoint')
  }
  return url
}

function endpoint(root, path) {
  return new URL(`${root.pathname}${path}`, root.origin)
}

async function readBounded(response, maximum, label) {
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) {
    throw new Error(`${label} response exceeds the byte boundary`)
  }
  if (response.body === null) throw new Error(`${label} response body is missing`)
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!(value instanceof Uint8Array) || (length += value.byteLength) > maximum) {
      await reader.cancel()
      throw new Error(`${label} response exceeds the byte boundary`)
    }
    chunks.push(value)
  }
  if (declared !== null && length !== Number(declared)) throw new Error(`${label} Content-Length does not match the body`)
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), length)
}

async function responseJson(response, maximum, label) {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`)
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/json') throw new Error(`${label} response is not JSON`)
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(response, maximum, label)))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(label)) throw error
    throw new Error(`${label} response contains invalid JSON`)
  }
}

function imageRef(value) {
  return {
    attachmentId: value.attachmentId,
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...(value.name === undefined ? {} : { name: value.name }),
  }
}

function validImageRef(value) {
  return isRecord(value)
    && typeof value.attachmentId === 'string' && ATTACHMENT_ID.test(value.attachmentId)
    && typeof value.mediaType === 'string'
    && Number.isSafeInteger(value.bytes) && value.bytes > 0
    && Number.isSafeInteger(value.width) && value.width > 0
    && Number.isSafeInteger(value.height) && value.height > 0
    && (value.name === undefined || typeof value.name === 'string')
}

function messageImages(messages, generatedOnly = false) {
  const images = []
  let visited = 0
  const collect = (blocks, generated = false) => {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (++visited > 20_000) throw new Error('e-Mate image history exceeds the edit lookup boundary')
      if (block?.type === 'image' && validImageRef(block.attachment) && (!generatedOnly || generated)) {
        images.push(block.attachment)
      }
      if (block?.type === 'tool-result') collect(block.content, true)
    }
  }
  for (const message of messages) collect(message?.content)
  return images
}

function uniqueImages(images, newestFirst = false) {
  const ordered = newestFirst ? [...images].reverse() : images
  const seen = new Set()
  return ordered.filter(image => {
    if (seen.has(image.attachmentId)) return false
    seen.add(image.attachmentId)
    return true
  })
}

function sessionMessages(agent) {
  const messages = agent?.session?.deriveMessages?.()
  if (!Array.isArray(messages)) throw new Error('image tools require the authoritative e-Mate conversation')
  return messages
}

function sessionImage(agent, attachmentId) {
  const image = uniqueImages(messageImages(sessionMessages(agent)), true)
    .find(candidate => candidate.attachmentId === attachmentId)
  if (image !== undefined) return image
  throw new Error(`image attachment ${attachmentId} is not present in this e-Mate session`)
}

function latestUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.source?.kind === 'user') return messages[index]
  }
  return undefined
}

function imageCatalogContext(messages) {
  const current = uniqueImages(messageImages(latestUserMessage(messages) === undefined ? [] : [latestUserMessage(messages)]))
  const recent = uniqueImages(messageImages(messages), true)
    .filter(image => !current.some(selected => selected.attachmentId === image.attachmentId))
    .slice(0, 32)
  if (current.length === 0 && recent.length === 0) return undefined
  const selected = current.length === 0 ? ''
    : `Images selected in the current user request, in attachment order: ${current.map(image => `\`${image.attachmentId}\``).join(', ')}. `
  const history = recent.length === 0 ? ''
    : `Recent images already stored in this conversation, newest first: ${recent.map(image => `\`${image.attachmentId}\``).join(', ')}. `
  return `${selected}${history}For an edit or reference request such as \"修改上图\", call imagegen with the matching exact image_url attachment ID (normally the newest image when the user says \"上图\"); never ask the user to upload an image already listed here. A request for a wholly new image must omit image_url. To deliver several images together, call image_pack once with their exact attachment IDs.`
}

const SESSION_IMAGE_REFERENCE = /(?:上图|这张图|该图|原图|刚才(?:生成|上传)?的?(?:那张)?图|所附图片|附件(?:中|里)的图|(?:把|将)它(?:修改|改成|修成)|\b(?:this|that|above|previous|original|uploaded|attached)\s+(?:image|picture|photo)\b)/iu

function implicitEditImages(agent, task) {
  if (task.attachmentIds.length > 0) return task.attachmentIds
  const messages = sessionMessages(agent)
  const current = uniqueImages(messageImages(latestUserMessage(messages) === undefined ? [] : [latestUserMessage(messages)]))
  if (current.length > 0) return current.map(image => image.attachmentId)
  const text = latestUserMessage(messages)?.content
    ?.filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join('\n') ?? ''
  if (!SESSION_IMAGE_REFERENCE.test(`${text}\n${task.prompt}`)) return []
  const newest = uniqueImages(messageImages(messages), true)[0]
  if (newest === undefined) {
    throw new Error('image editing needs a source image in the current conversation; upload one image once and retry')
  }
  return [newest.attachmentId]
}

function normalizeTask(args) {
  if (!isRecord(args) || Object.keys(args).some(key => !['prompt', 'image_url'].includes(key))
    || typeof args.prompt !== 'string') {
    throw new Error('imagegen accepts only prompt and optional image_url')
  }
  const prompt = args.prompt.trim()
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS || prompt.includes('\0')) {
    throw new Error(`image prompt must contain 1 to ${MAX_PROMPT_CHARS} characters`)
  }
  const imageUrl = args.image_url
  const attachmentIds = imageUrl === undefined ? [] : Array.isArray(imageUrl) ? imageUrl : [imageUrl]
  if (attachmentIds.length > MAX_EDIT_IMAGES
    || attachmentIds.some(id => typeof id !== 'string' || !ATTACHMENT_ID.test(id))) {
    throw new Error('image_url must contain current-session image attachment IDs')
  }
  return { prompt, attachmentIds: [...new Set(attachmentIds)] }
}

function normalizePack(args) {
  if (!exactKeys(args, ['image_url']) || !Array.isArray(args.image_url)) {
    throw new Error('image_pack accepts only an image_url array')
  }
  const attachmentIds = [...new Set(args.image_url)]
  if (attachmentIds.length === 0 || attachmentIds.length > MAX_PACK_IMAGES
    || attachmentIds.some(id => typeof id !== 'string' || !ATTACHMENT_ID.test(id))) {
    throw new Error(`image_pack requires 1 to ${MAX_PACK_IMAGES} current-session image attachment IDs`)
  }
  return { attachmentIds }
}

function packRelativePath(attachmentIds) {
  const digest = createHash('sha256').update(attachmentIds.join('\0')).digest('hex').slice(0, 12)
  return `.e-mate/images/e-Mate-images-${digest}.zip`
}

function inside(root, candidate) {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

async function imageWorkspace(agent) {
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('image packaging requires a current local workspace')
  const root = await realpath(cwd)
  const info = await lstat(root)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('current image workspace is unavailable')
  return root
}

async function imagePackDirectory(root) {
  let current = root
  for (const segment of ['.e-mate', 'images']) {
    const path = join(current, segment)
    await mkdir(path, { recursive: false, mode: 0o700 }).catch(error => {
      if (error?.code !== 'EEXIST') throw error
    })
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('image package output directory is unsafe')
    current = await realpath(path)
    if (!inside(root, current)) throw new Error('image package output directory escapes the workspace')
  }
  return current
}

function imageExtension(mediaType) {
  if (mediaType === 'image/png') return 'png'
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  throw new Error(`${mediaType} is unsupported by image packaging`)
}

async function publishImagePack(root, relativePath, data, signal) {
  if (data.byteLength < 1 || data.byteLength > MAX_PACK_BYTES + 1024 * 1024) {
    throw new Error('image package output exceeds the 101 MiB limit')
  }
  const directory = await imagePackDirectory(root)
  const target = join(directory, relativePath.slice(relativePath.lastIndexOf('/') + 1))
  const existing = await lstat(target).catch(error => {
    if (error?.code === 'ENOENT') return undefined
    throw error
  })
  if (existing !== undefined) {
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== data.byteLength
      || !Buffer.from(await readFile(target, { signal })).equals(Buffer.from(data))) {
      throw new Error('an existing image package conflicts with the current attachment set')
    }
    return
  }
  const temporary = join(directory, `.image-pack-${randomUUID()}.tmp`)
  await writeFile(temporary, data, { flag: 'wx', flush: true, mode: 0o600, signal })
  try {
    await link(temporary, target)
    const info = await lstat(target)
    if (!info.isFile() || info.isSymbolicLink()) {
      await unlink(target).catch(() => {})
      throw new Error('image package output is not a regular file')
    }
  } finally {
    await unlink(temporary).catch(() => {})
  }
}

async function createImagePack(ctx, agent, args, signal) {
  const pack = normalizePack(args)
  const refs = pack.attachmentIds.map(id => sessionImage(agent, id))
  const entries = {}
  let total = 0
  for (const [index, ref] of refs.entries()) {
    signal.throwIfAborted()
    const stored = await ctx.attachments.readImage(ref, signal)
    total += stored.data.byteLength
    if (total > MAX_PACK_BYTES) throw new Error('image package inputs exceed the 100 MiB limit')
    const name = `image-${String(index + 1).padStart(3, '0')}.${imageExtension(ref.mediaType)}`
    entries[name] = new Uint8Array(stored.data)
  }
  const relativePath = packRelativePath(pack.attachmentIds)
  const data = zipSync(entries, { level: 0 })
  await publishImagePack(await imageWorkspace(agent), relativePath, data, signal)
  return { bytes: data.byteLength, image_count: refs.length, relative_path: relativePath }
}

function detectedImage(data) {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mediaType: 'image/png', extension: 'png' }
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mediaType: 'image/jpeg', extension: 'jpg' }
  }
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mediaType: 'image/webp', extension: 'webp' }
  }
  throw new Error('e-Mate image result is not PNG, JPEG, or WebP')
}

function requestScope(exec) {
  const sessionId = String(exec.agent?.session?.header?.id ?? exec.agent?.id ?? '')
  const callId = String(exec.callId ?? '')
  if (sessionId.length === 0 || callId.length === 0) throw new Error('image generation requires a stable e-Mate Tool scope')
  const id = createHash('sha256').update(sessionId).update('\0').update(callId).digest('hex').slice(0, 32)
  return {
    'x-e-mate-task-id': `image-${id}`,
    'x-e-mate-trace-id': `image-${id}`,
    session_id: `image-${id}`,
    'x-client-request-id': `image-${id}`,
  }
}

function createImageClient({ request, root, attachments }) {
  const imageLimit = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes)
  const responseLimit = Math.ceil(imageLimit * 4 / 3) + 256 * 1024

  async function execute(task, refs, signal, scope) {
    const headers = new Headers({ accept: 'application/json', ...scope })
    let body
    let path
    if (refs.length === 0) {
      path = '/images/generations'
      headers.set('content-type', 'application/json')
      body = JSON.stringify({ model: IMAGE_MODEL, prompt: task.prompt })
    } else {
      path = '/images/edits'
      const form = new FormData()
      form.set('model', IMAGE_MODEL)
      form.set('prompt', task.prompt)
      const field = refs.length === 1 ? 'image' : 'image[]'
      for (const [index, ref] of refs.entries()) {
        if (!MEDIA_TYPES.has(ref.mediaType)) throw new Error(`${ref.mediaType} is unsupported by e-Mate image editing`)
        const stored = await attachments.readImage(ref, signal)
        if (stored.data.byteLength > MAX_EDIT_IMAGE_BYTES) throw new Error('e-Mate image edit input exceeds 5 MiB')
        const extension = ref.mediaType === 'image/png' ? 'png' : ref.mediaType === 'image/jpeg' ? 'jpg' : 'webp'
        form.append(field, new Blob([new Uint8Array(stored.data)], { type: ref.mediaType }), `image-${index + 1}.${extension}`)
      }
      body = form
    }
    const value = await responseJson(await request(endpoint(root, path), {
      method: 'POST', headers, body, redirect: 'error', signal,
    }), responseLimit, `e-Mate image ${refs.length === 0 ? 'generation' : 'edit'}`)
    if (!exactKeys(value, ['id', 'data', 'usage']) || typeof value.id !== 'string' || !IDENTIFIER.test(value.id)
      || !Array.isArray(value.data) || value.data.length !== 1 || !isRecord(value.usage)
      || !exactKeys(value.data[0], ['b64_json']) || typeof value.data[0].b64_json !== 'string'
      || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value.data[0].b64_json)) {
      throw new Error('e-Mate image response is invalid')
    }
    const data = Buffer.from(value.data[0].b64_json, 'base64')
    if (data.byteLength < 1 || data.byteLength > imageLimit
      || data.toString('base64').replace(/=+$/u, '') !== value.data[0].b64_json.replace(/=+$/u, '')) {
      throw new Error('e-Mate image response bytes are invalid')
    }
    const detected = detectedImage(data)
    const attachment = await attachments.saveImage({
      data,
      mediaType: detected.mediaType,
      name: `e-Mate-image.${detected.extension}`,
    })
    return { request_id: value.id, model: IMAGE_MODEL, image: imageRef(attachment) }
  }

  return { execute }
}

function startImageJob(ctx, owner, execSignal, operation) {
  if (owner === undefined) throw new Error('image generation requires an owning e-Mate Agent')
  let result
  const id = ctx.jobs.start({
    kind: 'emate-image',
    label: 'Generate or edit e-Mate image',
    owner,
    outputLimitBytes: 16 * 1024,
    run() {
      const controller = new AbortController()
      const onAbort = () => controller.abort(execSignal.reason)
      execSignal.addEventListener('abort', onAbort, { once: true })
      result = Promise.resolve().then(() => operation(controller.signal)).finally(() => {
        execSignal.removeEventListener('abort', onAbort)
      })
      return {
        cancel: reason => controller.abort(reason),
        done: result.then(
          value => ({
            status: 'completed',
            detail: '1 image, 0 failures',
            output: JSON.stringify({
              image_count: 1,
              failure_count: 0,
              request_ids: [value.request_id],
              attachment_ids: [value.image.attachmentId],
            }),
          }),
          error => ({
            status: controller.signal.aborted ? 'killed' : 'failed',
            detail: error instanceof Error ? error.message : String(error),
          }),
        ),
      }
    },
  })
  return { id, result }
}

const imageOutput = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      job_id: { type: 'string', required: true },
      images: { type: 'array', required: true, items: { type: 'json' } },
      failures: { type: 'array', required: true, items: { type: 'json' } },
    },
  },
  render: (_args, value) => [
    {
      type: 'text',
      text: `Generated 1 image. Current-session image attachment ID for future image_url: ${value.images[0].image.attachmentId}`,
    },
    ...value.images.map(item => ({ type: 'image', attachment: imageRef(item.image) })),
  ],
}

const imagePackOutput = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      bytes: { type: 'integer', required: true },
      image_count: { type: 'integer', required: true },
      relative_path: { type: 'string', required: true },
    },
  },
  render: (_args, value) => [{
    type: 'text',
    text: `已将 ${value.image_count} 张图片打包到本地产物：${value.relative_path}（${value.bytes} bytes）。`,
  }],
}

export async function apply(ctx, config = {}) {
  const capabilities = ctx.get('emateCapabilities')
  if (capabilities === undefined) throw new Error('e-Mate image generation requires emateCapabilities')
  let root
  let configurationError
  try {
    root = config.rootUrl === undefined ? undefined : gatewayRoot(config.rootUrl)
  } catch (error) {
    configurationError = error instanceof Error ? error.message : String(error)
  }
  ctx.effect(() => capabilities.register({
    id: 'image-generation',
    title: '生图 / 改图',
    summary: '使用企业下发的固定图像模型生成或编辑图片，结果保存在当前本地会话。',
    icon_key: 'image',
    order: 10,
    actions: [],
    status: async () => root === undefined
      ? {
          state: config.rootUrl === undefined ? 'setup-required' : 'blocked',
          detail: configurationError ?? '企业管理端尚未下发生图服务地址。',
          action_ids: [],
        }
      : { state: 'ready', detail: IMAGE_MODEL, action_ids: [] },
  }), 'emate.image: capability metadata')
  if (root === undefined) return
  const identity = ctx.get('emateIdentity')
  if (identity === undefined) throw new Error('managed image generation requires emateIdentity')
  const modelPolicy = ctx.get('emateModelPolicy')
  if (modelPolicy === undefined) throw new Error('managed image generation requires emateModelPolicy')
  const client = createImageClient({
    request: identity.request.bind(identity),
    root,
    attachments: ctx.attachments,
  })
  const bindingPath = config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json')
  const [{ defineTool }, { createUserMessage }] = await Promise.all([
    loadTargetTools(bindingPath),
    loadTargetLlm(bindingPath),
  ])
  ctx.on('agent/pre-step', async (_proposal, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const context = imageCatalogContext(decision.messages)
    return context === undefined ? decision : {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text: context }],
        source: { kind: 'plugin', plugin: '@e-mate/dsh-image-generation', form: 'catalog' },
      })],
    }
  })
  ctx.effect(() => ctx.jobs.attachController('emate-image'), 'emate.image: target Job controller')
  ctx.tools.register(defineTool({
    name: 'imagegen',
    description: 'Generate or edit one independent image through the fixed e-Mate gpt-image-2-pro route. For an edit, copy the exact sha256: value labeled as the current-session image attachment ID by a prior imagegen or job_output result into image_url; never pass its Job ID, request ID, or a URL. For multiple outputs, make separate concurrent imagegen calls. Never pass a provider, model, output path, size, quality, timeout, or concurrency policy.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'One image generation or edit instruction.' },
      image_url: {
        oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
        description: 'Optional exact sha256: current-session image attachment ID or ordered IDs from prior imagegen results for editing/reference fusion. Job IDs, request IDs, and URLs are invalid.',
      },
    },
    output: imageOutput,
    isConcurrencySafe: () => true,
    timeoutMs: IMAGE_TIMEOUT_MS,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const task = normalizeTask(args)
      task.attachmentIds = implicitEditImages(exec.agent, task)
      await modelPolicy.assertModel(IMAGE_MODEL)
      const refs = task.attachmentIds.map(id => sessionImage(exec.agent, id))
      const scope = requestScope(exec)
      const started = startImageJob(ctx, exec.agent, exec.signal, signal => client.execute(task, refs, signal, scope))
      const [image] = await Promise.all([
        started.result,
        ctx.jobs.wait(started.id, IMAGE_TIMEOUT_MS, exec.agent, exec.signal),
      ])
      return { job_id: started.id, images: [image], failures: [] }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Generate or edit image',
      kind: 'write',
      rawInput: args.prompt,
    }),
  }))
  ctx.tools.register(defineTool({
    name: 'image_pack',
    description: 'Package already-generated current-session images into one local ZIP deliverable. Copy the exact sha256: attachment IDs from the image catalog into image_url in the desired order. Do not regenerate, transform, download by URL, or ask for an output path.',
    parameters: {
      image_url: {
        type: 'array', required: true, items: { type: 'string' },
        description: 'Exact current-session sha256: image attachment IDs to include, in archive order.',
      },
    },
    output: imagePackOutput,
    isConcurrencySafe: () => false,
    timeoutMs: 120_000,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return await createImagePack(ctx, exec.agent, args, exec.signal)
    },
    presentCall: args => {
      try {
        const pack = normalizePack(args)
        const path = packRelativePath(pack.attachmentIds)
        return {
          card: 'generic', title: '打包图片', kind: 'edit', rawInput: `${pack.attachmentIds.length} images`,
          locations: [{ path }],
        }
      } catch {
        return undefined
      }
    },
  }))
}
