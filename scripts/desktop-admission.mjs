#!/usr/bin/env node

import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseProfileComponentManifest } from '../desktop/e-mate-desktop/src/profile-component.ts'
import {
  assertCompleteProfileRelease,
  profileGenerationId,
} from '../desktop/e-mate-desktop/src/profile-generation.ts'
import {
  canonicalProfileJson,
  loadProfileBaseContract,
  parseProfileReleaseEnvelope,
} from '../desktop/e-mate-desktop/src/profile-release.ts'

const REPOSITORY = 'zyfjacksonchen-source/e-Mate-2.0.11'
const TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64']
const SHA40 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const RUN_ID = /^[1-9][0-9]*$/u
const PROFILE_TREE_CONTEXT = Buffer.from('e-mate-staged-profile-tree-v1\0', 'utf8')
const PROFILE_PUBLICATION_CONTEXT = Buffer.from('e-mate-profile-publication-tree-v1\0', 'utf8')
const PROFILE_COMPONENT_CONTEXT = Buffer.from('e-mate-profile-component-aggregate-v1\0', 'utf8')
const PROFILE_AGGREGATE_CONTEXT = Buffer.from('e-mate-profile-aggregate-v1\0', 'utf8')
const PERFORMANCE_SIGNATURE_CONTEXT = Buffer.from('e-mate-performance-admission-v1\0', 'utf8')
const PERFORMANCE_AGGREGATE_SIGNATURE_CONTEXT = Buffer.from('e-mate-performance-aggregate-admission-v1\0', 'utf8')
const MAX_JSON_BYTES = 64 * 1024 * 1024
const MAX_PERFORMANCE_FILE_BYTES = 64 * 1024 * 1024
const MAX_PROFILE_FILES = 50_000
const MAX_PROFILE_BYTES = 4 * 1024 * 1024 * 1024
const PERFORMANCE_PATHS = ['baseline', 'emate_online', 'emate_enterprise_unavailable_valid_cache']
const PERFORMANCE_ARTIFACT_FIELDS = [
  ['raw_samples_artifact', 'raw-samples'],
  ['native_trace_artifact', 'native-session-trace'],
  ['provider_receipt_artifact', 'provider-invocation-receipt'],
  ['request_header_artifact', 'request-headers'],
  ['renderer_paint_artifact', 'renderer-paint-trace'],
  ['installed_runtime_artifact', 'installed-runtime-receipt'],
]
export const PERFORMANCE_MODEL_ROSTER = Object.freeze([
  Object.freeze({
    route_id: 'ecorex-chat', provider: 'e-mate-enterprise', model: 'gpt-5.6-luna', reasoning_effort: 'max',
  }),
  Object.freeze({
    route_id: 'ecorex-gpt-5.6-sol', provider: 'e-mate-enterprise', model: 'gpt-5.6-sol', reasoning_effort: 'medium',
  }),
  Object.freeze({
    route_id: 'ecorex-deepseek-v4-pro', provider: 'e-mate-enterprise-deepseek',
    model: 'deepseek-v4-flash', reasoning_effort: 'max',
  }),
  Object.freeze({
    route_id: 'ecorex-doubao-seed-2.0-pro', provider: 'e-mate-enterprise-doubao',
    model: 'doubao-seed-2-0-pro-260215', reasoning_effort: 'medium',
  }),
])
export const PERFORMANCE_MODEL_LEAF_IDS = Object.freeze(['luna', 'sol', 'deepseek', 'doubao'])

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, keys) {
  if (!record(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalDigest(context, value) {
  return createHash('sha256').update(context).update(canonicalProfileJson(value)).digest('hex')
}

async function boundedJson(path, maximumBytes = MAX_JSON_BYTES) {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new Error(`admission input is not a bounded regular file: ${basename(path)}`)
  }
  const bytes = await readFile(path)
  let value
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch {
    throw new Error(`admission input is invalid JSON: ${basename(path)}`)
  }
  return { bytes, value }
}

async function hashFile(path) {
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`admission tree contains a non-file: ${path}`)
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk)
  const after = await stat(path)
  if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    throw new Error(`admission file changed while hashing: ${path}`)
  }
  return { bytes: after.size, sha256: digest.digest('hex') }
}

async function treeEntries(root) {
  const absolute = resolve(root)
  const rootMetadata = await lstat(absolute)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('admission tree root must be a real directory')
  }
  const entries = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`admission tree contains a symlink: ${path}`)
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile()) {
        const name = relative(absolute, path).split(sep).join('/')
        if (name === '' || name !== name.normalize('NFC') || name.includes('\\')) {
          throw new Error(`admission tree path is not portable: ${name}`)
        }
        entries.push({ path: name, ...await hashFile(path) })
      } else {
        throw new Error(`admission tree contains an unsupported entry: ${path}`)
      }
    }
  }
  await visit(absolute)
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  if (entries.length === 0 || entries.length > MAX_PROFILE_FILES || bytes > MAX_PROFILE_BYTES) {
    throw new Error('admission tree exceeds the accepted file or byte boundary')
  }
  return { entries, bytes }
}

export async function profilePublicationTreeSha256(root) {
  return canonicalDigest(PROFILE_PUBLICATION_CONTEXT, (await treeEntries(root)).entries)
}

async function atomicJson(path, value) {
  const output = resolve(path)
  await mkdir(dirname(output), { recursive: true })
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await rename(temporary, output)
}

function profileInventory(value) {
  if (!record(value) || value.schema_version !== 1 || !Array.isArray(value.components)) {
    throw new Error('Profile component inventory is invalid')
  }
  const accepted = value.components.filter(component => record(component) && component.desktop !== 'blocked')
  const ids = accepted.map(component => component.id).sort()
  if (ids.length === 0 || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length
    || accepted.some(component => !['profile', 'platform-profile'].includes(component.kind)
      || component.kind === 'profile' && component.targets !== undefined
      || component.kind === 'platform-profile' && (!Array.isArray(component.targets)
        || component.targets.length !== TARGETS.length))) {
    throw new Error('Profile component inventory has an invalid accepted set')
  }
  return { ids, byId: new Map(accepted.map(component => [component.id, component])) }
}

/** Bind the raw Profile artifact to the source inventory before GitHub archives it. */
export async function createProfileBuildReceipt(options) {
  if (!SHA40.test(options.sourceCommit)) throw new Error('Profile build source commit is invalid')
  const base = loadProfileBaseContract(resolve(options.baseContract))
  const inventory = await boundedJson(resolve(options.inventory), 1024 * 1024)
  profileInventory(inventory.value)
  const stagedInventoryPath = join(resolve(options.profile), 'dsh', 'profile', 'component-inventory.json')
  const stagedInventory = await boundedJson(stagedInventoryPath, 1024 * 1024)
  if (!inventory.bytes.equals(stagedInventory.bytes)) throw new Error('staged Profile inventory drifted from source')
  const tree = await treeEntries(options.profile)
  const receipt = {
    schema_version: 1,
    document_type: 'emate.desktop-profile-build-receipt',
    source_commit: options.sourceCommit,
    base_contract_id: base.id,
    inventory_sha256: sha256(inventory.bytes),
    staged_profile_tree_sha256: canonicalDigest(PROFILE_TREE_CONTEXT, tree.entries),
    file_count: tree.entries.length,
    total_bytes: tree.bytes,
  }
  await atomicJson(options.output, receipt)
  return receipt
}

function parseProfileReceipt(value, sourceCommit, base) {
  if (!exactKeys(value, [
    'schema_version', 'document_type', 'source_commit', 'base_contract_id', 'inventory_sha256',
    'staged_profile_tree_sha256', 'file_count', 'total_bytes',
  ]) || value.schema_version !== 1 || value.document_type !== 'emate.desktop-profile-build-receipt'
    || value.source_commit !== sourceCommit || value.base_contract_id !== base.id
    || !SHA256.test(value.inventory_sha256 ?? '') || !SHA256.test(value.staged_profile_tree_sha256 ?? '')
    || !Number.isSafeInteger(value.file_count) || value.file_count <= 0
    || !Number.isSafeInteger(value.total_bytes) || value.total_bytes <= 0) {
    throw new Error('Desktop Profile build receipt is invalid')
  }
  return value
}

function publicationObject(value, role) {
  if (!exactKeys(value, ['role', 'key', 'url', 'path', 'bytes', 'sha256', 'content_type', 'cache_control'])
    || value.role !== role || typeof value.key !== 'string' || value.key === ''
    || typeof value.url !== 'string' || !safeArtifactPath(value.path)
    || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || !SHA256.test(value.sha256 ?? '')
    || typeof value.content_type !== 'string' || typeof value.cache_control !== 'string') {
    throw new Error(`Profile publication ${role} object is invalid`)
  }
  const url = new URL(value.url)
  if (url.origin !== 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
    || url.pathname.slice(1) !== value.key || url.search !== '' || url.hash !== '') {
    throw new Error(`Profile publication ${role} URL is invalid`)
  }
  return value
}

function releaseTarget(name) {
  const [platform, arch] = name.split('-')
  return { platform, arch }
}

function sameTarget(actual, expected) {
  return record(actual) && actual.platform === expected.platform && actual.arch === expected.arch
}

function componentFileUrl(reference, path) {
  return new URL(`files/${path.split('/').map(encodeURIComponent).join('/')}`, new URL('.', reference.manifest_url)).href
}

/** Recompute the existing four-field Profile summary from actual signed Profile publication bytes. */
export async function createProfileComponentAggregate(options) {
  if (!SHA40.test(options.sourceCommit) || !RUN_ID.test(options.ciRunId) || !RUN_ID.test(options.profileRunId)) {
    throw new Error('Profile aggregate provenance is invalid')
  }
  const base = loadProfileBaseContract(resolve(options.baseContract))
  const inventory = await boundedJson(resolve(options.inventory), 1024 * 1024)
  const inventoryContract = profileInventory(inventory.value)
  const expectedIds = inventoryContract.ids
  const receiptInput = await boundedJson(resolve(options.profileReceipt), 1024 * 1024)
  const receipt = parseProfileReceipt(receiptInput.value, options.sourceCommit, base)
  const stagedInventory = await boundedJson(join(resolve(options.profile), 'dsh', 'profile', 'component-inventory.json'), 1024 * 1024)
  const tree = await treeEntries(options.profile)
  if (!inventory.bytes.equals(stagedInventory.bytes) || sha256(inventory.bytes) !== receipt.inventory_sha256
    || tree.entries.length !== receipt.file_count || tree.bytes !== receipt.total_bytes
    || canonicalDigest(PROFILE_TREE_CONTEXT, tree.entries) !== receipt.staged_profile_tree_sha256) {
    throw new Error('downloaded Desktop Profile artifact does not match its build receipt')
  }

  const bundleRoot = resolve(options.publicationBundle)
  const planInput = await boundedJson(join(bundleRoot, 'publication-plan.json'))
  const bundleTree = await treeEntries(bundleRoot)
  const bundleEntries = new Map(bundleTree.entries.map(entry => [entry.path, entry]))
  const acceptedObject = item => {
    const entry = bundleEntries.get(item.path)
    if (entry?.bytes !== item.bytes || entry.sha256 !== item.sha256) {
      throw new Error(`Profile publication object bytes drifted: ${item.path}`)
    }
    return resolve(bundleRoot, ...item.path.split('/'))
  }
  const plan = planInput.value
  if (!exactKeys(plan, [
    'schema_version', 'document_type', 'status', 'source_commit', 'main_commit', 'accepted_ci_run_id',
    'preparation_run_id', 'base_contract_id', 'schedule_protocol_floor', 'immutable_objects', 'activations',
  ]) || plan.schema_version !== 1
    || plan.document_type !== 'emate.profile-native-cloudflare-publication-plan' || plan.status !== 'prepared'
    || plan.source_commit !== options.sourceCommit || plan.main_commit !== options.sourceCommit
    || String(plan.accepted_ci_run_id) !== options.ciRunId || String(plan.preparation_run_id) !== options.profileRunId
    || plan.base_contract_id !== base.id || plan.schedule_protocol_floor !== base.schedule_protocol_floor
    || !Array.isArray(plan.immutable_objects) || !Array.isArray(plan.activations)
    || plan.activations.length !== TARGETS.length) {
    throw new Error('Profile publication plan provenance is invalid')
  }

  const immutable = plan.immutable_objects.map(item => publicationObject(item, item?.role))
  if (immutable.some(item => !['component', 'desired-state-immutable'].includes(item.role))) {
    throw new Error('Profile publication contains an unsupported immutable role')
  }
  const objects = new Map()
  const objectKeys = new Set()
  const objectPaths = new Set()
  for (const item of immutable) {
    if (objects.has(item.url) || objectKeys.has(item.key) || objectPaths.has(item.path)) {
      throw new Error(`Profile publication object identity is duplicated: ${item.url}`)
    }
    objectKeys.add(item.key)
    objectPaths.add(item.path)
    objects.set(item.url, { item, path: acceptedObject(item) })
  }

  const targets = []
  const performanceTargets = []
  const consumedObjects = new Set()
  for (let index = 0; index < TARGETS.length; index += 1) {
    const target = TARGETS[index]
    const activation = plan.activations[index]
    if (!exactKeys(activation, [
      'target', 'generation', 'sequence', 'parent_generation', 'changed_components', 'expected_current', 'object',
    ]) || activation.target !== target || !SHA256.test(activation.generation ?? '') || activation.sequence !== 1
      || activation.parent_generation !== null || !Array.isArray(activation.changed_components)
      || canonicalProfileJson(activation.changed_components) !== canonicalProfileJson(expectedIds)) {
      throw new Error(`Profile bootstrap activation is invalid: ${target}`)
    }
    if (activation.expected_current !== null
      && (!exactKeys(activation.expected_current, ['bytes', 'sha256'])
        || !Number.isSafeInteger(activation.expected_current.bytes) || activation.expected_current.bytes <= 0
        || !SHA256.test(activation.expected_current.sha256 ?? ''))) {
      throw new Error(`Profile bootstrap current-state receipt is invalid: ${target}`)
    }
    const activeObject = publicationObject(activation.object, 'desired-state-active')
    const activePath = acceptedObject(activeObject)
    if (activeObject.bytes > 1024 * 1024) throw new Error(`Profile desired state is too large: ${target}`)
    const activeBytes = await readFile(activePath)
    const release = parseProfileReleaseEnvelope(activeBytes, base)
    if (release === undefined || release.payload.source_commit !== options.sourceCommit
      || release.payload.release_version !== options.releaseVersion
      || release.payload.sequence !== 1 || !sameTarget(release.payload.target, releaseTarget(target))
      || release.payload.schedule_protocol_floor !== base.schedule_protocol_floor
      || release.payload.harness_contract.version !== base.harness_version
      || release.payload.harness_contract.commit !== base.harness_commit
      || !release.payload.base_contracts.includes(base.id)
      || profileGenerationId(release.payload) !== activation.generation) {
      throw new Error(`signed Profile desired state is invalid: ${target}`)
    }
    assertCompleteProfileRelease(release.payload, expectedIds)
    const immutableRelease = objects.get(
      `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/profile/releases/${activation.generation}/${target}.json`,
    )
    if (immutableRelease?.item.role !== 'desired-state-immutable'
      || immutableRelease.item.bytes !== activeObject.bytes || immutableRelease.item.sha256 !== activeObject.sha256
      || immutableRelease.item.bytes > 1024 * 1024) {
      throw new Error(`immutable and active Profile desired states diverged: ${target}`)
    }
    consumedObjects.add(immutableRelease.item.url)

    let clientBundleSha256
    for (const reference of release.payload.components) {
      const inventoryComponent = inventoryContract.byId.get(reference.id)
      const expectedTarget = inventoryComponent?.kind === 'platform-profile'
        ? inventoryComponent.targets.find(candidate => sameTarget(candidate, release.payload.target))
        : null
      if (inventoryComponent === undefined || inventoryComponent.kind !== reference.kind
        || canonicalProfileJson(reference.target) !== canonicalProfileJson(expectedTarget ?? null)) {
        throw new Error(`Profile component reference drifted from source inventory: ${target}/${reference.id}`)
      }
      const manifestObject = objects.get(reference.manifest_url)
      if (manifestObject?.item.role !== 'component'
        || manifestObject.item.bytes !== reference.manifest_bytes
        || manifestObject.item.sha256 !== reference.manifest_sha256) {
        throw new Error(`Profile component manifest is missing: ${target}/${reference.id}`)
      }
      if (manifestObject.item.bytes > 1024 * 1024) {
        throw new Error(`Profile component manifest is too large: ${target}/${reference.id}`)
      }
      const manifest = parseProfileComponentManifest(await readFile(manifestObject.path), reference, base)
      if (manifest === undefined) throw new Error(`Profile component manifest is invalid: ${target}/${reference.id}`)
      if (reference.id === '@e-mate/dsh-client-shell') {
        const client = manifest.files.filter(file => file.path === 'lib/client.js')
        if (client.length !== 1) throw new Error(`Profile client bundle is missing: ${target}`)
        clientBundleSha256 = client[0].sha256
      }
      consumedObjects.add(manifestObject.item.url)
      for (const file of manifest.files) {
        const object = objects.get(componentFileUrl(reference, file.path))
        if (object?.item.role !== 'component' || object.item.bytes !== file.bytes || object.item.sha256 !== file.sha256) {
          throw new Error(`Profile component file is missing: ${target}/${reference.id}/${file.path}`)
        }
        consumedObjects.add(object.item.url)
      }
    }
    const componentAggregateSha256 = canonicalDigest(PROFILE_COMPONENT_CONTEXT, {
      target,
      components: release.payload.components,
    })
    targets.push({
      target,
      profile_generation: activation.generation,
      component_aggregate_sha256: componentAggregateSha256,
    })
    if (options.performanceOutput !== undefined) {
      if (clientBundleSha256 === undefined) throw new Error(`Profile client bundle authority is missing: ${target}`)
      performanceTargets.push({
        target,
        profile_generation: activation.generation,
        composition_sha256: componentAggregateSha256,
        client_bundle_sha256: clientBundleSha256,
      })
    }
  }

  if (consumedObjects.size !== objects.size) {
    throw new Error('Profile publication plan contains unreferenced immutable objects')
  }

  const expectedBundleFiles = new Set([
    'publication-plan.json',
    ...immutable.map(item => item.path),
    ...plan.activations.map(activation => activation.object.path),
  ])
  const actualBundleFiles = new Set(bundleTree.entries.map(entry => entry.path))
  if (canonicalProfileJson([...actualBundleFiles].sort()) !== canonicalProfileJson([...expectedBundleFiles].sort())) {
    throw new Error('Profile publication bundle contains unreceipted files')
  }
  const unsigned = {
    inventory_sha256: receipt.inventory_sha256,
    staged_profile_tree_sha256: receipt.staged_profile_tree_sha256,
    targets,
  }
  const aggregate = {
    aggregate_sha256: canonicalDigest(PROFILE_AGGREGATE_CONTEXT, unsigned),
    ...unsigned,
  }
  await atomicJson(options.output, aggregate)
  if (options.performanceOutput !== undefined) {
    await atomicJson(options.performanceOutput, {
      schema_version: 1,
      document_type: 'emate.profile-performance-authorities',
      source_commit: options.sourceCommit,
      base_contract_id: base.id,
      publication_tree_sha256: canonicalDigest(PROFILE_PUBLICATION_CONTEXT, bundleTree.entries),
      profile_component_aggregate_sha256: aggregate.aggregate_sha256,
      targets: performanceTargets,
    })
  }
  return aggregate
}

function strictBase64(value) {
  if (typeof value !== 'string' || value === '') return
  const bytes = Buffer.from(value, 'base64')
  return bytes.toString('base64') === value ? bytes : undefined
}

function safeArtifactPath(value) {
  return typeof value === 'string' && value !== '' && !value.startsWith('/') && !value.endsWith('/')
    && !value.includes('\\') && value.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function performanceEvidenceFiles(evidence) {
  if (!record(evidence.paths) || !exactKeys(evidence.paths, PERFORMANCE_PATHS)) {
    throw new Error('performance evidence path set is invalid')
  }
  const descriptors = new Map()
  for (const pathName of PERFORMANCE_PATHS) {
    const receipt = evidence.paths[pathName]?.run_receipt
    if (!record(receipt)) throw new Error(`performance evidence ${pathName} receipt is missing`)
    const fields = pathName === 'baseline'
      ? PERFORMANCE_ARTIFACT_FIELDS
      : [...PERFORMANCE_ARTIFACT_FIELDS, ['enterprise_receipt_artifact', 'enterprise-runtime-receipt']]
    for (const [field, kind] of fields) {
      const descriptor = receipt[field]
      if (!exactKeys(descriptor, ['kind', 'path', 'sha256']) || descriptor.kind !== kind
        || !safeArtifactPath(descriptor.path) || !SHA256.test(descriptor.sha256 ?? '')
        || ['e-mate-performance-evidence.json', 'performance-admission.json', 'scripts/performance-parity.mjs']
          .includes(descriptor.path)
        || descriptors.has(descriptor.path)) {
        throw new Error(`performance evidence ${pathName} ${field} descriptor is invalid`)
      }
      descriptors.set(descriptor.path, descriptor.sha256)
    }
  }
  return descriptors
}

function candidateArtifacts(value, sourceCommit) {
  if (!exactKeys(value, [
    'schema_version', 'document_type', 'release_status', 'version', 'source_commit',
    'schedule_protocol_floor', 'artifacts',
  ]) || value.schema_version !== 2 || value.document_type !== 'emate.desktop-artifact-candidate'
    || value.release_status !== 'admission-pending' || value.source_commit !== sourceCommit
    || !record(value.artifacts)) throw new Error('Desktop candidate is invalid')
  for (const platform of ['darwin', 'win32']) {
    const artifact = value.artifacts[platform]
    if (!exactKeys(artifact, ['url', 'bytes', 'sha256', 'build_source_commit', 'build_run_id'])
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || !SHA256.test(artifact.sha256 ?? '')
      || artifact.build_source_commit !== sourceCommit || !RUN_ID.test(artifact.build_run_id ?? '')) {
      throw new Error(`Desktop candidate ${platform} artifact is invalid`)
    }
  }
  return value.artifacts
}

async function verifyDesktopCandidateBundle(path, sourceCommit) {
  const candidatePath = resolve(path)
  const candidate = (await boundedJson(candidatePath, 1024 * 1024)).value
  const artifacts = candidateArtifacts(candidate, sourceCommit)
  if (typeof candidate.version !== 'string' || !/^\d+\.\d+\.\d+$/u.test(candidate.version)) {
    throw new Error('Desktop candidate version is invalid')
  }
  const names = {
    darwin: `e-Mate-${candidate.version}-mac-universal.dmg`,
    win32: `e-Mate-${candidate.version}-win-x64-Setup.exe`,
  }
  const files = (await treeEntries(dirname(candidatePath))).entries
  if (canonicalProfileJson(files.map(file => file.path))
    !== canonicalProfileJson(['desktop-candidate.json', names.darwin, names.win32].sort())) {
    throw new Error('Desktop candidate artifact file set is invalid')
  }
  for (const platform of ['darwin', 'win32']) {
    const file = files.find(item => item.path === names[platform])
    if (file?.bytes !== artifacts[platform].bytes || file.sha256 !== artifacts[platform].sha256) {
      throw new Error(`Desktop candidate ${platform} installer bytes drifted`)
    }
  }
  return { candidate, artifacts }
}

function performanceModelIdentity(evidence) {
  const receipts = PERFORMANCE_PATHS.map(pathName => evidence.paths?.[pathName]?.run_receipt)
  const identity = receipts[0]
  if (!record(identity) || receipts.some(receipt => !record(receipt)
    || receipt.provider !== identity.provider || receipt.model !== identity.model
    || receipt.reasoning_level !== identity.reasoning_level)) {
    throw new Error('performance model identity is inconsistent')
  }
  return { provider: identity.provider, model: identity.model, reasoning_effort: identity.reasoning_level }
}

function verifyPerformanceSignature(admission, base, context = PERFORMANCE_SIGNATURE_CONTEXT) {
  const key = base.profile_signing_keys.find(candidate => candidate.id === admission.signature?.key_id)
  const signature = strictBase64(admission.signature?.value)
  const publicKey = strictBase64(key?.public_key_spki_der_base64)
  const { signature: ignored, ...unsigned } = admission
  if (!exactKeys(admission.signature, ['algorithm', 'key_id', 'value'])
    || admission.signature.algorithm !== 'ed25519' || key === undefined
    || signature?.byteLength !== 64 || publicKey === undefined
    || !verify(null, Buffer.concat([
      context,
      Buffer.from(canonicalProfileJson(unsigned), 'utf8'),
    ]), createPublicKey({ key: publicKey, format: 'der', type: 'spki' }), signature)) {
    throw new Error('performance admission signature is invalid')
  }
  return key
}

async function verifyPerformanceChild(options) {
  const prefix = `children/${String(options.index + 1).padStart(2, '0')}-${PERFORMANCE_MODEL_LEAF_IDS[options.index]}`
  const childRoot = join(options.performanceRoot, ...prefix.split('/'))
  const evidence = await boundedJson(join(childRoot, 'e-mate-performance-evidence.json'))
  const supportingFiles = performanceEvidenceFiles(evidence.value)
  if (supportingFiles.size !== 20) throw new Error('performance child must contain exactly 20 support files')
  const entries = (await treeEntries(childRoot)).entries
  const expectedFiles = ['performance-admission.json', 'e-mate-performance-evidence.json', ...supportingFiles.keys()].sort()
  if (canonicalProfileJson(entries.map(entry => entry.path)) !== canonicalProfileJson(expectedFiles)
    || entries.some(entry => entry.bytes <= 0 || entry.bytes > MAX_PERFORMANCE_FILE_BYTES)
    || entries.some(entry => supportingFiles.has(entry.path) && supportingFiles.get(entry.path) !== entry.sha256)) {
    throw new Error(`performance child ${options.roster.route_id} file set is invalid`)
  }
  const admissionInput = await boundedJson(join(childRoot, 'performance-admission.json'), 1024 * 1024)
  const admission = admissionInput.value
  if (!exactKeys(admission, [
    'schema_version', 'document_type', 'status', 'performance_run_id', 'source_commit', 'base_contract_id',
    'profile_component_aggregate_sha256', 'desktop_artifacts', 'evidence_sha256', 'verifier', 'signature',
  ]) || admission.schema_version !== 1 || admission.document_type !== 'emate.performance-admission'
    || admission.status !== 'passed' || typeof admission.performance_run_id !== 'string'
    || admission.performance_run_id.length < 16 || admission.source_commit !== options.sourceCommit
    || admission.base_contract_id !== options.base.id
    || admission.profile_component_aggregate_sha256 !== options.profileAggregate.aggregate_sha256
    || admission.evidence_sha256 !== sha256(evidence.bytes)
    || !record(admission.desktop_artifacts) || !record(admission.signature)) {
    throw new Error(`signed performance child ${options.roster.route_id} identity is invalid`)
  }
  for (const platform of ['darwin', 'win32']) {
    if (!exactKeys(admission.desktop_artifacts[platform], ['bytes', 'sha256'])
      || admission.desktop_artifacts[platform].bytes !== options.artifacts[platform].bytes
      || admission.desktop_artifacts[platform].sha256 !== options.artifacts[platform].sha256) {
      throw new Error(`performance child ${options.roster.route_id} ${platform} artifact drifted`)
    }
  }
  const identity = performanceModelIdentity(evidence.value)
  if (canonicalProfileJson(identity) !== canonicalProfileJson({
    provider: options.roster.provider, model: options.roster.model, reasoning_effort: options.roster.reasoning_effort,
  }) || canonicalProfileJson(evidence.value?.performance_model) !== canonicalProfileJson(options.roster)) {
    throw new Error(`performance child ${options.roster.route_id} model identity drifted`)
  }
  const decision = evidence.value?.decision
  const verifier = admission.verifier
  if (!exactKeys(verifier, [
    'contract', 'source', 'source_commit', 'source_sha256', 'harness_commit', 'evidence_filename',
    'decision_sha256', 'gate_status',
  ]) || verifier.contract !== 'ttft-v2' || verifier.source !== 'scripts/performance-parity.mjs'
    || verifier.source_commit !== options.sourceCommit || verifier.source_sha256 !== options.sourceSha256
    || verifier.harness_commit !== options.base.harness_commit
    || verifier.evidence_filename !== 'e-mate-performance-evidence.json'
    || evidence.value?.schema_version !== 2
    || evidence.value?.comparison_kind !== 'installed-2.0.12-vs-2.0.13'
    || evidence.value?.evidence_kind !== 'production-real-provider'
    || evidence.value?.production_artifacts_verified !== true
    || evidence.value?.harness_commit !== options.base.harness_commit
    || !record(decision) || decision.gate_status !== 'passed'
    || !Array.isArray(decision.failures) || decision.failures.length !== 0
    || !Array.isArray(decision.production_receipt_failures) || decision.production_receipt_failures.length !== 0
    || verifier.decision_sha256 !== sha256(Buffer.from(`${JSON.stringify(decision, null, 2)}\n`, 'utf8'))
    || verifier.gate_status !== 'passed'
    || evidence.value?.performance_run_id !== admission.performance_run_id) {
    throw new Error(`performance child ${options.roster.route_id} verifier receipt is invalid`)
  }
  const key = verifyPerformanceSignature(admission, options.base)
  return {
    child: {
      route_id: options.roster.route_id,
      performance_run_id: admission.performance_run_id,
      admission_sha256: sha256(admissionInput.bytes),
      evidence_sha256: sha256(evidence.bytes),
      verifier,
    },
    key_id: key.id,
    files: entries.map(entry => `${prefix}/${entry.path}`),
  }
}

/** Verify all four signed TTFT v2 cohorts and emit only the updater's existing four-field summary. */
export async function createPerformanceSummary(options) {
  if (!SHA40.test(options.sourceCommit)) throw new Error('performance source commit is invalid')
  const base = loadProfileBaseContract(resolve(options.baseContract))
  const { artifacts } = await verifyDesktopCandidateBundle(options.candidate, options.sourceCommit)
  const profileAggregate = (await boundedJson(resolve(options.profileAggregate), 1024 * 1024)).value
  if (!exactKeys(profileAggregate, ['aggregate_sha256', 'inventory_sha256', 'staged_profile_tree_sha256', 'targets'])
    || !SHA256.test(profileAggregate.aggregate_sha256 ?? '')) throw new Error('Profile aggregate is invalid')
  const sourcePath = resolve(options.verifierSource)
  const sourceMetadata = await lstat(sourcePath)
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()
    || sourceMetadata.size <= 0 || sourceMetadata.size > MAX_PERFORMANCE_FILE_BYTES) {
    throw new Error('performance verifier source is invalid')
  }
  const sourceSha256 = sha256(await readFile(sourcePath))
  const performanceRoot = resolve(options.performanceBundle)
  const children = []
  for (const [index, roster] of PERFORMANCE_MODEL_ROSTER.entries()) {
    children.push(await verifyPerformanceChild({
      performanceRoot, roster, index, sourceCommit: options.sourceCommit, base, profileAggregate, artifacts, sourceSha256,
    }))
  }
  const childReceipts = children.map(child => child.child)
  const runIds = childReceipts.map(child => child.performance_run_id)
  if (new Set(runIds).size !== PERFORMANCE_MODEL_ROSTER.length) {
    throw new Error('performance child run identity is duplicated')
  }
  const admissionInput = await boundedJson(join(performanceRoot, 'performance-admission.json'), 1024 * 1024)
  const admission = admissionInput.value
  if (!exactKeys(admission, [
    'schema_version', 'document_type', 'status', 'performance_run_id', 'source_commit', 'base_contract_id',
    'profile_component_aggregate_sha256', 'desktop_artifacts', 'roster', 'children',
    'evidence_sha256', 'verifier', 'signature',
  ]) || admission.schema_version !== 1 || admission.document_type !== 'emate.performance-aggregate-admission'
    || admission.status !== 'passed' || typeof admission.performance_run_id !== 'string'
    || admission.performance_run_id.length < 16 || runIds.includes(admission.performance_run_id)
    || admission.source_commit !== options.sourceCommit || admission.base_contract_id !== base.id
    || admission.profile_component_aggregate_sha256 !== profileAggregate.aggregate_sha256
    || !record(admission.desktop_artifacts)
    || canonicalProfileJson(admission.roster) !== canonicalProfileJson(PERFORMANCE_MODEL_ROSTER)
    || canonicalProfileJson(admission.children) !== canonicalProfileJson(childReceipts)
    || admission.evidence_sha256 !== sha256(Buffer.from(
      canonicalProfileJson(childReceipts.map(child => child.evidence_sha256)), 'utf8'))
    || admission.performance_run_id !== `performance-aggregate-${sha256(Buffer.from(
      canonicalProfileJson(childReceipts), 'utf8')).slice(0, 40)}`) {
    throw new Error('signed performance aggregate identity is invalid')
  }
  for (const platform of ['darwin', 'win32']) {
    if (!exactKeys(admission.desktop_artifacts[platform], ['bytes', 'sha256'])
      || admission.desktop_artifacts[platform].bytes !== artifacts[platform].bytes
      || admission.desktop_artifacts[platform].sha256 !== artifacts[platform].sha256) {
      throw new Error(`performance aggregate ${platform} artifact drifted`)
    }
  }
  const verifier = admission.verifier
  if (!exactKeys(verifier, [
    'contract', 'source', 'source_commit', 'source_sha256', 'harness_commit',
    'evidence_filename', 'decision_sha256', 'gate_status',
  ]) || verifier.contract !== 'ttft-v2-aggregate' || verifier.source !== 'scripts/performance-parity.mjs'
    || verifier.source_commit !== options.sourceCommit || verifier.source_sha256 !== sourceSha256
    || verifier.harness_commit !== base.harness_commit
    || verifier.evidence_filename !== 'performance-admission.json'
    || verifier.decision_sha256 !== sha256(Buffer.from(
      canonicalProfileJson(childReceipts.map(child => child.verifier.decision_sha256)), 'utf8'))
    || verifier.gate_status !== 'passed') {
    throw new Error('performance aggregate verifier receipt is invalid')
  }
  const key = verifyPerformanceSignature(admission, base, PERFORMANCE_AGGREGATE_SIGNATURE_CONTEXT)
  if (children.some(child => child.key_id !== key.id)) {
    throw new Error('performance child signing key differs from the aggregate')
  }
  const expectedFiles = ['performance-admission.json', ...children.flatMap(child => child.files)].sort()
  const actualEntries = (await treeEntries(performanceRoot)).entries
  if (canonicalProfileJson(actualEntries.map(entry => entry.path)) !== canonicalProfileJson(expectedFiles)
    || actualEntries.length !== 89 || actualEntries.some(entry => entry.bytes <= 0
      || entry.bytes > MAX_PERFORMANCE_FILE_BYTES || entry.path.toLowerCase().includes('mac-smoke'))) {
    throw new Error('performance aggregate artifact file set is invalid')
  }
  const summary = {
    performance_run_id: admission.performance_run_id,
    admission_sha256: sha256(admissionInput.bytes),
    signature_key_id: key.id,
    verifier,
  }
  await atomicJson(options.output, summary)
  return summary
}

function githubRun(value, expected) {
  if (!record(value) || String(value.id) !== expected.id || value.path !== expected.path
    || value.head_sha !== expected.sourceCommit || value.head_branch !== 'main'
    || value.event !== expected.event || value.status !== 'completed' || value.conclusion !== 'success'
    || value.repository?.full_name !== REPOSITORY
    || value.run_attempt !== 1) {
    throw new Error(`GitHub ${expected.label} run provenance is invalid`)
  }
  return value
}

function successfulJob(value, name, label) {
  if (!record(value) || !Array.isArray(value.jobs)
    || value.jobs.filter(job => job?.name === name && job.conclusion === 'success').length !== 1) {
    throw new Error(`GitHub ${label} job is not uniquely successful: ${name}`)
  }
}

function githubArtifact(value, expected) {
  if (!record(value) || String(value.id) !== expected.id || value.name !== expected.name
    || value.expired !== false || typeof value.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.digest)
    || String(value.workflow_run?.id) !== expected.runId || value.workflow_run?.head_sha !== expected.sourceCommit) {
    throw new Error(`GitHub ${expected.label} artifact provenance is invalid`)
  }
  return value
}

async function metadata(directory, name) {
  return (await boundedJson(join(resolve(directory), name), 4 * 1024 * 1024)).value
}

/** Validate downloaded GitHub metadata and emit the updater's release provenance. */
export async function createGithubArtifactProvenance(options) {
  if (!SHA40.test(options.sourceCommit) || !RUN_ID.test(options.ciRunId)
    || !RUN_ID.test(options.desktopRunId) || !RUN_ID.test(options.profileRunId)
    || !RUN_ID.test(options.desktopArtifactId) || !RUN_ID.test(options.profileArtifactId)) {
    throw new Error('GitHub admission identifiers are invalid')
  }
  const { artifacts: candidateArtifact } = await verifyDesktopCandidateBundle(options.candidate, options.sourceCommit)
  if (candidateArtifact.darwin.build_run_id !== options.ciRunId
    || candidateArtifact.win32.build_run_id !== options.ciRunId) {
    throw new Error('Desktop candidate installers are not owned by the selected CI run')
  }
  const ciRun = githubRun(await metadata(options.metadata, 'ci-run.json'), {
    id: options.ciRunId, path: '.github/workflows/ci.yml', event: 'push',
    sourceCommit: options.sourceCommit, label: 'CI',
  })
  const desktopRun = githubRun(await metadata(options.metadata, 'desktop-run.json'), {
    id: options.desktopRunId, path: '.github/workflows/desktop-release.yml', event: 'workflow_dispatch',
    sourceCommit: options.sourceCommit, label: 'Desktop',
  })
  const profileRun = githubRun(await metadata(options.metadata, 'profile-run.json'), {
    id: options.profileRunId, path: '.github/workflows/profile-release.yml', event: 'workflow_dispatch',
    sourceCommit: options.sourceCommit, label: 'Profile',
  })
  successfulJob(await metadata(options.metadata, 'ci-jobs.json'), 'CI admission', 'CI')
  successfulJob(await metadata(options.metadata, 'ci-jobs.json'), 'Node 24 / target contracts and unit tests', 'CI')
  successfulJob(await metadata(options.metadata, 'ci-jobs.json'), 'Windows x64 / unsigned desktop installer', 'CI')
  successfulJob(await metadata(options.metadata, 'ci-jobs.json'), 'macOS universal / unsigned desktop disk image', 'CI')
  successfulJob(await metadata(options.metadata, 'desktop-jobs.json'), 'Bind exact protected-main CI artifacts to the release manifest', 'Desktop')
  const profileJobs = await metadata(options.metadata, 'profile-jobs.json')
  successfulJob(profileJobs, 'Validate accepted CI evidence', 'Profile')
  for (const target of TARGETS) successfulJob(profileJobs, `Bootstrap complete Profile generation / ${target}`, 'Profile')
  successfulJob(profileJobs, 'Prepare signed native Cloudflare publication bundle', 'Profile')
  const mainRef = await metadata(options.metadata, 'main-ref.json')
  if (mainRef?.object?.sha !== options.sourceCommit) throw new Error('GitHub main branch head drifted')

  const desktop = githubArtifact(await metadata(options.metadata, 'desktop-artifact.json'), {
    id: options.desktopArtifactId, name: `e-mate-desktop-release-${options.sourceCommit}`,
    runId: options.desktopRunId, sourceCommit: options.sourceCommit, label: 'Desktop candidate',
  })
  const ciArtifact = await metadata(options.metadata, 'ci-artifact.json')
  if (!record(ciArtifact) || !RUN_ID.test(String(ciArtifact.id))) throw new Error('GitHub CI artifact ID is invalid')
  githubArtifact(ciArtifact, {
    id: String(ciArtifact.id), name: `e-mate-ci-plan-${options.sourceCommit}`,
    runId: options.ciRunId, sourceCommit: options.sourceCommit, label: 'CI impact',
  })
  githubArtifact(await metadata(options.metadata, 'profile-publication-artifact.json'), {
    id: options.profileArtifactId, name: `e-mate-profile-native-cloudflare-publication-${options.sourceCommit}`,
    runId: options.profileRunId, sourceCommit: options.sourceCommit, label: 'Profile publication',
  })
  const ciOwnedArtifacts = [
    [await metadata(options.metadata, 'base-sdk-artifact.json'), `e-mate-base-sdk-${options.sourceCommit}`, 'Base SDK'],
    [await metadata(options.metadata, 'profile-build-artifact.json'), `e-mate-desktop-profile-${options.sourceCommit}`, 'Profile build'],
    [await metadata(options.metadata, 'profile-build-receipt-artifact.json'), `e-mate-desktop-profile-build-receipt-${options.sourceCommit}`, 'Profile build receipt'],
    [await metadata(options.metadata, 'windows-ci-artifact.json'), `e-mate-desktop-windows-${options.sourceCommit}`, 'Windows CI installer'],
    [await metadata(options.metadata, 'macos-ci-artifact.json'), `e-mate-desktop-macos-${options.sourceCommit}`, 'macOS CI installer'],
  ]
  const artifactIds = new Set()
  for (const [value, name, label] of [
    ...ciOwnedArtifacts,
  ]) {
    if (!record(value) || !RUN_ID.test(String(value.id))) throw new Error(`GitHub ${label} artifact ID is invalid`)
    githubArtifact(value, {
      id: String(value.id), name, runId: options.ciRunId,
      sourceCommit: options.sourceCommit, label,
    })
    if (artifactIds.has(String(value.id))) throw new Error('GitHub CI build artifacts share an identity')
    artifactIds.add(String(value.id))
  }
  const provenance = {
    schema_version: 1,
    document_type: 'emate.github-artifact-provenance',
    source_commit: options.sourceCommit,
    artifacts: [
      {
        role: 'desktop_candidate', name: desktop.name, artifact_id: String(desktop.id), digest: desktop.digest,
        run_id: String(desktopRun.id), run_attempt: desktopRun.run_attempt,
      },
    ],
  }
  await atomicJson(options.output, provenance)
  return { provenance, ciRun, profileRun }
}

function option(values, name) {
  const value = values[name]
  if (typeof value !== 'string' || value === '') throw new Error(`missing --${name}`)
  return value
}

async function main() {
  const command = process.argv[2]
  const { values } = parseArgs({ args: process.argv.slice(3), options: Object.fromEntries([
    'base-contract', 'candidate', 'ci-run-id', 'commit', 'desktop-artifact-id', 'desktop-run-id', 'inventory',
    'metadata', 'out', 'performance-bundle', 'profile',
    'profile-aggregate', 'profile-artifact-id', 'profile-receipt', 'profile-release-bundle', 'profile-run-id',
    'release-version', 'verifier-source', 'performance-authorities-out',
  ].map(name => [name, { type: 'string' }])) })
  if (command === 'profile-build-receipt') {
    await createProfileBuildReceipt({
      sourceCommit: option(values, 'commit'), profile: option(values, 'profile'),
      inventory: option(values, 'inventory'), baseContract: option(values, 'base-contract'), output: option(values, 'out'),
    })
  } else if (command === 'profile-aggregate') {
    await createProfileComponentAggregate({
      sourceCommit: option(values, 'commit'), ciRunId: option(values, 'ci-run-id'),
      profileRunId: option(values, 'profile-run-id'), releaseVersion: option(values, 'release-version'),
      profile: option(values, 'profile'), inventory: option(values, 'inventory'),
      profileReceipt: option(values, 'profile-receipt'), publicationBundle: option(values, 'profile-release-bundle'),
      baseContract: option(values, 'base-contract'), output: option(values, 'out'),
      ...(values['performance-authorities-out'] === undefined
        ? {} : { performanceOutput: option(values, 'performance-authorities-out') }),
    })
  } else if (command === 'performance-summary') {
    await createPerformanceSummary({
      sourceCommit: option(values, 'commit'), candidate: option(values, 'candidate'),
      profileAggregate: option(values, 'profile-aggregate'), performanceBundle: option(values, 'performance-bundle'),
      verifierSource: option(values, 'verifier-source'), baseContract: option(values, 'base-contract'),
      output: option(values, 'out'),
    })
  } else if (command === 'github-provenance') {
    await createGithubArtifactProvenance({
      sourceCommit: option(values, 'commit'), candidate: option(values, 'candidate'), metadata: option(values, 'metadata'),
      ciRunId: option(values, 'ci-run-id'), desktopRunId: option(values, 'desktop-run-id'),
      profileRunId: option(values, 'profile-run-id'), desktopArtifactId: option(values, 'desktop-artifact-id'),
      profileArtifactId: option(values, 'profile-artifact-id'), output: option(values, 'out'),
    })
  } else {
    throw new Error('desktop admission command must be profile-build-receipt, profile-aggregate, performance-summary, or github-provenance')
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (cause) {
    process.stderr.write(`desktop-admission: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  }
}
