/** Headless version checks against the public e-Mate release service. */

import { createHash, createPublicKey, verify } from 'node:crypto'
import type { ProfileSigningKey } from './profile-release.ts'

/** Signed stable feed used only by Desktop Bases that verify its manifest. */
export const DESKTOP_VERSION_ENDPOINT = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/signed/latest.json'

/** Maximum response body bytes accepted from the version service. */
export const MAX_VERSION_RESPONSE_BYTES = 64 * 1024

/** Desktop release lanes published by the e-Mate release service. */
export type DesktopReleasePlatform = 'darwin' | 'win32'

/** Immutable installer identity supplied by the signed release manifest. */
export interface DesktopReleaseArtifact {
  readonly url: string
  readonly bytes: number
  readonly sha256: string
}

/** Existing Ed25519 Profile key reused as the installed Desktop Base trust root. */
export type DesktopReleaseSigningKey = ProfileSigningKey

/** Strictly parsed SemVer components. Numeric components remain strings to avoid overflow. */
export interface ParsedSemVer {
  /** Canonical version without the optional leading `v`. */
  readonly version: string
  /** Major numeric identifier. */
  readonly major: string
  /** Minor numeric identifier. */
  readonly minor: string
  /** Patch numeric identifier. */
  readonly patch: string
  /** Ordered prerelease identifiers, or an empty list for a stable version. */
  readonly prerelease: readonly string[]
  /** Build identifiers, ignored for version precedence. */
  readonly build: readonly string[]
}

/** Fetch-compatible request function used by the headless checker. */
export type UpdateRequest = (url: string, init: RequestInit) => Promise<Response>

/** Inputs for one stable version check. */
export interface UpdateCheckOptions {
  /** Installed application version, expressed as canonical stable SemVer. */
  readonly currentVersion: string
  /** Highest Schedule delivery protocol committed by the installed Base. */
  readonly currentScheduleProtocolFloor: number
  /** Current desktop release lane used to select one immutable installer. */
  readonly platform: DesktopReleasePlatform
  /** Release-manifest keys loaded from the packaged Base contract. */
  readonly trustedManifestKeys: readonly DesktopReleaseSigningKey[]
  /** Caller-owned cancellation signal; the checker does not create its own timeout. */
  readonly signal?: AbortSignal
  /** Optional fetch implementation for a host adapter or test. */
  readonly request?: UpdateRequest
}

/** Successful comparison returned by the stable version service. */
export type UpdateCheckResult = {
  /** Whether the service reports a version newer than the installed application. */
  readonly status: 'up-to-date'
  /** Canonical installed stable version. */
  readonly currentVersion: string
  /** Canonical latest stable version returned by the service. */
  readonly latestVersion: string
} | {
  readonly status: 'update-available'
  readonly currentVersion: string
  readonly latestVersion: string
  readonly sourceCommit: string
  readonly baseContractId: string
  readonly scheduleProtocolFloor: number
  readonly manifestIdentity: string
  readonly artifact: DesktopReleaseArtifact
}

const DESKTOP_RELEASE_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const DESKTOP_RELEASE_PATH_PREFIX = '/desktop/releases/v'
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const BASE_CONTRACT_ID_PATTERN = /^e-mate-desktop-profile-v[1-9][0-9]*-dsh-[0-9a-f]{12}$/u
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u
const RELEASE_TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const
const MANIFEST_SIGNATURE_CONTEXT = Buffer.from('e-mate-desktop-release-manifest-v1\0', 'utf8')

const SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

/**
 * Parse strict SemVer with an optional lowercase `v` prefix.
 * @param input - complete version or release tag.
 * @returns parsed identifiers, or null when the input is not valid SemVer.
 */
export function parseSemVer(input: string): ParsedSemVer | null {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = SEMVER_PATTERN.exec(version)
  if (match === null) return null

  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => isNumeric(identifier) && hasLeadingZero(identifier))) return null

  return {
    version,
    major: match[1]!,
    minor: match[2]!,
    patch: match[3]!,
    prerelease,
    build: match[5]?.split('.') ?? [],
  }
}

/**
 * Compare two strict SemVer strings without numeric overflow.
 * @param left - first strict SemVer value.
 * @param right - second strict SemVer value.
 * @returns negative, zero, or positive precedence, or null when either value is invalid.
 */
export function compareSemVerVersions(left: string, right: string): number | null {
  const leftVersion = parseSemVer(left)
  const rightVersion = parseSemVer(right)
  if (leftVersion === null || rightVersion === null) return null
  return compareParsedSemVer(leftVersion, rightVersion)
}

/**
 * Check the fixed e-Mate version endpoint for a newer stable release.
 * @param options - installed version, caller-owned signal, and optional request adapter.
 * @returns a successful comparison, or null when any request or validation step fails.
 */
export async function checkForStableUpdate(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult | null> {
  const current = parseCanonicalStableVersion(options.currentVersion)
  if (current === null || !isPositiveSafeInteger(options.currentScheduleProtocolFloor)) return null

  const init: RequestInit = {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const request = options.request ?? defaultRequest

  let response: Response
  try {
    response = await request(DESKTOP_VERSION_ENDPOINT, init)
  } catch {
    return null
  }
  if (response.status !== 200) return null

  let body: string
  try {
    body = await readLimitedBody(response)
  } catch {
    return null
  }

  const latest = parseVersionResponse(body, options.trustedManifestKeys)
  if (latest === null || latest.scheduleProtocolFloor < options.currentScheduleProtocolFloor) return null
  const comparison = compareParsedSemVer(latest.version, current)
  if (comparison <= 0) {
    return {
      status: 'up-to-date',
      currentVersion: current.version,
      latestVersion: latest.version.version,
    }
  }
  const artifact = latest.artifacts[options.platform]
  return {
    status: 'update-available',
    currentVersion: current.version,
    latestVersion: latest.version.version,
    sourceCommit: latest.sourceCommit,
    baseContractId: latest.baseContractId,
    scheduleProtocolFloor: latest.scheduleProtocolFloor,
    manifestIdentity: latest.manifestIdentity,
    artifact,
  }
}

async function defaultRequest(url: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init)
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null
    && /^[0-9]+$/u.test(declaredLength)
    && BigInt(declaredLength) > BigInt(MAX_VERSION_RESPONSE_BYTES)) {
    throw new Error('version response is too large')
  }

  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > MAX_VERSION_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('version response is too large')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

interface ParsedDesktopReleaseManifest {
  readonly version: ParsedSemVer
  readonly sourceCommit: string
  readonly baseContractId: string
  readonly scheduleProtocolFloor: number
  readonly manifestIdentity: string
  readonly artifacts: Record<DesktopReleasePlatform, DesktopReleaseArtifact>
}

function parseVersionResponse(
  body: string,
  trustedKeys: readonly DesktopReleaseSigningKey[],
): ParsedDesktopReleaseManifest | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  return parseAdmittedDesktopReleaseManifest(value, trustedKeys)
}

/** Check the exact public admitted Desktop manifest contract without executing an update. */
export function validateAdmittedDesktopReleaseManifest(
  value: unknown,
  trustedKeys: readonly DesktopReleaseSigningKey[],
): boolean {
  return parseAdmittedDesktopReleaseManifest(value, trustedKeys) !== null
}

/** Check the unsigned rich payload accepted only at the external signer boundary. */
export function validateUnsignedAdmittedDesktopReleaseManifest(value: unknown): boolean {
  if (parseUnsignedAdmittedDesktopReleaseManifest(value) === null) return false
  try {
    canonicalJson(value)
    return true
  } catch {
    return false
  }
}

function parseAdmittedDesktopReleaseManifest(
  value: unknown,
  trustedKeys: readonly DesktopReleaseSigningKey[],
): ParsedDesktopReleaseManifest | null {
  if (!hasExactKeys(value, [
    'schema_version', 'document_type', 'release_status', 'version', 'source_commit', 'base_contract_id',
    'schedule_protocol_floor', 'profile_component_aggregate', 'performance', 'github_artifact_provenance', 'artifacts',
    'signature',
  ]) || !isManifestSignature(value.signature)) return null
  const { signature, ...unsigned } = value
  const parsed = parseUnsignedAdmittedDesktopReleaseManifest(unsigned)
  if (parsed === null || !verifyManifestSignature(unsigned, signature, trustedKeys)) return null
  try {
    return {
      ...parsed,
      manifestIdentity: createHash('sha256').update(canonicalJson(value)).digest('hex'),
    }
  } catch {
    return null
  }
}

function parseUnsignedAdmittedDesktopReleaseManifest(value: unknown): ParsedDesktopReleaseManifest | null {
  if (!hasExactKeys(value, [
    'schema_version', 'document_type', 'release_status', 'version', 'source_commit', 'base_contract_id',
    'schedule_protocol_floor', 'profile_component_aggregate', 'performance', 'github_artifact_provenance', 'artifacts',
  ]) || value.schema_version !== 1 || value.document_type !== 'emate.desktop-release-manifest'
    || value.release_status !== 'admitted' || typeof value.version !== 'string'
    || typeof value.source_commit !== 'string' || !SOURCE_COMMIT_PATTERN.test(value.source_commit)
    || typeof value.base_contract_id !== 'string' || !BASE_CONTRACT_ID_PATTERN.test(value.base_contract_id)
    || !isPositiveSafeInteger(value.schedule_protocol_floor)
    || !hasExactKeys(value.artifacts, ['darwin', 'win32'])) return null
  const version = parseCanonicalStableVersion(value.version)
  if (version === null) return null
  if (!isProfileComponentAggregateSummary(value.profile_component_aggregate)
    || !isPerformanceAdmissionSummary(value.performance)
    || !isGithubArtifactProvenance(value.github_artifact_provenance, value.source_commit as string)) return null
  const darwin = parseManifestArtifact('darwin', version.version, value.source_commit as string, value.artifacts.darwin)
  const win32 = parseManifestArtifact('win32', version.version, value.source_commit as string, value.artifacts.win32)
  if (darwin === null || win32 === null) return null
  return {
    version,
    sourceCommit: value.source_commit as string,
    baseContractId: value.base_contract_id,
    scheduleProtocolFloor: value.schedule_protocol_floor,
    manifestIdentity: '',
    artifacts: { darwin, win32 },
  }
}

function isManifestSignature(value: unknown): value is {
  readonly algorithm: 'ed25519'
  readonly key_id: string
  readonly value: string
} {
  return hasExactKeys(value, ['algorithm', 'key_id', 'value'])
    && value.algorithm === 'ed25519'
    && typeof value.key_id === 'string'
    && typeof value.value === 'string'
}

function verifyManifestSignature(
  manifest: Record<string, unknown>,
  signature: { readonly algorithm: 'ed25519', readonly key_id: string, readonly value: string },
  trustedKeys: readonly DesktopReleaseSigningKey[],
): boolean {
  const key = trustedKeys.find(candidate => candidate.id === signature.key_id && candidate.algorithm === 'ed25519')
  const signatureBytes = strictBase64(signature.value)
  const publicKeyBytes = strictBase64(key?.public_key_spki_der_base64)
  if (key === undefined || signatureBytes?.byteLength !== 64 || publicKeyBytes === undefined) return false
  try {
    return verify(
      null,
      Buffer.concat([MANIFEST_SIGNATURE_CONTEXT, Buffer.from(canonicalJson(manifest), 'utf8')]),
      createPublicKey({ key: publicKeyBytes, format: 'der', type: 'spki' }),
      signatureBytes,
    )
  } catch {
    return false
  }
}

function strictBase64(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || value === '') return
  const bytes = Buffer.from(value, 'base64')
  return bytes.toString('base64') === value ? bytes : undefined
}

function parseManifestArtifact(
  platform: DesktopReleasePlatform,
  version: string,
  sourceCommit: string,
  value: unknown,
): DesktopReleaseArtifact | null {
  if (!hasExactKeys(value, ['url', 'bytes', 'sha256', 'build_source_commit', 'build_run_id'])
    || value.build_source_commit !== sourceCommit
    || typeof value.build_run_id !== 'string' || !RUN_ID_PATTERN.test(value.build_run_id)) return null
  const artifact = validateDesktopReleaseArtifact(platform, version, value)
  if (artifact === null) return null
  const releasePrefix = `${DESKTOP_RELEASE_PATH_PREFIX}${encodeURIComponent(version)}/`
  return new URL(artifact.url).pathname.slice(releasePrefix.length).split('/')[0] === sourceCommit ? artifact : null
}

function isProfileComponentAggregateSummary(value: unknown): boolean {
  return hasExactKeys(value, ['aggregate_sha256', 'inventory_sha256', 'staged_profile_tree_sha256', 'targets'])
    && typeof value.aggregate_sha256 === 'string' && SHA256_PATTERN.test(value.aggregate_sha256)
    && typeof value.inventory_sha256 === 'string' && SHA256_PATTERN.test(value.inventory_sha256)
    && typeof value.staged_profile_tree_sha256 === 'string' && SHA256_PATTERN.test(value.staged_profile_tree_sha256)
    && Array.isArray(value.targets)
    && value.targets.length === RELEASE_TARGETS.length
    && value.targets.every((target, index) => hasExactKeys(target, [
      'target', 'profile_generation', 'component_aggregate_sha256',
    ]) && target.target === RELEASE_TARGETS[index]
      && typeof target.profile_generation === 'string' && SHA256_PATTERN.test(target.profile_generation)
      && typeof target.component_aggregate_sha256 === 'string' && SHA256_PATTERN.test(target.component_aggregate_sha256))
}

function isPerformanceAdmissionSummary(value: unknown): boolean {
  return hasExactKeys(value, ['performance_run_id', 'admission_sha256', 'signature_key_id', 'verifier'])
    && typeof value.performance_run_id === 'string'
    && typeof value.admission_sha256 === 'string' && SHA256_PATTERN.test(value.admission_sha256)
    && typeof value.signature_key_id === 'string'
    && isRecord(value.verifier)
}

function isGithubArtifactProvenance(value: unknown, sourceCommit: string): boolean {
  const roles = ['desktop_candidate', 'performance_admission'] as const
  return hasExactKeys(value, ['schema_version', 'document_type', 'source_commit', 'artifacts'])
    && value.schema_version === 1
    && value.document_type === 'emate.github-artifact-provenance'
    && value.source_commit === sourceCommit
    && Array.isArray(value.artifacts)
    && value.artifacts.length === roles.length
    && new Set(value.artifacts.map(artifact => artifact?.artifact_id)).size === roles.length
    && value.artifacts.every((artifact, index) => {
      const role = roles[index]
      const name = role === 'desktop_candidate'
        ? `e-mate-desktop-release-${sourceCommit}`
        : `e-mate-performance-admission-${sourceCommit}-attempt-1`
      return hasExactKeys(artifact, ['role', 'name', 'artifact_id', 'digest', 'run_id', 'run_attempt'])
        && artifact.role === role && artifact.name === name
        && typeof artifact.artifact_id === 'string' && RUN_ID_PATTERN.test(artifact.artifact_id)
        && typeof artifact.digest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(artifact.digest)
        && typeof artifact.run_id === 'string' && RUN_ID_PATTERN.test(artifact.run_id)
        && artifact.run_attempt === 1
    })
}

/** Validate one immutable platform artifact from the public release manifest. */
export function validateDesktopReleaseArtifact(
  platform: DesktopReleasePlatform,
  version: string,
  value: unknown,
): DesktopReleaseArtifact | null {
  if (!isRecord(value)
    || typeof value.url !== 'string'
    || !Number.isSafeInteger(value.bytes)
    || (value.bytes as number) <= 0
    || typeof value.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.sha256)) return null

  let url: URL
  try {
    url = new URL(value.url)
  } catch {
    return null
  }
  const releasePrefix = `${DESKTOP_RELEASE_PATH_PREFIX}${encodeURIComponent(version)}/`
  const expectedFilename = platform === 'darwin'
    ? `e-Mate-${version}-mac-universal.dmg`
    : `e-Mate-${version}-win-x64-Setup.exe`
  const [sourceCommit, filename, extra] = url.pathname.slice(releasePrefix.length).split('/')
  if (url.origin !== DESKTOP_RELEASE_ORIGIN
    || value.url !== url.href
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || !url.pathname.startsWith(releasePrefix)
    || !SOURCE_COMMIT_PATTERN.test(sourceCommit ?? '')
    || filename !== expectedFilename
    || extra !== undefined) return null

  return { url: url.href, bytes: value.bytes as number, sha256: value.sha256 }
}

function parseCanonicalStableVersion(input: string): ParsedSemVer | null {
  const parsed = parseSemVer(input)
  return parsed !== null && parsed.prerelease.length === 0 && parsed.version === input
    ? parsed
    : null
}

function compareParsedSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumeric(left[key], right[key])
    if (comparison !== 0) return comparison
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = isNumeric(leftIdentifier)
    const rightNumeric = isNumeric(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumeric(leftIdentifier, rightIdentifier)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isNumeric(identifier: string): boolean {
  return /^[0-9]+$/u.test(identifier)
}

function hasLeadingZero(identifier: string): boolean {
  return identifier.length > 1 && identifier.startsWith('0')
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function hasExactKeys<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => key in value)
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('manifest contains a non-canonical number')
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  throw new Error('manifest contains an unsupported canonical JSON value')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
