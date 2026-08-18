#!/usr/bin/env node

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const destination = join(root, 'packages', 'dsh', 'profile', 'bundles')
const expected = [
  '@e-mate/dsh-plugin-better-sidebar',
  '@e-mate/dsh-plugin-browser',
  '@e-mate/dsh-plugin-browser-panel',
  '@e-mate/dsh-plugin-file-import',
  '@e-mate/dsh-plugin-genui',
  '@e-mate/dsh-plugin-im',
  '@e-mate/dsh-plugin-memory-evolve',
  '@e-mate/dsh-plugin-office-skills',
  '@e-mate/dsh-plugin-search-mcp',
  '@e-mate/dsh-plugin-subagent',
  '@e-mate/dsh-plugin-vision-toolkit',
]

async function copyEntry(source, target) {
  const metadata = await stat(source)
  await mkdir(target.endsWith('/') ? target : resolve(target, '..'), { recursive: true })
  await cp(source, target, { recursive: metadata.isDirectory(), force: true })
}

await rm(destination, { recursive: true, force: true })
await mkdir(destination, { recursive: true })

const receipts = []
for (const name of expected) {
  const slug = name.slice('@e-mate/dsh-plugin-'.length)
  const source = join(root, 'packages', `dsh-plugin-${slug}`)
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  if (manifest.name !== name || manifest.version !== '2.0.8' || manifest.license !== 'MIT') {
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
  version: '2.0.8',
  harness_version: '0.1.0-rc.5',
  harness_commit: '12d68b6ca05fa538d98f70ed47786c44ca3a7225',
  packages: receipts,
}, null, 2)}\n`)
