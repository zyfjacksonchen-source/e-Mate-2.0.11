import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import { ADMIN_USER_ROLES, type AdminUserRole } from '@e-mate/admin-contract';
import type { ModelGatewayPrincipal } from './server.ts';

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const base64urlPattern = /^[A-Za-z0-9_-]+$/;

type SessionClaims = {
  schemaVersion: 1;
  iss: string;
  aud: string;
  sub: string;
  sid: string;
  tenantId: string;
  roles?: AdminUserRole[];
  modelIds: string[];
  scopes: ['models:read', 'responses:create', 'usage:read'];
  iat: number;
  nbf: number;
  exp: number;
  jti: string;
};

type SessionTokenPolicy = {
  issuer: string;
  audience: string;
  now: () => number;
  maximumLifetimeSeconds: number;
  clockSkewSeconds: number;
};

export type SessionTokenVerifierOptions = {
  issuer: string;
  audience: string;
  publicKeys: ReadonlyMap<string, KeyObject | string | Buffer>;
  now?: () => number;
  maximumLifetimeSeconds?: number;
  clockSkewSeconds?: number;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function decodeJson(segment: string): Record<string, unknown> | undefined {
  if (!base64urlPattern.test(segment)) return undefined;
  try {
    const bytes = Buffer.from(segment, 'base64url');
    if (bytes.length < 2 || bytes.length > 4_096 || bytes.toString('base64url') !== segment) {
      return undefined;
    }
    return object(JSON.parse(bytes.toString('utf8')));
  } catch {
    return undefined;
  }
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).toSorted();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].toSorted()[index]);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value);
}

function validNonce(value: unknown): value is string {
  return validIdentifier(value) && value.length >= 16;
}

function validClaimText(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 256 && !/\p{Cc}/u.test(value);
}

function parseClaims(value: Record<string, unknown>, policy: SessionTokenPolicy): SessionClaims | undefined {
  const claimKeys = ['schemaVersion', 'iss', 'aud', 'sub', 'sid', 'tenantId', 'scopes', 'iat', 'nbf', 'exp', 'jti'];
  if (
    (!exactKeys(value, [...claimKeys, 'modelIds']) && !exactKeys(value, [...claimKeys, 'modelIds', 'roles'])) ||
    value.schemaVersion !== 1 ||
    value.iss !== policy.issuer ||
    value.aud !== policy.audience ||
    !validIdentifier(value.sub) ||
    !validIdentifier(value.sid) ||
    !validIdentifier(value.tenantId) ||
    !validNonce(value.jti) ||
    (value.roles !== undefined &&
      (!Array.isArray(value.roles) ||
        value.roles.length < 1 ||
        value.roles.length > ADMIN_USER_ROLES.length ||
        value.roles.some((role) => !ADMIN_USER_ROLES.includes(role as AdminUserRole)) ||
        new Set(value.roles).size !== value.roles.length)) ||
    (!Array.isArray(value.modelIds) ||
        value.modelIds.length < 1 ||
        value.modelIds.length > 20 ||
        value.modelIds.some((id) => !validIdentifier(id)) ||
        value.modelIds.includes('e-mate-faux') ||
        new Set(value.modelIds).size !== value.modelIds.length) ||
    !Array.isArray(value.scopes) ||
    value.scopes.length !== 3 ||
    value.scopes[0] !== 'models:read' ||
    value.scopes[1] !== 'responses:create' ||
    value.scopes[2] !== 'usage:read' ||
    !Number.isSafeInteger(value.iat) ||
    !Number.isSafeInteger(value.nbf) ||
    !Number.isSafeInteger(value.exp)
  ) {
    return undefined;
  }
  const nowMilliseconds = policy.now();
  if (!Number.isFinite(nowMilliseconds) || !Number.isSafeInteger(nowMilliseconds)) {
    return undefined;
  }
  const now = Math.floor(nowMilliseconds / 1_000);
  const skew = policy.clockSkewSeconds;
  const maximumLifetime = policy.maximumLifetimeSeconds;
  if (
    skew < 0 ||
    skew > 60 ||
    maximumLifetime < 60 ||
    maximumLifetime > 15 * 60 ||
    (value.iat as number) > now + skew ||
    (value.nbf as number) > now + skew ||
    Math.abs((value.nbf as number) - (value.iat as number)) > skew ||
    (value.nbf as number) >= (value.exp as number) ||
    (value.exp as number) <= now ||
    (value.exp as number) <= (value.iat as number) ||
    (value.exp as number) - (value.iat as number) > maximumLifetime
  ) {
    return undefined;
  }
  return value as SessionClaims;
}

export function createSessionTokenVerifier(
  options: SessionTokenVerifierOptions
): (token: string) => Promise<ModelGatewayPrincipal | null> {
  const skew = options.clockSkewSeconds ?? 60;
  const maximumLifetime = options.maximumLifetimeSeconds ?? 15 * 60;
  if (
    !validClaimText(options.issuer) ||
    !validClaimText(options.audience) ||
    options.publicKeys.size < 1 ||
    options.publicKeys.size > 8 ||
    !Number.isSafeInteger(skew) ||
    skew < 0 ||
    skew > 60 ||
    !Number.isSafeInteger(maximumLifetime) ||
    maximumLifetime < 60 ||
    maximumLifetime > 15 * 60
  ) {
    throw new Error('Invalid session verifier configuration');
  }
  const keys = new Map<string, KeyObject>();
  for (const [keyId, value] of options.publicKeys) {
    if (!validIdentifier(keyId)) {
      throw new Error('Invalid session verifier key id');
    }
    let key: KeyObject;
    if (typeof value === 'string' || Buffer.isBuffer(value)) {
      key = createPublicKey(value);
    } else {
      key = value;
    }
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      throw new Error('Session verifier key must be Ed25519');
    }
    keys.set(keyId, key);
  }
  const policy: SessionTokenPolicy = {
    issuer: options.issuer,
    audience: options.audience,
    now: options.now ?? Date.now,
    maximumLifetimeSeconds: maximumLifetime,
    clockSkewSeconds: skew,
  };

  return async (token) => {
    if (typeof token !== 'string' || token.length < 32 || token.length > 4_096) {
      return null;
    }
    const parts = token.split('.');
    if (parts.length !== 3 || !base64urlPattern.test(parts[2] as string)) {
      return null;
    }
    const header = decodeJson(parts[0] as string);
    const payload = decodeJson(parts[1] as string);
    if (
      !header ||
      !payload ||
      !exactKeys(header, ['alg', 'typ', 'kid']) ||
      header.alg !== 'EdDSA' ||
      header.typ !== 'e-mate-model-session+jwt' ||
      !validIdentifier(header.kid)
    ) {
      return null;
    }
    const key = keys.get(header.kid);
    const claims = parseClaims(payload, policy);
    if (!key || !claims) return null;
    const signature = Buffer.from(parts[2] as string, 'base64url');
    if (
      signature.length !== 64 ||
      signature.toString('base64url') !== parts[2] ||
      !verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), key, signature)
    ) {
      return null;
    }
    return {
      tenantId: claims.tenantId,
      userId: claims.sub,
      ...(claims.roles ? { roles: [...claims.roles] } : {}),
      modelIds: [...claims.modelIds],
      sessionId: claims.sid,
    };
  };
}
