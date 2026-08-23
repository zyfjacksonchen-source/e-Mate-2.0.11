import {
  parseAdminApiKeyCreationResult,
  parseAdminConsentList,
  parseAdminApiKeyList,
  parseAdminModelRouteList,
  type AdminModelRouteKeyUpdate,
  parseTenantUser,
  parseTenantUserList,
  type AdminApiKeyCreate,
  type AdminApiKeyCreationResult,
  type AdminApiKeyList,
  type AdminConsentList,
  type AdminConsentQuery,
  type AdminModelRoute,
  type AdminModelRouteList,
  type AdminModelRoutePublication,
  type AdminModelRouteUpdate,
  type AdminPasswordReset,
  type TenantUser,
  type TenantUserCreate,
  type TenantUserDelete,
  type TenantUserList,
  type TenantUserUpdate,
} from '@e-mate/admin-contract';

export const ADMIN_TOKEN_SESSION_KEY = 'e-mate.admin.access-token';
export const LEGACY_ADMIN_MODEL_SESSION_KEY = 'e-mate.admin.model-session';

export function clearLegacyAdminModelSession(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(LEGACY_ADMIN_MODEL_SESSION_KEY);
}

export type AdminLoginSession = {
  accessToken: string;
};

export type AdminPasswordLogin = {
  authBase?: string;
  clientId: string;
  organization: string;
  account: string;
  password: string;
};

export type QuotaUnit = 'K' | 'M';

export function formatTokenCount(value: number): string {
  const amount = BigInt(value);
  const [divisor, suffix] = amount >= 1_000_000n
    ? [1_000_000n, 'M'] as const
    : amount >= 1_000n
      ? [1_000n, 'K'] as const
      : [1n, ''] as const;
  if (!suffix) return amount.toString();
  const tenths = (amount * 10n + divisor / 2n) / divisor;
  return `${tenths / 10n}${tenths % 10n ? `.${tenths % 10n}` : ''}${suffix}`;
}

export function quotaTokens(amount: number | undefined, unit: QuotaUnit, unlimited: boolean): number | null | undefined {
  if (unlimited) return null;
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return undefined;
  const scaled = amount * (unit === 'M' ? 1_000_000 : 1_000);
  const value = Math.round(scaled);
  return Number.isSafeInteger(value) && Math.abs(scaled - value) < 1e-6 ? value : undefined;
}

export function abbreviateAuditValue(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 12)}…${value.slice(-8)}`;
}

export class AdminApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Admin API request failed with status ${status}`);
    this.status = status;
  }
}

export function resolveSameOriginPath(configured: string | undefined, path: string, origin: string): string {
  if (!configured) return path;
  const base = new URL(configured, origin);
  if (base.origin !== origin || base.username || base.password) {
    throw new Error('Admin API must share the console origin');
  }
  const endpoint = new URL(path.replace(/^\//, ''), `${base.href.replace(/\/?$/, '/')}`);
  return `${endpoint.pathname}${endpoint.search}`;
}

export function resolveUsageDashboardPath(configured: string | undefined, origin: string): string | null {
  if (!configured) return null;
  const target = new URL(configured, origin);
  if (target.origin !== origin || target.username || target.password) {
    throw new Error('Usage dashboard must share the console origin');
  }
  return `${target.pathname}${target.search}${target.hash}`;
}

type StatusRequestOptions = {
  apiBase?: string;
  origin: string;
  fetcher?: typeof fetch;
};

type SameOriginRoute =
  | { kind: 'auth'; base?: string }
  | { kind: 'admin'; path: string };

const adminValidationOrigin = 'https://e-mate.invalid';

function normalizeAdminPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('Admin management path is not allowlisted');
  }
  const target = new URL(path, adminValidationOrigin);
  if (
    target.origin !== adminValidationOrigin ||
    target.hash ||
    (target.pathname !== '/v1/admin' && !target.pathname.startsWith('/v1/admin/'))
  ) {
    throw new Error('Admin management path is not allowlisted');
  }
  return `${target.pathname}${target.search}`;
}

async function sameOriginRequest(
  route: SameOriginRoute,
  signal: AbortSignal,
  options: StatusRequestOptions,
  init: RequestInit
): Promise<Response> {
  const path = route.kind === 'auth' ? '/v1/auth/password' : route.path;
  const base = route.kind === 'auth' ? route.base : options.apiBase;
  return (options.fetcher ?? fetch)(resolveSameOriginPath(base, path, options.origin), {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
}

export async function loginAdmin(
  input: AdminPasswordLogin,
  signal: AbortSignal,
  options: StatusRequestOptions
): Promise<AdminLoginSession> {
  const response = await sameOriginRequest({ kind: 'auth', base: input.authBase }, signal, options, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      clientId: input.clientId,
      organization: input.organization,
      user: input.account,
      password: input.password,
    }),
  });
  if (!response.ok) throw new AdminApiError(response.status);
  const value = (await response.json()) as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    typeof value.accessToken !== 'string' ||
    !/^[^\s]{32,4096}$/.test(value.accessToken)
  ) {
    throw new AdminApiError(503);
  }
  return { accessToken: value.accessToken };
}

export async function requestAdmin(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  path: string,
  init: { method?: 'DELETE' | 'GET' | 'POST' | 'PUT'; body?: unknown } = {}
): Promise<unknown> {
  const normalizedPath = normalizeAdminPath(path);
  if (!/^[^\s]{1,8192}$/.test(token)) throw new AdminApiError(401);
  const response = await sameOriginRequest({ kind: 'admin', path: normalizedPath }, signal, options, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) throw new AdminApiError(response.status);
  return response.status === 204 ? null : response.json();
}

export async function loadConsentAcceptances(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  query: AdminConsentQuery
): Promise<AdminConsentList> {
  const search = new URLSearchParams();
  if (query.userId) search.set('userId', query.userId);
  if (query.agreementVersion) search.set('agreementVersion', query.agreementVersion);
  if (query.disclaimerVersion) search.set('disclaimerVersion', query.disclaimerVersion);
  if (query.acceptedFrom) search.set('acceptedFrom', query.acceptedFrom);
  if (query.acceptedTo) search.set('acceptedTo', query.acceptedTo);
  search.set('limit', String(query.limit));
  return parseAdminConsentList(await requestAdmin(token, signal, options, `/v1/admin/consents?${search.toString()}`));
}

export async function loadTenantUsers(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions
): Promise<TenantUserList> {
  return parseTenantUserList(await requestAdmin(token, signal, options, '/v1/admin/users'));
}

export async function createTenantUser(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  input: TenantUserCreate
): Promise<TenantUser> {
  return parseTenantUser(await requestAdmin(token, signal, options, '/v1/admin/users', { method: 'POST', body: input }));
}

export async function updateTenantUser(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  userId: string,
  input: TenantUserUpdate
): Promise<TenantUser> {
  return parseTenantUser(
    await requestAdmin(token, signal, options, `/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: input,
    })
  );
}

export async function deleteTenantUser(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  userId: string,
  input: TenantUserDelete
): Promise<void> {
  await requestAdmin(token, signal, options, `/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    body: input,
  });
}

export async function resetTenantUserPassword(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  userId: string,
  input: AdminPasswordReset
): Promise<void> {
  await requestAdmin(token, signal, options, `/v1/admin/users/${encodeURIComponent(userId)}/password`, {
    method: 'PUT',
    body: input,
  });
}

export async function loadApiKeys(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions
): Promise<AdminApiKeyList> {
  return parseAdminApiKeyList(await requestAdmin(token, signal, options, '/v1/admin/api-keys'));
}

export async function issueApiKey(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  input: AdminApiKeyCreate
): Promise<AdminApiKeyCreationResult> {
  return parseAdminApiKeyCreationResult(
    await requestAdmin(token, signal, options, '/v1/admin/api-keys', { method: 'POST', body: input })
  );
}

export async function revokeApiKey(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  keyId: string
): Promise<void> {
  await requestAdmin(token, signal, options, `/v1/admin/api-keys/${encodeURIComponent(keyId)}/revoke`, {
    method: 'POST',
  });
}

export async function loadModelRoutes(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions
): Promise<AdminModelRouteList> {
  return parseAdminModelRouteList(await requestAdmin(token, signal, options, '/v1/admin/model-routes'));
}

export async function updateModelRoute(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  routeId: string,
  input: AdminModelRouteUpdate
): Promise<AdminModelRoute> {
  const value = await requestAdmin(token, signal, options, `/v1/admin/model-routes/${encodeURIComponent(routeId)}`, {
    method: 'PUT',
    body: input,
  });
  return parseAdminModelRouteList({ schemaVersion: 1, routes: [value] }).routes[0] as AdminModelRoute;
}

export async function publishModelRoute(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  routeId: string,
  input: AdminModelRoutePublication
): Promise<AdminModelRoute> {
  const value = await requestAdmin(
    token,
    signal,
    options,
    `/v1/admin/model-routes/${encodeURIComponent(routeId)}/publication`,
    { method: 'PUT', body: input }
  );
  return parseAdminModelRouteList({ schemaVersion: 1, routes: [value] }).routes[0] as AdminModelRoute;
}

export async function updateModelRouteKey(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  routeId: string,
  input: AdminModelRouteKeyUpdate
): Promise<AdminModelRoute> {
  const value = await requestAdmin(token, signal, options, `/v1/admin/model-routes/${encodeURIComponent(routeId)}/key`, {
    method: 'PUT',
    body: input,
  });
  return parseAdminModelRouteList({ schemaVersion: 1, routes: [value] }).routes[0] as AdminModelRoute;
}
