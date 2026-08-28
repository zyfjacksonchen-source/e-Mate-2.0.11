/** Sign and notarize one already accepted CI macOS DMG without rebuilding product bytes. */

import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  adaptMacReleaseEnvironment,
  assertMacReleaseReady,
  type MacReleasePreflightResult,
  withoutMacReleaseSecrets,
} from './release-preflight.ts'

const SHA40 = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const POSITIVE_ID = /^[1-9][0-9]*$/u
const TEAM_ID = /^[A-Z0-9]{10}$/u
const NOTARY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const FORBIDDEN_COMMAND = /(?:^|[\s/.:])(?:electron-builder|dist:mac(?:-unsigned-release)?|package-dir|build:harness|publish-r2|wrangler|r2|feed)(?:$|[\s/.:])/iu
const RECEIPT_NAME = 'desktop-macos-signed-receipt.json'
const VERIFICATION_NAME = 'desktop-macos-signed-verification.json'
const COMPUTER_USE_NATIVE_SEGMENTS = [
  'Contents', 'Resources', 'app.asar.unpacked', 'build', 'e-mate-profile', 'bundles',
  'computer-use', 'native', 'macos',
] as const
const COMPUTER_USE_HELPER = 'dsh-computer-use-helper'

interface FileIdentity {
  readonly name: string
  readonly bytes: number
  readonly sha256: string
}

interface BaseContractIdentity {
  readonly id: string
  readonly harness_commit: string
}

interface ArtifactMetadata {
  readonly id?: unknown
  readonly name?: unknown
  readonly expired?: unknown
  readonly size_in_bytes?: unknown
  readonly digest?: unknown
  readonly workflow_run?: { readonly id?: unknown; readonly head_sha?: unknown }
}

interface DesktopCiReceipt {
  readonly schema_version?: unknown
  readonly document_type?: unknown
  readonly platform?: unknown
  readonly source_commit?: unknown
  readonly ci_run_id?: unknown
  readonly base_contract_id?: unknown
  readonly files?: readonly FileIdentity[]
}

interface DesktopRuntimeReceipt {
  readonly schema_version?: unknown
  readonly document_type?: unknown
  readonly platform?: unknown
  readonly source_commit?: unknown
  readonly ci_run_id?: unknown
  readonly base_contract_id?: unknown
  readonly harness_commit?: unknown
  readonly installer?: FileIdentity & { readonly format?: unknown }
}

export interface MacSignerInput {
  readonly sourceCommit: string
  readonly ciRunId: string
  readonly artifactId: string
  readonly version: string
  readonly baseContract: BaseContractIdentity
  readonly artifactMetadata: ArtifactMetadata
  readonly artifactArchive: Omit<FileIdentity, 'name'>
  readonly ciReceipt: DesktopCiReceipt
  readonly ciReceiptFile: FileIdentity
  readonly runtime: DesktopRuntimeReceipt
  readonly runtimeReceiptFile: FileIdentity
  readonly inputDmg: FileIdentity
}

export interface ValidatedMacSignerInput extends MacSignerInput {
  readonly artifactName: string
}

interface AppSignature {
  readonly signature?: string
  readonly authority?: string
  readonly teamId: string | null
}

interface NotaryResult {
  readonly id: string
  readonly status: 'Accepted'
}

interface ExtractedInput {
  readonly appPath: string
  readonly cleanup: () => Promise<void>
}

interface SigningContext {
  readonly keychain?: string
}

interface ComputerUseHelperManifest {
  readonly schemaVersion?: unknown
  readonly helperVersion?: unknown
  readonly sourceSha256?: unknown
  readonly binary?: {
    readonly path?: unknown
    sha256?: unknown
    readonly architectures?: unknown
    readonly minimumMacOS?: unknown
  }
}

export interface ComputerUseHelperSigningOptions {
  readonly appPath: string
  readonly identity: string
  readonly teamId: string
  readonly keychain?: string
  readonly runCodesign: (args: readonly string[]) => void
  readonly inspectSignature: (path: string) => AppSignature
}

export interface MacSignerOperations {
  readonly resetOutput: () => Promise<void>
  readonly extractInput: (input: ValidatedMacSignerInput) => Promise<ExtractedInput>
  readonly inspectInputSignature: (appPath: string) => Promise<AppSignature>
  readonly prepareSigning: (
    preflight: MacReleasePreflightResult,
    environment: NodeJS.ProcessEnv,
    extracted: ExtractedInput,
  ) => Promise<SigningContext>
  readonly signComputerUseHelper: (
    appPath: string,
    preflight: MacReleasePreflightResult,
    signing: SigningContext,
  ) => Promise<string>
  readonly signApp: (
    appPath: string,
    preflight: MacReleasePreflightResult,
    signing: SigningContext,
    computerUseHelper: string,
  ) => Promise<void>
  readonly inspectSignedApp: (appPath: string) => Promise<AppSignature>
  readonly packageDmg: (appPath: string) => Promise<void>
  readonly signDmg: (preflight: MacReleasePreflightResult, signing: SigningContext) => Promise<void>
  readonly notarizeDmg: (preflight: MacReleasePreflightResult) => Promise<NotaryResult>
  readonly stapleDmg: () => Promise<void>
  readonly verifyDmg: () => Promise<void>
  readonly generateBlockmap: () => Promise<void>
  readonly writeEvidence: (facts: {
    readonly input: ValidatedMacSignerInput
    readonly preflight: MacReleasePreflightResult
    readonly teamId: string
    readonly notary: NotaryResult
  }) => Promise<unknown>
}

export interface MacSignerPipelineOptions {
  readonly input: MacSignerInput
  readonly env: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  readonly listCodeSigningIdentities: () => string
  readonly operations: MacSignerOperations
}

function fileIdentity(path: string): FileIdentity {
  const metadata = lstatSync(path)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0) {
    throw new Error(`macOS signer input is not a non-empty regular file: ${basename(path)}`)
  }
  return {
    name: basename(path),
    bytes: metadata.size,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
  }
}

function validFileIdentity(value: FileIdentity | undefined, name?: string): value is FileIdentity {
  return value !== undefined
    && (name === undefined || value.name === name)
    && basename(value.name) === value.name
    && Number.isSafeInteger(value.bytes) && value.bytes > 0
    && SHA256.test(value.sha256)
}

function sameFile(left: FileIdentity | undefined, right: FileIdentity): boolean {
  return validFileIdentity(left) && left.name === right.name
    && left.bytes === right.bytes && left.sha256 === right.sha256
}

/** Close the GitHub artifact, CI receipt, runtime receipt, and DMG byte identities. */
export function validateMacSignerInput(value: MacSignerInput): ValidatedMacSignerInput {
  const expectedArtifact = `e-mate-desktop-macos-${value.sourceCommit}`
  const expectedDmg = `e-Mate-${value.version}-mac-universal.dmg`
  if (!SHA40.test(value.sourceCommit) || !POSITIVE_ID.test(value.ciRunId)
    || !POSITIVE_ID.test(value.artifactId) || !/^\d+\.\d+\.\d+$/u.test(value.version)
    || typeof value.baseContract?.id !== 'string' || value.baseContract.id === ''
    || !SHA40.test(value.baseContract?.harness_commit ?? '')) {
    throw new Error('macOS signer input identity is invalid')
  }
  const artifact = value.artifactMetadata
  if (String(artifact.id) !== value.artifactId || artifact.name !== expectedArtifact
    || artifact.expired !== false || artifact.size_in_bytes !== value.artifactArchive.bytes
    || artifact.digest !== `sha256:${value.artifactArchive.sha256}`
    || String(artifact.workflow_run?.id) !== value.ciRunId
    || artifact.workflow_run?.head_sha !== value.sourceCommit
    || !Number.isSafeInteger(value.artifactArchive.bytes) || value.artifactArchive.bytes <= 0
    || !SHA256.test(value.artifactArchive.sha256)) {
    throw new Error('macOS signer GitHub artifact identity or digest drifted')
  }
  const receipt = value.ciReceipt
  if (receipt.schema_version !== 1 || receipt.document_type !== 'emate.desktop-ci-artifact'
    || receipt.platform !== 'darwin' || receipt.source_commit !== value.sourceCommit
    || receipt.ci_run_id !== value.ciRunId || receipt.base_contract_id !== value.baseContract.id
    || !Array.isArray(receipt.files)
    || !validFileIdentity(value.ciReceiptFile, 'desktop-artifact-receipt.json')) {
    throw new Error('macOS signer CI artifact receipt identity drifted')
  }
  const runtime = value.runtime
  if (runtime.schema_version !== 1 || runtime.document_type !== 'emate.desktop-runtime-verification'
    || runtime.platform !== 'darwin' || runtime.source_commit !== value.sourceCommit
    || runtime.ci_run_id !== value.ciRunId || runtime.base_contract_id !== value.baseContract.id
    || runtime.harness_commit !== value.baseContract.harness_commit
    || runtime.installer?.format !== 'udif' || !sameFile(runtime.installer, value.inputDmg)
    || !validFileIdentity(value.runtimeReceiptFile, 'desktop-runtime-verification.json')
    || !receipt.files.some(file => sameFile(file, value.runtimeReceiptFile))
    || !validFileIdentity(value.inputDmg, expectedDmg)
    || !receipt.files.some(file => sameFile(file, value.inputDmg))) {
    throw new Error('macOS signer runtime or installer receipt drifted')
  }
  return { ...value, artifactName: expectedArtifact }
}

/** Reject any product rebuild or public-write command at the one signer runner. */
export function assertSafeMacSignerCommand(command: string, args: readonly string[]): void {
  if (FORBIDDEN_COMMAND.test([command, ...args].join(' '))) {
    throw new Error('macOS signer command is forbidden because it rebuilds product bytes or writes public state')
  }
}

function teamId(identity: string): string {
  const match = /\(([A-Z0-9]{10})\)$/u.exec(identity)
  if (match === null || !TEAM_ID.test(match[1]!)) throw new Error('Developer ID team identity is invalid')
  return match[1]!
}

/** Fixed high-level signer ordering; every byte mutation happens after credential preflight. */
export async function runMacSignerPipeline(options: MacSignerPipelineOptions): Promise<unknown> {
  const input = validateMacSignerInput(options.input)
  const releaseEnvironment = adaptMacReleaseEnvironment(options.env)
  const preflight = assertMacReleaseReady({
    env: releaseEnvironment,
    platform: options.platform,
    listCodeSigningIdentities: options.listCodeSigningIdentities,
  })
  const expectedTeam = teamId(preflight.identity)

  await options.operations.resetOutput()
  const extracted = await options.operations.extractInput(input)
  try {
    const unsigned = await options.operations.inspectInputSignature(extracted.appPath)
    if (unsigned.signature !== 'adhoc' || unsigned.teamId !== null) {
      throw new Error('accepted CI macOS DMG is not the expected ad-hoc unsigned input')
    }
    const signing = await options.operations.prepareSigning(preflight, releaseEnvironment, extracted)
    const computerUseHelper = await options.operations.signComputerUseHelper(extracted.appPath, preflight, signing)
    await options.operations.signApp(extracted.appPath, preflight, signing, computerUseHelper)
    const signed = await options.operations.inspectSignedApp(extracted.appPath)
    if (signed.authority !== preflight.identity || signed.teamId !== expectedTeam) {
      throw new Error('Developer ID signed application identity drifted')
    }
    await options.operations.packageDmg(extracted.appPath)
    await options.operations.signDmg(preflight, signing)
    const notary = await options.operations.notarizeDmg(preflight)
    if (notary.status !== 'Accepted' || !NOTARY_ID.test(notary.id)) throw new Error('Apple notarization did not accept the DMG')
    await options.operations.stapleDmg()
    await options.operations.verifyDmg()
    await options.operations.generateBlockmap()
    return await options.operations.writeEvidence({ input, preflight, teamId: expectedTeam, notary })
  } finally {
    await extracted.cleanup()
  }
}

function exactOutputSet(directory: string, names: readonly string[]): void {
  const actual = readdirSync(directory).sort()
  const expected = [...names].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('signed macOS artifact output file set drifted')
  }
}

/** Write only measured, non-secret final-byte receipts. */
export async function writeSignedMacEvidence(options: {
  readonly outputDir: string
  readonly outputDmg: string
  readonly outputBlockmap: string
  readonly input: ValidatedMacSignerInput
  readonly preflight: MacReleasePreflightResult
  readonly teamId: string
  readonly notary: NotaryResult
}) {
  exactOutputSet(options.outputDir, [basename(options.outputDmg), basename(options.outputBlockmap)])
  const outputDmg = fileIdentity(options.outputDmg)
  const outputBlockmap = fileIdentity(options.outputBlockmap)
  if (outputDmg.name !== options.input.inputDmg.name || outputDmg.sha256 === options.input.inputDmg.sha256) {
    throw new Error('signed macOS output did not become a distinct exact DMG identity')
  }
  const receipt = {
    schema_version: 1,
    document_type: 'emate.desktop-macos-signed-release',
    source_commit: options.input.sourceCommit,
    ci_run_id: options.input.ciRunId,
    base_contract_id: options.input.baseContract.id,
    harness_commit: options.input.baseContract.harness_commit,
    input: {
      artifact_id: options.input.artifactId,
      artifact_name: options.input.artifactName,
      artifact_api_digest: `sha256:${options.input.artifactArchive.sha256}`,
      artifact_archive_bytes: options.input.artifactArchive.bytes,
      desktop_artifact_receipt: options.input.ciReceiptFile,
      runtime_verification_receipt: options.input.runtimeReceiptFile,
      dmg: options.input.inputDmg,
      signing: 'adhoc',
    },
    output: {
      dmg: outputDmg,
      blockmap: outputBlockmap,
      signing: 'developer-id',
      notarized: true,
    },
    developer_id: {
      identity: options.preflight.identity,
      team_id: options.teamId,
      credential_source: options.preflight.signing,
    },
    notarization: {
      credential_source: options.preflight.notarization,
      submission_id: options.notary.id,
      status: options.notary.status,
    },
  }
  const verification = {
    schema_version: 1,
    document_type: 'emate.desktop-macos-signed-verification',
    source_commit: options.input.sourceCommit,
    ci_run_id: options.input.ciRunId,
    input_dmg_sha256: options.input.inputDmg.sha256,
    output_dmg_sha256: outputDmg.sha256,
    checks: {
      codesign_app: 'passed',
      codesign_dmg: 'passed',
      gatekeeper_app: 'accepted',
      gatekeeper_dmg: 'accepted',
      stapler_dmg: 'valid',
      verify_mac_release: 'passed',
    },
  }
  await writeFile(join(options.outputDir, RECEIPT_NAME), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 })
  await writeFile(join(options.outputDir, VERIFICATION_NAME), `${JSON.stringify(verification, null, 2)}\n`, { mode: 0o644 })
  exactOutputSet(options.outputDir, [outputDmg.name, outputBlockmap.name, RECEIPT_NAME, VERIFICATION_NAME])
  return { receipt, verification }
}

function command(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { readonly stdout: string; readonly stderr: string } {
  assertSafeMacSignerCommand(executable, args)
  const result = spawnSync(executable, args, { encoding: 'utf8', env })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${basename(executable)} failed in the isolated macOS signer`)
  return { stdout: result.stdout, stderr: result.stderr }
}

function signature(path: string, env: NodeJS.ProcessEnv): AppSignature {
  const result = command('codesign', ['-dv', '--verbose=4', path], env)
  const output = `${result.stdout}\n${result.stderr}`
  const signatureValue = /^Signature=(.+)$/mu.exec(output)?.[1]
  const authority = /^Authority=(.+)$/mu.exec(output)?.[1]
  const team = /^TeamIdentifier=(.+)$/mu.exec(output)?.[1]
  return {
    ...(signatureValue === undefined ? {} : { signature: signatureValue }),
    ...(authority === undefined ? {} : { authority }),
    teamId: team === undefined || team === 'not set' ? null : team,
  }
}

interface AppBuilderDependency {
  readonly packageJson: string
  readonly require: NodeRequire
}

function appBuilderDependency(desktopRoot: string): AppBuilderDependency {
  const desktopRequire = createRequire(join(desktopRoot, 'package.json'))
  const electronBuilderPackage = desktopRequire.resolve('electron-builder/package.json')
  const electronBuilderRequire = createRequire(electronBuilderPackage)
  const appBuilderPackage = electronBuilderRequire.resolve('app-builder-lib/package.json')
  return { packageJson: appBuilderPackage, require: createRequire(appBuilderPackage) }
}

function computerUseHelperPaths(appPath: string): { readonly manifest: string; readonly helper: string } {
  if (!isAbsolute(appPath) || resolve(appPath) !== appPath) throw new Error('Computer Use helper app path is not absolute')
  let directory = appPath
  for (const segment of COMPUTER_USE_NATIVE_SEGMENTS) {
    const metadata = lstatSync(directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Computer Use helper directory is missing, linked, or drifted')
    }
    directory = join(directory, segment)
  }
  const nativeMetadata = lstatSync(directory)
  const bin = join(directory, 'bin')
  const binMetadata = lstatSync(bin)
  if (!nativeMetadata.isDirectory() || nativeMetadata.isSymbolicLink()
    || !binMetadata.isDirectory() || binMetadata.isSymbolicLink()) {
    throw new Error('Computer Use helper directory is missing, linked, or drifted')
  }
  const manifest = join(directory, 'manifest.json')
  const helper = join(bin, COMPUTER_USE_HELPER)
  for (const path of [manifest, helper]) {
    const metadata = lstatSync(path)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('Computer Use helper file is missing, linked, or drifted')
    }
  }
  return { manifest, helper }
}

/** Sign the fixed high-privilege helper without Electron entitlements and rebind its manifest. */
export function signComputerUseHelper(options: ComputerUseHelperSigningOptions): {
  readonly helperPath: string
  readonly inputSha256: string
  readonly outputSha256: string
} {
  const paths = computerUseHelperPaths(options.appPath)
  const manifest = JSON.parse(readFileSync(paths.manifest, 'utf8')) as ComputerUseHelperManifest
  const architectures = manifest.binary?.architectures
  const expected = manifest.binary?.sha256
  if (manifest.schemaVersion !== 1 || manifest.helperVersion !== '0.1.0'
    || typeof manifest.sourceSha256 !== 'string' || !SHA256.test(manifest.sourceSha256)
    || manifest.binary?.path !== `bin/${COMPUTER_USE_HELPER}`
    || typeof expected !== 'string' || !SHA256.test(expected)
    || !Array.isArray(architectures) || JSON.stringify(architectures) !== '["arm64","x86_64"]'
    || manifest.binary?.minimumMacOS !== '14.0') {
    throw new Error('Computer Use helper manifest contract is invalid')
  }
  const inputSha256 = createHash('sha256').update(readFileSync(paths.helper)).digest('hex')
  if (inputSha256 !== expected) throw new Error('Computer Use helper manifest SHA drifted before signing')

  options.runCodesign([
    '--force', '--sign', options.identity, '--timestamp', '--options', 'runtime',
    ...(options.keychain === undefined ? [] : ['--keychain', options.keychain]), paths.helper,
  ])
  const signed = options.inspectSignature(paths.helper)
  if (signed.authority !== options.identity || signed.teamId !== options.teamId) {
    throw new Error('Computer Use helper Developer ID signature drifted')
  }
  const outputSha256 = createHash('sha256').update(readFileSync(paths.helper)).digest('hex')
  if (outputSha256 === inputSha256) throw new Error('Computer Use helper bytes did not change after Developer ID signing')
  manifest.binary.sha256 = outputSha256
  writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
  return { helperPath: paths.helper, inputSha256, outputSha256 }
}

/** Match electron-builder's existing minimal entitlement choice for every signed app item. */
export function macAppSignOptions(
  appBuilderPackage: string,
  appPath: string,
  computerUseHelper: string,
  identity: string,
  keychain: string | undefined,
): Record<string, unknown> & {
  readonly ignore: readonly RegExp[]
  readonly optionsForFile: (filePath: string) => { readonly entitlements: string }
} {
  const expectedHelper = join(appPath, ...COMPUTER_USE_NATIVE_SEGMENTS, 'bin', COMPUTER_USE_HELPER)
  if (!isAbsolute(computerUseHelper) || resolve(computerUseHelper) !== computerUseHelper
    || computerUseHelper !== expectedHelper) {
    throw new Error('Computer Use helper bulk-sign ignore path drifted')
  }
  const entitlements = join(dirname(appBuilderPackage), 'templates', 'entitlements.mac.plist')
  const helperPattern = new RegExp(`^${computerUseHelper.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u')
  return {
    app: appPath,
    platform: 'darwin',
    identity,
    ...(keychain === undefined ? {} : { keychain }),
    hardenedRuntime: true,
    preEmbedProvisioningProfile: false,
    strictVerify: true,
    ignore: [helperPattern],
    optionsForFile: () => ({ entitlements }),
  }
}

async function signApp(
  desktopRoot: string,
  appPath: string,
  computerUseHelper: string,
  identity: string,
  keychain: string | undefined,
): Promise<void> {
  const dependency = appBuilderDependency(desktopRoot)
  const signer = dependency.require('@electron/osx-sign') as {
    readonly signAsync: (options: Record<string, unknown>) => Promise<void>
  }
  await signer.signAsync(macAppSignOptions(dependency.packageJson, appPath, computerUseHelper, identity, keychain))
}

async function generateBlockmap(desktopRoot: string, dmg: string, blockmap: string): Promise<void> {
  const dependency = appBuilderDependency(desktopRoot)
  const builder = dependency.require('./out/targets/blockmap/blockmap.js') as {
    readonly buildBlockMap: (input: string, compression: 'gzip', output: string) => Promise<unknown>
  }
  await builder.buildBlockMap(dmg, 'gzip', blockmap)
}

function p12Path(environment: NodeJS.ProcessEnv, root: string): string {
  const link = environment.CSC_LINK?.trim()
  if (link === undefined || link === '') throw new Error('P12 signing input is missing')
  if (!link.startsWith('data:application/x-pkcs12;base64,')) return resolve(link)
  const path = join(root, 'developer-id.p12')
  const encoded = link.slice('data:application/x-pkcs12;base64,'.length)
  writeFileSync(path, Buffer.from(encoded, 'base64'), { mode: 0o600 })
  return path
}

async function prepareSigning(
  preflight: MacReleasePreflightResult,
  environment: NodeJS.ProcessEnv,
  root: string,
): Promise<SigningContext> {
  if (preflight.signing === 'keychain') {
    const selected = environment.CSC_KEYCHAIN?.trim()
    return selected === undefined || selected === '' ? {} : { keychain: selected }
  }
  const password = environment.CSC_KEY_PASSWORD?.trim()
  if (password === undefined || password === '') throw new Error('P12 signing password is missing')
  const keychain = join(root, 'signing.keychain-db')
  const keychainPassword = randomBytes(24).toString('hex')
  const cleanEnvironment = withoutMacReleaseSecrets(environment)
  command('security', ['create-keychain', '-p', keychainPassword, keychain], cleanEnvironment)
  command('security', ['set-keychain-settings', '-lut', '21600', keychain], cleanEnvironment)
  command('security', ['unlock-keychain', '-p', keychainPassword, keychain], cleanEnvironment)
  command('security', ['import', p12Path(environment, root), '-k', keychain, '-P', password,
    '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'], cleanEnvironment)
  command('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s',
    '-k', keychainPassword, keychain], cleanEnvironment)
  return { keychain }
}

function notaryArguments(
  dmg: string,
  source: MacReleasePreflightResult['notarization'],
  environment: NodeJS.ProcessEnv,
): readonly string[] {
  const common = ['notarytool', 'submit', dmg, '--wait', '--output-format', 'json']
  if (source === 'keychain-profile') {
    const profile = environment.APPLE_KEYCHAIN_PROFILE!.trim()
    const keychain = environment.APPLE_KEYCHAIN?.trim()
    return [...common, '--keychain-profile', profile, ...(keychain === undefined || keychain === '' ? [] : ['--keychain', keychain])]
  }
  if (source === 'apple-id') {
    return [...common, '--apple-id', environment.APPLE_ID!.trim(),
      '--password', environment.APPLE_APP_SPECIFIC_PASSWORD!.trim(), '--team-id', environment.APPLE_TEAM_ID!.trim()]
  }
  return [...common, '--key', environment.APPLE_API_KEY!.trim(),
    '--key-id', environment.APPLE_API_KEY_ID!.trim(), '--issuer', environment.APPLE_API_ISSUER!.trim()]
}

function uniqueApp(directory: string): string {
  const apps = readdirSync(directory)
    .filter(name => name.endsWith('.app'))
    .map(name => join(directory, name))
    .filter(path => {
      const metadata = lstatSync(path)
      return metadata.isDirectory() && !metadata.isSymbolicLink()
    })
  if (apps.length !== 1) throw new Error(`macOS signer requires one application in the DMG; found ${String(apps.length)}`)
  return apps[0]!
}

async function extractInputDmg(dmg: string, cleanEnvironment: NodeJS.ProcessEnv): Promise<ExtractedInput & { readonly root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-macos-signer-'))
  const mount = join(root, 'mount')
  const staging = join(root, 'volume')
  await mkdir(mount)
  let mounted = false
  try {
    try {
      command('hdiutil', ['attach', dmg, '-mountpoint', mount, '-nobrowse', '-readonly'], cleanEnvironment)
      mounted = true
      command('/usr/bin/ditto', [mount, staging], cleanEnvironment)
    } finally {
      if (mounted) command('hdiutil', ['detach', mount], cleanEnvironment)
    }
  } catch (cause) {
    rmSync(root, { recursive: true, force: true })
    throw cause
  }
  return {
    root,
    appPath: uniqueApp(staging),
    cleanup: async () => { rmSync(root, { recursive: true, force: true }) },
  }
}

function argument(values: Record<string, string>, name: string): string {
  const value = values[name]
  if (value === undefined || value === '') throw new Error(`missing --${name}`)
  return value
}

function argumentsFrom(argv: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === undefined || value === undefined || !key.startsWith('--')) throw new Error('signer arguments must be --key value pairs')
    values[key.slice(2)] = value
  }
  return values
}

async function json(path: string): Promise<Record<string, unknown>> {
  const identity = fileIdentity(path)
  if (identity.bytes > 1024 * 1024) throw new Error(`macOS signer JSON is too large: ${identity.name}`)
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

async function main(): Promise<void> {
  const values = argumentsFrom(process.argv.slice(2))
  const sourceCommit = argument(values, 'source-commit')
  const ciRunId = argument(values, 'ci-run-id')
  const artifactId = argument(values, 'artifact-id')
  const version = argument(values, 'version')
  const inputDirectory = resolve(argument(values, 'input'))
  const outputDirectory = resolve(argument(values, 'output'))
  const archivePath = resolve(argument(values, 'artifact-archive'))
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const baseContract = await json(resolve(argument(values, 'base-contract'))) as unknown as BaseContractIdentity
  const cleanEnvironment = withoutMacReleaseSecrets(process.env)
  command(process.execPath, [
    resolve(desktopRoot, '../..', 'scripts', 'stage-desktop-ci-artifact.mjs'),
    'verify', '--platform', 'darwin', '--source-commit', sourceCommit, '--ci-run-id', ciRunId,
    '--base-contract', resolve(argument(values, 'base-contract')), '--directory', inputDirectory,
  ], cleanEnvironment)
  const archive = fileIdentity(archivePath)
  const inputDmg = fileIdentity(join(inputDirectory, `e-Mate-${version}-mac-universal.dmg`))
  const input = {
    sourceCommit,
    ciRunId,
    artifactId,
    version,
    baseContract,
    artifactMetadata: await json(resolve(argument(values, 'artifact-metadata'))),
    artifactArchive: { bytes: archive.bytes, sha256: archive.sha256 },
    ciReceipt: await json(join(inputDirectory, 'desktop-artifact-receipt.json')),
    ciReceiptFile: fileIdentity(join(inputDirectory, 'desktop-artifact-receipt.json')),
    runtime: await json(join(inputDirectory, 'desktop-runtime-verification.json')),
    runtimeReceiptFile: fileIdentity(join(inputDirectory, 'desktop-runtime-verification.json')),
    inputDmg,
  }
  const outputDmg = join(outputDirectory, inputDmg.name)
  const outputBlockmap = `${outputDmg}.blockmap`
  let extractedRoot = ''
  const operations: MacSignerOperations = {
    resetOutput: async () => {
      rmSync(outputDirectory, { recursive: true, force: true })
      await mkdir(outputDirectory, { recursive: true })
    },
    extractInput: async validated => {
      const extracted = await extractInputDmg(join(inputDirectory, validated.inputDmg.name), cleanEnvironment)
      extractedRoot = extracted.root
      return extracted
    },
    inspectInputSignature: async appPath => signature(appPath, cleanEnvironment),
    prepareSigning: async (preflight, environment) => prepareSigning(preflight, environment, extractedRoot),
    signComputerUseHelper: async (appPath, preflight, signing) => signComputerUseHelper({
      appPath,
      identity: preflight.identity,
      teamId: teamId(preflight.identity),
      ...(signing.keychain === undefined ? {} : { keychain: signing.keychain }),
      runCodesign: args => { command('codesign', args, cleanEnvironment) },
      inspectSignature: path => signature(path, cleanEnvironment),
    }).helperPath,
    signApp: async (appPath, preflight, signing, helperPath) => signApp(
      desktopRoot, appPath, helperPath, preflight.identity, signing.keychain,
    ),
    inspectSignedApp: async appPath => signature(appPath, cleanEnvironment),
    packageDmg: async appPath => {
      command('hdiutil', ['create', '-srcfolder', dirname(appPath), '-volname', 'e-Mate',
        '-fs', 'HFS+', '-format', 'UDZO', '-ov', outputDmg], cleanEnvironment)
    },
    signDmg: async (preflight, signing) => {
      command('codesign', ['--force', '--sign', preflight.identity, '--timestamp',
        ...(signing.keychain === undefined ? [] : ['--keychain', signing.keychain]), outputDmg], cleanEnvironment)
    },
    notarizeDmg: async preflight => {
      const result = command('xcrun', notaryArguments(outputDmg, preflight.notarization, process.env), process.env)
      const parsed = JSON.parse(result.stdout) as { readonly id?: unknown; readonly status?: unknown }
      if (typeof parsed.id !== 'string' || !NOTARY_ID.test(parsed.id) || parsed.status !== 'Accepted') {
        throw new Error('Apple notarization did not accept the DMG')
      }
      return { id: parsed.id, status: parsed.status }
    },
    stapleDmg: async () => { command('xcrun', ['stapler', 'staple', outputDmg], cleanEnvironment) },
    verifyDmg: async () => {
      command('codesign', ['--verify', '--strict', '--verbose=2', outputDmg], cleanEnvironment)
      command('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', outputDmg], cleanEnvironment)
      command(process.execPath, [join(desktopRoot, 'scripts', 'verify-mac-release.ts'), outputDirectory,
        '--signed-notarized-dmg'], cleanEnvironment)
    },
    generateBlockmap: async () => generateBlockmap(desktopRoot, outputDmg, outputBlockmap),
    writeEvidence: async facts => writeSignedMacEvidence({
      outputDir: outputDirectory,
      outputDmg,
      outputBlockmap,
      ...facts,
    }),
  }
  const result = await runMacSignerPipeline({
    input,
    env: process.env,
    platform: process.platform,
    listCodeSigningIdentities: () => command('security', ['find-identity', '-v', '-p', 'codesigning'], cleanEnvironment).stdout,
    operations,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`macos-signer: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
