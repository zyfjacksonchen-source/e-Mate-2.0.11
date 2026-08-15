import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_TOKEN_SESSION_KEY,
  AdminApiError,
  abbreviateAuditValue,
  createTenantUser,
  deleteTenantUser,
  issueApiKey,
  loadApiKeys,
  loadConsentAcceptances,
  loadRuntimeStatus,
  resetTenantUserPassword,
  resolveSameOriginPath,
  resolveUsageDashboardPath,
  updateModelRouteKey,
  updateTenantUser,
} from '../src/api.ts';

const origin = 'https://admin.example.test';

test('admin API paths must stay on the console origin', () => {
  assert.equal(
    resolveSameOriginPath('/e-mate/enterprise-api/', '/runtime/status', origin),
    '/e-mate/enterprise-api/runtime/status'
  );
  assert.throws(
    () => resolveSameOriginPath('https://attacker.example/runtime', '/runtime/status', origin),
    /must share/
  );
});

test('usage links are emitted only for same-origin deployments', () => {
  assert.equal(resolveUsageDashboardPath('/e-mate/usage/', origin), '/e-mate/usage/');
  assert.equal(resolveUsageDashboardPath(undefined, origin), null);
  assert.throws(() => resolveUsageDashboardPath('https://attacker.example/usage', origin), /must share/);
});

test('admin credentials use a session key separate from the usage read token', () => {
  assert.equal(ADMIN_TOKEN_SESSION_KEY, 'e-mate.admin.access-token');
  assert.notEqual(ADMIN_TOKEN_SESSION_KEY, 'e-mate.usage.read-token');
});

test('audit identifiers stay readable while long values are safely abbreviated', () => {
  assert.equal(abbreviateAuditValue('acceptance-1'), 'acceptance-1');
  assert.equal(abbreviateAuditValue('a'.repeat(64)), `${'a'.repeat(12)}…${'a'.repeat(8)}`);
});

test('runtime status uses bearer authentication without putting the token in the URL', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const status = await loadRuntimeStatus('secret-token', new AbortController().signal, {
    origin,
    fetcher: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          activeUsers: 3,
          activeSessions: 4,
          runningTasks: 2,
          failedTasks: 1,
          modelStatus: 'HEALTHY',
          updatedAt: '2026-07-30T10:00:00.000Z',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  });

  assert.equal(status.activeUsers, 3);
  assert.equal(calls[0]?.input, '/runtime/status');
  assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'Bearer secret-token');
  assert.equal(calls[0]?.input.includes('secret-token'), false);
  assert.equal(calls[0]?.init?.credentials, 'same-origin');
});

test('runtime status rejects forbidden roles and malformed server facts', async () => {
  await assert.rejects(
    loadRuntimeStatus('invalid token', new AbortController().signal, {
      origin,
      fetcher: async () => new Response('{}', { status: 200 }),
    }),
    (error: unknown) => error instanceof AdminApiError && error.status === 401
  );

  await assert.rejects(
    loadRuntimeStatus('token', new AbortController().signal, {
      origin,
      fetcher: async () => new Response('{}', { status: 403 }),
    }),
    (error: unknown) => error instanceof AdminApiError && error.status === 403
  );

  await assert.rejects(
    loadRuntimeStatus('token', new AbortController().signal, {
      origin,
      fetcher: async () => new Response(JSON.stringify({ schemaVersion: 1 }), { status: 200 }),
    }),
    /Invalid runtime registry status/
  );
});

test('consent audit requests retain audit evidence without sending tenant or policy bodies', async () => {
  let call: { input: string; init?: RequestInit } | undefined;
  const result = await loadConsentAcceptances(
    'admin-token',
    new AbortController().signal,
    {
      origin,
      fetcher: async (input, init) => {
        call = { input: String(input), init };
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            acceptances: [
              {
                schemaVersion: 1,
                acceptanceId: 'acceptance-1',
                userId: 'user-1',
                agreementId: 'e-mate-platform-terms',
                agreementVersion: '1.0.0',
                disclaimerVersion: '1.0.0',
                contentHash: 'a'.repeat(64),
                acceptedAt: '2026-08-02T10:00:00.000Z',
                clientVersion: '2.1.46',
                locale: 'zh-CN',
              },
            ],
          }),
          { status: 200 }
        );
      },
    },
    { userId: 'user-1', agreementVersion: '1.0.0', limit: 50 }
  );
  assert.equal(result.acceptances[0]?.acceptanceId, 'acceptance-1');
  assert.equal(result.acceptances[0]?.agreementId, 'e-mate-platform-terms');
  assert.equal(result.acceptances[0]?.contentHash, 'a'.repeat(64));
  assert.equal(call?.input, '/v1/admin/consents?userId=user-1&agreementVersion=1.0.0&limit=50');
  assert.equal(call?.input.includes('tenantId'), false);
  assert.equal(call?.init?.method, 'GET');
  assert.equal(call?.init?.body, undefined);
});

test('admin mutations derive tenant server-side and task secrets never appear in list responses', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const responses = [
    new Response(
      JSON.stringify({
        schemaVersion: 1,
        userId: 'user-1',
        displayName: 'Employee',
        roles: ['MEMBER'],
        status: 'ACTIVE',
        tokenLimit: 50_000,
        allowedModelIds: ['gpt-5.6-sol'],
        createdAt: '2026-07-30T10:00:00.000Z',
        updatedAt: '2026-07-30T10:00:00.000Z',
      }),
      { status: 201 }
    ),
    new Response(
      JSON.stringify({
        schemaVersion: 1,
        userId: 'user-1',
        displayName: 'Employee',
        roles: ['MEMBER'],
        status: 'ACTIVE',
        tokenLimit: 75_000,
        allowedModelIds: ['gpt-5.6-sol'],
        createdAt: '2026-07-30T10:00:00.000Z',
        updatedAt: '2026-07-31T10:00:00.000Z',
      }),
      { status: 200 }
    ),
    new Response(JSON.stringify({ schemaVersion: 1, keys: [] }), { status: 200 }),
    new Response(
      JSON.stringify({
        schemaVersion: 1,
        key: {
          schemaVersion: 1,
          keyId: 'key-1',
          label: 'Desktop',
          principalType: 'DEVICE',
          principalId: 'device-1',
          userId: 'user-1',
          scopes: ['task-events:write'],
          createdAt: '2026-07-30T10:00:00.000Z',
          lastUsedAt: null,
          revokedAt: null,
        },
        secret: `emate_twe_${'a'.repeat(43)}`,
      }),
      { status: 201 }
    ),
  ];
  const options = {
    origin,
    fetcher: async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return responses.shift() as Response;
    },
  };
  const signal = new AbortController().signal;
  await createTenantUser('admin-token', signal, options, {
    schemaVersion: 1,
    userId: 'user-1',
    displayName: 'Employee',
    roles: ['MEMBER'],
    tokenLimit: 50_000,
    allowedModelIds: ['gpt-5.6-sol'],
    initialPassword: 'InitialPass-2026!',
  });
  await updateTenantUser('admin-token', signal, options, 'user-1', {
    schemaVersion: 1,
    displayName: 'Employee',
    roles: ['MEMBER'],
    status: 'ACTIVE',
    tokenLimit: 75_000,
    allowedModelIds: ['gpt-5.6-sol'],
    expectedUpdatedAt: '2026-07-30T10:00:00.000Z',
  });
  const keys = await loadApiKeys('admin-token', signal, options);
  const issued = await issueApiKey('admin-token', signal, options, {
    schemaVersion: 1,
    label: 'Desktop',
    principalType: 'DEVICE',
    principalId: 'device-1',
    userId: 'user-1',
    scopes: ['task-events:write'],
  });

  assert.equal(JSON.stringify(keys).includes('emate_twe_'), false);
  assert.match(issued.secret, /^emate_twe_/);
  const userBody = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
  assert.equal('tenantId' in userBody, false);
  assert.equal(userBody.initialPassword, 'InitialPass-2026!');
  assert.equal((JSON.parse(String(calls[1]?.init?.body)) as { tokenLimit: number }).tokenLimit, 75_000);
  assert.equal(new Headers(calls[0]?.init?.headers).get('authorization'), 'Bearer admin-token');
  assert.equal(
    calls.some((call) => call.input.includes('admin-token')),
    false
  );
});

test('password reset uses the isolated tenant user password endpoint', async () => {
  let call: { input: string; init?: RequestInit } | undefined;
  await resetTenantUserPassword(
    'admin-token',
    new AbortController().signal,
    {
      origin,
      fetcher: async (input, init) => {
        call = { input: String(input), init };
        return new Response(null, { status: 204 });
      },
    },
    'user/1',
    { schemaVersion: 1, password: 'Replacement-2026!' }
  );
  assert.equal(call?.input, '/v1/admin/users/user%2F1/password');
  assert.equal(call?.init?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(call?.init?.body)), {
    schemaVersion: 1,
    password: 'Replacement-2026!',
  });
});

test('user deletion uses the tenant-scoped DELETE endpoint with optimistic concurrency', async () => {
  let call: { input: string; init?: RequestInit } | undefined;
  await deleteTenantUser(
    'admin-token',
    new AbortController().signal,
    {
      origin,
      fetcher: async (input, init) => {
        call = { input: String(input), init };
        return new Response(null, { status: 204 });
      },
    },
    'user/1',
    {
      schemaVersion: 1,
      expectedUpdatedAt: '2026-07-30T10:00:00.000Z',
    }
  );

  assert.equal(call?.input, '/v1/admin/users/user%2F1');
  assert.equal(call?.init?.method, 'DELETE');
  assert.deepEqual(JSON.parse(String(call?.init?.body)), {
    schemaVersion: 1,
    expectedUpdatedAt: '2026-07-30T10:00:00.000Z',
  });
});

test('model route key updates use the write-only key endpoint', async () => {
  const apiKey = 'provider-key-that-is-long-enough';
  let call: { input: string; init?: RequestInit } | undefined;
  const route = await updateModelRouteKey(
    'admin-token',
    new AbortController().signal,
    {
      origin,
      fetcher: async (input, init) => {
        call = { input: String(input), init };
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            routeId: 'gpt-5.6-sol',
            label: 'Sol',
            provider: 'OpenAI',
            enabled: true,
            updatedAt: null,
            keyConfigured: true,
            keyUpdatedAt: '2026-07-31T10:00:00.000Z',
          }),
          { status: 200 }
        );
      },
    },
    'gpt-5.6-sol',
    {
      schemaVersion: 1,
      apiKey,
    }
  );

  assert.equal(route.keyConfigured, true);
  assert.equal(JSON.stringify(route).includes(apiKey), false);
  assert.equal(call?.input, '/v1/admin/model-routes/gpt-5.6-sol/key');
  assert.equal(call?.init?.method, 'PUT');
  assert.equal((JSON.parse(String(call?.init?.body)) as { apiKey: string }).apiKey, apiKey);
});
