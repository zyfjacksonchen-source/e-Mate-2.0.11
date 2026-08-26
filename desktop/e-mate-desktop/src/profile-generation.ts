/** Content-addressed Profile generations assembled from signed component releases. */

import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  materializeProfileComponent,
  verifyMaterializedProfileComponent,
  type ProfileComponentRequest,
} from './profile-component.ts'
import {
  canonicalProfileJson,
  sameProfileReleaseTarget,
  selectProfileRelease,
  verifyProfileRelease,
  type ProfileBaseContract,
  type ProfileReleasePayload,
  type ProfileReleaseTarget,
  type SignedProfileRelease,
} from './profile-release.ts'

const STATE_VERSION = 1
const STATE_DIRECTORY_MODE = 0o700
const STATE_FILE_MODE = 0o600
const MAX_STATE_BYTES = 16 * 1024
const MAX_RELEASE_BYTES = 1024 * 1024
const SHA256 = /^[0-9a-f]{64}$/u
const RELEASE_FILENAME = 'release.json'

/** Immutable generation shipped inside the installed Desktop Base. */
export const BUNDLED_PROFILE_GENERATION = 'bundled'
export type ProfileGenerationId = typeof BUNDLED_PROFILE_GENERATION | string

export interface ProfileGenerationState {
  readonly schema_version: 1
  readonly active: ProfileGenerationId
  readonly last_known_good: ProfileGenerationId
  readonly previous_known_good?: ProfileGenerationId
  readonly pending?: ProfileGenerationId
}

export interface ProfileGenerationStartup {
  readonly generation_id: ProfileGenerationId
  readonly state: ProfileGenerationState
  readonly recovered_state: boolean
  readonly rolled_back_from?: ProfileGenerationId
}

export interface VerifiedProfileGeneration {
  readonly id: string
  readonly directory: string
  readonly release: SignedProfileRelease
  readonly component_directories: ReadonlyMap<string, string>
}

export interface ResolvedProfileGenerationStartup {
  readonly generation_id: ProfileGenerationId
  readonly state: ProfileGenerationState
  readonly generation?: VerifiedProfileGeneration
  readonly recovered_state: boolean
  readonly rolled_back_from: readonly ProfileGenerationId[]
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function assertGenerationId(value: string): asserts value is ProfileGenerationId {
  if (value !== BUNDLED_PROFILE_GENERATION && !SHA256.test(value)) {
    throw new Error(`invalid Profile generation id ${JSON.stringify(value)}`)
  }
}

function defaultState(): ProfileGenerationState {
  return {
    schema_version: STATE_VERSION,
    active: BUNDLED_PROFILE_GENERATION,
    last_known_good: BUNDLED_PROFILE_GENERATION,
  }
}

function parseState(value: unknown): ProfileGenerationState {
  if (!record(value) || !exactKeys(value, [
    'schema_version', 'active', 'last_known_good',
    ...(value.previous_known_good === undefined ? [] : ['previous_known_good']),
    ...(value.pending === undefined ? [] : ['pending']),
  ]) || value.schema_version !== STATE_VERSION || typeof value.active !== 'string'
    || typeof value.last_known_good !== 'string'
    || (value.previous_known_good !== undefined && typeof value.previous_known_good !== 'string')
    || (value.pending !== undefined && typeof value.pending !== 'string')) {
    throw new Error('Profile generation state is invalid')
  }
  assertGenerationId(value.active)
  assertGenerationId(value.last_known_good)
  if (value.previous_known_good !== undefined) assertGenerationId(value.previous_known_good)
  if (value.pending !== undefined) assertGenerationId(value.pending)
  return {
    schema_version: STATE_VERSION,
    active: value.active,
    last_known_good: value.last_known_good,
    ...(value.previous_known_good === undefined ? {} : { previous_known_good: value.previous_known_good }),
    ...(value.pending === undefined ? {} : { pending: value.pending }),
  }
}

function loadState(statePath: string): { state: ProfileGenerationState, recovered: boolean } {
  let metadata: ReturnType<typeof lstatSync>
  try {
    metadata = lstatSync(statePath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { state: defaultState(), recovered: false }
    throw cause
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0 || metadata.size > MAX_STATE_BYTES) {
    return { state: defaultState(), recovered: true }
  }
  let value: unknown
  try {
    value = JSON.parse(readFileSync(statePath, 'utf8'))
  } catch (cause) {
    if (cause instanceof SyntaxError) return { state: defaultState(), recovered: true }
    throw cause
  }
  try {
    return { state: parseState(value), recovered: false }
  } catch {
    return { state: defaultState(), recovered: true }
  }
}

function writeState(statePath: string, state: ProfileGenerationState): void {
  const directory = dirname(statePath)
  mkdirSync(directory, { recursive: true, mode: STATE_DIRECTORY_MODE })
  const directoryMetadata = lstatSync(directory)
  if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
    throw new Error('Profile generation state directory is not private')
  }
  chmodSync(directory, STATE_DIRECTORY_MODE)
  const temporary = join(directory, `.${basename(statePath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: STATE_FILE_MODE,
    })
    renameSync(temporary, statePath)
    chmodSync(statePath, STATE_FILE_MODE)
  } finally {
    rmSync(temporary, { force: true })
  }
}

/** Read the private generation state, recovering malformed state to the bundled Base. */
export function readProfileGenerationState(statePath: string): ProfileGenerationState {
  return loadState(statePath).state
}

/** Select a pending generation, or roll an unconfirmed generation back before boot. */
export function beginProfileGenerationStartup(statePath: string): ProfileGenerationStartup {
  const loaded = loadState(statePath)
  const current = loaded.state
  if (current.pending !== undefined) {
    const state: ProfileGenerationState = {
      schema_version: STATE_VERSION,
      active: current.pending,
      last_known_good: current.last_known_good,
      ...(current.previous_known_good === undefined ? {} : { previous_known_good: current.previous_known_good }),
    }
    writeState(statePath, state)
    return {
      generation_id: state.active,
      state,
      recovered_state: loaded.recovered,
    }
  }
  if (current.active !== current.last_known_good) {
    const state: ProfileGenerationState = {
      schema_version: STATE_VERSION,
      active: current.last_known_good,
      last_known_good: current.last_known_good,
      ...(current.previous_known_good === undefined ? {} : { previous_known_good: current.previous_known_good }),
    }
    writeState(statePath, state)
    return {
      generation_id: state.active,
      state,
      recovered_state: true,
      rolled_back_from: current.active,
    }
  }
  if (loaded.recovered) writeState(statePath, current)
  return {
    generation_id: current.active,
    state: current,
    recovered_state: loaded.recovered,
  }
}

/** Persist a user-confirmed generation for activation on the next restart. */
export function stageProfileGeneration(statePath: string, generationId: string): ProfileGenerationState {
  assertGenerationId(generationId)
  if (generationId === BUNDLED_PROFILE_GENERATION) throw new Error('the bundled generation cannot be staged as an update')
  const current = loadState(statePath).state
  const state: ProfileGenerationState = {
    schema_version: STATE_VERSION,
    active: current.active,
    last_known_good: current.last_known_good,
    ...(current.previous_known_good === undefined ? {} : { previous_known_good: current.previous_known_good }),
    pending: generationId,
  }
  writeState(statePath, state)
  return state
}

/** Commit one generation only after the Renderer Loader reports healthy. */
export function markProfileGenerationHealthy(statePath: string, generationId: ProfileGenerationId): ProfileGenerationState {
  assertGenerationId(generationId)
  const current = loadState(statePath).state
  if (current.active !== generationId || current.pending !== undefined) {
    throw new Error('cannot confirm an inactive Profile generation')
  }
  const state: ProfileGenerationState = {
    schema_version: STATE_VERSION,
    active: generationId,
    last_known_good: generationId,
    ...(current.last_known_good === generationId
      ? current.previous_known_good === undefined ? {} : { previous_known_good: current.previous_known_good }
      : { previous_known_good: current.last_known_good }),
  }
  writeState(statePath, state)
  return state
}

/** Roll a failed generation back to the last Renderer-confirmed generation. */
export function markProfileGenerationFailed(statePath: string, generationId: ProfileGenerationId): ProfileGenerationState {
  assertGenerationId(generationId)
  const current = loadState(statePath).state
  if (current.active !== generationId) throw new Error('cannot fail an inactive Profile generation')
  const fallback = current.active === current.last_known_good
    ? current.previous_known_good ?? BUNDLED_PROFILE_GENERATION
    : current.last_known_good
  const state: ProfileGenerationState = {
    schema_version: STATE_VERSION,
    active: fallback,
    last_known_good: fallback,
    ...(fallback === BUNDLED_PROFILE_GENERATION ? {} : { previous_known_good: BUNDLED_PROFILE_GENERATION }),
  }
  writeState(statePath, state)
  return state
}

/** Content identity of a signed desired-state payload, independent of JSON whitespace. */
export function profileGenerationId(payload: ProfileReleasePayload): string {
  let identity: unknown = payload
  if (payload.schedule_protocol_floor === 0) {
    const { schedule_protocol_floor: _legacyFloor, ...legacy } = payload
    identity = legacy
  }
  return createHash('sha256').update(canonicalProfileJson(identity)).digest('hex')
}

/** A desired state must describe the complete independently updatable runtime set. */
export function assertCompleteProfileRelease(
  payload: ProfileReleasePayload,
  expectedComponentIds: readonly string[],
): void {
  const expected = [...expectedComponentIds].sort()
  if (expected.length === 0 || new Set(expected).size !== expected.length) {
    throw new Error('expected Profile component inventory is invalid')
  }
  const actual = payload.components.map(component => component.id)
  if (canonicalProfileJson(actual) !== canonicalProfileJson(expected)) {
    throw new Error('signed Profile release does not contain the complete runtime component set')
  }
}

function generationDirectory(root: string, id: string): string {
  assertGenerationId(id)
  if (id === BUNDLED_PROFILE_GENERATION) throw new Error('the bundled generation has no downloaded directory')
  return join(root, 'generations', id)
}

function componentDirectory(root: string, sha: string): string {
  if (!SHA256.test(sha)) throw new Error('invalid component store identity')
  return join(root, 'components', sha)
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: STATE_DIRECTORY_MODE })
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Profile generation store is not private')
  await chmod(path, STATE_DIRECTORY_MODE)
}

async function readGenerationRelease(path: string, base: ProfileBaseContract): Promise<SignedProfileRelease> {
  const bytes = await readFile(path)
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RELEASE_BYTES) throw new Error('Profile generation release is invalid')
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch {
    throw new Error('Profile generation release is invalid')
  }
  const release = verifyProfileRelease(value, base)
  if (release === undefined) throw new Error('Profile generation release signature is invalid')
  return release
}

/** Load and fully re-verify one immutable downloaded generation. */
export async function loadProfileGeneration(options: {
  readonly root: string
  readonly id: string
  readonly base: ProfileBaseContract
  readonly expected_component_ids: readonly string[]
  readonly target: ProfileReleaseTarget
}): Promise<VerifiedProfileGeneration> {
  const directory = generationDirectory(options.root, options.id)
  const metadata = await lstat(directory)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Profile generation is not a real directory')
  const release = await readGenerationRelease(join(directory, RELEASE_FILENAME), options.base)
  if (profileGenerationId(release.payload) !== options.id
    || !sameProfileReleaseTarget(release.payload.target, options.target)
    || selectProfileRelease(release.payload, options.base, 0) === 'base-required') {
    throw new Error('Profile generation is incompatible with this Desktop Base')
  }
  assertCompleteProfileRelease(release.payload, options.expected_component_ids)
  const componentDirectories = new Map<string, string>()
  for (const reference of release.payload.components) {
    const path = componentDirectory(options.root, reference.manifest_sha256)
    await verifyMaterializedProfileComponent({
      directory: path,
      reference,
      base: options.base,
      platform: options.target.platform,
      arch: options.target.arch,
    })
    componentDirectories.set(reference.id, path)
  }
  return { id: options.id, directory, release, component_directories: componentDirectories }
}

/** Resolve the newest valid generation, falling through at most the saved LKG chain to bundled bytes. */
export async function resolveProfileGenerationStartup(options: {
  readonly state_path: string
  readonly root: string
  readonly base: ProfileBaseContract
  readonly expected_component_ids: readonly string[]
  readonly target: ProfileReleaseTarget
}): Promise<ResolvedProfileGenerationStartup> {
  const startup = beginProfileGenerationStartup(options.state_path)
  let generationId = startup.generation_id
  let state = startup.state
  const rolledBack = startup.rolled_back_from === undefined ? [] : [startup.rolled_back_from]
  const attempted = new Set<ProfileGenerationId>()
  while (generationId !== BUNDLED_PROFILE_GENERATION) {
    if (attempted.has(generationId)) throw new Error('Profile generation recovery loop detected')
    attempted.add(generationId)
    try {
      const generation = await loadProfileGeneration({
        root: options.root,
        id: generationId,
        base: options.base,
        expected_component_ids: options.expected_component_ids,
        target: options.target,
      })
      return {
        generation_id: generationId,
        state,
        generation,
        recovered_state: startup.recovered_state || rolledBack.length > 0,
        rolled_back_from: rolledBack,
      }
    } catch {
      rolledBack.push(generationId)
      state = markProfileGenerationFailed(options.state_path, generationId)
      generationId = state.active
    }
  }
  return {
    generation_id: BUNDLED_PROFILE_GENERATION,
    state,
    recovered_state: startup.recovered_state || rolledBack.length > 0,
    rolled_back_from: rolledBack,
  }
}

/** Download only missing component identities and assemble a complete inactive generation. */
export async function assembleProfileGeneration(options: {
  readonly root: string
  readonly release: SignedProfileRelease
  readonly base: ProfileBaseContract
  readonly expected_component_ids: readonly string[]
  readonly target: ProfileReleaseTarget
  readonly request: ProfileComponentRequest
  readonly signal?: AbortSignal
}): Promise<VerifiedProfileGeneration> {
  const release = verifyProfileRelease(options.release, options.base)
  if (release === undefined || !sameProfileReleaseTarget(release.payload.target, options.target)
    || selectProfileRelease(release.payload, options.base, 0) === 'base-required') {
    throw new Error('signed Profile release is incompatible with this Desktop Base')
  }
  assertCompleteProfileRelease(release.payload, options.expected_component_ids)
  const id = profileGenerationId(release.payload)
  await ensurePrivateDirectory(options.root)
  await ensurePrivateDirectory(join(options.root, 'components'))
  await ensurePrivateDirectory(join(options.root, 'generations'))

  const existingGeneration = generationDirectory(options.root, id)
  if (existsSync(existingGeneration)) {
    try {
      return await loadProfileGeneration({
        root: options.root,
        id,
        base: options.base,
        expected_component_ids: options.expected_component_ids,
        target: options.target,
      })
    } catch {
      await rm(existingGeneration, { recursive: true, force: true })
    }
  }

  for (const reference of release.payload.components) {
    options.signal?.throwIfAborted()
    const destination = componentDirectory(options.root, reference.manifest_sha256)
    if (existsSync(destination)) {
      try {
        await verifyMaterializedProfileComponent({
          directory: destination,
          reference,
          base: options.base,
          platform: options.target.platform,
          arch: options.target.arch,
        })
        continue
      } catch {
        await rm(destination, { recursive: true, force: true })
      }
    }
    const temporary = join(options.root, 'components', `.${reference.manifest_sha256}.${randomUUID()}.tmp`)
    try {
      await materializeProfileComponent({
        destination: temporary,
        reference,
        base: options.base,
        request: options.request,
        platform: options.target.platform,
        arch: options.target.arch,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      await verifyMaterializedProfileComponent({
        directory: temporary,
        reference,
        base: options.base,
        platform: options.target.platform,
        arch: options.target.arch,
      })
      try {
        await rename(temporary, destination)
      } catch (cause) {
        if (!existsSync(destination)) throw cause
        await verifyMaterializedProfileComponent({
          directory: destination,
          reference,
          base: options.base,
          platform: options.target.platform,
          arch: options.target.arch,
        })
      }
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  }

  const temporaryGeneration = join(options.root, 'generations', `.${id}.${randomUUID()}.tmp`)
  try {
    await mkdir(temporaryGeneration, { mode: STATE_DIRECTORY_MODE })
    await writeFile(join(temporaryGeneration, RELEASE_FILENAME), `${JSON.stringify(release, null, 2)}\n`, {
      mode: STATE_FILE_MODE,
      flag: 'wx',
    })
    await rename(temporaryGeneration, existingGeneration)
  } catch (cause) {
    if (!existsSync(existingGeneration)) throw cause
  } finally {
    await rm(temporaryGeneration, { recursive: true, force: true })
  }
  return await loadProfileGeneration({
    root: options.root,
    id,
    base: options.base,
    expected_component_ids: options.expected_component_ids,
    target: options.target,
  })
}
