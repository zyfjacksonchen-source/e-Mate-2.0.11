// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { longMessageDefinition } from '../src/client/long-message-disclosure.tsx'
import { RetryAttempts } from '../src/client/retry-attempts.tsx'

vi.mock('@deepseek-ai/dsh-client-runtime/client', () => ({
  isAppendSurfaceEvent: (event: { surfaceOp?: string }) => event.surfaceOp === 'append',
}))

const activity = readFileSync(resolve('src/client/activity-header.tsx'), 'utf8')
const disclosure = readFileSync(resolve('src/client/long-message-disclosure.tsx'), 'utf8')

describe('chat fidelity contract', () => {
  it('keeps the real activity clock, terminal clock and collapsible running group', () => {
    expect(activity).toContain("if (status === 'running') return '已工作'")
    expect(activity).toContain("if (reason.kind === 'blocked') return 'blocked'")
    expect(activity).toContain("if (status === 'blocked') return '已阻塞'")
    expect(activity).toContain("if (reason.kind === 'interrupted') return 'interrupted'")
    expect(activity).toContain("if (status === 'interrupted') return '已中断'")
    expect(activity).toContain("return 'cancelled'")
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

  it('keeps every target-projected retry attempt visible in one correlated row group', () => {
    render(<RetryAttempts node={{ data: {
      attempts: [
        {
          kind: 'model-retry', seq: 3, time: 3, retryId: 'retry-1', turn: 1, step: 1,
          provider: 'fake', mode: 'normal', policyKey: 'normal', retry: 1, maxRetries: 2,
          delayMs: 900, failure: { code: 'TRANSPORT', message: 'first failure' }, retryState: 'started',
        },
        {
          kind: 'model-retry', seq: 5, time: 5, retryId: 'retry-1', turn: 1, step: 1,
          provider: 'fake', mode: 'normal', policyKey: 'normal', retry: 2, maxRetries: 2,
          delayMs: 900, failure: { code: 'TRANSPORT', message: 'second failure' }, retryState: 'cancelled',
        },
      ],
      current: {
        kind: 'model-retry', seq: 5, time: 5, retryId: 'retry-1', turn: 1, step: 1,
        provider: 'fake', mode: 'normal', policyKey: 'normal', retry: 2, maxRetries: 2,
        delayMs: 900, failure: { code: 'TRANSPORT', message: 'second failure' }, retryState: 'cancelled',
      },
    } } as never} />)

    const chain = screen.getByText('上次尝试失败').closest('[data-emate-retry-attempts]')
    expect(chain).not.toBeNull()
    expect(within(chain!).getByText('上次尝试失败')).toBeTruthy()
    expect(within(chain!).getByText('第 1 次 · 1s')).toBeTruthy()
    expect(within(chain!).getByText('重试已取消')).toBeTruthy()
    expect(within(chain!).getByText('第 2 次 · 1s')).toBeTruthy()
  })
})
