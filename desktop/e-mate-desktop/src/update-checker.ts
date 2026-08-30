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

/** Stable failure stages returned without exposing untrusted response details. */
export type UpdateCheckFailureCode =
  | 'check-config-invalid'
  | 'check-network-failed'
  | 'check-timeout'
  | 'check-cancelled'
  | 'check-http-failed'
  | 'check-response-invalid'
  | 'check-manifest-invalid'
  | 'check-signature-invalid'
  | 'check-artifact-invalid'
  | 'check-protocol-unsupported'

/** Typed outcome returned by the stable version service. */
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
  /** Signed release policy; absent for the admitted v2 compatibility manifest. */
  readonly mandatory?: boolean
  /** Oldest installed Base admitted by the signed release policy. */
  readonly minimumSupportedVersion?: string
} | {
  readonly status: 'failed'
  readonly code: UpdateCheckFailureCode
  readonly retryable: boolean
  readonly httpStatus?: number
}

const DESKTOP_RELEASE_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const DESKTOP_RELEASE_PATH_PREFIX = '/desktop/releases/v'
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const BASE_CONTRACT_ID_PATTERN = /^e-mate-desktop-profile-v[1-9][0-9]*-dsh-[0-9a-f]{12}$/u
const RUN_ID_PATTERN = /^[1-9][0-9]*$/u
const LOCAL_FLOW_RUN_ID_PATTERN = /^\d{8}T\d{6}Z-[0-9a-f]{12}-[0-9a-f]{6}$/u
const RELEASE_TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const
const MANIFEST_SIGNATURE_CONTEXTS = {
  2: Buffer.from('e-mate-desktop-release-manifest-v2\0', 'utf8'),
  3: Buffer.from('e-mate-desktop-release-manifest-v3\0', 'utf8'),
  4: Buffer.from('e-mate-desktop-release-manifest-v4\0', 'utf8'),
} as const

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
 * @returns a comparison or a typed failure stage.
 */
export async function checkForStableUpdate(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult> {
  const current = parseCanonicalStableVersion(options.currentVersion)
  if (current === null || !isPositiveSafeInteger(options.currentScheduleProtocolFloor)) {
    return failedCheck('check-config-invalid')
  }

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
  } catch (cause) {
    return failedCheck(options.signal?.aborted || isAbortError(cause) ? 'check-cancelled' : 'check-network-failed')
  }
  if (response.status !== 200) return failedCheck('check-http-failed', response.status)

  let body: string
  try {
    body = await readLimitedBody(response)
  } catch (cause) {
    return failedCheck(options.signal?.aborted || isAbortError(cause) ? 'check-cancelled' : 'check-response-invalid')
  }

  const latest = parseVersionResponse(body, options.trustedManifestKeys)
  if (latest.status === 'failed') return latest
  if (latest.value.scheduleProtocolFloor < options.currentScheduleProtocolFloor) {
    return failedCheck('check-protocol-unsupported')
  }
  const manifest = latest.value
  const comparison = compareParsedSemVer(manifest.version, current)
  if (comparison <= 0) {
    return {
      status: 'up-to-date',
      currentVersion: current.version,
      latestVersion: manifest.version.version,
    }
  }
  const artifact = manifest.artifacts[options.platform]
  return {
    status: 'update-available',
    currentVersion: current.version,
    latestVersion: manifest.version.version,
    sourceCommit: manifest.sourceCommit,
    baseContractId: manifest.baseContractId,
    scheduleProtocolFloor: manifest.scheduleProtocolFloor,
    manifestIdentity: manifest.manifestIdentity,
    artifact,
    ...(manifest.minimumSupportedVersion === undefined ? {} : {
      mandatory: manifest.mandatory
        || compareParsedSemVer(current, manifest.minimumSupportedVersion) < 0,
      minimumSupportedVersion: manifest.minimumSupportedVersion.version,
    }),
  }
}

/** Whether retrying the same check later can reasonably succeed without changing the installed Base. */
export function isRetryableUpdateCheckFailure(code: UpdateCheckFailureCode): boolean {
  return code === 'check-network-failed'
    || code === 'check-timeout'
    || code === 'check-cancelled'
    || code === 'check-http-failed'
}

function failedCheck<C extends UpdateCheckFailureCode>(
  code: C,
  httpStatus?: number,
): Extract<UpdateCheckResult, { status: 'failed' }> & { readonly code: C } {
  return {
    status: 'failed',
    code,
    retryable: isRetryableUpdateCheckFailure(code),
    ...(httpStatus === undefined ? {} : { httpStatus }),
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
  readonly mandatory?: boolean
  readonly minimumSupportedVersion?: ParsedSemVer
}

type ManifestFailureCode = Extract<UpdateCheckFailureCode,
  'check-response-invalid' | 'check-manifest-invalid' | 'check-signature-invalid' | 'check-artifact-invalid'>

type ManifestParseResult = {
  readonly status: 'ok'
  readonly value: ParsedDesktopReleaseManifest
} | {
  readonly status: 'failed'
  readonly code: ManifestFailureCode
  readonly retryable: boolean
}

function parseVersionResponse(
  body: string,
  trustedKeys: readonly DesktopReleaseSigningKey[],
): ManifestParseResult {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return failedCheck('check-response-invalid')
  }
  return parseAdmittedDesktopReleaseManifest(value, trustedKeys)
}

/** Check the exact public admitted Desktop manifest contract without executing an update. */
export function validateAdmittedDesktopReleaseManifest(
  value: unknown,
  trustedKeys: readonly DesktopReleaseSigningKey[],
): boolean {
  return parseAdmittedDesktopReleaseManifest(value, trustedKeys).status === 'ok'
}

/** Check the unsigned rich payload accepted only at the external signer boundary. */
export function validateUnsignedAdmittedDesktopReleaseManifest(value: unknown): boolean {
  if (parseUnsignedAdmittedDesktopReleaseManifest(value).status === 'failed') return false
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
): ManifestParseResult {
  if (!isRecord(value) || !isManifestSignature(value.signature)
    || (value.schema_version !== 2 && value.schema_version !== 3 && value.schema_version !== 4)) {
    return failedCheck('check-signature-invalid')
  }
  const { signature, ...unsigned } = value
  if (!verifyManifestSignature(unsigned, signature, trustedKeys, value.schema_version)) {
    return failedCheck('check-signature-invalid')
  }
  const parsed = parseUnsignedAdmittedDesktopReleaseManifest(unsigned)
  if (parsed.status === 'failed') return parsed
  try {
    return {
      status: 'ok',
      value: {
        ...parsed.value,
        manifestIdentity: createHash('sha256').update(canonicalJson(value)).digest('hex'),
      },
    }
  } catch {
    return failedCheck('check-manifest-invalid')
  }
}

function parseUnsignedAdmittedDesktopReleaseManifest(value: unknown): ManifestParseResult {
  if (!isRecord(value)
    || (value.schema_version !== 2 && value.schema_version !== 3 && value.schema_version !== 4)) {
    return failedCheck('check-manifest-invalid')
  }
  const provenanceKey = value.schema_version === 4
    ? 'local_publication_provenance'
    : 'github_artifact_provenance'
  const keys = [
    'schema_version', 'document_type', 'release_status', 'version', 'source_commit', 'base_contract_id',
    'schedule_protocol_floor', 'profile_component_aggregate', provenanceKey, 'artifacts',
    ...(value.schema_version === 2 ? [] : ['update_policy']),
  ]
  if (!hasExactKeys(value, keys)) {
    return failedCheck('artifacts' in value ? 'check-manifest-invalid' : 'check-artifact-invalid')
  }
  if (value.document_type !== 'emate.desktop-release-manifest'
    || value.release_status !== 'admitted' || typeof value.version !== 'string'
    || typeof value.source_commit !== 'string' || !SOURCE_COMMIT_PATTERN.test(value.source_commit)
    || typeof value.base_contract_id !== 'string' || !BASE_CONTRACT_ID_PATTERN.test(value.base_contract_id)
    || !isPositiveSafeInteger(value.schedule_protocol_floor)) {
    return failedCheck('check-manifest-invalid')
  }
  const version = parseCanonicalStableVersion(value.version)
  if (version === null) return failedCheck('check-manifest-invalid')
  const policy = value.schema_version === 2 ? undefined : parseUpdatePolicy(value.update_policy, version)
  if (value.schema_version !== 2 && policy === undefined) {
    return failedCheck('check-manifest-invalid')
  }
  if (!isProfileComponentAggregateSummary(value.profile_component_aggregate)) {
    return failedCheck('check-manifest-invalid')
  }
  if (!hasExactKeys(value.artifacts, ['darwin', 'win32'])) {
    return failedCheck('check-artifact-invalid')
  }
  const local = value.schema_version === 4
  const darwin = parseManifestArtifact('darwin', version.version, value.source_commit as string, value.artifacts.darwin, local)
  const win32 = parseManifestArtifact('win32', version.version, value.source_commit as string, value.artifacts.win32, local)
  if (darwin === null || win32 === null) return failedCheck('check-artifact-invalid')
  if (local ? !isLocalPublicationProvenance(value.local_publication_provenance, {
    version: version.version,
    sourceCommit: value.source_commit as string,
    baseContractId: value.base_contract_id,
    profileComponentAggregateSha256:
      (value.profile_component_aggregate as Record<string, unknown>).aggregate_sha256 as string,
    artifacts: { darwin, win32 },
  }) : !isGithubArtifactProvenance(value.github_artifact_provenance, value.source_commit as string)) {
    return failedCheck('check-manifest-invalid')
  }
  return {
    status: 'ok',
    value: {
      version,
      sourceCommit: value.source_commit as string,
      baseContractId: value.base_contract_id,
      scheduleProtocolFloor: value.schedule_protocol_floor,
      manifestIdentity: '',
      artifacts: { darwin, win32 },
      ...(policy === undefined ? {} : policy),
    },
  }
}

function parseUpdatePolicy(
  value: unknown,
  releaseVersion: ParsedSemVer,
): Pick<ParsedDesktopReleaseManifest, 'mandatory' | 'minimumSupportedVersion'> | undefined {
  if (!hasExactKeys(value, ['mandatory', 'minimum_supported_version'])
    || typeof value.mandatory !== 'boolean'
    || typeof value.minimum_supported_version !== 'string') return
  const minimumSupportedVersion = parseCanonicalStableVersion(value.minimum_supported_version)
  if (minimumSupportedVersion === null || compareParsedSemVer(minimumSupportedVersion, releaseVersion) > 0) return
  return { mandatory: value.mandatory, minimumSupportedVersion }
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
  schemaVersion: 2 | 3 | 4,
): boolean {
  const key = trustedKeys.find(candidate => candidate.id === signature.key_id && candidate.algorithm === 'ed25519')
  const signatureBytes = strictBase64(signature.value)
  const publicKeyBytes = strictBase64(key?.public_key_spki_der_base64)
  if (key === undefined || signatureBytes?.byteLength !== 64 || publicKeyBytes === undefined) return false
  try {
    return verify(
      null,
      Buffer.concat([MANIFEST_SIGNATURE_CONTEXTS[schemaVersion], Buffer.from(canonicalJson(manifest), 'utf8')]),
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
  local: boolean = false,
): DesktopReleaseArtifact | null {
  if (local ? !hasExactKeys(value, ['url', 'bytes', 'sha256'])
    : !hasExactKeys(value, ['url', 'bytes', 'sha256', 'build_source_commit', 'build_run_id'])
      || value.build_source_commit !== sourceCommit
      || typeof value.build_run_id !== 'string' || !RUN_ID_PATTERN.test(value.build_run_id)) return null
  const artifact = validateDesktopReleaseArtifact(platform, version, value)
  if (artifact === null) return null
  const releasePrefix = `${DESKTOP_RELEASE_PATH_PREFIX}${encodeURIComponent(version)}/`
  return new URL(artifact.url).pathname.slice(releasePrefix.length).split('/')[0] === sourceCommit ? artifact : null
}

function isLocalPublicationProvenance(
  value: unknown,
  expected: {
    readonly version: string
    readonly sourceCommit: string
    readonly baseContractId: string
    readonly profileComponentAggregateSha256: string
    readonly artifacts: Record<DesktopReleasePlatform, DesktopReleaseArtifact>
  },
): boolean {
  if (!hasExactKeys(value, [
    'schema_version', 'document_type', 'run_id', 'publication_request_sha256',
    'manifest_input_ledger_sha256', 'version', 'source_commit', 'base_contract_id',
    'profile_component_aggregate_sha256', 'artifacts',
  ]) || !hasExactKeys(value.artifacts, ['darwin', 'win32'])) return false
  const artifacts = value.artifacts
  return value.schema_version === 1
    && value.document_type === 'emate.local-publication-provenance'
    && typeof value.run_id === 'string' && LOCAL_FLOW_RUN_ID_PATTERN.test(value.run_id)
    && typeof value.publication_request_sha256 === 'string' && SHA256_PATTERN.test(value.publication_request_sha256)
    && typeof value.manifest_input_ledger_sha256 === 'string' && SHA256_PATTERN.test(value.manifest_input_ledger_sha256)
    && value.version === expected.version
    && value.source_commit === expected.sourceCommit
    && value.base_contract_id === expected.baseContractId
    && value.profile_component_aggregate_sha256 === expected.profileComponentAggregateSha256
    && (['darwin', 'win32'] as const).every(platform => isBoundLocalPublicationArtifact(
      artifacts[platform], expected.artifacts[platform],
    ))
}

function isBoundLocalPublicationArtifact(value: unknown, expected: DesktopReleaseArtifact): boolean {
  return hasExactKeys(value, ['url', 'bytes', 'sha256'])
    && value.url === expected.url && value.bytes === expected.bytes && value.sha256 === expected.sha256
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

function isGithubArtifactProvenance(value: unknown, sourceCommit: string): boolean {
  const roles = ['desktop_candidate'] as const
  return hasExactKeys(value, ['schema_version', 'document_type', 'source_commit', 'artifacts'])
    && value.schema_version === 1
    && value.document_type === 'emate.github-artifact-provenance'
    && value.source_commit === sourceCommit
    && Array.isArray(value.artifacts)
    && value.artifacts.length === roles.length
    && new Set(value.artifacts.map(artifact => artifact?.artifact_id)).size === roles.length
    && value.artifacts.every((artifact, index) => {
      const role = roles[index]
      const name = `e-mate-desktop-release-${sourceCommit}`
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

function isAbortError(value: unknown): boolean {
  return isRecord(value) && value.name === 'AbortError'
}
