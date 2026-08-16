import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import {
  HELLO_TIMEOUT_MS,
  PING_INTERVAL_MS,
  parseBridgeFrame,
  type BridgeCaps,
  type ServerFrame,
} from './protocol.ts'

interface PendingTool {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
  abort?: () => void
}

interface ReadyConnection {
  ws: WebSocket
  connectedAt: string
  ping: NodeJS.Timeout
}

export class BrowserBridgeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'BrowserBridgeError'
  }
}

function loopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function extensionOrigin(origin: string | undefined): boolean {
  return origin !== undefined && /^(?:chrome|edge)-extension:\/\/[a-p]{32}$/u.test(origin)
}

function equalToken(actual: string, expected: string): boolean {
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function frameText(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return Buffer.from(data).toString('utf8')
}

function send(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
}

export class BrowserBridgeServer {
  private readonly wss = new WebSocketServer({ noServer: true })
  private readonly pending = new Map<string, PendingTool>()
  private current: ReadyConnection | undefined
  private closed = false

  constructor(
    private readonly token: string,
    private readonly caps: BridgeCaps,
  ) {}

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.closed || !loopback(req.socket.remoteAddress) || !extensionOrigin(req.headers.origin)) {
      socket.destroy()
      return
    }
    this.wss.handleUpgrade(req, socket, head, ws => this.attach(ws))
  }

  status(): { connected: boolean; connected_at?: string } {
    return this.current === undefined
      ? { connected: false }
      : { connected: true, connected_at: this.current.connectedAt }
  }

  async requestTool(
    name: string,
    args: Record<string, unknown>,
    sessionId: string,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<unknown> {
    const connection = this.current
    if (connection === undefined || connection.ws.readyState !== WebSocket.OPEN) {
      throw new BrowserBridgeError('browser-not-connected', 'e-Mate 浏览器扩展未连接。')
    }
    signal.throwIfAborted()
    const id = randomUUID()
    const expiresAt = Date.now() + timeoutMs
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.get(id)?.abort?.()
        this.pending.delete(id)
        send(connection.ws, { t: 'tool.cancel', id })
        reject(new BrowserBridgeError('timeout', `${name} timed out`))
      }, timeoutMs)
      const onAbort = () => {
        clearTimeout(timer)
        this.pending.delete(id)
        send(connection.ws, { t: 'tool.cancel', id })
        reject(signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve,
        reject,
        timer,
        abort: () => signal.removeEventListener('abort', onAbort),
      })
      send(connection.ws, { t: 'tool.call', id, name, args, expiresAt, sessionId })
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.replace('browser bridge stopped')
    await new Promise<void>(resolve => this.wss.close(() => resolve()))
  }

  private attach(ws: WebSocket): void {
    let accepted = false
    const hello = setTimeout(() => ws.close(4001, 'hello timeout'), HELLO_TIMEOUT_MS)
    ws.on('message', data => {
      const frame = parseBridgeFrame(frameText(data))
      if (frame === undefined) {
        ws.close(1008, 'invalid frame')
        return
      }
      if (!accepted) {
        if (frame.t !== 'hello' || !equalToken(frame.token, this.token)) {
          ws.close(1008, 'authentication failed')
          return
        }
        accepted = true
        clearTimeout(hello)
        this.promote(ws)
        return
      }
      if (frame.t === 'tool.result') {
        const pending = this.pending.get(frame.id)
        if (pending === undefined) return
        this.pending.delete(frame.id)
        clearTimeout(pending.timer)
        pending.abort?.()
        if (frame.ok) pending.resolve(frame.result)
        else pending.reject(new BrowserBridgeError(frame.error.code, frame.error.message))
      }
    })
    ws.once('close', () => {
      clearTimeout(hello)
      if (this.current?.ws === ws) this.replace('browser extension disconnected')
    })
    ws.once('error', () => {})
  }

  private promote(ws: WebSocket): void {
    this.replace('browser extension connection replaced')
    const ping = setInterval(() => send(ws, { t: 'ping' }), PING_INTERVAL_MS)
    this.current = { ws, ping, connectedAt: new Date().toISOString() }
    send(ws, { t: 'hello.ok', caps: this.caps })
  }

  private replace(message: string): void {
    const connection = this.current
    this.current = undefined
    if (connection !== undefined) {
      clearInterval(connection.ping)
      if (connection.ws.readyState === WebSocket.OPEN || connection.ws.readyState === WebSocket.CONNECTING) {
        connection.ws.close(4000, message)
      }
    }
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.abort?.()
      pending.reject(new BrowserBridgeError('bridge-closed', message))
    }
  }
}
