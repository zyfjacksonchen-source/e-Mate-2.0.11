import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDesktopReleaseManifest,
  DESKTOP_RELEASE_VERSION,
} from '../scripts/desktop-release-manifest.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktop release manifest', () => {
  it('uses the version of the desktop package that produces the installers', async () => {
    const desktopManifest = JSON.parse(await readFile(join(import.meta.dirname, '..', 'package.json'), 'utf8'))
    expect(DESKTOP_RELEASE_VERSION).toBe(desktopManifest.version)
  })

  it('binds both immutable R2 artifacts to bytes and SHA-256', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-desktop-release-'))
    roots.push(root)
    const artifacts = join(root, 'artifacts')
    await mkdir(artifacts)
    const macBytes = Buffer.from('mac-dmg')
    const windowsBytes = Buffer.from('windows-exe')
    const macArtifact = join(artifacts, 'e-Mate-2.0.10-mac-universal.dmg')
    const windowsArtifact = join(artifacts, 'e-Mate-2.0.10-win-x64-Setup.exe')
    await writeFile(macArtifact, macBytes)
    await writeFile(windowsArtifact, windowsBytes)
    const output = join(root, 'release', 'latest.json')
    const commit = 'a'.repeat(40)

    await createDesktopReleaseManifest({
      macArtifact,
      windowsArtifact,
      sourceCommit: commit,
      macSourceCommit: 'b'.repeat(40),
      windowsSourceCommit: 'c'.repeat(40),
      macBuildRunId: '123',
      windowsBuildRunId: '456',
      output,
    })

    const manifest = JSON.parse(await readFile(output, 'utf8'))
    expect(manifest).toEqual({
      schema_version: 1,
      version: '2.0.10',
      source_commit: commit,
      artifacts: {
        darwin: {
          url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v2.0.10/${commit}/e-Mate-2.0.10-mac-universal.dmg`,
          bytes: macBytes.byteLength,
          sha256: createHash('sha256').update(macBytes).digest('hex'),
          build_source_commit: 'b'.repeat(40),
          build_run_id: '123',
        },
        win32: {
          url: `https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/releases/v2.0.10/${commit}/e-Mate-2.0.10-win-x64-Setup.exe`,
          bytes: windowsBytes.byteLength,
          sha256: createHash('sha256').update(windowsBytes).digest('hex'),
          build_source_commit: 'c'.repeat(40),
          build_run_id: '456',
        },
      },
    })
  })

  it('rejects mutable or misnamed release inputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'e-mate-desktop-release-'))
    roots.push(root)
    const macArtifact = join(root, 'latest.dmg')
    const windowsArtifact = join(root, 'e-Mate-2.0.10-win-x64-Setup.exe')
    await writeFile(macArtifact, 'mac')
    await writeFile(windowsArtifact, 'win')

    await expect(createDesktopReleaseManifest({
      macArtifact,
      windowsArtifact,
      sourceCommit: 'not-a-commit',
      macSourceCommit: 'a'.repeat(40),
      windowsSourceCommit: 'a'.repeat(40),
      macBuildRunId: '1',
      windowsBuildRunId: '1',
      output: join(root, 'latest.json'),
    })).rejects.toThrow('source commit')
    await expect(createDesktopReleaseManifest({
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
})
