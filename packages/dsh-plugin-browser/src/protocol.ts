/** Minimal e-Mate browser-extension wire contract. */

export const BRIDGE_PATH = '/ext/browser'
export const BRIDGE_CONFIG_PATH = '/ext/browser-config'
export const HELLO_TIMEOUT_MS = 5_000
export const PING_INTERVAL_MS = 30_000
export const DEFAULT_SNAPSHOT_MAX_CHARS = 32_000
export const MIN_SNAPSHOT_MAX_CHARS = 500

export interface BridgeCaps {
  textOnly: true
  snapshotMaxChars: number
  maxInteractiveItems: number
}

export interface ToolError {
  code: string
  message: string
}

export type ClientFrame =
  | { t: 'hello'; token: string; caps: BridgeCaps }
  | { t: 'pong' }
  | { t: 'tool.result'; id: string; ok: true; result: unknown }
  | { t: 'tool.result'; id: string; ok: false; error: ToolError }

export type ServerFrame =
  | { t: 'hello.ok'; caps: BridgeCaps }
  | { t: 'ping' }
  | { t: 'tool.call'; id: string; name: string; args: Record<string, unknown>; expiresAt: number; sessionId: string }
  | { t: 'tool.cancel'; id: string }
  | { t: 'error'; code: string; message: string }

export type BridgeFrame = ClientFrame | ServerFrame

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, maximum = 512): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum

const caps = (value: unknown): value is BridgeCaps => record(value)
  && value.textOnly === true
  && Number.isSafeInteger(value.snapshotMaxChars)
  && Number(value.snapshotMaxChars) >= MIN_SNAPSHOT_MAX_CHARS
  && Number.isSafeInteger(value.maxInteractiveItems)
  && Number(value.maxInteractiveItems) > 0

export function parseBridgeFrame(raw: string): BridgeFrame | undefined {
  if (raw.length > 1_048_576) return undefined
  let value: unknown
  try { value = JSON.parse(raw) } catch { return undefined }
  if (!record(value) || !text(value.t, 32)) return undefined
  switch (value.t) {
    case 'hello':
      return text(value.token, 256) && caps(value.caps)
        ? value as unknown as Extract<ClientFrame, { t: 'hello' }>
        : undefined
    case 'hello.ok':
      return caps(value.caps) ? value as unknown as Extract<ServerFrame, { t: 'hello.ok' }> : undefined
    case 'ping':
    case 'pong':
      return value as BridgeFrame
    case 'tool.call':
      return text(value.id, 128) && text(value.name, 128) && record(value.args)
        && Number.isSafeInteger(value.expiresAt) && text(value.sessionId, 256)
        ? value as unknown as Extract<ServerFrame, { t: 'tool.call' }>
        : undefined
    case 'tool.cancel':
      return text(value.id, 128) ? value as unknown as Extract<ServerFrame, { t: 'tool.cancel' }> : undefined
    case 'tool.result':
      if (!text(value.id, 128) || typeof value.ok !== 'boolean') return undefined
      if (value.ok) return value as unknown as Extract<ClientFrame, { t: 'tool.result'; ok: true }>
      return record(value.error) && text(value.error.code, 128) && text(value.error.message, 2_000)
        ? value as unknown as Extract<ClientFrame, { t: 'tool.result'; ok: false }>
        : undefined
    case 'error':
      return text(value.code, 128) && text(value.message, 2_000)
        ? value as unknown as Extract<ServerFrame, { t: 'error' }>
        : undefined
    default:
      return undefined
  }
}

export function isServerFrame(frame: BridgeFrame): frame is ServerFrame {
  return frame.t === 'hello.ok' || frame.t === 'ping' || frame.t === 'tool.call'
    || frame.t === 'tool.cancel' || frame.t === 'error'
}
