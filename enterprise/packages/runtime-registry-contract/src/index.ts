export type RuntimeRegistryModelStatus = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export type RuntimeRegistryHeartbeat = {
  schemaVersion: 1;
  runtimeInstanceId: string;
  sequence: number;
  activeSessionIds: string[];
  runningTaskIds: string[];
  failedTaskIds: string[];
  modelStatus: RuntimeRegistryModelStatus;
  observedAt: string;
};

export type RuntimeRegistryStatus = {
  schemaVersion: 1;
  activeUsers: number;
  activeSessions: number;
  runningTasks: number;
  failedTasks: number;
  modelStatus: RuntimeRegistryModelStatus;
  updatedAt: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(input: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(input);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    throw new Error(`Invalid ${label} fields`);
  }
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${label}`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function modelStatus(value: unknown): RuntimeRegistryModelStatus {
  if (value !== 'HEALTHY' && value !== 'DEGRADED' && value !== 'UNAVAILABLE') {
    throw new Error('Invalid runtime registry model status');
  }
  return value;
}

function identifiers(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error(`Invalid ${label}`);
  }
  const values = value.map((item) => identifier(item, label));
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
  return values;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`Invalid ${label}`);
  }
  return value as number;
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`Invalid ${label}`);
  }
  return value as number;
}

export function parseRuntimeRegistryHeartbeat(value: unknown): RuntimeRegistryHeartbeat {
  const input = record(value, 'runtime registry heartbeat');
  exactKeys(
    input,
    [
      'schemaVersion',
      'runtimeInstanceId',
      'sequence',
      'activeSessionIds',
      'runningTaskIds',
      'failedTaskIds',
      'modelStatus',
      'observedAt',
    ],
    'runtime registry heartbeat'
  );
  if (input.schemaVersion !== 1) throw new Error('Invalid runtime registry heartbeat');
  return {
    schemaVersion: 1,
    runtimeInstanceId: identifier(input.runtimeInstanceId, 'runtime instance ID'),
    sequence: positiveSafeInteger(input.sequence, 'heartbeat sequence'),
    activeSessionIds: identifiers(input.activeSessionIds, 'active session IDs'),
    runningTaskIds: identifiers(input.runningTaskIds, 'running task IDs'),
    failedTaskIds: identifiers(input.failedTaskIds, 'failed task IDs'),
    modelStatus: modelStatus(input.modelStatus),
    observedAt: timestamp(input.observedAt, 'heartbeat observed time'),
  };
}

export function parseRuntimeRegistryStatus(value: unknown): RuntimeRegistryStatus {
  const input = record(value, 'runtime registry status');
  exactKeys(
    input,
    ['schemaVersion', 'activeUsers', 'activeSessions', 'runningTasks', 'failedTasks', 'modelStatus', 'updatedAt'],
    'runtime registry status'
  );
  if (input.schemaVersion !== 1) throw new Error('Invalid runtime registry status');
  return {
    schemaVersion: 1,
    activeUsers: nonNegativeSafeInteger(input.activeUsers, 'active user count'),
    activeSessions: nonNegativeSafeInteger(input.activeSessions, 'active session count'),
    runningTasks: nonNegativeSafeInteger(input.runningTasks, 'running task count'),
    failedTasks: nonNegativeSafeInteger(input.failedTasks, 'failed task count'),
    modelStatus: modelStatus(input.modelStatus),
    updatedAt: timestamp(input.updatedAt, 'status updated time'),
  };
}
