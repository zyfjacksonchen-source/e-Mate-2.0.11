import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { RuntimeRegistryHeartbeat } from '@e-mate/runtime-registry-contract';
import { type ObservabilityPolicy } from '@e-mate/observability-policy-contract';
import { InMemoryConsentStore } from '@e-mate/consent-store';
import { parseSessionSummary, type SessionSummary, type SessionSummaryWrite } from '@e-mate/session-index-contract';
import { InMemoryObservabilityPolicyStore } from '../src/observability-policy.ts';
import { InMemoryAdminManagementStore } from '../src/admin-management.ts';
import {
  RedisRuntimeRegistry,
  type RedisRegistryAdapter,
  type RuntimeRegistryPrincipal,
} from '../src/runtime-registry.ts';
import type { SessionIndexSearch, SessionIndexWriteResult, SessionSummaryStore } from '../src/session-index.ts';
import { createAnalyticsServer } from '../src/server.ts';

type FakeEntry = {
  value: string;
  expiresAt: number;
};

class FakeRedisAdapter implements RedisRegistryAdapter {
  readonly entries = new Map<string, FakeEntry>();
  fail = false;
  now = Date.parse('2026-07-26T08:00:00.000Z');

  async eval(script: string, keys: string[], arguments_: string[]): Promise<unknown> {
    if (this.fail) throw new Error('redis://secret@internal:6379');
    const key = keys[0] as string;
    this.expire();
    if (script.includes("redis.call('SET'")) {
      const existing = this.entries.get(key);
      if (existing) {
        const stored = JSON.parse(existing.value) as {
          sequence: number;
          userId: string;
        };
        if (stored.userId !== arguments_[3]) return -1;
        if (Number(arguments_[0]) <= stored.sequence) return 0;
      }
      this.entries.set(key, {
        value: arguments_[1] as string,
        expiresAt: this.now + Number(arguments_[2]),
      });
      return 1;
    }
    const existing = this.entries.get(key);
    if (!existing) return 1;
    if ((JSON.parse(existing.value) as { userId: string }).userId !== arguments_[0]) {
      return 0;
    }
    this.entries.delete(key);
    return 1;
  }

  async scan(match: string, limit: number): Promise<string[]> {
    if (this.fail) throw new Error('redis password leaked');
    this.expire();
    const prefix = match.slice(0, -1);
    return [...this.entries.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit + 1);
  }

  async mGet(keys: string[]): Promise<Array<string | null>> {
    if (this.fail) throw new Error('redis unavailable');
    this.expire();
    return keys.map((key) => this.entries.get(key)?.value ?? null);
  }

  private expire(): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= this.now) this.entries.delete(key);
    }
  }
}

const principal = (userId: string, tenantId = 'tenant-1', roles: string[] = []): RuntimeRegistryPrincipal => ({
  tenantId,
  userId,
  roles,
});

const heartbeat = (
  runtimeInstanceId: string,
  sequence: number,
  overrides: Partial<RuntimeRegistryHeartbeat> = {}
): RuntimeRegistryHeartbeat => ({
  schemaVersion: 1,
  runtimeInstanceId,
  sequence,
  activeSessionIds: ['session-1'],
  runningTaskIds: ['task-running'],
  failedTaskIds: ['task-failed'],
  modelStatus: 'HEALTHY',
  observedAt: '2026-07-26T08:00:00.000Z',
  ...overrides,
});

const consentPolicy = {
  schemaVersion: 1,
  agreementId: 'e-mate-platform-terms',
  agreementVersion: '1.0.0',
  disclaimerVersion: '1.0.0',
  contentHash: 'a'.repeat(64),
} as const;

const consentInput = {
  ...consentPolicy,
  termsAccepted: true,
  policyRead: true,
  lawfulUseConfirmed: true,
  clientVersion: '2.1.45',
  locale: 'zh-CN',
} as const;

class FakeSessionIndex implements SessionSummaryStore {
  readonly entries = new Map<string, SessionSummary>();

  async write(
    identity: RuntimeRegistryPrincipal,
    sessionId: string,
    value: SessionSummaryWrite
  ): Promise<SessionIndexWriteResult> {
    if (value.projectId && !(identity.projectIds ?? []).includes(value.projectId)) {
      return { status: 'DENIED' };
    }
    const key = `${identity.tenantId}\0${sessionId}`;
    const current = this.entries.get(key);
    if (
      (!current && value.expectedSourceCursor !== null) ||
      (current && (current.ownerId !== identity.userId || current.sourceCursor !== value.expectedSourceCursor))
    ) {
      return { status: 'CONFLICT' };
    }
    const summary = parseSessionSummary({
      schemaVersion: 1,
      sessionId,
      ownerId: identity.userId,
      title: value.title,
      summary: value.summary,
      ...(value.projectId ? { projectId: value.projectId } : {}),
      tags: value.tags,
      state: value.state,
      updatedAt: value.updatedAt,
      sourceCursor: (current?.sourceCursor ?? 0) + 1,
    });
    this.entries.set(key, summary);
    return { status: 'OK', summary };
  }

  async get(identity: RuntimeRegistryPrincipal, sessionId: string): Promise<SessionSummary | null> {
    const summary = this.entries.get(`${identity.tenantId}\0${sessionId}`);
    return summary &&
      summary.state !== 'DELETED' &&
      (summary.ownerId === identity.userId ||
        Boolean(summary.projectId && (identity.projectIds ?? []).includes(summary.projectId)))
      ? summary
      : null;
  }

  async search(identity: RuntimeRegistryPrincipal, input: SessionIndexSearch): Promise<SessionSummary[]> {
    const query = input.query.toLocaleLowerCase();
    return [...this.entries.values()]
      .filter(
        (summary) =>
          summary.state !== 'DELETED' &&
          (input.includeArchived || summary.state === 'ACTIVE') &&
          summary.ownerId === identity.userId &&
          (!input.projectId || summary.projectId === input.projectId) &&
          [summary.title, summary.summary, ...summary.tags].some((value) => value.toLocaleLowerCase().includes(query))
      )
      .slice(0, input.limit);
  }
}

test('Redis leases replace by instance, reject stale/takeover, deduplicate and expire', async () => {
  const redis = new FakeRedisAdapter();
  const registry = new RedisRuntimeRegistry(redis, {
    ttlMs: 30_000,
    now: () => redis.now,
  });
  assert.equal(await registry.heartbeat(principal('user-1'), heartbeat('instance-1', 2)), true);
  assert.equal(await registry.heartbeat(principal('user-1'), heartbeat('instance-1', 1)), false);
  assert.equal(await registry.heartbeat(principal('user-1'), heartbeat('instance-1', 2)), false);
  assert.equal(await registry.heartbeat(principal('user-2'), heartbeat('instance-1', 3)), false);
  assert.equal(
    await registry.heartbeat(principal('user-1'), heartbeat('instance-2', 1, { modelStatus: 'DEGRADED' })),
    true
  );
  assert.equal(
    await registry.heartbeat(
      principal('user-2'),
      heartbeat('instance-3', 1, {
        activeSessionIds: ['session-2'],
        runningTaskIds: ['task-running'],
        failedTaskIds: [],
      })
    ),
    true
  );
  await registry.heartbeat(principal('user-other', 'tenant-2'), heartbeat('instance-other', 1));

  assert.deepEqual(await registry.status('tenant-1'), {
    schemaVersion: 1,
    activeUsers: 2,
    activeSessions: 2,
    runningTasks: 1,
    failedTasks: 1,
    modelStatus: 'DEGRADED',
    updatedAt: '2026-07-26T08:00:00.000Z',
  });
  assert.equal((await registry.status('tenant-2')).activeUsers, 1);
  assert.equal(await registry.remove(principal('user-2'), 'instance-2'), false);
  assert.equal(await registry.remove(principal('user-1'), 'instance-2'), true);

  redis.now += 30_001;
  assert.deepEqual(await registry.status('tenant-1'), {
    schemaVersion: 1,
    activeUsers: 0,
    activeSessions: 0,
    runningTasks: 0,
    failedTasks: 0,
    modelStatus: 'UNAVAILABLE',
    updatedAt: '2026-07-26T08:00:30.001Z',
  });
});

async function withServer<T>(
  run: (
    baseUrl: string,
    redis: FakeRedisAdapter,
    sessionIndex: FakeSessionIndex,
    observabilityPolicy: InMemoryObservabilityPolicyStore
  ) => Promise<T>
): Promise<T> {
  const redis = new FakeRedisAdapter();
  const registry = new RedisRuntimeRegistry(redis, {
    ttlMs: 30_000,
    now: () => redis.now,
  });
  const users: Record<string, RuntimeRegistryPrincipal> = {
    employee: principal('user-1'),
    other: principal('user-2'),
    admin: {
      ...principal('admin-1', 'tenant-1', ['TENANT_ADMIN']),
      projectIds: ['project-1'],
    },
    auditor: principal('auditor-1', 'tenant-1', ['AUDIT_ADMIN']),
    tenant2: principal('admin-2', 'tenant-2', ['AUDIT_ADMIN']),
    tenant2admin: principal('admin-2', 'tenant-2', ['TENANT_ADMIN']),
    superadmin: principal('root-1', 'platform', ['SUPER_ADMIN']),
  };
  const sessionIndex = new FakeSessionIndex();
  const observabilityPolicy = new InMemoryObservabilityPolicyStore({
    now: () => redis.now,
  });
  const adminManagement = new InMemoryAdminManagementStore(
    [{ routeId: 'gpt-5.6-sol', label: 'Sol', provider: 'Enterprise gateway' }],
    () => redis.now
  );
  const consentStore = new InMemoryConsentStore(consentPolicy, () => redis.now);
  await consentStore.accept({ tenantId: 'tenant-1', userId: 'user-1' }, consentInput);
  await consentStore.accept({ tenantId: 'tenant-2', userId: 'user-2' }, consentInput);
  const server = createAnalyticsServer({
    registry,
    sessionIndex,
    observabilityPolicy,
    platformMonitoring: {
      read: async (period) => ({
        schemaVersion: 1,
        scope: 'PLATFORM',
        period,
        state: 'NO_DATA',
        from: '2026-07-25T08:00:00.000Z',
        to: '2026-07-26T08:00:00.000Z',
        generatedAt: '2026-07-26T08:00:01.000Z',
        sourceUpdatedAt: null,
        summary: {
          averageTaskDurationMs: null,
          toolFailureRate: null,
          agentErrors: null,
          agentTimeouts: null,
          toolFailures: null,
        },
        trend: [],
        missing: [
          'TASK_DURATION',
          'TOOL_FAILURE_RATE',
          'AGENT_ERROR',
          'AGENT_TIMEOUT',
          'TASK_TREND_SUCCESS',
          'TASK_TREND_FAILURE',
        ],
      }),
    },
    usageAnalytics: {
      read: async (identity, query) => {
        const metrics = {
          totalRequests: '2',
          accountedRequests: '1',
          rejectedRequests: '1',
          pendingRequests: '0',
          usageEvents: '1',
          inputTokens: '7',
          outputTokens: '3',
          cacheReadTokens: '2',
          cacheWriteTokens: '1',
          totalTokens: '13',
          costUsd: '0.100000000001',
          zeroCostUsageEvents: '0',
          unpricedUsageEvents: '0',
        };
        const checkedAt = '2026-07-27T00:00:01.000Z';
        return {
          projection: {
            schemaVersion: 1,
            scope: 'TENANT',
            tenantId: identity.tenantId,
            from: query.from,
            to: query.to,
            timezone: query.timezone,
            bucket: query.bucket,
            generatedAt: checkedAt,
            taskCount: '1',
            summary: metrics,
            groups: [
              {
                bucketStart: '2026-07-25T16:00:00.000Z',
                userId: query.userIds?.[0] ?? 'user-1',
                modelId: query.modelId ?? 'gpt-5.6-sol',
                metrics,
              },
            ],
          },
          reconciliation: {
            schemaVersion: 1,
            scope: 'TENANT',
            tenantId: identity.tenantId,
            from: query.from,
            to: query.to,
            checkedAt,
            state: 'MATCHED',
            checks: {
              requestStatuses: '0',
              usageTaskTotals: '0',
              completedInvocationUsage: '0',
              usageInvocationLinks: '0',
            },
          },
        };
      },
      events: async (identity, query) => ({
        schemaVersion: 1,
        scope: 'TENANT',
        tenantId: identity.tenantId,
        from: query.from,
        to: query.to,
        events: [
          {
            kind: 'USAGE',
            eventId: 'response-1',
            occurredAt: '2026-07-25T16:00:00.000Z',
            userId: query.userIds?.[0] ?? 'user-1',
            taskId: 'task-1',
            traceId: 'trace-1',
            modelId: query.modelId ?? 'gpt-5.6-sol',
            providerId: 'openai',
            scenario: query.scenario ?? null,
            inputTokens: '7',
            outputTokens: '3',
            cacheReadTokens: '2',
            cacheWriteTokens: '1',
            totalTokens: '13',
            costUsd: '0.100000000001',
          },
        ],
        nextCursor: null,
      }),
    },
    adminManagement,
    consentStore,
    authenticate: async (token) => users[token] ?? null,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`, redis, sessionIndex, observabilityPolicy);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('consent audit listing is read-only, filterable and tenant scoped', async () => {
  await withServer(async (baseUrl) => {
    const filtered = await fetch(`${baseUrl}/v1/admin/consents?userId=user-1&agreementVersion=1.0.0&limit=20`, {
      headers: auth('auditor', false),
    });
    assert.equal(filtered.status, 200);
    const body = (await filtered.json()) as { acceptances: Array<{ userId: string }> };
    assert.deepEqual(
      body.acceptances.map(({ userId }) => userId),
      ['user-1']
    );

    const otherTenant = await fetch(`${baseUrl}/v1/admin/consents`, { headers: auth('tenant2', false) });
    assert.equal(otherTenant.status, 200);
    assert.deepEqual(
      ((await otherTenant.json()) as { acceptances: Array<{ userId: string }> }).acceptances.map(
        ({ userId }) => userId
      ),
      ['user-2']
    );
    assert.equal((await fetch(`${baseUrl}/v1/admin/consents`, { headers: auth('employee', false) })).status, 403);
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/consents?limit=201`, {
          headers: auth('admin', false),
        })
      ).status,
      400
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/consents`, {
          method: 'POST',
          headers: auth('admin'),
          body: '{}',
        })
      ).status,
      405
    );
  });
});

function auth(token: string, json = true): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

test('HTTP API binds identity to bearer principal and enforces roles and methods', async () => {
  await withServer(async (baseUrl) => {
    const accepted = await fetch(`${baseUrl}/v1/runtime-registry/heartbeats`, {
      method: 'POST',
      headers: auth('employee'),
      body: JSON.stringify(heartbeat('instance-http', 1)),
    });
    assert.equal(accepted.status, 204);

    const forbidden = await fetch(`${baseUrl}/runtime/status`, {
      headers: auth('employee', false),
    });
    assert.equal(forbidden.status, 403);
    const status = await fetch(`${baseUrl}/runtime/status`, {
      headers: auth('admin', false),
    });
    assert.equal(status.status, 200);
    assert.equal(((await status.json()) as { activeUsers: number }).activeUsers, 1);
    const otherTenant = await fetch(`${baseUrl}/runtime/status`, {
      headers: auth('tenant2', false),
    });
    assert.equal(((await otherTenant.json()) as { activeUsers: number }).activeUsers, 0);

    const wrongOwner = await fetch(`${baseUrl}/v1/runtime-registry/instances/instance-http`, {
      method: 'DELETE',
      headers: auth('other', false),
    });
    assert.equal(wrongOwner.status, 404);
    const removed = await fetch(`${baseUrl}/v1/runtime-registry/instances/instance-http`, {
      method: 'DELETE',
      headers: auth('employee', false),
    });
    assert.equal(removed.status, 204);

    const wrongMethod = await fetch(`${baseUrl}/runtime/status`, {
      method: 'POST',
      headers: auth('admin', false),
    });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');
    assert.equal((await fetch(`${baseUrl}/missing`)).status, 404);
  });
});

test('admin APIs derive tenant scope and keep administrator and model credentials separated', async () => {
  await withServer(async (baseUrl) => {
    const injected = await fetch(`${baseUrl}/v1/admin/users`, {
      method: 'POST',
      headers: auth('admin'),
      body: JSON.stringify({
        schemaVersion: 1,
        tenantId: 'tenant-2',
        userId: 'user-a',
        displayName: 'User A',
        roles: ['MEMBER'],
        tokenLimit: 25_000,
        allowedModelIds: ['gpt-5.6-sol'],
        initialPassword: 'InitialPass-2026!',
      }),
    });
    assert.equal(injected.status, 400);

    const created = await fetch(`${baseUrl}/v1/admin/users`, {
      method: 'POST',
      headers: auth('admin'),
      body: JSON.stringify({
        schemaVersion: 1,
        userId: 'user-a',
        displayName: 'User A',
        roles: ['MEMBER'],
        tokenLimit: 25_000,
        allowedModelIds: ['gpt-5.6-sol'],
        initialPassword: 'InitialPass-2026!',
      }),
    });
    assert.equal(created.status, 201);
    const createdUser = (await created.json()) as { updatedAt: string };
    assert.equal(JSON.stringify(createdUser).includes('InitialPass-2026!'), false);
    const resetPassword = await fetch(`${baseUrl}/v1/admin/users/user-a/password`, {
      method: 'PUT',
      headers: auth('admin'),
      body: JSON.stringify({ schemaVersion: 1, password: 'Replacement-2026!' }),
    });
    assert.equal(resetPassword.status, 204);
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/users/user-a/password`, {
          method: 'PUT',
          headers: auth('employee'),
          body: JSON.stringify({ schemaVersion: 1, password: 'Replacement-2026!' }),
        })
      ).status,
      403
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/users/user-a/password`, {
          method: 'PUT',
          headers: auth('admin'),
          body: JSON.stringify({ schemaVersion: 1, password: 'short' }),
        })
      ).status,
      400
    );
    const quotaUpdated = await fetch(`${baseUrl}/v1/admin/users/user-a`, {
      method: 'PUT',
      headers: auth('admin'),
      body: JSON.stringify({
        schemaVersion: 1,
        displayName: 'User A',
        roles: ['MEMBER'],
        status: 'ACTIVE',
        tokenLimit: 50_000,
        allowedModelIds: ['gpt-5.6-sol'],
        expectedUpdatedAt: createdUser.updatedAt,
      }),
    });
    assert.equal(quotaUpdated.status, 200);
    const quotaUpdatedUser = (await quotaUpdated.json()) as { tokenLimit: number; updatedAt: string };
    assert.equal(quotaUpdatedUser.tokenLimit, 50_000);
    const staleUpdate = await fetch(`${baseUrl}/v1/admin/users/user-a`, {
      method: 'PUT',
      headers: auth('admin'),
      body: JSON.stringify({
        schemaVersion: 1,
        displayName: 'Stale User A',
        roles: ['MEMBER'],
        status: 'SUSPENDED',
        tokenLimit: 1,
        allowedModelIds: ['gpt-5.6-sol'],
        expectedUpdatedAt: createdUser.updatedAt,
      }),
    });
    assert.equal(staleUpdate.status, 409);
    assert.equal(((await staleUpdate.json()) as { error: { code: string } }).error.code, 'ADMIN_USER_STALE');
    assert.equal(
      (
        (await (await fetch(`${baseUrl}/v1/admin/users`, { headers: auth('admin', false) })).json()) as {
          users: unknown[];
        }
      ).users.length,
      1
    );
    assert.equal(
      (
        (await (await fetch(`${baseUrl}/v1/admin/users`, { headers: auth('tenant2admin', false) })).json()) as {
          users: unknown[];
        }
      ).users.length,
      0
    );
    assert.equal((await fetch(`${baseUrl}/v1/admin/users`, { headers: auth('employee', false) })).status, 403);

    const issuedResponse = await fetch(`${baseUrl}/v1/admin/api-keys`, {
      method: 'POST',
      headers: auth('admin'),
      body: JSON.stringify({
        schemaVersion: 1,
        label: 'Desktop',
        principalType: 'USER',
        principalId: 'user-a',
        userId: 'user-a',
        scopes: ['models:invoke'],
      }),
    });
    assert.equal(issuedResponse.status, 201);
    const issued = (await issuedResponse.json()) as { secret: string };
    assert.equal((await fetch(`${baseUrl}/v1/admin/users`, { headers: auth(issued.secret, false) })).status, 401);
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/api-keys`, {
          method: 'POST',
          headers: auth('admin'),
          body: JSON.stringify({
            schemaVersion: 1,
            label: 'Retired task writer',
            principalType: 'USER',
            principalId: 'user-a',
            userId: 'user-a',
            scopes: ['task-events:write'],
          }),
        })
      ).status,
      400
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/tasks/events`, {
          method: 'POST',
          headers: auth(issued.secret),
          body: JSON.stringify({}),
        })
      ).status,
      404
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/runtime-registry/heartbeats`, {
          method: 'POST',
          headers: auth(issued.secret),
          body: JSON.stringify(heartbeat('model-token-instance', 1)),
        })
      ).status,
      401
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/tasks/events`, {
          method: 'POST',
          headers: auth('admin'),
          body: JSON.stringify({}),
        })
      ).status,
      404
    );

    const modelApiKey = 'tenant-provider-key-that-is-long-enough';
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/model-routes/gpt-5.6-sol/key`, {
          method: 'PUT',
          headers: auth('auditor'),
          body: JSON.stringify({ schemaVersion: 1, apiKey: modelApiKey }),
        })
      ).status,
      403
    );
    const keyUpdated = await fetch(`${baseUrl}/v1/admin/model-routes/gpt-5.6-sol/key`, {
      method: 'PUT',
      headers: auth('admin'),
      body: JSON.stringify({ schemaVersion: 1, apiKey: modelApiKey }),
    });
    assert.equal(keyUpdated.status, 200);
    const keyUpdatedBody = await keyUpdated.text();
    assert.equal(keyUpdatedBody.includes(modelApiKey), false);
    assert.equal((JSON.parse(keyUpdatedBody) as { keyConfigured: boolean }).keyConfigured, true);
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/model-routes/gpt-5.6-sol/key`, {
          method: 'PUT',
          headers: auth('admin'),
          body: JSON.stringify({ schemaVersion: 1, apiKey: modelApiKey, tenantId: 'tenant-2' }),
        })
      ).status,
      400
    );
    const removedRoute = await fetch(`${baseUrl}/v1/admin/model-routes/gpt-5.6-sol/publication`, {
      method: 'PUT',
      headers: auth('admin'),
      body: JSON.stringify({ schemaVersion: 1, published: false }),
    });
    assert.equal(removedRoute.status, 200);
    const removedRouteBody = (await removedRoute.json()) as { published: boolean; enabled: boolean };
    assert.equal(removedRouteBody.published, false);
    assert.equal(removedRouteBody.enabled, false);
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/model-routes/not-deployed/publication`, {
          method: 'PUT',
          headers: auth('admin'),
          body: JSON.stringify({ schemaVersion: 1, published: true }),
        })
      ).status,
      404
    );
    const staleDelete = await fetch(`${baseUrl}/v1/admin/users/user-a`, {
      method: 'DELETE',
      headers: auth('admin'),
      body: JSON.stringify({ schemaVersion: 1, expectedUpdatedAt: createdUser.updatedAt }),
    });
    assert.equal(staleDelete.status, 409);
    assert.equal(((await staleDelete.json()) as { error: { code: string } }).error.code, 'ADMIN_USER_STALE');
    const deletionBody = JSON.stringify({
      schemaVersion: 1,
      expectedUpdatedAt: quotaUpdatedUser.updatedAt,
    });
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/users/user-a`, {
          method: 'DELETE',
          headers: auth('tenant2admin'),
          body: deletionBody,
        })
      ).status,
      404
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/users/user-a`, {
          method: 'DELETE',
          headers: auth('admin'),
          body: deletionBody,
        })
      ).status,
      204
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/users/user-a`, {
          method: 'DELETE',
          headers: auth('admin'),
          body: deletionBody,
        })
      ).status,
      204
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/admin/users/user-a`, {
          method: 'PUT',
          headers: auth('admin'),
          body: JSON.stringify({
            schemaVersion: 1,
            displayName: 'User A',
            roles: ['MEMBER'],
            status: 'ACTIVE',
            tokenLimit: 50_000,
            allowedModelIds: ['gpt-5.6-sol'],
            expectedUpdatedAt: quotaUpdatedUser.updatedAt,
          }),
        })
      ).status,
      404
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/tasks/events`, {
          method: 'POST',
          headers: auth(issued.secret),
          body: JSON.stringify({}),
        })
      ).status,
      404
    );
  });
});

test('platform monitoring accepts only a fixed period from SUPER_ADMIN', async () => {
  await withServer(async (baseUrl) => {
    assert.equal(
      (await fetch(`${baseUrl}/v1/operations/observability?period=TODAY`, { headers: auth('admin', false) })).status,
      403
    );
    const response = await fetch(`${baseUrl}/v1/operations/observability?period=TODAY`, {
      headers: auth('superadmin', false),
    });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { scope: string }).scope, 'PLATFORM');
    for (const query of ['', '?period=TODAY&tenantId=tenant-1', '?period=TODAY&period=WEEK', '?query=up']) {
      assert.equal(
        (await fetch(`${baseUrl}/v1/operations/observability${query}`, { headers: auth('superadmin', false) })).status,
        400
      );
    }
  });
});

test('usage metrics are tenant-bound, exact and independently reconcilable', async () => {
  await withServer(async (baseUrl) => {
    const query =
      'from=2026-07-25T00%3A00%3A00.000Z&to=2026-07-27T00%3A00%3A00.000Z&timezone=Asia%2FShanghai&bucket=DAY';
    assert.equal(
      (await fetch(`${baseUrl}/v1/usage/summary?${query}`, { headers: auth('employee', false) })).status,
      403
    );
    const summary = await fetch(`${baseUrl}/v1/usage/summary?${query}&scenario=CONTENT_CREATION`, {
      headers: auth('auditor', false),
    });
    assert.equal(summary.status, 200);
    const body = (await summary.json()) as {
      tenantId: string;
      taskCount: string;
      summary: { totalTokens: string; costUsd: string };
    };
    assert.equal(body.tenantId, 'tenant-1');
    assert.equal(body.taskCount, '1');
    assert.deepEqual(body.summary, {
      totalRequests: '2',
      accountedRequests: '1',
      rejectedRequests: '1',
      pendingRequests: '0',
      usageEvents: '1',
      inputTokens: '7',
      outputTokens: '3',
      cacheReadTokens: '2',
      cacheWriteTokens: '1',
      totalTokens: '13',
      costUsd: '0.100000000001',
      zeroCostUsageEvents: '0',
      unpricedUsageEvents: '0',
    });
    const reconciliation = await fetch(`${baseUrl}/v1/usage/reconciliation?${query}&scenario=CONTENT_CREATION`, {
      headers: auth('admin', false),
    });
    assert.equal(reconciliation.status, 200);
    assert.equal(((await reconciliation.json()) as { state: string }).state, 'MATCHED');
    const events = await fetch(`${baseUrl}/v1/usage/events?${query}&scenario=CONTENT_CREATION&limit=1`, {
      headers: auth('auditor', false),
    });
    assert.equal(events.status, 200);
    assert.deepEqual(
      ((await events.json()) as { events: Array<{ eventId: string; scenario: string | null }> }).events[0],
      {
        kind: 'USAGE',
        eventId: 'response-1',
        occurredAt: '2026-07-25T16:00:00.000Z',
        userId: 'user-1',
        taskId: 'task-1',
        traceId: 'trace-1',
        modelId: 'gpt-5.6-sol',
        providerId: 'openai',
        scenario: 'CONTENT_CREATION',
        inputTokens: '7',
        outputTokens: '3',
        cacheReadTokens: '2',
        cacheWriteTokens: '1',
        totalTokens: '13',
        costUsd: '0.100000000001',
      }
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/usage/summary?${query}&userId=user-1&userId=user-2`, {
          headers: auth('auditor', false),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/usage/summary?${query}&userId=user-1&userId=user-1`, {
          headers: auth('auditor', false),
        })
      ).status,
      400
    );
    const invalidQueries = [
      '',
      `${query}&tenantId=tenant-2`,
      `${query}&from=2026-07-24T00%3A00%3A00.000Z`,
      query.replace('Asia%2FShanghai', 'Mars%2FOlympus'),
      query.replace('2026-07-27T00%3A00%3A00.000Z', '2026-07-27T08%3A00%3A00%2B08%3A00'),
      `${query}&scenario=UNKNOWN`,
      `${query}&scenario=GENERAL&scenario=SEARCH_QUERY`,
    ];
    const invalidStatuses = await Promise.all(
      invalidQueries.map(async (invalid) => {
        const response = await fetch(`${baseUrl}/v1/usage/summary?${invalid}`, {
          headers: auth('auditor', false),
        });
        return response.status;
      })
    );
    assert.deepEqual(
      invalidStatuses,
      invalidQueries.map(() => 400)
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/usage/events?${query}&cursor=not-a-cursor`, {
          headers: auth('auditor', false),
        })
      ).status,
      400
    );
  });
});

test('Session Index binds ownership, project access and optimistic cursor', async () => {
  await withServer(async (baseUrl) => {
    const write = {
      schemaVersion: 1,
      title: '季度复盘',
      summary: '完成销售数据分析并生成汇报。',
      tags: ['销售'],
      state: 'ACTIVE',
      updatedAt: '2026-07-26T10:00:00.000Z',
      expectedSourceCursor: null,
    };
    const created = await fetch(`${baseUrl}/v1/session-index/session-1`, {
      method: 'PUT',
      headers: auth('employee'),
      body: JSON.stringify(write),
    });
    assert.equal(created.status, 200);
    assert.equal(((await created.json()) as SessionSummary).sourceCursor, 1);
    const stale = await fetch(`${baseUrl}/v1/session-index/session-1`, {
      method: 'PUT',
      headers: auth('employee'),
      body: JSON.stringify(write),
    });
    assert.equal(stale.status, 409);

    const search = await fetch(`${baseUrl}/v1/session-index/search?q=${encodeURIComponent('销售')}`, {
      headers: auth('employee', false),
    });
    assert.equal(search.status, 200);
    assert.equal(((await search.json()) as { sessions: SessionSummary[] }).sessions[0]?.sessionId, 'session-1');
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/session-index/session-1`, {
          headers: auth('other', false),
        })
      ).status,
      404
    );

    const deniedProject = await fetch(`${baseUrl}/v1/session-index/session-project`, {
      method: 'PUT',
      headers: auth('employee'),
      body: JSON.stringify({ ...write, projectId: 'project-1' }),
    });
    assert.equal(deniedProject.status, 403);
    const badQuery = await fetch(`${baseUrl}/v1/session-index/search?q=x&tenantId=tenant-2`, {
      headers: auth('employee', false),
    });
    assert.equal(badQuery.status, 400);
  });
});

test('Observability policy enforces roles, CAS, idempotency and rollback', async () => {
  await withServer(async (baseUrl) => {
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/observability-policy`, {
          headers: auth('employee', false),
        })
      ).status,
      403
    );
    const visible = await fetch(`${baseUrl}/v1/observability-policy`, {
      headers: auth('auditor', false),
    });
    assert.equal(visible.status, 200);
    assert.equal(((await visible.json()) as ObservabilityPolicy).contentCapture, 'NONE');
    const update = {
      schemaVersion: 1,
      requestId: 'request:update-http',
      expectedVersion: 1,
      traceSampleRatio: 0.25,
    };
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/observability-policy`, {
          method: 'PUT',
          headers: auth('auditor'),
          body: JSON.stringify(update),
        })
      ).status,
      403
    );
    const changed = await fetch(`${baseUrl}/v1/observability-policy`, {
      method: 'PUT',
      headers: auth('admin'),
      body: JSON.stringify(update),
    });
    assert.equal(changed.status, 200);
    assert.equal(((await changed.json()) as ObservabilityPolicy).version, 2);
    const isolated = await fetch(`${baseUrl}/v1/observability-policy`, {
      headers: auth('tenant2admin', false),
    });
    assert.equal(((await isolated.json()) as ObservabilityPolicy).version, 1);
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/observability-policy`, {
          method: 'PUT',
          headers: auth('admin'),
          body: JSON.stringify(update),
        })
      ).status,
      200
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/observability-policy`, {
          method: 'PUT',
          headers: auth('admin'),
          body: JSON.stringify({ ...update, expectedVersion: 2 }),
        })
      ).status,
      409
    );
    const idempotencyConflict = await fetch(`${baseUrl}/v1/observability-policy`, {
      method: 'PUT',
      headers: auth('admin'),
      body: JSON.stringify({ ...update, traceSampleRatio: 0.5 }),
    });
    assert.equal(idempotencyConflict.status, 409);
    assert.equal(
      ((await idempotencyConflict.json()) as { error: { code: string } }).error.code,
      'POLICY_IDEMPOTENCY_CONFLICT'
    );
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/observability-policy`, {
          method: 'PUT',
          headers: auth('admin'),
          body: JSON.stringify({
            ...update,
            requestId: 'request:stale-http',
          }),
        })
      ).status,
      409
    );
    const rollback = await fetch(`${baseUrl}/v1/observability-policy/rollback`, {
      method: 'POST',
      headers: auth('admin'),
      body: JSON.stringify({
        schemaVersion: 1,
        requestId: 'request:rollback-http',
        expectedVersion: 2,
        targetVersion: 1,
      }),
    });
    assert.equal(rollback.status, 200);
    assert.equal(((await rollback.json()) as ObservabilityPolicy).version, 3);
    assert.equal(
      (
        await fetch(`${baseUrl}/v1/observability-policy`, {
          method: 'PUT',
          headers: auth('admin'),
          body: JSON.stringify({
            ...update,
            requestId: 'request:retention-http',
            expectedVersion: 3,
            metadataRetentionDays: 90,
          }),
        })
      ).status,
      400
    );
    assert.equal(
      (await fetch(`${baseUrl}/v1/observability-policy/rollback`, { headers: auth('admin', false) })).status,
      405
    );
  });
});

test('HTTP API rejects identity fields, invalid media, oversized bodies and hides failures', async () => {
  await withServer(async (baseUrl, redis) => {
    const injected = await fetch(`${baseUrl}/v1/runtime-registry/heartbeats`, {
      method: 'POST',
      headers: auth('employee'),
      body: JSON.stringify({
        ...heartbeat('instance-injected', 1),
        tenantId: 'tenant-2',
        userId: 'admin',
      }),
    });
    assert.equal(injected.status, 400);
    assert.equal(((await injected.json()) as { error: { code: string } }).error.code, 'INVALID_HEARTBEAT');

    const unsupported = await fetch(`${baseUrl}/v1/runtime-registry/heartbeats`, {
      method: 'POST',
      headers: auth('employee', false),
      body: '{}',
    });
    assert.equal(unsupported.status, 415);
    const oversized = await fetch(`${baseUrl}/v1/runtime-registry/heartbeats`, {
      method: 'POST',
      headers: auth('employee'),
      body: JSON.stringify({ padding: 'x'.repeat(70_000) }),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await fetch(`${baseUrl}/runtime/status`)).status, 401);

    redis.fail = true;
    const unavailable = await fetch(`${baseUrl}/runtime/status`, {
      headers: auth('admin', false),
    });
    assert.equal(unavailable.status, 503);
    const body = JSON.stringify(await unavailable.json());
    assert.equal(body.includes('secret'), false);
    assert.equal(body.includes('password'), false);
    assert.equal(body.includes('redis://'), false);
  });
});
