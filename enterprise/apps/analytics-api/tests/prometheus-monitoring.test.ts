import assert from 'node:assert/strict';
import test from 'node:test';
import { PrometheusPlatformMonitoringReader, parsePrometheusMonitoringConfig } from '../src/prometheus-monitoring.ts';

const now = Date.parse('2026-07-26T10:00:00.000Z');

function prometheusResponse(url: URL): Response {
  const query = url.searchParams.get('query') ?? '';
  const timestamp = Number(url.searchParams.get('time') ?? now / 1000);
  if (url.pathname === '/api/v1/query_range') {
    const end = Number(url.searchParams.get('end'));
    const failure = query.includes('outcome="failure"');
    return Response.json({
      status: 'success',
      data: {
        resultType: 'matrix',
        result: [
          {
            metric: {},
            values: [
              [end - 900, failure ? '0.1' : '2'],
              [end, failure ? '0' : '3'],
            ],
          },
        ],
      },
    });
  }
  const value = query.includes('duration_milliseconds_sum')
    ? '12000'
    : query.includes('duration_milliseconds_count')
      ? '4'
      : query.includes('tool_calls_total{outcome="failure"}')
        ? '1'
        : query.includes('tool_calls_total')
          ? '10'
          : query.includes('kind="error"')
            ? '2'
            : '0';
  return Response.json({
    status: 'success',
    data: {
      resultType: 'vector',
      result: [{ metric: {}, value: [timestamp, value] }],
    },
  });
}

test('queries only fixed platform aggregates and removes Prometheus labels', async () => {
  const requests: URL[] = [];
  const reader = new PrometheusPlatformMonitoringReader(
    {
      baseUrl: 'https://prometheus.example.com/',
      token: 'read-only-token-123',
    },
    async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      assert(init);
      assert.equal((init.headers as Record<string, string>).authorization, 'Bearer read-only-token-123');
      assert.equal(init?.redirect, 'error');
      return prometheusResponse(url);
    },
    () => now
  );
  const result = await reader.read('TODAY');
  assert.equal(result.state, 'OK');
  assert.equal(result.summary.averageTaskDurationMs, 3000);
  assert.equal(result.summary.toolFailureRate, 0.1);
  assert.deepEqual(
    result.trend.map(({ completedPerMinute, failedPerMinute }) => [completedPerMinute, failedPerMinute]),
    [
      [2, 0.1],
      [3, 0],
    ]
  );
  assert.equal(requests.length, 8);
  assert(
    requests.every(
      (url) =>
        !url.searchParams.has('tenantId') &&
        !url.searchParams.has('userId') &&
        !url.searchParams.get('query')?.includes('service_instance')
    )
  );
  assert.equal(JSON.stringify(result).includes('metric'), false);
});

test('keeps no data distinct from failure and rejects unsafe configuration', async () => {
  const reader = new PrometheusPlatformMonitoringReader(
    {
      baseUrl: 'http://127.0.0.1/',
      token: 'read-only-token-123',
    },
    async (input) => {
      const range = new URL(String(input)).pathname.endsWith('query_range');
      return Response.json({
        status: 'success',
        data: {
          resultType: range ? 'matrix' : 'vector',
          result: [],
        },
      });
    },
    () => now
  );
  assert.equal((await reader.read('WEEK')).state, 'NO_DATA');
  assert.throws(() =>
    parsePrometheusMonitoringConfig({
      E_MATE_PROMETHEUS_URL: 'http://prometheus.example.com/',
      E_MATE_PROMETHEUS_READ_TOKEN: 'read-only-token-123',
    })
  );
  assert.throws(() =>
    parsePrometheusMonitoringConfig({
      E_MATE_PROMETHEUS_URL: 'https://user:secret@prometheus.example.com/',
      E_MATE_PROMETHEUS_READ_TOKEN: 'read-only-token-123',
    })
  );
  assert.throws(() =>
    parsePrometheusMonitoringConfig({
      E_MATE_PROMETHEUS_URL: 'https://prometheus.example.com/',
      E_MATE_PROMETHEUS_READ_TOKEN: 'read-only\u0085token-123',
    })
  );
  const failing = new PrometheusPlatformMonitoringReader(
    {
      baseUrl: 'https://prometheus.example.com/',
      token: 'read-only-token-123',
    },
    async () => new Response('secret backend failure', { status: 500 }),
    () => now
  );
  await assert.rejects(failing.read('TODAY'), /monitoring unavailable/);
});
