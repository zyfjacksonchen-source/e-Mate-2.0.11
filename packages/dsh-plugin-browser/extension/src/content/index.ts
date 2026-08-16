import { DEFAULT_SNAPSHOT_MAX_CHARS } from '../../../src/protocol.ts'
import { runAction, ActionError } from './actions.ts'
import { ElementIds } from './ids.ts'
import type { SnapshotBudget } from './snapshot.ts'

let budget: SnapshotBudget = { maxItems: 60, maxForms: 30, maxChars: DEFAULT_SNAPSHOT_MAX_CHARS }
const ids = new ElementIds()
const LISTENER = '__eMateBrowserContentListener__'

export interface ToolResult {
  ok: boolean
  result?: { text: string }
  error?: { code: string; message: string }
}

function onMessage(message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response: ToolResult) => void): true | undefined {
  if (typeof message !== 'object' || message === null) return
  const value = message as { type?: unknown; action?: unknown; args?: unknown; budget?: Partial<SnapshotBudget> }
  if (value.type !== 'EMATE_BROWSER_ACTION' || typeof value.action !== 'string'
    || typeof value.args !== 'object' || value.args === null || Array.isArray(value.args)) return
  const actionBudget = value.budget === undefined ? budget : { ...budget, ...value.budget }
  budget = actionBudget
  void runAction(value.action, value.args as Record<string, unknown>, { ids, budget: actionBudget }).then(
    result => sendResponse({ ok: true, result }),
    (error: unknown) => sendResponse({
      ok: false,
      error: {
        code: error instanceof ActionError ? error.code : 'action-failed',
        message: error instanceof Error ? error.message : String(error),
      },
    }),
  )
  return true
}

const contentGlobal = globalThis as typeof globalThis & { [LISTENER]?: typeof onMessage }
const previous = contentGlobal[LISTENER]
if (previous !== undefined) {
  try { chrome.runtime.onMessage.removeListener(previous) } catch { /* stale extension context */ }
}
contentGlobal[LISTENER] = onMessage
chrome.runtime.onMessage.addListener(onMessage)
