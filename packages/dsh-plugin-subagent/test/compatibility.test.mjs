import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { nativeSubagentCompatibility } from '../lib/index.js'

test('compatibility bundle pins only native rc.5 subagent composition', async () => {
  assert.equal(nativeSubagentCompatibility.harnessVersion, '0.1.0-rc.5')
  assert.equal(nativeSubagentCompatibility.harnessCommit, '47f943859bef60e4160492346772ded9b24f765a')
  assert.equal(nativeSubagentCompatibility.preset, 'standard')
  assert.ok(nativeSubagentCompatibility.packages.every(name => name.startsWith('@deepseek-ai/')))
  assert.deepEqual(nativeSubagentCompatibility.tools, [
    'subagent',
    'subagent_fork',
    'send_message',
    'interrupt_agent',
    'list_agents',
    'report',
  ])

  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /intentionally an empty patch/)
  assert.match(patch, /\[\]\s*$/u)
})
