import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseObservabilityPolicy,
  parseObservabilityPolicyRollback,
  parseObservabilityPolicyUpdate,
} from '../src/index.ts';

const policy = {
  schemaVersion: 1,
  version: 2,
  traceSampleRatio: 0.25,
  metadataRetentionDays: 30,
  contentCapture: 'NONE',
  updatedAt: '2026-07-26T08:00:00.000Z',
} as const;

test('parses the strict policy and mutation contracts', () => {
  assert.deepEqual(parseObservabilityPolicy(policy), policy);
  assert.deepEqual(
    parseObservabilityPolicyUpdate({
      schemaVersion: 1,
      requestId: 'request:update-1',
      expectedVersion: 2,
      traceSampleRatio: 0.5,
    }),
    {
      schemaVersion: 1,
      requestId: 'request:update-1',
      expectedVersion: 2,
      traceSampleRatio: 0.5,
    }
  );
  assert.deepEqual(
    parseObservabilityPolicyRollback({
      schemaVersion: 1,
      requestId: 'request:rollback-1',
      expectedVersion: 2,
      targetVersion: 1,
    }).targetVersion,
    1
  );
});

test('rejects sensitive capture, writable retention and unsafe mutations', () => {
  assert.throws(() =>
    parseObservabilityPolicy({
      ...policy,
      contentCapture: 'PROMPT',
    })
  );
  assert.throws(() =>
    parseObservabilityPolicy({
      ...policy,
      metadataRetentionDays: 90,
    })
  );
  assert.throws(() =>
    parseObservabilityPolicyUpdate({
      schemaVersion: 1,
      requestId: 'request:update-1',
      expectedVersion: 2,
      traceSampleRatio: 0.5,
      metadataRetentionDays: 90,
    })
  );
  assert.throws(() =>
    parseObservabilityPolicyUpdate({
      schemaVersion: 1,
      requestId: 'request:update-1',
      expectedVersion: 2,
      traceSampleRatio: 1.01,
    })
  );
  assert.throws(() =>
    parseObservabilityPolicyRollback({
      schemaVersion: 1,
      requestId: 'request:rollback-1',
      expectedVersion: 2,
      targetVersion: 2,
    })
  );
});
