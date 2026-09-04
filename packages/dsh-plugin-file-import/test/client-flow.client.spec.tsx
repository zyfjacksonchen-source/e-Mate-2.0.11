// @vitest-environment jsdom
import React, { useMemo, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addNativeImages, apply, FILE_PICK_EVENT, FileCards, FileImportControl } from '../src/client/index.tsx'
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

  it('retains a failed import and puts the successful retry inside the composer above plain text', async () => {
    const callImport = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: '文件暂时无法导入当前工作区。', details: {} } })
      .mockResolvedValueOnce(success)
    render(<Composer draft="请读" callImport={callImport} />)
    fireEvent.change(picker(), { target: { files: [file()] } })
    await screen.findByText('文件暂时无法导入当前工作区。')
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

  it('keeps the registered native textarea resident across absent and changed sessions without an empty accessory', async () => {
    let composer: any
    let trigger: any
    let lastNativeProps: any
    let live: any
    const Native = (props: any) => {
      lastNativeProps = props
      return <div data-composer-card>{props.accessory}<textarea readOnly value={live?.draft ?? ''} />{props.leftItems}</div>
    }
    const guard = vi.fn(() => true)
    const scope = { bail: guard }
    const ctx: any = {
      effect: (register: any) => register(),
      get: () => ({ registerSource(source: any) { trigger = source; return () => {} } }),
      slots: {
        inject: (name: string, register: any) => { if (name === 'conversation.composer.bar') register() },
        entries: () => [{ component: Native, options: {}, inject: () => ({}), children: {}, locale: 'conversation' }],
        register: (_options: any, Component: any) => { composer = Component; return () => {} },
      },
      sessions: { scope: () => scope },
      conversation: { input: { for: () => ({ notify: vi.fn() }) } },
      connection: { isLoopback: true, rpc: { call: vi.fn() } },
    }
    apply(ctx)
    const props = { useInput: (select: any) => select(live), leftItems: <span>原生工具</span> }
    const view = render(React.createElement(composer, props))
    const textarea = screen.getByRole('textbox')
    expect(lastNativeProps.accessory).toBeUndefined()
    live = { draft: '', fileRefs: [], phase: 'plain' }
    const actions = { addFiles: vi.fn(() => true), removeFile: vi.fn() }
    view.rerender(React.createElement(composer, { ...props, sessionId: 'one', inputActions: actions }))
    expect(screen.getByRole('textbox')).toBe(textarea)
    view.rerender(React.createElement(composer, { ...props, sessionId: 'two', inputActions: actions }))
    expect(screen.getByRole('textbox')).toBe(textarea)
    expect(lastNativeProps.accessory).toBeUndefined()
    expect(screen.getByText('原生工具')).toBeTruthy()
    const picked = vi.fn()
    document.addEventListener(FILE_PICK_EVENT, picked)
    try {
      const span = { start: 4, end: 5, draftRev: 8 }
      trigger.onPick({ session: { sessionId: 'two' }, span })
      expect(guard).toHaveBeenCalledWith(scope, 'slash/input-consume-token', { guard: { kind: 'span', span } })
      expect(picked).toHaveBeenCalledOnce()
      guard.mockReturnValue(false)
      trigger.onPick({ session: { sessionId: 'two' }, span })
      expect(picked).toHaveBeenCalledOnce()
    } finally { document.removeEventListener(FILE_PICK_EVENT, picked) }
  })
})
