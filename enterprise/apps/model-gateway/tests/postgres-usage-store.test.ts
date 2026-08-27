import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseUsageActivityQuery,
  PostgresUsageStore,
} from '../src/index.ts';

test('aggregates activity from the existing usage-attempt ledger with timezone-aware boundaries', async () => {
  const queries: Array<{ statement: string; parameters: unknown[] }> = [];
  const pool = {
    query: async (statement: string, parameters: unknown[]) => {
      queries.push({ statement, parameters });
      return {
        rows: [{
          date: '2024-02-29',
          input_tokens: '9007199254740993',
          output_tokens: '7',
          cache_read_tokens: '3',
          cache_write_tokens: '2',
          calculated_at: new Date('2024-03-02T00:00:00.000Z'),
        }],
      };
    },
  };
  const store = new PostgresUsageStore(pool as never, {
    tenantRequestsPerMinute: 1_000,
    tenantBurst: 1_000,
    tenantMaxConcurrent: 1,
    invocationLeaseMs: 180_000,
  });
  const activity = await store.accountUsageActivity(
    { tenantId: 'tenant-a', userId: 'user-a', modelIds: ['gpt-5.6-luna'] },
    parseUsageActivityQuery({
      timezone: 'America/Los_Angeles',
      startDate: '2024-02-28',
      endDate: '2024-03-01',
    }),
  );

  assert.equal(queries.length, 1);
  assert.match(queries[0]!.statement, /e_mate_model_usage_attempt/);
  assert.match(queries[0]!.statement, /recorded_at AT TIME ZONE \$3/);
  assert.deepEqual(queries[0]!.parameters, [
    'tenant-a',
    'user-a',
    'America/Los_Angeles',
    '2024-02-28',
    '2024-03-01',
  ]);
  assert.equal(activity.days[1]?.date, '2024-02-29');
  assert.equal(activity.periodTotal, '9007199254741005');
  assert.deepEqual(Object.keys(activity).sort(), [
    'calculatedAt',
    'days',
    'endDate',
    'periodTotal',
    'schemaVersion',
    'startDate',
    'timezone',
  ]);
});

test('reconciles an overlapping UTC activity range with the compatible weekly projection', async () => {
  const statements: string[] = [];
  const pool = {
    query: async (statement: string) => {
      statements.push(statement);
      if (statement.includes("date_trunc('week'")) {
        return { rows: [{
          total_tokens: '18',
          week_started_at: new Date('2024-02-26T00:00:00.000Z'),
          calculated_at: new Date('2024-02-29T12:00:00.000Z'),
        }] };
      }
      return { rows: [{
        date: '2024-02-29',
        input_tokens: '10',
        output_tokens: '5',
        cache_read_tokens: '2',
        cache_write_tokens: '1',
        calculated_at: new Date('2024-02-29T12:00:00.000Z'),
      }] };
    },
  };
  const store = new PostgresUsageStore(pool as never, {
    tenantRequestsPerMinute: 1_000,
    tenantBurst: 1_000,
    tenantMaxConcurrent: 1,
    invocationLeaseMs: 180_000,
  });
  const principal = { tenantId: 'tenant-a', userId: 'user-a', modelIds: ['gpt-5.6-luna'] };
  const [activity, weekly] = await Promise.all([
    store.accountUsageActivity(principal, parseUsageActivityQuery({
      timezone: 'UTC',
      startDate: '2024-02-26',
      endDate: '2024-02-29',
    })),
    store.currentAccountUsage(principal),
  ]);

  assert.equal(BigInt(activity.periodTotal), BigInt(weekly.totalTokens));
  assert.equal(statements.length, 2);
  assert.equal(statements.every(statement => statement.includes('e_mate_model_usage_attempt')), true);
});
