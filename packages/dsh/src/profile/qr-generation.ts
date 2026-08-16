import { join } from 'node:path'
import QRCode from 'qrcode'
import { loadTargetTools } from './target-runtime.js'

export const name = 'emate-qr-generation'
export const inject = ['tools', 'jobs', 'attachments']

const MAX_CONTENT_BYTES = 1024
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function normalizeContent(args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).length !== 1 || typeof args.content !== 'string') {
    throw new Error('QR generation accepts only content')
  }
  const content = args.content.trim()
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes < 1 || bytes > MAX_CONTENT_BYTES || content.includes('\0')) {
    throw new Error(`QR content must contain 1 to ${MAX_CONTENT_BYTES} UTF-8 bytes`)
  }
  return content
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

function startQrJob(ctx, owner, execSignal, content) {
  if (owner === undefined) throw new Error('QR generation requires an owning e-Mate Agent')
  let result
  const id = ctx.jobs.start({
    kind: 'emate-qr',
    label: 'Generate e-Mate QR code',
    owner,
    outputLimitBytes: 1024,
    run() {
      const controller = new AbortController()
      const onAbort = () => controller.abort(execSignal.reason)
      execSignal.addEventListener('abort', onAbort, { once: true })
      result = Promise.resolve().then(async () => {
        controller.signal.throwIfAborted()
        const data = await QRCode.toBuffer(content, {
          type: 'png', errorCorrectionLevel: 'M', margin: 2, width: 512,
        })
        controller.signal.throwIfAborted()
        if (!Buffer.isBuffer(data) || data.byteLength < PNG_SIGNATURE.byteLength
          || data.byteLength > 2 * 1024 * 1024 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) {
          throw new Error('QR encoder did not return a valid PNG')
        }
        return imageRef(await ctx.attachments.saveImage({
          data,
          mediaType: 'image/png',
          name: 'e-Mate-qr.png',
        }))
      }).finally(() => execSignal.removeEventListener('abort', onAbort))
      return {
        cancel: reason => controller.abort(reason),
        done: result.then(
          () => ({ status: 'completed', detail: '1 QR code', output: '{"image_count":1}' }),
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

const qrOutput = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      job_id: { type: 'string', required: true },
      image: { type: 'json', required: true },
    },
  },
  render: (_args, value) => [
    { type: 'text', text: '二维码已生成。' },
    { type: 'image', attachment: imageRef(value.image) },
  ],
}

export async function apply(ctx, config = {}) {
  const { defineTool } = await loadTargetTools(config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json'))
  ctx.effect(() => ctx.jobs.attachController('emate-qr'), 'emate.qr: target Job controller')
  ctx.tools.register(defineTool({
    name: 'e_mate_qr_generate',
    description: 'Create one PNG QR code for non-sensitive text or a URL and save it to the current e-Mate conversation. The Tool input is persisted in the session, so never encode passwords, API keys, access or refresh tokens, recovery codes, private keys, or session cookies.',
    parameters: {
      content: { type: 'string', required: true, description: `Text or URL, at most ${MAX_CONTENT_BYTES} UTF-8 bytes.` },
    },
    output: qrOutput,
    isConcurrencySafe: () => true,
    timeoutMs: 15_000,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const started = startQrJob(ctx, exec.agent, exec.signal, normalizeContent(args))
      return { job_id: started.id, image: await started.result }
    },
    presentCall: () => ({ card: 'generic', title: '生成二维码', kind: 'write' }),
  }))
}
