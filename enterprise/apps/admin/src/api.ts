import { parseRuntimeRegistryStatus, type RuntimeRegistryStatus } from '@e-mate/runtime-registry-contract';
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
  type AdminModelRouteUpdate,
  type AdminPasswordReset,
  type TenantUser,
  type TenantUserCreate,
  type TenantUserDelete,
  type TenantUserList,
  type TenantUserUpdate,
} from '@e-mate/admin-contract';

export const ADMIN_TOKEN_SESSION_KEY = 'e-mate.admin.access-token';

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

async function request(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  path: string,
  init: { method?: 'DELETE' | 'GET' | 'POST' | 'PUT'; body?: unknown } = {}
): Promise<unknown> {
  if (!/^[^\s]{1,8192}$/.test(token)) throw new AdminApiError(401);
  const response = await (options.fetcher ?? fetch)(resolveSameOriginPath(options.apiBase, path, options.origin), {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) throw new AdminApiError(response.status);
  return response.status === 204 ? null : response.json();
}

export async function loadRuntimeStatus(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions
): Promise<RuntimeRegistryStatus> {
  return parseRuntimeRegistryStatus(await request(token, signal, options, '/runtime/status'));
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
  return parseAdminConsentList(await request(token, signal, options, `/v1/admin/consents?${search.toString()}`));
}

export async function loadTenantUsers(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions
): Promise<TenantUserList> {
  return parseTenantUserList(await request(token, signal, options, '/v1/admin/users'));
}

export async function createTenantUser(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  input: TenantUserCreate
): Promise<TenantUser> {
  return parseTenantUser(await request(token, signal, options, '/v1/admin/users', { method: 'POST', body: input }));
}

export async function updateTenantUser(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  userId: string,
  input: TenantUserUpdate
): Promise<TenantUser> {
  return parseTenantUser(
    await request(token, signal, options, `/v1/admin/users/${encodeURIComponent(userId)}`, {
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
  await request(token, signal, options, `/v1/admin/users/${encodeURIComponent(userId)}`, {
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
  await request(token, signal, options, `/v1/admin/users/${encodeURIComponent(userId)}/password`, {
    method: 'PUT',
    body: input,
  });
}

export async function loadApiKeys(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions
): Promise<AdminApiKeyList> {
  return parseAdminApiKeyList(await request(token, signal, options, '/v1/admin/api-keys'));
}

export async function issueApiKey(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  input: AdminApiKeyCreate
): Promise<AdminApiKeyCreationResult> {
  return parseAdminApiKeyCreationResult(
    await request(token, signal, options, '/v1/admin/api-keys', { method: 'POST', body: input })
  );
}

export async function revokeApiKey(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  keyId: string
): Promise<void> {
  await request(token, signal, options, `/v1/admin/api-keys/${encodeURIComponent(keyId)}/revoke`, {
    method: 'POST',
  });
}

export async function loadModelRoutes(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions
): Promise<AdminModelRouteList> {
  return parseAdminModelRouteList(await request(token, signal, options, '/v1/admin/model-routes'));
}

export async function updateModelRoute(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  routeId: string,
  input: AdminModelRouteUpdate
): Promise<AdminModelRoute> {
  const value = await request(token, signal, options, `/v1/admin/model-routes/${encodeURIComponent(routeId)}`, {
    method: 'PUT',
    body: input,
  });
  return parseAdminModelRouteList({ schemaVersion: 1, routes: [value] }).routes[0] as AdminModelRoute;
}

export async function updateModelRouteKey(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  routeId: string,
  input: AdminModelRouteKeyUpdate
): Promise<AdminModelRoute> {
  const value = await request(token, signal, options, `/v1/admin/model-routes/${encodeURIComponent(routeId)}/key`, {
    method: 'PUT',
    body: input,
  });
  return parseAdminModelRouteList({ schemaVersion: 1, routes: [value] }).routes[0] as AdminModelRoute;
}
