import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRuntimeRegistryHeartbeat, parseRuntimeRegistryStatus } from '../src/index.ts';

const heartbeat = {
  schemaVersion: 1,
  runtimeInstanceId: 'runtime:desktop-1',
  sequence: 1,
  activeSessionIds: ['session-1'],
  runningTaskIds: ['task-1'],
  failedTaskIds: [],
  modelStatus: 'HEALTHY',
  observedAt: '2026-07-26T00:00:00.000Z',
} as const;

test('parses only strict v1 runtime registry facts', () => {
  assert.deepEqual(parseRuntimeRegistryHeartbeat(heartbeat), heartbeat);
  assert.deepEqual(
    parseRuntimeRegistryStatus({
      schemaVersion: 1,
      activeUsers: 1,
      activeSessions: 1,
      runningTasks: 1,
      failedTasks: 0,
      modelStatus: 'DEGRADED',
      updatedAt: '2026-07-26T00:00:00.000Z',
    }),
    {
      schemaVersion: 1,
      activeUsers: 1,
      activeSessions: 1,
      runningTasks: 1,
      failedTasks: 0,
      modelStatus: 'DEGRADED',
      updatedAt: '2026-07-26T00:00:00.000Z',
    }
  );
});

test('rejects malformed, duplicate, oversized and non-exact registry facts', () => {
  for (const invalid of [
    { ...heartbeat, extra: true },
    { ...heartbeat, sequence: 0 },
    { ...heartbeat, runtimeInstanceId: '' },
    { ...heartbeat, activeSessionIds: ['session-1', 'session-1'] },
    { ...heartbeat, runningTaskIds: Array.from({ length: 101 }, (_, index) => `task-${index}`) },
    { ...heartbeat, observedAt: '2026-07-26T00:00:00Z' },
  ]) {
    assert.throws(() => parseRuntimeRegistryHeartbeat(invalid));
  }
  assert.throws(() =>
    parseRuntimeRegistryStatus({
      schemaVersion: 1,
      activeUsers: -1,
      activeSessions: 0,
      runningTasks: 0,
      failedTasks: 0,
      modelStatus: 'HEALTHY',
      updatedAt: '2026-07-26T00:00:00.000Z',
    })
  );
});
