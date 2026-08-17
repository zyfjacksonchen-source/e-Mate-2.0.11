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
export const ADMIN_MODEL_SESSION_KEY = 'e-mate.admin.model-session';

export type AdminModelSession = {
  basePath: string;
  sessionToken: string;
  expiresAt: string;
  allowedModelIds: string[];
};

export type AdminLoginSession = {
  accessToken: string;
  modelGateway: AdminModelSession;
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

export function resolveModelGatewayPath(configured: string, origin: string): string {
  const target = new URL(configured, origin);
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !/^\/e-mate\/model-api\/?$/.test(target.pathname)
  ) {
    throw new Error('Invalid Model Gateway URL');
  }
  return '/e-mate/model-api/';
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

export async function loginAdmin(
  input: AdminPasswordLogin,
  signal: AbortSignal,
  options: StatusRequestOptions
): Promise<AdminLoginSession> {
  const response = await (options.fetcher ?? fetch)(
    resolveSameOriginPath(input.authBase, '/v1/auth/password', options.origin),
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
  if (!response.ok) throw new AdminApiError(response.status);
  const value = (await response.json()) as Record<string, unknown>;
  const modelGateway = value.modelGateway as Record<string, unknown> | undefined;
  const allowedModelIds = modelGateway?.allowedModelIds;
  const expiresAt = modelGateway?.expiresAt;
  if (
    value.schemaVersion !== 1 ||
    typeof value.accessToken !== 'string' ||
    !/^[^\s]{32,4096}$/.test(value.accessToken) ||
    !modelGateway ||
    typeof modelGateway.baseUrl !== 'string' ||
    typeof modelGateway.sessionToken !== 'string' ||
    !/^[^\s]{32,8192}$/.test(modelGateway.sessionToken) ||
    typeof expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    Date.parse(expiresAt) <= Date.now() ||
    !Array.isArray(allowedModelIds) ||
    allowedModelIds.length < 1 ||
    allowedModelIds.length > 20 ||
    allowedModelIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(id)) ||
    new Set(allowedModelIds).size !== allowedModelIds.length
  ) {
    throw new AdminApiError(503);
  }
  return {
    accessToken: value.accessToken,
    modelGateway: {
      basePath: resolveModelGatewayPath(modelGateway.baseUrl, options.origin),
      sessionToken: modelGateway.sessionToken,
      expiresAt,
      allowedModelIds: [...allowedModelIds],
    },
  };
}

export function readAdminModelSession(value: string | null): AdminModelSession | null {
  if (!value) return null;
  try {
    const session = JSON.parse(value) as Partial<AdminModelSession>;
    return typeof session.basePath === 'string' && session.basePath.startsWith('/') &&
      typeof session.sessionToken === 'string' && /^[^\s]{32,8192}$/.test(session.sessionToken) &&
      typeof session.expiresAt === 'string' && Number.isFinite(Date.parse(session.expiresAt)) &&
      Array.isArray(session.allowedModelIds) && session.allowedModelIds.length > 0 &&
      session.allowedModelIds.length <= 20 &&
      session.allowedModelIds.every((id) => typeof id === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(id)) &&
      new Set(session.allowedModelIds).size === session.allowedModelIds.length
      ? session as AdminModelSession
      : null;
  } catch {
    return null;
  }
}

type ModelCatalogEntry = {
  id: string;
  capabilities: { imageGeneration: boolean };
};

export type ModelConnectionResult = {
  method: 'live-inference' | 'live-image-generation';
  checkedAt: string;
};

async function modelRequest(
  session: AdminModelSession,
  signal: AbortSignal,
  options: StatusRequestOptions,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  if (Date.parse(session.expiresAt) <= Date.now()) throw new AdminApiError(401);
  const headers = new Headers(init.headers);
  if (!headers.has('accept')) headers.set('accept', 'application/json');
  headers.set('authorization', `Bearer ${session.sessionToken}`);
  const response = await (options.fetcher ?? fetch)(
    resolveSameOriginPath(session.basePath, path, options.origin),
    {
      ...init,
      headers,
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal,
    }
  );
  if (!response.ok) throw new AdminApiError(response.status);
  return response;
}

function parseModelCatalog(value: unknown): ModelCatalogEntry[] {
  const models = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>).models
    : undefined;
  if (!Array.isArray(models)) throw new AdminApiError(503);
  const parsed = models.map((entry) => {
    const record = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : null;
    const capabilities = record?.capabilities;
    if (
      !record ||
      typeof record.id !== 'string' ||
      !capabilities ||
      typeof capabilities !== 'object' ||
      Array.isArray(capabilities) ||
      typeof (capabilities as Record<string, unknown>).imageGeneration !== 'boolean'
    ) {
      throw new AdminApiError(503);
    }
    return {
      id: record.id,
      capabilities: { imageGeneration: (capabilities as Record<string, unknown>).imageGeneration as boolean },
    };
  });
  if (parsed.length < 1 || parsed.length > 20 || new Set(parsed.map(({ id }) => id)).size !== parsed.length) {
    throw new AdminApiError(503);
  }
  return parsed;
}

async function consumeModelStream(response: Response): Promise<void> {
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream') || !response.body) {
    throw new AdminApiError(503);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let bytes = 0;
  try {
    while (true) {
      // The test prompt is bounded; stop rather than retaining an unexpected provider stream.
      // eslint-disable-next-line no-await-in-loop
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 4 * 1024 * 1024) throw new AdminApiError(503);
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!body.includes('"type":"response.completed"')) {
    throw new AdminApiError(503);
  }
}

export async function testModelConnection(
  routeId: string,
  session: AdminModelSession,
  signal: AbortSignal,
  options: StatusRequestOptions
): Promise<ModelConnectionResult> {
  if (!session.allowedModelIds.includes(routeId)) throw new AdminApiError(403);
  const catalogResponse = await modelRequest(session, signal, options, '/v1/models');
  const catalog = parseModelCatalog(await catalogResponse.json());
  const route = catalog.find(({ id }) => id === routeId);
  if (!route) throw new AdminApiError(403);
  const scope = `admin-model-test-${crypto.randomUUID()}`;
  const headers = {
    'content-type': 'application/json',
    session_id: scope,
    'x-client-request-id': scope,
    'x-e-mate-task-id': scope,
    'x-e-mate-trace-id': scope,
  };
  if (route.capabilities.imageGeneration) {
    const response = await modelRequest(session, signal, options, '/v1/images/generations', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: routeId, prompt: 'A solid orange square.', size: '1024x1024' }),
    });
    await response.body?.cancel();
    return { method: 'live-image-generation', checkedAt: new Date().toISOString() };
  }
  const response = await modelRequest(session, signal, options, '/v1/responses', {
    method: 'POST',
    headers: { ...headers, accept: 'text/event-stream' },
    body: JSON.stringify({
      model: routeId,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Reply with OK.' }] }],
      max_output_tokens: 32,
      stream: true,
      store: false,
    }),
  });
  await consumeModelStream(response);
  return { method: 'live-inference', checkedAt: new Date().toISOString() };
}

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

export async function publishModelRoute(
  token: string,
  signal: AbortSignal,
  options: StatusRequestOptions,
  routeId: string,
  input: AdminModelRoutePublication
): Promise<AdminModelRoute> {
  const value = await request(
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
  const value = await request(token, signal, options, `/v1/admin/model-routes/${encodeURIComponent(routeId)}/key`, {
    method: 'PUT',
    body: input,
  });
  return parseAdminModelRouteList({ schemaVersion: 1, routes: [value] }).routes[0] as AdminModelRoute;
}
