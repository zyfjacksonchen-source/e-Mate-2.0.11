// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SlotTestRuntime } from '../../../../../../upstream/deepseek-harness/packages/test-support/client-runtime/lib/index.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseImageOutputReceipt } from '../src/client/image-gallery-contract.ts'
import {
  ArtifactTerminal,
  galleryImageItems,
  ImageGalleryView,
  imageCallsDefinition,
  selectArtifactTerminal,
  terminalImageItems,
  toolImagesDefinition,
} from '../src/client/image-gallery.tsx'
import { registerImageGallery } from '../src/client/index.ts'

vi.mock('@deepseek-ai/dsh-client-ui-attachment', () => ({
  MessageImage: ({ attachment, labels }: {
    attachment: { name?: string }
    labels: { open: string; openNamed: (label: string) => string }
  }) => (
    <button
      type="button"
      data-variant="tile"
      title={labels.open}
      aria-label={labels.openNamed(attachment.name ?? 'image')}
    >{attachment.name ?? 'image'}</button>
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

function hidden(
  item: ReturnType<typeof parseImageOutputReceipt>,
  key = 'receipt',
  turnNumber = 1,
  anchorSeq = 1,
) {
  return {
    key, kind: 'e-mate-tool-images', id: key, target: 'chat', anchorSeq,
    location: { kind: 'turn', turn: turn({}, turnNumber) }, visibility: 'hidden', data: { item },
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

function galleryProps(
  sessionId: string,
  nodes: readonly unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    sessionId,
    useSession: (selector: (value: unknown) => unknown) => selector({ chat: { nodes: { values: () => nodes.values() } } }),
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
  it('registers one native conversation.view Gallery Tab', async () => {
    const runtime = await SlotTestRuntime.create()
    await runtime.root.declare({
      'conversation.view': { kind: 'list', scope: 'session' },
    } as never, (() => null) as never)
    await runtime.mount({ inject: ['slots'], apply: registerImageGallery })
    const entries = runtime.slots.entries('conversation.view')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({
      id: 'e-mate-gallery', order: 20, label: '画廊',
    })
    expect(entries[0]?.component).toBe(ImageGalleryView)
    await runtime.dispose()
  })

  it('deduplicates current-Session receipts by revision then anchor and ignores visible nodes', () => {
    const item = (callId: string, revision: number, name: string) => parseImageOutputReceipt(receipt({
      call_id: callId,
      revision,
      status: revision === 3 ? 'needs-review' : 'completed',
      content: [{ type: 'image', attachment: { ...attachment, name } }],
    }))!
    const olderRevision = item('revision-call', 2, 'older-revision.png')
    const latestRevision = item('revision-call', 3, 'latest-revision.png')
    const earlierAnchor = item('anchor-call', 2, 'earlier-anchor.png')
    const latestAnchor = item('anchor-call', 2, 'latest-anchor.png')
    const newest = item('newest-call', 2, 'newest.png')
    expect(galleryImageItems([
      hidden(olderRevision, 'older-revision', 1, 9),
      hidden(latestRevision, 'latest-revision', 1, 2),
      hidden(earlierAnchor, 'earlier-anchor', 1, 4),
      hidden(latestAnchor, 'latest-anchor', 1, 5),
      hidden(newest, 'newest', 1, 10),
      { ...hidden(newest, 'visible', 1, 99), visibility: 'visible' },
    ] as never)).toEqual([newest, latestAnchor, latestRevision])
    expect(parseImageOutputReceipt(receipt({ failure_code: '/Users/private/image.png' }))).toBeNull()
  })

  it('reads only the active Session and searches status, type, and redacted failures', () => {
    const sessionA = parseImageOutputReceipt(receipt({
      call_id: 'session-a',
      content: [{ type: 'image', attachment: { ...attachment, name: 'session-a.png' } }],
    }))!
    const sessionB = parseImageOutputReceipt(receipt({
      call_id: 'session-b', revision: 3, operation: 'edit', status: 'needs-review',
      content: [{ type: 'image', attachment: { ...attachment, name: 'session-b.png' } }],
    }))!
    const failed = parseImageOutputReceipt(receipt({
      call_id: 'session-b-failed', revision: 3, operation: 'fusion', status: 'failed',
      content: [], output: undefined, failure_code: 'provider-result-uncommitted',
    }))!
    const view = render(<ImageGalleryView {...galleryProps('session-a', [hidden(sessionA)]) as never} />)
    expect(screen.getByRole('article', { name: 'session-a.png' })).toBeTruthy()

    view.rerender(<ImageGalleryView {...galleryProps('session-b', [hidden(sessionB), hidden(failed, 'failed', 1, 2)]) as never} />)
    expect(screen.queryByRole('article', { name: 'session-a.png' })).toBeNull()
    expect(screen.getByRole('article', { name: 'session-b.png' })).toBeTruthy()
    expect((screen.getByRole('button', { name: '添加到聊天：session-b.png' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('筛选状态'), { target: { value: 'failed' } })
    expect(screen.getByRole('article', { name: /session-b-failed/u })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /session-b-failed/u })).toBeNull()
    fireEvent.change(screen.getByLabelText('筛选状态'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('筛选类型'), { target: { value: 'fusion' } })
    fireEvent.change(screen.getByPlaceholderText('搜索文件名或结果编号'), { target: { value: 'provider-result' } })
    expect(screen.getByText('错误：provider-result-uncommitted')).toBeTruthy()
    expect(view.container.textContent).not.toContain('/Users')
    expect(screen.queryByRole('button', { name: /删除/u })).toBeNull()
  })

  it('mounts at most 24 Gallery images per page and resets paging after every input or Session change', () => {
    const items = (label: string) => Array.from({ length: 60 }, (_, index) => parseImageOutputReceipt(receipt({
      call_id: `batch-${label}-${index}`,
      content: [{ type: 'image', attachment: {
        ...attachment,
        attachmentId: `sha256:${index.toString(16).padStart(64, '0')}`,
        name: `batch-${label}-${index}.png`,
      } }],
    }))!)
    const nodes = (values: readonly ReturnType<typeof parseImageOutputReceipt>[]) =>
      values.map((item, index) => hidden(item, `page-${index}`, 1, index + 1))
    const view = render(<ImageGalleryView {...galleryProps('session-gallery', nodes(items('first'))) as never} />)

    expect(screen.getAllByRole('article')).toHaveLength(24)
    expect(screen.getAllByRole('button', { name: /查看原图/u })).toHaveLength(24)
    expect(screen.getByText('第 1 / 3 页')).toBeTruthy()
    expect(screen.getByRole('article', { name: 'batch-first-59.png' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '画廊下一页' }))
    expect(screen.getAllByRole('article')).toHaveLength(24)
    expect(screen.getAllByRole('button', { name: /查看原图/u })).toHaveLength(24)
    fireEvent.click(screen.getByRole('button', { name: '画廊下一页' }))
    expect(screen.getAllByRole('article')).toHaveLength(12)
    expect(screen.getAllByRole('button', { name: /查看原图/u })).toHaveLength(12)

    fireEvent.change(screen.getByPlaceholderText('搜索文件名或结果编号'), { target: { value: 'batch' } })
    expect(screen.getByText('第 1 / 3 页')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '画廊下一页' }))
    fireEvent.change(screen.getByLabelText('筛选状态'), { target: { value: 'completed' } })
    expect(screen.getByText('第 1 / 3 页')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '画廊下一页' }))
    fireEvent.change(screen.getByLabelText('筛选类型'), { target: { value: 'generate' } })
    expect(screen.getByText('第 1 / 3 页')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '画廊下一页' }))
    view.rerender(<ImageGalleryView {...galleryProps('session-gallery', nodes(items('updated'))) as never} />)
    expect(screen.getByText('第 1 / 3 页')).toBeTruthy()
    expect(screen.getByRole('article', { name: 'batch-updated-59.png' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /查看原图/u })).toHaveLength(24)
  })

  it('routes Gallery copy, download, and add-to-chat through the shared native owners', async () => {
    const completed = parseImageOutputReceipt(receipt())!
    const props = galleryProps('session-gallery', [hidden(completed)])
    render(<ImageGalleryView {...props as never} />)
    expect(props.loadImage).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '复制图像：result.png' }))
    await waitFor(() => { expect(props.runResource).toHaveBeenCalledWith({
      action: 'copy-image',
      resource: { kind: 'image', sessionId: 'session-gallery', name: 'result.png', src: 'blob:image' },
    }) })
    fireEvent.click(screen.getByRole('button', { name: '下载副本：result.png' }))
    await waitFor(() => { expect(props.runResource).toHaveBeenCalledWith({
      action: 'save-as',
      resource: { kind: 'image', sessionId: 'session-gallery', name: 'result.png', src: 'blob:image' },
    }) })
    fireEvent.click(screen.getByRole('button', { name: '添加到聊天：result.png' }))
    await waitFor(() => { expect(props.addImageToDraft).toHaveBeenCalledWith(attachment) })
    expect(props.notify).toHaveBeenCalledWith('info', '图片已添加到聊天草稿。')
  })

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

  it('ignores subagent calls and reads legacy child-session receipts without projecting child state', () => {
    const start = { type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }
    const state = imageCallsDefinition.start({} as never, { event: start } as never, {} as never)
    for (const [index, name] of ['subagent', 'subagent_fork'].entries()) {
      const call = { type: 'tool/call', seq: index + 2, time: index + 2, data: {
        turn: 1, step: 1, callId: `delegated-${index}`, name, arguments: '{}',
      } }
      expect(imageCallsDefinition.match(call as never)).toBeNull()
      expect(imageCallsDefinition.update({ state } as never, { event: call } as never)).toBe(state)
    }
    expect(state).toEqual({ turn: 1, calls: [] })
    const legacy = parseImageOutputReceipt(receipt({ child_session_id: 'image-child' }))
    expect(legacy).toEqual(expect.objectContaining({ callId: 'call-image-1', status: 'completed' }))
    expect(legacy).not.toHaveProperty('childSessionId')
    expect(selectArtifactTerminal({
      turn: turn({ 'e-mate-image-calls': state }), nodes: [], seq: 20, openFile: vi.fn(),
    } as never)).toBeNull()
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
    expect(parseImageOutputReceipt(receipt({ failure_code: '/Users/private/image.png' }))).toBeNull()
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

  it('renders direct parent failures and cancellations without a success menu', () => {
    for (const [status, failureCode] of [
      ['failed', 'provider-result-uncommitted'],
      ['cancelled', 'cancelled'],
    ] as const) {
      const failed = parseImageOutputReceipt(receipt({
        status, content: [], output: undefined, failure_code: failureCode,
      }))!
      const failureView = render(<ArtifactTerminal {...terminalProps([hidden(failed)]) as never} />)
      expect(screen.getByRole('status').textContent).toContain(failureCode)
      expect(failureView.container.querySelector('[aria-label^="图片操作"]')).toBeNull()
      cleanup()
    }
  })

  it('fails closed for busy or full drafts', () => {
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
    fireEvent.click(screen.getByRole('menuitem', { name: '下载副本' }))
    await waitFor(() => { expect(props.runResource).toHaveBeenCalledWith({
      action: 'save-as',
      resource: { kind: 'image', sessionId: 'session-1', name: 'result.png', src: 'blob:image' },
    }) })
  })

  it('does not expose lower-level paths when adding an image fails', async () => {
    const completed = parseImageOutputReceipt(receipt())!
    const props = terminalProps([hidden(completed)], undefined, {
      addImageToDraft: vi.fn(async () => { throw new Error('/Users/private/result.png') }),
    })
    render(<ArtifactTerminal {...props as never} />)
    fireEvent.click(screen.getByRole('button', { name: '图片操作：result.png' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '添加到聊天' }))
    await waitFor(() => {
      expect(props.notify).toHaveBeenCalledWith('error', '图片未能添加到聊天，请重试。')
    })
    expect(props.notify.mock.calls.flat().join(' ')).not.toContain('/Users')
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
    const contract = readFileSync(resolve('src/client/image-gallery-contract.ts'), 'utf8')
    expect(source).not.toMatch(/querySelector|createPortal|MutationObserver|setInterval/u)
    expect(source).not.toMatch(/gpt-image|provider|prompt/u)
    expect(source).not.toMatch(/child_session_id|childSessionId|subagent|delegations/u)
    expect(contract).not.toMatch(/childSessionId|subagent|delegations/u)
    expect(`${source}\n${contract}`).not.toMatch(/indexedDB|localStorage|sessionStorage|tombstone|\bfetch\s*\(/u)
    expect(source).toContain('<MessageImage')
    expect(source).toContain("visibility: 'hidden'")
    const apply = readFileSync(resolve('src/client/index.ts'), 'utf8')
    expect(apply).toContain("ctx.slots.inject('conversation.view'")
    expect(apply).toContain('session.readAttachment(attachment.attachmentId)')
    expect(apply).not.toMatch(/\bfetch\s*\(/u)
    expect(apply).toContain('releaseDraftImages(images)')
  })
})
