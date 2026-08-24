import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type {
  TenantTaskSummary,
  TenantUsageProjection,
  TenantUsageReconciliation,
  TenantUsageEventPage,
  UsageMetrics,
} from '@e-mate/monitoring-contract';
import {
  queryForPeriod,
  queryForDay,
  queryForRange,
  loginUsageAccount,
  logoutUsageAccount,
  refreshUsageAccount,
  UsageApiError,
  resolveSameOriginApiPath,
  taskQueryString,
  usageQueryString,
  validateDashboardPair,
  validateUsageEventPage,
} from '../src/api.ts';
import {
  addMetrics,
  callSuccessRate,
  exactCount,
  exactCost,
  hasUsageFacts,
  percentage,
  tokenCount,
  usageDetails,
  usageModels,
  usageTrend,
  usageUserTrend,
  usageUsers,
} from '../src/usage-data.ts';
import { messagesFor } from '../src/i18n.ts';

const metrics = (overrides: Partial<UsageMetrics> = {}): UsageMetrics => ({
  totalRequests: '1',
  accountedRequests: '1',
  rejectedRequests: '0',
  pendingRequests: '0',
  usageEvents: '1',
  inputTokens: '1',
  outputTokens: '2',
  cacheReadTokens: '3',
  cacheWriteTokens: '4',
  totalTokens: '10',
  costUsd: '0.100000000001',
  zeroCostUsageEvents: '0',
  unpricedUsageEvents: '0',
  ...overrides,
});

test('aggregates user trend across models without mixing dates or users', () => {
  const projection = {
    groups: [
      { bucketStart: '2026-07-29T00:00:00.000Z', userId: 'user-1', modelId: 'model-1', metrics: metrics() },
      { bucketStart: '2026-07-29T00:00:00.000Z', userId: 'user-1', modelId: 'model-2', metrics: metrics() },
      { bucketStart: '2026-07-30T00:00:00.000Z', userId: 'user-1', modelId: 'model-1', metrics: metrics() },
      { bucketStart: '2026-07-29T00:00:00.000Z', userId: 'user-2', modelId: 'model-1', metrics: metrics() },
    ],
  } as TenantUsageProjection;
  assert.deepEqual(
    usageUserTrend(projection).map(({ bucketStart, userId, metrics: value }) => ({
      bucketStart,
      userId,
      totalRequests: value.totalRequests,
    })),
    [
      { bucketStart: '2026-07-29T00:00:00.000Z', userId: 'user-1', totalRequests: '2' },
      { bucketStart: '2026-07-29T00:00:00.000Z', userId: 'user-2', totalRequests: '1' },
      { bucketStart: '2026-07-30T00:00:00.000Z', userId: 'user-1', totalRequests: '1' },
    ]
  );
});

test('aggregates exact counts and decimals without Number coercion', () => {
  const value = addMetrics(
    metrics({
      totalRequests: '9007199254740993',
      accountedRequests: '9007199254740993',
      inputTokens: '9007199254740993',
      totalTokens: '9007199254741002',
    }),
    metrics()
  );
  assert.equal(value.totalRequests, '9007199254740994');
  assert.equal(value.totalTokens, '9007199254741012');
  assert.equal(value.costUsd, '0.200000000002');
});

test('formats displayed token values with K and M above three digits', () => {
  assert.equal(tokenCount('999'), '999');
  assert.equal(tokenCount('1000'), '1K');
  assert.equal(tokenCount('1250'), '1.3K');
  assert.equal(tokenCount('1000000'), '1M');
  assert.equal(tokenCount('1250000'), '1.3M');
  assert.equal(exactCount('999', 'zh-CN'), '999');
  assert.equal(exactCount('1000', 'zh-CN'), '1K');
  assert.equal(exactCount('1250000', 'zh-CN'), '1.3M');
});

test('groups trends and details only by their declared ledger keys', () => {
  const projection = {
    groups: [
      {
        bucketStart: '2026-07-29T00:00:00.000Z',
        userId: 'user-1',
        modelId: 'model-1',
        metrics: metrics(),
      },
      {
        bucketStart: '2026-07-29T00:00:00.000Z',
        userId: 'user-2',
        modelId: 'model-1',
        metrics: metrics(),
      },
    ],
  } as TenantUsageProjection;
  assert.equal(usageTrend(projection)[0]?.metrics.totalRequests, '2');
  assert.equal(usageDetails(projection).length, 2);
  assert.deepEqual(usageModels(projection), [{ modelId: 'model-1', callCount: '2' }]);
  assert.deepEqual(
    usageUsers(projection).map(({ userId, modelIds, metrics: value }) => ({
      userId,
      modelIds,
      totalTokens: value.totalTokens,
    })),
    [
      { userId: 'user-1', modelIds: ['model-1'], totalTokens: '10' },
      { userId: 'user-2', modelIds: ['model-1'], totalTokens: '10' },
    ]
  );
});

test('uses bounded bigint ratios and exact cost display', () => {
  assert.equal(percentage('9007199254740993', '18014398509481986'), 50);
  assert.equal(exactCost('12345678901234567890.120000000000', 'en-US'), '$12,345,678,901,234,567,890.12');
  assert.equal(percentage('0', '0'), 0);
});

test('calculates call success only from accounted and rejected calls', () => {
  assert.equal(
    callSuccessRate(
      metrics({ totalRequests: '101', accountedRequests: '1', rejectedRequests: '1', pendingRequests: '99' })
    ),
    50
  );
  assert.equal(
    callSuccessRate(
      metrics({ totalRequests: '99', accountedRequests: '0', rejectedRequests: '0', pendingRequests: '99' })
    ),
    null
  );
});

test('keeps an empty ledger distinct from real zero-valued usage', () => {
  assert.equal(
    hasUsageFacts({ summary: metrics({ totalRequests: '0', usageEvents: '0' }) } as TenantUsageProjection),
    false
  );
  assert.equal(
    hasUsageFacts({ summary: metrics({ totalRequests: '0', usageEvents: '1' }) } as TenantUsageProjection),
    true
  );
});

test('rejects invalid periods and cross-scope dashboard pairs', () => {
  assert.throws(() => queryForPeriod(0), /Invalid usage period/);
  const now = new Date('2026-07-03T00:00:00.000Z');
  assert.deepEqual(queryForRange(new Date('2026-07-01T00:00:00.000Z'), new Date('2026-07-02T00:00:00.000Z'), now), {
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-02T00:00:00.000Z',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    bucket: 'DAY',
  });
  assert.throws(
    () => queryForRange(new Date('2026-07-02T00:00:00.000Z'), new Date('2026-07-01T00:00:00.000Z'), now),
    /Invalid usage range/
  );
  assert.throws(
    () => queryForRange(new Date('2026-07-01T00:00:00.000Z'), new Date('2026-07-04T00:00:00.000Z'), now),
    /Invalid usage range/
  );
  const projection = {
    tenantId: 'tenant-a',
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-02T00:00:00.000Z',
  } as TenantUsageProjection;
  const reconciliation = {
    tenantId: 'tenant-b',
    from: projection.from,
    to: projection.to,
  } as TenantUsageReconciliation;
  const taskSummary = {
    tenantId: projection.tenantId,
    from: projection.from,
    to: projection.to,
  } as TenantTaskSummary;
  assert.throws(() => validateDashboardPair(projection, reconciliation, taskSummary), /one ledger scope/);
  const matchingReconciliation = { ...reconciliation, tenantId: projection.tenantId };
  const mismatchedTaskSummary = { ...taskSummary, tenantId: 'tenant-c' };
  assert.throws(
    () => validateDashboardPair(projection, matchingReconciliation, mismatchedTaskSummary),
    /one ledger scope/
  );
});

test('adds event pagination only to event queries and preserves configured query strings', () => {
  const query = {
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-02T00:00:00.000Z',
    timezone: 'Asia/Shanghai',
    bucket: 'DAY' as const,
    userIds: ['user-1', 'user-2'],
  };
  assert.equal(new URLSearchParams(usageQueryString(query)).has('limit'), false);
  assert.deepEqual(new URLSearchParams(usageQueryString(query)).getAll('userId'), ['user-1', 'user-2']);
  assert.deepEqual([...new URLSearchParams(taskQueryString(query)).keys()], ['from', 'to', 'timezone', 'userId', 'userId']);
  assert.equal(new URLSearchParams(taskQueryString(query)).get('timezone'), 'Asia/Shanghai');
  assert.deepEqual(new URLSearchParams(taskQueryString(query)).getAll('userId'), ['user-1', 'user-2']);
  assert.equal(new URLSearchParams(usageQueryString(query, true, 'cursor-1')).get('cursor'), 'cursor-1');
  assert.deepEqual(
    queryForDay('2026-07-01T00:00:00.000Z', '2026-07-02T12:00:00.000Z', 'Asia/Shanghai', ['user-1']),
    {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-02T00:00:00.000Z',
      timezone: 'Asia/Shanghai',
      bucket: 'DAY',
      userIds: ['user-1'],
    }
  );
  assert.equal(
    resolveSameOriginApiPath('/e-mate/enterprise-api/', '/v1/usage/summary?from=one', 'https://example.test'),
    '/e-mate/enterprise-api/v1/usage/summary?from=one'
  );
  assert.throws(
    () => resolveSameOriginApiPath('https://other.test/', '/v1/usage/summary', 'https://example.test'),
    /share the dashboard origin/
  );
});

test('rejects event pages outside the selected tenant ledger scope', () => {
  const query = {
    from: '2026-07-01T00:00:00.000Z',
    to: '2026-07-02T00:00:00.000Z',
    timezone: 'Asia/Shanghai',
    bucket: 'DAY' as const,
  };
  const page: TenantUsageEventPage = {
    schemaVersion: 1,
    scope: 'TENANT',
    tenantId: 'tenant-a',
    from: query.from,
    to: query.to,
    events: [],
    nextCursor: null,
  };
  assert.equal(validateUsageEventPage(page, query, 'tenant-a'), page);
  assert.throws(() => validateUsageEventPage(page, query, 'tenant-b'), /dashboard ledger scope/);
});

test('projects real token, user, quota, model, and reconciliation facts', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const metric of [
    'copy.tasks',
    'copy.requests',
    'copy.totalTokens',
    'copy.configuredQuota',
    'copy.userEventCount',
    'copy.details',
    'copy.reconciliation',
    'copy.viewEvents',
    'copy.customRange',
    'copy.userFilter',
    'copy.modelCallStatus',
    'copy.userTrend',
    'copy.scenarioTrend',
    'copy.visibleColumns',
  ]) {
    assert.match(source, new RegExp(metric.replace('.', '\\.')));
  }
  assert.doesNotMatch(source, /metrics\.totalTokens[\s\S]{0,120}tokenLimit|<progress/);
  assert.match(source, /copy\.weeklyQuota/);
  assert.match(source, /taskSummary\?\.userEventCounts/);
  assert.match(source, /queryForRange/);
  assert.match(source, /mode='multiple'/);
  assert.match(source, /queryForDay/);
  assert.match(source, /usageUserTrend/);
  assert.match(source, /scenarioBuckets/);
  assert.match(source, /displayNameByUserId/);
  assert.match(source, /selectedUserIds\.length \? \{ userIds: selectedUserIds \}/);
  assert.match(source, /eventTypeLabels\[type\].*type/);
  assert.match(source, /status === 401[\s\S]*refreshUsageSession/);
  assert.doesNotMatch(source, /models\.slice/);
  assert.doesNotMatch(source, /eventState\.events[\s\S]{0,160}eventCount/);
  assert.match(readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8'), /\/v1\/admin\/users/);
});

test('builds for the production usage-panel path and same-origin enterprise API', () => {
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(
    vite,
    /base: '\/ecorex-agent\/usage-panel\/'/
  );
  assert.match(vite, /'\/v1\/admin': apiTarget/);
  assert.equal(readFileSync(new URL('../.env.production', import.meta.url), 'utf8').trim(), [
    'VITE_USAGE_API_BASE=/e-mate/enterprise-api/',
    'VITE_AUTH_API_BASE=/e-mate/auth-api/',
    'VITE_AUTH_CLIENT_ID=e-mate-admin',
    'VITE_AUTH_ORGANIZATION=emate-v2',
  ].join('\n'));
  assert.match(vite, /'\/v1\/auth': authTarget/);
});

test('password login reuses the same-origin Auth Gateway and accepts only usage administrators', async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const token = `header.${'a'.repeat(32)}.signature`;
  const fetcher: typeof fetch = async (input, init) => {
    request = { input, init };
    return new Response(JSON.stringify({
      schemaVersion: 1,
      accessToken: token,
      refreshToken: `emate_rt_${'r'.repeat(43)}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      identity: { roles: ['AUDIT_ADMIN'] },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  assert.deepEqual(await loginUsageAccount({
    authBase: '/e-mate/auth-api/',
    clientId: 'e-mate-admin',
    organization: 'emate-v2',
    account: 'auditor',
    password: 'secret',
  }, new AbortController().signal, { origin: 'https://example.test', fetcher }), {
    accessToken: token,
    refreshToken: `emate_rt_${'r'.repeat(43)}`,
  });
  assert.equal(request?.input, '/e-mate/auth-api/v1/auth/password');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    clientId: 'e-mate-admin',
    organization: 'emate-v2',
    user: 'auditor',
    password: 'secret',
  });
  assert.equal(new Headers(request?.init?.headers).get('authorization'), null);

  await assert.rejects(() => loginUsageAccount({
    clientId: 'e-mate-admin',
    organization: 'emate-v2',
    account: 'member',
    password: 'secret',
  }, new AbortController().signal, {
    origin: 'https://example.test',
    fetcher: async () => new Response(JSON.stringify({
      schemaVersion: 1,
      accessToken: token,
      refreshToken: `emate_rt_${'r'.repeat(43)}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      identity: { roles: ['MEMBER'] },
    }), { status: 200 }),
  }), (error: unknown) => error instanceof UsageApiError && error.status === 403);
});

test('refresh rotates an expired usage session through the existing Auth Gateway contract', async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const accessToken = `header.${'a'.repeat(32)}.signature`;
  const refreshToken = `emate_rt_${'r'.repeat(43)}`;
  const rotatedRefreshToken = `emate_rt_${'s'.repeat(43)}`;
  const refreshRequestId = 'refresh-request-1';
  assert.deepEqual(await refreshUsageAccount({
    authBase: '/e-mate/auth-api/',
    clientId: 'e-mate-admin',
    refreshToken,
    refreshRequestId,
  }, new AbortController().signal, {
    origin: 'https://example.test',
    fetcher: async (input, init) => {
      request = { input, init };
      return new Response(JSON.stringify({
        schemaVersion: 1,
        accessToken,
        refreshToken: rotatedRefreshToken,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        identity: { roles: ['AUDIT_ADMIN'] },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  }), { accessToken, refreshToken: rotatedRefreshToken });
  assert.equal(request?.input, '/e-mate/auth-api/v1/auth/refresh');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    clientId: 'e-mate-admin',
    refreshToken,
    refreshRequestId,
  });
  assert.equal(new Headers(request?.init?.headers).get('authorization'), null);
});

test('logout revokes the existing Auth session through the same-origin contract', async () => {
  let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
  const refreshToken = `emate_rt_${'r'.repeat(43)}`;
  const clientRequestId = 'logout-request-1';
  await logoutUsageAccount({
    authBase: '/e-mate/auth-api/',
    clientId: 'e-mate-admin',
    refreshToken,
    clientRequestId,
  }, new AbortController().signal, {
    origin: 'https://example.test',
    fetcher: async (input, init) => {
      request = { input, init };
      return new Response(JSON.stringify({
        schemaVersion: 1,
        receiptId: clientRequestId,
        reauthenticationRequired: false,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(request?.input, '/e-mate/auth-api/v1/auth/logout');
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    clientId: 'e-mate-admin',
    refreshToken,
    clientRequestId,
  });
  assert.equal(new Headers(request?.init?.headers).get('authorization'), null);
});

test('reuses the original labels where task events map without guessing', () => {
  const zh = messagesFor('zh-CN');
  assert.equal(zh.eventReceived, '任务已接收');
  assert.equal(zh.eventCompleted, '任务已完成');
  assert.equal(zh.eventFailed, '任务失败');
  assert.equal(zh.eventCancelled, '任务已取消');
  assert.equal(zh.eventArtifactUpdated, '产物已更新');
  assert.equal(messagesFor('zh-CN').eventWaitingInput, '等待用户输入');
  assert.equal(messagesFor('en-US').eventWaitingInput, 'Waiting for input');
});

test('reuses canonical tokens and lets a valid saved theme override the system theme', () => {
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(styles, /upstream\/e-mate-2\.0\.5\/desktop\/src\/styles\/tokens\.css/);
  assert.match(styles, /grid-template-columns: var\(--layout-sidebar-width\)/);
  assert.match(styles, /\.sidebar nav a > span:last-child/);
  assert.doesNotMatch(styles, /\.sidebar nav a span\s*\{/);
  assert.doesNotMatch(styles, /box-shadow: 0 12px 32px|#[0-9a-f]{6}/i);
  assert.match(main, /prefers-color-scheme: dark/);
  assert.match(main, /value === 'light' \|\| value === 'dark'/);
  assert.match(main, /savedTheme\(\) \?\?/);
  assert.match(main, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(main, /systemTheme\.addEventListener\('change', applySystemTheme\)/);
  assert.match(readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), /localStorage\.setItem\('e-mate\.usage\.theme'/);
});
