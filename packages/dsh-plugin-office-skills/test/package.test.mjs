import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { apply, inject } from '../lib/index.js'

test('registers four bundled skills through the Harness skill seam', async () => {
  let provider
  assert.deepEqual(inject, ['skills'])
  apply({ skills: { registerProvider(create) { provider = create({ signal: AbortSignal.abort(), invalidate() {} }); return () => {} } } })
  assert.equal(provider.name, 'emate-office-skills')

  const skills = await provider.list({})
  assert.deepEqual(skills.map(skill => skill.name), ['documents', 'pdf', 'spreadsheets', 'presentations'])
  for (const skill of skills) {
    assert.equal(skill.rank, 600)
    assert.equal(skill.source, 'bundled')
    const loaded = await provider.get(skill, {})
    assert.ok(loaded.content.length > 400)
    assert.doesNotMatch(loaded.content, /^---/)
    assert.match(loaded.content, /fail|blocked|unavailable/i)
  }
})

test('package carries no removed runtime or installer dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.deepEqual(manifest.dependencies, undefined)
  const text = JSON.stringify(manifest)
  assert.doesNotMatch(text, /python|playwright|chromium|rapidocr|libreoffice|office-ocr/i)
})
