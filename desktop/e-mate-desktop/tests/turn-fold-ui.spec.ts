import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join('node_modules', 'dsh-turn-fold', 'client.js'), 'utf8')

function namedFunction(name: string): string {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`missing function ${name}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`unterminated function ${name}`)
}

const computeTurnFold = new Function(
  `${namedFunction('turnNumber')}\n${namedFunction('computeTurnFold')}\nreturn computeTurnFold`,
)() as (order: string[], nodes: Map<string, any>, locations: any, turnEnds: Set<number>, node: any) => any
const activityHeaderLabel = new Function(
  `${namedFunction('activityHeaderLabel')}\nreturn activityHeaderLabel`,
)() as (fold: { toolCount: number, messageCount: number }) => string
const toolFailed = new Function(`${namedFunction('toolFailed')}\nreturn toolFailed`)() as (node: any) => boolean
const assistantMustStayVisible = new Function(
  `${namedFunction('assistantMustStayVisible')}\nreturn assistantMustStayVisible`,
)() as (node: any) => boolean

function turnNode(key: string, kind: string, anchorSeq: number, data: object = {}) {
  return { key, kind, anchorSeq, location: { kind: 'turn', turn: { turn: 1 } }, data }
}

describe('dsh-turn-fold activity projection', () => {
  it('groups running rc.7 nodes without inventing a final message', () => {
    const user = turnNode('user', 'user', 1)
    const think = turnNode('think', 'assistant-step', 2, { blocks: [{ kind: 'reasoning' }] })
    const tool = turnNode('tool', 'tool-call', 3, { root: { kind: 'tool-result', isError: false } })
    const order = ['user', 'think', 'tool']
    const nodes = new Map([['user', user], ['think', think], ['tool', tool]])
    const fold = computeTurnFold(order, nodes, { getTurn: () => order }, new Set(), think)
    expect(fold).toMatchObject({
      closed: false, toolCount: 1, messageCount: 1, activityCount: 2,
      finalAssistantKey: null, headerKey: 'think', foldable: true, isTurnHeader: true,
    })
    expect(activityHeaderLabel(fold)).toBe('1 tool calls, 1 messages')
    expect(source).toContain('v === undefined ? false : v')
  })

  it('keeps the completed final message and failure or attachment evidence outside collapse', () => {
    const user = turnNode('user', 'user', 1)
    const think = turnNode('think', 'assistant-step', 2, { blocks: [{ kind: 'reasoning' }] })
    const failed = turnNode('failed', 'tool-call', 3, { root: { kind: 'tool-result', isError: true } })
    const final = turnNode('final', 'assistant-step', 4, { blocks: [{ kind: 'text' }] })
    const order = ['user', 'think', 'failed', 'final']
    const nodes = new Map([['user', user], ['think', think], ['failed', failed], ['final', final]])
    expect(computeTurnFold(order, nodes, { getTurn: () => order }, new Set([1]), final)).toMatchObject({
      finalAssistantKey: 'final', isFinalAssistant: true, foldable: true,
    })
    expect(toolFailed(failed)).toBe(true)
    expect(assistantMustStayVisible(turnNode('image', 'assistant-step', 5, { blocks: [{ kind: 'image' }] }))).toBe(true)
    expect(assistantMustStayVisible(turnNode('stopped', 'assistant-step', 5, { status: 'interrupted' }))).toBe(true)
    expect(source).not.toContain('turnTimings')
    expect(source).not.toMatch(/首 token|缓存命中|tok\/s|消耗.*token/u)
  })
})
