import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PERFORMANCE_MODEL_ROSTER, profilePublicationTreeSha256 } from './desktop-admission.mjs'
import {
  assertAcceptanceOwnerEnvironment,
  assertCapturedSourceLayout,
  assertInstalledAuthorities,
  createAcceptancePlan,
  createPairSchedule,
  finalizeAcceptanceCapture,
  loadProfileAcceptanceAuthority,
} from './performance-acceptance.mjs'

const sourceCommit = 'e'.repeat(40)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const ownerEnvironment = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REF_PROTECTED: 'true',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_SHA: sourceCommit,
  GITHUB_REPOSITORY: 'owner/repository',
  GITHUB_WORKFLOW_REF: 'owner/repository/.github/workflows/desktop-performance.yml@refs/heads/main',
}
const profileTargets = ['darwin-arm64', 'darwin-x64', 'win32-x64']

async function profileAuthorityFixture(root) {
  await mkdir(join(root, 'profile-publication'))
  const publicationRoot = await realpath(join(root, 'profile-publication'))
  await writeFile(join(publicationRoot, 'publication-plan.json'), '{}\n')
  const aggregate = {
    aggregate_sha256: '1'.repeat(64),
    inventory_sha256: '2'.repeat(64),
    staged_profile_tree_sha256: '3'.repeat(64),
    targets: profileTargets.map((target, index) => ({
      target,
      profile_generation: String(index + 4).repeat(64),
      component_aggregate_sha256: String(index + 7).repeat(64),
    })),
  }
  const aggregatePath = join(root, 'profile-component-aggregate.json')
  await writeFile(aggregatePath, `${JSON.stringify(aggregate)}\n`)
  const receipt = {
    schema_version: 1,
    document_type: 'emate.profile-performance-authorities',
    source_commit: sourceCommit,
    base_contract_id: 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0',
    publication_tree_sha256: await profilePublicationTreeSha256(publicationRoot),
    profile_component_aggregate_sha256: aggregate.aggregate_sha256,
    targets: aggregate.targets.map(target => ({
      target: target.target,
      profile_generation: target.profile_generation,
      composition_sha256: target.component_aggregate_sha256,
      client_bundle_sha256: 'a'.repeat(64),
    })),
  }
  const authorityPath = join(root, 'profile-performance-authorities.json')
  await writeFile(authorityPath, `${JSON.stringify(receipt)}\n`)
  return {
    publicationRoot,
    authorityPath,
    aggregatePath,
    authority: await loadProfileAcceptanceAuthority({ publicationRoot, authorityPath, aggregatePath, sourceCommit }),
  }
}

test('requires the exact protected-main one-shot owner', () => {
  assert.doesNotThrow(() => assertAcceptanceOwnerEnvironment(ownerEnvironment, sourceCommit))
  for (const mutation of [
    { GITHUB_ACTIONS: undefined },
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { GITHUB_SHA: 'f'.repeat(40) },
    { GITHUB_WORKFLOW_REF: 'owner/repository/.github/workflows/other.yml@refs/heads/main' },
  ]) {
    assert.throws(
      () => assertAcceptanceOwnerEnvironment({ ...ownerEnvironment, ...mutation }, sourceCommit),
      /exact protected-main one-shot workflow owner/u,
    )
  }
})

test('owns exactly 30 paired rows with balanced scenarios and AB/BA order', () => {
  const schedule = createPairSchedule('performance-test-run', 'ecorex-chat')
  assert.equal(schedule.length, 30)
  assert.equal(new Set(schedule.map(row => row.pair_id)).size, 30)
  for (const scenario of ['short-text', 'history-20', 'read-only-tool']) {
    const rows = schedule.filter(row => row.scenario === scenario)
    assert.equal(rows.length, 10)
    assert.deepEqual(new Set(rows.map(row => row.arm_order)), new Set(['AB', 'BA']))
  }
  assert.deepEqual(schedule[0].path_order, [
    'baseline', 'emate_online', 'emate_enterprise_unavailable_valid_cache',
  ])
  assert.deepEqual(schedule[1].path_order, [
    'emate_online', 'emate_enterprise_unavailable_valid_cache', 'baseline',
  ])
})

test('pins the closed four-model roster and both Harness identities in the probe plan', () => {
  const plan = createAcceptancePlan({
    sourceCommit,
    collectorSha256: 'a'.repeat(64),
    candidateArtifactsRoot: '/candidate',
    profileAuthority: { receipt: { targets: [] } },
    scratchRoot: '/scratch',
  })
  assert.equal(plan.harness_commit, 'b2b1650b01f0ee88d81837a9b5c050f9f763f606')
  assert.equal(plan.baseline_harness_commit, '2bc16230975f6cf02aa1b283b1f86de44007b059')
  assert.deepEqual(plan.models.map(model => model.performance_model), PERFORMANCE_MODEL_ROSTER)
  assert.equal(new Set(plan.models.map(model => model.performance_run_id)).size, 4)
  assert.ok(plan.models.every(model => model.expected_files.length === 18 && model.schedule.length === 30))
  assert.equal(plan.profile_artifacts_root, undefined)
  assert.deepEqual(plan.profile_authority, { receipt: { targets: [] } })
})

test('wires the one-shot producer before the existing exact-85 consumer', async () => {
  const workflow = await readFile(new URL('../.github/workflows/desktop-performance.yml', import.meta.url), 'utf8')
  const producer = workflow.indexOf('pnpm performance:acceptance')
  const consumer = workflow.indexOf('Copy only the exact source-partitioned production evidence')
  assert.ok(producer > 0 && consumer > producer)
  assert.match(workflow, /EMATE_PERFORMANCE_COLLECTOR_SHA256/u)
  assert.match(workflow, /--handoff "\$EVIDENCE_ROOT\/\$GITHUB_SHA"/u)
  assert.match(workflow, /PERFORMANCE_AUTHORITIES: \$\{\{ runner\.temp \}\}\/e-mate-profile-performance-authorities-\$\{\{ github\.sha \}\}\.json/u)
  assert.match(workflow, /--performance-authorities-out "\$PERFORMANCE_AUTHORITIES"/u)
  assert.match(workflow, /--profile-authorities "\$PERFORMANCE_AUTHORITIES"/u)
  assert.doesNotMatch(workflow, /\$STAGE_DIRECTORY\/profile-performance-authorities\.json/u)
  assert.doesNotMatch(workflow.slice(producer, consumer), /--fixture/u)
})

test('binds installed receipts to the frozen predecessor and exact Profile target', () => {
  const profile = {
    target: 'darwin-arm64',
    profile_generation: '4'.repeat(64),
    composition_sha256: '7'.repeat(64),
    client_bundle_sha256: 'a'.repeat(64),
  }
  const candidateRuntime = {
    source_commit: sourceCommit,
    base_contract_id: 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0',
    profile_generation: profile.profile_generation,
    composition_sha256: profile.composition_sha256,
    client_bundle_sha256: profile.client_bundle_sha256,
    desktop_artifact_sha256: '5'.repeat(64),
    desktop_artifact_bytes: 200,
  }
  const candidateInstall = {
    target: 'darwin-arm64', package_sha256: candidateRuntime.desktop_artifact_sha256, package_bytes: 200,
  }
  const baseline = {
    runtime: {
      source_commit: '9fbc70ad56c4f263dfa0aa0085f19eded134e32d',
      base_contract_id: 'e-mate-desktop-profile-v6-dsh-2bc16230975f',
      profile_generation: 'd8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93',
      desktop_artifact_sha256: 'd2cb459d2e8648213e0b38aa6e210c1a727937be77993b2493e2a7848d5d3b2e',
      desktop_artifact_bytes: 390_527_181,
    },
    install_receipt: {
      target: 'darwin-arm64',
      package_sha256: 'd2cb459d2e8648213e0b38aa6e210c1a727937be77993b2493e2a7848d5d3b2e',
      package_bytes: 390_527_181,
    },
  }
  const evidence = {
    paths: {
      baseline: { run_receipt: baseline },
      emate_online: { run_receipt: { runtime: candidateRuntime, install_receipt: candidateInstall } },
      emate_enterprise_unavailable_valid_cache: {
        run_receipt: {
          runtime: structuredClone(candidateRuntime), install_receipt: structuredClone(candidateInstall),
        },
      },
    },
  }
  const plan = { source_commit: sourceCommit, profile_authority: { receipt: { targets: [profile] } } }
  const candidate = { source_commit: sourceCommit, artifacts: { darwin: { sha256: '5'.repeat(64), bytes: 200 } } }
  assert.doesNotThrow(() => assertInstalledAuthorities(evidence, plan, candidate))
  const relabelled = structuredClone(evidence)
  relabelled.paths.baseline.run_receipt.runtime.source_commit = '4'.repeat(40)
  assert.throws(
    () => assertInstalledAuthorities(relabelled, plan, candidate),
    /does not match the frozen artifacts/u,
  )
  for (const mutate of [
    value => {
      value.paths.emate_online.run_receipt.install_receipt.target = 'darwin-x64'
      value.paths.emate_enterprise_unavailable_valid_cache.run_receipt.install_receipt.target = 'darwin-x64'
    },
    value => {
      value.paths.emate_online.run_receipt.runtime.profile_generation = 'b'.repeat(64)
      value.paths.emate_enterprise_unavailable_valid_cache.run_receipt.runtime.profile_generation = 'b'.repeat(64)
    },
    value => {
      value.paths.emate_online.run_receipt.runtime.composition_sha256 = 'b'.repeat(64)
      value.paths.emate_enterprise_unavailable_valid_cache.run_receipt.runtime.composition_sha256 = 'b'.repeat(64)
    },
    value => {
      value.paths.emate_online.run_receipt.runtime.client_bundle_sha256 = 'b'.repeat(64)
      value.paths.emate_enterprise_unavailable_valid_cache.run_receipt.runtime.client_bundle_sha256 = 'b'.repeat(64)
    },
  ]) {
    const drifted = structuredClone(evidence)
    mutate(drifted)
    assert.throws(
      () => assertInstalledAuthorities(drifted, plan, candidate),
      /does not match the frozen artifacts/u,
    )
  }
})

test('rejects a Profile root or receipt that drifts from its signed-publication authority', async t => {
  const root = await mkdtemp(join(tmpdir(), 'e-mate-profile-performance-authority-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixture = await profileAuthorityFixture(root)
  assert.equal(fixture.authority.receipt.targets.length, 3)
  await writeFile(join(fixture.publicationRoot, 'publication-plan.json'), '{"drift":true}\n')
  await assert.rejects(() => loadProfileAcceptanceAuthority({
    publicationRoot: fixture.publicationRoot,
    authorityPath: fixture.authorityPath,
    aggregatePath: fixture.aggregatePath,
    sourceCommit,
  }), /does not match the signed Profile publication aggregate/u)
})

test('accepts only one manifest plus the exact 17 source artifacts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'e-mate-performance-source-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const plan = createAcceptancePlan({
    sourceCommit,
    collectorSha256: 'a'.repeat(64),
    candidateArtifactsRoot: '/candidate',
    profileAuthority: { receipt: { targets: [] } },
    scratchRoot: root,
  })
  for (const name of plan.models[0].expected_files) await writeFile(join(root, name), '{}\n')
  await assert.doesNotReject(assertCapturedSourceLayout(root))
  await writeFile(join(root, 'fixture.json'), '{}\n')
  await assert.rejects(assertCapturedSourceLayout(root), /exactly one manifest and 17 source artifacts/u)
})

test('assembles four fixture-shaped capture trees into the exact production handoff layout', async t => {
  const root = await mkdtemp(join(tmpdir(), 'e-mate-performance-one-shot-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const scratchRoot = join(root, 'scratch')
  await mkdir(join(scratchRoot, 'models'), { recursive: true })
  const candidateRoot = join(root, 'candidate')
  await mkdir(candidateRoot)
  await writeFile(join(candidateRoot, 'desktop-candidate.json'), `${JSON.stringify({
    source_commit: sourceCommit,
    artifacts: {
      darwin: { sha256: '5'.repeat(64), bytes: 200 },
      win32: { sha256: '6'.repeat(64), bytes: 300 },
    },
  })}\n`)
  const collectorSha256 = 'a'.repeat(64)
  const profileFixture = await profileAuthorityFixture(root)
  const plan = createAcceptancePlan({
    sourceCommit,
    collectorSha256,
    candidateArtifactsRoot: candidateRoot,
    profileAuthority: profileFixture.authority,
    scratchRoot,
  })
  const json = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
  for (const model of plan.models) {
    const directory = join(scratchRoot, model.output_directory)
    await mkdir(directory, { recursive: true })
    const pairIds = model.schedule.map(row => row.pair_id)
    const sampleIdsSha256 = sha256(JSON.stringify(pairIds))
    const paths = {}
    for (const pathName of ['baseline', 'emate_online', 'emate_enterprise_unavailable_valid_cache']) {
      const candidate = pathName !== 'baseline'
      const prefix = pathName.replaceAll('_', '-')
      const binding = {
        schema_version: 2,
        performance_run_id: model.performance_run_id,
        path_name: pathName,
        sample_ids_sha256: sampleIdsSha256,
      }
      const samples = model.schedule.map((row, index) => {
        const attempts = row.scenario === 'read-only-tool' ? 2 : 1
        const requests = Array.from({ length: attempts }, (_, attempt) => ({
          ordinal: attempt + 1,
          request_header_sha256: sha256(`header:${model.leaf_id}:${row.pair_id}:${String(attempt + 1)}`),
          request_header_bytes: 100 + attempt,
          request_tool_count: row.scenario === 'read-only-tool' && attempt === 0 ? 1 : 0,
          ...(candidate ? { diagnostic: null } : {}),
        }))
        const providerAttempts = Array.from({ length: attempts }, (_, attempt) => ({
          ordinal: attempt + 1,
          provider_invocation_id_sha256: sha256(`invocation:${model.leaf_id}:${pathName}:${row.pair_id}:${String(attempt + 1)}`),
          provider_response_id_sha256: sha256(`response:${model.leaf_id}:${pathName}:${row.pair_id}:${String(attempt + 1)}`),
          provider_usage_sha256: sha256(`usage:${model.leaf_id}:${pathName}:${row.pair_id}:${String(attempt + 1)}`),
          input_tokens: 10,
          output_tokens: 10,
        }))
        return {
          pair_id: row.pair_id,
          scenario: row.scenario,
          arm_order: row.arm_order,
          session_id_sha256: sha256(`session:${model.leaf_id}:${pathName}:${row.pair_id}`),
          turn: 1,
          step: 1,
          user_message_to_first_text_delta_ms: 100,
          output_tokens_per_second: 100,
          queue_wait_ms: 1,
          duplicate_model_request_count: 0,
          duplicate_tool_execution_count: 0,
          duplicate_job_execution_count: 0,
          duplicate_deliverable_count: 0,
          ...(row.scenario === 'read-only-tool'
            ? { tool_result_to_next_request_ms: 1 }
            : {}),
          requests,
          provider_attempts: providerAttempts,
          submit_to_first_visible_text_ms: 100,
          first_chunk_to_paint_ms: 10,
        }
      })
      const nativeKeys = [
        'pair_id', 'scenario', 'arm_order', 'session_id_sha256', 'turn', 'step',
        'user_message_to_first_text_delta_ms', 'output_tokens_per_second', 'queue_wait_ms',
        'duplicate_model_request_count', 'duplicate_tool_execution_count',
        'duplicate_job_execution_count', 'duplicate_deliverable_count',
      ]
      const pick = (sample, keys) => Object.fromEntries(keys.map(key => [key, sample[key]]))
      await json(join(directory, `${prefix}.native.json`), {
        ...binding,
        kind: 'native-session-trace',
        source: 'dsh-session-events',
        samples: samples.map(sample => pick(sample, sample.scenario === 'read-only-tool'
          ? [...nativeKeys, 'tool_result_to_next_request_ms']
          : nativeKeys)),
      })
      await json(join(directory, `${prefix}.provider.json`), {
        ...binding,
        kind: 'provider-invocation-receipt',
        source: 'managed-provider-receipts',
        provider: model.performance_model.provider,
        model: model.performance_model.model,
        reasoning_level: model.performance_model.reasoning_effort,
        samples: samples.map(sample => pick(sample, ['pair_id', 'provider_attempts'])),
      })
      await json(join(directory, `${prefix}.headers.json`), {
        ...binding,
        kind: 'request-headers',
        source: 'dsh-request-header-waterfall',
        samples: samples.map(sample => pick(sample, ['pair_id', 'requests'])),
      })
      await json(join(directory, `${prefix}.paint.json`), {
        ...binding,
        kind: 'renderer-paint-trace',
        source: 'desktop-renderer-paint',
        samples: samples.map(sample => pick(sample, [
          'pair_id', 'submit_to_first_visible_text_ms', 'first_chunk_to_paint_ms',
        ])),
      })
      const runtime = {
        product: 'e-mate-desktop',
        product_version: candidate ? '2.0.13' : '2.0.12',
        source_commit: candidate ? sourceCommit : '9fbc70ad56c4f263dfa0aa0085f19eded134e32d',
        desktop_reference_commit: '6074088f5b660206e404b3591fab51fb99c69add',
        base_contract_id: candidate
          ? 'e-mate-desktop-profile-v7-dsh-b2b1650b01f0'
          : 'e-mate-desktop-profile-v6-dsh-2bc16230975f',
        profile_generation: candidate
          ? plan.profile_authority.receipt.targets[0].profile_generation
          : 'd8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93',
        composition_sha256: candidate ? plan.profile_authority.receipt.targets[0].composition_sha256 : '2'.repeat(64),
        client_bundle_sha256: candidate ? plan.profile_authority.receipt.targets[0].client_bundle_sha256 : '4'.repeat(64),
        desktop_artifact_sha256: candidate
          ? '5'.repeat(64)
          : 'd2cb459d2e8648213e0b38aa6e210c1a727937be77993b2493e2a7848d5d3b2e',
        desktop_artifact_bytes: candidate ? 200 : 390_527_181,
      }
      await json(join(directory, `${prefix}.installed.json`), {
        ...binding,
        kind: 'installed-runtime-receipt',
        source: 'installed-application',
        runtime,
        install_receipt: {
          installation_kind: 'installed-application',
          target: 'darwin-arm64',
          bundle_id: 'com.emate.desktop',
          package_sha256: runtime.desktop_artifact_sha256,
          package_bytes: runtime.desktop_artifact_bytes,
          installed_executable_sha256: candidate ? '7'.repeat(64) : '8'.repeat(64),
          installed_executable_bytes: 50,
          installed_at: '2026-08-25T23:59:00.000Z',
          launched_at: '2026-08-26T00:00:00.000Z',
        },
      })
      if (candidate) {
        await json(join(directory, `${prefix}.enterprise.json`), {
          ...binding,
          kind: 'enterprise-runtime-receipt',
          source: 'e-mate-enterprise-state',
          receipt: {
            lease_sha256: '9'.repeat(64),
            model_policy_sha256: 'b'.repeat(64),
            audit_outbox_sha256: pathName === 'emate_online' ? 'c'.repeat(64) : 'd'.repeat(64),
          },
        })
      }
      paths[pathName] = {
        tool: `e-mate-performance-probe@sha256:${collectorSha256}`,
        dataset_sha256: 'e'.repeat(64),
        acceptance_identity_sha256: 'f'.repeat(64),
        started_at: '2026-08-26T00:00:00.000Z',
        finished_at: '2026-08-26T01:00:00.000Z',
        environment: {
          machine_id_sha256: 'a'.repeat(64),
          os: 'macOS',
          arch: 'arm64',
          node: '24.19.0',
          browser: '149',
          network_profile: 'fixed',
        },
        native_trace_artifact: `${prefix}.native.json`,
        provider_receipt_artifact: `${prefix}.provider.json`,
        request_header_artifact: `${prefix}.headers.json`,
        renderer_paint_artifact: `${prefix}.paint.json`,
        installed_runtime_artifact: `${prefix}.installed.json`,
        ...(candidate ? {
          enterprise_state: pathName === 'emate_online'
            ? { endpoint: 'available', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox' }
            : { endpoint: 'unavailable', lease: 'valid-cached', model_policy: 'valid-cached', audit: 'async-outbox' },
          enterprise_receipt_artifact: `${prefix}.enterprise.json`,
        } : {}),
      }
    }
    await json(join(directory, 'manifest.json'), {
      schema_version: 2,
      comparison_kind: 'installed-2.0.12-vs-2.0.13',
      performance_run_id: model.performance_run_id,
      evidence_kind: 'production-real-provider',
      harness_commit: plan.harness_commit,
      baseline_harness_commit: plan.baseline_harness_commit,
      performance_model: model.performance_model,
      paths,
    })
  }
  const handoff = await finalizeAcceptanceCapture(plan, join(root, 'handoff'))
  const evidence = JSON.parse(await readFile(
    join(handoff, 'models', 'ecorex-chat', 'e-mate-performance-evidence.json'),
    'utf8',
  ))
  assert.equal(evidence.decision.gate_status, 'passed')
  assert.equal(evidence.baseline_harness_commit, plan.baseline_harness_commit)
  assert.deepEqual(evidence.performance_model, PERFORMANCE_MODEL_ROSTER[0])
})
