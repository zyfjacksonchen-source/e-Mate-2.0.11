export type MonitoringPeriod = 'TODAY' | 'WEEK' | 'MONTH';
export type MonitoringState = 'OK' | 'NO_DATA' | 'STALE' | 'PARTIAL';
export type UsageBucket = 'HOUR' | 'DAY';

export const TASK_EVENT_TYPES = [
  'RECEIVED',
  'FIRST_RESPONSE',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'SKILL_SELECTED',
  'TOOL_SELECTED',
  'TOOL_EXECUTION',
  'PERMISSION_REQUESTED',
  'WAITING_INPUT',
  'ARTIFACT_UPDATED',
] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export const TASK_SCENARIOS = [
  'GENERAL',
  'CONTENT_CREATION',
  'DOCUMENT_EDITING',
  'SYSTEM_MAINTENANCE',
  'ASSET_PRODUCTION',
  'DATA_PROCESSING',
  'SEARCH_QUERY',
] as const;
export type TaskScenario = (typeof TASK_SCENARIOS)[number];

export type TaskEventInput = {
  schemaVersion: 1;
  eventId: string;
  taskId: string;
  type: TaskEventType;
  scenario: TaskScenario;
  occurredAt: string;
};

export type TenantTaskSummary = {
  schemaVersion: 1;
  scope: 'TENANT';
  tenantId: string;
  from: string;
  to: string;
  generatedAt: string;
  sourceState: 'AUTHORITATIVE' | 'NO_DATA';
  summary: {
    receivedTasks: string;
    successfulTasks: string;
    failedTasks: string;
    cancelledTasks: string;
  };
  scenarioCounts: Array<{
    scenario: TaskScenario;
    taskCount: string;
  }>;
  scenarioBuckets: Array<{
    bucketStart: string;
    scenario: TaskScenario;
    taskCount: string;
  }>;
  eventTypeCounts: Array<{
    type: TaskEventType;
    eventCount: string;
  }>;
  userEventCounts: Array<{
    userId: string;
    eventCount: string;
  }>;
};

export type UsageMetrics = {
  totalRequests: string;
  accountedRequests: string;
  rejectedRequests: string;
  pendingRequests: string;
  usageEvents: string;
  inputTokens: string;
  outputTokens: string;
  cacheReadTokens: string;
  cacheWriteTokens: string;
  totalTokens: string;
  costUsd: string;
  zeroCostUsageEvents: string;
  unpricedUsageEvents: string;
};

export type TenantUsageProjection = {
  schemaVersion: 1;
  scope: 'TENANT';
  tenantId: string;
  from: string;
  to: string;
  timezone: string;
  bucket: UsageBucket;
  generatedAt: string;
  taskCount: string;
  summary: UsageMetrics;
  groups: Array<{
    bucketStart: string;
    userId: string;
    modelId: string;
    metrics: UsageMetrics;
  }>;
};

export type TenantUsageReconciliation = {
  schemaVersion: 1;
  scope: 'TENANT';
  tenantId: string;
  from: string;
  to: string;
  checkedAt: string;
  state: 'MATCHED' | 'MISMATCHED';
  checks: {
    requestStatuses: string;
    usageTaskTotals: string;
    completedInvocationUsage: string;
    usageInvocationLinks: string;
  };
};

export type TenantUsageEvent =
  | {
      kind: 'REQUEST';
      eventId: string;
      occurredAt: string;
      userId: string;
      taskId: string;
      traceId: string;
      modelId: string;
      providerId: string;
      outcome: 'ACCOUNTED' | 'REJECTED' | 'PENDING';
    }
  | {
      kind: 'USAGE';
      eventId: string;
      occurredAt: string;
      userId: string;
      taskId: string;
      traceId: string;
      modelId: string;
      providerId: string;
      inputTokens: string;
      outputTokens: string;
      cacheReadTokens: string;
      cacheWriteTokens: string;
      totalTokens: string;
      costUsd: string | null;
    };

export type TenantUsageEventPage = {
  schemaVersion: 1;
  scope: 'TENANT';
  tenantId: string;
  from: string;
  to: string;
  events: TenantUsageEvent[];
  nextCursor: string | null;
};

export type PlatformMonitoringProjection = {
  schemaVersion: 1;
  scope: 'PLATFORM';
  period: MonitoringPeriod;
  state: MonitoringState;
  from: string;
  to: string;
  generatedAt: string;
  sourceUpdatedAt: string | null;
  summary: {
    averageTaskDurationMs: number | null;
    toolFailureRate: number | null;
    agentErrors: number | null;
    agentTimeouts: number | null;
    toolFailures: number | null;
  };
  trend: Array<{
    at: string;
    completedPerMinute: number | null;
    failedPerMinute: number | null;
  }>;
  missing: Array<
    | 'TASK_DURATION'
    | 'TOOL_FAILURE_RATE'
    | 'AGENT_ERROR'
    | 'AGENT_TIMEOUT'
    | 'TASK_TREND_SUCCESS'
    | 'TASK_TREND_FAILURE'
  >;
};

const periods = new Set<MonitoringPeriod>(['TODAY', 'WEEK', 'MONTH']);
const states = new Set<MonitoringState>(['OK', 'NO_DATA', 'STALE', 'PARTIAL']);
const usageBuckets = new Set<UsageBucket>(['HOUR', 'DAY']);
const taskEventTypes = new Set<TaskEventType>(TASK_EVENT_TYPES);
const taskScenarios = new Set<TaskScenario>(TASK_SCENARIOS);
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const countPattern = /^(0|[1-9]\d{0,39})$/;
const costPattern = /^(0|[1-9]\d{0,29})\.\d{12}$/;
const queryIds = new Set<PlatformMonitoringProjection['missing'][number]>([
  'TASK_DURATION',
  'TOOL_FAILURE_RATE',
  'AGENT_ERROR',
  'AGENT_TIMEOUT',
  'TASK_TREND_SUCCESS',
  'TASK_TREND_FAILURE',
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== fields.length || actual.some((key) => !fields.includes(key))) {
    throw new Error(`Invalid ${label} fields`);
  }
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 64 || new Date(value).toISOString() !== value) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function metric(value: unknown, label: string, ratio = false): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (ratio && value > 1)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !identifierPattern.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function principal(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 128 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function countString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !countPattern.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function costString(value: unknown): string {
  if (typeof value !== 'string' || !costPattern.test(value)) {
    throw new Error('Invalid usage cost');
  }
  return value;
}

export function parseTaskEventInput(value: unknown): TaskEventInput {
  const input = record(value, 'task event');
  exact(input, ['schemaVersion', 'eventId', 'taskId', 'type', 'scenario', 'occurredAt'], 'task event');
  if (
    input.schemaVersion !== 1 ||
    !taskEventTypes.has(input.type as TaskEventType) ||
    !taskScenarios.has(input.scenario as TaskScenario)
  ) {
    throw new Error('Invalid task event');
  }
  return {
    schemaVersion: 1,
    eventId: identifier(input.eventId, 'task event id'),
    taskId: identifier(input.taskId, 'task id'),
    type: input.type as TaskEventType,
    scenario: input.scenario as TaskScenario,
    occurredAt: timestamp(input.occurredAt, 'task event time'),
  };
}

export function parseTenantTaskSummary(value: unknown): TenantTaskSummary {
  const input = record(value, 'tenant task summary');
  exact(
    input,
    [
      'schemaVersion',
      'scope',
      'tenantId',
      'from',
      'to',
      'generatedAt',
      'sourceState',
      'summary',
      'scenarioCounts',
      'scenarioBuckets',
      'eventTypeCounts',
      'userEventCounts',
    ],
    'tenant task summary'
  );
  if (
    input.schemaVersion !== 1 ||
    input.scope !== 'TENANT' ||
    !['AUTHORITATIVE', 'NO_DATA'].includes(String(input.sourceState))
  ) {
    throw new Error('Invalid tenant task summary');
  }
  const from = timestamp(input.from, 'task summary start');
  const to = timestamp(input.to, 'task summary end');
  const generatedAt = timestamp(input.generatedAt, 'task summary generation time');
  if (Date.parse(from) >= Date.parse(to) || Date.parse(to) > Date.parse(generatedAt)) {
    throw new Error('Invalid task summary range');
  }

  const summaryInput = record(input.summary, 'task summary totals');
  exact(summaryInput, ['receivedTasks', 'successfulTasks', 'failedTasks', 'cancelledTasks'], 'task summary totals');
  const summary = {
    receivedTasks: countString(summaryInput.receivedTasks, 'received task count'),
    successfulTasks: countString(summaryInput.successfulTasks, 'successful task count'),
    failedTasks: countString(summaryInput.failedTasks, 'failed task count'),
    cancelledTasks: countString(summaryInput.cancelledTasks, 'cancelled task count'),
  };
  if (
    BigInt(summary.successfulTasks) + BigInt(summary.failedTasks) + BigInt(summary.cancelledTasks) >
    BigInt(summary.receivedTasks)
  ) {
    throw new Error('Inconsistent task summary totals');
  }

  if (!Array.isArray(input.scenarioCounts) || input.scenarioCounts.length !== TASK_SCENARIOS.length) {
    throw new Error('Invalid task scenario counts');
  }
  const scenarioCounts = input.scenarioCounts.map((entry) => {
    const item = record(entry, 'task scenario count');
    exact(item, ['scenario', 'taskCount'], 'task scenario count');
    if (!taskScenarios.has(item.scenario as TaskScenario)) {
      throw new Error('Invalid task scenario');
    }
    return {
      scenario: item.scenario as TaskScenario,
      taskCount: countString(item.taskCount, 'scenario task count'),
    };
  });
  if (
    new Set(scenarioCounts.map(({ scenario }) => scenario)).size !== TASK_SCENARIOS.length ||
    scenarioCounts.reduce((total, item) => total + BigInt(item.taskCount), BigInt(0)) !== BigInt(summary.receivedTasks)
  ) {
    throw new Error('Inconsistent task scenario counts');
  }

  if (!Array.isArray(input.scenarioBuckets) || input.scenarioBuckets.length > TASK_SCENARIOS.length * 367) {
    throw new Error('Invalid task scenario buckets');
  }
  const scenarioBuckets = input.scenarioBuckets.map((entry) => {
    const item = record(entry, 'task scenario bucket');
    exact(item, ['bucketStart', 'scenario', 'taskCount'], 'task scenario bucket');
    const bucketStart = timestamp(item.bucketStart, 'task scenario bucket start');
    if (
      !taskScenarios.has(item.scenario as TaskScenario) ||
      Date.parse(bucketStart) < Date.parse(from) - 86_400_000 ||
      Date.parse(bucketStart) >= Date.parse(to)
    ) {
      throw new Error('Invalid task scenario bucket');
    }
    return {
      bucketStart,
      scenario: item.scenario as TaskScenario,
      taskCount: countString(item.taskCount, 'scenario bucket task count'),
    };
  });
  if (
    new Set(scenarioBuckets.map(({ bucketStart, scenario }) => `${bucketStart}\0${scenario}`)).size !==
      scenarioBuckets.length ||
    scenarioBuckets.reduce((total, item) => total + BigInt(item.taskCount), 0n) !== BigInt(summary.receivedTasks)
  ) {
    throw new Error('Inconsistent task scenario buckets');
  }

  if (!Array.isArray(input.eventTypeCounts) || input.eventTypeCounts.length !== TASK_EVENT_TYPES.length) {
    throw new Error('Invalid task event type counts');
  }
  const eventTypeCounts = input.eventTypeCounts.map((entry) => {
    const item = record(entry, 'task event type count');
    exact(item, ['type', 'eventCount'], 'task event type count');
    if (!taskEventTypes.has(item.type as TaskEventType)) {
      throw new Error('Invalid task event type');
    }
    return {
      type: item.type as TaskEventType,
      eventCount: countString(item.eventCount, 'task event count'),
    };
  });
  if (new Set(eventTypeCounts.map(({ type }) => type)).size !== TASK_EVENT_TYPES.length) {
    throw new Error('Duplicate task event type count');
  }
  if (!Array.isArray(input.userEventCounts) || input.userEventCounts.length > 10_000) {
    throw new Error('Invalid task user event counts');
  }
  const userEventCounts = input.userEventCounts.map((entry) => {
    const item = record(entry, 'task user event count');
    exact(item, ['userId', 'eventCount'], 'task user event count');
    return {
      userId: principal(item.userId, 'task user id'),
      eventCount: countString(item.eventCount, 'task user event count'),
    };
  });
  if (
    new Set(userEventCounts.map(({ userId }) => userId)).size !== userEventCounts.length ||
    userEventCounts.reduce((total, item) => total + BigInt(item.eventCount), 0n) !==
      eventTypeCounts.reduce((total, item) => total + BigInt(item.eventCount), 0n)
  ) {
    throw new Error('Inconsistent task user event counts');
  }
  const eventCounts = Object.fromEntries(eventTypeCounts.map(({ type, eventCount }) => [type, eventCount]));
  if (
    eventCounts.RECEIVED !== summary.receivedTasks ||
    eventCounts.COMPLETED !== summary.successfulTasks ||
    eventCounts.FAILED !== summary.failedTasks ||
    eventCounts.CANCELLED !== summary.cancelledTasks
  ) {
    throw new Error('Inconsistent task outcome event counts');
  }
  const sourceState = input.sourceState as TenantTaskSummary['sourceState'];
  if ((summary.receivedTasks === '0') !== (sourceState === 'NO_DATA')) {
    throw new Error('Inconsistent task source state');
  }

  return {
    schemaVersion: 1,
    scope: 'TENANT',
    tenantId: identifier(input.tenantId, 'task tenant id'),
    from,
    to,
    generatedAt,
    sourceState,
    summary,
    scenarioCounts,
    scenarioBuckets,
    eventTypeCounts,
    userEventCounts,
  };
}

function parseUsageMetrics(value: unknown): UsageMetrics {
  const input = record(value, 'usage metrics');
  exact(
    input,
    [
      'totalRequests',
      'accountedRequests',
      'rejectedRequests',
      'pendingRequests',
      'usageEvents',
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'totalTokens',
      'costUsd',
      'zeroCostUsageEvents',
      'unpricedUsageEvents',
    ],
    'usage metrics'
  );
  const parsed = {
    totalRequests: countString(input.totalRequests, 'total request count'),
    accountedRequests: countString(input.accountedRequests, 'accounted request count'),
    rejectedRequests: countString(input.rejectedRequests, 'rejected request count'),
    pendingRequests: countString(input.pendingRequests, 'pending request count'),
    usageEvents: countString(input.usageEvents, 'usage event count'),
    inputTokens: countString(input.inputTokens, 'input token count'),
    outputTokens: countString(input.outputTokens, 'output token count'),
    cacheReadTokens: countString(input.cacheReadTokens, 'cache read token count'),
    cacheWriteTokens: countString(input.cacheWriteTokens, 'cache write token count'),
    totalTokens: countString(input.totalTokens, 'total token count'),
    costUsd: costString(input.costUsd),
    zeroCostUsageEvents: countString(input.zeroCostUsageEvents, 'zero-cost usage event count'),
    unpricedUsageEvents: countString(input.unpricedUsageEvents, 'unpriced usage event count'),
  };
  if (
    BigInt(parsed.totalRequests) !==
      BigInt(parsed.accountedRequests) + BigInt(parsed.rejectedRequests) + BigInt(parsed.pendingRequests) ||
    BigInt(parsed.totalTokens) !==
      BigInt(parsed.inputTokens) +
        BigInt(parsed.outputTokens) +
        BigInt(parsed.cacheReadTokens) +
        BigInt(parsed.cacheWriteTokens) ||
    BigInt(parsed.zeroCostUsageEvents) + BigInt(parsed.unpricedUsageEvents) > BigInt(parsed.usageEvents)
  ) {
    throw new Error('Inconsistent usage metrics');
  }
  return parsed;
}

function costUnits(value: string): bigint {
  return BigInt(value.replace('.', ''));
}

function usageMetricsEqual(left: UsageMetrics, right: UsageMetrics): boolean {
  return (Object.keys(left) as Array<keyof UsageMetrics>).every((key) => left[key] === right[key]);
}

function sumUsageMetrics(values: UsageMetrics[]): UsageMetrics {
  const countFields = [
    'totalRequests',
    'accountedRequests',
    'rejectedRequests',
    'pendingRequests',
    'usageEvents',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'totalTokens',
    'zeroCostUsageEvents',
    'unpricedUsageEvents',
  ] as const;
  const result = Object.fromEntries(
    countFields.map((field) => [
      field,
      values.reduce((total, value) => total + BigInt(value[field]), BigInt(0)).toString(),
    ])
  ) as Omit<UsageMetrics, 'costUsd'>;
  const units = values.reduce((total, value) => total + costUnits(value.costUsd), BigInt(0));
  const digits = units.toString().padStart(13, '0');
  return {
    ...result,
    costUsd: `${digits.slice(0, -12)}.${digits.slice(-12)}`,
  };
}

export function parseTenantUsageProjection(value: unknown): TenantUsageProjection {
  const input = record(value, 'tenant usage projection');
  exact(
    input,
    [
      'schemaVersion',
      'scope',
      'tenantId',
      'from',
      'to',
      'timezone',
      'bucket',
      'generatedAt',
      'taskCount',
      'summary',
      'groups',
    ],
    'tenant usage projection'
  );
  if (
    input.schemaVersion !== 1 ||
    input.scope !== 'TENANT' ||
    !usageBuckets.has(input.bucket as UsageBucket) ||
    typeof input.timezone !== 'string' ||
    input.timezone.length < 1 ||
    input.timezone.length > 64 ||
    /\p{Cc}/u.test(input.timezone)
  ) {
    throw new Error('Invalid tenant usage projection');
  }
  const from = timestamp(input.from, 'usage start');
  const to = timestamp(input.to, 'usage end');
  const generatedAt = timestamp(input.generatedAt, 'usage generation time');
  if (Date.parse(from) >= Date.parse(to)) {
    throw new Error('Invalid usage time range');
  }
  if (!Array.isArray(input.groups) || input.groups.length > 10_000) {
    throw new Error('Invalid usage groups');
  }
  const groups = input.groups.map((groupValue) => {
    const group = record(groupValue, 'usage group');
    exact(group, ['bucketStart', 'userId', 'modelId', 'metrics'], 'usage group');
    const bucketStart = timestamp(group.bucketStart, 'usage bucket start');
    if (Date.parse(bucketStart) < Date.parse(from) || Date.parse(bucketStart) >= Date.parse(to)) {
      throw new Error('Usage bucket is outside the requested range');
    }
    return {
      bucketStart,
      userId: identifier(group.userId, 'usage user id'),
      modelId: identifier(group.modelId, 'usage model id'),
      metrics: parseUsageMetrics(group.metrics),
    };
  });
  if (
    groups.some((group, index) => {
      if (index === 0) return false;
      const prior = groups[index - 1] as (typeof groups)[number];
      return (
        `${group.bucketStart}\0${group.userId}\0${group.modelId}` <=
        `${prior.bucketStart}\0${prior.userId}\0${prior.modelId}`
      );
    })
  ) {
    throw new Error('Invalid usage group order');
  }
  const summary = parseUsageMetrics(input.summary);
  if (!usageMetricsEqual(summary, sumUsageMetrics(groups.map(({ metrics }) => metrics)))) {
    throw new Error('Usage summary does not match grouped facts');
  }
  return {
    schemaVersion: 1,
    scope: 'TENANT',
    tenantId: identifier(input.tenantId, 'usage tenant id'),
    from,
    to,
    timezone: input.timezone,
    bucket: input.bucket as UsageBucket,
    generatedAt,
    taskCount: countString(input.taskCount, 'task count'),
    summary,
    groups,
  };
}

export function parseTenantUsageReconciliation(value: unknown): TenantUsageReconciliation {
  const input = record(value, 'tenant usage reconciliation');
  exact(
    input,
    ['schemaVersion', 'scope', 'tenantId', 'from', 'to', 'checkedAt', 'state', 'checks'],
    'tenant usage reconciliation'
  );
  if (
    input.schemaVersion !== 1 ||
    input.scope !== 'TENANT' ||
    !['MATCHED', 'MISMATCHED'].includes(String(input.state))
  ) {
    throw new Error('Invalid tenant usage reconciliation');
  }
  const from = timestamp(input.from, 'usage reconciliation start');
  const to = timestamp(input.to, 'usage reconciliation end');
  const checkedAt = timestamp(input.checkedAt, 'usage reconciliation time');
  if (Date.parse(from) >= Date.parse(to)) {
    throw new Error('Invalid usage reconciliation range');
  }
  const checks = record(input.checks, 'usage reconciliation checks');
  exact(
    checks,
    ['requestStatuses', 'usageTaskTotals', 'completedInvocationUsage', 'usageInvocationLinks'],
    'usage reconciliation checks'
  );
  const parsedChecks = {
    requestStatuses: countString(checks.requestStatuses, 'request status mismatch count'),
    usageTaskTotals: countString(checks.usageTaskTotals, 'usage task mismatch count'),
    completedInvocationUsage: countString(checks.completedInvocationUsage, 'completed invocation mismatch count'),
    usageInvocationLinks: countString(checks.usageInvocationLinks, 'usage invocation mismatch count'),
  };
  const matched = Object.values(parsedChecks).every((mismatches) => mismatches === '0');
  if ((input.state === 'MATCHED') !== matched) {
    throw new Error('Usage reconciliation state is inconsistent');
  }
  return {
    schemaVersion: 1,
    scope: 'TENANT',
    tenantId: identifier(input.tenantId, 'usage tenant id'),
    from,
    to,
    checkedAt,
    state: input.state as TenantUsageReconciliation['state'],
    checks: parsedChecks,
  };
}

export function parseTenantUsageEventPage(value: unknown): TenantUsageEventPage {
  const input = record(value, 'tenant usage event page');
  exact(input, ['schemaVersion', 'scope', 'tenantId', 'from', 'to', 'events', 'nextCursor'], 'tenant usage event page');
  if (
    input.schemaVersion !== 1 ||
    input.scope !== 'TENANT' ||
    (input.nextCursor !== null &&
      (typeof input.nextCursor !== 'string' ||
        input.nextCursor.length < 1 ||
        input.nextCursor.length > 512 ||
        !/^[A-Za-z0-9_-]+$/.test(input.nextCursor)))
  ) {
    throw new Error('Invalid tenant usage event page');
  }
  const from = timestamp(input.from, 'usage event start');
  const to = timestamp(input.to, 'usage event end');
  if (Date.parse(from) >= Date.parse(to) || !Array.isArray(input.events) || input.events.length > 200) {
    throw new Error('Invalid usage event range');
  }
  const events = input.events.map((eventValue): TenantUsageEvent => {
    const event = record(eventValue, 'usage event');
    const commonFields = ['kind', 'eventId', 'occurredAt', 'userId', 'taskId', 'traceId', 'modelId', 'providerId'];
    const kind = event.kind;
    exact(
      event,
      kind === 'REQUEST'
        ? [...commonFields, 'outcome']
        : [
            ...commonFields,
            'inputTokens',
            'outputTokens',
            'cacheReadTokens',
            'cacheWriteTokens',
            'totalTokens',
            'costUsd',
          ],
      'usage event'
    );
    const common = {
      eventId: identifier(event.eventId, 'usage event id'),
      occurredAt: timestamp(event.occurredAt, 'usage event time'),
      userId: identifier(event.userId, 'usage user id'),
      taskId: identifier(event.taskId, 'usage task id'),
      traceId: identifier(event.traceId, 'usage trace id'),
      modelId: identifier(event.modelId, 'usage model id'),
      providerId: identifier(event.providerId, 'usage provider id'),
    };
    if (Date.parse(common.occurredAt) < Date.parse(from) || Date.parse(common.occurredAt) >= Date.parse(to)) {
      throw new Error('Usage event is outside the requested range');
    }
    if (kind === 'REQUEST') {
      if (!['ACCOUNTED', 'REJECTED', 'PENDING'].includes(String(event.outcome))) {
        throw new Error('Invalid usage request outcome');
      }
      return {
        kind,
        ...common,
        outcome: event.outcome as 'ACCOUNTED' | 'REJECTED' | 'PENDING',
      };
    }
    if (kind !== 'USAGE') throw new Error('Invalid usage event kind');
    const usage = {
      inputTokens: countString(event.inputTokens, 'input token count'),
      outputTokens: countString(event.outputTokens, 'output token count'),
      cacheReadTokens: countString(event.cacheReadTokens, 'cache read token count'),
      cacheWriteTokens: countString(event.cacheWriteTokens, 'cache write token count'),
      totalTokens: countString(event.totalTokens, 'total token count'),
      costUsd: event.costUsd === null ? null : costString(event.costUsd),
    };
    if (
      BigInt(usage.totalTokens) !==
      BigInt(usage.inputTokens) +
        BigInt(usage.outputTokens) +
        BigInt(usage.cacheReadTokens) +
        BigInt(usage.cacheWriteTokens)
    ) {
      throw new Error('Inconsistent usage event tokens');
    }
    return { kind, ...common, ...usage };
  });
  if (
    events.some((event, index) => {
      if (index === 0) return false;
      const prior = events[index - 1] as TenantUsageEvent;
      return (
        `${event.occurredAt}\0${event.kind}\0${event.eventId}\0${event.userId}\0${event.taskId}` <=
        `${prior.occurredAt}\0${prior.kind}\0${prior.eventId}\0${prior.userId}\0${prior.taskId}`
      );
    })
  ) {
    throw new Error('Invalid usage event order');
  }
  return {
    schemaVersion: 1,
    scope: 'TENANT',
    tenantId: identifier(input.tenantId, 'usage tenant id'),
    from,
    to,
    events,
    nextCursor: input.nextCursor as string | null,
  };
}

export function parseMonitoringPeriod(value: unknown): MonitoringPeriod {
  if (!periods.has(value as MonitoringPeriod)) {
    throw new Error('Invalid monitoring period');
  }
  return value as MonitoringPeriod;
}

export function parsePlatformMonitoringProjection(value: unknown): PlatformMonitoringProjection {
  const input = record(value, 'platform monitoring projection');
  exact(
    input,
    [
      'schemaVersion',
      'scope',
      'period',
      'state',
      'from',
      'to',
      'generatedAt',
      'sourceUpdatedAt',
      'summary',
      'trend',
      'missing',
    ],
    'platform monitoring projection'
  );
  const period = parseMonitoringPeriod(input.period);
  if (input.schemaVersion !== 1 || input.scope !== 'PLATFORM' || !states.has(input.state as MonitoringState)) {
    throw new Error('Invalid platform monitoring projection');
  }
  const from = timestamp(input.from, 'monitoring start');
  const to = timestamp(input.to, 'monitoring end');
  const generatedAt = timestamp(input.generatedAt, 'monitoring generation time');
  if (Date.parse(from) >= Date.parse(to) || Date.parse(to) > Date.parse(generatedAt)) {
    throw new Error('Invalid monitoring time range');
  }
  const sourceUpdatedAt =
    input.sourceUpdatedAt === null ? null : timestamp(input.sourceUpdatedAt, 'monitoring source update');
  if (
    sourceUpdatedAt &&
    (Date.parse(sourceUpdatedAt) < Date.parse(from) || Date.parse(sourceUpdatedAt) > Date.parse(to))
  ) {
    throw new Error('Invalid monitoring source time');
  }
  const summary = record(input.summary, 'monitoring summary');
  exact(
    summary,
    ['averageTaskDurationMs', 'toolFailureRate', 'agentErrors', 'agentTimeouts', 'toolFailures'],
    'monitoring summary'
  );
  if (!Array.isArray(input.trend) || input.trend.length > 128) {
    throw new Error('Invalid monitoring trend');
  }
  const trend = input.trend.map((value) => {
    const point = record(value, 'monitoring trend point');
    exact(point, ['at', 'completedPerMinute', 'failedPerMinute'], 'monitoring trend point');
    const at = timestamp(point.at, 'monitoring point time');
    if (Date.parse(at) < Date.parse(from) || Date.parse(at) > Date.parse(to)) {
      throw new Error('Invalid monitoring point time');
    }
    return {
      at,
      completedPerMinute: metric(point.completedPerMinute, 'completed task rate'),
      failedPerMinute: metric(point.failedPerMinute, 'failed task rate'),
    };
  });
  if (
    trend.some((point, index) => index > 0 && Date.parse(point.at) <= Date.parse(trend[index - 1]!.at)) ||
    !Array.isArray(input.missing) ||
    input.missing.length > queryIds.size
  ) {
    throw new Error('Invalid monitoring projection order');
  }
  const missing = input.missing.map((value) => {
    if (!queryIds.has(value as PlatformMonitoringProjection['missing'][number])) {
      throw new Error('Invalid monitoring query ID');
    }
    return value as PlatformMonitoringProjection['missing'][number];
  });
  if (new Set(missing).size !== missing.length) {
    throw new Error('Duplicate monitoring query ID');
  }
  const parsedSummary = {
    averageTaskDurationMs: metric(summary.averageTaskDurationMs, 'average task duration'),
    toolFailureRate: metric(summary.toolFailureRate, 'tool failure rate', true),
    agentErrors: metric(summary.agentErrors, 'agent errors'),
    agentTimeouts: metric(summary.agentTimeouts, 'agent timeouts'),
    toolFailures: metric(summary.toolFailures, 'tool failures'),
  };
  const expectedMissing = [
    ...(parsedSummary.averageTaskDurationMs === null ? ['TASK_DURATION' as const] : []),
    ...(parsedSummary.toolFailureRate === null ? ['TOOL_FAILURE_RATE' as const] : []),
    ...(parsedSummary.agentErrors === null ? ['AGENT_ERROR' as const] : []),
    ...(parsedSummary.agentTimeouts === null ? ['AGENT_TIMEOUT' as const] : []),
    ...(trend.every(({ completedPerMinute }) => completedPerMinute === null) ? ['TASK_TREND_SUCCESS' as const] : []),
    ...(trend.every(({ failedPerMinute }) => failedPerMinute === null) ? ['TASK_TREND_FAILURE' as const] : []),
  ];
  if (missing.length !== expectedMissing.length || missing.some((queryId) => !expectedMissing.includes(queryId))) {
    throw new Error('Monitoring missing facts are inconsistent');
  }
  const state = input.state as MonitoringState;
  if (
    (state === 'NO_DATA' &&
      (sourceUpdatedAt !== null ||
        trend.length !== 0 ||
        missing.length !== queryIds.size ||
        Object.values(parsedSummary).some((metric) => metric !== null))) ||
    (state === 'OK' && missing.length !== 0) ||
    (state === 'PARTIAL' && (missing.length === 0 || sourceUpdatedAt === null)) ||
    (state === 'STALE' && sourceUpdatedAt === null)
  ) {
    throw new Error('Invalid monitoring availability state');
  }
  return {
    schemaVersion: 1,
    scope: 'PLATFORM',
    period,
    state,
    from,
    to,
    generatedAt,
    sourceUpdatedAt,
    summary: parsedSummary,
    trend,
    missing,
  };
}
