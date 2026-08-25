/** Signed desired-state contract for independently published e-Mate Profile components. */

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'

const RELEASE_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const SIGNATURE_CONTEXT = Buffer.from('e-mate-profile-release-v1\0', 'utf8')
const STABLE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u
const SHA40 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const COMPONENT_ID = /^@e-mate\/(?:dsh-client-shell|dsh-plugin-[a-z0-9]+(?:-[a-z0-9]+)*)$/u
const COMPONENT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const BASE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u
const KEY_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u
const HARNESS_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u
const BASE_RUNTIME_PACKAGE = /^(?:@deepseek-ai\/[a-z0-9][a-z0-9._-]*|@e-mate\/desktop\/vision-toolkit|react(?:-dom)?)$/u
const MAX_BASE_CONTRACT_BYTES = 64 * 1024

export interface ProfileSigningKey {
  readonly id: string
  readonly algorithm: 'ed25519'
  readonly public_key_spki_der_base64: string
}

export interface ProfileBaseContract {
  readonly schema_version: 1
  readonly id: string
  readonly desktop_api: number
  readonly profile_format: number
  readonly schedule_protocol_floor: number
  readonly harness_version: string
  readonly harness_commit: string
  readonly runtime_imports: Readonly<Record<string, string>>
  readonly profile_signing_keys: readonly ProfileSigningKey[]
}

export interface ProfileReleaseTarget {
  readonly platform: 'darwin' | 'win32'
  readonly arch: 'arm64' | 'x64'
}

export interface ProfileComponentTarget extends ProfileReleaseTarget {
  readonly runtime_abi: string
  readonly minimum_os: string
  readonly signing: {
    readonly scheme: 'adhoc' | 'unsigned'
    readonly identity: string
  }
  readonly native_paths: readonly string[]
}

export interface ProfileReleaseComponent {
  readonly id: string
  readonly version: string
  readonly kind: 'profile' | 'platform-profile'
  readonly target: ProfileComponentTarget | null
  readonly profile_path: string
  readonly manifest_url: string
  readonly manifest_bytes: number
  readonly manifest_sha256: string
  readonly manifest_source_commit: string
}

export interface ProfileReleasePayload {
  readonly schema_version: 1
  readonly product: 'e-Mate'
  readonly release_version: string
  readonly sequence: number
  readonly source_commit: string
  readonly schedule_protocol_floor: number
  readonly target: ProfileReleaseTarget
  readonly base_contracts: readonly string[]
  readonly harness_contract: {
    readonly version: string
    readonly commit: string
  }
  readonly components: readonly ProfileReleaseComponent[]
}

export interface SignedProfileRelease {
  readonly schema_version: 1
  readonly payload: ProfileReleasePayload
  readonly signature: {
    readonly algorithm: 'ed25519'
    readonly key_id: string
    readonly value: string
  }
}

export type ProfileReleaseSelection = 'update' | 'current' | 'base-required'

/** Return whether a package name is part of the explicitly versioned Base ABI. */
export function isProfileBaseRuntimePackage(name: string): boolean {
  return BASE_RUNTIME_PACKAGE.test(name)
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index])
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('canonical JSON accepts only safe integers')
    return String(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!record(value)) throw new Error('canonical JSON contains an unsupported value')
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

/** Deterministic JSON used as the only signature input. */
export function canonicalProfileJson(value: unknown): string {
  return canonical(value)
}

function signatureBytes(payload: unknown): Buffer {
  return Buffer.concat([SIGNATURE_CONTEXT, Buffer.from(canonicalProfileJson(payload), 'utf8')])
}

function strictBase64(value: unknown): Buffer | undefined {
  if (typeof value !== 'string' || value === '') return
  const bytes = Buffer.from(value, 'base64')
  return bytes.toString('base64') === value ? bytes : undefined
}

/** Parse the immutable Base contract shipped inside the signed Desktop package. */
export function parseProfileBaseContract(value: unknown): ProfileBaseContract | undefined {
  if (!record(value) || !exactKeys(value, [
    'schema_version', 'id', 'desktop_api', 'profile_format', 'desktop_reference',
    'schedule_protocol_floor', 'harness_version', 'harness_commit', 'runtime_imports', 'profile_signing_keys',
  ]) || value.schema_version !== 1 || typeof value.id !== 'string' || !BASE_ID.test(value.id)
    || !Number.isSafeInteger(value.desktop_api) || (value.desktop_api as number) <= 0
    || !Number.isSafeInteger(value.profile_format) || (value.profile_format as number) <= 0
    || !Number.isSafeInteger(value.schedule_protocol_floor) || (value.schedule_protocol_floor as number) <= 0
    || typeof value.harness_version !== 'string' || !HARNESS_VERSION.test(value.harness_version)
    || typeof value.harness_commit !== 'string' || !SHA40.test(value.harness_commit)
    || !record(value.desktop_reference)
    || !exactKeys(value.desktop_reference, [
      'repository', 'commit', 'harness_repository', 'harness_commit', 'harness_version',
    ])
    || typeof value.desktop_reference.repository !== 'string' || value.desktop_reference.repository === ''
    || typeof value.desktop_reference.commit !== 'string' || !SHA40.test(value.desktop_reference.commit)
    || typeof value.desktop_reference.harness_repository !== 'string' || value.desktop_reference.harness_repository === ''
    || typeof value.desktop_reference.harness_commit !== 'string' || !SHA40.test(value.desktop_reference.harness_commit)
    || typeof value.desktop_reference.harness_version !== 'string'
    || !HARNESS_VERSION.test(value.desktop_reference.harness_version)
    || !record(value.runtime_imports)
    || !Array.isArray(value.profile_signing_keys) || value.profile_signing_keys.length === 0) return

  const runtimeImports = Object.entries(value.runtime_imports)
  if (runtimeImports.some(([name, version]) => !isProfileBaseRuntimePackage(name)
    || typeof version !== 'string' || !HARNESS_VERSION.test(version))
    || runtimeImports.some(([name], index) => index > 0 && runtimeImports[index - 1]![0] >= name)) return

  const keys: ProfileSigningKey[] = []
  for (const item of value.profile_signing_keys) {
    if (!record(item) || !exactKeys(item, ['id', 'algorithm', 'public_key_spki_der_base64'])
      || typeof item.id !== 'string' || !KEY_ID.test(item.id) || item.algorithm !== 'ed25519'
      || typeof item.public_key_spki_der_base64 !== 'string') return
    const publicBytes = strictBase64(item.public_key_spki_der_base64)
    if (publicBytes === undefined) return
    try {
      if (createPublicKey({ key: publicBytes, format: 'der', type: 'spki' }).asymmetricKeyType !== 'ed25519') return
    } catch { return }
    keys.push({
      id: item.id,
      algorithm: 'ed25519',
      public_key_spki_der_base64: item.public_key_spki_der_base64,
    })
  }
  if (new Set(keys.map(key => key.id)).size !== keys.length
    || keys.some((key, index) => index > 0 && keys[index - 1]!.id >= key.id)) return
  return {
    schema_version: 1,
    id: value.id,
    desktop_api: value.desktop_api as number,
    profile_format: value.profile_format as number,
    schedule_protocol_floor: value.schedule_protocol_floor as number,
    harness_version: value.harness_version,
    harness_commit: value.harness_commit,
    runtime_imports: Object.fromEntries(runtimeImports) as Record<string, string>,
    profile_signing_keys: keys,
  }
}

/** Load one bounded Base contract without accepting schema drift. */
export function loadProfileBaseContract(path: string): ProfileBaseContract {
  const bytes = readFileSync(path)
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BASE_CONTRACT_BYTES) {
    throw new Error('Desktop Base contract is invalid')
  }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch {
    throw new Error('Desktop Base contract is invalid')
  }
  const base = parseProfileBaseContract(value)
  if (base === undefined) throw new Error('Desktop Base contract is invalid')
  return base
}

function sortedUniqueStrings(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === 'string' && item !== '')
    && new Set(value).size === value.length
    && value.every((item, index) => index === 0 || value[index - 1]! < item)
}

function safeRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && !value.startsWith('/') && !value.includes('\\')
    && !value.includes('\0') && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

function parseReleaseTarget(value: unknown): ProfileReleaseTarget | undefined {
  if (!record(value) || !exactKeys(value, ['platform', 'arch'])
    || !['darwin', 'win32'].includes(value.platform as string)
    || !['arm64', 'x64'].includes(value.arch as string)
    || value.platform === 'win32' && value.arch !== 'x64') return
  return { platform: value.platform as 'darwin' | 'win32', arch: value.arch as 'arm64' | 'x64' }
}

export function parseProfileComponentTarget(value: unknown): ProfileComponentTarget | undefined {
  if (!record(value) || !exactKeys(value, [
    'platform', 'arch', 'runtime_abi', 'minimum_os', 'signing', 'native_paths',
  ])) return
  const releaseTarget = parseReleaseTarget({ platform: value.platform, arch: value.arch })
  const nativePaths = Array.isArray(value.native_paths) ? value.native_paths : undefined
  if (releaseTarget === undefined
    || typeof value.runtime_abi !== 'string' || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(value.runtime_abi)
    || typeof value.minimum_os !== 'string' || !/^[0-9]+\.[0-9]+$/u.test(value.minimum_os)
    || !record(value.signing) || !exactKeys(value.signing, ['scheme', 'identity'])
    || !['adhoc', 'unsigned'].includes(value.signing.scheme as string)
    || typeof value.signing.identity !== 'string' || value.signing.identity === ''
    || releaseTarget.platform === 'darwin' && value.signing.scheme !== 'adhoc'
    || releaseTarget.platform === 'win32' && value.signing.scheme !== 'unsigned'
    || value.signing.scheme === 'adhoc' && value.signing.identity !== 'adhoc'
    || value.signing.scheme === 'unsigned' && value.signing.identity !== 'none'
    || nativePaths === undefined || nativePaths.some(path => !safeRelativePath(path))
    || nativePaths.some((path, index) => index > 0 && nativePaths[index - 1] >= path)
    || value.runtime_abi === 'none' && nativePaths.length !== 0
    || value.runtime_abi !== 'none' && nativePaths.length === 0) return
  return {
    ...releaseTarget,
    runtime_abi: value.runtime_abi,
    minimum_os: value.minimum_os,
    signing: {
      scheme: value.signing.scheme as 'adhoc' | 'unsigned',
      identity: value.signing.identity,
    },
    native_paths: [...nativePaths] as string[],
  }
}

export function sameProfileComponentTarget(
  left: ProfileComponentTarget | null,
  right: ProfileComponentTarget | null,
): boolean {
  return canonicalProfileJson(left) === canonicalProfileJson(right)
}

export function profileReleaseTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): ProfileReleaseTarget {
  const target = parseReleaseTarget({ platform, arch })
  if (target === undefined) throw new Error(`unsupported Profile release target ${platform}-${arch}`)
  return target
}

export function sameProfileReleaseTarget(left: ProfileReleaseTarget, right: ProfileReleaseTarget): boolean {
  return left.platform === right.platform && left.arch === right.arch
}

function expectedProfilePath(id: string): string {
  return id === '@e-mate/dsh-client-shell'
    ? 'node_modules/@deepseek-ai/dsh-client-ui-sidebar'
    : `node_modules/${id}`
}

function componentSlug(id: string): string | undefined {
  const value = id.replace(/^@e-mate\//u, '')
  return COMPONENT_SLUG.test(value) ? value : undefined
}

function validateManifestUrl(component: ProfileReleaseComponent): boolean {
  const slug = componentSlug(component.id)
  if (slug === undefined) return false
  let url: URL
  try { url = new URL(component.manifest_url) } catch { return false }
  const targetPath = component.target === null ? '' : `/${component.target.platform}-${component.target.arch}`
  return url.origin === RELEASE_ORIGIN
    && url.username === ''
    && url.password === ''
    && url.search === ''
    && url.hash === ''
    && url.pathname === `/desktop/profile/components/${slug}/v${component.version}/${component.manifest_source_commit}${targetPath}/manifest.json`
}

function parseComponent(value: unknown, releaseTarget: ProfileReleaseTarget): ProfileReleaseComponent | undefined {
  if (!record(value) || !exactKeys(value, [
    'id', 'version', 'kind', 'target', 'profile_path', 'manifest_url', 'manifest_bytes',
    'manifest_sha256', 'manifest_source_commit',
  ])) return
  const component = value as unknown as ProfileReleaseComponent
  const target = value.target === null ? null : parseProfileComponentTarget(value.target)
  if (typeof component.id !== 'string' || !COMPONENT_ID.test(component.id)
    || typeof component.version !== 'string' || !STABLE_VERSION.test(component.version)
    || !['profile', 'platform-profile'].includes(component.kind)
    || component.kind === 'profile' && value.target !== null
    || component.kind === 'platform-profile' && (target === undefined || target === null
      || !sameProfileReleaseTarget(target, releaseTarget))
    || component.profile_path !== expectedProfilePath(component.id)
    || !Number.isSafeInteger(component.manifest_bytes) || component.manifest_bytes <= 0
    || typeof component.manifest_sha256 !== 'string' || !SHA256.test(component.manifest_sha256)
    || typeof component.manifest_source_commit !== 'string' || !SHA40.test(component.manifest_source_commit)
    || !validateManifestUrl(component)) return
  return { ...component, target: target ?? null }
}

function parsePayload(value: unknown): ProfileReleasePayload | undefined {
  if (!record(value)) return
  const keys = [
    'schema_version', 'product', 'release_version', 'sequence', 'source_commit', 'schedule_protocol_floor',
    'target', 'base_contracts', 'harness_contract', 'components',
  ]
  const legacy = exactKeys(value, keys.filter(key => key !== 'schedule_protocol_floor'))
  if (!legacy && !exactKeys(value, keys)) return
  const scheduleProtocolFloor = legacy ? 0 : value.schedule_protocol_floor
  if (value.schema_version !== 1 || value.product !== 'e-Mate'
    || typeof value.release_version !== 'string' || !STABLE_VERSION.test(value.release_version)
    || !Number.isSafeInteger(value.sequence) || (value.sequence as number) <= 0
    || typeof value.source_commit !== 'string' || !SHA40.test(value.source_commit)
    || !Number.isSafeInteger(scheduleProtocolFloor) || (!legacy && (scheduleProtocolFloor as number) <= 0)
    || !sortedUniqueStrings(value.base_contracts)
    || !record(value.harness_contract)
    || !exactKeys(value.harness_contract, ['version', 'commit'])
    || typeof value.harness_contract.version !== 'string' || value.harness_contract.version === ''
    || typeof value.harness_contract.commit !== 'string' || !SHA40.test(value.harness_contract.commit)
    || !Array.isArray(value.components) || value.components.length === 0) return
  const target = parseReleaseTarget(value.target)
  if (target === undefined) return
  const components = value.components.map(component => parseComponent(component, target))
  if (components.some(component => component === undefined)) return
  const ids = components.map(component => component!.id)
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) return
  return {
    schema_version: 1,
    product: 'e-Mate',
    release_version: value.release_version,
    sequence: value.sequence as number,
    source_commit: value.source_commit,
    // A verified pre-floor release is migration evidence only and can never match a floor-aware Base.
    schedule_protocol_floor: scheduleProtocolFloor as number,
    target,
    base_contracts: [...value.base_contracts],
    harness_contract: {
      version: value.harness_contract.version,
      commit: value.harness_contract.commit,
    },
    components: components as ProfileReleaseComponent[],
  }
}

/** Sign one already validated desired-state payload with the release-only private key. */
export function signProfileRelease(
  payload: ProfileReleasePayload,
  privateKeyPem: string,
  keyId: string,
): SignedProfileRelease {
  const signature = sign(null, signatureBytes(payload), createPrivateKey(privateKeyPem)).toString('base64')
  return {
    schema_version: 1,
    payload,
    signature: { algorithm: 'ed25519', key_id: keyId, value: signature },
  }
}

/** Verify signature, schema, origin, compatibility metadata, ordering, and identities. */
export function verifyProfileRelease(value: unknown, base: ProfileBaseContract): SignedProfileRelease | undefined {
  if (!record(value) || !exactKeys(value, ['schema_version', 'payload', 'signature'])
    || value.schema_version !== 1 || !record(value.signature)) return
  const envelopeSignature = value.signature
  if (!exactKeys(envelopeSignature, ['algorithm', 'key_id', 'value'])
    || envelopeSignature.algorithm !== 'ed25519' || typeof envelopeSignature.key_id !== 'string') return
  const payload = parsePayload(value.payload)
  const signature = strictBase64(envelopeSignature.value)
  const key = base.profile_signing_keys.find(candidate => candidate.id === envelopeSignature.key_id)
  const publicBytes = strictBase64(key?.public_key_spki_der_base64)
  if (payload === undefined || signature?.byteLength !== 64 || key === undefined || publicBytes === undefined) return
  let valid = false
  try {
    valid = verify(
      null,
      signatureBytes(value.payload),
      createPublicKey({ key: publicBytes, format: 'der', type: 'spki' }),
      signature,
    )
  } catch { return }
  if (!valid) return
  return {
    schema_version: 1,
    payload,
    signature: { algorithm: 'ed25519', key_id: key.id, value: signature.toString('base64') },
  }
}

/** Select an update without ever inferring compatibility from SemVer. */
export function selectProfileRelease(
  payload: ProfileReleasePayload,
  installedBase: Pick<ProfileBaseContract, 'id' | 'harness_version' | 'harness_commit' | 'schedule_protocol_floor'>,
  installedSequence: number,
): ProfileReleaseSelection {
  if (!payload.base_contracts.includes(installedBase.id)
    || payload.schedule_protocol_floor !== installedBase.schedule_protocol_floor
    || payload.harness_contract.version !== installedBase.harness_version
    || payload.harness_contract.commit !== installedBase.harness_commit) return 'base-required'
  return payload.sequence > installedSequence ? 'update' : 'current'
}

/** Parse and verify one bounded UTF-8 envelope from the update service. */
export function parseProfileReleaseEnvelope(
  bytes: Uint8Array,
  base: ProfileBaseContract,
  maximumBytes = 1024 * 1024,
): SignedProfileRelease | undefined {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) return
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch { return }
  return verifyProfileRelease(value, base)
}
