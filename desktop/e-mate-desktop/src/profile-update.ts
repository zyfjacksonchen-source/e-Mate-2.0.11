/** Native Profile update check and staging on the existing Desktop update path. */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  fetchProfileComponentManifest,
  verifyMaterializedProfileComponent,
  type ProfileComponentRequest,
} from './profile-component.ts'
import {
  assembleProfileGeneration,
  assertCompleteProfileRelease,
  profileGenerationId,
  stageProfileGeneration,
  type VerifiedProfileGeneration,
} from './profile-generation.ts'
import {
  parseProfileReleaseEnvelope,
  sameProfileReleaseTarget,
  selectProfileRelease,
  type ProfileBaseContract,
  type ProfileReleaseComponent,
  type ProfileReleaseTarget,
  type SignedProfileRelease,
} from './profile-release.ts'

const PROFILE_RELEASE_ROOT = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/profile/desired-state'
const MAX_RELEASE_BYTES = 1024 * 1024

export function profileReleaseUrl(target: ProfileReleaseTarget): string {
  return `${PROFILE_RELEASE_ROOT}/${target.platform}-${target.arch}.json`
}

export interface ProfileUpdateComponentSummary {
  readonly id: string
  readonly version: string
  readonly bytes: number
}

export interface ProfileUpdateAvailable {
  readonly status: 'update-available'
  readonly currentGeneration: string
  readonly currentSequence: number
  readonly generationId: string
  readonly releaseVersion: string
  readonly sequence: number
  readonly changedComponents: readonly ProfileUpdateComponentSummary[]
  readonly downloadBytes: number
  readonly release: SignedProfileRelease
}

export type ProfileUpdateCheckResult =
  | ProfileUpdateAvailable
  | {
      readonly status: 'up-to-date'
      readonly currentGeneration: string
      readonly currentSequence: number
      readonly releaseVersion: string
      readonly sequence: number
    }
  | {
      readonly status: 'base-required'
      readonly currentGeneration: string
      readonly currentSequence: number
      readonly releaseVersion: string
      readonly sequence: number
      readonly requiredBaseContracts: readonly string[]
    }

export interface DesktopProfileUpdateAdapter {
  check(signal: AbortSignal): Promise<ProfileUpdateCheckResult>
  confirm(update: ProfileUpdateAvailable): Promise<boolean>
  install(update: ProfileUpdateAvailable, signal: AbortSignal): Promise<void>
}

export interface ProfileUpdateContext {
  readonly base: ProfileBaseContract
  readonly target: ProfileReleaseTarget
  readonly expectedComponentIds: readonly string[]
  readonly generationRoot: string
  readonly generationStatePath: string
  readonly activeGenerationId: string
  readonly activeRelease?: SignedProfileRelease
  readonly request: ProfileComponentRequest
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  if (response.status !== 200 || response.body === null) throw new Error('Profile release request failed')
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared)
    || BigInt(declared) > BigInt(MAX_RELEASE_BYTES))) throw new Error('Profile release length is invalid')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_RELEASE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Profile release is too large')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, length)
}

function sameComponent(left: ProfileReleaseComponent | undefined, right: ProfileReleaseComponent): boolean {
  return left?.manifest_sha256 === right.manifest_sha256
}

async function remainingComponentBytes(
  context: ProfileUpdateContext,
  reference: ProfileReleaseComponent,
  signal: AbortSignal,
): Promise<number> {
  const manifest = await fetchProfileComponentManifest({
    reference,
    base: context.base,
    request: context.request,
    signal,
  })
  const cached = join(context.generationRoot, 'components', reference.manifest_sha256)
  if (!existsSync(cached)) return manifest.total_bytes
  try {
    await verifyMaterializedProfileComponent({
      directory: cached,
      reference,
      base: context.base,
      platform: context.target.platform,
      arch: context.target.arch,
    })
    return 0
  } catch {
    return manifest.total_bytes
  }
}

/** Verify the signed desired state and calculate only the component bytes not already accepted. */
export async function checkProfileUpdate(
  context: ProfileUpdateContext,
  signal: AbortSignal,
): Promise<ProfileUpdateCheckResult> {
  const bytes = await readBoundedResponse(await context.request(profileReleaseUrl(context.target), {
    method: 'GET', cache: 'no-store', redirect: 'error', signal,
  }))
  const release = parseProfileReleaseEnvelope(bytes, context.base, MAX_RELEASE_BYTES)
  if (release === undefined) throw new Error('Profile release signature or contract is invalid')
  if (!sameProfileReleaseTarget(release.payload.target, context.target)) {
    throw new Error('Profile release target does not match this Desktop runtime')
  }
  const currentSequence = context.activeRelease?.payload.sequence ?? 0
  const selection = selectProfileRelease(release.payload, context.base, currentSequence)
  const common = {
    currentGeneration: context.activeGenerationId,
    currentSequence,
    releaseVersion: release.payload.release_version,
    sequence: release.payload.sequence,
  }
  if (selection === 'base-required') {
    return { status: 'base-required', ...common, requiredBaseContracts: release.payload.base_contracts }
  }
  assertCompleteProfileRelease(release.payload, context.expectedComponentIds)
  if (selection === 'current') return { status: 'up-to-date', ...common }

  const active = new Map(context.activeRelease?.payload.components.map(component => [component.id, component]) ?? [])
  const changed = release.payload.components.filter(component => !sameComponent(active.get(component.id), component))
  const sizes = await Promise.all(changed.map(async component => await remainingComponentBytes(context, component, signal)))
  const changedComponents = changed.map((component, index) => ({
    id: component.id,
    version: component.version,
    bytes: sizes[index]!,
  }))
  return {
    status: 'update-available',
    ...common,
    generationId: profileGenerationId(release.payload),
    changedComponents,
    downloadBytes: sizes.reduce((sum, bytes) => sum + bytes, 0),
    release,
  }
}

/** Assemble a complete inactive generation and atomically select it for the next restart. */
export async function installProfileUpdate(
  context: ProfileUpdateContext,
  update: ProfileUpdateAvailable,
  signal: AbortSignal,
): Promise<VerifiedProfileGeneration> {
  const generation = await assembleProfileGeneration({
    root: context.generationRoot,
    release: update.release,
    base: context.base,
    expected_component_ids: context.expectedComponentIds,
    target: context.target,
    request: context.request,
    signal,
  })
  if (generation.id !== update.generationId) throw new Error('Profile generation changed during installation')
  stageProfileGeneration(context.generationStatePath, generation.id)
  return generation
}

export function sameProfileUpdate(left: ProfileUpdateAvailable | undefined, right: ProfileUpdateAvailable): boolean {
  return left?.generationId === right.generationId
}
