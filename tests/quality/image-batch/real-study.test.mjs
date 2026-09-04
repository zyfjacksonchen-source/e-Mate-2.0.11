import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { protocolConstants, validateAndAnalyzeStudy } from './noninferiority-protocol.mjs'
import { collectStudy, evaluatorHash, finalizeStudy, prepareStudy } from './real-study.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const categories = protocolConstants.CATEGORIES

function context() {
  return {
    root: new URL('https://production.example/v1'), token: 'private-session-token-value', upstreamModel: 'upstream-image-model',
    provenance: { emate_commit: 'a'.repeat(40), harness_commit: '4da69d7c3522ee51de12822c917c503a124f7a7d', desktop_reference: '6074088f5b660206e404b3591fab51fb99c69add', version: '2.0.17' },
    environment: { layer: 'production-provider', environment_name_sha256: hash('production'), gateway_origin_sha256: hash('https://production.example/v1'), deployment_fingerprint_sha256: hash('deployment') },
  }
}

function dimensions(category, value = 4) {
  return Object.fromEntries([['prompt_adherence', value], ['detail', value], ['composition', value],
    ...(category === 'text' ? [['text', value]] : []), ...(category === 'reference-edit' ? [['reference_consistency', value]] : [])])
}

test('precommit balances A/B before collection; blind packet and finalized raw bind evaluator and artifact hashes', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'emate-em217-503-'))
  try {
    const reference = join(temporary, 'reference.png'); writeFileSync(reference, png, { mode: 0o600 })
    const input = {
      schema_version: 1, evaluator_protocol_commitment_sha256: hash('evaluator protocol v1'),
      cases: Array.from({ length: 60 }, (_, index) => {
        const category = categories[index % categories.length]
        return { pair_id: `pair-${String(index + 1).padStart(3, '0')}`, category,
          prompt: `private test prompt ${index + 1}`, references: category === 'reference-edit' ? [reference] : [] }
      }),
    }
    const state = prepareStudy(input, '1'.repeat(64), context())
    const globalBatchA = state.cases.filter(value => value.allocation.A === 'batch').length
    assert(Math.abs(globalBatchA - (state.cases.length - globalBatchA)) <= 1)
    for (const category of categories) {
      const values = state.cases.filter(value => value.category === category)
      const batchA = values.filter(value => value.allocation.A === 'batch').length
      assert(Math.abs(batchA - (values.length - batchA)) <= 1)
    }
    const stateRaw = JSON.stringify(state) + '\n'; const precommit = hash(stateRaw)
    const output = join(temporary, 'outputs')
    let calls = 0
    const seenBatch = new Map()
    const packet = await collectStudy(state, precommit, context(), output, async (_url, options) => {
      calls += 1
      const headers = options.headers
      if (headers['x-e-mate-batch-id']) {
        const ordinals = seenBatch.get(headers['x-e-mate-batch-id']) ?? []
        ordinals.push(Number(headers['x-e-mate-batch-ordinal'])); seenBatch.set(headers['x-e-mate-batch-id'], ordinals)
      }
      return new Response(JSON.stringify({ id: `result-${calls}`, data: [{ b64_json: png.toString('base64') }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    assert.equal(calls, 120)
    assert([...seenBatch.values()].every(ordinals => ordinals.length >= 2 && ordinals.length <= 4 && ordinals.every((ordinal, index) => ordinal === index + 1)))
    assert.equal(Object.hasOwn(packet.pairs[0], 'allocation'), false)
    assert.equal(Object.hasOwn(packet.pairs[0], 'condition'), false)

    const evaluator = { model: 'automatic-blind-evaluator-v1', implementation_sha256: hash('evaluator implementation'), protocol_sha256: input.evaluator_protocol_commitment_sha256 }
    const scoreSheet = {
      schema_version: 1, evaluator, evaluator_hash: evaluatorHash(evaluator),
      pairs: packet.pairs.map(value => ({ pair_id: value.pair_id,
        artifacts: { A: { sha256: value.artifacts.A.sha256 }, B: { sha256: value.artifacts.B.sha256 } },
        scores: { A: dimensions(value.category), B: dimensions(value.category) } })),
    }
    const result = finalizeStudy(state, precommit, packet, [scoreSheet])
    assert.equal(result.analysis.status, 'PASS')
    const descriptor = { uri: `https://evidence.example/immutable/${hash(result.raw)}.json`, sha256: hash(result.raw) }
    assert.equal(validateAndAnalyzeStudy(result.raw, descriptor).status, 'PASS')
    assert.doesNotMatch(result.raw, /private test prompt|private-session-token-value|\/var\//u)

    const badEvaluator = structuredClone(scoreSheet); badEvaluator.evaluator_hash = hash('unmatched evaluator')
    assert.throws(() => finalizeStudy(state, precommit, packet, [badEvaluator]), /evaluator hash\/protocol mismatch/u)
    const badArtifact = structuredClone(scoreSheet); badArtifact.pairs[0].artifacts.A.sha256 = hash('wrong artifact')
    assert.throws(() => finalizeStudy(state, precommit, packet, [badArtifact]), /artifact hash mismatch/u)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('prepare rejects category gaps and reference edits without an actual reference', () => {
  const base = { schema_version: 1, evaluator_protocol_commitment_sha256: hash('protocol'),
    cases: Array.from({ length: 50 }, (_, index) => ({ pair_id: `pair-${index + 1}`, category: categories[index % categories.length], prompt: 'private', references: [] })) }
  assert.throws(() => prepareStudy(base, '2'.repeat(64), context()), /reference\/category mismatch|at least five/u)
})
