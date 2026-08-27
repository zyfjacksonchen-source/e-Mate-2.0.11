interface LoaderStatus {
  resolve(id: string): { fiber?: { state?: number } }
}

interface ToolStatus {
  schemas(): readonly { name: string }[]
}

/** Fail closed unless both the native loader fiber and its server Tool surface are live. */
export function isMcpServerActive(
  loader: LoaderStatus,
  tools: ToolStatus,
  entryId: string | undefined,
  serverName: string,
): boolean {
  if (entryId === undefined) return false
  try {
    return loader.resolve(entryId).fiber?.state === 2
      && tools.schemas().some(tool => tool.name.startsWith(`mcp__${serverName}__`))
  } catch {
    return false
  }
}
