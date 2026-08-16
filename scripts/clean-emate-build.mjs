import { readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const packageRoot = fileURLToPath(new URL('../packages/dsh/', import.meta.url))

rmSync(join(packageRoot, 'lib'), { recursive: true, force: true })
for (const directory of [
  join(packageRoot, 'profile', 'plugins'),
  join(packageRoot, 'profile', 'plugins', 'identity'),
]) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) rmSync(join(directory, entry.name))
  }
}
rmSync(join(packageRoot, 'profile', 'plugins', 'emate-shell', 'index.js'), { force: true })
rmSync(join(packageRoot, 'profile', 'plugins', 'emate-shell', 'node_modules', '.vite'), { recursive: true, force: true })
