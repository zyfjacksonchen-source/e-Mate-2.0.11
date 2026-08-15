import { randomUUID } from 'node:crypto';
import { chatCompletionsToResponsesStream, responsesToChatCompletionsRequest } from './chat-completions-adapter.ts';
import { inspectSseFrame, parseImageGenerationResponse, type ModelGatewayRoute } from './server.ts';

export type ModelSmokeRoute = Pick<
  ModelGatewayRoute,
  | 'id'
  | 'apiMode'
  | 'upstreamModelId'
  | 'fallbackUpstreamModelId'
  | 'upstreamBaseUrl'
  | 'allowInsecureHttpUpstream'
  | 'upstreamApiKey'
  | 'maxTokens'
>;

type SmokeMethod = 'live-inference' | 'live-image-generation';

export type ModelSmokeResult = {
  routeId: string;
  status: 'PASSED';
  method: SmokeMethod;
  evidenceId: string;
};

export type ModelSmokeApproval = {
  schemaVersion: 1;
  environment: 'production';
  modelConfigSha256: string;
  checkedAt: string;
  operator: string;
  results: ModelSmokeResult[];
};

type SmokeRouteContract = {
  id: string;
  apiMode: NonNullable<ModelGatewayRoute['apiMode']>;
  upstreamModelId: string | RegExp;
  hostname: string;
  pathname: string;
  fallbackUpstreamModelId?: string;
};

const routeContracts: readonly SmokeRouteContract[] = [
  {
    id: 'gpt-5.6-luna',
    apiMode: 'responses',
    upstreamModelId: 'gpt-5.6-luna',
    hostname: 'main-provider.ecorex.internal',
    pathname: '/v1',
  },
  {
    id: 'gpt-5.6-sol',
    apiMode: 'responses',
    upstreamModelId: 'gpt-5.6-sol',
    hostname: 'main-provider.ecorex.internal',
    pathname: '/v1',
  },
  {
    id: 'deepseek',
    apiMode: 'chat-completions',
    upstreamModelId: 'deepseek-v4-pro',
    hostname: 'deepseek-provider.ecorex.internal',
    pathname: '/v1',
  },
  {
    id: 'gpt-image-2-pro',
    apiMode: 'images-generations',
    upstreamModelId: 'gpt-image-2-pro',
    fallbackUpstreamModelId: 'gpt-image-2',
    hostname: 'image-provider.ecorex.internal',
    pathname: '/v1',
  },
  {
    id: 'doubao-seed-2-0-pro-260215',
    apiMode: 'chat-completions',
    upstreamModelId: 'doubao-seed-2-0-pro-260215',
    hostname: 'doubao-provider.ecorex.internal',
    pathname: '/v1',
  },
];

const evidencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,100}$/;
const imageFallbackStatuses = new Set([400, 404, 415, 422]);

export class ModelSmokeError extends Error {
  readonly code: 'INVALID_CATALOG' | 'UPSTREAM_UNAVAILABLE' | 'UPSTREAM_REJECTED' | 'INVALID_UPSTREAM_RESPONSE';
  readonly routeId?: string;

  constructor(
    code: 'INVALID_CATALOG' | 'UPSTREAM_UNAVAILABLE' | 'UPSTREAM_REJECTED' | 'INVALID_UPSTREAM_RESPONSE',
    routeId?: string
  ) {
    super('Model smoke failed');
    this.name = 'ModelSmokeError';
    this.code = code;
    this.routeId = routeId;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validateCatalog(routes: readonly ModelSmokeRoute[]): Map<string, ModelSmokeRoute> {
  if (routes.length !== routeContracts.length) throw new ModelSmokeError('INVALID_CATALOG');
  const byId = new Map(routes.map((route) => [route.id, route]));
  if (byId.size !== routeContracts.length) throw new ModelSmokeError('INVALID_CATALOG');
  for (const contract of routeContracts) {
    const route = byId.get(contract.id);
    let upstream: URL;
    try {
      if (!route) throw new Error('missing');
      upstream = new URL(route.upstreamBaseUrl);
    } catch {
      throw new ModelSmokeError('INVALID_CATALOG', contract.id);
    }
    const modelMatches =
      typeof contract.upstreamModelId === 'string'
        ? route.upstreamModelId === contract.upstreamModelId
        : contract.upstreamModelId.test(route.upstreamModelId);
    const transportMatches =
      route.allowInsecureHttpUpstream === true
        ? upstream.protocol === 'http:'
        : upstream.protocol === 'https:' &&
          upstream.hostname === contract.hostname &&
          upstream.port === '18443';
    if (
      route.apiMode !== contract.apiMode ||
      !modelMatches ||
      route.fallbackUpstreamModelId !== contract.fallbackUpstreamModelId ||
      !transportMatches ||
      !upstream.hostname ||
      upstream.pathname !== contract.pathname ||
      upstream.username ||
      upstream.password ||
      upstream.search ||
      upstream.hash ||
      route.upstreamApiKey.length < 20 ||
      /\s/.test(route.upstreamApiKey) ||
      !Number.isSafeInteger(route.maxTokens) ||
      route.maxTokens < 1
    ) {
      throw new ModelSmokeError('INVALID_CATALOG', contract.id);
    }
  }
  return byId;
}

function evidenceId(
  response: Response,
  providerResponseId: string | undefined,
  localId: string,
  fallback = false
): string {
  const headerId = ['x-request-id', 'request-id', 'openai-request-id', 'x-tt-logid']
    .map((name) => response.headers.get(name))
    .find((value): value is string => Boolean(value && evidencePattern.test(value)));
  const providerId =
    headerId ?? (providerResponseId && evidencePattern.test(providerResponseId) ? providerResponseId : null);
  const value = providerId ? `provider:${providerId}` : `local:${localId}`;
  return fallback ? `fallback:${value}` : value;
}

async function consumeResponsesStream(response: Response, routeId: string): Promise<string> {
  if (!(response.headers.get('content-type') ?? '').includes('text/event-stream') || !response.body) {
    throw new ModelSmokeError('INVALID_UPSTREAM_RESPONSE', routeId);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let totalBytes = 0;
  let providerResponseId: string | undefined;
  let sawTerminal = false;
  let sawDone = false;
  const inspect = (frame: string): void => {
    const result = inspectSseFrame(frame);
    if (result.usage) {
      if (sawTerminal || sawDone) throw new Error('duplicate terminal');
      sawTerminal = true;
      providerResponseId = result.usage.providerResponseId;
      return;
    }
    if (result.done) {
      if (!sawTerminal || sawDone) throw new Error('invalid done');
      sawDone = true;
      return;
    }
    if (sawTerminal) throw new Error('event after terminal');
  };
  try {
    while (true) {
      // Sequential reads are required to validate SSE ordering without buffering response content.
      // eslint-disable-next-line no-await-in-loop
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > 64 * 1024 * 1024) throw new Error('stream too large');
      pending += decoder.decode(next.value, { stream: true });
      if (pending.length > 4 * 1024 * 1024) throw new Error('frame too large');
      const frames = pending.split(/\r?\n\r?\n/);
      pending = frames.pop() ?? '';
      for (const frame of frames) inspect(frame);
    }
    pending += decoder.decode();
    if (pending.trim()) inspect(pending);
    if (!sawTerminal || !providerResponseId) throw new Error('terminal missing');
    return providerResponseId;
  } catch {
    throw new ModelSmokeError('INVALID_UPSTREAM_RESPONSE', routeId);
  } finally {
    reader.releaseLock();
  }
}

async function readBoundedJson(response: Response, routeId: string): Promise<unknown> {
  if (!(response.headers.get('content-type') ?? '').includes('application/json') || !response.body) {
    throw new ModelSmokeError('INVALID_UPSTREAM_RESPONSE', routeId);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let totalBytes = 0;
  try {
    while (true) {
      // Sequential reads enforce the response byte bound before accepting more data.
      // eslint-disable-next-line no-await-in-loop
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > 64 * 1024 * 1024) throw new Error('response too large');
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch {
    throw new ModelSmokeError('INVALID_UPSTREAM_RESPONSE', routeId);
  } finally {
    reader.releaseLock();
  }
}

async function fetchUpstream(
  route: ModelSmokeRoute,
  url: string,
  init: RequestInit,
  fetchImplementation: typeof fetch
): Promise<Response> {
  try {
    return await fetchImplementation(url, init);
  } catch {
    throw new ModelSmokeError('UPSTREAM_UNAVAILABLE', route.id);
  }
}

async function smokeInference(
  route: ModelSmokeRoute,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  localId: string
): Promise<ModelSmokeResult> {
  const request = {
    model: route.id,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Reply with OK.' }],
      },
    ],
    store: false,
    stream: true,
  };
  const chat =
    route.apiMode === 'chat-completions'
      ? responsesToChatCompletionsRequest(request, route.upstreamModelId, Math.min(route.maxTokens, 256), false)
      : undefined;
  const body =
    chat?.body ??
    JSON.stringify({
      ...request,
      model: route.upstreamModelId,
      max_output_tokens: Math.min(route.maxTokens, 256),
      ...(route.id === 'gpt-5.6-luna'
        ? { reasoning: { effort: 'high' } }
        : route.id === 'gpt-5.6-sol'
          ? { reasoning: { effort: 'medium' } }
          : {}),
    });
  const response = await fetchUpstream(
    route,
    `${route.upstreamBaseUrl.replace(/\/$/, '')}/${chat ? 'chat/completions' : 'responses'}`,
    {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        authorization: `Bearer ${route.upstreamApiKey}`,
        'content-type': 'application/json',
        'idempotency-key': `smoke-${localId}`,
      },
      body,
      redirect: 'error',
      signal,
    },
    fetchImplementation
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ModelSmokeError('UPSTREAM_REJECTED', route.id);
  }
  const providerResponseId = await consumeResponsesStream(
    chat ? chatCompletionsToResponsesStream(response, { responseId: `smoke-${localId}`, tools: chat.tools }) : response,
    route.id
  );
  return {
    routeId: route.id,
    status: 'PASSED',
    method: 'live-inference',
    // The chat adapter intentionally rewrites its Responses id. Only a real
    // upstream header may be labelled as provider evidence for that path.
    evidenceId: evidenceId(response, chat ? undefined : providerResponseId, localId),
  };
}

async function smokeImage(
  route: ModelSmokeRoute,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
  localId: string
): Promise<ModelSmokeResult> {
  const models = [route.upstreamModelId, route.fallbackUpstreamModelId].filter(
    (model): model is string => model !== undefined
  );
  let response: Response | undefined;
  let fallback = false;
  for (const [index, model] of models.entries()) {
    // The fallback must never race the primary image request and risk a duplicate charge.
    // eslint-disable-next-line no-await-in-loop
    response = await fetchUpstream(
      route,
      `${route.upstreamBaseUrl.replace(/\/$/, '')}/images/generations`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${route.upstreamApiKey}`,
          'content-type': 'application/json',
          'idempotency-key': index === 0 ? `smoke-${localId}` : `smoke-${localId}:fallback`,
        },
        body: JSON.stringify({
          model,
          prompt: 'A solid orange square.',
          size: '1024x1024',
          n: 1,
          response_format: 'b64_json',
        }),
        redirect: 'error',
        signal,
      },
      fetchImplementation
    );
    if (response.ok) {
      fallback = index > 0;
      break;
    }
    if (index === 0 && route.fallbackUpstreamModelId && imageFallbackStatuses.has(response.status)) {
      // eslint-disable-next-line no-await-in-loop
      await response.body?.cancel().catch(() => undefined);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await response.body?.cancel().catch(() => undefined);
    throw new ModelSmokeError('UPSTREAM_REJECTED', route.id);
  }
  if (!response?.ok) throw new ModelSmokeError('UPSTREAM_REJECTED', route.id);
  const value = await readBoundedJson(response, route.id);
  try {
    parseImageGenerationResponse(value, `smoke-${localId}`);
  } catch {
    throw new ModelSmokeError('INVALID_UPSTREAM_RESPONSE', route.id);
  }
  const providerResponseId = record(value)?.id;
  return {
    routeId: route.id,
    status: 'PASSED',
    method: 'live-image-generation',
    evidenceId: evidenceId(
      response,
      typeof providerResponseId === 'string' ? providerResponseId : undefined,
      localId,
      fallback
    ),
  };
}

export async function runModelSmoke(options: {
  routes: readonly ModelSmokeRoute[];
  catalogSha256: string;
  operator: string;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
  randomId?: () => string;
  onResult?: (result: ModelSmokeResult) => void;
}): Promise<ModelSmokeApproval> {
  if (
    !/^[a-f0-9]{64}$/.test(options.catalogSha256) ||
    !/^[A-Za-z0-9][A-Za-z0-9._@-]{2,127}$/.test(options.operator) ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1_000 ||
    options.timeoutMs > 600_000
  ) {
    throw new ModelSmokeError('INVALID_CATALOG');
  }
  const routes = validateCatalog(options.routes);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const randomId = options.randomId ?? randomUUID;
  const results: ModelSmokeResult[] = [];
  for (const contract of routeContracts) {
    const route = routes.get(contract.id) as ModelSmokeRoute;
    const localId = randomId();
    if (!evidencePattern.test(localId)) throw new ModelSmokeError('INVALID_CATALOG', route.id);
    // Smoke calls are intentionally sequential to cap cost and avoid provider bursts.
    const smokeRequest =
      route.apiMode === 'images-generations'
        ? smokeImage(route, fetchImplementation, AbortSignal.timeout(options.timeoutMs), localId)
        : smokeInference(route, fetchImplementation, AbortSignal.timeout(options.timeoutMs), localId);
    // eslint-disable-next-line no-await-in-loop
    const result = await smokeRequest;
    results.push(result);
    options.onResult?.(result);
  }
  const checkedAt = (options.now ?? (() => new Date()))();
  if (!Number.isFinite(checkedAt.getTime())) throw new ModelSmokeError('INVALID_CATALOG');
  return {
    schemaVersion: 1,
    environment: 'production',
    modelConfigSha256: options.catalogSha256,
    checkedAt: checkedAt.toISOString(),
    operator: options.operator,
    results,
  };
}
