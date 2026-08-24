import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresUsageAnalyticsReader } from '../src/usage-analytics.ts';

const principal = {
  tenantId: 'tenant-1',
  userId: 'auditor-1',
  roles: ['AUDIT_ADMIN'],
};

test('usage reader sums exact grouped facts and exposes ledger mismatches', async () => {
  const calls: unknown[][] = [];
  const statements: string[] = [];
  let query = 0;
  const pool = {
    query: async (sql: string, parameters: unknown[]) => {
      statements.push(sql);
      calls.push(parameters);
      query += 1;
      return query === 1
        ? {
            rows: [
              {
                bucket_start: new Date('2026-07-25T16:00:00.000Z'),
                user_id: 'user-1',
                model_id: 'gpt-5.6-sol',
                total_requests: '2',
                accounted_requests: '1',
                rejected_requests: '1',
                pending_requests: '0',
                usage_events: '1',
                input_tokens: '7',
                output_tokens: '3',
                cache_read_tokens: '2',
                cache_write_tokens: '1',
                total_tokens: '13',
                cost_usd: '0.100000000001',
                zero_cost_usage_events: '0',
                unpriced_usage_events: '0',
              },
              {
                bucket_start: new Date('2026-07-26T16:00:00.000Z'),
                user_id: 'user-2',
                model_id: 'gpt-5.6-sol',
                total_requests: '1',
                accounted_requests: '0',
                rejected_requests: '0',
                pending_requests: '1',
                usage_events: '2',
                input_tokens: '9007199254740993',
                output_tokens: '2',
                cache_read_tokens: '0',
                cache_write_tokens: '0',
                total_tokens: '9007199254740995',
                cost_usd: '0.200000000009',
                zero_cost_usage_events: '1',
                unpriced_usage_events: '1',
              },
            ],
          }
        : {
            rows: [
              {
                task_count: '2',
                usage_task_totals: '1',
                completed_invocation_usage: '0',
                usage_invocation_links: '0',
              },
            ],
          };
    },
  } as unknown as Pool;
  const reader = new PostgresUsageAnalyticsReader(pool, () => Date.parse('2026-07-27T00:00:01.000Z'));
  const result = await reader.read(principal, {
    from: '2026-07-25T00:00:00.000Z',
    to: '2026-07-27T00:00:00.000Z',
    timezone: 'Asia/Shanghai',
    bucket: 'DAY',
  });

  assert.equal(result.projection.summary.totalTokens, '9007199254741008');
  assert.equal(result.projection.summary.costUsd, '0.300000000010');
  assert.equal(result.projection.taskCount, '2');
  assert.deepEqual(result.reconciliation, {
    schemaVersion: 1,
    scope: 'TENANT',
    tenantId: 'tenant-1',
    from: '2026-07-25T00:00:00.000Z',
    to: '2026-07-27T00:00:00.000Z',
    checkedAt: '2026-07-27T00:00:01.000Z',
    state: 'MISMATCHED',
    checks: {
      requestStatuses: '0',
      usageTaskTotals: '1',
      completedInvocationUsage: '0',
      usageInvocationLinks: '0',
    },
  });
  assert.deepEqual(calls[0], [
    'tenant-1',
    '2026-07-25T00:00:00.000Z',
    '2026-07-27T00:00:00.000Z',
    'day',
    'Asia/Shanghai',
    [],
    null,
  ]);
  assert.equal(statements[0]?.match(/GREATEST\(/g)?.length, 2);
  assert.equal(statements[0]?.match(/\$2::timestamptz/g)?.length, 4);
  assert.deepEqual(calls[1], ['tenant-1', '2026-07-25T00:00:00.000Z', '2026-07-27T00:00:00.000Z', [], null]);
  assert.match(statements[1] ?? '', /left\(audit_invocation\.invocation_id, 13\) = 'auditreceipt_'/);
  assert.match(statements[1] ?? '', /task\.status <> 'FINALIZED'/);
  assert.doesNotMatch(statements[1] ?? '', /\$[67]\b/);
});

test('usage reader rejects ambiguous ranges and timezones before querying', async () => {
  const pool = {
    query: async () => {
      throw new Error('query must not run');
    },
  } as unknown as Pool;
  const reader = new PostgresUsageAnalyticsReader(pool);
  await assert.rejects(
    reader.read(principal, {
      from: '2026-07-25T00:00:00.000Z',
      to: '2026-07-25T00:00:00.000Z',
      timezone: 'UTC',
      bucket: 'DAY',
    }),
    /Invalid usage query/
  );
  await assert.rejects(
    reader.read(principal, {
      from: '2026-07-25T00:00:00.000Z',
      to: '2026-07-26T00:00:00.000Z',
      timezone: 'Mars/Olympus',
      bucket: 'DAY',
    }),
    /Invalid usage timezone/
  );
});

test('usage event drill-down is ordered, exact and cursor-bounded', async () => {
  let parameters: unknown[] = [];
  const pool = {
    query: async (_sql: string, input: unknown[]) => {
      parameters = input;
      return {
        rows: [
          {
            event_kind: 'REQUEST',
            event_id: 'invocation-1',
            event_at: new Date('2026-07-25T01:00:00.000Z'),
            user_id: 'user-1',
            task_id: 'task-1',
            trace_id: 'trace-1',
            model_id: 'gpt-5.6-sol',
            provider_id: 'openai',
            outcome: 'ACCOUNTED',
            input_tokens: null,
            output_tokens: null,
            cache_read_tokens: null,
            cache_write_tokens: null,
            total_tokens: null,
            cost_usd: null,
          },
          {
            event_kind: 'USAGE',
            event_id: 'response-1',
            event_at: new Date('2026-07-25T01:00:01.000Z'),
            user_id: 'user-1',
            task_id: 'task-1',
            trace_id: 'trace-1',
            model_id: 'gpt-5.6-sol',
            provider_id: 'openai',
            outcome: null,
            input_tokens: '1',
            output_tokens: '2',
            cache_read_tokens: '3',
            cache_write_tokens: '4',
            total_tokens: '10',
            cost_usd: null,
          },
        ],
      };
    },
  } as unknown as Pool;
  const reader = new PostgresUsageAnalyticsReader(pool);
  const page = await reader.events(
    principal,
    {
      from: '2026-07-25T00:00:00.000Z',
      to: '2026-07-26T00:00:00.000Z',
      timezone: 'UTC',
      bucket: 'DAY',
      userIds: ['user-1', 'user-2'],
    },
    null,
    1
  );
  assert.equal(page.events[0]?.kind, 'REQUEST');
  assert.match(page.nextCursor ?? '', /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(page.nextCursor as string, 'base64url').toString('utf8')), [
    '2026-07-25T01:00:00.000Z',
    'REQUEST',
    'invocation-1',
    'user-1',
    'task-1',
  ]);
  assert.deepEqual(parameters.slice(0, 5), [
    'tenant-1',
    '2026-07-25T00:00:00.000Z',
    '2026-07-26T00:00:00.000Z',
    ['user-1', 'user-2'],
    null,
  ]);
  assert.equal(parameters[10], 2);
});
