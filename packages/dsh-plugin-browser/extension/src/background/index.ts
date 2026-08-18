import {
  BRIDGE_CONFIG_PATH,
  type BridgeCaps,
  type ServerFrame,
} from '../../../src/protocol.ts'
import { BridgeClient, type BridgeState } from './bridge.ts'
import { dispatchToolCall, resetTabSnapshot, type ContentBudget, type ToolCall } from './tools.ts'

interface Discovery { wsUrl: string; token: string }

const SESSION_TABS = 'emateBrowserSessionTabs'
const NEXT_TAB = 'emateBrowserNextTab'
const DISCOVERY_PORTS = Array.from({ length: 101 }, (_, index) => 3080 + index)
const active = new Map<string, AbortController>()
let caps: BridgeCaps = { textOnly: true, snapshotMaxChars: 32_000, maxInteractiveItems: 60 }
let currentDiscovery: Discovery | undefined

function exactDiscovery(value: unknown): Discovery | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const row = value as Record<string, unknown>
  if (row.schema_version !== 1 || row.product !== 'e-Mate' || row.version !== '2.0.9'
    || typeof row.ws_url !== 'string' || typeof row.token !== 'string') return undefined
  try {
    const url = new URL(row.ws_url)
    if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.pathname !== '/ext/browser') return undefined
  } catch { return undefined }
  return { wsUrl: row.ws_url, token: row.token }
}

async function discover(port: number): Promise<Discovery> {
  const response = await fetch(`http://127.0.0.1:${port}${BRIDGE_CONFIG_PATH}`, {
    cache: 'no-store', signal: AbortSignal.timeout(750),
  })
  if (!response.ok) throw new Error('not e-Mate')
  const found = exactDiscovery(await response.json())
  if (found === undefined) throw new Error('invalid e-Mate bridge discovery')
  return found
}

async function discoverAny(): Promise<Discovery | undefined> {
  try { return await Promise.any(DISCOVERY_PORTS.map(discover)) } catch { return undefined }
}

async function sessionMap(): Promise<Record<string, number>> {
  const stored = (await chrome.storage.session.get(SESSION_TABS))[SESSION_TABS]
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
  const result: Record<string, number> = {}
  for (const [id, tab] of Object.entries(stored)) {
    if (id.length <= 256 && typeof tab === 'number' && Number.isSafeInteger(tab)) result[id] = tab
  }
  return result
}

async function saveSessionMap(value: Record<string, number>): Promise<void> {
  await chrome.storage.session.set({ [SESSION_TABS]: value })
}

function usable(tab: chrome.tabs.Tab | undefined): tab is chrome.tabs.Tab & { id: number; url: string } {
  return tab?.id !== undefined && typeof tab.url === 'string' && /^https?:\/\//iu.test(tab.url)
}

async function tabForSession(sessionId: string): Promise<chrome.tabs.Tab & { id: number; url: string }> {
  const stored = await sessionMap()
  const preferred = (await chrome.storage.session.get(NEXT_TAB))[NEXT_TAB]
  const explicit = Number.isSafeInteger(preferred)
  let tab: chrome.tabs.Tab | undefined
  if (explicit) {
    await chrome.storage.session.remove(NEXT_TAB)
    try { tab = await chrome.tabs.get(preferred as number) } catch { tab = undefined }
  }
  if (!usable(tab) && Number.isSafeInteger(stored[sessionId])) {
    try { tab = await chrome.tabs.get(stored[sessionId]!) } catch { tab = undefined }
  }
  if (!usable(tab)) tab = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
  if (!usable(tab)) throw new Error('没有可绑定的 http/https 浏览器标签页。')
  const owner = Object.entries(stored).find(([id, tabId]) => id !== sessionId && tabId === tab!.id)?.[0]
  if (owner !== undefined && !explicit) {
    throw new Error('当前标签页已绑定其他 e-Mate 会话。请先打开或切换到另一个标签页，再点击 e-Mate 浏览器扩展图标后重试。')
  }
  if (explicit) {
    for (const [id, tabId] of Object.entries(stored)) {
      if (id !== sessionId && tabId === tab.id) delete stored[id]
    }
  }
  stored[sessionId] = tab.id
  await saveSessionMap(stored)
  return tab
}

async function stillBound(sessionId: string, tabId: number): Promise<boolean> {
  return (await sessionMap())[sessionId] === tabId
}

function sendResult(frame: Extract<ServerFrame, { t: 'tool.call' }>, answer: Awaited<ReturnType<typeof dispatchToolCall>>): void {
  bridge.send(answer.ok
    ? { t: 'tool.result', id: frame.id, ok: true, result: answer.result }
    : { t: 'tool.result', id: frame.id, ok: false, error: answer.error ?? { code: 'action-failed', message: 'browser action failed' } })
}

async function handleTool(frame: Extract<ServerFrame, { t: 'tool.call' }>): Promise<void> {
  const controller = new AbortController()
  active.set(frame.id, controller)
  try {
    const tab = await tabForSession(frame.sessionId)
    const call: ToolCall = { id: frame.id, name: frame.name, args: frame.args, expiresAt: frame.expiresAt, sessionId: frame.sessionId }
    const budget: ContentBudget = { maxItems: caps.maxInteractiveItems, maxChars: caps.snapshotMaxChars }
    const answer = await dispatchToolCall(call, 'auto', budget, async () => 'approved', controller.signal, tab, () => true)
    if (!(await stillBound(frame.sessionId, tab.id))) {
      sendResult(frame, { ok: false, error: { code: 'target-changed', message: '会话绑定的浏览器标签页已改变，请重新执行。' } })
      return
    }
    sendResult(frame, answer)
  } catch (error: unknown) {
    sendResult(frame, { ok: false, error: { code: 'content-unavailable', message: error instanceof Error ? error.message : String(error) } })
  } finally {
    active.delete(frame.id)
  }
}

function onFrame(frame: ServerFrame): void {
  if (frame.t === 'tool.call') void handleTool(frame)
  if (frame.t === 'tool.cancel') active.get(frame.id)?.abort()
}

function setBadge(state: BridgeState): void {
  const connected = state === 'connected'
  void chrome.action.setBadgeBackgroundColor({ color: connected ? '#E85D1A' : '#737373' })
  void chrome.action.setBadgeText({ text: connected ? '✓' : '' })
  void chrome.action.setTitle({ title: connected ? 'e-Mate 浏览器已连接' : 'e-Mate 浏览器正在连接' })
}

const bridge = new BridgeClient({
  onStateChange: setBadge,
  onFrame,
  onHelloOk: value => { caps = value },
})

async function connect(): Promise<void> {
  const found = await discoverAny()
  if (found === undefined) return
  if (currentDiscovery?.wsUrl === found.wsUrl && currentDiscovery.token === found.token && bridge.state !== 'stopped') return
  currentDiscovery = found
  bridge.start(found.wsUrl, found.token)
}

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined || !usable(tab)) return
  void chrome.storage.session.set({ [NEXT_TAB]: tab.id }).then(() => {
    resetTabSnapshot(tab.id!)
    return chrome.action.setTitle({ title: '已选择此标签页；下一次 e-Mate 浏览器操作将绑定到这里。', tabId: tab.id })
  })
})

chrome.tabs.onRemoved.addListener(tabId => {
  void sessionMap().then(async stored => {
    let changed = false
    for (const [sessionId, storedTab] of Object.entries(stored)) {
      if (storedTab !== tabId) continue
      delete stored[sessionId]
      changed = true
    }
    if (changed) await saveSessionMap(stored)
    resetTabSnapshot(tabId)
  })
})

chrome.alarms.create('emate-browser-connect', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'emate-browser-connect') void connect() })
void connect()
