import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_VERSION_ENDPOINT,
  MAX_VERSION_RESPONSE_BYTES,
  checkForStableUpdate as checkForStableUpdateRaw,
  compareSemVerVersions,
  parseSemVer,
  type DesktopReleaseSigningKey,
  type UpdateCheckOptions,
  type UpdateRequest,
} from '../src/update-checker.ts'

const SOURCE_COMMIT = 'a'.repeat(40)
const MANIFEST_SIGNATURE_CONTEXT = Buffer.from('e-mate-desktop-release-manifest-v2\0', 'utf8')
const { privateKey: manifestPrivateKey, publicKey: manifestPublicKey } = generateKeyPairSync('ed25519')
const TRUSTED_MANIFEST_KEYS: readonly DesktopReleaseSigningKey[] = [{
  id: 'desktop-release-test-key',
  algorithm: 'ed25519',
  public_key_spki_der_base64: manifestPublicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
}]

function checkForStableUpdate(
  options: Omit<UpdateCheckOptions, 'trustedManifestKeys'> & Pick<Partial<UpdateCheckOptions>, 'trustedManifestKeys'>,
) {
  return checkForStableUpdateRaw({
    ...options,
    trustedManifestKeys: options.trustedManifestKeys ?? TRUSTED_MANIFEST_KEYS,
  })
}

function versionResponse(version: unknown, scheduleProtocolFloor: unknown = 1, init: ResponseInit = {}): Response {
  return Response.json(versionManifest(version, scheduleProtocolFloor), init)
}

function versionManifest(version: unknown, scheduleProtocolFloor: unknown = 1): Record<string, unknown> {
  const release = typeof version === 'string' ? version : 'invalid'
  return signManifest({
    schema_version: 2,
    document_type: 'emate.desktop-release-manifest',
    release_status: 'admitted',
    version,
    source_commit: SOURCE_COMMIT,
    base_contract_id: 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0',
    schedule_protocol_floor: scheduleProtocolFloor,
    profile_component_aggregate: profileComponentAggregateSummary(),
    github_artifact_provenance: githubArtifactProvenance(),
    artifacts: {
      darwin: manifestArtifact(release, 'darwin'),
      win32: manifestArtifact(release, 'win32'),
    },
  })
}

function signManifest(
  manifest: Record<string, unknown>,
  context: Buffer = MANIFEST_SIGNATURE_CONTEXT,
): Record<string, unknown> {
  const value = sign(
    null,
    Buffer.concat([context, Buffer.from(canonicalJson(manifest), 'utf8')]),
    manifestPrivateKey,
  ).toString('base64')
  return {
    ...manifest,
    signature: { algorithm: 'ed25519', key_id: TRUSTED_MANIFEST_KEYS[0]!.id, value },
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

function releaseArtifact(version: string, platform: 'darwin' | 'win32') {
  return {
    url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v${encodeURIComponent(version)}/${SOURCE_COMMIT}/e-Mate-${version}-${platform === 'darwin' ? 'mac-universal.dmg' : 'win-x64-Setup.exe'}`,
    bytes: 1024,
    sha256: '0'.repeat(64),
  }
}

function manifestArtifact(version: string, platform: 'darwin' | 'win32') {
  return {
    ...releaseArtifact(version, platform),
    build_source_commit: SOURCE_COMMIT,
    build_run_id: platform === 'darwin' ? '123' : '456',
  }
}

function profileComponentAggregateSummary() {
  return {
    aggregate_sha256: '1'.repeat(64),
    inventory_sha256: '2'.repeat(64),
    staged_profile_tree_sha256: '3'.repeat(64),
    targets: ['darwin-arm64', 'darwin-x64', 'win32-x64'].map(target => ({
      target,
      profile_generation: '5'.repeat(64),
      component_aggregate_sha256: '6'.repeat(64),
    })),
  }
}

function githubArtifactProvenance() {
  return {
    schema_version: 1,
    document_type: 'emate.github-artifact-provenance',
    source_commit: SOURCE_COMMIT,
    artifacts: [
      {
        role: 'desktop_candidate',
        name: `e-mate-desktop-release-${SOURCE_COMMIT}`,
        artifact_id: '11',
        digest: `sha256:${'7'.repeat(64)}`,
        run_id: '123',
        run_attempt: 1,
      },
    ],
  }
}

describe('strict SemVer parsing', () => {
  it('accepts a three-part version, optional lowercase v, prerelease, and build metadata', () => {
    expect(parseSemVer('v2.10.3-alpha.1+mac.arm64')).toEqual({
      version: '2.10.3-alpha.1+mac.arm64',
      major: '2',
      minor: '10',
      patch: '3',
      prerelease: ['alpha', '1'],
      build: ['mac', 'arm64'],
    })
    expect(parseSemVer('0.0.0')).not.toBeNull()
  })

  it.each([
    '1',
    '1.2',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-01',
    '1.2.3-alpha..1',
    '1.2.3+',
    'V1.2.3',
    ' 1.2.3',
  ])('rejects invalid SemVer %s', version => {
    expect(parseSemVer(version)).toBeNull()
  })

  it('compares strict versions without numeric overflow', () => {
    expect(compareSemVerVersions('2.1.0', '2.0.10')).toBeGreaterThan(0)
    expect(compareSemVerVersions('2.0.0-rc.1', '2.0.0')).toBeLessThan(0)
    expect(compareSemVerVersions('2.0', '2.0.0')).toBeNull()
    expect(compareSemVerVersions(
      '10000000000000000.0.0',
      '9007199254740992.0.0',
    )).toBeGreaterThan(0)
  })
})

describe('public Desktop version check', () => {
  it('uses only the fixed no-cache version endpoint and reports a newer stable version', async () => {
    const controller = new AbortController()
    const calls: Array<{ url: string, init: RequestInit }> = []
    const request: UpdateRequest = async (url, init) => {
      calls.push({ url, init })
      return versionResponse('2.10.0')
    }

    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.9.9',
      currentScheduleProtocolFloor: 1,
      signal: controller.signal,
      request,
    })).resolves.toEqual({
      status: 'update-available',
      currentVersion: '2.9.9',
      latestVersion: '2.10.0',
      sourceCommit: SOURCE_COMMIT,
      baseContractId: 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0',
      scheduleProtocolFloor: 1,
      manifestIdentity: expect.stringMatching(/^[0-9a-f]{64}$/u),
      artifact: releaseArtifact('2.10.0', 'darwin'),
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(DESKTOP_VERSION_ENDPOINT)
    expect(calls[0]?.url).toBe('https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/signed/latest.json')
    expect(calls[0]?.url).not.toBe('https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/latest.json')
    expect(calls[0]?.url).not.toContain('/api/downloads/')
    expect(calls[0]?.init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.has('if-none-match')).toBe(false)
    expect(headers.has('x-github-api-version')).toBe(false)
  })

  it('uses one canonical identity independent of JSON whitespace and key order', async () => {
    const manifest = versionManifest('2.1.0')
    const reversed = Object.fromEntries(Object.entries(manifest).reverse())
    const check = (body: string) => checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
    })

    const normal = await check(JSON.stringify(manifest))
    const reordered = await check(JSON.stringify(reversed, null, 2))
    expect(normal).toMatchObject({ status: 'update-available' })
    expect(reordered).toMatchObject({ status: 'update-available' })
    expect((normal as Extract<typeof normal, { status: 'update-available' }>).manifestIdentity)
      .toBe((reordered as Extract<typeof reordered, { status: 'update-available' }>).manifestIdentity)
  })

  it.each([
    ['missing signature', () => {
      const { signature: _, ...unsigned } = versionManifest('2.1.0')
      return unsigned
    }],
    ['unknown key', () => {
      const manifest = versionManifest('2.1.0') as Record<string, any>
      manifest.signature.key_id = 'unknown-key'
      return manifest
    }],
    ['malformed signature', () => {
      const manifest = versionManifest('2.1.0') as Record<string, any>
      manifest.signature.value = 'not base64'
      return manifest
    }],
    ['signature field drift', () => {
      const manifest = versionManifest('2.1.0') as Record<string, any>
      manifest.signature.note = 'unexpected'
      return manifest
    }],
    ['mutated signed body', () => {
      const manifest = versionManifest('2.1.0') as Record<string, any>
      manifest.artifacts.win32.sha256 = '9'.repeat(64)
      return manifest
    }],
    ['wrong signature context', () => {
      const { signature: _, ...unsigned } = versionManifest('2.1.0')
      return signManifest(unsigned, Buffer.from('other-release-context\0', 'utf8'))
    }],
  ])('fails closed for a manifest with %s', async (_case, fixture) => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => Response.json(fixture()),
    })).resolves.toBeNull()
  })

  it('fails closed when the installed Base supplies no matching trust root', async () => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      trustedManifestKeys: [],
      request: async () => versionResponse('2.1.0'),
    })).resolves.toBeNull()
  })

  it.each([
    ['2.0.0', '2.0.0'],
    ['2.0.1', '2.0.0'],
  ])('reports no update for installed %s and service %s', async (currentVersion, latestVersion) => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion,
      currentScheduleProtocolFloor: 1,
      request: async () => versionResponse(latestVersion),
    })).resolves.toEqual({
      status: 'up-to-date',
      currentVersion,
      latestVersion,
    })
  })

  it('never turns a correctly signed lower version into a rollback install', async () => {
    await expect(checkForStableUpdate({
      platform: 'win32',
      currentVersion: '2.0.13',
      currentScheduleProtocolFloor: 1,
      request: async () => versionResponse('2.0.12'),
    })).resolves.toEqual({
      status: 'up-to-date',
      currentVersion: '2.0.13',
      latestVersion: '2.0.12',
    })
  })

  it('compares service versions without overflowing JavaScript numbers', async () => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '9007199254740992.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => versionResponse('10000000000000000.0.0'),
    })).resolves.toMatchObject({ status: 'update-available' })
  })

  it.each([
    ['missing artifacts', (manifest: Record<string, unknown>) => { delete manifest.artifacts }],
    ['wrong origin', (manifest: Record<string, any>) => { manifest.artifacts.darwin.url = 'https://example.com/update.dmg' }],
    ['non-canonical default port', (manifest: Record<string, any>) => { manifest.artifacts.darwin.url = manifest.artifacts.darwin.url.replace('.r2.dev/', '.r2.dev:443/') }],
    ['disguised platform suffix', (manifest: Record<string, any>) => { manifest.artifacts.darwin.url = manifest.artifacts.darwin.url.replace('.dmg', '.exe.dmg') }],
    ['invalid digest', (manifest: Record<string, any>) => { manifest.artifacts.darwin.sha256 = 'ABC' }],
    ['invalid Base contract id', (manifest: Record<string, any>) => { manifest.base_contract_id = 'v7' }],
    ['coerced Profile digest', (manifest: Record<string, any>) => { manifest.profile_component_aggregate.aggregate_sha256 = ['1'.repeat(64)] }],
    ['duplicate candidate provenance', (manifest: Record<string, any>) => {
      manifest.github_artifact_provenance.artifacts.push({ ...manifest.github_artifact_provenance.artifacts[0] })
    }],
    ['candidate rerun provenance', (manifest: Record<string, any>) => {
      manifest.github_artifact_provenance.artifacts[0].run_attempt = 2
    }],
  ])('rejects a newer release with %s', async (_label, mutate) => {
    const manifest = versionManifest('2.1.0')
    mutate(manifest)
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => Response.json(manifest),
    })).resolves.toBeNull()
  })

  it.each([
    ['leading v', { version: 'v2.1.0' }],
    ['prerelease', { version: '2.1.0-rc.1' }],
    ['invalid SemVer', { version: '2.01.0' }],
    ['missing version', {}],
    ['non-string version', { version: 2 }],
    ['array response', ['2.1.0']],
  ])('silently ignores a service response with %s', async (_case, value) => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => Response.json(value),
    })).resolves.toBeNull()
  })

  it.each([
    ['admission-pending candidate', () => ({
      ...versionManifest('2.1.0'),
      document_type: 'emate.desktop-artifact-candidate',
      release_status: 'admission-pending',
    })],
    ['legacy public schema', () => {
      const value = versionManifest('2.1.0')
      return { version: value.version, schedule_protocol_floor: value.schedule_protocol_floor, artifacts: value.artifacts }
    }],
    ['top-level field drift', () => ({ ...versionManifest('2.1.0'), channel: 'stable' })],
    ['platform artifact mismatch', () => {
      const value = versionManifest('2.1.0')
      const artifacts = value.artifacts as Record<string, unknown>
      return { ...value, artifacts: { darwin: artifacts.win32, win32: artifacts.darwin } }
    }],
  ])('rejects %s', async (_case, fixture) => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => Response.json(fixture()),
    })).resolves.toBeNull()
  })

  it('silently ignores malformed JSON and non-200 statuses', async () => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => new Response('{'),
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => new Response('unavailable', { status: 503 }),
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => new Response(null, { status: 304 }),
    })).resolves.toBeNull()
  })

  it('silently ignores network failure and caller cancellation', async () => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => { throw new TypeError('offline') },
    })).resolves.toBeNull()

    const controller = new AbortController()
    controller.abort()
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      signal: controller.signal,
      request: async () => { throw new DOMException('cancelled', 'AbortError') },
    })).resolves.toBeNull()
  })

  it('silently ignores declared and streamed oversized responses', async () => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => new Response('{}', {
        headers: { 'content-length': String(MAX_VERSION_RESPONSE_BYTES + 1) },
      }),
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => new Response('x'.repeat(MAX_VERSION_RESPONSE_BYTES + 1)),
    })).resolves.toBeNull()
  })

  it.each(['2.0', 'v2.0.0', '2.0.0-rc.1'])('skips invalid installed version %s before requesting', async currentVersion => {
    const request = vi.fn(async () => versionResponse('2.1.0'))

    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion,
      currentScheduleProtocolFloor: 1,
      request,
    })).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects a missing latest Schedule protocol floor', async () => {
    const manifest = versionManifest('2.1.0')
    delete manifest.schedule_protocol_floor
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => Response.json(manifest),
    })).resolves.toBeNull()
  })

  it.each([0, 1.5, '1'])('rejects invalid latest Schedule protocol floor %s', async scheduleProtocolFloor => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 1,
      request: async () => versionResponse('2.1.0', scheduleProtocolFloor),
    })).resolves.toBeNull()
  })

  it('rejects a higher version below the installed Schedule protocol floor', async () => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 2,
      request: async () => versionResponse('99.0.0', 1),
    })).resolves.toBeNull()
  })

  it('accepts a higher version at the installed Schedule protocol floor', async () => {
    await expect(checkForStableUpdate({
      platform: 'darwin',
      currentVersion: '2.0.0',
      currentScheduleProtocolFloor: 2,
      request: async () => versionResponse('2.1.0', 2),
    })).resolves.toMatchObject({
      status: 'update-available',
      latestVersion: '2.1.0',
      scheduleProtocolFloor: 2,
    })
  })
})
