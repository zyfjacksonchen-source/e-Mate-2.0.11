import { deflateSync } from 'node:zlib';

const width = 132;
const height = 44;
const segments: Record<string, readonly number[]> = {
  '0': [0, 1, 2, 4, 5, 6],
  '1': [2, 5],
  '2': [0, 2, 3, 4, 6],
  '3': [0, 2, 3, 5, 6],
  '4': [1, 2, 3, 5],
  '5': [0, 1, 3, 5, 6],
  '6': [0, 1, 3, 4, 5, 6],
  '7': [0, 2, 5],
  '8': [0, 1, 2, 3, 4, 5, 6],
  '9': [0, 1, 2, 3, 5, 6],
};

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const result = Buffer.allocUnsafe(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}

function paint(image: Buffer, x: number, y: number, w: number, h: number, color: readonly [number, number, number]): void {
  for (let row = Math.max(0, y); row < Math.min(height, y + h); row += 1) {
    for (let column = Math.max(0, x); column < Math.min(width, x + w); column += 1) {
      const offset = (row * width + column) * 3;
      image[offset] = color[0];
      image[offset + 1] = color[1];
      image[offset + 2] = color[2];
    }
  }
}

export function createCaptchaPng(code: string, entropy: Buffer): Buffer {
  if (!/^\d{6}$/.test(code) || entropy.length < 32) throw new Error('Invalid CAPTCHA input');
  const image = Buffer.alloc(width * height * 3, 248);
  for (let index = 0; index < 24; index += 1) {
    const x = entropy[index % entropy.length] % width;
    const y = entropy[(index + 17) % entropy.length] % height;
    paint(image, x, y, 2, 2, [218, 145 + (index % 50), 104]);
  }
  const shapes = [
    [3, 0, 10, 3], [0, 3, 3, 11], [10, 3, 3, 11], [3, 14, 10, 3],
    [0, 17, 3, 11], [10, 17, 3, 11], [3, 28, 10, 3],
  ] as const;
  [...code].forEach((digit, index) => {
    const x = 10 + index * 20 + (entropy[index] % 3);
    const y = 6 + (entropy[index + 6] % 3);
    const color = [38 + (entropy[index + 12] % 40), 38, 34] as const;
    for (const segment of segments[digit] ?? []) {
      const [left, top, w, h] = shapes[segment] as (typeof shapes)[number];
      paint(image, x + left, y + top, w, h, color);
    }
  });
  for (let x = 0; x < width; x += 1) {
    const y = 8 + ((x * 7 + entropy[30]) % 29);
    paint(image, x, y, 1, 1, [234, 88, 12]);
  }
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const target = row * (width * 3 + 1);
    raw[target] = 0;
    image.copy(raw, target + 1, row * width * 3, (row + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
