import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

const RECEIPT_SCHEMA = 1
const RECEIPT_NAME = 'legacy-schedule-v1.json'
const MAX_STORE_BYTES = 16 * 1024 * 1024
const MAX_TASKS = 10_000
const MAX_TASK_ID_CHARS = 256
const MAX_NAME_CHARS = 512
const MAX_PROMPT_CHARS = 20_000
const MIN_EVERY_SECONDS = 300
const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u

type LegacyScheduleFamily = 'emate-runtime' | 'ecorex-runtime' | 'cowagent'
type JsonRecord = Record<string, unknown>

export interface LegacyScheduleSource {
  family: LegacyScheduleFamily
  root: string
}

type TargetScheduleArgs = { at: string } | { every_seconds: number }

export interface StagedLegacySchedule {
  id: string
  source_family: LegacyScheduleFamily
  source_root_sha256: string
  source_task_id_sha256: string
  source_digest: string
  name: string
  prompt: string
  original_enabled: boolean
  status: 'disabled'
  target_args?: TargetScheduleArgs
  blocked_reason?: string
  activations: Array<{
    session_id_sha256: string
    target_schedule_id: string
    activated_at: string
  }>
}

interface LegacyScheduleReceipt {
  schema_version: 1
  completed_at: string
  source_fingerprints: string[]
  tasks: StagedLegacySchedule[]
}

export interface LegacyScheduleMigrationResult {
  source_found: boolean
  imported_tasks: number
  reused_tasks: number
  blocked_tasks: number
  receipt_path: string
  source_fingerprints: string[]
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function atomicJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function safeCanonicalRoot(path: string) {
  const absolute = resolve(path)
  if (!existsSync(absolute)) return undefined
  const metadata = lstatSync(absolute)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('legacy schedule source root is unsafe')
  }
  return realpathSync(absolute)
}

function stableFile(path: string, root: string) {
  const absolute = resolve(path)
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new Error('legacy schedule store escapes its source root')
  }
  let cursor = root
  for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, part)
    const metadata = lstatSync(cursor)
    if (metadata.isSymbolicLink()) throw new Error('legacy schedule store crosses a symbolic link')
  }
  const descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = fstatSync(descriptor)
    if (!before.isFile() || before.size > MAX_STORE_BYTES) {
      throw new Error('legacy schedule store is invalid or too large')
    }
    const content = readFileSync(descriptor)
    const after = fstatSync(descriptor)
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs) {
      throw new Error('legacy schedule store changed while it was read')
    }
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content)
    } catch (error) {
      throw new Error('legacy schedule store is not valid UTF-8', { cause: error })
    }
    return { content, text }
  } finally {
    closeSync(descriptor)
  }
}

export function defaultLegacyScheduleSources(options: {
  home?: string
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
} = {}): LegacyScheduleSource[] {
  const home = resolve(options.home || homedir())
  const environment = options.environment ?? process.env
  const platform = options.platform ?? process.platform
  const candidates: LegacyScheduleSource[] = [
    { family: 'emate-runtime', root: join(home, '.emate') },
    { family: 'ecorex-runtime', root: join(home, 'ECoreX') },
    { family: 'cowagent', root: join(home, '.cow') },
    { family: 'cowagent', root: join(home, 'cow') },
  ]
  if (platform === 'darwin') {
    candidates.splice(1, 0, {
      family: 'ecorex-runtime',
      root: join(home, 'Library', 'Application Support', 'ECoreX'),
    })
  } else if (platform === 'win32') {
    for (const base of [environment.APPDATA, environment.LOCALAPPDATA]) {
      if (!base) continue
      candidates.push({ family: 'ecorex-runtime', root: join(base, 'ECoreX') })
      candidates.push({ family: 'cowagent', root: join(base, 'CowAgent') })
    }
  }
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = `${candidate.family}:${resolve(candidate.root)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function boundedString(value: unknown, label: string, maximum: number) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const result = value.trim()
  if (result.length === 0 || result.length > maximum || result.includes('\0')) {
    throw new Error(`${label} is empty or exceeds its boundary`)
  }
  return result
}

function targetArgs(schedule: unknown): { args?: TargetScheduleArgs; blocked?: string } {
  if (!isRecord(schedule) || typeof schedule.type !== 'string') return { blocked: 'invalid_schedule' }
  if (schedule.type === 'cron') return { blocked: 'cron_not_supported_by_target_schedule_v1' }
  if (schedule.type === 'interval') {
    const seconds = schedule.seconds
    if (!Number.isSafeInteger(seconds) || Number(seconds) <= 0) return { blocked: 'invalid_interval' }
    if (Number(seconds) < MIN_EVERY_SECONDS) return { blocked: 'interval_below_target_minimum' }
    return { args: { every_seconds: Number(seconds) } }
  }
  if (schedule.type === 'once') {
    if (typeof schedule.run_at !== 'string' || !OFFSET_DATE_TIME.test(schedule.run_at)
      || !Number.isFinite(Date.parse(schedule.run_at))) {
      return { blocked: 'absolute_time_zone_missing_or_invalid' }
    }
    return { args: { at: new Date(schedule.run_at).toISOString() } }
  }
  return { blocked: 'unsupported_schedule_type' }
}

function planTask(
  source: LegacyScheduleSource,
  root: string,
  key: string,
  value: unknown,
): StagedLegacySchedule {
  if (!isRecord(value)) throw new Error(`legacy schedule task ${JSON.stringify(key)} is not an object`)
  const taskId = boundedString(value.id, 'legacy schedule task id', MAX_TASK_ID_CHARS)
  if (taskId !== key) throw new Error(`legacy schedule task ${JSON.stringify(key)} has a conflicting identity`)
  const name = boundedString(value.name, 'legacy schedule task name', MAX_NAME_CHARS)
  if (!isRecord(value.action)) throw new Error(`legacy schedule task ${JSON.stringify(key)} has no action object`)
  let prompt: string
  let blockedReason: string | undefined
  if (value.action.type === 'agent_task') {
    prompt = boundedString(value.action.task_description, 'legacy agent task prompt', MAX_PROMPT_CHARS)
  } else if (value.action.type === 'send_message') {
    prompt = boundedString(value.action.content, 'legacy scheduled message', MAX_PROMPT_CHARS)
  } else {
    prompt = `Unsupported legacy action: ${String(value.action.type ?? 'unknown')}`
    blockedReason = 'unsupported_action_type'
  }
  const mapping = targetArgs(value.schedule)
  blockedReason ??= mapping.blocked
  const rootDigest = sha256(root)
  const sourceDigest = sha256(canonicalJson(value))
  return {
    id: `legacy-schedule-${sha256(`${source.family}\u001f${rootDigest}\u001f${taskId}`).slice(0, 24)}`,
    source_family: source.family,
    source_root_sha256: rootDigest,
    source_task_id_sha256: sha256(taskId),
    source_digest: sourceDigest,
    name,
    prompt,
    original_enabled: value.enabled !== false,
    status: 'disabled',
    ...(blockedReason === undefined ? { target_args: mapping.args } : { blocked_reason: blockedReason }),
    activations: [],
  }
}

function validateReceipt(value: unknown): asserts value is LegacyScheduleReceipt {
  if (!isRecord(value) || value.schema_version !== RECEIPT_SCHEMA
    || Object.keys(value).sort().join(',') !== 'completed_at,schema_version,source_fingerprints,tasks'
    || typeof value.completed_at !== 'string' || !Number.isFinite(Date.parse(value.completed_at))
    || !Array.isArray(value.source_fingerprints) || value.source_fingerprints.length > 32
    || value.source_fingerprints.some(item => typeof item !== 'string' || !/^[0-9a-f]{64}$/u.test(item))
    || new Set(value.source_fingerprints).size !== value.source_fingerprints.length
    || !Array.isArray(value.tasks) || value.tasks.length > MAX_TASKS) {
    throw new Error('legacy schedule migration receipt is invalid')
  }
  const ids = new Set<string>()
  for (const task of value.tasks) {
    if (!isRecord(task)
      || !/^legacy-schedule-[0-9a-f]{24}$/u.test(String(task.id))
      || ids.has(String(task.id))
      || !['emate-runtime', 'ecorex-runtime', 'cowagent'].includes(String(task.source_family))
      || !/^[0-9a-f]{64}$/u.test(String(task.source_root_sha256))
      || !/^[0-9a-f]{64}$/u.test(String(task.source_task_id_sha256))
      || !/^[0-9a-f]{64}$/u.test(String(task.source_digest))
      || typeof task.name !== 'string' || task.name.length < 1 || task.name.length > MAX_NAME_CHARS
      || typeof task.prompt !== 'string' || task.prompt.length < 1 || task.prompt.length > MAX_PROMPT_CHARS
      || typeof task.original_enabled !== 'boolean' || task.status !== 'disabled'
      || !Array.isArray(task.activations) || task.activations.length > 1_000) {
      throw new Error('legacy schedule migration receipt contains an invalid task')
    }
    ids.add(String(task.id))
    const hasTarget = isRecord(task.target_args)
      && Object.keys(task.target_args).length === 1
      && ((typeof task.target_args.at === 'string' && OFFSET_DATE_TIME.test(task.target_args.at)
        && Number.isFinite(Date.parse(task.target_args.at)))
        || (Number.isSafeInteger(task.target_args.every_seconds)
          && Number(task.target_args.every_seconds) >= MIN_EVERY_SECONDS))
    const hasBlocker = typeof task.blocked_reason === 'string'
      && task.blocked_reason.length > 0 && task.blocked_reason.length <= 128
    if (Number(hasTarget) + Number(hasBlocker) !== 1) {
      throw new Error('legacy schedule migration receipt task mapping is invalid')
    }
    const sessions = new Set<string>()
    for (const activation of task.activations) {
      if (!isRecord(activation)
        || Object.keys(activation).sort().join(',') !== 'activated_at,session_id_sha256,target_schedule_id'
        || typeof activation.session_id_sha256 !== 'string'
        || !/^[0-9a-f]{64}$/u.test(activation.session_id_sha256)
        || sessions.has(activation.session_id_sha256)
        || typeof activation.target_schedule_id !== 'string'
        || activation.target_schedule_id.length < 1 || activation.target_schedule_id.length > 256
        || typeof activation.activated_at !== 'string' || !Number.isFinite(Date.parse(activation.activated_at))) {
        throw new Error('legacy schedule migration receipt contains an invalid activation')
      }
      sessions.add(activation.session_id_sha256)
    }
  }
}

export function legacyScheduleReceiptPath(dshHome: string) {
  return join(resolve(dshHome), 'e-mate', 'migrations', RECEIPT_NAME)
}

export function readLegacyScheduleReceipt(dshHome: string): LegacyScheduleReceipt | undefined {
  const path = legacyScheduleReceiptPath(dshHome)
  if (!existsSync(path)) return undefined
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error('legacy schedule migration receipt is unreadable', { cause: error })
  }
  validateReceipt(value)
  return value
}

export function legacyScheduleActivationPrompt(task: StagedLegacySchedule) {
  return `[e-Mate legacy schedule ${task.id}]\n${task.prompt}`
}

export function legacyScheduleConfirmation(taskId: string) {
  return `确认启用 ${taskId}`
}

export function recordLegacyScheduleActivation(
  dshHome: string,
  taskId: string,
  sessionId: string,
  targetScheduleId: string,
) {
  const receipt = readLegacyScheduleReceipt(dshHome)
  if (receipt === undefined) throw new Error('legacy schedule migration receipt is missing')
  const task = receipt.tasks.find(candidate => candidate.id === taskId)
  if (task === undefined) throw new Error('legacy schedule task was not found')
  const sessionDigest = sha256(sessionId)
  const existing = task.activations.find(activation => activation.session_id_sha256 === sessionDigest)
  if (existing !== undefined) {
    if (existing.target_schedule_id !== targetScheduleId) {
      throw new Error('legacy schedule activation conflicts with its recorded target')
    }
    return existing
  }
  const activation = {
    session_id_sha256: sessionDigest,
    target_schedule_id: targetScheduleId,
    activated_at: new Date().toISOString(),
  }
  task.activations.push(activation)
  atomicJson(legacyScheduleReceiptPath(dshHome), receipt)
  return activation
}

export function findLegacyScheduleActivation(task: StagedLegacySchedule, sessionId: string) {
  return task.activations.find(activation => activation.session_id_sha256 === sha256(sessionId))
}

export function migrateLegacySchedules(options: {
  dshHome: string
  sources?: LegacyScheduleSource[]
  home?: string
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): LegacyScheduleMigrationResult {
  const dshHome = resolve(options.dshHome)
  const receiptPath = legacyScheduleReceiptPath(dshHome)
  const candidates = options.sources ?? defaultLegacyScheduleSources(options)
  const snapshots: Array<{ fingerprint: string; tasks: StagedLegacySchedule[] }> = []
  let taskCount = 0
  for (const source of candidates) {
    const root = safeCanonicalRoot(source.root)
    if (root === undefined) continue
    if (root === dshHome || root.startsWith(`${dshHome}${sep}`) || dshHome.startsWith(`${root}${sep}`)) {
      throw new Error('legacy schedule source and DSH_HOME must be disjoint')
    }
    const store = join(root, 'scheduler', 'tasks.json')
    if (!existsSync(store)) continue
    const read = stableFile(store, root)
    let payload: unknown
    try {
      payload = JSON.parse(read.text)
    } catch (error) {
      throw new Error('legacy schedule store contains invalid JSON', { cause: error })
    }
    if (!isRecord(payload) || !isRecord(payload.tasks)) throw new Error('legacy schedule store has no tasks object')
    const entries = Object.entries(payload.tasks).sort(([left], [right]) => left.localeCompare(right))
    taskCount += entries.length
    if (taskCount > MAX_TASKS) throw new Error('legacy schedule sources exceed the task boundary')
    snapshots.push({
      fingerprint: sha256(canonicalJson({ family: source.family, root: sha256(root), store: sha256(read.content) })),
      tasks: entries.map(([key, task]) => planTask(source, root, key, task)),
    })
  }
  if (snapshots.length === 0) {
    return {
      source_found: false,
      imported_tasks: 0,
      reused_tasks: 0,
      blocked_tasks: 0,
      receipt_path: receiptPath,
      source_fingerprints: [],
    }
  }
  const sourceFingerprints = snapshots.map(snapshot => snapshot.fingerprint).sort()
  const tasks = snapshots.flatMap(snapshot => snapshot.tasks).sort((left, right) => left.id.localeCompare(right.id))
  const existing = readLegacyScheduleReceipt(dshHome)
  if (existing !== undefined) {
    if (canonicalJson(existing.source_fingerprints) !== canonicalJson(sourceFingerprints)) {
      throw new Error('legacy schedule sources changed after their completed migration')
    }
    const expected = new Map(tasks.map(task => [task.id, task]))
    if (existing.tasks.length !== expected.size || existing.tasks.some((task) => {
      const planned = expected.get(task.id)
      return planned === undefined || task.source_digest !== planned.source_digest
        || task.name !== planned.name || task.prompt !== planned.prompt
        || canonicalJson(task.target_args) !== canonicalJson(planned.target_args)
        || task.blocked_reason !== planned.blocked_reason
    })) {
      throw new Error('legacy schedule receipt conflicts with its completed source plan')
    }
    return {
      source_found: true,
      imported_tasks: 0,
      reused_tasks: tasks.length,
      blocked_tasks: tasks.filter(task => task.blocked_reason !== undefined).length,
      receipt_path: receiptPath,
      source_fingerprints: sourceFingerprints,
    }
  }
  atomicJson(receiptPath, {
    schema_version: RECEIPT_SCHEMA,
    completed_at: new Date().toISOString(),
    source_fingerprints: sourceFingerprints,
    tasks,
  } satisfies LegacyScheduleReceipt)
  return {
    source_found: true,
    imported_tasks: tasks.length,
    reused_tasks: 0,
    blocked_tasks: tasks.filter(task => task.blocked_reason !== undefined).length,
    receipt_path: receiptPath,
    source_fingerprints: sourceFingerprints,
  }
}
