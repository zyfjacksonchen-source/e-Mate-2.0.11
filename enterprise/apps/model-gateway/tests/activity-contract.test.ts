import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryUsageStore,
  parseUsageActivityQuery,
  projectUsageActivity,
  usageActivityDate,
} from '../src/index.ts';

const limits = {
  tenantRequestsPerMinute: 1_000,
  tenantBurst: 1_000,
  tenantMaxConcurrent: 1,
  invocationLeaseMs: 180_000,
};

test('validates canonical IANA timezones and inclusive Gregorian ranges up to 366 days', () => {
  assert.deepEqual(parseUsageActivityQuery({
    timezone: 'Asia/Shanghai',
    startDate: '2024-02-29',
    endDate: '2024-02-29',
  }), {
    timezone: 'Asia/Shanghai',
    startDate: '2024-02-29',
    endDate: '2024-02-29',
  });
  assert.doesNotThrow(() => parseUsageActivityQuery({
    timezone: 'UTC',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
  }));
  assert.doesNotThrow(() => parseUsageActivityQuery({
    timezone: 'Europe/Kyiv',
    startDate: '2024-02-29',
    endDate: '2024-02-29',
  }));
  for (const query of [
    { timezone: 'UTC+8', startDate: '2024-02-29', endDate: '2024-02-29' },
    { timezone: 'Mars/Base', startDate: '2024-02-29', endDate: '2024-02-29' },
    { timezone: 'UTC', startDate: '2023-02-29', endDate: '2023-02-29' },
    { timezone: 'UTC', startDate: '2024-03-01', endDate: '2024-02-29' },
    { timezone: 'UTC', startDate: '2023-01-01', endDate: '2024-01-02' },
  ]) {
    assert.throws(() => parseUsageActivityQuery(query), /usage activity query/i);
  }
});

test('projects leap days, empty days and integers beyond JSON safe-number range without private fields', () => {
  const query = parseUsageActivityQuery({
    timezone: 'America/Los_Angeles',
    startDate: '2024-02-28',
    endDate: '2024-03-01',
  });
  assert.equal(usageActivityDate('2024-03-10T07:59:59.000Z', query.timezone), '2024-03-09');
  assert.equal(usageActivityDate('2024-03-10T08:00:00.000Z', query.timezone), '2024-03-10');
  const activity = projectUsageActivity(query, [{
    date: '2024-02-29',
    inputTokens: '9007199254740993',
    outputTokens: '7',
    cacheReadTokens: '3',
    cacheWriteTokens: '2',
  }], '2024-03-02T00:00:00.000Z');

  assert.deepEqual(activity, {
    schemaVersion: 1,
    timezone: 'America/Los_Angeles',
    startDate: '2024-02-28',
    endDate: '2024-03-01',
    days: [
      { date: '2024-02-28', total: '0', input: '0', output: '0', cacheRead: '0', cacheWrite: '0' },
      {
        date: '2024-02-29',
        total: '9007199254741005',
        input: '9007199254740993',
        output: '7',
        cacheRead: '3',
        cacheWrite: '2',
      },
      { date: '2024-03-01', total: '0', input: '0', output: '0', cacheRead: '0', cacheWrite: '0' },
    ],
    periodTotal: '9007199254741005',
    calculatedAt: '2024-03-02T00:00:00.000Z',
  });
  assert.doesNotMatch(
    JSON.stringify(activity),
    /account|subject|prompt|session|title|file|tool|plugin|content/i,
  );
});

test('the ledger reconciles UTC weeks while late facts retain their local-day timezone boundary', async () => {
  const now = Date.parse('2024-03-04T00:30:00.000Z');
  const store = new InMemoryUsageStore(limits, () => now);
  const fact = (providerResponseId: string, inputTokens: number) => ({
    tenantId: 'tenant-a',
    userId: 'user-a',
    taskId: `task-${providerResponseId}`,
    traceId: `trace-${providerResponseId}`,
    modelId: 'gpt-5.6-luna',
    providerId: 'gpt-responses',
    providerResponseId,
    inputTokens,
    outputTokens: 2,
    cacheReadTokens: 1,
    cacheWriteTokens: 0,
    costUsd: 0,
  });
  await store.add(fact('monday', 20));
  const lateFactId = `auditfact_${'a'.repeat(64)}`;
  await store.ingestAuditUsage([{
    factId: lateFactId,
    payloadSha256: 'b'.repeat(64),
    occurredAt: '2024-03-03T23:30:00.000Z',
    fact: { ...fact(lateFactId, 10), providerResponseId: lateFactId },
  }]);

  const principal = { tenantId: 'tenant-a', userId: 'user-a', modelIds: ['gpt-5.6-luna'] };
  const shanghai = await store.accountUsageActivity(principal, parseUsageActivityQuery({
    timezone: 'Asia/Shanghai',
    startDate: '2024-03-04',
    endDate: '2024-03-04',
  }));
  assert.equal(shanghai.periodTotal, '36');

  const utc = await store.accountUsageActivity(principal, parseUsageActivityQuery({
    timezone: 'UTC',
    startDate: '2024-03-04',
    endDate: '2024-03-04',
  }));
  const weekly = await store.currentAccountUsage(principal);
  assert.equal(utc.periodTotal, '23');
  assert.equal(BigInt(weekly.totalTokens), BigInt(utc.periodTotal));

  const empty = await store.accountUsageActivity(principal, parseUsageActivityQuery({
    timezone: 'UTC',
    startDate: '2024-02-29',
    endDate: '2024-02-29',
  }));
  assert.equal(empty.periodTotal, '0');
  assert.equal(empty.days[0]?.total, '0');
});
