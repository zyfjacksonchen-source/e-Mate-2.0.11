// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { activityFoldSummary, registerActivityFold } from '../src/client/activity-fold.tsx'

const cssSource = readFileSync(resolve('src/client/activity-fold.module.css'), 'utf8')

const location = (turn: number) => ({ kind: 'step', turn: { turn } })

function modeScope(initial: unknown = 'simple') {
  let snapshot = { status: 'ready', value: { messageFlowMode: initial }, writable: true }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async () => {},
    unset: async () => {},
    publish(value: unknown) {
      snapshot = { ...snapshot, value: { messageFlowMode: value } }
      for (const listener of listeners) listener()
    },
  }
}

describe('Codex-like process fold', () => {
  it('keeps natural assistant messages native while folding Think, Tool and GenUI detail', () => {
    const nodes = new Map<string, any>([
      ['reasoning', {
        key: 'reasoning', kind: 'assistant-step', location: location(7),
        data: { status: 'running', blocks: [{ kind: 'reasoning', text: '内部思考' }] },
      }],
      ['context', {
        key: 'context', kind: 'context', location: location(7),
        data: { content: '内部上下文' },
      }],
      ['tool', {
        key: 'tool', kind: 'tool-call', location: location(7),
        data: { root: { callId: 'call-1', name: 'render_ui' } },
      }],
      ['progress', {
        key: 'progress', kind: 'assistant-step', location: location(7),
        data: {
          status: 'running',
          blocks: [
            { kind: 'reasoning', text: '第二段内部思考' },
            { kind: 'text', text: '正在为你整理页面。' },
          ],
        },
      }],
      ['final', {
        key: 'final', kind: 'assistant-step', location: location(7),
        data: { status: 'complete', blocks: [{ kind: 'text', text: '页面已经整理完成。' }] },
      }],
    ])
    const snapshot = { chat: { order: [...nodes.keys()], nodes } }
    const useSession = (selector: (value: typeof snapshot) => unknown) => selector(snapshot)
    const entries: any[] = [
      {
        options: { key: 'assistant-step', priority: 0 },
        component: ({ node }: any) => (
          <div data-native-assistant data-streaming={node.data.status === 'running' || undefined}>
            {node.data.blocks.map((block: any, index: number) => block.kind === 'reasoning'
              ? <div data-variant="think" key={index}>{block.text}</div>
              : <p key={index}>{block.text}</p>)}
          </div>
        ),
      },
      {
        options: { key: 'tool-call', priority: 0 },
        component: ({ node, renderSlot }: any) => (
          <div data-native-tool>
            {renderSlot('tool.call.toolview', { toolName: node.data.root.name }, {
              entryKey: node.data.root.name,
              fallback: <span>原生工具回退</span>,
            })}
          </div>
        ),
      },
      {
        options: { key: 'context', priority: 0 },
        component: () => <div data-native-context>上下文</div>,
      },
    ]
    const toolViews = [{
      options: { key: 'render_ui' },
      component: ({ toolName }: any) => <span>GenUI：{toolName}</span>,
    }]
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (options: unknown, component: unknown) => {
          const entry = { options, component }
          entries.push(entry)
          return () => { entries.splice(entries.indexOf(entry), 1) }
        },
        entries: () => entries,
        entriesOfSlot: () => toolViews,
      },
    }
    registerActivityFold(ctx, modeScope() as never)
    const renderer = (key: string) => entries.find(entry =>
      entry.options.key === key && entry.options.priority === -1).component
    const Assistant = renderer('assistant-step')
    const Tool = renderer('tool-call')
    const Context = renderer('context')
    const common = { sessionId: 'session-activity-fold', useSession }

    const view = render(<>
      <Assistant {...common} node={nodes.get('reasoning')} />
      <Context {...common} node={nodes.get('context')} />
      <Tool {...common} node={nodes.get('tool')} />
      <Assistant {...common} node={nodes.get('progress')} />
      <Assistant {...common} node={nodes.get('final')} />
    </>)

    const header = screen.getByRole('button', { name: /正在运行 · 1 次工具调用，2 条思考/u })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(header.querySelector('[data-emate-brain-icon]')).not.toBeNull()
    expect(screen.getByText('正在为你整理页面。')).toBeTruthy()
    expect(screen.getByText('页面已经整理完成。')).toBeTruthy()
    expect(view.container.querySelector('[data-streaming="true"]')).not.toBeNull()
    expect(screen.queryByText('内部思考')).toBeNull()
    expect(screen.queryByText('上下文')).toBeNull()
    expect(screen.queryByText('GenUI：render_ui')).toBeNull()
    expect(screen.getByText('正在为你整理页面。').closest('[data-native-assistant]')?.querySelector('[data-variant="think"]')).toBeNull()

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('内部思考')).toBeTruthy()
    expect(screen.queryByText('上下文')).toBeNull()
    expect(screen.getByText('第二段内部思考')).toBeTruthy()
    expect(screen.getByText('GenUI：render_ui')).toBeTruthy()
    expect(screen.getByText('正在为你整理页面。')).toBeTruthy()
    expect(screen.getByText('页面已经整理完成。')).toBeTruthy()
    expect(screen.getByText('正在为你整理页面。').closest('[data-native-assistant]')?.querySelector('[data-variant="think"]')).toBeNull()
  })

  it('removes only the fold shadows when the persisted mode changes to detailed', () => {
    const entries: any[] = (['assistant-step', 'tool-call', 'context'] as const).map(key => ({
      options: { key, priority: 0 },
      component: ({ node }: any) => <div data-native={key}>{node.key}</div>,
    }))
    const scope = modeScope('broken')
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (options: unknown, component: unknown) => {
          const entry = { options, component }
          entries.push(entry)
          return () => { entries.splice(entries.indexOf(entry), 1) }
        },
        entries: () => entries,
        entriesOfSlot: () => [],
      },
    }

    registerActivityFold(ctx, scope as never)
    expect(entries.filter(entry => entry.options.priority === -1).map(entry => entry.options.key))
      .toEqual(['assistant-step', 'tool-call', 'context'])

    scope.publish('detailed')
    expect(entries.filter(entry => entry.options.priority === -1)).toEqual([])
    expect(entries.map(entry => entry.options.key)).toEqual(['assistant-step', 'tool-call', 'context'])

    scope.publish('simple')
    expect(entries.filter(entry => entry.options.priority === -1).map(entry => entry.options.key))
      .toEqual(['assistant-step', 'tool-call', 'context'])
  })

  it('keeps one historical node sequence across restart, interrupt, multiple tools and mode switches', () => {
    const nodes = [
      { key: 'reasoning-text', kind: 'assistant-step', data: { status: 'running', blocks: [
        { kind: 'reasoning', text: '分析中' }, { kind: 'text', text: '自然文本' },
      ] } },
      { key: 'tool-one', kind: 'tool-call', data: { root: { callId: 'call-1', name: 'render_ui' } } },
      { key: 'tool-two', kind: 'tool-call', data: { root: { callId: 'call-2', name: 'bash', status: 'interrupted' } } },
    ]
    const original = structuredClone(nodes)
    const entries: any[] = (['assistant-step', 'tool-call', 'context'] as const).map(key => ({
      options: { key, priority: 0 },
      component: ({ node }: any) => node,
    }))
    const scope = modeScope('detailed') // persisted value restored before this historical Session mounts
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => unknown) => callback(),
        register: (options: unknown, component: unknown) => {
          const entry = { options, component }
          entries.push(entry)
          return () => { entries.splice(entries.indexOf(entry), 1) }
        },
        entries: () => entries,
        entriesOfSlot: () => [],
      },
    }

    registerActivityFold(ctx, scope as never)
    expect(entries.filter(entry => entry.options.priority === -1)).toEqual([])

    scope.publish('simple')
    scope.publish('detailed')
    expect(entries.filter(entry => entry.options.priority === -1)).toEqual([])
    expect(nodes).toEqual(original)
    expect(nodes.map(node => node.key)).toEqual(['reasoning-text', 'tool-one', 'tool-two'])
  })

  it('never discloses injected context metadata, even when process detail is expanded', () => {
    const nodes = new Map<string, any>([
      ['context', { key: 'context', kind: 'context', location: location(9), data: { content: '内部上下文' } }],
      ['tool', { key: 'tool', kind: 'tool-call', location: location(9), data: { root: { callId: 'call-9', name: 'bash' } } }],
    ])
    expect(activityFoldSummary([...nodes.keys()], nodes, nodes.get('tool'))).toMatchObject({
      headerKey: 'tool',
      toolCount: 1,
    })
  })

  it('projects one process group without rewriting DSH nodes', () => {
    const nodes = new Map<string, any>([
      ['message', { key: 'message', kind: 'assistant-step', location: location(2), data: { blocks: [{ kind: 'text', text: '进度' }] } }],
      ['context', { key: 'context', kind: 'context', location: location(2), data: {} }],
      ['tool', { key: 'tool', kind: 'tool-call', location: location(2), data: { root: { kind: 'tool-result' } } }],
    ])
    expect(activityFoldSummary([...nodes.keys()], nodes, nodes.get('context'))).toEqual({
      turn: 2,
      headerKey: 'tool',
      toolCount: 1,
      reasoningCount: 0,
      running: false,
    })
    expect(cssSource).not.toContain("[data-emate-process-collapsed] :global([data-variant='think'])")
    expect(cssSource).toContain(':has([data-emate-process-hidden])')
    expect(cssSource).toContain('.header + *')
    expect(cssSource).toContain('margin-top: 8px')
  })
})
