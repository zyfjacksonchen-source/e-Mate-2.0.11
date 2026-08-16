import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import test from 'node:test';
import type { Pool } from 'pg';
import { createAccessSessionAuthenticator } from '../src/access-session-auth.ts';

function token(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  now: number,
  roles: string[] = ['TENANT_ADMIN']
): string {
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'e-mate-auth-session+jwt', kid: 'auth-1' })).toString(
    'base64url'
  );
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      iss: 'https://auth.example.test',
      aud: 'e-mate-admin',
      sub: 'admin-1',
      sid: randomUUID(),
      tenantId: 'tenant-1',
      roles,
      weeklyTokenLimit: 1_000_000,
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: randomUUID(),
    })
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign(null, Buffer.from(input, 'ascii'), privateKey).toString('base64url')}`;
}

test('password-session bearer is signature checked and revalidated against the active database session', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const now = 1_786_742_400;
  let calls = 0;
  const pool = {
    async query(_sql: string, values: unknown[]) {
      calls += 1;
      assert.equal(values[1], 'tenant-1');
      assert.equal(values[2], 'admin-1');
      assert.equal(values[3], 'e-mate-admin');
      return { rows: [{ roles: ['TENANT_ADMIN'] }] };
    },
  } as unknown as Pool;
  const authenticate = createAccessSessionAuthenticator(pool, {
    issuer: 'https://auth.example.test',
    audience: 'e-mate-admin',
    clientId: 'e-mate-admin',
    publicKeys: new Map([['auth-1', publicKey]]),
    now: () => now * 1_000,
  });
  const valid = token(privateKey, now);

  assert.deepEqual(await authenticate(valid), {
    tenantId: 'tenant-1',
    userId: 'admin-1',
    roles: ['TENANT_ADMIN'],
  });
  assert.equal(calls, 1);
  const parts = valid.split('.');
  const signature = parts[2] as string;
  const tampered = `${parts[0]}.${parts[1]}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  assert.equal(await authenticate(tampered), null);
  assert.equal(calls, 1);
  assert.equal(await authenticate(token(privateKey, now, ['SUPER_ADMIN'])), null);
  assert.equal(calls, 1);
});
