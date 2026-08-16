import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('creates the fixed Harness chat-state fixture once and reuses it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'e-mate-chat-state-'))
  const root = join(directory, 'sessions')
  const cwd = join(directory, 'workspace')
  await mkdir(cwd)
  const run = () => JSON.parse(execFileSync(process.execPath, [
    fileURLToPath(new URL('./create-chat-state-fixture.mjs', import.meta.url)),
    '--root', root,
    '--cwd', cwd,
  ], { encoding: 'utf8' }))

  try {
    const created = run()
    const reused = run()
    assert.equal(created.reused, false)
    assert.equal(reused.reused, true)
    assert.equal(created.event_count, 50)
    assert.equal(created.events_sha256, 'e88c05a486d196cfd14f2ae8d0be003de191b826b1c226d803bbfb658ff15096')
    assert.deepEqual(created.states.map(({ key, reason }) => [key, reason]), [
      ['completed', 'completed'],
      ['failed', 'error'],
      ['blocked', 'blocked'],
      ['cancelled', 'aborted'],
      ['interrupted', 'interrupted'],
      ['max-tokens', 'max-tokens'],
    ])
    assert.equal(reused.events_sha256, created.events_sha256)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
