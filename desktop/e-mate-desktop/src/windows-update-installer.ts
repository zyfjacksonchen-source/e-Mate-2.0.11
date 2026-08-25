/** Private handshake between the running Windows Base and its assisted NSIS installer. */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  createReadStream,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { lstat, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  compareSemVerVersions,
  parseSemVer,
  validateDesktopReleaseArtifact,
  type DesktopReleaseArtifact,
} from './update-checker.ts'

const APP_ID = 'net.ecoremedia.e-mate'
const DOCUMENT_TYPE = 'emate.windows-update-request'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const SOURCE_COMMIT = /^[0-9a-f]{40}$/u
const BASE_CONTRACT_ID = /^[A-Za-z0-9._-]{1,200}$/u
const SID = /^S-1-(?:[0-9]+-){1,14}[0-9]+$/u
const MAX_JSON_BYTES = 64 * 1024
const READY_TIMEOUT_MS = 60_000
const CONFIRMATION_TIMEOUT_MS = 120_000
const POLL_MS = 100

const REQUEST_KEYS = [
  'schemaVersion', 'documentType', 'appId', 'transactionId', 'token', 'parentPid',
  'ownerSid', 'admission', 'currentVersion', 'targetVersion', 'sourceCommit', 'baseContractId',
  'scheduleProtocolFloor', 'manifestIdentity', 'artifact', 'installerPath',
  'currentExecutable', 'currentExecutableSha256', 'canonicalDirectory', 'transactionRoot',
  'mailboxPath', 'pendingPath', 'createdAt',
] as const
const JOURNAL_KEYS = [
  'schemaVersion', 'documentType', 'phase', 'transactionId', 'token', 'admission', 'currentVersion',
  'targetVersion', 'sourceCommit', 'baseContractId', 'scheduleProtocolFloor',
  'manifestIdentity', 'artifact', 'installMode', 'canonicalDirectory', 'transactionRoot',
  'candidateDirectory', 'lastGoodDirectory', 'failedDirectory', 'candidateExecutable',
  'candidateExecutableSha256', 'updatedAt',
] as const
const CANDIDATE_START_PHASES = [
  'candidate-at-canonical', 'awaiting-ack', 'confirmed', 'confirmed-unknown',
] as const

/** Authority bound to the request before the first canonical-directory rename. */
export type WindowsUpdateAdmission = {
  readonly kind: 'managed-manifest'
  readonly signatureStatus: null
  readonly publisher: null
  readonly certificateThumbprint: null
} | {
  readonly kind: 'manual-installer'
  readonly signatureStatus: 'unsigned'
  readonly publisher: null
  readonly certificateThumbprint: null
} | {
  readonly kind: 'manual-installer'
  readonly signatureStatus: 'valid'
  readonly publisher: string
  readonly certificateThumbprint: string
}

/** Immutable installer bytes; manual admission has no claimed remote URL. */
export interface WindowsUpdateArtifact {
  readonly url: string | null
  readonly bytes: number
  readonly sha256: string
}

/** Durable, complete identity authorized for one physical Base replacement. */
export interface WindowsUpdateRequest {
  readonly schemaVersion: 1
  readonly documentType: typeof DOCUMENT_TYPE
  readonly appId: typeof APP_ID
  readonly transactionId: string
  readonly token: string
  readonly parentPid: number
  readonly ownerSid: string
  readonly admission: WindowsUpdateAdmission
  readonly currentVersion: string
  readonly targetVersion: string
  readonly sourceCommit: string | null
  readonly baseContractId: string
  readonly scheduleProtocolFloor: number
  readonly manifestIdentity: string
  readonly artifact: WindowsUpdateArtifact
  readonly installerPath: string
  readonly currentExecutable: string
  readonly currentExecutableSha256: string
  readonly canonicalDirectory: string
  readonly transactionRoot: string
  readonly mailboxPath: string
  readonly pendingPath: string
  readonly createdAt: string
}

export interface ScheduleWindowsUpdateOptions {
  readonly installerPath: string
  readonly currentExecutable: string
  readonly userDataPath: string
  readonly currentVersion: string
  readonly targetVersion: string
  readonly sourceCommit: string
  readonly baseContractId: string
  readonly scheduleProtocolFloor: number
  readonly manifestIdentity: string
  readonly artifact: DesktopReleaseArtifact
  readonly parentPid?: number
  readonly signal?: AbortSignal
  readonly readyTimeoutMs?: number
}

export interface PreparedWindowsUpdateInstallation {
  readonly request: WindowsUpdateRequest
  /** Let the already-staged Setup cross its first rename only after Cordis disposed. */
  markShutdownReady(): void
}

interface ReadyReceipt {
  readonly schemaVersion: 1
  readonly documentType: 'emate.windows-update-ready'
  readonly transactionId: string
  readonly token: string
  readonly admission: WindowsUpdateAdmission
  readonly targetVersion: string
  readonly sourceCommit: string | null
  readonly baseContractId: string
  readonly scheduleProtocolFloor: number
  readonly manifestIdentity: string
  readonly artifact: WindowsUpdateArtifact
  readonly canonicalDirectory: string
  readonly transactionRoot: string
  readonly setupPid: number
}

export interface WindowsUpdateCandidateSession {
  readonly request: WindowsUpdateRequest
  readonly requestPath: string
  readonly executableSha256: string
}

export interface WindowsUpdateBaseIdentity {
  readonly id: string
  readonly scheduleProtocolFloor: number
}

export interface WindowsUpdateRuntimeAdapter {
  readonly platform: NodeJS.Platform
  readonly ownerSid: () => string
  readonly secureDirectory: (path: string, ownerSid: string) => void
  readonly pendingOwnerIsLive: (request: WindowsUpdateRequest) => boolean
  readonly spawnInstaller: (path: string, args: readonly string[]) => ChildProcess
}

export interface AdmittedWindowsUpdateIdentity {
  readonly sourceCommit: string
  readonly baseContractId: string
  readonly scheduleProtocolFloor: number
  readonly manifestIdentity: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase('en-US') === resolve(right).toLocaleLowerCase('en-US')
}

function stableVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = parseSemVer(value)
  return parsed !== null && parsed.prerelease.length === 0 && parsed.version === value
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function sameArtifact(left: unknown, right: WindowsUpdateArtifact): boolean {
  return isRecord(left) && exactKeys(left, ['url', 'bytes', 'sha256'])
    && left.url === right.url && left.bytes === right.bytes && left.sha256 === right.sha256
}

function sameAdmission(left: unknown, right: WindowsUpdateAdmission): boolean {
  const parsed = parseAdmission(left)
  return parsed !== undefined
    && parsed.kind === right.kind
    && parsed.signatureStatus === right.signatureStatus
    && parsed.publisher === right.publisher
    && parsed.certificateThumbprint === right.certificateThumbprint
}

function sameCommitIdentityValue(
  key: string,
  actual: unknown,
  expected: unknown,
  request: WindowsUpdateRequest,
): boolean {
  if (key === 'artifact') return sameArtifact(actual, request.artifact)
  if (key === 'admission') return sameAdmission(actual, request.admission)
  return actual === expected
}

function parseAdmission(value: unknown): WindowsUpdateAdmission | undefined {
  if (!isRecord(value) || !exactKeys(value, [
    'kind', 'signatureStatus', 'publisher', 'certificateThumbprint',
  ])) return undefined
  if (value.kind === 'managed-manifest' && value.signatureStatus === null
    && value.publisher === null && value.certificateThumbprint === null) {
    return value as unknown as WindowsUpdateAdmission
  }
  if (value.kind !== 'manual-installer') return undefined
  if (value.signatureStatus === 'unsigned' && value.publisher === null
    && value.certificateThumbprint === null) return value as unknown as WindowsUpdateAdmission
  if (value.signatureStatus === 'valid'
    && typeof value.publisher === 'string' && value.publisher.length > 0 && value.publisher.length <= 512
    && !/[\0\r\n]/u.test(value.publisher)
    && typeof value.certificateThumbprint === 'string'
    && /^[0-9a-f]{40}$/u.test(value.certificateThumbprint)) {
    return value as unknown as WindowsUpdateAdmission
  }
  return undefined
}

function parseIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

/** Parse a request without trusting public `--updated`/`--force-run` switches. */
export function parseWindowsUpdateRequest(value: unknown, requestPath: string, token: string): WindowsUpdateRequest {
  const admission = isRecord(value) ? parseAdmission(value.admission) : undefined
  if (!isRecord(value) || !exactKeys(value, REQUEST_KEYS)
    || value.schemaVersion !== 1 || value.documentType !== DOCUMENT_TYPE || value.appId !== APP_ID
    || typeof value.transactionId !== 'string' || !UUID_V4.test(value.transactionId)
    || typeof value.token !== 'string' || !UUID_V4.test(value.token) || value.token !== token
    || !positiveSafeInteger(value.parentPid) || typeof value.ownerSid !== 'string' || !SID.test(value.ownerSid)
    || admission === undefined
    || !stableVersion(value.currentVersion) || !stableVersion(value.targetVersion)
    || (compareSemVerVersions(value.targetVersion, value.currentVersion) ?? 0) <= 0
    || !(value.sourceCommit === null || typeof value.sourceCommit === 'string' && SOURCE_COMMIT.test(value.sourceCommit))
    || typeof value.baseContractId !== 'string' || !BASE_CONTRACT_ID.test(value.baseContractId)
    || !positiveSafeInteger(value.scheduleProtocolFloor)
    || typeof value.manifestIdentity !== 'string' || !SHA256.test(value.manifestIdentity)
    || !isRecord(value.artifact)
    || !exactKeys(value.artifact, ['url', 'bytes', 'sha256'])
    || !(value.artifact.url === null || typeof value.artifact.url === 'string')
    || !positiveSafeInteger(value.artifact.bytes)
    || typeof value.artifact.sha256 !== 'string' || !SHA256.test(value.artifact.sha256)
    || typeof value.installerPath !== 'string' || typeof value.currentExecutable !== 'string'
    || typeof value.currentExecutableSha256 !== 'string' || !SHA256.test(value.currentExecutableSha256)
    || typeof value.canonicalDirectory !== 'string' || typeof value.transactionRoot !== 'string'
    || typeof value.mailboxPath !== 'string' || typeof value.pendingPath !== 'string'
    || !parseIsoTimestamp(value.createdAt)) {
    throw new Error('Windows update request is invalid')
  }
  const request = value as unknown as WindowsUpdateRequest
  const mailbox = resolve(dirname(requestPath))
  const canonicalParent = resolve(dirname(request.canonicalDirectory))
  const transactionContainer = join(canonicalParent, `.${APP_ID}-update`)
  const managedAdmission = request.admission.kind === 'managed-manifest'
    && request.sourceCommit !== null
    && request.artifact.url !== null
    && validateDesktopReleaseArtifact('win32', request.targetVersion, request.artifact) !== null
    && new URL(request.artifact.url).pathname.includes(`/${request.sourceCommit}/`)
  const manualAdmission = request.admission.kind === 'manual-installer'
    && request.sourceCommit === null
    && request.artifact.url === null
    && request.manifestIdentity === request.artifact.sha256
  if (!sameWindowsPath(requestPath, join(mailbox, 'request.json'))
    || !sameWindowsPath(request.mailboxPath, mailbox)
    || !sameWindowsPath(request.pendingPath, join(dirname(mailbox), 'pending.json'))
    || basename(request.currentExecutable).toLocaleLowerCase('en-US') !== 'e-mate.exe'
    || !sameWindowsPath(request.currentExecutable, join(resolve(request.canonicalDirectory), 'e-Mate.exe'))
    || !sameWindowsPath(request.transactionRoot, join(transactionContainer, request.transactionId))
    || sameWindowsPath(request.transactionRoot, request.canonicalDirectory)
    || inside(resolve(request.canonicalDirectory), resolve(request.transactionRoot))
    || inside(resolve(request.transactionRoot), resolve(request.canonicalDirectory))
    || !managedAdmission && !manualAdmission) {
    throw new Error('Windows update request path or identity is invalid')
  }
  return request
}

/** Refuse to schedule a Base unless the admitted manifest supplied every rollback identity. */
export function admittedWindowsUpdateIdentity(value: unknown): AdmittedWindowsUpdateIdentity {
  if (!isRecord(value)
    || typeof value.sourceCommit !== 'string' || !SOURCE_COMMIT.test(value.sourceCommit)
    || typeof value.baseContractId !== 'string' || !BASE_CONTRACT_ID.test(value.baseContractId)
    || !positiveSafeInteger(value.scheduleProtocolFloor)
    || typeof value.manifestIdentity !== 'string' || !SHA256.test(value.manifestIdentity)) {
    throw new Error('Windows update admitted manifest identity is incomplete')
  }
  return {
    sourceCommit: value.sourceCommit,
    baseContractId: value.baseContractId,
    scheduleProtocolFloor: value.scheduleProtocolFloor,
    manifestIdentity: value.manifestIdentity,
  }
}

function readBoundedJsonSync(path: string): unknown {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > MAX_JSON_BYTES) {
    throw new Error(`Windows update JSON is not a bounded real file: ${path}`)
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path)))
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolveHash, reject) => {
    const stream = createReadStream(path)
    stream.on('data', chunk => { hash.update(chunk) })
    stream.once('error', reject)
    stream.once('end', resolveHash)
  })
  return hash.digest('hex')
}

function durableJsonSync(path: string, value: unknown, exclusive = false): void {
  const parent = dirname(path)
  const data = `${JSON.stringify(value)}\n`
  const temporary = join(parent, `.${basename(path)}.${randomUUID()}.tmp`)
  let descriptor: number | undefined
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    writeFileSync(descriptor, data, 'utf8')
    fsyncSync(descriptor)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
  if (exclusive) {
    try { linkSync(temporary, path) } finally { unlinkSync(temporary) }
  } else {
    renameSync(temporary, path)
  }
  if (process.platform !== 'win32') {
    const parentDescriptor = openSync(parent, constants.O_RDONLY)
    try { fsyncSync(parentDescriptor) } finally { closeSync(parentDescriptor) }
  }
}

function defaultOwnerSid(): string {
  const result = spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.error !== undefined || result.status !== 0) throw result.error ?? new Error('whoami.exe failed')
  const match = /,"(S-1-(?:[0-9]+-){1,14}[0-9]+)"\s*$/u.exec(result.stdout.trim())
  if (match?.[1] === undefined) throw new Error('Windows account SID is unavailable')
  return match[1]
}

function defaultSecureDirectory(path: string, ownerSid: string): void {
  const result = spawnSync('icacls.exe', [
    path,
    '/inheritance:r',
    '/grant:r',
    `*${ownerSid}:(OI)(CI)F`,
    '*S-1-5-18:(OI)(CI)F',
    '*S-1-5-32-544:(OI)(CI)F',
  ], { encoding: 'utf8', windowsHide: true })
  if (result.error !== undefined || result.status !== 0) throw result.error ?? new Error('icacls.exe failed')
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function defaultPendingOwnerIsLive(request: WindowsUpdateRequest): boolean {
  const script = [
    '$p=Get-CimInstance Win32_Process -ErrorAction Stop;',
    `$parent=${String(request.parentPid)};`,
    `$current=${quotePowerShell(request.currentExecutable)};`,
    `$installer=${quotePowerShell(request.installerPath)};`,
    `$token=${quotePowerShell(request.token)};`,
    '$live=$p|Where-Object {',
    '  ($_.ProcessId -eq $parent -and $_.ExecutablePath -ieq $current) -or',
    '  ($_.ExecutablePath -ieq $installer -and $_.CommandLine -like ("*"+$token+"*"))',
    '};',
    'if($live){exit 0}else{exit 1}',
  ].join('')
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { windowsHide: true, stdio: 'ignore' })
  if (result.error !== undefined || (result.status !== 0 && result.status !== 1)) {
    throw result.error ?? new Error('Windows update owner liveness check failed')
  }
  return result.status === 0
}

const defaultAdapter: WindowsUpdateRuntimeAdapter = {
  platform: process.platform,
  ownerSid: defaultOwnerSid,
  secureDirectory: defaultSecureDirectory,
  pendingOwnerIsLive: defaultPendingOwnerIsLive,
  spawnInstaller: (path, args) => spawn(path, [...args], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsHide: false,
  }),
}

/** Reclaim only a pre-Setup pending owner; any physical journal remains Setup-owned. */
export function recoverStaleWindowsUpdatePending(
  mailboxRoot: string,
  adapter: WindowsUpdateRuntimeAdapter = defaultAdapter,
): boolean {
  const pendingPath = join(mailboxRoot, 'pending.json')
  let pending: unknown
  try {
    pending = readBoundedJsonSync(pendingPath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
  if (!isRecord(pending) || !exactKeys(pending, ['schemaVersion', 'requestPath', 'transactionId', 'token'])
    || pending.schemaVersion !== 1 || typeof pending.requestPath !== 'string'
    || typeof pending.transactionId !== 'string' || !UUID_V4.test(pending.transactionId)
    || typeof pending.token !== 'string' || !UUID_V4.test(pending.token)) {
    throw new Error('Windows update pending owner is invalid')
  }
  const request = parseWindowsUpdateRequest(
    readBoundedJsonSync(pending.requestPath),
    pending.requestPath,
    pending.token,
  )
  if (request.transactionId !== pending.transactionId || !sameWindowsPath(request.pendingPath, pendingPath)) {
    throw new Error('Windows update pending owner does not match its request')
  }
  if (adapter.pendingOwnerIsLive(request)) throw new Error('another Windows update transaction is active')
  if (lstatSync(request.transactionRoot, { throwIfNoEntry: false }) !== undefined) {
    throw new Error('a Windows update physical transaction requires Setup recovery')
  }
  const claimedPath = join(mailboxRoot, `pending.reclaim.${randomUUID()}.json`)
  renameSync(pendingPath, claimedPath)
  try {
    if (adapter.pendingOwnerIsLive(request)
      || lstatSync(request.transactionRoot, { throwIfNoEntry: false }) !== undefined) {
      throw new Error('Windows update pending owner became active during recovery')
    }
    rmSync(request.mailboxPath, { recursive: true, force: true })
    rmSync(claimedPath, { force: true })
    return true
  } catch (cause) {
    if (lstatSync(pendingPath, { throwIfNoEntry: false }) === undefined) renameSync(claimedPath, pendingPath)
    throw cause
  }
}

async function realFile(path: string): Promise<string> {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`Windows update path is not a real file: ${path}`)
  return realpath(path)
}

async function realDirectory(path: string): Promise<string> {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`Windows update path is not a real directory: ${path}`)
  return realpath(path)
}

function commitIdentity(request: WindowsUpdateRequest): Record<string, unknown> {
  return {
    transactionId: request.transactionId,
    token: request.token,
    admission: request.admission,
    targetVersion: request.targetVersion,
    sourceCommit: request.sourceCommit,
    baseContractId: request.baseContractId,
    scheduleProtocolFloor: request.scheduleProtocolFloor,
    manifestIdentity: request.manifestIdentity,
    artifact: request.artifact,
    canonicalDirectory: request.canonicalDirectory,
    transactionRoot: request.transactionRoot,
  }
}

function assertReady(value: unknown, request: WindowsUpdateRequest): asserts value is ReadyReceipt {
  const identity = commitIdentity(request)
  if (!isRecord(value) || !exactKeys(value, [
    'schemaVersion', 'documentType', ...Object.keys(identity), 'setupPid',
  ]) || value.schemaVersion !== 1 || value.documentType !== 'emate.windows-update-ready'
    || !positiveSafeInteger(value.setupPid)
    || Object.entries(identity).some(([key, expected]) =>
      !sameCommitIdentityValue(key, value[key], expected, request))) {
    throw new Error('Windows update READY receipt is invalid')
  }
}

function assertCandidateJournal(
  value: unknown,
  request: WindowsUpdateRequest,
): asserts value is Record<(typeof JOURNAL_KEYS)[number], unknown> {
  if (!isRecord(value) || !exactKeys(value, JOURNAL_KEYS)
    || value.schemaVersion !== 1 || value.documentType !== 'emate.windows-update-journal'
    || !CANDIDATE_START_PHASES.includes(value.phase as typeof CANDIDATE_START_PHASES[number])
    || value.currentVersion !== request.currentVersion || value.targetVersion !== request.targetVersion
    || value.installMode !== 'CurrentUser' && value.installMode !== 'all'
    || typeof value.candidateExecutableSha256 !== 'string' || !SHA256.test(value.candidateExecutableSha256)
    || !parseIsoTimestamp(value.updatedAt)
    || Object.entries(commitIdentity(request)).some(([key, expected]) =>
      !sameCommitIdentityValue(key, value[key], expected, request))
    || !sameWindowsPath(String(value.candidateDirectory), join(request.transactionRoot, 'candidate'))
    || !sameWindowsPath(String(value.lastGoodDirectory), join(request.transactionRoot, 'last-good'))
    || !sameWindowsPath(String(value.failedDirectory), join(request.transactionRoot, 'failed'))
    || !sameWindowsPath(String(value.candidateExecutable), join(request.transactionRoot, 'candidate', 'e-Mate.exe'))) {
    throw new Error('Windows update candidate journal is invalid')
  }
}

async function waitForReady(
  request: WindowsUpdateRequest,
  child: ChildProcess,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const readyPath = join(request.mailboxPath, 'ready.json')
  let exited = false
  let childError: Error | undefined
  child.once('exit', () => { exited = true })
  child.once('error', cause => { childError = cause })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    if (childError !== undefined) throw childError
    try {
      const value = readBoundedJsonSync(readyPath)
      assertReady(value, request)
      child.unref()
      return
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
    if (exited) throw new Error('Windows update Setup exited before READY')
    await delay(POLL_MS, undefined, signal === undefined ? undefined : { signal })
  }
  throw new Error('Windows update Setup did not reach READY before timeout')
}

/** Stage one authenticated assisted-NSIS update and wait before allowing the app to exit. */
export async function scheduleWindowsUpdateInstallation(
  options: ScheduleWindowsUpdateOptions,
  adapter: WindowsUpdateRuntimeAdapter = defaultAdapter,
): Promise<PreparedWindowsUpdateInstallation> {
  if (adapter.platform !== 'win32') throw new Error('Windows update scheduling requires win32')
  if (!stableVersion(options.currentVersion) || !stableVersion(options.targetVersion)
    || (compareSemVerVersions(options.targetVersion, options.currentVersion) ?? 0) <= 0
    || !SOURCE_COMMIT.test(options.sourceCommit) || !BASE_CONTRACT_ID.test(options.baseContractId)
    || !positiveSafeInteger(options.scheduleProtocolFloor) || !SHA256.test(options.manifestIdentity)
    || validateDesktopReleaseArtifact('win32', options.targetVersion, options.artifact) === null) {
    throw new Error('Windows update identity is invalid')
  }
  const installerPath = await realFile(options.installerPath)
  const currentExecutable = await realFile(options.currentExecutable)
  const canonicalDirectory = await realDirectory(dirname(currentExecutable))
  const installerMetadata = await stat(installerPath)
  if (installerMetadata.size !== options.artifact.bytes
    || await sha256File(installerPath) !== options.artifact.sha256) {
    throw new Error('Windows update installer hash or size changed after download')
  }
  const transactionId = randomUUID()
  const token = randomUUID()
  const ownerSid = adapter.ownerSid()
  if (!SID.test(ownerSid)) throw new Error('Windows update owner SID is invalid')
  const mailboxRootCandidate = join(await realDirectory(options.userDataPath), 'updates', 'windows-base')
  mkdirSync(mailboxRootCandidate, { recursive: true, mode: 0o700 })
  const mailboxRoot = await realDirectory(mailboxRootCandidate)
  adapter.secureDirectory(mailboxRoot, ownerSid)
  recoverStaleWindowsUpdatePending(mailboxRoot, adapter)
  const mailboxPath = join(mailboxRoot, transactionId)
  mkdirSync(mailboxPath, { mode: 0o700 })
  adapter.secureDirectory(mailboxPath, ownerSid)
  const pendingPath = join(mailboxRoot, 'pending.json')
  const requestPath = join(mailboxPath, 'request.json')
  const request: WindowsUpdateRequest = {
    schemaVersion: 1,
    documentType: DOCUMENT_TYPE,
    appId: APP_ID,
    transactionId,
    token,
    parentPid: options.parentPid ?? process.pid,
    ownerSid,
    admission: {
      kind: 'managed-manifest',
      signatureStatus: null,
      publisher: null,
      certificateThumbprint: null,
    },
    currentVersion: options.currentVersion,
    targetVersion: options.targetVersion,
    sourceCommit: options.sourceCommit,
    baseContractId: options.baseContractId,
    scheduleProtocolFloor: options.scheduleProtocolFloor,
    manifestIdentity: options.manifestIdentity,
    artifact: options.artifact,
    installerPath,
    currentExecutable,
    currentExecutableSha256: await sha256File(currentExecutable),
    canonicalDirectory,
    transactionRoot: join(dirname(canonicalDirectory), `.${APP_ID}-update`, transactionId),
    mailboxPath,
    pendingPath,
    createdAt: new Date().toISOString(),
  }
  parseWindowsUpdateRequest(request, requestPath, token)
  let pendingCreated = false
  let installerSpawned = false
  try {
    durableJsonSync(requestPath, request, true)
    durableJsonSync(pendingPath, { schemaVersion: 1, requestPath, transactionId, token }, true)
    pendingCreated = true
    const child = adapter.spawnInstaller(installerPath, [
      '/S', '--updated', '--force-run',
      `--emate-update-request=${requestPath}`,
      `--emate-update-token=${token}`,
    ])
    installerSpawned = true
    await waitForReady(request, child, options.readyTimeoutMs ?? READY_TIMEOUT_MS, options.signal)
  } catch (cause) {
    if (!installerSpawned) {
      if (pendingCreated) rmSync(pendingPath, { force: true })
      rmSync(mailboxPath, { recursive: true, force: true })
    }
    throw cause
  }
  return {
    request,
    markShutdownReady: () => {
      durableJsonSync(join(mailboxPath, 'shutdown.json'), {
        schemaVersion: 1,
        documentType: 'emate.windows-update-shutdown',
        ...commitIdentity(request),
        parentPid: request.parentPid,
      }, true)
    },
  }
}

function privateArgument(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const values = argv.filter(value => value.startsWith(prefix)).map(value => value.slice(prefix.length))
  if (values.length > 1 || values.some(value => value === '')) throw new Error(`duplicate or empty --${name}`)
  return values[0]
}

/** Bind an updated process to the exact journal before normal startup is allowed to continue. */
export async function beginWindowsUpdateCandidateStartup(options: {
  readonly platform?: NodeJS.Platform
  readonly argv?: readonly string[]
  readonly currentExecutable?: string
  readonly currentVersion?: string
} = {}): Promise<WindowsUpdateCandidateSession | undefined> {
  const requestPath = privateArgument(options.argv ?? process.argv, 'emate-update-request')
  const token = privateArgument(options.argv ?? process.argv, 'emate-update-token')
  if (requestPath === undefined && token === undefined) return undefined
  if ((options.platform ?? process.platform) !== 'win32' || requestPath === undefined || token === undefined) {
    throw new Error('incomplete Windows update candidate identity')
  }
  const request = parseWindowsUpdateRequest(readBoundedJsonSync(requestPath), requestPath, token)
  const currentExecutable = realpathSync(options.currentExecutable ?? process.execPath)
  const currentVersion = options.currentVersion ?? process.env.npm_package_version
  const executableMetadata = lstatSync(currentExecutable)
  if (!executableMetadata.isFile() || executableMetadata.isSymbolicLink()
    || !sameWindowsPath(dirname(currentExecutable), request.canonicalDirectory)
    || currentVersion !== request.targetVersion) {
    throw new Error('Windows update candidate path or version is invalid')
  }
  const journal = readBoundedJsonSync(join(request.transactionRoot, 'journal.json'))
  assertCandidateJournal(journal, request)
  const executableSha256 = await sha256File(currentExecutable)
  if (executableSha256 !== journal.candidateExecutableSha256) {
    throw new Error('Windows update candidate executable hash is invalid')
  }
  durableJsonSync(join(request.mailboxPath, 'started.json'), {
    schemaVersion: 1,
    documentType: 'emate.windows-update-started',
    ...commitIdentity(request),
    pid: process.pid,
    executable: currentExecutable,
    executableSha256,
    startedAt: new Date().toISOString(),
  }, true)
  return { request, requestPath, executableSha256 }
}

function assertConfirmation(value: unknown, request: WindowsUpdateRequest): void {
  const identity = commitIdentity(request)
  if (!isRecord(value) || !exactKeys(value, [
    'schemaVersion', 'documentType', ...Object.keys(identity), 'confirmedAt',
  ]) || value.schemaVersion !== 1 || value.documentType !== 'emate.windows-update-confirmed'
    || !parseIsoTimestamp(value.confirmedAt)
    || Object.entries(identity).some(([key, expected]) =>
      !sameCommitIdentityValue(key, value[key], expected, request))) {
    throw new Error('Windows update confirmation is invalid')
  }
}

/** ACK only after renderer health, then require Setup confirmation before recording APPLIED. */
export async function completeWindowsUpdateCandidateStartup(
  session: WindowsUpdateCandidateSession | undefined,
  base: WindowsUpdateBaseIdentity,
  timeoutMs: number = CONFIRMATION_TIMEOUT_MS,
): Promise<void> {
  if (session === undefined) return
  const { request } = session
  if (base.id !== request.baseContractId || base.scheduleProtocolFloor !== request.scheduleProtocolFloor) {
    throw new Error('Windows update candidate Base identity is invalid')
  }
  durableJsonSync(join(request.mailboxPath, 'ack.json'), {
    schemaVersion: 1,
    documentType: 'emate.windows-update-ack',
    ...commitIdentity(request),
    pid: process.pid,
    executableSha256: session.executableSha256,
    acknowledgedAt: new Date().toISOString(),
  }, true)
  const confirmationPath = join(request.mailboxPath, 'confirmation.json')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const confirmation = readBoundedJsonSync(confirmationPath)
      assertConfirmation(confirmation, request)
      durableJsonSync(join(request.mailboxPath, 'applied.json'), {
        schemaVersion: 1,
        documentType: 'emate.windows-update-applied',
        ...commitIdentity(request),
        pid: process.pid,
        executableSha256: session.executableSha256,
        appliedAt: new Date().toISOString(),
      }, true)
      return
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
    await delay(POLL_MS)
  }
  throw new Error('Windows update confirmation timed out')
}
