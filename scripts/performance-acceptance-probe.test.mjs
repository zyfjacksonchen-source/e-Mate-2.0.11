import assert from 'node:assert/strict'
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assertNoPrivatePayload,
  assertExactRequestCardinality,
  assertOfflineValidCacheBoundary,
  assertProbePlan,
  acquireSingleRunLock,
  buildCdpPreBootstrapScript,
  loadRunnerPrivateConfig,
  strictJoinUsageAttempts,
} from './performance-acceptance-probe.mjs'

const digest = 'a'.repeat(64)

test('uses one renderer performance clock through trusted send, chunk, text, and double-rAF paint', () => {
  const script = buildCdpPreBootstrapScript()
  assert.match(script, /event\.isTrusted/u)
  assert.match(script, /firstChunkAt = performance\.now\(\)/u)
  assert.match(script, /firstTextAt = performance\.now\(\)/u)
  assert.match(script, /requestAnimationFrame\(\(\) => requestAnimationFrame/u)
  assert.doesNotMatch(script, /Date\.now|textContent\s*:/u)
})

test('joins native attempts and usage only by the exact dedicated scope and ids', () => {
  const attempt = {
    account: 'acceptance', model: 'deepseek-chat', scope: 'run-1', cursor: 'cursor-1',
    request_id: 'request-1', provider_invocation_id: 'invocation-1', provider_response_id: 'response-1',
  }
  const event = { ...attempt, usage: { input_tokens: 4, output_tokens: 2 } }
  const joined = strictJoinUsageAttempts({
    account: attempt.account, model: attempt.model, scope: attempt.scope, cursor: attempt.cursor,
    attempts: [attempt], events: [event],
  })
  assert.equal(joined.length, 1)
  assert.notEqual(joined[0].request_id_sha256, joined[0].provider_response_id_sha256)
  assert.throws(() => strictJoinUsageAttempts({
    account: attempt.account, model: attempt.model, scope: attempt.scope, cursor: attempt.cursor,
    attempts: [attempt], events: [],
  }), /extra or missing/u)
  assert.throws(() => strictJoinUsageAttempts({
    account: attempt.account, model: attempt.model, scope: attempt.scope, cursor: attempt.cursor,
    attempts: [attempt], events: [event, { ...event, provider_response_id: 'response-2' }],
  }), /extra or missing/u)
  assert.doesNotThrow(() => assertExactRequestCardinality('short-text', ['request-1'], []))
  assert.doesNotThrow(() => assertExactRequestCardinality(
    'read-only-tool', ['request-1', 'request-2'], ['tool-1'],
  ))
  assert.throws(() => assertExactRequestCardinality('read-only-tool', ['request-1'], ['tool-1']), /cardinality/u)
})

test('offline-valid-cache cuts only auth and policy control plane', () => {
  const online = {
    endpoint: 'available', lease_sha256: digest, model_policy_sha256: 'b'.repeat(64),
    lease_refreshed_at: '2026-08-26T00:00:00.000Z', policy_refreshed_at: '2026-08-26T00:00:00.000Z',
  }
  const offline = {
    ...online, endpoint: 'unavailable', inference_gateway: 'available',
    finished_at: '2026-08-26T00:05:00.000Z', lease_expires_at: '2026-08-26T01:00:00.000Z',
    policy_expires_at: '2026-08-26T01:00:00.000Z', audit_outbox_sha256: 'c'.repeat(64),
  }
  assert.equal(assertOfflineValidCacheBoundary(online, offline).lease_sha256, digest)
  assert.throws(() => assertOfflineValidCacheBoundary(online, {
    ...offline, inference_gateway: 'unavailable',
  }), /isolate only/u)
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
  }
  await writeFile(path, `${JSON.stringify(config)}\n`, { mode: 0o600 })
  assert.deepEqual(await loadRunnerPrivateConfig(path), config)
  const release = await acquireSingleRunLock(path)
  await assert.rejects(acquireSingleRunLock(path), /another performance acceptance probe/u)
  await release()
  await chmod(path, 0o644)
  await assert.rejects(loadRunnerPrivateConfig(path), /owner-only/u)
  assert.throws(() => assertNoPrivatePayload({ prompt: 'private' }), /not allowed/u)
})

test('requires the running bytes to equal both source and installed provenance digests', () => {
  const plan = {
    schema_version: 1,
    mode: 'production-installed-performance-acceptance',
    collector_sha256: digest,
    collector_provenance: { source_sha256: digest, installed_sha256: digest },
    models: Array.from({ length: 4 }, () => ({
      schedule: Array.from({ length: 30 }, () => ({})),
      expected_files: Array.from({ length: 18 }, () => 'artifact'),
    })),
  }
  assert.doesNotThrow(() => assertProbePlan(plan, digest))
  assert.throws(() => assertProbePlan({
    ...plan, collector_provenance: { ...plan.collector_provenance, installed_sha256: 'b'.repeat(64) },
  }, digest), /protected-main source bytes/u)
})
