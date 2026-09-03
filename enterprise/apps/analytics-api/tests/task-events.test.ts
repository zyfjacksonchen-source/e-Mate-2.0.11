import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresTaskEventStore } from '../src/task-events.ts';

const principal = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  roles: [],
};

test('task summary uses only authoritative task rows and exact decimal strings', async () => {
  let parameters: unknown[] = [];
  let statement = '';
  const pool = {
    query: async (sql: string, values: unknown[]) => {
      statement = sql;
      parameters = values;
      return {
        rows: [
          {
            received_tasks: '2',
            successful_tasks: '1',
            failed_tasks: '1',
            cancelled_tasks: '0',
            scenario_counts: {
              CONTENT_CREATION: '2',
            },
            scenario_buckets: [
              {
                bucketStart: '2026-07-25T16:00:00+00:00',
                scenario: 'CONTENT_CREATION',
                taskCount: '2',
              },
            ],
            event_type_counts: {
              RECEIVED: '2',
              COMPLETED: '1',
              FAILED: '1',
              WAITING_INPUT: '1',
              TOOL_EXECUTION: '3',
            },
            user_event_counts: [
              { userId: 'user-1', eventCount: '7' },
              { userId: 'user-2', eventCount: '1' },
            ],
          },
        ],
      };
    },
  } as unknown as Pool;
  const store = new PostgresTaskEventStore(pool, () => Date.parse('2026-07-27T00:00:01.000Z'));
  const summary = await store.summary(principal, {
    from: '2026-07-25T00:00:00.000Z',
    to: '2026-07-27T00:00:00.000Z',
    timezone: 'Asia/Shanghai',
    userIds: ['user-1', 'user-2'],
    scenario: 'CONTENT_CREATION',
  });

  assert.deepEqual(summary.summary, {
    receivedTasks: '2',
    successfulTasks: '1',
    failedTasks: '1',
    cancelledTasks: '0',
  });
  assert.equal(summary.scenarioCounts.find(({ scenario }) => scenario === 'CONTENT_CREATION')?.taskCount, '2');
  assert.deepEqual(summary.scenarioBuckets, [
    { bucketStart: '2026-07-25T16:00:00.000Z', scenario: 'CONTENT_CREATION', taskCount: '2' },
  ]);
  assert.equal(summary.eventTypeCounts.find(({ type }) => type === 'WAITING_INPUT')?.eventCount, '1');
  assert.deepEqual(summary.userEventCounts, [
    { userId: 'user-1', eventCount: '7' },
    { userId: 'user-2', eventCount: '1' },
  ]);
  assert.match(statement, /user_event_counts AS[\s\S]*GROUP BY event\.user_id/);
  assert.doesNotMatch(statement, /\bLIMIT\b/);
  assert.match(statement, /user_id = ANY\(\$4::text\[\]\)/);
  assert.match(statement, /received_at AT TIME ZONE \$5/);
  assert.match(statement, /\$6::text IS NULL OR scenario = \$6/);
  assert.deepEqual(parameters, [
    'tenant-1',
    '2026-07-25T00:00:00.000Z',
    '2026-07-27T00:00:00.000Z',
    ['user-1', 'user-2'],
    'Asia/Shanghai',
    'CONTENT_CREATION',
  ]);
  await assert.rejects(
    store.summary(principal, {
      from: '2026-07-25T00:00:00.000Z',
      to: '2026-07-27T00:00:00.000Z',
      scenario: 'UNKNOWN' as 'CONTENT_CREATION',
    }),
    /Invalid task event scenario filter/
  );
});
