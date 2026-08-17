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
import { parseTenantUserList, type TenantUser } from '@e-mate/admin-contract';

export type UsageQuery = {
  from: string;
  to: string;
  timezone: string;
  bucket: UsageBucket;
  userId?: string;
};

export type UsageDashboardData = {
  projection: TenantUsageProjection;
  reconciliation: TenantUsageReconciliation;
  taskSummary: TenantTaskSummary;
  users: TenantUser[] | null;
};

export type UsagePasswordLogin = {
  authBase?: string;
  clientId: string;
  organization: string;
  account: string;
  password: string;
};

export type UsageAuthSession = {
  accessToken: string;
  refreshToken: string;
};

export type UsageLogout = {
  authBase?: string;
  clientId: string;
  refreshToken: string;
  clientRequestId: string;
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
  return queryForRange(new Date(now.getTime() - days * 86_400_000), now, now);
}

export function queryForRange(from: Date, to: Date, now = new Date()): UsageQuery {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const duration = toMs - fromMs;
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    duration <= 0 ||
    duration > 366 * 86_400_000 ||
    toMs > now.getTime()
  ) {
    throw new Error('Invalid usage range');
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return {
    from: from.toISOString(),
    to: to.toISOString(),
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
  if (query.userId) parameters.set('userId', query.userId);
  if (events) {
    if (cursor) parameters.set('cursor', cursor);
    parameters.set('limit', '100');
  }
  return parameters.toString();
}

export function taskQueryString(query: UsageQuery): string {
  const parameters = new URLSearchParams({ from: query.from, to: query.to });
  if (query.userId) parameters.set('userId', query.userId);
  return parameters.toString();
}

export function resolveSameOriginApiPath(configured: string | undefined, path: string, origin: string): string {
  if (!configured) return path;
  const base = new URL(configured, origin);
  if (base.origin !== origin || base.username || base.password) {
    throw new Error('Usage API must share the dashboard origin');
  }
  const endpoint = new URL(path.replace(/^\//, ''), `${base.href.replace(/\/?$/, '/')}`);
  return `${endpoint.pathname}${endpoint.search}`;
}

export async function loginUsageAccount(
  input: UsagePasswordLogin,
  signal: AbortSignal,
  options: { origin: string; fetcher?: typeof fetch }
): Promise<UsageAuthSession> {
  const response = await (options.fetcher ?? fetch)(
    resolveSameOriginApiPath(input.authBase, '/v1/auth/password', options.origin),
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: input.clientId,
        organization: input.organization,
        user: input.account,
        password: input.password,
      }),
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    }
  );
  if (!response.ok) throw new UsageApiError(response.status);
  const value = (await response.json()) as Record<string, unknown>;
  const identity = value.identity as Record<string, unknown> | undefined;
  const roles = identity?.roles;
  const rolesValid =
    Array.isArray(roles) &&
    roles.length >= 1 &&
    roles.length <= 3 &&
    roles.every((role) => role === 'TENANT_ADMIN' || role === 'AUDIT_ADMIN' || role === 'MEMBER') &&
    new Set(roles).size === roles.length;
  if (
    value.schemaVersion !== 1 ||
    typeof value.accessToken !== 'string' ||
    !/^[^\s]{32,4096}$/.test(value.accessToken) ||
    typeof value.refreshToken !== 'string' ||
    !/^emate_rt_[A-Za-z0-9_-]{43}$/.test(value.refreshToken) ||
    typeof value.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) <= Date.now() ||
    !rolesValid
  ) {
    throw new UsageApiError(503);
  }
  if (!roles.some((role) => role === 'TENANT_ADMIN' || role === 'AUDIT_ADMIN')) throw new UsageApiError(403);
  return { accessToken: value.accessToken, refreshToken: value.refreshToken };
}

export async function logoutUsageAccount(
  input: UsageLogout,
  signal: AbortSignal,
  options: { origin: string; fetcher?: typeof fetch }
): Promise<void> {
  const response = await (options.fetcher ?? fetch)(
    resolveSameOriginApiPath(input.authBase, '/v1/auth/logout', options.origin),
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: input.clientId,
        refreshToken: input.refreshToken,
        clientRequestId: input.clientRequestId,
      }),
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    }
  );
  if (!response.ok) throw new UsageApiError(response.status);
  const value = (await response.json()) as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    value.receiptId !== input.clientRequestId ||
    value.reauthenticationRequired !== false
  ) {
    throw new UsageApiError(503);
  }
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
): Omit<UsageDashboardData, 'users'> {
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

async function loadQuotaUsers(token: string, signal: AbortSignal): Promise<TenantUser[] | null> {
  try {
    return parseTenantUserList(await readJson('/v1/admin/users', token, signal)).users;
  } catch (error) {
    if (error instanceof UsageApiError && (error.status === 403 || error.status === 503)) return null;
    throw error;
  }
}

export async function loadUsageDashboard(
  token: string,
  query: UsageQuery,
  signal: AbortSignal
): Promise<UsageDashboardData> {
  const parameters = usageQueryString(query);
  const [projectionValue, reconciliationValue, taskSummaryValue, users] = await Promise.all([
    readJson(`/v1/usage/summary?${parameters}`, token, signal),
    readJson(`/v1/usage/reconciliation?${parameters}`, token, signal),
    readJson(`/v1/tasks/summary?${taskQueryString(query)}`, token, signal),
    loadQuotaUsers(token, signal),
  ]);
  return {
    ...validateDashboardPair(
      parseTenantUsageProjection(projectionValue),
      parseTenantUsageReconciliation(reconciliationValue),
      parseTenantTaskSummary(taskSummaryValue)
    ),
    users,
  };
}

export async function loadUsageEvents(
  token: string,
  query: UsageQuery,
  cursor: string | null,
  signal: AbortSignal,
  expectedTenantId: string
): Promise<TenantUsageEventPage> {
  return validateUsageEventPage(
    parseTenantUsageEventPage(
      await readJson(`/v1/usage/events?${usageQueryString(query, true, cursor)}`, token, signal)
    ),
    query,
    expectedTenantId
  );
}

export function validateUsageEventPage(
  page: TenantUsageEventPage,
  query: UsageQuery,
  expectedTenantId: string
): TenantUsageEventPage {
  if (page.tenantId !== expectedTenantId || page.from !== query.from || page.to !== query.to) {
    throw new Error('Usage events do not share the dashboard ledger scope');
  }
  return page;
}
