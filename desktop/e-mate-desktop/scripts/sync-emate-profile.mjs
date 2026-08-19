import { cp, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const repositoryRoot = resolve(desktopRoot, '..', '..')
const source = join(repositoryRoot, 'packages', 'dsh', 'profile')
const destination = join(desktopRoot, 'build', 'e-mate-profile')
const mark = join(source, 'plugins', 'emate-shell', 'assets', 'emate-mark.png')
const browserExtension = join(repositoryRoot, 'packages', 'dsh-plugin-browser', 'extension', 'dist')
const require = createRequire(import.meta.url)
const desktopManifest = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8'))
const version = desktopManifest.version
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(version)) {
  throw new Error('sync-emate-profile: desktop package version must be a stable semantic version')
}
const ecosystemPlugins = [
  '@kelearns/dsh-navigation-bar',
  '@omdsh-dev/dsh-genui',
  'dsh-at-file',
  'dsh-better-sidebar',
  'dsh-file-viewer',
  'dsh-search-mcp',
  'dsh-turn-fold',
  'dsh-visualize',
]

for (const path of [
  join(source, 'cordis.patch.yml'),
  join(source, 'bundles', 'registry.json'),
  join(source, 'plugins', 'health.js'),
  join(source, 'plugins', 'emate-shell', 'lib', 'client.js'),
  join(browserExtension, 'manifest.json'),
  mark,
]) {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
    throw new Error(`sync-emate-profile: required build output is invalid: ${path}`)
  }
}

await rm(destination, { recursive: true, force: true })
await mkdir(dirname(destination), { recursive: true })
await cp(source, destination, {
  recursive: true,
  force: true,
  dereference: false,
  filter: async path => !(await lstat(path)).isSymbolicLink(),
})
await cp(browserExtension, join(destination, 'browser-extension'), {
  recursive: true,
  force: true,
  dereference: false,
  filter: async path => !(await lstat(path)).isSymbolicLink(),
})

for (const name of ecosystemPlugins) {
  const packageRoot = dirname(require.resolve(`${name}/package.json`))
  await cp(packageRoot, join(destination, 'ecosystem', name), {
    recursive: true,
    force: true,
    dereference: true,
  })
}

const registry = JSON.parse(await readFile(join(destination, 'bundles', 'registry.json'), 'utf8'))
if (registry.product !== 'e-Mate' || registry.version !== version
  || registry.harness_commit !== 'df78045a127e32cb5b942defba52c539590d1596') {
  throw new Error('sync-emate-profile: bundled e-Mate profile identity drifted')
}

const sourceBytes = await sharp(await readFile(mark), { failOn: 'warning' })
  .resize({ width: 720, height: 720, fit: 'contain' })
  .png()
  .toBuffer()
const roundedSurface = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <rect x="32" y="32" width="960" height="960" rx="224" fill="#000000"/>
  </svg>
`)
await sharp(roundedSurface, { failOn: 'warning' })
  .composite([{ input: sourceBytes, left: 152, top: 152 }])
  .toColourspace('rgb16')
  .withIccProfile('srgb')
  .png({ compressionLevel: 9, palette: false })
  .toFile(join(desktopRoot, 'build', 'app-icon.png'))

await writeFile(join(destination, 'desktop-source.json'), `${JSON.stringify({
  schema_version: 1,
  product: 'e-Mate',
  version,
  harness_commit: registry.harness_commit,
  registry_sha256: createHash('sha256')
    .update(await readFile(join(destination, 'bundles', 'registry.json')))
    .digest('hex'),
}, null, 2)}\n`)
