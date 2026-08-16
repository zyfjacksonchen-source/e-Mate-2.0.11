import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { loadTargetTools } from './target-runtime.js'

export const name = 'emate-image-generation'
export const inject = ['tools', 'jobs', 'attachments', 'emateIdentity', 'emateModelPolicy', 'emateCapabilities']

const IMAGE_MODEL = 'gpt-image-2-pro'
const MAX_PROMPT_CHARS = 20_000
const MAX_EDIT_IMAGES = 16
const MAX_EDIT_IMAGE_BYTES = 5 * 1024 * 1024
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

function sessionImage(agent, attachmentId) {
  const messages = agent?.session?.deriveMessages?.()
  if (!Array.isArray(messages)) throw new Error('image editing requires the authoritative e-Mate conversation')
  let visited = 0
  const find = blocks => {
    if (!Array.isArray(blocks)) return undefined
    for (const block of blocks) {
      if (++visited > 20_000) throw new Error('e-Mate image history exceeds the edit lookup boundary')
      if (block?.type === 'image' && validImageRef(block.attachment)
        && block.attachment.attachmentId === attachmentId) return block.attachment
      if (block?.type === 'tool-result') {
        const nested = find(block.content)
        if (nested !== undefined) return nested
      }
    }
    return undefined
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const found = find(messages[index]?.content)
    if (found !== undefined) return found
  }
  throw new Error(`image attachment ${attachmentId} is not present in this e-Mate session`)
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
  const { defineTool } = await loadTargetTools(config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json'))
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
    timeoutMs: 610_000,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const task = normalizeTask(args)
      await modelPolicy.assertModel(IMAGE_MODEL)
      const refs = task.attachmentIds.map(id => sessionImage(exec.agent, id))
      const scope = requestScope(exec)
      const started = startImageJob(ctx, exec.agent, exec.signal, signal => client.execute(task, refs, signal, scope))
      return { job_id: started.id, images: [await started.result], failures: [] }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Generate or edit image',
      kind: 'write',
      rawInput: args.prompt,
    }),
  }))
}
