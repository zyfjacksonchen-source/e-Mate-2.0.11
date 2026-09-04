import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const CONTRACT_URL = new URL('./contract.json', import.meta.url)
const contract = JSON.parse(await readFile(CONTRACT_URL, 'utf8'))

function foregroundCap() {
  assert.deepEqual(Object.keys(contract.baseline_source), ['commit', 'foreground_cap'])
  assert.match(contract.baseline_source.commit, /^[0-9a-f]{40}$/u)
  assert.equal(contract.baseline_source.commit, 'f876f01d8280e4ab20fe83b88c36c7fe7a662135')
  assert.equal(contract.baseline_source.foreground_cap, 4)
  return contract.baseline_source.foreground_cap
}

function fixtureTask(taskCount, ordinal) {
  return {
    task_id: 'fixture-' + taskCount + '-' + String(ordinal).padStart(2, '0'),
    ordinal,
    input_class: contract.batches.executed_input_class,
    request: { ...contract.executed_request },
    control: { ...contract.single_image_control },
  }
}

function runFixtureBatch(taskCount, run, cap) {
  const items = Array.from({ length: taskCount }, (_, index) => fixtureTask(taskCount, index + 1))
  let waveStart = 10
  const traces = []
  for (let offset = 0; offset < items.length; offset += cap) {
    const wave = items.slice(offset, offset + cap)
    const waveTraces = wave.map(item => {
      const providerLatency = 20 + ((run * 11 + item.ordinal * 7 + taskCount) % 23)
      const at = {
        'parent-planning': 0,
        'child-start': waveStart,
        'provider-submit': waveStart + 2,
        'provider-finish': waveStart + 2 + providerLatency,
        'attachment-commit': waveStart + 5 + providerLatency,
        'projection-paint': waveStart + 7 + providerLatency,
        'child-return': waveStart + 8 + providerLatency,
      }
      return { ...item, wave: Math.floor(offset / cap) + 1, at }
    })
    traces.push(...waveTraces)
    waveStart = Math.max(...waveTraces.map(item => item.at['child-return'])) + 1
  }
  const turnClose = Math.max(...traces.map(item => item.at['child-return'])) + 5
  for (const item of traces) item.at['turn-close'] = turnClose
  return {
    batch_id: 'fixture-' + taskCount + '-run-' + String(run).padStart(2, '0'),
    task_count: taskCount,
    foreground_cap: cap,
    events: [
      { type: 'parent-planning', at: 0 },
      { type: 'turn-close', at: turnClose },
    ],
    metrics: { total_duration: turnClose, wave_count: Math.ceil(taskCount / cap) },
    completion_order: [...traces]
      .sort((a, b) => a.at['projection-paint'] - b.at['projection-paint'] || a.ordinal - b.ordinal)
      .map(item => item.task_id),
    items: traces.map(item => ({
      ...item,
      events: contract.timeline_events.map(type => ({ type, at: item.at[type] })),
      metrics: {
        planning_to_start: item.at['child-start'] - item.at['parent-planning'],
        provider_latency: item.at['provider-finish'] - item.at['provider-submit'],
        attachment_commit_latency: item.at['attachment-commit'] - item.at['provider-finish'],
        projection_paint_latency: item.at['projection-paint'] - item.at['attachment-commit'],
        completion_to_turn_close: turnClose - item.at['projection-paint'],
      },
      visible: { session_gallery: item.at['projection-paint'], artifact_terminal: turnClose },
    })),
  }
}

function assertSanitized(value) {
  const forbidden = new Set(contract.sanitization.forbidden_fields)
  const visit = current => {
    if (Array.isArray(current)) return current.forEach(visit)
    if (current === null || typeof current !== 'object') return
    for (const [key, child] of Object.entries(current)) {
      assert.ok(!forbidden.has(key), 'forbidden evidence field: ' + key)
      visit(child)
    }
  }
  visit(value)
}

test('frozen captured 2.0.16 baseline identifies its source commit and foreground cap', () => {
  assert.equal(foregroundCap(), 4)
  assert.equal(contract.batches.executed_input_class, 'text-only-new-image')
  assert.equal(contract.executed_request.model, 'gpt-image-2-pro')
  assert.ok(contract.unsupported_current_batch_inputs.every(gap => gap.source_evidence.every(evidence =>
    typeof evidence.file === 'string' && evidence.file.length > 0
      && typeof evidence.assertion === 'string' && evidence.assertion.length > 0)))
})

test('20 deterministic fixture batches for each 4/5/8-task shape retain item-level evidence', () => {
  const cap = foregroundCap()
  const batches = contract.batches.task_counts.flatMap(taskCount =>
    Array.from({ length: contract.batches.runs_per_task_count }, (_, index) => runFixtureBatch(taskCount, index + 1, cap)))
  assert.equal(batches.length, 60)
  assert.deepEqual([...new Set(batches.map(batch => batch.task_count))], [4, 5, 8])
  for (const batch of batches) {
    assert.equal(batch.items.length, batch.task_count)
    assert.deepEqual(batch.events, [
      { type: 'parent-planning', at: 0 },
      { type: 'turn-close', at: batch.metrics.total_duration },
    ])
    assert.deepEqual(Object.keys(batch.metrics), contract.batch_metrics)
    const waves = Map.groupBy(batch.items, item => item.wave)
    assert.ok(Math.max(...[...waves.values()].map(items => items.length)) <= cap)
    assert.deepEqual(new Set(batch.items.flatMap(item => item.events.map(event => event.type))), new Set(contract.timeline_events))
    assert.deepEqual(batch.completion_order, [...batch.items]
      .sort((a, b) => a.visible.session_gallery - b.visible.session_gallery || a.ordinal - b.ordinal)
      .map(item => item.task_id))
    for (const item of batch.items) {
      assert.deepEqual(Object.keys(item.metrics), contract.item_metrics)
      assert.ok(item.visible.session_gallery < item.visible.artifact_terminal)
      assert.equal(item.input_class, 'text-only-new-image')
      assert.deepEqual(item.request, contract.executed_request)
      assert.equal(item.request.image_url, 'omitted-new-image')
      assert.equal(item.request.aspect_ratio, 'unexpressible')
      assert.equal(item.request.size, 'unexpressible')
      assert.equal(item.request.quality, 'provider-default-unexpressible')
      assert.ok(!Object.hasOwn(item, 'reference_class'))
      assert.ok(!Object.hasOwn(item, 'aspect_ratio'))
      for (const field of contract.single_image_control.comparison_requires_equal) {
        assert.equal(item.control[field], item.request[field])
      }
    }
    assertSanitized(batch)
  }
})

test('task 5 starts only after every first-wave child returns', () => {
  const cap = foregroundCap()
  for (const taskCount of [5, 8]) {
    for (let run = 1; run <= contract.batches.runs_per_task_count; run += 1) {
      const batch = runFixtureBatch(taskCount, run, cap)
      const firstWaveReturned = Math.max(...batch.items.filter(item => item.wave === 1).map(item => item.at['child-return']))
      assert.ok(batch.items[4].at['child-start'] > firstWaveReturned)
    }
  }
})

test('unsupported current batch inputs remain explicit gaps without successful timelines', () => {
  assert.deepEqual(contract.unsupported_current_batch_inputs.map(gap => gap.id), [
    'reference-edit', 'reference-fusion', 'caller-selected-aspect-ratio',
    'caller-selected-size', 'caller-selected-quality',
  ])
  assert.ok(contract.unsupported_current_batch_inputs.every(gap => gap.status === 'unsupported-in-2.0.16'))
  assert.ok(contract.unsupported_current_batch_inputs.every(gap => gap.source_evidence.length > 0))
  assert.ok(contract.unsupported_current_batch_inputs.every(gap =>
    !contract.batches.task_counts.includes(gap.id) && gap.current_behavior !== 'simulated-success'))
})

test('failure taxonomy and metadata-only provider contract are complete', () => {
  assert.deepEqual(contract.failure_classifications, [
    'preflight', 'pre-submit', 'provider-rejected', 'provider-outcome-unknown',
    'attachment-commit', 'projection-ui', 'cancelled',
  ])
  assert.equal(contract.provider.class, 'deterministic-keyless-fixture')
  assert.equal(contract.provider.network, 'forbidden')
  assert.equal(contract.provider.credentials, 'none')
  assert.equal(contract.provider.response_payload, 'metadata-only')
})
