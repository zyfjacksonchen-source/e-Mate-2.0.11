#!/usr/bin/env node

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const destination = join(root, 'packages', 'dsh', 'profile', 'bundles')
const inventory = JSON.parse(await readFile(join(root, 'packages', 'dsh', 'profile', 'component-inventory.json'), 'utf8'))
if (inventory.schema_version !== 1 || !Array.isArray(inventory.components)) {
  throw new Error('component inventory is invalid')
}
const expected = inventory.components.filter(component => component.cli === true)

async function copyEntry(source, target) {
  const metadata = await stat(source)
  await mkdir(target.endsWith('/') ? target : resolve(target, '..'), { recursive: true })
  await cp(source, target, { recursive: metadata.isDirectory(), force: true })
}

await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })

const receipts = []
for (const component of expected) {
  const { id: name } = component
  const slug = name.slice('@e-mate/dsh-plugin-'.length)
  const source = join(root, component.root)
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  if (manifest.name !== name || manifest.version !== '2.0.11' || manifest.license !== 'MIT') {
    throw new Error(`${source} package identity is invalid`)
  }
  if (typeof manifest.main !== 'string') throw new Error(`${name} has no main entry`)
  await stat(join(source, manifest.main))
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error(`${name} has no explicit files allowlist`)

  const target = join(destination, slug)
  await mkdir(target, { recursive: true })
  await cp(join(source, 'package.json'), join(target, 'package.json'))
  for (const entry of manifest.files) {
    if (typeof entry !== 'string' || entry === '' || entry.includes('..') || entry.startsWith('/')) {
      throw new Error(`${name} contains an unsafe files entry`)
    }
    await copyEntry(join(source, entry), join(target, entry))
  }
  receipts.push({ name, version: manifest.version, directory: basename(target) })
}

await writeFile(join(destination, 'registry.json'), `${JSON.stringify({
  schema_version: 1,
  product: 'e-Mate',
  version: '2.0.11',
  harness_version: '0.1.0-rc.7',
  harness_commit: 'df78045a127e32cb5b942defba52c539590d1596',
  packages: receipts,
}, null, 2)}\n`)
