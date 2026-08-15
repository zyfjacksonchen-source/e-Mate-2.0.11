import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { installTestProfile as installProfile } from './runtime-binding.fixture.mjs'
import {
  legacyScheduleConfirmation,
  migrateLegacySchedules,
  readLegacyScheduleReceipt,
} from '../lib/legacy-schedule.js'
import { apply as applyScheduleImport } from '../profile/plugins/schedule-import.js'

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')

function writeStore(root, tasks) {
  const path = join(root, 'scheduler', 'tasks.json')
  mkdirSync(join(root, 'scheduler'), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ version: 1, tasks }, null, 2)}\n`)
  return path
}

function legacyTask(id, schedule, action = { type: 'agent_task', task_description: `Run ${id}` }) {
  return { id, name: `Task ${id}`, enabled: true, schedule, action }
}

test('legacy schedules are copied once as disabled staging records and source drift fails closed', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-legacy-schedule-'))
  const source = join(temporary, 'cow')
  const dshHome = join(temporary, 'dsh-home')
  const store = writeStore(source, {
    interval: legacyTask('interval', { type: 'interval', seconds: 600 }),
    once: legacyTask('once', { type: 'once', run_at: '2099-01-02T03:04:05+08:00' }),
    cron: legacyTask('cron', { type: 'cron', expression: '0 9 * * *' }),
    fast: legacyTask('fast', { type: 'interval', seconds: 30 }),
  })
  const before = digest(store)
  try {
    const first = migrateLegacySchedules({
      dshHome,
      sources: [{ family: 'cowagent', root: source }],
    })
    assert.deepEqual(
      { imported: first.imported_tasks, reused: first.reused_tasks, blocked: first.blocked_tasks },
      { imported: 4, reused: 0, blocked: 2 },
    )
    const receipt = readLegacyScheduleReceipt(dshHome)
    assert.equal(receipt.tasks.every(task => task.status === 'disabled' && task.activations.length === 0), true)
    assert.deepEqual(receipt.tasks.find(task => task.name === 'Task interval').target_args, { every_seconds: 600 })
    assert.deepEqual(receipt.tasks.find(task => task.name === 'Task once').target_args, { at: '2099-01-01T19:04:05.000Z' })
    assert.equal(receipt.tasks.find(task => task.name === 'Task cron').blocked_reason, 'cron_not_supported_by_target_schedule_v1')
    assert.equal(receipt.tasks.find(task => task.name === 'Task fast').blocked_reason, 'interval_below_target_minimum')
    assert.equal(digest(store), before)

    const second = migrateLegacySchedules({
      dshHome,
      sources: [{ family: 'cowagent', root: source }],
    })
    assert.deepEqual({ imported: second.imported_tasks, reused: second.reused_tasks }, { imported: 0, reused: 4 })

    const receiptText = readFileSync(first.receipt_path, 'utf8')
    const tampered = JSON.parse(receiptText)
    tampered.tasks.find(task => task.name === 'Task interval').target_args.every_seconds = 1
    writeFileSync(first.receipt_path, `${JSON.stringify(tampered)}\n`)
    assert.throws(() => readLegacyScheduleReceipt(dshHome), /task mapping is invalid/)
    writeFileSync(first.receipt_path, receiptText)

    writeStore(source, {
      interval: legacyTask('interval', { type: 'interval', seconds: 900 }),
    })
    assert.throws(
      () => migrateLegacySchedules({ dshHome, sources: [{ family: 'cowagent', root: source }] }),
      /changed after their completed migration/,
    )
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('legacy activation requires an exact later user confirmation and delegates to target Schedule Tools', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'e-mate-legacy-schedule-activation-'))
  const source = join(temporary, 'ECoreX')
  const dshHome = join(temporary, 'dsh-home')
  writeStore(source, {
    report: legacyTask('report', { type: 'interval', seconds: 900 }),
  })
  const paths = installProfile(dshHome)
  const registered = new Map()
  const active = []
  const nested = []
  const ctx = {
    tools: {
      register(tool) {
        registered.set(tool.name, tool)
        return () => registered.delete(tool.name)
      },
      async execute(input) {
        nested.push(input)
        if (input.name === 'schedule_list') return { isError: false, value: [...active], content: [] }
        if (input.name === 'schedule_create') {
          const schedule = {
            id: `schedule-${active.length + 1}`,
            kind: 'every',
            prompt: input.arguments.prompt,
            everySeconds: input.arguments.every_seconds,
            scheduledAt: '2099-01-01T00:00:00.000Z',
            state: 'scheduled',
            deliveryMode: 'session-local',
          }
          active.push(schedule)
          return { isError: false, value: schedule, content: [] }
        }
        throw new Error(`unexpected nested Tool ${input.name}`)
      },
    },
  }
  try {
    await applyScheduleImport(ctx, {
      bindingPath: join(paths.profile, 'plugins', 'runtime-binding.json'),
      dshHome,
      legacyScheduleSources: [{ family: 'ecorex-runtime', root: source }],
    })
    const list = await registered.get('e_mate_schedule_import_list').execute({})
    assert.equal(list.items.length, 1)
    assert.equal(list.items[0].status, 'disabled')
    const taskId = list.items[0].legacy_task_id
    const messages = [{
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: '请启用旧任务' }],
    }]
    const agent = { id: 'session-a', session: { deriveMessages: () => messages } }
    const exec = {
      callId: 'outer-call',
      rootCallId: 'outer-call',
      token: Symbol('outer'),
      signal: new AbortController().signal,
      agent,
    }
    const enable = registered.get('e_mate_schedule_import_enable')
    const refused = await enable.execute({ legacy_task_id: taskId }, exec)
    assert.equal(refused.code, 'confirmation_required')
    assert.equal(active.length, 0)
    assert.equal(nested.length, 0)

    messages.push({
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: legacyScheduleConfirmation(taskId) }],
    })
    const enabled = await enable.execute({ legacy_task_id: taskId }, exec)
    assert.equal(enabled.enabled, true)
    assert.equal(enabled.already_enabled, false)
    assert.equal(active.length, 1)
    assert.match(active[0].prompt, new RegExp(`^\\[e-Mate legacy schedule ${taskId}\\]`))
    assert.equal(active[0].everySeconds, 900)
    assert.deepEqual(nested.map(call => call.name), ['schedule_list', 'schedule_create'])
    assert.equal(nested.every(call => call.agent === agent && call.parent === exec.token), true)

    const repeated = await enable.execute({ legacy_task_id: taskId }, exec)
    assert.equal(repeated.already_enabled, true)
    assert.equal(active.length, 1)
    assert.equal(readLegacyScheduleReceipt(dshHome).tasks[0].activations.length, 1)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
