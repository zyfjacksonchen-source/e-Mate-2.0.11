import { Pool } from 'pg';
import {
  parseTenantTaskSummary,
  TASK_EVENT_TYPES,
  TASK_SCENARIOS,
  type TaskScenario,
  type TenantTaskSummary,
} from '@e-mate/monitoring-contract';
import type { RuntimeRegistryPrincipal } from './runtime-registry.ts';

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const principalPattern = /^[^\p{Cc}]{1,128}$/u;

export type TaskEventQuery = {
  from: string;
  to: string;
  timezone?: string;
  userIds?: string[];
  scenario?: TaskScenario;
};

export type TaskEventStore = {
  summary(principal: RuntimeRegistryPrincipal, query: TaskEventQuery): Promise<TenantTaskSummary>;
};

type SummaryRow = {
  received_tasks: string;
  successful_tasks: string;
  failed_tasks: string;
  cancelled_tasks: string;
  scenario_counts: Record<string, string> | null;
  scenario_buckets: Array<{ bucketStart: string; scenario: TaskScenario; taskCount: string }> | null;
  event_type_counts: Record<string, string> | null;
  user_event_counts: Array<{ userId: string; eventCount: string }> | null;
};

function identifier(value: string, label: string): string {
  if (!identifierPattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function principalId(value: string): string {
  if (value.trim() !== value || !principalPattern.test(value)) throw new Error('Invalid user id');
  return value;
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export class PostgresTaskEventStore implements TaskEventStore {
  readonly #pool: Pool;
  readonly #now: () => number;

  constructor(pool: Pool, now: () => number = Date.now) {
    this.#pool = pool;
    this.#now = now;
  }

  async summary(principal: RuntimeRegistryPrincipal, query: TaskEventQuery): Promise<TenantTaskSummary> {
    const tenantId = identifier(principal.tenantId, 'tenant id');
    const from = new Date(query.from).toISOString();
    const to = new Date(query.to).toISOString();
    const generatedAt = new Date(this.#now()).toISOString();
    if (Date.parse(from) >= Date.parse(to) || Date.parse(to) > Date.parse(generatedAt)) {
      throw new Error('Invalid task event query');
    }
    const userIds = query.userIds ?? [];
    if (
      !Array.isArray(userIds) ||
      userIds.length > 100 ||
      new Set(userIds).size !== userIds.length ||
      userIds.some((userId) => typeof userId !== 'string')
    ) {
      throw new Error('Invalid task event user filter');
    }
    const filteredUserIds = userIds.map(principalId);
    if (query.scenario !== undefined && !TASK_SCENARIOS.includes(query.scenario)) {
      throw new Error('Invalid task event scenario filter');
    }
    const timezone = query.timezone ?? 'UTC';
    try {
      if (
        timezone.length < 1 ||
        timezone.length > 64 ||
        /\p{Cc}/u.test(timezone) ||
        !new Intl.DateTimeFormat('en-US', { timeZone: timezone }).resolvedOptions().timeZone
      ) {
        throw new Error('Invalid timezone');
      }
    } catch {
      throw new Error('Invalid task event timezone');
    }
    const result = await this.#pool.query<SummaryRow>(
      `
      WITH cohort AS (
        SELECT tenant_id, task_id, user_id, scenario, received_at, status, terminal_at
          FROM e_mate_task_fact
         WHERE tenant_id = $1
           AND received_at >= $2::timestamptz
           AND received_at < $3::timestamptz
           AND (cardinality($4::text[]) = 0 OR user_id = ANY($4::text[]))
           AND ($6::text IS NULL OR scenario = $6)
      ),
      totals AS (
        SELECT count(*)::text AS received_tasks,
               count(*) FILTER (
                 WHERE status = 'COMPLETED' AND terminal_at < $3::timestamptz
               )::text AS successful_tasks,
               count(*) FILTER (
                 WHERE status = 'FAILED' AND terminal_at < $3::timestamptz
               )::text AS failed_tasks,
               count(*) FILTER (
                 WHERE status = 'CANCELLED' AND terminal_at < $3::timestamptz
               )::text AS cancelled_tasks
          FROM cohort
      ),
      scenario_counts AS (
        SELECT scenario, count(*)::text AS task_count
          FROM cohort
         GROUP BY scenario
      ),
      scenario_buckets AS (
        SELECT date_trunc('day', received_at AT TIME ZONE $5) AT TIME ZONE $5 AS bucket_start,
               scenario,
               count(*)::text AS task_count
          FROM cohort
         GROUP BY bucket_start, scenario
      ),
      event_counts AS (
        SELECT event.type, count(*)::text AS event_count
          FROM e_mate_task_event AS event
          JOIN cohort USING (tenant_id, task_id)
         WHERE event.occurred_at < $3::timestamptz
         GROUP BY event.type
      ),
      user_event_counts AS (
        SELECT event.user_id, count(*)::text AS event_count
          FROM e_mate_task_event AS event
          JOIN cohort USING (tenant_id, task_id)
         WHERE event.occurred_at < $3::timestamptz
         GROUP BY event.user_id
      )
      SELECT totals.*,
             COALESCE(
               (SELECT jsonb_object_agg(scenario, task_count) FROM scenario_counts),
               '{}'::jsonb
             ) AS scenario_counts,
             COALESCE(
               (
                 SELECT jsonb_agg(
                   jsonb_build_object(
                     'bucketStart', bucket_start,
                     'scenario', scenario,
                     'taskCount', task_count
                   )
                   ORDER BY bucket_start, scenario
                 )
                   FROM scenario_buckets
               ),
               '[]'::jsonb
             ) AS scenario_buckets,
             COALESCE(
               (SELECT jsonb_object_agg(type, event_count) FROM event_counts),
               '{}'::jsonb
             ) AS event_type_counts,
             COALESCE(
               (
                 SELECT jsonb_agg(
                   jsonb_build_object('userId', user_id, 'eventCount', event_count)
                   ORDER BY user_id
                 )
                   FROM user_event_counts
               ),
               '[]'::jsonb
             ) AS user_event_counts
        FROM totals
    `,
      [tenantId, from, to, filteredUserIds, timezone, query.scenario ?? null]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Task event totals were unavailable');
    return parseTenantTaskSummary({
      schemaVersion: 1,
      scope: 'TENANT',
      tenantId,
      from,
      to,
      generatedAt,
      sourceState: row.received_tasks === '0' ? 'NO_DATA' : 'AUTHORITATIVE',
      summary: {
        receivedTasks: row.received_tasks,
        successfulTasks: row.successful_tasks,
        failedTasks: row.failed_tasks,
        cancelledTasks: row.cancelled_tasks,
      },
      scenarioCounts: TASK_SCENARIOS.map((scenario) => ({
        scenario,
        taskCount: row.scenario_counts?.[scenario] ?? '0',
      })),
      scenarioBuckets: (row.scenario_buckets ?? []).map(({ bucketStart, scenario, taskCount }) => ({
        bucketStart: iso(bucketStart),
        scenario,
        taskCount,
      })),
      eventTypeCounts: TASK_EVENT_TYPES.map((type) => ({
        type,
        eventCount: row.event_type_counts?.[type] ?? '0',
      })),
      userEventCounts: row.user_event_counts ?? [],
    });
  }
}

export async function openPostgresTaskEventStore(url: string): Promise<{
  store: PostgresTaskEventStore;
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
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(loopback || privateService ? {} : { ssl: { rejectUnauthorized: true } }),
  });
  pool.on('error', () => undefined);
  const store = new PostgresTaskEventStore(pool);
  return { store, close: () => pool.end() };
}
