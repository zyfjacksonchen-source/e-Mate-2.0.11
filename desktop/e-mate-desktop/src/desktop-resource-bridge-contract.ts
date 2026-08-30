/** Closed renderer-to-main contract for operator-triggered resource actions. */

export const DESKTOP_RESOURCE_BRIDGE = '__EMATE_DESKTOP_RESOURCES__'
export const DESKTOP_RESOURCE_RUN = 'emate:desktop-resource-run'

export type DesktopResourceAction =
  | 'open-with'
  | 'save-as'
  | 'copy-path'
  | 'copy-file'
  | 'reveal'
  | 'copy-image'

export type DesktopFileResource = { kind: 'file'; sessionId: string; root: string; path: string }
export type DesktopImageResource = { kind: 'image'; sessionId: string; name: string; src: string }
export type DesktopResource = DesktopFileResource | DesktopImageResource

export type DesktopResourceRequest =
  | { action: Exclude<DesktopResourceAction, 'copy-image'>; resource: DesktopFileResource }
  | { action: 'save-as' | 'reveal' | 'copy-image'; resource: DesktopImageResource }

export interface DesktopResourceBridge {
  run(request: DesktopResourceRequest): Promise<void>
}

export interface DesktopResourceBridgeWindow extends Window {
  [DESKTOP_RESOURCE_BRIDGE]?: DesktopResourceBridge
}

const ACTIONS = new Set<DesktopResourceAction>([
  'open-with', 'save-as', 'copy-path', 'copy-file', 'reveal', 'copy-image',
])

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0')
}

/** Reject every action or field outside the frozen v2 Desktop allowlist. */
export function parseDesktopResourceRequest(value: unknown): DesktopResourceRequest | undefined {
  if (!record(value) || !exactKeys(value, ['action', 'resource']) || !ACTIONS.has(value.action as DesktopResourceAction)) {
    return undefined
  }
  const resource = value.resource
  if (!record(resource) || !text(resource.sessionId, 4_096)) return undefined
  if (resource.kind === 'file'
    && exactKeys(resource, ['kind', 'path', 'root', 'sessionId'])
    && value.action !== 'copy-image'
    && text(resource.path, 32_768) && text(resource.root, 32_768)) {
    return { action: value.action as DesktopResourceAction, resource: {
      kind: 'file', sessionId: resource.sessionId, root: resource.root, path: resource.path,
    } } as DesktopResourceRequest
  }
  if (resource.kind === 'image'
    && exactKeys(resource, ['kind', 'name', 'sessionId', 'src'])
    && (value.action === 'save-as' || value.action === 'reveal' || value.action === 'copy-image')
    && text(resource.name, 1_024) && text(resource.src, 4_096) && resource.src.startsWith('blob:')) {
    return { action: value.action as DesktopResourceAction, resource: {
      kind: 'image', sessionId: resource.sessionId, name: resource.name, src: resource.src,
    } } as DesktopResourceRequest
  }
  return undefined
}
