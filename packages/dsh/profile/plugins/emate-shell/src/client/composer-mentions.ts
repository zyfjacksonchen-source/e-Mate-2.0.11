import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

interface GoalReference {
  kind: 'goal'
  sessionId: string
  id: string
  revision: number
  objective: string
}

interface PlanReference {
  kind: 'plan'
  sessionId: string
  index: number
  content: string
  status: string
}

interface SkillReference {
  kind: 'skill'
  sessionId: string
  name: string
}

interface GoalSnapshot {
  goal: { id: string; revision: number; objective: string }
}

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

interface SkillEntry {
  name: string
  description: string
}

interface ComputerUseCapability {
  state: 'ready' | 'setup-required' | 'blocked' | 'failed'
  detail?: string
  actions: readonly { id: string; label: string }[]
}

const xml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

function binding(ctx: any, sessionId: string): any {
  const value = ctx.sessions.binding(sessionId)
  if (value === undefined) throw new Error('会话已不可用')
  return value
}

function goalOf(ctx: any, sessionId: string): GoalSnapshot | undefined {
  return binding(ctx, sessionId).session.projections.faceOf('goal').getSnapshot() ?? undefined
}

function todosOf(ctx: any, sessionId: string): readonly TodoItem[] {
  return binding(ctx, sessionId).session.projections.faceOf('todos').getSnapshot() ?? []
}

async function skillsOf(ctx: any, sessionId: string, signal: AbortSignal): Promise<readonly SkillEntry[]> {
  signal.throwIfAborted()
  const { result } = await ctx.connection.api.skills.list({ sessionId }, signal)
  if (!result.ok) throw new Error(result.error.message)
  return result.value.skills
}

async function computerUseOf(ctx: any, signal: AbortSignal): Promise<ComputerUseCapability | undefined> {
  const result = await ctx.connection.rpc.call('/emate.capabilities', 'list', {}, signal)
  if (!result?.ok) throw new Error(result?.error?.message ?? '无法读取 Computer Use 状态')
  const item = result.value?.items?.find((candidate: any) => candidate?.id === 'computer-use')
  if (item === undefined) return undefined
  if (!['ready', 'setup-required', 'blocked', 'failed'].includes(item.state)
    || !Array.isArray(item.actions)
    || item.actions.some((action: any) => typeof action?.id !== 'string' || typeof action?.label !== 'string')) {
    throw new Error('Computer Use 状态无效')
  }
  return item
}

const computerCandidate = (description: string, hint: string) => [{ name: '电脑操控', description, hint }]

/** Keep explicit Computer Use on the same native @ registry as every other reference. */
export function registerComputerUseTrigger(ctx: any): void {
  const source: InputTriggerSource = {
    trigger: '@',
    name: '功能',
    order: -20,
    async candidates(_session, { query, signal }) {
      if (!'电脑操控'.includes(query)) return []
      if (document.body.dataset.dshDesktopPlatform !== 'darwin') {
        return computerCandidate(document.body.dataset.dshDesktopPlatform === 'win32'
          ? 'Windows 暂不支持 Computer Use。'
          : '当前桌面平台未提供 Computer Use。', '不可用')
      }
      try {
        const capability = await computerUseOf(ctx, signal)
        if (capability === undefined) return computerCandidate('Computer Use 能力未加载。', '不可用')
        if (capability.state === 'ready') return computerCandidate(capability.detail ?? 'Computer Use 已就绪。', '可插入')
        if (capability.state === 'setup-required' && capability.actions.length > 0) {
          return computerCandidate(capability.detail ?? '需要在 macOS 系统设置中开启权限。', '打开系统设置')
        }
        return computerCandidate(capability.detail ?? 'Computer Use 当前不可用。', '不可用')
      } catch (reason) {
        signal.throwIfAborted()
        return computerCandidate(reason instanceof Error ? reason.message : '无法读取 Computer Use 状态。', '不可用')
      }
    },
    lexicon() { return ['电脑操控'] },
    onPick({ candidate }) {
      if (document.body.dataset.dshDesktopPlatform !== 'darwin') return 'handled'
      if (candidate.hint === '可插入') {
        return { insert: { source: '功能', ref: 'computer-use', label: '@电脑操控', clipboardText: '@电脑操控' } }
      }
      if (candidate.hint === '打开系统设置') {
        const signal = AbortSignal.timeout(10_000)
        void computerUseOf(ctx, signal).then(async (capability) => {
          const action = capability?.state === 'setup-required' ? capability.actions[0] : undefined
          if (action === undefined) return
          const result = await ctx.connection.rpc.call('/emate.capabilities', 'action', {
            capability_id: 'computer-use', action_id: action.id, data: {},
          }, signal)
          if (!result?.ok) throw new Error(result?.error?.message ?? '无法打开 macOS 系统设置')
        }).catch((reason) => { ctx.logger?.warn?.('Computer Use setup action failed', reason) })
      }
      return 'handled'
    },
    codec: {
      clipboardText: () => '@电脑操控',
      serialize: (_ref, signal) => {
        signal.throwIfAborted()
        return Promise.resolve('@电脑操控')
      },
    },
  }
  ctx.effect(() => ctx.inputTriggers.registerSource(source), 'e-mate-shell: @电脑操控 source')
}

function parseRef(ref: string, kind: string): Record<string, unknown> {
  const value: unknown = JSON.parse(ref)
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || (value as { kind?: unknown }).kind !== kind) throw new Error('引用无效')
  return value as Record<string, unknown>
}

/** Add Goal, session-owned Plan, and Skill references to the native InputTrigger roster. */
export function registerMentionSources(ctx: any): void {
  const goal: InputTriggerSource = {
    trigger: '@',
    name: '目标',
    order: -10,
    async candidates(session, { query, signal }) {
      signal.throwIfAborted()
      const snapshot = goalOf(ctx, session.sessionId)
      return snapshot?.goal.objective.toLocaleLowerCase().includes(query.toLocaleLowerCase()) === true
        ? [{ name: snapshot.goal.objective, description: `目标 · revision ${snapshot.goal.revision}` }]
        : []
    },
    onPick({ candidate, session }) {
      const current = goalOf(ctx, session.sessionId)?.goal
      if (current === undefined || current.objective !== candidate.name) return undefined
      const ref: GoalReference = { kind: 'goal', sessionId: session.sessionId, ...current }
      return { insert: { source: '目标', ref: JSON.stringify(ref), label: '@目标', clipboardText: `@目标 ${current.objective}` } }
    },
    codec: {
      clipboardText: ref => `@目标 ${(parseRef(ref, 'goal') as unknown as GoalReference).objective}`,
      async serialize(ref, signal) {
        signal.throwIfAborted()
        const saved = parseRef(ref, 'goal') as unknown as GoalReference
        const current = goalOf(ctx, saved.sessionId)?.goal
        if (current === undefined || current.id !== saved.id || current.revision !== saved.revision
          || current.objective !== saved.objective) throw new Error('目标已更新，请重新选择')
        return `<goal id="${xml(saved.id)}" revision="${saved.revision}">${xml(saved.objective)}</goal>`
      },
    },
  }

  const plan: InputTriggerSource = {
    trigger: '@',
    name: '计划',
    order: -9,
    async candidates(session, { query, signal }) {
      signal.throwIfAborted()
      const needle = query.toLocaleLowerCase()
      return todosOf(ctx, session.sessionId).flatMap((item, index) => {
        const name = `${index + 1}. ${item.content}`
        return name.toLocaleLowerCase().includes(needle) ? [{ name, description: item.status }] : []
      })
    },
    onPick({ candidate, session }) {
      const index = Number.parseInt(candidate.name, 10) - 1
      const current = todosOf(ctx, session.sessionId)[index]
      if (current === undefined || candidate.name !== `${index + 1}. ${current.content}`) return undefined
      const ref: PlanReference = { kind: 'plan', sessionId: session.sessionId, index, ...current }
      return { insert: { source: '计划', ref: JSON.stringify(ref), label: `@计划 ${index + 1}`, clipboardText: candidate.name } }
    },
    codec: {
      clipboardText: ref => {
        const saved = parseRef(ref, 'plan') as unknown as PlanReference
        return `${saved.index + 1}. ${saved.content}`
      },
      async serialize(ref, signal) {
        signal.throwIfAborted()
        const saved = parseRef(ref, 'plan') as unknown as PlanReference
        const current = todosOf(ctx, saved.sessionId)[saved.index]
        if (current === undefined || current.content !== saved.content || current.status !== saved.status) {
          throw new Error('计划项已更新，请重新选择')
        }
        return `<plan-item index="${saved.index + 1}" status="${saved.status}">${xml(saved.content)}</plan-item>`
      },
    },
  }

  const skill: InputTriggerSource = {
    trigger: '@',
    name: 'Skill',
    order: -8,
    async candidates(session, { query, signal }) {
      const needle = query.toLocaleLowerCase()
      return (await skillsOf(ctx, session.sessionId, signal))
        .filter(item => item.name.toLocaleLowerCase().includes(needle))
        .map(item => ({ name: item.name, description: item.description }))
    },
    onPick({ candidate, session }) {
      const ref: SkillReference = { kind: 'skill', sessionId: session.sessionId, name: candidate.name }
      return { insert: { source: 'Skill', ref: JSON.stringify(ref), label: `@${candidate.name}`, clipboardText: `/${candidate.name}` } }
    },
    codec: {
      clipboardText: ref => `/${(parseRef(ref, 'skill') as unknown as SkillReference).name}`,
      async serialize(ref, signal) {
        const saved = parseRef(ref, 'skill') as unknown as SkillReference
        if (!(await skillsOf(ctx, saved.sessionId, signal)).some(item => item.name === saved.name)) {
          throw new Error('Skill 已不可用，请重新选择')
        }
        return `/${saved.name}`
      },
    },
  }

  for (const source of [goal, plan, skill]) {
    ctx.effect(() => ctx.inputTriggers.registerSource(source), `e-mate-shell: @${source.name} source`)
  }
}

/** Open the complete native @ roster by changing the native draft and feeding its owning controller. */
export function openMentionMenu(
  ctx: any,
  sessionId: string,
  selection: { start: number; end: number },
): void {
  const scope = ctx.sessions.scope(sessionId)
  if (scope === undefined) throw new Error('会话已不可用')
  const input = ctx.conversation.input.for(scope)
  const before = input.state.getSnapshot()
  if (before.phase === 'adjudicating' || before.phase === 'submitting') return
  const start = Math.max(0, Math.min(selection.start, before.draft.length))
  const end = Math.max(start, Math.min(selection.end, before.draft.length))
  const prefix = start > 0 && !/\s/u.test(before.draft[start - 1] ?? '') ? ' @' : '@'
  const draft = `${before.draft.slice(0, start)}${prefix}${before.draft.slice(end)}`
  const caret = start + prefix.length
  input.setDraft(draft)
  const after = input.state.getSnapshot()
  ctx.inputTriggers.sessionOf(scope).track(draft, caret, {
    tier: after.phase === 'claimed' ? 'claimed' : 'plain',
  }, after.draftRev)
}
