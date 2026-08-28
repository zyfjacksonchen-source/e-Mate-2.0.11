import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  admitDesktopReleaseManifest,
  createDesktopArtifactCandidate,
  DESKTOP_RELEASE_VERSION,
} from '../scripts/desktop-release-manifest.ts'
import { validateUnsignedAdmittedDesktopReleaseManifest } from '../src/update-checker.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktop release manifest', () => {
  it('uses the version of the desktop package that produces the installers', async () => {
    const desktopManifest = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'))
    expect(DESKTOP_RELEASE_VERSION).toBe(desktopManifest.version)
  })

  it('binds both immutable R2 artifacts to an admission-pending candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-desktop-release-'))
    roots.push(root)
    const artifacts = join(root, 'artifacts')
    await mkdir(artifacts)
    const macBytes = Buffer.from('mac-dmg')
    const windowsBytes = Buffer.from('windows-exe')
    const macArtifact = join(artifacts, `e-Mate-${DESKTOP_RELEASE_VERSION}-mac-universal.dmg`)
    const windowsArtifact = join(artifacts, `e-Mate-${DESKTOP_RELEASE_VERSION}-win-x64-Setup.exe`)
    await writeFile(macArtifact, macBytes)
    await writeFile(windowsArtifact, windowsBytes)
    const output = join(root, 'release', 'desktop-candidate.json')
    const commit = 'a'.repeat(40)

    await createDesktopArtifactCandidate({
      macArtifact,
      windowsArtifact,
      sourceCommit: commit,
      macSourceCommit: commit,
      windowsSourceCommit: commit,
      macBuildRunId: '123',
      windowsBuildRunId: '456',
      output,
    })

    const manifest = JSON.parse(await readFile(output, 'utf8'))
    expect(manifest).toEqual({
      schema_version: 2,
      document_type: 'emate.desktop-artifact-candidate',
      release_status: 'admission-pending',
      version: DESKTOP_RELEASE_VERSION,
      source_commit: commit,
      schedule_protocol_floor: 1,
      artifacts: {
        darwin: {
          url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v${DESKTOP_RELEASE_VERSION}/${commit}/e-Mate-${DESKTOP_RELEASE_VERSION}-mac-universal.dmg`,
          bytes: macBytes.byteLength,
          sha256: createHash('sha256').update(macBytes).digest('hex'),
          build_source_commit: commit,
          build_run_id: '123',
        },
        win32: {
          url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v${DESKTOP_RELEASE_VERSION}/${commit}/e-Mate-${DESKTOP_RELEASE_VERSION}-win-x64-Setup.exe`,
          bytes: windowsBytes.byteLength,
          sha256: createHash('sha256').update(windowsBytes).digest('hex'),
          build_source_commit: commit,
          build_run_id: '456',
        },
      },
    })
  })

  it('rejects mutable or misnamed release inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-desktop-release-'))
    roots.push(root)
    const macArtifact = join(root, 'latest.dmg')
    const windowsArtifact = join(root, `e-Mate-${DESKTOP_RELEASE_VERSION}-win-x64-Setup.exe`)
    await writeFile(macArtifact, 'mac')
    await writeFile(windowsArtifact, 'win')

    await expect(createDesktopArtifactCandidate({
      macArtifact,
      windowsArtifact,
      sourceCommit: 'not-a-commit',
      macSourceCommit: 'a'.repeat(40),
      windowsSourceCommit: 'a'.repeat(40),
      macBuildRunId: '1',
      windowsBuildRunId: '1',
      output: join(root, 'latest.json'),
    })).rejects.toThrow('source commit')
    await expect(createDesktopArtifactCandidate({
      macArtifact,
      windowsArtifact,
      sourceCommit: 'a'.repeat(40),
      macSourceCommit: 'a'.repeat(40),
      windowsSourceCommit: 'a'.repeat(40),
      macBuildRunId: '1',
      windowsBuildRunId: '1',
      output: join(root, 'latest.json'),
    })).rejects.toThrow('unexpected desktop artifact name')
  })

  it('is the only producer of the external signer\'s unsigned 10-field input', async () => {
    const root = await releaseFixture()
    const candidate = join(root, 'desktop-candidate.json')
    const output = join(root, 'latest.json')
    const commit = 'a'.repeat(40)
    const inputs = await admissionInputs(root, commit)

    await admitDesktopReleaseManifest({ candidate, ...inputs, output })

    const manifest = JSON.parse(await readFile(output, 'utf8'))
    expect(Object.keys(manifest)).toHaveLength(10)
    expect(validateUnsignedAdmittedDesktopReleaseManifest(manifest)).toBe(true)
  })

  it('rejects the old public shape and admission drift without writing latest.json', async () => {
    const root = await releaseFixture()
    const candidate = join(root, 'desktop-candidate.json')
    const output = join(root, 'latest.json')
    const commit = 'a'.repeat(40)
    const inputs = await admissionInputs(root, commit)
    const oldPublicManifest = JSON.parse(await readFile(candidate, 'utf8'))
    delete oldPublicManifest.document_type
    delete oldPublicManifest.release_status
    oldPublicManifest.base_contract_id = 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0'
    expect(validateUnsignedAdmittedDesktopReleaseManifest(oldPublicManifest)).toBe(false)

    const provenance = JSON.parse(await readFile(inputs.githubArtifactProvenance, 'utf8'))
    provenance.source_commit = 'b'.repeat(40)
    await writeFile(inputs.githubArtifactProvenance, JSON.stringify(provenance))
    await expect(admitDesktopReleaseManifest({ candidate, ...inputs, output }))
      .rejects.toThrow('admitted release manifest is invalid')
    await expect(readFile(output)).rejects.toThrow()
  })

  it('rejects an unsigned input with unbound provenance fields', async () => {
    const root = await releaseFixture()
    const candidate = join(root, 'desktop-candidate.json')
    const output = join(root, 'latest.json')
    const commit = 'a'.repeat(40)
    const inputs = await admissionInputs(root, commit)
    const provenance = JSON.parse(await readFile(inputs.githubArtifactProvenance, 'utf8'))
    provenance.artifacts[0].note = 'unbound'
    await writeFile(inputs.githubArtifactProvenance, JSON.stringify(provenance))

    await expect(admitDesktopReleaseManifest({ candidate, ...inputs, output }))
      .rejects.toThrow('admitted release manifest is invalid')
  })
})

async function releaseFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'e-mate-desktop-release-'))
  roots.push(root)
  const commit = 'a'.repeat(40)
  const macArtifact = join(root, `e-Mate-${DESKTOP_RELEASE_VERSION}-mac-universal.dmg`)
  const windowsArtifact = join(root, `e-Mate-${DESKTOP_RELEASE_VERSION}-win-x64-Setup.exe`)
  await writeFile(macArtifact, 'mac')
  await writeFile(windowsArtifact, 'win')
  await createDesktopArtifactCandidate({
    macArtifact,
    windowsArtifact,
    sourceCommit: commit,
    macSourceCommit: commit,
    windowsSourceCommit: commit,
    macBuildRunId: '123',
    windowsBuildRunId: '456',
    output: join(root, 'desktop-candidate.json'),
  })
  return root
}

async function admissionInputs(root: string, sourceCommit: string) {
  const profileComponentAggregate = join(root, 'profile-component-aggregate.json')
  const githubArtifactProvenance = join(root, 'github-provenance.json')
  await writeFile(profileComponentAggregate, JSON.stringify({
    aggregate_sha256: '1'.repeat(64),
    inventory_sha256: '2'.repeat(64),
    staged_profile_tree_sha256: '3'.repeat(64),
    targets: ['darwin-arm64', 'darwin-x64', 'win32-x64'].map(target => ({
      target,
      profile_generation: '5'.repeat(64),
      component_aggregate_sha256: '6'.repeat(64),
    })),
  }))
  await writeFile(githubArtifactProvenance, JSON.stringify({
    schema_version: 1,
    document_type: 'emate.github-artifact-provenance',
    source_commit: sourceCommit,
    artifacts: [
      { role: 'desktop_candidate', name: `e-mate-desktop-release-${sourceCommit}`, artifact_id: '11', digest: `sha256:${'7'.repeat(64)}`, run_id: '123', run_attempt: 1 },
    ],
  }))
  return { profileComponentAggregate, githubArtifactProvenance }
}
