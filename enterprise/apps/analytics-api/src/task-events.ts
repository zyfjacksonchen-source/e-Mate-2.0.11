import { Pool, type PoolClient } from 'pg';
import {
  parseTaskEventInput,
  parseTenantTaskSummary,
  TASK_EVENT_TYPES,
  TASK_SCENARIOS,
  type TaskEventInput,
  type TaskEventType,
  type TaskScenario,
  type TenantTaskSummary,
} from '@e-mate/monitoring-contract';
import type { RuntimeRegistryPrincipal } from './runtime-registry.ts';

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const principalPattern = /^[^\p{Cc}]{1,128}$/u;
const terminalTypes = new Set<TaskEventType>(['COMPLETED', 'FAILED', 'CANCELLED']);

export type TaskEventQuery = {
  from: string;
  to: string;
};

export type TaskEventWriteResult = 'ACCEPTED' | 'REPLAY' | 'CONFLICT' | 'NOT_RECEIVED';

export type TaskEventStore = {
  append(principal: RuntimeRegistryPrincipal, value: TaskEventInput): Promise<TaskEventWriteResult>;
  summary(principal: RuntimeRegistryPrincipal, query: TaskEventQuery): Promise<TenantTaskSummary>;
};

type TaskRow = {
  user_id: string;
  scenario: TaskScenario;
  received_event_id: string;
  received_at: Date | string;
  status: 'RECEIVED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  terminal_at: Date | string | null;
};

type EventRow = {
  user_id: string;
  task_id: string;
  type: TaskEventType;
  scenario: TaskScenario;
  occurred_at: Date | string;
};

type SummaryRow = {
  received_tasks: string;
  successful_tasks: string;
  failed_tasks: string;
  cancelled_tasks: string;
  scenario_counts: Record<string, string> | null;
  event_type_counts: Record<string, string> | null;
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

function sameEvent(row: EventRow, principal: RuntimeRegistryPrincipal, event: TaskEventInput): boolean {
  return (
    row.user_id === principal.userId &&
    row.task_id === event.taskId &&
    row.type === event.type &&
    row.scenario === event.scenario &&
    iso(row.occurred_at) === event.occurredAt
  );
}

async function rollback(client: PoolClient): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined);
}

export class PostgresTaskEventStore implements TaskEventStore {
  readonly #pool: Pool;
  readonly #now: () => number;

  constructor(pool: Pool, now: () => number = Date.now) {
    this.#pool = pool;
    this.#now = now;
  }

  async initialize(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS e_mate_task_fact (
        tenant_id text NOT NULL,
        task_id text NOT NULL,
        user_id text NOT NULL,
        scenario text NOT NULL CHECK (
          scenario IN (
            'CONTENT_CREATION', 'DOCUMENT_EDITING', 'SYSTEM_MAINTENANCE',
            'ASSET_PRODUCTION', 'DATA_PROCESSING', 'SEARCH_QUERY'
          )
        ),
        received_event_id text NOT NULL,
        received_at timestamptz NOT NULL,
        status text NOT NULL CHECK (
          status IN ('RECEIVED', 'COMPLETED', 'FAILED', 'CANCELLED')
        ),
        terminal_event_id text,
        terminal_at timestamptz,
        PRIMARY KEY (tenant_id, task_id),
        UNIQUE (tenant_id, received_event_id),
        CHECK (
          (status = 'RECEIVED' AND terminal_event_id IS NULL AND terminal_at IS NULL) OR
          (status <> 'RECEIVED' AND terminal_event_id IS NOT NULL AND terminal_at IS NOT NULL)
        )
      );
      CREATE TABLE IF NOT EXISTS e_mate_task_event (
        tenant_id text NOT NULL,
        event_id text NOT NULL,
        task_id text NOT NULL,
        user_id text NOT NULL,
        type text NOT NULL CHECK (
          type IN (
            'RECEIVED', 'FIRST_RESPONSE', 'COMPLETED', 'FAILED',
            'CANCELLED', 'SKILL_SELECTED', 'TOOL_SELECTED',
            'TOOL_EXECUTION', 'PERMISSION_REQUESTED', 'WAITING_INPUT',
            'ARTIFACT_UPDATED'
          )
        ),
        scenario text NOT NULL CHECK (
          scenario IN (
            'CONTENT_CREATION', 'DOCUMENT_EDITING', 'SYSTEM_MAINTENANCE',
            'ASSET_PRODUCTION', 'DATA_PROCESSING', 'SEARCH_QUERY'
          )
        ),
        occurred_at timestamptz NOT NULL,
        recorded_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, event_id),
        FOREIGN KEY (tenant_id, task_id)
          REFERENCES e_mate_task_fact (tenant_id, task_id)
      );
      CREATE INDEX IF NOT EXISTS e_mate_task_fact_received
        ON e_mate_task_fact (tenant_id, received_at, task_id);
      CREATE INDEX IF NOT EXISTS e_mate_task_event_occurred
        ON e_mate_task_event (tenant_id, occurred_at, event_id);
      ALTER TABLE e_mate_task_event
        DROP CONSTRAINT IF EXISTS e_mate_task_event_type_check;
      ALTER TABLE e_mate_task_event
        ADD CONSTRAINT e_mate_task_event_type_check CHECK (
          type IN (
            'RECEIVED', 'FIRST_RESPONSE', 'COMPLETED', 'FAILED',
            'CANCELLED', 'SKILL_SELECTED', 'TOOL_SELECTED',
            'TOOL_EXECUTION', 'PERMISSION_REQUESTED', 'WAITING_INPUT',
            'ARTIFACT_UPDATED'
          )
        );
    `);
  }

  async #findEvent(tenantId: string, eventId: string): Promise<EventRow | undefined> {
    const result = await this.#pool.query<EventRow>(
      `
      SELECT user_id, task_id, type, scenario, occurred_at
        FROM e_mate_task_event
       WHERE tenant_id = $1 AND event_id = $2
       LIMIT 1
    `,
      [tenantId, eventId]
    );
    return result.rows[0];
  }

  async append(principal: RuntimeRegistryPrincipal, value: TaskEventInput): Promise<TaskEventWriteResult> {
    const tenantId = identifier(principal.tenantId, 'tenant id');
    const userId = principalId(principal.userId);
    const event = parseTaskEventInput(value);
    const replay = await this.#findEvent(tenantId, event.eventId);
    if (replay) return sameEvent(replay, principal, event) ? 'REPLAY' : 'CONFLICT';

    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      if (event.type === 'RECEIVED') {
        await client.query(
          `
          INSERT INTO e_mate_task_fact (
            tenant_id, task_id, user_id, scenario, received_event_id,
            received_at, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,'RECEIVED')
        `,
          [tenantId, event.taskId, userId, event.scenario, event.eventId, event.occurredAt]
        );
      } else {
        const taskResult = await client.query<TaskRow>(
          `
          SELECT user_id, scenario, received_event_id, received_at, status,
                 terminal_at
            FROM e_mate_task_fact
           WHERE tenant_id = $1 AND task_id = $2
           FOR UPDATE
        `,
          [tenantId, event.taskId]
        );
        const task = taskResult.rows[0];
        if (!task) {
          await rollback(client);
          return 'NOT_RECEIVED';
        }
        const occurredAt = Date.parse(event.occurredAt);
        if (
          task.user_id !== userId ||
          task.scenario !== event.scenario ||
          occurredAt < Date.parse(iso(task.received_at)) ||
          (terminalTypes.has(event.type) && task.status !== 'RECEIVED') ||
          (!terminalTypes.has(event.type) && task.terminal_at && occurredAt > Date.parse(iso(task.terminal_at)))
        ) {
          await rollback(client);
          return 'CONFLICT';
        }
      }

      await client.query(
        `
        INSERT INTO e_mate_task_event (
          tenant_id, event_id, task_id, user_id, type, scenario, occurred_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
        [tenantId, event.eventId, event.taskId, userId, event.type, event.scenario, event.occurredAt]
      );
      if (terminalTypes.has(event.type)) {
        await client.query(
          `
          UPDATE e_mate_task_fact
             SET status = $3, terminal_event_id = $4, terminal_at = $5
           WHERE tenant_id = $1 AND task_id = $2
        `,
          [tenantId, event.taskId, event.type, event.eventId, event.occurredAt]
        );
      }
      await client.query('COMMIT');
      return 'ACCEPTED';
    } catch (error) {
      await rollback(client);
      if ((error as { code?: unknown }).code === '23505') {
        const existing = await this.#findEvent(tenantId, event.eventId);
        return existing && sameEvent(existing, principal, event) ? 'REPLAY' : 'CONFLICT';
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async summary(principal: RuntimeRegistryPrincipal, query: TaskEventQuery): Promise<TenantTaskSummary> {
    const tenantId = identifier(principal.tenantId, 'tenant id');
    const from = new Date(query.from).toISOString();
    const to = new Date(query.to).toISOString();
    const generatedAt = new Date(this.#now()).toISOString();
    if (Date.parse(from) >= Date.parse(to) || Date.parse(to) > Date.parse(generatedAt)) {
      throw new Error('Invalid task event query');
    }
    const result = await this.#pool.query<SummaryRow>(
      `
      WITH cohort AS (
        SELECT tenant_id, task_id, scenario, status, terminal_at
          FROM e_mate_task_fact
         WHERE tenant_id = $1
           AND received_at >= $2::timestamptz
           AND received_at < $3::timestamptz
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
      event_counts AS (
        SELECT event.type, count(*)::text AS event_count
          FROM e_mate_task_event AS event
          JOIN cohort USING (tenant_id, task_id)
         WHERE event.occurred_at < $3::timestamptz
         GROUP BY event.type
      )
      SELECT totals.*,
             COALESCE(
               (SELECT jsonb_object_agg(scenario, task_count) FROM scenario_counts),
               '{}'::jsonb
             ) AS scenario_counts,
             COALESCE(
               (SELECT jsonb_object_agg(type, event_count) FROM event_counts),
               '{}'::jsonb
             ) AS event_type_counts
        FROM totals
    `,
      [tenantId, from, to]
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
      eventTypeCounts: TASK_EVENT_TYPES.map((type) => ({
        type,
        eventCount: row.event_type_counts?.[type] ?? '0',
      })),
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
  try {
    await store.initialize();
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  return { store, close: () => pool.end() };
}
