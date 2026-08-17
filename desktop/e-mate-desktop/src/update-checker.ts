/** Headless version checks against the public e-Mate release service. */

/** Public endpoint returning the latest stable e-Mate version. */
export const DESKTOP_VERSION_ENDPOINT = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/latest.json'

/** Maximum response body bytes accepted from the version service. */
export const MAX_VERSION_RESPONSE_BYTES = 16 * 1024

/** Desktop release lanes published by the e-Mate release service. */
export type DesktopReleasePlatform = 'darwin' | 'win32'

/** Immutable installer identity supplied by the signed release manifest. */
export interface DesktopReleaseArtifact {
  readonly url: string
  readonly bytes: number
  readonly sha256: string
}

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
  /** Current desktop release lane used to select one immutable installer. */
  readonly platform: DesktopReleasePlatform
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
  readonly artifact: DesktopReleaseArtifact
}

const DESKTOP_RELEASE_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const DESKTOP_RELEASE_PATH_PREFIX = '/desktop/releases/v'
const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u

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
  if (current === null) return null

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

  const latest = parseVersionResponse(body)
  if (latest === null) return null
  const comparison = compareParsedSemVer(latest.version, current)
  if (comparison <= 0) {
    return {
      status: 'up-to-date',
      currentVersion: current.version,
      latestVersion: latest.version.version,
    }
  }
  const artifact = validateDesktopReleaseArtifact(
    options.platform,
    latest.version.version,
    latest.artifacts[options.platform],
  )
  if (artifact === null) return null
  return {
    status: 'update-available',
    currentVersion: current.version,
    latestVersion: latest.version.version,
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

function parseVersionResponse(body: string): {
  readonly version: ParsedSemVer
  readonly artifacts: Record<string, unknown>
} | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(value) || typeof value.version !== 'string') return null
  const version = parseCanonicalStableVersion(value.version)
  if (version === null) return null
  return {
    version,
    artifacts: isRecord(value.artifacts) ? value.artifacts : {},
  }
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
  const expectedSuffix = platform === 'darwin' ? '.dmg' : '.exe'
  const [sourceCommit, filename, extra] = url.pathname.slice(releasePrefix.length).split('/')
  if (url.origin !== DESKTOP_RELEASE_ORIGIN
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || !url.pathname.startsWith(releasePrefix)
    || !SOURCE_COMMIT_PATTERN.test(sourceCommit ?? '')
    || filename === undefined
    || filename === ''
    || extra !== undefined
    || !filename.endsWith(expectedSuffix)) return null

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
