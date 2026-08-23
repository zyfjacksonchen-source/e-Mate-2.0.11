import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelRouteIdsFromCatalog, parseProductionConfig, validatePostgresUrl } from '../src/production.ts';

function validConfig(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    listen: { host: '127.0.0.1', port: 8443 },
    tls: { certificateFile: '/run/e-mate/tls.crt', privateKeyFile: '/run/e-mate/tls.key' },
    database: { urlFile: '/run/e-mate/postgres.url', transport: { mode: 'internal-plaintext' } },
    security: { maximumRequestsPerMinute: 120 },
    session: {
      issuer: 'e-mate-auth',
      keyId: 'auth-2026-08',
      privateKeyFile: '/run/e-mate/session-private.pem',
      accessAudience: 'e-mate-desktop',
      accessLifetimeSeconds: 900,
      refreshDerivationSecretFile: '/run/e-mate/refresh-secret',
      refreshLifetimeSeconds: 2_592_000,
    },
    modelGateway: {
      baseUrl: 'https://mvdcm.ecoremedia.net/e-mate/model-api',
      audience: 'e-mate-model-gateway',
      usageKeyId: 'usage-2026-08',
      usagePublicKeyFile: '/run/e-mate/usage-public.pem',
      sessionLifetimeSeconds: 600,
      routeCatalogFile: '/run/e-mate/model-gateway-config.json',
    },
    allowedClientIds: ['e-mate-desktop'],
    organizations: [{ slug: '亦芯', tenantId: 'tenant-a' }],
  };
}

test('production configuration is strict and normalizes organization slugs', () => {
  const parsed = parseProductionConfig(validConfig());
  assert.deepEqual(parsed.organizations, [{ slug: '亦芯', tenantId: 'tenant-a' }]);
  assert.deepEqual(parsed.allowedClientIds, ['e-mate-desktop']);
});

test('production configuration rejects unknown fields, insecure URLs, and duplicate organizations', () => {
  assert.throws(() => parseProductionConfig({ ...validConfig(), unknown: true }), /fields/);
  const insecure = validConfig();
  (insecure.modelGateway as Record<string, unknown>).baseUrl = 'http://gateway.example.test';
  assert.throws(() => parseProductionConfig(insecure), /Model Gateway URL/);
  const duplicate = validConfig();
  duplicate.organizations = [
    { slug: 'ACME', tenantId: 'tenant-a' },
    { slug: 'acme', tenantId: 'tenant-b' },
  ];
  assert.throws(() => parseProductionConfig(duplicate), /Duplicate organization/);
});

test('Auth model ids come only from the shared Model Gateway route catalog', () => {
  assert.deepEqual(
    modelRouteIdsFromCatalog({
      schemaVersion: 1,
      routes: [
        { id: 'gemini-3.1-pro' },
        { id: 'gpt-5.6-luna' },
        { id: 'gpt-web-search' },
        { id: 'gpt-image-2-pro' },
      ],
    }),
    ['gemini-3.1-pro', 'gpt-5.6-luna', 'gpt-image-2-pro']
  );
  assert.throws(() => modelRouteIdsFromCatalog({ routes: [] }), /route catalog/);
  assert.throws(() => modelRouteIdsFromCatalog({ routes: [{ id: 'gpt-web-search' }] }), /route catalog/);
  assert.throws(() => modelRouteIdsFromCatalog({ routes: [{ id: 'e-mate-faux' }] }), /route id/);
  assert.throws(
    () => modelRouteIdsFromCatalog({ routes: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-5.6-sol' }] }),
    /Duplicate/
  );
});

test('plaintext Postgres is limited to the isolated Compose hostname while external databases require CA mode', () => {
  assert.equal(
    validatePostgresUrl('postgresql://e_mate:password@postgres:5432/e_mate', 'internal-plaintext'),
    'postgresql://e_mate:password@postgres:5432/e_mate'
  );
  assert.throws(
    () => validatePostgresUrl('postgresql://e_mate:password@db.example.test/e_mate', 'internal-plaintext'),
    /PostgreSQL URL/
  );
  assert.equal(
    validatePostgresUrl('postgresql://e_mate:password@db.example.test/e_mate', 'verify-ca'),
    'postgresql://e_mate:password@db.example.test/e_mate'
  );
  assert.throws(
    () => validatePostgresUrl('postgresql://e_mate:password@postgres/e_mate?sslmode=disable', 'verify-ca'),
    /PostgreSQL URL/
  );
});
