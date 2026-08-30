import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  launchManagedChrome,
} from '../lib/index.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))

function settingsHarness(initial = true, endpoint = 'http://127.0.0.1:9222') {
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
  assert.equal(manifest.eMate.harnessCommit, 'd19aae6da3100e836867418c2cf73bdee8a0b1a8')
  assert.equal(manifest.files.includes('extension'), false)
  assert.doesNotMatch(source, /npx|playwright|puppeteer|chrome-devtools-mcp|child_process/iu)
  assert.match(source, /persistent isolated profile and loopback-only CDP endpoint/u)
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
      { id: 'open-browser', label: '打开浏览器', kind: 'primary' },
      { id: 'enable-control', label: '启用浏览器控制', kind: 'primary' },
      { id: 'disable-control', label: '停用浏览器控制', kind: 'secondary' },
    ])
    assert.deepEqual(await capabilities[0].status(new AbortController().signal), {
      state: 'ready',
      detail: 'CDP 已连接 · 1 个页面 · 控制已启用',
      action_ids: ['disable-control'],
    })
    await capabilities[0].invoke('disable-control')
    assert.equal(harness.get().allowControl, false)
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('starts installed Chrome with an isolated persistent profile and fixed loopback port', async () => {
  const spawns = []
  const controller = new AbortController()
  const profile = await mkdtemp(join(tmpdir(), 'e-mate-cdp-test-'))
  try {
    await launchManagedChrome({
      subprocess: {
        resolveExecutable: async command => `/resolved/${command}`,
        spawn: spec => {
          spawns.push(spec)
          return { done: Promise.resolve({ exitCode: 0 }) }
        },
      },
    }, 'http://127.0.0.1:9222', profile, controller.signal)
    const chromeArgs = [
      '--remote-debugging-port=9222',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ]
    assert.deepEqual(spawns[0].argv, process.platform === 'darwin'
      ? ['/resolved/open', '-na', 'Google Chrome', '--args', ...chromeArgs]
      : process.platform === 'win32'
        ? ['/resolved/cmd.exe', '/d', '/s', '/c', 'start', '', 'chrome.exe', ...chromeArgs]
        : ['/resolved/google-chrome', ...chromeArgs])
  } finally {
    await rm(profile, { recursive: true, force: true })
  }
})

test('keeps Chrome out of application startup and starts it on first browser use', async () => {
  const tools = []
  const capabilities = []
  const disposers = []
  const harness = settingsHarness()
  let browserRunning = false
  let launches = 0
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => {
    if (!browserRunning) throw new Error('CDP is not running')
    return new Response(JSON.stringify([{
      id: 'page-1',
      type: 'page',
      title: 'Example',
      url: 'https://example.com/',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page-1',
    }]), { status: 200 })
  }
  try {
    apply({
      approval: {},
      settings: harness.settings,
      subprocess: {
        resolveExecutable: async command => `/resolved/${command}`,
        spawn: () => {
          launches += 1
          browserRunning = true
          return { done: Promise.resolve({ exitCode: 0 }) }
        },
      },
      tools: { register: definition => { tools.push(definition); return () => undefined } },
      systemPrompt: { section: () => () => undefined },
      userQuestions: { ask: async () => { throw new Error('unexpected question') } },
      emateCapabilities: {
        register: definition => { capabilities.push(definition); return () => undefined },
      },
      effect: callback => {
        const dispose = callback()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
    })

    assert.equal(launches, 0)
    assert.deepEqual(await capabilities[0].status(new AbortController().signal), {
      state: 'ready',
      detail: '首次网页任务时自动启动 Chrome · 控制已启用',
      action_ids: ['open-browser', 'disable-control'],
    })
    assert.equal(launches, 0)

    const tabs = tools.find(tool => tool.name === 'browser_tabs')
    assert.match((await tabs.execute({}, {
      agent: { id: 'agent-1', session: {} },
      callId: 'call-1',
      signal: new AbortController().signal,
    })).text, /page-1\tExample\thttps:\/\/example\.com\//u)
    assert.equal(launches, 1)
  } finally {
    for (const dispose of disposers.reverse()) dispose()
    globalThis.fetch = previousFetch
  }
})

test('rejects mutations before CDP when native approval policy is never', async () => {
  const tools = []
  let requests = 0
  const harness = settingsHarness(false)
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
  const harness = settingsHarness(false)
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

test('makes CDP the first browser path and reserves Computer Use for an explicit mention', async () => {
  const prompts = []
  const harness = settingsHarness()
  apply({
    approval: {},
    settings: harness.settings,
    tools: { register: () => () => undefined },
    systemPrompt: { section: definition => { prompts.push(definition); return () => undefined } },
    userQuestions: { ask: async () => { throw new Error('unexpected question') } },
    emateCapabilities: { register: () => () => undefined },
    effect: callback => callback(),
  })
  assert.equal(harness.get().allowControl, true)
  assert.match(prompts[0].text, /only when the latest user request explicitly asks to read or operate a visible Chrome webpage/u)
  assert.match(prompts[0].text, /Never use them for attachments, image generation, native apps, or non-page work/u)
  assert.match(prompts[0].text, /only when the user explicitly inserts @电脑操控/u)
})
