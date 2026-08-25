#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { builtinModules, createRequire } from 'node:module'
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
const BUILTIN_MODULES = new Set(builtinModules.flatMap(name => [name, `node:${name}`]))
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)(?:\/|$)/u
const DESKTOP_COMPONENT_IMPORT = '@e-mate/desktop/vision-toolkit'
let typescript

function runtimeImportParser() {
  typescript ??= createRequire(new URL('../upstream/deepseek-harness/package.json', import.meta.url))('typescript')
  return typescript
}

/** The impact lane intentionally runs before the Harness toolchain is installed. */
export function componentRuntimeParserAvailable() {
  try {
    runtimeImportParser()
    return true
  } catch {
    return false
  }
}

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

function packageName(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || BUILTIN_MODULES.has(specifier)) return
  if (specifier === '@e-mate/desktop' || specifier.startsWith('@e-mate/desktop/')) {
    if (specifier !== DESKTOP_COMPONENT_IMPORT) {
      throw new Error(`unsupported Desktop Base runtime import: ${specifier}`)
    }
    return specifier
  }
  const match = PACKAGE_NAME.exec(specifier)
  if (match === null) throw new Error(`unsupported component runtime import: ${specifier}`)
  return match[0].replace(/\/$/u, '')
}

/** Extract the exact bare package imports left external in the emitted runtime closure. */
export function componentRuntimeImports(entries) {
  const runtimeEntries = entries.filter(entry => /\.[cm]?js$/u.test(entry.path))
  if (runtimeEntries.length === 0) return []
  const ts = runtimeImportParser()
  const imports = new Set()
  for (const entry of runtimeEntries) {
    const source = ts.createSourceFile(
      entry.source,
      readFileSync(entry.source, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    )
    if (source.parseDiagnostics.length > 0) throw new Error(`component runtime JavaScript is invalid: ${entry.path}`)
    const visit = node => {
      let specifier
      if (ts.isCallExpression(node) && node.arguments.length === 1
        && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'load'
        && ts.isPropertyAccessExpression(node.expression.expression)
        && node.expression.expression.name.text === '__ModuleLoader__'
        && ts.isIdentifier(node.expression.expression.expression)
        && node.expression.expression.expression.text === 'window'
        && ts.isObjectLiteralExpression(node.arguments[0])) {
        const property = node.arguments[0].properties.find(candidate =>
          ts.isPropertyAssignment(candidate)
            && (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name))
            && candidate.name.text === 'factory')
        const factory = property?.initializer
        const parameter = factory !== undefined
          && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))
          && factory.parameters.length > 0 && ts.isIdentifier(factory.parameters[0].name)
          ? factory.parameters[0].name.text
          : undefined
        if (parameter !== undefined) {
          const visitFactory = candidate => {
            if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression)
              && candidate.expression.text === parameter && candidate.arguments.length === 1
              && ts.isStringLiteral(candidate.arguments[0])) {
              const name = packageName(candidate.arguments[0].text)
              if (name !== undefined) imports.add(name)
            }
            ts.forEachChild(candidate, visitFactory)
          }
          visitFactory(factory.body)
        }
      }
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        specifier = node.moduleSpecifier.text
      } else if (ts.isCallExpression(node) && node.arguments.length === 1
        && ts.isStringLiteral(node.arguments[0])
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
        specifier = node.arguments[0].text
      }
      if (specifier !== undefined) {
        const name = packageName(specifier)
        if (name !== undefined) imports.add(name)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return [...imports].sort(comparePath)
}

export function verifyComponentRuntimeImports(entries, component, target = null) {
  const baseImports = componentRuntimeImports(targetEntries(entries, component, target))
  if (JSON.stringify(baseImports) !== JSON.stringify(component.base_imports)) {
    const label = target === null ? 'portable' : `${target.platform}-${target.arch}`
    throw new Error(`component runtime imports do not match its fixed Base ABI declaration: ${component.id} ${label}; declared ${JSON.stringify(component.base_imports)}, emitted ${JSON.stringify(baseImports)}`)
  }
  return baseImports
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
  const componentEntries = componentFiles(packageRoot, manifest)
  const entries = targetEntries(componentEntries, component, target)
  const baseImports = verifyComponentRuntimeImports(componentEntries, component, target)
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
    schedule_protocol_floor: boundary.baseContract.schedule_protocol_floor,
    base_imports: baseImports,
    authority_contract: {
      effects: [...component.authority_contract.effects],
      guards: [...component.authority_contract.guards],
    },
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
      schedule_protocol_floor: boundary.baseContract.schedule_protocol_floor,
      components: boundary.components.map(component => ({
        id: component.id,
        version: component.version,
        kind: component.kind,
        root: component.root,
        source_roots: component.source_roots,
        base_imports: component.base_imports,
        authority_contract: component.authority_contract,
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
