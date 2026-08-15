import {
  parseTenantTaskSummary,
  parseTenantUsageEventPage,
  parseTenantUsageProjection,
  parseTenantUsageReconciliation,
  type TenantTaskSummary,
  type TenantUsageEventPage,
  type TenantUsageProjection,
  type TenantUsageReconciliation,
  type UsageBucket,
} from '@e-mate/monitoring-contract';

export type UsageQuery = {
  from: string;
  to: string;
  timezone: string;
  bucket: UsageBucket;
};

export type UsageDashboardData = {
  projection: TenantUsageProjection;
  reconciliation: TenantUsageReconciliation;
  taskSummary: TenantTaskSummary;
};

export class UsageApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Usage API request failed with status ${status}`);
    this.status = status;
  }
}

export function queryForPeriod(days: number, now = new Date()): UsageQuery {
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new Error('Invalid usage period');
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    from: new Date(now.getTime() - days * 86_400_000).toISOString(),
    to: now.toISOString(),
    timezone,
    bucket: 'DAY',
  };
}

export function usageQueryString(query: UsageQuery, events = false, cursor: string | null = null): string {
  const parameters = new URLSearchParams({
    from: query.from,
    to: query.to,
    timezone: query.timezone,
    bucket: query.bucket,
  });
  if (events) {
    if (cursor) parameters.set('cursor', cursor);
    parameters.set('limit', '100');
  }
  return parameters.toString();
}

export function taskQueryString(query: UsageQuery): string {
  return new URLSearchParams({ from: query.from, to: query.to }).toString();
}

export function resolveSameOriginApiPath(configured: string | undefined, path: string, origin: string): string {
  if (!configured) return path;
  const base = new URL(configured, origin);
  if (base.origin !== origin) {
    throw new Error('Usage API must share the dashboard origin');
  }
  const endpoint = new URL(path.replace(/^\//, ''), `${base.href.replace(/\/?$/, '/')}`);
  return `${endpoint.pathname}${endpoint.search}`;
}

function apiUrl(path: string): string {
  return resolveSameOriginApiPath(
    import.meta.env.VITE_USAGE_API_BASE as string | undefined,
    path,
    window.location.origin
  );
}

async function readJson(path: string, token: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(apiUrl(path), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw new UsageApiError(response.status);
  return response.json();
}

export function validateDashboardPair(
  projection: TenantUsageProjection,
  reconciliation: TenantUsageReconciliation,
  taskSummary: TenantTaskSummary
): UsageDashboardData {
  if (
    projection.tenantId !== reconciliation.tenantId ||
    projection.tenantId !== taskSummary.tenantId ||
    projection.from !== reconciliation.from ||
    projection.from !== taskSummary.from ||
    projection.to !== reconciliation.to ||
    projection.to !== taskSummary.to
  ) {
    throw new Error('Usage projections do not share one ledger scope');
  }
  return { projection, reconciliation, taskSummary };
}

export async function loadUsageDashboard(
  token: string,
  query: UsageQuery,
  signal: AbortSignal
): Promise<UsageDashboardData> {
  const parameters = usageQueryString(query);
  const [projectionValue, reconciliationValue, taskSummaryValue] = await Promise.all([
    readJson(`/v1/usage/summary?${parameters}`, token, signal),
    readJson(`/v1/usage/reconciliation?${parameters}`, token, signal),
    readJson(`/v1/tasks/summary?${taskQueryString(query)}`, token, signal),
  ]);
  return validateDashboardPair(
    parseTenantUsageProjection(projectionValue),
    parseTenantUsageReconciliation(reconciliationValue),
    parseTenantTaskSummary(taskSummaryValue)
  );
}

export async function loadUsageEvents(
  token: string,
  query: UsageQuery,
  cursor: string | null,
  signal: AbortSignal
): Promise<TenantUsageEventPage> {
  return parseTenantUsageEventPage(
    await readJson(`/v1/usage/events?${usageQueryString(query, true, cursor)}`, token, signal)
  );
}
