import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePlatformMonitoringProjection,
  parseTaskEventInput,
  parseTenantTaskSummary,
  parseTenantUsageEventPage,
  parseTenantUsageProjection,
  parseTenantUsageReconciliation,
} from '../src/index.ts';

test('task events accept metadata only and task summaries conserve explicit outcomes', () => {
  const event = {
    schemaVersion: 1,
    eventId: 'event-1',
    taskId: 'task-1',
    type: 'RECEIVED',
    scenario: 'CONTENT_CREATION',
    occurredAt: '2026-07-25T10:00:00.000Z',
  } as const;
  assert.deepEqual(parseTaskEventInput(event), event);
  assert.equal(
    parseTaskEventInput({ ...event, eventId: 'event-skill', type: 'SKILL_SELECTED' }).type,
    'SKILL_SELECTED'
  );
  assert.throws(() => parseTaskEventInput({ ...event, prompt: 'secret' }));
  assert.throws(() => parseTaskEventInput({ ...event, type: 'ACCOUNTED' }));

  const summary = {
    schemaVersion: 1,
    scope: 'TENANT',
    tenantId: 'tenant-1',
    from: '2026-07-25T00:00:00.000Z',
    to: '2026-07-26T00:00:00.000Z',
    generatedAt: '2026-07-26T00:00:01.000Z',
    sourceState: 'AUTHORITATIVE',
    summary: {
      receivedTasks: '2',
      successfulTasks: '1',
      failedTasks: '0',
      cancelledTasks: '1',
    },
    scenarioCounts: [
      { scenario: 'GENERAL', taskCount: '0' },
      { scenario: 'CONTENT_CREATION', taskCount: '1' },
      { scenario: 'DOCUMENT_EDITING', taskCount: '1' },
      { scenario: 'SYSTEM_MAINTENANCE', taskCount: '0' },
      { scenario: 'ASSET_PRODUCTION', taskCount: '0' },
      { scenario: 'DATA_PROCESSING', taskCount: '0' },
      { scenario: 'SEARCH_QUERY', taskCount: '0' },
    ],
    eventTypeCounts: [
      { type: 'RECEIVED', eventCount: '2' },
      { type: 'FIRST_RESPONSE', eventCount: '2' },
      { type: 'COMPLETED', eventCount: '1' },
      { type: 'FAILED', eventCount: '0' },
      { type: 'CANCELLED', eventCount: '1' },
      { type: 'SKILL_SELECTED', eventCount: '0' },
      { type: 'TOOL_SELECTED', eventCount: '3' },
      { type: 'TOOL_EXECUTION', eventCount: '3' },
      { type: 'PERMISSION_REQUESTED', eventCount: '1' },
      { type: 'WAITING_INPUT', eventCount: '1' },
      { type: 'ARTIFACT_UPDATED', eventCount: '1' },
    ],
    userEventCounts: [
      { userId: 'user-1', eventCount: '8' },
      { userId: 'user-2', eventCount: '7' },
    ],
  } as const;
  assert.deepEqual(parseTenantTaskSummary(summary), summary);
  assert.equal(
    parseTaskEventInput({ ...event, eventId: 'event-waiting', type: 'WAITING_INPUT' }).type,
    'WAITING_INPUT'
  );
  assert.throws(() =>
    parseTenantTaskSummary({
      ...summary,
      summary: { ...summary.summary, failedTasks: '1' },
    })
  );
  assert.throws(() =>
    parseTenantTaskSummary({
      ...summary,
      eventTypeCounts: summary.eventTypeCounts.map((entry) =>
        entry.type === 'COMPLETED' ? { type: entry.type, eventCount: '0' } : entry
      ),
    })
  );
  assert.throws(() =>
    parseTenantTaskSummary({
      ...summary,
      userEventCounts: [{ userId: 'user-1', eventCount: '14' }],
    })
  );
});

const projection = {
  schemaVersion: 1,
  scope: 'PLATFORM',
  period: 'TODAY',
  state: 'OK',
  from: '2026-07-25T10:00:00.000Z',
  to: '2026-07-26T10:00:00.000Z',
  generatedAt: '2026-07-26T10:00:01.000Z',
  sourceUpdatedAt: '2026-07-26T09:59:00.000Z',
  summary: {
    averageTaskDurationMs: 1200,
    toolFailureRate: 0.1,
    agentErrors: 2,
    agentTimeouts: 1,
    toolFailures: 3,
  },
  trend: [
    {
      at: '2026-07-26T09:55:00.000Z',
      completedPerMinute: 2,
      failedPerMinute: 0,
    },
  ],
  missing: [],
} as const;

test('accepts only a bounded platform monitoring projection', () => {
  assert.deepEqual(parsePlatformMonitoringProjection(projection), projection);
  assert.throws(() => parsePlatformMonitoringProjection({ ...projection, tenantId: 'tenant-a' }));
  assert.throws(() =>
    parsePlatformMonitoringProjection({
      ...projection,
      summary: { ...projection.summary, toolFailureRate: 2 },
    })
  );
  assert.throws(() =>
    parsePlatformMonitoringProjection({
      ...projection,
      trend: [...projection.trend, projection.trend[0]],
    })
  );
});

const usageMetrics = {
  totalRequests: '2',
  accountedRequests: '1',
  rejectedRequests: '1',
  pendingRequests: '0',
  usageEvents: '1',
  inputTokens: '7',
  outputTokens: '3',
  cacheReadTokens: '2',
  cacheWriteTokens: '1',
  totalTokens: '13',
  costUsd: '0.100000000001',
  zeroCostUsageEvents: '0',
  unpricedUsageEvents: '0',
} as const;

const usageProjection = {
  schemaVersion: 1,
  scope: 'TENANT',
  tenantId: 'tenant-1',
  from: '2026-07-25T00:00:00.000Z',
  to: '2026-07-27T00:00:00.000Z',
  timezone: 'Asia/Shanghai',
  bucket: 'DAY',
  generatedAt: '2026-07-27T00:00:01.000Z',
  taskCount: '1',
  summary: usageMetrics,
  groups: [
    {
      bucketStart: '2026-07-25T16:00:00.000Z',
      userId: 'user-1',
      modelId: 'gpt-5.6-sol',
      metrics: usageMetrics,
    },
  ],
} as const;

test('usage projection preserves exact integer and decimal ledger totals', () => {
  assert.deepEqual(parseTenantUsageProjection(usageProjection), usageProjection);
  assert.throws(() =>
    parseTenantUsageProjection({
      ...usageProjection,
      taskCount: 1,
    })
  );
  assert.throws(() =>
    parseTenantUsageProjection({
      ...usageProjection,
      summary: { ...usageMetrics, totalTokens: '12' },
    })
  );
  assert.throws(() =>
    parseTenantUsageProjection({
      ...usageProjection,
      summary: { ...usageMetrics, costUsd: '0.1' },
    })
  );
  assert.throws(() =>
    parseTenantUsageProjection({
      ...usageProjection,
      groups: [
        usageProjection.groups[0],
        {
          ...usageProjection.groups[0],
          userId: 'user-0',
        },
      ],
    })
  );
});

test('usage reconciliation state follows mismatch counts', () => {
  const reconciliation = {
    schemaVersion: 1,
    scope: 'TENANT',
    tenantId: 'tenant-1',
    from: '2026-07-25T00:00:00.000Z',
    to: '2026-07-27T00:00:00.000Z',
    checkedAt: '2026-07-27T00:00:01.000Z',
    state: 'MATCHED',
    checks: {
      requestStatuses: '0',
      usageTaskTotals: '0',
      completedInvocationUsage: '0',
      usageInvocationLinks: '0',
    },
  } as const;
  assert.deepEqual(parseTenantUsageReconciliation(reconciliation), reconciliation);
  assert.throws(() =>
    parseTenantUsageReconciliation({
      ...reconciliation,
      checks: { ...reconciliation.checks, usageTaskTotals: '1' },
    })
  );
});

test('usage event pages keep drill-down facts exact and ordered', () => {
  const page = {
    schemaVersion: 1,
    scope: 'TENANT',
    tenantId: 'tenant-1',
    from: '2026-07-25T00:00:00.000Z',
    to: '2026-07-27T00:00:00.000Z',
    events: [
      {
        kind: 'REQUEST',
        eventId: 'invocation-1',
        occurredAt: '2026-07-25T01:00:00.000Z',
        userId: 'user-1',
        taskId: 'task-1',
        traceId: 'trace-1',
        modelId: 'gpt-5.6-sol',
        providerId: 'openai',
        outcome: 'ACCOUNTED',
      },
      {
        kind: 'USAGE',
        eventId: 'response-1',
        occurredAt: '2026-07-25T01:00:01.000Z',
        userId: 'user-1',
        taskId: 'task-1',
        traceId: 'trace-1',
        modelId: 'gpt-5.6-sol',
        providerId: 'openai',
        inputTokens: '1',
        outputTokens: '2',
        cacheReadTokens: '3',
        cacheWriteTokens: '4',
        totalTokens: '10',
        costUsd: null,
      },
    ],
    nextCursor: 'WyJjdXJzb3IiXQ',
  } as const;
  assert.deepEqual(parseTenantUsageEventPage(page), page);
  assert.throws(() =>
    parseTenantUsageEventPage({
      ...page,
      events: [page.events[1], page.events[0]],
    })
  );
});

test('usage event ordering keeps pagination stable when source ids collide', () => {
  const event = {
    kind: 'USAGE',
    eventId: 'response-1',
    occurredAt: '2026-07-25T01:00:01.000Z',
    userId: 'user-1',
    taskId: 'task-1',
    traceId: 'trace-1',
    modelId: 'gpt-5.6-sol',
    providerId: 'openai',
    inputTokens: '1',
    outputTokens: '2',
    cacheReadTokens: '3',
    cacheWriteTokens: '4',
    totalTokens: '10',
    costUsd: null,
  } as const;
  const page = {
    schemaVersion: 1,
    scope: 'TENANT',
    tenantId: 'tenant-1',
    from: '2026-07-25T00:00:00.000Z',
    to: '2026-07-27T00:00:00.000Z',
    events: [event, { ...event, userId: 'user-2', taskId: 'task-2' }],
    nextCursor: null,
  } as const;
  assert.deepEqual(parseTenantUsageEventPage(page), page);
  assert.throws(() => parseTenantUsageEventPage({ ...page, events: [page.events[1], page.events[0]] }));
});
