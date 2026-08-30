#!/usr/bin/env node

import { constants } from 'node:fs'
import {
  link, lstat, mkdir, open, readdir, realpath, rename, rm, stat, writeFile,
} from 'node:fs/promises'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const MAGIC = Buffer.from('EMATE_SIGNING_CONTROL_V1\n', 'ascii')
const LENGTH_BYTES = 8
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024
const MAX_FILE_BYTES = 1024 * 1024 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
const MAX_FILES = 100_000
const CHUNK_BYTES = 64 * 1024
const MAX_BUNDLE_BYTES = MAGIC.byteLength + LENGTH_BYTES + MAX_MANIFEST_BYTES + MAX_TOTAL_BYTES
const SHA256 = /^[0-9a-f]{64}$/u
const CLASSIFICATIONS = new Set([
  'future-public-profile-byte',
  'redacted-local-flow-control',
  'verified-build-sidecar',
])

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys) {
  if (!record(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function comparePath(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function safePath(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._+@/-]+$/u.test(value) && !isAbsolute(value) && !value.includes('\\')
    && !value.includes('\0') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function assertMetadata(value) {
  if (!record(value) || value.schema_version !== 1
    || value.document_type !== 'emate.local-protected-signer-control-input') {
    throw new Error('signing control metadata is invalid')
  }
  let encoded
  try {
    encoded = canonicalJson(value)
  } catch {
    throw new Error('signing control metadata is not canonical JSON')
  }
  if (encoded === undefined || JSON.parse(encoded) === undefined) {
    throw new Error('signing control metadata is not canonical JSON')
  }
  return value
}

async function openRegular(path, label) {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`${label} is not a regular file`)
  const descriptor = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const current = await descriptor.stat()
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino) {
      throw new Error(`${label} changed before it was opened`)
    }
    return { descriptor, metadata: current }
  } catch (cause) {
    await descriptor.close()
    throw cause
  }
}

async function hashHandle(descriptor, bytes, start = 0) {
  const hash = createHash('sha256')
  const chunk = Buffer.allocUnsafe(CHUNK_BYTES)
  let offset = 0
  while (offset < bytes) {
    const length = Math.min(chunk.byteLength, bytes - offset)
    const { bytesRead } = await descriptor.read(chunk, 0, length, start + offset)
    if (bytesRead !== length) throw new Error('signing control file ended before its declared size')
    hash.update(chunk.subarray(0, bytesRead))
    offset += bytesRead
  }
  return hash.digest('hex')
}

async function fileIdentity(path, label, maxBytes = MAX_FILE_BYTES) {
  const { descriptor, metadata } = await openRegular(path, label)
  try {
    if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0 || metadata.size > maxBytes) {
      throw new Error(`${label} size is outside the signing control limit`)
    }
    return { bytes: metadata.size, sha256: await hashHandle(descriptor, metadata.size) }
  } finally {
    await descriptor.close()
  }
}

function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
    throw new Error('signing control file count is invalid')
  }
  const sorted = files.map(file => {
    if (!exactKeys(file, ['path', 'classification', 'bytes', 'sha256']) || !safePath(file.path)
      || !CLASSIFICATIONS.has(file.classification) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0
      || file.bytes > MAX_FILE_BYTES || !SHA256.test(file.sha256 ?? '')) {
      throw new Error('signing control file path, classification, or approved identity is invalid')
    }
    return { ...file }
  }).sort((left, right) => comparePath(left.path, right.path))
  if (sorted.some((file, index) => index > 0 && sorted[index - 1].path === file.path)) {
    throw new Error('signing control file path is duplicate')
  }
  return sorted
}

async function openRootFile(root, path, label) {
  const parts = path.split('/')
  let parent = root
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part)
    const metadata = await lstat(parent)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`${label} has a symbolic-link or non-directory ancestor`)
    }
  }
  const absolute = join(root, ...parts)
  if (await realpath(absolute) !== absolute) throw new Error(`${label} escaped its canonical root`)
  const opened = await openRegular(absolute, label)
  try {
    if (await realpath(absolute) !== absolute) throw new Error(`${label} changed its canonical path`)
    return opened
  } catch (cause) {
    await opened.descriptor.close()
    throw cause
  }
}

async function bundleManifest(root, metadata, files) {
  const entries = []
  let totalBytes = 0
  for (const file of validateFiles(files)) {
    const absolute = resolve(root, ...file.path.split('/'))
    const fromRoot = relative(root, absolute)
    if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`signing control file path escaped its root: ${file.path}`)
    }
    const opened = await openRootFile(root, file.path, `signing control file ${file.path}`)
    let identity
    try {
      if (!Number.isSafeInteger(opened.metadata.size) || opened.metadata.size <= 0
        || opened.metadata.size > MAX_FILE_BYTES) {
        throw new Error(`signing control file ${file.path} size is outside the signing control limit`)
      }
      identity = { bytes: opened.metadata.size, sha256: await hashHandle(opened.descriptor, opened.metadata.size) }
    } finally {
      await opened.descriptor.close()
    }
    if (identity.bytes !== file.bytes || identity.sha256 !== file.sha256) {
      throw new Error(`signing control file changed from its approved public-safe identity: ${file.path}`)
    }
    totalBytes += identity.bytes
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('signing control payload exceeds its total size limit')
    }
    entries.push({ ...file })
  }
  return {
    schema_version: 1,
    document_type: 'emate.local-signing-control-bundle',
    format: 'emate-signing-control-v1',
    metadata: assertMetadata(metadata),
    limits: {
      max_manifest_bytes: MAX_MANIFEST_BYTES,
      max_file_bytes: MAX_FILE_BYTES,
      max_total_bytes: MAX_TOTAL_BYTES,
      max_files: MAX_FILES,
    },
    file_count: entries.length,
    total_bytes: totalBytes,
    files: entries,
  }
}

function manifestBytes(manifest) {
  const bytes = Buffer.from(canonicalJson(manifest), 'utf8')
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('signing control manifest size is invalid')
  }
  return bytes
}

async function writeAll(descriptor, bytes, position) {
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await descriptor.write(bytes, offset, bytes.byteLength - offset, position + offset)
    if (bytesWritten <= 0) throw new Error('signing control bundle write made no progress')
    offset += bytesWritten
  }
}

async function copyExact(source, destination, bytes, sourceStart, destinationStart) {
  const hash = createHash('sha256')
  const chunk = Buffer.allocUnsafe(CHUNK_BYTES)
  let offset = 0
  while (offset < bytes) {
    const length = Math.min(chunk.byteLength, bytes - offset)
    const { bytesRead } = await source.read(chunk, 0, length, sourceStart + offset)
    if (bytesRead !== length) throw new Error('signing control payload ended before its declared size')
    hash.update(chunk.subarray(0, bytesRead))
    await writeAll(destination, chunk.subarray(0, bytesRead), destinationStart + offset)
    offset += bytesRead
  }
  return hash.digest('hex')
}

async function publishCreateOnly(temporary, output) {
  try {
    await link(temporary, output)
  } catch (cause) {
    if (cause?.code !== 'EEXIST') throw cause
    const [candidate, existing] = await Promise.all([
      fileIdentity(temporary, 'temporary signing control bundle', MAX_BUNDLE_BYTES),
      fileIdentity(output, 'existing signing control bundle', MAX_BUNDLE_BYTES),
    ])
    if (candidate.bytes !== existing.bytes || candidate.sha256 !== existing.sha256) {
      throw new Error('existing signing control bundle differs from the deterministic candidate')
    }
  }
}

/** Create a deterministic, streaming, regular-files-only protected-signer control bundle. */
export async function createSigningControlBundle({ root: inputRoot, output: inputOutput, metadata, files }) {
  const root = await realpath(resolve(inputRoot))
  const output = resolve(inputOutput)
  const manifest = await bundleManifest(root, metadata, files)
  const encoded = manifestBytes(manifest)
  const header = Buffer.alloc(MAGIC.byteLength + LENGTH_BYTES)
  MAGIC.copy(header)
  header.writeBigUInt64BE(BigInt(encoded.byteLength), MAGIC.byteLength)
  await mkdir(dirname(output), { recursive: true })
  const temporary = `${output}.tmp-${randomBytes(8).toString('hex')}`
  const destination = await open(temporary, 'wx', 0o600)
  let position = 0
  try {
    await writeAll(destination, header, position)
    position += header.byteLength
    await writeAll(destination, encoded, position)
    position += encoded.byteLength
    for (const file of manifest.files) {
      const { descriptor, metadata: current } = await openRootFile(root, file.path, `signing control file ${file.path}`)
      try {
        if (current.size !== file.bytes) throw new Error(`signing control file changed size: ${file.path}`)
        const actual = await copyExact(descriptor, destination, file.bytes, 0, position)
        if (actual !== file.sha256) throw new Error(`signing control file changed digest: ${file.path}`)
        position += file.bytes
      } finally {
        await descriptor.close()
      }
    }
    await destination.sync()
  } catch (cause) {
    await destination.close()
    await rm(temporary, { force: true })
    throw cause
  }
  await destination.close()
  try {
    await publishCreateOnly(temporary, output)
    const identity = await fileIdentity(output, 'signing control bundle', MAX_BUNDLE_BYTES)
    return { ...identity, manifest }
  } finally {
    await rm(temporary, { force: true })
  }
}

function validateManifest(value) {
  const limits = value?.limits
  if (!exactKeys(value, [
    'schema_version', 'document_type', 'format', 'metadata', 'limits', 'file_count', 'total_bytes', 'files',
  ]) || value.schema_version !== 1 || value.document_type !== 'emate.local-signing-control-bundle'
    || value.format !== 'emate-signing-control-v1' || !exactKeys(limits, [
      'max_manifest_bytes', 'max_file_bytes', 'max_total_bytes', 'max_files',
    ]) || limits.max_manifest_bytes !== MAX_MANIFEST_BYTES || limits.max_file_bytes !== MAX_FILE_BYTES
    || limits.max_total_bytes !== MAX_TOTAL_BYTES || limits.max_files !== MAX_FILES
    || !Number.isSafeInteger(value.file_count) || value.file_count <= 0 || value.file_count > MAX_FILES
    || !Number.isSafeInteger(value.total_bytes) || value.total_bytes <= 0 || value.total_bytes > MAX_TOTAL_BYTES
    || !Array.isArray(value.files) || value.files.length !== value.file_count) {
    throw new Error('signing control bundle manifest is invalid')
  }
  assertMetadata(value.metadata)
  let totalBytes = 0
  for (const [index, file] of value.files.entries()) {
    if (!exactKeys(file, ['path', 'classification', 'bytes', 'sha256']) || !safePath(file.path)
      || !CLASSIFICATIONS.has(file.classification) || !Number.isSafeInteger(file.bytes)
      || file.bytes <= 0 || file.bytes > MAX_FILE_BYTES || !SHA256.test(file.sha256 ?? '')
      || index > 0 && comparePath(value.files[index - 1].path, file.path) >= 0) {
      throw new Error('signing control bundle file descriptor is invalid or duplicate')
    }
    totalBytes += file.bytes
  }
  if (totalBytes !== value.total_bytes) throw new Error('signing control bundle total size is invalid')
  return value
}

async function readHeader(descriptor, size) {
  const header = Buffer.alloc(MAGIC.byteLength + LENGTH_BYTES)
  const { bytesRead } = await descriptor.read(header, 0, header.byteLength, 0)
  if (bytesRead !== header.byteLength || !header.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
    throw new Error('signing control bundle header is invalid')
  }
  const manifestLength = Number(header.readBigUInt64BE(MAGIC.byteLength))
  if (!Number.isSafeInteger(manifestLength) || manifestLength <= 0 || manifestLength > MAX_MANIFEST_BYTES
    || header.byteLength + manifestLength >= size) throw new Error('signing control bundle manifest length is invalid')
  const encoded = Buffer.alloc(manifestLength)
  const manifestRead = await descriptor.read(encoded, 0, manifestLength, header.byteLength)
  if (manifestRead.bytesRead !== manifestLength) throw new Error('signing control bundle manifest is truncated')
  let parsed
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(encoded))
  } catch {
    throw new Error('signing control bundle manifest JSON is invalid')
  }
  const manifest = validateManifest(parsed)
  if (canonicalJson(manifest) !== encoded.toString('utf8')) {
    throw new Error('signing control bundle manifest is not canonical')
  }
  const payloadStart = header.byteLength + manifestLength
  if (payloadStart + manifest.total_bytes !== size) throw new Error('signing control bundle size or trailing bytes are invalid')
  return { manifest, payloadStart }
}

async function openBundle(path) {
  const { descriptor, metadata } = await openRegular(resolve(path), 'signing control bundle')
  try {
    const header = await readHeader(descriptor, metadata.size)
    return { descriptor, ...header }
  } catch (cause) {
    await descriptor.close()
    throw cause
  }
}

export async function inspectSigningControlBundle(path) {
  const { descriptor, manifest } = await openBundle(path)
  try {
    let position = MAGIC.byteLength + LENGTH_BYTES + manifestBytes(manifest).byteLength
    for (const file of manifest.files) {
      const actual = await hashHandle(descriptor, file.bytes, position)
      if (actual !== file.sha256) throw new Error(`signing control payload digest is invalid: ${file.path}`)
      position += file.bytes
    }
    return manifest
  } finally {
    await descriptor.close()
  }
}

async function allFiles(root, prefix = '') {
  const paths = []
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    const metadata = await lstat(join(root, ...path.split('/')))
    if (metadata.isSymbolicLink()) throw new Error(`signing control extraction created a symbolic link: ${path}`)
    if (metadata.isDirectory()) paths.push(...await allFiles(root, path))
    else if (metadata.isFile()) paths.push(path)
    else throw new Error(`signing control extraction created a non-file entry: ${path}`)
  }
  return paths
}

export async function extractSigningControlBundle(path, destinationPath) {
  const destination = resolve(destinationPath)
  try {
    await stat(destination)
    throw new Error('signing control extraction destination already exists')
  } catch (cause) {
    if (cause?.code !== 'ENOENT') throw cause
  }
  const staging = `${destination}.extracting-${randomBytes(8).toString('hex')}`
  const { descriptor, manifest, payloadStart } = await openBundle(path)
  try {
    await mkdir(staging, { recursive: false, mode: 0o700 })
    let sourcePosition = payloadStart
    for (const file of manifest.files) {
      const output = join(staging, ...file.path.split('/'))
      await mkdir(dirname(output), { recursive: true, mode: 0o700 })
      const target = await open(output, 'wx', 0o600)
      try {
        const actual = await copyExact(descriptor, target, file.bytes, sourcePosition, 0)
        if (actual !== file.sha256) throw new Error(`signing control payload digest is invalid: ${file.path}`)
        await target.sync()
      } finally {
        await target.close()
      }
      sourcePosition += file.bytes
    }
    await writeFile(join(staging, 'signing-control-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx', mode: 0o600,
    })
    const actual = await allFiles(staging)
    const expected = ['signing-control-manifest.json', ...manifest.files.map(file => file.path)].sort()
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('signing control extraction contains an unexpected file')
    }
    await mkdir(dirname(destination), { recursive: true })
    await rename(staging, destination)
    return manifest
  } catch (cause) {
    await rm(staging, { recursive: true, force: true })
    throw cause
  } finally {
    await descriptor.close()
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: { bundle: { type: 'string' }, output: { type: 'string' } },
  })
  if (positionals.length !== 1 || values.bundle === undefined
    || positionals[0] === 'unpack' && values.output === undefined
    || !['inspect', 'unpack'].includes(positionals[0])) {
    throw new Error('usage: signing-control-bundle.mjs <inspect|unpack> --bundle <file> [--output <directory>]')
  }
  const manifest = positionals[0] === 'inspect'
    ? await inspectSigningControlBundle(values.bundle)
    : await extractSigningControlBundle(values.bundle, values.output)
  process.stdout.write(`${JSON.stringify(manifest)}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (cause) {
    process.stderr.write(`signing-control-bundle: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
