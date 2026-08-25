/** Validation and materialization boundary for one signed e-Mate Profile component. */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { Unzip, UnzipInflate } from 'fflate'
import type {
  ProfileBaseContract,
  ProfileComponentTarget,
  ProfileReleaseComponent,
} from './profile-release.ts'
import { parseProfileComponentTarget, sameProfileComponentTarget } from './profile-release.ts'

const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_COMPONENT_BYTES = 512 * 1024 * 1024
const MAX_COMPONENT_FILES = 10_000
const SHA40 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu
const LOCAL_RECEIPT = '.e-mate-component.json'
const LOCAL_MANIFEST = '.e-mate-component-manifest.json'
const MAX_WHEEL_BYTES = 64 * 1024 * 1024
const MAX_WHEEL_FILES = 5_000
const MAX_WHEEL_EXPANDED_BYTES = 256 * 1024 * 1024
const COMPONENT_AUTHORITY_EFFECTS = new Set([
  'browser-control', 'browser-read', 'credentials-read', 'credentials-write', 'desktop-restart',
  'filesystem-read', 'filesystem-write', 'host-plugin-install', 'network-loopback', 'network-remote',
  'os-accessibility', 'os-input-control', 'os-screen-recording', 'persistent-state', 'skill-lifecycle',
  'subprocess',
])
const COMPONENT_AUTHORITY_GUARDS = new Set([
  'atomic-receipt', 'authenticated-identity', 'enterprise-policy', 'explicit-user-action',
  'fixed-catalog', 'fixed-endpoint', 'native-approval', 'native-user-question', 'os-tcc',
  'plugin-settings-grant', 'read-only', 'sandbox-policy', 'session-scope', 'workspace-scope',
])

export interface ProfileComponentFile {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly mode: '0644' | '0755'
}

export interface ProfileComponentAuthorityContract {
  readonly effects: readonly string[]
  readonly guards: readonly string[]
}

export interface ProfileComponentManifest {
  readonly schema_version: 1
  readonly id: string
  readonly slug: string
  readonly version: string
  readonly kind: 'profile' | 'platform-profile'
  readonly target: ProfileComponentTarget | null
  readonly source_commit: string
  readonly base_contracts: readonly string[]
  readonly schedule_protocol_floor: number
  readonly base_imports: readonly string[]
  readonly authority_contract: ProfileComponentAuthorityContract
  readonly harness_contract: {
    readonly version: string
    readonly commit: string
  }
  readonly package_entry: string
  readonly dsh: Record<string, unknown>
  readonly total_bytes: number
  readonly files: readonly ProfileComponentFile[]
}

/** Fetch-compatible request surface shared with Electron net.fetch and tests. */
export type ProfileComponentRequest = (url: string, init: RequestInit) => Promise<Response>

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function sortedUniqueStrings(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(item => typeof item === 'string' && item !== '')
    && value.every((item, index) => index === 0 || value[index - 1]! < item)
}

function parseAuthorityContract(value: unknown): ProfileComponentAuthorityContract | undefined {
  if (!record(value) || !exactKeys(value, ['effects', 'guards'])
    || !sortedUniqueStrings(value.effects, true) || !sortedUniqueStrings(value.guards, true)
    || value.effects.some(effect => !COMPONENT_AUTHORITY_EFFECTS.has(effect))
    || value.guards.some(guard => !COMPONENT_AUTHORITY_GUARDS.has(guard))) return
  return { effects: [...value.effects], guards: [...value.guards] }
}

/** Reject traversal plus names that cannot be materialized consistently on macOS and Windows. */
export function safeComponentPath(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > 2048
    || value !== value.normalize('NFC') || value.startsWith('/') || value.includes('\\')
    || /[\0-\x1f\x7f:*?"<>|]/u.test(value)) return false
  const segments = value.split('/')
  return segments.length > 0 && segments.every(segment => segment !== '' && segment !== '.' && segment !== '..'
    && segment.length <= 240 && !segment.endsWith('.') && !segment.endsWith(' ')
    && !WINDOWS_RESERVED.test(segment))
}

function componentSlug(id: string): string {
  return id.replace(/^@e-mate\//u, '')
}

function parseFile(value: unknown): ProfileComponentFile | undefined {
  if (!record(value) || !exactKeys(value, ['path', 'bytes', 'sha256', 'mode'])
    || !safeComponentPath(value.path) || value.path === LOCAL_RECEIPT || value.path === LOCAL_MANIFEST
    || !Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0
    || typeof value.sha256 !== 'string' || !SHA256.test(value.sha256)
    || (value.mode !== '0644' && value.mode !== '0755')) return
  return {
    path: value.path,
    bytes: value.bytes as number,
    sha256: value.sha256,
    mode: value.mode,
  }
}

/** Strictly bind a component manifest to the signed desired-state reference and Base. */
export function parseProfileComponentManifest(
  bytes: Uint8Array,
  reference: ProfileReleaseComponent,
  base: ProfileBaseContract,
): ProfileComponentManifest | undefined {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MANIFEST_BYTES) return
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch { return }
  if (!record(value) || !exactKeys(value, [
    'schema_version', 'id', 'slug', 'version', 'kind', 'target', 'source_commit', 'base_contracts',
    'schedule_protocol_floor',
    'base_imports', 'authority_contract', 'harness_contract', 'package_entry', 'dsh', 'total_bytes', 'files',
  ]) || value.schema_version !== 1
    || value.id !== reference.id || value.slug !== componentSlug(reference.id)
    || value.version !== reference.version || !STABLE_VERSION.test(value.version as string)
    || value.kind !== reference.kind || value.source_commit !== reference.manifest_source_commit
    || typeof value.source_commit !== 'string' || !SHA40.test(value.source_commit)
    || !sortedUniqueStrings(value.base_contracts) || !value.base_contracts.includes(base.id)
    || value.schedule_protocol_floor !== base.schedule_protocol_floor
    || !sortedUniqueStrings(value.base_imports, true)
    || value.base_imports.some(name => !Object.hasOwn(base.runtime_imports, name))
    || parseAuthorityContract(value.authority_contract) === undefined
    || !record(value.harness_contract)
    || !exactKeys(value.harness_contract, ['version', 'commit'])
    || value.harness_contract.version !== base.harness_version
    || value.harness_contract.commit !== base.harness_commit
    || !safeComponentPath(value.package_entry) || !record(value.dsh)
    || !Number.isSafeInteger(value.total_bytes) || (value.total_bytes as number) < 0
    || !Array.isArray(value.files) || value.files.length === 0 || value.files.length > MAX_COMPONENT_FILES) return
  const target = value.target === null ? null : parseProfileComponentTarget(value.target)
  if (target === undefined || !sameProfileComponentTarget(target, reference.target)) return
  const files = value.files.map(parseFile)
  if (files.some(file => file === undefined)) return
  const paths = files.map(file => file!.path)
  const total = files.reduce((sum, file) => sum + file!.bytes, 0)
  if (new Set(paths).size !== paths.length
    || paths.some((path, index) => index > 0 && paths[index - 1]! >= path)
    || !paths.includes('package.json') || !paths.includes(value.package_entry)
    || total !== value.total_bytes || total > MAX_COMPONENT_BYTES) return
  return {
    schema_version: 1,
    id: reference.id,
    slug: componentSlug(reference.id),
    version: reference.version,
    kind: reference.kind,
    target,
    source_commit: reference.manifest_source_commit,
    base_contracts: [...value.base_contracts],
    schedule_protocol_floor: base.schedule_protocol_floor,
    base_imports: [...value.base_imports],
    authority_contract: parseAuthorityContract(value.authority_contract)!,
    harness_contract: { version: base.harness_version, commit: base.harness_commit },
    package_entry: value.package_entry,
    dsh: value.dsh,
    total_bytes: total,
    files: files as ProfileComponentFile[],
  }
}

const execFileAsync = promisify(execFile)
const MACH_O_MAGICS = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'])

async function binaryKind(path: string): Promise<'mach-o' | 'pe' | 'elf' | undefined> {
  const handle = await open(path, 'r')
  try {
    const header = Buffer.alloc(64)
    const bytesRead = (await handle.read(header, 0, header.byteLength, 0)).bytesRead
    if (bytesRead >= 4 && MACH_O_MAGICS.has(header.subarray(0, 4).toString('hex'))) return 'mach-o'
    if (bytesRead >= 4 && header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'elf'
    if (bytesRead < 64 || header[0] !== 0x4d || header[1] !== 0x5a) return
    const offset = header.readUInt32LE(0x3c)
    const metadata = await handle.stat()
    if (offset > metadata.size - 4) return
    const signature = Buffer.alloc(4)
    if ((await handle.read(signature, 0, signature.byteLength, offset)).bytesRead === 4
      && signature.equals(Buffer.from([0x50, 0x45, 0x00, 0x00]))) return 'pe'
  } finally {
    await handle.close()
  }
}

interface WheelBinary {
  readonly path: string
  readonly kind: 'mach-o' | 'pe' | 'elf'
  readonly bytes: Buffer
}

function bufferBinaryKind(bytes: Buffer): 'mach-o' | 'pe' | 'elf' | undefined {
  const magic = bytes.subarray(0, 4).toString('hex')
  if (MACH_O_MAGICS.has(magic)) return 'mach-o'
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'elf'
  if (bytes.length < 64 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return
  const offset = bytes.readUInt32LE(0x3c)
  return offset <= bytes.length - 6 && bytes.subarray(offset, offset + 4).equals(Buffer.from([0x50, 0x45, 0x00, 0x00]))
    ? 'pe'
    : undefined
}

function wheelTargetMatches(filename: string, target: ProfileComponentTarget): boolean {
  if (target.runtime_abi !== 'cpython-3.12') return false
  const suffix = target.platform === 'win32'
    ? '-cp312-cp312-win_amd64.whl'
    : target.arch === 'arm64'
      ? /-cp312-cp312-macosx_[0-9]+_[0-9]+_arm64\.whl$/u
      : /-cp312-cp312-macosx_[0-9]+_[0-9]+_x86_64\.whl$/u
  return typeof suffix === 'string' ? filename.endsWith(suffix) : suffix.test(filename)
}

function wheelBinaryMatchesTarget(bytes: Buffer, target: ProfileComponentTarget): boolean {
  if (target.platform === 'win32') {
    if (bufferBinaryKind(bytes) !== 'pe') return false
    const offset = bytes.readUInt32LE(0x3c)
    return bytes.readUInt16LE(offset + 4) === 0x8664
  }
  const magic = bytes.subarray(0, 4).toString('hex')
  const expected = target.arch === 'arm64' ? 0x0100000c : 0x01000007
  if (magic === 'cafebabe' || magic === 'bebafeca' || magic === 'cafebabf' || magic === 'bfbafeca') {
    const littleEndian = magic === 'bebafeca' || magic === 'bfbafeca'
    const count = littleEndian ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4)
    const entrySize = magic === 'cafebabf' || magic === 'bfbafeca' ? 32 : 20
    if (count < 1 || count > 16 || 8 + count * entrySize > bytes.length) return false
    const cpus = new Set(Array.from({ length: count }, (_, index) => (
      littleEndian ? bytes.readUInt32LE(8 + index * entrySize) : bytes.readUInt32BE(8 + index * entrySize)
    )))
    return cpus.size === 1 && cpus.has(expected)
  }
  if (magic !== 'cffaedfe' && magic !== 'cefaedfe' && magic !== 'feedfacf' && magic !== 'feedface') return false
  const littleEndian = magic === 'cffaedfe' || magic === 'cefaedfe'
  return (littleEndian ? bytes.readUInt32LE(4) : bytes.readUInt32BE(4)) === expected
}

async function wheelBinaries(path: string, target: ProfileComponentTarget): Promise<WheelBinary[]> {
  const archive = await readFile(path)
  if (archive.byteLength === 0 || archive.byteLength > MAX_WHEEL_BYTES
    || !wheelTargetMatches(basename(path), target)) {
    throw new Error('component wheel target contract is invalid')
  }
  const binaries: WheelBinary[] = []
  const names = new Set<string>()
  let entries = 0
  let expanded = 0
  let started = 0
  let completed = 0
  let failure: Error | undefined
  const unzip = new Unzip(file => {
    if (failure !== undefined) return
    const name = file.name.endsWith('/') ? file.name.slice(0, -1) : file.name
    entries += 1
    if (name === '' || !safeComponentPath(name) || names.has(name)
      || entries > MAX_WHEEL_FILES || file.originalSize === undefined
      || !Number.isSafeInteger(file.originalSize) || file.originalSize < 0) {
      failure = new Error('component wheel archive contract is invalid')
      return
    }
    names.add(name)
    expanded += file.originalSize
    if (expanded > MAX_WHEEL_EXPANDED_BYTES) {
      failure = new Error('component wheel expanded size is invalid')
      return
    }
    if (file.name.endsWith('/')) return
    started += 1
    const chunks: Uint8Array[] = []
    let length = 0
    file.ondata = (error, chunk, final) => {
      if (failure !== undefined) return
      if (error !== null) {
        failure = error
        return
      }
      length += chunk.byteLength
      if (length > file.originalSize!) {
        failure = new Error('component wheel entry length is invalid')
        return
      }
      chunks.push(chunk)
      if (!final) return
      completed += 1
      if (length !== file.originalSize) {
        failure = new Error('component wheel entry length is invalid')
        return
      }
      const bytes = Buffer.concat(chunks, length)
      const kind = bufferBinaryKind(bytes)
      if (kind !== undefined) binaries.push({ path: file.name, kind, bytes })
    }
    try { file.start() } catch (cause) {
      failure = cause instanceof Error ? cause : new Error(String(cause))
    }
  })
  unzip.register(UnzipInflate)
  try { unzip.push(archive, true) } catch (cause) {
    failure ??= cause instanceof Error ? cause : new Error(String(cause))
  }
  if (failure !== undefined) throw failure
  if (entries === 0 || completed !== started || binaries.length === 0
    || binaries.some(binary => !wheelBinaryMatchesTarget(binary.bytes, target))) {
    throw new Error('component wheel native closure is invalid')
  }
  return binaries
}

async function verifyPlatformTarget(
  directory: string,
  manifest: ProfileComponentManifest,
  platform: NodeJS.Platform,
  arch: string,
): Promise<void> {
  const binaries: Array<{ path: string, kind: 'mach-o' | 'pe' | 'elf', bytes?: Buffer }> = []
  if (manifest.target === null && manifest.files.some(file => file.path.endsWith('.whl'))) {
    throw new Error('portable component contains a platform wheel')
  }
  for (const file of manifest.files) {
    const path = join(directory, ...file.path.split('/'))
    const kind = await binaryKind(path)
    if (kind !== undefined) binaries.push({ path: file.path, kind })
  }
  if (manifest.target === null) {
    if (binaries.length !== 0) throw new Error('portable component contains a native binary')
    return
  }
  if (manifest.target.platform !== platform || manifest.target.arch !== arch) {
    throw new Error('component target does not match this Desktop runtime')
  }
  if (binaries.some(binary => !manifest.target!.native_paths.some(path => (
    binary.path === path || binary.path.startsWith(`${path}/`)
  )))) throw new Error('component native binary escaped its declared closure')
  const nativeFiles = manifest.files.filter(file => manifest.target!.native_paths.some(path => (
    file.path === path || file.path.startsWith(`${path}/`)
  )))
  if (manifest.target.runtime_abi === 'none') {
    if (nativeFiles.length !== 0) throw new Error('component with no native runtime contains native files')
    return
  }
  if (nativeFiles.length === 0) throw new Error('platform component native closure is empty')
  if (manifest.target.runtime_abi === 'cpython-3.12') {
    if (nativeFiles.some(file => !file.path.endsWith('.whl'))) {
      throw new Error('CPython component native closure must contain only wheels')
    }
    for (const file of nativeFiles) {
      const archivePath = join(directory, ...file.path.split('/'))
      for (const binary of await wheelBinaries(archivePath, manifest.target)) {
        binaries.push({ path: `${file.path}!/${binary.path}`, kind: binary.kind, bytes: binary.bytes })
      }
    }
  }
  if (platform === 'darwin') {
    const machO = binaries.filter(binary => binary.kind === 'mach-o')
    if (manifest.target.signing.scheme !== 'adhoc' || machO.length === 0 || machO.length !== binaries.length) {
      throw new Error('macOS component native signing contract is invalid')
    }
    const extracted = machO.some(binary => binary.bytes !== undefined)
      ? await mkdtemp(join(tmpdir(), 'e-mate-component-native-'))
      : undefined
    try {
      for (let index = 0; index < machO.length; index += 1) {
        const binary = machO[index]!
        const path = binary.bytes === undefined
          ? join(directory, ...binary.path.split('/'))
          : join(extracted!, `${String(index)}.bin`)
        if (binary.bytes !== undefined) await writeFile(path, binary.bytes, { mode: 0o644, flag: 'wx' })
        await execFileAsync('/usr/bin/codesign', ['--verify', '--strict', path])
        const displayed = await execFileAsync('/usr/bin/codesign', ['-dvv', path])
        if (!/Signature=adhoc/u.test(`${displayed.stdout}\n${displayed.stderr}`)) {
          throw new Error('macOS component native binary is not ad-hoc signed')
        }
      }
    } finally {
      if (extracted !== undefined) await rm(extracted, { recursive: true, force: true })
    }
  } else if (manifest.target.signing.scheme !== 'unsigned' || binaries.length === 0
    || binaries.some(binary => binary.kind !== 'pe')) {
    throw new Error('Windows component native signing contract is invalid')
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function readExactResponse(response: Response, maximumBytes: number): Promise<Buffer> {
  if (response.status !== 200 || response.body === null) throw new Error('component object request failed')
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared)
    || BigInt(declared) > BigInt(maximumBytes))) throw new Error('component object length is invalid')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('component object is too large')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, length)
}

function componentFileUrl(manifestUrl: string, path: string): string {
  const base = new URL('.', manifestUrl)
  const encoded = path.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const url = new URL(`files/${encoded}`, base)
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}files/`)) {
    throw new Error('component file URL escaped its immutable prefix')
  }
  return url.href
}

/** Fetch and verify only one immutable manifest so update UI can show the exact payload size. */
export async function fetchProfileComponentManifest(options: {
  readonly reference: ProfileReleaseComponent
  readonly base: ProfileBaseContract
  readonly request: ProfileComponentRequest
  readonly signal?: AbortSignal
}): Promise<ProfileComponentManifest> {
  const init: RequestInit = {
    method: 'GET', cache: 'no-store', redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const bytes = await readExactResponse(
    await options.request(options.reference.manifest_url, init),
    Math.min(options.reference.manifest_bytes, MAX_MANIFEST_BYTES),
  )
  if (bytes.byteLength !== options.reference.manifest_bytes
    || sha256(bytes) !== options.reference.manifest_sha256) {
    throw new Error('component manifest identity does not match the signed release')
  }
  const manifest = parseProfileComponentManifest(bytes, options.reference, options.base)
  if (manifest === undefined) throw new Error('component manifest contract is invalid')
  return manifest
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!record(value)) throw new Error('unsupported package contract value')
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

async function verifyPackageContract(
  directory: string,
  manifest: ProfileComponentManifest,
  base: ProfileBaseContract,
): Promise<void> {
  let value: unknown
  try { value = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) } catch { throw new Error('component package.json is invalid') }
  if (!record(value) || value.name !== manifest.id || value.version !== manifest.version
    || value.license !== 'MIT' || value.main !== manifest.package_entry
    || !record(value.dsh) || canonical(value.dsh) !== canonical(manifest.dsh)
    || !record(value.eMate) || !record(value.eMate.component)
    || !exactKeys(value.eMate.component, [
      'schema_version', 'id', 'kind', 'base_imports', 'authority_contract', 'base_contracts',
    ])
    || value.eMate.component.schema_version !== 1
    || value.eMate.component.id !== manifest.id
    || value.eMate.component.kind !== manifest.kind
    || canonical(value.eMate.component.base_contracts) !== canonical(manifest.base_contracts)
    || canonical(value.eMate.component.base_imports) !== canonical(manifest.base_imports)
    || canonical(value.eMate.component.authority_contract) !== canonical(manifest.authority_contract)
    || !manifest.base_contracts.includes(base.id)) {
    throw new Error('component package contract does not match its verified manifest')
  }
}

async function materializedFiles(root: string, directory: string = root): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const metadata = await lstat(path)
    if (metadata.isSymbolicLink()) throw new Error('materialized component contains a symbolic link')
    if (metadata.isDirectory()) files.push(...await materializedFiles(root, path))
    else if (metadata.isFile()) files.push(relative(root, path).split(sep).join('/'))
    else throw new Error('materialized component contains a special file')
  }
  return files.sort()
}

/** Re-verify a cached component before it can enter a new Profile generation. */
export async function verifyMaterializedProfileComponent(options: {
  readonly directory: string
  readonly reference: ProfileReleaseComponent
  readonly base: ProfileBaseContract
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}): Promise<ProfileComponentManifest> {
  const rootMetadata = await lstat(options.directory)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('materialized component root is not a real directory')
  }
  let receipt: unknown
  try {
    const bytes = await readFile(join(options.directory, LOCAL_RECEIPT))
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_MANIFEST_BYTES) throw new Error()
    receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new Error('materialized component receipt is invalid')
  }
  if (!record(receipt) || !exactKeys(receipt, ['schema_version', 'reference'])
    || receipt.schema_version !== 1 || canonical(receipt.reference) !== canonical(options.reference)) {
    throw new Error('materialized component receipt does not match its release reference')
  }

  const manifestBytes = await readFile(join(options.directory, LOCAL_MANIFEST))
  if (manifestBytes.byteLength !== options.reference.manifest_bytes
    || sha256(manifestBytes) !== options.reference.manifest_sha256) {
    throw new Error('materialized component manifest identity mismatch')
  }
  const manifest = parseProfileComponentManifest(manifestBytes, options.reference, options.base)
  if (manifest === undefined) throw new Error('materialized component manifest contract is invalid')

  const expected = [...manifest.files.map(file => file.path), LOCAL_MANIFEST, LOCAL_RECEIPT].sort()
  const actual = await materializedFiles(options.directory)
  if (canonical(actual) !== canonical(expected)) throw new Error('materialized component file set is not exact')
  for (const file of manifest.files) {
    const path = join(options.directory, ...file.path.split('/'))
    const metadata = await lstat(path)
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== file.bytes
      || sha256(await readFile(path)) !== file.sha256) {
      throw new Error(`materialized component file identity mismatch: ${file.path}`)
    }
    if ((options.platform ?? process.platform) !== 'win32') {
      const executable = (metadata.mode & 0o111) !== 0
      if (executable !== (file.mode === '0755')) {
        throw new Error(`materialized component file mode mismatch: ${file.path}`)
      }
    }
  }
  await verifyPackageContract(options.directory, manifest, options.base)
  await verifyPlatformTarget(options.directory, manifest, options.platform ?? process.platform, options.arch ?? process.arch)
  return manifest
}

/** Download and verify every regular file into a new, inactive component directory. */
export async function materializeProfileComponent(options: {
  readonly destination: string
  readonly reference: ProfileReleaseComponent
  readonly base: ProfileBaseContract
  readonly request: ProfileComponentRequest
  readonly signal?: AbortSignal
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}): Promise<ProfileComponentManifest> {
  const init: RequestInit = {
    method: 'GET', cache: 'no-store', redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const manifestBytes = await readExactResponse(
    await options.request(options.reference.manifest_url, init),
    Math.min(options.reference.manifest_bytes, MAX_MANIFEST_BYTES),
  )
  if (manifestBytes.byteLength !== options.reference.manifest_bytes
    || sha256(manifestBytes) !== options.reference.manifest_sha256) {
    throw new Error('component manifest identity does not match the signed release')
  }
  const manifest = parseProfileComponentManifest(manifestBytes, options.reference, options.base)
  if (manifest === undefined) throw new Error('component manifest contract is invalid')

  await rm(options.destination, { recursive: true, force: true })
  await mkdir(options.destination, { recursive: true, mode: 0o700 })
  try {
    for (const file of manifest.files) {
      options.signal?.throwIfAborted()
      const bytes = await readExactResponse(
        await options.request(componentFileUrl(options.reference.manifest_url, file.path), init),
        file.bytes,
      )
      if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
        throw new Error(`component file identity mismatch: ${file.path}`)
      }
      const destination = join(options.destination, ...file.path.split('/'))
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await writeFile(destination, bytes, { mode: file.mode === '0755' ? 0o755 : 0o644, flag: 'wx' })
      await chmod(destination, file.mode === '0755' ? 0o755 : 0o644)
    }
    await verifyPackageContract(options.destination, manifest, options.base)
    await verifyPlatformTarget(options.destination, manifest, options.platform ?? process.platform, options.arch ?? process.arch)
    await writeFile(join(options.destination, LOCAL_MANIFEST), manifestBytes, { mode: 0o600, flag: 'wx' })
    await writeFile(join(options.destination, LOCAL_RECEIPT), `${JSON.stringify({
      schema_version: 1,
      reference: options.reference,
    }, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    return manifest
  } catch (cause) {
    await rm(options.destination, { recursive: true, force: true })
    throw cause
  }
}
