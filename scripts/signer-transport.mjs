#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile, lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { R2_PUBLIC_ORIGIN } from './release-source.mjs'

export const SIGNER_ACTION_COMMIT = '93c707e2b7d833db3df4ee0013455b905232e1f6'
export const SIGNER_ACTION_REPOSITORY = 'zyfjacksonchen-source/e-mate-desktop-publication'
export const SIGNER_ACTION_OWNER = `${SIGNER_ACTION_REPOSITORY}@${SIGNER_ACTION_COMMIT}`
export const SIGNER_ACTION_USES = `${SIGNER_ACTION_REPOSITORY}/local-schema2@${SIGNER_ACTION_COMMIT}`
export const SIGNER_REPOSITORY = 'zyfjacksonchen-source/e-Mate-2.0.11'
export const SIGNER_WORKFLOW = '.github/workflows/desktop-publication.yml'
export const COMPATIBILITY_WORKFLOW = '.github/workflows/desktop-compatibility-attestation.yml'
export const R2_ORIGIN = R2_PUBLIC_ORIGIN
export const COMPATIBILITY_RECEIPT_PATH = 'publication/compatibility-attestation-receipt.json'
export const SIGNING_BUNDLE_PATH = 'publication/protected-signer-control.emate'
export const SIGNING_INPUT_REQUEST_PATH = 'publication/signing-input-owner-request.json'
export const SIGNING_INPUT_RECEIPT_PATH = 'publication/signing-input-owner-receipt.json'
export const SIGNER_DISPATCH_REQUEST_PATH = 'publication/protected-signer-dispatch-request.json'
export const SIGNER_RESULT_PATH = 'publication/protected-signer-result'
export const SIGNER_RESULT_RECEIPT = 'signer-result-receipt.json'
export const SIGNER_RESULT_OWNER_RECEIPT_PATH = 'publication/protected-signer-result-owner-receipt.json'
export const PROFILE_SNAPSHOT_PATH = 'profile-current-snapshot.json'

const SHA40 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const GITHUB_ID = /^[1-9][0-9]*$/u
const RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{12}-[0-9a-f]{6}$/u
const CONTROL_MAX_BYTES = 16 * 1024 * 1024
const PROFILE_RESULT_FILES = [
  'profile-component-aggregate.json',
  'profile-desired-state/darwin-arm64.json',
  'profile-desired-state/darwin-x64.json',
  'profile-desired-state/win32-x64.json',
  'profile-publication-plan.json',
  'profile-signer-result.json',
]
const DESKTOP_RESULT_FILES = [
  'cloudflare-plugin-handoff.json', 'cloudflare-publication-plan.json', 'desktop-release-signed.json',
]

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys) {
  if (!record(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function safePath(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._+@/-]+$/u.test(value) && !isAbsolute(value)
    && !value.includes('\\') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function regularIdentity(path, maximum = Number.MAX_SAFE_INTEGER) {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > maximum) {
    throw new Error(`protected signer input is not a bounded regular file: ${path}`)
  }
  const descriptor = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const hash = createHash('sha256')
  try {
    const current = await descriptor.stat()
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size) {
      throw new Error(`protected signer input changed before read: ${path}`)
    }
    const chunk = Buffer.allocUnsafe(64 * 1024)
    let offset = 0
    while (offset < current.size) {
      const length = Math.min(chunk.byteLength, current.size - offset)
      const { bytesRead } = await descriptor.read(chunk, 0, length, offset)
      if (bytesRead !== length) throw new Error(`protected signer input is truncated: ${path}`)
      hash.update(chunk.subarray(0, bytesRead))
      offset += bytesRead
    }
    return { bytes: current.size, sha256: hash.digest('hex') }
  } finally {
    await descriptor.close()
  }
}

async function json(path, label) {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > CONTROL_MAX_BYTES) {
    throw new Error(`${label} is not a bounded regular file`)
  }
  const descriptor = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const current = await descriptor.stat()
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size) {
      throw new Error(`${label} changed before read`)
    }
    const bytes = Buffer.alloc(current.size)
    let offset = 0
    while (offset < bytes.byteLength) {
      const { bytesRead } = await descriptor.read(bytes, offset, bytes.byteLength - offset, offset)
      if (bytesRead <= 0) throw new Error(`${label} is truncated`)
      offset += bytesRead
    }
    let value
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch {
      throw new Error(`${label} JSON is invalid`)
    }
    return { value, identity: { bytes: bytes.byteLength, sha256: sha256(bytes) } }
  } finally {
    await descriptor.close()
  }
}

export function validateCompatibilityCarrierReceipt(receipt, run, request, requestSha256) {
  const expectedFiles = request?.workflow?.exact_files
  const artifact = receipt?.artifact
  const archive = artifact?.archive
  if (!exactKeys(receipt, [
    'schema_version', 'document_type', 'status', 'authority', 'request_sha256', 'repository', 'workflow',
    'ref', 'head_sha', 'run', 'job', 'artifact', 'verification', 'production_state', 'next_owner',
  ]) || receipt.schema_version !== 1
    || receipt.document_type !== 'emate.github-compatibility-attestation-owner-receipt'
    || receipt.status !== 'passed' || receipt.authority !== 'github-api-verification-owner'
    || receipt.request_sha256 !== requestSha256 || !SHA256.test(requestSha256 ?? '')
    || receipt.repository !== SIGNER_REPOSITORY || receipt.workflow !== COMPATIBILITY_WORKFLOW
    || receipt.ref !== 'refs/heads/main' || receipt.head_sha !== run.source_commit
    || !exactKeys(receipt.run, ['id', 'attempt', 'event', 'status', 'conclusion', 'head_sha'])
    || !GITHUB_ID.test(receipt.run.id ?? '') || receipt.run.attempt !== 1
    || receipt.run.event !== 'workflow_dispatch' || receipt.run.status !== 'completed'
    || receipt.run.conclusion !== 'success' || receipt.run.head_sha !== run.source_commit
    || !exactKeys(receipt.job, ['name', 'status', 'conclusion', 'unique'])
    || receipt.job.name !== 'Materialize exact R2 bytes for the accepted 2.0.13 schema-2 parser'
    || receipt.job.status !== 'completed' || receipt.job.conclusion !== 'success' || receipt.job.unique !== true
    || !exactKeys(artifact, [
      'role', 'name', 'artifact_id', 'digest', 'bytes', 'run_id', 'source_commit', 'expired', 'archive',
    ]) || artifact.role !== 'desktop_candidate' || artifact.name !== request.workflow.artifact_name
    || !GITHUB_ID.test(artifact.artifact_id ?? '') || !/^sha256:[0-9a-f]{64}$/u.test(artifact.digest ?? '')
    || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.run_id !== receipt.run.id
    || artifact.source_commit !== run.source_commit || artifact.expired !== false
    || !exactKeys(archive, ['bytes', 'sha256', 'compression_level_0', 'exact_files'])
    || !Number.isSafeInteger(archive.bytes) || archive.bytes <= 0 || !SHA256.test(archive.sha256 ?? '')
    || artifact.bytes !== archive.bytes || artifact.digest !== `sha256:${archive.sha256}`
    || archive.compression_level_0 !== true || !isDeepStrictEqual(archive.exact_files, expectedFiles)
    || !exactKeys(receipt.verification, ['protected_main', 'workflow', 'job', 'artifact', 'archive'])
    || Object.values(receipt.verification).some(value => value !== 'passed')
    || !exactKeys(receipt.production_state, [
      'github_built_or_tested_installer_bytes', 'r2_write_performed', 'pointer_changed',
    ]) || receipt.production_state.github_built_or_tested_installer_bytes !== false
    || receipt.production_state.r2_write_performed !== false || receipt.production_state.pointer_changed !== false
    || receipt.next_owner !== SIGNER_ACTION_OWNER) {
    throw new Error('compatibility attestation owner receipt is invalid')
  }
  return receipt
}

async function tree(root, prefix = '') {
  const files = []
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isSymbolicLink()) throw new Error(`protected signer input contains a symbolic link: ${path}`)
    if (entry.isDirectory()) files.push(...await tree(root, path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`protected signer input contains a non-file entry: ${path}`)
  }
  return files
}

async function assertCanonicalRootFile(root, path) {
  if (!safePath(path)) throw new Error(`protected signer input path is invalid: ${String(path)}`)
  const canonicalRoot = await realpath(root)
  const absolute = join(canonicalRoot, ...path.split('/'))
  if (await realpath(absolute) !== absolute) throw new Error(`protected signer input escaped its root: ${path}`)
  return absolute
}

async function publicSafeIdentity(path, classification) {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink() || before.size <= 0) {
    throw new Error(`protected signer public control input is not a regular file: ${path}`)
  }
  const descriptor = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const hash = createHash('sha256')
  try {
    const current = await descriptor.stat()
    if (!current.isFile() || current.dev !== before.dev || current.ino !== before.ino || current.size !== before.size) {
      throw new Error(`protected signer public control input changed before scan: ${path}`)
    }
    const chunk = Buffer.allocUnsafe(64 * 1024)
    let offset = 0
    let tail = ''
    while (offset < current.size) {
      const length = Math.min(chunk.byteLength, current.size - offset)
      const { bytesRead } = await descriptor.read(chunk, 0, length, offset)
      if (bytesRead !== length) throw new Error(`protected signer public control input was truncated: ${path}`)
      const bytes = chunk.subarray(0, bytesRead)
      hash.update(bytes)
      const text = tail + bytes.toString('latin1')
      if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(text)
        || /(?:ghp_|github_pat_|AKIA|sk-|xox[baprs]-|AIza)[A-Za-z0-9_=-]{12,}/u.test(text)
        || /["'](?:password|secret|token|authorization|cookie|private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)["']\s*[:=]\s*["'][^"'\r\n]{8,}["']/iu.test(text)
        || /(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[A-Za-z0-9._-]+/u.test(text)
        || classification === 'redacted-local-flow-control' && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(text)) {
        throw new Error(`protected signer public control input contains sensitive material: ${path}`)
      }
      tail = text.slice(-4096)
      offset += bytesRead
    }
    return { bytes: current.size, sha256: hash.digest('hex') }
  } finally {
    await descriptor.close()
  }
}

export function validatePublicControlRun(run) {
  if (!exactKeys(run, [
    'schema_version', 'document_type', 'run_id', 'command', 'version', 'source_commit', 'source_branch',
    'created_at', 'updated_at', 'status', 'platforms', 'verification', 'manifest_inputs',
    'release_transaction', 'publication', 'rollback',
  ]) || run.schema_version !== 1 || run.document_type !== 'emate.local-flow-run'
    || !RUN_ID.test(run.run_id ?? '') || run.command !== 'candidate' || run.status !== 'built'
    || !SHA40.test(run.source_commit ?? '') || typeof run.source_branch !== 'string' || run.source_branch === ''
    || run.verification?.status !== 'passed' || !exactKeys(run.platforms, ['macos', 'windows'])
    || !['passed', 'reused'].includes(run.platforms.macos?.status)
    || !['passed', 'reused'].includes(run.platforms.windows?.status)
    || run.platforms.macos.source_commit !== run.source_commit
    || run.platforms.windows.source_commit !== run.source_commit
    || run.rollback?.status !== 'not-requested'
    || run.publication?.status !== 'awaiting-compatibility-attestation'
    || run.publication.scope !== 'full' || run.publication.owner !== 'github-compatibility-attestation-carrier'
    || run.publication.immutable_request !== 'publication/immutable-owner-request.json'
    || run.publication.immutable_receipt !== 'publication/immutable-owner-receipt.json'
    || run.publication.request !== 'publication/compatibility-attestation-request.json'
    || ![run.publication.immutable_request_sha256, run.publication.immutable_receipt_sha256,
      run.publication.request_sha256].every(value => SHA256.test(value ?? ''))
    || run.publication.transaction_mode !== run.release_transaction?.mode) {
    throw new Error('protected signer public control run schema is invalid')
  }
  const closed = new Map([
    ['platforms', ['macos', 'windows']],
    ['platforms.macos', ['status', 'source_commit', 'artifact']],
    ['platforms.windows', ['status', 'source_commit', 'artifact', 'codex_remote']],
    ['platforms.macos.artifact', ['name', 'bytes', 'sha256']],
    ['platforms.windows.artifact', ['name', 'bytes', 'sha256']],
    ['platforms.windows.codex_remote', ['host', 'request_sha256', 'receipt', 'receipt_sha256']],
    ['verification', ['status', 'verified_at', 'artifacts', 'computer_use']],
    ['verification.artifacts', ['macos', 'windows']],
    ['verification.artifacts.macos', ['primary', 'files']],
    ['verification.artifacts.windows', ['primary', 'files']],
    ['verification.artifacts.macos.primary', ['name', 'bytes', 'sha256']],
    ['verification.artifacts.windows.primary', ['name', 'bytes', 'sha256']],
    ['verification.artifacts.macos.files[]', ['name', 'bytes', 'sha256']],
    ['verification.artifacts.windows.files[]', ['name', 'bytes', 'sha256']],
    ['verification.computer_use', ['macos', 'windows']],
    ['verification.computer_use.macos', [
      'task', 'thread_id', 'matrix', 'scope', 'status', 'host', 'tested_at', 'installed_artifact_sha256',
      'coverage', 'computer_use', 'matrix_receipt',
    ]],
    ['verification.computer_use.windows', [
      'task', 'thread_id', 'matrix', 'scope', 'status', 'host', 'tested_at', 'installed_artifact_sha256',
      'coverage', 'computer_use', 'matrix_receipt',
    ]],
    ['verification.computer_use.macos.computer_use', ['status', 'installed_artifact_sha256']],
    ['verification.computer_use.windows.computer_use', ['status', 'disposition', 'tested']],
    ['verification.computer_use.macos.matrix_receipt', ['file', 'sha256']],
    ['verification.computer_use.windows.matrix_receipt', ['file', 'sha256']],
    ['manifest_inputs', [
      'schema_version', 'document_type', 'status', 'ledger', 'base_contract', 'component_inventory',
      'profile_build_receipts', 'platform_receipts', 'artifact_receipts', 'local_candidate_provenance',
      'profile_signing', 'client_compatible_provenance', 'targets',
    ]],
    ['manifest_inputs.ledger', ['path', 'bytes', 'sha256']],
    ['manifest_inputs.base_contract', [
      'path', 'bytes', 'sha256', 'id', 'schedule_protocol_floor', 'harness_commit', 'trusted_signing_key_ids',
    ]],
    ['manifest_inputs.component_inventory', ['path', 'bytes', 'sha256']],
    ['manifest_inputs.profile_build_receipts', ['macos', 'windows']],
    ['manifest_inputs.profile_build_receipts.macos', ['path', 'bytes', 'sha256']],
    ['manifest_inputs.profile_build_receipts.windows', ['path', 'bytes', 'sha256']],
    ['manifest_inputs.platform_receipts', ['macos', 'windows']],
    ['manifest_inputs.platform_receipts.macos', ['path', 'bytes', 'sha256']],
    ['manifest_inputs.platform_receipts.windows', ['path', 'bytes', 'sha256']],
    ['manifest_inputs.artifact_receipts', ['macos', 'windows']],
    ['manifest_inputs.artifact_receipts.macos', ['path', 'bytes', 'sha256']],
    ['manifest_inputs.artifact_receipts.windows', ['path', 'bytes', 'sha256']],
    ['manifest_inputs.local_candidate_provenance', ['path', 'bytes', 'sha256']],
    ['release_transaction', [
      'schema_version', 'mode', 'distribution_origin', 'run_id', 'product_version', 'source_commit',
      'current_public_version', 'current_public_source_commit', 'current_public_pointers', 'manual_manifest',
      'activation_order', 'rollback_order', 'manual_reinstall_required_for_existing_2_0_15',
    ]],
    ['release_transaction.current_public_pointers', ['signed', 'legacy', 'manual']],
    ['release_transaction.current_public_pointers.signed', ['key', 'identity']],
    ['release_transaction.current_public_pointers.legacy', ['key', 'identity']],
    ['release_transaction.current_public_pointers.manual', ['key', 'identity']],
    ['release_transaction.current_public_pointers.signed.identity', ['bytes', 'sha256', 'etag']],
    ['release_transaction.current_public_pointers.legacy.identity', ['bytes', 'sha256', 'etag']],
    ['release_transaction.current_public_pointers.manual.identity', ['bytes', 'sha256', 'etag']],
    ['release_transaction.manual_manifest', ['key', 'write', 'rollback']],
    ['publication', [
      'status', 'scope', 'owner', 'immutable_request', 'immutable_request_sha256', 'immutable_receipt',
      'immutable_receipt_sha256', 'request', 'request_sha256', 'transaction_mode',
    ]],
    ['rollback', ['status']],
  ])
  const allowedHosts = new Map([
    ['platforms.windows.codex_remote.host', 'DESKTOP-KH19ARC'],
    ['verification.computer_use.macos.host', 'T18-MAC'],
    ['verification.computer_use.windows.host', 'DESKTOP-KH19ARC'],
  ])
  const visit = (value, path = '') => {
    if (Array.isArray(value)) return value.forEach(item => visit(item, `${path}[]`))
    if (!record(value)) {
      if (typeof value === 'string' && (/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/u.test(value)
        || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)
        || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u.test(value))) {
        throw new Error(`protected signer public control run contains sensitive text: ${path}`)
      }
      return
    }
    if (path !== '' && (!closed.has(path) || !exactKeys(value, closed.get(path)))) {
      throw new Error(`protected signer public control run contains an unknown object shape: ${path}`)
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = path === '' ? key : `${path}.${key}`
      if (key === 'error' || /^(?:password|secret|token|authorization|cookie|private[_-]?key)$/iu.test(key)) {
        throw new Error(`protected signer public control run contains a forbidden field: ${childPath}`)
      }
      if (key === 'host') {
        if (allowedHosts.get(childPath) !== child) {
          throw new Error(`protected signer public control run contains an unknown host: ${childPath}`)
        }
      }
      visit(child, childPath)
    }
  }
  visit(run)
  return run
}

/** Return the exact T20R10 read closure, excluding only the two R2-hydrated primary installers. */
export async function collectSigningControlFiles(runRoot, run) {
  validatePublicControlRun(run)
  const files = new Map()
  const add = (path, classification) => {
    if (files.has(path)) throw new Error(`protected signer input path is duplicated: ${path}`)
    files.set(path, classification)
  }
  for (const path of [
    'run.json', 'publication/immutable-owner-request.json', 'publication/immutable-owner-receipt.json',
    'publication/compatibility-attestation-request.json', COMPATIBILITY_RECEIPT_PATH, PROFILE_SNAPSHOT_PATH,
  ]) add(path, 'redacted-local-flow-control')
  for (const path of await tree(runRoot, 'manifest-inputs')) add(path, 'future-public-profile-byte')
  for (const platform of ['macos', 'windows']) {
    const root = `artifacts/${platform}`
    const receiptPath = `${root}/local-artifact-receipt.json`
    add(receiptPath, 'verified-build-sidecar')
    const receipt = (await json(await assertCanonicalRootFile(runRoot, receiptPath), `${platform} artifact receipt`)).value
    const primary = run.verification?.artifacts?.[platform]?.primary?.name
    if (!Array.isArray(receipt.files) || typeof primary !== 'string'
      || receipt.files.filter(file => file?.name === primary).length !== 1) {
      throw new Error(`protected signer ${platform} artifact receipt is invalid`)
    }
    for (const file of receipt.files) {
      if (typeof file?.name !== 'string' || !safePath(file.name) || file.name.includes('/')) {
        throw new Error(`protected signer ${platform} artifact file name is invalid`)
      }
      if (file.name !== primary) add(`${root}/${file.name}`, 'verified-build-sidecar')
    }
  }
  const result = [...files].map(([path, classification]) => ({ path, classification }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  for (const file of result) {
    const absolute = await assertCanonicalRootFile(runRoot, file.path)
    Object.assign(file, await publicSafeIdentity(absolute, file.classification))
  }
  return result
}

export function buildSigningInputOwnerRequest(run, bindings) {
  const bundle = bindings?.bundle
  const compatibility = bindings?.compatibility
  if (!RUN_ID.test(run?.run_id ?? '') || !SHA40.test(run?.source_commit ?? '')
    || !exactKeys(bundle, ['path', 'bytes', 'sha256']) || bundle.path !== SIGNING_BUNDLE_PATH
    || !Number.isSafeInteger(bundle.bytes) || bundle.bytes <= 0 || !SHA256.test(bundle.sha256 ?? '')
    || !exactKeys(compatibility, ['request', 'receipt'])
    || ![compatibility.request, compatibility.receipt].every(value => exactKeys(value, ['path', 'bytes', 'sha256'])
      && safePath(value.path) && Number.isSafeInteger(value.bytes) && value.bytes > 0 && SHA256.test(value.sha256 ?? ''))) {
    throw new Error('protected signer control-object request bindings are invalid')
  }
  const key = `desktop/control/schema2-signing/${run.source_commit}/${bundle.sha256}.emate-signing-control`
  return {
    schema_version: 1,
    document_type: 'emate.local-cloudflare-owner-request',
    operation: 'publish-protected-signer-control-input',
    mode: 'apply',
    status: 'ready-for-existing-owner',
    authority: 'codex-cloudflare-plugin',
    distribution_origin: R2_ORIGIN,
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    transaction_mode: run.release_transaction.mode,
    compatibility,
    control_object: {
      role: 'protected-signer-control-input', key, url: `${R2_ORIGIN}/${key}`,
      source_path: bundle.path, bytes: bundle.bytes, sha256: bundle.sha256,
      disclosure: 'public-control-input-containing-verified-future-public-product-bytes',
      write: 'create-only-or-already-exact', authenticated_readback: 'required',
      public_full_byte_readback: 'required',
    },
    completion: {
      order: ['create-only-or-already-exact', 'authenticated-full-byte-readback', 'public-direct-200-full-byte-readback'],
      terminal_state: 'protected-signer-control-input-verified', next_request: 'protected-signer-dispatch',
    },
    delete_objects: [],
  }
}

export function validateSigningInputOwnerReceipt(receipt, request, requestSha256) {
  const expected = request.control_object
  const object = receipt?.control_object
  const authenticated = object?.authenticated_readback
  const publicReadback = object?.public_full_byte_readback
  if (!exactKeys(receipt, [
    'schema_version', 'document_type', 'operation', 'status', 'authority', 'distribution_origin',
    'run_id', 'version', 'source_commit', 'transaction_mode', 'request_sha256', 'control_object', 'deleted_objects',
  ]) || receipt.schema_version !== 1 || receipt.document_type !== 'emate.local-cloudflare-owner-receipt'
    || receipt.operation !== request.operation || receipt.status !== 'passed' || receipt.authority !== request.authority
    || receipt.distribution_origin !== R2_ORIGIN || receipt.run_id !== request.run_id
    || receipt.version !== request.version || receipt.source_commit !== request.source_commit
    || receipt.transaction_mode !== request.transaction_mode || receipt.request_sha256 !== requestSha256
    || !SHA256.test(requestSha256 ?? '') || !exactKeys(object, [
      'role', 'key', 'url', 'bytes', 'sha256', 'write', 'authenticated_readback', 'public_full_byte_readback',
    ]) || object.role !== expected.role || object.key !== expected.key || object.url !== expected.url
    || object.bytes !== expected.bytes || object.sha256 !== expected.sha256
    || !['created', 'already-exact'].includes(object.write)
    || !exactKeys(authenticated, ['status', 'bytes', 'sha256']) || authenticated.status !== 'passed'
    || authenticated.bytes !== expected.bytes || authenticated.sha256 !== expected.sha256
    || !exactKeys(publicReadback, ['status', 'url', 'http_status', 'bytes', 'sha256'])
    || publicReadback.status !== 'passed' || publicReadback.url !== expected.url || publicReadback.http_status !== 200
    || publicReadback.bytes !== expected.bytes || publicReadback.sha256 !== expected.sha256
    || !Array.isArray(receipt.deleted_objects) || receipt.deleted_objects.length !== 0) {
    throw new Error('protected signer control-object owner receipt is invalid')
  }
  return receipt
}

export function buildProtectedSignerDispatchRequest(run, bindings) {
  const compatibility = bindings?.compatibilityReceipt
  const control = bindings?.controlReceipt?.control_object
  const descriptors = bindings?.descriptors
  if (!GITHUB_ID.test(compatibility?.run?.id ?? '') || !GITHUB_ID.test(compatibility?.artifact?.artifact_id ?? '')
    || !exactKeys(descriptors, ['immutable_request', 'immutable_receipt', 'compatibility_request', 'compatibility_receipt',
      'signing_input_request', 'signing_input_receipt'])
    || Object.values(descriptors).some(value => !exactKeys(value, ['path', 'bytes', 'sha256'])
      || !safePath(value.path) || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || !SHA256.test(value.sha256 ?? ''))
    || typeof control?.key !== 'string' || control.url !== `${R2_ORIGIN}/${control.key}`) {
    throw new Error('protected signer dispatch bindings are invalid')
  }
  return {
    schema_version: 1,
    document_type: 'emate.local-protected-signer-dispatch-request',
    status: 'ready-for-manual-dispatch',
    control_plane: 'github-protected-schema2-signing',
    data_plane: {
      origin: R2_ORIGIN, installer_download: 'cloudflare-r2-only', online_update: 'cloudflare-r2-only',
      rollback: 'cloudflare-r2-only', github_result: 'local-import-control-evidence-only',
    },
    run_id: run.run_id,
    version: run.version,
    source_commit: run.source_commit,
    transaction_mode: run.release_transaction.mode,
    workflow: {
      repository: SIGNER_REPOSITORY, path: SIGNER_WORKFLOW, event: 'workflow_dispatch', ref: 'refs/heads/main',
      required_head: run.source_commit, required_run_attempt: 1,
      artifact_name: `e-mate-protected-schema2-signer-${run.source_commit}`,
      dispatch_performed_by_local_flow: false,
    },
    action: { owner: SIGNER_ACTION_OWNER, uses: SIGNER_ACTION_USES },
    inputs: {
      source_sha: run.source_commit, control_key: control.key, control_bytes: String(control.bytes),
      control_sha256: control.sha256, compatibility_run_id: compatibility.run.id,
      compatibility_artifact_id: compatibility.artifact.artifact_id,
      signing_input_request_bytes: String(descriptors.signing_input_request.bytes),
      signing_input_request_sha256: descriptors.signing_input_request.sha256,
      signing_input_receipt_bytes: String(descriptors.signing_input_receipt.bytes),
      signing_input_receipt_sha256: descriptors.signing_input_receipt.sha256,
    },
    predecessors: descriptors,
    expected_result: {
      document_type: 'emate.local-protected-signer-result', status: 'ready-for-main-local-flow-activation',
      exact_file_set_from_receipt: true, component_payloads_in_github_result: false,
      installer_bytes_in_github_result: false,
      owner_receipt: {
        document_type: 'emate.github-protected-signer-result-owner-receipt',
        authority: 'github-api-verification-owner',
        required: true,
        provenance: ['run', 'job', 'artifact-id-digest-archive', 'exact-file-set', 'expired-false'],
      },
    },
    forbidden_actions: ['build-installers', 'test-installers', 'write-r2', 'activate-pointer', 'serve-user-downloads'],
  }
}

/** Recreate the exact post-bundle dispatch request from frozen workflow inputs. */
export async function materializeProtectedSignerDispatchRequest({ runRoot, inputs }) {
  const root = resolve(runRoot)
  const run = (await json(join(root, 'run.json'), 'protected signer run')).value
  if (run.source_commit !== inputs.source_sha || inputs.control_url !== `${R2_ORIGIN}/${inputs.control_key}`
    || !Number.isSafeInteger(inputs.control_bytes) || inputs.control_bytes <= 0
    || ![inputs.control_sha256, inputs.signing_input_request_sha256, inputs.signing_input_receipt_sha256,
      inputs.dispatch_request_sha256].every(value => SHA256.test(value ?? ''))
    || !Number.isSafeInteger(inputs.signing_input_request_bytes) || inputs.signing_input_request_bytes <= 0
    || !Number.isSafeInteger(inputs.signing_input_receipt_bytes) || inputs.signing_input_receipt_bytes <= 0
    || !GITHUB_ID.test(inputs.compatibility_run_id ?? '') || !GITHUB_ID.test(inputs.compatibility_artifact_id ?? '')) {
    throw new Error('protected signer workflow dispatch inputs are invalid')
  }
  const compatibilityReceipt = (await json(
    join(root, COMPATIBILITY_RECEIPT_PATH), 'compatibility attestation owner receipt',
  )).value
  if (compatibilityReceipt.run?.id !== inputs.compatibility_run_id
    || compatibilityReceipt.artifact?.artifact_id !== inputs.compatibility_artifact_id) {
    throw new Error('protected signer workflow compatibility selectors drifted')
  }
  const actualDescriptor = async path => {
    const identity = await regularIdentity(join(root, ...path.split('/')))
    return { path, ...identity }
  }
  const descriptors = {
    immutable_request: await actualDescriptor('publication/immutable-owner-request.json'),
    immutable_receipt: await actualDescriptor('publication/immutable-owner-receipt.json'),
    compatibility_request: await actualDescriptor('publication/compatibility-attestation-request.json'),
    compatibility_receipt: await actualDescriptor(COMPATIBILITY_RECEIPT_PATH),
    signing_input_request: {
      path: SIGNING_INPUT_REQUEST_PATH,
      bytes: inputs.signing_input_request_bytes,
      sha256: inputs.signing_input_request_sha256,
    },
    signing_input_receipt: {
      path: SIGNING_INPUT_RECEIPT_PATH,
      bytes: inputs.signing_input_receipt_bytes,
      sha256: inputs.signing_input_receipt_sha256,
    },
  }
  const request = buildProtectedSignerDispatchRequest(run, {
    compatibilityReceipt,
    controlReceipt: { control_object: {
      key: inputs.control_key, url: inputs.control_url,
      bytes: inputs.control_bytes, sha256: inputs.control_sha256,
    } },
    descriptors,
  })
  const bytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`)
  if (sha256(bytes) !== inputs.dispatch_request_sha256) {
    throw new Error('protected signer workflow dispatch request digest drifted')
  }
  const path = join(root, SIGNER_DISPATCH_REQUEST_PATH)
  await mkdir(dirname(path), { recursive: true })
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }) } catch (cause) {
    if (cause?.code !== 'EEXIST' || !(await readFile(path)).equals(bytes)) throw cause
  }
  return request
}

async function copyExact(source, destination) {
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination, constants.COPYFILE_EXCL)
  return regularIdentity(destination)
}

function descriptor(path, identity) {
  return { path, bytes: identity.bytes, sha256: identity.sha256 }
}

async function assertExactTree(root, expected) {
  const actual = await tree(root)
  if (!isDeepStrictEqual(actual, [...expected].sort())) throw new Error('protected signer result file set is invalid')
}

/** Assemble one compact GitHub signer result; payload components remain in the local run only. */
export async function assembleProtectedSignerResult({ runRoot, desktop, profile, output, env = process.env }) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== SIGNER_REPOSITORY
    || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_REF_PROTECTED !== 'true' || env.GITHUB_RUN_ATTEMPT !== '1'
    || env.GITHUB_WORKFLOW_REF !== `${SIGNER_REPOSITORY}/${SIGNER_WORKFLOW}@refs/heads/main`
    || !SHA40.test(env.GITHUB_SHA ?? '') || !GITHUB_ID.test(env.GITHUB_RUN_ID ?? '')) {
    throw new Error('protected signer result requires exact protected-main attempt-1 context')
  }
  const dispatchPath = join(resolve(runRoot), SIGNER_DISPATCH_REQUEST_PATH)
  const dispatchInput = await json(dispatchPath, 'protected signer dispatch request')
  const dispatch = dispatchInput.value
  if (dispatch.source_commit !== env.GITHUB_SHA || dispatch.action?.uses !== SIGNER_ACTION_USES
    || dispatch.workflow?.artifact_name !== `e-mate-protected-schema2-signer-${env.GITHUB_SHA}`) {
    throw new Error('protected signer dispatch request drifted')
  }
  const destination = resolve(output)
  try { await lstat(destination); throw new Error('protected signer result output already exists') } catch (cause) {
    if (cause?.code !== 'ENOENT') throw cause
  }
  await mkdir(destination, { recursive: false, mode: 0o700 })
  try {
    const identities = []
    for (const [root, paths] of [[resolve(desktop), DESKTOP_RESULT_FILES], [resolve(profile), PROFILE_RESULT_FILES]]) {
      await assertExactTree(root, paths)
      for (const path of paths) identities.push(descriptor(path, await copyExact(
        join(root, ...path.split('/')), join(destination, ...path.split('/')),
      )))
    }
    identities.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    const receipt = {
      schema_version: 1,
      document_type: 'emate.local-protected-signer-result',
      status: 'ready-for-main-local-flow-activation',
      repository: SIGNER_REPOSITORY,
      workflow: SIGNER_WORKFLOW,
      ref: 'refs/heads/main',
      head_sha: env.GITHUB_SHA,
      github_run_id: env.GITHUB_RUN_ID,
      github_run_attempt: 1,
      artifact_name: dispatch.workflow.artifact_name,
      local_run_id: dispatch.run_id,
      action: { owner: SIGNER_ACTION_OWNER, uses: SIGNER_ACTION_USES },
      dispatch_request: descriptor(SIGNER_DISPATCH_REQUEST_PATH, dispatchInput.identity),
      control_input: {
        key: dispatch.inputs.control_key, bytes: Number(dispatch.inputs.control_bytes),
        sha256: dispatch.inputs.control_sha256, origin: R2_ORIGIN,
      },
      compatibility: {
        run_id: dispatch.inputs.compatibility_run_id,
        artifact_id: dispatch.inputs.compatibility_artifact_id,
      },
      files: identities,
      forbidden_content: ['component-payloads', 'installers', 'credentials', 'user-data'],
      next_owner: 'main-local-flow-activation',
    }
    await writeFile(join(destination, SIGNER_RESULT_RECEIPT), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await assertExactTree(destination, [SIGNER_RESULT_RECEIPT, ...identities.map(item => item.path)])
    return receipt
  } catch (cause) {
    await rm(destination, { recursive: true, force: true })
    throw cause
  }
}

export async function validateProtectedSignerResultDirectory(directory, run, dispatch, dispatchSha256) {
  const root = resolve(directory)
  const receiptInput = await json(join(root, SIGNER_RESULT_RECEIPT), 'protected signer result receipt')
  const receipt = receiptInput.value
  if (!exactKeys(receipt, [
    'schema_version', 'document_type', 'status', 'repository', 'workflow', 'ref', 'head_sha', 'github_run_id',
    'github_run_attempt', 'artifact_name', 'local_run_id', 'action', 'dispatch_request', 'control_input',
    'compatibility', 'files', 'forbidden_content', 'next_owner',
  ]) || receipt.schema_version !== 1 || receipt.document_type !== 'emate.local-protected-signer-result'
    || receipt.status !== 'ready-for-main-local-flow-activation' || receipt.repository !== SIGNER_REPOSITORY
    || receipt.workflow !== SIGNER_WORKFLOW || receipt.ref !== 'refs/heads/main'
    || receipt.head_sha !== run.source_commit || !GITHUB_ID.test(receipt.github_run_id ?? '')
    || receipt.github_run_attempt !== 1 || receipt.artifact_name !== dispatch.workflow.artifact_name
    || receipt.local_run_id !== run.run_id
    || !isDeepStrictEqual(receipt.action, { owner: SIGNER_ACTION_OWNER, uses: SIGNER_ACTION_USES })
    || !exactKeys(receipt.dispatch_request, ['path', 'bytes', 'sha256'])
    || receipt.dispatch_request.path !== SIGNER_DISPATCH_REQUEST_PATH
    || receipt.dispatch_request.sha256 !== dispatchSha256
    || !exactKeys(receipt.control_input, ['key', 'bytes', 'sha256', 'origin'])
    || receipt.control_input.key !== dispatch.inputs.control_key
    || receipt.control_input.bytes !== Number(dispatch.inputs.control_bytes)
    || receipt.control_input.sha256 !== dispatch.inputs.control_sha256 || receipt.control_input.origin !== R2_ORIGIN
    || !isDeepStrictEqual(receipt.compatibility, {
      run_id: dispatch.inputs.compatibility_run_id, artifact_id: dispatch.inputs.compatibility_artifact_id,
    }) || !isDeepStrictEqual(receipt.forbidden_content, ['component-payloads', 'installers', 'credentials', 'user-data'])
    || receipt.next_owner !== 'main-local-flow-activation' || !Array.isArray(receipt.files)) {
    throw new Error('protected signer result receipt is invalid')
  }
  const expectedPaths = [...DESKTOP_RESULT_FILES, ...PROFILE_RESULT_FILES].sort()
  if (!isDeepStrictEqual(receipt.files.map(file => file?.path), expectedPaths)
    || receipt.files.some(file => !exactKeys(file, ['path', 'bytes', 'sha256']) || !safePath(file.path)
      || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || !SHA256.test(file.sha256 ?? ''))) {
    throw new Error('protected signer result descriptor set is invalid')
  }
  await assertExactTree(root, [SIGNER_RESULT_RECEIPT, ...expectedPaths])
  for (const file of receipt.files) {
    const absolute = await assertCanonicalRootFile(root, file.path)
    if (!isDeepStrictEqual(await regularIdentity(absolute), { bytes: file.bytes, sha256: file.sha256 })) {
      throw new Error(`protected signer result bytes drifted: ${file.path}`)
    }
  }
  return { root, receipt, receiptIdentity: receiptInput.identity }
}

export function validateProtectedSignerResultOwnerReceipt(
  receipt, run, dispatch, dispatchSha256, resultReceiptDescriptor,
) {
  const artifact = receipt?.artifact
  const archive = artifact?.archive
  const expectedFiles = [SIGNER_RESULT_RECEIPT, ...DESKTOP_RESULT_FILES, ...PROFILE_RESULT_FILES].sort()
  if (!exactKeys(receipt, [
    'schema_version', 'document_type', 'status', 'authority', 'dispatch_request_sha256', 'repository',
    'workflow', 'ref', 'head_sha', 'run', 'job', 'artifact', 'result', 'verification',
    'production_state', 'next_owner',
  ]) || receipt.schema_version !== 1
    || receipt.document_type !== 'emate.github-protected-signer-result-owner-receipt'
    || receipt.status !== 'passed' || receipt.authority !== 'github-api-verification-owner'
    || receipt.dispatch_request_sha256 !== dispatchSha256 || !SHA256.test(dispatchSha256 ?? '')
    || receipt.repository !== SIGNER_REPOSITORY || receipt.workflow !== SIGNER_WORKFLOW
    || receipt.ref !== 'refs/heads/main' || receipt.head_sha !== run.source_commit
    || !exactKeys(receipt.run, ['id', 'attempt', 'event', 'status', 'conclusion', 'head_sha'])
    || !GITHUB_ID.test(receipt.run.id ?? '') || receipt.run.attempt !== 1
    || receipt.run.event !== 'workflow_dispatch' || receipt.run.status !== 'completed'
    || receipt.run.conclusion !== 'success' || receipt.run.head_sha !== run.source_commit
    || !exactKeys(receipt.job, ['name', 'status', 'conclusion', 'unique'])
    || receipt.job.name !== 'Produce protected schema-2 signer control result'
    || receipt.job.status !== 'completed' || receipt.job.conclusion !== 'success' || receipt.job.unique !== true
    || !exactKeys(artifact, [
      'role', 'name', 'artifact_id', 'digest', 'bytes', 'run_id', 'source_commit', 'expired', 'archive',
    ]) || artifact.role !== 'protected_schema2_signer_result'
    || artifact.name !== dispatch.workflow.artifact_name || !GITHUB_ID.test(artifact.artifact_id ?? '')
    || !/^sha256:[0-9a-f]{64}$/u.test(artifact.digest ?? '') || !Number.isSafeInteger(artifact.bytes)
    || artifact.bytes <= 0 || artifact.run_id !== receipt.run.id || artifact.source_commit !== run.source_commit
    || artifact.expired !== false || !exactKeys(archive, ['bytes', 'sha256', 'exact_files'])
    || !Number.isSafeInteger(archive.bytes) || archive.bytes <= 0 || !SHA256.test(archive.sha256 ?? '')
    || artifact.bytes !== archive.bytes || artifact.digest !== `sha256:${archive.sha256}`
    || !isDeepStrictEqual(archive.exact_files, expectedFiles)
    || !exactKeys(receipt.result, ['receipt', 'exact_files'])
    || !isDeepStrictEqual(receipt.result.receipt, resultReceiptDescriptor)
    || !isDeepStrictEqual(receipt.result.exact_files, expectedFiles)
    || !exactKeys(receipt.verification, ['protected_main', 'workflow', 'job', 'artifact', 'archive'])
    || Object.values(receipt.verification).some(value => value !== 'passed')
    || !isDeepStrictEqual(receipt.production_state, {
      r2_write_performed: false, pointer_changed: false, user_download_exposed: false,
    }) || receipt.next_owner !== 'main-local-flow-activation') {
    throw new Error('protected signer GitHub result owner receipt is invalid')
  }
  return receipt
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, strict: true, options: {
    'run-root': { type: 'string' }, desktop: { type: 'string' }, profile: { type: 'string' }, output: { type: 'string' },
    'source-sha': { type: 'string' }, 'control-key': { type: 'string' }, 'control-url': { type: 'string' },
    'control-bytes': { type: 'string' }, 'control-sha256': { type: 'string' },
    'compatibility-run-id': { type: 'string' }, 'compatibility-artifact-id': { type: 'string' },
    'signing-input-request-bytes': { type: 'string' }, 'signing-input-request-sha256': { type: 'string' },
    'signing-input-receipt-bytes': { type: 'string' }, 'signing-input-receipt-sha256': { type: 'string' },
    'dispatch-request-sha256': { type: 'string' },
  } })
  if (isDeepStrictEqual(positionals, ['materialize-dispatch'])) {
    const required = [
      'run-root', 'source-sha', 'control-key', 'control-url', 'control-bytes', 'control-sha256',
      'compatibility-run-id', 'compatibility-artifact-id', 'signing-input-request-bytes',
      'signing-input-request-sha256', 'signing-input-receipt-bytes', 'signing-input-receipt-sha256',
      'dispatch-request-sha256',
    ]
    if (required.some(name => values[name] === undefined)) throw new Error('protected signer dispatch materialization input is missing')
    await materializeProtectedSignerDispatchRequest({ runRoot: values['run-root'], inputs: {
      source_sha: values['source-sha'], control_key: values['control-key'], control_url: values['control-url'],
      control_bytes: Number(values['control-bytes']), control_sha256: values['control-sha256'],
      compatibility_run_id: values['compatibility-run-id'], compatibility_artifact_id: values['compatibility-artifact-id'],
      signing_input_request_bytes: Number(values['signing-input-request-bytes']),
      signing_input_request_sha256: values['signing-input-request-sha256'],
      signing_input_receipt_bytes: Number(values['signing-input-receipt-bytes']),
      signing_input_receipt_sha256: values['signing-input-receipt-sha256'],
      dispatch_request_sha256: values['dispatch-request-sha256'],
    } })
    process.stdout.write('{"status":"materialized"}\n')
    return
  }
  if (!isDeepStrictEqual(positionals, ['assemble'])
    || ['run-root', 'desktop', 'profile', 'output'].some(name => values[name] === undefined)) {
    throw new Error('usage: signer-transport.mjs assemble --run-root <dir> --desktop <dir> --profile <dir> --output <dir>')
  }
  const result = await assembleProtectedSignerResult({
    runRoot: values['run-root'], desktop: values.desktop, profile: values.profile, output: values.output,
  })
  process.stdout.write(`${JSON.stringify({ status: result.status, artifact_name: result.artifact_name })}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (cause) {
    process.stderr.write(`signer-transport: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
