import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { openPostgresAdminManagementStore } from '../../analytics-api/src/admin-management.ts';
import type { RuntimeRegistryPrincipal } from '../../analytics-api/src/runtime-registry.ts';
import {
  InvocationAdmissionError,
  PostgresTenantModelRoutePolicy,
  PostgresUsageStore,
  type InvocationFact,
  type ModelGatewayPrincipal,
  type UsageFact,
} from '../src/index.ts';

const databaseUrl = process.env.E_MATE_TEST_POSTGRES_URL;
const limits = {
  tenantRequestsPerMinute: 10_000,
  tenantBurst: 10_000,
  tenantMaxConcurrent: 100,
  invocationLeaseMs: 180_000,
};

function pool(): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
  });
}

async function createActiveTestUsers(
  database: Pool,
  users: Array<{ tenantId: string; userId: string; tokenLimit?: number | null }>
): Promise<void> {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('e-mate-test-tenant-user-schema'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS e_mate_tenant_user (
        tenant_id text NOT NULL,
        user_id text NOT NULL,
        display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
        roles text[] NOT NULL,
        status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
        token_limit bigint CHECK (token_limit BETWEEN 1 AND ${Number.MAX_SAFE_INTEGER}),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, user_id),
        CHECK (roles <@ ARRAY['TENANT_ADMIN', 'AUDIT_ADMIN', 'MEMBER']::text[]),
        CHECK (cardinality(roles) BETWEEN 1 AND 3)
      );
      ALTER TABLE e_mate_tenant_user
        ADD COLUMN IF NOT EXISTS token_limit bigint;
      ALTER TABLE e_mate_tenant_user
        DROP CONSTRAINT IF EXISTS e_mate_tenant_user_status_check;
      ALTER TABLE e_mate_tenant_user
        ADD CONSTRAINT e_mate_tenant_user_status_check
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED'));
      ALTER TABLE e_mate_tenant_user
        DROP CONSTRAINT IF EXISTS e_mate_tenant_user_token_limit_check;
      ALTER TABLE e_mate_tenant_user
        ADD CONSTRAINT e_mate_tenant_user_token_limit_check
        CHECK (token_limit BETWEEN 1 AND ${Number.MAX_SAFE_INTEGER});
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  await Promise.all(
    users.map(({ tenantId, userId, tokenLimit = null }) =>
      database.query(
        `
        INSERT INTO e_mate_tenant_user (
          tenant_id, user_id, display_name, roles, status, token_limit
        )
        VALUES ($1,$2,$2,ARRAY['MEMBER']::text[],'ACTIVE',$3)
        ON CONFLICT (tenant_id, user_id) DO UPDATE
          SET status = 'ACTIVE', token_limit = EXCLUDED.token_limit, updated_at = now()
      `,
        [tenantId, userId, tokenLimit]
      )
    )
  );
}

test(
  'real PostgreSQL atomically aggregates and freezes gateway usage attempts',
  { skip: databaseUrl ? false : 'E_MATE_TEST_POSTGRES_URL is not set' },
  async () => {
    const suffix = randomUUID();
    const tenantId = `tenant-${suffix}`;
    const userId = `user-${suffix}`;
    const taskId = `task-${suffix}`;
    const principal: ModelGatewayPrincipal = {
      tenantId,
      userId,
      modelIds: ['gpt-5.6-sol'],
    };
    let database = pool();
    let store = new PostgresUsageStore(database, limits);
    await Promise.all(Array.from({ length: 10 }, () => new PostgresUsageStore(database, limits).initialize()));
    await createActiveTestUsers(database, [{ tenantId, userId }]);
    const fact = (index: number): UsageFact => ({
      tenantId,
      userId,
      taskId,
      traceId: `trace-${suffix}`,
      modelId: 'gpt-5.6-sol',
      providerId: 'custom-gpt',
      providerResponseId: `response-${index}`,
      inputTokens: 1,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      costUsd: 0.01,
    });
    try {
      await Promise.all(Array.from({ length: 50 }, (_, index) => store.add(fact(index))));
      await Promise.all(Array.from({ length: 20 }, () => store.add(fact(0))));
      await Promise.all(Array.from({ length: 20 }, () => store.add(fact(50))));
      await assert.rejects(store.add({ ...fact(0), outputTokens: 99 }), /idempotency conflict/);
      await assert.rejects(store.add({ ...fact(60), modelId: 'gpt-5.5' }), /scope changed/);

      const finalized = await Promise.all(Array.from({ length: 20 }, () => store.finalize(principal, taskId)));
      const first = finalized[0];
      assert(first);
      assert(finalized.every((usage) => usage?.usageId === first.usageId));
      assert.deepEqual(
        {
          inputTokens: first.inputTokens,
          outputTokens: first.outputTokens,
          cacheReadTokens: first.cacheReadTokens,
          cacheWriteTokens: first.cacheWriteTokens,
          costUsd: first.costUsd,
        },
        {
          inputTokens: 51,
          outputTokens: 102,
          cacheReadTokens: 153,
          cacheWriteTokens: 204,
          costUsd: 0.51,
        }
      );
      await store.add(fact(0));
      await assert.rejects(store.add(fact(51)), /already finalized/);
      assert.equal(await store.finalize({ ...principal, tenantId: `other-${suffix}` }, taskId), null);
      assert.equal(await store.finalize({ ...principal, userId: `other-${suffix}` }, taskId), null);

      const raceTaskId = `race-${suffix}`;
      const racePrincipal = principal;
      const raceBase = { ...fact(70), taskId: raceTaskId };
      const raceNext = {
        ...fact(71),
        taskId: raceTaskId,
      };
      await store.add(raceBase);
      const [raceAdd, raceFinalize] = await Promise.allSettled([
        store.add(raceNext),
        store.finalize(racePrincipal, raceTaskId),
      ]);
      assert.equal(raceFinalize.status, 'fulfilled');
      if (raceAdd.status === 'rejected') {
        assert.match(String(raceAdd.reason), /already finalized/);
      }
      const raceReceipt = await store.finalize(racePrincipal, raceTaskId);
      assert(raceReceipt);
      assert.equal(raceReceipt.inputTokens, raceAdd.status === 'fulfilled' ? 2 : 1);
      assert.equal((await store.finalize(racePrincipal, raceTaskId))?.usageId, raceReceipt.usageId);

      const limitTaskId = `limit-${suffix}`;
      const limitFact: UsageFact = {
        ...fact(80),
        taskId: limitTaskId,
        inputTokens: Number.MAX_SAFE_INTEGER,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      };
      await store.add(limitFact);
      await assert.rejects(
        store.add({
          ...limitFact,
          providerResponseId: 'limit-overflow',
          inputTokens: 0,
          outputTokens: 1,
        })
      );
      await store.add({
        ...limitFact,
        providerResponseId: 'limit-overflow',
        inputTokens: 0,
      });
      assert.equal((await store.finalize(principal, limitTaskId))?.inputTokens, Number.MAX_SAFE_INTEGER);

      const invocationTaskId = `invocation-${suffix}`;
      const invocation: InvocationFact = {
        tenantId,
        userId,
        taskId: invocationTaskId,
        traceId: `trace-${suffix}`,
        modelId: 'gpt-5.6-sol',
        providerId: 'custom-gpt',
        requestDigest: 'A'.repeat(43),
        routeFingerprint: 'R'.repeat(43),
      };
      const prepared = await Promise.all(Array.from({ length: 20 }, () => store.prepare(invocation)));
      assert.equal(prepared.filter(({ status }) => status === 'STARTED').length, 1);
      assert.equal(new Set(prepared.map(({ invocationId }) => invocationId)).size, 1);
      await assert.rejects(store.finalize(principal, invocationTaskId), /requires reconciliation/);
      const completedFact: UsageFact = {
        tenantId: invocation.tenantId,
        userId: invocation.userId,
        taskId: invocation.taskId,
        traceId: invocation.traceId,
        modelId: invocation.modelId,
        providerId: invocation.providerId,
        providerResponseId: `response-invocation-${suffix}`,
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.01,
      };
      await store.complete(prepared[0]!.invocationId, completedFact);
      await store.complete(prepared[0]!.invocationId, completedFact);
      assert.equal((await store.prepare(invocation)).status, 'RECORDED');
      const unknownInvocation = {
        ...invocation,
        requestDigest: 'B'.repeat(43),
      };
      const unknown = await store.prepare(unknownInvocation);
      assert.equal(unknown.status, 'STARTED');

      await database.end();
      database = pool();
      store = new PostgresUsageStore(database, limits);
      const restoredPending = await store.prepare(unknownInvocation);
      assert.equal(restoredPending.status, 'PENDING');
      assert.equal(restoredPending.invocationId, unknown.invocationId);
      const claims = await Promise.all(
        Array.from({ length: 20 }, () =>
          store.claimReconciliation(
            principal,
            invocationTaskId,
            unknown.invocationId,
            unknownInvocation.routeFingerprint
          )
        )
      );
      assert.equal(claims.filter(Boolean).length, 1);
      const claim = claims.find((value) => value !== null);
      assert(claim);
      assert.equal(
        await store.claimReconciliation(
          { ...principal, tenantId: `other-${suffix}` },
          invocationTaskId,
          unknown.invocationId,
          unknownInvocation.routeFingerprint
        ),
        null
      );
      await assert.rejects(
        store.reject({ ...principal, tenantId: `other-${suffix}` }, invocationTaskId, unknown.invocationId),
        /not found/
      );
      await assert.rejects(
        store.rejectReconciliation(principal, invocationTaskId, unknown.invocationId, 'stale-lease'),
        /lease changed/
      );
      assert.equal(
        await store.renewReconciliation(principal, invocationTaskId, unknown.invocationId, claim.leaseToken),
        true
      );
      assert.equal(
        await store.renewReconciliation(principal, invocationTaskId, unknown.invocationId, 'stale-lease'),
        false
      );
      await store.rejectReconciliation(principal, invocationTaskId, unknown.invocationId, claim.leaseToken);

      const legacyTaskId = `legacy-invocation-${suffix}`;
      const legacyInvocation = {
        ...invocation,
        taskId: legacyTaskId,
        requestDigest: 'L'.repeat(43),
      };
      const legacy = await store.prepare(legacyInvocation);
      await database.query(
        `
        UPDATE e_mate_model_invocation
           SET route_fingerprint = NULL
         WHERE invocation_id = $1
      `,
        [legacy.invocationId]
      );
      assert.equal(
        await store.claimReconciliation(
          principal,
          legacyTaskId,
          legacy.invocationId,
          legacyInvocation.routeFingerprint
        ),
        null
      );
      await store.reject(principal, legacyTaskId, legacy.invocationId);
      assert.equal((await store.finalize(principal, invocationTaskId))?.outputTokens, 2);
      const restored = await store.finalize(principal, taskId);
      assert.equal(restored?.usageId, first.usageId);
      assert.equal(restored?.occurredAt, first.occurredAt);
    } finally {
      await database
        .query('DELETE FROM e_mate_model_usage_task WHERE tenant_id = $1', [tenantId])
        .catch(() => undefined);
      await database
        .query('DELETE FROM e_mate_model_quota_state WHERE tenant_id = $1', [tenantId])
        .catch(() => undefined);
      await database
        .query('DELETE FROM e_mate_tenant_user WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId])
        .catch(() => undefined);
      await database.end().catch(() => undefined);
    }
  }
);

test(
  'real PostgreSQL applies committed administrator user, quota, and route-key changes to the next gateway request',
  { skip: databaseUrl ? false : 'E_MATE_TEST_POSTGRES_URL is not set' },
  async () => {
    const suffix = randomUUID();
    const tenantId = `admin-live-${suffix}`;
    const userId = `user-${suffix}`;
    const routeId = 'gpt-5.6-sol';
    const routeKeyEncryptionKey = Buffer.alloc(32, 19);
    const oldProviderKey = 'tenant-provider-key-before-admin-rotation';
    const newProviderKey = 'tenant-provider-key-after-admin-rotation';
    const admin: RuntimeRegistryPrincipal = {
      tenantId,
      userId: `admin-${suffix}`,
      roles: ['TENANT_ADMIN'],
    };
    const adminStore = await openPostgresAdminManagementStore(
      databaseUrl as string,
      [{ routeId, label: 'Sol', provider: 'Enterprise gateway' }],
      routeKeyEncryptionKey
    );
    const gatewayDatabase = pool();
    const gatewayPolicy = new PostgresTenantModelRoutePolicy(gatewayDatabase, routeKeyEncryptionKey);
    const usageStore = new PostgresUsageStore(gatewayDatabase, limits);
    const principal: ModelGatewayPrincipal = { tenantId, userId, modelIds: [routeId] };
    const completedTaskId = `completed-${suffix}`;
    const invocation = (taskId: string): InvocationFact => ({
      tenantId,
      userId,
      taskId,
      traceId: `trace-${taskId}`,
      modelId: routeId,
      providerId: 'custom-gpt',
      requestDigest: 'D'.repeat(43),
      routeFingerprint: 'R'.repeat(43),
    });
    try {
      await usageStore.initialize();
      const created = await adminStore.store.createUser(admin, {
        schemaVersion: 1,
        userId,
        displayName: 'User',
        roles: ['MEMBER'],
        tokenLimit: 10,
        allowedModelIds: [routeId],
        initialPassword: 'InitialPass-2026!',
      });
      await adminStore.store.updateModelRouteKey(admin, routeId, {
        schemaVersion: 1,
        apiKey: oldProviderKey,
      });

      assert.equal(await gatewayPolicy.isUserActive(tenantId, userId), true);
      assert.equal(await gatewayPolicy.upstreamApiKey(tenantId, routeId), oldProviderKey);

      await usageStore.add({
        tenantId,
        userId,
        taskId: completedTaskId,
        traceId: `trace-${completedTaskId}`,
        modelId: routeId,
        providerId: 'custom-gpt',
        providerResponseId: `response-${suffix}`,
        inputTokens: 4,
        outputTokens: 6,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      });
      await usageStore.finalize(principal, completedTaskId);
      await assert.rejects(usageStore.prepare(invocation(`blocked-${suffix}`)), (error: unknown) => {
        assert(error instanceof InvocationAdmissionError);
        assert.equal(error.code, 'USER_TOKEN_LIMIT_REACHED');
        return true;
      });

      const raised = await adminStore.store.updateUser(admin, userId, {
        schemaVersion: 1,
        displayName: 'User',
        roles: ['MEMBER'],
        status: 'ACTIVE',
        tokenLimit: 11,
        allowedModelIds: [routeId],
        expectedUpdatedAt: created.updatedAt,
      });
      assert(raised);
      const admitted = await usageStore.prepare(invocation(`allowed-${suffix}`));
      assert.equal(admitted.status, 'STARTED');
      await usageStore.reject(principal, `allowed-${suffix}`, admitted.invocationId);

      await adminStore.store.updateModelRouteKey(admin, routeId, {
        schemaVersion: 1,
        apiKey: newProviderKey,
      });
      assert.equal(await gatewayPolicy.upstreamApiKey(tenantId, routeId), newProviderKey);

      await adminStore.store.updateUser(admin, userId, {
        schemaVersion: 1,
        displayName: 'User',
        roles: ['MEMBER'],
        status: 'SUSPENDED',
        tokenLimit: 11,
        allowedModelIds: [routeId],
        expectedUpdatedAt: raised.updatedAt,
      });
      assert.equal(await gatewayPolicy.isUserActive(tenantId, userId), false);
    } finally {
      await adminStore.close();
      await gatewayDatabase
        .query('DELETE FROM e_mate_admin_audit WHERE tenant_id = $1', [tenantId])
        .catch(() => undefined);
      await gatewayDatabase
        .query('DELETE FROM e_mate_model_invocation WHERE tenant_id = $1', [tenantId])
        .catch(() => undefined);
      await gatewayDatabase
        .query('DELETE FROM e_mate_model_usage_task WHERE tenant_id = $1', [tenantId])
        .catch(() => undefined);
      await gatewayDatabase
        .query('DELETE FROM e_mate_model_quota_state WHERE tenant_id = $1', [tenantId])
        .catch(() => undefined);
      await gatewayDatabase
        .query('DELETE FROM e_mate_tenant_model_route WHERE tenant_id = $1', [tenantId])
        .catch(() => undefined);
      await gatewayDatabase
        .query('DELETE FROM e_mate_auth_session WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId])
        .catch(() => undefined);
      await gatewayDatabase
        .query('DELETE FROM e_mate_admin_api_key WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId])
        .catch(() => undefined);
      await gatewayDatabase
        .query('DELETE FROM e_mate_auth_password_credential WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId])
        .catch(() => undefined);
      await gatewayDatabase
        .query('DELETE FROM e_mate_tenant_user WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId])
        .catch(() => undefined);
      await gatewayDatabase.end().catch(() => undefined);
    }
  }
);

test(
  'real PostgreSQL atomically enforces tenant invocation concurrency',
  { skip: databaseUrl ? false : 'E_MATE_TEST_POSTGRES_URL is not set' },
  async () => {
    const suffix = randomUUID();
    const tenantId = `quota-${suffix}`;
    const otherTenantId = `quota-other-${suffix}`;
    const database = pool();
    const store = new PostgresUsageStore(database, {
      tenantRequestsPerMinute: 100,
      tenantBurst: 100,
      tenantMaxConcurrent: 2,
      invocationLeaseMs: 180_000,
    });
    await store.initialize();
    await createActiveTestUsers(database, [
      { tenantId, userId: `user-${suffix}` },
      { tenantId: otherTenantId, userId: `user-${suffix}` },
    ]);
    const invocation = (tenant: string, index: number): InvocationFact => ({
      tenantId: tenant,
      userId: `user-${suffix}`,
      taskId: `quota-task-${index}-${suffix}`,
      traceId: `quota-trace-${index}-${suffix}`,
      modelId: 'gpt-5.6-sol',
      providerId: 'custom-gpt',
      requestDigest: Buffer.from(`quota-${index}`).toString('base64url').padEnd(43, 'Q'),
      routeFingerprint: 'R'.repeat(43),
    });
    try {
      const admitted = await Promise.allSettled(
        Array.from({ length: 10 }, (_, index) => store.prepare(invocation(tenantId, index)))
      );
      const started = admitted.flatMap((result) =>
        result.status === 'fulfilled' && result.value.status === 'STARTED' ? [result.value] : []
      );
      assert.equal(started.length, 2);
      assert.equal(
        admitted.filter(
          (result) => result.status === 'rejected' && String(result.reason).includes('Too many model requests')
        ).length,
        8
      );
      assert.equal((await store.prepare(invocation(otherTenantId, 99))).status, 'STARTED');
    } finally {
      await database
        .query('DELETE FROM e_mate_model_usage_task WHERE tenant_id = ANY($1)', [[tenantId, otherTenantId]])
        .catch(() => undefined);
      await database
        .query('DELETE FROM e_mate_model_quota_state WHERE tenant_id = ANY($1)', [[tenantId, otherTenantId]])
        .catch(() => undefined);
      await database
        .query('DELETE FROM e_mate_tenant_user WHERE tenant_id = ANY($1) AND user_id = $2', [
          [tenantId, otherTenantId],
          `user-${suffix}`,
        ])
        .catch(() => undefined);
      await database.end().catch(() => undefined);
    }
  }
);

test(
  'real PostgreSQL applies a raised user token limit to the next invocation',
  { skip: databaseUrl ? false : 'E_MATE_TEST_POSTGRES_URL is not set' },
  async () => {
    const suffix = randomUUID();
    const tenantId = `token-limit-${suffix}`;
    const userId = `user-${suffix}`;
    const database = pool();
    const store = new PostgresUsageStore(database, limits);
    await store.initialize();
    await createActiveTestUsers(database, [{ tenantId, userId }]);
    const principal: ModelGatewayPrincipal = {
      tenantId,
      userId,
      modelIds: ['gpt-5.6-sol'],
    };
    const completedTaskId = `completed-${suffix}`;
    const invocation = (taskId: string): InvocationFact => ({
      tenantId,
      userId,
      taskId,
      traceId: `trace-${taskId}`,
      modelId: 'gpt-5.6-sol',
      providerId: 'custom-gpt',
      requestDigest: 'D'.repeat(43),
      routeFingerprint: 'R'.repeat(43),
    });
    try {
      await store.add({
        tenantId,
        userId,
        taskId: completedTaskId,
        traceId: `trace-${completedTaskId}`,
        modelId: 'gpt-5.6-sol',
        providerId: 'custom-gpt',
        providerResponseId: `response-${suffix}`,
        inputTokens: 4,
        outputTokens: 6,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
      });
      await store.finalize(principal, completedTaskId);
      await database.query(
        'UPDATE e_mate_tenant_user SET token_limit = 10, updated_at = now() WHERE tenant_id = $1 AND user_id = $2',
        [tenantId, userId]
      );
      await assert.rejects(store.prepare(invocation(`blocked-${suffix}`)), (error: unknown) => {
        assert(error instanceof InvocationAdmissionError);
        assert.equal(error.code, 'USER_TOKEN_LIMIT_REACHED');
        return true;
      });

      await database.query(
        'UPDATE e_mate_tenant_user SET token_limit = 11, updated_at = now() WHERE tenant_id = $1 AND user_id = $2',
        [tenantId, userId]
      );
      assert.equal((await store.prepare(invocation(`allowed-${suffix}`))).status, 'STARTED');
    } finally {
      await database
        .query('DELETE FROM e_mate_model_usage_task WHERE tenant_id = $1', [tenantId])
        .catch(() => undefined);
      await database
        .query('DELETE FROM e_mate_model_quota_state WHERE tenant_id = $1', [tenantId])
        .catch(() => undefined);
      await database
        .query('DELETE FROM e_mate_tenant_user WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId])
        .catch(() => undefined);
      await database.end().catch(() => undefined);
    }
  }
);
