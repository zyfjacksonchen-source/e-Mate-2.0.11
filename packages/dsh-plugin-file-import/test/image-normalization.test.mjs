import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import test from 'node:test'
import { normalizedImage } from '../src/client/image.ts'

const T18_JPEG_PREFIX = Uint8Array.of(
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
  0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x48,
)
const PNG_PREFIX = Uint8Array.of(
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
)

test('normalizes the T18 JPEG signature despite a png name and declaration', async () => {
  const disguised = new File([T18_JPEG_PREFIX], 'about-final.png', { type: 'image/png' })
  const normalized = await normalizedImage(disguised, 'image/png')

  assert.equal(normalized.name, 'about-final.png')
  assert.equal(normalized.type, 'image/jpeg')
  assert.deepEqual(new Uint8Array(await normalized.arrayBuffer()), T18_JPEG_PREFIX)
})

test('keeps a true png declaration and bytes unchanged', async () => {
  const png = new File([PNG_PREFIX], 'true.png', { type: 'image/png' })
  const normalized = await normalizedImage(png, 'image/png')

  assert.strictEqual(normalized, png)
  assert.equal(normalized.type, 'image/png')
})

test('recognizes gif and webp while leaving unknown bytes for Host validation', async () => {
  const cases = [
    [Uint8Array.from(Buffer.from('GIF89a')), 'image/gif'],
    [Uint8Array.from(Buffer.from('RIFF0000WEBP')), 'image/webp'],
  ]
  for (const [bytes, mediaType] of cases) {
    const file = new File([bytes], 'image.png', { type: 'image/png' })
    assert.equal((await normalizedImage(file, 'image/png')).type, mediaType)
  }
  const damaged = new File([Uint8Array.of(1, 2, 3)], 'damaged.png', { type: 'image/png' })
  assert.strictEqual(await normalizedImage(damaged, 'image/png'), damaged)
})
