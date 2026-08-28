import { createHash } from 'node:crypto'

/** Minimal authoritative workspace view used by the memory adapter. */
export interface MemoryWorkspace {
  readonly id: string
  readonly path: string
  readonly sessionIds: readonly string[]
  status(): Promise<'ok' | 'missing-dir'>
}

/** Public WorkspaceRegistry operations used to resolve a session owner. */
export interface MemoryWorkspaceRegistry {
  resolveByPath(path: string): Promise<MemoryWorkspace | undefined>
}

/** Calling-agent fields required to bind memory to a session or project. */
export interface MemoryExecution {
  readonly agent?: {
    readonly id: string
    readonly session?: { readonly header?: { readonly cwd?: unknown } }
  }
  readonly signal?: AbortSignal
}

/** Product-owned workspace that must isolate each attached conversation. */
export interface MemoryScopeOptions {
  readonly sessionOnlyWorkspacePath?: string
}

export type MemoryScopeErrorCode = 'unavailable' | 'scope-invalid'

/** Stable classification for recall without hiding scope or directory failures. */
export class MemoryScopeError extends Error {
  constructor(readonly code: MemoryScopeErrorCode, message: string) {
    super(message)
    this.name = 'MemoryScopeError'
  }
}

/** Stable storage identity derived only from authoritative Harness state. */
export type MemoryScope =
  | {
      readonly kind: 'project'
      readonly key: string
      readonly projectId: string
      readonly projectPathSha256: string
      readonly sessionId: string
    }
  | {
      readonly kind: 'session'
      readonly key: string
      readonly sessionId: string
    }

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

/**
 * Resolve memory ownership from the live Agent and WorkspaceRegistry.
 * @param registry - Harness workspace registry with canonical paths and membership.
 * @param execution - Current Tool execution.
 * @returns project scope, or session-only scope for an ungrouped conversation.
 */
export async function resolveMemoryScope(
  registry: MemoryWorkspaceRegistry,
  execution: MemoryExecution,
  options: MemoryScopeOptions = {},
): Promise<MemoryScope> {
  execution.signal?.throwIfAborted()
  const sessionId = execution.agent?.id
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 256) {
    throw new MemoryScopeError('scope-invalid', 'e-Mate memory requires a live Harness session')
  }

  const cwd = execution.agent?.session?.header?.cwd
  if (cwd === undefined) {
    return { kind: 'session', key: `session:${sha256(sessionId)}`, sessionId }
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new MemoryScopeError('scope-invalid', 'e-Mate memory received an invalid session workspace')
  }

  const workspace = await registry.resolveByPath(cwd)
  if (workspace === undefined) {
    throw new MemoryScopeError('scope-invalid', 'e-Mate memory cannot prove the session workspace binding')
  }
  execution.signal?.throwIfAborted()
  if (await workspace.status() !== 'ok') {
    throw new MemoryScopeError('unavailable', 'the owning e-Mate project directory is unavailable')
  }
  execution.signal?.throwIfAborted()
  if (!workspace.sessionIds.some(candidate => String(candidate) === sessionId)) {
    throw new MemoryScopeError('scope-invalid', 'the e-Mate session is not bound to its owning project')
  }
  if (options.sessionOnlyWorkspacePath !== undefined) {
    const sessionOnlyWorkspace = workspace.path === options.sessionOnlyWorkspacePath
      ? workspace
      : await registry.resolveByPath(options.sessionOnlyWorkspacePath)
    if (String(sessionOnlyWorkspace?.id) === String(workspace.id)) {
      return { kind: 'session', key: `session:${sha256(sessionId)}`, sessionId }
    }
  }

  const projectId = String(workspace.id)
  const projectPathSha256 = sha256(workspace.path)
  return {
    kind: 'project',
    key: `project:${projectId}:${projectPathSha256}`,
    projectId,
    projectPathSha256,
    sessionId,
  }
}
