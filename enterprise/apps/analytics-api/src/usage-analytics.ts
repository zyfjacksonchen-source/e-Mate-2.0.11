import { Pool } from 'pg';
import {
  parseTenantUsageEventPage,
  parseTenantUsageProjection,
  parseTenantUsageReconciliation,
  TASK_SCENARIOS,
  type TaskScenario,
  type TenantUsageEvent,
  type TenantUsageEventPage,
  type TenantUsageProjection,
  type TenantUsageReconciliation,
  type UsageBucket,
  type UsageMetrics,
} from '@e-mate/monitoring-contract';
import type { RuntimeRegistryPrincipal } from './runtime-registry.ts';

export type UsageAnalyticsQuery = {
  from: string;
  to: string;
  timezone: string;
  bucket: UsageBucket;
  userIds?: string[];
  modelId?: string;
  scenario?: TaskScenario;
};

export type UsageAnalyticsResult = {
  projection: TenantUsageProjection;
  reconciliation: TenantUsageReconciliation;
};

export type UsageAnalyticsReader = {
  read(principal: RuntimeRegistryPrincipal, query: UsageAnalyticsQuery): Promise<UsageAnalyticsResult>;
  events?(
    principal: RuntimeRegistryPrincipal,
    query: UsageAnalyticsQuery,
    cursor: string | null,
    limit: number
  ): Promise<TenantUsageEventPage>;
};

type AggregateRow = {
  bucket_start: Date | string;
  user_id: string;
  model_id: string;
  total_requests: string;
  accounted_requests: string;
  rejected_requests: string;
  pending_requests: string;
  usage_events: string;
  input_tokens: string;
  output_tokens: string;
  cache_read_tokens: string;
  cache_write_tokens: string;
  total_tokens: string;
  cost_usd: string;
  zero_cost_usage_events: string;
  unpriced_usage_events: string;
};

type ReconciliationRow = {
  task_count: string;
  usage_task_totals: string;
  completed_invocation_usage: string;
  usage_invocation_links: string;
};

type EventRow = {
  event_kind: 'REQUEST' | 'USAGE';
  event_id: string;
  event_at: Date | string;
  user_id: string;
  task_id: string;
  trace_id: string;
  model_id: string;
  provider_id: string;
  scenario: TaskScenario | null;
  outcome: 'ACCOUNTED' | 'REJECTED' | 'PENDING' | null;
  input_tokens: string | null;
  output_tokens: string | null;
  cache_read_tokens: string | null;
  cache_write_tokens: string | null;
  total_tokens: string | null;
  cost_usd: string | null;
};

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const countPattern = /^(0|[1-9]\d*)$/;
const maxGroups = 10_000;
const taskScenarios = new Set<TaskScenario>(TASK_SCENARIOS);

function identifier(value: string, label: string): string {
  if (!identifierPattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function iso(value: Date | string, label: string): string {
  try {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function count(value: string, label: string): string {
  if (!countPattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function decimal(value: string): string {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,12}))?$/.exec(value);
  if (!match) throw new Error('Invalid usage cost');
  return `${match[1]}.${(match[2] ?? '').padEnd(12, '0')}`;
}

function addCounts(values: string[]): string {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

function addCosts(values: string[]): string {
  const units = values.reduce((total, value) => total + BigInt(decimal(value).replace('.', '')), 0n);
  const digits = units.toString().padStart(13, '0');
  return `${digits.slice(0, -12)}.${digits.slice(-12)}`;
}

function metrics(row: AggregateRow): UsageMetrics {
  return {
    totalRequests: count(row.total_requests, 'total request count'),
    accountedRequests: count(row.accounted_requests, 'accounted request count'),
    rejectedRequests: count(row.rejected_requests, 'rejected request count'),
    pendingRequests: count(row.pending_requests, 'pending request count'),
    usageEvents: count(row.usage_events, 'usage event count'),
    inputTokens: count(row.input_tokens, 'input token count'),
    outputTokens: count(row.output_tokens, 'output token count'),
    cacheReadTokens: count(row.cache_read_tokens, 'cache read token count'),
    cacheWriteTokens: count(row.cache_write_tokens, 'cache write token count'),
    totalTokens: count(row.total_tokens, 'total token count'),
    costUsd: decimal(row.cost_usd),
    zeroCostUsageEvents: count(row.zero_cost_usage_events, 'zero-cost usage event count'),
    unpricedUsageEvents: count(row.unpriced_usage_events, 'unpriced usage event count'),
  };
}

function sumMetrics(values: UsageMetrics[]): UsageMetrics {
  return {
    totalRequests: addCounts(values.map(({ totalRequests }) => totalRequests)),
    accountedRequests: addCounts(values.map(({ accountedRequests }) => accountedRequests)),
    rejectedRequests: addCounts(values.map(({ rejectedRequests }) => rejectedRequests)),
    pendingRequests: addCounts(values.map(({ pendingRequests }) => pendingRequests)),
    usageEvents: addCounts(values.map(({ usageEvents }) => usageEvents)),
    inputTokens: addCounts(values.map(({ inputTokens }) => inputTokens)),
    outputTokens: addCounts(values.map(({ outputTokens }) => outputTokens)),
    cacheReadTokens: addCounts(values.map(({ cacheReadTokens }) => cacheReadTokens)),
    cacheWriteTokens: addCounts(values.map(({ cacheWriteTokens }) => cacheWriteTokens)),
    totalTokens: addCounts(values.map(({ totalTokens }) => totalTokens)),
    costUsd: addCosts(values.map(({ costUsd }) => costUsd)),
    zeroCostUsageEvents: addCounts(values.map(({ zeroCostUsageEvents }) => zeroCostUsageEvents)),
    unpricedUsageEvents: addCounts(values.map(({ unpricedUsageEvents }) => unpricedUsageEvents)),
  };
}

function validateQuery(query: UsageAnalyticsQuery): UsageAnalyticsQuery {
  const from = iso(query.from, 'usage start');
  const to = iso(query.to, 'usage end');
  const duration = Date.parse(to) - Date.parse(from);
  const maximum = query.bucket === 'HOUR' ? 31 * 86_400_000 : 366 * 86_400_000;
  if (
    duration <= 0 ||
    duration > maximum ||
    !['HOUR', 'DAY'].includes(query.bucket) ||
    query.timezone.length < 1 ||
    query.timezone.length > 64 ||
    /\p{Cc}/u.test(query.timezone)
  ) {
    throw new Error('Invalid usage query');
  }
  let timezone: string;
  try {
    timezone = new Intl.DateTimeFormat('en-US', { timeZone: query.timezone }).resolvedOptions().timeZone;
  } catch {
    throw new Error('Invalid usage timezone');
  }
  const userIds = query.userIds ?? [];
  if (
    !Array.isArray(userIds) ||
    userIds.length > 100 ||
    new Set(userIds).size !== userIds.length ||
    userIds.some((userId) => typeof userId !== 'string')
  ) {
    throw new Error('Invalid usage user filter');
  }
  if (query.scenario !== undefined && !taskScenarios.has(query.scenario)) {
    throw new Error('Invalid usage scenario filter');
  }
  return {
    from,
    to,
    timezone,
    bucket: query.bucket,
    ...(userIds.length ? { userIds: userIds.map((userId) => identifier(userId, 'usage user id')) } : {}),
    ...(query.modelId ? { modelId: identifier(query.modelId, 'usage model id') } : {}),
    ...(query.scenario ? { scenario: query.scenario } : {}),
  };
}

function decodeCursor(
  value: string | null
): [string | null, string | null, string | null, string | null, string | null] {
  if (value === null) return [null, null, null, null, null];
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid usage cursor');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid usage cursor');
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 5 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    typeof parsed[2] !== 'string' ||
    typeof parsed[3] !== 'string' ||
    typeof parsed[4] !== 'string' ||
    !['REQUEST', 'USAGE'].includes(parsed[1])
  ) {
    throw new Error('Invalid usage cursor');
  }
  return [
    iso(parsed[0], 'usage cursor time'),
    parsed[1],
    identifier(parsed[2], 'usage cursor id'),
    identifier(parsed[3], 'usage cursor user id'),
    identifier(parsed[4], 'usage cursor task id'),
  ];
}

function encodeCursor(event: TenantUsageEvent): string {
  return Buffer.from(
    JSON.stringify([event.occurredAt, event.kind, event.eventId, event.userId, event.taskId])
  ).toString('base64url');
}

export class PostgresUsageAnalyticsReader implements UsageAnalyticsReader {
  readonly #pool: Pool;
  readonly #now: () => number;

  constructor(pool: Pool, now: () => number = Date.now) {
    this.#pool = pool;
    this.#now = now;
  }

  async read(principal: RuntimeRegistryPrincipal, input: UsageAnalyticsQuery): Promise<UsageAnalyticsResult> {
    const tenantId = identifier(principal.tenantId, 'usage tenant id');
    const query = validateQuery(input);
    const parameters = [
      tenantId,
      query.from,
      query.to,
      query.bucket.toLowerCase(),
      query.timezone,
      query.userIds ?? [],
      query.modelId ?? null,
      query.scenario ?? null,
    ];
    const grouped = await this.#pool.query<AggregateRow>(
      `
      WITH request_facts AS (
        SELECT user_id, model_id,
               GREATEST(
                 date_trunc($4::text, COALESCE(finished_at, prepared_at), $5::text),
                 $2::timestamptz
               )
                 AS bucket_start,
               count(*) AS total_requests,
               count(*) FILTER (WHERE status = 'COMPLETED')
                 AS accounted_requests,
               count(*) FILTER (WHERE status = 'REJECTED')
                 AS rejected_requests,
               count(*) FILTER (WHERE status = 'PREPARED')
                 AS pending_requests
          FROM e_mate_model_invocation
         WHERE tenant_id = $1
           AND COALESCE(finished_at, prepared_at) >= $2::timestamptz
           AND COALESCE(finished_at, prepared_at) < $3::timestamptz
           AND (cardinality($6::text[]) = 0 OR user_id = ANY($6::text[]))
           AND ($7::text IS NULL OR model_id = $7)
           AND (
             $8::text IS NULL OR EXISTS (
               SELECT 1
                 FROM e_mate_task_fact AS task_fact
                WHERE task_fact.tenant_id = e_mate_model_invocation.tenant_id
                  AND task_fact.task_id = e_mate_model_invocation.task_id
                  AND task_fact.scenario = $8
             )
           )
         GROUP BY user_id, model_id, bucket_start
      ),
      usage_facts AS (
        SELECT user_id, model_id,
               GREATEST(
                 date_trunc($4::text, recorded_at, $5::text),
                 $2::timestamptz
               ) AS bucket_start,
               count(*) AS usage_events,
               sum(input_tokens) AS input_tokens,
               sum(output_tokens) AS output_tokens,
               sum(cache_read_tokens) AS cache_read_tokens,
               sum(cache_write_tokens) AS cache_write_tokens,
               sum(input_tokens + output_tokens +
                   cache_read_tokens + cache_write_tokens) AS total_tokens,
               sum(COALESCE(cost_usd, 0)) AS cost_usd,
               count(*) FILTER (WHERE cost_usd = 0)
                 AS zero_cost_usage_events,
               count(*) FILTER (WHERE cost_usd IS NULL)
                 AS unpriced_usage_events
          FROM e_mate_model_usage_attempt
         WHERE tenant_id = $1
           AND recorded_at >= $2::timestamptz
           AND recorded_at < $3::timestamptz
           AND (cardinality($6::text[]) = 0 OR user_id = ANY($6::text[]))
           AND ($7::text IS NULL OR model_id = $7)
           AND (
             $8::text IS NULL OR EXISTS (
               SELECT 1
                 FROM e_mate_task_fact AS task_fact
                WHERE task_fact.tenant_id = e_mate_model_usage_attempt.tenant_id
                  AND task_fact.task_id = e_mate_model_usage_attempt.task_id
                  AND task_fact.scenario = $8
             )
           )
         GROUP BY user_id, model_id, bucket_start
      )
      SELECT COALESCE(request_facts.bucket_start, usage_facts.bucket_start)
               AS bucket_start,
             COALESCE(request_facts.user_id, usage_facts.user_id) AS user_id,
             COALESCE(request_facts.model_id, usage_facts.model_id) AS model_id,
             COALESCE(total_requests, 0)::text AS total_requests,
             COALESCE(accounted_requests, 0)::text AS accounted_requests,
             COALESCE(rejected_requests, 0)::text AS rejected_requests,
             COALESCE(pending_requests, 0)::text AS pending_requests,
             COALESCE(usage_events, 0)::text AS usage_events,
             COALESCE(input_tokens, 0)::text AS input_tokens,
             COALESCE(output_tokens, 0)::text AS output_tokens,
             COALESCE(cache_read_tokens, 0)::text AS cache_read_tokens,
             COALESCE(cache_write_tokens, 0)::text AS cache_write_tokens,
             COALESCE(total_tokens, 0)::text AS total_tokens,
             COALESCE(cost_usd, 0)::text AS cost_usd,
             COALESCE(zero_cost_usage_events, 0)::text
               AS zero_cost_usage_events,
             COALESCE(unpriced_usage_events, 0)::text
               AS unpriced_usage_events
        FROM request_facts
        FULL JOIN usage_facts USING (user_id, model_id, bucket_start)
       ORDER BY bucket_start, user_id, model_id
       LIMIT ${maxGroups + 1}
    `,
      parameters
    );
    if (grouped.rows.length > maxGroups) {
      throw new Error('Usage aggregation is too large');
    }
    const groups = grouped.rows.map((row) => ({
      bucketStart: iso(row.bucket_start, 'usage bucket start'),
      userId: identifier(row.user_id, 'usage user id'),
      modelId: identifier(row.model_id, 'usage model id'),
      metrics: metrics(row),
    }));
    const requestStatusMismatches = groups.filter(
      ({ metrics: value }) =>
        BigInt(value.totalRequests) !==
        BigInt(value.accountedRequests) + BigInt(value.rejectedRequests) + BigInt(value.pendingRequests)
    ).length;
    const reconciled = await this.#pool.query<ReconciliationRow>(
      `
      WITH distinct_tasks AS (
        SELECT count(DISTINCT (user_id, task_id)) AS total
          FROM e_mate_model_invocation
         WHERE tenant_id = $1
           AND COALESCE(finished_at, prepared_at) >= $2::timestamptz
           AND COALESCE(finished_at, prepared_at) < $3::timestamptz
           AND (cardinality($4::text[]) = 0 OR user_id = ANY($4::text[]))
           AND ($5::text IS NULL OR model_id = $5)
           AND (
             $6::text IS NULL OR EXISTS (
               SELECT 1
                 FROM e_mate_task_fact AS task_fact
                WHERE task_fact.tenant_id = e_mate_model_invocation.tenant_id
                  AND task_fact.task_id = e_mate_model_invocation.task_id
                  AND task_fact.scenario = $6
             )
           )
      ),
      touched_tasks AS (
        SELECT DISTINCT tenant_id, user_id, task_id
          FROM e_mate_model_usage_attempt
         WHERE tenant_id = $1
           AND recorded_at >= $2::timestamptz
           AND recorded_at < $3::timestamptz
           AND (cardinality($4::text[]) = 0 OR user_id = ANY($4::text[]))
           AND ($5::text IS NULL OR model_id = $5)
           AND (
             $6::text IS NULL OR EXISTS (
               SELECT 1
                 FROM e_mate_task_fact AS task_fact
                WHERE task_fact.tenant_id = e_mate_model_usage_attempt.tenant_id
                  AND task_fact.task_id = e_mate_model_usage_attempt.task_id
                  AND task_fact.scenario = $6
             )
           )
      ),
      attempt_totals AS (
        SELECT attempt.tenant_id, attempt.user_id, attempt.task_id,
               sum(attempt.input_tokens) AS input_tokens,
               sum(attempt.output_tokens) AS output_tokens,
               sum(attempt.cache_read_tokens) AS cache_read_tokens,
               sum(attempt.cache_write_tokens) AS cache_write_tokens,
               sum(COALESCE(attempt.cost_usd, 0)) AS cost_usd
          FROM e_mate_model_usage_attempt AS attempt
          JOIN touched_tasks USING (tenant_id, user_id, task_id)
         GROUP BY attempt.tenant_id, attempt.user_id, attempt.task_id
      ),
      task_mismatches AS (
        SELECT count(*) AS mismatches
          FROM touched_tasks
          JOIN e_mate_model_usage_task AS task
            USING (tenant_id, user_id, task_id)
          LEFT JOIN attempt_totals AS totals
            USING (tenant_id, user_id, task_id)
         WHERE task.input_tokens <> COALESCE(totals.input_tokens, 0)
            OR task.output_tokens <> COALESCE(totals.output_tokens, 0)
            OR task.cache_read_tokens <> COALESCE(totals.cache_read_tokens, 0)
            OR task.cache_write_tokens <> COALESCE(totals.cache_write_tokens, 0)
            OR task.cost_usd <> COALESCE(totals.cost_usd, 0)
            OR (
              EXISTS (
                SELECT 1
                  FROM e_mate_model_invocation AS audit_invocation
                 WHERE audit_invocation.tenant_id = task.tenant_id
                   AND audit_invocation.user_id = task.user_id
                   AND audit_invocation.task_id = task.task_id
                   AND left(audit_invocation.invocation_id, 13) = 'auditreceipt_'
              )
              AND (
                task.status <> 'FINALIZED'
                OR task.usage_id IS NULL
                OR task.finalized_at IS NULL
              )
            )
      ),
      completed_without_usage AS (
        SELECT count(*) AS mismatches
          FROM e_mate_model_invocation AS invocation
          LEFT JOIN e_mate_model_usage_attempt AS attempt
            ON attempt.tenant_id = invocation.tenant_id
           AND attempt.user_id = invocation.user_id
           AND attempt.task_id = invocation.task_id
           AND attempt.provider_response_id = invocation.provider_response_id
         WHERE invocation.tenant_id = $1
           AND invocation.status = 'COMPLETED'
           AND invocation.finished_at >= $2::timestamptz
           AND invocation.finished_at < $3::timestamptz
           AND (cardinality($4::text[]) = 0 OR invocation.user_id = ANY($4::text[]))
           AND ($5::text IS NULL OR invocation.model_id = $5)
           AND (
             $6::text IS NULL OR EXISTS (
               SELECT 1
                 FROM e_mate_task_fact AS task_fact
                WHERE task_fact.tenant_id = invocation.tenant_id
                  AND task_fact.task_id = invocation.task_id
                  AND task_fact.scenario = $6
             )
           )
           AND attempt.provider_response_id IS NULL
      ),
      usage_without_invocation AS (
        SELECT count(*) AS mismatches
          FROM e_mate_model_usage_attempt AS attempt
          LEFT JOIN e_mate_model_invocation AS invocation
            ON invocation.tenant_id = attempt.tenant_id
           AND invocation.user_id = attempt.user_id
           AND invocation.task_id = attempt.task_id
           AND invocation.provider_response_id = attempt.provider_response_id
           AND invocation.status = 'COMPLETED'
         WHERE attempt.tenant_id = $1
           AND attempt.recorded_at >= $2::timestamptz
           AND attempt.recorded_at < $3::timestamptz
           AND (cardinality($4::text[]) = 0 OR attempt.user_id = ANY($4::text[]))
           AND ($5::text IS NULL OR attempt.model_id = $5)
           AND (
             $6::text IS NULL OR EXISTS (
               SELECT 1
                 FROM e_mate_task_fact AS task_fact
                WHERE task_fact.tenant_id = attempt.tenant_id
                  AND task_fact.task_id = attempt.task_id
                  AND task_fact.scenario = $6
             )
           )
           AND invocation.invocation_id IS NULL
      )
      SELECT distinct_tasks.total::text AS task_count,
             task_mismatches.mismatches::text AS usage_task_totals,
             completed_without_usage.mismatches::text
               AS completed_invocation_usage,
             usage_without_invocation.mismatches::text
               AS usage_invocation_links
        FROM distinct_tasks, task_mismatches, completed_without_usage,
             usage_without_invocation
    `,
      [tenantId, query.from, query.to, query.userIds ?? [], query.modelId ?? null, query.scenario ?? null]
    );
    const check = reconciled.rows[0];
    if (!check) throw new Error('Usage reconciliation was unavailable');
    const checkedAt = new Date(this.#now()).toISOString();
    const checks = {
      requestStatuses: String(requestStatusMismatches),
      usageTaskTotals: count(check.usage_task_totals, 'usage task mismatch count'),
      completedInvocationUsage: count(check.completed_invocation_usage, 'completed invocation usage mismatch count'),
      usageInvocationLinks: count(check.usage_invocation_links, 'usage invocation mismatch count'),
    };
    return {
      projection: parseTenantUsageProjection({
        schemaVersion: 1,
        scope: 'TENANT',
        tenantId,
        from: query.from,
        to: query.to,
        timezone: query.timezone,
        bucket: query.bucket,
        generatedAt: checkedAt,
        taskCount: count(check.task_count, 'task count'),
        summary: sumMetrics(groups.map(({ metrics: value }) => value)),
        groups,
      }),
      reconciliation: parseTenantUsageReconciliation({
        schemaVersion: 1,
        scope: 'TENANT',
        tenantId,
        from: query.from,
        to: query.to,
        checkedAt,
        state: Object.values(checks).every((mismatches) => mismatches === '0') ? 'MATCHED' : 'MISMATCHED',
        checks,
      }),
    };
  }

  async events(
    principal: RuntimeRegistryPrincipal,
    input: UsageAnalyticsQuery,
    cursor: string | null,
    limit: number
  ): Promise<TenantUsageEventPage> {
    const tenantId = identifier(principal.tenantId, 'usage tenant id');
    const query = validateQuery(input);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid usage event limit');
    const [cursorAt, cursorKind, cursorId, cursorUserId, cursorTaskId] = decodeCursor(cursor);
    const result = await this.#pool.query<EventRow>(
      `
      WITH events AS (
        SELECT tenant_id, user_id, task_id, trace_id, model_id, provider_id,
               'REQUEST'::text AS event_kind,
               invocation_id AS event_id,
               COALESCE(finished_at, prepared_at) AS event_at,
               CASE status
                 WHEN 'COMPLETED' THEN 'ACCOUNTED'
                 WHEN 'REJECTED' THEN 'REJECTED'
                 ELSE 'PENDING'
               END AS outcome,
               NULL::bigint AS input_tokens,
               NULL::bigint AS output_tokens,
               NULL::bigint AS cache_read_tokens,
               NULL::bigint AS cache_write_tokens,
               NULL::bigint AS total_tokens,
               NULL::numeric AS cost_usd
          FROM e_mate_model_invocation
        UNION ALL
        SELECT tenant_id, user_id, task_id, trace_id, model_id, provider_id,
               'USAGE'::text AS event_kind,
               provider_response_id AS event_id,
               recorded_at AS event_at,
               NULL::text AS outcome,
               input_tokens,
               output_tokens,
               cache_read_tokens,
               cache_write_tokens,
               input_tokens + output_tokens +
                 cache_read_tokens + cache_write_tokens AS total_tokens,
               cost_usd
          FROM e_mate_model_usage_attempt
      )
      SELECT events.event_kind, events.event_id, events.event_at,
             events.user_id, events.task_id, events.trace_id,
             events.model_id, events.provider_id, task_fact.scenario,
             events.outcome, events.input_tokens::text,
             events.output_tokens::text, events.cache_read_tokens::text,
             events.cache_write_tokens::text, events.total_tokens::text,
             events.cost_usd::text
        FROM events
        LEFT JOIN e_mate_task_fact AS task_fact
          ON task_fact.tenant_id = events.tenant_id
         AND task_fact.task_id = events.task_id
       WHERE events.tenant_id = $1
         AND events.event_at >= $2::timestamptz
         AND events.event_at < $3::timestamptz
         AND (cardinality($4::text[]) = 0 OR events.user_id = ANY($4::text[]))
         AND ($5::text IS NULL OR events.model_id = $5)
         AND ($6::text IS NULL OR task_fact.scenario = $6)
         AND (
           $7::timestamptz IS NULL OR
            (events.event_at, events.event_kind, events.event_id,
             events.user_id, events.task_id) >
              ($7::timestamptz, $8::text, $9::text, $10::text, $11::text)
          )
       ORDER BY events.event_at, events.event_kind, events.event_id,
                events.user_id, events.task_id
       LIMIT $12
    `,
      [
        tenantId,
        query.from,
        query.to,
        query.userIds ?? [],
        query.modelId ?? null,
        query.scenario ?? null,
        cursorAt,
        cursorKind,
        cursorId,
        cursorUserId,
        cursorTaskId,
        limit + 1,
      ]
    );
    const more = result.rows.length > limit;
    const events = result.rows.slice(0, limit).map((row): TenantUsageEvent => {
      const common = {
        eventId: identifier(row.event_id, 'usage event id'),
        occurredAt: iso(row.event_at, 'usage event time'),
        userId: identifier(row.user_id, 'usage user id'),
        taskId: identifier(row.task_id, 'usage task id'),
        traceId: identifier(row.trace_id, 'usage trace id'),
        modelId: identifier(row.model_id, 'usage model id'),
        providerId: identifier(row.provider_id, 'usage provider id'),
        scenario: row.scenario,
      };
      if (row.event_kind === 'REQUEST') {
        if (!row.outcome) throw new Error('Usage request outcome was unavailable');
        return Object.assign({ kind: 'REQUEST' as const }, common, { outcome: row.outcome });
      }
      if (
        row.input_tokens === null ||
        row.output_tokens === null ||
        row.cache_read_tokens === null ||
        row.cache_write_tokens === null ||
        row.total_tokens === null
      ) {
        throw new Error('Usage event totals were unavailable');
      }
      return Object.assign({ kind: 'USAGE' as const }, common, {
        inputTokens: count(row.input_tokens, 'input token count'),
        outputTokens: count(row.output_tokens, 'output token count'),
        cacheReadTokens: count(row.cache_read_tokens, 'cache read token count'),
        cacheWriteTokens: count(row.cache_write_tokens, 'cache write token count'),
        totalTokens: count(row.total_tokens, 'total token count'),
        costUsd: row.cost_usd === null ? null : decimal(row.cost_usd),
      });
    });
    return parseTenantUsageEventPage({
      schemaVersion: 1,
      scope: 'TENANT',
      tenantId,
      from: query.from,
      to: query.to,
      events,
      nextCursor: more && events.length > 0 ? encodeCursor(events[events.length - 1] as TenantUsageEvent) : null,
    });
  }
}

export async function openPostgresUsageAnalyticsReader(url: string): Promise<{
  reader: PostgresUsageAnalyticsReader;
  close: () => Promise<void>;
}> {
  const parsed = new URL(url);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(parsed.hostname);
  const privateService = parsed.hostname === 'postgres';
  const queryValid =
    loopback || privateService
      ? !parsed.search
      : parsed.searchParams.size === 1 && parsed.searchParams.get('sslmode') === 'require';
  if (
    (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') ||
    !parsed.hostname ||
    parsed.hash ||
    !queryValid
  ) {
    throw new Error('PostgreSQL URL was invalid');
  }
  const pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(loopback || privateService ? {} : { ssl: { rejectUnauthorized: true } }),
  });
  pool.on('error', () => undefined);
  return { reader: new PostgresUsageAnalyticsReader(pool), close: () => pool.end() };
}
