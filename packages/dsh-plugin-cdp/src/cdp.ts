/** Small dependency-free CDP client restricted to a user-enabled loopback endpoint. */

const MAX_JSON_BYTES = 1024 * 1024
const MAX_TARGETS = 256
const MAX_SNAPSHOT_CHARS = 40_000
const MAX_INTERACTIVE_NODES = 80

export interface CdpTarget {
  readonly id: string
  readonly type: 'page'
  readonly title: string
  readonly url: string
  readonly webSocketDebuggerUrl: string
}

export interface AccessibilityNode {
  readonly nodeId?: string
  readonly ignored?: boolean
  readonly backendDOMNodeId?: number
  readonly role?: { readonly value?: unknown }
  readonly name?: { readonly value?: unknown }
}

export interface AccessibilitySnapshot {
  readonly text: string
  readonly indices: ReadonlyMap<number, number>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Accept only explicit literal loopback HTTP origins; no DNS, paths, credentials, or query state. */
export function validateCdpEndpoint(value: unknown): string {
  if (typeof value !== 'string') throw new Error('CDP endpoint must be a string')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('CDP endpoint is invalid') }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.port === '' || !/^[1-9][0-9]{0,4}$/u.test(url.port) || Number(url.port) > 65_535
    || url.username !== '' || url.password !== '' || !['', '/'].includes(url.pathname)
    || url.search !== '' || url.hash !== '') {
    throw new Error('CDP endpoint must be an explicit loopback HTTP origin with a port')
  }
  return url.origin
}

function validateDebuggerUrl(value: unknown, endpoint: string): string {
  if (typeof value !== 'string') throw new Error('CDP target has no debugger URL')
  const base = new URL(endpoint)
  let url: URL
  try { url = new URL(value) } catch { throw new Error('CDP target debugger URL is invalid') }
  if (url.protocol !== 'ws:' || url.hostname !== base.hostname || url.port !== base.port
    || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== ''
    || !url.pathname.startsWith('/devtools/page/')) {
    throw new Error('CDP target debugger URL escaped the configured loopback origin')
  }
  return url.href
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status !== 200 || response.body === null) throw new Error(`CDP endpoint returned HTTP ${response.status}`)
  const declared = response.headers.get('content-length')
  if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared)
    || BigInt(declared) > BigInt(MAX_JSON_BYTES))) throw new Error('CDP endpoint response is too large')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('CDP endpoint response is too large')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)))
  } catch { throw new Error('CDP endpoint returned invalid JSON') }
}

function parseTargets(value: unknown, endpoint: string): CdpTarget[] {
  if (!Array.isArray(value) || value.length > MAX_TARGETS) throw new Error('CDP target list is invalid')
  const targets: CdpTarget[] = []
  for (const item of value) {
    if (!record(item) || item.type !== 'page' || typeof item.id !== 'string' || item.id === ''
      || typeof item.title !== 'string' || typeof item.url !== 'string') continue
    targets.push({
      id: item.id,
      type: 'page',
      title: item.title.slice(0, 500),
      url: item.url.slice(0, 4_000),
      webSocketDebuggerUrl: validateDebuggerUrl(item.webSocketDebuggerUrl, endpoint),
    })
  }
  return targets
}

interface PendingCommand {
  readonly resolve: (value: Record<string, unknown>) => void
  readonly reject: (cause: Error) => void
  readonly dispose: () => void
}

export class CdpConnection {
  private nextId = 1
  private readonly pending = new Map<number, PendingCommand>()

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', event => { this.receive(event.data) })
    socket.addEventListener('close', () => { this.failAll(new Error('CDP connection closed')) })
    socket.addEventListener('error', () => { this.failAll(new Error('CDP connection failed')) })
  }

  static async open(url: string, signal: AbortSignal): Promise<CdpConnection> {
    signal.throwIfAborted()
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        signal.removeEventListener('abort', abort)
        socket.removeEventListener('open', opened)
        socket.removeEventListener('error', failed)
      }
      const abort = (): void => {
        cleanup()
        socket.close()
        reject(signal.reason instanceof Error ? signal.reason : new Error('CDP connection aborted'))
      }
      const opened = (): void => { cleanup(); resolve() }
      const failed = (): void => { cleanup(); reject(new Error('CDP connection failed')) }
      signal.addEventListener('abort', abort, { once: true })
      socket.addEventListener('open', opened, { once: true })
      socket.addEventListener('error', failed, { once: true })
    })
    return new CdpConnection(socket)
  }

  async send(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    signal.throwIfAborted()
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('CDP connection is not open')
    const id = this.nextId++
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const abort = (): void => {
        this.pending.delete(id)
        reject(signal.reason instanceof Error ? signal.reason : new Error('CDP command aborted'))
      }
      const dispose = (): void => { signal.removeEventListener('abort', abort) }
      signal.addEventListener('abort', abort, { once: true })
      this.pending.set(id, { resolve, reject, dispose })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (cause) {
        this.pending.delete(id)
        dispose()
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
  }

  close(): void {
    this.socket.close()
    this.failAll(new Error('CDP connection closed'))
  }

  private receive(data: unknown): void {
    let value: unknown
    try { value = JSON.parse(String(data)) } catch { return }
    if (!record(value) || !Number.isSafeInteger(value.id)) return
    const pending = this.pending.get(value.id as number)
    if (pending === undefined) return
    this.pending.delete(value.id as number)
    pending.dispose()
    if (record(value.error)) {
      pending.reject(new Error(typeof value.error.message === 'string' ? value.error.message : 'CDP command failed'))
    } else {
      pending.resolve(record(value.result) ? value.result : {})
    }
  }

  private failAll(cause: Error): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      pending.dispose()
      pending.reject(cause)
    }
  }
}

const INTERACTIVE_ROLES = new Set([
  'button', 'checkbox', 'combobox', 'link', 'listbox', 'menuitem', 'radio', 'searchbox',
  'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem',
])

function axString(value: unknown): string {
  return record(value) && typeof value.value === 'string'
    ? value.value.replace(/\s+/gu, ' ').trim().slice(0, 1_000)
    : ''
}

/** Convert the protocol AX tree into bounded text plus stable backend-node indices. */
export function formatAccessibilitySnapshot(
  target: Pick<CdpTarget, 'title' | 'url'>,
  nodes: readonly AccessibilityNode[],
): AccessibilitySnapshot {
  const indices = new Map<number, number>()
  const lines = [`Title: ${target.title}`, `URL: ${target.url}`, '', 'Accessibility tree:']
  let characters = lines.reduce((sum, line) => sum + line.length + 1, 0)
  let nextIndex = 1
  for (const node of nodes) {
    if (node.ignored === true) continue
    const role = axString(node.role)
    const name = axString(node.name)
    if (role === '' || name === '' || ['generic', 'none', 'RootWebArea'].includes(role)) continue
    if (INTERACTIVE_ROLES.has(role) && Number.isSafeInteger(node.backendDOMNodeId)
      && nextIndex <= MAX_INTERACTIVE_NODES) {
      indices.set(nextIndex, node.backendDOMNodeId!)
      const line = `[${nextIndex}] ${role} ${JSON.stringify(name)}`
      lines.push(line)
      characters += line.length + 1
      nextIndex += 1
    } else if (['heading', 'paragraph', 'StaticText', 'img', 'listitem'].includes(role)) {
      const line = `${role}: ${name}`
      lines.push(line)
      characters += line.length + 1
    }
    if (characters >= MAX_SNAPSHOT_CHARS) {
      lines.push('[snapshot truncated]')
      break
    }
  }
  return { text: lines.join('\n').slice(0, MAX_SNAPSHOT_CHARS), indices }
}

interface SessionSnapshot {
  readonly targetId: string
  readonly indices: ReadonlyMap<number, number>
}

export class CdpBrowser {
  private readonly endpoint: string
  private readonly targets = new Map<string, string>()
  private readonly snapshots = new Map<string, SessionSnapshot>()

  constructor(endpoint: string, private readonly request: typeof fetch = fetch) {
    this.endpoint = validateCdpEndpoint(endpoint)
  }

  async pages(signal: AbortSignal): Promise<CdpTarget[]> {
    const url = new URL('/json/list', this.endpoint)
    return parseTargets(await readJson(await this.request(url, {
      method: 'GET', cache: 'no-store', redirect: 'error', signal,
    })), this.endpoint)
  }

  async select(sessionId: string, targetId: string, signal: AbortSignal): Promise<CdpTarget> {
    const target = (await this.pages(signal)).find(candidate => candidate.id === targetId)
    if (target === undefined) throw new Error('CDP page target is unavailable')
    this.targets.set(sessionId, target.id)
    this.snapshots.delete(sessionId)
    return target
  }

  async withPage<T>(
    sessionId: string,
    signal: AbortSignal,
    callback: (connection: CdpConnection, target: CdpTarget) => Promise<T>,
  ): Promise<T> {
    const pages = await this.pages(signal)
    if (pages.length === 0) {
      throw new Error('No CDP page is available. Enable remote debugging in Chrome at chrome://inspect/#remote-debugging.')
    }
    const selected = this.targets.get(sessionId)
    const target = pages.find(candidate => candidate.id === selected) ?? pages[0]!
    this.targets.set(sessionId, target.id)
    const connection = await CdpConnection.open(target.webSocketDebuggerUrl, signal)
    try { return await callback(connection, target) } finally { connection.close() }
  }

  rememberSnapshot(sessionId: string, targetId: string, indices: ReadonlyMap<number, number>): void {
    this.snapshots.set(sessionId, { targetId, indices })
  }

  backendNode(sessionId: string, targetId: string, index: number): number {
    const snapshot = this.snapshots.get(sessionId)
    const node = snapshot?.targetId === targetId ? snapshot.indices.get(index) : undefined
    if (node === undefined) throw new Error('Browser element index is stale; run browser_snapshot again')
    return node
  }
}

export function runtimeValue(result: Record<string, unknown>): unknown {
  const remote = record(result.result) ? result.result : undefined
  if (remote === undefined) throw new Error('CDP Runtime result is invalid')
  if (typeof remote.description === 'string' && remote.subtype === 'error') throw new Error(remote.description)
  return remote.value
}
