/** Build the immutable desktop artifact manifest consumed by e-Mate updates. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '2.0.7'
const R2_ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const SOURCE_COMMIT = /^[0-9a-f]{40}$/u

export interface DesktopReleaseManifestOptions {
  readonly macArtifact: string
  readonly windowsArtifact: string
  readonly sourceCommit: string
  readonly output: string
}

interface ArtifactRecord {
  readonly url: string
  readonly bytes: number
  readonly sha256: string
}

/** Create one deterministic latest.json after both native packages have passed their platform gates. */
export async function createDesktopReleaseManifest(options: DesktopReleaseManifestOptions): Promise<void> {
  if (!SOURCE_COMMIT.test(options.sourceCommit)) throw new Error('desktop release source commit is invalid')
  const prefix = `${R2_ORIGIN}/desktop/releases/v${VERSION}/${options.sourceCommit}`
  const [darwin, win32] = await Promise.all([
    artifact(options.macArtifact, `e-Mate-${VERSION}-mac-universal.dmg`, prefix),
    artifact(options.windowsArtifact, `e-Mate-${VERSION}-win-x64-Setup.exe`, prefix),
  ])
  const output = resolve(options.output)
  await mkdir(dirname(output), { recursive: true })
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify({
    schema_version: 1,
    version: VERSION,
    source_commit: options.sourceCommit,
    artifacts: { darwin, win32 },
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  await rename(temporary, output)
}

async function artifact(path: string, expectedName: string, prefix: string): Promise<ArtifactRecord> {
  const resolved = resolve(path)
  if (basename(resolved) !== expectedName) throw new Error(`unexpected desktop artifact name: ${basename(resolved)}`)
  const file = await stat(resolved)
  if (!file.isFile() || file.size <= 0 || !Number.isSafeInteger(file.size)) {
    throw new Error(`desktop artifact is not a non-empty regular file: ${resolved}`)
  }
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(resolved)) digest.update(chunk)
  return { url: `${prefix}/${expectedName}`, bytes: file.size, sha256: digest.digest('hex') }
}

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (value === undefined || value.length === 0) throw new Error(`missing ${name}`)
  return value
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await createDesktopReleaseManifest({
    macArtifact: argument('--mac'),
    windowsArtifact: argument('--win'),
    sourceCommit: argument('--commit'),
    output: argument('--out'),
  })
}
