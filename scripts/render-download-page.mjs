#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const desktopVersion = JSON.parse(readFileSync(new URL('../desktop/e-mate-desktop/package.json', import.meta.url), 'utf8')).version
if (typeof desktopVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(desktopVersion)) {
  throw new Error('download page requires the stable Desktop package version')
}
const SOURCE_DIRECTORY = fileURLToPath(new URL('../deploy/download-page/', import.meta.url))
const DESKTOP_SCRIPT = 'site.865115b8aa11.js'
const SOURCE_COMMIT = /^[0-9a-f]{40}$/u
const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
})

export function validateDownloadPage(index, macGuide, script) {
  const declared = [index, macGuide].map(page => /data-desktop-version="(\d+\.\d+\.\d+)"/u.exec(page)?.[1])
  declared.push(/const VERSION = "(\d+\.\d+\.\d+)";/u.exec(script)?.[1])
  if (declared.some(version => version !== desktopVersion)
    || !index.includes(`./${DESKTOP_SCRIPT}`)
    || !macGuide.includes(`./${DESKTOP_SCRIPT}`)
    || !index.includes('data-platform-switch')
    || !index.includes('data-downloads')
    || !script.includes('`${R2_ORIGIN}/desktop/manual/v${VERSION}/latest.json`')) {
    throw new Error('download page desktop manifest contract is incomplete')
  }
  return desktopVersion
}

function contentType(path) {
  const value = CONTENT_TYPES[extname(path)]
  if (value === undefined) throw new Error(`download page contains an unsupported file: ${path}`)
  return value
}

function inventory(root) {
  const files = []
  const visit = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`download page must not contain symlinks: ${relativePath}`)
      if (entry.isDirectory()) {
        visit(path, relativePath)
      } else if (entry.isFile()) {
        const bytes = readFileSync(path)
        files.push({
          relative_path: relativePath,
          bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          content_type: contentType(relativePath),
        })
      } else {
        throw new Error(`download page contains a non-file entry: ${relativePath}`)
      }
    }
  }
  visit(root)
  return files.sort((left, right) => left.relative_path < right.relative_path ? -1 : left.relative_path > right.relative_path ? 1 : 0)
}

function safeStagePaths(sourceDirectory, outputDirectory, planPath) {
  const source = resolve(sourceDirectory)
  const output = resolve(outputDirectory)
  const plan = resolve(planPath)
  if (output === source || output.startsWith(`${source}${sep}`) || source.startsWith(`${output}${sep}`)
    || plan === source || plan.startsWith(`${source}${sep}`)
    || plan === output || plan.startsWith(`${output}${sep}`)
    || output === dirname(output)) {
    throw new Error('download page staging paths must be separate from source and plan')
  }
  const sourceMetadata = lstatSync(source)
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink() || realpathSync(source) !== source) {
    throw new Error('download page source must be a canonical directory')
  }
  if (existsSync(output) && (!lstatSync(output).isDirectory() || lstatSync(output).isSymbolicLink())) {
    throw new Error('download page output must be a regular directory')
  }
  if (existsSync(plan) && lstatSync(plan).isSymbolicLink()) {
    throw new Error('download page publication plan must not be a symlink')
  }
  return { source, output, plan }
}

export function stageDownloadPage({
  sourceDirectory = SOURCE_DIRECTORY,
  outputDirectory,
  planPath,
  sourceCommit,
}) {
  if (!SOURCE_COMMIT.test(sourceCommit ?? '')) throw new Error('download page requires an exact source commit')
  const paths = safeStagePaths(sourceDirectory, outputDirectory, planPath)
  const sourceFiles = inventory(paths.source)
  const read = name => readFileSync(join(paths.source, name), 'utf8')
  validateDownloadPage(read('index.html'), read('install-macos.html'), read(DESKTOP_SCRIPT))

  rmSync(paths.output, { recursive: true, force: true })
  mkdirSync(paths.output, { recursive: true })
  for (const file of sourceFiles) {
    const destination = join(paths.output, ...file.relative_path.split('/'))
    mkdirSync(dirname(destination), { recursive: true })
    copyFileSync(join(paths.source, ...file.relative_path.split('/')), destination)
  }
  const stagedFiles = inventory(paths.output)
  if (JSON.stringify(stagedFiles) !== JSON.stringify(sourceFiles)) {
    throw new Error('staged download page does not match its source bytes')
  }

  const plan = {
    schema_version: 1,
    document_type: 'emate.website-publication-plan',
    status: 'prepared',
    source_commit: sourceCommit,
    staged_directory: 'download-page',
    publication_contract: {
      target: 'website-server',
      strategy: 'versioned-relative-symlink',
      preserve_unrelated_content: true,
      switch_symlink_last: true,
      server_writes_performed: false,
      r2_writes_performed: false,
      published: false,
      live_verified: false,
    },
    files: stagedFiles,
  }
  mkdirSync(dirname(paths.plan), { recursive: true })
  writeFileSync(paths.plan, `${JSON.stringify(plan, null, 2)}\n`)
  return plan
}

function main() {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, plan: { type: 'string' }, commit: { type: 'string' } },
  })
  if (values.out === undefined || values.plan === undefined || values.commit === undefined) {
    throw new Error('usage: render-download-page.mjs --out <directory> --plan <path> --commit <sha>')
  }
  stageDownloadPage({ outputDirectory: values.out, planPath: values.plan, sourceCommit: values.commit })
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
