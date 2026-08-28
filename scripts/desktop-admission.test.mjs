import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import {
  createGithubArtifactProvenance,
  PERFORMANCE_MODEL_LEAF_IDS,
  PERFORMANCE_MODEL_ROSTER,
  createPerformanceSummary,
  createProfileBuildReceipt,
  createProfileComponentAggregate,
} from './desktop-admission.mjs'
import { profileGenerationId } from '../desktop/e-mate-desktop/src/profile-generation.ts'
import { canonicalProfileJson, signProfileRelease } from '../desktop/e-mate-desktop/src/profile-release.ts'

const SOURCE = 'a'.repeat(40)
const ORIGIN = 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev'
const TARGETS = ['darwin-arm64', 'darwin-x64', 'win32-x64']
const PERFORMANCE_CONTEXT = Buffer.from('e-mate-performance-admission-v1\0', 'utf8')
const PERFORMANCE_AGGREGATE_CONTEXT = Buffer.from('e-mate-performance-aggregate-admission-v1\0', 'utf8')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function file(path, bytes) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

async function json(path, value) {
  await file(path, `${JSON.stringify(value, null, 2)}\n`)
}

function fixtureBase(publicKey) {
  return {
    schema_version: 1,
    id: 'e-mate-test-base',
    desktop_api: 1,
    profile_format: 1,
    schedule_protocol_floor: 1,
    desktop_reference: {
      repository: 'example/desktop', commit: 'b'.repeat(40),
      harness_repository: 'example/harness', harness_commit: 'c'.repeat(40), harness_version: '0.1.0-rc.7',
    },
    harness_version: '0.1.0-rc.7',
    harness_commit: 'd'.repeat(40),
    runtime_imports: {},
    profile_signing_keys: [{
      id: 'test-key', algorithm: 'ed25519',
      public_key_spki_der_base64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    }],
  }
}

function inventory() {
  return {
    schema_version: 1,
    components: [{
      id: '@e-mate/dsh-client-shell', root: 'packages/dsh/profile/plugins/emate-shell',
      kind: 'profile', desktop: 'hot-profile', cli: true,
    }],
  }
}

async function profileFixture(root) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const base = fixtureBase(publicKey)
  const basePath = join(root, 'base-contract.json')
  const inventoryPath = join(root, 'component-inventory.json')
  const profileRoot = join(root, 'profile')
  await json(basePath, base)
  await json(inventoryPath, inventory())
  await json(join(profileRoot, 'dsh/profile/component-inventory.json'), inventory())
  await file(join(profileRoot, 'emate-shell/lib/client.js'), 'export {}\n')
  const receiptPath = join(root, 'profile-build-receipt.json')
  await createProfileBuildReceipt({
    sourceCommit: SOURCE, baseContract: basePath, inventory: inventoryPath,
    profile: profileRoot, output: receiptPath,
  })

  const packageBytes = Buffer.from('{"name":"@e-mate/dsh-client-shell"}\n')
  const entryBytes = Buffer.from('export {}\n')
  const manifest = {
    schema_version: 1,
    id: '@e-mate/dsh-client-shell',
    slug: 'dsh-client-shell',
    version: '2.0.13',
    kind: 'profile',
    target: null,
    source_commit: SOURCE,
    base_contracts: [base.id],
    schedule_protocol_floor: 1,
    base_imports: [],
    authority_contract: { effects: [], guards: [] },
    harness_contract: { version: base.harness_version, commit: base.harness_commit },
    package_entry: 'lib/client.js',
    dsh: {},
    total_bytes: packageBytes.length + entryBytes.length,
    files: [
      { path: 'lib/client.js', bytes: entryBytes.length, sha256: sha256(entryBytes), mode: '0644' },
      { path: 'package.json', bytes: packageBytes.length, sha256: sha256(packageBytes), mode: '0644' },
    ],
  }
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  const manifestKey = `desktop/profile/components/dsh-client-shell/v2.0.13/${SOURCE}/manifest.json`
  const manifestUrl = `${ORIGIN}/${manifestKey}`
  const reference = {
    id: manifest.id,
    version: manifest.version,
    kind: manifest.kind,
    target: null,
    profile_path: 'node_modules/@deepseek-ai/dsh-client-ui-sidebar',
    manifest_url: manifestUrl,
    manifest_bytes: manifestBytes.length,
    manifest_sha256: sha256(manifestBytes),
    manifest_source_commit: SOURCE,
  }
  const bundle = join(root, 'publication')
  const immutable = []
  async function object(role, key, path, bytes, cacheControl = 'public,max-age=31536000,immutable') {
    await file(join(bundle, ...path.split('/')), bytes)
    return {
      role, key, url: `${ORIGIN}/${key}`, path, bytes: bytes.length, sha256: sha256(bytes),
      content_type: 'application/json', cache_control: cacheControl,
    }
  }
  immutable.push(await object('component', manifestKey, `immutable/${manifestKey}`, manifestBytes))
  for (const [path, bytes] of [['lib/client.js', entryBytes], ['package.json', packageBytes]]) {
    const key = `${manifestKey.slice(0, -'manifest.json'.length)}files/${path}`
    immutable.push(await object('component', key, `immutable/${key}`, bytes))
  }
  const activations = []
  for (const target of TARGETS) {
    const [platform, arch] = target.split('-')
    const payload = {
      schema_version: 1,
      product: 'e-Mate',
      release_version: '2.0.13',
      sequence: 1,
      source_commit: SOURCE,
      schedule_protocol_floor: 1,
      target: { platform, arch },
      base_contracts: [base.id],
      harness_contract: { version: base.harness_version, commit: base.harness_commit },
      components: [reference],
    }
    const generation = profileGenerationId(payload)
    const envelopeBytes = Buffer.from(`${JSON.stringify(signProfileRelease(payload, privateKeyPem, 'test-key'), null, 2)}\n`)
    const immutableKey = `desktop/profile/releases/${generation}/${target}.json`
    immutable.push(await object('desired-state-immutable', immutableKey, `immutable/${immutableKey}`, envelopeBytes))
    const activeKey = `desktop/profile/desired-state/${target}.json`
    activations.push({
      target, generation, sequence: 1, parent_generation: null,
      changed_components: [reference.id], expected_current: null,
      object: await object('desired-state-active', activeKey, `activation/${activeKey}`, envelopeBytes, 'no-store'),
    })
  }
  await json(join(bundle, 'publication-plan.json'), {
    schema_version: 1,
    document_type: 'emate.profile-native-cloudflare-publication-plan',
    status: 'prepared',
    source_commit: SOURCE,
    main_commit: SOURCE,
    accepted_ci_run_id: '100',
    preparation_run_id: '103',
    base_contract_id: base.id,
    schedule_protocol_floor: 1,
    immutable_objects: immutable,
    activations,
  })
  return { base, basePath, privateKey, inventoryPath, profileRoot, receiptPath, bundle }
}

async function desktopCandidate(root) {
  const version = '2.0.13'
  const files = {
    darwin: { name: `e-Mate-${version}-mac-universal.dmg`, bytes: Buffer.from('mac-installer') },
    win32: { name: `e-Mate-${version}-win-x64-Setup.exe`, bytes: Buffer.from('win-installer') },
  }
  for (const item of Object.values(files)) await file(join(root, item.name), item.bytes)
  const candidate = {
    schema_version: 2,
    document_type: 'emate.desktop-artifact-candidate',
    release_status: 'admission-pending',
    version,
    source_commit: SOURCE,
    schedule_protocol_floor: 1,
    artifacts: Object.fromEntries(Object.entries(files).map(([platform, item]) => [platform, {
      url: `${ORIGIN}/desktop/releases/v${version}/${SOURCE}/${item.name}`,
      bytes: item.bytes.length,
      sha256: sha256(item.bytes),
      build_source_commit: SOURCE,
      build_run_id: '100',
    }])),
  }
  const path = join(root, 'desktop-candidate.json')
  await json(path, candidate)
  return { path, candidate }
}

test('Profile build receipt rejects links instead of hashing outside the staged artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-admission-profile-link-'))
  try {
    const { publicKey } = generateKeyPairSync('ed25519')
    const basePath = join(root, 'base-contract.json')
    const inventoryPath = join(root, 'component-inventory.json')
    const profileRoot = join(root, 'profile')
    await json(basePath, fixtureBase(publicKey))
    await json(inventoryPath, inventory())
    await json(join(profileRoot, 'dsh/profile/component-inventory.json'), inventory())
    await file(join(root, 'outside.txt'), 'outside\n')
    await symlink(join(root, 'outside.txt'), join(profileRoot, 'outside-link'))
    await assert.rejects(() => createProfileBuildReceipt({
      sourceCommit: SOURCE, baseContract: basePath, inventory: inventoryPath,
      profile: profileRoot, output: join(root, 'receipt.json'),
    }), /contains a symlink/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Profile aggregate is recomputed from staged bytes, signed desired states, and component objects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-admission-profile-'))
  try {
    const fixture = await profileFixture(root)
    const output = join(root, 'profile-component-aggregate.json')
    const performanceOutput = join(root, 'profile-performance-authorities.json')
    const aggregate = await createProfileComponentAggregate({
      sourceCommit: SOURCE, ciRunId: '100', profileRunId: '103', releaseVersion: '2.0.13',
      baseContract: fixture.basePath, inventory: fixture.inventoryPath, profile: fixture.profileRoot,
      profileReceipt: fixture.receiptPath, publicationBundle: fixture.bundle, output, performanceOutput,
    })
    assert.deepEqual(aggregate.targets.map(item => item.target), TARGETS)
    assert.match(aggregate.aggregate_sha256, /^[0-9a-f]{64}$/u)
    const performance = JSON.parse(await readFile(performanceOutput, 'utf8'))
    assert.deepEqual(performance.targets.map(item => item.client_bundle_sha256), TARGETS.map(() => sha256('export {}\n')))
    assert.deepEqual(
      performance.targets.map(item => item.composition_sha256),
      aggregate.targets.map(item => item.component_aggregate_sha256),
    )
    await file(join(fixture.profileRoot, 'emate-shell/lib/client.js'), 'mutated\n')
    await assert.rejects(() => createProfileComponentAggregate({
      sourceCommit: SOURCE, ciRunId: '100', profileRunId: '103', releaseVersion: '2.0.13',
      baseContract: fixture.basePath, inventory: fixture.inventoryPath, profile: fixture.profileRoot,
      profileReceipt: fixture.receiptPath, publicationBundle: fixture.bundle, output,
    }), /does not match its build receipt/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function performanceFixture(root, profile, options = {}) {
  const candidate = await desktopCandidate(join(root, 'desktop'))
  const aggregate = {
    aggregate_sha256: '1'.repeat(64), inventory_sha256: '2'.repeat(64), staged_profile_tree_sha256: '3'.repeat(64),
    targets: TARGETS.map(target => ({
      target, profile_generation: '4'.repeat(64), component_aggregate_sha256: '5'.repeat(64),
    })),
  }
  const aggregatePath = join(root, 'profile-aggregate.json')
  await json(aggregatePath, aggregate)
  const performanceRoot = join(root, 'performance')
  const sourcePath = join(root, 'performance-parity.mjs')
  await file(sourcePath, 'export {}\n')
  const supportingBytes = Buffer.from('{}\n')
  const path = (name, candidate, roster) => ({
    run_receipt: Object.fromEntries([
      ['provider', roster.provider],
      ['model', roster.model],
      ['reasoning_level', roster.reasoning_effort],
      ['raw_samples_artifact', 'raw-samples'],
      ['native_trace_artifact', 'native-session-trace'],
      ['provider_receipt_artifact', 'provider-invocation-receipt'],
      ['request_header_artifact', 'request-headers'],
      ['renderer_paint_artifact', 'renderer-paint-trace'],
      ['installed_runtime_artifact', 'installed-runtime-receipt'],
      ...(candidate ? [['enterprise_receipt_artifact', 'enterprise-runtime-receipt']] : []),
    ].map(([field, kind]) => field.endsWith('_artifact') ? [field, {
      kind, path: `evidence/${name}/${field}.json`, sha256: sha256(supportingBytes),
    }] : [field, kind])),
  })
  const desktopArtifacts = Object.fromEntries(['darwin', 'win32'].map(platform => [platform, {
    bytes: candidate.candidate.artifacts[platform].bytes,
    sha256: candidate.candidate.artifacts[platform].sha256,
  }]))
  const models = []
  for (const [index, roster] of PERFORMANCE_MODEL_ROSTER.entries()) {
    if (options.omitRouteId === roster.route_id) continue
    const childRoot = join(performanceRoot, 'children', `${String(index + 1).padStart(2, '0')}-${PERFORMANCE_MODEL_LEAF_IDS[index]}`)
    const evidence = {
      schema_version: 2,
      comparison_kind: 'installed-2.0.12-vs-2.0.13',
      performance_run_id: options.duplicateRunId ? 'performance-child-run-duplicate' : `performance-child-run-${index + 1}`,
      evidence_kind: options.evidenceKind ?? 'production-real-provider',
      harness_commit: profile.base.harness_commit,
      performance_model: options.modelDrift && index === 0 ? { ...roster, model: 'wrong-model' } : roster,
      paths: {
        baseline: path('baseline', false, roster),
        emate_online: path('emate_online', true, roster),
        emate_enterprise_unavailable_valid_cache: path('emate_enterprise_unavailable_valid_cache', true, roster),
      },
      production_artifacts_verified: true,
      decision: { gate_status: 'passed', failures: [], production_receipt_failures: [], comparisons: {} },
    }
    const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`)
    await file(join(childRoot, 'e-mate-performance-evidence.json'), evidenceBytes)
    for (const evidencePath of Object.values(evidence.paths)) {
      for (const [field, descriptor] of Object.entries(evidencePath.run_receipt)) {
        if (field.endsWith('_artifact')) await file(join(childRoot, ...descriptor.path.split('/')), supportingBytes)
      }
    }
    const verifier = {
      contract: 'ttft-v2', source: 'scripts/performance-parity.mjs', source_commit: SOURCE,
      source_sha256: sha256(await readFile(sourcePath)), harness_commit: profile.base.harness_commit,
      evidence_filename: 'e-mate-performance-evidence.json',
      decision_sha256: sha256(Buffer.from(`${JSON.stringify(evidence.decision, null, 2)}\n`, 'utf8')),
      gate_status: 'passed',
    }
    const unsigned = {
      schema_version: 1,
      document_type: 'emate.performance-admission',
      status: 'passed',
      performance_run_id: evidence.performance_run_id,
      source_commit: SOURCE,
      base_contract_id: profile.base.id,
      profile_component_aggregate_sha256: aggregate.aggregate_sha256,
      desktop_artifacts: desktopArtifacts,
      evidence_sha256: sha256(evidenceBytes),
      verifier,
    }
    const signature = sign(null, Buffer.concat([
      PERFORMANCE_CONTEXT, Buffer.from(canonicalProfileJson(unsigned), 'utf8'),
    ]), profile.privateKey).toString('base64')
    const admission = {
      ...unsigned, signature: { algorithm: 'ed25519', key_id: 'test-key', value: signature },
    }
    const admissionBytes = Buffer.from(`${JSON.stringify(admission, null, 2)}\n`)
    await file(join(childRoot, 'performance-admission.json'), admissionBytes)
    models.push({
      route_id: roster.route_id,
      performance_run_id: evidence.performance_run_id,
      admission_sha256: sha256(admissionBytes),
      evidence_sha256: sha256(evidenceBytes),
      verifier,
    })
  }
  const aggregateVerifier = {
    contract: 'ttft-v2-aggregate', source: 'scripts/performance-parity.mjs', source_commit: SOURCE,
    source_sha256: sha256(await readFile(sourcePath)), harness_commit: profile.base.harness_commit,
    evidence_filename: 'performance-admission.json',
    decision_sha256: sha256(Buffer.from(canonicalProfileJson(models.map(child => child.verifier.decision_sha256)), 'utf8')),
    gate_status: 'passed',
  }
  const aggregateRunId = `performance-aggregate-${sha256(Buffer.from(canonicalProfileJson(models), 'utf8')).slice(0, 40)}`
  const aggregateUnsigned = {
    schema_version: 1,
    document_type: 'emate.performance-aggregate-admission',
    status: 'passed',
    performance_run_id: aggregateRunId,
    source_commit: SOURCE,
    base_contract_id: profile.base.id,
    profile_component_aggregate_sha256: aggregate.aggregate_sha256,
    desktop_artifacts: desktopArtifacts,
    roster: PERFORMANCE_MODEL_ROSTER,
    children: models,
    evidence_sha256: sha256(Buffer.from(canonicalProfileJson(models.map(child => child.evidence_sha256)), 'utf8')),
    verifier: aggregateVerifier,
  }
  const aggregateSignature = sign(null, Buffer.concat([
    PERFORMANCE_AGGREGATE_CONTEXT, Buffer.from(canonicalProfileJson(aggregateUnsigned), 'utf8'),
  ]), profile.privateKey).toString('base64')
  await json(join(performanceRoot, 'performance-admission.json'), {
    ...aggregateUnsigned, signature: { algorithm: 'ed25519', key_id: 'test-key', value: aggregateSignature },
  })
  return { aggregatePath, candidate, performanceRoot, sourcePath }
}

test('performance summary accepts only the exact signed TTFT v2 bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-admission-performance-'))
  try {
    const profile = await profileFixture(join(root, 'profile-fixture'))
    const fixture = await performanceFixture(root, profile)
    const summary = await createPerformanceSummary({
      sourceCommit: SOURCE, baseContract: profile.basePath, candidate: fixture.candidate.path,
      profileAggregate: fixture.aggregatePath, performanceBundle: fixture.performanceRoot,
      verifierSource: fixture.sourcePath, output: join(root, 'summary.json'),
    })
    assert.match(summary.performance_run_id, /^performance-aggregate-[0-9a-f]{40}$/u)
    assert.equal(summary.signature_key_id, 'test-key')
    await json(join(fixture.performanceRoot, 'extra.json'), {})
    await assert.rejects(() => createPerformanceSummary({
      sourceCommit: SOURCE, baseContract: profile.basePath, candidate: fixture.candidate.path,
      profileAggregate: fixture.aggregatePath, performanceBundle: fixture.performanceRoot,
      verifierSource: fixture.sourcePath, output: join(root, 'summary.json'),
    }), /file set is invalid/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('performance aggregate fails closed for missing, duplicate, drifted, or fixture model evidence', async () => {
  for (const options of [
    { omitRouteId: PERFORMANCE_MODEL_ROSTER[3].route_id },
    { duplicateRunId: true },
    { modelDrift: true },
    { evidenceKind: 'fixture' },
  ]) {
    const root = await mkdtemp(join(tmpdir(), 'desktop-admission-performance-negative-'))
    try {
      const profile = await profileFixture(join(root, 'profile-fixture'))
      const fixture = await performanceFixture(root, profile, options)
      await assert.rejects(() => createPerformanceSummary({
        sourceCommit: SOURCE, baseContract: profile.basePath, candidate: fixture.candidate.path,
        profileAggregate: fixture.aggregatePath, performanceBundle: fixture.performanceRoot,
        verifierSource: fixture.sourcePath, output: join(root, 'summary.json'),
      }))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

function run(id, path, event = 'workflow_dispatch') {
  return {
    id: Number(id), path, head_sha: SOURCE, head_branch: 'main', event,
    status: 'completed', conclusion: 'success', run_attempt: 1,
    repository: { full_name: 'zyfjacksonchen-source/e-Mate-2.0.11' },
  }
}

function jobs(names) {
  return { jobs: names.map(name => ({ name, conclusion: 'success' })) }
}

function artifact(id, name, runId) {
  return {
    id: Number(id), name, expired: false, digest: `sha256:${String(id).padStart(64, '0')}`,
    workflow_run: { id: Number(runId), head_sha: SOURCE },
  }
}

test('GitHub provenance rejects the old repository and binds exact protected-main artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-admission-github-'))
  try {
    const desktop = await desktopCandidate(join(root, 'desktop'))
    const metadata = join(root, 'metadata')
    await json(join(metadata, 'main-ref.json'), { object: { sha: SOURCE } })
    await json(join(metadata, 'ci-run.json'), run('100', '.github/workflows/ci.yml', 'push'))
    await json(join(metadata, 'desktop-run.json'), run('102', '.github/workflows/desktop-release.yml'))
    await json(join(metadata, 'profile-run.json'), run('103', '.github/workflows/profile-release.yml'))
    const ciJobNames = [
      'CI admission', 'Node 24 / target contracts and unit tests',
      'Windows x64 / unsigned desktop installer', 'macOS universal / unsigned desktop disk image',
      ...TARGETS.map(target => `Complete Profile generation / ${target}`),
    ]
    await json(join(metadata, 'ci-jobs.json'), jobs(ciJobNames))
    await json(join(metadata, 'desktop-jobs.json'), jobs([
      'Bind exact protected-main CI artifacts to the release manifest',
    ]))
    await json(join(metadata, 'profile-jobs.json'), jobs([
      'Validate accepted CI evidence',
      'Prepare signed native Cloudflare publication bundle',
    ]))
    await json(join(metadata, 'desktop-artifact.json'), artifact('201', `e-mate-desktop-release-${SOURCE}`, '102'))
    await json(join(metadata, 'ci-artifact.json'), artifact('206', `e-mate-ci-plan-${SOURCE}`, '100'))
    await json(join(metadata, 'profile-publication-artifact.json'), artifact('202', `e-mate-profile-native-cloudflare-publication-${SOURCE}`, '103'))
    await json(join(metadata, 'base-sdk-artifact.json'), artifact('204', `e-mate-base-sdk-${SOURCE}`, '100'))
    await json(join(metadata, 'profile-build-artifact.json'), artifact('205', `e-mate-desktop-profile-${SOURCE}`, '100'))
    await json(join(metadata, 'profile-build-receipt-artifact.json'), artifact('207', `e-mate-desktop-profile-build-receipt-${SOURCE}`, '100'))
    await json(join(metadata, 'windows-ci-artifact.json'), artifact('208', `e-mate-desktop-windows-${SOURCE}`, '100'))
    await json(join(metadata, 'macos-ci-artifact.json'), artifact('209', `e-mate-desktop-macos-${SOURCE}`, '100'))
    const options = {
      sourceCommit: SOURCE, candidate: desktop.path, metadata,
      ciRunId: '100', desktopRunId: '102', profileRunId: '103',
      desktopArtifactId: '201', profileArtifactId: '202',
      output: join(root, 'github-artifact-provenance.json'),
    }
    const { provenance } = await createGithubArtifactProvenance(options)
    assert.deepEqual(provenance.artifacts.map(item => item.role), ['desktop_candidate'])
    for (const target of TARGETS) {
      const name = `Complete Profile generation / ${target}`
      await json(join(metadata, 'ci-jobs.json'), jobs(ciJobNames.filter(job => job !== name)))
      await assert.rejects(() => createGithubArtifactProvenance(options), new RegExp(`CI job is not uniquely successful: ${name}`, 'u'))
      const failed = jobs(ciJobNames)
      failed.jobs.find(job => job.name === name).conclusion = 'failure'
      await json(join(metadata, 'ci-jobs.json'), failed)
      await assert.rejects(() => createGithubArtifactProvenance(options), new RegExp(`CI job is not uniquely successful: ${name}`, 'u'))
      await json(join(metadata, 'ci-jobs.json'), { jobs: [...jobs(ciJobNames).jobs, { name, conclusion: 'success' }] })
      await assert.rejects(() => createGithubArtifactProvenance(options), new RegExp(`CI job is not uniquely successful: ${name}`, 'u'))
    }
    await json(join(metadata, 'ci-jobs.json'), jobs(ciJobNames))
    const rerun = run('100', '.github/workflows/ci.yml', 'push')
    rerun.run_attempt = 2
    await json(join(metadata, 'ci-run.json'), rerun)
    await assert.rejects(() => createGithubArtifactProvenance(options), /CI run provenance is invalid/u)
    const invalid = run('100', '.github/workflows/ci.yml', 'push')
    invalid.repository.full_name = 'zyfjacksonchen-source/e-Mate'
    await json(join(metadata, 'ci-run.json'), invalid)
    await assert.rejects(() => createGithubArtifactProvenance(options), /CI run provenance is invalid/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('workflow is build-only and uploads only the two external signer inputs', async () => {
  const workflow = await readFile('.github/workflows/desktop-admission.yml', 'utf8')
  const desktopBuild = await readFile('.github/workflows/desktop-release.yml', 'utf8')
  const performance = await readFile('.github/workflows/desktop-performance.yml', 'utf8')
  const { parse } = createRequire(resolve('packages/dsh/package.json'))('yaml')
  const parsed = parse(workflow)
  const ci = parse(await readFile('.github/workflows/ci.yml', 'utf8'))
  const desktopRelease = parse(desktopBuild)
  const profileRelease = parse(await readFile('.github/workflows/profile-release.yml', 'utf8'))
  assert.deepEqual(Object.keys(parsed.jobs), ['admission'])
  assert.equal(parsed.jobs.admission.name, 'Desktop release admission')
  assert.ok(Object.values(ci.jobs).some(job => job.name === 'CI admission'))
  assert.deepEqual(Object.keys(desktopRelease.jobs), ['manifest'])
  assert.ok(Object.values(desktopRelease.jobs).some(job => job.name === 'Bind exact protected-main CI artifacts to the release manifest'))
  assert.ok(Object.values(profileRelease.jobs).some(job => job.name === 'Validate accepted CI evidence'))
  assert.ok(Object.values(profileRelease.jobs).some(job => job.name === 'Prepare signed native Cloudflare publication bundle'))
  assert.deepEqual(Object.keys(profileRelease.jobs), ['validate', 'prepare-publication'])
  const upload = parsed.jobs.admission.steps.find(step => step.uses === 'actions/upload-artifact@v4')
  assert.equal(upload.with.name, 'e-mate-desktop-admission-${{ github.sha }}')
  assert.equal(upload.with.path.trim(), [
    '.admission/output/base-contract.json', '.admission/output/desktop-release-unsigned.json',
  ].join('\n'))
  assert.match(workflow, /^\s+name: Desktop release admission$/mu)
  assert.match(workflow, /GITHUB_REF_PROTECTED" = true/u)
  assert.match(workflow, /zyfjacksonchen-source\/e-Mate-2\.0\.11/u)
  assert.doesNotMatch(workflow, /zyfjacksonchen-source\/e-Mate(?:\s|$)/u)
  assert.match(workflow, /desktop-release-manifest\.ts\s+admit/u)
  assert.doesNotMatch(workflow, /performance_workflow_run_id|performance_artifact_id|PERFORMANCE_MODEL_LEAF_IDS|performance-summary/u)
  assert.match(workflow, /base-contract\.json,desktop-release-unsigned\.json/u)
  assert.doesNotMatch(workflow, /secrets\.|aws |wrangler|r2-publish|desktop\/latest\.json/u)
  assert.match(desktopBuild, /e-mate-desktop-profile-build-receipt-\$\{\{ inputs\.source_sha \}\}/u)
  assert.match(desktopBuild, /stage-desktop-ci-artifact\.mjs verify/u)
  assert.match(desktopBuild, /working-directory: desktop\s+run: yarn install --immutable/u)
  for (const consumer of [parsed, parse(performance)]) {
    const downloads = consumer.jobs[Object.keys(consumer.jobs)[0]].steps
      .filter(step => step.uses === 'actions/download-artifact@v4' && step.with?.['artifact-ids'])
    assert.ok(downloads.length > 0)
    assert.ok(downloads.every(step => step.with['merge-multiple'] === true))
  }
  for (const consumer of [desktopBuild, performance, workflow]) {
    assert.match(consumer, /require\(process\.argv\[1\]\)\.version" \.\/desktop\/e-mate-desktop\/package\.json/u)
    assert.doesNotMatch(consumer, /require\(process\.argv\[1\]\)\.version" desktop\/e-mate-desktop\/package\.json/u)
  }
  assert.doesNotMatch(desktopBuild, /build:harness|pnpm test|build:sdk|dist:win|dist:mac/u)
  assert.match(desktopBuild, /retention-days: 30/u)
})

test('performance evidence and signing use their existing isolated environments', async () => {
  const workflow = await readFile('.github/workflows/desktop-performance.yml', 'utf8')
  const { parse } = createRequire(resolve('packages/dsh/package.json'))('yaml')
  const parsed = parse(workflow)
  assert.equal(parsed.jobs.evidence.environment, 'performance-admission')
  assert.equal(parsed.jobs.admission.environment, 'r2-publish')
  assert.equal(parsed.jobs.admission.needs, 'evidence')
  const signer = parsed.jobs.admission.steps.find(step => step.id === 'admit')
  assert.equal(signer.uses, 'zyfjacksonchen-source/e-mate-desktop-publication/performance@cd7d223692b51e4e7a53db5759e1c2a9811febd0')
  assert.deepEqual([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/gu)].map(match => match[1]).sort(), [
    'EMATE_PROFILE_SIGNING_KEY_ID', 'EMATE_PROFILE_SIGNING_PRIVATE_KEY',
  ])
  assert.match(workflow, /test "\$\{GITHUB_REF_PROTECTED:-\}" = true/u)
  assert.match(workflow, /test "\$GITHUB_RUN_ATTEMPT" = 1/u)
  assert.match(workflow, /GITHUB_WORKFLOW_REF" = "\$GITHUB_REPOSITORY\/\.github\/workflows\/desktop-performance\.yml@refs\/heads\/main"/u)
  assert.match(workflow, /Desktop candidate installers are not owned by the selected CI run/u)
  assert.match(workflow, /CI_RUN_ID: \$\{\{ inputs\.main_ci_run_id \}\}/u)
  assert.doesNotMatch(workflow, /inputs\.ci_run_id/u)
  assert.match(workflow, /test "\$\(jq -er '\.path' <<<"\$run_json"\)" = \.github\/workflows\/ci\.yml/u)
  assert.doesNotMatch(workflow, /Build and verify the e-Mate profile|Build unsigned macOS universal disk image/u)
  assert.match(workflow, /files\.length !== 92/u)
  for (const leafId of PERFORMANCE_MODEL_LEAF_IDS) {
    assert.match(workflow, new RegExp(`e-mate-performance-evidence-${leafId}-\\$\\{\\{ github\\.sha \\}\\}-attempt-1`, 'u'))
    assert.match(workflow, new RegExp(`${leafId}-evidence-artifact-id:`, 'u'))
  }
  assert.doesNotMatch(workflow, /AWS_|ECOREX_R2_|R2_ACCESS|R2_SECRET|\b(?:aws|wrangler|s3api)\b|cloudflarestorage|desktop\/latest\.json/u)
})

test('Desktop publication workflow only emits the exact Cloudflare plugin handoff', async () => {
  const workflow = await readFile('.github/workflows/desktop-publication.yml', 'utf8')
  const { parse } = createRequire(resolve('packages/dsh/package.json'))('yaml')
  const parsed = parse(workflow)
  assert.deepEqual(Object.keys(parsed.on), ['workflow_dispatch'])
  assert.deepEqual(Object.keys(parsed.on.workflow_dispatch.inputs), [
    'main_ci_run_id', 'admission_artifact_id', 'macos_artifact_id',
    'windows_artifact_id', 'expected_signed_current', 'expected_legacy_current',
  ])
  assert.equal(Object.values(parsed.on.workflow_dispatch.inputs).every(input => input.required === true && input.type === 'string'), true)
  assert.deepEqual(Object.keys(parsed.jobs), ['handoff'])
  assert.deepEqual(parsed.permissions, { actions: 'read', contents: 'read' })
  const job = parsed.jobs.handoff
  assert.equal(job.name, 'Desktop Cloudflare plugin handoff')
  assert.equal(job.environment, 'r2-publish')
  const invocation = job.steps.find(step => step.id === 'prepare')
  assert.equal(invocation.uses, 'zyfjacksonchen-source/e-mate-desktop-publication@cd7d223692b51e4e7a53db5759e1c2a9811febd0')
  assert.deepEqual(invocation.with, {
    'source-sha': '${{ github.sha }}',
    'main-ci-run-id': '${{ inputs.main_ci_run_id }}',
    'admission-artifact-id': '${{ inputs.admission_artifact_id }}',
    'macos-artifact-id': '${{ inputs.macos_artifact_id }}',
    'windows-artifact-id': '${{ inputs.windows_artifact_id }}',
    'expected-signed-current': '${{ inputs.expected_signed_current }}',
    'expected-legacy-current': '${{ inputs.expected_legacy_current }}',
    'signing-key-id': '${{ secrets.EMATE_PROFILE_SIGNING_KEY_ID }}',
  })
  assert.deepEqual(invocation.env, {
    EMATE_GITHUB_PROVENANCE_TOKEN: '${{ github.token }}',
    EMATE_DESKTOP_SIGNING_PRIVATE_KEY_PEM: '${{ secrets.EMATE_PROFILE_SIGNING_PRIVATE_KEY }}',
  })
  assert.deepEqual(job.steps.filter(step => step.uses).map(step => step.uses), [
    'actions/setup-node@v6',
    'zyfjacksonchen-source/e-mate-desktop-publication@cd7d223692b51e4e7a53db5759e1c2a9811febd0',
    'actions/upload-artifact@v4',
  ])
  const upload = job.steps.find(step => step.uses === 'actions/upload-artifact@v4')
  assert.equal(upload.with.name, "${{ steps.prepare.outputs['artifact-name'] }}")
  assert.equal(upload.with.path, "${{ steps.prepare.outputs['artifact-path'] }}")
  assert.match(workflow, /GITHUB_REF_PROTECTED" = true/u)
  assert.match(workflow, /GITHUB_RUN_ATTEMPT" = 1/u)
  assert.match(workflow, /desktop-publication\.yml@refs\/heads\/main/u)
  assert.match(workflow, /ready-for-cloudflare-plugin/u)
  assert.match(workflow, /cloudflare-plugin-handoff\.json,cloudflare-publication-plan\.json,desktop-release-signed\.json/u)
  assert.doesNotMatch(workflow, /\b(?:curl|wget|wrangler|aws)\b|api\.cloudflare\.com|\.r2\.cloudflarestorage\.com|pub-ada3f610c0234a76838f4e19fe2bb25e\.r2\.dev/iu)
  assert.doesNotMatch(workflow, /secrets\.(?:CLOUDFLARE|R2|AWS)/iu)
})
