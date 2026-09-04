// @vitest-environment jsdom
import React, { useMemo, useState } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '../../../upstream/deepseek-harness/packages/test-support/client-runtime/src/index.ts'
import { InputBar } from '../../../upstream/deepseek-harness/packages/client/ui-conversation/src/client/skeleton/InputBar.tsx'
import { SessionInputShell } from '../../../upstream/deepseek-harness/packages/client/ui-conversation/src/client/input/facade.ts'
import { registerChatNodeRenderers } from '../../../upstream/deepseek-harness/packages/client/ui-conversation/src/client/chat/register-node-renderers.ts'
import { adaptHarnessConversationSource } from '../../../scripts/harness-conversation-adapter.mjs'
import { addNativeImages, apply, inject, FILE_PICK_EVENT, FileCards, FileImportControl } from '../src/client/index.tsx'
import { importedDraft, importedMessage, type FileReference } from '../src/client/references.ts'

const imported = {
  bytes: 4, display_name: '报告 带空格@验证.txt', media_type: 'text/plain',
  relative_path: '.e-mate/imports/报告_带空格_验证.txt', stored_name: '报告_带空格_验证.txt',
}
const success = { ok: true, value: { schema_version: 1, files: [imported] } }
function file(name = imported.display_name, type = 'text/plain'): File {
  const value = new File(['note'], name, { type })
  const arrayBuffer = async () => new TextEncoder().encode('note').buffer
  Object.defineProperty(value, 'arrayBuffer', { value: arrayBuffer })
  Object.defineProperty(value, 'slice', { value: () => ({ arrayBuffer }) })
  return value
}
function picker(): HTMLInputElement { return document.querySelector('input[type=file]') as HTMLInputElement }

// React store fixture for the plugin's native InputState face. The actual
// transformed native facade/store/hub are exercised by the adapter self-check.
function Composer({ sessionId = 'one', draft = '', files = [], callImport = vi.fn(), addImages = () => null }: {
  sessionId?: string; draft?: string; files?: readonly FileReference[]; callImport?: any; addImages?: any
}) {
  const [input, setInput] = useState({ draft, fileRefs: files, phase: 'plain' })
  const actions = useMemo(() => ({
    addFiles(added: readonly FileReference[], text?: string) {
      setInput(current => ({ ...current, draft: text ?? current.draft, fileRefs: [...current.fileRefs, ...added] }))
      return true
    },
    removeFile(path: string) { setInput(current => ({ ...current, fileRefs: current.fileRefs.filter(file => file.relative_path !== path) })) },
  }), [])
  return <FileImportControl sessionId={sessionId} input={input} inputActions={actions} isLoopback
    callImport={callImport} addImages={addImages}
    renderComposer={({ accessory, controls, pending }) => <div data-composer-card>{accessory}<textarea readOnly value={input.draft} /><button disabled={pending}>发送</button>{controls}</div>} />
}
afterEach(cleanup)

describe('file import composer lifecycle', () => {
  it('treats picker cancellation as a no-op', () => {
    const callImport = vi.fn()
    render(<Composer callImport={callImport} />)
    fireEvent.change(picker(), { target: { files: [] } })
    expect(callImport).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows standard file icons and separate extensions with complete names and independent actions', () => {
    const types = [
      ['季度经营报告 带空格@最终版本与补充说明.md', 'text/markdown', 'MD', 'FileText'],
      ['预算.XLSX', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX', 'FileSpreadsheet'],
      ['方案.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PPTX', 'FileChartColumn'],
      ['数据.json', 'application/json', 'JSON', 'FileJson2'],
      ['配置.yaml', 'application/yaml', 'YAML', 'FileCode2'],
      ['归档.zip', 'application/zip', 'ZIP', 'FileArchive'],
      ['说明.pdf', 'application/pdf', 'PDF', 'FileText'],
    ] as const
    const files = types.map(([display_name, media_type, extension], index) => ({
      ...imported, display_name, media_type, stored_name: `file-${index}.${extension.toLowerCase()}`,
      relative_path: `.e-mate/imports/file-${index}.${extension.toLowerCase()}`,
    }))
    const open = vi.fn()
    const remove = vi.fn()
    render(<FileCards files={files} open={open} remove={remove} />)

    for (const [name, , extension, icon] of types) {
      const card = screen.getByRole('button', { name: `打开 ${name}` })
      expect(card.getAttribute('title')).toBe(name)
      expect(within(card).getByText(name).getAttribute('title')).toBe(name)
      expect(within(card).getByText(extension)).not.toBe(within(card).getByText(name))
      expect(card.querySelector('svg')?.getAttribute('data-file-icon')).toBe(icon)
      expect(card.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    }
    expect(screen.queryByText('表格')).toBeNull()
    expect(screen.queryByText('演示')).toBeNull()
    expect(screen.queryByText('压缩')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `移除 ${files[0]!.display_name}` }))
    expect(remove).toHaveBeenCalledWith(files[0]!.relative_path)
    expect(open).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: `打开 ${files[1]!.display_name}` }))
    expect(open).toHaveBeenCalledWith(files[1]!.relative_path)
  })

  it('retains a failed import and puts the successful retry inside the composer above plain text', async () => {
    const callImport = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: '文件暂时无法导入当前工作区。', details: {} } })
      .mockResolvedValueOnce(success)
    render(<Composer draft="请读" callImport={callImport} />)
    fireEvent.change(picker(), { target: { files: [file()] } })
    const failure = await screen.findByText('文件暂时无法导入当前工作区。')
    const failedCard = failure.closest('[data-phase="error"]')!
    expect(within(failedCard as HTMLElement).getByText('TXT')).toBeTruthy()
    expect(failedCard.querySelector('svg')?.getAttribute('data-file-icon')).toBe('FileText')
    fireEvent.click(screen.getByRole('button', { name: `移除 ${imported.display_name}` }))
    fireEvent.change(picker(), { target: { files: [file()] } })
    await waitFor(() => expect(document.querySelector('[data-emate-resource-path]')).not.toBeNull())
    const remove = screen.getByRole('button', { name: `移除 ${imported.display_name}` })
    const card = remove.closest('[data-emate-resource-path]')!
    expect(card.getAttribute('data-emate-resource-path')).toBe(imported.relative_path)
    expect(card.closest('[data-composer-card]')).not.toBeNull()
    expect(card.compareDocumentPosition(screen.getByRole('textbox')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('请读')
    expect(screen.queryByText(`@${imported.relative_path}`)).toBeNull()
    expect(callImport).toHaveBeenCalledTimes(2)
    fireEvent.click(remove)
    expect(screen.queryByRole('status')).toBeNull()
    expect(callImport).toHaveBeenCalledTimes(2)
  })

  it('uses the native image facade for a mixed picker batch without synthetic drops', async () => {
    const callImport = vi.fn().mockResolvedValue(success)
    const addImages = vi.fn(() => null)
    const drop = vi.fn()
    document.addEventListener('drop', drop)
    try {
      render(<React.StrictMode><Composer callImport={callImport} addImages={addImages} /></React.StrictMode>)
      fireEvent.change(picker(), { target: { files: [file('picture.png', 'image/png'), file()] } })
      await screen.findByRole('button', { name: `移除 ${imported.display_name}` })
      expect(addImages).toHaveBeenCalledOnce()
      expect(addImages.mock.calls[0]![0][0].name).toBe('picture.png')
      expect(drop).not.toHaveBeenCalled()
      expect(callImport.mock.calls[0]![0].files).toHaveLength(1)
    } finally { document.removeEventListener('drop', drop) }
  })

  it('reports selected image refusal instead of silently losing it', async () => {
    render(<Composer addImages={() => '当前正在发送消息，图片未加入草稿，请稍后重试。'} />)
    fireEvent.change(picker(), { target: { files: [file('picture.png', 'image/png')] } })
    await screen.findByText('当前正在发送消息，图片未加入草稿，请稍后重试。')
    expect(screen.getByText('picture.png')).toBeTruthy()
  })

  it('migrates legacy imported paths into removable cards without changing native workspace mentions', async () => {
    render(<Composer draft={`请读 @src/main.ts @${imported.relative_path} `} />)
    const remove = await screen.findByRole('button', { name: `移除 ${imported.stored_name}` })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('请读 @src/main.ts')
    fireEvent.click(remove)
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('请读 @src/main.ts')
  })

  it('does not revive an importing card removed before its result arrives', async () => {
    let resolve!: (value: unknown) => void
    const callImport = vi.fn(() => new Promise(value => { resolve = value }))
    render(<Composer callImport={callImport} />)
    fireEvent.change(picker(), { target: { files: [file()] } })
    await waitFor(() => expect(callImport).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: `移除 ${imported.display_name}` }))
    resolve(success)
    await waitFor(() => expect(screen.getByRole('button', { name: '添加本地图片或文件' }).hasAttribute('disabled')).toBe(false))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('drops an old in-flight result after switching sessions', async () => {
    let resolve!: (value: unknown) => void
    const callImport = vi.fn(() => new Promise(value => { resolve = value }))
    const view = render(<Composer callImport={callImport} />)
    const textarea = screen.getByRole('textbox')
    fireEvent.change(picker(), { target: { files: [file()] } })
    await waitFor(() => expect(callImport).toHaveBeenCalledOnce())
    view.rerender(<Composer sessionId="two" callImport={callImport} />)
    expect(screen.getByRole('textbox')).toBe(textarea)
    resolve(success)
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
  })

  it('keeps same-name paths distinct and projects submitted names without changing transport content', () => {
    const another = { ...imported, relative_path: '.e-mate/imports/报告_带空格_验证-2.txt', stored_name: '报告_带空格_验证-2.txt' }
    const text = `请读\n@${imported.relative_path}\n@${another.relative_path}`
    const content = [{ type: 'text', text }, { type: 'image', attachment: { attachmentId: 'native-cas' } }]
    const projected = importedMessage(content, { mentions: [imported, another].map(file => ({ source: 'e-mate/file-import', ref: JSON.stringify(file) })) })
    expect(content[0].text).toBe(text)
    expect(projected.content[0].text).toBe('请读')
    expect(projected.content[1]).toBe(content[1])
    const open = vi.fn()
    render(<FileCards files={projected.files} open={open} />)
    expect(screen.getAllByText(imported.display_name)).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: `打开 ${imported.display_name}` })[1]!)
    expect(open).toHaveBeenCalledWith(another.relative_path)
    expect(importedDraft('@src/main.ts @.e-mate/imports/../secret.txt').files).toEqual([])
  })

  it('uses native addImages admission even when the model catalog blocks submitting', () => {
    const images = [{ id: 'native-image' }]
    const shell = { state: { getSnapshot: () => ({ imageIds: [] }) }, addImages: vi.fn(() => true) }
    const ctx = {
      sessions: { scope: () => ({}), binding: () => ({ session: { projections: { faceOf: () => ({ getSnapshot: () => undefined }) } } }) },
      conversation: { input: { for: () => shell }, draftImages: () => [], createDraftImages: vi.fn(() => images), releaseDraftImages: vi.fn() },
    }
    expect(addNativeImages(ctx, 'one', [file('picture.png', 'image/png')])).toBeNull()
    expect(shell.addImages).toHaveBeenCalledWith(['native-image'])
    shell.addImages.mockReturnValue(false)
    expect(addNativeImages(ctx, 'one', [file('picture.png', 'image/png')])).toContain('图片未加入草稿')
    expect(ctx.conversation.releaseDraftImages).toHaveBeenCalledWith(images)
  })

  it('registers against the real native slots and preserves child ownership and the native InputBar lifecycle', async () => {
    const runtime = await SlotTestRuntime.create()
    let trigger: any
    let lastNativeProps: any
    let live: any
    let finishImport!: (value: unknown) => void
    const callImport = vi.fn(() => new Promise(resolve => { finishImport = resolve }))
    const Native = (props: any) => {
      lastNativeProps = props
      return <InputBar {...props} />
    }
    const picked = vi.fn()
    try {
      const shell = new SessionInputShell({ actx: {} as never, defaultSink: vi.fn() })
      const absentMenu = { getSnapshot: () => null, subscribe: () => () => {} }
      const locale = { revision: 0 }
      runtime.slots.installLocale({ getSnapshot: () => locale, subscribe: () => () => {}, bind: () => (key: string) => key } as never)
      runtime.provide('inputTriggers', { registerSource(source: any) { trigger = source; return () => {} } } as never)
      runtime.provide('connection', { isLoopback: true, rpc: { call: callImport } } as never)
      runtime.provide('conversation', { input: { for: () => ({ notify: vi.fn() }) }, draftImages: () => [] } as never)
      await runtime.sessions.add({ id: 'one' }, { current: false })
      await runtime.sessions.add({ id: 'two' }, { current: false })
      await runtime.declare({
        'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      } as never)
      // Execute the exact adapted native registration, including its children
      // and inject. SlotTestRuntime uses production SlotRegistry + web-react.
      const source = adaptHarnessConversationSource(readFileSync('upstream/deepseek-harness/packages/client/ui-conversation/lib/client.js', 'utf8'))
      const start = source.indexOf('\t\t\tslots.register({\n\t\t\t\tname: "conversation.composer.bar",')
      const end = source.indexOf('\t\t\tslots.register({\n\t\t\t\tname: "conversation.composer",', start)
      expect(start).toBeGreaterThan(0)
      expect(end).toBeGreaterThan(start)
      await runtime.mount({ inject: ['slots'], apply(ctx: any) {
        new Function('env', `const { slots, InputBar, react_jsx_runtime, NS, inputHub, concreteConversation, ctx, submissionPolicy, ABSENT_NOTICES, ABSENT_LEXICON, ABSENT_MENU_LAUNCHER } = env;\n${source.slice(start, end)}`)({
          slots: ctx.slots, InputBar: Native, react_jsx_runtime: jsxRuntime, NS: 'conversation', ctx,
          inputHub: { shell: () => shell, inputTriggers: () => undefined }, concreteConversation: () => ctx.conversation,
          submissionPolicy: { resolve: () => 'queue' }, ABSENT_NOTICES: shell.notices,
          ABSENT_LEXICON: shell.lexicon, ABSENT_MENU_LAUNCHER: absentMenu,
        })
        registerChatNodeRenderers(ctx)
        ctx.slots.register({ name: 'conversation.input.plan' }, () => <button>原生计划</button>)
        ctx.slots.register({ name: 'conversation.input.model' }, () => <button>原生模型</button>)
      } })
      const actions = { ...shell.actions, addFiles: vi.fn(() => true), removeFile: vi.fn() }
      runtime.renderSlot('conversation.composer.bar' as never, {
        useInput: (select: any) => select(live), inputActions: actions, leftItems: <span>原生工具</span>,
      } as never)
      const nativeTextarea = screen.getByRole('textbox') // Fallback before the product plugin loads.
      expect(screen.queryByRole('button', { name: '添加本地图片或文件' })).toBeNull()
      live = { ...shell.snapshot, fileRefs: [] }
      await runtime.sessions.setCurrent('one')
      expect(screen.getByRole('textbox')).toBe(nativeTextarea)
      await runtime.sessions.setCurrent('two')
      expect(screen.getByRole('textbox')).not.toBe(nativeTextarea)
      live = undefined
      await runtime.sessions.setCurrent(undefined)
      const feature = await runtime.mount({ inject, apply })
      const textarea = screen.getByRole('textbox')
      expect(lastNativeProps.accessory).toBeUndefined()
      expect(runtime.slots.entries('conversation.composer.bar' as never)).toHaveLength(1)
      expect(runtime.slots.entries('e-mate.conversation.composer' as never)).toHaveLength(1)
      for (const key of ['user', 'steering']) {
        const entries = runtime.slots.entries('conversation.chat.node' as never).filter(entry => entry.options.key === key)
        expect(entries).toHaveLength(2)
        expect(entries[0]!.children).toBeUndefined()
      }
      live = { ...shell.snapshot, fileRefs: [] }
      await runtime.sessions.setCurrent('one')
      expect(screen.getByRole('textbox')).toBe(textarea)
      expect(screen.getByRole('button', { name: '原生计划' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '原生模型' })).toBeTruthy()
      fireEvent.change(picker(), { target: { files: [file()] } })
      await waitFor(() => expect(callImport).toHaveBeenCalledOnce())
      expect(screen.getByRole('button', { name: `移除 ${imported.display_name}` })).toBeTruthy()
      await runtime.sessions.setCurrent('two')
      // rc.7 SessionMaybeEntry adopts the first session, then remounts on a
      // different session; the product follows the same isolation boundary.
      expect(screen.getByRole('textbox')).not.toBe(textarea)
      expect(lastNativeProps.accessory).toBeUndefined()
      finishImport(success)
      await runtime.flush()
      expect(screen.queryByRole('button', { name: `移除 ${imported.display_name}` })).toBeNull()
      expect(actions.addFiles).not.toHaveBeenCalled()
      expect(screen.getByText('原生工具')).toBeTruthy()
      const guard = vi.fn(() => true)
      runtime.sessions.scope('two' as never)!.on('slash/input-consume-token', guard)
      document.addEventListener(FILE_PICK_EVENT, picked)
      const span = { start: 4, end: 5, draftRev: 8 }
      trigger.onPick({ session: { sessionId: 'two' }, span })
      expect(guard).toHaveBeenCalledWith({ guard: { kind: 'span', span } })
      expect(picked).toHaveBeenCalledOnce()
      guard.mockReturnValue(false)
      trigger.onPick({ session: { sessionId: 'two' }, span })
      expect(picked).toHaveBeenCalledOnce()
      await feature.dispose()
      expect(runtime.slots.entries('e-mate.conversation.composer' as never)).toHaveLength(0)
      expect(screen.getByRole('textbox')).toBeTruthy()
      expect(screen.getByRole('button', { name: '原生计划' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '原生模型' })).toBeTruthy()
    } finally {
      document.removeEventListener(FILE_PICK_EVENT, picked)
      await runtime.dispose()
    }
  })
})
