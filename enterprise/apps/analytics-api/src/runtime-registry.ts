import { createHash } from 'node:crypto';
import { createClient } from '@redis/client';
import {
  parseRuntimeRegistryHeartbeat,
  parseRuntimeRegistryStatus,
  type RuntimeRegistryHeartbeat,
  type RuntimeRegistryModelStatus,
  type RuntimeRegistryStatus,
} from '@e-mate/runtime-registry-contract';

const heartbeatScript = `
local current = redis.call('GET', KEYS[1])
if current then
  local decoded = cjson.decode(current)
  if decoded.userId ~= ARGV[4] then
    return -1
  end
  if tonumber(ARGV[1]) <= tonumber(decoded.sequence) then
    return 0
  end
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

const deleteScript = `
local current = redis.call('GET', KEYS[1])
if not current then
  return 1
end
local decoded = cjson.decode(current)
if decoded.userId ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[1])
return 1
`;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const principalPattern = /^[^\p{Cc}]{1,128}$/u;
const maxInstancesPerTenant = 10_000;

export type RuntimeRegistryPrincipal = {
  tenantId: string;
  userId: string;
  roles: string[];
  scopes?: string[];
  projectIds?: string[];
};

export type RuntimeRegistryStore = {
  heartbeat(principal: RuntimeRegistryPrincipal, heartbeat: RuntimeRegistryHeartbeat): Promise<boolean>;
  remove(principal: Pick<RuntimeRegistryPrincipal, 'tenantId' | 'userId'>, runtimeInstanceId: string): Promise<boolean>;
  status(tenantId: string): Promise<RuntimeRegistryStatus>;
};

export type RedisRegistryAdapter = {
  eval(script: string, keys: string[], arguments_: string[]): Promise<unknown>;
  scan(match: string, limit: number): Promise<string[]>;
  mGet(keys: string[]): Promise<Array<string | null>>;
};

type StoredLease = RuntimeRegistryHeartbeat & {
  tenantId: string;
  userId: string;
  receivedAt: string;
};

function identifier(value: string, label: string): string {
  if (!identifierPattern.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function principalIdentifier(value: string, label: string): string {
  if (!principalPattern.test(value) || value.trim() !== value) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function tenantPrefix(tenantId: string): string {
  const digest = createHash('sha256').update(identifier(tenantId, 'tenant id')).digest('base64url');
  return `emate:runtime:v1:${digest}:instance:`;
}

function leaseKey(tenantId: string, runtimeInstanceId: string): string {
  return `${tenantPrefix(tenantId)}${identifier(runtimeInstanceId, 'instance id')}`;
}

function parseStoredLease(value: string, expectedTenantId: string): StoredLease {
  const input = JSON.parse(value) as Record<string, unknown>;
  const tenantId = principalIdentifier(String(input.tenantId ?? ''), 'stored tenant id');
  const userId = principalIdentifier(String(input.userId ?? ''), 'stored user id');
  const receivedAt =
    typeof input.receivedAt === 'string' && new Date(input.receivedAt).toISOString() === input.receivedAt
      ? input.receivedAt
      : (() => {
          throw new Error('Invalid stored receipt time');
        })();
  if (tenantId !== expectedTenantId) {
    throw new Error('Stored Runtime lease tenant mismatch');
  }
  const { tenantId: _tenantId, userId: _userId, receivedAt: _receivedAt, ...heartbeatInput } = input;
  return {
    ...parseRuntimeRegistryHeartbeat(heartbeatInput),
    tenantId,
    userId,
    receivedAt,
  };
}

function worstModelStatus(
  current: RuntimeRegistryModelStatus,
  next: RuntimeRegistryModelStatus
): RuntimeRegistryModelStatus {
  const rank: Record<RuntimeRegistryModelStatus, number> = {
    HEALTHY: 0,
    DEGRADED: 1,
    UNAVAILABLE: 2,
  };
  return rank[next] > rank[current] ? next : current;
}

export class RedisRuntimeRegistry implements RuntimeRegistryStore {
  readonly #redis: RedisRegistryAdapter;
  readonly #ttlMs: number;
  readonly #now: () => number;

  constructor(redis: RedisRegistryAdapter, options: { ttlMs?: number; now?: () => number } = {}) {
    this.#redis = redis;
    this.#ttlMs = options.ttlMs ?? 30_000;
    this.#now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.#ttlMs) || this.#ttlMs < 1_000) {
      throw new Error('Runtime Registry TTL was invalid');
    }
  }

  async heartbeat(principal: RuntimeRegistryPrincipal, heartbeatInput: RuntimeRegistryHeartbeat): Promise<boolean> {
    const tenantId = principalIdentifier(principal.tenantId, 'tenant id');
    const userId = principalIdentifier(principal.userId, 'user id');
    const heartbeat = parseRuntimeRegistryHeartbeat(heartbeatInput);
    const lease: StoredLease = {
      ...heartbeat,
      tenantId,
      userId,
      receivedAt: new Date(this.#now()).toISOString(),
    };
    const result = await this.#redis.eval(
      heartbeatScript,
      [leaseKey(tenantId, heartbeat.runtimeInstanceId)],
      [String(heartbeat.sequence), JSON.stringify(lease), String(this.#ttlMs), userId]
    );
    return result === 1;
  }

  async remove(
    principal: Pick<RuntimeRegistryPrincipal, 'tenantId' | 'userId'>,
    runtimeInstanceId: string
  ): Promise<boolean> {
    const tenantId = principalIdentifier(principal.tenantId, 'tenant id');
    const userId = principalIdentifier(principal.userId, 'user id');
    const result = await this.#redis.eval(deleteScript, [leaseKey(tenantId, runtimeInstanceId)], [userId]);
    return result === 1;
  }

  async status(tenantIdInput: string): Promise<RuntimeRegistryStatus> {
    const tenantId = principalIdentifier(tenantIdInput, 'tenant id');
    const keys = await this.#redis.scan(`${tenantPrefix(tenantId)}*`, maxInstancesPerTenant);
    if (keys.length > maxInstancesPerTenant) {
      throw new Error('Runtime Registry instance limit exceeded');
    }
    const values: Array<string | null> = [];
    for (let index = 0; index < keys.length; index += 500) {
      values.push(...(await this.#redis.mGet(keys.slice(index, index + 500))));
    }
    const users = new Set<string>();
    const sessions = new Set<string>();
    const runningTasks = new Set<string>();
    const failedTasks = new Set<string>();
    let modelStatus: RuntimeRegistryModelStatus = 'HEALTHY';
    let updatedAt: string | null = null;
    let hasLease = false;
    for (const value of values) {
      if (value === null) continue;
      const lease = parseStoredLease(value, tenantId);
      users.add(lease.userId);
      lease.activeSessionIds.forEach((id) => sessions.add(id));
      lease.runningTaskIds.forEach((id) => runningTasks.add(id));
      lease.failedTaskIds.forEach((id) => failedTasks.add(id));
      modelStatus = worstModelStatus(modelStatus, lease.modelStatus);
      if (updatedAt === null || lease.receivedAt > updatedAt) {
        updatedAt = lease.receivedAt;
      }
      hasLease = true;
    }
    if (!hasLease) modelStatus = 'UNAVAILABLE';
    return parseRuntimeRegistryStatus({
      schemaVersion: 1,
      activeUsers: users.size,
      activeSessions: sessions.size,
      runningTasks: runningTasks.size,
      failedTasks: failedTasks.size,
      modelStatus,
      updatedAt: updatedAt ?? new Date(this.#now()).toISOString(),
    });
  }
}

type RedisClientSubset = {
  on(event: 'error', listener: (error: Error) => void): unknown;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<string | string[]>;
  mGet(keys: string[]): Promise<Array<string | null>>;
};

export async function openRedisRuntimeRegistry(
  url: string,
  options: { ttlMs?: number } = {}
): Promise<{ registry: RedisRuntimeRegistry; close: () => Promise<void> }> {
  const parsed = new URL(url);
  const privateService = parsed.hostname === 'redis';
  if (
    (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') ||
    !parsed.hostname ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol === 'redis:' && !privateService && !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
  ) {
    throw new Error('Redis URL was invalid');
  }
  const client = createClient({ url }) as unknown as RedisClientSubset;
  client.on('error', () => undefined);
  await client.connect();
  const adapter: RedisRegistryAdapter = {
    eval: (script, keys, arguments_) => client.eval(script, { keys, arguments: arguments_ }),
    scan: async (match, limit) => {
      const keys: string[] = [];
      for await (const page of client.scanIterator({ MATCH: match, COUNT: 100 })) {
        keys.push(...(Array.isArray(page) ? page : [page]));
        if (keys.length > limit) break;
      }
      return keys;
    },
    mGet: (keys) => client.mGet(keys),
  };
  return {
    registry: new RedisRuntimeRegistry(adapter, options),
    close: async () => {
      await client.quit();
    },
  };
}
