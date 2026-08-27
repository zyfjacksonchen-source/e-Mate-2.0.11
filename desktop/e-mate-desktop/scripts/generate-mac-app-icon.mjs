/** Generate platform application icons from the canonical PNG. */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

/** Pixel width and height of the generated macOS icon canvas. */
export const MAC_APP_ICON_CANVAS_SIZE = 1024
/** Pixel width and height of the centered source artwork. */
export const MAC_APP_ICON_ARTWORK_SIZE = 824
/** Transparent inset on each edge of the generated macOS icon. */
export const MAC_APP_ICON_INSET = (MAC_APP_ICON_CANVAS_SIZE - MAC_APP_ICON_ARTWORK_SIZE) / 2

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const sourcePath = join(packageRoot, 'build', 'app-icon.png')
const outputPath = join(packageRoot, 'build', 'app-icon-mac.png')

const ICONSET_FILES = new Map([
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
])
export const WINDOWS_ICON_SIZES = [32, 64, 128, 256]

function createIcns(images) {
  const chunks = [
    ['icp4', 16],
    ['ic11', 32],
    ['icp5', 32],
    ['ic12', 64],
    ['ic07', 128],
    ['ic13', 256],
    ['ic08', 256],
    ['ic14', 512],
    ['ic09', 512],
    ['ic10', 1024],
  ].flatMap(([type, size]) => {
    const data = images.get(size)
    const header = Buffer.alloc(8)
    header.write(type, 0, 4, 'ascii')
    header.writeUInt32BE(data.length + header.length, 4)
    return [header, data]
  })
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(header.length + chunks.reduce((total, chunk) => total + chunk.length, 0), 4)
  return Buffer.concat([header, ...chunks])
}

function createIco(images) {
  const directorySize = 6 + images.length * 16
  const header = Buffer.alloc(directorySize)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let offset = directorySize
  images.forEach(({ data, size }, index) => {
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(data.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += data.length
  })

  return Buffer.concat([header, ...images.map(({ data }) => data)])
}

async function resizePng(input, size) {
  return sharp(input, { failOn: 'warning' })
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .keepIccProfile()
    .png({ compressionLevel: 9, progressive: false, palette: false })
    .toBuffer()
}

/**
 * Derive the macOS application icon without changing the cross-platform source.
 * @param {string} source - absolute path to the square source PNG.
 * @param {string} output - absolute path for the generated macOS PNG.
 * @returns {Promise<void>} Resolves after the complete PNG has been written.
 */
export async function generateMacAppIcon(source = sourcePath, output = outputPath) {
  if (resolve(source) === resolve(output)) {
    throw new Error('generate-mac-app-icon: output must not overwrite the source icon')
  }

  const metadata = await sharp(source).metadata()
  if (
    metadata.format !== 'png'
    || metadata.width !== MAC_APP_ICON_CANVAS_SIZE
    || metadata.height !== MAC_APP_ICON_CANVAS_SIZE
    || metadata.space !== 'rgb16'
    || metadata.depth !== 'ushort'
    || metadata.bitsPerSample !== 16
    || metadata.channels !== 4
    || metadata.hasAlpha !== true
    || metadata.icc === undefined
  ) {
    throw new Error(
      `generate-mac-app-icon: source must be a ${MAC_APP_ICON_CANVAS_SIZE}x${MAC_APP_ICON_CANVAS_SIZE} RGBA16 PNG with an ICC profile`,
    )
  }

  const rendered = await sharp(source, { failOn: 'warning' })
    .resize({
      width: MAC_APP_ICON_ARTWORK_SIZE,
      height: MAC_APP_ICON_ARTWORK_SIZE,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .extend({
      top: MAC_APP_ICON_INSET,
      bottom: MAC_APP_ICON_INSET,
      left: MAC_APP_ICON_INSET,
      right: MAC_APP_ICON_INSET,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toColourspace('rgb16')
    .keepIccProfile()
    .png({
      compressionLevel: 9,
      progressive: false,
      adaptiveFiltering: false,
      palette: false,
    })
    .toBuffer()

  const generated = await sharp(rendered).metadata()
  if (
    generated.format !== 'png'
    || generated.width !== MAC_APP_ICON_CANVAS_SIZE
    || generated.height !== MAC_APP_ICON_CANVAS_SIZE
    || generated.space !== 'rgb16'
    || generated.depth !== 'ushort'
    || generated.bitsPerSample !== 16
    || generated.channels !== 4
    || generated.hasAlpha !== true
    || generated.icc?.equals(metadata.icc) !== true
  ) {
    throw new Error('generate-mac-app-icon: generated icon did not preserve the source color data')
  }

  await writeFile(output, rendered)

  const buildRoot = dirname(output)
  const iconsetPath = join(buildRoot, 'icon.iconset')
  await rm(iconsetPath, { recursive: true, force: true })
  await mkdir(iconsetPath, { recursive: true })

  const macImages = new Map()
  for (const size of new Set(ICONSET_FILES.values())) {
    macImages.set(size, await resizePng(rendered, size))
  }
  await Promise.all([...ICONSET_FILES].map(([filename, size]) => (
    writeFile(join(iconsetPath, filename), macImages.get(size))
  )))

  await writeFile(join(buildRoot, 'icon.icns'), createIcns(macImages))

  const windowsImages = await Promise.all(WINDOWS_ICON_SIZES.map(async size => ({
    data: await resizePng(source, size),
    size,
  })))
  await writeFile(join(buildRoot, 'icon.ico'), createIco(windowsImages))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await generateMacAppIcon()
}
