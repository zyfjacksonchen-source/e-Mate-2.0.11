import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminManagementError, InMemoryAdminManagementStore, createManagementAuthenticator } from '../src/index.ts';
import type { RuntimeRegistryPrincipal } from '../src/runtime-registry.ts';

const tenantAdmin = (tenantId: string): RuntimeRegistryPrincipal => ({
  tenantId,
  userId: 'admin-1',
  roles: ['TENANT_ADMIN'],
});

test('tenant user and model route records remain tenant-isolated', async () => {
  let now = Date.parse('2026-07-30T10:00:00.000Z');
  const store = new InMemoryAdminManagementStore(
    [{ routeId: 'gpt-5.6-sol', label: 'Sol', provider: 'Enterprise gateway' }],
    () => now
  );
  const created = await store.createUser(tenantAdmin('tenant-a'), {
    schemaVersion: 1,
    userId: 'user-a',
    displayName: 'User A',
    roles: ['MEMBER'],
    tokenLimit: 1_000,
    allowedModelIds: ['gpt-5.6-sol'],
    initialPassword: 'InitialPass-2026!',
  });
  await store.updateUser(tenantAdmin('tenant-a'), 'user-a', {
    schemaVersion: 1,
    displayName: 'User A',
    roles: ['MEMBER'],
    status: 'ACTIVE',
    tokenLimit: 5_000,
    allowedModelIds: ['gpt-5.6-sol'],
    expectedUpdatedAt: created.updatedAt,
  });
  assert.equal((await store.listUsers(tenantAdmin('tenant-a'))).users[0]?.tokenLimit, 5_000);
  await assert.rejects(
    store.updateUser(tenantAdmin('tenant-a'), 'user-a', {
      schemaVersion: 1,
      displayName: 'Stale User A',
      roles: ['MEMBER'],
      status: 'SUSPENDED',
      tokenLimit: 1,
      allowedModelIds: ['gpt-5.6-sol'],
      expectedUpdatedAt: created.updatedAt,
    }),
    (error: unknown) => error instanceof AdminManagementError && error.code === 'STALE_UPDATE'
  );
  await assert.rejects(
    store.deleteUser(tenantAdmin('tenant-a'), 'user-a', {
      schemaVersion: 1,
      expectedUpdatedAt: created.updatedAt,
    }),
    (error: unknown) => error instanceof AdminManagementError && error.code === 'STALE_UPDATE'
  );
  assert.equal((await store.listUsers(tenantAdmin('tenant-a'))).users[0]?.status, 'ACTIVE');
  assert.equal((await store.listUsers(tenantAdmin('tenant-b'))).users.length, 0);

  now += 1_000;
  await store.updateModelRoute(tenantAdmin('tenant-a'), 'gpt-5.6-sol', {
    schemaVersion: 1,
    enabled: false,
  });
  assert.equal((await store.listModelRoutes(tenantAdmin('tenant-a'))).routes[0]?.enabled, false);
  assert.equal((await store.listModelRoutes(tenantAdmin('tenant-b'))).routes[0]?.enabled, true);

  const apiKey = 'tenant-provider-key-that-is-long-enough';
  now += 1_000;
  const updated = await store.updateModelRouteKey(tenantAdmin('tenant-a'), 'gpt-5.6-sol', {
    schemaVersion: 1,
    apiKey,
  });
  assert.equal(updated?.keyConfigured, true);
  assert.equal(JSON.stringify(updated).includes(apiKey), false);
  assert.equal((await store.listModelRoutes(tenantAdmin('tenant-a'))).routes[0]?.keyConfigured, true);
  assert.equal((await store.listModelRoutes(tenantAdmin('tenant-b'))).routes[0]?.keyConfigured, false);
});

test('client credentials are shown once, scope-bound, user-bound, and revocable', async () => {
  let now = Date.parse('2026-07-30T10:00:00.000Z');
  const store = new InMemoryAdminManagementStore([], () => now);
  const admin = tenantAdmin('tenant-a');
  await store.createUser(admin, {
    schemaVersion: 1,
    userId: 'user-a',
    displayName: 'User A',
    roles: ['MEMBER'],
    tokenLimit: 10_000,
    allowedModelIds: ['gpt-5.6-sol'],
    initialPassword: 'InitialPass-2026!',
  });
  const issued = await store.issueApiKey(admin, {
    schemaVersion: 1,
    label: 'Desktop',
    principalType: 'DEVICE',
    principalId: 'device-a',
    userId: 'user-a',
    scopes: ['task-events:write'],
  });
  assert.match(issued.secret, /^emate_twe_[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(await store.listApiKeys(admin)).includes(issued.secret), false);
  assert.deepEqual(await store.authenticateTaskEventBearer(issued.secret), {
    tenantId: 'tenant-a',
    userId: 'user-a',
    roles: [],
    scopes: ['task-events:write'],
  });
  const combined = await store.issueApiKey(admin, {
    schemaVersion: 1,
    label: 'e-Mate access',
    principalType: 'USER',
    principalId: 'user-a',
    userId: 'user-a',
    scopes: ['task-events:write', 'models:invoke'],
  });
  assert.deepEqual((await store.authenticateTaskEventBearer(combined.secret))?.scopes, [
    'task-events:write',
    'models:invoke',
  ]);
  const modelOnly = await store.issueApiKey(admin, {
    schemaVersion: 1,
    label: 'Model access',
    principalType: 'USER',
    principalId: 'user-a',
    userId: 'user-a',
    scopes: ['models:invoke'],
  });
  assert.equal(await store.authenticateTaskEventBearer(modelOnly.secret), null);

  now += 1_000;
  assert.equal(await store.revokeApiKey(admin, issued.key.keyId), true);
  assert.equal(await store.authenticateTaskEventBearer(issued.secret), null);
  assert.equal(await store.revokeApiKey(tenantAdmin('tenant-b'), issued.key.keyId), false);
});

test('suspended and missing users cannot receive task event credentials', async () => {
  const store = new InMemoryAdminManagementStore([]);
  const admin = tenantAdmin('tenant-a');
  const created = await store.createUser(admin, {
    schemaVersion: 1,
    userId: 'user-a',
    displayName: 'User A',
    roles: ['MEMBER'],
    tokenLimit: 1_000,
    allowedModelIds: ['gpt-5.6-sol'],
    initialPassword: 'InitialPass-2026!',
  });
  await store.updateUser(admin, 'user-a', {
    schemaVersion: 1,
    displayName: 'User A',
    roles: ['MEMBER'],
    status: 'SUSPENDED',
    tokenLimit: null,
    allowedModelIds: [],
    expectedUpdatedAt: created.updatedAt,
  });
  await assert.rejects(
    store.issueApiKey(admin, {
      schemaVersion: 1,
      label: 'Desktop',
      principalType: 'USER',
      principalId: 'user-a',
      userId: 'user-a',
      scopes: ['task-events:write'],
    }),
    (error: unknown) => error instanceof AdminManagementError && error.code === 'USER_UNAVAILABLE'
  );
});

test('deleting a user is idempotent, terminal, and revokes existing credentials', async () => {
  const store = new InMemoryAdminManagementStore([]);
  const admin = tenantAdmin('tenant-a');
  const created = await store.createUser(admin, {
    schemaVersion: 1,
    userId: 'user-a',
    displayName: 'User A',
    roles: ['MEMBER'],
    tokenLimit: 1_000,
    allowedModelIds: ['gpt-5.6-sol'],
    initialPassword: 'InitialPass-2026!',
  });
  const issued = await store.issueApiKey(admin, {
    schemaVersion: 1,
    label: 'Desktop',
    principalType: 'USER',
    principalId: 'user-a',
    userId: 'user-a',
    scopes: ['task-events:write', 'models:invoke'],
  });

  const deletion = { schemaVersion: 1 as const, expectedUpdatedAt: created.updatedAt };
  assert.equal(await store.deleteUser(admin, 'user-a', deletion), true);
  assert.equal(await store.deleteUser(admin, 'user-a', deletion), true);
  const deleted = (await store.listUsers(admin)).users[0];
  assert.equal(deleted?.status, 'DELETED');
  assert.equal((await store.listApiKeys(admin)).keys[0]?.revokedAt !== null, true);
  assert.equal(await store.authenticateTaskEventBearer(issued.secret), null);
  assert.equal(
    await store.updateUser(admin, 'user-a', {
      schemaVersion: 1,
      displayName: 'User A',
      roles: ['MEMBER'],
      status: 'ACTIVE',
      tokenLimit: 1_000,
      allowedModelIds: ['gpt-5.6-sol'],
      expectedUpdatedAt: deleted?.updatedAt as string,
    }),
    null
  );
  await assert.rejects(
    store.issueApiKey(admin, {
      schemaVersion: 1,
      label: 'Replacement',
      principalType: 'USER',
      principalId: 'user-a',
      userId: 'user-a',
      scopes: ['models:invoke'],
    }),
    (error: unknown) => error instanceof AdminManagementError && error.code === 'USER_UNAVAILABLE'
  );
});

test('enterprise and task-event authenticators remain separated by roles and scopes', async () => {
  const store = new InMemoryAdminManagementStore([]);
  const admin = tenantAdmin('tenant-a');
  await store.createUser(admin, {
    schemaVersion: 1,
    userId: 'user-a',
    displayName: 'User A',
    roles: ['MEMBER'],
    tokenLimit: 1_000,
    allowedModelIds: ['gpt-5.6-sol'],
    initialPassword: 'InitialPass-2026!',
  });
  const issued = await store.issueApiKey(admin, {
    schemaVersion: 1,
    label: 'Desktop',
    principalType: 'USER',
    principalId: 'user-a',
    userId: 'user-a',
    scopes: ['task-events:write'],
  });
  const authenticate = createManagementAuthenticator(
    async (bearer) => (bearer === 'admin-token' ? admin : null),
    store
  );
  assert.deepEqual(await authenticate('admin-token'), admin);
  assert.deepEqual((await authenticate(issued.secret))?.roles, []);
  assert.deepEqual((await authenticate(issued.secret))?.scopes, ['task-events:write']);
});
