#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
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

const REPOSITORY = 'zyfjacksonchen-source/e-Mate'
const BUCKET = 'emate-desktop-downloads'
const ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const TARGET_NAMES = ['darwin-arm64', 'darwin-x64', 'win32-x64']
const IMMUTABLE_CACHE = 'public,max-age=31536000,immutable'
const MAX_CURRENT_BYTES = 1024 * 1024
const MAX_COMMAND_OUTPUT = 1024 * 1024
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
  return { base, candidates, objects: [...objectMap.values()].sort((a, b) => a.key.localeCompare(b.key)), releases }
}

function writeFileSyncAtomic(path, bytes) {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, bytes, { mode: 0o600 })
  renameSync(temporary, path)
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
      '--endpoint-url', endpoint(), 's3api', 'head-object', '--bucket', BUCKET, '--key', item.key, '--output', 'json',
    ])
    const value = JSON.parse(output)
    if (value.ContentLength !== item.size || value.ContentType !== item.contentType
      || value.CacheControl !== item.cacheControl || value.Metadata?.sha256 !== item.sha256) {
      throw new Error(`R2 object identity collision: ${item.key}`)
    }
    return true
  } catch (error) {
    if (/\(404\)|Not Found|NoSuchKey/u.test(error?.output ?? '')) return false
    throw error
  }
}

async function putObject(item) {
  await command('aws', [
    '--endpoint-url', endpoint(), 's3api', 'put-object', '--bucket', BUCKET, '--key', item.key,
    '--body', item.path, '--content-type', item.contentType, '--cache-control', item.cacheControl,
    '--metadata', `sha256=${item.sha256}`,
  ])
}

async function publicProbe(item) {
  const response = await fetch(item.url, {
    redirect: 'error', headers: { 'accept-encoding': 'identity', 'cache-control': 'no-cache' },
  })
  if (response.status !== 200 || response.body === null) {
    throw new Error(`public Profile object returned ${response.status}: ${item.key}`)
  }
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) !== item.size)) {
    throw new Error(`public Profile object length differs: ${item.key}`)
  }
  const digest = createHash('sha256')
  const reader = response.body.getReader()
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > item.size) {
      await reader.cancel()
      throw new Error(`public Profile object exceeds admitted size: ${item.key}`)
    }
    digest.update(value)
  }
  if (size !== item.size || digest.digest('hex') !== item.sha256) {
    throw new Error(`public Profile object bytes differ: ${item.key}`)
  }
}

async function retryPublicProbe(item) {
  let last
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { await publicProbe(item); return } catch (cause) {
      last = cause
      if (attempt < 5) await sleep(1000 * 2 ** attempt)
    }
  }
  throw last
}

async function publishImmutable(item) {
  if (!await headObject(item)) await putObject(item)
  if (!await headObject(item)) throw new Error(`R2 authenticated readback failed: ${item.key}`)
  await retryPublicProbe(item)
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

function authorize(bootstrap) {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== REPOSITORY
    || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch'
    || process.env.GITHUB_REF !== 'refs/heads/main'
    || process.env.GITHUB_WORKFLOW_REF !== `${REPOSITORY}/.github/workflows/profile-release.yml@refs/heads/main`
    || !SHA40.test(process.env.GITHUB_SHA ?? '')) {
    throw new Error(`Profile publication is allowed only by the main Profile release workflow in ${REPOSITORY}`)
  }
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw new Error('R2 S3 credentials are missing')
  if ((process.env.EMATE_PROFILE_BOOTSTRAP === 'true') !== bootstrap) throw new Error('Profile bootstrap authority does not match the requested mode')
}

export async function publishProfileR2(options) {
  authorize(options.bootstrap)
  const currentByTarget = new Map(await Promise.all(TARGET_NAMES.map(async target => [target, await readCurrent(target)])))
  const prepared = prepareProfilePublication({
    ...options,
    sourceCommit: process.env.GITHUB_SHA,
    privateKeyPem: process.env.EMATE_PROFILE_SIGNING_PRIVATE_KEY,
    keyId: process.env.EMATE_PROFILE_SIGNING_KEY_ID || undefined,
    currentByTarget,
  })
  let cursor = 0
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < prepared.objects.length) {
      const item = prepared.objects[cursor]
      cursor += 1
      await publishImmutable(item)
    }
  }))
  for (const release of prepared.releases) {
    const current = await readCurrent(release.target)
    const accepted = currentByTarget.get(release.target)
    if ((current === undefined) !== (accepted === undefined)
      || current !== undefined && !current.equals(accepted)) {
      throw new Error(`public desired state changed during publication: ${release.target}`)
    }
  }
  for (const release of prepared.releases) {
    await putObject(release.stable)
    if (!await headObject(release.stable)) throw new Error(`active desired-state readback failed: ${release.target}`)
    await retryPublicProbe(release.stable)
  }
  const receipt = {
    schema_version: 1,
    document_type: 'emate.profile-r2-admission',
    status: 'verified',
    source_commit: process.env.GITHUB_SHA,
    base_contract_id: prepared.base.id,
    objects: prepared.objects.map(item => ({ key: item.key, url: item.url, bytes: item.size, sha256: item.sha256 })),
    releases: prepared.releases.map(release => ({
      target: release.target,
      generation: release.generation,
      sequence: release.sequence,
      parent_generation: release.parent_generation,
      changed_components: release.changed_components,
      desired_state_url: release.stable.url,
      bytes: release.stable.size,
      sha256: release.stable.sha256,
    })),
  }
  await mkdir(dirname(options.receipt), { recursive: true })
  const temporary = `${options.receipt}.tmp`
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, options.receipt)
  return receipt
}

async function main() {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string', multiple: true },
    'artifact-root': { type: 'string', multiple: true },
    receipt: { type: 'string' },
    bootstrap: { type: 'boolean', default: false },
  } })
  if (values.candidate?.length !== 3 || values['artifact-root']?.length === 0 || values.receipt === undefined) {
    throw new Error('usage: publish-profile-r2.mjs --candidate <dir> (three targets) --artifact-root <dir> --receipt <path> [--bootstrap]')
  }
  const root = fileURLToPath(new URL('..', import.meta.url))
  const receipt = await publishProfileR2({
    root,
    candidateDirectories: values.candidate,
    artifactRoots: values['artifact-root'],
    receipt: resolve(values.receipt),
    bootstrap: values.bootstrap,
  })
  process.stdout.write(`${JSON.stringify({ status: receipt.status, releases: receipt.releases })}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (cause) {
    process.stderr.write(`publish-profile-r2: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
