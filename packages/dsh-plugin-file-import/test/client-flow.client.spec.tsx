// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FileImportControl } from '../src/client/index.tsx'

const imported = {
  bytes: 4,
  display_name: 'note.txt',
  media_type: 'text/plain',
  relative_path: '.e-mate/imports/note.txt',
  stored_name: 'note.txt',
}

function file(name = 'note.txt', type = 'text/plain'): File {
  const value = new File(['note'], name, { type })
  Object.defineProperty(value, 'arrayBuffer', { value: async () => new TextEncoder().encode('note').buffer })
  return value
}

function input(): HTMLInputElement {
  return document.querySelector('input[type=file]') as HTMLInputElement
}

const NativeDataTransfer = globalThis.DataTransfer
const NativeDragEvent = globalThis.DragEvent

class FixtureDataTransfer {
  readonly files: File[] = []
  readonly entries: Array<{ kind: string; getAsFile(): File; webkitGetAsEntry?(): { isDirectory: boolean } }> = []
  readonly items = {
    add: (value: File) => { this.files.push(value); this.entries.push({ kind: 'file', getAsFile: () => value }) },
    [Symbol.iterator]: () => this.entries[Symbol.iterator](),
  }
}

class FixtureDragEvent extends Event {
  readonly dataTransfer: FixtureDataTransfer
  constructor(type: string, init: EventInit & { dataTransfer: FixtureDataTransfer }) {
    super(type, init)
    this.dataTransfer = init.dataTransfer
  }
}

beforeAll(() => {
  globalThis.DataTransfer = FixtureDataTransfer as unknown as typeof DataTransfer
  globalThis.DragEvent = FixtureDragEvent as unknown as typeof DragEvent
})
afterAll(() => {
  globalThis.DataTransfer = NativeDataTransfer
  globalThis.DragEvent = NativeDragEvent
})
afterEach(cleanup)

describe('file import client lifecycle', () => {
  it('treats picker cancellation as a no-op', () => {
    const callImport = vi.fn()
    render(<FileImportControl sessionId="one" input={{ draft: '', phase: 'plain' }} inputActions={{ setDraft() {} }} isLoopback callImport={callImport} />)
    fireEvent.change(input(), { target: { files: [] } })
    expect(callImport).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('allows a fresh picker attempt after a safe failure', async () => {
    const setDraft = vi.fn()
    const callImport = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: '文件暂时无法导入当前工作区。', details: {} } })
      .mockResolvedValueOnce({ ok: true, value: { schema_version: 1, files: [imported] } })
    render(<FileImportControl sessionId="one" input={{ draft: '请读' , phase: 'plain' }} inputActions={{ setDraft }} isLoopback callImport={callImport} />)
    fireEvent.change(input(), { target: { files: [file()] } })
    await screen.findByText('文件暂时无法导入当前工作区。')
    fireEvent.change(input(), { target: { files: [file()] } })
    await waitFor(() => expect(setDraft).toHaveBeenCalledWith('请读 @.e-mate/imports/note.txt '))
    expect(callImport).toHaveBeenCalledTimes(2)
  })

  it('keeps native image handling while importing the ordinary half of a mixed picker batch', async () => {
    const setDraft = vi.fn()
    const callImport = vi.fn().mockResolvedValue({ ok: true, value: { schema_version: 1, files: [imported] } })
    const nativeDrops: File[][] = []
    const observe = (event: Event) => { nativeDrops.push([...(event as FixtureDragEvent).dataTransfer.files]) }
    document.addEventListener('drop', observe)
    try {
      render(<FileImportControl sessionId="one" input={{ draft: '', phase: 'plain' }} inputActions={{ setDraft }} isLoopback callImport={callImport} />)
      fireEvent.change(input(), { target: { files: [file('picture.png', 'image/png'), file()] } })
      await waitFor(() => expect(callImport).toHaveBeenCalledOnce())
      expect(nativeDrops.flat().map(value => value.name)).toContain('picture.png')
      expect(callImport.mock.calls[0][0].files).toHaveLength(1)
      expect(setDraft).toHaveBeenCalledWith('@.e-mate/imports/note.txt ')
    } finally {
      document.removeEventListener('drop', observe)
    }
  })

  it('passes folder drops through to the native Workspace owner', () => {
    const callImport = vi.fn()
    const view = render(<div data-composer-card><FileImportControl sessionId="one" input={{ draft: '', phase: 'plain' }} inputActions={{ setDraft() {} }} isLoopback callImport={callImport} /></div>)
    const transfer = new FixtureDataTransfer()
    transfer.files.push(file())
    transfer.entries.push({ kind: 'file', getAsFile: () => file(), webkitGetAsEntry: () => ({ isDirectory: true }) })
    const event = new FixtureDragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    expect(view.container.firstElementChild?.dispatchEvent(event)).toBe(true)
    expect(callImport).not.toHaveBeenCalled()
  })

  it('drops an old in-flight result after switching sessions', async () => {
    let resolve!: (value: unknown) => void
    const callImport = vi.fn(() => new Promise(value => { resolve = value }))
    const setDraft = vi.fn()
    const view = render(<FileImportControl sessionId="one" input={{ draft: '', phase: 'plain' }} inputActions={{ setDraft }} isLoopback callImport={callImport} />)
    fireEvent.change(input(), { target: { files: [file()] } })
    await screen.findByText('导入中…')
    view.rerender(<FileImportControl sessionId="two" input={{ draft: '', phase: 'plain' }} inputActions={{ setDraft }} isLoopback callImport={callImport} />)
    resolve({ ok: true, value: { schema_version: 1, files: [imported] } })
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(setDraft).not.toHaveBeenCalled()
  })
})
