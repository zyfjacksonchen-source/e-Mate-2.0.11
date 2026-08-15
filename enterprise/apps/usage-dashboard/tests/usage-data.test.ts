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
  resolveSameOriginApiPath,
  taskQueryString,
  usageQueryString,
  validateDashboardPair,
  validateUsageEventPage,
} from '../src/api.ts';
import {
  addMetrics,
  callSuccessRate,
  exactCost,
  hasUsageFacts,
  percentage,
  usageDetails,
  usageModels,
  usageTrend,
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
  };
  assert.equal(new URLSearchParams(usageQueryString(query)).has('limit'), false);
  assert.deepEqual([...new URLSearchParams(taskQueryString(query)).keys()], ['from', 'to']);
  assert.equal(new URLSearchParams(usageQueryString(query, true, 'cursor-1')).get('cursor'), 'cursor-1');
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
    'copy.details',
    'copy.reconciliation',
    'copy.viewEvents',
  ]) {
    assert.match(source, new RegExp(metric.replace('.', '\\.')));
  }
  assert.doesNotMatch(source, /metrics\.totalTokens[\s\S]{0,120}tokenLimit|<progress/);
  assert.match(source, /copy\.weeklyQuota/);
  assert.match(readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8'), /\/v1\/admin\/users/);
});

test('builds for the production usage-panel path and same-origin enterprise API', () => {
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.match(
    vite,
    /base: '\/ecorex-agent\/usage-panel\/'/
  );
  assert.match(vite, /'\/v1\/admin': apiTarget/);
  assert.equal(
    readFileSync(new URL('../.env.production', import.meta.url), 'utf8').trim(),
    'VITE_USAGE_API_BASE=/e-mate/enterprise-api/'
  );
});

test('labels the waiting-for-input task event for both dashboard locales', () => {
  assert.equal(messagesFor('zh-CN').eventWaitingInput, '等待用户输入');
  assert.equal(messagesFor('en-US').eventWaitingInput, 'Waiting for input');
});

test('reuses the canonical e-Mate tokens and follows the system theme', () => {
  const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
  assert.match(styles, /upstream\/e-mate-2\.0\.5\/desktop\/src\/styles\/tokens\.css/);
  assert.match(styles, /grid-template-columns: var\(--layout-sidebar-width\)/);
  assert.match(styles, /\.sidebar nav a > span:last-child/);
  assert.doesNotMatch(styles, /\.sidebar nav a span\s*\{/);
  assert.doesNotMatch(styles, /box-shadow: 0 12px 32px|#[0-9a-f]{6}/i);
  assert.match(main, /prefers-color-scheme: dark/);
  assert.match(main, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(main, /systemTheme\.addEventListener\('change', applySystemTheme\)/);
});
