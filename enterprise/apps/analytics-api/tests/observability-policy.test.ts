import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryObservabilityPolicyStore } from '../src/observability-policy.ts';

test('policy updates use CAS, idempotency, tenant isolation and rollback history', async () => {
  let now = Date.parse('2026-07-26T08:00:00.000Z');
  const store = new InMemoryObservabilityPolicyStore({ now: () => now });
  const admin = {
    tenantId: 'tenant-1',
    userId: 'admin-1',
    roles: ['TENANT_ADMIN'],
  };
  assert.deepEqual(await store.get('tenant-1'), {
    schemaVersion: 1,
    version: 1,
    traceSampleRatio: 1,
    metadataRetentionDays: 30,
    contentCapture: 'NONE',
    updatedAt: '2026-07-26T08:00:00.000Z',
  });

  now += 1_000;
  const update = {
    schemaVersion: 1 as const,
    requestId: 'request:update-1',
    expectedVersion: 1,
    traceSampleRatio: 0.25,
  };
  const changed = await store.update(admin, update);
  assert.equal(changed.status, 'OK');
  assert.equal(changed.status === 'OK' && changed.policy.version, 2);
  assert.deepEqual(await store.update(admin, update), changed);
  assert.equal(
    (
      await store.update(admin, {
        ...update,
        expectedVersion: 2,
      })
    ).status,
    'IDEMPOTENCY_CONFLICT'
  );
  assert.equal(
    (
      await store.update(admin, {
        ...update,
        traceSampleRatio: 0.5,
      })
    ).status,
    'IDEMPOTENCY_CONFLICT'
  );
  assert.equal(
    (
      await store.update(admin, {
        ...update,
        requestId: 'request:update-stale',
      })
    ).status,
    'VERSION_CONFLICT'
  );

  now += 1_000;
  assert.equal(
    (
      await store.update(admin, {
        ...update,
        requestId: 'request:update-2',
        expectedVersion: 2,
        traceSampleRatio: 0.5,
      })
    ).status,
    'OK'
  );
  now += 1_000;
  const rolledBack = await store.rollback(admin, {
    schemaVersion: 1,
    requestId: 'request:rollback-1',
    expectedVersion: 3,
    targetVersion: 1,
  });
  assert.equal(rolledBack.status, 'OK');
  assert.equal(rolledBack.status === 'OK' && rolledBack.policy.traceSampleRatio, 1);
  assert.equal(rolledBack.status === 'OK' && rolledBack.policy.version, 4);
  assert.equal(
    (
      await store.update(admin, {
        schemaVersion: 1,
        requestId: 'request:no-change',
        expectedVersion: 4,
        traceSampleRatio: 1,
      })
    ).status,
    'NO_CHANGE'
  );
  assert.equal((await store.get('tenant-2')).version, 1);
});
