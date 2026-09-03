import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundedDuration,
  createImageObservation,
  imageFailureCode,
  imageFailureCodes,
  type ImageCorrelation,
} from '../src/image-observability.ts';

const digest = 'a'.repeat(64);
const correlation: ImageCorrelation = {
  trace_id: 'image-' + digest,
  client_request_id: 'image-' + digest,
  task_id: 'sha256:' + digest,
  batch_id: 'sha256:' + 'b'.repeat(64),
  ordinal: 3,
};
const wall = Date.parse('2027-01-02T03:04:05.000Z');

const observation = (value: ImageCorrelation = correlation) =>
  createImageObservation(value, 'client_response', 1_000, 1_200, 1_205, wall, 'failed', 'provider_outcome_unknown');

test('image observability owns one fixed conservative failure taxonomy', () => {
  const mapped = [
    imageFailureCode({ phase: 'preflight' }),
    imageFailureCode({ phase: 'admission' }),
    imageFailureCode({ phase: 'provider', providerSubmitted: true, definitelyRejected: true }),
    imageFailureCode({ phase: 'provider', providerSubmitted: true, timedOut: true, definitelyNotAccepted: true }),
    imageFailureCode({ phase: 'provider', providerSubmitted: true, timedOut: true }),
    imageFailureCode({ phase: 'attachment_commit' }),
    imageFailureCode({ phase: 'projection' }),
    imageFailureCode({ phase: 'preflight', cancelled: true }),
  ];
  assert.deepEqual(mapped, imageFailureCodes);
  for (const input of [
    { phase: 'provider', providerSubmitted: true, cancelled: true },
    { phase: 'provider', providerSubmitted: true, timedOut: true },
    { phase: 'provider', providerSubmitted: true },
  ] as const) assert.equal(imageFailureCode(input), 'provider_outcome_unknown');
});

test('image observations reconstruct exact identifiers and bounded monotonic durations', () => {
  const observations = [
    createImageObservation(correlation, 'admission_decision', 1_000, 1_000, 1_010, wall, 'admitted'),
    createImageObservation(correlation, 'provider_submit', 1_000, 1_010, 1_011, wall + 1, 'submitted'),
    createImageObservation(correlation, 'provider_outcome', 1_000, 1_011, 1_200, wall + 2, 'failed', 'provider_outcome_unknown'),
    observation(),
  ];
  assert.deepEqual(observations.map(({ stage }) => stage), [
    'admission_decision', 'provider_submit', 'provider_outcome', 'client_response',
  ]);
  assert.equal(observations[0]?.occurred_at, '2027-01-02T03:04:05.000Z');
  for (const value of observations) {
    assert(Number.isFinite(value.elapsed_ms) && value.elapsed_ms >= 0 && value.elapsed_ms <= 600_000);
    assert(Number.isFinite(value.duration_ms) && value.duration_ms >= 0 && value.duration_ms <= 600_000);
  }
});

test('rejects injected, mismatched, partial, and sensitive correlation fields', () => {
  const invalid = [
    { ...correlation, prompt: 'private prompt' },
    { ...correlation, secret: 'private secret' },
    { ...correlation, local_path: '/Users/example/private.png' },
    { ...correlation, ordinal: undefined },
    { ...correlation, batch_id: undefined },
    { ...correlation, ordinal: 0 },
    { ...correlation, ordinal: 9 },
    { ...correlation, trace_id: 'image-' + 'c'.repeat(64) },
    { ...correlation, client_request_id: 'image-' + 'c'.repeat(64) },
    { ...correlation, task_id: 'sha256:' + 'c'.repeat(64) },
    { trace_id: 'direct', client_request_id: 'direct', task_id: 'direct', prompt: 'no' },
  ];
  for (const value of invalid) assert.throws(() => observation(value as ImageCorrelation), /Invalid image correlation/);
  assert.deepEqual(
    observation({ trace_id: 'direct', client_request_id: 'direct', task_id: 'direct' }),
    {
      schema_version: 1, trace_id: 'direct', client_request_id: 'direct', task_id: 'direct',
      stage: 'client_response', occurred_at: '2027-01-02T03:04:05.000Z',
      elapsed_ms: 205, duration_ms: 5, outcome: 'failed', failure_code: 'provider_outcome_unknown',
    }
  );
});

test('rejects invalid wall and monotonic timing instead of coercing it', () => {
  for (const args of [
    [Number.NaN, 1], [10, 9], [0, 600_001], [-1, 0],
  ]) assert.throws(() => boundedDuration(args[0]!, args[1]!), /Invalid image observation timing/);
  assert.throws(
    () => createImageObservation(correlation, 'client_response', 2, 1, 3, wall, 'failed', 'preflight'),
    /Invalid image observation/
  );
  assert.throws(
    () => createImageObservation(correlation, 'client_response', 1, 2, 3, Number.NaN, 'failed', 'preflight'),
    /Invalid image observation/
  );
  assert.throws(
    () => createImageObservation(correlation, 'client_response', 1, 2, 3, wall, 'succeeded', 'preflight'),
    /Invalid image observation/
  );
});
