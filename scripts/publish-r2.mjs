#!/usr/bin/env node

// Publishes the already-admitted npm release bytes to the existing e-Mate R2
// bucket. The stable download page is switched only after Computer Use passes.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { mkdir, open, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { isAcceptedReleaseCommit, VERSION, verifyRelease } from './release.mjs'
import { releasePrefix } from './release-source.mjs'

export const R2_BUCKET = 'emate-desktop-downloads'
export const R2_PUBLIC_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const REPOSITORY = 'zyfjacksonchen-source/e-Mate'
const EVIDENCE_FILES = [
  'SHA256SUMS',
  'release-manifest.json',
  `e-mate-${VERSION}.spdx.json`,
  'THIRD_PARTY_LICENSES.txt',
  'EVIDENCE_SHA256SUMS',
]
const SHA256 = /^[0-9a-f]{64}$/u
const MAX_COMMAND_OUTPUT = 1024 * 1024
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

export function matchesR2Head(value, item) {
  return value.ContentLength === item.size
    && value.ContentType === item.contentType
    && value.ContentDisposition === contentDisposition(item.filename)
    && value.CacheControl === IMMUTABLE_CACHE_CONTROL
    && value.Metadata?.sha256 === item.sha256
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
    || manifest.download.tarball_url !== `${R2_PUBLIC_ORIGIN}/${prefix}/e-mate-dsh-2.0.12.tgz`) {
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

function command(commandName, args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(commandName, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const append = chunk => {
      output += chunk
      if (output.length > MAX_COMMAND_OUTPUT) child.kill('SIGKILL')
    }
    child.stdout.setEncoding('utf8').on('data', append)
    child.stderr.setEncoding('utf8').on('data', append)
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolveCommand(output)
      else reject(Object.assign(new Error(`${commandName} exited with ${String(code)}: ${output}`), { output }))
    })
  })
}

function endpoint() {
  const account = process.env.ECOREX_R2_ACCOUNT_ID
  if (!/^[0-9a-f]{32}$/u.test(account ?? '')) throw new Error('ECOREX_R2_ACCOUNT_ID is missing or invalid')
  return `https://${account}.r2.cloudflarestorage.com`
}

async function headObject(item) {
  try {
    const output = await command('aws', [
      '--endpoint-url', endpoint(), 's3api', 'head-object', '--bucket', R2_BUCKET, '--key', item.key, '--output', 'json',
    ])
    const value = JSON.parse(output)
    if (!matchesR2Head(value, item)) {
      throw new Error(`R2 immutable object collision: ${item.key}`)
    }
    return true
  } catch (error) {
    if (/\(404\)|Not Found|NoSuchKey/u.test(error?.output ?? '')) return false
    throw error
  }
}

async function putObject(item) {
  await command('aws', [
    '--endpoint-url', endpoint(), 's3api', 'put-object',
    '--bucket', R2_BUCKET,
    '--key', item.key,
    '--body', item.path,
    '--content-type', item.contentType,
    '--content-disposition', contentDisposition(item.filename),
    '--cache-control', IMMUTABLE_CACHE_CONTROL,
    '--metadata', `sha256=${item.sha256}`,
  ])
}

async function publicProbe(item) {
  const response = await fetch(item.url, {
    method: 'HEAD',
    redirect: 'error',
    headers: { 'accept-encoding': 'identity', 'cache-control': 'no-cache' },
  })
  if (response.status !== 200 || response.headers.get('content-length') !== String(item.size)) {
    throw new Error(`R2 public HEAD did not admit ${item.key}`)
  }
  const file = await open(item.path, 'r')
  try {
    const ranges = [[0, Math.min(15, item.size - 1)], [Math.max(0, item.size - 16), item.size - 1]]
    for (const [start, end] of ranges.filter((value, index, values) => index === 0 || value[0] !== values[0][0])) {
      const result = await fetch(item.url, {
        redirect: 'error',
        headers: { range: `bytes=${start}-${end}`, 'accept-encoding': 'identity', 'cache-control': 'no-cache' },
      })
      const bytes = Buffer.from(await result.arrayBuffer())
      const local = Buffer.alloc(end - start + 1)
      await file.read(local, 0, local.length, start)
      if (result.status !== 206 || result.headers.get('content-range') !== `bytes ${start}-${end}/${item.size}`
        || !bytes.equals(local)) throw new Error(`R2 public bytes did not admit ${item.key}`)
    }
  } finally {
    await file.close()
  }
}

async function publishObject(item) {
  if (!await headObject(item)) await putObject(item)
  if (!await headObject(item)) throw new Error(`R2 authenticated readback failed: ${item.key}`)
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await publicProbe(item)
      return
    } catch (error) {
      lastError = error
      if (attempt < 4) await sleep(1000 * 2 ** attempt)
    }
  }
  throw lastError
}

function receiptObject(item) {
  return {
    role: item.role,
    filename: item.filename,
    key: item.key,
    url: item.url,
    size: item.size,
    sha256: item.sha256,
  }
}

function authorize() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== REPOSITORY
    || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || !isAcceptedReleaseCommit()) {
    throw new Error(`R2 publication is allowed only by workflow dispatch for the accepted commit in ${REPOSITORY}`)
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('R2 S3 credentials are missing')
  }
  normalizeProductionPublicOrigin(process.env.EMATE_R2_PUBLIC_ORIGIN)
}

export async function publishR2(npmDirectory, evidenceDirectory, receiptPath) {
  authorize()
  if (basename(receiptPath) !== 'r2-download-admission.json') throw new Error('R2 receipt filename is invalid')
  const inventory = buildR2Inventory(
    npmDirectory,
    evidenceDirectory,
    process.env.GITHUB_SHA,
    process.env.EMATE_R2_PUBLIC_ORIGIN,
  )
  let cursor = 0
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < inventory.objects.length) {
      const index = cursor
      cursor += 1
      await publishObject(inventory.objects[index])
    }
  }))
  const receipt = { ...inventory, status: 'verified', max_parallel_uploads: 3, objects: inventory.objects.map(receiptObject) }
  await mkdir(dirname(receiptPath), { recursive: true })
  const temporary = `${receiptPath}.tmp`
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, receiptPath)
  await publishObject(record(receiptPath, 'r2-admission', inventory.public_origin, inventory.prefix))
  console.log(`e-Mate R2 admission: ${receipt.objects.length} release objects verified under ${inventory.prefix}`)
  return receipt
}

async function main() {
  const { values } = parseArgs({
    options: { npm: { type: 'string' }, evidence: { type: 'string' }, receipt: { type: 'string' } },
  })
  if (values.npm === undefined || values.evidence === undefined || values.receipt === undefined) {
    throw new Error('usage: publish-r2.mjs --npm <tarball directory> --evidence <evidence directory> --receipt <receipt path>')
  }
  await publishR2(values.npm, values.evidence, values.receipt)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main()
