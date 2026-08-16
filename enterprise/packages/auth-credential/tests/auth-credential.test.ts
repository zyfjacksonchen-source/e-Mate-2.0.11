import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import test from 'node:test';
import {
  AUTH_CREDENTIAL_SCHEMA_SQL,
  derivePasswordVerifier,
  normalizeLoginIdentifier,
  verifyEcorexV0292Password,
  verifyPassword,
} from '../src/index.ts';

test('password derivation is pinned and verifies without exposing plaintext', async () => {
  const verifier = await derivePasswordVerifier('initial-enterprise-password', Buffer.alloc(32, 7));
  assert.deepEqual(
    {
      saltBytes: verifier.salt.byteLength,
      hashBytes: verifier.hash.byteLength,
      cost: verifier.cost,
      blockSize: verifier.blockSize,
      parallelization: verifier.parallelization,
    },
    { saltBytes: 32, hashBytes: 64, cost: 65_536, blockSize: 8, parallelization: 1 }
  );
  assert.equal(await verifyPassword('initial-enterprise-password', verifier), true);
  assert.equal(await verifyPassword('wrong-enterprise-password', verifier), false);
  assert.equal(JSON.stringify(verifier).includes('initial-enterprise-password'), false);
});

test('login normalization and shared schema stay strict', () => {
  assert.equal(normalizeLoginIdentifier('  USER-A  '), 'user-a');
  assert.throws(() => normalizeLoginIdentifier('user\u0000a'), /login identifier/);
  assert.match(AUTH_CREDENTIAL_SCHEMA_SQL, /scrypt_cost integer NOT NULL CHECK \(scrypt_cost = 65536\)/);
  assert.match(AUTH_CREDENTIAL_SCHEMA_SQL, /e_mate_auth_session/);
  assert.match(AUTH_CREDENTIAL_SCHEMA_SQL, /e_mate_auth_refresh_token/);
  assert.match(AUTH_CREDENTIAL_SCHEMA_SQL, /source_version IN \('0\.2\.9\.2', 'admin'\)/);
  assert.match(AUTH_CREDENTIAL_SCHEMA_SQL, /pbkdf2_sha256\\\$180000/);
});

test('v0.2.9.2 verifier accepts only the pinned PBKDF2 encoding', async () => {
  const password = 'unchanged-legacy-password';
  const salt = Buffer.alloc(16, 5);
  const digest = pbkdf2Sync(password, salt, 180_000, 32, 'sha256');
  const encoded = `pbkdf2_sha256$180000$${salt.toString('base64')}$${digest.toString('base64')}`;
  assert.equal(await verifyEcorexV0292Password(password, encoded), true);
  assert.equal(await verifyEcorexV0292Password('wrong-password', encoded), false);
  assert.equal(await verifyEcorexV0292Password(password, encoded.replace('$180000$', '$179999$')), false);
  assert.equal(await verifyEcorexV0292Password(password, `argon2$180000$${encoded}`), false);
  assert.equal(await verifyEcorexV0292Password(password, `${encoded}\n`), false);
});
