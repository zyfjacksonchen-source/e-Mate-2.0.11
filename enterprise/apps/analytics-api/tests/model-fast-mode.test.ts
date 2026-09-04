import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GPT_FAST_MODEL_IDS, parseAdminModelFastModeUpdate, type AdminModelFastMode } from '@e-mate/admin-contract';
import { createModelFastModeControl, ModelFastModeError } from '../src/model-fast-mode.ts';
import { createAnalyticsServer } from '../src/server.ts';

test('GPT fast mode authorizes admins, rejects other models, and changes a batch atomically', async () => {
  let state: AdminModelFastMode = { schemaVersion: 1, revision: 'a'.repeat(64), enabledModelIds: [] };
  let updates = 0;
  const server = createAnalyticsServer({
    authenticate: async (token) => token === 'missing' ? null : ({
      tenantId: 'tenant-a', userId: 'admin-1', roles: [token],
      ...(token === 'scoped' ? { roles: ['TENANT_ADMIN'], scopes: ['models:invoke'] } : {}),
    }),
    modelFastMode: {
      read: async () => state,
      update: async (principal, input) => {
        assert.equal(principal.tenantId, 'tenant-a');
        if (input.expectedRevision !== state.revision) throw new ModelFastModeError('CONFLICT');
        updates += 1;
        state = { schemaVersion: 1, revision: String(updates).repeat(64), enabledModelIds: input.enabled ? input.modelIds : [] };
        return state;
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/admin/model-fast-mode`;
  const request = (token: string, body?: unknown) => fetch(url, {
    method: body ? 'PUT' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  try {
    for (const role of ['MEMBER', 'AUDIT_ADMIN', 'scoped']) assert.equal((await request(role)).status, 403);
    assert.equal((await request('missing')).status, 401);
    assert.deepEqual(await (await request('TENANT_ADMIN')).json(), state);
    const input = { schemaVersion: 1, expectedRevision: state.revision, modelIds: [...GPT_FAST_MODEL_IDS], enabled: true };
    for (const modelIds of [['deepseek'], ['gpt-image-2-pro'], [], ['gpt-5.6-sol', 'gpt-5.6-sol']]) {
      assert.equal((await request('TENANT_ADMIN', { ...input, modelIds })).status, 400);
    }
    assert.equal(updates, 0);
    assert.equal((await request('TENANT_ADMIN', input)).status, 200);
    assert.deepEqual(state.enabledModelIds, GPT_FAST_MODEL_IDS);
    assert.equal(updates, 1);
    assert.equal((await request('TENANT_ADMIN', input)).status, 409);
    assert.equal(updates, 1);
    assert.equal((await request('SUPER_ADMIN', { ...input, expectedRevision: state.revision, enabled: false })).status, 200);
    assert.deepEqual(state.enabledModelIds, []);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('unconfigured service and cross-tenant control fail before touching SSH', async () => {
  const control = createModelFastModeControl({ tenantId: 'tenant-a', sshHost: 'must-not-connect.invalid', privateKeyFile: '/missing', knownHostsFile: '/missing' });
  await assert.rejects(control.read({ tenantId: 'tenant-b', userId: 'admin', roles: ['TENANT_ADMIN'] }),
    (error) => error instanceof ModelFastModeError && error.code === 'FORBIDDEN');
  assert.throws(() => parseAdminModelFastModeUpdate({ schemaVersion: 1, expectedRevision: 'a'.repeat(64), modelIds: ['gpt-5.6-sol'], enabled: 'true' }));
  const server = createAnalyticsServer({ authenticate: async () => ({ tenantId: 'tenant-a', userId: 'admin', roles: ['TENANT_ADMIN'] }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/admin/model-fast-mode`, { headers: { authorization: 'Bearer admin' } });
    assert.equal(response.status, 503);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('SSH bridge uses fixed argv and stdin, parses results, and bounds failures', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'e-mate-fast-mode-'));
  const ssh = join(directory, 'ssh');
  const argsFile = join(directory, 'args');
  const stdinFile = join(directory, 'stdin');
  const previous = {
    path: process.env.PATH,
    args: process.env.E_MATE_FAKE_SSH_ARGS,
    stdin: process.env.E_MATE_FAKE_SSH_STDIN,
    mode: process.env.E_MATE_FAKE_SSH_MODE,
  };
  writeFileSync(ssh, `#!/bin/sh
set -eu
printf '%s\\n' "$@" > "$E_MATE_FAKE_SSH_ARGS"
cat > "$E_MATE_FAKE_SSH_STDIN"
case "$E_MATE_FAKE_SSH_MODE" in
  ok) printf '%s\\n' '{"schemaVersion":1,"revision":"${'b'.repeat(64)}","enabledModelIds":["gpt-5.6-luna"]}' ;;
  conflict) printf '%s\\n' '{"error":"CONFLICT"}' ;;
  fail) exit 23 ;;
  hang) exec sleep 30 ;;
esac
`);
  chmodSync(ssh, 0o700);
  process.env.PATH = `${directory}:${previous.path ?? ''}`;
  process.env.E_MATE_FAKE_SSH_ARGS = argsFile;
  process.env.E_MATE_FAKE_SSH_STDIN = stdinFile;
  process.env.E_MATE_FAKE_SSH_MODE = 'ok';
  const principal = { tenantId: 'tenant-a', userId: 'admin-1', roles: ['TENANT_ADMIN'] };
  const control = createModelFastModeControl({
    tenantId: 'tenant-a', sshHost: 'proxy.example',
    privateKeyFile: '/run/secrets/fast-key', knownHostsFile: '/run/secrets/fast-hosts',
  });
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  try {
    assert.deepEqual(await control.read(principal), {
      schemaVersion: 1, revision: 'b'.repeat(64), enabledModelIds: ['gpt-5.6-luna'],
    });
    assert.deepEqual(readFileSync(argsFile, 'utf8').trimEnd().split('\n'), [
      '-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
      '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5',
      '-o', 'UserKnownHostsFile=/run/secrets/fast-hosts', '-i', '/run/secrets/fast-key',
      'root@proxy.example', 'emate-gpt-fast-mode-v1',
    ]);
    assert.deepEqual(JSON.parse(readFileSync(stdinFile, 'utf8')), {
      tenantId: 'tenant-a', actorId: 'admin-1',
    });
    const update = {
      schemaVersion: 1 as const, expectedRevision: 'a'.repeat(64),
      modelIds: ['gpt-5.6-luna' as const], enabled: true,
    };
    await control.update(principal, update);
    assert.deepEqual(JSON.parse(readFileSync(stdinFile, 'utf8')), {
      tenantId: 'tenant-a', actorId: 'admin-1', update,
    });

    process.env.E_MATE_FAKE_SSH_MODE = 'conflict';
    await assert.rejects(control.update(principal, update),
      (error) => error instanceof ModelFastModeError && error.code === 'CONFLICT');
    process.env.E_MATE_FAKE_SSH_MODE = 'fail';
    await assert.rejects(control.read(principal),
      (error) => error instanceof ModelFastModeError && error.code === 'UNAVAILABLE');

    process.env.E_MATE_FAKE_SSH_MODE = 'hang';
    const startedAt = Date.now();
    await assert.rejects(control.read(principal),
      (error) => error instanceof ModelFastModeError && error.code === 'UNAVAILABLE');
    assert(Date.now() - startedAt >= 14_000 && Date.now() - startedAt < 25_000);
  } finally {
    restore('PATH', previous.path);
    restore('E_MATE_FAKE_SSH_ARGS', previous.args);
    restore('E_MATE_FAKE_SSH_STDIN', previous.stdin);
    restore('E_MATE_FAKE_SSH_MODE', previous.mode);
    rmSync(directory, { recursive: true, force: true });
  }
});
