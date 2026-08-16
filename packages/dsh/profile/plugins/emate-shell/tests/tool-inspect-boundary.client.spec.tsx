import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const shellCss = readFileSync(resolve('src/client/chat-chrome.module.css'), 'utf8')
const profile = readFileSync(resolve('../../cordis.patch.yml'), 'utf8')
const targetRoot = resolve('../../../../../upstream/deepseek-harness/packages/client')
const tree = readFileSync(resolve(targetRoot, 'ui-tool/src/client/tool/ToolCallTree.tsx'), 'utf8')
const row = readFileSync(resolve(targetRoot, 'ui-tool/src/client/tool/components/ToolRow.tsx'), 'utf8')
const bash = readFileSync(resolve(targetRoot, 'ui-tool/src/client/tool/toolviews/bash-sample.tsx'), 'utf8')

describe('disabled trajectory Inspect boundary', () => {
  it('hides only the pinned target Inspect seats when trajectory is absent', () => {
    expect(profile).toMatch(/id: ui-trajectory[\s\S]*?disabled: true/u)
    expect(tree).toContain('data-chat-call-id={callId}')
    expect(tree).toContain('inspect: () => { inspectCall(callId) }')
    expect(row).toMatch(/<div className=\{css\.bodyWrap\}>[\s\S]*?\{inspect !== undefined && \([\s\S]*?<button[\s\S]*?<IconInspectOutline12 \/>/u)
    expect(bash).toContain('data-sample="bash"')
    expect(bash).toMatch(/<div className=\{css\.bodyWrap\}>[\s\S]*?\{inspect !== undefined && \([\s\S]*?<button[\s\S]*?<IconInspectOutline12 \/>/u)
    expect(shellCss).toContain("[data-variant] > [data-open='true'] > div > button:has(> svg[aria-hidden][width='12'][height='12'])")
    expect(shellCss).toContain("[data-sample='bash'] + div > button:has(> svg[aria-hidden][width='12'][height='12'])")
    expect(shellCss).toMatch(/\[data-sample='bash'\][^}]*\{\s*display: none;\s*\}/u)
  })
})
