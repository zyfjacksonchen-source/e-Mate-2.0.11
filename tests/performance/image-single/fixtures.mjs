import assert from 'node:assert/strict'
import { crc32, deflateSync } from 'node:zlib'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const SMALL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii')
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.byteLength)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0)
  return Buffer.concat([size, name, data, checksum])
}

export function createExactMaxPng() {
  const width = 1279
  const height = 1024
  const rows = Buffer.allocUnsafe(height * (1 + width * 4))
  let state = 0x6d2b79f5
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    rows[offset++] = 0
    for (let x = 0; x < width * 4; x += 1) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      rows[offset++] = state & 0xff
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 6, 0, 0, 0], 8)
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = pngChunk('IHDR', header)
  const idat = pngChunk('IDAT', deflateSync(rows, { level: 0 }))
  const iend = pngChunk('IEND', Buffer.alloc(0))
  const textLength = MAX_IMAGE_BYTES - (signature.byteLength + ihdr.byteLength + idat.byteLength + iend.byteLength) - 12
  assert.ok(textLength >= 9, 'exact max PNG lacks room for a valid tEXt chunk')
  const text = Buffer.alloc(textLength, 0x61)
  Buffer.from('fixture\0', 'latin1').copy(text)
  const output = Buffer.concat([signature, ihdr, pngChunk('tEXt', text), idat, iend])
  assert.equal(output.byteLength, MAX_IMAGE_BYTES)
  return output
}

export function imageResponseBody(image) {
  return Buffer.from(JSON.stringify({
    id: 'image-benchmark-response',
    data: [{ b64_json: image.toString('base64') }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  }))
}
