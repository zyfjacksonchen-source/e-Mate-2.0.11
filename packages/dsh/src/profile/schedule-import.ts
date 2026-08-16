import { join } from 'node:path'
import {
  findLegacyScheduleActivation,
  legacyScheduleActivationPrompt,
  legacyScheduleConfirmation,
  migrateLegacySchedules,
  readLegacyScheduleReceipt,
  recordLegacyScheduleActivation,
} from '../legacy-schedule.js'
import { readManagedBinding, loadTargetTools } from './target-runtime.js'

export const name = 'emate-schedule-import'
export const inject = ['tools']

let activationQueue: Promise<unknown> = Promise.resolve()

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = activationQueue.then(operation, operation)
  activationQueue = result.catch(() => undefined)
  return result
}

function sessionId(exec: any) {
  const value = exec.agent?.id
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error('legacy schedule activation requires a live e-Mate session')
  }
  return value
}

function latestUserText(agent: any) {
  const messages = agent?.session?.deriveMessages?.()
  if (!Array.isArray(messages)) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user' || message?.source?.kind !== 'user' || !Array.isArray(message.content)) continue
    const text = message.content
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('\n')
      .trim()
    return text
  }
  return undefined
}

function publicTask(task: any) {
  return {
    legacy_task_id: task.id,
    name: task.name,
    prompt: task.prompt,
    source_family: task.source_family,
    original_enabled: task.original_enabled,
    status: 'disabled',
    mappable: task.target_args !== undefined,
    blocked_reason: task.blocked_reason ?? null,
    target_rule: task.target_args ?? null,
    target_delivery: 'session-local',
    confirmation_required: legacyScheduleConfirmation(task.id),
    activation_count: task.activations.length,
  }
}

function targetError(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as { code?: unknown }).code === 'string'
}

function nestedInput(exec: any, name: string, argumentsValue: unknown, suffix: string) {
  return {
    callId: `${String(exec.callId)}:emate-legacy-schedule-${suffix}`,
    rootCallId: exec.rootCallId,
    name,
    arguments: argumentsValue,
    agent: exec.agent,
    parent: exec.token,
    signal: exec.signal,
  }
}

export async function activateLegacySchedule(ctx: any, dshHome: string, taskId: string, exec: any) {
  return serial(async () => {
    if (typeof taskId !== 'string' || !/^legacy-schedule-[0-9a-f]{24}$/u.test(taskId)) {
      return { legacy_task_id: String(taskId), enabled: false, code: 'invalid_legacy_task_id', message: 'The legacy schedule task ID is invalid.' }
    }
    const id = sessionId(exec)
    const receipt = readLegacyScheduleReceipt(dshHome)
    if (receipt === undefined) {
      return { legacy_task_id: taskId, enabled: false, code: 'no_legacy_schedule_source', message: 'No legacy schedule import is available.' }
    }
    const task = receipt.tasks.find(candidate => candidate.id === taskId)
    if (task === undefined) {
      return { legacy_task_id: taskId, enabled: false, code: 'legacy_task_not_found', message: 'The legacy schedule task was not found.' }
    }
    if (task.target_args === undefined) {
      return {
        legacy_task_id: taskId,
        enabled: false,
        code: 'legacy_task_not_mappable',
        message: task.blocked_reason ?? 'The target Schedule plugin cannot represent this task.',
      }
    }
    const required = legacyScheduleConfirmation(task.id)
    if (latestUserText(exec.agent) !== required) {
      return {
        legacy_task_id: taskId,
        enabled: false,
        code: 'confirmation_required',
        message: `Ask the user to reply exactly: ${required}`,
      }
    }
    const recorded = findLegacyScheduleActivation(task, id)
    if (recorded !== undefined) {
      return {
        legacy_task_id: taskId,
        enabled: true,
        already_enabled: true,
        target_schedule: { id: recorded.target_schedule_id },
      }
    }

    const prompt = legacyScheduleActivationPrompt(task)
    const listed = await ctx.tools.execute(nestedInput(exec, 'schedule_list', {}, 'list'))
    if (listed.isError) throw new Error('the target Schedule list operation failed')
    if (targetError(listed.value)) {
      return {
        legacy_task_id: taskId,
        enabled: false,
        code: listed.value.code,
        message: listed.value.message,
      }
    }
    if (!Array.isArray(listed.value)) throw new Error('the target Schedule list result is invalid')
    const recovered = listed.value.find(value => value?.prompt === prompt && typeof value?.id === 'string')
    if (recovered !== undefined) {
      recordLegacyScheduleActivation(dshHome, task.id, id, recovered.id)
      return {
        legacy_task_id: taskId,
        enabled: true,
        already_enabled: true,
        target_schedule: recovered,
      }
    }

    const created = await ctx.tools.execute(nestedInput(exec, 'schedule_create', {
      prompt,
      ...task.target_args,
    }, 'create'))
    if (created.isError) throw new Error('the target Schedule create operation failed')
    if (targetError(created.value)) {
      return {
        legacy_task_id: taskId,
        enabled: false,
        code: created.value.code,
        message: created.value.message,
      }
    }
    if (created.value === null || typeof created.value !== 'object' || Array.isArray(created.value)
      || typeof (created.value as { id?: unknown }).id !== 'string') {
      throw new Error('the target Schedule create result is invalid')
    }
    recordLegacyScheduleActivation(dshHome, task.id, id, (created.value as { id: string }).id)
    return {
      legacy_task_id: taskId,
      enabled: true,
      already_enabled: false,
      target_schedule: created.value,
    }
  })
}

const listOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: { type: 'array', required: true, items: { type: 'json' } },
    },
  },
  render: (_args: unknown, value: any) => [{
    type: 'text',
    text: value.items.length === 0
      ? 'No legacy scheduled tasks were found.'
      : value.items.map((item: any) => (
        `- ${item.name} (${item.legacy_task_id}): disabled; `
        + (item.mappable ? `reply exactly “${item.confirmation_required}” to enable in this session` : `blocked: ${item.blocked_reason}`)
      )).join('\n'),
  }],
}

const enableOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      legacy_task_id: { type: 'string', required: true },
      enabled: { type: 'boolean', required: true },
      already_enabled: { type: 'boolean' },
      code: { type: 'string' },
      message: { type: 'string' },
      target_schedule: { type: 'json' },
    },
  },
  render: (_args: unknown, value: any) => [{
    type: 'text',
    text: value.enabled
      ? `Legacy task ${value.legacy_task_id} is now owned by the target Schedule plugin as ${value.target_schedule.id}.`
      : `Legacy task ${value.legacy_task_id} remains disabled: ${value.message}`,
  }],
}

export async function apply(ctx: any, config: any = {}) {
  const bindingPath = config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json')
  const binding = readManagedBinding(bindingPath)
  const dshHome = config.dshHome ?? binding.dsh_home
  migrateLegacySchedules({
    dshHome,
    home: config.home,
    environment: config.environment,
    platform: config.platform,
    sources: config.legacyScheduleSources,
  })
  const { defineTool } = await loadTargetTools(bindingPath)

  ctx.tools.register(defineTool({
    name: 'e_mate_schedule_import_list',
    description: 'List old e-Mate/CowAgent scheduled tasks staged locally as disabled. This Tool never starts a timer or changes the target Schedule stream.',
    parameters: {},
    output: listOutput,
    execute: async () => ({ items: readLegacyScheduleReceipt(dshHome)?.tasks.map(publicTask) ?? [] }),
    presentCall: () => ({ card: 'generic', title: 'List disabled legacy schedules', kind: 'read' }),
  }))

  ctx.tools.register(defineTool({
    name: 'e_mate_schedule_import_enable',
    description: 'Enable one mappable legacy task only after the latest real user message exactly matches the confirmation phrase returned by e_mate_schedule_import_list. Execution delegates to the target schedule_list and schedule_create Tools; this adapter owns no timer.',
    parameters: {
      legacy_task_id: { type: 'string', required: true, description: 'Exact staged legacy task ID returned by e_mate_schedule_import_list.' },
    },
    output: enableOutput,
    execute: (args: any, exec: any) => activateLegacySchedule(ctx, dshHome, args.legacy_task_id, exec),
    presentCall: (args: any) => ({ card: 'generic', title: 'Enable imported schedule', kind: 'write', rawInput: args.legacy_task_id }),
  }))
}
