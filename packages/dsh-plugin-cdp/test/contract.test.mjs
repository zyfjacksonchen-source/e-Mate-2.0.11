import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  formatAccessibilitySnapshot,
  validateCdpEndpoint,
} from '../lib/cdp.mjs'
import {
  apply,
  authorizeBrowserMutation,
  browserToolRequiresApproval,
  CDP_CONTROL_SETTINGS_NAMESPACE,
} from '../lib/index.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

function settingsHarness(initial = false, endpoint = 'http://127.0.0.1:9222') {
  let value = { allowControl: initial, endpoint }
  let revision = 0
  return {
    settings: {
      writable: true,
      register: () => ({ get: () => value }),
      describe: () => [{ ns: CDP_CONTROL_SETTINGS_NAMESPACE, revision }],
      replace: async (_ns, next, expectedRevision) => {
        assert.equal(expectedRevision, revision)
        value = next
        revision += 1
      },
    },
    get: () => value,
  }
}

test('accepts only an explicit literal loopback CDP origin', () => {
  assert.equal(validateCdpEndpoint('http://127.0.0.1:9222'), 'http://127.0.0.1:9222')
  assert.equal(validateCdpEndpoint('http://[::1]:9222'), 'http://[::1]:9222')
  for (const endpoint of [
    'https://127.0.0.1:9222',
    'http://localhost:9222',
    'http://example.com:9222',
    'http://127.0.0.1:9222/json',
    'http://user@127.0.0.1:9222',
  ]) assert.throws(() => validateCdpEndpoint(endpoint), /loopback HTTP origin/)
})

test('renders bounded session indices without exposing form values', () => {
  const snapshot = formatAccessibilitySnapshot(
    { title: 'Example', url: 'https://example.com/' },
    [
      { role: { value: 'heading' }, name: { value: 'Welcome' } },
      { role: { value: 'button' }, name: { value: 'Continue' }, backendDOMNodeId: 41 },
      { role: { value: 'textbox' }, name: { value: 'Password' }, value: { value: 'never-print-this' }, backendDOMNodeId: 42 },
    ],
  )
  assert.match(snapshot.text, /\[1\] button "Continue"/)
  assert.match(snapshot.text, /\[2\] textbox "Password"/)
  assert.doesNotMatch(snapshot.text, /never-print-this/)
  assert.deepEqual([...snapshot.indices], [[1, 41], [2, 42]])
})

test('ships no extension, browser binary, runtime downloader, or MCP subprocess', async () => {
  const manifest = JSON.parse(await readFile(`${root}/package.json`, 'utf8'))
  const source = await readFile(`${root}/src/index.ts`, 'utf8')
  assert.equal(manifest.name, '@e-mate/dsh-plugin-cdp')
  assert.equal(manifest.eMate.harnessCommit, '2bc16230975f6cf02aa1b283b1f86de44007b059')
  assert.equal(manifest.files.includes('extension'), false)
  assert.doesNotMatch(source, /npx|playwright|puppeteer|chrome-devtools-mcp|child_process/iu)
})

test('projects real CDP readiness and routes page mutations through native approval', async () => {
  assert.equal(browserToolRequiresApproval('browser_scroll'), true)
  assert.equal(browserToolRequiresApproval('browser_tabs'), false)

  const capabilities = []
  const harness = settingsHarness()
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify([{
    id: 'page-1',
    type: 'page',
    title: 'Example',
    url: 'https://example.com/',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page-1',
  }]), { status: 200 })
  try {
    apply({
      approval: {},
      settings: harness.settings,
      tools: { register: () => () => undefined },
      systemPrompt: { section: () => () => undefined },
      userQuestions: { ask: async () => { throw new Error('unexpected question') } },
      emateCapabilities: {
        register: definition => { capabilities.push(definition); return () => undefined },
      },
      effect: callback => callback(),
    })
    assert.equal(capabilities.length, 1)
    assert.deepEqual(capabilities[0].actions, [
      { id: 'enable-control', label: '启用浏览器控制', kind: 'primary' },
      { id: 'disable-control', label: '停用浏览器控制', kind: 'secondary' },
    ])
    assert.deepEqual(await capabilities[0].status(new AbortController().signal), {
      state: 'ready',
      detail: 'CDP 已连接 · 1 个页面 · 控制未启用',
      action_ids: ['enable-control'],
    })
    await capabilities[0].invoke('enable-control')
    assert.equal(harness.get().allowControl, true)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('rejects mutations before CDP when native approval policy is never', async () => {
  const tools = []
  let requests = 0
  const harness = settingsHarness()
  apply({
    approval: {
      config: { policy: 'ask' },
      overrideOf: () => 'never',
      request: async () => { requests += 1; return 'allowed-once' },
    },
    settings: harness.settings,
    tools: { register: definition => { tools.push(definition); return () => undefined } },
    systemPrompt: { section: () => () => undefined },
    userQuestions: { ask: async () => { throw new Error('unexpected question') } },
    emateCapabilities: { register: () => () => undefined },
    effect: callback => callback(),
  })
  const scroll = tools.find(tool => tool.name === 'browser_scroll')
  await assert.rejects(
    scroll.execute({ direction: 'down' }, {
      agent: { id: 'agent-1', session: {} },
      callId: 'call-1',
      signal: new AbortController().signal,
    }),
    /approval prompts are disabled/,
  )
  assert.equal(requests, 0)
})

test('keeps the CDP control grant separate from sandbox and native approval', async () => {
  let requests = 0
  const exec = {
    agent: { id: 'agent-1', session: {} },
    callId: 'call-1',
    signal: new AbortController().signal,
  }
  const ctx = {
    approval: {
      config: { policy: 'never' },
      overrideOf: () => 'never',
      request: async () => { requests += 1; return 'allowed-once' },
    },
  }
  await authorizeBrowserMutation(ctx, exec, 'browser_click', true)
  assert.equal(requests, 0)
  await assert.rejects(authorizeBrowserMutation(ctx, exec, 'browser_click', false), /approval prompts are disabled/)
  assert.equal(requests, 0)
})

test('does not reuse a browser-control grant for a different CDP endpoint', async () => {
  const capabilities = []
  const harness = settingsHarness(true)
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify([{
    id: 'page-1',
    type: 'page',
    title: 'Example',
    url: 'https://example.com/',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9333/devtools/page/page-1',
  }]), { status: 200 })
  try {
    apply({
      approval: {},
      settings: harness.settings,
      tools: { register: () => () => undefined },
      systemPrompt: { section: () => () => undefined },
      userQuestions: { ask: async () => { throw new Error('unexpected question') } },
      emateCapabilities: {
        register: definition => { capabilities.push(definition); return () => undefined },
      },
      effect: callback => callback(),
    }, { endpoint: 'http://127.0.0.1:9333' })
    assert.deepEqual(await capabilities[0].status(new AbortController().signal), {
      state: 'ready',
      detail: 'CDP 已连接 · 1 个页面 · 控制未启用',
      action_ids: ['enable-control'],
    })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('lets an owning Agent change the same persisted control grant through UserQuestions', async () => {
  const tools = []
  const harness = settingsHarness()
  apply({
    approval: { config: { policy: 'never' }, overrideOf: () => 'never' },
    settings: harness.settings,
    tools: { register: definition => { tools.push(definition); return () => undefined } },
    systemPrompt: { section: () => () => undefined },
    userQuestions: { ask: async () => ({ answers: [{ selected: ['启用控制'] }] }) },
    emateCapabilities: { register: () => () => undefined },
    effect: callback => callback(),
  })
  const access = tools.find(tool => tool.name === 'browser_control_access')
  await assert.doesNotReject(access.execute({ enabled: true }, {
    agent: { id: 'agent-1', session: {} },
    callId: 'call-1',
    signal: new AbortController().signal,
  }))
  assert.equal(harness.get().allowControl, true)
})
