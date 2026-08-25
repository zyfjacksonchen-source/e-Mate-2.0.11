#!/usr/bin/env node

import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadReleaseBoundary } from './change-impact.mjs'
import { parseProfileComponentManifest } from '../desktop/e-mate-desktop/src/profile-component.ts'
import {
  assembleProfileGeneration,
  assertCompleteProfileRelease,
  profileGenerationId,
} from '../desktop/e-mate-desktop/src/profile-generation.ts'
import {
  parseProfileBaseContract,
  parseProfileReleaseEnvelope,
  sameProfileReleaseTarget,
  selectProfileRelease,
  signProfileRelease,
  verifyProfileRelease,
} from '../desktop/e-mate-desktop/src/profile-release.ts'

const RELEASE_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const SHA40 = /^[0-9a-f]{40}$/u
const TARGETS = new Set(['darwin-arm64', 'darwin-x64', 'win32-x64'])
const MAX_CURRENT_RELEASE_BYTES = 1024 * 1024

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function targetValue(name) {
  if (!TARGETS.has(name)) throw new Error(`unsupported Profile target: ${String(name)}`)
  const [platform, arch] = name.split('-')
  return { platform, arch }
}

function targetName(target) {
  return `${target.platform}-${target.arch}`
}

function profilePath(id) {
  return id === '@e-mate/dsh-client-shell'
    ? 'node_modules/@deepseek-ai/dsh-client-ui-sidebar'
    : `node_modules/${id}`
}

function componentSlug(id) {
  const value = id.replace(/^@e-mate\//u, '')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) throw new Error(`component id is invalid: ${String(id)}`)
  return value
}

function manifestUrl(manifest) {
  const suffix = manifest.target === null ? '' : `/${targetName(manifest.target)}`
  return `${RELEASE_ORIGIN}/desktop/profile/components/${componentSlug(manifest.id)}/v${manifest.version}/${manifest.source_commit}${suffix}/manifest.json`
}

function referenceForArtifact(directory, base) {
  const manifestPath = join(directory, 'manifest.json')
  const bytes = readFileSync(manifestPath)
  let value
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch {
    throw new Error(`component artifact manifest is invalid: ${manifestPath}`)
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || typeof value.id !== 'string' || typeof value.version !== 'string'
    || typeof value.kind !== 'string' || typeof value.source_commit !== 'string') {
    throw new Error(`component artifact identity is invalid: ${manifestPath}`)
  }
  const reference = {
    id: value.id,
    version: value.version,
    kind: value.kind,
    target: value.target ?? null,
    profile_path: profilePath(value.id),
    manifest_url: manifestUrl(value),
    manifest_bytes: bytes.byteLength,
    manifest_sha256: sha256(bytes),
    manifest_source_commit: value.source_commit,
  }
  if (parseProfileComponentManifest(bytes, reference, base) === undefined) {
    throw new Error(`component artifact does not match the accepted Base: ${manifestPath}`)
  }
  return { directory, manifest_path: manifestPath, manifest: value, reference }
}

function visitArtifacts(directory, paths) {
  const metadata = lstatSync(directory)
  if (metadata.isSymbolicLink()) throw new Error(`component artifact tree contains a symlink: ${directory}`)
  if (!metadata.isDirectory()) throw new Error(`component artifact root is not a directory: ${directory}`)
  if (existsSync(join(directory, 'manifest.json')) && existsSync(join(directory, 'files'))) {
    paths.push(directory)
    return
  }
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) throw new Error(`component artifact tree contains a symlink: ${join(directory, entry.name)}`)
    if (entry.isDirectory()) visitArtifacts(join(directory, entry.name), paths)
  }
}

/** Discover emitted component payloads without trusting artifact directory names. */
export function scanComponentArtifacts(roots, base) {
  const paths = []
  for (const root of roots) visitArtifacts(resolve(root), paths)
  if (paths.length === 0) throw new Error('no emitted component artifacts were found')
  return paths.map(path => referenceForArtifact(path, base))
}

function localObjectMap(artifacts) {
  const objects = new Map()
  for (const artifact of artifacts) {
    const url = artifact.reference.manifest_url
    if (objects.has(url)) throw new Error(`duplicate component artifact URL: ${url}`)
    objects.set(url, artifact.manifest_path)
    for (const file of artifact.manifest.files) {
      const objectUrl = `${new URL('.', url).href}files/${file.path.split('/').map(encodeURIComponent).join('/')}`
      if (objects.has(objectUrl)) throw new Error(`duplicate component file URL: ${objectUrl}`)
      objects.set(objectUrl, join(artifact.directory, 'files', ...file.path.split('/')))
    }
  }
  return objects
}

function responseForFile(path) {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`component object is not a regular file: ${path}`)
  const bytes = readFileSync(path)
  return new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.byteLength) } })
}

function acceptedRelease(path, base, target, expectedIds) {
  if (path === undefined) return
  const bytes = readFileSync(path)
  const release = parseProfileReleaseEnvelope(bytes, base, MAX_CURRENT_RELEASE_BYTES)
  if (release === undefined || !sameProfileReleaseTarget(release.payload.target, target)
    || selectProfileRelease(release.payload, base, 0) === 'base-required') {
    throw new Error('current accepted Profile release is invalid or incompatible')
  }
  assertCompleteProfileRelease(release.payload, expectedIds)
  return release
}

function exactChangedArtifacts(artifacts, target, changedIds) {
  const relevant = artifacts.filter(artifact => artifact.reference.target === null
    || sameProfileReleaseTarget(artifact.reference.target, target))
  const byId = new Map()
  for (const artifact of relevant) {
    if (byId.has(artifact.reference.id)) throw new Error(`duplicate component artifact for ${artifact.reference.id} on ${targetName(target)}`)
    byId.set(artifact.reference.id, artifact)
  }
  const actual = [...byId.keys()].sort()
  const expected = [...new Set(changedIds)].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`changed component artifact set mismatch: expected ${expected.join(', ')}, got ${actual.join(', ')}`)
  }
  return byId
}

function validateCompositionReferences(references, components, target) {
  const inventory = new Map(components.map(component => [component.id, component]))
  for (const reference of references.values()) {
    const component = inventory.get(reference.id)
    if (component === undefined || reference.kind !== component.kind) {
      throw new Error(`Profile component kind drifted from inventory: ${reference.id}`)
    }
    if (component.kind === 'profile') {
      if (reference.target !== null) throw new Error(`portable component has a target: ${reference.id}`)
      continue
    }
    const expected = component.targets.find(candidate => sameProfileReleaseTarget(candidate, target))
    if (expected === undefined || JSON.stringify(reference.target) !== JSON.stringify(expected)) {
      throw new Error(`platform component target drifted from inventory: ${reference.id}`)
    }
  }
}

function signingIdentity(baseRaw, privateKeyPem, keyId) {
  if (privateKeyPem !== undefined || keyId !== undefined) {
    if (typeof privateKeyPem !== 'string' || privateKeyPem === '' || typeof keyId !== 'string' || keyId === '') {
      throw new Error('production Profile signing requires both private key and key id')
    }
    const base = parseProfileBaseContract(baseRaw)
    if (base === undefined || !base.profile_signing_keys.some(key => key.id === keyId)) {
      throw new Error('Profile signing key id is not trusted by the Desktop Base')
    }
    return { base, baseRaw, privateKeyPem, keyId, kind: 'production' }
  }
  const pair = generateKeyPairSync('ed25519')
  const ephemeralRaw = {
    ...baseRaw,
    profile_signing_keys: [{
      id: 'ci-ephemeral',
      algorithm: 'ed25519',
      public_key_spki_der_base64: pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    }],
  }
  const base = parseProfileBaseContract(ephemeralRaw)
  if (base === undefined) throw new Error('ephemeral Profile verification Base is invalid')
  return {
    base,
    baseRaw: ephemeralRaw,
    privateKeyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    keyId: 'ci-ephemeral',
    kind: 'ephemeral',
  }
}

/** Merge changed payloads into one complete accepted set and materialize every referenced byte. */
export async function composeProfileReleaseCandidate(options) {
  const root = resolve(options.root)
  const boundary = loadReleaseBoundary(root)
  if (!boundary.valid) throw new Error(boundary.errors.join('\n'))
  const baseRaw = json(join(root, 'desktop/e-mate-desktop/base-contract.json'))
  const base = parseProfileBaseContract(baseRaw)
  if (base === undefined || base.id !== boundary.baseContract.id) throw new Error('Profile Base contract is invalid')
  const target = targetValue(options.target)
  const expectedComponents = boundary.components.filter(component => component.desktop !== 'blocked')
  const expectedIds = expectedComponents
    .map(component => component.id)
    .sort()
  const changedIds = [...new Set(options.changedIds)].sort()
  if (changedIds.length === 0 || changedIds.some(id => !expectedIds.includes(id))) {
    throw new Error('changed Profile component set is invalid')
  }
  const sourceCommit = options.sourceCommit
  if (!SHA40.test(sourceCommit)) throw new Error('Profile release source commit is invalid')
  const output = resolve(options.output)
  const outputRelative = relative(root, output)
  if (output === root || outputRelative === '' || outputRelative === '..' || outputRelative.startsWith(`..${sep}`)) {
    throw new Error('Profile release output must stay inside the repository')
  }
  const artifacts = scanComponentArtifacts(options.artifactRoots, base)
  const changed = exactChangedArtifacts(artifacts, target, changedIds)
  const current = acceptedRelease(options.current, base, target, expectedIds)
  const references = new Map(current?.payload.components.map(reference => [reference.id, reference]) ?? [])
  for (const [id, artifact] of changed) references.set(id, artifact.reference)
  if (references.size !== expectedIds.length || expectedIds.some(id => !references.has(id))) {
    throw new Error('candidate Profile release is missing accepted components')
  }
  validateCompositionReferences(references, expectedComponents, target)
  const releaseVersion = json(join(root, 'desktop/e-mate-desktop/package.json')).version
  if (typeof releaseVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(releaseVersion)) {
    throw new Error('Desktop release version is invalid')
  }
  const payload = {
    schema_version: 1,
    product: 'e-Mate',
    release_version: releaseVersion,
    sequence: (current?.payload.sequence ?? 0) + 1,
    source_commit: sourceCommit,
    schedule_protocol_floor: base.schedule_protocol_floor,
    target,
    base_contracts: [base.id],
    harness_contract: { version: base.harness_version, commit: base.harness_commit },
    components: expectedIds.map(id => references.get(id)),
  }
  assertCompleteProfileRelease(payload, expectedIds)
  const signing = signingIdentity(baseRaw, options.privateKeyPem, options.keyId)
  const release = signProfileRelease(payload, signing.privateKeyPem, signing.keyId)
  if (verifyProfileRelease(release, signing.base) === undefined) {
    throw new Error('candidate Profile release signature does not match its verification Base')
  }

  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const localObjects = localObjectMap(artifacts)
  const fallbackRequest = options.request ?? ((url, init) => fetch(url, init))
  const request = async (url, init) => {
    const local = localObjects.get(url)
    return local === undefined ? fallbackRequest(url, init) : responseForFile(local)
  }
  const store = join(output, 'store')
  const generation = await assembleProfileGeneration({
    root: store,
    release,
    base: signing.base,
    expected_component_ids: expectedIds,
    target,
    request,
  })
  const parentGeneration = current === undefined ? null : profileGenerationId(current.payload)
  const admission = {
    schema_version: 1,
    document_type: 'emate.profile-generation-admission',
    status: 'verified',
    target,
    source_commit: sourceCommit,
    release_version: releaseVersion,
    sequence: payload.sequence,
    base_contract_id: base.id,
    schedule_protocol_floor: base.schedule_protocol_floor,
    harness_contract: payload.harness_contract,
    parent_generation: parentGeneration,
    candidate_generation: generation.id,
    changed_components: changedIds,
    signature_kind: signing.kind,
    signature_key_id: signing.keyId,
    components: payload.components.map(reference => ({
      id: reference.id,
      version: reference.version,
      target: reference.target,
      manifest_url: reference.manifest_url,
      manifest_bytes: reference.manifest_bytes,
      manifest_sha256: reference.manifest_sha256,
      manifest_source_commit: reference.manifest_source_commit,
    })),
  }
  writeFileSync(join(output, 'payload.json'), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(join(output, 'envelope.json'), `${JSON.stringify(release, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(join(output, 'verification-base.json'), `${JSON.stringify(signing.baseRaw, null, 2)}\n`, { mode: 0o600 })
  writeFileSync(join(output, 'admission.json'), `${JSON.stringify(admission, null, 2)}\n`, { mode: 0o600 })
  return { admission, release, generation, verificationBase: signing.base }
}

function parseArguments(argv) {
  const options = { artifactRoots: [], changedIds: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--bootstrap') options.bootstrap = true
    else if (['--artifact-root', '--changed'].includes(name)) {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${name} requires a value`)
      options[name === '--artifact-root' ? 'artifactRoots' : 'changedIds'].push(value)
      index += 1
    } else if (['--root', '--target', '--current', '--out', '--source-commit', '--private-key', '--key-id'].includes(name)) {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`${name} requires a value`)
      options[name.slice(2).replaceAll('-', '')] = value
      index += 1
    } else throw new Error(`unknown argument: ${String(name)}`)
  }
  return options
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const root = resolve(options.root ?? fileURLToPath(new URL('..', import.meta.url)))
  if (options.target === undefined || options.out === undefined || options.sourcecommit === undefined
    || options.artifactRoots.length === 0 || options.changedIds.length === 0
    || options.bootstrap !== true && options.current === undefined
    || options.bootstrap === true && options.current !== undefined
    || (options.privatekey === undefined) !== (options.keyid === undefined)) {
    throw new Error('usage: profile-release.mjs --target <target> --artifact-root <dir> --changed <id> --source-commit <sha> --out <dir> (--current <signed.json> | --bootstrap) [--private-key <pem> --key-id <id>]')
  }
  const result = await composeProfileReleaseCandidate({
    root,
    target: options.target,
    artifactRoots: options.artifactRoots,
    changedIds: options.changedIds,
    sourceCommit: options.sourcecommit,
    output: options.out,
    current: options.current,
    ...(options.privatekey === undefined ? {} : {
      privateKeyPem: readFileSync(options.privatekey, 'utf8'),
      keyId: options.keyid,
    }),
  })
  process.stdout.write(`${JSON.stringify(result.admission)}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (cause) {
    process.stderr.write(`profile-release: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
