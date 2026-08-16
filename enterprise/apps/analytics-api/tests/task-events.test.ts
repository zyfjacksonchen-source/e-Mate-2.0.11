import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool, PoolClient } from 'pg';
import { PostgresTaskEventStore } from '../src/task-events.ts';

const principal = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  roles: [],
};

const received = {
  schemaVersion: 1 as const,
  eventId: 'event-received',
  taskId: 'task-1',
  type: 'RECEIVED' as const,
  scenario: 'CONTENT_CREATION' as const,
  occurredAt: '2026-07-25T10:00:00.000Z',
};

test('task event schema migration admits the metadata milestone event types', async () => {
  let schema = '';
  const pool = {
    query: async (sql: string) => {
      schema = sql;
      return { rows: [] };
    },
  } as unknown as Pool;
  const store = new PostgresTaskEventStore(pool);

  await store.initialize();

  for (const type of ['FIRST_RESPONSE', 'SKILL_SELECTED', 'TOOL_SELECTED', 'PERMISSION_REQUESTED', 'WAITING_INPUT']) {
    assert.match(schema, new RegExp(`'${type}'`));
  }
  assert.match(schema, /DROP CONSTRAINT IF EXISTS e_mate_task_event_type_check/);
  assert.match(schema, /e_mate_task_fact_scenario_check[\s\S]*'GENERAL'/);
});

test('task event writes are tenant-bound, idempotent and require an explicit receive', async () => {
  const transactionCalls: Array<{ sql: string; parameters?: unknown[] }> = [];
  const client = {
    query: async (sql: string, parameters?: unknown[]) => {
      transactionCalls.push({ sql, parameters });
      if (sql.includes('FROM e_mate_task_fact')) return { rows: [] };
      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  let eventLookup = 0;
  const pool = {
    query: async () => {
      eventLookup += 1;
      return eventLookup === 1
        ? { rows: [] }
        : {
            rows: [
              {
                user_id: principal.userId,
                task_id: received.taskId,
                type: received.type,
                scenario: received.scenario,
                occurred_at: new Date(received.occurredAt),
              },
            ],
          };
    },
    connect: async () => client,
  } as unknown as Pool;
  const store = new PostgresTaskEventStore(pool);

  assert.equal(await store.append(principal, received), 'ACCEPTED');
  assert.equal(await store.append(principal, received), 'REPLAY');
  assert.deepEqual(transactionCalls.find(({ sql }) => sql.includes('INSERT INTO e_mate_task_fact'))?.parameters, [
    principal.tenantId,
    received.taskId,
    principal.userId,
    received.scenario,
    received.eventId,
    received.occurredAt,
  ]);
});

test('task terminal events are rejected before the demand is received', async () => {
  const client = {
    query: async (sql: string) => {
      if (sql.includes('FROM e_mate_task_fact')) return { rows: [] };
      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = {
    query: async () => ({ rows: [] }),
    connect: async () => client,
  } as unknown as Pool;
  const store = new PostgresTaskEventStore(pool);

  assert.equal(
    await store.append(principal, {
      ...received,
      eventId: 'event-failed',
      type: 'FAILED',
      occurredAt: '2026-07-25T10:01:00.000Z',
    }),
    'NOT_RECEIVED'
  );
});

test('waiting for structured user input records a fact without closing the task', async () => {
  const statements: string[] = [];
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      if (sql.includes('FROM e_mate_task_fact')) {
        return {
          rows: [
            {
              user_id: principal.userId,
              scenario: received.scenario,
              received_event_id: received.eventId,
              received_at: new Date(received.occurredAt),
              status: 'RECEIVED',
              terminal_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    },
    release: () => undefined,
  } as unknown as PoolClient;
  const pool = {
    query: async () => ({ rows: [] }),
    connect: async () => client,
  } as unknown as Pool;
  const store = new PostgresTaskEventStore(pool);

  assert.equal(
    await store.append(principal, {
      ...received,
      eventId: 'event-waiting-input',
      type: 'WAITING_INPUT',
      occurredAt: '2026-07-25T10:00:01.000Z',
    }),
    'ACCEPTED'
  );
  assert.equal(
    statements.some((sql) => sql.includes('UPDATE e_mate_task_fact')),
    false
  );
});

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
  });

  assert.deepEqual(summary.summary, {
    receivedTasks: '2',
    successfulTasks: '1',
    failedTasks: '1',
    cancelledTasks: '0',
  });
  assert.equal(summary.scenarioCounts.find(({ scenario }) => scenario === 'CONTENT_CREATION')?.taskCount, '2');
  assert.equal(summary.eventTypeCounts.find(({ type }) => type === 'WAITING_INPUT')?.eventCount, '1');
  assert.deepEqual(summary.userEventCounts, [
    { userId: 'user-1', eventCount: '7' },
    { userId: 'user-2', eventCount: '1' },
  ]);
  assert.match(statement, /user_event_counts AS[\s\S]*GROUP BY event\.user_id/);
  assert.doesNotMatch(statement, /\bLIMIT\b/);
  assert.deepEqual(parameters, ['tenant-1', '2026-07-25T00:00:00.000Z', '2026-07-27T00:00:00.000Z']);
});
