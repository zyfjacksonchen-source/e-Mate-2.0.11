import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import {
  TASK_EVENT_TYPES,
  TASK_SCENARIOS,
  type TaskEventInput,
  type TenantTaskSummary,
} from '@e-mate/monitoring-contract';
import type { RuntimeRegistryPrincipal, RuntimeRegistryStore } from '../src/runtime-registry.ts';
import { createAnalyticsServer } from '../src/server.ts';
import type { TaskEventQuery, TaskEventStore } from '../src/task-events.ts';

const users: Record<string, RuntimeRegistryPrincipal> = {
  employee: { tenantId: 'tenant-1', userId: 'user-1', roles: [], scopes: ['task-events:write'] },
  unscoped: { tenantId: 'tenant-1', userId: 'user-2', roles: [] },
  auditor: { tenantId: 'tenant-1', userId: 'auditor-1', roles: ['AUDIT_ADMIN'] },
  tenant2: { tenantId: 'tenant-2', userId: 'auditor-2', roles: ['AUDIT_ADMIN'] },
};

const received = {
  schemaVersion: 1,
  eventId: 'event-received',
  taskId: 'task-1',
  type: 'RECEIVED',
  scenario: 'CONTENT_CREATION',
  occurredAt: '2026-07-25T10:00:00.000Z',
} as const;

class FakeTaskEvents implements TaskEventStore {
  readonly events = new Map<string, { userId: string; event: TaskEventInput }>([
    [`tenant-1\0${received.eventId}`, { userId: 'user-1', event: received }],
  ]);
  readonly tasks = new Map<string, { userId: string; scenario: TaskEventInput['scenario']; status: string }>([
    [`tenant-1\0${received.taskId}`, { userId: 'user-1', scenario: received.scenario, status: 'RECEIVED' }],
  ]);

  async summary(principal: RuntimeRegistryPrincipal, query: TaskEventQuery): Promise<TenantTaskSummary> {
    const tasks = [...this.tasks.entries()].filter(
      ([key, task]) =>
        key.startsWith(`${principal.tenantId}\0`) &&
        (!query.userIds?.length || query.userIds.includes(task.userId)) &&
        (!query.scenarios?.length || query.scenarios.includes(task.scenario))
    );
    const count = (status: string): string => String(tasks.filter(([, task]) => task.status === status).length);
    const scenarioCount = (scenario: TaskEventInput['scenario']): string =>
      String(tasks.filter(([, task]) => task.scenario === scenario).length);
    const eventCount = (type: TaskEventInput['type']): string =>
      String(
        [...this.events.entries()].filter(
          ([key, stored]) =>
            key.startsWith(`${principal.tenantId}\0`) &&
            (!query.userIds?.length || query.userIds.includes(stored.userId)) &&
            (!query.scenarios?.length || query.scenarios.includes(stored.event.scenario)) &&
            stored.event.type === type
        ).length
      );
    return {
      schemaVersion: 1,
      scope: 'TENANT',
      tenantId: principal.tenantId,
      from: query.from,
      to: query.to,
      generatedAt: '2026-07-30T00:00:00.000Z',
      sourceState: tasks.length ? 'AUTHORITATIVE' : 'NO_DATA',
      summary: {
        receivedTasks: String(tasks.length),
        successfulTasks: count('COMPLETED'),
        failedTasks: count('FAILED'),
        cancelledTasks: count('CANCELLED'),
      },
      scenarioCounts: TASK_SCENARIOS.map((scenario) => ({ scenario, taskCount: scenarioCount(scenario) })),
      scenarioBuckets: TASK_SCENARIOS
        .map((scenario) => ({ bucketStart: query.from, scenario, taskCount: scenarioCount(scenario) }))
        .filter(({ taskCount }) => taskCount !== '0'),
      eventTypeCounts: TASK_EVENT_TYPES.map((type) => ({ type, eventCount: eventCount(type) })),
      userEventCounts: [...new Set([...this.events.entries()]
        .filter(
          ([key, stored]) =>
            key.startsWith(`${principal.tenantId}\0`) &&
            (!query.userIds?.length || query.userIds.includes(stored.userId)) &&
            (!query.scenarios?.length || query.scenarios.includes(stored.event.scenario))
        )
        .map(([, stored]) => stored.userId))]
        .sort()
        .map((userId) => ({
          userId,
          eventCount: String([...this.events.entries()].filter(
            ([key, stored]) =>
              key.startsWith(`${principal.tenantId}\0`) &&
              (!query.userIds?.length || query.userIds.includes(stored.userId)) &&
              (!query.scenarios?.length || query.scenarios.includes(stored.event.scenario)) &&
              stored.userId === userId
          ).length),
        })),
    };
  }
}

const registry: RuntimeRegistryStore = {
  heartbeat: async () => false,
  remove: async () => false,
  status: async () => ({
    schemaVersion: 1,
    activeUsers: 0,
    activeSessions: 0,
    runningTasks: 0,
    failedTasks: 0,
    modelStatus: 'UNAVAILABLE',
    updatedAt: '2026-07-30T00:00:00.000Z',
  }),
};

async function withServer(run: (baseUrl: string, taskEvents: FakeTaskEvents) => Promise<void>): Promise<void> {
  const taskEvents = new FakeTaskEvents();
  const server = createAnalyticsServer({
    registry,
    taskEvents,
    authenticate: async (token) => users[token] ?? null,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`, taskEvents);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const auth = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
});

test('task event write endpoint is absent and cannot mutate the read projection', async () => {
  await withServer(async (baseUrl, taskEvents) => {
    const before = JSON.stringify({ tasks: [...taskEvents.tasks], events: [...taskEvents.events] });
    for (const [method, token] of [
      ['POST', 'employee'],
      ['POST', 'auditor'],
      ['GET', 'employee'],
    ] as const) {
      const response = await fetch(`${baseUrl}/v1/tasks/events`, {
        method,
        headers: auth(token),
        ...(method === 'POST' ? { body: JSON.stringify(received) } : {}),
      });
      assert.equal(response.status, 404);
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'NOT_FOUND');
    }
    assert.equal(JSON.stringify({ tasks: [...taskEvents.tasks], events: [...taskEvents.events] }), before);
  });
});

test('task summary is role-gated and tenant-isolated', async () => {
  await withServer(async (baseUrl) => {
    const query = 'from=2026-07-25T00%3A00%3A00.000Z&to=2026-07-26T00%3A00%3A00.000Z';
    assert.equal((await fetch(`${baseUrl}/v1/tasks/summary?${query}`, { headers: auth('employee') })).status, 403);
    const tenant1 = await fetch(`${baseUrl}/v1/tasks/summary?${query}`, { headers: auth('auditor') });
    const tenant1Summary = (await tenant1.json()) as TenantTaskSummary;
    assert.equal(tenant1Summary.tenantId, 'tenant-1');
    assert.deepEqual(tenant1Summary.scenarioBuckets, [
      { bucketStart: '2026-07-25T00:00:00.000Z', scenario: 'CONTENT_CREATION', taskCount: '1' },
    ]);
    const filtered = await fetch(`${baseUrl}/v1/tasks/summary?${query}&userId=user-1&userId=user-2`, {
      headers: auth('auditor'),
    });
    assert.deepEqual(((await filtered.json()) as TenantTaskSummary).userEventCounts, [
      { userId: 'user-1', eventCount: '1' },
    ]);
    const scenarioFiltered = await fetch(
      `${baseUrl}/v1/tasks/summary?${query}&scenario=SEARCH_QUERY&scenario=CONTENT_CREATION`,
      {
        headers: auth('auditor'),
      }
    );
    assert.equal(((await scenarioFiltered.json()) as TenantTaskSummary).summary.receivedTasks, '1');
    const emptyScenario = await fetch(`${baseUrl}/v1/tasks/summary?${query}&scenario=SEARCH_QUERY`, {
      headers: auth('auditor'),
    });
    assert.equal(((await emptyScenario.json()) as TenantTaskSummary).summary.receivedTasks, '0');
    assert.equal(
      (await fetch(`${baseUrl}/v1/tasks/summary?${query}&userId=user-1&userId=user-1`, { headers: auth('auditor') }))
        .status,
      400
    );
    assert.equal(
      (await fetch(`${baseUrl}/v1/tasks/summary?${query}&userId=invalid%20user`, { headers: auth('auditor') }))
        .status,
      400
    );
    assert.equal(
      (await fetch(`${baseUrl}/v1/tasks/summary?${query}&timezone=Not%2FAZone`, { headers: auth('auditor') }))
        .status,
      400
    );
    assert.equal(
      (await fetch(`${baseUrl}/v1/tasks/summary?${query}&scenario=UNKNOWN`, { headers: auth('auditor') })).status,
      400
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/tasks/summary?${query}&scenario=GENERAL&scenario=GENERAL`, {
          headers: auth('auditor'),
        })
      ).status,
      400
    );
    assert.equal(
      (
        await fetch(
          `${baseUrl}/v1/tasks/summary?${query}&scenario=GENERAL&scenario=CONTENT_CREATION&scenario=DOCUMENT_EDITING&scenario=SYSTEM_MAINTENANCE&scenario=ASSET_PRODUCTION&scenario=DATA_PROCESSING&scenario=SEARCH_QUERY&scenario=GENERAL`,
          { headers: auth('auditor') }
        )
      ).status,
      400
    );
    const tenant2 = await fetch(`${baseUrl}/v1/tasks/summary?${query}`, { headers: auth('tenant2') });
    assert.equal(((await tenant2.json()) as TenantTaskSummary).summary.receivedTasks, '0');
  });
});
