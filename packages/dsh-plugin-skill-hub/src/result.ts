export const SKILL_HUB_RESULT_SCHEMA_VERSION = 1 as const

export const SKILL_HUB_FAILURE_MESSAGES = {
  auth: 'Skill Hub 登录状态已失效，请重新登录后重试。',
  network: 'Skill Hub 服务暂时不可用，请稍后重试。',
  conflict: 'Skill Hub 状态已发生变化，请刷新后重试。',
  integrity: 'Skill Hub 返回内容未通过完整性校验。',
  recovery: 'Skill Hub 正在恢复上次操作，请稍后重试。',
  'native-provider': '本机 Skill 状态暂时无法读取，请重启 e-Mate 后重试。',
  'bad-request': 'Skill Hub 请求无效，请刷新后重试。',
  cancelled: 'Skill Hub 操作已取消。',
  internal: 'Skill Hub 暂时不可用，请稍后重试。',
  'invalid-response': 'Skill Hub 返回了无法识别的结果，请稍后重试。',
} as const

export type SkillHubFailureCode = keyof typeof SKILL_HUB_FAILURE_MESSAGES
export type SkillHubFailure = { code: SkillHubFailureCode; message: string }
export type SkillHubResult<T> =
  | { schema_version: 1; status: 'success'; value: T }
  | { schema_version: 1; status: 'failure'; error: SkillHubFailure }
export type SkillHubClientResult<T> = { ok: true; value: T } | { ok: false; error: SkillHubFailure }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index])
}

function knownCode(value: unknown): value is SkillHubFailureCode {
  return typeof value === 'string' && Object.hasOwn(SKILL_HUB_FAILURE_MESSAGES, value)
}

export function skillHubError(error: unknown): SkillHubFailure {
  let code: SkillHubFailureCode = 'internal'
  if (isRecord(error) && knownCode(error.code)) code = error.code
  else if (isRecord(error) && error.name === 'AbortError') code = 'cancelled'
  return { code, message: SKILL_HUB_FAILURE_MESSAGES[code] }
}

export function skillHubSuccess<T>(value: T): SkillHubResult<T> {
  return { schema_version: SKILL_HUB_RESULT_SCHEMA_VERSION, status: 'success', value }
}

export function skillHubFailureResult(error: unknown): SkillHubResult<never> {
  return { schema_version: SKILL_HUB_RESULT_SCHEMA_VERSION, status: 'failure', error: skillHubError(error) }
}

export function skillHubClientFailure(code: SkillHubFailureCode): SkillHubClientResult<never> {
  return { ok: false, error: { code, message: SKILL_HUB_FAILURE_MESSAGES[code] } }
}

export function parseSkillHubResult<T = unknown>(value: unknown): SkillHubClientResult<T> {
  if (!isRecord(value) || value.schema_version !== SKILL_HUB_RESULT_SCHEMA_VERSION) {
    return skillHubClientFailure('invalid-response')
  }
  if (value.status === 'success' && exactKeys(value, ['schema_version', 'status', 'value'])) {
    return { ok: true, value: value.value as T }
  }
  if (value.status === 'failure' && exactKeys(value, ['schema_version', 'status', 'error']) && isRecord(value.error)
    && exactKeys(value.error, ['code', 'message']) && knownCode(value.error.code)
    && value.error.message === SKILL_HUB_FAILURE_MESSAGES[value.error.code]) {
    return { ok: false, error: { code: value.error.code, message: value.error.message } }
  }
  return skillHubClientFailure('invalid-response')
}

export function parseSkillHubRpcResult<T = unknown>(transport: unknown): SkillHubClientResult<T> {
  if (!isRecord(transport) || transport.ok !== true || !exactKeys(transport, ['ok', 'value'])) {
    return skillHubClientFailure('invalid-response')
  }
  return parseSkillHubResult<T>(transport.value)
}
