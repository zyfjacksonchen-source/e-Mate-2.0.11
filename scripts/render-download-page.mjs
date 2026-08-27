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
const DESKTOP_SCRIPT = 'site.48e1d1764753.js'
const SOURCE_COMMIT = /^[0-9a-f]{40}$/u
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u
const POSITIVE_ID = /^[1-9][0-9]*$/u
const PUBLICATION_ACTION = Object.freeze({
  repository: 'zyfjacksonchen-source/e-mate-desktop-publication',
  commit: 'cd7d223692b51e4e7a53db5759e1c2a9811febd0',
})
const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
})

export function validateDownloadPage(index, macGuide, script, expectedVersion = desktopVersion) {
  if (typeof expectedVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(expectedVersion)) {
    throw new Error('download page expected version must be stable SemVer')
  }
  const declared = [index, macGuide].map(page => /data-desktop-version="(\d+\.\d+\.\d+)"/u.exec(page)?.[1])
  declared.push(/const VERSION = "(\d+\.\d+\.\d+)";/u.exec(script)?.[1])
  if (declared.some(version => version !== expectedVersion)
    || !index.includes(`./${DESKTOP_SCRIPT}`)
    || !macGuide.includes(`./${DESKTOP_SCRIPT}`)
    || !index.includes('data-platform-switch')
    || !index.includes('data-downloads')
    || !script.includes('`${R2_ORIGIN}/desktop/manual/v${VERSION}/latest.json`')) {
    throw new Error('download page desktop manifest contract is incomplete')
  }
  return expectedVersion
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

function exactIdentity(value, label) {
  if (value === 'absent') return null
  const match = /^(\d+):([0-9a-f]{64})$/u.exec(value ?? '')
  const bytes = Number(match?.[1])
  if (match === null || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`${label} must be absent or <bytes>:<sha256>`)
  return { bytes, sha256: match[2] }
}

function publicOrigin(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('website public origin must be an absolute HTTPS URL') }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('website public origin must be an absolute HTTPS URL without credentials, query, or fragment')
  }
  return `${url.href.replace(/\/+$/u, '')}/`
}

function releaseState(path, sourceCommit) {
  const bytes = readFileSync(path)
  let state
  try { state = JSON.parse(bytes) } catch { throw new Error('website handoff requires a valid release state') }
  const keys = value => Object.keys(value ?? {}).sort().join(',')
  const stages = {
    ci: ['run_id', 'status'],
    profile: ['artifact_bytes', 'artifact_digest', 'artifact_id', 'run_id', 'status'],
    desktop: ['artifact_bytes', 'artifact_digest', 'artifact_id', 'run_id', 'status'],
    admission: ['artifact_bytes', 'artifact_digest', 'artifact_id', 'run_id', 'status'],
    publication: ['macos', 'status', 'windows'],
  }
  const identities = [state?.stages?.profile, state?.stages?.desktop, state?.stages?.admission,
    state?.stages?.publication?.macos, state?.stages?.publication?.windows]
  if (keys(state) !== ['document_type', 'release_mode', 'schema_version', 'source_sha', 'stages', 'status', 'version'].sort().join(',')
    || state.schema_version !== 3 || state.document_type !== 'emate.release-state'
    || state.status !== 'admitted-awaiting-cloudflare-plugin' || state.release_mode !== 'base'
    || state.source_sha !== sourceCommit || state.version !== desktopVersion
    || keys(state.stages) !== Object.keys(stages).sort().join(',')
    || Object.entries(stages).some(([name, expected]) => keys(state.stages[name]) !== expected.sort().join(','))
    || keys(state.stages.publication?.macos) !== ['artifact_bytes', 'artifact_digest', 'artifact_id'].join(',')
    || keys(state.stages.publication?.windows) !== ['artifact_bytes', 'artifact_digest', 'artifact_id'].join(',')
    || Object.entries(state.stages).some(([name, stage]) => stage.status !== (name === 'publication' ? 'pending-cloudflare-plugin' : 'accepted'))
    || !POSITIVE_ID.test(state.stages.ci.run_id)
    || identities.some(value => !POSITIVE_ID.test(String(value?.artifact_id)) || !SHA256_DIGEST.test(value?.artifact_digest ?? '')
      || !Number.isSafeInteger(value?.artifact_bytes) || value.artifact_bytes <= 0)
    || [state.stages.profile, state.stages.desktop, state.stages.admission]
      .some(value => !POSITIVE_ID.test(String(value.run_id)))) {
    throw new Error('website handoff release state is not the exact admitted source')
  }
  return {
    value: state,
    identity: { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') },
  }
}

export function stageDownloadPage({
  sourceDirectory = SOURCE_DIRECTORY,
  outputDirectory,
  planPath,
  sourceCommit,
  releaseStatePath,
  websitePublicOrigin,
  expectedActiveTarget,
  expectedActiveIndex,
}) {
  if (!SOURCE_COMMIT.test(sourceCommit ?? '')) throw new Error('download page requires an exact source commit')
  if (typeof releaseStatePath !== 'string') throw new Error('download page requires the admitted release state')
  if (expectedActiveTarget !== 'absent'
    && !/^(?:\/srv\/ecorex-agent-download\/)?releases\/[A-Za-z0-9._-]+$/u.test(expectedActiveTarget ?? '')) {
    throw new Error('website current target must be absent or one safe releases/<id> path')
  }
  const predecessorIndex = exactIdentity(expectedActiveIndex, 'website active index')
  if ((expectedActiveTarget === 'absent') !== (predecessorIndex === null)) {
    throw new Error('website active target and index predecessor must both be absent or both be present')
  }
  const origin = publicOrigin(websitePublicOrigin)
  const admitted = releaseState(releaseStatePath, sourceCommit)
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
    schema_version: 2,
    document_type: 'emate.website-publication-plan',
    status: 'ready-for-website-publication-owner',
    source_commit: sourceCommit,
    version: desktopVersion,
    staged_directory: 'download-page',
    release_state: {
      artifact_name: `e-mate-release-state-${sourceCommit}`,
      ...admitted.identity,
      stages: admitted.value.stages,
    },
    desktop_publication_predecessor: {
      action_repository: PUBLICATION_ACTION.repository,
      action_commit: PUBLICATION_ACTION.commit,
      artifact_name: `e-mate-desktop-cloudflare-handoff-${sourceCommit}`,
      required_status: 'ready-for-cloudflare-plugin',
      require_cloudflare_public_readback: true,
    },
    publication_contract: {
      target: 'website-server',
      authority: 'website-server-owner',
      strategy: 'versioned-current-symlink',
      server_root: '/srv/ecorex-agent-download',
      version_directory: `releases/site-emate-${desktopVersion}-${sourceCommit}`,
      current_symlink: 'current',
      candidate_relative_target: `releases/site-emate-${desktopVersion}-${sourceCommit}`,
      expected_current_target: expectedActiveTarget === 'absent' ? null : expectedActiveTarget,
      expected_current_index: predecessorIndex,
      preserve_unrelated_content: true,
      switch_symlink_last: true,
      require_cloudflare_public_readback_first: true,
      server_writes_performed: false,
      r2_writes_performed: false,
      published: false,
      live_verified: false,
    },
    public_readback: {
      origin,
      current_index_url: new URL('index.html', origin).href,
      requirements: ['https-200', 'no-redirect', 'content-type', 'content-length', 'sha256', 'installer-links-admitted'],
      files: stagedFiles.map(file => ({ ...file, url: new URL(file.relative_path, origin).href })),
    },
  }
  mkdirSync(dirname(paths.plan), { recursive: true })
  writeFileSync(paths.plan, `${JSON.stringify(plan, null, 2)}\n`)
  return plan
}

function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      plan: { type: 'string' },
      commit: { type: 'string' },
      'release-state': { type: 'string' },
      'public-origin': { type: 'string' },
      'expected-active-target': { type: 'string' },
      'expected-active-index': { type: 'string' },
    },
  })
  if (values.out === undefined || values.plan === undefined || values.commit === undefined
    || values['release-state'] === undefined || values['public-origin'] === undefined
    || values['expected-active-target'] === undefined || values['expected-active-index'] === undefined) {
    throw new Error('usage: render-download-page.mjs --out <directory> --plan <path> --commit <sha> --release-state <path> --public-origin <https-url> --expected-active-target <absent|releases/id> --expected-active-index <absent|bytes:sha256>')
  }
  stageDownloadPage({
    outputDirectory: values.out,
    planPath: values.plan,
    sourceCommit: values.commit,
    releaseStatePath: values['release-state'],
    websitePublicOrigin: values['public-origin'],
    expectedActiveTarget: values['expected-active-target'],
    expectedActiveIndex: values['expected-active-index'],
  })
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
