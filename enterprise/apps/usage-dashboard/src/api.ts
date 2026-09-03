import {
  parseTenantTaskSummary,
  parseTenantUsageEventPage,
  parseTenantUsageProjection,
  parseTenantUsageReconciliation,
  type TenantTaskSummary,
  type TenantUsageEventPage,
  type TenantUsageProjection,
  type TenantUsageReconciliation,
  type TaskScenario,
  type UsageBucket,
} from '@e-mate/monitoring-contract';
import { parseTenantUserList, type TenantUser } from '@e-mate/admin-contract';

export type UsageQuery = {
  from: string;
  to: string;
  timezone: string;
  bucket: UsageBucket;
  userIds?: string[];
  scenario?: TaskScenario;
};

export type UsageDashboardData = {
  projection: TenantUsageProjection;
  reconciliation: TenantUsageReconciliation;
  taskSummary: TenantTaskSummary;
  users: TenantUser[] | null;
  scopedUserIds: string[];
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

export type UsageRefresh = {
  authBase?: string;
  clientId: string;
  refreshToken: string;
  refreshRequestId: string;
};

export type UsageLogout = {
  authBase?: string;
  clientId: string;
  refreshToken: string;
  clientRequestId: string;
};

const excludedAuditUserIds = new Set([
  'emate-admin',
  '03ff8d33-94e8-46f6-883b-dd80330cbe7c',
  'cae2a9ef-2110-41ab-990d-151658c549e7',
]);
const excludedAuditDisplayNames = new Set(['企业管理员', 'e-Mate 企业管理员', '验收用户', '测试']);

export function auditVisibleUsers(users: TenantUser[]): TenantUser[] {
  return users.filter(
    ({ userId, displayName }) =>
      !excludedAuditUserIds.has(userId) && !excludedAuditDisplayNames.has(displayName.trim())
  );
}

export function auditVisibleLedgerUserIds(
  userIds: Iterable<string>,
  directoryUsers: TenantUser[] | null = null
): string[] {
  const excludedUserIds = new Set(excludedAuditUserIds);
  for (const { userId, displayName } of directoryUsers ?? []) {
    if (excludedAuditDisplayNames.has(displayName.trim())) excludedUserIds.add(userId);
  }
  return [...new Set([...userIds].filter((userId) => !excludedUserIds.has(userId)))];
}

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

function localDateStart(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(Number.NaN);
  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue) - 1;
  const day = Number(dayValue);
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
    ? date
    : new Date(Number.NaN);
}

export function queryForDateRange(fromValue: string, toValue: string, now = new Date()): UsageQuery {
  const from = localDateStart(fromValue);
  const inclusiveTo = localDateStart(toValue);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (inclusiveTo.getTime() > today.getTime()) throw new Error('Invalid usage range');
  const to = inclusiveTo.getTime() === today.getTime()
    ? now
    : new Date(inclusiveTo.getFullYear(), inclusiveTo.getMonth(), inclusiveTo.getDate() + 1);
  return queryForRange(from, to, now);
}

export function queryForYesterday(now = new Date()): UsageQuery {
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 1);
  return queryForRange(from, to, now);
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

export function queryForDay(
  bucketStart: string,
  overallTo: string,
  timezone: string,
  userIds: string[] = [],
  scenario?: TaskScenario
): UsageQuery {
  const from = new Date(bucketStart);
  const end = Math.min(from.getTime() + 86_400_000, Date.parse(overallTo));
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(end) || end <= from.getTime()) {
    throw new Error('Invalid usage day');
  }
  return {
    from: from.toISOString(),
    to: new Date(end).toISOString(),
    timezone,
    bucket: 'DAY',
    ...(userIds.length ? { userIds: [...userIds] } : {}),
    ...(scenario ? { scenario } : {}),
  };
}

export function usageQueryString(query: UsageQuery, events = false, cursor: string | null = null): string {
  const parameters = new URLSearchParams({
    from: query.from,
    to: query.to,
    timezone: query.timezone,
    bucket: query.bucket,
  });
  for (const userId of query.userIds ?? []) parameters.append('userId', userId);
  if (query.scenario) parameters.set('scenario', query.scenario);
  if (events) {
    if (cursor) parameters.set('cursor', cursor);
    parameters.set('limit', '200');
  }
  return parameters.toString();
}

export function taskQueryString(query: UsageQuery): string {
  const parameters = new URLSearchParams({ from: query.from, to: query.to, timezone: query.timezone });
  for (const userId of query.userIds ?? []) parameters.append('userId', userId);
  if (query.scenario) parameters.set('scenario', query.scenario);
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

function parseUsageAuthSession(value: Record<string, unknown>): UsageAuthSession {
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
  return parseUsageAuthSession((await response.json()) as Record<string, unknown>);
}

export async function refreshUsageAccount(
  input: UsageRefresh,
  signal: AbortSignal,
  options: { origin: string; fetcher?: typeof fetch }
): Promise<UsageAuthSession> {
  const response = await (options.fetcher ?? fetch)(
    resolveSameOriginApiPath(input.authBase, '/v1/auth/refresh', options.origin),
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: input.clientId,
        refreshToken: input.refreshToken,
        refreshRequestId: input.refreshRequestId,
      }),
      cache: 'no-store',
      credentials: 'same-origin',
      signal,
    }
  );
  if (!response.ok) throw new UsageApiError(response.status);
  return parseUsageAuthSession((await response.json()) as Record<string, unknown>);
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
): Omit<UsageDashboardData, 'users' | 'scopedUserIds'> {
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
  const allUsers = await loadQuotaUsers(token, signal);
  const users = allUsers ? auditVisibleUsers(allUsers) : null;
  let candidateUserIds = query.userIds;
  if (!candidateUserIds) {
    const seedParameters = usageQueryString(query);
    const [seedProjection, seedTaskSummary] = await Promise.all([
      readJson(`/v1/usage/summary?${seedParameters}`, token, signal).then(parseTenantUsageProjection),
      readJson(`/v1/tasks/summary?${taskQueryString(query)}`, token, signal).then(parseTenantTaskSummary),
    ]);
    candidateUserIds = [
      ...seedProjection.groups.map(({ userId }) => userId),
      ...seedTaskSummary.userEventCounts.map(({ userId }) => userId),
    ];
    if (candidateUserIds.length === 0) candidateUserIds = users?.map(({ userId }) => userId) ?? [];
  }
  const userIds = auditVisibleLedgerUserIds(candidateUserIds, allUsers);
  // ponytail: reuse the existing <=100 inclusive user scope; add an exclude-user query only when a tenant exceeds it.
  if (userIds.length === 0 || userIds.length > 100) throw new UsageApiError(503);
  const scopedQuery = { ...query, userIds };
  const parameters = usageQueryString(scopedQuery);
  const [projectionValue, reconciliationValue, taskSummaryValue] = await Promise.all([
    readJson(`/v1/usage/summary?${parameters}`, token, signal),
    readJson(`/v1/usage/reconciliation?${parameters}`, token, signal),
    readJson(`/v1/tasks/summary?${taskQueryString(scopedQuery)}`, token, signal),
  ]);
  return {
    ...validateDashboardPair(
      parseTenantUsageProjection(projectionValue),
      parseTenantUsageReconciliation(reconciliationValue),
      parseTenantTaskSummary(taskSummaryValue)
    ),
    users,
    scopedUserIds: userIds,
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

export async function loadAllUsageEvents(
  token: string,
  query: UsageQuery,
  signal: AbortSignal,
  expectedTenantId: string,
  loadPage: typeof loadUsageEvents = loadUsageEvents
): Promise<TenantUsageEventPage['events']> {
  const events: TenantUsageEventPage['events'] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await loadPage(token, query, cursor, signal, expectedTenantId);
    events.push(...page.events);
    if (!page.nextCursor) return events;
    if (cursors.has(page.nextCursor)) throw new Error('Usage event pagination repeated a cursor');
    cursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (true);
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
