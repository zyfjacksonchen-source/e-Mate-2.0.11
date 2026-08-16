import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { createSessionTokenVerifier } from '../src/session-auth.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const now = Date.parse('2026-07-26T08:00:00.000Z');

function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const encodedHeader = Buffer.from(
    JSON.stringify({
      alg: 'EdDSA',
      typ: 'e-mate-model-session+jwt',
      kid: 'auth-2026',
      ...header,
    })
  ).toString('base64url');
  const encodedPayload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      iss: 'e-mate-auth',
      aud: 'e-mate-model-gateway',
      sub: 'user-1',
      sid: 'session-1',
      tenantId: 'tenant-1',
      roles: ['MEMBER'],
      modelIds: ['gpt-5.6-sol'],
      scopes: ['models:read', 'responses:create', 'usage:read'],
      iat: Math.floor(now / 1_000),
      nbf: Math.floor(now / 1_000),
      exp: Math.floor(now / 1_000) + 600,
      jti: 'token-0000000001',
      ...claims,
    })
  ).toString('base64url');
  const body = `${encodedHeader}.${encodedPayload}`;
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString('base64url')}`;
}

const authenticate = createSessionTokenVerifier({
  issuer: 'e-mate-auth',
  audience: 'e-mate-model-gateway',
  publicKeys: new Map([['auth-2026', publicKey]]),
  now: () => now,
});

test('verifies short-lived Ed25519 session tokens with their signed user model policy', async () => {
  assert.deepEqual(await authenticate(token()), {
    tenantId: 'tenant-1',
    userId: 'user-1',
    roles: ['MEMBER'],
    modelIds: ['gpt-5.6-sol'],
    sessionId: 'session-1',
  });
  assert.equal(await authenticate(token({ modelIds: undefined })), null);
  assert.deepEqual(await authenticate(token({ roles: undefined })), {
    tenantId: 'tenant-1',
    userId: 'user-1',
    modelIds: ['gpt-5.6-sol'],
    sessionId: 'session-1',
  });
  assert.equal(await authenticate(token({ roles: ['SUPER_ADMIN'] })), null);
});

test('rejects tampering, algorithm confusion, wrong scope and invalid lifetime', async () => {
  const valid = token();
  const [header, payload, signature] = valid.split('.');
  const tamperedSignature = `${signature?.startsWith('A') ? 'B' : 'A'}${signature?.slice(1)}`;
  assert.equal(await authenticate(`${header}.${payload}.${tamperedSignature}`), null);
  assert.equal(await authenticate(token({}, { alg: 'HS256' })), null);
  assert.equal(await authenticate(token({}, { kid: 'unknown-key' })), null);
  assert.equal(await authenticate(token({ aud: 'other-service' })), null);
  assert.equal(await authenticate(token({ scopes: ['models:read'] })), null);
  assert.equal(await authenticate(token({ unexpected: true })), null);
  assert.equal(await authenticate(token({ exp: Math.floor(now / 1_000) - 1 })), null);
  assert.equal(await authenticate(token({ exp: Math.floor(now / 1_000) + 901 })), null);
  assert.equal(await authenticate(token({ nbf: Math.floor(now / 1_000) + 61 })), null);
  assert.equal(await authenticate(token({ modelIds: ['e-mate-faux'] })), null);
  assert.equal(await authenticate(token({ modelIds: ['gpt-5.6-sol', 'gpt-5.6-sol'] })), null);
  assert.equal(await authenticate(token({ tenantId: 'tenant\u0085control' })), null);
});

test('rejects unsafe verifier time configuration', () => {
  assert.throws(
    () =>
      createSessionTokenVerifier({
        issuer: 'e-mate-auth',
        audience: 'e-mate-model-gateway',
        publicKeys: new Map([['auth-2026', publicKey]]),
        clockSkewSeconds: Number.NaN,
      }),
    /configuration/
  );
  assert.throws(
    () =>
      createSessionTokenVerifier({
        issuer: 'e-mate-auth',
        audience: 'e-mate-model-gateway',
        publicKeys: new Map([['auth-2026', publicKey]]),
        maximumLifetimeSeconds: Number.NaN,
      }),
    /configuration/
  );
});
