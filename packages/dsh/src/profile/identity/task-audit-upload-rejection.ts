const TASK_AUDIT_UPLOAD_REJECTION = Symbol.for('@e-mate/task-audit-upload-rejection')

export class TaskAuditUploadRejection extends Error {
  readonly [TASK_AUDIT_UPLOAD_REJECTION] = true

  constructor(
    readonly status: 400 | 409,
    readonly kind: 'invalid' | 'conflict',
  ) {
    super('e-Mate enterprise task audit request was rejected')
  }
}

export function isTaskAuditUploadRejection(error: unknown): error is TaskAuditUploadRejection {
  if (!(error instanceof Error)) return false
  const candidate = error as TaskAuditUploadRejection
  return candidate[TASK_AUDIT_UPLOAD_REJECTION] === true
    && (candidate.status === 400 && candidate.kind === 'invalid'
      || candidate.status === 409 && candidate.kind === 'conflict')
}
