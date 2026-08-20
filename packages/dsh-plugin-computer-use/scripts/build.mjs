import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, '../../upstream/plugins/dsh-computer-use')
const harness = resolve(root, '../../upstream/deepseek-harness')
const bundleRuntime = () => {
  const result = spawnSync(process.execPath, [
    resolve(harness, 'node_modules/tsdown/dist/run.mjs'),
    '--config', join(root, 'tsdown.runtime.config.ts'),
  ], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) throw new Error(`runtime bundle failed:\n${result.stdout}${result.stderr}`)
}

for (const name of ['lib', 'assets', 'docs']) {
  await rm(join(root, name), { recursive: true, force: true })
  await cp(join(upstream, name), join(root, name), { recursive: true })
}
if (process.platform === 'darwin') {
  await rm(join(root, 'native'), { recursive: true, force: true })
  await cp(join(upstream, 'native'), join(root, 'native'), { recursive: true })
}
await mkdir(join(root, 'scripts'), { recursive: true })
await cp(join(upstream, 'scripts/build-native.mjs'), join(root, 'scripts/build-native.mjs'))
await cp(join(upstream, 'LICENSE'), join(root, 'LICENSE'))
if (process.platform === 'darwin') {
  const helper = join(root, 'native/macos/bin/dsh-computer-use-helper')
  const nativeManifestPath = join(root, 'native/macos/manifest.json')
  const nativeManifest = JSON.parse(await readFile(nativeManifestPath, 'utf8'))
  nativeManifest.binary.sha256 = createHash('sha256').update(await readFile(helper)).digest('hex')
  await writeFile(nativeManifestPath, `${JSON.stringify(nativeManifest, null, 2)}\n`)
}
let client = await readFile(join(root, 'lib/client.js'), 'utf8')
client = client.replaceAll('@anionex/dsh-computer-use', '@e-mate/dsh-plugin-computer-use')
await writeFile(join(root, 'lib/client.js'), client)

function replaceExactlyOnce(source, before, after, label) {
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`computer-use adapter expected one ${label} seam, found ${count}`)
  return source.replace(before, after)
}
const indexPath = join(root, 'lib/index.js')
bundleRuntime()
let runtime = await readFile(join(root, '.runtime-bundle/index.js'), 'utf8')
runtime = replaceExactlyOnce(runtime, 'new URL("../../native/macos/", import.meta.url)', 'new URL("../native/macos/", import.meta.url)', 'bundled native path')
runtime = replaceExactlyOnce(runtime, 'new URL("../../scripts/build-native.mjs", import.meta.url)', 'new URL("../scripts/build-native.mjs", import.meta.url)', 'bundled native builder path')
await writeFile(indexPath, runtime)
await rm(join(root, '.runtime-bundle'), { recursive: true, force: true })
