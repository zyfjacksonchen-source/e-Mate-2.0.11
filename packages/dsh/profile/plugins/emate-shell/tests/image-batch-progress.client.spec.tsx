// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { useRef, useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectionValueStore } from '../../../../../../upstream/deepseek-harness/packages/client/runtime/src/client/sessions/projection-store.ts'
import type { SessionListState, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import { useImageBatchProjection } from '../src/client/image-batch-client.ts'
import { ImageBatchProgress } from '../src/client/image-batch-progress.tsx'
import { ArtifactTerminal, imageCallsDefinition, selectArtifactTerminal } from '../src/client/image-gallery.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-attachment', () => ({
  MessageImage: ({ attachment, load, labels }: {
    attachment: { attachmentId?: string; name?: string }
    load: (attachment: unknown) => Promise<string>
    labels: { openNamed: (name: string) => string }
  }) => <button type="button" aria-label={labels.openNamed(attachment.name ?? 'image')}
    data-attachment-id={attachment.attachmentId}
    onClick={() => { void load(attachment) }}>{attachment.name}</button>,
}))

afterEach(cleanup)

const parentSessionId = 'batch-parent'
const parentCallId = 'batch-call'
const batchId = 'sha256:' + 'a'.repeat(64)
const taskIds = 'bcdef012'.split('').map(character => 'sha256:' + character.repeat(64))
const terminalEventId = 'sha256:' + '3'.repeat(64)
const attachment = {
  attachmentId: 'sha256:' + '9'.repeat(64), mediaType: 'image/png', bytes: 42, width: 2, height: 3, name: 'first.png',
}
const unrelatedAttachment = {
  ...attachment, attachmentId: 'sha256:' + '8'.repeat(64), name: 'unrelated.png',
}

function task(ordinal: number, state: string, revision = 1) {
  const linked = state !== 'queued' && state !== 'interrupted'
  const terminal = ['completed', 'failed', 'cancelled', 'unknown', 'interrupted'].includes(state)
  const reviewable = state === 'completed' || state === 'needs-review'
  return {
    task_id: taskIds[ordinal - 1], ordinal, revision, state,
    submission_status: linked ? state === 'running' ? 'unknown' : 'submitted' : 'not-submitted',
    prompt_sha256: 'e'.repeat(64), image_url: [],
    ...(linked ? { child_session_id: 'child-' + ordinal, job_id: 'job-' + ordinal } : {}),
    ...(reviewable ? { receipt: {
      owner_session_id: 'child-' + ordinal, call_id: 'call-' + ordinal, revision: 2, event_seq: 9,
      status: state === 'completed' ? 'completed' : 'needs-review',
    } } : {}),
    ...(terminal && state !== 'completed' ? { failure_code: state === 'interrupted' ? 'interrupted' : 'task-' + state } : {}),
  }
}

function projection(states: readonly string[], options: {
  revisions?: readonly number[]; terminal?: boolean; imageBearingFailures?: readonly number[]
} = {}) {
  const tasks = states.map((state, index) => {
    const item = task(index + 1, state, options.revisions?.[index] ?? 1)
    if (state !== 'failed' || !options.imageBearingFailures?.includes(index + 1)) return item
    return { ...item, receipt: {
      owner_session_id: 'child-' + (index + 1), call_id: 'call-' + (index + 1),
      revision: 2, event_seq: 9, status: 'completed',
    } }
  })
  const images = tasks.filter(item => item.receipt?.status === 'completed').length
  const failures = tasks.filter(item => item.state !== 'completed').length
  const status = states.every(state => state === 'completed') && images === states.length
    ? 'completed'
    : images > 0 && failures > 0
      ? 'partial'
      : images === 0 && states.every(state => state === 'cancelled' || state === 'interrupted')
        ? 'cancelled'
        : 'failed'
  return [{
    schema_version: 1, batch_id: batchId, parent_session_id: parentSessionId, parent_call_id: parentCallId,
    concurrency: 3, tasks,
    image_evidence: tasks.filter(item => item.receipt?.status === 'completed').map(item => ({
      task_id: item.task_id, ordinal: item.ordinal, child_session_id: item.child_session_id, receipt: item.receipt,
    })),
    failures: tasks.filter(item => ['failed', 'cancelled', 'unknown', 'interrupted'].includes(item.state)).map(item => ({
      task_id: item.task_id, ordinal: item.ordinal, state: item.state, failure_code: item.failure_code,
      ...(item.child_session_id === undefined ? {} : { child_session_id: item.child_session_id }),
      ...(item.job_id === undefined ? {} : { job_id: item.job_id }),
      ...(item.receipt === undefined ? {} : { receipt: item.receipt }),
    })),
    ...(options.terminal ? { status, terminal_event_id: terminalEventId } : {}),
  }]
}

function imageReceipt(
  sessionId = 'child-1', callId = 'call-1', image: typeof attachment = attachment,
  status: 'completed' | 'needs-review' | 'failed' = 'completed',
) {
  return {
    schema_version: 2, revision: 2, call_id: callId, operation: 'generate', status,
    billing_status: 'recorded', parent_session_id: sessionId, sources: [],
    content: status === 'failed' ? [] : [{ type: 'image', attachment: image }], output: image, job_id: 'job-1',
    provider_request_id: 'provider-1', client_request_id: 'client-1', model: 'gpt-image-2-pro',
    verifier: { structural: 'attachment-cas-v1', semantic: 'not-required' },
    verification: { structural: 'passed', source_output: 'not-applicable', semantic: 'not-applicable' },
  }
}

function useProjectionFrom(store: ProjectionValueStore): UseProjection {
  return ((key: string, selector: (value: unknown) => unknown = value => value) => {
    const face = store.faceOf(key)
    return useSyncExternalStore(face.subscribe, () => selector(face.getSnapshot()))
  }) as UseProjection
}

function sessionHarness(initial: SessionListState) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const useSessions = <T,>(selector: (value: SessionListState) => T, equal: (a: T, b: T) => boolean = Object.is): T => {
    const selected = selector(useSyncExternalStore(
      listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
      () => snapshot,
    ))
    const previous = useRef(selected)
    if (!equal(previous.current, selected)) previous.current = selected
    return previous.current
  }
  return {
    useSessions,
    set(next: SessionListState) { snapshot = next; for (const listener of [...listeners]) listener() },
    subscriptions: () => listeners.size,
  }
}

function emptySessions(): SessionListState {
  return { ids: [], byId: {}, roots: [], subagentsByParent: {}, diagnostics: [], current: undefined } as never
}

function projectedSessions(statuses: readonly ('completed' | 'needs-review' | 'failed')[]): SessionListState {
  const byId: Record<string, unknown> = {}
  statuses.forEach((status, index) => {
    const ordinal = index + 1
    const image = {
      ...attachment,
      attachmentId: 'sha256:' + '456789ab'[index]!.repeat(64),
      name: 'image-' + ordinal + '.png',
    }
    byId['child-' + ordinal] = { projectionValues: { eMateImageReceipts: [{
      seq: 9, createdAt: 10 + ordinal,
      receipt: imageReceipt('child-' + ordinal, 'call-' + ordinal, image, status),
    }] } }
  })
  return { ...emptySessions(), byId } as never
}

function renderProgress(store: ProjectionValueStore, sessions = sessionHarness(emptySessions()), loadImage = vi.fn(async () => 'blob:image')) {
  function Owner() {
    const view = useImageBatchProjection(useProjectionFrom(store), parentSessionId)
    return <ImageBatchProgress
      batches={view.batches.filter(batch => batch.parentCallId === parentCallId)}
      useSessions={sessions.useSessions}
      loadImage={loadImage}
    />
  }
  const result = render(<Owner />)
  return { ...result, sessions, loadImage }
}

describe('live image batch progress', () => {
  it('binds only image_batch calls to an open Turn tail while preserving legacy imagegen closure', () => {
    const start = { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }
    const initial = imageCallsDefinition.start({} as never, { event: start } as never, {} as never)
    const call = { type: 'tool/call', seq: 2, time: 2, data: {
      turn: 1, step: 1, callId: parentCallId, name: 'image_batch', arguments: '{}',
    } }
    expect(imageCallsDefinition.match(call as never)).toEqual({ id: '1', role: 'update' })
    const state = imageCallsDefinition.update({ state: initial } as never, { event: call } as never)
    expect(state.batchCalls).toEqual([{ callId: parentCallId, seq: 2 }])
    const owner = { turn: { turn: 1, status: 'open', data: { get: () => state }, steps: [] }, nodes: [], seq: 2 }
    expect(selectArtifactTerminal(owner as never)).toEqual({
      callIds: [], batchCallIds: [parentCallId], paths: [], childSessionIds: [],
    })
    expect(selectArtifactTerminal({ ...owner, turn: { ...owner.turn, data: { get: () => ({ calls: [] }) } } } as never)).toBeNull()
  })

  it('renders fixed ordinal cards for every state and preserves sibling DOM identity across updates', async () => {
    const store = new ProjectionValueStore()
    const face = store.faceOf('eMateImageBatches')
    const nativeSubscribe = face.subscribe
    let projectionSubscriptions = 0
    face.subscribe = listener => {
      projectionSubscriptions += 1
      const dispose = nativeSubscribe(listener)
      return () => { projectionSubscriptions -= 1; dispose() }
    }
    store.apply('eMateImageBatches', projection(['queued', 'queued']), 1)
    const view = renderProgress(store)
    expect(projectionSubscriptions).toBe(1)
    const first = screen.getByRole('article', { name: '第 1 张图片：排队中' })
    const second = screen.getByRole('article', { name: '第 2 张图片：排队中' })
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    await act(async () => {
      store.apply('eMateImageBatches', projection(['running', 'queued'], { revisions: [2, 1] }), 2)
      await Promise.resolve()
    })
    expect(screen.getByRole('article', { name: '第 1 张图片：正在生成' })).toBe(first)
    expect(screen.getByRole('article', { name: '第 2 张图片：排队中' })).toBe(second)

    const states = ['queued', 'running', 'needs-review', 'completed', 'failed', 'cancelled', 'unknown', 'interrupted']
    await act(async () => { store.apply('eMateImageBatches', projection(states), 3); await Promise.resolve() })
    expect(screen.getAllByRole('article').map(node => node.getAttribute('data-state'))).toEqual(states)
    view.unmount()
    expect(projectionSubscriptions).toBe(0)
    expect(view.sessions.subscriptions()).toBe(0)
  })

  it('shows an exact child receipt preview while the parent batch remains open', async () => {
    const store = new ProjectionValueStore()
    store.apply('eMateImageBatches', projection(['completed', 'running'], { revisions: [3, 2] }), 1)
    const sessions = sessionHarness(emptySessions())
    const loadImage = vi.fn(async () => 'blob:image')
    renderProgress(store, sessions, loadImage)
    expect(screen.queryByRole('button', { name: '查看原图：first.png' })).toBeNull()

    await act(async () => {
      sessions.set({ ...emptySessions(), byId: { 'child-1': { projectionValues: { eMateImageReceipts: [{
        seq: 9, createdAt: 10, receipt: imageReceipt(),
      }] } } } } as never)
    })
    const preview = screen.getByRole('button', { name: '查看原图：first.png' })
    expect(screen.getByLabelText('图片批次，共 2 张').getAttribute('aria-busy')).toBe('true')
    preview.click()
    expect(loadImage).toHaveBeenCalledWith(attachment, 'child-1')
  })

  it('keeps one batch card across open-close and excludes only its exact legacy receipt', () => {
    const store = new ProjectionValueStore()
    store.apply('eMateImageBatches', projection(['completed', 'failed'], { revisions: [3, 3], terminal: true }), 1)
    const sessions = sessionHarness({ ...emptySessions(), byId: {
      [parentSessionId]: { title: '批次', cwd: '/work' },
      'child-1': { projectionValues: { eMateImageReceipts: [{ seq: 9, createdAt: 10, receipt: imageReceipt() }] } },
      'child-unrelated': { projectionValues: { eMateImageReceipts: [{
        seq: 12, createdAt: 12, receipt: imageReceipt('child-unrelated', 'call-unrelated', unrelatedAttachment),
      }] } },
    }, subagentsByParent: { [parentSessionId]: { entries: [
      { kind: 'child', id: 'child-1', label: '批次任务', mode: 'one-shot' },
      { kind: 'child', id: 'child-unrelated', label: '独立任务', mode: 'one-shot' },
    ] } } } as never)
    const common = {
      sessionId: parentSessionId, seq: 20, openFile: vi.fn(),
      useSession: (selector: (value: unknown) => unknown) => selector({ chat: { nodes: { values: () => [][Symbol.iterator]() } } }),
      useSessions: sessions.useSessions,
      useInput: (selector: (value: unknown) => unknown) => selector({ imageIds: [], phase: 'plain' }),
      useProjection: useProjectionFrom(store), loadImage: vi.fn(async () => 'blob:image'),
      addImageToDraft: vi.fn(async () => {}), draftBytes: () => 0, notify: vi.fn(), runResource: vi.fn(async () => {}),
    }
    const openMatch = { callIds: [], batchCallIds: [parentCallId], paths: [], childSessionIds: [] }
    const view = render(<ArtifactTerminal {...common as never} matched={openMatch} turn={{
      turn: 1, status: 'open', start: undefined, end: undefined, steps: [], data: { get: () => undefined },
    } as never} />)
    const batchCard = screen.getByRole('article', { name: '第 1 张图片：已完成' })
    expect(screen.getAllByRole('button', { name: '查看原图：first.png' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '查看原图：unrelated.png' })).toBeNull()

    view.rerender(<ArtifactTerminal {...common as never} matched={{
      ...openMatch, childSessionIds: ['child-1', 'child-unrelated'],
    }} turn={{
      turn: 1, status: 'closed', start: undefined, end: undefined, steps: [], data: { get: () => undefined },
    } as never} />)
    expect(screen.getByRole('article', { name: '第 1 张图片：已完成' })).toBe(batchCard)
    expect(screen.getAllByRole('button', { name: '查看原图：first.png' })).toHaveLength(1)
    const unrelated = within(screen.getByRole('region', { name: '图片结果' }))
      .getByRole('button', { name: /^查看原图：/u })
    expect(unrelated.getAttribute('data-attachment-id')).toBe(unrelatedAttachment.attachmentId)
    expect(unrelated.getAttribute('aria-label')).toMatch(/子任务02-生成/u)

    view.rerender(<ArtifactTerminal {...common as never} matched={{
      ...openMatch, childSessionIds: ['child-1', 'child-unrelated'],
    }} turn={{
      turn: 1, status: 'closed', start: undefined, end: undefined, steps: [], data: { get: () => undefined },
    } as never} seq={21} />)
    expect(screen.getAllByRole('button', { name: '查看原图：first.png' })).toHaveLength(1)
    expect(screen.getAllByLabelText('图片批次进度')).toHaveLength(1)
  })

  it('hides foreign or malformed receipt pointers and does not duplicate on parent terminal', async () => {
    const store = new ProjectionValueStore()
    const sessions = sessionHarness({ ...emptySessions(), byId: { 'child-1': { projectionValues: {
      eMateImageReceipts: [{ seq: 8, createdAt: 10, receipt: imageReceipt('foreign-child') }],
    } } } } as never)
    store.apply('eMateImageBatches', projection(['completed', 'failed'], { revisions: [3, 3] }), 1)
    const view = renderProgress(store, sessions)
    const cards = screen.getAllByRole('article')
    expect(screen.queryByRole('button', { name: '查看原图：first.png' })).toBeNull()

    await act(async () => {
      store.apply('eMateImageBatches', projection(['completed', 'failed'], { revisions: [3, 3], terminal: true }), 2)
      await Promise.resolve()
    })
    const progress = screen.getByLabelText('图片批次进度')
    expect(screen.getAllByLabelText('图片批次进度')).toHaveLength(1)
    const batch = within(progress).getByRole('region', { name: '图片批次，共 2 张，部分完成' })
    expect(batch.getAttribute('data-batch-id')).toBe(batchId)
    expect(progress.querySelectorAll('[role="list"]')).toHaveLength(1)
    expect(within(batch).getAllByRole('article')).toHaveLength(2)
    expect(screen.getAllByRole('article')[0]).toBe(cards[0])
    expect(screen.getAllByRole('article')[1]).toBe(cards[1])
    expect(within(batch).getAllByRole('region', { name: '批次未完成项目：1 项' })).toHaveLength(1)
    expect(batch.getAttribute('aria-busy')).toBe('false')
    view.unmount()
  })

  it('converges live and cold terminal batches to identical accessible markup', async () => {
    const terminal = projection(['completed', 'failed'], { revisions: [3, 3], terminal: true })
    const sessions = projectedSessions(['completed', 'failed'])
    const liveStore = new ProjectionValueStore()
    liveStore.apply('eMateImageBatches', projection(['queued', 'queued']), 1)
    const live = renderProgress(liveStore, sessionHarness(sessions))
    const section = screen.getByLabelText('图片批次，共 2 张')
    const firstCard = screen.getByRole('article', { name: '第 1 张图片：排队中' })
    await act(async () => {
      liveStore.apply('eMateImageBatches', projection(['running', 'running'], { revisions: [2, 2] }), 2)
      liveStore.apply('eMateImageBatches', terminal, 3)
      await Promise.resolve()
    })
    expect(screen.getByLabelText('图片批次，共 2 张，部分完成')).toBe(section)
    expect(screen.getByRole('article', { name: '第 1 张图片：已完成' })).toBe(firstCard)
    const liveMarkup = section.outerHTML
    live.unmount()

    const coldStore = new ProjectionValueStore()
    coldStore.apply('eMateImageBatches', terminal, 3)
    const cold = renderProgress(coldStore, sessionHarness(sessions))
    expect(screen.getByLabelText('图片批次，共 2 张，部分完成').outerHTML).toBe(liveMarkup)
    cold.unmount()
  })

  it('keeps four successful previews and summarizes one bounded failure', () => {
    const store = new ProjectionValueStore()
    store.apply('eMateImageBatches', projection(
      ['completed', 'completed', 'completed', 'completed', 'failed'],
      { revisions: [3, 3, 3, 3, 3], terminal: true },
    ), 1)
    const view = renderProgress(store, sessionHarness(projectedSessions([
      'completed', 'completed', 'completed', 'completed', 'failed',
    ])))
    expect(screen.getAllByRole('button', { name: /^查看原图：/u })).toHaveLength(4)
    expect(screen.getAllByRole('article')).toHaveLength(5)
    const summary = screen.getByRole('region', { name: '批次未完成项目：1 项' })
    expect(summary.textContent).toBe('未完成 1 项图片 5：生成失败（代码：task-failed）')
    expect(summary.textContent).not.toMatch(/[\/]|provider|prompt/iu)
    expect(summary.getAttribute('role')).toBeNull()
    expect(summary.getAttribute('aria-live')).toBeNull()
    expect(within(screen.getByLabelText('图片批次进度')).queryByRole('status')).toBeNull()
    view.unmount()
  })

  it('retains an image-bearing failed receipt exactly once with its failure summary', () => {
    const store = new ProjectionValueStore()
    store.apply('eMateImageBatches', projection(
      ['completed', 'failed'],
      { revisions: [3, 3], terminal: true, imageBearingFailures: [2] },
    ), 1)
    const view = renderProgress(store, sessionHarness(projectedSessions(['completed', 'completed'])))
    expect(screen.getAllByRole('button', { name: /^查看原图：/u })).toHaveLength(2)
    expect(screen.getByRole('article', { name: '第 2 张图片：生成失败' })).toBeTruthy()
    expect(screen.getByRole('region', { name: '批次未完成项目：1 项' })).toBeTruthy()
    view.unmount()
  })

  it.each([
    [['completed', 'completed'], '全部完成', 0],
    [['failed', 'failed'], '失败', 2],
    [['cancelled', 'interrupted'], '已取消', 2],
    [['unknown', 'failed'], '失败', 2],
  ] as const)('renders terminal status %s as %s with %i failures', (states, label, count) => {
    const store = new ProjectionValueStore()
    store.apply('eMateImageBatches', projection(states, { revisions: [3, 3], terminal: true }), 1)
    const view = renderProgress(store, sessionHarness(projectedSessions(
      states.map(state => state === 'completed' ? 'completed' : 'failed'),
    )))
    expect(screen.getByLabelText('图片批次，共 2 张，' + label).getAttribute('aria-busy')).toBe('false')
    expect(screen.queryAllByRole('region', { name: '批次未完成项目：' + count + ' 项' })).toHaveLength(count === 0 ? 0 : 1)
    view.unmount()
  })

  it('shows needs-review live, then updates the same card for accepted and rejected outcomes', async () => {
    const acceptedStore = new ProjectionValueStore()
    acceptedStore.apply('eMateImageBatches', projection(['needs-review', 'running'], { revisions: [2, 2] }), 1)
    const acceptedSessions = sessionHarness(projectedSessions(['needs-review', 'failed']))
    const accepted = renderProgress(acceptedStore, acceptedSessions)
    const acceptedCard = screen.getByRole('article', { name: '第 1 张图片：待确认' })
    expect(screen.getByRole('button', { name: '查看原图：image-1.png' })).toBeTruthy()
    await act(async () => {
      acceptedSessions.set(projectedSessions(['completed', 'failed']))
      acceptedStore.apply('eMateImageBatches', projection(['completed', 'failed'], { revisions: [3, 3], terminal: true }), 2)
      await Promise.resolve()
    })
    expect(screen.getByRole('article', { name: '第 1 张图片：已完成' })).toBe(acceptedCard)
    expect(screen.getAllByRole('button', { name: '查看原图：image-1.png' })).toHaveLength(1)
    accepted.unmount()

    const rejectedStore = new ProjectionValueStore()
    rejectedStore.apply('eMateImageBatches', projection(['needs-review', 'running'], { revisions: [2, 2] }), 1)
    const rejectedSessions = sessionHarness(projectedSessions(['needs-review', 'failed']))
    const rejected = renderProgress(rejectedStore, rejectedSessions)
    const rejectedCard = screen.getByRole('article', { name: '第 1 张图片：待确认' })
    expect(screen.getByRole('button', { name: '查看原图：image-1.png' })).toBeTruthy()
    await act(async () => {
      rejectedSessions.set(projectedSessions(['failed', 'failed']))
      rejectedStore.apply('eMateImageBatches', projection(['failed', 'failed'], { revisions: [3, 3], terminal: true }), 2)
      await Promise.resolve()
    })
    expect(screen.getByRole('article', { name: '第 1 张图片：生成失败' })).toBe(rejectedCard)
    expect(screen.getByRole('region', { name: '批次未完成项目：2 项' })).toBeTruthy()
    rejected.unmount()
  })
})
