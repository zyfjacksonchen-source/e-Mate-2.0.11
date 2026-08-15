import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelSmokeError, runModelSmoke } from '../src/modelSmoke.ts';

const secret = 'test-secret-that-is-never-production';
function route(
  id: string,
  apiMode: 'responses' | 'chat-completions' | 'images-generations',
  upstreamModelId: string,
  upstreamBaseUrl: string,
  fallbackUpstreamModelId?: string
) {
  return {
    id,
    apiMode,
    upstreamModelId,
    ...(fallbackUpstreamModelId ? { fallbackUpstreamModelId } : {}),
    upstreamBaseUrl,
    upstreamApiKey: secret,
    maxTokens: 65_536,
  };
}

const routes = [
  route('gpt-5.6-luna', 'responses', 'gpt-5.6-luna', 'https://main-provider.ecorex.internal:18443/v1'),
  route('gpt-5.6-sol', 'responses', 'gpt-5.6-sol', 'https://main-provider.ecorex.internal:18443/v1'),
  route('deepseek', 'chat-completions', 'deepseek-v4-pro', 'https://deepseek-provider.ecorex.internal:18443/v1'),
  route(
    'gpt-image-2-pro',
    'images-generations',
    'gpt-image-2-pro',
    'https://image-provider.ecorex.internal:18443/v1',
    'gpt-image-2'
  ),
  route(
    'doubao-seed-2-0-pro-260215',
    'chat-completions',
    'doubao-seed-2-0-pro-260215',
    'https://doubao-provider.ecorex.internal:18443/v1'
  ),
];

function responsesStream(id: string): Response {
  return new Response(
    [
      `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'sensitive-response-text' })}`,
      `data: ${JSON.stringify({
        type: 'response.completed',
        response: {
          id,
          status: 'completed',
          usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
        },
      })}`,
      'data: [DONE]',
      '',
    ].join('\n\n'),
    { headers: { 'content-type': 'text/event-stream', 'x-request-id': `request-${id}` } }
  );
}

function chatStream(id: string, requestHeader = true): Response {
  const chunks = [
    {
      id,
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'sensitive-response-text' }, finish_reason: 'stop' }],
    },
    {
      id,
      object: 'chat.completion.chunk',
      choices: [],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    },
  ];
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, {
    headers: {
      'content-type': 'text/event-stream',
      ...(requestHeader ? { 'x-request-id': `request-${id}` } : {}),
    },
  });
}

function imageResponse(id: string): Response {
  return Response.json(
    {
      id,
      data: [{ b64_json: 'QUJDRA==' }],
      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
    },
    { headers: { 'x-request-id': `request-${id}` } }
  );
}

function mockFetch(options: { rejectCall?: number; rejectPrimaryImage?: boolean; omitChatRequestId?: boolean } = {}): {
  fetchImplementation: typeof fetch;
  requests: Array<{ url: string; body: Record<string, unknown> }>;
} {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImplementation = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url, body });
    if (requests.length === options.rejectCall) return new Response(null, { status: 401 });
    if (url.endsWith('/images/generations')) {
      if (options.rejectPrimaryImage && body.model === 'gpt-image-2-pro') return new Response(null, { status: 404 });
      return imageResponse(`image-${requests.length}`);
    }
    return url.endsWith('/chat/completions')
      ? chatStream(`chat-${requests.length}`, !options.omitChatRequestId)
      : responsesStream(`response-${requests.length}`);
  }) as typeof fetch;
  return { fetchImplementation, requests };
}

const randomId = (): (() => string) => {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, '0')}`;
};

test('writes only catalog-bound redacted evidence after all five live routes pass', async () => {
  const { fetchImplementation } = mockFetch();
  const approval = await runModelSmoke({
    routes,
    catalogSha256: 'a'.repeat(64),
    operator: 'release.operator',
    timeoutMs: 10_000,
    fetchImplementation,
    randomId: randomId(),
    now: () => new Date('2026-08-02T12:00:00.000Z'),
  });
  const serialized = JSON.stringify(approval);
  assert.deepEqual(
    approval.results.map(({ routeId, method }) => [routeId, method]),
    [
      ['gpt-5.6-luna', 'live-inference'],
      ['gpt-5.6-sol', 'live-inference'],
      ['deepseek', 'live-inference'],
      ['gpt-image-2-pro', 'live-image-generation'],
      ['doubao-seed-2-0-pro-260215', 'live-inference'],
    ]
  );
  assert.equal(serialized.includes(secret) || serialized.includes('sensitive-response-text'), false);
  assert.equal(serialized.includes('Reply with OK.') || serialized.includes('A solid orange square.'), false);
});

test('does not label an adapter-generated chat id as provider evidence', async () => {
  const { fetchImplementation } = mockFetch({ omitChatRequestId: true });
  const approval = await runModelSmoke({
    routes,
    catalogSha256: 'e'.repeat(64),
    operator: 'release.operator',
    timeoutMs: 10_000,
    fetchImplementation,
    randomId: randomId(),
  });
  assert.deepEqual(
    approval.results.filter(({ routeId }) => routeId === 'deepseek' || routeId === 'doubao-seed-2-0-pro-260215')
      .map(({ evidenceId }) => evidenceId.startsWith('local:')),
    [true, true]
  );
});

test('uses the fixed protocols and approves a definite image fallback', async () => {
  const { fetchImplementation, requests } = mockFetch({ rejectPrimaryImage: true });
  const approval = await runModelSmoke({
    routes,
    catalogSha256: 'b'.repeat(64),
    operator: 'release.operator',
    timeoutMs: 10_000,
    fetchImplementation,
    randomId: randomId(),
  });
  assert.deepEqual(
    requests.map(({ url }) => url.slice(url.lastIndexOf('/') + 1)),
    ['responses', 'responses', 'completions', 'generations', 'generations', 'completions']
  );
  assert.deepEqual(
    requests.filter(({ url }) => url.endsWith('/images/generations')).map(({ body }) => body.model),
    ['gpt-image-2-pro', 'gpt-image-2']
  );
  assert.match(approval.results.find(({ routeId }) => routeId === 'gpt-image-2-pro')?.evidenceId ?? '', /^fallback:provider:/);
});

test('fails closed without returning approval after any provider rejection', async () => {
  const { fetchImplementation, requests } = mockFetch({ rejectCall: 3 });
  const completed: string[] = [];
  await assert.rejects(
    runModelSmoke({
      routes,
      catalogSha256: 'c'.repeat(64),
      operator: 'release.operator',
      timeoutMs: 10_000,
      fetchImplementation,
      randomId: randomId(),
      onResult: ({ routeId }) => completed.push(routeId),
    }),
    (error: unknown) =>
      error instanceof ModelSmokeError && error.code === 'UPSTREAM_REJECTED' && error.routeId === 'deepseek'
  );
  assert.deepEqual(completed, ['gpt-5.6-luna', 'gpt-5.6-sol']);
  assert.equal(requests.length, 3);
});

test('rejects a non-private route catalog before any credential-bearing request', async () => {
  const { fetchImplementation, requests } = mockFetch();
  const invalidRoutes = structuredClone(routes);
  const invalidRoute = invalidRoutes.find(({ id }) => id === 'deepseek');
  assert(invalidRoute);
  invalidRoute.upstreamBaseUrl = 'https://example.test/v1';
  await assert.rejects(
    runModelSmoke({
      routes: invalidRoutes,
      catalogSha256: 'd'.repeat(64),
      operator: 'release.operator',
      timeoutMs: 10_000,
      fetchImplementation,
    }),
    (error: unknown) =>
      error instanceof ModelSmokeError && error.code === 'INVALID_CATALOG' && error.routeId === 'deepseek'
  );
  assert.equal(requests.length, 0);
});
