#!/usr/bin/env node

// Historical filename retained for release-carrier compatibility. This module
// only emits a byte-bound publication plan; the connected Codex Cloudflare
// plugin is the sole authority allowed to read or write production R2 objects.
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { VERSION, verifyRelease } from './release.mjs'
import { releasePrefix } from './release-source.mjs'

export const R2_BUCKET = 'emate-desktop-downloads'
export const R2_PUBLIC_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const REPOSITORY = 'zyfjacksonchen-source/e-Mate-2.0.11'
const EVIDENCE_FILES = [
  'SHA256SUMS',
  'release-manifest.json',
  `e-mate-${VERSION}.spdx.json`,
  'THIRD_PARTY_LICENSES.txt',
  'EVIDENCE_SHA256SUMS',
]
const SHA256 = /^[0-9a-f]{64}$/u
const IMMUTABLE_CACHE_CONTROL = 'public,max-age=31536000,immutable'

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function contentType(filename) {
  if (filename.endsWith('.tgz')) return 'application/gzip'
  if (filename.endsWith('.json')) return 'application/json'
  return 'text/plain; charset=utf-8'
}

function contentDisposition(filename) {
  return `attachment; filename="${filename}"`
}

function normalizePublicOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('EMATE_R2_PUBLIC_ORIGIN is missing or invalid')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('EMATE_R2_PUBLIC_ORIGIN must be a credential-free HTTPS origin')
  }
  return url.origin
}

export function normalizeProductionPublicOrigin(value) {
  const origin = normalizePublicOrigin(value)
  if (origin !== R2_PUBLIC_ORIGIN) throw new Error('EMATE_R2_PUBLIC_ORIGIN must be the e-Mate Cloudflare R2 public bucket origin')
  return origin
}

function record(path, role, publicOrigin, prefix) {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
    throw new Error(`R2 release input is not a non-empty regular file: ${path}`)
  }
  const filename = basename(path)
  const key = `${prefix}/${filename}`
  return {
    role,
    filename,
    key,
    url: `${publicOrigin}/${key}`,
    size: metadata.size,
    sha256: digest(path),
    contentType: contentType(filename),
    contentDisposition: contentDisposition(filename),
    cacheControl: IMMUTABLE_CACHE_CONTROL,
    path,
  }
}

export function buildR2Inventory(
  npmDirectory,
  evidenceDirectory,
  sourceCommit = '0'.repeat(40),
  publicOrigin,
) {
  publicOrigin = normalizePublicOrigin(publicOrigin)
  const release = verifyRelease(npmDirectory)
  const manifestPath = join(evidenceDirectory, 'release-manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.product !== 'e-Mate' || manifest.version !== VERSION || manifest.source_commit !== sourceCommit
    || !SHA256.test(manifest.release_sha256 ?? '') || !Array.isArray(manifest.packages)
    || manifest.download?.source_commit !== sourceCommit) {
    throw new Error('R2 release manifest identity is invalid')
  }
  const prefix = releasePrefix(sourceCommit)
  if (manifest.download.manifest_url !== `${R2_PUBLIC_ORIGIN}/${prefix}/release-manifest.json`
    || manifest.download.tarball_url !== `${R2_PUBLIC_ORIGIN}/${prefix}/e-mate-dsh-${VERSION}.tgz`) {
    throw new Error('R2 release manifest download source is invalid')
  }
  const packageRecords = release.map(item => record(item.path, 'npm-package', publicOrigin, prefix))
  if (manifest.packages.length !== packageRecords.length
    || new Set(manifest.packages.map(item => item.filename)).size !== packageRecords.length) {
    throw new Error('R2 release manifest package set is invalid')
  }
  for (const item of packageRecords) {
    const expected = manifest.packages.find(candidate => candidate.filename === item.filename)
    const actual = release.find(candidate => candidate.filename === item.filename)
    if (expected?.sha256 !== item.sha256 || expected?.sha512 !== actual?.sha512
      || expected?.integrity !== actual?.integrity
      || expected?.size !== item.size || manifest.download.sha256 !== item.sha256
      || manifest.download.integrity !== expected.integrity || manifest.download.size !== item.size) {
      throw new Error(`R2 package differs from release manifest: ${item.filename}`)
    }
  }
  const objects = [
    ...packageRecords,
    ...EVIDENCE_FILES.map(name => record(join(evidenceDirectory, name), 'release-evidence', publicOrigin, prefix)),
  ]
  if (new Set(objects.map(item => item.key)).size !== objects.length) throw new Error('R2 release contains duplicate object keys')
  return {
    schema_version: 1,
    document_type: 'emate.r2-npm-download-admission',
    product: 'e-Mate',
    version: VERSION,
    source_commit: sourceCommit,
    release_sha256: manifest.release_sha256,
    bucket: R2_BUCKET,
    public_origin: publicOrigin,
    prefix,
    objects,
  }
}

export async function writeR2PublicationPlan(npmDirectory, evidenceDirectory, planPath, sourceCommit) {
  if (basename(planPath) !== 'r2-publication-plan.json') throw new Error('R2 publication plan filename is invalid')
  const inventory = buildR2Inventory(npmDirectory, evidenceDirectory, sourceCommit, R2_PUBLIC_ORIGIN)
  const plan = {
    ...inventory,
    document_type: 'emate.cloudflare-plugin-r2-publication-plan',
    repository: REPOSITORY,
    publication_authority: 'codex-cloudflare-plugin',
    objects: inventory.objects.map(({ path, contentType, contentDisposition, cacheControl, ...item }) => ({
      ...item,
      artifact_path: `${item.role === 'npm-package' ? 'npm' : 'release'}/${item.filename}`,
      content_type: contentType,
      content_disposition: contentDisposition,
      cache_control: cacheControl,
    })),
  }
  await mkdir(dirname(planPath), { recursive: true })
  const temporary = `${planPath}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await rename(temporary, planPath)
  return plan
}

async function main() {
  const { values } = parseArgs({
    options: {
      npm: { type: 'string' }, evidence: { type: 'string' }, plan: { type: 'string' }, commit: { type: 'string' },
    },
  })
  if (values.npm === undefined || values.evidence === undefined || values.plan === undefined
    || values.commit === undefined || !/^[0-9a-f]{40}$/u.test(values.commit)) {
    throw new Error('usage: publish-r2.mjs --npm <tarball directory> --evidence <evidence directory> --plan <plan path> --commit <source SHA>')
  }
  await writeR2PublicationPlan(values.npm, values.evidence, values.plan, values.commit)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
