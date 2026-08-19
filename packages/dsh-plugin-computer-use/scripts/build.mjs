import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, '../../upstream/plugins/dsh-computer-use')

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
const entitlements = join(root, 'native/macos/helper-entitlements.plist')
await cp(join(root, 'overrides/helper-entitlements.plist'), entitlements)
const nativeBuilderPath = join(root, 'scripts/build-native.mjs')
let nativeBuilder = await readFile(nativeBuilderPath, 'utf8')
nativeBuilder = nativeBuilder
  .replace(
    "const HELPER_OUTPUT = join(NATIVE, 'bin', 'dsh-computer-use-helper')",
    "const HELPER_OUTPUT = join(NATIVE, 'bin', 'dsh-computer-use-helper')\nconst HELPER_ENTITLEMENTS = join(NATIVE, 'helper-entitlements.plist')",
  )
  .replace(
    "await run('codesign', ['--force', '--sign', '-', '--timestamp=none', HELPER_OUTPUT])",
    "await run('codesign', ['--force', '--sign', '-', '--timestamp=none', '--options', 'runtime', '--entitlements', HELPER_ENTITLEMENTS, HELPER_OUTPUT])",
  )
await writeFile(nativeBuilderPath, nativeBuilder)
const helper = join(root, 'native/macos/bin/dsh-computer-use-helper')
if (process.platform === 'darwin') {
  execFileSync('/usr/bin/codesign', [
    '--force', '--sign', '-', '--timestamp=none', '--options', 'runtime', '--entitlements', entitlements, helper,
  ], { stdio: 'inherit' })
}
const nativeManifestPath = join(root, 'native/macos/manifest.json')
const nativeManifest = JSON.parse(await readFile(nativeManifestPath, 'utf8'))
nativeManifest.binary.sha256 = createHash('sha256').update(await readFile(helper)).digest('hex')
await writeFile(nativeManifestPath, `${JSON.stringify(nativeManifest, null, 2)}\n`)
let client = await readFile(join(root, 'lib/client.js'), 'utf8')
client = client.replaceAll('@anionex/dsh-computer-use', '@e-mate/dsh-plugin-computer-use')
await writeFile(join(root, 'lib/client.js'), client)
