// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { openMentionMenu, registerComputerUseTrigger, registerMentionSources } from '../src/client/composer-mentions.ts'

describe('native e-Mate @ references', () => {
  it('keeps the naked @ roster ordered and makes empty or failed native owners inert', async () => {
    const sources: InputTriggerSource[] = []
    const listSkills = vi.fn(async () => ({ result: { ok: true, value: { skills: [] } } }))
    const ctx = {
      effect(run: () => () => void) { return run() },
      inputTriggers: { registerSource(source: InputTriggerSource) { sources.push(source); return () => {} } },
      sessions: {
        binding: () => ({ session: { projections: { faceOf: (key: string) => ({ getSnapshot: () => key === 'goal' ? undefined : [] }) } } }),
      },
      connection: {
        rpc: { call: vi.fn(async () => ({ ok: true, value: { schema_version: 1, items: [] } })) },
        api: { skills: { list: listSkills } },
      },
      logger: { warn: vi.fn() },
    }

    registerComputerUseTrigger(ctx)
    registerMentionSources(ctx)
    const roster = [{ name: '文件', order: -30 }, ...sources]
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map(source => source.name)
    expect(roster).toEqual(['文件', '目标', '计划', '电脑操控', 'Skill'])

    const signal = new AbortController().signal
    const request = { query: '', position: 'inline' as const, signal }
    const session = { sessionId: 'session-1' as never }
    const goal = sources.find(source => source.name === '目标')!
    const plan = sources.find(source => source.name === '计划')!
    const skill = sources.find(source => source.name === 'Skill')!
    const goalEmpty = (await goal.candidates(session, request))[0]!
    const planEmpty = (await plan.candidates(session, request))[0]!
    const skillEmpty = (await skill.candidates(session, request))[0]!
    expect(goalEmpty).toEqual({ name: '暂无目标', description: '请先创建目标后再引用' })
    expect(planEmpty).toEqual({ name: '暂无计划', description: '请先创建计划后再引用' })
    expect(skillEmpty).toEqual({ name: '暂无可用 Skill', description: '当前会话没有可引用的 Skill' })
    for (const [source, candidate] of [[goal, goalEmpty], [plan, planEmpty], [skill, skillEmpty]] as const) {
      expect(source.onPick({ candidate, session, position: 'inline', via: 'menu', span: { start: 0, end: 1, draftRev: 1 } })).toBeUndefined()
    }

    listSkills.mockRejectedValueOnce(new Error('offline') as never)
    await expect(skill.candidates(session, request)).resolves.toEqual([
      { name: 'Skill 暂时无法读取', description: '请稍后重试' },
    ])
  })

  it('uses native Computer Use metadata for ready, setup, failed, and Windows candidates', async () => {
    let item: any = {
      id: 'computer-use', state: 'ready', detail: '原生 Computer Use 已就绪。', actions: [],
    }
    const call = vi.fn(async (_channel: string, endpoint: string) => endpoint === 'list'
      ? { ok: true, value: { schema_version: 1, items: [item] } }
      : { ok: true, value: { schema_version: 1 } })
    const sources: InputTriggerSource[] = []
    registerComputerUseTrigger({
      effect(run: () => () => void) { return run() },
      inputTriggers: { registerSource(source: InputTriggerSource) { sources.push(source); return () => {} } },
      connection: { rpc: { call } },
      logger: { warn: vi.fn() },
    })
    const source = sources[0]!
    const signal = new AbortController().signal
    const setupSignal = new AbortController().signal
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(setupSignal)
    const session = { sessionId: 'session-1' as never }
    const request = { query: '', position: 'inline' as const, signal }
    const pick = (candidate: any) => source.onPick({
      candidate, session, position: 'inline', via: 'menu', span: { start: 0, end: 1, draftRev: 1 },
    })

    document.body.dataset.dshDesktopPlatform = 'darwin'
    const ready = (await source.candidates(session, request))[0]!
    expect(ready).toMatchObject({ name: '电脑操控', description: '原生 Computer Use 已就绪。', hint: '可插入' })
    expect(pick(ready)).toMatchObject({ insert: { ref: 'computer-use', label: '@电脑操控' } })

    item = {
      id: 'computer-use', state: 'setup-required', detail: '需要开启辅助功能。',
      actions: [{ id: 'open-accessibility-settings', label: '打开辅助功能设置' }],
    }
    const setup = (await source.candidates(session, request))[0]!
    expect(setup).toMatchObject({ description: '需要开启辅助功能。', hint: '打开系统设置' })
    expect(pick(setup)).toBe('handled')
    expect(timeout).toHaveBeenCalledWith(10_000)
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('/emate.capabilities', 'action', {
      capability_id: 'computer-use', action_id: 'open-accessibility-settings', data: {},
    }, setupSignal))

    item = { id: 'computer-use', state: 'failed', detail: 'provider failed', actions: [] }
    const failed = (await source.candidates(session, request))[0]!
    expect(failed).toMatchObject({ description: 'provider failed', hint: '不可用' })
    const actionCalls = call.mock.calls.filter(([, endpoint]) => endpoint === 'action').length
    expect(pick(failed)).toBe('handled')
    expect(call.mock.calls.filter(([, endpoint]) => endpoint === 'action')).toHaveLength(actionCalls)

    call.mockClear()
    document.body.dataset.dshDesktopPlatform = 'win32'
    const windows = (await source.candidates(session, request))[0]!
    expect(windows).toMatchObject({ description: 'Windows 暂不支持 Computer Use。', hint: '不可用' })
    expect(pick(windows)).toBe('handled')
    expect(call).not.toHaveBeenCalled()
    delete document.body.dataset.dshDesktopPlatform
    timeout.mockRestore()
  })

  it('reads Goal, todo_write Plan, and enabled Skills from their native Session owners and fails stale refs closed', async () => {
    let goal: any = { goal: { id: 'goal-1', revision: 3, objective: '交付季度报告', phase: 'active' } }
    let todos: any = [{ content: '整理数据', status: 'in_progress' }, { content: '复核结论', status: 'pending' }]
    let skills = [{ name: 'office-review', description: '复核办公文档', modelInvocable: true }]
    const sources: InputTriggerSource[] = []
    const ctx = {
      effect(run: () => () => void) { return run() },
      inputTriggers: { registerSource(source: InputTriggerSource) { sources.push(source); return () => {} } },
      sessions: {
        binding: (sessionId: string) => sessionId === 'session-1' ? {
          session: { projections: { faceOf: (key: string) => ({ getSnapshot: () => key === 'goal' ? goal : todos }) } },
        } : undefined,
      },
      connection: {
        api: { skills: { list: vi.fn(async () => ({ result: { ok: true, value: { skills } } })) } },
      },
    }

    registerMentionSources(ctx)
    expect(sources.map(source => source.name)).toEqual(['目标', '计划', 'Skill'])
    const signal = new AbortController().signal
    const goalSource = sources[0]!
    const planSource = sources[1]!
    const skillSource = sources[2]!

    expect(await goalSource.candidates({ sessionId: 'session-1' as never }, { query: '季度', position: 'inline', signal }))
      .toEqual([{ name: '交付季度报告', description: '目标 · revision 3' }])
    const goalPick = goalSource.onPick({
      candidate: { name: '交付季度报告' }, session: { sessionId: 'session-1' as never }, position: 'inline', via: 'menu',
      span: { start: 0, end: 1, draftRev: 1 },
    }) as { insert: { ref: string } }
    await expect(goalSource.codec?.serialize(goalPick.insert.ref, signal))
      .resolves.toBe('<goal id="goal-1" revision="3">交付季度报告</goal>')
    goal = { goal: { ...goal.goal, revision: 4 } }
    await expect(goalSource.codec?.serialize(goalPick.insert.ref, signal)).rejects.toThrow('目标已更新')

    expect((await planSource.candidates({ sessionId: 'session-1' as never }, { query: '', position: 'inline', signal }))
      .map(candidate => candidate.name)).toEqual(['1. 整理数据', '2. 复核结论'])
    const planPick = planSource.onPick({
      candidate: { name: '1. 整理数据' }, session: { sessionId: 'session-1' as never }, position: 'inline', via: 'menu',
      span: { start: 0, end: 1, draftRev: 1 },
    }) as { insert: { ref: string } }
    await expect(planSource.codec?.serialize(planPick.insert.ref, signal))
      .resolves.toBe('<plan-item index="1" status="in_progress">整理数据</plan-item>')
    todos = [{ content: '整理更新后的数据', status: 'in_progress' }]
    await expect(planSource.codec?.serialize(planPick.insert.ref, signal)).rejects.toThrow('计划项已更新')

    expect(await skillSource.candidates({ sessionId: 'session-1' as never }, { query: 'office', position: 'inline', signal }))
      .toEqual([{ name: 'office-review', description: '复核办公文档' }])
    const skillPick = skillSource.onPick({
      candidate: { name: 'office-review' }, session: { sessionId: 'session-1' as never }, position: 'inline', via: 'menu',
      span: { start: 0, end: 1, draftRev: 1 },
    }) as { insert: { ref: string } }
    await expect(skillSource.codec?.serialize(skillPick.insert.ref, signal)).resolves.toBe('/office-review')
    skills = []
    await expect(skillSource.codec?.serialize(skillPick.insert.ref, signal)).rejects.toThrow('Skill 已不可用')
  })

  it('opens the complete native @ roster through the owning draft and InputTrigger controller', () => {
    let snapshot = { draft: '请处理', draftRev: 7, phase: 'plain' as const }
    const setDraft = vi.fn((draft: string) => { snapshot = { ...snapshot, draft, draftRev: snapshot.draftRev + 1 } })
    const track = vi.fn()
    const scope = {}
    const ctx = {
      sessions: { scope: (sessionId: string) => sessionId === 'session-1' ? scope : undefined },
      conversation: { input: { for: () => ({ state: { getSnapshot: () => snapshot }, setDraft }) } },
      inputTriggers: { sessionOf: () => ({ track }) },
    }

    openMentionMenu(ctx, 'session-1', { start: 3, end: 3 })
    expect(setDraft).toHaveBeenCalledWith('请处理 @')
    expect(track).toHaveBeenCalledWith('请处理 @', 5, { tier: 'plain' }, 8)
  })
})
