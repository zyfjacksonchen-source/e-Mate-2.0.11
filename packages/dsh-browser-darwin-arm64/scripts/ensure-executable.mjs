import { chmodSync, existsSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifestPath = resolve(root, 'emate-browser.json')
if (!existsSync(manifestPath)) {
  if (existsSync(resolve(root, '..', '..', 'pnpm-workspace.yaml'))) process.exit(0)
  throw new Error('required e-Mate Browser manifest is missing')
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (process.platform !== 'win32') {
  for (const relative of manifest.executables ?? []) {
    if (typeof relative !== 'string') throw new Error('invalid browser executable path')
    const path = resolve(root, relative)
    if (!path.startsWith(`${root}${sep}`)) throw new Error('invalid browser executable path')
    chmodSync(path, 0o755)
  }
}
