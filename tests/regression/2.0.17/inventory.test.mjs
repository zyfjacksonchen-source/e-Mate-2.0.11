import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const repositoryRoot = new URL('../../../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('./inventory.json', import.meta.url), 'utf8'))
assert.equal(manifest.schemaVersion, 1)
assert.equal(manifest.baseline, '2.0.16')
assert.equal(manifest.target, '2.0.17')
assert.ok(Array.isArray(manifest.rows) && manifest.rows.length > 0)

const ids = manifest.rows.map(row => row.id)
assert.equal(new Set(ids).size, ids.length, 'inventory IDs must be unique')
const documentedInventory = await readFile(new URL('docs/2.0.17/regression-inventory.md', repositoryRoot), 'utf8')
for (const [, id] of documentedInventory.matchAll(/^\| (NEW-[A-Z0-9-]+) \|/gm)) {
  assert.ok(ids.includes(id), 'documented new acceptance missing from inventory: ' + id)
}
const priorities = new Set(['P0', 'P1'])
const platforms = new Set(['all', 'web', 'macos', 'windows', 'server'])
const owners = new Set(['automated-test', 'main-agent-gui'])
for (const row of manifest.rows) {
  assert.ok(typeof row.id === 'string' && /^[A-Z][A-Z0-9-]+-\d{3}$/.test(row.id), 'invalid ID: ' + row.id)
  assert.ok(priorities.has(row.priority), 'invalid priority: ' + row.id)
  assert.ok(['2.0.16-baseline', '2.0.17-new'].includes(row.release), 'invalid release: ' + row.id)
  assert.ok(Array.isArray(row.platforms) && row.platforms.length > 0, 'missing platforms: ' + row.id)
  assert.equal(new Set(row.platforms).size, row.platforms.length, 'duplicate platforms: ' + row.id)
  assert.ok(row.platforms.every(platform => platforms.has(platform)), 'invalid platform: ' + row.id)
  assert.ok(owners.has(row.evidenceOwner), 'invalid evidence owner: ' + row.id)
  assert.ok(typeof row.evidence === 'string' && row.evidence.length > 0, 'missing evidence: ' + row.id)
  assert.ok(typeof row.evidenceFile === 'string' && row.evidenceFile.length > 0, 'missing evidence file: ' + row.id)
  if (row.evidenceOwner === 'automated-test') {
    assert.match(row.evidence, /\.(?:mjs|tsx?) :: .+/u, 'automated evidence needs exact path and test name: ' + row.id)
    const delimiter = row.evidence.indexOf(' :: ')
    const evidencePath = row.evidence.slice(0, delimiter)
    const testName = row.evidence.slice(delimiter + 4)
    assert.equal(evidencePath, row.evidenceFile, 'evidence path/file mismatch: ' + row.id)
    assert.ok(testName.length > 0, 'missing exact test name: ' + row.id)
    const source = await readFile(new URL(row.evidenceFile, repositoryRoot), 'utf8')
    assert.ok(source.includes(testName), 'referenced test name not found: ' + row.id)
  } else {
    assert.match(row.evidence, /^GUI EM217-GUI-[A-Z0-9-]+: .+/u, 'GUI evidence needs exact future step: ' + row.id)
  }
}

const mandatory = [
  'identity-login-agreements-model-policy',
  'sessions-history-migration',
  'agent-tools-jobs-subagents-goals-todos',
  'images-single-generation-edit-review-pack-gallery-cancel-unknown',
  'attachments-file-import',
  'web-shell-navigation-settings-theme-sidebar-composer-accessibility',
  'profile-plugins',
  'enterprise-gateway-admin-audit-usage',
  'desktop-startup-window-tray-profile-pnpm-terminal-resources-update',
  'computer-use-macos',
  'windows-gaps',
  'image-batch-new',
  'computer-use-windows-new',
]
const categories = new Set(manifest.rows.map(row => row.category))
for (const category of mandatory) assert.ok(categories.has(category), 'missing mandatory category: ' + category)
assert.ok(manifest.rows.some(row => row.id === 'NEW-IMG-BATCH-001' && row.release === '2.0.17-new'))
assert.ok(manifest.rows.some(row => row.id === 'NEW-WIN-CU-001' && row.release === '2.0.17-new'))
assert.ok(manifest.rows.some(row => row.id === 'WIN-GAP-001' && row.release === '2.0.16-baseline'))
assert.ok(manifest.rows.some(row => row.id === 'ATT-004' && row.release === '2.0.17-new'))
assert.ok(manifest.rows.some(row => row.id === 'ATT-005' && row.release === '2.0.17-new'))
console.log('validated ' + manifest.rows.length + ' regression inventory rows')
