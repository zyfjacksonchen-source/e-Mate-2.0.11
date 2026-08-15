import { chmodSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') {
  const root = dirname(dirname(fileURLToPath(import.meta.url)))
  const manifest = JSON.parse(readFileSync(resolve(root, 'emate-runtime.json'), 'utf8'))
  for (const relative of manifest.executables ?? []) {
    if (typeof relative !== 'string') throw new Error('invalid runtime executable path')
    const path = resolve(root, relative)
    if (!path.startsWith(`${root}${sep}`)) throw new Error('invalid runtime executable path')
    chmodSync(path, 0o755)
  }
}
