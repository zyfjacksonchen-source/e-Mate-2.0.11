/** Generate native tray bitmaps from the repository-owned brand SVG. */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const buildRoot = join(packageRoot, 'build')
const sourcePath = join(buildRoot, 'tray-icon.svg')
const source = await readFile(sourcePath, 'utf8')

const BRAND_ORANGE = '#F06418'
if (!source.includes(`fill="${BRAND_ORANGE}"`) || /<style\b/iu.test(source)) {
  throw new Error(`generate-tray-icons: tray-icon.svg must use the fixed brand color ${BRAND_ORANGE}`)
}

const variants = [
  ['tray-iconTemplate.png', '#000000', 16],
  ['tray-iconTemplate@2x.png', '#000000', 32],
  ['tray-icon-blue.png', BRAND_ORANGE, 16],
  ['tray-icon-blue@1.25x.png', BRAND_ORANGE, 20],
  ['tray-icon-blue@1.5x.png', BRAND_ORANGE, 24],
  ['tray-icon-blue@2x.png', BRAND_ORANGE, 32],
]

await Promise.all(variants.map(async ([filename, color, size]) => {
  const rendered = source.replaceAll(BRAND_ORANGE, color)
  await sharp(Buffer.from(rendered))
    .resize({ width: size, height: size, fit: 'contain' })
    .png({ compressionLevel: 9 })
    .toFile(join(buildRoot, filename))
}))
