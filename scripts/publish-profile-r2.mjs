#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadReleaseBoundary } from './change-impact.mjs'
import { scanComponentArtifacts } from './profile-release.mjs'
import {
  assertCompleteProfileRelease,
  profileGenerationId,
} from '../desktop/e-mate-desktop/src/profile-generation.ts'
import {
  canonicalProfileJson,
  parseProfileBaseContract,
  parseProfileReleaseEnvelope,
  sameProfileReleaseTarget,
  signProfileRelease,
  verifyProfileRelease,
} from '../desktop/e-mate-desktop/src/profile-release.ts'

const REPOSITORY = 'zyfjacksonchen-source/e-Mate-2.0.11'
const ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const TARGET_NAMES = ['darwin-arm64', 'darwin-x64', 'win32-x64']
const IMMUTABLE_CACHE = 'public,max-age=31536000,immutable'
const MAX_CURRENT_BYTES = 1024 * 1024
const SHA40 = /^[0-9a-f]{40}$/u

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function targetName(target) {
  return `${target.platform}-${target.arch}`
}

function regularFile(path) {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Profile publication input is not a regular file: ${path}`)
  return metadata
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

function loadCandidate(directory, base, expectedIds, sourceCommit, privateKeyPem, keyId) {
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
    || admission.status !== 'verified' || admission.signature_kind !== 'ephemeral'
    || admission.source_commit !== sourceCommit || admission.candidate_generation !== generation
    || canonicalProfileJson(admission.target) !== canonicalProfileJson(payload.target)
    || !Array.isArray(admission.changed_components) || admission.changed_components.length === 0
    || new Set(admission.changed_components).size !== admission.changed_components.length
    || admission.changed_components.some((id, index, values) => typeof id !== 'string'
      || index > 0 && values[index - 1] >= id)) {
    throw new Error(`Profile candidate admission is invalid: ${directory}`)
  }
  return { directory, admission, payload: verified.payload, envelope, generation, name }
}

function validateCurrent(candidate, bytes, base, expectedIds, bootstrap) {
  let current
  if (bytes !== undefined) {
    current = parseProfileReleaseEnvelope(bytes, base, MAX_CURRENT_BYTES)
    if (current === undefined || !sameProfileReleaseTarget(current.payload.target, candidate.payload.target)) {
      throw new Error(`current desired state is invalid: ${candidate.name}`)
    }
    assertCompleteProfileRelease(current.payload, expectedIds)
    if (canonicalProfileJson(current) === canonicalProfileJson(candidate.envelope)) return
  }
  if (bootstrap) {
    if (current !== undefined || candidate.admission.parent_generation !== null || candidate.payload.sequence !== 1) {
      throw new Error(`bootstrap candidate would replace an existing desired state: ${candidate.name}`)
    }
    if (candidate.admission.changed_components.length !== expectedIds.length) {
      throw new Error(`bootstrap candidate does not replace the complete component set: ${candidate.name}`)
    }
    return
  }
  if (current === undefined) throw new Error(`current desired state is missing: ${candidate.name}`)
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
  const candidates = options.candidateDirectories.map(directory => loadCandidate(
    resolve(directory), base, expectedIds, options.sourceCommit, options.privateKeyPem, keyId,
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

async function readCurrent(target) {
  const url = `${ORIGIN}/desktop/profile/desired-state/${target}.json`
  const response = await fetch(url, { redirect: 'error', headers: { 'cache-control': 'no-cache' } })
  if (response.status === 404) return
  if (response.status !== 200 || response.body === null) throw new Error(`current desired state request failed: ${target}`)
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > MAX_CURRENT_BYTES)) {
    throw new Error(`current desired state length is invalid: ${target}`)
  }
  const chunks = []
  const reader = response.body.getReader()
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_CURRENT_BYTES) {
      await reader.cancel()
      throw new Error(`current desired state is too large: ${target}`)
    }
    chunks.push(Buffer.from(value))
  }
  const bytes = Buffer.concat(chunks, size)
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CURRENT_BYTES) throw new Error(`current desired state is invalid: ${target}`)
  return bytes
}

function authorizePreparation(bootstrap) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== REPOSITORY
    || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || process.env.GITHUB_REF !== 'refs/heads/main'
    || process.env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/.github/workflows/profile-release.yml@refs/heads/main`
    || !SHA40.test(process.env.GITHUB_SHA ?? '')) {
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
  const mainCommit = provenance.mainCommit ?? prepared.sourceCommit
  if (!SHA40.test(mainCommit)) throw new Error('Profile publication main commit is invalid')
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
  const plan = {
    schema_version: 1,
    document_type: 'emate.profile-native-cloudflare-publication-plan',
    status: 'prepared',
    source_commit: prepared.sourceCommit,
    main_commit: mainCommit,
    accepted_ci_run_id: provenance.acceptedCiRunId,
    preparation_run_id: provenance.preparationRunId,
    base_contract_id: prepared.base.id,
    immutable_objects: immutableObjects,
    activations,
  }
  writeFileSyncAtomic(join(destination, 'publication-plan.json'), Buffer.from(`${JSON.stringify(plan, null, 2)}\n`))
  return plan
}

export async function prepareSignedProfilePublication(options) {
  authorizePreparation(options.bootstrap)
  const currentByTarget = new Map(await Promise.all(TARGET_NAMES.map(async target => [target, await readCurrent(target)])))
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

async function main() {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string', multiple: true },
    'artifact-root': { type: 'string', multiple: true },
    changed: { type: 'string', multiple: true },
    bundle: { type: 'string' },
    bootstrap: { type: 'boolean', default: false },
  } })
  if (values.candidate?.length !== 3 || values['artifact-root']?.length === 0
    || values.changed?.length === 0 || values.bundle === undefined) {
    throw new Error('usage: publish-profile-r2.mjs --candidate <dir> (three targets) --artifact-root <dir> --changed <component> --bundle <directory> [--bootstrap]')
  }
  const root = fileURLToPath(new URL('..', import.meta.url))
  const plan = await prepareSignedProfilePublication({
    root,
    candidateDirectories: values.candidate,
    artifactRoots: values['artifact-root'],
    expectedChangedIds: values.changed,
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
