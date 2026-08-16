import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { Pool } from 'pg';
import type { RuntimeRegistryPrincipal } from './runtime-registry.ts';
import { validateAdminPostgresUrl } from './admin-management.ts';

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base64urlPattern = /^[A-Za-z0-9_-]+$/;
const allowedRoles = new Set(['TENANT_ADMIN', 'AUDIT_ADMIN', 'MEMBER']);

type AccessClaims = {
  tenantId: string;
  userId: string;
  sessionId: string;
};

export type AccessSessionVerifierOptions = {
  issuer: string;
  audience: string;
  clientId: string;
  publicKeys: ReadonlyMap<string, KeyObject | string | Buffer>;
  now?: () => number;
  maximumLifetimeSeconds?: number;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function decode(segment: string): Record<string, unknown> | undefined {
  if (!base64urlPattern.test(segment)) return undefined;
  try {
    const bytes = Buffer.from(segment, 'base64url');
    if (bytes.byteLength < 2 || bytes.byteLength > 4_096 || bytes.toString('base64url') !== segment) return undefined;
    return object(JSON.parse(bytes.toString('utf8')));
  } catch {
    return undefined;
  }
}

function exact(value: Record<string, unknown>, keys: string[]): boolean {
  const expected = new Set(keys);
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => expected.has(key));
}

function text(value: string, maximum: number): boolean {
  return value.length >= 1 && value.length <= maximum && !/\p{Cc}/u.test(value);
}

function createTokenVerifier(options: AccessSessionVerifierOptions): (token: string) => AccessClaims | null {
  const maximumLifetime = options.maximumLifetimeSeconds ?? 24 * 60 * 60;
  if (
    !text(options.issuer, 256) ||
    !text(options.audience, 256) ||
    !identifierPattern.test(options.clientId) ||
    options.publicKeys.size < 1 ||
    options.publicKeys.size > 8 ||
    !Number.isSafeInteger(maximumLifetime) ||
    maximumLifetime < 120 ||
    maximumLifetime > 24 * 60 * 60
  ) {
    throw new Error('Invalid access session verifier configuration');
  }
  const keys = new Map<string, KeyObject>();
  for (const [keyId, value] of options.publicKeys) {
    if (!identifierPattern.test(keyId)) throw new Error('Invalid access session key id');
    const key = typeof value === 'string' || Buffer.isBuffer(value) ? createPublicKey(value) : value;
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      throw new Error('Access session key must be Ed25519');
    }
    keys.set(keyId, key);
  }

  return (token) => {
    if (typeof token !== 'string' || token.length < 32 || token.length > 4_096) return null;
    const parts = token.split('.');
    if (parts.length !== 3 || !base64urlPattern.test(parts[2] as string)) return null;
    const header = decode(parts[0] as string);
    const claims = decode(parts[1] as string);
    if (
      !header ||
      !claims ||
      !exact(header, ['alg', 'typ', 'kid']) ||
      header.alg !== 'EdDSA' ||
      header.typ !== 'e-mate-auth-session+jwt' ||
      typeof header.kid !== 'string' ||
      !identifierPattern.test(header.kid) ||
      !exact(claims, [
        'schemaVersion',
        'iss',
        'aud',
        'sub',
        'sid',
        'tenantId',
        'roles',
        'weeklyTokenLimit',
        'iat',
        'nbf',
        'exp',
        'jti',
      ]) ||
      claims.schemaVersion !== 1 ||
      claims.iss !== options.issuer ||
      claims.aud !== options.audience ||
      typeof claims.sub !== 'string' ||
      !identifierPattern.test(claims.sub) ||
      typeof claims.sid !== 'string' ||
      !uuidPattern.test(claims.sid) ||
      typeof claims.tenantId !== 'string' ||
      !identifierPattern.test(claims.tenantId) ||
      !Array.isArray(claims.roles) ||
      claims.roles.length < 1 ||
      claims.roles.length > 3 ||
      claims.roles.some((role) => typeof role !== 'string' || !allowedRoles.has(role)) ||
      !Number.isSafeInteger(claims.weeklyTokenLimit) ||
      (claims.weeklyTokenLimit as number) < 1 ||
      !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.nbf) ||
      !Number.isSafeInteger(claims.exp) ||
      typeof claims.jti !== 'string' ||
      !uuidPattern.test(claims.jti)
    ) {
      return null;
    }
    const now = Math.floor((options.now ?? Date.now)() / 1_000);
    if (
      (claims.iat as number) > now + 60 ||
      (claims.nbf as number) > now + 60 ||
      (claims.exp as number) <= now - 60 ||
      (claims.exp as number) <= (claims.iat as number) ||
      (claims.exp as number) - (claims.iat as number) > maximumLifetime
    ) {
      return null;
    }
    const key = keys.get(header.kid);
    const signature = Buffer.from(parts[2] as string, 'base64url');
    if (
      !key ||
      signature.byteLength !== 64 ||
      signature.toString('base64url') !== parts[2] ||
      !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), key, signature)
    ) {
      return null;
    }
    return { tenantId: claims.tenantId, userId: claims.sub, sessionId: claims.sid };
  };
}

export function createAccessSessionAuthenticator(pool: Pool, options: AccessSessionVerifierOptions) {
  const verifyToken = createTokenVerifier(options);
  return async (token: string): Promise<RuntimeRegistryPrincipal | null> => {
    const claims = verifyToken(token);
    if (!claims) return null;
    const result = await pool.query<{ roles: string[] }>(
      `SELECT app_user.roles
         FROM e_mate_auth_session AS session
         JOIN e_mate_tenant_user AS app_user
           ON app_user.tenant_id = session.tenant_id AND app_user.user_id = session.user_id
        WHERE session.session_id = $1 AND session.tenant_id = $2 AND session.user_id = $3
          AND session.client_id = $4 AND session.status = 'ACTIVE' AND session.expires_at > clock_timestamp()
          AND app_user.status = 'ACTIVE'`,
      [claims.sessionId, claims.tenantId, claims.userId, options.clientId]
    );
    const roles = result.rows[0]?.roles;
    if (!roles || roles.length < 1 || roles.some((role) => !allowedRoles.has(role))) return null;
    return { tenantId: claims.tenantId, userId: claims.userId, roles: [...roles] };
  };
}

export function openPostgresAccessSessionAuthenticator(url: string, options: AccessSessionVerifierOptions) {
  const connectionString = validateAdminPostgresUrl(url);
  const hostname = new URL(connectionString).hostname;
  const local = ['127.0.0.1', 'localhost', '::1', '[::1]', 'postgres'].includes(hostname);
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(local ? {} : { ssl: { rejectUnauthorized: true } }),
  });
  pool.on('error', () => undefined);
  return { authenticate: createAccessSessionAuthenticator(pool, options), close: () => pool.end() };
}
