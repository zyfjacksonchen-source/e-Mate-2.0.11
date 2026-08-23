import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalProfileJson,
  parseProfileBaseContract,
  parseProfileReleaseEnvelope,
  selectProfileRelease,
  signProfileRelease,
  type ProfileBaseContract,
  type ProfileReleasePayload,
} from '../src/profile-release.ts'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const keyId = '0123456789abcdef'
const base: ProfileBaseContract = {
  schema_version: 1,
  id: 'e-mate-desktop-profile-v5-dsh-2bc16230975f',
  desktop_api: 1,
  profile_format: 1,
  harness_version: '0.1.0-rc.7',
  harness_commit: '2bc16230975f6cf02aa1b283b1f86de44007b059',
  runtime_imports: { '@e-mate/desktop/vision-toolkit': '2.0.12' },
  profile_signing_keys: [{
    id: keyId,
    algorithm: 'ed25519',
    public_key_spki_der_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }],
}
const commit = 'a'.repeat(40)
const payload: ProfileReleasePayload = {
  schema_version: 1,
  product: 'e-Mate',
  release_version: '2.0.12',
  sequence: 7,
  source_commit: commit,
  target: { platform: 'darwin', arch: 'arm64' },
  base_contracts: [base.id],
  harness_contract: { version: base.harness_version, commit: base.harness_commit },
  components: [{
    id: '@e-mate/dsh-plugin-memory-evolve',
    version: '2.0.12',
    kind: 'profile',
    target: null,
    profile_path: 'node_modules/@e-mate/dsh-plugin-memory-evolve',
    manifest_url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/profile/components/dsh-plugin-memory-evolve/v2.0.12/${commit}/manifest.json`,
    manifest_bytes: 123,
    manifest_sha256: 'b'.repeat(64),
    manifest_source_commit: commit,
  }],
}
const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

function encoded(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value)}\n`)
}

describe('signed Profile desired state', () => {
  it('parses only the exact packaged Base contract and Ed25519 trust root', () => {
    const value = {
      ...base,
      desktop_reference: {
        repository: 'anywhere-labs/deepseek-harness-desktop',
        commit: '6'.repeat(40),
        harness_repository: 'deepseek-ai/deepseek-harness',
        harness_commit: '9'.repeat(40),
        harness_version: '0.1.0-rc.7',
      },
    }
    expect(parseProfileBaseContract(value)).toEqual(base)
    expect(parseProfileBaseContract({
      ...value,
      runtime_imports: { '@e-mate/plugin': '2.0.12' },
    })).toBeUndefined()
    expect(parseProfileBaseContract({ ...value, ignored: true })).toBeUndefined()
    expect(parseProfileBaseContract({
      ...value,
      profile_signing_keys: [{ ...base.profile_signing_keys[0], algorithm: 'rsa' }],
    })).toBeUndefined()
  })

  it('uses deterministic canonical JSON and verifies an exact Ed25519 envelope', () => {
    expect(canonicalProfileJson({ z: 1, a: ['x', { b: true, a: null }] }))
      .toBe('{"a":["x",{"a":null,"b":true}],"z":1}')
    const envelope = signProfileRelease(payload, privatePem, keyId)
    expect(parseProfileReleaseEnvelope(encoded(envelope), base)).toEqual(envelope)
  })

  it('rejects payload, signature, key, path, URL, and trailing schema drift', () => {
    const envelope = signProfileRelease(payload, privatePem, keyId)
    for (const candidate of [
      { ...envelope, payload: { ...payload, sequence: 8 } },
      { ...envelope, signature: { ...envelope.signature, value: `A${envelope.signature.value.slice(1)}` } },
      { ...envelope, signature: { ...envelope.signature, key_id: 'ffffffffffffffff' } },
      { ...envelope, payload: { ...payload, components: [{ ...payload.components[0]!, profile_path: '../escape' }] } },
      { ...envelope, payload: { ...payload, components: [{ ...payload.components[0]!, manifest_url: 'https://example.com/manifest.json' }] } },
      { ...envelope, ignored: true },
    ]) expect(parseProfileReleaseEnvelope(encoded(candidate), base)).toBeUndefined()
  })

  it('requires an explicitly accepted Base contract and a strictly newer sequence', () => {
    expect(selectProfileRelease(payload, base, 6)).toBe('update')
    expect(selectProfileRelease(payload, base, 7)).toBe('current')
  })

  it('verifies a newer Harness envelope before requiring a Base update', () => {
    const oldBase: ProfileBaseContract = {
      ...base,
      id: 'e-mate-desktop-profile-v1-dsh-rc6',
      harness_version: '0.1.0-rc.6',
      harness_commit: '6'.repeat(40),
    }
    const envelope = signProfileRelease(payload, privatePem, keyId)
    const verified = parseProfileReleaseEnvelope(encoded(envelope), oldBase)

    expect(verified).toEqual(envelope)
    expect(selectProfileRelease(verified!.payload, oldBase, 0)).toBe('base-required')
  })

  it('binds platform components to one exact Desktop target before download', () => {
    const target = {
      platform: 'darwin' as const,
      arch: 'arm64' as const,
      runtime_abi: 'macos-computer-use-helper-v1',
      minimum_os: '14.0',
      signing: { scheme: 'adhoc' as const, identity: 'adhoc' },
      native_paths: ['native/macos'],
    }
    const platformPayload: ProfileReleasePayload = {
      ...payload,
      components: [{
        id: '@e-mate/dsh-plugin-computer-use',
        version: '2.0.12',
        kind: 'platform-profile',
        target,
        profile_path: 'node_modules/@e-mate/dsh-plugin-computer-use',
        manifest_url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/profile/components/dsh-plugin-computer-use/v2.0.12/${commit}/darwin-arm64/manifest.json`,
        manifest_bytes: 123,
        manifest_sha256: 'c'.repeat(64),
        manifest_source_commit: commit,
      }],
    }
    const envelope = signProfileRelease(platformPayload, privatePem, keyId)
    expect(parseProfileReleaseEnvelope(encoded(envelope), base)).toEqual(envelope)

    const wrongTarget = { ...platformPayload, target: { platform: 'darwin' as const, arch: 'x64' as const } }
    expect(parseProfileReleaseEnvelope(
      encoded(signProfileRelease(wrongTarget, privatePem, keyId)),
      base,
    )).toBeUndefined()
  })
})
