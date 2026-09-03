export const imageFailureCodes = [
  'preflight',
  'rate_limited',
  'provider_rejected',
  'provider_timeout_before_accept',
  'provider_outcome_unknown',
  'attachment_commit',
  'projection',
  'cancelled',
] as const;

export type ImageFailureCode = (typeof imageFailureCodes)[number];
export type ImageObservationStage =
  | 'admission_decision'
  | 'provider_submit'
  | 'provider_outcome'
  | 'client_response';

export type ImageCorrelation = {
  trace_id: string;
  client_request_id: string;
  task_id: string;
  batch_id?: string;
  ordinal?: number;
};

export type ImageObservation = ImageCorrelation & {
  schema_version: 1;
  stage: ImageObservationStage;
  occurred_at: string;
  elapsed_ms: number;
  duration_ms: number;
  outcome: 'admitted' | 'submitted' | 'succeeded' | 'failed';
  failure_code?: ImageFailureCode;
};

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256_ID = /^sha256:[0-9a-f]{64}$/;
const BATCH_CLIENT_ID = /^image-([0-9a-f]{64})$/;
const MAX_DURATION_MS = 600_000;
const STAGES = new Set<ImageObservationStage>([
  'admission_decision', 'provider_submit', 'provider_outcome', 'client_response',
]);
const OUTCOMES = new Set<ImageObservation['outcome']>(['admitted', 'submitted', 'succeeded', 'failed']);
const FAILURE_CODES = new Set<ImageFailureCode>(imageFailureCodes);

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function validatedCorrelation(value: ImageCorrelation): ImageCorrelation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid image correlation');
  const batch = Object.hasOwn(value, 'batch_id') || Object.hasOwn(value, 'ordinal');
  if (!exactKeys(value, ['client_request_id', 'task_id', 'trace_id', ...(batch ? ['batch_id', 'ordinal'] : [])])
    || typeof value.trace_id !== 'string' || !IDENTIFIER.test(value.trace_id)
    || typeof value.client_request_id !== 'string' || !IDENTIFIER.test(value.client_request_id)
    || typeof value.task_id !== 'string' || !IDENTIFIER.test(value.task_id)) throw new Error('Invalid image correlation');
  if (!batch) return {
    trace_id: value.trace_id,
    client_request_id: value.client_request_id,
    task_id: value.task_id,
  };
  const match = BATCH_CLIENT_ID.exec(value.client_request_id);
  if (value.trace_id !== value.client_request_id
    || typeof value.batch_id !== 'string' || !SHA256_ID.test(value.batch_id)
    || !Number.isSafeInteger(value.ordinal) || value.ordinal! < 1 || value.ordinal! > 8
    || !SHA256_ID.test(value.task_id) || match?.[1] !== value.task_id.slice('sha256:'.length)) {
    throw new Error('Invalid image correlation');
  }
  return {
    trace_id: value.trace_id,
    client_request_id: value.client_request_id,
    task_id: value.task_id,
    batch_id: value.batch_id,
    ordinal: value.ordinal,
  };
}

export function boundedDuration(startedAt: number, finishedAt: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)
    || startedAt < 0 || finishedAt < startedAt || finishedAt - startedAt > MAX_DURATION_MS) {
    throw new Error('Invalid image observation timing');
  }
  return Math.round(finishedAt - startedAt);
}

export function imageFailureCode(input: {
  phase: 'preflight' | 'admission' | 'provider' | 'attachment_commit' | 'projection';
  cancelled?: boolean;
  timedOut?: boolean;
  definitelyNotAccepted?: boolean;
  definitelyRejected?: boolean;
  providerSubmitted?: boolean;
}): ImageFailureCode {
  if (input.cancelled && input.providerSubmitted !== true) return 'cancelled';
  if (input.phase === 'preflight') return 'preflight';
  if (input.phase === 'admission') return 'rate_limited';
  if (input.phase === 'attachment_commit') return 'attachment_commit';
  if (input.phase === 'projection') return 'projection';
  if (input.timedOut && input.definitelyNotAccepted) return 'provider_timeout_before_accept';
  if (input.definitelyRejected) return 'provider_rejected';
  return 'provider_outcome_unknown';
}

export function createImageObservation(
  correlation: ImageCorrelation,
  stage: ImageObservationStage,
  requestStartedAt: number,
  stageStartedAt: number,
  finishedAt: number,
  occurredAt: number,
  outcome: ImageObservation['outcome'],
  failure_code?: ImageFailureCode
): ImageObservation {
  const exact = validatedCorrelation(correlation);
  if (!STAGES.has(stage) || !OUTCOMES.has(outcome)
    || !Number.isFinite(occurredAt) || occurredAt < 0
    || !Number.isFinite(new Date(occurredAt).getTime())
    || stageStartedAt < requestStartedAt || finishedAt < stageStartedAt
    || failure_code !== undefined && !FAILURE_CODES.has(failure_code)
    || (outcome === 'failed') !== (failure_code !== undefined)) throw new Error('Invalid image observation');
  return {
    schema_version: 1,
    trace_id: exact.trace_id,
    client_request_id: exact.client_request_id,
    task_id: exact.task_id,
    ...(exact.batch_id === undefined ? {} : { batch_id: exact.batch_id, ordinal: exact.ordinal }),
    stage,
    occurred_at: new Date(occurredAt).toISOString(),
    elapsed_ms: boundedDuration(requestStartedAt, finishedAt),
    duration_ms: boundedDuration(stageStartedAt, finishedAt),
    outcome,
    ...(failure_code === undefined ? {} : { failure_code }),
  };
}
