import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  apply,
  inject,
  OFFICE_ADAPTER_STATUS,
  OFFICE_RUNTIME_BLOCK_CODE,
} from '../lib/index.js'

test('registers four bundled skills through the Harness skill seam', async () => {
  let provider
  const capabilities = []
  assert.deepEqual(inject, ['skills', 'emateCapabilities'])
  apply({
    skills: { registerProvider(create) { provider = create({ signal: AbortSignal.abort(), invalidate() {} }); return () => {} } },
    emateCapabilities: { register(definition) { capabilities.push(definition); return () => {} } },
    effect(register) { register() },
  })
  assert.equal(provider.name, 'emate-office-skills')

  const skills = await provider.list({})
  assert.deepEqual(skills.map(skill => skill.name), ['documents', 'pdf', 'spreadsheets', 'presentations'])
  for (const skill of skills) {
    assert.equal(skill.rank, 600)
    assert.equal(skill.source, 'bundled')
    assert.deepEqual(skill.invocation, { modelInvocable: false, userInvocable: false })
    assert.equal(skill.metadata.state, 'blocked')
    assert.equal(skill.metadata.blockerCode, OFFICE_RUNTIME_BLOCK_CODE)
    const loaded = await provider.get(skill, {})
    assert.ok(loaded.content.length > 400)
    assert.doesNotMatch(loaded.content, /^---/)
    assert.match(loaded.content, /fail|blocked|unavailable/i)
  }
  assert.deepEqual(capabilities.map(capability => capability.id), ['office-skills'])
  assert.deepEqual(await capabilities[0].status(), {
    state: 'blocked',
    detail: `Office 执行层未交付，四项 Skill 保持禁用（${OFFICE_RUNTIME_BLOCK_CODE}）。`,
    action_ids: [],
  })
  assert.deepEqual(capabilities[0].actions, [])
  assert.deepEqual(OFFICE_ADAPTER_STATUS, {
    state: 'blocked',
    code: OFFICE_RUNTIME_BLOCK_CODE,
    harnessVersion: '0.1.0-rc.5',
    runtimeInstalled: false,
    toolsRegistered: 0,
    reason: 'The pinned runtime exposes the native Skill, filesystem, Bash/PowerShell, and Job seams but ships no distributable Office execution layer; the four Codex primary-runtime Skills cannot be redistributed or resolved by e-Mate.',
  })
})

test('package carries no removed runtime or installer dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dsh.officeSkills, {
    adapterState: 'blocked',
    blockerCode: OFFICE_RUNTIME_BLOCK_CODE,
    runtimeInstalled: false,
    toolsRegistered: 0,
  })
  assert.deepEqual(manifest.dependencies, undefined)
  const text = JSON.stringify(manifest)
  assert.doesNotMatch(text, /python|playwright|chromium|rapidocr|libreoffice|office-ocr/i)
})
