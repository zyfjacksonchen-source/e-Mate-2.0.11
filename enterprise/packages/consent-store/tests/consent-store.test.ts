import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ConsentStoreError, InMemoryConsentStore, openPostgresConsentStore } from '../src/index.ts';

const policy = {
  schemaVersion: 1,
  agreementId: 'e-mate-platform-terms',
  agreementVersion: '1.0.0',
  disclaimerVersion: '1.0.0',
  contentHash: 'a'.repeat(64),
} as const;

const input = {
  ...policy,
  termsAccepted: true,
  policyRead: true,
  lawfulUseConfirmed: true,
  clientVersion: '2.1.45',
  locale: 'zh-CN',
} as const;

test('current status is tenant-scoped and acceptance is idempotent', async () => {
  const store = new InMemoryConsentStore(policy, () => Date.parse('2026-08-02T01:02:03.000Z'));
  const user = { tenantId: 'tenant-1', userId: 'user-1' };
  assert.equal((await store.status(user)).required, true);
  const first = await store.accept(user, input);
  const replay = await store.accept(user, { ...input, clientVersion: '2.1.46', locale: 'en-US' });
  assert.deepEqual(replay, first);
  assert.equal((await store.status(user)).required, false);
  assert.equal((await store.status({ tenantId: 'tenant-2', userId: 'user-1' })).required, true);
});

test('acceptance fails closed when the submitted policy is stale', async () => {
  const store = new InMemoryConsentStore(policy);
  await assert.rejects(
    store.accept({ tenantId: 'tenant-1', userId: 'user-1' }, { ...input, disclaimerVersion: '0.9.0' }),
    (error) => error instanceof ConsentStoreError && error.code === 'POLICY_CHANGED'
  );
});

test('administrator listing filters only the selected tenant and metadata', async () => {
  let now = Date.parse('2026-08-02T01:00:00.000Z');
  const store = new InMemoryConsentStore(policy, () => now);
  await store.accept({ tenantId: 'tenant-1', userId: 'user-1' }, input);
  now += 60_000;
  await store.accept({ tenantId: 'tenant-1', userId: 'user-2' }, { ...input, locale: 'en-US' });
  await store.accept({ tenantId: 'tenant-2', userId: 'user-3' }, input);
  const result = await store.list('tenant-1', { userId: 'user-2', limit: 20 });
  assert.deepEqual(
    result.acceptances.map(({ userId }) => userId),
    ['user-2']
  );
  assert.equal('userTerms' in result.acceptances[0]!, false);
});

test(
  'real PostgreSQL migrates and preserves one append-only acceptance per policy tuple',
  { skip: process.env.E_MATE_TEST_POSTGRES_URL ? false : 'E_MATE_TEST_POSTGRES_URL is not set' },
  async () => {
    const opened = await openPostgresConsentStore(process.env.E_MATE_TEST_POSTGRES_URL as string, policy);
    const principal = { tenantId: `tenant-${randomUUID()}`, userId: `user-${randomUUID()}` };
    try {
      const first = await opened.store.accept(principal, input);
      const replay = await opened.store.accept(principal, { ...input, clientVersion: '2.1.46' });
      assert.deepEqual(replay, first);
      assert.deepEqual((await opened.store.list(principal.tenantId, { limit: 20 })).acceptances, [first]);
    } finally {
      await opened.close();
    }
  }
);
