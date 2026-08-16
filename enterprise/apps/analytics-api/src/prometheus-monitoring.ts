import {
  parseMonitoringPeriod,
  parsePlatformMonitoringProjection,
  type MonitoringPeriod,
  type PlatformMonitoringProjection,
} from '@e-mate/monitoring-contract';

export type PlatformMonitoringReader = {
  read(period: MonitoringPeriod): Promise<PlatformMonitoringProjection>;
};

export type PrometheusMonitoringConfig = {
  baseUrl: string;
  token: string;
};

type Sample = { at: number; value: number };

const maxResponseBytes = 1024 * 1024;
const allQueries = [
  'TASK_DURATION',
  'TOOL_FAILURE_RATE',
  'AGENT_ERROR',
  'AGENT_TIMEOUT',
  'TASK_TREND_SUCCESS',
  'TASK_TREND_FAILURE',
] as const;
const periods: Record<MonitoringPeriod, { durationMs: number; window: string; stepSeconds: number }> = {
  TODAY: { durationMs: 24 * 60 * 60_000, window: '24h', stepSeconds: 900 },
  WEEK: { durationMs: 7 * 24 * 60 * 60_000, window: '7d', stepSeconds: 3600 },
  MONTH: {
    durationMs: 30 * 24 * 60 * 60_000,
    window: '30d',
    stepSeconds: 21_600,
  },
};

export function parsePrometheusMonitoringConfig(env: NodeJS.ProcessEnv): PrometheusMonitoringConfig | null {
  const baseUrl = env.E_MATE_PROMETHEUS_URL?.trim() ?? '';
  const token = env.E_MATE_PROMETHEUS_READ_TOKEN?.trim() ?? '';
  if (!baseUrl && !token) return null;
  if (!baseUrl || !token) {
    throw new Error('Prometheus monitoring configuration is incomplete');
  }
  if (token.length < 16 || token.length > 512 || /\p{Cc}/u.test(token)) {
    throw new Error('Prometheus monitoring credential is invalid');
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Prometheus monitoring endpoint is invalid');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Prometheus monitoring endpoint is invalid');
  }
  return { baseUrl: url.href, token };
}

export class PrometheusPlatformMonitoringReader implements PlatformMonitoringReader {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(
    config: PrometheusMonitoringConfig,
    fetchImplementation: typeof fetch = fetch,
    now: () => number = Date.now
  ) {
    const parsed = parsePrometheusMonitoringConfig({
      E_MATE_PROMETHEUS_URL: config.baseUrl,
      E_MATE_PROMETHEUS_READ_TOKEN: config.token,
    });
    if (!parsed) throw new Error('Prometheus monitoring configuration is required');
    this.#baseUrl = parsed.baseUrl;
    this.#token = parsed.token;
    this.#fetch = fetchImplementation;
    this.#now = now;
  }

  async read(periodInput: MonitoringPeriod): Promise<PlatformMonitoringProjection> {
    const period = parseMonitoringPeriod(periodInput);
    const config = periods[period];
    const toMs = this.#now();
    if (!Number.isSafeInteger(toMs) || toMs <= config.durationMs) {
      throw new Error('Monitoring clock is invalid');
    }
    const fromMs = toMs - config.durationMs;
    const window = config.window;
    const [
      durationSum,
      durationCount,
      toolFailures,
      toolCalls,
      agentErrors,
      agentTimeouts,
      successTrend,
      failureTrend,
    ] = await Promise.all([
      this.#instant(`sum(increase(emate_task_duration_milliseconds_sum[${window}]))`, toMs),
      this.#instant(`sum(increase(emate_task_duration_milliseconds_count[${window}]))`, toMs),
      this.#instant(`sum(increase(emate_tool_calls_total{outcome="failure"}[${window}]))`, toMs),
      this.#instant(`sum(increase(emate_tool_calls_total[${window}]))`, toMs),
      this.#instant(`sum(increase(emate_agent_errors_total{kind="error"}[${window}]))`, toMs),
      this.#instant(`sum(increase(emate_agent_errors_total{kind="timeout"}[${window}]))`, toMs),
      this.#range(
        'sum(rate(emate_task_completed_total{outcome="success"}[5m])) * 60',
        fromMs,
        toMs,
        config.stepSeconds
      ),
      this.#range(
        'sum(rate(emate_task_completed_total{outcome="failure"}[5m])) * 60',
        fromMs,
        toMs,
        config.stepSeconds
      ),
    ]);

    const averageTaskDurationMs =
      durationSum && durationCount && durationCount.value > 0 ? durationSum.value / durationCount.value : null;
    const toolFailureRate =
      toolFailures && toolCalls && toolCalls.value > 0 ? Math.min(toolFailures.value / toolCalls.value, 1) : null;
    const missing: PlatformMonitoringProjection['missing'] = [];
    if (averageTaskDurationMs === null) missing.push('TASK_DURATION');
    if (toolFailureRate === null) missing.push('TOOL_FAILURE_RATE');
    if (!agentErrors) missing.push('AGENT_ERROR');
    if (!agentTimeouts) missing.push('AGENT_TIMEOUT');
    if (successTrend.size === 0) missing.push('TASK_TREND_SUCCESS');
    if (failureTrend.size === 0) missing.push('TASK_TREND_FAILURE');

    const trendTimes = [...new Set([...successTrend.keys(), ...failureTrend.keys()])].toSorted(
      (left, right) => left - right
    );
    const trend = trendTimes.map((at) => ({
      at: new Date(at).toISOString(),
      completedPerMinute: successTrend.get(at) ?? null,
      failedPerMinute: failureTrend.get(at) ?? null,
    }));
    const samples = [
      durationSum,
      durationCount,
      toolFailures,
      toolCalls,
      agentErrors,
      agentTimeouts,
      ...[...successTrend].map(([at, value]) => ({ at, value })),
      ...[...failureTrend].map(([at, value]) => ({ at, value })),
    ].filter((item): item is Sample => item !== null);
    const sourceUpdatedAt =
      samples.length === 0 ? null : new Date(Math.max(...samples.map(({ at }) => at))).toISOString();
    const stale =
      sourceUpdatedAt !== null &&
      Date.parse(sourceUpdatedAt) < toMs - Math.max(config.stepSeconds * 2_000, 10 * 60_000);
    const state = sourceUpdatedAt === null ? 'NO_DATA' : stale ? 'STALE' : missing.length > 0 ? 'PARTIAL' : 'OK';
    return parsePlatformMonitoringProjection({
      schemaVersion: 1,
      scope: 'PLATFORM',
      period,
      state,
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
      generatedAt: new Date(this.#now()).toISOString(),
      sourceUpdatedAt,
      summary: {
        averageTaskDurationMs,
        toolFailureRate,
        agentErrors: agentErrors?.value ?? null,
        agentTimeouts: agentTimeouts?.value ?? null,
        toolFailures: toolFailures?.value ?? null,
      },
      trend,
      missing: state === 'NO_DATA' ? [...allQueries] : missing,
    });
  }

  async #instant(query: string, atMs: number): Promise<Sample | null> {
    const result = await this.#request('/api/v1/query', {
      query,
      time: String(atMs / 1000),
    });
    if (result.resultType !== 'vector' || !Array.isArray(result.result)) {
      throw new Error('Prometheus monitoring response was invalid');
    }
    if (result.result.length === 0) return null;
    if (result.result.length !== 1) {
      throw new Error('Prometheus monitoring response was unbounded');
    }
    return sample(record(result.result[0], 'Prometheus vector').value);
  }

  async #range(query: string, fromMs: number, toMs: number, stepSeconds: number): Promise<Map<number, number>> {
    const result = await this.#request('/api/v1/query_range', {
      query,
      start: String(fromMs / 1000),
      end: String(toMs / 1000),
      step: String(stepSeconds),
    });
    if (result.resultType !== 'matrix' || !Array.isArray(result.result)) {
      throw new Error('Prometheus monitoring response was invalid');
    }
    if (result.result.length === 0) return new Map();
    if (result.result.length !== 1) {
      throw new Error('Prometheus monitoring response was unbounded');
    }
    const values = record(result.result[0], 'Prometheus matrix').values;
    if (!Array.isArray(values) || values.length > 128) {
      throw new Error('Prometheus monitoring response was unbounded');
    }
    const parsed = values.map(sample);
    if (
      parsed.some(
        (value, index) => value.at < fromMs || value.at > toMs || (index > 0 && value.at <= parsed[index - 1]!.at)
      )
    ) {
      throw new Error('Prometheus monitoring samples were invalid');
    }
    return new Map(parsed.map(({ at, value }) => [at, value]));
  }

  async #request(
    path: '/api/v1/query' | '/api/v1/query_range',
    parameters: Record<string, string>
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, this.#baseUrl);
    for (const [name, value] of Object.entries(parameters)) {
      url.searchParams.set(name, value);
    }
    const response = await this.#fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.#token}`,
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error('Prometheus monitoring unavailable');
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
      throw new Error('Prometheus monitoring response was not JSON');
    }
    let payload: Record<string, unknown>;
    try {
      payload = record(JSON.parse(await boundedText(response)), 'Prometheus response');
    } catch {
      throw new Error('Prometheus monitoring response was invalid');
    }
    if (payload.status !== 'success' || payload.warnings || payload.infos) {
      throw new Error('Prometheus monitoring query was incomplete');
    }
    return record(payload.data, 'Prometheus data');
  }
}

async function boundedText(response: Response): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxResponseBytes)) {
    throw new Error('Prometheus monitoring response was too large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw new Error('Prometheus monitoring response was too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function sample(value: unknown): Sample {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    (typeof value[0] !== 'number' && typeof value[0] !== 'string') ||
    typeof value[1] !== 'string'
  ) {
    throw new Error('Prometheus monitoring sample was invalid');
  }
  const seconds = Number(value[0]);
  const metric = Number(value[1]);
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(metric) || metric < 0) {
    throw new Error('Prometheus monitoring sample was invalid');
  }
  return { at: Math.round(seconds * 1000), value: metric };
}
