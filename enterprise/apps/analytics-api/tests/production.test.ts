import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { parseProductionConfiguration } from '../src/production.ts';
import { createAnalyticsServer } from '../src/server.ts';

const token = 'test-admin-bearer';
const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

function configuration(principalsFile = '/run/secrets/analytics-principals.json'): Record<string, unknown> {
  return {
    schemaVersion: 1,
    listen: { host: '0.0.0.0', port: 4190 },
    database: { urlFile: '/run/secrets/postgres-url' },
    redis: { urlFile: '/run/secrets/redis-url' },
    managementAuth: { principalsFile },
    consentPolicy: {
      schemaVersion: 1,
      agreementId: 'e-mate-platform-terms',
      agreementVersion: '1.0.0',
      disclaimerVersion: '1.0.0',
      contentHash: 'a'.repeat(64),
    },
    modelRoutes: [
      { routeId: 'gpt-5.6-luna', label: 'Luna', provider: 'OpenAI' },
      { routeId: 'gpt-5.6-sol', label: 'Sol', provider: 'OpenAI' },
    ],
  };
}

function secretReader(principalDocument: unknown): (path: string) => Buffer {
  const values = new Map([
    ['/run/secrets/postgres-url', Buffer.from('postgres://e_mate:test@127.0.0.1:5432/e_mate')],
    ['/run/secrets/redis-url', Buffer.from('redis://127.0.0.1:6379')],
    ['/run/secrets/analytics-principals.json', Buffer.from(JSON.stringify(principalDocument))],
    ['/run/secrets/model-route-key-encryption', Buffer.from(Buffer.alloc(32, 5).toString('base64url'))],
  ]);
  return (path) => {
    const value = values.get(path);
    if (!value) throw new Error('Unexpected secret path');
    return value;
  };
}

function principals(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    principals: [
      {
        tokenSha256: tokenHash,
        tenantId: 'tenant-1',
        userId: 'admin-1',
        roles: ['TENANT_ADMIN'],
        projectIds: ['project-1'],
        ...overrides,
      },
    ],
  };
}

test('production configuration maps a hashed bearer to fixed identity and denies other tokens', async () => {
  const readSecret = secretReader(principals());
  const parsed = parseProductionConfiguration(
    {
      ...configuration(),
      modelRouteKeys: { encryptionKeyFile: '/run/secrets/model-route-key-encryption' },
    },
    (path) => {
      assert.notEqual(path, '/run/secrets/redis-url');
      return readSecret(path);
    }
  );
  assert.equal(parsed.host, '0.0.0.0');
  assert.equal(parsed.port, 4190);
  assert.equal(parsed.databaseUrl, 'postgres://e_mate:test@127.0.0.1:5432/e_mate');
  assert.deepEqual(parsed.modelRouteKeyEncryptionKey, Buffer.alloc(32, 5));
  assert.equal(parsed.consentPolicy.agreementId, 'e-mate-platform-terms');
  assert.deepEqual(await parsed.authenticate(token), {
    tenantId: 'tenant-1',
    userId: 'admin-1',
    roles: ['TENANT_ADMIN'],
    projectIds: ['project-1'],
  });
  assert.equal(await parsed.authenticate('wrong-admin-bearer'), null);
  const withoutRedis = configuration();
  delete withoutRedis.redis;
  assert.equal(parseProductionConfiguration(withoutRedis, readSecret).port, 4190);
});

test('production registers only identity, model-policy management and redacted audit surfaces', async () => {
  const source = readFileSync(new URL('../src/production.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /openRedisRuntimeRegistry|openPostgresSessionSummaryStore|openPostgresObservabilityPolicyStore/);
  assert.doesNotMatch(source, /\bregistry:|\bsessionIndex:|\bobservabilityPolicy:/);

  const server = createAnalyticsServer({ authenticate: async () => null });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    for (const path of [
      '/runtime/status',
      '/v1/runtime-registry/heartbeats',
      '/v1/runtime-registry/instances/runtime-1',
      '/v1/session-index/search',
      '/v1/session-index/session-1',
      '/v1/operations/observability',
      '/v1/observability-policy',
      '/v1/observability-policy/rollback',
    ]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 404, path);
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'NOT_FOUND');
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('production configuration rejects non-secret paths, unknown fields, invalid roles, and duplicate hashes', () => {
  assert.throws(
    () => parseProductionConfiguration(configuration('C:\\secrets\\principals.json'), secretReader(principals())),
    /Invalid management principals file/
  );
  assert.throws(
    () => parseProductionConfiguration({ ...configuration(), plaintextToken: token }, secretReader(principals())),
    /Invalid configuration/
  );
  assert.throws(
    () => parseProductionConfiguration(configuration(), secretReader(principals({ roles: ['MEMBER'] }))),
    /Invalid role/
  );
  const duplicate = principals();
  duplicate.principals = [
    ...(duplicate.principals as unknown[]),
    {
      tokenSha256: tokenHash,
      tenantId: 'tenant-2',
      userId: 'admin-2',
      roles: ['AUDIT_ADMIN'],
      projectIds: [],
    },
  ];
  assert.throws(
    () => parseProductionConfiguration(configuration(), secretReader(duplicate)),
    /Invalid management principal 2/
  );
});

test('health endpoint is available without credentials and leaks no dependency details', async () => {
  const server = createAnalyticsServer({
    registry: {
      heartbeat: async () => true,
      remove: async () => true,
      status: async () => {
        throw new Error('health endpoint must not query Redis');
      },
    },
    authenticate: async () => {
      throw new Error('health endpoint must not authenticate');
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/healthz?verbose=1`)).status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/healthz`, { method: 'POST' })).status, 405);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
