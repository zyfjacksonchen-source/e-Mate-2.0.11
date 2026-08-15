// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { longMessageDefinition } from '../src/client/long-message-disclosure.tsx'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  isAppendSurfaceEvent: (event: { surfaceOp?: string }) => event.surfaceOp === 'append',
}))

const activity = readFileSync(resolve('src/client/activity-header.tsx'), 'utf8')
const disclosure = readFileSync(resolve('src/client/long-message-disclosure.tsx'), 'utf8')

describe('chat fidelity contract', () => {
  it('keeps the real activity clock, terminal clock and collapsible running group', () => {
    expect(activity).toContain("if (status === 'running') return '已工作'")
    expect(activity).toContain("String(minutes).padStart(2, '0')")
    expect(activity).toContain("state === 'ok' || state === 'running'")
    expect(activity).not.toContain("disabled={status === 'running'}")
  })

  it('measures one Markdown DOM and exposes functional expand and download controls', () => {
    expect(disclosure).toContain('text.scrollHeight > 160')
    expect(disclosure).toContain("data-emate-long-disclosure-host")
    expect(disclosure).toContain("data-emate-long-download-host")
    expect(disclosure).toContain("new Blob([copy.innerText]")
    expect(disclosure).toContain("expanded ? '收起文本' : '展开文本'")
  })

  it('does not add a measurement row for provably short plain text', () => {
    const user = (text: string) => ({
      type: 'user/message', seq: 1, time: 1, surfaceOp: 'append',
      data: { id: 'user-1', source: { kind: 'user' }, content: [{ type: 'text', text }] },
    })
    expect(longMessageDefinition.match(user('short message') as never)).toBeNull()
    expect(longMessageDefinition.match(user('x'.repeat(49)) as never)).not.toBeNull()
    expect(longMessageDefinition.match(user('![image](https://x)') as never)).not.toBeNull()
    expect(longMessageDefinition.match(user('line one\nline two') as never)).not.toBeNull()
  })

  it('disconnects terminal activity groups from the shared flow observer', () => {
    expect(activity).toContain("status === 'running' ? new MutationObserver(mark) : null")
  })
})
