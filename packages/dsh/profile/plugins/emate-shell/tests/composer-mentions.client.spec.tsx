// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { openMentionMenu, registerMentionSources } from '../src/client/composer-mentions.ts'

describe('native e-Mate @ references', () => {
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
