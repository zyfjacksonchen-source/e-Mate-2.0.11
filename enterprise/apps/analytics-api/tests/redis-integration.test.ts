import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { openRedisRuntimeRegistry } from '../src/runtime-registry.ts';

const redisUrl = process.env.E_MATE_TEST_REDIS_URL;

test(
  'real Redis keeps tenant leases isolated, ordered and expiring',
  {
    skip: redisUrl ? false : 'E_MATE_TEST_REDIS_URL is not set',
  },
  async () => {
    const { registry, close } = await openRedisRuntimeRegistry(redisUrl as string, {
      ttlMs: 1_000,
    });
    const run = randomUUID();
    const tenant = `tenant-${run}`;
    const otherTenant = `tenant-${randomUUID()}`;
    const principal = { tenantId: tenant, userId: 'user-1', roles: [] };
    const heartbeat = {
      schemaVersion: 1 as const,
      runtimeInstanceId: `runtime-${run}`,
      sequence: 1,
      activeSessionIds: [`session-${run}`],
      runningTaskIds: [`task-${run}`],
      failedTaskIds: [],
      modelStatus: 'HEALTHY' as const,
      observedAt: new Date().toISOString(),
    };
    try {
      assert.equal(await registry.heartbeat(principal, heartbeat), true);
      assert.equal(await registry.heartbeat(principal, heartbeat), false);
      assert.equal((await registry.status(tenant)).activeUsers, 1);
      assert.equal((await registry.status(otherTenant)).activeUsers, 0);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const expired = await registry.status(tenant);
      assert.deepEqual(expired, {
        schemaVersion: 1,
        activeUsers: 0,
        activeSessions: 0,
        runningTasks: 0,
        failedTasks: 0,
        modelStatus: 'UNAVAILABLE',
        updatedAt: expired.updatedAt,
      });
    } finally {
      await registry.remove(principal, heartbeat.runtimeInstanceId);
      await close();
    }
  }
);
