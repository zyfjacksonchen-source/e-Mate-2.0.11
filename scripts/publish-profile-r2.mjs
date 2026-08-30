#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import {
  constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { loadReleaseBoundary } from './change-impact.mjs'
import { createProfileComponentAggregate } from './desktop-admission.mjs'
import {
  awaitingImmutablePublicationState,
  buildPublicationRequest,
  IMMUTABLE_REQUEST_PATH,
  loadRun,
  sourceIdentity,
  verifyManifestInputLedger,
} from './local-flow.mjs'
import {
  SIGNER_ACTION_OWNER,
  SIGNER_ACTION_USES,
  SIGNER_DISPATCH_REQUEST_PATH,
  SIGNING_BUNDLE_PATH,
  SIGNING_INPUT_RECEIPT_PATH,
  SIGNING_INPUT_REQUEST_PATH,
} from './signer-transport.mjs'
import { composeProfileReleaseCandidate, scanComponentArtifacts } from './profile-release.mjs'
import { R2_PUBLIC_ORIGIN } from './release-source.mjs'
import {
  assertCompleteProfileRelease,
  profileGenerationId,
} from '../desktop/e-mate-desktop/src/profile-generation.ts'
import {
  canonicalProfileJson,
  parseProfileBaseContract,
  parseProfileReleaseEnvelope,
  sameProfileReleaseTarget,
  selectProfileRelease,
  signProfileRelease,
  verifyProfileRelease,
} from '../desktop/e-mate-desktop/src/profile-release.ts'

const REPOSITORY = 'zyfjacksonchen-source/e-Mate-2.0.11'
const ORIGIN = R2_PUBLIC_ORIGIN
const TARGET_NAMES = ['darwin-arm64', 'darwin-x64', 'win32-x64']
const IMMUTABLE_CACHE = 'public,max-age=31536000,immutable'
const MAX_CURRENT_BYTES = 1024 * 1024
const MAX_CURRENT_SNAPSHOT_BYTES = 5 * 1024 * 1024
const CURRENT_SNAPSHOT_DOCUMENT = 'emate.profile-current-desired-state-snapshot'
const CURRENT_SNAPSHOT_AUTHORITY = 'codex-cloudflare-plugin'
const LOCAL_RUN_ID = /^\d{8}T\d{6}Z-[0-9a-f]{12}-[0-9a-f]{6}$/u
const SHA40 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function targetName(target) {
  return `${target.platform}-${target.arch}`
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, expected) {
  if (!record(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function descriptorFor(root, path) {
  const name = relative(root, path).split(sep).join('/')
  regularFile(path)
  const bytes = readFileSync(path)
  return { path: name, bytes: bytes.byteLength, sha256: sha256(bytes) }
}

function descriptorForResult(root, path) {
  const descriptor = descriptorFor(root, path)
  if (!descriptor.path.startsWith('profile-')) throw new Error('compact Profile result path is invalid')
  return descriptor
}

function currentSnapshotIdentity(root) {
  const releaseVersion = JSON.parse(readFileSync(join(root, 'desktop/e-mate-desktop/package.json'), 'utf8')).version
  const baseContractId = JSON.parse(readFileSync(join(root, 'desktop/e-mate-desktop/base-contract.json'), 'utf8')).id
  if (typeof releaseVersion !== 'string' || !STABLE_VERSION.test(releaseVersion)
    || typeof baseContractId !== 'string' || baseContractId === '') {
    throw new Error('Profile current snapshot candidate identity is invalid')
  }
  return { releaseVersion, baseContractId }
}

function currentSnapshotBody(value) {
  return {
    schema_version: value.schema_version,
    document_type: value.document_type,
    capture_authority: value.capture_authority,
    source_origin: value.source_origin,
    candidate_release_version: value.candidate_release_version,
    candidate_base_contract_id: value.candidate_base_contract_id,
    captured_at: value.captured_at,
    targets: value.targets,
  }
}

/** Build one reviewable, network-free snapshot from bytes read by the connected Cloudflare plugin. */
export function createProfileCurrentSnapshot(options) {
  if (!(options.currentByTarget instanceof Map)
    || canonicalProfileJson([...options.currentByTarget.keys()].sort()) !== canonicalProfileJson([...TARGET_NAMES].sort())) {
    throw new Error('Profile current snapshot must contain exactly the three Desktop targets')
  }
  const targets = Object.fromEntries(TARGET_NAMES.map(target => {
    const value = options.currentByTarget.get(target)
    if (value === undefined) return [target, { status: 'absent' }]
    const bytes = Buffer.from(value)
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CURRENT_BYTES) {
      throw new Error(`Profile current desired state is invalid: ${target}`)
    }
    return [target, {
      status: 'present',
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      content_base64: bytes.toString('base64'),
    }]
  }))
  const body = {
    schema_version: 1,
    document_type: CURRENT_SNAPSHOT_DOCUMENT,
    capture_authority: CURRENT_SNAPSHOT_AUTHORITY,
    source_origin: ORIGIN,
    candidate_release_version: options.releaseVersion,
    candidate_base_contract_id: options.baseContractId,
    captured_at: options.capturedAt,
    targets,
  }
  const snapshot = {
    ...body,
    snapshot_sha256: sha256(Buffer.from(canonicalProfileJson(body), 'utf8')),
  }
  return parseProfileCurrentSnapshot(snapshot, {
    releaseVersion: options.releaseVersion,
    baseContractId: options.baseContractId,
  }).snapshot
}

/** Parse an exact three-target snapshot without consulting production R2. */
export function parseProfileCurrentSnapshot(value, expected) {
  if (!record(value) || !exactKeys(value, [
    'schema_version', 'document_type', 'capture_authority', 'source_origin',
    'candidate_release_version', 'candidate_base_contract_id', 'captured_at', 'targets', 'snapshot_sha256',
  ]) || value.schema_version !== 1 || value.document_type !== CURRENT_SNAPSHOT_DOCUMENT
    || value.capture_authority !== CURRENT_SNAPSHOT_AUTHORITY || value.source_origin !== ORIGIN
    || value.candidate_release_version !== expected.releaseVersion
    || value.candidate_base_contract_id !== expected.baseContractId
    || typeof value.captured_at !== 'string'
    || !Number.isFinite(Date.parse(value.captured_at))
    || new Date(value.captured_at).toISOString() !== value.captured_at
    || !record(value.targets)
    || canonicalProfileJson(Object.keys(value.targets).sort()) !== canonicalProfileJson([...TARGET_NAMES].sort())
    || !SHA256.test(value.snapshot_sha256 ?? '')
    || value.snapshot_sha256 !== sha256(Buffer.from(canonicalProfileJson(currentSnapshotBody(value)), 'utf8'))) {
    throw new Error('Profile current desired-state snapshot is invalid')
  }
  const currentByTarget = new Map()
  for (const target of TARGET_NAMES) {
    const entry = value.targets[target]
    if (!record(entry) || entry.status === 'absent' && !exactKeys(entry, ['status'])) {
      throw new Error(`Profile current desired-state snapshot entry is invalid: ${target}`)
    }
    if (entry.status === 'absent') {
      currentByTarget.set(target, undefined)
      continue
    }
    if (entry.status !== 'present' || !exactKeys(entry, ['status', 'bytes', 'sha256', 'content_base64'])
      || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || entry.bytes > MAX_CURRENT_BYTES
      || !SHA256.test(entry.sha256 ?? '') || typeof entry.content_base64 !== 'string' || entry.content_base64 === '') {
      throw new Error(`Profile current desired-state snapshot entry is invalid: ${target}`)
    }
    const bytes = Buffer.from(entry.content_base64, 'base64')
    if (bytes.toString('base64') !== entry.content_base64
      || bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`Profile current desired-state snapshot bytes are invalid: ${target}`)
    }
    currentByTarget.set(target, bytes)
  }
  return { snapshot: value, currentByTarget }
}

export function loadProfileCurrentSnapshot(path, expected) {
  const metadata = regularFile(path)
  if (metadata.size === 0 || metadata.size > MAX_CURRENT_SNAPSHOT_BYTES) {
    throw new Error('Profile current desired-state snapshot size is invalid')
  }
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('Profile current desired-state snapshot JSON is invalid')
  }
  return parseProfileCurrentSnapshot(value, expected)
}

function regularFile(path) {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Profile publication input is not a regular file: ${path}`)
  return metadata
}

function signingCredentials(root, env) {
  const privateKeyPem = env.EMATE_PROFILE_SIGNING_PRIVATE_KEY
  if (typeof privateKeyPem !== 'string' || privateKeyPem === '') {
    throw new Error('production Profile signing key is missing')
  }
  const baseRaw = JSON.parse(readFileSync(join(root, 'desktop/e-mate-desktop/base-contract.json'), 'utf8'))
  const base = parseProfileBaseContract(baseRaw)
  let publicKey
  try {
    publicKey = createPublicKey(createPrivateKey(privateKeyPem)).export({ format: 'der', type: 'spki' }).toString('base64')
  } catch {
    throw new Error('production Profile signing key is invalid')
  }
  const trusted = base?.profile_signing_keys.find(key => key.public_key_spki_der_base64 === publicKey)
  const keyId = env.EMATE_PROFILE_SIGNING_KEY_ID || trusted?.id
  if (base === undefined || trusted === undefined || keyId !== trusted.id) {
    throw new Error('production Profile signing key is not trusted by the Desktop Base')
  }
  return { base, privateKeyPem, keyId }
}

function localProfileRequestState(run, requestDescriptor, allowedStages) {
  if (allowedStages === undefined) {
    return isDeepStrictEqual(run.publication, awaitingImmutablePublicationState(run, requestDescriptor.sha256))
  }
  if (!Array.isArray(allowedStages) || !allowedStages.includes(run.publication?.status)) return false
  const publication = run.publication
  if (publication.status === 'awaiting-compatibility-attestation') {
    return exactKeys(publication, [
      'status', 'scope', 'owner', 'immutable_request', 'immutable_request_sha256', 'immutable_receipt',
      'immutable_receipt_sha256', 'request', 'request_sha256', 'transaction_mode',
    ]) && publication.scope === 'full' && publication.owner === 'github-compatibility-attestation-carrier'
      && publication.immutable_request === IMMUTABLE_REQUEST_PATH
      && publication.immutable_request_sha256 === requestDescriptor.sha256
      && publication.immutable_receipt === 'publication/immutable-owner-receipt.json'
      && SHA256.test(publication.immutable_receipt_sha256 ?? '')
      && publication.request === 'publication/compatibility-attestation-request.json'
      && SHA256.test(publication.request_sha256 ?? '')
      && publication.transaction_mode === run.release_transaction?.mode
  }
  return publication.status === 'awaiting-protected-signer' && exactKeys(publication, [
    'status', 'scope', 'owner', 'immutable_request', 'immutable_request_sha256', 'immutable_receipt',
    'immutable_receipt_sha256', 'compatibility_request', 'compatibility_request_sha256',
    'compatibility_receipt', 'compatibility_receipt_sha256', 'control_bundle', 'control_bundle_bytes',
    'control_bundle_sha256', 'signing_input_request', 'signing_input_request_sha256',
    'signing_input_receipt', 'signing_input_receipt_sha256', 'request', 'request_sha256', 'action',
    'transaction_mode',
  ]) && publication.scope === 'full' && publication.owner === SIGNER_ACTION_OWNER
    && publication.immutable_request === IMMUTABLE_REQUEST_PATH
    && publication.immutable_request_sha256 === requestDescriptor.sha256
    && publication.immutable_receipt === 'publication/immutable-owner-receipt.json'
    && publication.compatibility_request === 'publication/compatibility-attestation-request.json'
    && publication.compatibility_receipt === 'publication/compatibility-attestation-receipt.json'
    && publication.control_bundle === SIGNING_BUNDLE_PATH
    && Number.isSafeInteger(publication.control_bundle_bytes) && publication.control_bundle_bytes > 0
    && publication.signing_input_request === SIGNING_INPUT_REQUEST_PATH
    && publication.signing_input_receipt === SIGNING_INPUT_RECEIPT_PATH
    && publication.request === SIGNER_DISPATCH_REQUEST_PATH && publication.action === SIGNER_ACTION_USES
    && [
      publication.immutable_receipt_sha256, publication.compatibility_request_sha256,
      publication.compatibility_receipt_sha256, publication.control_bundle_sha256,
      publication.signing_input_request_sha256, publication.signing_input_receipt_sha256,
      publication.request_sha256,
    ].every(value => SHA256.test(value ?? ''))
    && publication.transaction_mode === run.release_transaction?.mode
}

async function loadLocalProfileInputs(options) {
  const root = resolve(options.root)
  const runRoot = resolve(options.runRoot)
  const loaded = await loadRun(basename(runRoot), dirname(runRoot))
  if (resolve(loaded.directory) !== runRoot) throw new Error('local Profile run root is invalid')
  const run = loaded.run
  const requestPath = resolve(options.request)
  if (requestPath !== join(runRoot, IMMUTABLE_REQUEST_PATH)) {
    throw new Error('local Profile request is not the canonical run publication request')
  }
  const requestDescriptor = descriptorFor(runRoot, requestPath)
  const request = JSON.parse(readFileSync(requestPath, 'utf8'))
  if (!isDeepStrictEqual(request, buildPublicationRequest(run))) throw new Error('local Profile publication request is invalid')
  if (!localProfileRequestState(run, requestDescriptor, options.allowedPublicationStages)) {
    throw new Error('local Profile publication request descriptor drifted from its run')
  }
  await verifyManifestInputLedger(runRoot, run)
  const releaseVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  if (run.version !== releaseVersion) throw new Error('local Profile request version does not match the source')
  if (sourceIdentity(root).source_commit !== run.source_commit) {
    throw new Error('local Profile source is not the exact committed-clean ledger source')
  }
  const binding = run.manifest_inputs
  const sourceBaseBytes = readFileSync(join(root, 'desktop/e-mate-desktop/base-contract.json'))
  const sourceInventoryBytes = readFileSync(join(root, 'packages/dsh/profile/component-inventory.json'))
  const boundBaseBytes = readFileSync(join(runRoot, ...binding.base_contract.path.split('/')))
  const boundInventoryBytes = readFileSync(join(runRoot, ...binding.component_inventory.path.split('/')))
  if (!boundBaseBytes.equals(sourceBaseBytes) || !boundInventoryBytes.equals(sourceInventoryBytes)) {
    throw new Error('local Profile Base or inventory drifted from the source')
  }
  const boundary = loadReleaseBoundary(root)
  if (!boundary.valid) throw new Error(boundary.errors.join('\n'))
  const platformRoot = platform => join(runRoot, 'manifest-inputs', 'platforms', platform)

  return {
    runRoot,
    request,
    requestDescriptor,
    binding,
    macosRoot: platformRoot('macos'),
    artifactRoots: [
      join(platformRoot('macos'), 'unsigned-components'),
      join(platformRoot('windows'), 'unsigned-components'),
    ],
    expectedChangedIds: boundary.components.filter(component => component.desktop !== 'blocked')
      .map(component => component.id).sort(),
  }
}

function contentType(path) {
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'text/javascript; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.md') || path.endsWith('.txt') || path.endsWith('.yml') || path.endsWith('.yaml')) {
    return 'text/plain; charset=utf-8'
  }
  return 'application/octet-stream'
}

function immutableItem(path, key) {
  const metadata = regularFile(path)
  const bytes = readFileSync(path)
  if (metadata.size !== bytes.byteLength || bytes.byteLength === 0) throw new Error(`Profile publication object is empty or unstable: ${path}`)
  return {
    role: 'component',
    key,
    url: `${ORIGIN}/${key}`,
    path,
    size: bytes.byteLength,
    sha256: sha256(bytes),
    contentType: contentType(path),
    cacheControl: IMMUTABLE_CACHE,
  }
}

function keyForUrl(value) {
  const url = new URL(value)
  if (url.origin !== ORIGIN || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new Error('Profile component URL escaped the production R2 origin')
  }
  return url.pathname.slice(1)
}

function componentObjects(artifact) {
  const manifest = immutableItem(artifact.manifest_path, keyForUrl(artifact.reference.manifest_url))
  if (manifest.size !== artifact.reference.manifest_bytes || manifest.sha256 !== artifact.reference.manifest_sha256) {
    throw new Error(`component manifest bytes drifted before publication: ${artifact.reference.id}`)
  }
  const base = new URL('.', artifact.reference.manifest_url)
  const files = artifact.manifest.files.map(file => {
    const path = join(artifact.directory, 'files', ...file.path.split('/'))
    const url = new URL(`files/${file.path.split('/').map(encodeURIComponent).join('/')}`, base)
    const item = immutableItem(path, keyForUrl(url.href))
    if (item.size !== file.bytes || item.sha256 !== file.sha256) {
      throw new Error(`component file bytes drifted before publication: ${artifact.reference.id}/${file.path}`)
    }
    return item
  })
  return [manifest, ...files]
}

function loadCandidate(directory, base, expectedIds, sourceCommit, privateKeyPem, keyId, signatureKind) {
  const admission = JSON.parse(readFileSync(join(directory, 'admission.json'), 'utf8'))
  const payload = JSON.parse(readFileSync(join(directory, 'payload.json'), 'utf8'))
  assertCompleteProfileRelease(payload, expectedIds)
  const envelope = signProfileRelease(payload, privateKeyPem, keyId)
  const verified = verifyProfileRelease(envelope, base)
  const generation = profileGenerationId(payload)
  const name = targetName(payload.target)
  if (verified === undefined || !TARGET_NAMES.includes(name)
    || payload.source_commit !== sourceCommit
    || admission?.schema_version !== 1 || admission.document_type !== 'emate.profile-generation-admission'
    || admission.status !== 'verified' || admission.signature_kind !== signatureKind
    || admission.signature_key_id !== (signatureKind === 'production' ? keyId : 'ci-ephemeral')
    || admission.source_commit !== sourceCommit || admission.candidate_generation !== generation
    || admission.base_contract_id !== base.id
    || admission.schedule_protocol_floor !== base.schedule_protocol_floor
    || payload.schedule_protocol_floor !== base.schedule_protocol_floor
    || canonicalProfileJson(admission.target) !== canonicalProfileJson(payload.target)
    || !Array.isArray(admission.changed_components) || admission.changed_components.length === 0
    || new Set(admission.changed_components).size !== admission.changed_components.length
    || admission.changed_components.some((id, index, values) => typeof id !== 'string'
      || index > 0 && values[index - 1] >= id)) {
    throw new Error(`Profile candidate admission is invalid: ${directory}`)
  }
  if (signatureKind === 'production') {
    const stored = parseProfileReleaseEnvelope(readFileSync(join(directory, 'envelope.json')), base, MAX_CURRENT_BYTES)
    if (stored === undefined || canonicalProfileJson(stored) !== canonicalProfileJson(envelope)) {
      throw new Error(`production Profile candidate signature drifted: ${directory}`)
    }
  }
  return { directory, admission, payload: verified.payload, envelope, generation, name }
}

function validateCurrent(candidate, bytes, base, expectedIds, bootstrap) {
  let current
  let currentSelection
  if (bytes !== undefined) {
    current = parseProfileReleaseEnvelope(bytes, base, MAX_CURRENT_BYTES)
    if (current === undefined || !sameProfileReleaseTarget(current.payload.target, candidate.payload.target)) {
      throw new Error(`current desired state is invalid: ${candidate.name}`)
    }
    if (canonicalProfileJson(current) === canonicalProfileJson(candidate.envelope)) return
    currentSelection = selectProfileRelease(current.payload, base, 0)
    if (currentSelection !== 'base-required') assertCompleteProfileRelease(current.payload, expectedIds)
  }
  if (bootstrap) {
    if ((current !== undefined && currentSelection !== 'base-required')
      || candidate.admission.parent_generation !== null || candidate.payload.sequence !== 1) {
      throw new Error(`bootstrap candidate would replace an existing desired state: ${candidate.name}`)
    }
    if (candidate.admission.changed_components.length !== expectedIds.length) {
      throw new Error(`bootstrap candidate does not replace the complete component set: ${candidate.name}`)
    }
    return
  }
  if (current === undefined) throw new Error(`current desired state is missing: ${candidate.name}`)
  if (currentSelection === 'base-required') {
    throw new Error(`current desired state requires a Desktop Base migration: ${candidate.name}`)
  }
  if (candidate.admission.parent_generation !== profileGenerationId(current.payload)
    || candidate.payload.sequence !== current.payload.sequence + 1) {
    throw new Error(`candidate is not the direct successor of the public desired state: ${candidate.name}`)
  }
  const before = new Map(current.payload.components.map(component => [component.id, component.manifest_sha256]))
  const declared = new Set(candidate.admission.changed_components)
  for (const component of candidate.payload.components) {
    if (declared.has(component.id) !== (before.get(component.id) !== component.manifest_sha256)) {
      throw new Error(`changed component declaration drifted from the accepted set: ${candidate.name}/${component.id}`)
    }
  }
}

/** Validate all three admitted candidates and produce upload objects without changing R2. */
export function prepareProfilePublication(options) {
  const root = resolve(options.root)
  const boundary = loadReleaseBoundary(root)
  if (!boundary.valid) throw new Error(boundary.errors.join('\n'))
  const baseRaw = JSON.parse(readFileSync(join(root, 'desktop/e-mate-desktop/base-contract.json'), 'utf8'))
  const base = parseProfileBaseContract(baseRaw)
  if (base === undefined || base.id !== boundary.baseContract.id) throw new Error('Profile Base contract is invalid')
  if (!SHA40.test(options.sourceCommit)) throw new Error('Profile source commit is invalid')
  if (typeof options.privateKeyPem !== 'string' || options.privateKeyPem === '') throw new Error('Profile signing key is missing')
  let publicKey
  try {
    publicKey = createPublicKey(createPrivateKey(options.privateKeyPem)).export({ format: 'der', type: 'spki' }).toString('base64')
  } catch {
    throw new Error('Profile signing key is invalid')
  }
  const trusted = base.profile_signing_keys.find(key => key.public_key_spki_der_base64 === publicKey)
  const keyId = options.keyId ?? trusted?.id
  if (trusted === undefined || keyId !== trusted.id) throw new Error('Profile signing key is not trusted by the Desktop Base')
  const expectedIds = boundary.components.filter(component => component.desktop !== 'blocked').map(component => component.id).sort()
  const signatureKind = options.candidateSignatureKind ?? 'ephemeral'
  if (!['ephemeral', 'production'].includes(signatureKind)) throw new Error('Profile candidate signature kind is invalid')
  const candidates = options.candidateDirectories.map(directory => loadCandidate(
    resolve(directory), base, expectedIds, options.sourceCommit, options.privateKeyPem, keyId, signatureKind,
  )).sort((left, right) => left.name.localeCompare(right.name))
  if (canonicalProfileJson(candidates.map(candidate => candidate.name)) !== canonicalProfileJson([...TARGET_NAMES].sort())) {
    throw new Error('Profile publication must contain exactly one candidate for every Desktop target')
  }
  const expectedChangedIds = options.expectedChangedIds
  if (!Array.isArray(expectedChangedIds) || expectedChangedIds.length === 0
    || expectedChangedIds.some((id, index) => typeof id !== 'string'
      || !expectedIds.includes(id) || index > 0 && expectedChangedIds[index - 1] >= id)) {
    throw new Error('accepted CI changed component set is invalid')
  }
  for (const candidate of candidates) {
    if (canonicalProfileJson(candidate.admission.changed_components) !== canonicalProfileJson(expectedChangedIds)) {
      throw new Error(`candidate changed components do not match accepted CI impact: ${candidate.name}`)
    }
  }
  for (const candidate of candidates) {
    validateCurrent(candidate, options.currentByTarget.get(candidate.name), base, expectedIds, options.bootstrap)
  }

  const artifacts = scanComponentArtifacts(options.artifactRoots, base)
  const expectedArtifactUrls = new Set()
  for (const candidate of candidates) {
    const changed = new Set(candidate.admission.changed_components)
    for (const reference of candidate.payload.components) {
      if (changed.has(reference.id)) expectedArtifactUrls.add(reference.manifest_url)
    }
  }
  const artifactsByUrl = new Map(artifacts.map(artifact => [artifact.reference.manifest_url, artifact]))
  if (artifactsByUrl.size !== artifacts.length
    || artifactsByUrl.size !== expectedArtifactUrls.size
    || [...expectedArtifactUrls].some(url => !artifactsByUrl.has(url))) {
    throw new Error('changed component artifact set does not exactly match the admitted target candidates')
  }
  for (const candidate of candidates) {
    for (const reference of candidate.payload.components) {
      if (!candidate.admission.changed_components.includes(reference.id)) continue
      const artifact = artifactsByUrl.get(reference.manifest_url)
      if (artifact === undefined || canonicalProfileJson(artifact.reference) !== canonicalProfileJson(reference)) {
        throw new Error(`candidate reference does not match its component artifact: ${candidate.name}/${reference.id}`)
      }
    }
  }

  const objectMap = new Map()
  for (const artifact of artifacts) {
    for (const item of componentObjects(artifact)) {
      const previous = objectMap.get(item.key)
      if (previous !== undefined && (previous.sha256 !== item.sha256 || previous.size !== item.size)) {
        throw new Error(`immutable Profile object collision inside publication: ${item.key}`)
      }
      objectMap.set(item.key, item)
    }
  }
  const releases = candidates.map(candidate => {
    const bytes = Buffer.from(`${JSON.stringify(candidate.envelope, null, 2)}\n`)
    const path = join(candidate.directory, 'production-envelope.json')
    writeFileSyncAtomic(path, bytes)
    const immutableKey = `desktop/profile/releases/${candidate.generation}/${candidate.name}.json`
    const immutable = { ...immutableItem(path, immutableKey), role: 'desired-state-immutable' }
    objectMap.set(immutable.key, immutable)
    return {
      target: candidate.name,
      generation: candidate.generation,
      sequence: candidate.payload.sequence,
      changed_components: candidate.admission.changed_components,
      parent_generation: candidate.admission.parent_generation,
      stable: {
        ...immutable,
        role: 'desired-state-active',
        key: `desktop/profile/desired-state/${candidate.name}.json`,
        url: `${ORIGIN}/desktop/profile/desired-state/${candidate.name}.json`,
        cacheControl: 'no-store',
      },
    }
  })
  return {
    sourceCommit: options.sourceCommit,
    base,
    candidates,
    objects: [...objectMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    releases,
  }
}

function writeFileSyncAtomic(path, bytes) {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, bytes, { mode: 0o600 })
  renameSync(temporary, path)
}

export function materializeProfileCurrentSnapshot(snapshotPath, output, expected) {
  const { currentByTarget } = loadProfileCurrentSnapshot(snapshotPath, expected)
  const destination = resolve(output)
  if (TARGET_NAMES.some(target => currentByTarget.get(target) === undefined)) {
    throw new Error('Profile composition requires a present current desired state for every Desktop target')
  }
  mkdirSync(destination, { recursive: false })
  for (const target of TARGET_NAMES) {
    writeFileSyncAtomic(join(destination, `${target}.json`), currentByTarget.get(target))
  }
  return currentByTarget
}

function authorizePreparation(bootstrap) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== REPOSITORY
    || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || process.env.GITHUB_REF !== 'refs/heads/main'
    || process.env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/.github/workflows/profile-release.yml@refs/heads/main`
    || process.env.GITHUB_RUN_ATTEMPT !== '1' || !SHA40.test(process.env.GITHUB_SHA ?? '')) {
    throw new Error(`Profile publication is allowed only by the main Profile release workflow in ${REPOSITORY}`)
  }
  if (!/^[1-9][0-9]*$/u.test(process.env.GITHUB_RUN_ID ?? '')
    || !/^[1-9][0-9]*$/u.test(process.env.EMATE_ACCEPTED_CI_RUN_ID ?? '')
    || !SHA40.test(process.env.EMATE_ACCEPTED_SOURCE_SHA ?? '')) {
    throw new Error('Profile publication provenance is missing')
  }
  if ((process.env.EMATE_PROFILE_BOOTSTRAP === 'true') !== bootstrap) throw new Error('Profile bootstrap authority does not match the requested mode')
}

function copyPublicationItem(item, output, group) {
  const relativePath = `${group}/${item.key}`
  const destination = join(output, ...relativePath.split('/'))
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(item.path, destination, constants.COPYFILE_EXCL)
  const copied = immutableItem(destination, item.key)
  if (copied.size !== item.size || copied.sha256 !== item.sha256) {
    throw new Error(`Profile publication bundle copy drifted: ${item.key}`)
  }
  return {
    role: item.role,
    key: item.key,
    url: item.url,
    path: relativePath,
    bytes: item.size,
    sha256: item.sha256,
    content_type: item.contentType,
    cache_control: item.cacheControl,
  }
}

export function writeProfilePublicationBundle(prepared, output, currentByTarget, provenance = {}) {
  const destination = resolve(output)
  const local = provenance.mode === 'local-flow'
  const mainCommit = provenance.mainCommit ?? prepared.sourceCommit
  if (!local && !SHA40.test(mainCommit)) throw new Error('Profile publication main commit is invalid')
  if (local && (!LOCAL_RUN_ID.test(provenance.runId ?? '') || !STABLE_VERSION.test(provenance.releaseVersion ?? '')
    || !exactKeys(provenance, ['mode', 'runId', 'releaseVersion', 'request', 'ledger'])
    || !exactKeys(provenance.request, ['path', 'bytes', 'sha256'])
    || !exactKeys(provenance.ledger, ['path', 'bytes', 'sha256']))) {
    throw new Error('local Profile publication provenance is invalid')
  }
  mkdirSync(destination, { recursive: false })
  const immutableObjects = prepared.objects.map(item => copyPublicationItem(item, destination, 'immutable'))
  const activations = prepared.releases.map(release => ({
    target: release.target,
    generation: release.generation,
    sequence: release.sequence,
    parent_generation: release.parent_generation,
    changed_components: release.changed_components,
    expected_current: currentByTarget.get(release.target) === undefined ? null : {
      bytes: currentByTarget.get(release.target).byteLength,
      sha256: sha256(currentByTarget.get(release.target)),
    },
    object: copyPublicationItem(release.stable, destination, 'activation'),
  }))
  const plan = local ? {
    schema_version: 2,
    document_type: 'emate.profile-native-cloudflare-publication-plan',
    status: 'prepared',
    source_commit: prepared.sourceCommit,
    release_version: provenance.releaseVersion,
    provenance: {
      mode: 'local-flow',
      run_id: provenance.runId,
      request: provenance.request,
      ledger: provenance.ledger,
    },
    base_contract_id: prepared.base.id,
    schedule_protocol_floor: prepared.base.schedule_protocol_floor,
    immutable_objects: immutableObjects,
    activations,
  } : {
    schema_version: 1,
    document_type: 'emate.profile-native-cloudflare-publication-plan',
    status: 'prepared',
    source_commit: prepared.sourceCommit,
    main_commit: mainCommit,
    accepted_ci_run_id: provenance.acceptedCiRunId,
    preparation_run_id: provenance.preparationRunId,
    base_contract_id: prepared.base.id,
    schedule_protocol_floor: prepared.base.schedule_protocol_floor,
    immutable_objects: immutableObjects,
    activations,
  }
  writeFileSyncAtomic(join(destination, 'publication-plan.json'), Buffer.from(`${JSON.stringify(plan, null, 2)}\n`))
  return plan
}

export async function prepareSignedProfilePublication(options) {
  authorizePreparation(options.bootstrap)
  const { currentByTarget } = loadProfileCurrentSnapshot(
    options.currentSnapshot,
    currentSnapshotIdentity(options.root),
  )
  const prepared = prepareProfilePublication({
    ...options,
    sourceCommit: process.env.EMATE_ACCEPTED_SOURCE_SHA,
    privateKeyPem: process.env.EMATE_PROFILE_SIGNING_PRIVATE_KEY,
    keyId: process.env.EMATE_PROFILE_SIGNING_KEY_ID || undefined,
    currentByTarget,
  })
  return writeProfilePublicationBundle(prepared, options.bundle, currentByTarget, {
    acceptedCiRunId: process.env.EMATE_ACCEPTED_CI_RUN_ID,
    preparationRunId: process.env.GITHUB_RUN_ID,
    mainCommit: process.env.GITHUB_SHA,
  })
}

/** Prepare the production-signed Profile portion of one exact local-flow run without network access. */
export async function prepareLocalSignedProfilePublication(options) {
  const root = resolve(options.root ?? fileURLToPath(new URL('..', import.meta.url)))
  const env = options.env ?? process.env
  const signing = signingCredentials(root, env)
  const inputs = await loadLocalProfileInputs({
    root,
    runRoot: options.runRoot,
    request: options.request,
    allowedPublicationStages: options.allowedPublicationStages,
  })
  if (signing.base.id !== inputs.binding.base_contract.id
    || signing.base.schedule_protocol_floor !== inputs.binding.base_contract.schedule_protocol_floor
    || signing.base.harness_commit !== inputs.binding.base_contract.harness_commit
    || !inputs.binding.base_contract.trusted_signing_key_ids.includes(signing.keyId)) {
    throw new Error('production Profile signing identity drifted from the local ledger Base')
  }
  const { currentByTarget } = loadProfileCurrentSnapshot(
    resolve(options.currentSnapshot),
    currentSnapshotIdentity(root),
  )
  const output = resolve(options.output)
  const runRelative = relative(inputs.runRoot, output)
  if (output === inputs.runRoot || runRelative === '..' || runRelative.startsWith(`..${sep}`)) {
    throw new Error('local Profile signing output must stay inside the source run')
  }
  mkdirSync(output, { recursive: false, mode: 0o700 })
  const candidateDirectories = []
  for (const target of TARGET_NAMES) {
    const directory = join(output, 'candidates', target)
    await composeProfileReleaseCandidate({
      root,
      target,
      artifactRoots: inputs.artifactRoots,
      changedIds: inputs.expectedChangedIds,
      sourceCommit: inputs.request.source_commit,
      output: directory,
      outputRoot: inputs.runRoot,
      privateKeyPem: signing.privateKeyPem,
      keyId: signing.keyId,
      request: async () => { throw new Error('local Profile preparation attempted network access') },
    })
    candidateDirectories.push(directory)
  }
  const prepared = prepareProfilePublication({
    root,
    candidateDirectories,
    candidateSignatureKind: 'production',
    artifactRoots: inputs.artifactRoots,
    expectedChangedIds: inputs.expectedChangedIds,
    sourceCommit: inputs.request.source_commit,
    privateKeyPem: signing.privateKeyPem,
    keyId: signing.keyId,
    currentByTarget,
    bootstrap: true,
  })
  const bundle = join(output, 'publication-bundle')
  const plan = writeProfilePublicationBundle(prepared, bundle, currentByTarget, {
    mode: 'local-flow',
    runId: inputs.request.run_id,
    releaseVersion: inputs.request.version,
    request: inputs.requestDescriptor,
    ledger: inputs.binding.ledger,
  })
  const aggregatePath = join(output, 'profile-component-aggregate.json')
  const aggregate = await createProfileComponentAggregate({
    sourceCommit: inputs.request.source_commit,
    releaseVersion: inputs.request.version,
    baseContract: join(inputs.macosRoot, 'base-contract.json'),
    inventory: join(inputs.macosRoot, 'component-inventory.json'),
    profileReceipt: join(inputs.macosRoot, 'profile-build-receipt.json'),
    profile: join(inputs.macosRoot, 'profile-artifact'),
    publicationBundle: bundle,
    localRunRoot: inputs.runRoot,
    output: aggregatePath,
  })
  return {
    plan,
    aggregate,
    candidateDirectories,
    bundle,
    aggregatePath,
  }
}

/** Project the T20R10 production output to signed metadata only; component payload stays in the local run. */
export function writeCompactLocalProfileSignerResult(prepared, outputPath) {
  const output = resolve(outputPath)
  mkdirSync(join(output, 'profile-desired-state'), { recursive: true, mode: 0o700 })
  const aggregatePath = join(output, 'profile-component-aggregate.json')
  const planPath = join(output, 'profile-publication-plan.json')
  copyFileSync(prepared.aggregatePath, aggregatePath, constants.COPYFILE_EXCL)
  copyFileSync(join(prepared.bundle, 'publication-plan.json'), planPath, constants.COPYFILE_EXCL)
  const desiredStates = prepared.plan.activations.map(activation => {
    const candidate = prepared.candidateDirectories.find(directory => basename(directory) === activation.target)
    if (candidate === undefined) throw new Error(`compact Profile result candidate is missing: ${activation.target}`)
    const path = join(output, 'profile-desired-state', `${activation.target}.json`)
    copyFileSync(join(candidate, 'production-envelope.json'), path, constants.COPYFILE_EXCL)
    const immutable = prepared.plan.immutable_objects.filter(item => item.role === 'desired-state-immutable'
      && item.bytes === activation.object.bytes && item.sha256 === activation.object.sha256)
    const identity = descriptorForResult(output, path)
    if (immutable.length !== 1 || identity.bytes !== activation.object.bytes || identity.sha256 !== activation.object.sha256) {
      throw new Error(`compact Profile desired state binding is invalid: ${activation.target}`)
    }
    return {
      target: activation.target,
      generation: activation.generation,
      path: identity.path,
      bytes: identity.bytes,
      sha256: identity.sha256,
      immutable_key: immutable[0].key,
      active_key: activation.object.key,
    }
  })
  const receipt = {
    schema_version: 1,
    document_type: 'emate.local-compact-profile-signer-result',
    status: 'ready-for-main-local-flow-activation',
    source_commit: prepared.plan.source_commit,
    release_version: prepared.plan.release_version,
    run_id: prepared.plan.provenance.run_id,
    provenance: prepared.plan.provenance,
    component_payloads_in_result: false,
    aggregate: {
      ...descriptorForResult(output, aggregatePath),
      aggregate_sha256: prepared.aggregate.aggregate_sha256,
    },
    publication_plan: descriptorForResult(output, planPath),
    desired_states: desiredStates,
    next_owner: 'main-local-flow-activation',
  }
  writeFileSync(join(output, 'profile-signer-result.json'), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`), {
    flag: 'wx', mode: 0o600,
  })
  return receipt
}

function exactCompactProfileReceipt(value, inputs) {
  return exactKeys(value, [
    'schema_version', 'document_type', 'status', 'source_commit', 'release_version', 'run_id', 'provenance',
    'component_payloads_in_result', 'aggregate', 'publication_plan', 'desired_states', 'next_owner',
  ]) && value.schema_version === 1 && value.document_type === 'emate.local-compact-profile-signer-result'
    && value.status === 'ready-for-main-local-flow-activation'
    && value.source_commit === inputs.request.source_commit && value.release_version === inputs.request.version
    && value.run_id === inputs.request.run_id && value.component_payloads_in_result === false
    && value.next_owner === 'main-local-flow-activation'
    && canonicalProfileJson(value.provenance) === canonicalProfileJson({
      mode: 'local-flow', run_id: inputs.request.run_id,
      request: inputs.requestDescriptor, ledger: inputs.binding.ledger,
    })
    && exactKeys(value.aggregate, ['path', 'bytes', 'sha256', 'aggregate_sha256'])
    && exactKeys(value.publication_plan, ['path', 'bytes', 'sha256'])
    && Array.isArray(value.desired_states) && value.desired_states.length === TARGET_NAMES.length
    && value.desired_states.every((item, index) => exactKeys(item, [
      'target', 'generation', 'path', 'bytes', 'sha256', 'immutable_key', 'active_key',
    ]) && item.target === TARGET_NAMES[index] && SHA256.test(item.generation ?? '')
      && item.path === `profile-desired-state/${item.target}.json`
      && item.immutable_key === `desktop/profile/releases/${item.generation}/${item.target}.json`
      && item.active_key === `desktop/profile/desired-state/${item.target}.json`
      && Number.isSafeInteger(item.bytes) && item.bytes > 0 && SHA256.test(item.sha256 ?? ''))
}

function safeCompactPath(value) {
  return typeof value === 'string' && value !== '' && !value.startsWith('/') && !value.includes('\\')
    && !value.includes('\0') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function compactPublicationObject(value, role) {
  if (!exactKeys(value, [
    'role', 'key', 'url', 'path', 'bytes', 'sha256', 'content_type', 'cache_control',
  ]) || value.role !== role || !safeCompactPath(value.key) || !safeCompactPath(value.path)
    || value.url !== `${ORIGIN}/${value.key}` || !Number.isSafeInteger(value.bytes) || value.bytes <= 0
    || !SHA256.test(value.sha256 ?? '') || typeof value.content_type !== 'string' || value.content_type === ''
    || typeof value.cache_control !== 'string' || value.cache_control === '') {
    throw new Error(`compact Profile publication object is invalid: ${String(value?.path)}`)
  }
  return value
}

function validateCompactProfilePlan(plan, inputs) {
  if (!exactKeys(plan, [
    'schema_version', 'document_type', 'status', 'source_commit', 'release_version', 'provenance',
    'base_contract_id', 'schedule_protocol_floor', 'immutable_objects', 'activations',
  ]) || plan.schema_version !== 2 || plan.document_type !== 'emate.profile-native-cloudflare-publication-plan'
    || plan.status !== 'prepared' || plan.source_commit !== inputs.request.source_commit
    || plan.release_version !== inputs.request.version || !Array.isArray(plan.immutable_objects)
    || !Array.isArray(plan.activations) || plan.activations.length !== TARGET_NAMES.length) {
    throw new Error('compact Profile publication plan is invalid')
  }
  const paths = new Set()
  const keys = new Set()
  for (const item of plan.immutable_objects) {
    compactPublicationObject(item, item?.role)
    if (!['component', 'desired-state-immutable'].includes(item.role)
      || paths.has(item.path) || keys.has(item.key)) throw new Error('compact Profile immutable object set is invalid')
    paths.add(item.path)
    keys.add(item.key)
  }
  for (const [index, activation] of plan.activations.entries()) {
    if (!exactKeys(activation, [
      'target', 'generation', 'sequence', 'parent_generation', 'changed_components', 'expected_current', 'object',
    ]) || activation.target !== TARGET_NAMES[index] || !SHA256.test(activation.generation ?? '')
      || !Array.isArray(activation.changed_components)) {
      throw new Error(`compact Profile activation is invalid: ${String(activation?.target)}`)
    }
    compactPublicationObject(activation.object, 'desired-state-active')
    if (paths.has(activation.object.path) || keys.has(activation.object.key)) {
      throw new Error('compact Profile activation object set is invalid')
    }
    paths.add(activation.object.path)
    keys.add(activation.object.key)
  }
  return plan
}

/** Rebuild the aggregate from local component bytes plus the three imported signed desired states. */
export async function verifyCompactLocalProfileSignerResult(options) {
  const root = resolve(options.root ?? fileURLToPath(new URL('..', import.meta.url)))
  const inputs = await loadLocalProfileInputs({
    root, runRoot: options.runRoot, request: options.request,
    allowedPublicationStages: ['awaiting-protected-signer'],
  })
  const result = resolve(options.result)
  const receipt = JSON.parse(readFileSync(join(result, 'profile-signer-result.json'), 'utf8'))
  if (!exactCompactProfileReceipt(receipt, inputs)) throw new Error('compact Profile signer result receipt is invalid')
  const acceptDescriptor = (descriptor, path) => {
    const actual = descriptorFor(result, path)
    if (canonicalProfileJson(actual) !== canonicalProfileJson(descriptor)) {
      throw new Error(`compact Profile signer result bytes drifted: ${descriptor.path}`)
    }
    return path
  }
  const planPath = acceptDescriptor(receipt.publication_plan, join(result, 'profile-publication-plan.json'))
  const aggregatePath = acceptDescriptor({
    path: receipt.aggregate.path, bytes: receipt.aggregate.bytes, sha256: receipt.aggregate.sha256,
  }, join(result, 'profile-component-aggregate.json'))
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  if (canonicalProfileJson(plan.provenance) !== canonicalProfileJson(receipt.provenance)
    || plan.source_commit !== inputs.request.source_commit || plan.release_version !== inputs.request.version) {
    throw new Error('compact Profile publication plan provenance is invalid')
  }
  validateCompactProfilePlan(plan, inputs)
  const base = parseProfileBaseContract(JSON.parse(readFileSync(join(inputs.macosRoot, 'base-contract.json'), 'utf8')))
  if (base === undefined) throw new Error('compact Profile Base contract is invalid')
  const components = new Map()
  for (const artifact of scanComponentArtifacts(inputs.artifactRoots, base)) {
    for (const object of componentObjects(artifact)) {
      const previous = components.get(object.key)
      if (previous !== undefined && (previous.size !== object.size || previous.sha256 !== object.sha256)) {
        throw new Error(`compact Profile component object identity conflicts: ${object.key}`)
      }
      if (previous === undefined) components.set(object.key, object)
    }
  }
  const staging = mkdtempSync(join(inputs.runRoot, '.profile-import-'))
  try {
    writeFileSync(join(staging, 'publication-plan.json'), readFileSync(planPath), { flag: 'wx' })
    for (const item of plan.immutable_objects) {
      let source
      if (item.role === 'component') source = components.get(item.key)?.path
      else if (item.role === 'desired-state-immutable') {
        const state = receipt.desired_states.find(candidate => candidate.immutable_key === item.key)
        if (state !== undefined) source = join(result, ...state.path.split('/'))
      }
      if (source === undefined) throw new Error(`compact Profile publication object source is missing: ${item.key}`)
      const identity = descriptorFor(dirname(source), source)
      if (identity.bytes !== item.bytes || identity.sha256 !== item.sha256) {
        throw new Error(`compact Profile publication object drifted: ${item.key}`)
      }
      const destination = join(staging, ...item.path.split('/'))
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination, constants.COPYFILE_EXCL)
    }
    for (const activation of plan.activations) {
      const state = receipt.desired_states.find(item => item.target === activation.target)
      if (state === undefined || state.active_key !== activation.object.key
        || state.generation !== activation.generation || state.bytes !== activation.object.bytes
        || state.sha256 !== activation.object.sha256) {
        throw new Error(`compact Profile activation binding is invalid: ${activation.target}`)
      }
      const source = join(result, ...state.path.split('/'))
      acceptDescriptor({ path: state.path, bytes: state.bytes, sha256: state.sha256 }, source)
      const destination = join(staging, ...activation.object.path.split('/'))
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination, constants.COPYFILE_EXCL)
    }
    const recomputedPath = join(inputs.runRoot, `.profile-aggregate-${process.pid}-${Date.now()}.json`)
    try {
      const recomputed = await createProfileComponentAggregate({
        sourceCommit: inputs.request.source_commit, releaseVersion: inputs.request.version,
        baseContract: join(inputs.macosRoot, 'base-contract.json'),
        inventory: join(inputs.macosRoot, 'component-inventory.json'),
        profileReceipt: join(inputs.macosRoot, 'profile-build-receipt.json'),
        profile: join(inputs.macosRoot, 'profile-artifact'), publicationBundle: staging,
        localRunRoot: inputs.runRoot, output: recomputedPath,
      })
      const importedAggregate = JSON.parse(readFileSync(aggregatePath, 'utf8'))
      if (canonicalProfileJson(recomputed) !== canonicalProfileJson(importedAggregate)
        || recomputed.aggregate_sha256 !== receipt.aggregate.aggregate_sha256) {
        throw new Error('compact Profile component aggregate drifted from local product bytes')
      }
    } finally {
      rmSync(recomputedPath, { force: true })
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  return {
    aggregate: receipt.aggregate,
    plan: receipt.publication_plan,
    immutable_objects: plan.immutable_objects.map(item => ({
      ...item,
      source_path: item.role === 'component'
        ? relative(inputs.runRoot, components.get(item.key).path).split(sep).join('/')
        : `publication/protected-signer-result/${receipt.desired_states.find(state => state.immutable_key === item.key).path}`,
    })),
    activations: plan.activations.map(activation => ({
      ...activation,
      object: {
        ...activation.object,
        source_path: `publication/protected-signer-result/${receipt.desired_states.find(state => state.target === activation.target).path}`,
      },
    })),
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string', multiple: true },
    'artifact-root': { type: 'string', multiple: true },
    changed: { type: 'string', multiple: true },
    bundle: { type: 'string' },
    snapshot: { type: 'string' },
    'local-request': { type: 'string' },
    'local-run-root': { type: 'string' },
    'local-output': { type: 'string' },
    'local-compact-output': { type: 'string' },
    'materialize-current': { type: 'string' },
    bootstrap: { type: 'boolean', default: false },
  } })
  const root = fileURLToPath(new URL('..', import.meta.url))
  const local = values['local-request'] !== undefined || values['local-run-root'] !== undefined
    || values['local-output'] !== undefined || values['local-compact-output'] !== undefined
  if (local) {
    if (values['local-request'] === undefined || values['local-run-root'] === undefined
      || values['local-output'] === undefined || values.snapshot === undefined
      || values.candidate !== undefined || values['artifact-root'] !== undefined || values.changed !== undefined
      || values.bundle !== undefined || values['materialize-current'] !== undefined || values.bootstrap) {
      throw new Error('usage: publish-profile-r2.mjs --local-request <file> --local-run-root <directory> --snapshot <file> --local-output <directory> [--local-compact-output <directory>]')
    }
    const prepared = await prepareLocalSignedProfilePublication({
      root,
      request: resolve(values['local-request']),
      runRoot: resolve(values['local-run-root']),
      currentSnapshot: resolve(values.snapshot),
      output: resolve(values['local-output']),
      allowedPublicationStages: ['awaiting-compatibility-attestation'],
    })
    if (values['local-compact-output'] !== undefined) {
      writeCompactLocalProfileSignerResult(prepared, resolve(values['local-compact-output']))
    }
    process.stdout.write(`${JSON.stringify({
      status: prepared.plan.status,
      run_id: prepared.plan.provenance.run_id,
      activations: prepared.plan.activations.map(item => ({ target: item.target, generation: item.generation })),
      aggregate_sha256: prepared.aggregate.aggregate_sha256,
      compact_result: values['local-compact-output'] === undefined ? null : resolve(values['local-compact-output']),
    })}\n`)
    return
  }
  if (values['materialize-current'] !== undefined) {
    if (values.snapshot === undefined || values.candidate !== undefined || values['artifact-root'] !== undefined
      || values.changed !== undefined || values.bundle !== undefined || values['local-compact-output'] !== undefined
      || values.bootstrap) {
      throw new Error('usage: publish-profile-r2.mjs --snapshot <file> --materialize-current <directory>')
    }
    const currentByTarget = materializeProfileCurrentSnapshot(
      resolve(values.snapshot),
      resolve(values['materialize-current']),
      currentSnapshotIdentity(root),
    )
    process.stdout.write(`${JSON.stringify({
      status: 'materialized',
      targets: TARGET_NAMES.map(target => ({ target, bytes: currentByTarget.get(target).byteLength })),
    })}\n`)
    return
  }
  if (values.candidate?.length !== 3 || values['artifact-root']?.length === 0
    || values.changed?.length === 0 || values.bundle === undefined || values.snapshot === undefined) {
    throw new Error('usage: publish-profile-r2.mjs --candidate <dir> (three targets) --artifact-root <dir> --changed <component> --snapshot <file> --bundle <directory> [--bootstrap]')
  }
  const plan = await prepareSignedProfilePublication({
    root,
    candidateDirectories: values.candidate,
    artifactRoots: values['artifact-root'],
    expectedChangedIds: values.changed,
    currentSnapshot: resolve(values.snapshot),
    bundle: resolve(values.bundle),
    bootstrap: values.bootstrap,
  })
  process.stdout.write(`${JSON.stringify({ status: plan.status, activations: plan.activations.map(item => ({ target: item.target, generation: item.generation })) })}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (cause) {
    process.stderr.write(`publish-profile-r2: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
