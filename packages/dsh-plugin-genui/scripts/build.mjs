import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, '../../upstream/plugins/dsh-genui')
const output = resolve(root, 'lib')
const upstreamId = '@omdsh-dev/dsh-genui'
const packageId = '@e-mate/dsh-plugin-genui'

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
await cp(resolve(source, 'lib'), output, { recursive: true })

for (const relative of ['index.js', 'client.js']) {
  const path = resolve(output, relative)
  const built = await readFile(path, 'utf8')
  await writeFile(path, built.replaceAll(upstreamId, packageId))
}

await cp(resolve(source, 'SKILL.md'), resolve(root, 'SKILL.md'))
await cp(resolve(source, 'LICENSE'), resolve(root, 'LICENSE'))
