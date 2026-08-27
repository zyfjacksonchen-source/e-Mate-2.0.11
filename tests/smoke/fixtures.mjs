const CASE_ID = /^CP-(?:0[1-9]|1[0-5])$/u
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u

function safeId(name, value) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`${name} is invalid`)
  return value
}

export function sessionWorkspaceFixture(options = {}) {
  return Object.freeze({
    session: { id: safeId('session id', options.sessionId ?? 'smoke-session'), blank: options.blank ?? true },
    workspace: { id: safeId('workspace id', options.workspaceId ?? 'smoke-workspace'), connected: options.connected ?? true },
  })
}

export function toolRegistryMutationFixture(options = {}) {
  const before = [...(options.before ?? ['tool_search'])]
  const after = [...(options.after ?? ['tool_search', 'late_probe'])]
  for (const value of [...before, ...after]) safeId('Tool name', value)
  if (new Set(before).size !== before.length || new Set(after).size !== after.length) {
    throw new Error('Tool registry fixture names must be unique')
  }
  return Object.freeze({ before, after, selected: safeId('selected Tool', options.selected ?? 'late_probe') })
}

export function visionInputFixture(options = {}) {
  const variant = options.variant ?? 'paste-5-png'
  const capability = options.capability ?? 'image-capable'
  if (!['paste-5-png', 'text-plus-5-png', 'windows-chinese-path', 'mixed-image-pdf-docx'].includes(variant)) {
    throw new Error('Vision input fixture variant is invalid')
  }
  if (!['image-capable', 'capability-unknown', 'confirmed-text-only'].includes(capability)) {
    throw new Error('Vision input fixture capability is invalid')
  }
  return Object.freeze({
    work_order: 'EM-VISION-INPUT-01',
    variant,
    capability,
    durable_image_blocks_unchanged: true,
    request_time_conversion: capability === 'confirmed-text-only',
    owners: variant === 'mixed-image-pdf-docx'
      ? { image: 'native-attachment', pdf: 'file-import', docx: 'file-import' }
      : { image: 'native-attachment' },
    counts: {
      native_attachments: 5,
      model_image_blocks: 5,
      absolute_path_markers: 0,
      skill_find_fallbacks: 0,
      cdp_fallbacks: 0,
      duplicates: 0,
    },
  })
}

export function jobFixture(options = {}) {
  const status = options.status ?? 'succeeded'
  if (!['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(status)) throw new Error('Job status is invalid')
  return Object.freeze({ id: safeId('Job id', options.id ?? 'smoke-job'), status })
}

export function workerFetchFixture(options = {}) {
  const status = options.status ?? 200
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) throw new Error('Worker status is invalid')
  return Object.freeze({ status, ok: status >= 200 && status < 300, body_kind: safeId('Worker body kind', options.bodyKind ?? 'typed-result') })
}

export function updateFailpointFixture(options = {}) {
  const expectedState = options.expectedState ?? 'rolled-back'
  if (!['last-known-good', 'rolled-back', 'blocked'].includes(expectedState)) throw new Error('update failpoint state is invalid')
  return Object.freeze({ name: safeId('failpoint name', options.name ?? 'renderer-health'), expected_state: expectedState })
}

export function probeReceipt(options) {
  if (!CASE_ID.test(options?.caseId) || typeof options?.stageId !== 'string' || !SAFE_ID.test(options.stageId)
    || options.facts === null || typeof options.facts !== 'object' || Array.isArray(options.facts)) {
    throw new Error('probe receipt input is invalid')
  }
  return Object.freeze({
    schema_version: 1,
    case_id: options.caseId,
    stage_id: options.stageId,
    status: options.status ?? 'passed',
    mocked: options.mocked ?? true,
    facts: options.facts,
  })
}
