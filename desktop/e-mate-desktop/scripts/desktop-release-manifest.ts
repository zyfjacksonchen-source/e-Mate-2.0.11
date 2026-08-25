/** Build the immutable desktop artifact manifest consumed by e-Mate updates. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadProfileBaseContract } from '../src/profile-release.ts'
import { validateUnsignedAdmittedDesktopReleaseManifest } from '../src/update-checker.ts'

const desktopManifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version?: unknown }
export const DESKTOP_RELEASE_VERSION = desktopManifest.version
if (typeof DESKTOP_RELEASE_VERSION !== 'string'
  || !/^\d+\.\d+\.\d+$/u.test(DESKTOP_RELEASE_VERSION)) {
  throw new Error('desktop release package version must be a stable semantic version')
}
const R2_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const SOURCE_COMMIT = /^[0-9a-f]{40}$/u
const MAX_RELEASE_INPUT_BYTES = 64 * 1024
const baseContract = loadProfileBaseContract(fileURLToPath(new URL('../base-contract.json', import.meta.url)))

export interface DesktopReleaseManifestOptions {
  readonly macArtifact: string
  readonly windowsArtifact: string
  readonly sourceCommit: string
  readonly macSourceCommit: string
  readonly windowsSourceCommit: string
  readonly macBuildRunId: string
  readonly windowsBuildRunId: string
  readonly output: string
}

export interface DesktopReleaseAdmissionOptions {
  readonly candidate: string
  readonly profileComponentAggregate: string
  readonly performance: string
  readonly githubArtifactProvenance: string
  readonly output: string
}

interface ArtifactRecord {
  readonly url: string
  readonly bytes: number
  readonly sha256: string
  readonly build_source_commit: string
  readonly build_run_id: string
}

/** Create one deterministic performance-pending candidate over both native packages. */
export async function createDesktopArtifactCandidate(options: DesktopReleaseManifestOptions): Promise<void> {
  if (!SOURCE_COMMIT.test(options.sourceCommit)) throw new Error('desktop release source commit is invalid')
  for (const commit of [options.macSourceCommit, options.windowsSourceCommit]) {
    if (!SOURCE_COMMIT.test(commit)) throw new Error('desktop artifact source commit is invalid')
  }
  for (const runId of [options.macBuildRunId, options.windowsBuildRunId]) {
    if (!/^[1-9][0-9]*$/u.test(runId)) throw new Error('desktop artifact build run ID is invalid')
  }
  const prefix = `${R2_ORIGIN}/desktop/releases/v${DESKTOP_RELEASE_VERSION}/${options.sourceCommit}`
  const [darwin, win32] = await Promise.all([
    artifact(options.macArtifact, `e-Mate-${DESKTOP_RELEASE_VERSION}-mac-universal.dmg`, prefix, options.macSourceCommit, options.macBuildRunId),
    artifact(options.windowsArtifact, `e-Mate-${DESKTOP_RELEASE_VERSION}-win-x64-Setup.exe`, prefix, options.windowsSourceCommit, options.windowsBuildRunId),
  ])
  await atomicJson(options.output, {
    schema_version: 1,
    document_type: 'emate.desktop-artifact-candidate',
    release_status: 'performance-pending',
    version: DESKTOP_RELEASE_VERSION,
    source_commit: options.sourceCommit,
    schedule_protocol_floor: baseContract.schedule_protocol_floor,
    artifacts: { darwin, win32 },
  })
}

/** Form the exact unsigned 11-field input accepted only by the external signer. */
export async function admitDesktopReleaseManifest(options: DesktopReleaseAdmissionOptions): Promise<void> {
  const candidate = await jsonFile(options.candidate)
  if (!hasExactKeys(candidate, [
    'schema_version', 'document_type', 'release_status', 'version', 'source_commit',
    'schedule_protocol_floor', 'artifacts',
  ]) || candidate.schema_version !== 1 || candidate.document_type !== 'emate.desktop-artifact-candidate'
    || candidate.release_status !== 'performance-pending' || candidate.version !== DESKTOP_RELEASE_VERSION
    || typeof candidate.source_commit !== 'string' || !SOURCE_COMMIT.test(candidate.source_commit)
    || candidate.schedule_protocol_floor !== baseContract.schedule_protocol_floor) {
    throw new Error('desktop artifact candidate identity is invalid')
  }
  const manifest = {
    schema_version: candidate.schema_version,
    document_type: 'emate.desktop-release-manifest',
    release_status: 'admitted',
    version: candidate.version,
    source_commit: candidate.source_commit,
    base_contract_id: baseContract.id,
    schedule_protocol_floor: candidate.schedule_protocol_floor,
    profile_component_aggregate: await jsonFile(options.profileComponentAggregate),
    performance: await jsonFile(options.performance),
    github_artifact_provenance: await jsonFile(options.githubArtifactProvenance),
    artifacts: candidate.artifacts,
  }
  if (!validateUnsignedAdmittedDesktopReleaseManifest(manifest)) {
    throw new Error('desktop admitted release manifest is invalid')
  }
  await atomicJson(options.output, manifest)
}

async function artifact(
  path: string,
  expectedName: string,
  prefix: string,
  sourceCommit: string,
  buildRunId: string,
): Promise<ArtifactRecord> {
  const resolved = resolve(path)
  if (basename(resolved) !== expectedName) throw new Error(`unexpected desktop artifact name: ${basename(resolved)}`)
  const file = await stat(resolved)
  if (!file.isFile() || file.size <= 0 || !Number.isSafeInteger(file.size)) {
    throw new Error(`desktop artifact is not a non-empty regular file: ${resolved}`)
  }
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(resolved)) digest.update(chunk)
  return {
    url: `${prefix}/${expectedName}`,
    bytes: file.size,
    sha256: digest.digest('hex'),
    build_source_commit: sourceCommit,
    build_run_id: buildRunId,
  }
}

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (value === undefined || value.length === 0) throw new Error(`missing ${name}`)
  return value
}

async function jsonFile(path: string): Promise<Record<string, unknown>> {
  const bytes = await readFile(resolve(path))
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RELEASE_INPUT_BYTES) {
    throw new Error(`desktop release input is too large: ${basename(path)}`)
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error(`desktop release input is invalid JSON: ${basename(path)}`)
  }
  if (!isRecord(value)) throw new Error(`desktop release input is not an object: ${basename(path)}`)
  return value
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const output = resolve(path)
  await mkdir(dirname(output), { recursive: true })
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await rename(temporary, output)
}

function hasExactKeys<K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every(key => key in value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2]
  if (command === 'candidate') {
    await createDesktopArtifactCandidate({
      macArtifact: argument('--mac'),
      windowsArtifact: argument('--win'),
      sourceCommit: argument('--commit'),
      macSourceCommit: argument('--mac-commit'),
      windowsSourceCommit: argument('--win-commit'),
      macBuildRunId: argument('--mac-run'),
      windowsBuildRunId: argument('--win-run'),
      output: argument('--out'),
    })
  } else if (command === 'admit') {
    await admitDesktopReleaseManifest({
      candidate: argument('--candidate'),
      profileComponentAggregate: argument('--profile-aggregate'),
      performance: argument('--performance'),
      githubArtifactProvenance: argument('--github-provenance'),
      output: argument('--out'),
    })
  } else {
    throw new Error('desktop release manifest command must be candidate or admit')
  }
}
