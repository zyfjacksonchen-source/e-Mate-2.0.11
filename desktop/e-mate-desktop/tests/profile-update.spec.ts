import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readProfileGenerationState } from '../src/profile-generation.ts'
import { checkProfileUpdate, installProfileUpdate, profileReleaseUrl } from '../src/profile-update.ts'
import { signProfileRelease, type ProfileBaseContract, type ProfileReleasePayload } from '../src/profile-release.ts'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function response(bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes).buffer, {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength) },
  })
}

describe('signed Profile update path', () => {
  it('returns base-required for a signed v3 release on the installed v2 Base before fetching components', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const oldBase: ProfileBaseContract = {
      schema_version: 1,
      id: 'e-mate-desktop-profile-v2-dsh-2bc16230975f',
      desktop_api: 1,
      profile_format: 1,
      harness_version: '0.1.0-rc.7',
      harness_commit: '7'.repeat(40),
      runtime_imports: {},
      profile_signing_keys: [{
        id: 'release-key',
        algorithm: 'ed25519',
        public_key_spki_der_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      }],
    }
    const target = { platform: 'darwin' as const, arch: 'arm64' as const }
    const commit = '7'.repeat(40)
    const payload: ProfileReleasePayload = {
      schema_version: 1,
      product: 'e-Mate',
      release_version: '2.0.11',
      sequence: 1,
      source_commit: commit,
      target,
      base_contracts: ['e-mate-desktop-profile-v3-dsh-2bc16230975f'],
      harness_contract: { version: '0.1.0-rc.7', commit: '7'.repeat(40) },
      components: [{
        id: '@e-mate/dsh-plugin-memory-evolve',
        version: '2.0.11',
        kind: 'profile',
        target: null,
        profile_path: 'node_modules/@e-mate/dsh-plugin-memory-evolve',
        manifest_url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/profile/components/dsh-plugin-memory-evolve/v2.0.11/${commit}/manifest.json`,
        manifest_bytes: 123,
        manifest_sha256: '8'.repeat(64),
        manifest_source_commit: commit,
      }],
    }
    const release = signProfileRelease(
      payload,
      privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      'release-key',
    )
    const request = vi.fn(async () => response(Buffer.from(`${JSON.stringify(release)}\n`)))

    await expect(checkProfileUpdate({
      base: oldBase,
      target,
      expectedComponentIds: ['@e-mate/dsh-plugin-memory-evolve'],
      generationRoot: '/unused',
      generationStatePath: '/unused/state.json',
      activeGenerationId: 'bundled',
      request,
    }, new AbortController().signal)).resolves.toEqual({
      status: 'base-required',
      currentGeneration: 'bundled',
      currentSequence: 0,
      releaseVersion: '2.0.11',
      sequence: 1,
      requiredBaseContracts: ['e-mate-desktop-profile-v3-dsh-2bc16230975f'],
    })
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith(profileReleaseUrl(target), expect.objectContaining({ method: 'GET' }))
  })

  it('checks the exact delta, materializes it, and stages one generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-profile-update-'))
    temporary.push(root)
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const base: ProfileBaseContract = {
      schema_version: 1,
      id: 'e-mate-desktop-profile-v1-dsh-test',
      desktop_api: 1,
      profile_format: 1,
      harness_version: '0.1.0-rc.7',
      harness_commit: 'd'.repeat(40),
      runtime_imports: {},
      profile_signing_keys: [{
        id: 'test-key',
        algorithm: 'ed25519',
        public_key_spki_der_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
      }],
    }
    const id = '@e-mate/dsh-plugin-memory-evolve'
    const version = '2.0.11'
    const commit = 'a'.repeat(40)
    const dsh = { bundle: { patch: './cordis.patch.yml' } }
    const packageBytes = Buffer.from(`${JSON.stringify({
      name: id,
      version,
      license: 'MIT',
      main: 'index.js',
      dsh,
      eMate: { component: { schema_version: 1, id, kind: 'profile', base_imports: [], authority_contract: { effects: [], guards: [] }, base_contracts: [base.id] } },
    }, null, 2)}\n`)
    const indexBytes = Buffer.from('export const name = "memory-evolve"\n')
    const files = [
      { path: 'index.js', bytes: indexBytes.byteLength, sha256: sha256(indexBytes), mode: '0644' },
      { path: 'package.json', bytes: packageBytes.byteLength, sha256: sha256(packageBytes), mode: '0644' },
    ] as const
    const manifestBytes = Buffer.from(`${JSON.stringify({
      schema_version: 1,
      id,
      slug: 'dsh-plugin-memory-evolve',
      version,
      kind: 'profile',
      target: null,
      source_commit: commit,
      base_contracts: [base.id],
      base_imports: [],
      authority_contract: { effects: [], guards: [] },
      harness_contract: { version: base.harness_version, commit: base.harness_commit },
      package_entry: 'index.js',
      dsh,
      total_bytes: indexBytes.byteLength + packageBytes.byteLength,
      files,
    }, null, 2)}\n`)
    const manifestUrl = `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/profile/components/dsh-plugin-memory-evolve/v${version}/${commit}/manifest.json`
    const payload: ProfileReleasePayload = {
      schema_version: 1,
      product: 'e-Mate',
      release_version: version,
      sequence: 1,
      source_commit: commit,
      target: { platform: 'darwin', arch: 'arm64' },
      base_contracts: [base.id],
      harness_contract: { version: base.harness_version, commit: base.harness_commit },
      components: [{
        id,
        version,
        kind: 'profile',
        target: null,
        profile_path: `node_modules/${id}`,
        manifest_url: manifestUrl,
        manifest_bytes: manifestBytes.byteLength,
        manifest_sha256: sha256(manifestBytes),
        manifest_source_commit: commit,
      }],
    }
    const release = signProfileRelease(
      payload,
      privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      'test-key',
    )
    const releaseBytes = Buffer.from(`${JSON.stringify(release)}\n`)
    const request = vi.fn(async (url: string) => {
      if (url === profileReleaseUrl(payload.target)) return response(releaseBytes)
      if (url === manifestUrl) return response(manifestBytes)
      if (url.endsWith('/files/index.js')) return response(indexBytes)
      if (url.endsWith('/files/package.json')) return response(packageBytes)
      return new Response('missing', { status: 404 })
    })
    const context = {
      base,
      target: payload.target,
      expectedComponentIds: [id],
      generationRoot: join(root, 'store'),
      generationStatePath: join(root, 'state.json'),
      activeGenerationId: 'bundled',
      request,
    }
    const update = await checkProfileUpdate(context, new AbortController().signal)
    expect(update).toMatchObject({
      status: 'update-available',
      releaseVersion: version,
      sequence: 1,
      changedComponents: [{ id, version, bytes: indexBytes.byteLength + packageBytes.byteLength }],
      downloadBytes: indexBytes.byteLength + packageBytes.byteLength,
    })
    if (update.status !== 'update-available') throw new Error('expected component update')

    const generation = await installProfileUpdate(context, update, new AbortController().signal)
    expect(readProfileGenerationState(context.generationStatePath).pending).toBe(generation.id)
    await expect(readFile(join(generation.component_directories.get(id)!, 'index.js'), 'utf8'))
      .resolves.toBe(indexBytes.toString())
  })
})
