import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadTargetCredentials } from './target-runtime.js'

export const name = 'emate-credentials-os'
export const LOGGED_OUT_CREDENTIAL = 'E_MATE_CREDENTIAL_LOGGED_OUT_V1'

const KEYCHAIN_SERVICE = 'net.ecoremedia.e-mate.credentials.v1'
const KEYCHAIN_CHUNK_BYTES = 96
const KEYCHAIN_MAX_BYTES = 64 * 1024
const KEYCHAIN_MANIFEST_PREFIX = 'EMATE1:'
const KEYCHAIN_MANIFEST = /^EMATE1:([0-9a-f]{16}):([1-9][0-9]{0,3}):([1-9][0-9]{0,4}):([A-Za-z0-9_-]{43})$/u
const MAX_COMMAND_OUTPUT = 4 * 1024 * 1024
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/u
const MANAGED_IDENTITY_CREDENTIAL_REFS = new Set([
  'E_MATE_ENTERPRISE_SESSION',
  'E_MATE_MODEL_SESSION_TOKEN',
  'E_MATE_MODEL_KEY_GPT',
  'E_MATE_MODEL_KEY_DEEPSEEK',
  'E_MATE_MODEL_KEY_DOUBAO',
  'E_MATE_SEARCH_KEY_DEEPSEEK',
])

function keychainExpectScript(ref: string): string {
  if (!CREDENTIAL_REF.test(ref)) throw new Error('macOS Keychain credential reference is invalid')
  return String.raw`
log_user 0
set timeout 30
if {[gets stdin secret] < 0 || $secret eq ""} { exit 2 }
set account {${ref}}
set service {${KEYCHAIN_SERVICE}}
spawn -noecho /usr/bin/security add-generic-password -U -a $account -s $service -w
expect {
  -exact "password data for new item:" {}
  timeout { exit 124 }
  eof { exit 1 }
}
send -- "$secret\r"
expect {
  -exact "retype password for new item:" {}
  timeout { exit 124 }
  eof { exit 1 }
}
send -- "$secret\r"
expect {
  eof {}
  timeout { exit 124 }
}
set result [wait]
if {[lindex $result 2] != 0} { exit 1 }
exit [lindex $result 3]
`
}
const DPAPI_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$entropy = [Convert]::FromBase64String('ZS1NYXRlIERQSVBJIGNyZWRlbnRpYWxzIHYx')
if ($request.op -eq 'protect') {
  $plain = [Convert]::FromBase64String([string]$request.value_base64)
  $cipher = [System.Security.Cryptography.ProtectedData]::Protect(
    $plain, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($cipher))
} elseif ($request.op -eq 'unprotect') {
  $cipher = [Convert]::FromBase64String([string]$request.value_base64)
  $plain = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $cipher, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($plain))
} elseif ($request.op -eq 'probe') {
  $plain = [Text.Encoding]::UTF8.GetBytes('e-Mate DPAPI probe')
  $cipher = [System.Security.Cryptography.ProtectedData]::Protect(
    $plain, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  $roundtrip = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $cipher, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
  if ([Convert]::ToBase64String($roundtrip) -ne [Convert]::ToBase64String($plain)) { throw 'DPAPI roundtrip failed' }
  [Console]::Out.Write('ok')
} else {
  throw 'unsupported DPAPI operation'
}
`

type CommandResult = { status: number; stdout: string }
type CommandRunner = (file: string, args: readonly string[], input?: string) => Promise<CommandResult>

export interface CredentialBackend {
  readonly source: 'keychain' | 'dpapi'
  get(ref: string): Promise<string | undefined>
  has(ref: string): Promise<boolean>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<boolean>
}

interface EnvironmentEntry {
  value: string
  source: string
}

interface EnvironmentSnapshot {
  getFrom(name: string, sources: readonly string[]): EnvironmentEntry | undefined
}

interface ProviderConfig {
  bindingPath?: string
  backend?: CredentialBackend
}

function runCommand(file: string, args: readonly string[], input = ''): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [...args], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    let length = 0
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      child.kill()
      reject(error)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.byteLength
      if (length > MAX_COMMAND_OUTPUT) {
        fail(new Error('credential helper output exceeded its boundary'))
        return
      }
      chunks.push(chunk)
    })
    child.once('error', () => fail(new Error('credential helper could not be started')))
    child.once('close', code => {
      if (settled) return
      settled = true
      resolve({ status: code ?? -1, stdout: Buffer.concat(chunks, length).toString('utf8') })
    })
    child.stdin.end(input)
  })
}

function canonicalBase64(value: string, label: string): Buffer {
  const normalized = value.trim()
  const decoded = Buffer.from(normalized, 'base64')
  if (normalized === '' || decoded.toString('base64') !== normalized) {
    throw new Error(`${label} returned invalid protected data`)
  }
  return decoded
}

class MacOsKeychainBackend implements CredentialBackend {
  readonly source = 'keychain' as const
  private readonly mutations = new Map<string, Promise<unknown>>()

  constructor(private readonly run: CommandRunner = runCommand) {}

  private async mutate<T>(ref: string, action: () => Promise<T>): Promise<T> {
    const previous = this.mutations.get(ref) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(action)
    this.mutations.set(ref, current)
    try {
      return await current
    } finally {
      if (this.mutations.get(ref) === current) this.mutations.delete(ref)
    }
  }

  private async find(ref: string, reveal: boolean): Promise<CommandResult | undefined> {
    const result = await this.run('/usr/bin/security', [
      'find-generic-password', '-a', ref, '-s', KEYCHAIN_SERVICE, ...reveal ? ['-w'] : [],
    ])
    if (result.status === 44) return undefined
    if (result.status !== 0) throw new Error('macOS Keychain operation failed')
    return result
  }

  private async read(ref: string): Promise<Buffer | undefined> {
    const result = await this.find(ref, true)
    return result === undefined ? undefined : canonicalBase64(result.stdout, 'macOS Keychain')
  }

  private async write(ref: string, value: Buffer): Promise<void> {
    const result = await this.run('/usr/bin/expect', [
      '-c', keychainExpectScript(ref),
    ], `${value.toString('base64')}\n`)
    if (result.status !== 0) throw new Error('macOS Keychain operation failed')
  }

  private manifest(value: Buffer, generation = randomUUID().replaceAll('-', '').slice(0, 16)) {
    const chunks = Math.ceil(value.byteLength / KEYCHAIN_CHUNK_BYTES)
    const digest = createHash('sha256').update(value).digest('base64url')
    return { generation, chunks, bytes: value.byteLength, digest }
  }

  private parseManifest(value: Buffer) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(value)
    if (!text.startsWith(KEYCHAIN_MANIFEST_PREFIX)) return undefined
    const match = KEYCHAIN_MANIFEST.exec(text)
    if (match === null) throw new Error('macOS Keychain credential manifest is invalid')
    const chunks = Number(match[2])
    const bytes = Number(match[3])
    if (bytes > KEYCHAIN_MAX_BYTES || chunks !== Math.ceil(bytes / KEYCHAIN_CHUNK_BYTES)) {
      throw new Error('macOS Keychain credential manifest is invalid')
    }
    return { generation: match[1], chunks, bytes, digest: match[4] }
  }

  private manifestValue(value: ReturnType<MacOsKeychainBackend['manifest']>): Buffer {
    return Buffer.from(`${KEYCHAIN_MANIFEST_PREFIX}${value.generation}:${value.chunks}:${value.bytes}:${value.digest}`)
  }

  private chunkRef(ref: string, generation: string, index: number): string {
    return `${ref}_EMATE1_${generation}_${index}`
  }

  private async readChunks(ref: string, manifest: NonNullable<ReturnType<MacOsKeychainBackend['parseManifest']>>) {
    const chunks: Buffer[] = []
    for (let index = 0; index < manifest.chunks; index += 1) {
      const chunk = await this.read(this.chunkRef(ref, manifest.generation, index))
      if (chunk === undefined) throw new Error('macOS Keychain credential generation is incomplete')
      chunks.push(chunk)
    }
    const value = Buffer.concat(chunks)
    if (value.byteLength !== manifest.bytes
      || createHash('sha256').update(value).digest('base64url') !== manifest.digest) {
      throw new Error('macOS Keychain credential integrity check failed')
    }
    return value
  }

  private async deleteGeneration(ref: string, manifest: NonNullable<ReturnType<MacOsKeychainBackend['parseManifest']>>) {
    const failures: unknown[] = []
    for (let index = 0; index < manifest.chunks; index += 1) {
      try { await this.delete(this.chunkRef(ref, manifest.generation, index)) } catch (error) { failures.push(error) }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'macOS Keychain credential generation cleanup failed')
  }

  private async delete(ref: string): Promise<boolean> {
    const result = await this.run('/usr/bin/security', [
      'delete-generic-password', '-a', ref, '-s', KEYCHAIN_SERVICE,
    ])
    if (result.status === 44) return false
    if (result.status !== 0) throw new Error('macOS Keychain operation failed')
    return true
  }

  private async restore(ref: string, previous: Buffer | undefined): Promise<void> {
    if (previous === undefined) await this.delete(ref)
    else await this.write(ref, previous)
  }

  async get(ref: string): Promise<string | undefined> {
    const stored = await this.read(ref)
    if (stored === undefined) return undefined
    const manifest = this.parseManifest(stored)
    const value = manifest === undefined ? stored : await this.readChunks(ref, manifest)
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  }

  async has(ref: string): Promise<boolean> {
    return await this.find(ref, false) !== undefined
  }

  async set(ref: string, value: string): Promise<void> {
    await this.mutate(ref, () => this.setUnlocked(ref, value))
  }

  private async setUnlocked(ref: string, value: string): Promise<void> {
    const bytes = Buffer.from(value, 'utf8')
    if (bytes.byteLength > KEYCHAIN_MAX_BYTES) throw new Error('macOS Keychain credential exceeds its boundary')
    const previous = await this.read(ref)
    const previousManifest = previous === undefined ? undefined : this.parseManifest(previous)
    if (bytes.byteLength <= KEYCHAIN_CHUNK_BYTES
      && !bytes.toString('utf8').startsWith(KEYCHAIN_MANIFEST_PREFIX)) {
      try {
        await this.write(ref, bytes)
        if (!(await this.read(ref))?.equals(bytes)) throw new Error('macOS Keychain credential verification failed')
      } catch (error) {
        await this.restore(ref, previous)
        throw error
      }
      // ponytail: committed value wins; add an orphan index only if Keychain cleanup failures need retry.
      if (previousManifest !== undefined) await this.deleteGeneration(ref, previousManifest).catch(() => undefined)
      return
    }

    const next = this.manifest(bytes)
    const manifestValue = this.manifestValue(next)
    let manifestAttempted = false
    try {
      for (let index = 0; index < next.chunks; index += 1) {
        await this.write(
          this.chunkRef(ref, next.generation, index),
          bytes.subarray(index * KEYCHAIN_CHUNK_BYTES, (index + 1) * KEYCHAIN_CHUNK_BYTES),
        )
      }
      await this.readChunks(ref, next)
      manifestAttempted = true
      await this.write(ref, manifestValue)
      if (!(await this.read(ref))?.equals(manifestValue)) {
        throw new Error('macOS Keychain credential manifest verification failed')
      }
    } catch (error) {
      const failures: unknown[] = [error]
      let restored = !manifestAttempted
      if (manifestAttempted) {
        try {
          await this.restore(ref, previous)
          restored = true
        } catch (rollbackError) {
          failures.push(rollbackError)
        }
      }
      if (restored) {
        try { await this.deleteGeneration(ref, next) } catch (cleanupError) { failures.push(cleanupError) }
      }
      if (failures.length > 1) throw new AggregateError(failures, 'macOS Keychain credential rollback failed')
      throw error
    }
    // ponytail: committed value wins; add an orphan index only if Keychain cleanup failures need retry.
    if (previousManifest !== undefined) await this.deleteGeneration(ref, previousManifest).catch(() => undefined)
  }

  async unset(ref: string): Promise<boolean> {
    return this.mutate(ref, () => this.unsetUnlocked(ref))
  }

  private async unsetUnlocked(ref: string): Promise<boolean> {
    const stored = await this.read(ref)
    if (stored === undefined) return false
    const manifest = this.parseManifest(stored)
    if (!await this.delete(ref)) return false
    if (manifest !== undefined) await this.deleteGeneration(ref, manifest)
    return true
  }
}

class WindowsDpapiBackend implements CredentialBackend {
  readonly source = 'dpapi' as const

  constructor(
    private readonly root: string,
    private readonly run: CommandRunner = runCommand,
  ) {}

  private path(ref: string): string {
    return join(this.root, `${ref}.dpapi`)
  }

  private async exists(ref: string): Promise<boolean> {
    try {
      const metadata = await lstat(this.path(ref))
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('DPAPI credential object is invalid')
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private async dpapi(op: 'protect' | 'unprotect', value: string): Promise<string> {
    const result = await this.run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', DPAPI_SCRIPT,
    ], JSON.stringify({ op, value_base64: value }))
    if (result.status !== 0) throw new Error('Windows DPAPI operation failed')
    return result.stdout.trim()
  }

  async get(ref: string): Promise<string | undefined> {
    if (!await this.exists(ref)) return undefined
    const protectedValue = (await readFile(this.path(ref), 'utf8')).trim()
    canonicalBase64(protectedValue, 'Windows DPAPI store')
    const plaintext = await this.dpapi('unprotect', protectedValue)
    return new TextDecoder('utf-8', { fatal: true }).decode(canonicalBase64(plaintext, 'Windows DPAPI'))
  }

  async has(ref: string): Promise<boolean> {
    return this.exists(ref)
  }

  async set(ref: string, value: string): Promise<void> {
    const protectedValue = await this.dpapi('protect', Buffer.from(value, 'utf8').toString('base64'))
    canonicalBase64(protectedValue, 'Windows DPAPI')
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const temporary = join(this.root, `.${ref}.${process.pid}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, protectedValue, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporary, this.path(ref))
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async unset(ref: string): Promise<boolean> {
    if (!await this.exists(ref)) return false
    await rm(this.path(ref))
    return true
  }
}

export function createOsCredentialBackend(
  platform: NodeJS.Platform,
  dshHome: string,
  run: CommandRunner = runCommand,
): CredentialBackend {
  if (platform === 'darwin') return new MacOsKeychainBackend(run)
  if (platform === 'win32') return new WindowsDpapiBackend(join(dshHome, 'e-mate', 'credentials'), run)
  throw new Error('no supported e-Mate credential backend is available')
}

export class CredentialStore {
  private readonly resolved = new Map<string, string>()

  constructor(
    private readonly environment: EnvironmentSnapshot,
    private readonly backend: CredentialBackend,
  ) {}

  private inherited(ref: string): EnvironmentEntry | undefined {
    if (MANAGED_IDENTITY_CREDENTIAL_REFS.has(ref)) return undefined
    const entry = this.environment.getFrom(ref, ['process'])
    return entry !== undefined && entry.value.length > 0 ? entry : undefined
  }

  private fallback(ref: string): EnvironmentEntry | undefined {
    if (MANAGED_IDENTITY_CREDENTIAL_REFS.has(ref)) return undefined
    const entry = this.environment.getFrom(ref, ['project-env', 'user-env'])
    return entry !== undefined && entry.value.length > 0 ? entry : undefined
  }

  async resolve(ref: string): Promise<{ value: string; source: string } | undefined> {
    const inherited = this.inherited(ref)
    if (inherited !== undefined) return { value: inherited.value, source: 'env' }
    const cached = this.resolved.get(ref)
    if (cached !== undefined) {
      return cached === LOGGED_OUT_CREDENTIAL && MANAGED_IDENTITY_CREDENTIAL_REFS.has(ref)
        ? undefined
        : { value: cached, source: this.backend.source }
    }
    const stored = await this.backend.get(ref)
    if (stored !== undefined && stored.length > 0) {
      this.resolved.set(ref, stored)
      if (stored === LOGGED_OUT_CREDENTIAL && MANAGED_IDENTITY_CREDENTIAL_REFS.has(ref)) return undefined
      return { value: stored, source: this.backend.source }
    }
    const fallback = this.fallback(ref)
    return fallback === undefined ? undefined : { value: fallback.value, source: fallback.source }
  }

  async describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }> {
    if (MANAGED_IDENTITY_CREDENTIAL_REFS.has(ref)) {
      const hit = await this.resolve(ref)
      return hit === undefined
        ? { configured: false, writable: true }
        : { configured: true, source: hit.source, writable: true }
    }
    if (this.inherited(ref) !== undefined) return { configured: true, source: 'env', writable: false }
    if (this.resolved.has(ref)) return { configured: true, source: this.backend.source, writable: true }
    if (await this.backend.has(ref)) return { configured: true, source: this.backend.source, writable: true }
    const fallback = this.fallback(ref)
    return fallback === undefined
      ? { configured: false, writable: true }
      : { configured: true, source: fallback.source, writable: true }
  }

  async set(ref: string, value: string): Promise<void> {
    if (value.length === 0) throw new Error(`e-Mate credentials: an empty value cannot be stored for "${ref}"; use unset`)
    this.assertUnshadowed(ref, 'set')
    if (this.resolved.get(ref) === value) return
    await this.backend.set(ref, value)
    this.resolved.set(ref, value)
  }

  async unset(ref: string): Promise<boolean> {
    this.assertUnshadowed(ref, 'unset')
    const removed = await this.backend.unset(ref)
    this.resolved.delete(ref)
    return removed
  }

  private assertUnshadowed(ref: string, verb: 'set' | 'unset'): void {
    if (this.inherited(ref) !== undefined) {
      throw new Error(`e-Mate credentials: "${ref}" is supplied read-only by the launching environment, so ${verb} would be shadowed`)
    }
  }
}

export async function checkOsCredentialBackend(
  platform: NodeJS.Platform = process.platform,
  run: CommandRunner = runCommand,
): Promise<{ ok: boolean; detail: string }> {
  try {
    if (platform === 'darwin') {
      await Promise.all([
        access('/usr/bin/security', constants.X_OK),
        access('/usr/bin/expect', constants.X_OK),
      ])
      const result = await run('/usr/bin/security', ['default-keychain', '-d', 'user'])
      return result.status === 0 && result.stdout.trim() !== ''
        ? { ok: true, detail: 'macOS Keychain and Expect helper available' }
        : { ok: false, detail: 'macOS Keychain unavailable' }
    }
    if (platform === 'win32') {
      const result = await run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command', DPAPI_SCRIPT,
      ], JSON.stringify({ op: 'probe' }))
      return result.status === 0 && result.stdout === 'ok'
        ? { ok: true, detail: 'Windows CurrentUser DPAPI available' }
        : { ok: false, detail: 'Windows CurrentUser DPAPI unavailable' }
    }
  } catch {}
  return { ok: false, detail: 'unsupported or unavailable credential store platform' }
}

export async function apply(ctx: any, config: ProviderConfig = {}) {
  const bindingPath = config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json')
  const target = await loadTargetCredentials(bindingPath)
  const backend = config.backend ?? createOsCredentialBackend(process.platform, target.binding.dsh_home)
  const store = new CredentialStore(target.launchEnvironmentOf(ctx), backend)
  class OsCredentialProvider extends target.CredentialProvider {
    override resolve(ref: string) {
      return store.resolve(ref)
    }

    override describe(ref: string) {
      return store.describe(ref)
    }

    override async set(ref: string, value: string) {
      await store.set(ref, value)
      this.notifyUpdated(ref)
    }

    override async unset(ref: string) {
      if (await store.unset(ref)) this.notifyUpdated(ref)
    }
  }
  await ctx.plugin(OsCredentialProvider)
}
