#!/usr/bin/env node

import { createHash } from 'node:crypto'
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
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { componentJobsFor, loadReleaseBoundary } from './change-impact.mjs'

const SHA40 = /^[0-9a-f]{40}$/u

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function comparePath(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function safeRelativePath(path) {
  return typeof path === 'string'
    && path !== ''
    && !path.includes('\0')
    && !isAbsolute(path)
    && !path.split(/[\\/]/u).includes('..')
}

function walkAllowedEntry(packageRoot, entry, paths) {
  if (!safeRelativePath(entry)) throw new Error(`unsafe component files entry: ${String(entry)}`)
  if (entry.split(/[\\/]/u).includes('__pycache__') || entry.endsWith('.pyc')) return
  const source = join(packageRoot, entry)
  const metadata = lstatSync(source)
  if (metadata.isSymbolicLink()) throw new Error(`component files must not contain symlinks: ${entry}`)
  if (metadata.isDirectory()) {
    for (const child of readdirSync(source, { withFileTypes: true }).sort((left, right) => comparePath(left.name, right.name))) {
      walkAllowedEntry(packageRoot, `${entry.replace(/\/$/u, '')}/${child.name}`, paths)
    }
    return
  }
  if (!metadata.isFile()) throw new Error(`component entry is not a regular file: ${entry}`)
  const normalized = entry.replaceAll('\\', '/')
  paths.set(normalized, { source, executable: (metadata.mode & 0o111) !== 0 })
}

/** Enumerate the exact regular-file closure declared by one component package. */
export function componentFiles(packageRoot, manifest) {
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('component package has no files allowlist')
  }
  const paths = new Map()
  walkAllowedEntry(packageRoot, 'package.json', paths)
  for (const entry of manifest.files) walkAllowedEntry(packageRoot, entry, paths)
  return [...paths.entries()]
    .sort(([left], [right]) => comparePath(left, right))
    .map(([path, value]) => ({ path, ...value }))
}

function componentSlug(id) {
  const slug = id.replace(/^@e-mate\//u, '')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) throw new Error(`unsafe component id: ${id}`)
  return slug
}

function selectComponent(root, id) {
  const boundary = loadReleaseBoundary(root)
  if (!boundary.valid) throw new Error(boundary.errors.join('\n'))
  const component = boundary.components.find(candidate => candidate.id === id)
  if (component === undefined) throw new Error(`unknown first-party component: ${id}`)
  if (component.errors.length > 0) throw new Error(component.errors.join('\n'))
  return { boundary, component }
}

function selectTarget(component, requested) {
  if (component.kind === 'profile') {
    if (requested !== undefined) throw new Error('portable Profile components do not accept --target')
    return null
  }
  if (typeof requested !== 'string') throw new Error('platform Profile components require --target')
  const target = component.targets.find(candidate => `${candidate.platform}-${candidate.arch}` === requested)
  if (target === undefined) throw new Error(`unsupported component target: ${requested}`)
  return target
}

export function targetEntries(entries, component, target) {
  if (target === null) return entries
  const allNativePaths = [...new Set(component.targets.flatMap(candidate => candidate.native_paths))]
  return entries.filter(entry => {
    const nativeRoot = allNativePaths.find(path => entry.path === path || entry.path.startsWith(`${path}/`))
    return nativeRoot === undefined || target.native_paths.some(path => entry.path === path || entry.path.startsWith(`${path}/`))
  })
}

/** Emit one deterministic, unpacked component payload and integrity manifest. */
export function emitComponent(options) {
  const root = resolve(options.root)
  const sourceCommit = options.sourceCommit
  if (!SHA40.test(sourceCommit)) throw new Error('source commit must be 40 lowercase hex characters')
  const { boundary, component } = selectComponent(root, options.id)
  const packageRoot = join(root, component.root)
  const manifest = readJson(join(packageRoot, 'package.json'))
  const output = resolve(options.out)
  const outputRelative = relative(root, output)
  if (output === root || outputRelative === '' || outputRelative === '..' || outputRelative.startsWith(`..${sep}`)) {
    throw new Error('component output must be a repository child directory')
  }
  const target = selectTarget(component, options.target)
  const entries = targetEntries(componentFiles(packageRoot, manifest), component, target)
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
  const componentManifest = {
    schema_version: 1,
    id: component.id,
    slug: componentSlug(component.id),
    version: component.version,
    kind: component.kind,
    target,
    source_commit: sourceCommit,
    base_contracts: [...manifest.eMate.component.base_contracts].sort(),
    harness_contract: {
      version: boundary.baseContract.harness_version,
      commit: boundary.baseContract.harness_commit,
    },
    package_entry: manifest.main,
    dsh: manifest.dsh,
    total_bytes: totalBytes,
    files,
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(componentManifest, null, 2)}\n`)
  writeFileSync(join(output, 'manifest.json'), manifestBytes, { mode: 0o644 })
  return {
    ...componentManifest,
    manifest_bytes: manifestBytes.byteLength,
    manifest_sha256: sha256(manifestBytes),
    output,
  }
}

function parseArguments(argv) {
  const command = argv[0]
  if (!['emit', 'inventory'].includes(command)) throw new Error('command must be emit or inventory')
  const options = { command }
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index]
    if (!['--component', '--out', '--source-commit', '--root', '--target'].includes(name)) {
      throw new Error(`unknown argument: ${String(name)}`)
    }
    const value = argv[index + 1]
    if (value === undefined) throw new Error(`${name} requires a value`)
    options[name.slice(2).replace('-', '')] = value
    index += 1
  }
  return options
}

function gitHead(root) {
  const gitDirectory = join(root, '.git')
  try {
    const head = readFileSync(join(gitDirectory, 'HEAD'), 'utf8').trim()
    if (SHA40.test(head)) return head
  } catch {}
  throw new Error('--source-commit is required in a linked worktree')
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const root = resolve(options.root ?? fileURLToPath(new URL('..', import.meta.url)))
  if (options.command === 'inventory') {
    const boundary = loadReleaseBoundary(root)
    if (!boundary.valid) throw new Error(boundary.errors.join('\n'))
    const accepted = boundary.components.filter(component => component.desktop !== 'blocked')
    process.stdout.write(`${JSON.stringify({
      schema_version: 1,
      base_contract_id: boundary.baseContract.id,
      components: boundary.components.map(component => ({
        id: component.id,
        version: component.version,
        kind: component.kind,
        root: component.root,
        source_roots: component.source_roots,
        desktop: component.desktop,
        targets: component.targets,
      })),
      component_jobs: componentJobsFor(boundary, accepted.map(component => component.id), accepted.map(component => component.id)),
    }, null, 2)}\n`)
    return
  }
  if (options.component === undefined || options.out === undefined) {
    throw new Error('emit requires --component and --out')
  }
  const value = emitComponent({
    root,
    id: options.component,
    out: options.out,
    sourceCommit: options.sourcecommit ?? gitHead(root),
    target: options.target,
  })
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (cause) {
    process.stderr.write(`component-release: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
