import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { releaseMac, type MacReleaseOptions } from '../scripts/release-mac.ts'
import {
  assertSafeMacSignerCommand,
  macAppSignOptions,
  type MacSignerOperations,
  runMacSignerPipeline,
  signComputerUseHelper,
  validateMacSignerInput,
  writeSignedMacEvidence,
} from '../scripts/sign-existing-mac-release.ts'

const DEVELOPER_ID_OUTPUT = `
  1) 0123456789ABCDEF "Developer ID Application: Mengxin Yang (TEAM123456)"
     1 valid identities found
`

interface CommandCall {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

function baseOptions(
  env: NodeJS.ProcessEnv,
  calls: CommandCall[],
  identityEnvironments: NodeJS.ProcessEnv[] = [],
  logs: string[] = [],
): MacReleaseOptions {
  return {
    env,
    platform: 'darwin',
    desktopRoot: '/repo/@e-mate/desktop',
    outputDir: '/repo/@e-mate/desktop/dist/mac-release',
    resetOutput: () => undefined,
    listCodeSigningIdentities: identityEnv => {
      identityEnvironments.push({ ...identityEnv })
      return DEVELOPER_ID_OUTPUT
    },
    run: (command, args, cwd, commandEnv) => {
      calls.push({ command, args: [...args], cwd, env: { ...commandEnv } })
    },
    log: message => logs.push(message),
    prepareRuntime: () => undefined,
  }
}

describe('macOS release command boundary', () => {
  it('runs checks without credentials, then gives credentials only to the DMG builder', () => {
    const calls: CommandCall[] = []
    const identityEnvironments: NodeJS.ProcessEnv[] = []
    const logs: string[] = []
    const resetOutput = vi.fn()
    const appPassword = 'notary-password-that-must-not-be-logged'

    releaseMac({
      ...baseOptions({
        PATH: '/usr/bin',
        SAFE_BUILD_VALUE: 'kept',
        APPLE_ID: 'developer@example.test',
        APPLE_APP_SPECIFIC_PASSWORD: appPassword,
        APPLE_TEAM_ID: 'TEAM123456',
      }, calls, identityEnvironments, logs),
      resetOutput,
    })

    expect(resetOutput).toHaveBeenCalledOnce()
    expect(identityEnvironments).toEqual([{ PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' }])
    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual({
      command: 'yarn',
      args: ['run', 'check'],
      cwd: resolve('/repo/@e-mate/desktop', '..'),
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(calls[1]).toEqual({
      command: 'yarn',
      args: [
        'exec', 'electron-builder', '--mac', 'dmg', '--universal',
        '--config.forceCodeSigning=true', '--config.mac.notarize=true',
        '--config.npmRebuild=false',
        '--config.directories.output=/repo/@e-mate/desktop/dist/mac-release',
      ],
      cwd: '/repo/@e-mate/desktop',
      env: {
        PATH: '/usr/bin',
        SAFE_BUILD_VALUE: 'kept',
        APPLE_ID: 'developer@example.test',
        APPLE_APP_SPECIFIC_PASSWORD: appPassword,
        APPLE_TEAM_ID: 'TEAM123456',
      },
    })
    expect(calls[2]).toEqual({
      command: process.execPath,
      args: [
        'scripts/verify-mac-release.ts',
        '/repo/@e-mate/desktop/dist/mac-release',
      ],
      cwd: '/repo/@e-mate/desktop',
      env: { PATH: '/usr/bin', SAFE_BUILD_VALUE: 'kept' },
    })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toContain('signing via keychain; notarization via apple-id')
    expect(logs[0]).not.toContain(appPassword)
  })

  it('adapts the existing P12 variables only for electron-builder', () => {
    const calls: CommandCall[] = []
    const p12Password = 'p12-password-that-must-not-be-logged'
    const p12 = Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]).toString('base64')
    const options: MacReleaseOptions = {
      ...baseOptions({
        PATH: '/usr/bin',
        APPLE_API_KEY: '/private/AuthKey.p8',
        APPLE_API_KEY_ID: 'KEY123',
        APPLE_API_ISSUER: 'issuer-id',
        CSC_KEY_PASSWORD: p12Password,
        MAC_CERT_P12_BASE64: p12,
        MACOS_SIGN_IDENTITY: 'Developer ID Application: Mengxin Yang (TEAM123456)',
      }, calls),
      listCodeSigningIdentities: () => {
        throw new Error('P12 signing must not depend on a Keychain identity')
      },
    }

    releaseMac(options)

    expect(calls).toHaveLength(3)
    expect(calls[0]?.env).toEqual({ PATH: '/usr/bin' })
    expect(calls[1]?.env.CSC_LINK).toBe(`data:application/x-pkcs12;base64,${p12}`)
    expect(calls[1]?.env.CSC_NAME).toBe('Mengxin Yang (TEAM123456)')
    expect(calls[1]?.env.CSC_KEY_PASSWORD).toBe(p12Password)
    expect(calls[1]?.env.MAC_CERT_P12_BASE64).toBeUndefined()
    expect(calls[1]?.env.MACOS_SIGN_IDENTITY).toBeUndefined()
    expect(calls[2]?.env).toEqual({ PATH: '/usr/bin' })
  })

  it('rejects development signing before running any command', () => {
    const calls: CommandCall[] = []
    const options = baseOptions({
      APPLE_KEYCHAIN_PROFILE: 'dsh-notary',
      CSC_NAME: 'Apple Development: Developer (TEAM123456)',
    }, calls)

    expect(() => releaseMac(options)).toThrow('Developer ID Application')
    expect(calls).toEqual([])
  })

  it('does not invoke electron-builder after a failed credential-free check', () => {
    const calls: CommandCall[] = []
    const resetOutput = vi.fn()
    const options: MacReleaseOptions = {
      ...baseOptions({
        APPLE_KEYCHAIN_PROFILE: 'dsh-notary',
      }, calls),
      resetOutput,
      run: (command, args, cwd, commandEnv) => {
        calls.push({ command, args: [...args], cwd, env: { ...commandEnv } })
        throw new Error('headless check failed')
      },
    }

    expect(() => releaseMac(options)).toThrow('headless check failed')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual(['run', 'check'])
    expect(calls[0]?.cwd).toBe(resolve('/repo/@e-mate/desktop', '..'))
    expect(resetOutput).not.toHaveBeenCalled()
  })
})

const SIGNER_SOURCE = 'a'.repeat(40)
const SIGNER_HARNESS = '4787caf39134df190105b272da0dd2ba893d4d75'
const SIGNER_BASE = { id: 'e-mate-desktop-profile-v8-dsh-4787caf39134', harness_commit: SIGNER_HARNESS }
const SIGNER_INPUT_SHA = '1'.repeat(64)
const SIGNER_ARCHIVE_SHA = '2'.repeat(64)
const SIGNER_DMG = 'e-Mate-2.0.15-mac-universal.dmg'
const SIGNER_NOTARY_ID = '123e4567-e89b-42d3-a456-426614174000'

function signerInput() {
  return {
    sourceCommit: SIGNER_SOURCE,
    ciRunId: '123',
    artifactId: '456',
    version: '2.0.15',
    baseContract: SIGNER_BASE,
    artifactMetadata: {
      id: 456,
      name: `e-mate-desktop-macos-${SIGNER_SOURCE}`,
      expired: false,
      size_in_bytes: 777,
      digest: `sha256:${SIGNER_ARCHIVE_SHA}`,
      workflow_run: { id: 123, head_sha: SIGNER_SOURCE },
    },
    artifactArchive: { bytes: 777, sha256: SIGNER_ARCHIVE_SHA },
    ciReceipt: {
      schema_version: 1,
      document_type: 'emate.desktop-ci-artifact',
      platform: 'darwin',
      source_commit: SIGNER_SOURCE,
      ci_run_id: '123',
      base_contract_id: SIGNER_BASE.id,
      files: [
        { name: SIGNER_DMG, bytes: 900, sha256: SIGNER_INPUT_SHA },
        { name: 'desktop-runtime-verification.json', bytes: 300, sha256: '3'.repeat(64) },
      ],
    },
    ciReceiptFile: { name: 'desktop-artifact-receipt.json', bytes: 400, sha256: '4'.repeat(64) },
    runtime: {
      schema_version: 1,
      document_type: 'emate.desktop-runtime-verification',
      platform: 'darwin',
      source_commit: SIGNER_SOURCE,
      ci_run_id: '123',
      base_contract_id: SIGNER_BASE.id,
      harness_commit: SIGNER_HARNESS,
      installer: { name: SIGNER_DMG, bytes: 900, sha256: SIGNER_INPUT_SHA, format: 'udif' },
    },
    runtimeReceiptFile: { name: 'desktop-runtime-verification.json', bytes: 300, sha256: '3'.repeat(64) },
    inputDmg: { name: SIGNER_DMG, bytes: 900, sha256: SIGNER_INPUT_SHA },
  }
}

function computerUseHelperFixture(manifestSha?: string) {
  const root = mkdtempSync(join(tmpdir(), 'e-mate-signer-helper-'))
  const appPath = join(root, 'e-Mate (candidate).app')
  const nativeRoot = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'build',
    'e-mate-profile', 'bundles', 'computer-use', 'native', 'macos')
  const helperPath = join(nativeRoot, 'bin', 'dsh-computer-use-helper')
  const manifestPath = join(nativeRoot, 'manifest.json')
  mkdirSync(join(nativeRoot, 'bin'), { recursive: true })
  writeFileSync(helperPath, 'ad-hoc-helper')
  const helperSha = createHash('sha256').update('ad-hoc-helper').digest('hex')
  const manifest = {
    schemaVersion: 1,
    helperVersion: '0.1.0',
    sourceSha256: 'a'.repeat(64),
    binary: {
      path: 'bin/dsh-computer-use-helper',
      sha256: manifestSha ?? helperSha,
      architectures: ['arm64', 'x86_64'],
      minimumMacOS: '14.0',
    },
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { root, appPath, helperPath, manifestPath, manifest }
}

describe('exact existing macOS candidate signer', () => {
  it('uses electron-builder minimal entitlements for the app and every nested executable', () => {
    const appBuilderPackage = '/locked/app-builder-lib/package.json'
    const appPath = '/tmp/e-Mate.app'
    const helperPath = join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'build',
      'e-mate-profile', 'bundles', 'computer-use', 'native', 'macos', 'bin', 'dsh-computer-use-helper')
    const options = macAppSignOptions(appBuilderPackage, appPath, helperPath,
      'Developer ID Application: Release', undefined)
    const expected = '/locked/app-builder-lib/templates/entitlements.mac.plist'

    expect(options.optionsForFile(appPath).entitlements).toBe(expected)
    expect(options.optionsForFile(`${appPath}/Contents/Frameworks/e-Mate Helper.app`).entitlements).toBe(expected)
    expect(expected).not.toContain('@electron/osx-sign/entitlements/default.darwin.plist')
  })

  it('rejects a Computer Use helper manifest SHA drift before signing', () => {
    const fixture = computerUseHelperFixture('f'.repeat(64))
    const runCodesign = vi.fn()
    try {
      expect(() => signComputerUseHelper({
        appPath: fixture.appPath,
        identity: 'Developer ID Application: Release Signer (TEAM123456)',
        teamId: 'TEAM123456',
        runCodesign,
        inspectSignature: () => ({ teamId: null }),
      })).toThrow(/manifest.*SHA/u)
      expect(runCodesign).not.toHaveBeenCalled()
      expect(readFileSync(fixture.helperPath, 'utf8')).toBe('ad-hoc-helper')
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('signs and rebinds the helper once before bulk signing ignores only that exact path', () => {
    const fixture = computerUseHelperFixture()
    const events: string[] = []
    let codesignArgs: readonly string[] = []
    try {
      const signed = signComputerUseHelper({
        appPath: fixture.appPath,
        identity: 'Developer ID Application: Release Signer (TEAM123456)',
        teamId: 'TEAM123456',
        keychain: '/tmp/release.keychain-db',
        runCodesign: args => {
          events.push('sign-helper')
          codesignArgs = args
          writeFileSync(fixture.helperPath, 'developer-id-helper')
        },
        inspectSignature: () => {
          events.push('inspect-helper')
          return {
            authority: 'Developer ID Application: Release Signer (TEAM123456)',
            teamId: 'TEAM123456',
          }
        },
      })
      const rebound = JSON.parse(readFileSync(fixture.manifestPath, 'utf8')) as typeof fixture.manifest
      expect(events).toEqual(['sign-helper', 'inspect-helper'])
      expect(signed.outputSha256).toBe(createHash('sha256').update('developer-id-helper').digest('hex'))
      expect(signed.outputSha256).not.toBe(signed.inputSha256)
      expect(rebound.binary.sha256).toBe(signed.outputSha256)
      expect({ ...rebound, binary: { ...rebound.binary, sha256: fixture.manifest.binary.sha256 } }).toEqual(fixture.manifest)
      expect(codesignArgs).toEqual([
        '--force', '--sign', 'Developer ID Application: Release Signer (TEAM123456)', '--timestamp',
        '--options', 'runtime', '--keychain', '/tmp/release.keychain-db', fixture.helperPath,
      ])
      expect(codesignArgs).not.toContain('--entitlements')
      expect(codesignArgs.join(' ')).not.toMatch(/allow-jit|allow-unsigned-executable-memory|disable-library-validation/u)

      const bulk = macAppSignOptions('/locked/app-builder-lib/package.json', fixture.appPath,
        fixture.helperPath, 'Developer ID Application: Release Signer (TEAM123456)', undefined)
      expect(bulk.ignore).toHaveLength(1)
      expect(bulk.ignore[0]!.test(fixture.helperPath)).toBe(true)
      expect(bulk.ignore[0]!.test(`${fixture.helperPath}.backup`)).toBe(false)
      expect(bulk.ignore[0]!.test(join(fixture.appPath, 'Contents', 'MacOS', 'e-Mate'))).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it('closes GitHub artifact, CI receipt, runtime receipt, source, and digest identity', () => {
    expect(validateMacSignerInput(signerInput()).inputDmg.sha256).toBe(SIGNER_INPUT_SHA)

    const drifts: Array<(value: ReturnType<typeof signerInput>) => void> = [
      value => { value.sourceCommit = 'b'.repeat(40) },
      value => { value.artifactMetadata.digest = `sha256:${'4'.repeat(64)}` },
      value => { value.artifactMetadata.id = 457 },
      value => { value.ciReceipt.source_commit = 'b'.repeat(40) },
      value => { value.runtime.harness_commit = 'b'.repeat(40) },
      value => { value.inputDmg.sha256 = '5'.repeat(64) },
    ]
    for (const drift of drifts) {
      const value = structuredClone(signerInput())
      drift(value)
      expect(() => validateMacSignerInput(value)).toThrow(/drift|identity|receipt/u)
    }
  })

  it('rejects missing release credentials before any output mutation', async () => {
    const resetOutput = vi.fn()
    await expect(runMacSignerPipeline({
      input: signerInput(),
      env: {},
      platform: 'darwin',
      listCodeSigningIdentities: () => '0 valid identities found',
      operations: { resetOutput } as never,
    })).rejects.toThrow('Developer ID Application')
    expect(resetOutput).not.toHaveBeenCalled()
  })

  it('fixes sign, package, notarize, staple, verify, and evidence order', async () => {
    const events: string[] = []
    const operations: MacSignerOperations = {
      resetOutput: async () => { events.push('reset-output') },
      extractInput: async () => {
        events.push('extract-input')
        return { appPath: '/tmp/e-Mate.app', cleanup: async () => { events.push('cleanup') } }
      },
      inspectInputSignature: async () => ({ signature: 'adhoc', teamId: null }),
      prepareSigning: async () => { events.push('prepare-signing'); return {} },
      signComputerUseHelper: async () => {
        events.push('sign-computer-use-helper')
        return '/tmp/e-Mate.app/Contents/Resources/app.asar.unpacked/build/e-mate-profile/bundles/computer-use/native/macos/bin/dsh-computer-use-helper'
      },
      signApp: async (_appPath, _preflight, _signing, helperPath) => {
        expect(helperPath).toContain('/computer-use/native/macos/bin/dsh-computer-use-helper')
        events.push('sign-app')
      },
      inspectSignedApp: async () => ({
        authority: 'Developer ID Application: Release Signer (TEAM123456)',
        teamId: 'TEAM123456',
      }),
      packageDmg: async () => { events.push('package-dmg') },
      signDmg: async () => { events.push('sign-dmg') },
      notarizeDmg: async () => { events.push('notarize-dmg'); return { id: SIGNER_NOTARY_ID, status: 'Accepted' as const } },
      stapleDmg: async () => { events.push('staple-dmg') },
      verifyDmg: async () => { events.push('verify-dmg') },
      generateBlockmap: async () => { events.push('generate-blockmap') },
      writeEvidence: async () => { events.push('write-evidence'); return { receipt: true } },
    }

    await runMacSignerPipeline({
      input: signerInput(),
      env: { APPLE_KEYCHAIN_PROFILE: 'notary-profile' },
      platform: 'darwin',
      listCodeSigningIdentities: () => `1) ABC "Developer ID Application: Release Signer (TEAM123456)"`,
      operations,
    })

    expect(events).toEqual([
      'reset-output', 'extract-input', 'prepare-signing', 'sign-computer-use-helper', 'sign-app', 'package-dmg', 'sign-dmg',
      'notarize-dmg', 'staple-dmg', 'verify-dmg', 'generate-blockmap', 'write-evidence', 'cleanup',
    ])
  })

  it('rejects every product rebuild or public-write command at the signer boundary', () => {
    expect(() => assertSafeMacSignerCommand('hdiutil', ['create', '-srcfolder', '/tmp/volume'])).not.toThrow()
    for (const command of [
      ['yarn', ['dist:mac']],
      ['node', ['scripts/package-dir.mjs']],
      ['electron-builder', ['--mac', 'dmg']],
      ['pnpm', ['build:harness']],
      ['wrangler', ['r2', 'object', 'put']],
      ['node', ['scripts/publish-r2.mjs']],
    ] as const) {
      expect(() => assertSafeMacSignerCommand(command[0], command[1])).toThrow('forbidden')
    }
  })

  it('writes the exact four-file handoff from measured final bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e-mate-signer-evidence-'))
    try {
      const dmg = join(root, SIGNER_DMG)
      const blockmap = `${dmg}.blockmap`
      writeFileSync(dmg, 'signed-notarized-dmg')
      writeFileSync(blockmap, 'signed-dmg-blockmap')
      const result = await writeSignedMacEvidence({
        outputDir: root,
        outputDmg: dmg,
        outputBlockmap: blockmap,
        input: validateMacSignerInput(signerInput()),
        preflight: {
          identity: 'Developer ID Application: Release Signer (TEAM123456)',
          signing: 'keychain',
          notarization: 'keychain-profile',
        },
        teamId: 'TEAM123456',
        notary: { id: SIGNER_NOTARY_ID, status: 'Accepted' },
      })
      expect(result.receipt.output.dmg.sha256).toBe(createHash('sha256').update('signed-notarized-dmg').digest('hex'))
      expect(result.receipt.output.dmg.sha256).not.toBe(SIGNER_INPUT_SHA)
      expect(readdirSync(root).sort()).toEqual([
        SIGNER_DMG,
        `${SIGNER_DMG}.blockmap`,
        'desktop-macos-signed-receipt.json',
        'desktop-macos-signed-verification.json',
      ].sort())
      const serialized = readFileSync(join(root, 'desktop-macos-signed-receipt.json'), 'utf8')
      expect(serialized).not.toContain('notary-profile')
      expect(serialized).not.toContain('password')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps the workflow isolated, read-only, exact-input, and non-publishing', () => {
    const workflow = readFileSync(new URL('../../../.github/workflows/desktop-macos-signing.yml', import.meta.url), 'utf8')
    expect(workflow).toContain('environment: macos-signing')
    expect(workflow).toContain('source_sha:')
    expect(workflow).toContain('ci_run_id:')
    expect(workflow).toContain('macos_artifact_id:')
    expect(workflow).toContain('scripts/release-candidate.mjs verify')
    expect(workflow).toContain('scripts/stage-desktop-ci-artifact.mjs verify')
    expect(workflow).toContain('e-mate-desktop-macos-signed-${{ inputs.source_sha }}')
    expect(workflow).toMatch(/permissions:\n  actions: read\n  contents: read/u)
    expect(workflow).not.toMatch(/\b(?:wrangler|r2|feed|publish-r2|electron-builder|dist:mac|package-dir)\b/iu)
  })
})
