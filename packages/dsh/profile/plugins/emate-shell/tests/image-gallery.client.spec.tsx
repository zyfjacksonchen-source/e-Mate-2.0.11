// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseImageOutputReceipt } from '../src/client/image-gallery-contract.ts'
import { ToolImageGallery, toolImagesDefinition } from '../src/client/image-gallery.tsx'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  isAppendSurfaceEvent: (event: { surfaceOp?: string }) => event.surfaceOp === 'append',
}))

vi.mock('@deepseek-ai/dsh-client-ui-attachment', () => ({
  ImageGallery: ({ images }: { images: unknown[] }) => <div data-native-image-gallery="">{images.length} images</div>,
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

describe('typed native image gallery', () => {
  it('projects one frozen receipt context and updates revision 3 without a duplicate node', () => {
    const complete = event(receipt())
    const review = event(receipt({ revision: 3, status: 'needs-review' }), 9)
    expect(toolImagesDefinition.match(complete as never)).toEqual({ id: 'tool-images:call-image-1', role: 'start' })
    expect(toolImagesDefinition.match(review as never)).toEqual({ id: 'tool-images:call-image-1', role: 'update' })

    const started = toolImagesDefinition.start({} as never, { event: complete } as never, {} as never)
    const updated = toolImagesDefinition.update({ state: started } as never, { event: review } as never)
    expect(updated.sourceSeq).toBe(8)
    expect(updated.items).toHaveLength(1)
    expect(updated.items[0]).toMatchObject({
      callId: 'call-image-1', revision: 3, status: 'review-required', attachment,
    })
  })

  it('shows terminal failure honestly and rejects running or malformed receipts', () => {
    const failed = receipt({
      status: 'failed',
      content: [],
      output: undefined,
      failure_code: 'provider-result-uncommitted',
    })
    expect(parseImageOutputReceipt(failed)).toMatchObject({ status: 'failed', failureCode: 'provider-result-uncommitted' })
    expect(parseImageOutputReceipt(receipt({ status: 'running', revision: 1, content: [], output: undefined }))).toBeNull()
    expect(parseImageOutputReceipt(receipt({ schema_version: 3 }))).toBeNull()
    expect(parseImageOutputReceipt({ ...receipt(), extra: true })).toBeNull()

    render(<ToolImageGallery node={{
      key: 'tool-images:failure',
      data: { items: [parseImageOutputReceipt(failed)!] },
    } as never} loadImage={vi.fn()} />)
    const button = screen.getByRole('button', { name: '图像任务失败' })
    expect(screen.getByText('生成失败 · 失败')).toBeTruthy()
    expect(screen.queryByText(/images/u)).toBeNull()
    fireEvent.click(button)
    expect(screen.getByText('生成失败 · 失败').closest('[hidden]')).toBeTruthy()
  })

  it('deduplicates native Tool-result attachments without changing or hiding the Tool result', () => {
    const native = {
      type: 'tool/result', seq: 12, time: 12, surfaceOp: 'append',
      data: { message: {
        id: 'result-1',
        source: { kind: 'tool', callId: 'call-native' },
        content: [{ type: 'tool-result', content: [
          { type: 'image', attachment },
          { type: 'image', attachment },
          { type: 'text', text: '原生 Tool result 保留' },
        ] }],
      } },
    }
    const before = structuredClone(native)
    expect(toolImagesDefinition.match(native as never)).toEqual({ id: 'tool-images:result-1', role: 'start' })
    const state = toolImagesDefinition.start({} as never, { event: native } as never, {} as never)
    expect(state.items).toHaveLength(1)
    expect(native).toEqual(before)
    expect(native.data.message.content[0]!.content[2]).toEqual({ type: 'text', text: '原生 Tool result 保留' })
  })

  it('keeps the native attachment gallery accessible and responsive', () => {
    render(<ToolImageGallery node={{
      key: 'tool-images:success',
      data: { items: [parseImageOutputReceipt(receipt())!] },
    } as never} loadImage={vi.fn()} />)
    expect(screen.getByRole('region', { name: '图片结果' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '已查看 1 张图像' })).toBeTruthy()
    expect(screen.getByText('1 images').hasAttribute('data-native-image-gallery')).toBe(true)
    expect(screen.getByText('result.png')).toBeTruthy()

    const css = readFileSync(resolve('src/client/image-gallery.module.css'), 'utf8')
    const index = readFileSync(resolve('src/client/index.ts'), 'utf8')
    expect(css).toContain('flex-wrap: wrap')
    expect(index).not.toContain('imageDisclosureDefinition')
    expect(index).not.toContain('ImageDisclosure')
  })
})
