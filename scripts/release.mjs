#!/usr/bin/env node

// e-Mate release carrier. Runtime structure stays owned by DeepSeek Harness;
// this file only verifies, inventories and publishes the one packed npm artifact.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { PACKAGE_NAME, releaseSource } from './release-source.mjs'

export const VERSION = '2.0.11'
const HARNESS_VERSION = '0.1.0-rc.7'
const HARNESS_COMMIT = 'df78045a127e32cb5b942defba52c539590d1596'
const REPOSITORY = 'zyfjacksonchen-source/e-Mate-2.0.11'
const TAG = `e-mate-v${VERSION}`
const SHA256 = /^[0-9a-f]{64}$/u
const GIT_COMMIT = /^[0-9a-f]{40}$/u

export function isAcceptedReleaseCommit(environment = process.env) {
  const sourceCommit = environment.GITHUB_SHA ?? ''
  return GIT_COMMIT.test(sourceCommit) && environment.EMATE_ACCEPTED_SHA === sourceCommit
}

export const RELEASE_PACKAGES = [
  { name: '@e-mate/dsh', kind: 'main' },
]
const COMPONENT_INVENTORY = JSON.parse(readFileSync(
  fileURLToPath(new URL('../packages/dsh/profile/component-inventory.json', import.meta.url)),
  'utf8',
))
if (COMPONENT_INVENTORY.schema_version !== 1 || !Array.isArray(COMPONENT_INVENTORY.components)) {
  throw new Error('component inventory is invalid')
}
export const BUNDLED_PLUGIN_PACKAGES = COMPONENT_INVENTORY.components
  .filter(component => component.cli === true)
  .map(component => component.id)
const BUNDLED_MAIN_COMPONENTS = [
  { name: 'qrcode', version: '1.5.4', license: 'MIT' },
  { name: 'dijkstrajs', version: '1.0.3', license: 'MIT' },
  { name: 'pngjs', version: '5.0.0', license: 'MIT' },
]
export const TARGET_NATIVE_RUNTIME_FILES = [
  '@img/sharp-darwin-arm64/lib/sharp-darwin-arm64-0.35.3.node',
  '@img/sharp-darwin-x64/lib/sharp-darwin-x64-0.35.3.node',
  '@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.3.node',
  '@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.3.dylib',
  '@img/sharp-libvips-darwin-x64/lib/libvips-cpp.8.18.3.dylib',
  '@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node',
  '@koromix/koffi-darwin-x64/darwin_x64/koffi.node',
  '@koromix/koffi-win32-x64/win32_x64/koffi.node',
  '@vscode/ripgrep-darwin-arm64/bin/rg',
  '@vscode/ripgrep-darwin-x64/bin/rg',
  '@vscode/ripgrep-win32-x64/bin/rg.exe',
  'node-addon-require-builtin-darwin-arm64/prebuilt/darwin-arm64-napi-v9.node',
  'node-addon-require-builtin-darwin-x64/prebuilt/darwin-x64-napi-v9.node',
  'node-addon-require-builtin-win32-x64-msvc/prebuilt/win32-x64-msvc-napi-v9.node',
  'node-pty/prebuilds/darwin-arm64/pty.node',
  'node-pty/prebuilds/darwin-x64/pty.node',
  'node-pty/prebuilds/win32-x64/conpty.node',
  'node-pty/prebuilds/win32-x64/conpty_console_list.node',
  'node-pty/prebuilds/win32-x64/conpty/conpty.dll',
  'node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe',
]

const TRANSIENT_PUBLISH_CODES = ['E409', 'E429', 'E500', 'E502', 'E503', 'E504', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']
const PUBLISH_ATTEMPTS = 4
const PUBLISH_SPACING_MS = 2_000

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${basename(command)} ${args.join(' ')} exited with ${String(result.status)}:\n${result.stdout}${result.stderr}`)
  }
  return result.stdout.trim()
}

export function assertEvidenceSource(environment = process.env, execute = run) {
  const head = execute('git', ['rev-parse', 'HEAD'])
  const sourceCommit = environment.GITHUB_SHA ?? head
  if (!GIT_COMMIT.test(sourceCommit) || sourceCommit !== head) {
    throw new Error('release evidence source commit does not match the checked-out HEAD')
  }
  if (execute('git', ['status', '--porcelain=v1', '--untracked-files=normal']) !== '') {
    throw new Error('release evidence requires a clean worktree')
  }
  return sourceCommit
}

function attempt(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })
  if (result.error !== undefined) throw result.error
  return result
}

function hash(path, algorithm, encoding = 'hex') {
  return createHash(algorithm).update(readFileSync(path)).digest(encoding)
}

function tarballName(name) {
  const unscoped = name.startsWith('@') ? name.slice(1).replace('/', '-') : name
  return `${unscoped}-${VERSION}.tgz`
}

function tarEntries(path) {
  const entries = run('tar', ['-tzf', path]).split(/\r?\n/u).filter(Boolean)
  if (entries.length === 0) throw new Error(`${path} is empty`)
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/')
    if (!normalized.startsWith('package/') || normalized.startsWith('/') || normalized.split('/').includes('..') || normalized.includes('\0')) {
      throw new Error(`${path} contains unsafe entry ${entry}`)
    }
  }
  const verbose = run('tar', ['-tvzf', path]).split(/\r?\n/u).filter(Boolean)
  if (verbose.some(line => line[0] !== '-' && line[0] !== 'd')) {
    throw new Error(`${path} contains a link or unsupported tar entry`)
  }
  return entries
}

function tarText(path, entry) {
  return run('tar', ['-xOzf', path, entry])
}

function tarJson(path, entry) {
  const parsed = JSON.parse(tarText(path, entry))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path}:${entry} is not a JSON object`)
  }
  return parsed
}

function requireEntry(entries, entry, packageName) {
  if (!entries.includes(entry)) throw new Error(`${packageName} is missing ${entry}`)
}

function verifyMain(item, manifest, entries) {
  if (entries.some(entry => entry.startsWith('package/runtime/.harness-build-'))) {
    throw new Error('@e-mate/dsh contains a temporary Harness build directory')
  }
  const optional = Object.keys(manifest.optionalDependencies ?? {})
  if (optional.some(name => /^@e-mate\/dsh-(?:runtime|browser)-/u.test(name))) {
    throw new Error('@e-mate/dsh must not depend on legacy Runtime or Browser platform packages')
  }
  for (const entry of [
    'package/lib/bin.js',
    'package/lib/release-source.json',
    'package/profile/cordis.patch.yml',
    'package/profile/plugins/emate-shell/index.js',
    'package/profile/bundles/registry.json',
    'package/runtime/source-manifest.json',
    'package/runtime/harness/apps/cli/lib/bin.js',
    'package/THIRD_PARTY_NOTICES.txt',
  ]) requireEntry(entries, entry, item.name)
  for (const entry of TARGET_NATIVE_RUNTIME_FILES) {
    requireEntry(entries, `package/runtime/harness/node_modules/${entry}`, item.name)
  }
  const harness = tarJson(item.path, 'package/runtime/source-manifest.json')
  if (harness.version !== HARNESS_VERSION || harness.commit !== HARNESS_COMMIT || harness.product_version !== VERSION) {
    throw new Error('@e-mate/dsh carries the wrong DeepSeek Harness closure')
  }
  const source = tarJson(item.path, 'package/lib/release-source.json')
  const expectedSource = releaseSource(source.source_commit)
  if (JSON.stringify(source) !== JSON.stringify(expectedSource)) {
    throw new Error('@e-mate/dsh carries an invalid immutable release source')
  }
  const registry = tarJson(item.path, 'package/profile/bundles/registry.json')
  const actualPlugins = Array.isArray(registry.packages) ? registry.packages.map(plugin => plugin?.name).sort() : []
  if (registry.schema_version !== 1 || registry.product !== 'e-Mate' || registry.version !== VERSION
    || registry.harness_version !== HARNESS_VERSION || registry.harness_commit !== HARNESS_COMMIT
    || JSON.stringify(actualPlugins) !== JSON.stringify([...BUNDLED_PLUGIN_PACKAGES].sort())) {
    throw new Error('@e-mate/dsh carries the wrong embedded plugin bundle registry')
  }
  for (const plugin of registry.packages) {
    if (plugin.version !== VERSION || typeof plugin.directory !== 'string' || plugin.directory === '') {
      throw new Error('@e-mate/dsh embedded plugin receipt is invalid')
    }
    const base = `package/profile/bundles/${plugin.directory}`
    requireEntry(entries, `${base}/package.json`, plugin.name)
    const pluginManifest = tarJson(item.path, `${base}/package.json`)
    if (pluginManifest.name !== plugin.name || pluginManifest.version !== VERSION || pluginManifest.license !== 'MIT'
      || typeof pluginManifest.main !== 'string') {
      throw new Error(`${plugin.name} embedded bundle identity is invalid`)
    }
    requireEntry(entries, `${base}/${pluginManifest.main}`, plugin.name)
  }
  return { harness, registry, releaseSource: source }
}

export function verifyRelease(directory) {
  const root = resolve(directory)
  const filenames = readdirSync(root).filter(name => name.endsWith('.tgz')).sort()
  const expectedNames = RELEASE_PACKAGES.map(item => tarballName(item.name)).sort()
  if (JSON.stringify(filenames) !== JSON.stringify(expectedNames)) {
    throw new Error(`release tarball set is incomplete or contains extras\nexpected: ${expectedNames.join(', ')}\nactual: ${filenames.join(', ')}`)
  }

  return RELEASE_PACKAGES.map(expected => {
    const path = join(root, tarballName(expected.name))
    const entries = tarEntries(path)
    const manifest = tarJson(path, 'package/package.json')
    if (manifest.name !== expected.name || manifest.version !== VERSION || manifest.license !== 'MIT'
      || manifest.publishConfig?.access !== 'public') {
      throw new Error(`${path} has the wrong package identity, version, license or access`)
    }
    requireEntry(entries, 'package/LICENSE', expected.name)
    requireEntry(entries, 'package/README.md', expected.name)
    const item = { ...expected, path, filename: basename(path) }
    const detail = verifyMain(item, manifest, entries)
    return {
      ...item,
      manifest,
      entries,
      ...detail,
      size: statSync(path).size,
      sha256: hash(path, 'sha256'),
      sha512: hash(path, 'sha512'),
      integrity: `sha512-${hash(path, 'sha512', 'base64')}`,
    }
  })
}

function rawLicense(manifest) {
  if (typeof manifest.license === 'string' && manifest.license !== '') return manifest.license
  if (Array.isArray(manifest.licenses)) {
    const values = manifest.licenses.map(item => typeof item === 'string' ? item : item?.type).filter(Boolean)
    if (values.length > 0) return values.join(' OR ')
  }
  return 'NOASSERTION'
}

function spdxLicense(value) {
  return /^(?:MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|MPL-2\.0|PSF-2\.0|0BSD|Zlib|CC0-1\.0)(?:(?: AND | OR )(?:MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|MPL-2\.0|PSF-2\.0|0BSD|Zlib|CC0-1\.0))*$/u.test(value)
    ? value
    : 'NOASSERTION'
}

function componentId(key) {
  return `SPDXRef-Package-${createHash('sha256').update(key).digest('hex').slice(0, 20)}`
}

function addComponent(components, input) {
  const key = `${input.ecosystem}:${input.name}@${input.version}`
  const existing = components.get(key)
  if (existing !== undefined) {
    if (existing.license === 'NOASSERTION' && input.license !== 'NOASSERTION') existing.license = input.license
    if (input.owner !== undefined && !existing.owners.includes(input.owner)) existing.owners.push(input.owner)
    return existing
  }
  const component = {
    key,
    id: componentId(key),
    license: 'NOASSERTION',
    ...input,
    owners: input.owner === undefined ? [] : [input.owner],
  }
  components.set(key, component)
  return component
}

function walkPackageJson(root, directory = root, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walkPackageJson(root, path, output)
    else if (entry.isFile() && entry.name === 'package.json') output.push(path)
  }
  return output
}

async function packedComponents(main, components) {
  const scratch = await mkdtemp(join(tmpdir(), 'e-mate-release-main-'))
  try {
    run('tar', ['-xzf', main.path, '-C', scratch])
    const roots = [
      join(scratch, 'package', 'runtime', 'harness'),
      join(scratch, 'package', 'profile', 'bundles'),
    ]
    for (const path of roots.flatMap(root => walkPackageJson(root))) {
      const manifest = JSON.parse(await readFile(path, 'utf8'))
      if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') continue
      addComponent(components, {
        ecosystem: 'npm',
        name: manifest.name,
        version: manifest.version,
        license: rawLicense(manifest),
        owner: main.name,
      })
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

function gitCreated() {
  const epoch = process.env.SOURCE_DATE_EPOCH ?? run('git', ['show', '-s', '--format=%ct', 'HEAD'])
  if (!/^\d+$/u.test(epoch)) throw new Error('SOURCE_DATE_EPOCH must be an integer')
  return new Date(Number(epoch) * 1000).toISOString().replace('.000Z', 'Z')
}

function spdxPackage(component, archive) {
  const declared = spdxLicense(component.license)
  const item = {
    name: component.name,
    SPDXID: component.id,
    versionInfo: component.version,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: declared,
    copyrightText: 'NOASSERTION',
    comment: `ecosystem=${component.ecosystem}; declared=${component.license}`,
  }
  if (archive !== undefined) {
    item.packageFileName = archive.filename
    item.checksums = [
      { algorithm: 'SHA256', checksumValue: archive.sha256 },
      { algorithm: 'SHA512', checksumValue: archive.sha512 },
    ]
  }
  return item
}

export async function generateEvidence(directory, outputDirectory, sourceCommit = assertEvidenceSource()) {
  const release = verifyRelease(directory)
  const output = resolve(outputDirectory)
  await mkdir(output, { recursive: true })
  const components = new Map()
  const owners = new Map()

  for (const archive of release) {
    owners.set(archive.name, addComponent(components, {
      ecosystem: 'npm', name: archive.name, version: VERSION, license: 'MIT', owner: undefined,
    }))
  }
  const main = release.find(item => item.kind === 'main')
  if (main.releaseSource.source_commit !== sourceCommit || main.releaseSource.package_name !== PACKAGE_NAME) {
    throw new Error('packed release source does not match the evidence commit')
  }
  await packedComponents(main, components)
  for (const [name, version] of Object.entries(main.manifest.dependencies ?? {})) {
    addComponent(components, { ecosystem: 'npm', name, version, license: 'NOASSERTION', owner: main.name })
  }
  for (const component of BUNDLED_MAIN_COMPONENTS) {
    addComponent(components, { ecosystem: 'npm', ...component, owner: main.name })
  }
  const releaseDigest = createHash('sha256')
    .update(release.map(item => `${item.filename}\0${item.sha256}\n`).join(''))
    .digest('hex')
  const relationships = []
  for (const owner of owners.values()) {
    relationships.push({ spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: owner.id })
  }
  for (const component of components.values()) {
    for (const ownerName of component.owners) {
      const owner = owners.get(ownerName)
      if (owner !== undefined && owner.id !== component.id) {
        relationships.push({
          spdxElementId: owner.id,
          relationshipType: ownerName === main.name ? 'DEPENDS_ON' : 'CONTAINS',
          relatedSpdxElement: component.id,
        })
      }
    }
  }
  const archivesByName = new Map(release.map(item => [item.name, item]))
  const orderedComponents = [...components.values()].sort((left, right) => left.key.localeCompare(right.key))
  const spdx = {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `e-Mate-${VERSION}`,
    documentNamespace: `https://github.com/${REPOSITORY}/spdx/e-mate-${VERSION}-${releaseDigest}`,
    creationInfo: { created: gitCreated(), creators: ['Tool: e-Mate-release-evidence'] },
    packages: orderedComponents.map(component => spdxPackage(component, archivesByName.get(component.name))),
    relationships,
  }
  const manifest = {
    schema_version: 1,
    product: 'e-Mate',
    version: VERSION,
    repository: REPOSITORY,
    source_commit: sourceCommit,
    harness: { version: HARNESS_VERSION, commit: HARNESS_COMMIT },
    release_sha256: releaseDigest,
    download: {
      ...main.releaseSource,
      sha256: main.sha256,
      sha512: main.sha512,
      integrity: main.integrity,
      size: main.size,
    },
    publish_order: release.map(item => item.name),
    packages: release.map(({ name, kind, os, cpu, filename, size, sha256, sha512, integrity }) => ({
      name, version: VERSION, kind, ...(os === undefined ? {} : { os, cpu }), filename, size, sha256, sha512, integrity,
    })),
    evidence: ['SHA256SUMS', 'e-mate-2.0.11.spdx.json', 'THIRD_PARTY_LICENSES.txt', 'EVIDENCE_SHA256SUMS'],
  }
  const sums = `${release.map(item => `${item.sha256}  ${item.filename}`).sort().join('\n')}\n`
  const licenses = [
    `e-Mate ${VERSION} third-party license inventory`,
    'Full license and notice texts remain inside the corresponding npm tarball.',
    '',
    ...orderedComponents.map(item => `${item.ecosystem}:${item.name}@${item.version} — ${item.license}`),
    '',
  ].join('\n')
  const files = {
    SHA256SUMS: sums,
    'release-manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'e-mate-2.0.11.spdx.json': `${JSON.stringify(spdx, null, 2)}\n`,
    'THIRD_PARTY_LICENSES.txt': licenses,
  }
  for (const [name, content] of Object.entries(files)) await writeFile(join(output, name), content)
  const evidenceSums = Object.keys(files).sort()
    .map(name => `${hash(join(output, name), 'sha256')}  ${name}`).join('\n')
  await writeFile(join(output, 'EVIDENCE_SHA256SUMS'), `${evidenceSums}\n`)
  console.log(`e-Mate release evidence: ${release.length} tarballs, ${orderedComponents.length} SBOM components`)
  return { release, manifest, spdx }
}

function registryState(name, version) {
  const result = attempt('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json'])
  const output = `${result.stdout}${result.stderr}`
  if (result.status !== 0) {
    if (output.includes('E404') || output.includes('404 Not Found')) return { kind: 'absent' }
    throw new Error(`npm view ${name}@${version} failed:\n${output}`)
  }
  const parsed = JSON.parse(result.stdout)
  if (typeof parsed !== 'string' || parsed === '') throw new Error(`registry returned no integrity for ${name}@${version}`)
  return { kind: 'present', integrity: parsed }
}

function authorizePublication() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== REPOSITORY
    || process.env.GITHUB_REF_TYPE !== 'tag' || process.env.GITHUB_REF_NAME !== TAG) {
    throw new Error(`publication is allowed only by GitHub Actions in ${REPOSITORY} from tag ${TAG}`)
  }
  if (!isAcceptedReleaseCommit()) {
    throw new Error('EMATE_S12_ACCEPTED_SHA must equal the release commit before publication')
  }
  if (!process.env.NODE_AUTH_TOKEN) throw new Error('NODE_AUTH_TOKEN is required for publication')
  const registry = run('npm', ['config', 'get', 'registry'])
  if (registry !== 'https://registry.npmjs.org/') throw new Error(`publication registry must be npmjs.org, got ${registry}`)
}

function isTransient(output) {
  return TRANSIENT_PUBLISH_CODES.some(code => output.includes(`code ${code}`))
}

async function publishTarball(item) {
  for (let attemptNumber = 1; attemptNumber <= PUBLISH_ATTEMPTS; attemptNumber += 1) {
    const result = attempt('npm', ['publish', item.path, '--provenance', '--loglevel=error'])
    const output = `${result.stdout}${result.stderr}`
    if (result.status === 0) return
    const settled = registryState(item.name, VERSION)
    if (settled.kind === 'present' && settled.integrity === item.integrity) return
    if (attemptNumber === PUBLISH_ATTEMPTS || !isTransient(output)) {
      throw new Error(`npm publish ${item.name}@${VERSION} failed:\n${output}`)
    }
    await sleep(PUBLISH_SPACING_MS * 2 ** (attemptNumber - 1))
  }
}

export async function publishRelease(directory) {
  authorizePublication()
  const release = verifyRelease(directory)
  let published = 0
  for (const item of release) {
    const state = registryState(item.name, VERSION)
    if (state.kind === 'present') {
      if (state.integrity !== item.integrity) {
        throw new Error(`${item.name}@${VERSION} already exists with different content`)
      }
      console.log(`e-Mate release: ${item.name}@${VERSION} already published, skipping`)
      continue
    }
    if (published > 0) await sleep(PUBLISH_SPACING_MS)
    await publishTarball(item)
    console.log(`e-Mate release: published ${item.name}@${VERSION}`)
    published += 1
  }
  for (const item of release) {
    const state = registryState(item.name, VERSION)
    if (state.kind !== 'present' || state.integrity !== item.integrity) {
      throw new Error(`npm readback failed for ${item.name}@${VERSION}`)
    }
  }
  console.log(`e-Mate release: registry readback passed for ${release.length} packages`)
}

async function main() {
  const { values, positionals } = parseArgs({
    options: { from: { type: 'string' }, out: { type: 'string' } },
    allowPositionals: true,
  })
  const [command] = positionals
  if (values.from === undefined) throw new Error('usage: release.mjs <evidence|publish> --from <tarball directory> [--out <evidence directory>]')
  if (command === 'evidence') {
    if (values.out === undefined) throw new Error('evidence requires --out')
    await generateEvidence(values.from, values.out)
  } else if (command === 'publish') {
    if (values.out !== undefined) throw new Error('publish does not accept --out')
    await publishRelease(values.from)
  } else {
    throw new Error(`unknown release command ${JSON.stringify(command)}`)
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main()
}
