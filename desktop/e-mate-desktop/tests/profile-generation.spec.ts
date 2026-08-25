import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BUNDLED_PROFILE_GENERATION,
  beginProfileGenerationStartup,
  markProfileGenerationFailed,
  markProfileGenerationHealthy,
  profileGenerationId,
  readProfileGenerationState,
  resolveProfileGenerationStartup,
  stageProfileGeneration,
} from '../src/profile-generation.ts'
import { signProfileRelease, type ProfileBaseContract, type ProfileReleasePayload } from '../src/profile-release.ts'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const base: ProfileBaseContract = {
  schema_version: 1,
  id: 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0',
  desktop_api: 1,
  profile_format: 1,
  schedule_protocol_floor: 1,
  harness_version: '0.1.0-rc.7',
  harness_commit: 'b2b1650b01f0ee88d81837a9b5c050f9f763f606',
  runtime_imports: {},
  profile_signing_keys: [{
    id: 'test-key',
    algorithm: 'ed25519',
    public_key_spki_der_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  }],
}
const payload: ProfileReleasePayload = {
  schema_version: 1,
  product: 'e-Mate',
  release_version: '2.0.12',
  sequence: 2,
  source_commit: 'a'.repeat(40),
  schedule_protocol_floor: base.schedule_protocol_floor,
  target: { platform: 'darwin', arch: 'arm64' },
  base_contracts: [base.id],
  harness_contract: { version: base.harness_version, commit: base.harness_commit },
  components: [{
    id: '@e-mate/dsh-plugin-memory-evolve',
    version: '2.0.12',
    kind: 'profile',
    target: null,
    profile_path: 'node_modules/@e-mate/dsh-plugin-memory-evolve',
    manifest_url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/profile/components/dsh-plugin-memory-evolve/v2.0.12/${'a'.repeat(40)}/manifest.json`,
    manifest_bytes: 100,
    manifest_sha256: 'b'.repeat(64),
    manifest_source_commit: 'a'.repeat(40),
  }],
}

describe('Profile generation state', () => {
  it('stages, confirms, and retains a user-confirmed generation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-generation-state-'))
    temporary.push(root)
    const statePath = join(root, 'state.json')
    const id = profileGenerationId(payload)

    expect(readProfileGenerationState(statePath)).toEqual({
      schema_version: 1,
      active: BUNDLED_PROFILE_GENERATION,
      last_known_good: BUNDLED_PROFILE_GENERATION,
    })
    stageProfileGeneration(statePath, id)
    expect(beginProfileGenerationStartup(statePath).generation_id).toBe(id)
    expect(markProfileGenerationHealthy(statePath, id)).toEqual({
      schema_version: 1,
      active: id,
      last_known_good: id,
      previous_known_good: BUNDLED_PROFILE_GENERATION,
    })
    expect(beginProfileGenerationStartup(statePath).generation_id).toBe(id)
  })

  it('rolls an unconfirmed generation back to the previous healthy identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-generation-state-'))
    temporary.push(root)
    const statePath = join(root, 'state.json')
    const id = profileGenerationId(payload)

    stageProfileGeneration(statePath, id)
    expect(beginProfileGenerationStartup(statePath).generation_id).toBe(id)
    expect(markProfileGenerationFailed(statePath, id).active).toBe(BUNDLED_PROFILE_GENERATION)
    expect(beginProfileGenerationStartup(statePath)).toMatchObject({
      generation_id: BUNDLED_PROFILE_GENERATION,
      state: { active: BUNDLED_PROFILE_GENERATION, last_known_good: BUNDLED_PROFILE_GENERATION },
    })
  })

  it('retains the previous healthy generation for a later startup regression', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-generation-state-'))
    temporary.push(root)
    const statePath = join(root, 'state.json')
    const id = profileGenerationId(payload)

    stageProfileGeneration(statePath, id)
    beginProfileGenerationStartup(statePath)
    markProfileGenerationHealthy(statePath, id)

    expect(markProfileGenerationFailed(statePath, id)).toEqual({
      schema_version: 1,
      active: BUNDLED_PROFILE_GENERATION,
      last_known_good: BUNDLED_PROFILE_GENERATION,
    })
  })

  it('derives identity from the signed payload rather than signature randomness', () => {
    const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    const first = signProfileRelease(payload, privatePem, 'test-key')
    const second = signProfileRelease(payload, privatePem, 'test-key')
    expect(first).toEqual(second)
    expect(profileGenerationId(first.payload)).toBe(profileGenerationId(second.payload))
  })

  it('falls back to bundled bytes when a staged generation is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-generation-state-'))
    temporary.push(root)
    const statePath = join(root, 'state.json')
    const id = profileGenerationId(payload)
    stageProfileGeneration(statePath, id)

    await expect(resolveProfileGenerationStartup({
      state_path: statePath,
      root: join(root, 'store'),
      base,
      expected_component_ids: [payload.components[0]!.id],
      target: payload.target,
    })).resolves.toMatchObject({
      generation_id: BUNDLED_PROFILE_GENERATION,
      recovered_state: true,
      rolled_back_from: [id],
    })
    expect(readProfileGenerationState(statePath).active).toBe(BUNDLED_PROFILE_GENERATION)
  })
})
