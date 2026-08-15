const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ObservabilityPolicy = {
  schemaVersion: 1;
  version: number;
  traceSampleRatio: number;
  metadataRetentionDays: 30;
  contentCapture: 'NONE';
  updatedAt: string;
};

export type ObservabilityPolicyUpdate = {
  schemaVersion: 1;
  requestId: string;
  expectedVersion: number;
  traceSampleRatio: number;
};

export type ObservabilityPolicyRollback = {
  schemaVersion: 1;
  requestId: string;
  expectedVersion: number;
  targetVersion: number;
};

export type ObservabilityPolicyUpdateIntent = ObservabilityPolicyUpdate;
export type ObservabilityPolicyRollbackIntent = ObservabilityPolicyRollback;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function exact(input: Record<string, unknown>, fields: string[], label: string): void {
  if (Object.keys(input).toSorted().join('|') !== [...fields].toSorted().join('|')) {
    throw new Error(`Invalid ${label} fields`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`Invalid ${label}`);
  }
  return Number(value);
}

function sampleRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Invalid trace sample ratio');
  }
  return value;
}

function requestId(value: unknown): string {
  if (typeof value !== 'string' || !requestIdPattern.test(value)) {
    throw new Error('Invalid observability policy request ID');
  }
  return value;
}

function timestamp(value: unknown): string {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (typeof value !== 'string' || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error('Invalid observability policy timestamp');
  }
  return value;
}

export function parseObservabilityPolicy(value: unknown): ObservabilityPolicy {
  const input = record(value, 'observability policy');
  exact(
    input,
    ['schemaVersion', 'version', 'traceSampleRatio', 'metadataRetentionDays', 'contentCapture', 'updatedAt'],
    'observability policy'
  );
  if (input.schemaVersion !== 1 || input.metadataRetentionDays !== 30 || input.contentCapture !== 'NONE') {
    throw new Error('Invalid observability policy');
  }
  return {
    schemaVersion: 1,
    version: positiveInteger(input.version, 'observability policy version'),
    traceSampleRatio: sampleRatio(input.traceSampleRatio),
    metadataRetentionDays: 30,
    contentCapture: 'NONE',
    updatedAt: timestamp(input.updatedAt),
  };
}

export function parseObservabilityPolicyUpdate(value: unknown): ObservabilityPolicyUpdate {
  const input = record(value, 'observability policy update');
  exact(input, ['schemaVersion', 'requestId', 'expectedVersion', 'traceSampleRatio'], 'observability policy update');
  if (input.schemaVersion !== 1) {
    throw new Error('Invalid observability policy update');
  }
  return {
    schemaVersion: 1,
    requestId: requestId(input.requestId),
    expectedVersion: positiveInteger(input.expectedVersion, 'expected version'),
    traceSampleRatio: sampleRatio(input.traceSampleRatio),
  };
}

export function parseObservabilityPolicyRollback(value: unknown): ObservabilityPolicyRollback {
  const input = record(value, 'observability policy rollback');
  exact(input, ['schemaVersion', 'requestId', 'expectedVersion', 'targetVersion'], 'observability policy rollback');
  if (input.schemaVersion !== 1) {
    throw new Error('Invalid observability policy rollback');
  }
  const expectedVersion = positiveInteger(input.expectedVersion, 'expected version');
  const targetVersion = positiveInteger(input.targetVersion, 'target version');
  if (targetVersion >= expectedVersion) {
    throw new Error('Invalid observability policy rollback target');
  }
  return {
    schemaVersion: 1,
    requestId: requestId(input.requestId),
    expectedVersion,
    targetVersion,
  };
}

export const parseObservabilityPolicyUpdateIntent = parseObservabilityPolicyUpdate;
export const parseObservabilityPolicyRollbackIntent = parseObservabilityPolicyRollback;
