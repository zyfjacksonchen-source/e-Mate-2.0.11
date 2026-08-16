import { copyFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const extension = fileURLToPath(new URL('..', import.meta.url))
const packageRoot = fileURLToPath(new URL('../..', import.meta.url))
const repository = fileURLToPath(new URL('../../../..', import.meta.url))
await mkdir(`${extension}/dist/assets`, { recursive: true })
await copyFile(`${extension}/manifest.json`, `${extension}/dist/manifest.json`)
await copyFile(
  `${repository}/upstream/e-mate-2.0.5/desktop/src/v1/assets/emate-mark.png`,
  `${extension}/dist/assets/icon.png`,
)
await copyFile(`${packageRoot}/README.md`, `${extension}/dist/README.txt`)
