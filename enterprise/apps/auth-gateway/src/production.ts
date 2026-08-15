import { createPrivateKey, createPublicKey } from 'node:crypto';
import { createServer, type Server } from 'node:https';
import { readFileSync, statSync } from 'node:fs';
import { Pool } from 'pg';
import { createSessionTokenIssuer } from './crypto.ts';
import { PostgresAuthStore } from './postgres-store.ts';
import { createAuthGatewayHandler } from './server.ts';

type ProductionConfig = {
  schemaVersion: 1;
  listen: { host: string; port: number };
  tls: { certificateFile: string; privateKeyFile: string };
  database: {
    urlFile: string;
    transport: { mode: 'internal-plaintext' } | { mode: 'verify-ca'; caFile: string };
  };
  security: { maximumRequestsPerMinute: number };
  session: {
    issuer: string;
    keyId: string;
    privateKeyFile: string;
    accessAudience: string;
    accessLifetimeSeconds: number;
    refreshDerivationSecretFile: string;
    refreshLifetimeSeconds: number;
  };
  modelGateway: {
    baseUrl: string;
    audience: string;
    usageKeyId: string;
    usagePublicKeyFile: string;
    sessionLifetimeSeconds: number;
    routeCatalogFile: string;
  };
  allowedClientIds: string[];
  organizations: Array<{ slug: string; tenantId: string }>;
};

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const clientIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  const allowed = new Set(fields);
  if (Object.keys(value).length !== fields.length || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`Invalid ${label} fields`);
  }
}

function string(value: unknown, label: string, maximum = 2_048): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !value ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Invalid ${label}`);
  }
  return value as number;
}

function httpsUrl(value: unknown, label: string): string {
  const url = new URL(string(value, label));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`Invalid ${label}`);
  }
  return url.toString().replace(/\/$/, '');
}

export function parseProductionConfig(configValue: unknown): ProductionConfig {
  const root = object(configValue, 'production configuration');
  exact(
    root,
    [
      'schemaVersion',
      'listen',
      'tls',
      'database',
      'security',
      'session',
      'modelGateway',
      'allowedClientIds',
      'organizations',
    ],
    'production configuration'
  );
  if (root.schemaVersion !== 1) throw new Error('Invalid production configuration version');
  const listen = object(root.listen, 'listen configuration');
  exact(listen, ['host', 'port'], 'listen configuration');
  const tls = object(root.tls, 'TLS configuration');
  exact(tls, ['certificateFile', 'privateKeyFile'], 'TLS configuration');
  const database = object(root.database, 'database configuration');
  exact(database, ['urlFile', 'transport'], 'database configuration');
  const databaseTransport = object(database.transport, 'database transport');
  if (databaseTransport.mode === 'internal-plaintext') {
    exact(databaseTransport, ['mode'], 'database transport');
  } else if (databaseTransport.mode === 'verify-ca') {
    exact(databaseTransport, ['mode', 'caFile'], 'database transport');
  } else {
    throw new Error('Invalid database transport mode');
  }
  const security = object(root.security, 'security configuration');
  exact(security, ['maximumRequestsPerMinute'], 'security configuration');
  const session = object(root.session, 'session configuration');
  exact(
    session,
    [
      'issuer',
      'keyId',
      'privateKeyFile',
      'accessAudience',
      'accessLifetimeSeconds',
      'refreshDerivationSecretFile',
      'refreshLifetimeSeconds',
    ],
    'session configuration'
  );
  const modelGateway = object(root.modelGateway, 'Model Gateway configuration');
  exact(
    modelGateway,
    ['baseUrl', 'audience', 'usageKeyId', 'usagePublicKeyFile', 'sessionLifetimeSeconds', 'routeCatalogFile'],
    'Model Gateway configuration'
  );
  if (!Array.isArray(root.allowedClientIds) || root.allowedClientIds.length < 1 || root.allowedClientIds.length > 20) {
    throw new Error('Invalid allowed client ids');
  }
  const allowedClientIds = root.allowedClientIds.map((value) => string(value, 'client id', 128));
  if (
    allowedClientIds.some((value) => !clientIdPattern.test(value)) ||
    new Set(allowedClientIds).size !== allowedClientIds.length
  ) {
    throw new Error('Invalid allowed client ids');
  }
  if (!Array.isArray(root.organizations) || root.organizations.length < 1 || root.organizations.length > 1_000) {
    throw new Error('Invalid organizations');
  }
  const organizations = root.organizations.map((entry) => {
    const organization = object(entry, 'organization');
    exact(organization, ['slug', 'tenantId'], 'organization');
    const slug = string(organization.slug, 'organization slug', 160).normalize('NFKC').toLocaleLowerCase('en-US');
    const tenantId = string(organization.tenantId, 'tenant id', 128);
    if (!identifierPattern.test(tenantId)) throw new Error('Invalid tenant id');
    return { slug, tenantId };
  });
  if (new Set(organizations.map(({ slug }) => slug)).size !== organizations.length) {
    throw new Error('Duplicate organization slug');
  }
  const keyId = string(session.keyId, 'session key id', 128);
  if (!identifierPattern.test(keyId)) throw new Error('Invalid session key id');
  return {
    schemaVersion: 1,
    listen: {
      host: string(listen.host, 'listen host', 255),
      port: integer(listen.port, 'listen port', 1, 65_535),
    },
    tls: {
      certificateFile: string(tls.certificateFile, 'TLS certificate file'),
      privateKeyFile: string(tls.privateKeyFile, 'TLS private key file'),
    },
    database: {
      urlFile: string(database.urlFile, 'database URL file'),
      transport:
        databaseTransport.mode === 'internal-plaintext'
          ? { mode: 'internal-plaintext' }
          : { mode: 'verify-ca', caFile: string(databaseTransport.caFile, 'database CA file') },
    },
    security: {
      maximumRequestsPerMinute: integer(security.maximumRequestsPerMinute, 'maximum requests per minute', 1, 10_000),
    },
    session: {
      issuer: string(session.issuer, 'session issuer', 256),
      keyId,
      privateKeyFile: string(session.privateKeyFile, 'session private key file'),
      accessAudience: string(session.accessAudience, 'access audience', 256),
      accessLifetimeSeconds: integer(session.accessLifetimeSeconds, 'access lifetime', 120, 24 * 60 * 60),
      refreshDerivationSecretFile: string(session.refreshDerivationSecretFile, 'refresh secret file'),
      refreshLifetimeSeconds: integer(session.refreshLifetimeSeconds, 'refresh lifetime', 300, 30 * 24 * 60 * 60),
    },
    modelGateway: {
      baseUrl: httpsUrl(modelGateway.baseUrl, 'Model Gateway URL'),
      audience: string(modelGateway.audience, 'Model Gateway audience', 256),
      usageKeyId: string(modelGateway.usageKeyId, 'Usage key id', 80),
      usagePublicKeyFile: string(modelGateway.usagePublicKeyFile, 'Usage public key file'),
      sessionLifetimeSeconds: integer(
        modelGateway.sessionLifetimeSeconds,
        'Model Gateway session lifetime',
        120,
        15 * 60
      ),
      routeCatalogFile: string(modelGateway.routeCatalogFile, 'Model Gateway route catalog file'),
    },
    allowedClientIds,
    organizations,
  };
}

function readTextFile(path: string, label: string, secret = false): string {
  const statistics = statSync(path);
  if (!statistics.isFile()) throw new Error(`${label} is not a file`);
  if (secret && process.platform !== 'win32' && ((statistics.mode & 0o007) !== 0 || (statistics.mode & 0o030) !== 0)) {
    throw new Error(`${label} permissions are too broad`);
  }
  const value = readFileSync(path, 'utf8').trim();
  if (!value) throw new Error(`${label} is empty`);
  return value;
}

export function validatePostgresUrl(value: string, mode: 'internal-plaintext' | 'verify-ca'): string {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1) ||
    url.search ||
    url.hash ||
    (mode === 'internal-plaintext' && (url.hostname !== 'postgres' || !['', '5432'].includes(url.port)))
  ) {
    throw new Error('Invalid PostgreSQL URL');
  }
  return value;
}

export function modelRouteIdsFromCatalog(value: unknown): string[] {
  const catalog = object(value, 'Model Gateway route catalog');
  if (!Array.isArray(catalog.routes) || catalog.routes.length < 1 || catalog.routes.length > 20) {
    throw new Error('Invalid Model Gateway route catalog');
  }
  const routeIds = catalog.routes.map((entry) => {
    const route = object(entry, 'Model Gateway route');
    const routeId = string(route.id, 'model route id', 128);
    if (!identifierPattern.test(routeId) || routeId === 'e-mate-faux') {
      throw new Error('Invalid Model Gateway route id');
    }
    return routeId;
  });
  if (new Set(routeIds).size !== routeIds.length) throw new Error('Duplicate Model Gateway route id');
  return routeIds;
}

export async function startProductionAuthGateway(configPath: string): Promise<{
  server: Server;
  close(): Promise<void>;
}> {
  const config = parseProductionConfig(JSON.parse(readFileSync(configPath, 'utf8')) as unknown);
  const databaseUrl = validatePostgresUrl(
    readTextFile(config.database.urlFile, 'Database URL file', true),
    config.database.transport.mode
  );
  const refreshSecret = Buffer.from(
    readTextFile(config.session.refreshDerivationSecretFile, 'Refresh secret file', true),
    'base64url'
  );
  if (refreshSecret.byteLength !== 32) throw new Error('Refresh derivation secret must be 32 bytes');
  const sessionPrivateKey = readTextFile(config.session.privateKeyFile, 'Session private key file', true);
  const parsedPrivateKey = createPrivateKey(sessionPrivateKey);
  if (parsedPrivateKey.asymmetricKeyType !== 'ed25519') throw new Error('Session signing key must be Ed25519');
  const usagePublicKey = readTextFile(config.modelGateway.usagePublicKeyFile, 'Usage public key file');
  if (createPublicKey(usagePublicKey).asymmetricKeyType !== 'ed25519') {
    throw new Error('Usage public key must be Ed25519');
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl:
      config.database.transport.mode === 'verify-ca'
        ? {
            ca: readTextFile(config.database.transport.caFile, 'Database CA file'),
            rejectUnauthorized: true,
          }
        : false,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  try {
    const modelRouteIds = modelRouteIdsFromCatalog(
      JSON.parse(readFileSync(config.modelGateway.routeCatalogFile, 'utf8')) as unknown
    );
    const store = new PostgresAuthStore(pool, {
      refreshDerivationSecret: refreshSecret,
      modelRouteIds,
      sessionLifetimeSeconds: config.session.refreshLifetimeSeconds,
    });
    await store.initialize();
    const issueSession = createSessionTokenIssuer({
      issuer: config.session.issuer,
      accessAudience: config.session.accessAudience,
      modelAudience: config.modelGateway.audience,
      keyId: config.session.keyId,
      privateKey: parsedPrivateKey,
      modelGatewayBaseUrl: config.modelGateway.baseUrl,
      usageKeyId: config.modelGateway.usageKeyId,
      usagePublicKey,
      accessLifetimeSeconds: config.session.accessLifetimeSeconds,
      modelLifetimeSeconds: config.modelGateway.sessionLifetimeSeconds,
    });
    const handler = createAuthGatewayHandler({
      store,
      issueSession,
      organizations: new Map(config.organizations.map(({ slug, tenantId }) => [slug, tenantId])),
      allowedClientIds: new Set(config.allowedClientIds),
      maximumRequestsPerMinute: config.security.maximumRequestsPerMinute,
    });
    const server = createServer(
      {
        cert: readTextFile(config.tls.certificateFile, 'TLS certificate file'),
        key: readTextFile(config.tls.privateKeyFile, 'TLS private key file', true),
        minVersion: 'TLSv1.2',
      },
      (request, response) => {
        void handler(request, response);
      }
    );
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.listen.port, config.listen.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    return {
      server,
      async close() {
        try {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          });
        } finally {
          await pool.end();
        }
      },
    };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}
