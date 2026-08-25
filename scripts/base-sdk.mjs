#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyChangedPaths, loadReleaseBoundary } from './change-impact.mjs'
import { verifyHarnessBuildReceipt, verifyHarnessDesktopRuntime } from './harness-provenance.mjs'

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function visitFiles(repositoryRoot, directory, include, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
    const path = join(directory, entry.name)
    const metadata = lstatSync(path)
    const relativePath = relative(repositoryRoot, path).split(sep).join('/')
    if (metadata.isSymbolicLink()) throw new Error(`base SDK must not contain symlinks: ${relativePath}`)
    if (metadata.isDirectory()) visitFiles(repositoryRoot, path, include, files)
    else if (metadata.isFile() && include(relativePath)) files.push({
      path: relativePath,
      source: path,
      executable: (metadata.mode & 0o111) !== 0,
    })
    else if (!metadata.isFile()) throw new Error(`base SDK entry is not a regular file: ${relativePath}`)
  }
}

function visitHarnessLibs(repositoryRoot, directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
    const path = join(directory, entry.name)
    const metadata = lstatSync(path)
    if (metadata.isSymbolicLink()) {
      if (entry.name === 'lib') throw new Error(`base SDK lib must not be a symlink: ${relative(repositoryRoot, path)}`)
      continue
    }
    if (!metadata.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue
    if (entry.name === 'lib') visitFiles(repositoryRoot, path, () => true, files)
    else visitHarnessLibs(repositoryRoot, path, files)
  }
}

function compiledFiles(repositoryRoot) {
  const files = []
  const upstreamRoot = join(repositoryRoot, 'upstream/deepseek-harness')
  visitHarnessLibs(repositoryRoot, upstreamRoot, files)
  const desktopRoot = join(repositoryRoot, 'desktop/e-mate-desktop')
  visitFiles(repositoryRoot, join(desktopRoot, 'lib'), () => true, files)
  const profileRoot = join(desktopRoot, 'build/e-mate-profile')
  visitFiles(repositoryRoot, profileRoot, path => {
    const local = path.slice('desktop/e-mate-desktop/build/e-mate-profile/'.length)
    return local === 'component-inventory.json'
      || local === 'cordis.patch.yml'
      || local === 'desktop-source.json'
      || local === 'bundles/registry.json'
      || local.startsWith('plugins/')
      || local.startsWith('ecosystem/')
  }, files)
  const desktopBuildRoot = join(desktopRoot, 'build')
  for (const entry of readdirSync(desktopBuildRoot, { withFileTypes: true })) {
    if (!/^(?:app-icon(?:-mac)?|tray-icon(?:Template|-blue)(?:@[0-9.]+x)?)\.png$/u.test(entry.name)) continue
    const path = join(desktopBuildRoot, entry.name)
    const metadata = lstatSync(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`base SDK icon is not a regular file: ${entry.name}`)
    files.push({
      path: relative(repositoryRoot, path).split(sep).join('/'),
      source: path,
      executable: false,
    })
  }
  for (const relativePath of [
    '.release-cache/harness-build.json',
    'desktop/e-mate-desktop/build/harness-runtime-provenance.json',
  ]) {
    const source = join(repositoryRoot, relativePath)
    const metadata = lstatSync(source)
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`base SDK provenance is not a regular file: ${relativePath}`)
    files.push({ path: relativePath, source, executable: false })
  }
  const unique = new Map(files.map(file => [file.path, file]))
  if (unique.size !== files.length || !files.some(file => file.path.startsWith('upstream/deepseek-harness/'))
    || !files.some(file => file.path.startsWith('desktop/e-mate-desktop/lib/'))
    || !files.some(file => file.path.endsWith('/build/e-mate-profile/bundles/registry.json'))
    || !files.some(file => file.path.includes('/build/e-mate-profile/plugins/'))) {
    throw new Error('accepted Base SDK build closure is incomplete')
  }
  return [...unique.values()].sort((left, right) => compareText(left.path, right.path))
}

function loadContract(root) {
  const boundary = loadReleaseBoundary(root)
  if (!boundary.valid) throw new Error(boundary.errors.join('\n'))
  return boundary.baseContract
}

/** Content key of every tracked input that the release classifier assigns to Desktop Base. */
export function baseSdkFingerprint(root) {
  root = resolve(root)
  const rows = execFileSync('git', ['ls-files', '-s', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }).split('\0').filter(Boolean).map(row => {
    const separator = row.indexOf('\t')
    const [mode, object, stage] = row.slice(0, separator).split(' ')
    const path = row.slice(separator + 1)
    if (separator < 0 || !/^\d{6}$/u.test(mode) || !/^[0-9a-f]{40,64}$/u.test(object) || stage !== '0' || path === '') {
      throw new Error('git index contains an unsupported Base SDK entry')
    }
    return { mode, object, path }
  })
  const impact = classifyChangedPaths(rows.map(row => row.path), { root })
  if (!impact.contract.valid || impact.classifications.length !== rows.length) {
    throw new Error('release boundary cannot identify the Base SDK inputs')
  }
  const digest = createHash('sha256').update('e-mate-base-sdk-input-v1\0')
  let count = 0
  const classifications = new Map(impact.classifications.map(value => [value.path, value.kind]))
  for (const row of rows.sort((left, right) => compareText(left.path, right.path))) {
    if (classifications.get(row.path) !== 'base') continue
    digest.update(`${row.mode}\0${row.object}\0${row.path}\0`)
    count += 1
  }
  if (count === 0) throw new Error('Base SDK input set is empty')
  return digest.digest('hex')
}

/** Emit the exact compiled Harness test SDK once for one Base contract. */
export function emitBaseSdk(root, output) {
  root = resolve(root)
  output = resolve(output)
  const outputRelative = relative(root, output)
  if (output === root || outputRelative === '' || outputRelative === '..' || outputRelative.startsWith(`..${sep}`)) {
    throw new Error('base SDK output must be a repository child directory')
  }
  verifyHarnessBuildReceipt(root)
  verifyHarnessDesktopRuntime(root)
  const contract = loadContract(root)
  const entries = compiledFiles(root)
  rmSync(output, { recursive: true, force: true })
  const payloadRoot = join(output, 'files')
  mkdirSync(payloadRoot, { recursive: true })
  const files = []
  let totalBytes = 0
  for (const entry of entries) {
    const bytes = readFileSync(entry.source)
    const destination = join(payloadRoot, ...entry.path.split('/'))
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(entry.source, destination)
    chmodSync(destination, entry.executable ? 0o755 : 0o644)
    totalBytes += bytes.byteLength
    files.push({
      path: entry.path,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      mode: entry.executable ? '0755' : '0644',
    })
  }
  const manifest = {
    schema_version: 2,
    base_contract_id: contract.id,
    schedule_protocol_floor: contract.schedule_protocol_floor,
    desktop_reference_commit: contract.desktop_reference.commit,
    harness_version: contract.harness_version,
    harness_commit: contract.harness_commit,
    base_contract_sha256: sha256(readFileSync(join(root, 'desktop/e-mate-desktop/base-contract.json'))),
    total_bytes: totalBytes,
    files,
  }
  writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
  return manifest
}

function validateManifest(root, input) {
  const contract = loadContract(root)
  const manifest = JSON.parse(readFileSync(join(input, 'manifest.json'), 'utf8'))
  if (manifest.schema_version !== 2
    || manifest.base_contract_id !== contract.id
    || manifest.schedule_protocol_floor !== contract.schedule_protocol_floor
    || manifest.desktop_reference_commit !== contract.desktop_reference.commit
    || manifest.harness_version !== contract.harness_version
    || manifest.harness_commit !== contract.harness_commit
    || manifest.base_contract_sha256 !== sha256(readFileSync(join(root, 'desktop/e-mate-desktop/base-contract.json')))
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0) throw new Error('base SDK manifest does not match the checked-in Base contract')
  let totalBytes = 0
  const seen = new Set()
  for (const file of manifest.files) {
    if (file === null || typeof file !== 'object' || typeof file.path !== 'string'
      || file.path === '' || file.path.startsWith('/') || file.path.split('/').includes('..')
      || !Number.isSafeInteger(file.bytes) || file.bytes < 0
      || !/^[0-9a-f]{64}$/u.test(file.sha256)
      || !['0644', '0755'].includes(file.mode)
      || seen.has(file.path)) throw new Error('base SDK manifest contains an invalid file entry')
    seen.add(file.path)
    const source = join(input, 'files', ...file.path.split('/'))
    const metadata = lstatSync(source)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== file.bytes) {
      throw new Error(`base SDK file identity is invalid: ${file.path}`)
    }
    const bytes = readFileSync(source)
    if (sha256(bytes) !== file.sha256) throw new Error(`base SDK digest mismatch: ${file.path}`)
    totalBytes += bytes.byteLength
  }
  if (totalBytes !== manifest.total_bytes) throw new Error('base SDK total byte count drifted')
  return manifest
}

/** Verify and restore a cached SDK; never builds Harness on a cache miss. */
export function installBaseSdk(root, input) {
  root = resolve(root)
  input = resolve(input)
  const manifest = validateManifest(root, input)
  for (const file of manifest.files) {
    const source = join(input, 'files', ...file.path.split('/'))
    const destination = join(root, ...file.path.split('/'))
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(source, destination)
    chmodSync(destination, file.mode === '0755' ? 0o755 : 0o644)
  }
  return manifest
}

function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!['emit', 'install', 'verify', 'fingerprint'].includes(command)) {
    throw new Error('command must be emit, install, verify, or fingerprint')
  }
  let root = fileURLToPath(new URL('..', import.meta.url))
  let directory
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    const value = args[index + 1]
    if (value === undefined || !['--root', '--directory'].includes(name)) throw new Error(`invalid argument: ${String(name)}`)
    if (name === '--root') root = value
    else directory = value
    index += 1
  }
  root = resolve(root)
  if (command === 'fingerprint') {
    if (directory !== undefined) throw new Error('fingerprint does not accept --directory')
    process.stdout.write(`${baseSdkFingerprint(root)}\n`)
    return
  }
  if (directory === undefined) throw new Error('--directory is required')
  const value = command === 'emit'
    ? emitBaseSdk(root, directory)
    : command === 'install'
      ? installBaseSdk(root, directory)
      : validateManifest(root, resolve(directory))
  process.stdout.write(`${JSON.stringify({
    schema_version: value.schema_version,
    base_contract_id: value.base_contract_id,
    schedule_protocol_floor: value.schedule_protocol_floor,
    harness_commit: value.harness_commit,
    files: value.files.length,
    total_bytes: value.total_bytes,
  })}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (cause) {
    process.stderr.write(`base-sdk: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
