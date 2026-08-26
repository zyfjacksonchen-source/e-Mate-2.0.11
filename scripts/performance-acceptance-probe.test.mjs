import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  assertNoPrivatePayload,
  assertExactRequestCardinality,
  assertOfflineValidCacheBoundary,
  assertProbePlan,
  acquireSingleRunLock,
  buildCdpPreBootstrapScript,
  deriveAuthoritySample,
  loadFrozenBaselineBaseContract,
  loadRunnerPrivateConfig,
  nativeAuditStatusSha256,
  installVerifiedProfileTemplate,
  ownedExecutionSchedule,
  parseMuxAssistantTextDelta,
  prepareDarwinRuntimeLane,
  releaseRuntimeLane,
  runRunnerBroker,
  strictJoinUsageAttempts,
  verifyRuntimeProfileBinding,
  writePrivateFailureLog,
} from './performance-acceptance-probe.mjs'
import { loadProfileBaseContract } from '../desktop/e-mate-desktop/src/profile-release.ts'

const digest = 'a'.repeat(64)
const performanceRunId = 'performance-run-0001'
const sha256 = value => createHash('sha256').update(value).digest('hex')

test('uses one renderer performance clock through trusted send, chunk, text, and double-rAF paint', () => {
  const script = buildCdpPreBootstrapScript()
  assert.match(script, /event\.isTrusted/u)
  assert.match(script, /firstChunkAt = performance\.now\(\)/u)
  assert.match(script, /firstTextAt = performance\.now\(\)/u)
  assert.match(script, /requestAnimationFrame\(\(\) => requestAnimationFrame/u)
  assert.match(script, /\[data-conversation-scroll\]/u)
  assert.match(script, /\[data-composer-seat\] \[data-composer-card\]/u)
  assert.match(script, /textarea:enabled/u)
  assert.match(script, /data-chat-flow-kind="assistant-step"/u)
  assert.match(script, /payload\.type !== 'session\/event'/u)
  assert.match(script, /previous performance sample was not reset/u)
  assert.doesNotMatch(script, /Send message|发送消息/u)
  assert.doesNotMatch(script, /data-performance-send|data-current-turn/u)
  assert.doesNotMatch(script, /Date\.now|textContent\s*:/u)
})

test('parses the exact string ServerRequest mux transport and rejects binary or malformed frames', () => {
  const frame = JSON.stringify({
    type: 'server-request', rpcId: 'rpc-1', method: 'session/event',
    payload: {
      type: 'session/event', sessionId: 'session-1',
      event: { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'x' } } },
    },
  })
  const target = { sessionId: 'session-1', turn: 1, step: 1 }
  assert.equal(parseMuxAssistantTextDelta(frame, target), true)
  assert.equal(parseMuxAssistantTextDelta(frame, { ...target, sessionId: 'session-2' }), false)
  assert.equal(parseMuxAssistantTextDelta(frame, { ...target, step: 2 }), false)
  assert.throws(() => parseMuxAssistantTextDelta(Buffer.from(frame), target), /binary frame/u)
  assert.throws(() => parseMuxAssistantTextDelta('{', target), /malformed JSON/u)
  assert.throws(() => parseMuxAssistantTextDelta(JSON.stringify({
    type: 'server-request', rpcId: 'rpc-1', method: 'wrong', payload: { type: 'session/event' },
  }), target), /ServerRequest envelope/u)
})

test('joins native attempts and usage only by the exact dedicated scope and ids', () => {
  const common = {
    occurredAt: '2026-08-26T00:00:01.000Z', userId: 'acceptance', taskId: 'task-1',
    traceId: 'trace-1', modelId: 'deepseek-chat', providerId: 'deepseek',
  }
  const old = { ...common, kind: 'REQUEST', eventId: 'old-event', taskId: 'old-task', outcome: 'ACCOUNTED' }
  const request = { ...common, kind: 'REQUEST', eventId: 'request-1', outcome: 'ACCOUNTED' }
  const usage = { ...common, kind: 'USAGE', eventId: 'response-1', inputTokens: '4', outputTokens: '2' }
  const joined = strictJoinUsageAttempts({
    account: 'acceptance', model: 'deepseek-chat', provider: 'deepseek', account_exclusive: true,
    performance_run_id: performanceRunId, max_parallel: 1, expected_attempts: 1, before_events: [old], events: [old, request, usage],
  })
  assert.equal(joined.length, 1)
  assert.equal(joined[0].ordinal, 1)
  assert.notEqual(joined[0].provider_invocation_id_sha256, joined[0].provider_response_id_sha256)
  assert.throws(() => strictJoinUsageAttempts({
    account: 'acceptance', model: 'deepseek-chat', provider: 'deepseek', account_exclusive: true,
    performance_run_id: performanceRunId, max_parallel: 1, expected_attempts: 1, before_events: [old], events: [old, request],
  }), /extra or missing events/u)
  assert.throws(() => strictJoinUsageAttempts({
    account: 'acceptance', model: 'deepseek-chat', provider: 'deepseek', account_exclusive: true,
    performance_run_id: performanceRunId, max_parallel: 1, expected_attempts: 1, before_events: [old],
    events: [old, request, usage, { ...request, eventId: 'request-2', taskId: 'foreign-task' }],
  }), /extra or missing events/u)
  assert.throws(() => strictJoinUsageAttempts({
    account: 'acceptance', model: 'deepseek-chat', provider: 'deepseek', account_exclusive: true,
    performance_run_id: performanceRunId, max_parallel: 1, expected_attempts: 1, before_events: [old], events: [request, usage],
  }), /cursor history changed/u)
  assert.throws(() => strictJoinUsageAttempts({
    account: 'acceptance', model: 'deepseek-chat', provider: 'deepseek', account_exclusive: false,
    performance_run_id: performanceRunId, max_parallel: 1, expected_attempts: 1, before_events: [], events: [request, usage],
  }), /exclusive acceptance account/u)
  assert.doesNotThrow(() => assertExactRequestCardinality('short-text', ['request-1'], []))
  assert.doesNotThrow(() => assertExactRequestCardinality(
    'read-only-tool', ['request-1', 'request-2'], ['tool-1'],
  ))
  assert.throws(() => assertExactRequestCardinality('read-only-tool', ['request-1'], ['tool-1']), /cardinality/u)
})

test('offline-valid-cache cuts only auth and policy control plane', () => {
  const online = {
    endpoint: 'available', lease_sha256: digest, model_policy_sha256: 'b'.repeat(64),
    audit_status_sha256: 'd'.repeat(64),
    lease_refreshed_at: '2026-08-26T00:00:00.000Z', policy_refreshed_at: '2026-08-26T00:00:00.000Z',
  }
  const offline = {
    ...online, endpoint: 'unavailable', inference_gateway: 'available',
    finished_at: '2026-08-26T00:05:00.000Z', lease_expires_at: '2026-08-26T01:00:00.000Z',
    policy_expires_at: '2026-08-26T01:00:00.000Z', audit_status_sha256: 'c'.repeat(64),
  }
  assert.equal(assertOfflineValidCacheBoundary(online, offline).lease_sha256, digest)
  assert.throws(() => assertOfflineValidCacheBoundary(online, {
    ...offline, inference_gateway: 'unavailable',
  }), /isolate only/u)
})

test('hashes only the closed native audit.status projection', () => {
  const status = {
    schema_version: 1, pending: 1, delivered: 2, blocked: 0,
    pending_tokens: 3, delivered_tokens: 4,
    task_events_pending: 5, task_events_delivered: 6,
  }
  assert.match(nativeAuditStatusSha256(status), /^[0-9a-f]{64}$/u)
  assert.throws(() => nativeAuditStatusSha256({ ...status, audit_outbox_sha256: digest }), /invalid closed status/u)
})

test('derives one duplicate-free sample from native Session, full Usage delta, and renderer authorities', () => {
  const common = {
    occurredAt: '2026-08-26T00:00:01.000Z', userId: 'acceptance',
    traceId: 'trace-1', modelId: 'gpt-5.6-luna', providerId: 'e-mate-enterprise',
  }
  const request = { ...common, kind: 'REQUEST', eventId: 'invocation-1', taskId: 'task-1', outcome: 'ACCOUNTED' }
  const usage = { ...common, kind: 'USAGE', eventId: 'response-1', taskId: 'task-1', inputTokens: '4', outputTokens: '2' }
  const events = [
    { type: 'agent/inbox/spliced', seq: 0, time: 100, data: { inserted: [{ id: 'message-1' }] } },
    { type: 'turn/start', seq: 1, time: 110, data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: 115, data: { id: 'message-1' } },
    { type: 'step/start', seq: 3, time: 120, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', seq: 4, time: 200, data: { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'x' } } },
    { type: 'assistant/message', seq: 5, time: 300, data: { turn: 1, step: 1, usage: { outputTokens: 10 } } },
  ]
  const sample = deriveAuthoritySample({
    performance_run_id: performanceRunId,
    pair_id: 'pair-1', scenario: 'short-text', arm_order: 'AB', path_name: 'emate_online',
    path_execution_ordinal: 1,
    session_id: 'session-1', message_id: 'message-1', turn: 1, step: 1, events,
    request_attempts: [{ ordinal: 1, turn: 1, step: 1, request_id: 'unused', effective_header: { tools: [] }, diagnostic: null }],
    usage_before_events: [], usage_after_events: [request, usage],
    account: 'acceptance', account_exclusive: true, max_parallel: 1,
    model: 'gpt-5.6-luna', provider: 'e-mate-enterprise',
    job_execution_count: 0, deliverable_count: 0,
    paint: { submit_to_first_visible_text_ms: 90, first_chunk_to_paint_ms: 10 },
  })
  assert.equal(sample.native.user_message_to_first_text_delta_ms, 85)
  assert.equal(sample.native.output_tokens_per_second, 100)
  assert.equal(sample.native.queue_wait_ms, 10)
  assert.equal(sample.headers.requests[0].request_id_sha256, sample.provider.provider_attempts[0].request_id_sha256)
  assert.equal(sample.native.tool_result_to_next_request_ms, undefined)
  assert.equal(Object.values(sample.native).some(value => value === 'session-1'), false)
})

test('derives only the observable tool/result to next request boundary', () => {
  const usageEvents = [1, 2].flatMap(index => {
    const common = {
      occurredAt: `2026-08-26T00:00:0${String(index)}.000Z`, userId: 'acceptance',
      taskId: `task-${String(index)}`, traceId: 'trace-1', modelId: 'gpt-5.6-luna',
      providerId: 'e-mate-enterprise',
    }
    return [
      { ...common, kind: 'REQUEST', eventId: `invocation-${String(index)}`, outcome: 'ACCOUNTED' },
      { ...common, kind: 'USAGE', eventId: `response-${String(index)}`, inputTokens: '4', outputTokens: '2' },
    ]
  })
  const events = [
    { type: 'agent/inbox/spliced', seq: 0, time: 100, data: { inserted: [{ id: 'message-1' }] } },
    { type: 'turn/start', seq: 1, time: 110, data: { turn: 1 } },
    { type: 'user/message', seq: 2, time: 115, data: { id: 'message-1' } },
    { type: 'step/start', seq: 3, time: 120, data: { turn: 1, step: 1 } },
    { type: 'tool/call', seq: 4, time: 150, data: { turn: 1, step: 1, callId: 'call-1' } },
    { type: 'tool/result', seq: 5, time: 180, data: { turn: 1, step: 1, callId: 'call-1', isError: false } },
    { type: 'step/start', seq: 6, time: 190, data: { turn: 1, step: 2 } },
    { type: 'assistant/chunk', seq: 7, time: 250, data: { turn: 1, step: 2, chunk: { type: 'text-delta', text: 'x' } } },
    { type: 'assistant/message', seq: 8, time: 350, data: { turn: 1, step: 2, usage: { outputTokens: 10 } } },
  ]
  const sample = deriveAuthoritySample({
    performance_run_id: performanceRunId,
    pair_id: 'pair-2', scenario: 'read-only-tool', arm_order: 'BA', path_name: 'baseline',
    path_execution_ordinal: 1,
    session_id: 'session-2', message_id: 'message-1', turn: 1, step: 2, events,
    request_attempts: [1, 2].map(step => ({ ordinal: step, turn: 1, step, request_id: `unused-${step}`, effective_header: { tools: [{ name: 'read' }] } })),
    usage_before_events: [], usage_after_events: usageEvents,
    account: 'acceptance', account_exclusive: true, max_parallel: 1,
    model: 'gpt-5.6-luna', provider: 'e-mate-enterprise',
    job_execution_count: 0, deliverable_count: 0,
    paint: { submit_to_first_visible_text_ms: 150, first_chunk_to_paint_ms: 10 },
  })
  assert.equal(sample.native.tool_result_to_next_request_ms, 10)
  assert.equal('tool_call_to_start_ms' in sample.native, false)
  assert.equal(sample.provider.provider_attempts.length, 2)
})

test('accepts only canonical owner-only runner config with references, never credentials', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'e-mate-performance-config-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'config.json')
  const config = {
    schema_version: 1,
    runner_scope: 'dedicated-performance-runner',
    max_parallel_runs: 1,
    acceptance_identity: { authority: 'os-keychain', reference: 'e-mate-performance-identity' },
    admin_usage_exporter: { authority: 'local-secret-broker', reference: 'e-mate-usage-exporter' },
    offline_control: { authority: 'local-firewall-broker', reference: 'e-mate-offline-control' },
    installation_root: root,
  }
  await writeFile(path, `${JSON.stringify(config)}\n`, { mode: 0o600 })
  await mkdir(join(root, 'brokers'), { mode: 0o700 })
  for (const name of ['e-mate-usage-exporter', 'e-mate-offline-control']) {
    await writeFile(join(root, 'brokers', name), '#!/bin/sh\nread ignored\nprintf \'{"ok":true,"action":"%s"}\\n\' "$1"\n', { mode: 0o700 })
  }
  assert.deepEqual(await loadRunnerPrivateConfig(path), config)
  assert.deepEqual(await runRunnerBroker(path, 'e-mate-usage-exporter', 'usage-snapshot', {
    account: 'acceptance', model: 'gpt-5.6-luna', provider: 'e-mate-enterprise',
  }), { ok: true, action: 'usage-snapshot' })
  await assert.rejects(
    runRunnerBroker(path, 'e-mate-usage-exporter', 'unknown', {}),
    /outside the closed acceptance protocol/u,
  )
  const release = await acquireSingleRunLock(path)
  await assert.rejects(acquireSingleRunLock(path), /another performance acceptance probe/u)
  await release()
  await chmod(path, 0o644)
  await assert.rejects(loadRunnerPrivateConfig(path), /owner-only/u)
  assert.throws(() => assertNoPrivatePayload({ prompt: 'private' }), /not allowed/u)
})

test('always releases the one-shot owner lock and records only an owner-private failure', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'e-mate-performance-cleanup-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const configPath = join(root, 'performance-probe.json')
  await writeFile(configPath, '{}\n', { mode: 0o600 })
  let released = false
  await assert.rejects(releaseRuntimeLane({
    cleanup: async () => { throw new Error('runtime cleanup failed') },
  }, async () => { released = true }), /runtime cleanup failed/u)
  assert.equal(released, true)
  const logPath = await writePrivateFailureLog(configPath, new Error('diagnostic failure'))
  const info = await lstat(logPath)
  assert.equal(info.isFile(), true)
  assert.equal(info.mode & 0o077, 0)
  assert.match(await readFile(logPath, 'utf8'), /diagnostic failure/u)
})

test('prepares exact frozen and candidate macOS application bytes with read-only DMG cleanup', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'e-mate-performance-darwin-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const app = async (path, executable) => {
    await mkdir(join(path, 'Contents/MacOS'), { recursive: true, mode: 0o700 })
    await writeFile(join(path, 'Contents/Info.plist'), '<plist/>\n')
    await writeFile(join(path, 'Contents/MacOS/e-Mate'), executable, { mode: 0o700 })
  }
  const baselineApp = join(root, 'baseline/e-Mate.app')
  await app(baselineApp, 'baseline-executable')
  const baselineExecutable = Buffer.from('baseline-executable')
  const receiptPath = join(root, 'baseline/installed-runtime.json')
  const installedReceipt = {
    kind: 'installed-runtime-receipt',
    runtime: {
      product: 'e-mate-desktop', product_version: '2.0.12',
      source_commit: '9fbc70ad56c4f263dfa0aa0085f19eded134e32d',
      base_contract_id: 'e-mate-desktop-profile-v6-dsh-2bc16230975f',
      profile_generation: 'd8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93',
      desktop_artifact_sha256: 'd2cb459d2e8648213e0b38aa6e210c1a727937be77993b2493e2a7848d5d3b2e',
      desktop_artifact_bytes: 390_527_181,
    },
    install_receipt: {
      installation_kind: 'installed-application', target: 'darwin-arm64', bundle_id: 'com.emate.desktop',
      package_sha256: 'd2cb459d2e8648213e0b38aa6e210c1a727937be77993b2493e2a7848d5d3b2e',
      package_bytes: 390_527_181,
      installed_executable_sha256: sha256(baselineExecutable), installed_executable_bytes: baselineExecutable.byteLength,
    },
  }
  await writeFile(receiptPath, `${JSON.stringify(installedReceipt)}\n`, { mode: 0o600 })
  const candidateRoot = join(root, 'artifacts')
  const sourceApp = join(root, 'candidate-source/e-Mate.app')
  await Promise.all([mkdir(candidateRoot, { mode: 0o700 }), app(sourceApp, 'candidate-executable')])
  const dmg = Buffer.from('candidate-dmg')
  await writeFile(join(candidateRoot, 'e-Mate-2.0.13-mac-universal.dmg'), dmg)
  await writeFile(join(candidateRoot, 'desktop-candidate.json'), `${JSON.stringify({
    source_commit: 'e'.repeat(40), version: '2.0.13',
    artifacts: { darwin: { build_source_commit: 'e'.repeat(40), sha256: sha256(dmg), bytes: dmg.byteLength } },
  })}\n`)
  const plan = {
    source_commit: 'e'.repeat(40), candidate_artifacts_root: candidateRoot,
    profile_authority: { receipt: { targets: [{
      target: 'darwin-arm64', profile_generation: '1'.repeat(64),
      composition_sha256: '2'.repeat(64), client_bundle_sha256: '3'.repeat(64),
    }] } },
  }
  const options = {
    platform: 'darwin', arch: 'arm64',
    prepareProfiles: async () => ({
      baseline: { generation: 'd8769641262169a3b53369030a236f573e71499c22893d279e0a0c42df20ac93' },
      candidate: { generation: '1'.repeat(64) },
    }),
    run: async (executable, args) => {
      if (executable.endsWith('plutil') && args[0] === '-extract') return 'net.ecoremedia.e-mate\n'
      if (executable.endsWith('hdiutil') && args[0] === 'attach') {
        await cp(sourceApp, join(args[args.indexOf('-mountpoint') + 1], 'e-Mate.app'), { recursive: true })
      } else if (executable.endsWith('ditto')) await cp(args[0], args[1], { recursive: true })
    },
  }
  await assert.rejects(
    prepareDarwinRuntimeLane(plan, { installation_root: root }, options),
    /installed runtime receipt does not match/u,
  )
  installedReceipt.install_receipt.bundle_id = 'net.ecoremedia.e-mate'
  await writeFile(receiptPath, `${JSON.stringify(installedReceipt)}\n`)
  const lane = await prepareDarwinRuntimeLane(plan, { installation_root: root }, options)
  assert.equal(lane.target, 'darwin-arm64')
  assert.equal(lane.baseline.receipt.install_receipt.bundle_id, 'net.ecoremedia.e-mate')
  assert.equal(lane.candidate.receipt.install_receipt.bundle_id, 'net.ecoremedia.e-mate')
  assert.equal(lane.candidate.receipt.runtime.profile_generation, '1'.repeat(64))
  assert.equal(lane.candidate.receipt.install_receipt.package_sha256, sha256(dmg))
  await lane.cleanup()
})

test('accepts only the byte-exact pre-floor v6 Base as an in-memory floor-0 view', async t => {
  const fixture = fileURLToPath(new URL('fixtures/performance/v6-base-contract.json', import.meta.url))
  const base = await loadFrozenBaselineBaseContract(fixture)
  assert.equal(base.id, 'e-mate-desktop-profile-v6-dsh-2bc16230975f')
  assert.equal(base.harness_commit, '2bc16230975f6cf02aa1b283b1f86de44007b059')
  assert.equal(base.schedule_protocol_floor, 0)
  assert.throws(() => loadProfileBaseContract(fixture), /Base contract is invalid/u)

  const root = await realpath(await mkdtemp(join(tmpdir(), 'e-mate-v6-base-negative-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const incomplete = JSON.parse(await readFile(fixture, 'utf8'))
  delete incomplete.profile_format
  const incompletePath = join(root, 'base-contract.json')
  await writeFile(incompletePath, `${JSON.stringify(incomplete, null, 2)}\n`)
  await assert.rejects(
    loadFrozenBaselineBaseContract(incompletePath),
    /identity drifted/u,
  )
})

test('copies only one verified preinstalled Profile closure and rejects symlinked stores', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'e-mate-profile-template-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const generation = '1'.repeat(64)
  const manifest = '2'.repeat(64)
  const source = join(root, 'source')
  await mkdir(join(source, 'store/generations', generation), { recursive: true })
  await mkdir(join(source, 'store/components', manifest), { recursive: true })
  await writeFile(join(source, 'state.json'), `${JSON.stringify({
    schema_version: 1, active: generation, last_known_good: generation,
  })}\n`)
  await writeFile(join(source, 'store/generations', generation, 'release.json'), '{}\n')
  await writeFile(join(source, 'store/components', manifest, 'payload'), 'verified\n')
  const release = { payload: { components: [{ manifest_sha256: manifest }] } }
  const load = async options => {
    await realpath(join(options.root, 'generations', generation, 'release.json'))
    await realpath(join(options.root, 'components', manifest, 'payload'))
    return { id: generation, release }
  }
  const installed = await installVerifiedProfileTemplate({
    source,
    destination: join(root, 'destination'),
    generation,
    base: {},
    expected_component_ids: ['@e-mate/component'],
    target: { platform: 'darwin', arch: 'arm64' },
    load,
  })
  assert.equal(installed.generation, generation)
  await symlink(join(source, 'store/components', manifest, 'payload'), join(source, 'store/escape'))
  await assert.rejects(installVerifiedProfileTemplate({
    source,
    destination: join(root, 'rejected'),
    generation,
    base: {},
    expected_component_ids: ['@e-mate/component'],
    target: { platform: 'darwin', arch: 'arm64' },
    load,
  }), /symlink or escaping path/u)
})

test('fails closed when the launched app falls back to bundled Profile state or a mismatched DSH receipt', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'e-mate-running-profile-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const generation = '3'.repeat(64)
  const userData = join(root, 'user-data')
  const home = join(root, 'dsh-home')
  await mkdir(join(userData, 'profile-generations/store'), { recursive: true })
  await mkdir(join(home, 'profiles/e-mate'), { recursive: true })
  const statePath = join(userData, 'profile-generations/state.json')
  const receiptPath = join(home, 'profiles/e-mate/.e-mate-install.json')
  const state = { schema_version: 1, active: generation, last_known_good: generation }
  const receipt = {
    schema_version: 2, version: '2.0.13', harness_commit: 'a'.repeat(40),
    dsh_home: resolve(home), source_root: resolve(root), profile_generation: generation,
    managed_package_layout: 'linked-v1',
  }
  await writeFile(statePath, `${JSON.stringify(state)}\n`)
  await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`)
  const selected = { profile: {
    generation, base: { harness_commit: 'a'.repeat(40) }, expected_component_ids: [],
    target: { platform: 'darwin', arch: 'arm64' },
  } }
  await assert.doesNotReject(verifyRuntimeProfileBinding(selected, userData, home, async () => ({})))
  await writeFile(statePath, `${JSON.stringify({ schema_version: 1, active: 'bundled', last_known_good: 'bundled' })}\n`)
  await assert.rejects(
    verifyRuntimeProfileBinding(selected, userData, home, async () => ({})),
    /exact accepted Profile generation/u,
  )
  await writeFile(statePath, `${JSON.stringify(state)}\n`)
  await writeFile(receiptPath, `${JSON.stringify({ ...receipt, profile_generation: '4'.repeat(64) })}\n`)
  await assert.rejects(
    verifyRuntimeProfileBinding(selected, userData, home, async () => ({})),
    /receipt does not match/u,
  )
})

test('requires the running bytes to equal the owner-verified collector digest', () => {
  const plan = {
    schema_version: 1,
    mode: 'production-installed-performance-acceptance',
    source_commit: 'e'.repeat(40),
    collector_sha256: digest,
    workflow_owner: {
      repository: 'zyfjacksonchen-source/e-Mate-2.0.11',
      workflow_ref: 'zyfjacksonchen-source/e-Mate-2.0.11/.github/workflows/desktop-performance.yml@refs/heads/main',
      run_id: '123', run_attempt: 1, source_commit: 'e'.repeat(40),
    },
    models: Array.from({ length: 4 }, () => ({
      schedule: Array.from({ length: 30 }, () => ({})),
      expected_files: Array.from({ length: 18 }, () => 'artifact'),
    })),
  }
  const environment = { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'e'.repeat(40) }
  assert.doesNotThrow(() => assertProbePlan(plan, digest, environment))
  assert.throws(() => assertProbePlan(plan, 'b'.repeat(64), environment), /protected-main source bytes/u)
})

test('executes every owned AB/BA path in the actual declared order', () => {
  const schedule = Array.from({ length: 30 }, (_, index) => ({
    pair_id: `pair-${String(index + 1)}`,
    arm_order: index % 2 === 0 ? 'AB' : 'BA',
    path_order: index % 2 === 0
      ? ['baseline', 'emate_online', 'emate_enterprise_unavailable_valid_cache']
      : ['emate_online', 'emate_enterprise_unavailable_valid_cache', 'baseline'],
  }))
  const executions = ownedExecutionSchedule({ schedule })
  assert.equal(executions.length, 90)
  assert.deepEqual(executions.slice(0, 6).map(item => [item.path_name, item.path_execution_ordinal]), [
    ['baseline', 1], ['emate_online', 1], ['emate_enterprise_unavailable_valid_cache', 1],
    ['emate_online', 2], ['emate_enterprise_unavailable_valid_cache', 2], ['baseline', 2],
  ])
  const drift = structuredClone(schedule)
  drift[0].path_order.reverse()
  assert.throws(() => ownedExecutionSchedule({ schedule: drift }), /path order drifted/u)
})
