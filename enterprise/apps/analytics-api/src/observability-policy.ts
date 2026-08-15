import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import {
  parseObservabilityPolicy,
  parseObservabilityPolicyRollback,
  parseObservabilityPolicyUpdate,
  type ObservabilityPolicy,
  type ObservabilityPolicyRollback,
  type ObservabilityPolicyUpdate,
} from '@e-mate/observability-policy-contract';
import type { RuntimeRegistryPrincipal } from './runtime-registry.ts';

const principalPattern = /^[^\p{Cc}]{1,128}$/u;

export type ObservabilityPolicyMutationResult =
  | { status: 'OK'; policy: ObservabilityPolicy }
  | { status: 'VERSION_CONFLICT' }
  | { status: 'IDEMPOTENCY_CONFLICT' }
  | { status: 'NO_CHANGE' }
  | { status: 'VERSION_NOT_FOUND' };

export type ObservabilityPolicyStore = {
  get(tenantId: string): Promise<ObservabilityPolicy>;
  update(
    principal: RuntimeRegistryPrincipal,
    input: ObservabilityPolicyUpdate
  ): Promise<ObservabilityPolicyMutationResult>;
  rollback(
    principal: RuntimeRegistryPrincipal,
    input: ObservabilityPolicyRollback
  ): Promise<ObservabilityPolicyMutationResult>;
};

type PolicyRow = {
  version: string | number;
  trace_sample_ratio: number;
  updated_at: Date;
};

type AuditRow = {
  request_fingerprint: string;
  result_version: string | number;
};

type StoredRequest = {
  fingerprint: string;
  resultVersion: number;
};

type TenantState = {
  current: ObservabilityPolicy;
  history: Map<number, ObservabilityPolicy>;
  requests: Map<string, StoredRequest>;
};

function principalId(value: string, label: string): string {
  if (value.trim() !== value || !principalPattern.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('base64url');
}

function policy(version: number, traceSampleRatio: number, updatedAt: string): ObservabilityPolicy {
  return parseObservabilityPolicy({
    schemaVersion: 1,
    version,
    traceSampleRatio,
    metadataRetentionDays: 30,
    contentCapture: 'NONE',
    updatedAt,
  });
}

function mapRow(row: PolicyRow): ObservabilityPolicy {
  return policy(Number(row.version), row.trace_sample_ratio, row.updated_at.toISOString());
}

export class InMemoryObservabilityPolicyStore implements ObservabilityPolicyStore {
  readonly #tenants = new Map<string, TenantState>();
  readonly #now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  async get(tenantIdInput: string): Promise<ObservabilityPolicy> {
    return this.#state(principalId(tenantIdInput, 'tenant id')).current;
  }

  async update(
    principal: RuntimeRegistryPrincipal,
    value: ObservabilityPolicyUpdate
  ): Promise<ObservabilityPolicyMutationResult> {
    const input = parseObservabilityPolicyUpdate(value);
    const tenantId = principalId(principal.tenantId, 'tenant id');
    principalId(principal.userId, 'user id');
    const state = this.#state(tenantId);
    const requestFingerprint = fingerprint({
      operation: 'UPDATE',
      expectedVersion: input.expectedVersion,
      traceSampleRatio: input.traceSampleRatio,
    });
    const replay = state.requests.get(input.requestId);
    if (replay) {
      return replay.fingerprint === requestFingerprint
        ? { status: 'OK', policy: state.history.get(replay.resultVersion) as ObservabilityPolicy }
        : { status: 'IDEMPOTENCY_CONFLICT' };
    }
    if (state.current.version !== input.expectedVersion) {
      return { status: 'VERSION_CONFLICT' };
    }
    if (state.current.traceSampleRatio === input.traceSampleRatio) {
      return { status: 'NO_CHANGE' };
    }
    const next = policy(state.current.version + 1, input.traceSampleRatio, new Date(this.#now()).toISOString());
    state.current = next;
    state.history.set(next.version, next);
    state.requests.set(input.requestId, {
      fingerprint: requestFingerprint,
      resultVersion: next.version,
    });
    return { status: 'OK', policy: next };
  }

  async rollback(
    principal: RuntimeRegistryPrincipal,
    value: ObservabilityPolicyRollback
  ): Promise<ObservabilityPolicyMutationResult> {
    const input = parseObservabilityPolicyRollback(value);
    const tenantId = principalId(principal.tenantId, 'tenant id');
    principalId(principal.userId, 'user id');
    const state = this.#state(tenantId);
    const requestFingerprint = fingerprint({
      operation: 'ROLLBACK',
      expectedVersion: input.expectedVersion,
      targetVersion: input.targetVersion,
    });
    const replay = state.requests.get(input.requestId);
    if (replay) {
      return replay.fingerprint === requestFingerprint
        ? { status: 'OK', policy: state.history.get(replay.resultVersion) as ObservabilityPolicy }
        : { status: 'IDEMPOTENCY_CONFLICT' };
    }
    if (state.current.version !== input.expectedVersion) {
      return { status: 'VERSION_CONFLICT' };
    }
    const target = state.history.get(input.targetVersion);
    if (!target) return { status: 'VERSION_NOT_FOUND' };
    if (target.traceSampleRatio === state.current.traceSampleRatio) {
      return { status: 'NO_CHANGE' };
    }
    const next = policy(state.current.version + 1, target.traceSampleRatio, new Date(this.#now()).toISOString());
    state.current = next;
    state.history.set(next.version, next);
    state.requests.set(input.requestId, {
      fingerprint: requestFingerprint,
      resultVersion: next.version,
    });
    return { status: 'OK', policy: next };
  }

  #state(tenantId: string): TenantState {
    let state = this.#tenants.get(tenantId);
    if (!state) {
      const initial = policy(1, 1, new Date(this.#now()).toISOString());
      state = {
        current: initial,
        history: new Map([[1, initial]]),
        requests: new Map(),
      };
      this.#tenants.set(tenantId, state);
    }
    return state;
  }
}

export class PostgresObservabilityPolicyStore implements ObservabilityPolicyStore {
  readonly #pool: Pool;
  readonly #now: () => number;

  constructor(pool: Pool, options: { now?: () => number } = {}) {
    this.#pool = pool;
    this.#now = options.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS e_mate_observability_policy_current (
        tenant_id text PRIMARY KEY,
        version bigint NOT NULL CHECK (version > 0),
        trace_sample_ratio double precision NOT NULL
          CHECK (trace_sample_ratio >= 0 AND trace_sample_ratio <= 1),
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS e_mate_observability_policy_history (
        tenant_id text NOT NULL,
        version bigint NOT NULL CHECK (version > 0),
        trace_sample_ratio double precision NOT NULL
          CHECK (trace_sample_ratio >= 0 AND trace_sample_ratio <= 1),
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (tenant_id, version)
      );
      CREATE TABLE IF NOT EXISTS e_mate_observability_policy_audit (
        tenant_id text NOT NULL,
        request_id text NOT NULL,
        request_fingerprint text NOT NULL,
        actor_id text NOT NULL,
        operation text NOT NULL CHECK (operation IN ('UPDATE', 'ROLLBACK')),
        from_version bigint NOT NULL CHECK (from_version > 0),
        target_version bigint,
        result_version bigint NOT NULL CHECK (result_version > 0),
        changed_fields text[] NOT NULL,
        occurred_at timestamptz NOT NULL,
        PRIMARY KEY (tenant_id, request_id)
      );
    `);
  }

  async get(tenantIdInput: string): Promise<ObservabilityPolicy> {
    const tenantId = principalId(tenantIdInput, 'tenant id');
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.#current(client, tenantId);
      await client.query('COMMIT');
      return current;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async update(
    principal: RuntimeRegistryPrincipal,
    value: ObservabilityPolicyUpdate
  ): Promise<ObservabilityPolicyMutationResult> {
    const input = parseObservabilityPolicyUpdate(value);
    return this.#mutate(
      principal,
      input.requestId,
      input.expectedVersion,
      'UPDATE',
      fingerprint({
        operation: 'UPDATE',
        expectedVersion: input.expectedVersion,
        traceSampleRatio: input.traceSampleRatio,
      }),
      async () => ({ traceSampleRatio: input.traceSampleRatio })
    );
  }

  async rollback(
    principal: RuntimeRegistryPrincipal,
    value: ObservabilityPolicyRollback
  ): Promise<ObservabilityPolicyMutationResult> {
    const input = parseObservabilityPolicyRollback(value);
    return this.#mutate(
      principal,
      input.requestId,
      input.expectedVersion,
      'ROLLBACK',
      fingerprint({
        operation: 'ROLLBACK',
        expectedVersion: input.expectedVersion,
        targetVersion: input.targetVersion,
      }),
      async (client, tenantId) => {
        const result = await client.query<PolicyRow>(
          `
          SELECT version, trace_sample_ratio, updated_at
            FROM e_mate_observability_policy_history
           WHERE tenant_id = $1 AND version = $2
           LIMIT 1
        `,
          [tenantId, input.targetVersion]
        );
        return result.rows[0]
          ? {
              traceSampleRatio: result.rows[0].trace_sample_ratio,
              targetVersion: input.targetVersion,
            }
          : null;
      }
    );
  }

  async #current(client: PoolClient, tenantId: string): Promise<ObservabilityPolicy> {
    const timestamp = new Date(this.#now()).toISOString();
    await client.query(
      `
      INSERT INTO e_mate_observability_policy_current (
        tenant_id, version, trace_sample_ratio, updated_at
      ) VALUES ($1, 1, 1, $2)
      ON CONFLICT DO NOTHING
    `,
      [tenantId, timestamp]
    );
    const result = await client.query<PolicyRow>(
      `
      SELECT version, trace_sample_ratio, updated_at
        FROM e_mate_observability_policy_current
       WHERE tenant_id = $1
       FOR UPDATE
    `,
      [tenantId]
    );
    const row = result.rows[0];
    if (!row) throw new Error('Observability policy was unavailable');
    await client.query(
      `
      INSERT INTO e_mate_observability_policy_history (
        tenant_id, version, trace_sample_ratio, updated_at
      ) VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
    `,
      [tenantId, row.version, row.trace_sample_ratio, row.updated_at]
    );
    return mapRow(row);
  }

  async #mutate(
    principal: RuntimeRegistryPrincipal,
    requestId: string,
    expectedVersion: number,
    operation: 'UPDATE' | 'ROLLBACK',
    requestFingerprint: string,
    desired: (
      client: PoolClient,
      tenantId: string
    ) => Promise<{ traceSampleRatio: number; targetVersion?: number } | null>
  ): Promise<ObservabilityPolicyMutationResult> {
    const tenantId = principalId(principal.tenantId, 'tenant id');
    const actorId = principalId(principal.userId, 'user id');
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.#current(client, tenantId);
      const prior = await client.query<AuditRow>(
        `
        SELECT request_fingerprint, result_version
          FROM e_mate_observability_policy_audit
         WHERE tenant_id = $1 AND request_id = $2
         LIMIT 1
      `,
        [tenantId, requestId]
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_fingerprint !== requestFingerprint) {
          await client.query('ROLLBACK');
          return { status: 'IDEMPOTENCY_CONFLICT' };
        }
        const replay = await client.query<PolicyRow>(
          `
          SELECT version, trace_sample_ratio, updated_at
            FROM e_mate_observability_policy_history
           WHERE tenant_id = $1 AND version = $2
           LIMIT 1
        `,
          [tenantId, prior.rows[0].result_version]
        );
        if (!replay.rows[0]) {
          throw new Error('Observability policy audit referenced missing history');
        }
        await client.query('COMMIT');
        return { status: 'OK', policy: mapRow(replay.rows[0]) };
      }
      if (current.version !== expectedVersion) {
        await client.query('ROLLBACK');
        return { status: 'VERSION_CONFLICT' };
      }
      const nextValue = await desired(client, tenantId);
      if (!nextValue) {
        await client.query('ROLLBACK');
        return { status: 'VERSION_NOT_FOUND' };
      }
      if (nextValue.traceSampleRatio === current.traceSampleRatio) {
        await client.query('ROLLBACK');
        return { status: 'NO_CHANGE' };
      }
      const next = policy(current.version + 1, nextValue.traceSampleRatio, new Date(this.#now()).toISOString());
      await client.query(
        `
        INSERT INTO e_mate_observability_policy_history (
          tenant_id, version, trace_sample_ratio, updated_at
        ) VALUES ($1, $2, $3, $4)
      `,
        [tenantId, next.version, next.traceSampleRatio, next.updatedAt]
      );
      const updated = await client.query(
        `
        UPDATE e_mate_observability_policy_current
           SET version = $2,
               trace_sample_ratio = $3,
               updated_at = $4
         WHERE tenant_id = $1 AND version = $5
      `,
        [tenantId, next.version, next.traceSampleRatio, next.updatedAt, expectedVersion]
      );
      if (updated.rowCount !== 1) {
        await client.query('ROLLBACK');
        return { status: 'VERSION_CONFLICT' };
      }
      await client.query(
        `
        INSERT INTO e_mate_observability_policy_audit (
          tenant_id, request_id, request_fingerprint, actor_id, operation,
          from_version, target_version, result_version, changed_fields,
          occurred_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
        [
          tenantId,
          requestId,
          requestFingerprint,
          actorId,
          operation,
          current.version,
          nextValue.targetVersion ?? null,
          next.version,
          ['traceSampleRatio'],
          next.updatedAt,
        ]
      );
      await client.query('COMMIT');
      return { status: 'OK', policy: next };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function openPostgresObservabilityPolicyStore(url: string): Promise<{
  store: PostgresObservabilityPolicyStore;
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
  const store = new PostgresObservabilityPolicyStore(pool);
  try {
    await store.initialize();
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  return { store, close: () => pool.end() };
}
