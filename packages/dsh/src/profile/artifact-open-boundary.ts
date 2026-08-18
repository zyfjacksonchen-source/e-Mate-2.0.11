import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

export const name = 'emate-artifact-open-boundary'
export const inject = ['apiProxy', 'workspaceRegistry']

function inside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

async function localWorkspacePath(ctx: any, value: unknown): Promise<string> {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('path is not absolute')
  const target = await realpath(value)
  if (!ctx.workspaceRegistry.list().some((workspace: { path: string }) => inside(workspace.path, target))) {
    throw new Error('path is outside registered workspaces')
  }
  return target
}

/** Keep the native Host opener, but admit only existing paths owned by a registered local workspace. */
export function apply(ctx: any): void {
  const original = ctx.apiProxy.host.openPath
  const guarded = async (request: any, signal: AbortSignal) => {
    try {
      signal.throwIfAborted()
      const path = await localWorkspacePath(ctx, request?.payload?.path)
      signal.throwIfAborted()
      return await original({ ...request, payload: { path } }, signal)
    } catch {
      return {
        rpcId: request?.rpcId,
        result: {
          ok: false,
          error: {
            code: signal.aborted ? 'cancelled' : 'internal',
            message: signal.aborted
              ? 'path open was aborted'
              : 'path open failed: target must be an existing local path inside a registered workspace',
            details: {},
          },
        },
      }
    }
  }
  ctx.effect(() => {
    ctx.apiProxy.host.openPath = guarded
    return () => {
      if (ctx.apiProxy.host.openPath === guarded) ctx.apiProxy.host.openPath = original
    }
  }, 'emate.artifact-open: workspace boundary')
}
