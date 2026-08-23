import { lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'

const ignoredDirectories = new Set(['.git', 'build', 'dist', 'lib', 'node_modules'])

function entryExists(path) {
  try {
    lstatSync(path)
    return true
  } catch (cause) {
    if (cause?.code === 'ENOENT') return false
    throw cause
  }
}

function harnessPackages(harnessRoot) {
  const packages = new Map()
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) continue
      const child = join(directory, entry.name)
      const packagePath = join(child, 'package.json')
      if (entryExists(packagePath)) {
        const manifest = JSON.parse(readFileSync(packagePath, 'utf8'))
        if (typeof manifest.name === 'string') {
          if (packages.has(manifest.name)) throw new Error(`duplicate pinned Harness package: ${manifest.name}`)
          packages.set(manifest.name, { root: child, version: manifest.version })
        }
      }
      visit(child)
    }
  }
  for (const root of ['apps', 'packages', 'vendor']) {
    const directory = join(harnessRoot, root)
    if (entryExists(directory)) visit(directory)
  }
  return packages
}

function verifyPackage(path, name, expectedVersion) {
  const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
  if (manifest.name !== name || manifest.version !== expectedVersion) {
    throw new Error(`Base import ${name} must resolve to ${expectedVersion}`)
  }
}

/** Provide component tests the exact pinned Harness packages that production resolves from Base. */
export function prepareHarnessBaseImports({ componentRoot, harnessRoot, baseImports, runtimeImports }) {
  const packages = harnessPackages(harnessRoot)
  for (const name of baseImports.filter(candidate => candidate.startsWith('@deepseek-ai/'))) {
    const expectedVersion = runtimeImports[name]
    if (typeof expectedVersion !== 'string') throw new Error(`undeclared Base runtime import: ${name}`)
    const target = join(componentRoot, 'node_modules', ...name.split('/'))
    if (entryExists(target)) {
      verifyPackage(target, name, expectedVersion)
      continue
    }
    const source = packages.get(name)
    if (source === undefined) throw new Error(`pinned Harness package is unavailable for Base import: ${name}`)
    if (source.version !== expectedVersion) throw new Error(`pinned Harness ${name} must equal ${expectedVersion}`)
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(source.root, target, process.platform === 'win32' ? 'junction' : 'dir')
  }
}
