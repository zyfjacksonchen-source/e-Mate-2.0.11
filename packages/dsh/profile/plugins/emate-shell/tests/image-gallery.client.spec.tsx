// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseImageOutputReceipt } from '../src/client/image-gallery-contract.ts'
import {
  ArtifactTerminal,
  imageCallsDefinition,
  selectArtifactTerminal,
  terminalImageItems,
  toolImagesDefinition,
} from '../src/client/image-gallery.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-attachment', () => ({
  MessageImage: ({ attachment }: { attachment: { name?: string } }) => (
    <button type="button" data-variant="tile">{attachment.name ?? 'image'}</button>
  ),
}))

afterEach(cleanup)

const attachment = {
  attachmentId: `sha256:${'a'.repeat(64)}`,
  mediaType: 'image/png',
  bytes: 42,
  width: 2,
  height: 3,
  name: 'result.png',
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    revision: 2,
    call_id: 'call-image-1',
    operation: 'generate',
    status: 'completed',
    billing_status: 'recorded',
    parent_session_id: 'session-parent',
    sources: [],
    content: [{ type: 'image', attachment }],
    verifier: { structural: 'attachment-cas-v1', semantic: 'not-required' },
    verification: { structural: 'passed', source_output: 'not-applicable', semantic: 'not-applicable' },
    output: attachment,
    job_id: 'job-1',
    provider_request_id: 'provider-1',
    client_request_id: 'client-1',
    model: 'gpt-image-2-pro',
    ...overrides,
  }
}

function event(data: Record<string, unknown>, seq = 8) {
  return { type: 'emate/image-output', seq, time: seq, data }
}

function hidden(item: ReturnType<typeof parseImageOutputReceipt>, key = 'receipt', turnNumber = 1) {
  return {
    key, kind: 'e-mate-tool-images', id: key, target: 'chat', anchorSeq: 1,
    location: { kind: 'turn', turn: turn({}, turnNumber) }, visibility: 'hidden', data: { item },
  }
}

function settlement(senderSessionId: string, key: string, turnNumber = 2) {
  return {
    key, kind: 'context', id: key, target: 'chat', anchorSeq: 1,
    location: { kind: 'turn', turn: turn({}, turnNumber) }, visibility: 'visible',
    data: {
      kind: 'context', seq: 1, time: 1, content: [],
      source: { kind: 'subagent-settled', form: 'notice', senderSessionId },
    },
  }
}

function turn(data: Record<string, unknown>, turnNumber = 1, status: 'open' | 'closed' = 'closed') {
  return {
    turn: turnNumber, status, start: undefined, end: undefined, steps: [],
    data: { get: (key: string) => data[key] },
  }
}

const limits = {
  maxImagesPerMessage: 20,
  maxImageBytes: 5 * 1024 * 1024,
  maxMessageImageBytes: 20 * 1024 * 1024,
  maxImagePixels: 20_000_000,
  mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
}

function terminalProps(
  nodes: readonly unknown[],
  matched = { callIds: ['call-image-1'], paths: [] as string[] },
  overrides: Record<string, unknown> = {},
) {
  return {
    matched,
    sessionId: 'session-1',
    turn: turn({}),
    seq: 20,
    openFile: vi.fn(),
    useSession: (selector: (value: unknown) => unknown) => selector({ chat: { nodes: { values: () => nodes.values() } } }),
    useSessions: (selector: (value: unknown) => unknown) => selector({ byId: { 'session-1': { cwd: '/work' } } }),
    useInput: (selector: (value: unknown) => unknown) => selector({ imageIds: [], phase: 'plain' }),
    useProjection: () => limits,
    loadImage: vi.fn(async () => 'blob:image'),
    addImageToDraft: vi.fn(async () => {}),
    draftBytes: () => 0,
    notify: vi.fn(),
    runResource: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('completed artifact terminal', () => {
  it('publishes ImageGen call provenance and selects native files under one Turn tail', () => {
    const start = { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }
    const call = { type: 'tool/call', seq: 2, time: 2, data: {
      turn: 1, step: 1, callId: 'call-image-1', name: 'imagegen', arguments: '{}',
    } }
    const state = imageCallsDefinition.start({} as never, { event: start } as never, {} as never)
    const updated = imageCallsDefinition.update({ state } as never, { event: call } as never)
    expect(updated.calls).toEqual([{ callId: 'call-image-1', seq: 2 }])
    const data = {
        'e-mate-image-calls': { calls: updated.calls },
        deliverables: { produced: [
          { seq: 3, path: 'out/result.zip' }, { seq: 4, path: 'out/result.zip' }, { seq: 30, path: 'late.txt' },
        ] },
    }
    expect(selectArtifactTerminal({
      turn: turn(data, 1, 'open'),
      nodes: [hidden(parseImageOutputReceipt(receipt())!)],
      seq: 20,
      openFile: vi.fn(),
    } as never)).toBeNull()
    expect(selectArtifactTerminal({
      turn: turn(data),
      nodes: [hidden(parseImageOutputReceipt(receipt())!)],
      seq: 20,
      openFile: vi.fn(),
    } as never)).toEqual({ callIds: ['call-image-1'], paths: ['out/result.zip'] })
  })

  it('admits settled parent projections without waiting for failed siblings or trusting an orphan receipt', () => {
    const projectedCallId = `subagent-image:${'b'.repeat(64)}`
    const projected = parseImageOutputReceipt(receipt({
      call_id: projectedCallId,
      child_session_id: 'image-child-success',
    }))!
    expect(projected.childSessionId).toBe('image-child-success')
    const otherTurn = parseImageOutputReceipt(receipt({
      call_id: `subagent-image:${'c'.repeat(64)}`,
      child_session_id: 'image-child-other-turn',
    }))!
    const start = { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }
    const delegated = ['success', 'failed', 'cancelled'].map((suffix, index) => ({
      type: 'tool/call', seq: index + 2, time: index + 2, data: {
        turn: 1, step: 1, callId: `subagent-${suffix}`,
        name: suffix === 'success' ? 'subagent_fork' : 'subagent', arguments: '{}',
      },
    }))
    let state = imageCallsDefinition.start({} as never, { event: start } as never, {} as never)
    for (const call of delegated) {
      expect(imageCallsDefinition.match(call as never)).toEqual({ id: '1', role: 'update' })
      state = imageCallsDefinition.update({ state } as never, { event: call } as never)
    }
    const nodes = [hidden(projected, 'projected'), hidden(otherTurn, 'other-turn', 2)]
    const match = selectArtifactTerminal({
      turn: turn({ 'e-mate-image-calls': state }),
      nodes,
      seq: 20,
      openFile: vi.fn(),
    } as never)
    expect(match).toEqual({ callIds: [projectedCallId], paths: [] })
    expect(terminalImageItems(nodes as never, match!.callIds, 1)).toEqual([projected])

    expect(selectArtifactTerminal({
      turn: turn({ 'e-mate-image-calls': { calls: [], delegations: [] } }),
      nodes: [hidden(projected, 'orphan')],
      seq: 20,
      openFile: vi.fn(),
    } as never)).toBeNull()
  })

  it('pairs an idle-parent background receipt with the next Turn settlement source only', () => {
    const turn1Start = { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }
    const turn1Call = { type: 'tool/call', seq: 2, time: 2, data: {
      turn: 1, step: 1, callId: 'subagent-background', name: 'subagent', arguments: '{}',
    } }
    const turn1 = imageCallsDefinition.start({} as never, { event: turn1Start } as never, {} as never)
    expect(imageCallsDefinition.update({ state: turn1 } as never, { event: turn1Call } as never).delegations)
      .toEqual([{ callId: 'subagent-background', seq: 2 }])

    const successCallId = `subagent-image:${'d'.repeat(64)}`
    const success = parseImageOutputReceipt(receipt({
      call_id: successCallId, child_session_id: 'child-success',
    }))!
    const unrelated = parseImageOutputReceipt(receipt({
      call_id: `subagent-image:${'e'.repeat(64)}`, child_session_id: 'child-unrelated',
    }))!
    const turn2Start = { type: 'turn/start', seq: 10, time: 10, data: { turn: 2 } }
    const turn2 = imageCallsDefinition.start({} as never, { event: turn2Start } as never, {} as never)
    const nodes = [
      settlement('child-success', 'settled-success'),
      settlement('child-failed', 'settled-failed'),
      hidden(success, 'projected-success', 2),
      hidden(unrelated, 'projected-unrelated', 2),
    ]
    const match = selectArtifactTerminal({
      turn: turn({ 'e-mate-image-calls': turn2 }, 2), nodes, seq: 20, openFile: vi.fn(),
    } as never)
    expect(match).toEqual({ callIds: [successCallId], paths: [] })
    expect(terminalImageItems(nodes as never, match!.callIds, 2)).toEqual([success])

    expect(selectArtifactTerminal({
      turn: turn({ 'e-mate-image-calls': turn2 }, 2),
      nodes: [hidden(success, 'orphan-background', 2)],
      seq: 20,
      openFile: vi.fn(),
    } as never)).toBeNull()
    expect(parseImageOutputReceipt(receipt({ child_session_id: '' }))).toBeNull()
  })

  it('keeps the newest strict receipt hidden and never joins another Turn call', () => {
    const complete = event(receipt())
    const review = event(receipt({ revision: 3, status: 'needs-review' }), 9)
    expect(toolImagesDefinition.match(complete as never)).toEqual({ id: 'tool-images:call-image-1', role: 'start' })
    expect(toolImagesDefinition.match(review as never)).toEqual({ id: 'tool-images:call-image-1', role: 'update' })
    const started = toolImagesDefinition.start({} as never, { event: complete } as never, {} as never)
    const updated = toolImagesDefinition.update({ state: started } as never, { event: review } as never)
    const other = parseImageOutputReceipt(receipt({ call_id: 'call-other' }))!
    const otherTurn = parseImageOutputReceipt(receipt({ revision: 99 }))!
    expect(terminalImageItems([
      hidden(updated.item as never), hidden(other, 'other'), hidden(otherTurn, 'other-turn', 2),
      { ...hidden(updated.item as never, 'visible'), visibility: 'visible' },
    ] as never, ['call-image-1'], 1)).toEqual([updated.item])
    expect(toolImagesDefinition.match({ type: 'tool/result', seq: 10, data: {} } as never)).toBeNull()
    expect(parseImageOutputReceipt(receipt({ revision: 1, status: 'running', content: [], output: undefined }))).toBeNull()
    expect(parseImageOutputReceipt({ ...receipt(), extra: true })).toBeNull()
  })

  it.each([1, 4, 8])('renders %i images as one rail and the same Turn ZIP once', (count) => {
    const items = Array.from({ length: count }, (_, index) => parseImageOutputReceipt(receipt({
      call_id: `call-${index + 1}`,
      content: [{ type: 'image', attachment: { ...attachment, attachmentId: `sha256:${String(index + 1).padStart(64, '0')}`, name: `${index + 1}.png` } }],
    }))!)
    const props = terminalProps(items.map((item, index) => hidden(item, `r${index}`)), {
      callIds: items.map(item => item.callId), paths: ['out/images.zip'],
    })
    render(<ArtifactTerminal {...props as never} />)
    expect(screen.getByRole('region', { name: '图片结果' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /图片操作/u })).toHaveLength(count)
    expect(screen.getByRole('button', { name: '打开 images.zip' })).toBeTruthy()
    expect(screen.getAllByText('images.zip')).toHaveLength(1)
  })

  it.each([1, 3, 7])('renders %i native files with a six-row cap and no path leak', (count) => {
    const paths = Array.from({ length: count }, (_, index) => `folder-${index % 2}/${
      index < 2 ? '同名产物.pptx' : index === 2 ? '未知格式.bin' : `很长的中文文件名-${index}.pdf`
    }`)
    const view = render(<ArtifactTerminal {...terminalProps([], { callIds: [], paths }) as never} />)
    expect(screen.getAllByRole('button', { name: /^打开 /u })).toHaveLength(Math.min(count, 6))
    expect(view.container.textContent).not.toContain('/work')
    expect(screen.queryByRole('button', { name: /其余/u }) === null).toBe(count <= 6)
  })

  it('closes the one file menu outside or by Escape and keeps keyboard order', async () => {
    const paths = Array.from({ length: 7 }, (_, index) => `folder-${index}/很长的中文文件名-${index}.pptx`)
    const props = terminalProps([], { callIds: [], paths })
    const view = render(<ArtifactTerminal {...props as never} />)
    expect(screen.getAllByText('PPTX 文件')).toHaveLength(6)
    expect(screen.getByRole('button', { name: '其余 1 项，在文件夹中查看' })).toBeTruthy()
    expect(view.container.textContent).not.toContain('/work')
    fireEvent.click(screen.getByRole('button', { name: /打开方式：很长的中文文件名-0/u }))
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    fireEvent.pointerDown(document.body)
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: /打开方式：很长的中文文件名-0/u }))
    const first = screen.getByRole('menuitem', { name: '在默认应用中打开' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '打开方式 > 选择应用…' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })

  it('adds a completed image without sending and blocks needs-review', async () => {
    const completed = parseImageOutputReceipt(receipt())!
    const props = terminalProps([hidden(completed)])
    const view = render(<ArtifactTerminal {...props as never} />)
    fireEvent.click(screen.getByRole('button', { name: '图片操作：result.png' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '添加到聊天' }))
    await waitFor(() => { expect(props.addImageToDraft).toHaveBeenCalledWith(attachment) })
    expect(props.notify).toHaveBeenCalledWith('info', '图片已添加到聊天草稿。')

    cleanup()
    const review = parseImageOutputReceipt(receipt({ revision: 3, status: 'needs-review' }))!
    render(<ArtifactTerminal {...terminalProps([hidden(review)]) as never} />)
    fireEvent.contextMenu(screen.getByText('result.png'))
    expect((screen.getByRole('menuitem', { name: '添加到聊天' }) as HTMLButtonElement).disabled).toBe(true)
    expect(view.container.querySelectorAll('[role="menu"]')).toHaveLength(0)
  })

  it('renders failures without a success menu and fails closed for busy or full drafts', () => {
    const failed = parseImageOutputReceipt(receipt({
      revision: 3, status: 'failed', content: [], output: undefined, failure_code: 'provider-result-uncommitted',
    }))!
    const failureView = render(<ArtifactTerminal {...terminalProps([hidden(failed)]) as never} />)
    expect(screen.getByRole('status').textContent).toContain('provider-result-uncommitted')
    expect(failureView.container.querySelector('[aria-label^="图片操作"]')).toBeNull()

    cleanup()
    const completed = parseImageOutputReceipt(receipt())!
    const busy = terminalProps([hidden(completed)], undefined, {
      useInput: (selector: (value: unknown) => unknown) => selector({ imageIds: [], phase: 'submitting' }),
    })
    render(<ArtifactTerminal {...busy as never} />)
    fireEvent.click(screen.getByRole('button', { name: '图片操作：result.png' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '添加到聊天' }))
    expect(busy.addImageToDraft).not.toHaveBeenCalled()
    expect(busy.notify).toHaveBeenCalledWith('error', '当前正在发送消息，请稍后再添加图片。')

    cleanup()
    const full = terminalProps([hidden(completed)], undefined, {
      useInput: (selector: (value: unknown) => unknown) => selector({ imageIds: Array(20).fill('draft'), phase: 'plain' }),
    })
    render(<ArtifactTerminal {...full as never} />)
    fireEvent.click(screen.getByRole('button', { name: '图片操作：result.png' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '添加到聊天' }))
    expect(full.addImageToDraft).not.toHaveBeenCalled()
    expect(full.notify).toHaveBeenCalledWith('error', '最多可添加 20 张图片。')
  })

  it('loads and dispatches a native image action only after the operator chooses it', async () => {
    const completed = parseImageOutputReceipt(receipt())!
    const props = terminalProps([hidden(completed)])
    render(<ArtifactTerminal {...props as never} />)
    expect(props.loadImage).not.toHaveBeenCalled()
    expect(props.runResource).not.toHaveBeenCalled()
    fireEvent.contextMenu(screen.getByText('result.png'))
    fireEvent.click(screen.getByRole('menuitem', { name: '复制图像' }))
    await waitFor(() => { expect(props.runResource).toHaveBeenCalledWith({
      action: 'copy-image',
      resource: { kind: 'image', sessionId: 'session-1', name: 'result.png', src: 'blob:image' },
    }) })
  })

  it('fails a native file action without leaking the local path', async () => {
    const props = terminalProps([], { callIds: [], paths: ['private/report.pdf'] }, {
      runResource: vi.fn(async () => { throw new Error('/Users/private/report.pdf') }),
    })
    render(<ArtifactTerminal {...props as never} />)
    fireEvent.click(screen.getByRole('button', { name: '打开方式：report.pdf' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '在 Finder 中显示' }))
    await waitFor(() => {
      expect(props.notify).toHaveBeenCalledWith('error', '系统文件操作失败，请确认资源仍存在且属于当前工作区。')
    })
    expect(props.notify.mock.calls.flat().join(' ')).not.toContain('/Users')
  })

  it('has no DOM relocation, persistent observer or model/provider heuristic', () => {
    const source = readFileSync(resolve('src/client/image-gallery.tsx'), 'utf8')
    expect(source).not.toMatch(/querySelector|createPortal|MutationObserver|setInterval/u)
    expect(source).not.toMatch(/gpt-image|provider|prompt/u)
    expect(source).toContain('<MessageImage')
    expect(source).toContain("visibility: 'hidden'")
    const apply = readFileSync(resolve('src/client/index.ts'), 'utf8')
    expect(apply).toContain('session.readAttachment(attachment.attachmentId)')
    expect(apply).not.toMatch(/\bfetch\s*\(/u)
    expect(apply).toContain('releaseDraftImages(images)')
  })
})
