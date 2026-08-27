import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULT_MANIFEST, loadManifest, runSmoke, validateInstallReceipt } from '../../scripts/smoke/run.mjs'
import {
  jobFixture,
  probeReceipt,
  sessionWorkspaceFixture,
  toolRegistryMutationFixture,
  updateFailpointFixture,
  visionInputFixture,
  workerFetchFixture,
} from './fixtures.mjs'

async function temporaryManifest(stage, layer = 'component') {
  const root = await mkdtemp(join(tmpdir(), 'emate-smoke-test-'))
  const source = JSON.parse(await readFile(DEFAULT_MANIFEST, 'utf8'))
  source.layers.component.budget_ms = 5000
  source.layers['app-dir'].budget_ms = 5000
  source.layers.installed.budget_ms = 5000
  source.cases[0].stages[layer] = [stage]
  const manifest = join(root, 'manifest.json')
  await writeFile(manifest, `${JSON.stringify(source)}\n`)
  return { root, manifest }
}

function jsonProbe(stageId, facts, expected, mocked = true, caseId = 'CP-01') {
  const receipt = probeReceipt({ caseId, stageId, facts, mocked })
  return {
    id: stageId,
    type: 'json-probe',
    command: '$NODE',
    args: ['-e', `console.log(${JSON.stringify(JSON.stringify(receipt))})`],
    expect: expected,
    timeout_ms: 2000,
  }
}

test('manifest defines the complete three-layer CP-01 through CP-15 wall', async () => {
  const { manifest } = await loadManifest()
  assert.deepEqual(manifest.cases.map(item => item.id), Array.from({ length: 15 }, (_, index) => `CP-${String(index + 1).padStart(2, '0')}`))
  for (const item of manifest.cases) assert.deepEqual(Object.keys(item.stages).sort(), ['app-dir', 'component', 'installed'])
})

test('fixture factory keeps later Session, Tool, Job, Worker and updater extensions typed', () => {
  assert.equal(sessionWorkspaceFixture().session.blank, true)
  assert.deepEqual(toolRegistryMutationFixture().after, ['tool_search', 'late_probe'])
  assert.equal(jobFixture().status, 'succeeded')
  assert.equal(workerFetchFixture({ status: 503 }).ok, false)
  assert.equal(updateFailpointFixture().expected_state, 'rolled-back')
  for (const capability of ['image-capable', 'capability-unknown', 'confirmed-text-only']) {
    const input = visionInputFixture({ variant: 'text-plus-5-png', capability })
    assert.deepEqual(Object.values(input.counts), [5, 5, 0, 0, 0, 0])
    assert.equal(input.durable_image_blocks_unchanged, true)
    assert.equal(input.request_time_conversion, capability === 'confirmed-text-only')
  }
  assert.equal(visionInputFixture({ variant: 'windows-chinese-path' }).variant, 'windows-chinese-path')
  assert.deepEqual(visionInputFixture({ variant: 'mixed-image-pdf-docx' }).owners, {
    image: 'native-attachment', pdf: 'file-import', docx: 'file-import',
  })
  assert.throws(() => toolRegistryMutationFixture({ before: ['same', 'same'] }), /unique/u)
})

test('structured probe passes only when its exact facts match', async () => {
  const fixture = await temporaryManifest(jsonProbe('session-created', { session_created: true }, { session_created: true }))
  try {
    const evidence = await runSmoke({ manifestPath: fixture.manifest, layer: 'component', caseIds: ['CP-01'], quiet: true })
    assert.equal(evidence.status, 'passed')
    assert.equal(evidence.cases[0].stages[0].status, 'passed')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('runner catches Session creation failure with the exact case and stage', async () => {
  const fixture = await temporaryManifest(jsonProbe('session-created', { session_created: false }, { session_created: true }))
  try {
    const evidence = await runSmoke({ manifestPath: fixture.manifest, layer: 'component', caseIds: ['CP-01'], quiet: true })
    assert.equal(evidence.status, 'failed')
    assert.deepEqual(evidence.cases[0].stages[0], {
      id: 'session-created', type: 'json-probe', status: 'failed', duration_ms: evidence.cases[0].stages[0].duration_ms, error_code: 'PROBE_FACT_MISMATCH',
    })
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('runner catches Tool misrouting instead of accepting a generic success status', async () => {
  const fixture = await temporaryManifest(jsonProbe('tool-route', { selected_tool: 'find_skill' }, { selected_tool: 'imagegen' }))
  try {
    const evidence = await runSmoke({ manifestPath: fixture.manifest, layer: 'component', caseIds: ['CP-01'], quiet: true })
    assert.equal(evidence.cases[0].stages[0].error_code, 'PROBE_FACT_MISMATCH')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('app-directory evidence rejects a mocked success receipt', async () => {
  const fixture = await temporaryManifest(jsonProbe('service-state', { available: true }, { available: true }, true), 'app-dir')
  try {
    const evidence = await runSmoke({ manifestPath: fixture.manifest, layer: 'app-dir', caseIds: ['CP-01'], quiet: true })
    assert.equal(evidence.cases[0].stages[0].error_code, 'MOCK_E2E_FORBIDDEN')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('a live process without Renderer health never passes the app-directory gate', async () => {
  const fixture = await temporaryManifest({
    id: 'renderer-health',
    type: 'renderer-health',
    app_input: 'app-dir',
    args: ['-e', 'setInterval(() => {}, 1000)', '--'],
    timeout_ms: 250,
  }, 'app-dir')
  try {
    const evidence = await runSmoke({
      manifestPath: fixture.manifest,
      layer: 'app-dir',
      caseIds: ['CP-01'],
      appDir: process.execPath,
      quiet: true,
    })
    assert.equal(evidence.status, 'failed')
    assert.equal(evidence.cases[0].stages[0].error_code, 'RENDERER_HEALTH_TIMEOUT')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('unbound extension seams remain explicit and require-complete fails closed', async () => {
  const partial = await runSmoke({ layer: 'component', caseIds: ['CP-05'], quiet: true })
  assert.equal(partial.status, 'passed-with-pending')
  assert.equal(partial.remaining[0].extension, 'subagent-routing.component')
  const required = await runSmoke({ layer: 'component', caseIds: ['CP-05'], requireComplete: true, quiet: true })
  assert.equal(required.status, 'failed')
})

test('an owning ticket can bind its seam without changing the shared manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emate-smoke-extension-'))
  const extension = join(root, 'extension.json')
  await writeFile(extension, `${JSON.stringify({
    schema_version: 1,
    manifest_id: 'e-mate-critical-path-smoke-v1',
    bindings: {
      'subagent-routing.component': [jsonProbe('subagent-route', { selected_tool: 'imagegen' }, { selected_tool: 'imagegen' }, true, 'CP-05')],
    },
  })}\n`)
  try {
    const evidence = await runSmoke({ layer: 'component', caseIds: ['CP-05'], extensionPaths: [extension], quiet: true })
    assert.equal(evidence.status, 'passed')
    assert.equal(evidence.remaining.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('installed seam consumes the existing exact-byte runtime receipt contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emate-smoke-installed-receipt-'))
  const executable = join(root, 'e-Mate')
  const receiptPath = join(root, 'installed.json')
  const bytes = Buffer.from('installed-executable-fixture')
  const installedSha = createHash('sha256').update(bytes).digest('hex')
  const artifactSha = 'a'.repeat(64)
  const { manifest } = await loadManifest()
  await writeFile(executable, bytes)
  await writeFile(receiptPath, `${JSON.stringify({
    schema_version: 2,
    kind: 'installed-runtime-receipt',
    source: 'installed-application',
    runtime: {
      product: 'e-mate-desktop',
      product_version: '2.0.15',
      source_commit: 'b'.repeat(40),
      desktop_reference_commit: '6074088f5b660206e404b3591fab51fb99c69add',
      base_contract_id: manifest.base_contract_id,
      profile_generation: 'fixture-generation',
      composition_sha256: 'c'.repeat(64),
      client_bundle_sha256: 'd'.repeat(64),
      desktop_artifact_sha256: artifactSha,
      desktop_artifact_bytes: 123,
    },
    install_receipt: {
      installation_kind: 'installed-application',
      target: 'darwin-arm64',
      bundle_id: 'com.emate.desktop',
      package_sha256: artifactSha,
      package_bytes: 123,
      installed_executable_sha256: installedSha,
      installed_executable_bytes: bytes.byteLength,
      installed_at: '2026-08-27T00:00:00.000Z',
      launched_at: '2026-08-27T00:00:01.000Z',
    },
  })}\n`)
  try {
    const receipt = await validateInstallReceipt(receiptPath, executable, manifest)
    assert.equal(receipt.version, '2.0.15')
    assert.equal(receipt.target, 'darwin-arm64')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
