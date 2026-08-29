import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'
import { withResolvedVisionGlanceImages } from '../src/attachment-source.ts'

const attachmentId = `sha256:${'a'.repeat(64)}`
const attachment = {
  attachmentId,
  mediaType: 'image/png',
  bytes: 4,
  width: 1,
  height: 1,
  name: 'generated.png',
}

test('vision_glance resolves only an exact current-session image attachment', async () => {
  const reads = []
  let stagedPath
  const signal = new AbortController().signal
  const ctx = { attachments: { async readImage(ref, nextSignal) {
    reads.push([ref, nextSignal])
    return { data: Uint8Array.of(1, 2, 3, 4) }
  } } }
  const exec = {
    signal,
    agent: { session: {
      deriveMessages: () => [],
      events: [{ type: 'emate/image-output', data: { output: attachment, content: [{ type: 'image', attachment }] } }],
    } },
  }

  const result = await withResolvedVisionGlanceImages(ctx, [attachmentId], exec, async images => {
    stagedPath = images[0]
    assert.deepEqual(await readFile(stagedPath), Buffer.from([1, 2, 3, 4]))
    return 'ok'
  })

  assert.equal(result, 'ok')
  assert.deepEqual(reads, [[attachment, signal]])
  await assert.rejects(stat(stagedPath), { code: 'ENOENT' })
})

test('vision_glance rejects an attachment id outside the current Agent session', async () => {
  const exec = { signal: new AbortController().signal, agent: { session: { deriveMessages: () => [], events: [] } } }
  await assert.rejects(
    withResolvedVisionGlanceImages({ attachments: { readImage: async () => assert.fail('must not read') } }, [attachmentId], exec, async () => {}),
    error => error?.name === 'VisionToolkitError' && error?.code === 'input'
      && /not present in the current Agent session/u.test(error.message),
  )
})

test('vision_glance leaves ordinary workspace paths unchanged and preserves cancellation', async () => {
  const paths = ['input.png']
  let received
  await withResolvedVisionGlanceImages({}, paths, {}, async images => { received = images })
  assert.equal(received, paths)

  const controller = new AbortController()
  controller.abort(new Error('cancelled by caller'))
  await assert.rejects(
    withResolvedVisionGlanceImages({}, [attachmentId], { signal: controller.signal }, async () => {}),
    /cancelled by caller/u,
  )
})
